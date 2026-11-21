import * as THREE from 'three';

function createShowerRoseTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c4ccd2';
  ctx.fillRect(0, 0, s, s);
  const cx = s / 2;
  ctx.fillStyle = '#20252a';
  for (let ring = 0; ring <= 4; ring++) {
    const r = ring * 11;
    const count = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates natural subtle human skin color with realistic knuckle warmth & soft crease shading.
 */
function createNaturalSkinTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0.0, '#c89275');
  g.addColorStop(0.45, '#d8a284');
  g.addColorStop(0.8, '#d09679');
  g.addColorStop(1.0, '#bd8367');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  // Subtle organic tonal variation & fine skin micro-grain
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 0.7 + Math.random() * 2.4;
    ctx.fillStyle = Math.random() > 0.5
      ? 'rgba(145, 84, 60, 0.065)'
      : 'rgba(242, 210, 188, 0.055)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStationContactShadow() {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Broad soft bench shadow
  const g1 = ctx.createRadialGradient(w * 0.58, h * 0.52, 8, w * 0.58, h * 0.52, w * 0.36);
  g1.addColorStop(0, 'rgba(6, 10, 14, 0.76)');
  g1.addColorStop(0.65, 'rgba(6, 10, 14, 0.40)');
  g1.addColorStop(1, 'rgba(6, 10, 14, 0)');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.ellipse(w * 0.58, h * 0.52, w * 0.36, h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tight dark contact shadow under the bucket base
  const g2 = ctx.createRadialGradient(w * 0.35, h * 0.54, 4, w * 0.35, h * 0.54, 34);
  g2.addColorStop(0, 'rgba(3, 6, 9, 0.92)');
  g2.addColorStop(0.6, 'rgba(3, 6, 9, 0.48)');
  g2.addColorStop(1, 'rgba(3, 6, 9, 0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(w * 0.35, h * 0.54, 34, 0, Math.PI * 2);
  ctx.fill();

  // Contact shadow under coiled hose on far left
  const g3 = ctx.createRadialGradient(w * 0.14, h * 0.54, 3, w * 0.14, h * 0.54, 24);
  g3.addColorStop(0, 'rgba(4, 7, 10, 0.72)');
  g3.addColorStop(1, 'rgba(4, 7, 10, 0)');
  ctx.fillStyle = g3;
  ctx.beginPath();
  ctx.arc(w * 0.14, h * 0.54, 24, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createErgonomicSpongeGeometry() {
  const shape = new THREE.Shape();
  const w = 0.088;
  const h = 0.056;
  const waist = 0.044;
  shape.moveTo(-w, -h * 0.55);
  shape.bezierCurveTo(-w, -h, -w * 0.35, -h, 0, -waist);
  shape.bezierCurveTo(w * 0.35, -h, w, -h, w, -h * 0.55);
  shape.bezierCurveTo(w * 1.05, 0, w * 1.05, 0, w, h * 0.55);
  shape.bezierCurveTo(w, h, w * 0.35, h, 0, waist);
  shape.bezierCurveTo(-w * 0.35, h, -w, h, -w, h * 0.55);
  shape.bezierCurveTo(-w * 1.05, 0, -w * 1.05, 0, -w, -h * 0.55);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: 0.044,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geom.center();
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + 0.1) * 4.5, (pos.getY(i) + pos.getZ(i) * 0.6 + 0.1) * 4.5);
  }
  geom.setAttribute('uv2', uv.clone());
  return geom;
}

/**
 * Realistic double-folded plush microfiber towel stack with soft billowing cloth corners.
 */
function createFoldedTowelLayer(w, h, d, seed = 0) {
  const geom = new THREE.BoxGeometry(w, h, d, 14, 3, 12);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const nx = x / (w * 0.5);
    const nz = z / (d * 0.5);
    const edge = Math.min(1, Math.hypot(nx * 0.86, nz * 0.86));
    const puff = Math.cos(edge * Math.PI * 0.44);
    y *= 0.55 + 0.55 * puff;
    // Soft cloth drape ripples
    y += Math.sin(x * 24 + z * 15 + seed) * 0.0032 + Math.cos(z * 21 - seed) * 0.0024;
    // Gentle organic droop at outer corners
    const corner = Math.max(0, Math.abs(nx) * Math.abs(nz) - 0.45);
    y -= corner * 0.009;
    pos.setXYZ(i, x, y, z);
  }
  geom.computeVertexNormals();
  geom.setAttribute('uv2', geom.attributes.uv.clone());
  return geom;
}

