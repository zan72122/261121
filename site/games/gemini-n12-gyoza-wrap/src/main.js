import { createRendererAndScene } from './scene.js';
import { buildKitchenEnvironment } from './kitchenProps.js';
import { createRealisticHand } from './handMesh.js';
import { SteamSystem } from './steamFX.js';
import { KitchenAudio } from './audio.js';
import { GyozaGame } from './game.js';

async function init() {
  const { renderer, scene, camera, applyCameraPreset, updateCamera } = await createRendererAndScene();
  const [env, hand] = await Promise.all([
    buildKitchenEnvironment(scene),
    createRealisticHand(),
  ]);
  scene.add(hand);

  const steam = new SteamSystem(scene, env.sharedAssets.steamTex);
  const audio = new KitchenAudio();

  const game = new GyozaGame({
    scene,
    camera,
    renderer,
    env,
    hand,
    steam,
    audio,
    applyCameraPreset,
  });

  // Optional showcase URL param for visual QA & thumbnail capture (default = live interactive game!)
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'serve' || view === 'cook' || view === 'overview') {
    game.setupShowcase(view);
  }

  let lastTime = performance.now();
  let frameCount = 0;
  let fpsAccum = 0;
  let currentFps = 60;
  let lowFpsStreak = 0;

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    frameCount++;
    fpsAccum += dt;

    game.update(dt, now * 0.001);
    updateCamera(dt);
    renderer.render(scene, camera);

    if (frameCount === 15 || fpsAccum >= 1.0) {
      if (fpsAccum >= 0.4) {
        currentFps = Math.round(frameCount / fpsAccum);
        // Dynamic mobile pixelRatio adaptation: stay >= 30fps on older iPhone/iPad!
        if (currentFps < 30 && renderer.getPixelRatio() > 1.0) {
          lowFpsStreak++;
          if (lowFpsStreak >= 2) {
            renderer.setPixelRatio(Math.max(1.0, renderer.getPixelRatio() - 0.25));
            lowFpsStreak = 0;
          }
        } else {
          lowFpsStreak = 0;
        }
        frameCount = 0;
        fpsAccum = 0;
      }
      renderer.domElement.dataset.metrics = JSON.stringify({
        state: game.state,
        panCount: game.panGyoza.length,
        triangles: renderer.info.render.triangles,
        calls: renderer.info.render.calls,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        pixelRatio: Number(renderer.getPixelRatio().toFixed(2)),
        fps: currentFps,
      });
    }
  }
  requestAnimationFrame(animate);
}

init().catch((err) => console.error('Init failed:', err));
