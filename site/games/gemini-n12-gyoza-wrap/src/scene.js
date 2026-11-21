import * as THREE from 'three';
import { HDRLoader } from '../vendor/three/loaders/HDRLoader.js';

export async function createRendererAndScene() {
  const params = new URLSearchParams(window.location.search);
  const tmMode = params.get('tm') || 'agx';
  const hdriName = params.get('hdri') || 'kiara_interior_1k.hdr';

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = tmMode === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = tmMode === 'aces' ? 0.96 : 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#27211b');

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 8.0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const hdrLoader = new HDRLoader();
  const hdrTex = await hdrLoader.loadAsync(`./assets/hdri/${hdriName}`);
  const envRT = pmrem.fromEquirectangular(hdrTex);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.72;
  scene.environmentRotation = new THREE.Euler(0, 0.45, 0);
  hdrTex.dispose();
  pmrem.dispose();

  // Single warm morning/afternoon Japanese kitchen window key light (soft shadows on 1024x1024)
  const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.42);
  keyLight.position.set(-0.56, 1.05, 0.44);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.35;
  keyLight.shadow.camera.far = 2.5;
  keyLight.shadow.camera.left = -0.52;
  keyLight.shadow.camera.right = 0.52;
  keyLight.shadow.camera.top = 0.44;
  keyLight.shadow.camera.bottom = -0.44;
  keyLight.shadow.bias = -0.00045;
  keyLight.shadow.normalBias = 0.007;
  keyLight.shadow.radius = 2.6;
  scene.add(keyLight);

  // Subtle warm kitchen ambient bounce (keeps raw gyoza wheat dough creamy ivory, never cool grey!)
  const hemiLight = new THREE.HemisphereLight(0xfff6e8, 0x564434, 0.30);
  scene.add(hemiLight);

  // Carefully composed Portrait (390x844 iPhone) & Landscape (1024x768 iPad) cameras!
  const cameraPresets = {
    overview: {
      landscape: { pos: [-0.01, 0.50, 0.56], target: [-0.01, 0.025, 0.015], fov: 42 },
      portrait:  { pos: [-0.01, 0.88, 0.76], target: [-0.01, 0.020, 0.015], fov: 48 },
    },
    wrap: {
      landscape: { pos: [-0.08, 0.41, 0.46], target: [-0.10, 0.024, 0.015], fov: 42 },
      portrait:  { pos: [-0.08, 0.66, 0.58], target: [-0.10, 0.022, 0.005], fov: 46 },
    },
    cook: {
      landscape: { pos: [0.09, 0.40, 0.45], target: [0.10, 0.040, -0.01], fov: 41 },
      portrait:  { pos: [0.09, 0.64, 0.57], target: [0.10, 0.038, -0.01], fov: 46 },
    },
    serve: {
      landscape: { pos: [0.055, 0.345, 0.49], target: [0.068, 0.022, 0.195], fov: 40 },
      portrait:  { pos: [0.055, 0.48, 0.54], target: [0.068, 0.020, 0.195], fov: 44 },
    },
  };

  let currentPreset = 'overview';
  const camTargetPos = new THREE.Vector3();
  const camTargetLook = new THREE.Vector3();
  const camCurrentLook = new THREE.Vector3();
  let camTargetFov = 42;

  function applyCameraPreset(presetName, instant = false) {
    currentPreset = presetName;
    const isPortrait = window.innerHeight > window.innerWidth;
    const cfg = cameraPresets[presetName][isPortrait ? 'portrait' : 'landscape'];
    camTargetPos.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    camTargetLook.set(cfg.target[0], cfg.target[1], cfg.target[2]);
    camTargetFov = cfg.fov;
    if (instant) {
      camera.position.copy(camTargetPos);
      camCurrentLook.copy(camTargetLook);
      camera.fov = camTargetFov;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      camera.lookAt(camCurrentLook);
    }
  }

  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(camTargetPos, k);
    camCurrentLook.lerp(camTargetLook, k);
    if (Math.abs(camera.fov - camTargetFov) > 0.02) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, camTargetFov, k);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(camCurrentLook);
  }

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    applyCameraPreset(currentPreset, true);
  });

  applyCameraPreset('overview', true);

  return {
    renderer,
    scene,
    camera,
    keyLight,
    applyCameraPreset,
    updateCamera,
  };
}