/**
 * Creates a smooth continuous anatomical TubeGeometry digit with natural taper & rounded fingertip.
 */
function buildSmoothTubeMesh(points, baseRad, tipFactor, mat, tubularSegs = 14, radialSegs = 10, creaseAO = 0.0) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geom = new THREE.TubeGeometry(curve, tubularSegs, baseRad, radialSegs, false);
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = geom.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getX(i);
    const cPt = curve.getPoint(t);
    const taper = 1.0 - t * (1.0 - tipFactor);
    pos.setXYZ(
      i,
      cPt.x + (pos.getX(i) - cPt.x) * taper,
      cPt.y + (pos.getY(i) - cPt.y) * taper,
      cPt.z + (pos.getZ(i) - cPt.z) * taper
    );
    // Subtle baked ambient occlusion in underside & inner finger creases so hand has real photographic depth!
    const ny = nor.getY(i);
    const ao = 1.0 - creaseAO * (Math.max(0, -ny) * 0.55 + (1.0 - Math.abs(t - 0.5) * 2.0) * 0.18);
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao * 0.96;
    colors[i * 3 + 2] = ao * 0.94;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geom, mat));

  const tip = curve.getPoint(1.0);
  const capGeom = new THREE.SphereGeometry(baseRad * tipFactor, 10, 8);
  const capCount = capGeom.attributes.position.count;
  const capCols = new Float32Array(capCount * 3);
  for (let i = 0; i < capCount; i++) {
    capCols[i * 3] = 0.94;
    capCols[i * 3 + 1] = 0.90;
    capCols[i * 3 + 2] = 0.88;
  }
  capGeom.setAttribute('color', new THREE.BufferAttribute(capCols, 3));
  const cap = new THREE.Mesh(capGeom, mat);
  cap.position.copy(tip);
  group.add(cap);
  return group;
}

