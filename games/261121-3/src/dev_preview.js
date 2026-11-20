// 見た目確認用の最小プレビュー（製品には入らない）。本番と同じレンダラ設定。
// 使い方: 自分のプレビュー用エントリ（scratchpad に置く）から
//   import { setupPreview } from '<repo>/src/dev_preview.js';
//   const pv = setupPreview({ camPos: [0, 0.5, 0.6], target: [0, 0, 0], ground: true, lights: true });
//   pv.scene.add(obj); pv.onUpdate((dt, t) => {...});
// を呼び、node build.mjs --entry <entry> --out <preview.html> → tools/shot.cjs で撮る。
import * as THREE from 'three';

export function setupPreview({ camPos = [0, 0.5, 0.6], target = [0, 0, 0], fov = 38, ground = true, lights = true, bg = 0x8a8f96 } = {}) {
  let canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.02, 50);
  camera.position.set(...camPos);
  camera.lookAt(new THREE.Vector3(...target));
  if (lights) {
    // 朝の窓明かり風の標準ライト（本番のセットが自前のライトを持つ場合は lights:false）
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    sun.position.set(-0.8, 1.4, -0.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -0.8; c.right = 0.8; c.top = 0.8; c.bottom = -0.8; c.near = 0.1; c.far = 4;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.004; sun.shadow.radius = 4;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0xb59a78, 0.9));
    // 反射用の簡易環境
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x9aa3ad);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    win.position.set(-3, 2, -2); win.lookAt(0, 0, 0); es.add(win);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x8a6f52 }));
    fl.rotation.x = -Math.PI / 2; fl.position.y = -1; es.add(fl);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0xe8e4dc }));
    top.rotation.x = Math.PI / 2; top.position.y = 3; es.add(top);
    scene.environment = pm.fromScene(es, 0.04).texture;
    scene.environmentIntensity = 0.7;
  }
  if (ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.7 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  }
  const ups = [];
  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    for (const f of ups) f(dt, t);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera, onUpdate: (f) => ups.push(f) };
}
