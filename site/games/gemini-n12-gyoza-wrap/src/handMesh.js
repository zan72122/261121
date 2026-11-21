import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';

/**
 * Loads our seamless Catmull-Clark subdivided organic first-person right hand (`hand_fp.glb` V3)
 * with realistic warm human skin micro-texture, natural roughness variation, soft sheen,
 * and a subtle cozy woven cotton kitchen sleeve cuff on the lower forearm extending off-screen!
 */
export async function createRealisticHand() {
  const gltfLoader = new GLTFLoader();
  const gltf = await gltfLoader.loadAsync('./assets/models/hand_fp.glb');
  const root = gltf.scene;

  const size = 256;
  const cDiff = document.createElement('canvas');
  const cRough = document.createElement('canvas');
  cDiff.width = cRough.width = size;
  cDiff.height = cRough.height = size;
  const ctxD = cDiff.getContext('2d');
  const ctxR = cRough.getContext('2d');
  const imgD = ctxD.createImageData(size, size);
  const imgR = ctxR.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = Math.sin(x * 0.14) * Math.cos(y * 0.13) * 0.5 + Math.sin((x + y) * 0.37) * 0.3;
      const fine = Math.sin(x * 1.7 + y * 2.1) * Math.cos(x * 2.3 - y * 1.4) * 0.5;
      // Subtle warm flush near fingertips & knuckles
      const knuckleWarm = Math.exp(-Math.pow((v - 0.38) / 0.25, 2)) * 8;
      const idx = (y * size + x) * 4;
      imgD.data[idx] = Math.min(255, Math.max(0, Math.round(212 + knuckleWarm + n1 * 7 + fine * 4)));
      imgD.data[idx + 1] = Math.min(255, Math.max(0, Math.round(164 + n1 * 7 + fine * 4)));
      imgD.data[idx + 2] = Math.min(255, Math.max(0, Math.round(134 + n1 * 6 + fine * 4)));
      imgD.data[idx + 3] = 255;

      const rv = Math.round((0.58 + n1 * 0.05 + fine * 0.04) * 255);
      imgR.data[idx] = imgR.data[idx + 1] = imgR.data[idx + 2] = rv;
      imgR.data[idx + 3] = 255;
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxR.putImageData(imgR, 0, 0);

  const skinMap = new THREE.CanvasTexture(cDiff);
  skinMap.colorSpace = THREE.SRGBColorSpace;
  skinMap.wrapS = skinMap.wrapT = THREE.RepeatWrapping;

  const skinRough = new THREE.CanvasTexture(cRough);
  skinRough.colorSpace = THREE.NoColorSpace;
  skinRough.wrapS = skinRough.wrapT = THREE.RepeatWrapping;

  const skinMat = new THREE.MeshPhysicalMaterial({
    map: skinMap,
    roughnessMap: skinRough,
    roughness: 0.94,
    metalness: 0.0,
    sheen: 0.38,
    sheenRoughness: 0.80,
    sheenColor: new THREE.Color('#eba98d'),
    clearcoat: 0.03,
    clearcoatRoughness: 0.72,
  });

  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.material = skinMat;
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Cozy textured oatmeal knit cotton sleeve cuff extending far off-screen (0.58m -> never cuts off in portrait!)
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#ddd4c6';
  sctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 4) {
    sctx.fillStyle = x % 8 === 0 ? 'rgba(155,140,120,0.22)' : 'rgba(255,250,242,0.18)';
    sctx.fillRect(x, 0, 2, 128);
  }
  for (let y = 0; y < 128; y += 3) {
    sctx.fillStyle = 'rgba(130,118,100,0.08)';
    sctx.fillRect(0, y, 128, 1);
  }
  const sleeveTex = new THREE.CanvasTexture(sc);
  sleeveTex.colorSpace = THREE.SRGBColorSpace;
  sleeveTex.wrapS = sleeveTex.wrapT = THREE.RepeatWrapping;
  sleeveTex.repeat.set(3, 5);

  const sleeveMat = new THREE.MeshStandardMaterial({
    map: sleeveTex,
    color: new THREE.Color('#ffffff'),
    roughness: 0.95,
    metalness: 0.0,
  });
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.056, 0.56, 24),
    sleeveMat
  );
  sleeve.scale.set(1.02, 1.0, 0.76);
  sleeve.rotation.x = Math.PI * 0.5 - 0.08;
  sleeve.position.set(0.032, 0.064, 0.445);
  sleeve.castShadow = true;
  sleeve.receiveShadow = true;
  root.add(sleeve);

  const pivot = new THREE.Group();
  root.scale.setScalar(0.88);
  root.rotation.set(0.14, 0.30, -0.06);
  pivot.add(root);

  let pinchCurrent = 0;
  pivot.userData = {
    root,
    setPinch(amount) {
      pinchCurrent = THREE.MathUtils.clamp(amount, 0, 1);
      root.rotation.x = 0.14 + pinchCurrent * 0.18;
      root.rotation.z = -0.06 - pinchCurrent * 0.10;
      root.scale.set(0.88 - pinchCurrent * 0.04, 0.88, 0.88 - pinchCurrent * 0.02);
    },
  };

  return pivot;
}