function createFirstPersonHands(textures) {
  const skinTex = createNaturalSkinTexture();
  const skinMat = new THREE.MeshPhysicalMaterial({
    map: skinTex,
    normalMap: textures.rubber.normalMap,
    normalScale: new THREE.Vector2(0.06, 0.06),
    roughness: 0.62,
    metalness: 0.0,
    sheen: 0.38,
    sheenRoughness: 0.68,
    sheenColor: new THREE.Color('#e8bfa6'),
    clearcoat: 0.06,
    clearcoatRoughness: 0.48,
    envMapIntensity: 0.62,
  });

  const fingerSkinMat = skinMat.clone();
  fingerSkinMat.vertexColors = true;

  const cuffMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9eaec0'), // soft real chambray denim cotton sleeve
    map: textures.towel.map,
    normalMap: textures.towel.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: textures.towel.roughnessMap,
    roughness: 0.94,
    sheen: 0.42,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color('#dce6f0'),
  });

  // --- POSE 1: GRIP HAND (wraps around pistol grip centered at (0, -0.054, 0.015), radius ~0.020) ---
  const gripHand = new THREE.Group();
  gripHand.name = 'GripHand';

  // Forearm angling naturally from bottom-right corner into the wrist behind the grip
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.024, -0.056, 0.046),
    new THREE.Vector3(0.058, -0.088, 0.135),
    new THREE.Vector3(0.112, -0.145, 0.275),
    new THREE.Vector3(0.175, -0.215, 0.420),
  ]);
  const armGeom = new THREE.TubeGeometry(armCurve, 14, 0.029, 14, false);
  const ap = armGeom.attributes.position;
  const auv = armGeom.attributes.uv;
  for (let i = 0; i < ap.count; i++) {
    const t = auv.getX(i);
    const cPt = armCurve.getPoint(t);
    const sc = 0.82 + t * 0.42;
    ap.setXYZ(
      i,
      cPt.x + (ap.getX(i) - cPt.x) * sc * 0.92,
      cPt.y + (ap.getY(i) - cPt.y) * sc * 1.05,
      cPt.z + (ap.getZ(i) - cPt.z) * sc
    );
  }
  armGeom.computeVertexNormals();
  gripHand.add(new THREE.Mesh(armGeom, skinMat));

  // Rolled chambray sleeve cuff around lower forearm
  const cuffCurve = new THREE.CatmullRomCurve3([
    armCurve.getPoint(0.50),
    armCurve.getPoint(0.75),
    armCurve.getPoint(1.0),
  ]);
  const cuffMesh = new THREE.Mesh(new THREE.TubeGeometry(cuffCurve, 10, 0.044, 16, false), cuffMat);
  gripHand.add(cuffMesh);

  // Palm hugging right-rear contour of the pistol handle
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), skinMat);
  palm.scale.set(0.62, 1.15, 1.02);
  palm.position.set(0.020, -0.054, 0.026);
  gripHand.add(palm);

  // 4 smooth curled fingers wrapping around front of grip & chrome trigger with baked crease AO!
  const fingerYs = [-0.026, -0.044, -0.062, -0.079];
  const fingerRads = [0.0080, 0.0082, 0.0077, 0.0068];
  fingerYs.forEach((fy, idx) => {
    const zF = idx === 0 ? -0.024 : -0.011;
    const pts = [
      new THREE.Vector3(0.024, fy + 0.002, 0.022),
      new THREE.Vector3(0.025, fy, -0.002),
      new THREE.Vector3(0.004, fy - 0.002, zF),
      new THREE.Vector3(-0.020, fy - 0.002, zF + 0.012),
    ];
    gripHand.add(buildSmoothTubeMesh(pts, fingerRads[idx], 0.76, fingerSkinMat, 12, 10, 0.42));
  });

  // Opposing thumb resting naturally along the rear-left of the handle (snug, zero protrusion!)
  const thumbPts = [
    new THREE.Vector3(0.016, -0.038, 0.044),
    new THREE.Vector3(-0.006, -0.028, 0.036),
    new THREE.Vector3(-0.019, -0.022, 0.018),
    new THREE.Vector3(-0.018, -0.020, -0.002),
  ];
  gripHand.add(buildSmoothTubeMesh(thumbPts, 0.0094, 0.74, fingerSkinMat, 12, 10, 0.36));

  // --- POSE 2: FLAT SCRUBBING HAND (cups the back of the sponge & folded microfiber towel!) ---
  const flatHand = new THREE.Group();
  flatHand.name = 'FlatHand';

  const flatArmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.015, 0.012, 0.055),
    new THREE.Vector3(0.065, -0.020, 0.165),
    new THREE.Vector3(0.135, -0.072, 0.310),
  ]);
  const flatArm = new THREE.Mesh(new THREE.TubeGeometry(flatArmCurve, 12, 0.027, 14, false), skinMat);
  flatHand.add(flatArm);

  const flatCuffCurve = new THREE.CatmullRomCurve3([
    flatArmCurve.getPoint(0.45),
    flatArmCurve.getPoint(0.75),
    flatArmCurve.getPoint(1.0),
  ]);
  flatHand.add(new THREE.Mesh(new THREE.TubeGeometry(flatCuffCurve, 8, 0.040, 14, false), cuffMat));

  const flatPalm = new THREE.Mesh(new THREE.SphereGeometry(0.040, 16, 12), skinMat);
  flatPalm.scale.set(1.05, 0.42, 1.12);
  flatPalm.position.set(0.002, 0.008, 0.005);
  flatHand.add(flatPalm);

  [-0.025, -0.008, 0.009, 0.025].forEach((fx, idx) => {
    const len = [0.058, 0.064, 0.058, 0.046][idx];
    const pts = [
      new THREE.Vector3(fx, 0.010, -0.026),
      new THREE.Vector3(fx, 0.004, -0.026 - len * 0.55),
      new THREE.Vector3(fx, -0.012, -0.026 - len),
    ];
    flatHand.add(buildSmoothTubeMesh(pts, 0.0076, 0.76, skinMat, 10, 8));
  });
  const flatThumbPts = [
    new THREE.Vector3(-0.026, 0.004, 0.016),
    new THREE.Vector3(-0.044, -0.004, -0.004),
    new THREE.Vector3(-0.048, -0.016, -0.028),
  ];
  flatHand.add(buildSmoothTubeMesh(flatThumbPts, 0.0092, 0.76, skinMat, 10, 8));

  return { gripHand, flatHand };
}

/**
 * Realistic brushed cast-gunmetal, textured rubber & machined brass garden hose spray gun.
 */
