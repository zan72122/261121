import * as THREE from 'three';

/**
 * Photorealistic deformable Japanese Gyoza wrapper + filling assembly (Iteration 2 refined anatomy!).
 * - Smooth, plump lower belly taut around the minced filling (no accordion ribs down the sides!)
 * - Delicate overlapping pinched thumb-pleats (ひだ) focused authentically along the upper crest rim
 * - Correct UV orientation (flipY=false maps uv.y=0..0.37 golden Maillard sear strictly to FLAT BOTTOM!)
 */
export class GyozaUnit {
  constructor(sharedAssets, seed = 1) {
    this.shared = sharedAssets;
    this.seed = seed;
    this.group = new THREE.Group();

    const s1 = Math.sin(seed * 12.9898) * 43758.5453;
    const r1 = s1 - Math.floor(s1);
    const s2 = Math.sin(seed * 78.233) * 43758.5453;
    const r2 = s2 - Math.floor(s2);
    this.plumpScale = 0.94 + r1 * 0.13;
    this.curveBias = (r2 - 0.5) * 0.0028;
    this.pleatCount = 5 + (seed % 2); // 5 or 6 realistic handmade pleats

    this.fold = 0;
    this.pleat = 0;
    this.fillScale = 0;
    this.cook = 0;
    this.moistRim = 0;

    this.segU = 34;
    this.segV = 22;
    this.wrapperGeo = this._buildBaseGeometry();

    this.rawMat = new THREE.MeshPhysicalMaterial({
      map: sharedAssets.rawSkin.map,
      normalMap: sharedAssets.rawSkin.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: sharedAssets.rawSkin.roughnessMap,
      roughness: 0.92,
      metalness: 0.0,
      sheen: 0.35,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color('#fff2dd'),
      side: THREE.DoubleSide,
    });

    this.cookedMat = new THREE.MeshPhysicalMaterial({
      map: sharedAssets.cookedSkin.map,
      normalMap: sharedAssets.cookedSkin.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: sharedAssets.cookedSkin.roughnessMap,
      roughness: 0.88,
      metalness: 0.0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.38,
      sheen: 0.18,
      sheenRoughness: 0.68,
      sheenColor: new THREE.Color('#ffe8c4'),
      side: THREE.DoubleSide,
    });

    this.wrapperMesh = new THREE.Mesh(this.wrapperGeo, this.rawMat);
    this.wrapperMesh.castShadow = true;
    this.wrapperMesh.receiveShadow = true;
    this.group.add(this.wrapperMesh);

    this.cookedOverlay = new THREE.Mesh(this.wrapperGeo, this.cookedMat.clone());
    this.cookedOverlay.material.transparent = true;
    this.cookedOverlay.material.opacity = 0;
    this.cookedOverlay.material.depthWrite = false;
    this.cookedOverlay.material.polygonOffset = true;
    this.cookedOverlay.material.polygonOffsetFactor = -1;
    this.cookedOverlay.visible = false;
    this.group.add(this.cookedOverlay);

    this.fillingMesh = new THREE.Mesh(
      this._buildFillingGeometry(),
      sharedAssets.fillingMaterial
    );
    this.fillingMesh.castShadow = true;
    this.fillingMesh.receiveShadow = true;
    this.fillingMesh.position.set(0, 0.002, 0);
    this.fillingMesh.scale.setScalar(0.001);
    this.fillingMesh.visible = false;
    this.group.add(this.fillingMesh);

    const csGeo = new THREE.PlaneGeometry(0.092, 0.052);
    csGeo.rotateX(-Math.PI / 2);
    this.contactShadow = new THREE.Mesh(
      csGeo,
      new THREE.MeshBasicMaterial({
        map: sharedAssets.contactShadowTex,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      })
    );
    this.contactShadow.position.y = 0.0004;
    this.group.add(this.contactShadow);

    this.updateGeometry();
  }

  _buildBaseGeometry() {
    const segU = this.segU;
    const segV = this.segV;
    const count = (segU + 1) * (segV + 1);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const stData = new Float32Array(count * 2);
    const indices = [];

    let ptr = 0;
    let uvPtr = 0;
    let stPtr = 0;
    for (let iv = 0; iv <= segV; iv++) {
      const b = (iv / segV) * 2 - 1; // -1 (back rim) .. 0 (flat bottom) .. +1 (front rim)
      for (let iu = 0; iu <= segU; iu++) {
        const a = (iu / segU) * 2 - 1;
        const s = a * Math.sqrt(Math.max(0, 1 - 0.5 * b * b));
        const t = b * Math.sqrt(Math.max(0, 1 - 0.5 * a * a));
        stData[stPtr++] = s;
        stData[stPtr++] = t;

        positions[ptr++] = 0;
        positions[ptr++] = 0;
        positions[ptr++] = 0;

        // With flipY = false on our skin CanvasTextures:
        // uv.y = 0 -> flat seared bottom, uv.y = 1 -> top pleated crest!
        uvs[uvPtr++] = a * 0.5 + 0.5;
        uvs[uvPtr++] = Math.abs(b);
      }
    }

    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const i0 = iv * (segU + 1) + iu;
        const i1 = i0 + 1;
        const i2 = i0 + (segU + 1);
        const i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.userData.stData = stData;
    return geo;
  }

