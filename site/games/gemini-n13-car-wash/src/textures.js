import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Loads all bundled CC0 PBR textures & HDRI using strict sRGB vs Linear color spaces.
 */
export async function loadAllTextures(renderer) {
  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new HDRLoader();
  const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  const loadTex = (url, { srgb = false, repeat = [1, 1] } = {}) =>
    new Promise((resolve, reject) => {
      texLoader.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(repeat[0], repeat[1]);
          tex.anisotropy = maxAniso;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        reject
      );
    });

  const loadHDR = (url) =>
    new Promise((resolve, reject) => {
      hdrLoader.load(
        url,
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          resolve(tex);
        },
        undefined,
        reject
      );
    });

  const [
    hdri,
    paversDiff, paversNor, paversArm,
    brickDiff, brickNor, brickArm,
    mudDiff, mudNor, mudArm,
    spongeDiff, spongeNor, spongeRough, spongeAo,
    towelDiff, towelNor, towelRough, towelAo,
    concreteDiff, concreteNor, concreteRough,
    rubberDiff, rubberNor, rubberRough,
  ] = await Promise.all([
    loadHDR('./assets/hdri/tree_lined_driveway_1k.hdr'),

    loadTex('./assets/textures/pavers/diffuse.jpg', { srgb: true, repeat: [6, 6] }),
    loadTex('./assets/textures/pavers/nor_gl.jpg', { srgb: false, repeat: [6, 6] }),
    loadTex('./assets/textures/pavers/arm.jpg', { srgb: false, repeat: [6, 6] }),

    loadTex('./assets/textures/brick/diffuse.jpg', { srgb: true, repeat: [4, 1.8] }),
    loadTex('./assets/textures/brick/nor_gl.jpg', { srgb: false, repeat: [4, 1.8] }),
    loadTex('./assets/textures/brick/arm.jpg', { srgb: false, repeat: [4, 1.8] }),

    loadTex('./assets/textures/mud/diffuse.jpg', { srgb: true, repeat: [1, 1] }),
    loadTex('./assets/textures/mud/nor_gl.jpg', { srgb: false, repeat: [1, 1] }),
    loadTex('./assets/textures/mud/arm.jpg', { srgb: false, repeat: [1, 1] }),

    loadTex('./assets/textures/sponge/Sponge001_1K-JPG_Color.jpg', { srgb: true, repeat: [2, 2] }),
    loadTex('./assets/textures/sponge/Sponge001_1K-JPG_NormalGL.jpg', { srgb: false, repeat: [2, 2] }),
    loadTex('./assets/textures/sponge/Sponge001_1K-JPG_Roughness.jpg', { srgb: false, repeat: [2, 2] }),
    loadTex('./assets/textures/sponge/Sponge001_1K-JPG_AmbientOcclusion.jpg', { srgb: false, repeat: [2, 2] }),

    loadTex('./assets/textures/towel/Fabric030_1K-JPG_Color.jpg', { srgb: true, repeat: [3, 3] }),
    loadTex('./assets/textures/towel/Fabric030_1K-JPG_NormalGL.jpg', { srgb: false, repeat: [3, 3] }),
    loadTex('./assets/textures/towel/Fabric030_1K-JPG_Roughness.jpg', { srgb: false, repeat: [3, 3] }),
    loadTex('./assets/textures/towel/Fabric030_1K-JPG_AmbientOcclusion.jpg', { srgb: false, repeat: [3, 3] }),

    loadTex('./assets/textures/concrete/Concrete034_1K-JPG_Color.jpg', { srgb: true, repeat: [3, 1] }),
    loadTex('./assets/textures/concrete/Concrete034_1K-JPG_NormalGL.jpg', { srgb: false, repeat: [3, 1] }),
    loadTex('./assets/textures/concrete/Concrete034_1K-JPG_Roughness.jpg', { srgb: false, repeat: [3, 1] }),

    loadTex('./assets/textures/rubber/Rubber004_1K-JPG_Color.jpg', { srgb: true, repeat: [2, 2] }),
    loadTex('./assets/textures/rubber/Rubber004_1K-JPG_NormalGL.jpg', { srgb: false, repeat: [2, 2] }),
    loadTex('./assets/textures/rubber/Rubber004_1K-JPG_Roughness.jpg', { srgb: false, repeat: [2, 2] }),
  ]);

  return {
    hdri,
    pavers: { map: paversDiff, normalMap: paversNor, armMap: paversArm },
    brick: { map: brickDiff, normalMap: brickNor, armMap: brickArm },
    mud: { map: mudDiff, normalMap: mudNor, armMap: mudArm },
    sponge: { map: spongeDiff, normalMap: spongeNor, roughnessMap: spongeRough, aoMap: spongeAo },
    towel: { map: towelDiff, normalMap: towelNor, roughnessMap: towelRough, aoMap: towelAo },
    concrete: { map: concreteDiff, normalMap: concreteNor, roughnessMap: concreteRough },
    rubber: { map: rubberDiff, normalMap: rubberNor, roughnessMap: rubberRough },
  };
}