function createHoseGun(textures, includeLongTail = true) {
  const g = new THREE.Group();
  g.name = 'ToolHoseGun';

  const metalBodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#3b454b'), // brushed cast pewter/zinc housing (authentic hardware, NOT green plastic!)
    normalMap: textures.concrete.normalMap,
    normalScale: new THREE.Vector2(0.10, 0.10),
    roughness: 0.34,
    metalness: 0.74,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#202427'),
    map: textures.rubber.map,
    normalMap: textures.rubber.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: textures.rubber.roughnessMap,
    roughness: 0.88,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8a454'),
    metalness: 0.92,
    roughness: 0.22,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d2d8de'),
    metalness: 0.94,
    roughness: 0.16,
  });
  const hosePipeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#275c3d'),
    normalMap: textures.rubber.normalMap,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 0.44,
    clearcoat: 0.24,
    clearcoatRoughness: 0.35,
  });

  // Ergonomic rubberized pistol grip
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.020, 0.125, 16), gripMat);
  handle.position.set(0, -0.054, 0.015);
  handle.rotation.x = 0.24;
  g.add(handle);

  // Cast metal barrel + green anodized accent ring + rubberized rear bumper
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0205, 0.122, 18), metalBodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.016, -0.022);
  g.add(barrel);

  const rearCap = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.018, 0.020, 16), gripMat);
  rearCap.rotation.x = Math.PI / 2;
  rearCap.position.set(0, 0.016, 0.046);
  g.add(rearCap);

  // Machined brass adjustable spray head + black rubber bumper collar
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.020, 0.026, 18), brassMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.016, -0.094);
  g.add(collar);

  const rubberGuard = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0042, 8, 18), gripMat);
  rubberGuard.position.set(0, 0.016, -0.088);
  g.add(rubberGuard);

  const nozzleTip = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0165, 0.036, 16), brassMat);
  nozzleTip.rotation.x = Math.PI / 2;
  nozzleTip.position.set(0, 0.016, -0.121);
  g.add(nozzleTip);

  // Front chrome trigger lever
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.068, 0.013), chromeMat);
  trigger.position.set(0, -0.044, -0.020);
  trigger.rotation.x = -0.20;
  g.add(trigger);

  // Brass hose quick-coupler at base of handle
  const coupler = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.016, 0.036, 14), brassMat);
  coupler.position.set(0, -0.126, 0.032);
  coupler.rotation.x = 0.24;
  g.add(coupler);

  if (includeLongTail) {
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.140, 0.036),
      new THREE.Vector3(-0.02, -0.26, 0.07),
      new THREE.Vector3(-0.09, -0.44, 0.10),
      new THREE.Vector3(-0.22, -0.68, 0.02),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 14, 0.011, 10, false), hosePipeMat));
  }

  const tipMarker = new THREE.Object3D();
  tipMarker.position.set(0, 0.016, -0.144);
  g.add(tipMarker);

  g.userData = { tipMarker, trigger };
  return g;
}

function createCarWashSponge(textures) {
  const g = new THREE.Group();
  g.name = 'ToolSponge';

  const spongeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e8c860'),
    map: textures.sponge.map,
    normalMap: textures.sponge.normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughnessMap: textures.sponge.roughnessMap,
    aoMap: textures.sponge.aoMap,
    aoMapIntensity: 0.9,
    roughness: 0.95,
    metalness: 0.0,
    sheen: 0.22,
    sheenRoughness: 0.85,
  });

  const body = new THREE.Mesh(createErgonomicSpongeGeometry(), spongeMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);

  const sudsMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#fbfdff'),
    emissive: new THREE.Color('#e6eff7'),
    emissiveIntensity: 0.2,
    roughness: 0.34,
    clearcoat: 0.48,
    clearcoatRoughness: 0.2,
  });
  const sudsOffsets = [
    [-0.056, -0.022, -0.026, 0.016],
    [0.050, -0.024, -0.030, 0.018],
    [0.008, -0.028, -0.042, 0.017],
    [-0.024, -0.025, -0.046, 0.014],
  ];
  for (const [x, y, z, r] of sudsOffsets) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), sudsMat);
    puff.scale.set(1.2, 0.58, 1.1);
    puff.position.set(x, y, z);
    g.add(puff);
  }

  g.userData = { body };
  return g;
}