  _buildFillingGeometry() {
    const geo = new THREE.IcosahedronGeometry(0.0175, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      x *= 1.32;
      z *= 0.88;
      y *= 0.74;
      if (y < -0.002) y = -0.002 + (y + 0.002) * 0.22;
      const n =
        Math.sin(x * 185 + this.seed * 3.1) * Math.cos(z * 195 + y * 145) * 0.0021 +
        Math.sin(x * 340 - z * 280 + this.seed) * 0.0011;
      const len = Math.hypot(x, y, z) || 1;
      pos.setXYZ(i, x + (x / len) * n, y + 0.0085 + (y / len) * n * 0.8, z + (z / len) * n);
    }
    geo.computeVertexNormals();
    return geo;
  }

  setState({ fold, pleat, fillScale, cook, moistRim } = {}) {
    let geoDirty = false;
    if (fold !== undefined && Math.abs(fold - this.fold) > 1e-4) {
      this.fold = THREE.MathUtils.clamp(fold, 0, 1);
      geoDirty = true;
    }
    if (pleat !== undefined && Math.abs(pleat - this.pleat) > 1e-4) {
      this.pleat = THREE.MathUtils.clamp(pleat, 0, 1);
      geoDirty = true;
    }
    if (fillScale !== undefined) {
      this.fillScale = THREE.MathUtils.clamp(fillScale, 0, 1.15);
    }
    // Always sync filling visibility with current fold state so filling NEVER clips through closed dough!
    const vis = this.fillScale > 0.01 && this.fold < 0.80;
    this.fillingMesh.visible = vis;
    if (vis) {
      const s = this.fillScale * (1 - Math.max(0, this.fold - 0.45) * 0.65);
      this.fillingMesh.scale.set(s, s * (1 - this.fold * 0.20), s * (1 - this.fold * 0.28));
    }
    if (cook !== undefined) {
      this.cook = THREE.MathUtils.clamp(cook, 0, 1);
      if (this.cook <= 0.01) {
        this.wrapperMesh.material = this.rawMat;
        this.cookedOverlay.visible = false;
      } else if (this.cook >= 0.99) {
        this.wrapperMesh.material = this.cookedMat;
        this.cookedOverlay.visible = false;
      } else {
        this.wrapperMesh.material = this.rawMat;
        this.cookedOverlay.visible = true;
        this.cookedOverlay.material.opacity = this.cook;
      }
    }
    if (moistRim !== undefined) {
      this.moistRim = THREE.MathUtils.clamp(moistRim, 0, 1);
      this.rawMat.roughness = 0.92 - this.moistRim * 0.22;
    }
    if (geoDirty) {
      this.updateGeometry();
    }
  }

