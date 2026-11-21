import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Generates a soft realistic chassis + 4-tire contact AO texture so the SUV sits
 * heavily grounded on the interlocking driveway pavers (zero floating).
 */
function createCarContactShadowTexture() {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const bodyGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, w * 0.46);
  bodyGrad.addColorStop(0.0, 'rgba(6, 10, 14, 0.80)');
  bodyGrad.addColorStop(0.56, 'rgba(6, 10, 14, 0.54)');
  bodyGrad.addColorStop(0.84, 'rgba(6, 10, 14, 0.16)');
  bodyGrad.addColorStop(1.0, 'rgba(6, 10, 14, 0.0)');
  ctx.save();
  ctx.scale(1, 0.54);
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, h * 0.42, w, h * 1.1);
  ctx.restore();

  const tires = [
    [w * 0.255, h * 0.20],
    [w * 0.255, h * 0.80],
    [w * 0.768, h * 0.20],
    [w * 0.768, h * 0.80],
  ];
  for (const [tx, ty] of tires) {
    const g = ctx.createRadialGradient(tx, ty, 2, tx, ty, 28);
    g.addColorStop(0.0, 'rgba(3, 5, 8, 0.96)');
    g.addColorStop(0.45, 'rgba(5, 8, 12, 0.68)');
    g.addColorStop(1.0, 'rgba(5, 8, 12, 0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(tx, ty, 30, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates realistic weathered cedar wood plank texture (diffuse + roughness feel)
 * so fence slats and the grounded driveway bench have genuine wood grain, never flat beige.
 */
function createWoodGrainTexture() {
  const w = 256;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8b6d50';
  ctx.fillRect(0, 0, w, h);

  // Organic wood fibers & slight weathering streaks
  for (let y = 0; y < h; y++) {
    const streak = Math.sin(y * 0.14) * 10 + Math.sin(y * 0.57) * 6;
    const baseR = Math.round(134 + streak);
    const baseG = Math.round(104 + streak * 0.78);
    const baseB = Math.round(76 + streak * 0.58);
    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 18 + Math.random() * 65;
    const dark = Math.random() > 0.45;
    ctx.fillStyle = dark ? 'rgba(58, 40, 26, 0.14)' : 'rgba(186, 158, 126, 0.11)';
    ctx.fillRect(x, y, len, 1.3);
  }
  // Subtle plank join lines
  ctx.fillStyle = 'rgba(38, 25, 16, 0.32)';
  ctx.fillRect(0, 84, w, 2);
  ctx.fillRect(0, 170, w, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export async function buildDrivewayEnvironment(scene, textures) {
  const envGroup = new THREE.Group();
  envGroup.name = 'DrivewayEnvironment';
  scene.add(envGroup);

  const puddleUniforms = {
    uPuddleWetness: { value: 0.25 },
    uTime: { value: 0 },
  };

  // 1. Interlocking concrete pavers driveway with dynamic wet puddle shader
  const drivewayGeom = new THREE.PlaneGeometry(22, 18, 1, 1);
  drivewayGeom.setAttribute('uv2', drivewayGeom.attributes.uv);

  const drivewayMat = new THREE.MeshPhysicalMaterial({
    map: textures.pavers.map,
    normalMap: textures.pavers.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    aoMap: textures.pavers.armMap,
    aoMapIntensity: 0.9,
    roughnessMap: textures.pavers.armMap,
    roughness: 0.96,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.05,
  });

  drivewayMat.onBeforeCompile = (shader) => {
    shader.uniforms.uPuddleWetness = puddleUniforms.uPuddleWetness;
    shader.uniforms.uTime = puddleUniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uPuddleWetness;
        uniform float uTime;
        varying vec3 vWorldPos;

        float envHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float envNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x),
            mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float nBig = envNoise(vWorldPos.xz * 0.42);
        float nMed = envNoise(vWorldPos.xz * 1.45 + 3.7);
        diffuseColor.rgb *= (0.91 + nBig * 0.15);

        vec2 carRel = vec2((vWorldPos.x + 0.1) / 3.2, (vWorldPos.z - 0.55) / 2.35);
        float distCar = length(carRel) + (nMed - 0.5) * 0.34 + (nBig - 0.5) * 0.22;
        float wetRadius = mix(0.25, 1.32, uPuddleWetness);
        float wetMask = smoothstep(wetRadius, wetRadius - 0.45, distCar) * smoothstep(0.02, 0.18, uPuddleWetness);
        float puddleMask = smoothstep(wetRadius * 0.76, wetRadius * 0.36, distCar) * smoothstep(0.20, 0.85, uPuddleWetness);

        diffuseColor.rgb *= mix(1.0, 0.50, wetMask);
        float soapStreak = smoothstep(0.56, 0.86, envNoise(vWorldPos.xz * 3.6 + vec2(0.0, -uTime * 0.05))) * puddleMask * 0.22;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.95), soapStreak);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.22, wetMask);
        roughnessFactor = mix(roughnessFactor, 0.04, puddleMask);`
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = max(material.clearcoat, wetMask * 0.45 + puddleMask * 0.65);
          material.clearcoatRoughness = mix(0.24, 0.025, puddleMask);
        #endif`
      );
  };

  const driveway = new THREE.Mesh(drivewayGeom, drivewayMat);
  driveway.rotation.x = -Math.PI / 2;
  driveway.position.set(0, 0, 1.0);
  driveway.receiveShadow = true;
  envGroup.add(driveway);

  // 2. Baked SUV contact shadow (AO grounding)
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: createCarContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.94,
  });
  const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.7), contactShadowMat);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0.02, 0.005, 0.0);
  envGroup.add(contactShadow);

  // 3. Concrete driveway curbs & apron border (ambientCG Concrete034)
  const concreteMat = new THREE.MeshStandardMaterial({
    map: textures.concrete.map,
    normalMap: textures.concrete.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: textures.concrete.roughnessMap,
    roughness: 0.92,
    metalness: 0.0,
  });

  const backCurb = new THREE.Mesh(new THREE.BoxGeometry(15, 0.14, 0.18), concreteMat);
  backCurb.position.set(0.2, 0.07, -2.55);
  backCurb.castShadow = true;
  backCurb.receiveShadow = true;
  envGroup.add(backCurb);

  const garageApron = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.04, 0.65), concreteMat);
  garageApron.position.set(1.35, 0.02, -2.92);
  garageApron.receiveShadow = true;
  envGroup.add(garageApron);

  // 4. Brick residential garage & house wall (z = -3.35) — NO coplanar Z-fighting!
  // Wall is constructed around the real garage opening so the garage door sits cleanly recessed!
  const brickMat = new THREE.MeshStandardMaterial({
    map: textures.brick.map,
    normalMap: textures.brick.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    aoMap: textures.brick.armMap,
    roughnessMap: textures.brick.armMap,
    roughness: 0.94,
    metalness: 0.0,
  });

  const houseGroup = new THREE.Group();
  houseGroup.position.set(0.0, 0, -3.35);
  envGroup.add(houseGroup);

  const addBrickBlock = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    // World-proportioned UVs so brick course size stays uniform across wall sections
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const u = (nx > 0.5 ? pos.getZ(i) : pos.getX(i) + x) * 0.34;
      const v = (pos.getY(i) + y) * 0.34;
      uv.setXY(i, u, v);
    }
    g.setAttribute('uv2', uv.clone());
    const m = new THREE.Mesh(g, brickMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    houseGroup.add(m);
  };

  // Garage opening spans x in [-0.45, +3.15], y in [0, 2.35]. Roof eaves at y = 2.95 so sunlit sky & trees show above!
  addBrickBlock(4.8, 2.95, 0.38, -2.85, 1.475, 0); // Left brick wall (with hose & window)
  addBrickBlock(2.4, 2.95, 0.38, 4.35, 1.475, 0);  // Right brick pier
  addBrickBlock(3.6, 0.60, 0.38, 1.35, 2.65, 0);   // Brick header above garage opening

  // Concrete foundation plinths left & right of garage opening
  const plinthL = new THREE.Mesh(new THREE.BoxGeometry(4.85, 0.30, 0.43), concreteMat);
  plinthL.position.set(-2.85, 0.15, 0.02);
  plinthL.receiveShadow = true;
  houseGroup.add(plinthL);

  // Recessed residential garage door with real painted-steel grain, weatherstrip & handle
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cfc9be'),
    normalMap: textures.concrete.normalMap,
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughnessMap: textures.concrete.roughnessMap,
    roughness: 0.72,
    metalness: 0.04,
  });
  const garageDoorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b8b3aa'),
    normalMap: textures.concrete.normalMap,
    normalScale: new THREE.Vector2(0.14, 0.10),
    roughnessMap: textures.concrete.roughnessMap,
    roughness: 0.56,
    metalness: 0.18,
  });
  const darkSeamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#282b2e'),
    roughness: 0.88,
  });

  const garageX = 1.35;
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(3.84, 0.14, 0.10), trimMat);
  frameTop.position.set(garageX, 2.36, 0.21);
  houseGroup.add(frameTop);

  for (const sx of [-1.84, 1.84]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.38, 0.10), trimMat);
    post.position.set(garageX + sx, 1.19, 0.21);
    houseGroup.add(post);
  }

  const doorBack = new THREE.Mesh(new THREE.BoxGeometry(3.64, 2.36, 0.04), darkSeamMat);
  doorBack.position.set(garageX, 1.18, -0.10);
  houseGroup.add(doorBack);

  for (let i = 0; i < 5; i++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.56, 0.44, 0.06), garageDoorMat);
    panel.position.set(garageX, 0.24 + i * 0.465, -0.03);
    panel.receiveShadow = true;
    houseGroup.add(panel);
  }
  // Black rubber bottom weatherstrip seal along garage floor
  const weatherStrip = new THREE.Mesh(new THREE.BoxGeometry(3.58, 0.045, 0.075), darkSeamMat);
  weatherStrip.position.set(garageX, 0.022, -0.02);
  houseGroup.add(weatherStrip);
  // Subtle garage handle
  const doorHandle = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.025, 0.035),
    new THREE.MeshStandardMaterial({ color: '#454a50', metalness: 0.82, roughness: 0.3 })
  );
  doorHandle.position.set(garageX, 0.72, 0.015);
  houseGroup.add(doorHandle);

  // Sloped dark architectural roof fascia & gutter at y = 2.98 so natural blue sky & trees frame the upper 25%
  const eavesMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3c4147'),
    roughness: 0.68,
    metalness: 0.22,
  });
  const eaves = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.16, 0.72), eavesMat);
  eaves.position.set(0.25, 2.98, 0.26);
  eaves.castShadow = true;
  houseGroup.add(eaves);

  const roofSlope = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.18, 2.6), eavesMat);
  roofSlope.position.set(0.25, 3.38, -0.82);
  roofSlope.rotation.x = 0.26;
  houseGroup.add(roofSlope);

  // Residential window on left brick wall (cleanly proud at z = 0.22, zero Z-fighting)
  const winX = -3.45;
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.38, 1.18, 0.09), trimMat);
  winFrame.position.set(winX, 1.85, 0.22);
  houseGroup.add(winFrame);

  const winSill = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 0.18), concreteMat);
  winSill.position.set(winX, 1.24, 0.25);
  houseGroup.add(winSill);

  const winGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.20, 1.02),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#18232c'),
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1.0,
      envMapIntensity: 1.45,
    })
  );
  winGlass.position.set(winX, 1.85, 0.27);
  houseGroup.add(winGlass);

  const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.06, 0.03), trimMat);
  mullion.position.set(winX, 1.85, 0.278);
  houseGroup.add(mullion);

  // Brass outdoor spigot beside the wall-mounted hose
  const brassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b89652'),
    metalness: 0.86,
    roughness: 0.26,
  });
  const spigotPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10), brassMat);
  spigotPipe.rotation.x = Math.PI / 2;
  spigotPipe.position.set(-1.32, 0.72, 0.24);
  houseGroup.add(spigotPipe);

  const spigotValve = new THREE.Mesh(
    new THREE.TorusGeometry(0.034, 0.007, 8, 14),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#8e2c24'), roughness: 0.44, metalness: 0.2 })
  );
  spigotValve.rotation.x = Math.PI / 2;
  spigotValve.position.set(-1.32, 0.77, 0.28);
  houseGroup.add(spigotValve);

  // 5. Dark garden soil bed between curb and house wall
  const soilMat = new THREE.MeshStandardMaterial({
    map: textures.mud.map,
    normalMap: textures.mud.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: textures.mud.armMap,
    color: new THREE.Color('#5a4838'),
    roughness: 0.96,
  });
  const gardenBed = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.12, 0.72), soilMat);
  gardenBed.position.set(-3.1, 0.06, -2.92);
  gardenBed.receiveShadow = true;
  envGroup.add(gardenBed);

  // 6. Merged cedar privacy fence along right driveway edge (1 single draw call!)
  const woodTex = createWoodGrainTexture();
  woodTex.repeat.set(1, 2);
  const fenceWoodMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    normalMap: textures.concrete.normalMap,
    normalScale: new THREE.Vector2(0.22, 0.15),
    roughness: 0.86,
    metalness: 0.0,
  });

  const fenceGeoms = [];
  for (let i = 0; i < 24; i++) {
    const g = new THREE.BoxGeometry(0.032, 1.78, 0.25);
    g.translate(4.35, 0.89, -3.2 + i * 0.275);
    fenceGeoms.push(g);
  }
  for (let p = 0; p < 4; p++) {
    const g = new THREE.BoxGeometry(0.11, 1.86, 0.11);
    g.translate(4.31, 0.93, -3.0 + p * 2.1);
    fenceGeoms.push(g);
  }
  const mergedFence = mergeGeometries(fenceGeoms, false);
  fenceGeoms.forEach((g) => g.dispose());
  const fenceMesh = new THREE.Mesh(mergedFence, fenceWoodMat);
  fenceMesh.castShadow = true;
  fenceMesh.receiveShadow = true;
  envGroup.add(fenceMesh);

  // 7. Load genuine Poly Haven CC0 glTF props: Wall-mounted garden hose & residential shrubs
  const gltfLoader = new GLTFLoader();
  const [hoseGltf, shrubGltf] = await Promise.all([
    gltfLoader.loadAsync('./assets/models/hose/garden_hose_wall_mounted_01_1k.gltf'),
    gltfLoader.loadAsync('./assets/models/shrub/shrub_03_1k.gltf'),
  ]);

  const wallHose = hoseGltf.scene;
  wallHose.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  wallHose.scale.setScalar(1.22);
  wallHose.position.set(-1.95, 1.15, -3.14);
  envGroup.add(wallHose);

  // Place 2 natural residential shrubs in the garden bed (keeps total tris lean!)
  const shrubPlacements = [
    { pos: [-2.85, 0.08, -2.85], rotY: 0.45, scale: 1.24 },
    { pos: [-4.25, 0.08, -2.82], rotY: 2.15, scale: 1.38 },
  ];
  for (const sp of shrubPlacements) {
    const s = shrubGltf.scene.clone(true);
    s.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false; // avoids 16k extra shadow tris while staying naturally grounded in soil bed
        c.receiveShadow = true;
      }
    });
    s.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    s.rotation.y = sp.rotY;
    s.scale.setScalar(sp.scale);
    envGroup.add(s);
  }

  return {
    group: envGroup,
    puddleUniforms,
    woodTex,
    spigotWorldPos: new THREE.Vector3(-1.32, 0.72, -3.10),
  };
}