function createShowerWand(textures, includeTail = true) {
  const g = new THREE.Group();
  g.name = 'ToolShowerWand';

  const chromeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d2d8de'),
    metalness: 0.92,
    roughness: 0.16,
  });
  const rubberMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#27353f'),
    map: textures.rubber.map,
    normalMap: textures.rubber.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: textures.rubber.roughnessMap,
    roughness: 0.88,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: createShowerRoseTexture(),
    metalness: 0.78,
    roughness: 0.26,
  });
  const hoseMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#2d5f78'),
    roughness: 0.40,
    clearcoat: 0.26,
  });

  // Angled pistol grip matching gripHand coordinates!
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.132, 16), rubberMat);
  grip.position.set(0, -0.054, 0.015);
  grip.rotation.x = 0.24;
  g.add(grip);

  // Brushed aluminum angled neck tube extending forward
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.012, 0.155, 14), chromeMat);
  neck.rotation.x = Math.PI / 2 - 0.12;
  neck.position.set(0, 0.014, -0.068);
  g.add(neck);

  // Flared chrome garden shower rose head
  const roseHead = new THREE.Group();
  roseHead.position.set(0, 0.025, -0.148);
  roseHead.rotation.x = 0.20;
  g.add(roseHead);

  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.014, 0.034, 22), chromeMat);
  bell.rotation.x = -Math.PI / 2;
  roseHead.add(bell);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.0055, 10, 22), rubberMat);
  rim.position.set(0, 0, -0.017);
  roseHead.add(rim);

  const face = new THREE.Mesh(new THREE.CircleGeometry(0.042, 22), faceMat);
  face.rotation.y = Math.PI;
  face.position.set(0, 0, -0.0185);
  roseHead.add(face);

  if (includeTail) {
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.125, 0.034),
      new THREE.Vector3(0.03, -0.26, 0.09),
      new THREE.Vector3(0.09, -0.48, 0.08),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 12, 0.0105, 8, false), hoseMat));
  }

  const tipMarker = new THREE.Object3D();
  tipMarker.position.set(0, 0.020, -0.175);
  g.add(tipMarker);

  g.userData = { tipMarker };
  return g;
}

function createMicrofiberTowel(textures) {
  const g = new THREE.Group();
  g.name = 'ToolTowel';

  const towelMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#4f84ad'),
    map: textures.towel.map,
    normalMap: textures.towel.normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughnessMap: textures.towel.roughnessMap,
    aoMap: textures.towel.aoMap,
    aoMapIntensity: 0.90,
    roughness: 0.96,
    metalness: 0.0,
    sheen: 0.68,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color('#b6daf2'),
  });

  // Double-folded realistic cloth layers (never one flat rectangle!)
  const bottomFold = new THREE.Mesh(createFoldedTowelLayer(0.24, 0.026, 0.18, 0.4), towelMat);
  bottomFold.position.y = -0.010;
  bottomFold.castShadow = true;
  bottomFold.receiveShadow = true;
  g.add(bottomFold);

  const topFold = new THREE.Mesh(createFoldedTowelLayer(0.228, 0.024, 0.168, 2.7), towelMat);
  topFold.position.set(0.005, 0.011, -0.004);
  topFold.rotation.y = 0.04;
  topFold.castShadow = true;
  topFold.receiveShadow = true;
  g.add(topFold);

  return g;
}

function createSoapyBucket(textures) {
  const bucket = new THREE.Group();
  bucket.name = 'SoapyBucket';

  const plasticMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#2b4b60'),
    normalMap: textures.rubber.normalMap,
    normalScale: new THREE.Vector2(0.10, 0.10),
    roughnessMap: textures.rubber.roughnessMap,
    roughness: 0.44,
    metalness: 0.0,
    clearcoat: 0.30,
    clearcoatRoughness: 0.30,
  });
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#213b4d'),
    roughness: 0.46,
    clearcoat: 0.25,
  });
  const wireMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c8ced4'),
    metalness: 0.88,
    roughness: 0.22,
  });

  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.122, 0.26, 26, 1, true), plasticMat);
  shell.material.side = THREE.DoubleSide;
  shell.position.y = 0.13;
  shell.castShadow = true;
  shell.receiveShadow = true;
  bucket.add(shell);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.157, 0.154, 0.028, 26, 1, true), rimMat);
  band.position.y = 0.242;
  bucket.add(band);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.156, 0.0085, 10, 28), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.26;
  bucket.add(rim);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.0035, 8, 24, Math.PI), wireMat);
  handle.position.set(0, 0.245, 0);
  handle.rotation.x = 1.15;
  bucket.add(handle);

  const foamMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#fbfdff'),
    emissive: new THREE.Color('#e8f1f8'),
    emissiveIntensity: 0.22,
    roughness: 0.32,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
    sheen: 0.45,
    sheenColor: new THREE.Color('#ffffff'),
  });
  const waterDisc = new THREE.Mesh(new THREE.CircleGeometry(0.146, 22), foamMat);
  waterDisc.rotation.x = -Math.PI / 2;
  waterDisc.position.y = 0.232;
  bucket.add(waterDisc);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (i % 2) * 0.25;
    const rad = 0.032 + (i % 3) * 0.038;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028 + (i % 3) * 0.008, 1), foamMat);
    puff.scale.set(1.25, 0.60, 1.12);
    puff.position.set(Math.cos(a) * rad, 0.242 + (i % 2) * 0.01, Math.sin(a) * rad);
    bucket.add(puff);
  }

  return bucket;
}

