import * as THREE from 'three';
import { loadAllTextures } from './textures.js';
import { buildDrivewayEnvironment } from './environment.js';
import { CarWashSurface } from './carWashSurface.js';
import { loadFamilyCar } from './car.js';
import { WashParticleSystem } from './particles.js';
import { FirstPersonRig } from './toolsAndHand.js';
import { CarWashAudio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const IS_DEMO_SCENE = params.get('demo') === '1';
const PRESET_STATE = params.get('state') || '';
const TONE_MODE = params.get('tone') || 'agx';

// Four authentic real-world automotive metallic finishes cycled on each replay wash
const CAR_COLORS = ['#194466', '#7b1a23', '#2e4d3f', '#6b7580'];

async function init() {
  const container = document.getElementById('app');
  const veil = document.getElementById('veil');

  // 1. WebGL2 Renderer with AgX tone mapping & pixel ratio capped at 1.5
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  let currentPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(currentPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MODE === 'aces' ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#c8d9e6', 0.014);

  // 2. Camera with dedicated Portrait (390x844) & Landscape (1024x768) framing
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 80);
  scene.add(camera);

  const cameraTarget = new THREE.Vector3(-0.15, 0.88, -0.08);
  const cameraBasePos = new THREE.Vector3(-2.68, 1.32, 4.42);
  let fpRig = null;

  function applyCameraLayout() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const aspect = w / h;
    const isPortrait = aspect < 0.85;

    if (isPortrait) {
      camera.fov = 48;
      cameraBasePos.set(-3.12, 1.48, 5.42);
      cameraTarget.set(-0.24, 0.84, -0.05);
    } else {
      camera.fov = 40;
      cameraBasePos.set(-2.68, 1.32, 4.42);
      cameraTarget.set(-0.15, 0.88, -0.08);
    }
    camera.aspect = aspect;
    camera.position.copy(cameraBasePos);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (fpRig) fpRig.updateLayout(isPortrait);
  }

  // 3. Load bundled CC0 textures & Poly Haven HDRI
  const textures = await loadAllTextures(renderer);

  const pmrem = new PMREMGeneratorWrapper(renderer, textures.hdri);
  scene.environment = pmrem.envTexture;
  scene.environmentIntensity = 1.08;
  scene.environmentRotation.y = 0.85;
  scene.background = textures.hdri;
  scene.backgroundRotation.y = 0.85;
  scene.backgroundBlurriness = 0.025;
  scene.backgroundIntensity = 1.0;

  // 4. Single physical key sunlight (1024^2 shadow map per mobile budget)
  const sunLight = new THREE.DirectionalLight('#fff3df', 2.65);
  sunLight.position.set(-5.8, 9.2, 6.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 2.0;
  sunLight.shadow.camera.far = 24.0;
  sunLight.shadow.camera.left = -4.6;
  sunLight.shadow.camera.right = 4.6;
  sunLight.shadow.camera.top = 4.2;
  sunLight.shadow.camera.bottom = -3.2;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.025;
  scene.add(sunLight);

  const hemiFill = new THREE.HemisphereLight('#c4dff5', '#8b7e6d', 0.25);
  scene.add(hemiFill);

  // 5. Build driveway environment, dynamic wash surface, family SUV, particles, first-person rig & audio
  const env = await buildDrivewayEnvironment(scene, textures);
  const washSurface = new CarWashSurface(textures);
  const car = await loadFamilyCar(washSurface, textures);
  scene.add(car.group);

  const particles = new WashParticleSystem(scene);
  fpRig = new FirstPersonRig(scene, camera, textures, env.woodTex);
  const audio = new CarWashAudio();

  applyCameraLayout();
  window.addEventListener('resize', applyCameraLayout);

  // 6. Wash Game State Machine (zero text, world-driven physical cues)
  let washRound = 0;
  let hasFoamedEnough = false;
  let phase = 'playing'; // 'playing' | 'celebrating' | 'driveOut' | 'driveIn'
  let phaseTimer = 0;
  let headlampFlashTimer = 0;
  let lastInteractionTime = 0;
  let lastBucketCueTime = 0;
  let lastMetricsTime = 0;
  let cachedMetrics = washSurface.getMetrics();

  // Optional showcase / QA preset states (normal play always starts freshly muddy!)
  const demoHitPoint = new THREE.Vector3(-0.78, 0.86, 0.94);
  const demoHitNormal = new THREE.Vector3(-0.15, 0.2, 0.96).normalize();
  if (IS_DEMO_SCENE) {
    washSurface.seedShowcaseState();
    particles.seedShowcaseFoam(car.group);
    fpRig.setTool('hose', true);
    fpRig.setSuggestedTool('sponge');
  } else if (PRESET_STATE === 'clean') {
    washSurface.seedSpotlessState();
    fpRig.setTool('towel', true);
    fpRig.setSuggestedTool('towel');
    phase = 'celebrating';
    phaseTimer = 1.0;
  } else {
    washSurface.seedInitialMud(0);
    fpRig.setTool('hose', true);
    fpRig.setSuggestedTool('hose');
  }
  cachedMetrics = washSurface.getMetrics();

  // 7. One-finger unified pointer interaction (safe against accidental multi-touch)
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const prevPointerNdc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundHit = new THREE.Vector3();
  const localHit = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const tipPos = new THREE.Vector3();
  const slotPos = new THREE.Vector3();

  let activePointerId = null;
  let isPointerDown = false;
  let pointerSpeed = 0;
  let currentHitPoint = null;
  let currentHitNormal = null;
  let isHittingCar = false;
  let foamSpawnAccum = 0;

  function setPointerFromEvent(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    prevPointerNdc.copy(pointerNdc);
    pointerNdc.set(nx, ny);
    const dist = pointerNdc.distanceTo(prevPointerNdc);
    pointerSpeed = Math.min(1, pointerSpeed * 0.65 + dist * 16);
  }

  function triggerHeadlampWink(duration = 0.65) {
    headlampFlashTimer = Math.max(headlampFlashTimer, duration);
  }

  function onPointerDown(e) {
    if (IS_DEMO_SCENE) return;
    // Ignore secondary touches while one finger is already active
    if (activePointerId !== null && activePointerId !== e.pointerId) return;
    activePointerId = e.pointerId;
    audio.unlock();
    setPointerFromEvent(e);
    prevPointerNdc.copy(pointerNdc);
    pointerSpeed = 0.45;
    lastInteractionTime = clock.elapsedTime;

    raycaster.setFromCamera(pointerNdc, camera);

    // Priority 1: Check floating iridescent soap bubbles (instant tactile pop delight!)
    const popped = particles.popBubblesNearRay(raycaster.ray);
    if (popped > 0) {
      audio.playBubblePop();
    }

    // Priority 2: Check resting physical tools on the grounded driveway/stool
    const dockHits = raycaster.intersectObjects(fpRig.dockPickMeshes, false);
    if (dockHits.length > 0) {
      const toolId = dockHits[0].object.userData.toolId;
      if (toolId) {
        fpRig.setTool(toolId, false);
        audio.playToolPickup(toolId);
        // Joyful side discovery: tapping the soapy bucket splashes extra rainbow bubbles upward!
        if (toolId === 'sponge') {
          fpRig.getDockSlotWorldPos('sponge', slotPos);
          for (let i = 0; i < 5; i++) {
            particles.spawnBubble(slotPos);
          }
        }
        // If user grabs hose after celebrating, let them replay right away or spray!
        if (phase === 'celebrating' && phaseTimer > 2.0 && toolId === 'hose') {
          startNextWashCycle();
        }
      }
      isPointerDown = false;
      activePointerId = null;
      return;
    }

    // Priority 3: During celebration, tapping the sparkling car winks headlights & chirps!
    if (phase === 'celebrating') {
      const carHits = raycaster.intersectObjects(car.raycastMeshes, false);
      if (carHits.length > 0) {
        triggerHeadlampWink(0.75);
        audio.playSparklingFinish();
        if (phaseTimer > 3.2) {
          startNextWashCycle();
        }
      }
      isPointerDown = false;
      activePointerId = null;
      return;
    }

    if (phase !== 'playing') {
      isPointerDown = false;
      activePointerId = null;
      return;
    }

    isPointerDown = true;
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  function onPointerMove(e) {
    if (IS_DEMO_SCENE) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    setPointerFromEvent(e);
    if (isPointerDown) {
      lastInteractionTime = clock.elapsedTime;
      // Swiping through floating soap bubbles pops them effortlessly!
      raycaster.setFromCamera(pointerNdc, camera);
      if (particles.popBubblesNearRay(raycaster.ray) > 0) {
        audio.playBubblePop();
      }
    }
  }

  function onPointerUp(e) {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    isPointerDown = false;
    activePointerId = null;
    currentHitPoint = null;
    currentHitNormal = null;
    isHittingCar = false;
    particles.stopStream();
  }

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', onPointerDown, { passive: true });
  dom.addEventListener('pointermove', onPointerMove, { passive: true });
  dom.addEventListener('pointerup', onPointerUp, { passive: true });
  dom.addEventListener('pointercancel', onPointerUp, { passive: true });

  function startNextWashCycle() {
    if (phase === 'driveOut' || phase === 'driveIn') return;
    phase = 'driveOut';
    phaseTimer = 0;
    isPointerDown = false;
    particles.stopStream();
  }

  function updateSuggestedTool(elapsed) {
    const m = cachedMetrics;
    if (m.foam > 0.20) hasFoamedEnough = true;

    let nextSuggestion = 'hose';
    if (m.mud > 0.24 && m.wet < 0.34) {
      nextSuggestion = 'hose';
    } else if (!hasFoamedEnough && m.foam < 0.22) {
      nextSuggestion = 'sponge';
    } else if (m.foam >= 0.055 || m.mud >= 0.085) {
      nextSuggestion = 'shower';
    } else if (m.wet > 0.14 || m.polish < 0.22) {
      nextSuggestion = 'towel';
    } else {
      nextSuggestion = 'towel';
    }
    fpRig.setSuggestedTool(nextSuggestion);

    // Subtle physical invitation: when sponge is next (or user idle > 9s), soapy bucket drifts a gentle bubble upward!
    const idleSec = elapsed - lastInteractionTime;
    if (
      nextSuggestion === 'sponge' &&
      fpRig.activeTool !== 'sponge' &&
      elapsed - lastBucketCueTime > (idleSec > 8 ? 1.6 : 3.2)
    ) {
      lastBucketCueTime = elapsed;
      fpRig.getDockSlotWorldPos('sponge', slotPos);
      particles.spawnBubble(slotPos);
    }

    // Check sparkling completion (zero mud, zero foam, wiped dry & gleaming!)
    if (
      phase === 'playing' &&
      m.mud < 0.085 &&
      m.foam < 0.055 &&
      m.wet < 0.19 &&
      m.polish > 0.20
    ) {
      phase = 'celebrating';
      phaseTimer = 0;
      isPointerDown = false;
      particles.stopStream();
      particles.clearAllFoam();
      washSurface.seedSpotlessState();
      triggerHeadlampWink(1.1);
      audio.playSparklingFinish();
      // Gentle celebratory drift of sunlit iridescent bubbles across the yard!
      for (let i = 0; i < 12; i++) {
        particles.spawnBubble(
          new THREE.Vector3(-1.4 + Math.random() * 2.8, 0.7 + Math.random() * 0.9, 1.1 + Math.random() * 0.7)
        );
      }
    }
  }

  // Reveal scene cleanly
  requestAnimationFrame(() => {
    veil.classList.add('done');
  });

  // Telemetry & adaptive FPS guard
  const clock = new THREE.Clock();
  const demoPointer = new THREE.Vector2(-0.16, 0.02);
  let frameCount = 0;
  let fpsAccum = 0;
  let currentFps = 60;
  let lowFpsStreak = 0;

  window.__carWashStats = () => ({
    fps: Math.round(currentFps),
    triangles: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
    carTris: car.totalTris,
    carCalls: car.drawCalls,
    pixelRatio: renderer.getPixelRatio(),
    viewport: [container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight],
    phase,
    activeTool: fpRig.activeTool,
    suggestedTool: fpRig.suggestedTool,
    metrics: cachedMetrics,
  });

  // Expose lightweight QA helper for automated interactive verification only
  window.__carWashSelectTool = (id) => {
    fpRig.setTool(id, false);
  };

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const elapsed = clock.elapsedTime;
    pointerSpeed = Math.max(0, pointerSpeed - dt * 3.0);

    // FPS tracking + adaptive mobile pixelRatio guard (keeps >= 30fps on older iPhones/iPads)
    frameCount++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      currentFps = frameCount / fpsAccum;
      frameCount = 0;
      fpsAccum = 0;
      if (currentFps < 28 && currentPixelRatio > 1.0) {
        lowFpsStreak++;
        if (lowFpsStreak >= 3) {
          currentPixelRatio = Math.max(1.0, +(currentPixelRatio - 0.25).toFixed(2));
          renderer.setPixelRatio(currentPixelRatio);
          lowFpsStreak = 0;
        }
      } else {
        lowFpsStreak = 0;
      }
      document.body.dataset.stats = JSON.stringify(window.__carWashStats());
    }

    // Periodic wash metrics evaluation
    if (!IS_DEMO_SCENE && phase === 'playing' && elapsed - lastMetricsTime > 0.25) {
      lastMetricsTime = elapsed;
      cachedMetrics = washSurface.getMetrics();
      updateSuggestedTool(elapsed);
    }

    // Celebration & seamless drive-out / drive-in replay animation
    let celebSwayX = 0;
    let celebSwayY = 0;
    if (phase === 'celebrating') {
      phaseTimer += dt;
      celebSwayX = Math.sin(phaseTimer * 0.9) * 0.34;
      celebSwayY = Math.sin(phaseTimer * 0.6) * 0.06;
      particles.setSparkleIntensity(0.95, elapsed);
      if (phaseTimer > 7.5 && PRESET_STATE !== 'clean') {
        startNextWashCycle();
      }
    } else if (phase === 'driveOut') {
      phaseTimer += dt;
      const t = Math.min(1, phaseTimer / 1.45);
      const ease = t * t * (3 - 2 * t);
      car.group.position.x = -ease * 7.5;
      particles.setSparkleIntensity(0, elapsed);
      if (t >= 1) {
        washRound++;
        hasFoamedEnough = false;
        car.setCarColor(CAR_COLORS[washRound % CAR_COLORS.length]);
        washSurface.seedInitialMud(washRound);
        particles.clearAllFoam();
        cachedMetrics = washSurface.getMetrics();
        fpRig.setTool('hose', false);
        fpRig.setSuggestedTool('hose');
        car.group.position.x = 7.5;
        phase = 'driveIn';
        phaseTimer = 0;
      }
    } else if (phase === 'driveIn') {
      phaseTimer += dt;
      const t = Math.min(1, phaseTimer / 1.45);
      const ease = 1 - Math.pow(1 - t, 3);
      car.group.position.x = (1 - ease) * 7.5;
      if (t >= 1) {
        car.group.position.x = 0;
        phase = 'playing';
        phaseTimer = 0;
        triggerHeadlampWink(0.5);
      }
    } else {
      const polishSparkle = Math.max(0, (cachedMetrics.polish - 0.08) * 1.4) * (1 - cachedMetrics.mud * 2);
      particles.setSparkleIntensity(IS_DEMO_SCENE ? 0.45 : Math.max(0, Math.min(0.85, polishSparkle)), elapsed);
    }

    // Headlamp double-wink flash decay
    if (headlampFlashTimer > 0) {
      headlampFlashTimer = Math.max(0, headlampFlashTimer - dt);
      const pulse = Math.sin(headlampFlashTimer * 22) > 0 ? 1.0 : 0.0;
      car.setHeadlampFlash(pulse);
    } else {
      car.setHeadlampFlash(0);
    }

    // Subtle organic handheld first-person camera breathing
    camera.position.set(
      cameraBasePos.x + Math.sin(elapsed * 0.7) * 0.012 + celebSwayX,
      cameraBasePos.y + Math.sin(elapsed * 1.15) * 0.008 + celebSwayY,
      cameraBasePos.z
    );
    camera.lookAt(cameraTarget);

    // Sync wet driveway puddle shader & car wash surface runoff
    env.puddleUniforms.uPuddleWetness.value = washSurface.puddleWetness;
    env.puddleUniforms.uTime.value = elapsed;
    washSurface.update(dt, elapsed);

    // Active tool interaction loop
    if (IS_DEMO_SCENE) {
      fpRig.update(dt, elapsed, demoPointer, true, demoHitPoint);
      fpRig.getNozzleWorldTip(tipPos);
      particles.emitHoseJet(tipPos, demoHitPoint, demoHitNormal, 0.28, 12);
    } else if (isPointerDown && phase === 'playing') {
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(car.raycastMeshes, false);
      const tool = fpRig.activeTool;

      if (hits.length > 0) {
        const hit = hits[0];
        isHittingCar = true;
        currentHitPoint = hit.point;
        worldNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
        currentHitNormal = worldNormal;

        // Convert world hit to car-local coordinates for seamless wash mask painting
        localHit.copy(hit.point);
        car.group.worldToLocal(localHit);

        // Delightful side discovery: spraying/touching front headlamps flashes them briefly!
        if (localHit.x < -1.95 && localHit.y > 0.76 && localHit.y < 1.12 && headlampFlashTimer <= 0) {
          triggerHeadlampWink(0.35);
        }

        const radius = tool === 'shower' ? 0.135 : tool === 'towel' ? 0.115 : tool === 'sponge' ? 0.105 : 0.088;
        const delta = washSurface.applyTool(localHit, tool, dt, radius);

        fpRig.update(dt, elapsed, pointerNdc, true, currentHitPoint);
        fpRig.getNozzleWorldTip(tipPos);

        if (tool === 'hose') {
          particles.emitHoseJet(tipPos, currentHitPoint, currentHitNormal, delta.mudRemoved * 3.5, 11);
          particles.rinseFoamNear(currentHitPoint, 0.34);
        } else if (tool === 'shower') {
          particles.emitShowerFan(tipPos, currentHitPoint, currentHitNormal, 15);
          particles.rinseFoamNear(currentHitPoint, 0.54);
        } else if (tool === 'sponge') {
          particles.stopStream();
          foamSpawnAccum += dt * (8 + pointerSpeed * 22);
          if (foamSpawnAccum >= 1) {
            const count = Math.min(3, Math.floor(foamSpawnAccum));
            foamSpawnAccum -= count;
            particles.spawnFoamAt(currentHitPoint, currentHitNormal, count);
          }
        } else if (tool === 'towel') {
          particles.stopStream();
          particles.rinseFoamNear(currentHitPoint, 0.36);
        }
      } else {
        isHittingCar = false;
        currentHitPoint = null;
        fpRig.update(dt, elapsed, pointerNdc, true, null);

        // Spraying hose or shower onto the driveway pavers splashes real water & wets pavers!
        if ((tool === 'hose' || tool === 'shower') && raycaster.ray.intersectPlane(groundPlane, groundHit)) {
          // Clamp reasonable distance along driveway
          if (groundHit.distanceTo(camera.position) < 12) {
            fpRig.getNozzleWorldTip(tipPos);
            worldNormal.set(0, 1, 0);
            if (tool === 'hose') {
              particles.emitHoseJet(tipPos, groundHit, worldNormal, 0, 8);
            } else {
              particles.emitShowerFan(tipPos, groundHit, worldNormal, 10);
            }
            washSurface.puddleWetness = Math.min(1, washSurface.puddleWetness + dt * 0.10);
          }
        } else {
          particles.stopStream();
        }
      }
      audio.updateContinuous(tool, true, isHittingCar, pointerSpeed, elapsed);
    } else {
      particles.stopStream();
      fpRig.update(dt, elapsed, null, false, null);
      audio.updateContinuous(fpRig.activeTool, false, false, 0, elapsed);
    }

    particles.update(dt, elapsed);
    renderer.render(scene, camera);
  }

  animate();
}

/**
 * Helper to generate and cleanly dispose PMREM environment texture from equirectangular HDRI.
 */
class PMREMGeneratorWrapper {
  constructor(renderer, equirectTex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    this.rt = pmrem.fromEquirectangular(equirectTex);
    this.envTexture = this.rt.texture;
    pmrem.dispose();
  }
}

init().catch((err) => {
  console.error('CarWash init failed:', err);
});
