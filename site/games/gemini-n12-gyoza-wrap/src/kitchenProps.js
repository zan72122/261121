import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import {
  loadPBRSet,
  createGyozaSkinMaps,
  createCookedGyozaSkinMaps,
  createFillingMaps,
  createHanetsukiWingMaps,
  createWovenClothMap,
  createStonewareGlazeMap,
  createContactShadowTexture,
  createRectContactShadowTexture,
  createSteamTexture,
  createCondensationMaps,
} from './textures.js';

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  const cr = Math.min(r, hw, hh);
  s.moveTo(-hw + cr, -hh);
  s.lineTo(hw - cr, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  s.lineTo(hw, hh - cr);
  s.quadraticCurveTo(hw, hh, hw - cr, hh);
  s.lineTo(-hw + cr, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  s.lineTo(-hw, -hh + cr);
  s.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  return s;
}

function makeContactShadow(tex, w, d, opacity = 0.52) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  mesh.position.y = 0.0005;
  return mesh;
}

/**
 * Smooth-shaded rounded rectangular housing (eliminates vertical flat facets on ExtrudeGeometry sides!)
 */
function buildSmoothRoundedBox(w, d, h, radius, bevel = 0.005, segs = 32) {
  const shape = roundedRectShape(w, d, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: segs,
  });
  geo.rotateX(Math.PI / 2);
  // Merge vertices by welding? Instead compute smooth creased normals by indexing or high curveSegments!
  // With curveSegments=32 & bevelSegments=5, corners have 32 micro-steps = silky smooth enamel reflection!
  return geo;
}