  updateGeometry() {
    const R = 0.043; // ~8.6 cm real Japanese gyoza wrapper diameter
    const f = this.fold;
    const p = this.pleat;
    const pos = this.wrapperGeo.attributes.position;
    const stData = this.wrapperGeo.userData.stData;
    const segU = this.segU;
    const segV = this.segV;

    const fe = f * f * (3 - 2 * f);

    for (let iv = 0; iv <= segV; iv++) {
      const b = (iv / segV) * 2 - 1;
      const absB = Math.abs(b);
      const isFront = b > 0;
      for (let iu = 0; iu <= segU; iu++) {
        const a = (iu / segU) * 2 - 1;
        const idx = iv * (segU + 1) + iu;
        const s = stData[idx * 2];
        const t = stData[idx * 2 + 1];

        // --- STATE 0: Flat soft wheat wrapper on cutting board ---
        const flatX = s * R;
        const flatZ = t * R;
        const rad = Math.hypot(s, t);
        const rimWave = Math.pow(rad, 2.2) * 0.0018 *
          (Math.sin(Math.atan2(t, s) * 3 + this.seed * 2.1) + 0.5 * Math.cos(Math.atan2(t, s) * 5 - this.seed));
        const flatY = 0.0026 + rimWave + (1 - Math.min(1, rad * rad)) * 0.0005;

        // --- STATE 1: Realistic Hand-Pinched Japanese Crescent Gyoza ---
        const env = Math.sqrt(Math.max(0.0001, 1 - a * a * 0.95));
        const halfLen = 0.0385; // ~7.7 cm finished gyoza length

        let crossZ;
        let crossY;

        const bellyW = 0.0155 * env * this.plumpScale;
        const bellyH = 0.0235 * Math.pow(env, 0.68) * this.plumpScale;

        if (absB < 0.35) {
          // Flat seared pan-contact underside
          const uBase = absB / 0.35;
          crossZ = uBase * bellyW * 0.90;
          crossY = 0.0006 + Math.pow(uBase, 3.2) * 0.0016;
        } else if (absB < 0.85) {
          // Smooth, plump, taut lower belly cradling the juicy filling!
          const uWall = (absB - 0.35) / 0.50;
          crossZ = bellyW * (0.90 * (1 - uWall) + 0.11 * uWall + 0.26 * Math.sin(uWall * Math.PI));
          crossY = 0.0022 + bellyH * Math.pow(Math.sin(uWall * Math.PI * 0.5), 1.12);
          if (isFront) crossZ *= 1.05;
        } else {
          // Delicate pinched upper fin crest (~3.2mm tall thin crimped dough lip)
          const uFin = (absB - 0.85) / 0.15;
          crossZ = bellyW * 0.10 * (1 - uFin * 0.78) + 0.00035;
          crossY = 0.0022 + bellyH + uFin * 0.0036 * (0.4 + 0.6 * env);
        }

        const signZ = b >= 0 ? 1 : -1;
        let gx = a * halfLen;
        let gz = signZ * crossZ;
        let gy = crossY;

        // Progressive pleating (ひだ) — AUTHENTIC JAPANESE PLEATS!
        // Confined strictly to the upper crest & top 35% of the front rim (b > 0.56),
        // leaving the plump lower belly smooth and natural (no caterpillar/accordion grooves)!
        const normPos = (a + 0.92) / 1.84;
        const localPleat = THREE.MathUtils.clamp((p * 1.18 - normPos * 0.95) * 4.5, 0, 1);
        const lpSmooth = localPleat * localPleat * (3 - 2 * localPleat);

        // Authentic crescent curve (gentler & natural)
        const crescentAmt = (0.35 + 0.65 * p) * fe;
        gz -= (0.0092 + this.curveBias) * (1 - a * a) * crescentAmt;
        gx *= 1 - 0.05 * p;

        if (lpSmooth > 0.001 && Math.abs(a) < 0.90) {
          const pleatZoneX = Math.sin(Math.min(1, Math.max(0, (a + 0.88) / 1.76)) * Math.PI);
          // Slight natural spacing jitter so pleats feel handmade by fingers, never machine-stamped!
          const handJitter = Math.sin(a * 5.2 + this.seed) * 0.045;
          const phase = ((a + handJitter + 0.86) / 1.72) * this.pleatCount * Math.PI * 2;
          // Crisp overlapping thumb-fold sawtooth/S-wave
          const wave = Math.sin(phase) + 0.45 * Math.sin(2 * phase - 0.85) + 0.15 * Math.sin(3 * phase - 1.4);

          if (b > 0.54) {
            // Smooth ramp starting at upper shoulder (b=0.54) peaking at pinched rim (b=0.92)!
            const hMask = Math.pow(THREE.MathUtils.clamp((b - 0.54) / 0.46, 0, 1), 1.65);
            const crestPinch = Math.exp(-Math.pow((b - 0.90) / 0.14, 2));
            const amp = 0.0024 * pleatZoneX * lpSmooth;
            gz += wave * amp * (0.25 + 0.95 * hMask);
            gx += Math.cos(phase) * amp * 0.62 * hMask;
            gy += Math.sin(phase - 0.45) * 0.0011 * pleatZoneX * lpSmooth * (0.2 + crestPinch);
          } else if (b < -0.82) {
            // Back rim follows crimped crest neatly so seam stays tightly sealed
            const rimMask = Math.pow(THREE.MathUtils.clamp((-b - 0.82) / 0.18, 0, 1), 1.4);
            const amp = 0.0015 * pleatZoneX * lpSmooth * rimMask;
            gz += wave * amp;
            gy += Math.sin(phase - 0.45) * 0.0008 * pleatZoneX * lpSmooth * rimMask;
          }
        }

        // Subtle handmade organic dough variation across belly
        const micro =
          Math.sin(a * 9.5 + this.seed * 2.1) * Math.cos(b * 8.2 - this.seed) * 0.00065 +
          Math.sin(a * 19 - b * 14 + this.seed) * 0.00025;
        gy += micro * fe;
        gz += micro * 0.6 * fe;

        const arcLift = Math.sin(fe * Math.PI) * absB * 0.011;
        const fx = THREE.MathUtils.lerp(flatX, gx, fe);
        const fy = THREE.MathUtils.lerp(flatY, gy, fe) + arcLift;
        const fz = THREE.MathUtils.lerp(flatZ, gz, fe);

        pos.setXYZ(idx, fx, fy, fz);
      }
    }

    pos.needsUpdate = true;
    this.wrapperGeo.computeVertexNormals();

    this.contactShadow.scale.set(
      THREE.MathUtils.lerp(1.04, 0.92, fe),
      1,
      THREE.MathUtils.lerp(1.62, 0.68, fe)
    );
  }
}
