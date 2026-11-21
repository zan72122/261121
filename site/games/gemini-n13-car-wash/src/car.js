import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Loads the CC0 five-door family crossover SUV, merges static sub-meshes by material
 * (~10 draw calls), optimizes shadow casting (saving ~90k shadow tris for mobile 60fps),
 * upgrades materials to physically-calibrated PBR + clearcoat, and binds CarWashSurface.
 */
export async function loadFamilyCar(washSurface, textures) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('./assets/models/car/crossover_suv.glb');
  const rawRoot = gltf.scene;
  rawRoot.updateMatrixWorld(true);

  const buckets = new Map();
  rawRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const matName = (obj.material && obj.material.name) || 'default';
    let geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    for (const key of Object.keys(geom.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        geom.deleteAttribute(key);
      }
    }
    if (!geom.attributes.normal) geom.computeVertexNormals();
    if (!geom.attributes.uv) {
      const count = geom.attributes.position.count;
      geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (geom.index) {
      const nonIdx = geom.toNonIndexed();
      geom.dispose();
      geom = nonIdx;
    }
    if (!buckets.has(matName)) buckets.set(matName, []);
    buckets.get(matName).push(geom);
  });

  // Physically calibrated automotive materials
  const materials = {
    // Rich real-world metallic ocean-slate blue family SUV
    paint: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#194466'),
      metalness: 0.62,
      roughness: 0.20,
      clearcoat: 1.0,
      clearcoatRoughness: 0.045,
      reflectivity: 0.96,
      envMapIntensity: 1.25,
    }),
    'glass.001': new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#101d26'),
      metalness: 0.06,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.025,
      transparent: true,
      opacity: 0.76,
      envMapIntensity: 1.45,
    }),
    clearlens: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e8f1f8'),
      metalness: 0.0,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 1.5,
    }),
    redlens: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8c1216'),
      metalness: 0.1,
      roughness: 0.10,
      clearcoat: 0.95,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.25,
    }),
    chrome: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d2d8de'),
      metalness: 0.95,
      roughness: 0.16,
      clearcoat: 0.35,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.2,
    }),
    // Darker brushed steel brake rotor & calipers (fixes light flat grey inside wheel spokes!)
    'steel.001': new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a5056'),
      metalness: 0.80,
      roughness: 0.34,
      envMapIntensity: 0.85,
    }),
    'rubber.001': new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#1d1f22'),
      map: textures.rubber.map,
      normalMap: textures.rubber.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughnessMap: textures.rubber.roughnessMap,
      metalness: 0.0,
      roughness: 0.90,
      clearcoat: 0.04,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.7,
    }),
    'black.001': new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#181a1d'),
      metalness: 0.04,
      roughness: 0.50,
      clearcoat: 0.12,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.82,
    }),
    interior: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#141618'),
      metalness: 0.0,
      roughness: 0.92,
      envMapIntensity: 0.35,
    }),
    white: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d6dbe0'),
      metalness: 0.1,
      roughness: 0.28,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.0,
    }),
  };

  washSurface.patchMaterial(materials.paint, { mudScale: 1.0 });
  washSurface.patchMaterial(materials['glass.001'], { isGlass: true, mudScale: 0.80 });
  washSurface.patchMaterial(materials.clearlens, { isGlass: true, mudScale: 0.72 });
  washSurface.patchMaterial(materials.redlens, { mudScale: 0.8 });
  washSurface.patchMaterial(materials.chrome, { mudScale: 0.78 });
  washSurface.patchMaterial(materials['black.001'], { mudScale: 1.05 });
  washSurface.patchMaterial(materials['rubber.001'], { isTire: true, mudScale: 1.15 });
  washSurface.patchMaterial(materials.white, { mudScale: 0.85 });

  const carGroup = new THREE.Group();
  carGroup.name = 'FamilySUV';
  const raycastMeshes = [];
  let totalTris = 0;

  // Only primary body shell & black cladding cast shadows into the directional shadow map
  // (tires/rims/lugs already sit on our tight baked ground contact AO shadow — saves ~90k shadow tris!)
  const shadowCasters = new Set(['paint', 'black.001']);

  for (const [matName, geoms] of buckets.entries()) {
    const merged = mergeGeometries(geoms, false);
    geoms.forEach((g) => g.dispose());
    if (!merged) continue;

    const mat = materials[matName] || materials['black.001'];
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `suv_${matName}`;
    mesh.castShadow = shadowCasters.has(matName);
    mesh.receiveShadow = true;
    carGroup.add(mesh);

    totalTris += merged.attributes.position.count / 3;

    if (matName !== 'interior') {
      raycastMeshes.push(mesh);
    }
  }

  carGroup.position.set(0.0, -0.01, 0.0);

  return {
    group: carGroup,
    raycastMeshes,
    paintMaterial: materials.paint,
    headlampMaterial: materials.clearlens,
    setCarColor(hex) {
      materials.paint.color.set(hex);
    },
    setHeadlampFlash(intensity) {
      materials.clearlens.emissive.set('#fff3d4');
      materials.clearlens.emissiveIntensity = intensity * 3.5;
    },
    totalTris: Math.round(totalTris),
    drawCalls: buckets.size,
  };
}