export async function buildKitchenEnvironment(scene) {
  const gltfLoader = new GLTFLoader();

  const rawSkin = createGyozaSkinMaps();
  const cookedSkin = createCookedGyozaSkinMaps();
  const fillingMaps = createFillingMaps();
  const hanetsukiMaps = createHanetsukiWingMaps();
  const wovenClothMap = createWovenClothMap();
  const stonewareMap = createStonewareGlazeMap();
  const contactShadowTex = createContactShadowTexture();
  const rectShadowTex = createRectContactShadowTexture();
  const steamTex = createSteamTexture();
  const condensationMaps = createCondensationMaps();

  const fillingMaterial = new THREE.MeshPhysicalMaterial({
    map: fillingMaps.map,
    normalMap: fillingMaps.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: fillingMaps.roughnessMap,
    roughness: 0.92,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.26,
  });

  // Load CC0 PBR sets (Poly Haven + ambientCG)
  // Rotate kitchen_wood 90° so hardwood planks run horizontally left-to-right across the kitchen counter!
  const woodMaps = loadPBRSet('./assets/textures/kitchen_wood', {
    map: 'diff.jpg',
    normalMap: 'nor_gl.jpg',
    roughnessMap: 'rough.jpg',
    aoMap: 'ao.jpg',
  }, { repeat: [1.3, 2.2], anisotropy: 8, rotation: Math.PI * 0.5 });

  const tileMaps = loadPBRSet('./assets/textures/long_white_tiles', {
    map: 'diff.jpg',
    normalMap: 'nor_gl.jpg',
    roughnessMap: 'rough.jpg',
    aoMap: 'ao.jpg',
  }, { repeat: [3.2, 1.8], anisotropy: 4 });

  // Finer weave scale for realistic natural woven linen kitchen cloth (NOT flat grey mat!)
  const linenMaps = loadPBRSet('./assets/textures/rough_linen', {
    map: 'diff.jpg',
    normalMap: 'nor_gl.jpg',
    roughnessMap: 'rough.jpg',
  }, { repeat: [7.5, 5.5], anisotropy: 8 });

  // Fine dark fluororesin/cast-iron micro-grain for hot plate griddle
  const metalMaps = loadPBRSet('./assets/textures/metal_acg', {
    map: 'Metal049A_1K-JPG_Color.jpg',
    normalMap: 'Metal049A_1K-JPG_NormalGL.jpg',
    roughnessMap: 'Metal049A_1K-JPG_Roughness.jpg',
    metalnessMap: 'Metal049A_1K-JPG_Metalness.jpg',
  }, { repeat: [5.0, 4.0], anisotropy: 8 });

  const steelMaps = loadPBRSet('./assets/textures/metal_plate_02', {
    map: 'diff.jpg',
    normalMap: 'nor_gl.jpg',
    roughnessMap: 'rough.jpg',
  }, { repeat: [2.2, 2.2], anisotropy: 4 });

  const porcelainMaps = loadPBRSet('./assets/textures/porcelain_acg', {
    map: 'Porcelain003_1K-JPG_Color.jpg',
    normalMap: 'Porcelain003_1K-JPG_NormalGL.jpg',
    roughnessMap: 'Porcelain003_1K-JPG_Roughness.jpg',
  }, { repeat: [1.5, 1.5], anisotropy: 4 });

  const sharedAssets = {
    rawSkin,
    cookedSkin,
    fillingMaterial,
    hanetsukiMaps,
    contactShadowTex,
    rectShadowTex,
    steamTex,
    condensationMaps,
    porcelainMaps,
    steelMaps,
  };

  // --- 1. REAL KITCHEN COUNTERTOP & TILE BACKSPLASH ---
  const kitchenGroup = new THREE.Group();
  scene.add(kitchenGroup);

  const counterGeo = new THREE.BoxGeometry(1.9, 0.042, 1.05);
  counterGeo.setAttribute('uv2', counterGeo.attributes.uv);
  const counterMat = new THREE.MeshStandardMaterial({
    ...woodMaps,
    color: new THREE.Color('#dfd0be'),
    roughness: 0.76,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.65, 0.65),
    aoMapIntensity: 0.55,
  });
  const counter = new THREE.Mesh(counterGeo, counterMat);
  counter.position.set(0, -0.021, -0.02);
  counter.receiveShadow = true;
  kitchenGroup.add(counter);

  const wallGeo = new THREE.PlaneGeometry(2.4, 1.25);
  wallGeo.setAttribute('uv2', wallGeo.attributes.uv);
  const wallMat = new THREE.MeshStandardMaterial({
    ...tileMaps,
    color: new THREE.Color('#edeae3'),
    roughness: 0.38,
    metalness: 0.0,
    normalScale: new THREE.Vector2(0.5, 0.5),
    aoMapIntensity: 0.45,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, 0.58, -0.40);
  wall.receiveShadow = true;
  kitchenGroup.add(wall);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.015, 0.014),
    new THREE.MeshStandardMaterial({ color: '#cfd3d7', roughness: 0.32, metalness: 0.85 })
  );
  trim.position.set(0, 0.0075, -0.394);
  trim.receiveShadow = true;
  kitchenGroup.add(trim);

  const wallAO = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 0.08),
    new THREE.MeshBasicMaterial({ color: '#1b140e', transparent: true, opacity: 0.26, depthWrite: false })
  );
  wallAO.rotation.x = -Math.PI / 2;
  wallAO.position.set(0, 0.0006, -0.36);
  kitchenGroup.add(wallAO);

  // Folded warm oatmeal woven linen tea towel (real high-res subdivided cloth with subtle organic folds!)
  const clothGeo = new THREE.BoxGeometry(0.28, 0.0038, 0.21, 24, 1, 18);
  const cPos = clothGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i), y = cPos.getY(i), z = cPos.getZ(i);
    const wave = Math.sin(x * 38 + z * 18) * 0.0007 + Math.cos(z * 44 - x * 12) * 0.0005;
    // Softly bevel corners downward like real folded cotton-linen hem
    const edge = Math.max(Math.abs(x) / 0.14, Math.abs(z) / 0.105);
    const hemDrop = Math.max(0, (edge - 0.88) / 0.12) * 0.0014;
    cPos.setY(i, y + wave - (y > 0 ? hemDrop : 0));
  }
  clothGeo.computeVertexNormals();
  const clothMat = new THREE.MeshStandardMaterial({
    map: wovenClothMap,
    normalMap: linenMaps.normalMap,
    roughnessMap: linenMaps.roughnessMap,
    color: new THREE.Color('#ffffff'),
    roughness: 0.94,
    metalness: 0.0,
    normalScale: new THREE.Vector2(1.6, 1.6),
  });
  const linenCloth = new THREE.Mesh(clothGeo, clothMat);
  linenCloth.position.set(-0.185, 0.0022, -0.155);
  linenCloth.rotation.y = 0.05;
  linenCloth.receiveShadow = true;
  linenCloth.castShadow = true;
  kitchenGroup.add(linenCloth);
  const clothShadow = makeContactShadow(rectShadowTex, 0.30, 0.23, 0.32);
  clothShadow.position.set(-0.185, 0.0005, -0.155);
  clothShadow.rotation.y = 0.05;
  kitchenGroup.add(clothShadow);

  // --- 2. LOAD REAL POLY HAVEN CC0 glTF KITCHEN MODELS ---
  async function loadNormalizedModel(url, targetMaxDim, yOffset = 0) {
    const gltf = await gltfLoader.loadAsync(url);
    const root = gltf.scene;
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material.envMapIntensity = 0.92;
        }
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetMaxDim / maxDim;
    root.scale.setScalar(scale);

    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    const center2 = new THREE.Vector3();
    const size2 = new THREE.Vector3();
    box2.getCenter(center2);
    box2.getSize(size2);

    const wrapper = new THREE.Group();
    root.position.set(-center2.x, -box2.min.y + yOffset, -center2.z);
    wrapper.add(root);
    wrapper.userData.size = size2;
    return wrapper;
  }

  const [cuttingBoard, fillingBowl, woodenSpoon, gingerProp] = await Promise.all([
    loadNormalizedModel('./assets/models/wooden_cutting_board/wooden_cutting_board_1k.gltf', 0.275),
    loadNormalizedModel('./assets/models/wooden_bowl_01/wooden_bowl_01_1k.gltf', 0.132),
    loadNormalizedModel('./assets/models/wooden_spoon/wooden_spoon_1k.gltf', 0.155),
    loadNormalizedModel('./assets/models/food_ginger_01/food_ginger_01_1k.gltf', 0.095),
  ]);

  // Compact ergonomic layout: fits beautifully in BOTH 1024x768 landscape AND 390x844 portrait!
  cuttingBoard.position.set(-0.145, 0, 0.068);
  cuttingBoard.rotation.y = 0.03;
  kitchenGroup.add(cuttingBoard);
  const boardSize = cuttingBoard.userData.size;
  const boardTopY = boardSize.y;
  const boardShadow = makeContactShadow(rectShadowTex, boardSize.x * 1.09, boardSize.z * 1.12, 0.58);
  boardShadow.position.set(-0.145, 0.0006, 0.068);
  boardShadow.rotation.y = 0.03;
  kitchenGroup.add(boardShadow);

  // Wooden bowl of juicy gyoza filling (あん) — directly behind cutting board
  const bowlPos = new THREE.Vector3(-0.205, 0.0042, -0.135);
  fillingBowl.position.copy(bowlPos);
  kitchenGroup.add(fillingBowl);
  const bowlSize = fillingBowl.userData.size;
  const bowlShadow = makeContactShadow(contactShadowTex, bowlSize.x * 1.16, bowlSize.z * 1.16, 0.56);
  bowlShadow.position.set(bowlPos.x, 0.0046, bowlPos.z);
  kitchenGroup.add(bowlShadow);

  const bowlFillingGeo = new THREE.SphereGeometry(bowlSize.x * 0.405, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.58);
  const bfPos = bowlFillingGeo.attributes.position;
  for (let i = 0; i < bfPos.count; i++) {
    const x = bfPos.getX(i), y = bfPos.getY(i), z = bfPos.getZ(i);
    const n =
      Math.sin(x * 125 + 1.2) * Math.cos(z * 135 - 0.8) * 0.0030 +
      Math.sin(x * 270 - z * 240) * 0.0013;
    bfPos.setXYZ(i, x, y * 0.54 + n, z);
  }
  bowlFillingGeo.computeVertexNormals();
  const bowlFilling = new THREE.Mesh(bowlFillingGeo, fillingMaterial);
  bowlFilling.position.set(bowlPos.x, bowlPos.y + bowlSize.y * 0.44, bowlPos.z);
  bowlFilling.castShadow = true;
  bowlFilling.receiveShadow = true;
  kitchenGroup.add(bowlFilling);

  // Wooden spoon resting cleanly inside/across the filling bowl
  const spoonRestPos = new THREE.Vector3(bowlPos.x + 0.048, bowlPos.y + bowlSize.y * 0.80, bowlPos.z + 0.028);
  const spoonRestRot = new THREE.Euler(-0.32, 0.65, 0.22);
  woodenSpoon.position.copy(spoonRestPos);
  woodenSpoon.rotation.copy(spoonRestRot);
  kitchenGroup.add(woodenSpoon);

  // Real ginger root resting naturally on its side in rear-left kitchen background
  gingerProp.position.set(-0.295, 0.022, -0.225);
  gingerProp.rotation.set(Math.PI * 0.46, 0.72, 0.18);
  kitchenGroup.add(gingerProp);
  const gingerShadow = makeContactShadow(contactShadowTex, 0.10, 0.08, 0.45);
  gingerShadow.position.set(-0.295, 0.0045, -0.225);
  kitchenGroup.add(gingerShadow);

  // --- 3. REALISTIC ELECTRIC HOT PLATE (ホットプレート) ---
  const hotPlateGroup = new THREE.Group();
  const hpPos = new THREE.Vector3(0.145, 0, -0.022);
  hotPlateGroup.position.copy(hpPos);
  hotPlateGroup.rotation.y = -0.04;
  kitchenGroup.add(hotPlateGroup);

  const hpW = 0.275, hpD = 0.218, hpH = 0.044;
  const hpFootH = 0.008;
  const panSurfaceY = hpFootH + hpH - 0.0065; // ~0.0455m

  const hpShadow = makeContactShadow(rectShadowTex, hpW * 1.18, hpD * 1.22, 0.64);
  hpShadow.position.set(0, 0.0006, 0);
  hotPlateGroup.add(hpShadow);

  const footMat = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.88, metalness: 0.04 });
  for (const fx of [-hpW * 0.39, hpW * 0.39]) {
    for (const fz of [-hpD * 0.37, hpD * 0.37]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, hpFootH, 14), footMat);
      foot.position.set(fx, hpFootH * 0.5, fz);
      foot.castShadow = true;
      hotPlateGroup.add(foot);
    }
  }

  // Smooth-curved matte dark charcoal-black Japanese appliance housing (zero corner faceting!)
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#232325'),
    roughness: 0.38,
    metalness: 0.12,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
  });
  const bodyGeo = buildSmoothRoundedBox(hpW, hpD, hpH, 0.032, 0.005, 32);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.y = hpFootH + hpH - 0.005;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  hotPlateGroup.add(bodyMesh);

  // Satin brushed stainless-steel upper trim collar
  const rimOuter = roundedRectShape(hpW - 0.006, hpD - 0.006, 0.030);
  const rimInner = roundedRectShape(hpW - 0.028, hpD - 0.028, 0.022);
  rimOuter.holes.push(rimInner);
  const rimGeo = new THREE.ExtrudeGeometry(rimOuter, {
    depth: 0.009,
    bevelEnabled: true,
    bevelThickness: 0.0022,
    bevelSize: 0.002,
    bevelSegments: 4,
    curveSegments: 32,
  });
  rimGeo.rotateX(Math.PI / 2);
  const stainlessMat = new THREE.MeshStandardMaterial({
    normalMap: steelMaps.normalMap,
    roughnessMap: steelMaps.roughnessMap,
    color: new THREE.Color('#dfe4ea'),
    roughness: 0.24,
    metalness: 0.90,
    normalScale: new THREE.Vector2(0.12, 0.12),
  });
  const rimMesh = new THREE.Mesh(rimGeo, stainlessMat);
  rimMesh.position.y = hpFootH + hpH + 0.009;
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  hotPlateGroup.add(rimMesh);

  // Authentic matte micro-textured charcoal cast-iron / fluororesin griddle surface!
  const panShape = roundedRectShape(hpW - 0.026, hpD - 0.026, 0.021);
  const panGeo = new THREE.ShapeGeometry(panShape, 24);
  panGeo.rotateX(-Math.PI / 2);
  const pPos = panGeo.attributes.position;
  const pUv = panGeo.attributes.uv;
  for (let i = 0; i < pPos.count; i++) {
    pUv.setXY(i, (pPos.getX(i) / hpW) + 0.5, (pPos.getZ(i) / hpD) + 0.5);
  }
  const griddleMat = new THREE.MeshStandardMaterial({
    normalMap: metalMaps.normalMap,
    roughnessMap: metalMaps.roughnessMap,
    color: new THREE.Color('#1b1c20'), // authentic matte dark charcoal nonstick griddle!
    roughness: 0.58,
    metalness: 0.28,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  const griddlePan = new THREE.Mesh(panGeo, griddleMat);
  griddlePan.position.y = panSurfaceY;
  griddlePan.receiveShadow = true;
  hotPlateGroup.add(griddlePan);

  // Dark nonstick recessed inner wall lip
  const wallOuter = roundedRectShape(hpW - 0.023, hpD - 0.023, 0.022);
  const wallInner = roundedRectShape(hpW - 0.030, hpD - 0.030, 0.020);
  wallOuter.holes.push(wallInner);
  const panWallGeo = new THREE.ExtrudeGeometry(wallOuter, { depth: 0.013, bevelEnabled: false, curveSegments: 24 });
  panWallGeo.rotateX(Math.PI / 2);
  const panWall = new THREE.Mesh(panWallGeo, griddleMat);
  panWall.position.y = panSurfaceY + 0.012;
  hotPlateGroup.add(panWall);

  // Subtle glistening cooking-oil sheen on griddle center
  const oilGeo = new THREE.CircleGeometry(0.088, 36);
  oilGeo.rotateX(-Math.PI / 2);
  const oilMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#3a301e'),
    roughness: 0.06,
    metalness: 0.0,
    transparent: true,
    opacity: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    depthWrite: false,
  });
  const oilSheen = new THREE.Mesh(oilGeo, oilMat);
  oilSheen.position.y = panSurfaceY + 0.0004;
  hotPlateGroup.add(oilSheen);

  // Side heatproof dark Bakelite handles
  const bakeliteMat = new THREE.MeshStandardMaterial({ color: '#181717', roughness: 0.44, metalness: 0.06 });
  for (const side of [-1, 1]) {
    const hGroup = new THREE.Group();
    hGroup.position.set(side * (hpW * 0.5 + 0.011), hpFootH + hpH * 0.60, 0);
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.062, 6, 12), bakeliteMat);
    bar.rotation.x = Math.PI / 2;
    bar.castShadow = true;
    hGroup.add(bar);
    for (const sz of [-0.028, 0.028]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0056, 0.020, 10), stainlessMat);
      post.rotation.z = Math.PI / 2;
      post.position.set(-side * 0.010, 0, sz);
      hGroup.add(post);
    }
    hotPlateGroup.add(hGroup);
  }

  // Front stainless temperature bezel + physical sliding lever + warm amber pilot LED (ZERO TEXT!)
  const ctrlBezel = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.018, 0.007), stainlessMat);
  ctrlBezel.position.set(0, hpFootH + hpH * 0.45, hpD * 0.5 + 0.0035);
  hotPlateGroup.add(ctrlBezel);

  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.0038, 0.003), bakeliteMat);
  slot.position.set(-0.008, hpFootH + hpH * 0.45, hpD * 0.5 + 0.007);
  hotPlateGroup.add(slot);

  const sliderKnob = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.012, 0.010), bakeliteMat);
  sliderKnob.position.set(0.010, hpFootH + hpH * 0.45, hpD * 0.5 + 0.010);
  sliderKnob.castShadow = true;
  hotPlateGroup.add(sliderKnob);

  const pilotLedMat = new THREE.MeshStandardMaterial({
    color: '#ff4b1f',
    emissive: new THREE.Color('#ff4212'),
    emissiveIntensity: 2.0,
    roughness: 0.25,
  });
  const pilotLed = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 12, 10), pilotLedMat);
  pilotLed.position.set(0.032, hpFootH + hpH * 0.45, hpD * 0.5 + 0.0075);
  hotPlateGroup.add(pilotLed);

  // Milky starch-water liquid puddle on griddle
  const starchPuddleGeo = new THREE.CircleGeometry(0.088, 40);
  starchPuddleGeo.rotateX(-Math.PI / 2);
  const starchPuddleMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f4efe2'),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const starchPuddle = new THREE.Mesh(starchPuddleGeo, starchPuddleMat);
  starchPuddle.position.y = panSurfaceY + 0.0014;
  hotPlateGroup.add(starchPuddle);

  // Crispy lacy Voronoi Hanetsuki (羽根) crust mesh — flush with the golden seared bottoms!
  const hanetsukiGeo = new THREE.CircleGeometry(0.095, 48);
  hanetsukiGeo.rotateX(-Math.PI / 2);
  const hPos = hanetsukiGeo.attributes.position;
  for (let i = 0; i < hPos.count; i++) {
    const x = hPos.getX(i), z = hPos.getZ(i);
    const r = Math.hypot(x, z);
    const curl = Math.pow(r / 0.095, 2.4) * 0.0018 + Math.sin(x * 85) * Math.cos(z * 85) * 0.00045;
    hPos.setY(i, curl);
  }
  hanetsukiGeo.computeVertexNormals();

  const hanetsukiMat = new THREE.MeshPhysicalMaterial({
    map: hanetsukiMaps.map,
    alphaMap: hanetsukiMaps.alphaMap,
    normalMap: hanetsukiMaps.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughnessMap: hanetsukiMaps.roughnessMap,
    roughness: 0.82,
    metalness: 0.0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.34,
    transparent: true,
    alphaTest: 0.16,
    side: THREE.DoubleSide,
  });
  const hanetsukiWing = new THREE.Mesh(hanetsukiGeo, hanetsukiMat);
  hanetsukiWing.castShadow = true;
  hanetsukiWing.receiveShadow = true;

  // --- 4. REMOVABLE TEMPERED-GLASS HOT PLATE LID ---
  const lidGroup = new THREE.Group();
  const lidRimOuter = roundedRectShape(hpW - 0.010, hpD - 0.010, 0.029);
  const lidRimInner = roundedRectShape(hpW - 0.032, hpD - 0.032, 0.021);
  lidRimOuter.holes.push(lidRimInner);
  const lidRimGeo = new THREE.ExtrudeGeometry(lidRimOuter, {
    depth: 0.009,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 3,
    curveSegments: 28,
  });
  lidRimGeo.rotateX(Math.PI / 2);
  const lidRim = new THREE.Mesh(lidRimGeo, stainlessMat);
  lidRim.position.y = 0.010;
  lidRim.castShadow = true;
  lidRim.receiveShadow = true;
  lidGroup.add(lidRim);

  const lidGlassShape = roundedRectShape(hpW - 0.026, hpD - 0.026, 0.022);
  const lidGlassGeo = new THREE.ShapeGeometry(lidGlassShape, 20);
  lidGlassGeo.rotateX(-Math.PI / 2);
  const lgPos = lidGlassGeo.attributes.position;
  const lgUv = lidGlassGeo.attributes.uv;
  for (let i = 0; i < lgPos.count; i++) {
    const x = lgPos.getX(i), z = lgPos.getZ(i);
    const nx = x / ((hpW - 0.026) * 0.5);
    const nz = z / ((hpD - 0.026) * 0.5);
    const dome = Math.max(0, 1 - (nx * nx * 0.72 + nz * nz * 0.72));
    lgPos.setY(i, 0.014 + Math.pow(dome, 0.82) * 0.028);
    lgUv.setXY(i, nx * 0.5 + 0.5, nz * 0.5 + 0.5);
  }
  lidGlassGeo.computeVertexNormals();

  const lidGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e8f0ee'),
    roughness: 0.05,
    metalness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    envMapIntensity: 1.75,
    side: THREE.DoubleSide,
  });
  const lidGlass = new THREE.Mesh(lidGlassGeo, lidGlassMat);
  lidGroup.add(lidGlass);

  const lidFogMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f7f9fa'),
    roughnessMap: condensationMaps.roughnessMap,
    normalMap: condensationMaps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.85,
    metalness: 0.0,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lidFog = new THREE.Mesh(lidGlassGeo, lidFogMat);
  lidFog.position.y = -0.0012;
  lidGroup.add(lidFog);

  const steamVent = new THREE.Mesh(new THREE.TorusGeometry(0.005, 0.0016, 10, 18), stainlessMat);
  steamVent.rotation.x = Math.PI / 2;
  steamVent.position.set(0.056, 0.035, -0.040);
  lidGroup.add(steamVent);

  const lidHandleGroup = new THREE.Group();
  lidHandleGroup.position.set(0, 0.041, 0);
  const handleArch = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.062, 6, 14), bakeliteMat);
  handleArch.rotation.z = Math.PI / 2;
  handleArch.position.y = 0.022;
  handleArch.castShadow = true;
  lidHandleGroup.add(handleArch);
  for (const sx of [-0.029, 0.029]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0085, 0.024, 12), bakeliteMat);
    leg.position.set(sx, 0.010, 0);
    leg.castShadow = true;
    lidHandleGroup.add(leg);
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.002, 14), stainlessMat);
    washer.position.set(sx, -0.001, 0);
    lidHandleGroup.add(washer);
  }
  lidGroup.add(lidHandleGroup);

  const lidRestPos = new THREE.Vector3(0.185, 0.002, -0.255);
  const lidRestRot = new THREE.Euler(0.16, -0.18, 0.02);
  lidGroup.position.copy(lidRestPos);
  lidGroup.rotation.copy(lidRestRot);
  kitchenGroup.add(lidGroup);

  // --- 5. JAPANESE KURO-MINO STONEWARE SERVING PLATE (黒釉美濃焼和皿) ---
  const plateGroup = new THREE.Group();
  const plateProfile = [
    new THREE.Vector2(0.000, 0.002),
    new THREE.Vector2(0.054, 0.002),
    new THREE.Vector2(0.057, 0.000),
    new THREE.Vector2(0.062, 0.000),
    new THREE.Vector2(0.066, 0.005),
    new THREE.Vector2(0.094, 0.013),
    new THREE.Vector2(0.108, 0.021),
    new THREE.Vector2(0.106, 0.0235),
    new THREE.Vector2(0.101, 0.0225),
    new THREE.Vector2(0.085, 0.0115),
    new THREE.Vector2(0.058, 0.0070),
    new THREE.Vector2(0.000, 0.0066),
  ];
  const plateGeo = new THREE.LatheGeometry(plateProfile, 52);
  const plateMat = new THREE.MeshPhysicalMaterial({
    map: stonewareMap,
    normalMap: porcelainMaps.normalMap,
    roughnessMap: porcelainMaps.roughnessMap,
    color: new THREE.Color('#ffffff'), // authentic speckled dark slate Kuro-Mino glaze!
    roughness: 0.50,
    metalness: 0.02,
    clearcoat: 0.14,
    clearcoatRoughness: 0.36,
    normalScale: new THREE.Vector2(0.24, 0.24),
  });
  const plateMesh = new THREE.Mesh(plateGeo, plateMat);
  plateMesh.castShadow = true;
  plateMesh.receiveShadow = true;
  plateGroup.add(plateMesh);

  // Authentic matte toasted unglazed stoneware rim ring
  const plateRimRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.105, 0.0017, 8, 52),
    new THREE.MeshStandardMaterial({ color: '#6a5646', roughness: 0.82, metalness: 0.0 })
  );
  plateRimRing.rotation.x = Math.PI / 2;
  plateRimRing.position.y = 0.023;
  plateGroup.add(plateRimRing);

  const plateRestPos = new THREE.Vector3(0.095, 0, 0.215);
  plateGroup.position.copy(plateRestPos);
  kitchenGroup.add(plateGroup);
  const plateShadow = makeContactShadow(contactShadowTex, 0.23, 0.23, 0.56);
  plateShadow.position.set(plateRestPos.x, 0.0005, plateRestPos.z);
  kitchenGroup.add(plateShadow);

  // --- 6. SMALL PORCELAIN SOY SAUCE & REAL GLOSSY RUBY RAYU DISH ---
  const saucerGroup = new THREE.Group();
  const saucerProfile = [
    new THREE.Vector2(0.000, 0.0015),
    new THREE.Vector2(0.023, 0.0015),
    new THREE.Vector2(0.025, 0.000),
    new THREE.Vector2(0.028, 0.000),
    new THREE.Vector2(0.039, 0.012),
    new THREE.Vector2(0.041, 0.0145),
    new THREE.Vector2(0.038, 0.0145),
    new THREE.Vector2(0.029, 0.0048),
    new THREE.Vector2(0.000, 0.0044),
  ];
  const creamPorcelainMat = new THREE.MeshPhysicalMaterial({
    ...porcelainMaps,
    color: new THREE.Color('#eae3d7'),
    roughness: 0.26,
    metalness: 0.0,
    clearcoat: 0.58,
    clearcoatRoughness: 0.18,
    normalScale: new THREE.Vector2(0.14, 0.14),
  });
  const saucerMesh = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 36), creamPorcelainMat);
  saucerMesh.castShadow = true;
  saucerMesh.receiveShadow = true;
  saucerGroup.add(saucerMesh);

  // Mirror-glossy deep dark mahogany soy sauce
  const soyGeo = new THREE.CircleGeometry(0.032, 32);
  soyGeo.rotateX(-Math.PI / 2);
  const soyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0f0401'),
    roughness: 0.03,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.45,
  });
  const soyLiquid = new THREE.Mesh(soyGeo, soyMat);
  soyLiquid.position.y = 0.0092;
  saucerGroup.add(soyLiquid);

  // Real 3D domed glossy translucent crimson-ruby chili oil (ラー油) droplets!
  const rayuMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#7a0f02'),
    emissive: new THREE.Color('#320500'),
    emissiveIntensity: 0.35,
    roughness: 0.02,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 0.86,
  });
  const rayuBeads = [
    [0.012, 0.005, 0.0044],
    [0.007, 0.011, 0.0024],
    [-0.011, 0.009, 0.0034],
    [-0.015, 0.005, 0.0018],
    [0.002, -0.012, 0.0028],
    [0.015, -0.006, 0.0021],
    [-0.005, -0.014, 0.0016],
    [0.019, 0.001, 0.0015],
  ];
  for (const [rx, rz, rr] of rayuBeads) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(rr, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), rayuMat);
    bead.scale.set(1.0, 0.24, 1.0); // glossy meniscus oil lens dome!
    bead.position.set(rx, 0.0093, rz);
    saucerGroup.add(bead);
  }

  // Concentric glossy soy-sauce ripple ring (animates when dipping a gyoza!)
  const soyRippleMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#c88555'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const soyRipple = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.011, 28), soyRippleMat);
  soyRipple.rotation.x = -Math.PI / 2;
  soyRipple.position.y = 0.0096;
  saucerGroup.add(soyRipple);

  // Translucent milky starch-water pouring stream mesh (visible while tilting cup onto hot plate!)
  const pourStreamGeo = new THREE.CylinderGeometry(0.0042, 0.0068, 0.11, 14);
  const pourStreamMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f4efe2'),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 0.9,
    transparent: true,
    opacity: 0.82,
  });
  const pourStream = new THREE.Mesh(pourStreamGeo, pourStreamMat);
  pourStream.visible = false;
  kitchenGroup.add(pourStream);

  // Small spoonful of minced filling attached to wooden spoon during scooping animation!
  const spoonScoopGeo = new THREE.IcosahedronGeometry(0.0145, 2);
  spoonScoopGeo.scale(1.2, 0.65, 0.95);
  const spoonScoop = new THREE.Mesh(spoonScoopGeo, fillingMaterial);
  spoonScoop.position.set(0.055, 0.008, 0);
  spoonScoop.visible = false;
  woodenSpoon.add(spoonScoop);

  // Reusable crispy golden hanetsuki wing crumbs (pop out when child taps/cracks the crust!)
  const crumbGroup = new THREE.Group();
  kitchenGroup.add(crumbGroup);
  const crumbGeo = new THREE.DodecahedronGeometry(0.0042, 0);
  const crumbMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#c97d28'),
    roughness: 0.52,
    metalness: 0.0,
  });
  const crumbs = [];
  for (let i = 0; i < 16; i++) {
    const cm = new THREE.Mesh(crumbGeo, crumbMat);
    cm.scale.set(1.2, 0.35, 0.9);
    cm.visible = false;
    crumbGroup.add(cm);
    crumbs.push({ mesh: cm, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.7 });
  }

  const saucerPos = new THREE.Vector3(-0.072, 0, 0.228);
  saucerGroup.position.copy(saucerPos);
  kitchenGroup.add(saucerGroup);
  const saucerShadow = makeContactShadow(contactShadowTex, 0.095, 0.095, 0.48);
  saucerShadow.position.set(saucerPos.x, 0.0005, saucerPos.z);
  kitchenGroup.add(saucerShadow);

  // --- 7. GLASS CUP OF MILKY FLOUR-WATER (水溶き片栗粉) ---
  const waterCupGroup = new THREE.Group();
  const cupProfile = [
    new THREE.Vector2(0.000, 0.000),
    new THREE.Vector2(0.024, 0.000),
    new THREE.Vector2(0.026, 0.002),
    new THREE.Vector2(0.030, 0.062),
    new THREE.Vector2(0.029, 0.064),
    new THREE.Vector2(0.027, 0.062),
    new THREE.Vector2(0.023, 0.007),
    new THREE.Vector2(0.000, 0.007),
  ];
  const cupGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ebf2f1'),
    roughness: 0.05,
    metalness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    envMapIntensity: 1.85,
  });
  const cupGlass = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 32), cupGlassMat);
  cupGlass.castShadow = false;
  waterCupGroup.add(cupGlass);

  const cupLiquidGeo = new THREE.CylinderGeometry(0.0265, 0.023, 0.040, 28);
  const cupLiquidMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f2ece0'),
    roughness: 0.16,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.10,
    transparent: true,
    opacity: 0.90,
  });
  const cupLiquid = new THREE.Mesh(cupLiquidGeo, cupLiquidMat);
  cupLiquid.position.y = 0.0275;
  waterCupGroup.add(cupLiquid);

  const cupRestPos = new THREE.Vector3(-0.042, 0, -0.155);
  waterCupGroup.position.copy(cupRestPos);
  kitchenGroup.add(waterCupGroup);
  const cupShadow = makeContactShadow(contactShadowTex, 0.082, 0.082, 0.45);
  cupShadow.position.set(cupRestPos.x, 0.0005, cupRestPos.z);
  kitchenGroup.add(cupShadow);

  // --- 8. STACK OF SPARE TRANSLUCENT GYOZA WRAPPERS ON SMALL SAUCER ---
  const stackGroup = new THREE.Group();
  const stackPlate = new THREE.Mesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0.0, 0.001),
      new THREE.Vector2(0.036, 0.001),
      new THREE.Vector2(0.039, 0.0),
      new THREE.Vector2(0.042, 0.0),
      new THREE.Vector2(0.052, 0.0085),
      new THREE.Vector2(0.051, 0.0105),
      new THREE.Vector2(0.040, 0.0042),
      new THREE.Vector2(0.0, 0.0040),
    ], 32),
    creamPorcelainMat
  );
  stackPlate.castShadow = true;
  stackPlate.receiveShadow = true;
  stackGroup.add(stackPlate);

  const spareWrapperMat = new THREE.MeshPhysicalMaterial({
    map: rawSkin.map,
    normalMap: rawSkin.normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap: rawSkin.roughnessMap,
    roughness: 0.92,
    sheen: 0.3,
    sheenColor: new THREE.Color('#fff2dd'),
  });
  const spareWrapperDisks = [];
  for (let i = 0; i < 6; i++) {
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.0012, 32), spareWrapperMat);
    disk.position.set(
      Math.sin(i * 1.9) * 0.0020,
      0.0050 + i * 0.0013,
      Math.cos(i * 2.3) * 0.0020
    );
    disk.rotation.y = i * 0.8;
    disk.castShadow = true;
    disk.receiveShadow = true;
    stackGroup.add(disk);
    spareWrapperDisks.push(disk);
  }
  const stackPos = new THREE.Vector3(-0.295, 0, 0.045);
  stackGroup.position.copy(stackPos);
  kitchenGroup.add(stackGroup);
  const stackShadow = makeContactShadow(contactShadowTex, 0.12, 0.12, 0.44);
  stackShadow.position.set(stackPos.x, 0.0005, stackPos.z);
  kitchenGroup.add(stackShadow);

  return {
    sharedAssets,
    kitchenGroup,
    cuttingBoard,
    boardTopY,
    fillingBowl,
    bowlPos,
    bowlSize,
    bowlFilling,
    woodenSpoon,
    spoonRestPos,
    spoonRestRot,
    hotPlateGroup,
    hpPos,
    panSurfaceY,
    oilSheen,
    starchPuddle,
    hanetsukiWing,
    pilotLedMat,
    sliderKnob,
    lidGroup,
    lidRestPos,
    lidRestRot,
    lidFogMat,
    plateGroup,
    plateRestPos,
    plateShadow,
    saucerGroup,
    saucerPos,
    soyLiquid,
    soyRipple,
    pourStream,
    spoonScoop,
    crumbs,
    waterCupGroup,
    cupRestPos,
    cupLiquid,
    cupShadow,
    stackGroup,
    stackPos,
    spareWrapperDisks,
  };
}
