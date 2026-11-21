import * as THREE from 'three';

const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _col = new THREE.Color();

function createOpticalGlintTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;

  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.42);
  core.addColorStop(0.0, 'rgba(255, 253, 245, 1.0)');
  core.addColorStop(0.18, 'rgba(255, 250, 236, 0.62)');
  core.addColorStop(0.5, 'rgba(235, 246, 255, 0.14)');
  core.addColorStop(1.0, 'rgba(235, 246, 255, 0.0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, s, s);

  ctx.save();
  ctx.translate(cx, cx);
  for (let i = 0; i < 2; i++) {
    ctx.rotate((Math.PI / 2) * i + 0.35);
    const lg = ctx.createLinearGradient(-cx * 0.85, 0, cx * 0.85, 0);
    lg.addColorStop(0.0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.45, 'rgba(255,252,244,0.38)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    lg.addColorStop(0.55, 'rgba(255,252,244,0.38)');
    lg.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(-cx * 0.85, -1.3, cx * 1.7, 2.6);
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Creates a real-world continuous shimmering transparent water jet / shower cone shader
 * (replaces opaque marble bead chains with realistic Fresnel translucent flowing water!).
 */
function createWaterStreamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uIsShower: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      uniform float uTime;
      uniform float uIsShower;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Subtle organic high-speed fluid turbulence ripples along the stream
        float ripple = sin(uv.y * 28.0 - uTime * 34.0 + uv.x * 12.566) * 0.0022 * uv.y;
        p.x += normal.x * ripple;
        p.z += normal.z * ripple;
        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uIsShower;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        if (uOpacity <= 0.01) discard;
        // Core-bright aerated water stream fading smoothly to 0 at edges (zero hard cylinder outline!)
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float coreSoft = pow(ndv, 1.15);

        // Fast-moving aerated water streaks & sunlit sparkle filaments along flow length
        float n1 = noise(vec2(vUv.x * (uIsShower > 0.5 ? 24.0 : 9.0), vUv.y * 14.0 - uTime * 30.0));
        float n2 = noise(vec2(vUv.x * (uIsShower > 0.5 ? 48.0 : 18.0) + 4.2, vUv.y * 28.0 - uTime * 42.0));
        float breakup = smoothstep(0.12, 0.84, n1 * 0.60 + n2 * 0.40);

        float filament = uIsShower > 0.5
          ? (0.28 + 0.72 * pow(sin(vUv.x * 75.398) * 0.5 + 0.5, 1.8)) * (0.55 + breakup * 0.65)
          : (0.62 + breakup * 0.68);

        // Smooth organic fade at nozzle exit & gently feathering into splash cloud at car door
        float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        float tipDensity = mix(1.0, 0.58, vUv.y);

        vec3 waterCol = mix(vec3(0.84, 0.94, 1.0), vec3(1.0, 1.0, 1.0), clamp(coreSoft * 0.75 + breakup * 0.55, 0.0, 1.0));
        float alpha = coreSoft * filament * endFade * tipDensity * (uIsShower > 0.5 ? 0.68 : 0.88) * uOpacity;
        gl_FragColor = vec4(waterCol, clamp(alpha, 0.0, 0.84));
      }
    `,
  });
}

export class WashParticleSystem {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'WashParticles';
    scene.add(this.group);

    // 0. Continuous translucent shimmering water jet / shower cone mesh (zero marble-ball artifacts!)
    // Cylinder oriented along +Y from y=0 to y=1, radius 1 at base -> flared at impact
    const jetGeom = new THREE.CylinderGeometry(1.0, 0.28, 1.0, 16, 12, true);
    jetGeom.translate(0, 0.5, 0);
    this.streamMat = createWaterStreamMaterial();
    this.streamMesh = new THREE.Mesh(jetGeom, this.streamMat);
    this.streamMesh.visible = false;
    this.streamMesh.frustumCulled = false;
    this.streamMesh.renderOrder = 3;
    this.group.add(this.streamMesh);

    // Second fine outer mist sheath for realistic aerated spray halo
    const mistGeom = new THREE.CylinderGeometry(1.75, 0.35, 1.0, 14, 8, true);
    mistGeom.translate(0, 0.5, 0);
    this.mistMat = createWaterStreamMaterial();
    this.mistMesh = new THREE.Mesh(mistGeom, this.mistMat);
    this.mistMesh.visible = false;
    this.mistMesh.frustumCulled = false;
    this.mistMesh.renderOrder = 3;
    this.group.add(this.mistMesh);

    this.streamTargetOpacity = 0;

    // 1. Fine glistening water splash micro-droplets (crisp sparkling spray droplets!)
    this.maxWater = 320;
    const dropGeom = new THREE.OctahedronGeometry(0.0056, 0);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffffff'),
      emissive: new THREE.Color('#dceeff'),
      emissiveIntensity: 0.35,
      roughness: 0.02,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      envMapIntensity: 2.2,
    });
    this.waterMesh = new THREE.InstancedMesh(dropGeom, dropMat, this.maxWater);
    this.waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 4;
    this.waterPool = Array.from({ length: this.maxWater }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      size: 1,
      stretch: 1,
      muddy: 0,
    }));
    this.waterCursor = 0;
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < this.maxWater; i++) {
      this.waterMesh.setMatrixAt(i, _m4);
      this.waterMesh.setColorAt(i, _col.set('#ffffff'));
    }
    this.group.add(this.waterMesh);

    // 2. Soft bright subsurface-lit 3D frothy foam clusters (80 tris/instance -> lean triangle budget!)
    this.maxFoam = 160;
    const foamGeom = new THREE.IcosahedronGeometry(0.017, 1);
    const fPos = foamGeom.attributes.position;
    for (let i = 0; i < fPos.count; i++) {
      const vx = fPos.getX(i);
      const vy = fPos.getY(i);
      const vz = fPos.getZ(i);
      const bump = 0.88 + 0.24 * Math.sin(vx * 110 + vy * 130) * Math.cos(vz * 110);
      fPos.setXYZ(i, vx * bump, vy * bump * 0.52, vz * bump);
    }
    foamGeom.computeVertexNormals();

    const foamMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#fbfdff'),
      emissive: new THREE.Color('#e6eef5'),
      emissiveIntensity: 0.24, // real light scatter inside sunlit white foam (never dark grey blobs!)
      roughness: 0.34,
      metalness: 0.0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.18,
      sheen: 0.45,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#ffffff'),
      envMapIntensity: 1.05,
    });
    this.foamMesh = new THREE.InstancedMesh(foamGeom, foamMat, this.maxFoam);
    this.foamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foamMesh.frustumCulled = false;
    this.foamMesh.castShadow = false;
    this.foamMesh.receiveShadow = false;
    this.foamPool = Array.from({ length: this.maxFoam }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      size: 1,
      targetSize: 1,
      slideVel: 0,
      washingOff: false,
      vel: new THREE.Vector3(),
    }));
    this.foamCursor = 0;
    for (let i = 0; i < this.maxFoam; i++) this.foamMesh.setMatrixAt(i, _m4);
    this.group.add(this.foamMesh);

    // 3. Physically iridescent floating soap bubbles (thin-film interference!)
    this.maxBubbles = 40;
    const bubbleGeom = new THREE.SphereGeometry(0.022, 12, 10);
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffffff'),
      roughness: 0.02,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      iridescence: 1.0,
      iridescenceIOR: 1.33,
      iridescenceThicknessRange: [180, 520],
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      envMapIntensity: 2.3,
    });
    this.bubbleMesh = new THREE.InstancedMesh(bubbleGeom, bubbleMat, this.maxBubbles);
    this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbleMesh.frustumCulled = false;
    this.bubblePool = Array.from({ length: this.maxBubbles }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 3,
      size: 1,
      wobblePhase: Math.random() * Math.PI * 2,
    }));
    this.bubbleCursor = 0;
    for (let i = 0; i < this.maxBubbles; i++) this.bubbleMesh.setMatrixAt(i, _m4);
    this.group.add(this.bubbleMesh);

    // 4. Delicate optical sun-glints on spotless wiped clearcoat
    const glintTex = createOpticalGlintTexture();
    this.glints = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glintTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(0.24, 0.24, 1);
      sp.userData = { phase: i * 1.17 };
      this.group.add(sp);
      this.glints.push(sp);
    }
  }

  _updateStreamVisual(nozzleTip, hitPoint, isShower) {
    _dir.subVectors(hitPoint, nozzleTip);
    const dist = Math.max(0.15, _dir.length());
    _dir.divideScalar(dist);
    _quat.setFromUnitVectors(_up, _dir);

    const endRadius = isShower ? Math.min(0.24, 0.08 + dist * 0.07) : Math.min(0.044, 0.015 + dist * 0.012);

    this.streamMesh.position.copy(nozzleTip);
    this.streamMesh.quaternion.copy(_quat);
    this.streamMesh.scale.set(endRadius, dist, endRadius);
    this.streamMesh.visible = true;
    this.streamMat.uniforms.uIsShower.value = isShower ? 1.0 : 0.0;

    this.mistMesh.position.copy(nozzleTip);
    this.mistMesh.quaternion.copy(_quat);
    this.mistMesh.scale.set(endRadius * 1.6, dist * 0.96, endRadius * 1.6);
    this.mistMesh.visible = true;
    this.mistMat.uniforms.uIsShower.value = isShower ? 1.0 : 0.0;

    this.streamTargetOpacity = 1.0;
  }

  stopStream() {
    this.streamTargetOpacity = 0;
  }

  emitHoseJet(nozzleTip, hitPoint, hitNormal, mudHint = 0.2, count = 10) {
    this._updateStreamVisual(nozzleTip, hitPoint, false);

    // Fine sparkling rebound splash droplets bursting cleanly off the car metal!
    for (let i = 0; i < count; i++) {
      const p = this.waterPool[this.waterCursor];
      this.waterCursor = (this.waterCursor + 1) % this.maxWater;
      p.alive = true;
      p.pos.copy(hitPoint).addScaledVector(hitNormal, 0.012);
      p.pos.x += (Math.random() - 0.5) * 0.04;
      p.pos.y += (Math.random() - 0.5) * 0.04;
      const speed = 0.9 + Math.random() * 2.2;
      p.vel.copy(hitNormal).multiplyScalar(speed * 0.52);
      p.vel.x += (Math.random() - 0.5) * speed * 1.5;
      p.vel.y += Math.random() * speed * 0.95;
      p.vel.z += (Math.random() - 0.5) * speed * 1.3;
      p.life = 0;
      p.maxLife = 0.22 + Math.random() * 0.30;
      p.size = 0.55 + Math.random() * 0.65;
      p.stretch = 2.4 + Math.random() * 1.8;
      p.muddy = mudHint > 0.12 && Math.random() < 0.35 ? mudHint : 0;
    }
  }

  emitShowerFan(nozzleTip, hitPoint, hitNormal, count = 14) {
    this._updateStreamVisual(nozzleTip, hitPoint, true);

    for (let i = 0; i < count; i++) {
      const p = this.waterPool[this.waterCursor];
      this.waterCursor = (this.waterCursor + 1) % this.maxWater;
      p.alive = true;
      p.pos.copy(hitPoint).addScaledVector(hitNormal, 0.018);
      p.pos.x += (Math.random() - 0.5) * 0.28;
      p.pos.y += (Math.random() - 0.5) * 0.22;
      p.vel.copy(hitNormal).multiplyScalar(0.35 + Math.random() * 0.75);
      p.vel.y += 0.25 + Math.random() * 0.65;
      p.vel.x += (Math.random() - 0.5) * 1.0;
      p.vel.z += (Math.random() - 0.5) * 0.9;
      p.life = 0;
      p.maxLife = 0.24 + Math.random() * 0.24;
      p.size = 0.45 + Math.random() * 0.55;
      p.stretch = 1.9 + Math.random() * 1.2;
      p.muddy = 0;
    }
  }

  spawnFoamAt(worldPos, worldNormal, count = 3) {
    for (let i = 0; i < count; i++) {
      const f = this.foamPool[this.foamCursor];
      this.foamCursor = (this.foamCursor + 1) % this.maxFoam;
      f.alive = true;
      f.washingOff = false;
      f.normal.copy(worldNormal).normalize();
      f.pos.copy(worldPos).addScaledVector(f.normal, 0.008);
      f.pos.x += (Math.random() - 0.5) * 0.14;
      f.pos.y += (Math.random() - 0.5) * 0.11;
      f.pos.z += (Math.random() - 0.5) * 0.06;
      f.size = 0.12;
      f.targetSize = 0.58 + Math.random() * 0.92;
      f.slideVel = 0.004 + Math.random() * 0.010;
    }
    if (Math.random() < 0.48) {
      this.spawnBubble(worldPos, worldNormal);
    }
  }

  spawnBubble(origin, normal = null) {
    const b = this.bubblePool[this.bubbleCursor];
    this.bubbleCursor = (this.bubbleCursor + 1) % this.maxBubbles;
    b.alive = true;
    b.pos.copy(origin);
    if (normal) b.pos.addScaledVector(normal, 0.05);
    b.vel.set(
      (Math.random() - 0.5) * 0.26,
      0.22 + Math.random() * 0.30,
      (Math.random() - 0.5) * 0.24 + 0.10
    );
    b.life = 0;
    b.maxLife = 2.2 + Math.random() * 2.2;
    b.size = 0.45 + Math.random() * 1.05;
    b.wobblePhase = Math.random() * Math.PI * 2;
  }

  rinseFoamNear(worldPos, radius = 0.48) {
    const r2 = radius * radius;
    for (let i = 0; i < this.maxFoam; i++) {
      const f = this.foamPool[i];
      if (!f.alive || f.washingOff) continue;
      if (f.pos.distanceToSquared(worldPos) < r2) {
        f.washingOff = true;
        f.vel.set(
          (Math.random() - 0.5) * 0.35,
          -0.6 - Math.random() * 0.65,
          0.24 + Math.random() * 0.32
        );
      }
    }
  }

  clearAllFoam() {
    for (const f of this.foamPool) f.alive = false;
  }

  /**
   * Pops any floating iridescent soap bubble touched/swiped by the pointer ray!
   * Returns number of popped bubbles (for delightful plop sound feedback).
   */
  popBubblesNearRay(ray) {
    let popped = 0;
    const closest = new THREE.Vector3();
    for (let i = 0; i < this.maxBubbles; i++) {
      const b = this.bubblePool[i];
      if (!b.alive) continue;
      ray.closestPointToPoint(b.pos, closest);
      const hitDist = 0.11 + b.size * 0.04;
      if (closest.distanceTo(b.pos) < hitDist) {
        b.alive = false;
        _m4.makeScale(0, 0, 0);
        this.bubbleMesh.setMatrixAt(i, _m4);
        // Tiny sparkling burst of 5 water micro-droplets when bubble pops!
        for (let k = 0; k < 5; k++) {
          const p = this.waterPool[this.waterCursor];
          this.waterCursor = (this.waterCursor + 1) % this.maxWater;
          p.alive = true;
          p.pos.copy(b.pos);
          p.vel.set((Math.random() - 0.5) * 1.4, 0.3 + Math.random() * 0.9, (Math.random() - 0.5) * 1.4);
          p.life = 0;
          p.maxLife = 0.18 + Math.random() * 0.14;
          p.size = 0.45;
          p.stretch = 1.4;
          p.muddy = 0;
        }
        popped++;
      }
    }
    if (popped > 0) this.bubbleMesh.instanceMatrix.needsUpdate = true;
    return popped;
  }

  seedShowcaseFoam(carGroup) {
    this.clearAllFoam();
    // Tight organic frothy suds clustered gently along the foamy door panel
    const spots = [
      [-0.44, 0.88, 0.96], [-0.26, 0.92, 0.96], [-0.08, 0.86, 0.96],
      [-0.36, 0.72, 0.96], [-0.16, 0.70, 0.96], [-0.52, 0.78, 0.95],
      [-0.30, 1.02, 0.92], [-0.62, 1.04, 0.90], [0.06, 0.88, 0.96],
    ];
    for (const [x, y, z] of spots) {
      const p = new THREE.Vector3(x, y, z).add(carGroup.position);
      const n = new THREE.Vector3(0, 0.12, 0.96).normalize();
      this.spawnFoamAt(p, n, 5);
    }
    for (const f of this.foamPool) {
      if (f.alive) f.size = f.targetSize;
    }
    for (let i = 0; i < 6; i++) {
      this.spawnBubble(
        new THREE.Vector3(-0.85 + Math.random() * 1.4, 0.85 + Math.random() * 0.7, 1.08 + Math.random() * 0.4)
      );
    }
  }

  setSparkleIntensity(amount, elapsed) {
    const spots = [
      [-1.52, 1.16, 0.52], [-0.95, 1.24, 0.72], [-0.20, 1.12, 0.94],
      [0.45, 1.06, 0.95], [-0.65, 1.56, 0.42], [0.95, 1.18, 0.90],
      [-1.78, 0.95, 0.76], [0.15, 1.66, 0.35],
    ];
    for (let i = 0; i < this.glints.length; i++) {
      const sp = this.glints[i];
      const spot = spots[i % spots.length];
      sp.position.set(spot[0], spot[1], spot[2]);
      const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 2.1 + sp.userData.phase)), 5);
      const op = amount * (0.10 + pulse * 0.56);
      sp.material.opacity = op;
      const sc = 0.16 + pulse * 0.22;
      sp.scale.set(sc, sc, 1);
      sp.visible = op > 0.015;
    }
  }

  update(dt, elapsed) {
    // 0. Smooth stream fade in/out
    this.streamMat.uniforms.uTime.value = elapsed;
    this.mistMat.uniforms.uTime.value = elapsed;
    const curOp = this.streamMat.uniforms.uOpacity.value;
    const nextOp = curOp + (this.streamTargetOpacity - curOp) * Math.min(1, dt * 16);
    this.streamMat.uniforms.uOpacity.value = nextOp;
    this.mistMat.uniforms.uOpacity.value = nextOp * 0.45;
    if (nextOp < 0.015) {
      this.streamMesh.visible = false;
      this.mistMesh.visible = false;
    }

    // 1. Update fine splash droplets
    let waterDirty = false;
    for (let i = 0; i < this.maxWater; i++) {
      const p = this.waterPool[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife || p.pos.y < 0.01) {
        p.alive = false;
        _m4.makeScale(0, 0, 0);
        this.waterMesh.setMatrixAt(i, _m4);
        waterDirty = true;
        continue;
      }
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);

      _dir.copy(p.vel);
      const speed = _dir.length();
      if (speed > 0.01) {
        _dir.divideScalar(speed);
        _quat.setFromUnitVectors(_up, _dir);
      } else {
        _quat.identity();
      }
      const fade = 1.0 - Math.pow(p.life / p.maxLife, 2);
      const r = p.size * (0.55 + fade * 0.45);
      _scale.set(r, r * Math.min(5.2, 1.2 + speed * 0.45 * p.stretch * 0.35), r);
      _m4.compose(p.pos, _quat, _scale);
      this.waterMesh.setMatrixAt(i, _m4);
      if (p.muddy > 0.05) {
        _col.setRGB(0.65, 0.54, 0.42);
      } else {
        _col.setRGB(0.96, 0.99, 1.0);
      }
      this.waterMesh.setColorAt(i, _col);
      waterDirty = true;
    }
    if (waterDirty) {
      this.waterMesh.instanceMatrix.needsUpdate = true;
      if (this.waterMesh.instanceColor) this.waterMesh.instanceColor.needsUpdate = true;
    }

    // 2. Update 3D foam clusters
    let foamDirty = false;
    for (let i = 0; i < this.maxFoam; i++) {
      const f = this.foamPool[i];
      if (!f.alive) {
        _m4.makeScale(0, 0, 0);
        this.foamMesh.setMatrixAt(i, _m4);
        continue;
      }
      foamDirty = true;
      if (f.washingOff) {
        f.vel.y -= 6.5 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.size -= dt * 2.2;
        if (f.size <= 0.02 || f.pos.y < 0.01) {
          f.alive = false;
          _m4.makeScale(0, 0, 0);
          this.foamMesh.setMatrixAt(i, _m4);
          continue;
        }
      } else {
        f.size += (f.targetSize - f.size) * Math.min(1, dt * 8);
        f.pos.y = Math.max(0.24, f.pos.y - f.slideVel * dt);
      }
      _quat.setFromUnitVectors(_up, f.normal);
      _scale.set(f.size * 1.18, f.size * 0.48, f.size * 1.18);
      _m4.compose(f.pos, _quat, _scale);
      this.foamMesh.setMatrixAt(i, _m4);
    }
    if (foamDirty) {
      this.foamMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Update iridescent floating bubbles
    let bubbleDirty = false;
    for (let i = 0; i < this.maxBubbles; i++) {
      const b = this.bubblePool[i];
      if (!b.alive) continue;
      bubbleDirty = true;
      b.life += dt;
      if (b.life >= b.maxLife) {
        b.alive = false;
        _m4.makeScale(0, 0, 0);
        this.bubbleMesh.setMatrixAt(i, _m4);
        continue;
      }
      b.pos.x += (b.vel.x + Math.sin(elapsed * 2.4 + b.wobblePhase) * 0.14) * dt;
      b.pos.y += b.vel.y * dt;
      b.pos.z += (b.vel.z + Math.cos(elapsed * 2.0 + b.wobblePhase) * 0.10) * dt;
      const grow = Math.min(1, b.life * 4.5);
      const wobble = 1.0 + Math.sin(elapsed * 6.0 + b.wobblePhase) * 0.05;
      const sc = b.size * grow;
      _quat.identity();
      _scale.set(sc * wobble, sc / wobble, sc);
      _m4.compose(b.pos, _quat, _scale);
      this.bubbleMesh.setMatrixAt(i, _m4);
    }
    if (bubbleDirty) {
      this.bubbleMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