export class FirstPersonRig {
  constructor(scene, camera, textures, woodTex) {
    this.camera = camera;
    this.rigRoot = new THREE.Group();
    this.rigRoot.name = 'FirstPersonRig';
    camera.add(this.rigRoot);

    // 1. Hand + active held tool pivot (first-person right hand)
    this.handPivot = new THREE.Group();
    this.rigRoot.add(this.handPivot);

    const { gripHand, flatHand } = createFirstPersonHands(textures);
    this.gripHand = gripHand;
    this.flatHand = flatHand;
    this.handPivot.add(gripHand, flatHand);

    this.heldTools = {
      hose: createHoseGun(textures, true),
      sponge: createCarWashSponge(textures),
      shower: createShowerWand(textures, true),
      towel: createMicrofiberTowel(textures),
    };

    // Exact alignment with gripHand (pistol grip at origin) and flatHand (palm over sponge/towel)
    this.heldTools.hose.position.set(0, 0, 0);
    this.heldTools.shower.position.set(0, 0, 0);

    this.heldTools.sponge.position.set(-0.004, -0.028, -0.032);
    this.heldTools.sponge.rotation.set(0.10, 0.05, 0.0);

    this.heldTools.towel.scale.setScalar(0.84);
    this.heldTools.towel.position.set(-0.004, -0.026, -0.034);
    this.heldTools.towel.rotation.set(0.08, 0.04, 0.0);

    for (const tool of Object.values(this.heldTools)) {
      this.handPivot.add(tool);
    }

    // 2. WORLD-GROUNDED Driveway Car-Wash Supply Station (physically on pavers y = 0!)
    this.stationRoot = new THREE.Group();
    this.stationRoot.name = 'GroundedWashStation';
    this.stationRoot.position.set(-1.28, 0.0, 2.02);
    this.stationRoot.rotation.y = -0.49;
    scene.add(this.stationRoot);

    const aoShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 0.68),
      new THREE.MeshBasicMaterial({
        map: createStationContactShadow(),
        transparent: true,
        depthWrite: false,
        opacity: 0.92,
      })
    );
    aoShadow.rotation.x = -Math.PI / 2;
    aoShadow.position.set(0.0, 0.006, 0.02);
    this.stationRoot.add(aoShadow);

    // Deeper weathered cedar garden step-stool (blends naturally into real outdoor driveway!)
    const stoolWoodTex = woodTex.clone();
    stoolWoodTex.needsUpdate = true;
    stoolWoodTex.repeat.set(1.2, 0.6);
    const stoolMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b09579'), // modulates woodTex to rich weathered cedar
      map: stoolWoodTex,
      normalMap: textures.concrete.normalMap,
      normalScale: new THREE.Vector2(0.28, 0.22),
      roughness: 0.88,
      metalness: 0.0,
    });

    const stool = new THREE.Group();
    stool.position.set(0.22, 0.0, 0.0);
    this.stationRoot.add(stool);

    for (let s = -1; s <= 1; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.024, 0.090), stoolMat);
      slat.position.set(0, 0.185, s * 0.100);
      slat.castShadow = true;
      slat.receiveShadow = true;
      stool.add(slat);
    }
    for (const sx of [-0.27, 0.27]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.175, 0.275), stoolMat);
      leg.position.set(sx, 0.0875, 0);
      leg.castShadow = true;
      leg.receiveShadow = true;
      stool.add(leg);
    }
    const crossBrace = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.044, 0.022), stoolMat);
    crossBrace.position.set(0, 0.11, 0);
    stool.add(crossBrace);

    this.dockItems = {};
    this.dockPickMeshes = [];

    const registerSlot = (id, obj, pos, hitRadius = 0.16) => {
      const slot = new THREE.Group();
      slot.position.copy(pos);
      slot.userData = { toolId: id, baseY: pos.y };
      slot.add(obj);

      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(hitRadius, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitMesh.position.y = 0.08;
      hitMesh.userData = { toolId: id };
      slot.add(hitMesh);
      this.dockPickMeshes.push(hitMesh);

      this.stationRoot.add(slot);
      this.dockItems[id] = { slot, obj, hitMesh };
    };

    // Slot 1: Coiled green garden hose + brass spray gun on pavers
    const hoseRestGroup = new THREE.Group();
    const hoseCoilMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#265a3c'),
      normalMap: textures.rubber.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.44,
      clearcoat: 0.24,
    });
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.013, 10, 24), hoseCoilMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0, 0.015, 0);
    hoseRestGroup.add(coil);
    const coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.0125, 10, 22), hoseCoilMat);
    coil2.rotation.x = Math.PI / 2;
    coil2.position.set(0.01, 0.036, 0.005);
    hoseRestGroup.add(coil2);

    this.dockHoseGun = createHoseGun(textures, false);
    this.dockHoseGun.scale.setScalar(1.05);
    this.dockHoseGun.position.set(0.02, 0.092, 0.02);
    this.dockHoseGun.rotation.set(0.32, -0.75, -0.85);
    hoseRestGroup.add(this.dockHoseGun);
    registerSlot('hose', hoseRestGroup, new THREE.Vector3(-0.46, 0.0, 0.04), 0.17);

    // Slot 2: Real soapy car-wash bucket + porous yellow sponge
    const bucketSlotGroup = new THREE.Group();
    const bucket = createSoapyBucket(textures);
    bucketSlotGroup.add(bucket);

    this.dockSponge = createCarWashSponge(textures);
    this.dockSponge.scale.setScalar(1.02);
    this.dockSponge.position.set(0.01, 0.272, 0.015);
    this.dockSponge.rotation.set(0.22, 0.42, -0.14);
    bucketSlotGroup.add(this.dockSponge);
    registerSlot('sponge', bucketSlotGroup, new THREE.Vector3(-0.18, 0.0, 0.04), 0.19);

    // Slot 3: Chrome garden shower rose wand resting on cedar step-stool
    const dockShower = createShowerWand(textures, false);
    dockShower.scale.setScalar(1.0);
    dockShower.position.set(0.0, 0.048, 0.01);
    dockShower.rotation.set(0.14, -0.62, -1.32);
    registerSlot('shower', dockShower, new THREE.Vector3(0.13, 0.197, 0.0), 0.16);

    // Slot 4: Double-folded sky-blue woven microfiber drying towel on cedar step-stool
    const dockTowel = createMicrofiberTowel(textures);
    dockTowel.scale.setScalar(0.95);
    dockTowel.position.set(0.0, 0.022, 0.01);
    dockTowel.rotation.set(0.0, -0.22, 0.0);
    registerSlot('towel', dockTowel, new THREE.Vector3(0.40, 0.197, 0.01), 0.16);

    this.activeTool = 'hose';
    this.suggestedTool = 'hose';
    this.isPortrait = false;

    this.restPos = new THREE.Vector3(0.26, -0.17, -0.58);
    this.targetPos = this.restPos.clone();
    this.currentPos = this.restPos.clone();
    this.currentRot = new THREE.Euler(0.06, -0.24, 0.04);
    this.targetRot = this.currentRot.clone();
    this.activePress = 0;
    this.scrubPhase = 0;
    this.swapAnim = 0;

    this.setTool('hose', true);
    this.updateLayout(false);
  }

  updateLayout(isPortrait) {
    this.isPortrait = isPortrait;
    if (isPortrait) {
      this.stationRoot.position.set(-1.38, 0.0, 2.26);
      this.stationRoot.scale.setScalar(0.92);
      this.restPos.set(0.115, -0.145, -0.52);
    } else {
      this.stationRoot.position.set(-1.26, 0.0, 1.98);
      this.stationRoot.scale.setScalar(1.0);
      this.restPos.set(0.205, -0.150, -0.50);
    }
  }

  setTool(toolId, instant = false) {
    this.activeTool = toolId;
    for (const [id, mesh] of Object.entries(this.heldTools)) {
      mesh.visible = id === toolId;
    }
    const isGrip = toolId === 'hose' || toolId === 'shower';
    this.gripHand.visible = isGrip;
    this.flatHand.visible = !isGrip;

    this.dockHoseGun.visible = toolId !== 'hose';
    this.dockSponge.visible = toolId !== 'sponge';
    this.dockItems.shower.obj.visible = toolId !== 'shower';
    this.dockItems.towel.obj.visible = toolId !== 'towel';

    if (!instant) {
      this.swapAnim = 1.0;
    }
  }

  setSuggestedTool(toolId) {
    this.suggestedTool = toolId;
  }

  getNozzleWorldTip(out = new THREE.Vector3()) {
    const tool = this.heldTools[this.activeTool];
    if (tool && tool.userData && tool.userData.tipMarker) {
      tool.userData.tipMarker.getWorldPosition(out);
    } else {
      this.handPivot.getWorldPosition(out);
    }
    return out;
  }

  getDockSlotWorldPos(toolId, out = new THREE.Vector3()) {
    const item = this.dockItems[toolId];
    if (item) {
      item.slot.getWorldPosition(out);
      out.y += 0.24;
    }
    return out;
  }

  update(dt, elapsed, pointerNdc, isInteracting, worldHitPoint = null) {
    this.activePress += ((isInteracting ? 1 : 0) - this.activePress) * Math.min(1, dt * 14);
    this.swapAnim = Math.max(0, this.swapAnim - dt * 4.2);

    const isSpray = this.activeTool === 'hose' || this.activeTool === 'shower';

    if (isInteracting && pointerNdc) {
      if (isSpray) {
        const tx = this.restPos.x + pointerNdc.x * (this.isPortrait ? 0.08 : 0.14);
        const ty = this.restPos.y + 0.02 + pointerNdc.y * 0.10;
        this.targetPos.set(tx, ty, this.restPos.z - 0.02);
        this.targetRot.set(
          0.06 + pointerNdc.y * 0.34,
          -0.22 - pointerNdc.x * 0.42,
          0.04 - pointerNdc.x * 0.08
        );
      } else {
        this.scrubPhase += dt * 15.0;
        const scrubX = Math.cos(this.scrubPhase) * 0.022;
        const scrubY = Math.sin(this.scrubPhase * 1.15) * 0.018;
        if (worldHitPoint) {
          const localHit = this.camera.worldToLocal(worldHitPoint.clone());
          const dir = localHit.clone().normalize();
          const dist = Math.min(1.65, Math.max(0.45, localHit.length() - 0.11));
          this.targetPos.copy(dir).multiplyScalar(dist);
          this.targetPos.x += 0.022 + scrubX;
          this.targetPos.y += -0.008 + scrubY;
        } else {
          this.targetPos.set(pointerNdc.x * 0.24 + scrubX, pointerNdc.y * 0.18 + scrubY, -0.55);
        }
        this.targetRot.set(0.24 + scrubY * 2.5, -0.18 - pointerNdc.x * 0.25, -0.12 + scrubX * 2.6);
      }
    } else {
      const breathe = Math.sin(elapsed * 1.9) * 0.005;
      this.targetPos.set(this.restPos.x, this.restPos.y + breathe, this.restPos.z);
      this.targetRot.set(0.05, -0.24, 0.04);
    }

    const swapDip = Math.sin(this.swapAnim * Math.PI) * 0.12;
    const lerpSpeed = Math.min(1, dt * (isInteracting ? 14 : 7));
    this.currentPos.lerp(this.targetPos, lerpSpeed);
    this.currentRot.x += (this.targetRot.x - this.currentRot.x) * lerpSpeed;
    this.currentRot.y += (this.targetRot.y - this.currentRot.y) * lerpSpeed;
    this.currentRot.z += (this.targetRot.z - this.currentRot.z) * lerpSpeed;

    this.handPivot.position.copy(this.currentPos);
    this.handPivot.position.y -= swapDip;
    this.handPivot.rotation.copy(this.currentRot);

    if (this.activeTool === 'sponge') {
      const sq = 1.0 - this.activePress * 0.16;
      this.heldTools.sponge.scale.set(1.0 + this.activePress * 0.08, sq, 1.0 + this.activePress * 0.08);
    }
    if (this.activeTool === 'hose' && this.heldTools.hose.userData.trigger) {
      this.heldTools.hose.userData.trigger.rotation.x = -0.20 + this.activePress * 0.20;
    }

    // Subtle physical invitation wiggle ONLY on the currently suggested resting tool
    for (const [id, item] of Object.entries(this.dockItems)) {
      const isSuggested = id === this.suggestedTool && id !== this.activeTool;
      const baseY = item.slot.userData.baseY;
      const targetY = baseY + (isSuggested ? 0.006 + Math.max(0, Math.sin(elapsed * 3.4)) * 0.010 : 0);
      const targetTilt = isSuggested ? Math.sin(elapsed * 3.4) * 0.05 : 0;
      item.slot.position.y += (targetY - item.slot.position.y) * Math.min(1, dt * 8);
      item.slot.rotation.z += (targetTilt - item.slot.rotation.z) * Math.min(1, dt * 8);
    }
  }
}
