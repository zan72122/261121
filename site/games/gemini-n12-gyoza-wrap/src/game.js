import * as THREE from 'three';
import { GyozaUnit } from './gyozaMesh.js';

const RING_RADIUS = 0.0585;
const MAX_BATCH = 5;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export class GyozaGame {
  constructor({ scene, camera, renderer, env, hand, steam, audio, applyCameraPreset }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.env = env;
    this.hand = hand;
    this.steam = steam;
    this.audio = audio;
    this.applyCameraPreset = applyCameraPreset;

    this.state = 'SCOOP'; // SCOOP -> FOLD_PLEAT -> PLACE_ON_PAN -> POUR_WATER -> PUT_LID -> STEAMING -> LIFT_LID -> FLIP_PLATE -> ENJOY
    this.boardCenter = new THREE.Vector3(env.cuttingBoard.position.x, env.boardTopY, env.cuttingBoard.position.z);
    this.activeWrapperPos = new THREE.Vector3(this.boardCenter.x + 0.014, this.boardCenter.y + 0.0005, this.boardCenter.z + 0.010);

    // Cluster group holding the 5 gyoza + lacy hanetsuki wing (so they flip cleanly together 180° onto the plate!)
    this.panCluster = new THREE.Group();
    this.panCluster.position.set(0, env.panSurfaceY + 0.0008, 0);
    env.hotPlateGroup.add(this.panCluster);

    env.hanetsukiWing.position.set(0, 0.0004, 0);
    env.hanetsukiWing.visible = false;
    env.hanetsukiWing.material.opacity = 0;
    this.panCluster.add(env.hanetsukiWing);

    this.panGyoza = [];
    this.activeGyoza = null;
    this.seedCounter = 10;

    // Interactive state & animation timers
    this.pointerDown = false;
    this.activePointerId = null;
    this.dragMode = null; // 'spoon' | 'wrap' | 'gyoza' | 'cup' | 'lid' | 'plate' | 'eat'
    this.dragStartScreen = new THREE.Vector2();
    this.dragWorldPos = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.workPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -env.boardTopY);

    this.pleatSoundStep = 0;
    this.idleTime = 0;
    this.hintPulse = 0;

    // Tween/sequence animations
    this.scoopAnim = null;
    this.flyGyozaAnim = null;
    this.pourAnim = null;
    this.lidAnim = null;
    this.steamProgress = 0;
    this.flipAnim = null;
    this.eatAnim = null;
    this.soyRippleAge = -1;
    this.wobbles = [];

    // Hand target resting pose (tucked subtly at lower-right foreground edge, reaches in smoothly on touch!)
    this.handTarget = new THREE.Vector3(this.boardCenter.x + 0.14, this.boardCenter.y + 0.08, this.boardCenter.z + 0.16);
    this.handPinchTarget = 0.0;
    this.handActive = false;
    this.hand.position.copy(this.handTarget);

    this._bindInput();
    this.spawnNextWrapper(false);
    this.applyCameraPreset('wrap', true);
  }

  _slotPose(index) {
    const angle = (index / MAX_BATCH) * Math.PI * 2 - Math.PI * 0.5 + (index % 2 === 0 ? 0.03 : -0.02);
    return {
      x: Math.cos(angle) * RING_RADIUS,
      z: Math.sin(angle) * RING_RADIUS,
      rotY: -angle + Math.PI * 0.5 + ((index % 3) - 1) * 0.04,
    };
  }

  spawnNextWrapper(animatePeel = true) {
    if (this.activeGyoza) {
      this.scene.remove(this.activeGyoza.group);
    }
    this.seedCounter += 7;
    const g = new GyozaUnit(this.env.sharedAssets, this.seedCounter);
    g.setState({ fold: 0.0, pleat: 0.0, fillScale: 0.0, cook: 0.0, moistRim: 0.0 });
    g.group.position.copy(this.activeWrapperPos);
    g.group.rotation.y = (Math.random() - 0.5) * 0.25;
    this.scene.add(g.group);
    this.activeGyoza = g;
    this.pleatSoundStep = 0;
    this.state = 'SCOOP';

    // Update visible spare wrapper stack count
    const remaining = Math.max(1, 6 - this.panGyoza.length);
    this.env.spareWrapperDisks.forEach((d, idx) => {
      d.visible = idx < remaining;
    });

    if (animatePeel) {
      g.group.position.set(this.env.stackPos.x, this.env.stackPos.y + 0.03, this.env.stackPos.z);
      this.peelAnim = { t: 0, dur: 0.42, start: g.group.position.clone(), end: this.activeWrapperPos.clone() };
    }
  }

  /** Helper: instantly configure a showcase state for automated QA screenshots (e.g. ?view=serve) */
  setupShowcase(viewMode) {
    // Clear active wrapper if serving
    if (viewMode === 'serve' || viewMode === 'cook') {
      if (this.activeGyoza) {
        this.activeGyoza.setState({ fold: 0.12, pleat: 0, fillScale: 1.0, cook: 0 });
      }
      // Populate 5 cooked golden hanetsuki gyoza in panCluster
      for (let i = 0; i < MAX_BATCH; i++) {
        const pose = this._slotPose(i);
        const g = new GyozaUnit(this.env.sharedAssets, 21 + i * 7);
        g.setState({ fold: 1.0, pleat: 1.0, fillScale: 1.0, cook: 1.0 });
        g.group.position.set(pose.x, 0.0008, pose.z);
        g.group.rotation.y = pose.rotY;
        if (viewMode === 'serve') g.contactShadow.visible = false;
        this.panCluster.add(g.group);
        this.panGyoza.push(g);
      }
      this.env.hanetsukiWing.visible = true;
      this.env.hanetsukiWing.material.opacity = 1.0;

      if (viewMode === 'serve') {
        this.scene.add(this.panCluster);
        this.panCluster.position.set(this.env.plateRestPos.x, this.env.plateRestPos.y + 0.0365, this.env.plateRestPos.z);
        this.panCluster.rotation.x = Math.PI;
        // Sit lacy golden crust 1.6mm underneath the flipped seared gyoza bottoms so all gyoza shine cleanly through!
        this.env.hanetsukiWing.position.y = 0.0024;
        this.state = 'ENJOY';
        this.hand.visible = false;
        this.applyCameraPreset('serve', true);
        this.steam.prewarm(new THREE.Vector3(this.env.plateRestPos.x, this.env.plateRestPos.y + 0.042, this.env.plateRestPos.z), 12, {
          spread: 0.068, speedY: 0.065, scale: 0.082, opacity: 0.32, life: 2.1,
        });
      } else {
        this.state = 'POUR_WATER';
        this.applyCameraPreset('cook', true);
        this.steam.prewarm(new THREE.Vector3(this.env.hpPos.x, this.env.panSurfaceY + 0.025, this.env.hpPos.z), 12, {
          spread: 0.072, speedY: 0.075, scale: 0.085, opacity: 0.34, life: 2.1,
        });
      }
    } else if (viewMode === 'overview') {
      // Populate 1 wrapped gyoza on cutting board + open filled wrapper + 5 sizzling on pan
      if (this.activeGyoza) {
        this.activeGyoza.setState({ fold: 0.14, pleat: 0, fillScale: 1.0, cook: 0 });
      }
      for (let i = 0; i < MAX_BATCH; i++) {
        const pose = this._slotPose(i);
        const g = new GyozaUnit(this.env.sharedAssets, 21 + i * 7);
        g.setState({ fold: 1.0, pleat: 1.0, fillScale: 1.0, cook: 0.85 });
        g.group.position.set(pose.x, 0.0008, pose.z);
        g.group.rotation.y = pose.rotY;
        this.panCluster.add(g.group);
        this.panGyoza.push(g);
      }
      this.env.hanetsukiWing.visible = true;
      this.env.hanetsukiWing.material.opacity = 0.85;
      this.applyCameraPreset('overview', true);
      this.steam.prewarm(new THREE.Vector3(this.env.hpPos.x, this.env.panSurfaceY + 0.025, this.env.hpPos.z), 12, {
        spread: 0.072, speedY: 0.072, scale: 0.084, opacity: 0.32, life: 2.1,
      });
    }
  }

  _screenToWorld(clientX, clientY, planeY = this.env.boardTopY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.workPlane.constant = -planeY;
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.workPlane, hit);
    return hit;
  }

  _distXZ(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  _triggerWobble(obj, amp = 0.06) {
    this.wobbles.push({ obj, baseRotZ: obj.rotation.z, t: 0, dur: 0.35, amp });
  }

  _bindInput() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      if (this.activePointerId !== null) return; // multi-touch safe: ignore extra fingers!
      this.activePointerId = e.pointerId;
      this.pointerDown = true;
      this.idleTime = 0;
      this.audio.unlock();
      this.dragStartScreen.set(e.clientX, e.clientY);

      const pt = this._screenToWorld(e.clientX, e.clientY, this.state === 'POUR_WATER' || this.state === 'PUT_LID' || this.state === 'LIFT_LID' ? this.env.panSurfaceY : this.env.boardTopY);
      this.dragWorldPos.copy(pt);
      this._handlePointerDown(pt);
    }, { passive: true });

    dom.addEventListener('pointermove', (e) => {
      if (!this.pointerDown || e.pointerId !== this.activePointerId) return;
      this.idleTime = 0;
      const pt = this._screenToWorld(e.clientX, e.clientY, this.env.boardTopY);
      this.dragWorldPos.copy(pt);
      this._handlePointerMove(pt, e.clientX, e.clientY);
    }, { passive: true });

    const endHandler = (e) => {
      if (e.pointerId !== this.activePointerId) return;
      this.pointerDown = false;
      this.activePointerId = null;
      this._handlePointerUp();
    };
    dom.addEventListener('pointerup', endHandler, { passive: true });
    dom.addEventListener('pointercancel', endHandler, { passive: true });
  }

  _handlePointerDown(pt) {
    const { env } = this;

    // Ambient playful touches (soy saucer ripple, ginger wobble, spare wrapper reset in ENJOY!)
    if (this._distXZ(pt, env.saucerPos) < 0.055 && this.state !== 'ENJOY') {
      this._triggerSoyRipple();
      this.audio.playWaterDrop(1.1);
      return;
    }

    // State-driven forgiving 1-finger interactions!
    if (this.state === 'SCOOP') {
      if (this.scoopAnim) return;
      // Touching filling bowl, spoon, OR the waiting wrapper triggers juicy filling scoop!
      const nearBowl = this._distXZ(pt, env.bowlPos) < 0.11 || this._distXZ(pt, env.woodenSpoon.position) < 0.09;
      const nearWrapper = this._distXZ(pt, this.activeWrapperPos) < 0.08;
      const nearWater = this._distXZ(pt, env.cupRestPos) < 0.055;
      const nearPanEarly = this.panGyoza.length >= 3 && this._distXZ(pt, env.hpPos) < 0.14;

      if (nearWater && this.panGyoza.length >= 3) {
        // Eager child tapped water glass with 3+ gyoza already sizzling -> start steam-frying!
        this._enterCookPhase();
        this._startPourWater();
        return;
      }
      if (nearWater) {
        // Wetting finger & rim with water drop!
        if (this.activeGyoza) this.activeGyoza.setState({ moistRim: 1.0 });
        this.audio.playWaterDrop(1.25);
        this._triggerWobble(env.waterCupGroup, 0.05);
        return;
      }
      if (nearPanEarly) {
        this._enterCookPhase();
        return;
      }
      if (nearBowl || nearWrapper) {
        this.dragMode = 'spoon';
        this._startScoopFilling();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'FOLD_PLEAT') {
      const nearBowl = this._distXZ(pt, env.bowlPos) < 0.09;
      const nearWater = this._distXZ(pt, env.cupRestPos) < 0.055;
      const nearWrapper = this._distXZ(pt, this.activeWrapperPos) < 0.11;

      if (nearBowl && !this.scoopAnim && this.activeGyoza.fold < 0.25 && this.activeGyoza.fillScale < 1.12) {
        // Discovery #1: Extra plump scoop!
        this._startScoopFilling(true);
        return;
      }
      if (nearWater && this.activeGyoza.fold < 0.5) {
        this.activeGyoza.setState({ moistRim: 1.0 });
        this.audio.playWaterDrop(1.2);
        this._triggerWobble(env.waterCupGroup, 0.04);
        return;
      }
      if (nearWrapper) {
        this.dragMode = 'wrap';
        this.handActive = true;
        this.handPinchTarget = 0.75;
        this.handTarget.set(pt.x, this.boardCenter.y + 0.036, pt.z);
        // Forgiving tap-progress: even a single gentle tap advances folding or adds a crisp pleat!
        if (this.activeGyoza.fold < 0.96) {
          const nextFold = Math.min(1, this.activeGyoza.fold + 0.42);
          this.activeGyoza.setState({ fold: nextFold });
          this.audio.playPleat(0);
        } else {
          this._advancePleat(0.24);
        }
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'PLACE_ON_PAN') {
      if (this.flyGyozaAnim) return;
      const nearGyoza = this.activeGyoza && this._distXZ(pt, this.activeGyoza.group.position) < 0.095;
      const nearPan = this._distXZ(pt, env.hpPos) < 0.16;
      if (nearGyoza) {
        this.dragMode = 'gyoza';
        this.handActive = true;
        this.handPinchTarget = 0.85;
      } else if (nearPan) {
        this._launchGyozaToPan();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'POUR_WATER') {
      if (this.pourAnim) return;
      const nearCup = this._distXZ(pt, env.cupRestPos) < 0.085;
      const nearPan = this._distXZ(pt, env.hpPos) < 0.16;
      if (nearCup || nearPan) {
        this._startPourWater();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'PUT_LID') {
      if (this.lidAnim) return;
      const nearLid = this._distXZ(pt, env.lidRestPos) < 0.16;
      const nearPan = this._distXZ(pt, env.hpPos) < 0.16;
      if (nearLid || nearPan) {
        this._startPutLid();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'STEAMING') {
      // Discovery #3: Tapping steamy lid rattles it & shoots an extra puff from the steam vent!
      if (this._distXZ(pt, env.hpPos) < 0.16) {
        this._triggerWobble(env.lidGroup, 0.025);
        this.audio.playLidClack(true);
        const ventPos = new THREE.Vector3(env.hpPos.x + 0.056, env.panSurfaceY + 0.042, env.hpPos.z - 0.040);
        this.steam.emitBurst(ventPos, 8, { spread: 0.018, speedY: 0.12, scale: 0.065, opacity: 0.42, life: 1.6 });
        // Also gently speeds up steaming by a tiny joyful nudge if child keeps tapping excitedly
        this.steamProgress = Math.min(0.99, this.steamProgress + 0.08);
      }
      return;
    }

    if (this.state === 'LIFT_LID') {
      if (this.lidAnim) return;
      if (this._distXZ(pt, env.hpPos) < 0.18) {
        this._startLiftLid();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'FLIP_PLATE') {
      if (this.flipAnim) return;
      const nearPlate = this._distXZ(pt, env.plateRestPos) < 0.13;
      const nearPan = this._distXZ(pt, env.hpPos) < 0.16;
      if (nearPlate || nearPan) {
        this._startFlipPlate();
      } else {
        this._ambientTapFeedback(pt);
      }
      return;
    }

    if (this.state === 'ENJOY') {
      if (this.eatAnim) return;
      // Touch spare wrapper stack or cutting board -> cleanly start a fresh batch!
      const nearBoardOrStack = this._distXZ(pt, env.stackPos) < 0.10 || this._distXZ(pt, this.boardCenter) < 0.11;
      if (nearBoardOrStack) {
        this._resetNewBatch();
        return;
      }
      // Touch soy saucer -> ripple!
      if (this._distXZ(pt, env.saucerPos) < 0.055) {
        this._triggerSoyRipple();
        this.audio.playWaterDrop(1.0);
        return;
      }
      // Touching the served hanetsuki plate!
      if (this._distXZ(pt, env.plateRestPos) < 0.125) {
        // Find closest uneaten gyoza on the plate
        let best = null, bestD = 99;
        for (const g of this.panGyoza) {
          if (!g.group.visible) continue;
          const wp = new THREE.Vector3();
          g.group.getWorldPosition(wp);
          const d = this._distXZ(pt, wp);
          if (d < bestD) { bestD = d; best = g; }
        }
        // Always crunch crispy golden hanetsuki wing crumbs!
        this.audio.playCrispyCrunch();
        this._spawnCrumbs(new THREE.Vector3(pt.x, env.plateRestPos.y + 0.032, pt.z));

        // If tapped directly near a gyoza -> dip into soy sauce & enjoy a bite!
        if (best && bestD < 0.052) {
          this._startDipAndEat(best);
        } else {
          // Cracking center lacy wing cracks it slightly & shakes plate joyfully
          this._triggerWobble(env.plateGroup, 0.015);
          // Fade wing gently once all gyoza are eaten
          const anyLeft = this.panGyoza.some((x) => x.group.visible);
          if (!anyLeft) {
            env.hanetsukiWing.visible = false;
            setTimeout(() => this._resetNewBatch(), 650);
          }
        }
      }
    }
  }

  _handlePointerMove(pt, clientX, clientY) {
    if (this.dragMode === 'wrap' && this.state === 'FOLD_PLEAT' && this.activeGyoza) {
      this.handTarget.set(pt.x, this.boardCenter.y + 0.032, pt.z);
      const dy = this.dragStartScreen.y - clientY; // dragging UP folds the wrapper!
      const dx = Math.abs(clientX - this.dragStartScreen.x);

      if (this.activeGyoza.fold < 1.0) {
        // Smooth upward drag OR sweeping movement folds the wrapper in half!
        const foldDelta = Math.max(0, dy / 95) + dx / 220;
        const targetFold = Math.min(1.0, Math.max(this.activeGyoza.fold, foldDelta));
        if (targetFold > this.activeGyoza.fold + 0.01) {
          this.activeGyoza.setState({ fold: targetFold });
        }
      } else {
        // Once folded, stroking along the rim pinches pleats one-by-one!
        const distMove = Math.hypot(clientX - this.dragStartScreen.x, clientY - this.dragStartScreen.y);
        if (distMove > 14) {
          this._advancePleat(0.055);
          this.dragStartScreen.set(clientX, clientY);
        }
      }
    } else if (this.dragMode === 'gyoza' && this.state === 'PLACE_ON_PAN' && this.activeGyoza) {
      // Smoothly lift & drag wrapped gyoza directly under finger toward the hot plate!
      this.activeGyoza.group.position.lerp(
        new THREE.Vector3(
          THREE.MathUtils.clamp(pt.x, -0.26, 0.24),
          this.boardCenter.y + 0.048,
          THREE.MathUtils.clamp(pt.z, -0.14, 0.18)
        ),
        0.35
      );
      this.handTarget.set(this.activeGyoza.group.position.x + 0.01, this.activeGyoza.group.position.y + 0.025, this.activeGyoza.group.position.z + 0.01);
      // Generous magnetic snap once dragged near hot plate!
      if (this._distXZ(this.activeGyoza.group.position, this.env.hpPos) < 0.145) {
        this.dragMode = null;
        this.handActive = false;
        this._launchGyozaToPan();
      }
    }
  }

  _handlePointerUp() {
    if (this.dragMode === 'gyoza' && this.state === 'PLACE_ON_PAN' && this.activeGyoza) {
      // Forgiving tap-or-short-drag: releasing after tapping the finished gyoza sends it neatly to the hot plate!
      this._launchGyozaToPan();
    }
    this.dragMode = null;
    this.handActive = false;
    this.handPinchTarget = 0.0;
  }

  _advancePleat(amount) {
    if (!this.activeGyoza) return;
    const next = Math.min(1.0, this.activeGyoza.pleat + amount);
    this.activeGyoza.setState({ pleat: next });
    const step = Math.floor(next * 6);
    if (step > this.pleatSoundStep) {
      this.pleatSoundStep = step;
      this.audio.playPleat(step);
    }
    if (next >= 0.99) {
      this.state = 'PLACE_ON_PAN';
      this.dragMode = null;
      this.handActive = false;
      this.audio.playPleat(6);
      // Gentle bounce settle on cutting board
      this._triggerWobble(this.activeGyoza.group, 0.07);
    }
  }

  _startScoopFilling(isExtra = false) {
    this.audio.playPlop(isExtra ? 1.25 : 1.0);
    this.env.spoonScoop.visible = true;
    this.scoopAnim = {
      t: 0,
      dur: 0.68,
      isExtra,
      p0: this.env.spoonRestPos.clone(),
      pDip: new THREE.Vector3(this.env.bowlPos.x + 0.01, this.env.bowlPos.y + 0.055, this.env.bowlPos.z + 0.01),
      pDrop: new THREE.Vector3(this.activeWrapperPos.x + 0.025, this.activeWrapperPos.y + 0.045, this.activeWrapperPos.z + 0.01),
      dropped: false,
    };
  }

  _launchGyozaToPan() {
    if (!this.activeGyoza || this.flyGyozaAnim) return;
    const g = this.activeGyoza;
    this.activeGyoza = null;
    const slotIdx = this.panGyoza.length;
    const pose = this._slotPose(slotIdx);

    // Compute target world position on the hot plate
    const localTarget = new THREE.Vector3(pose.x, this.env.panSurfaceY + 0.0016, pose.z);
    const worldTarget = localTarget.clone().applyMatrix4(this.env.hotPlateGroup.matrixWorld);

    this.flyGyozaAnim = {
      gyoza: g,
      slotIdx,
      pose,
      t: 0,
      dur: 0.44,
      startPos: g.group.position.clone(),
      endPos: worldTarget,
      startRotY: g.group.rotation.y,
      endRotY: pose.rotY + this.env.hotPlateGroup.rotation.y,
    };
  }

  _enterCookPhase() {
    if (this.activeGyoza) {
      this.scene.remove(this.activeGyoza.group);
      this.activeGyoza = null;
    }
    this.state = 'POUR_WATER';
    this.applyCameraPreset('cook', false);
    this.audio.setSizzle(0.32, 5200);
  }

  _startPourWater() {
    if (this.pourAnim) return;
    this.audio.playCeramicClink(1.15);
    this.pourAnim = {
      t: 0,
      dur: 1.55,
      sizzleFired: false,
      startPos: this.env.cupRestPos.clone(),
      pourPos: new THREE.Vector3(this.env.hpPos.x - 0.04, this.env.panSurfaceY + 0.115, this.env.hpPos.z - 0.02),
    };
  }

  _startPutLid() {
    if (this.lidAnim) return;
    this.lidAnim = {
      type: 'put',
      t: 0,
      dur: 0.52,
      startPos: this.env.lidGroup.position.clone(),
      endPos: new THREE.Vector3(this.env.hpPos.x, this.env.panSurfaceY + 0.004, this.env.hpPos.z),
      startRot: this.env.lidGroup.rotation.clone(),
      endRot: new THREE.Euler(0, this.env.hotPlateGroup.rotation.y, 0),
    };
  }

  _startLiftLid() {
    if (this.lidAnim) return;
    this.audio.playLidClack(true);
    this.audio.setSizzle(0.52, 6400); // crisp open frying crackle!
    // Dramatic steam cloud release!
    this.steam.emitBurst(new THREE.Vector3(this.env.hpPos.x, this.env.panSurfaceY + 0.035, this.env.hpPos.z), 18, {
      spread: 0.085, speedY: 0.11, scale: 0.098, opacity: 0.44, life: 2.3,
    });
    this.lidAnim = {
      type: 'lift',
      t: 0,
      dur: 0.56,
      startPos: this.env.lidGroup.position.clone(),
      endPos: this.env.lidRestPos.clone(),
      startRot: this.env.lidGroup.rotation.clone(),
      endRot: this.env.lidRestRot.clone(),
    };
  }

  _startFlipPlate() {
    if (this.flipAnim) return;
    this.audio.playCeramicClink(0.92);
    this.audio.setSizzle(0.08, 3000);
    // Reparent panCluster to scene at its current world transform for smooth 180° flip!
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    this.panCluster.getWorldPosition(worldPos);
    this.panCluster.getWorldQuaternion(worldQuat);
    this.scene.add(this.panCluster);
    this.panCluster.position.copy(worldPos);
    this.panCluster.quaternion.copy(worldQuat);

    this.panGyoza.forEach((g) => { g.contactShadow.visible = false; });

    this.flipAnim = {
      t: 0,
      dur: 1.45,
      stageChime: false,
      plateStart: this.env.plateRestPos.clone(),
      panCenter: worldPos.clone(),
      serveCenter: new THREE.Vector3(this.env.plateRestPos.x, this.env.plateRestPos.y + 0.0365, this.env.plateRestPos.z),
    };
  }

  _startDipAndEat(gyoza) {
    const startWorld = new THREE.Vector3();
    gyoza.group.getWorldPosition(startWorld);
    this.scene.add(gyoza.group);
    gyoza.group.position.copy(startWorld);
    gyoza.group.rotation.set(Math.PI, gyoza.group.rotation.y, 0);

    this.eatAnim = {
      gyoza,
      t: 0,
      dur: 1.05,
      dipped: false,
      bitten: false,
      startPos: startWorld.clone(),
      dipPos: new THREE.Vector3(this.env.saucerPos.x, this.env.saucerPos.y + 0.024, this.env.saucerPos.z),
      eatPos: new THREE.Vector3(this.env.saucerPos.x - 0.01, this.env.saucerPos.y + 0.16, this.env.saucerPos.z + 0.16),
    };
  }

  _triggerSoyRipple() {
    this.soyRippleAge = 0;
  }

  _spawnCrumbs(origin) {
    let spawned = 0;
    for (const c of this.env.crumbs) {
      if (c.life > 0 || spawned >= 6) continue;
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.04 + Math.random() * 0.07;
      c.mesh.position.copy(origin);
      c.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.vx = Math.cos(ang) * spd;
      c.vy = 0.07 + Math.random() * 0.07;
      c.vz = Math.sin(ang) * spd;
      c.life = 0.001;
      c.maxLife = 0.55 + Math.random() * 0.25;
      c.mesh.visible = true;
      spawned++;
    }
  }

  _ambientTapFeedback(pt) {
    const { env } = this;
    if (this._distXZ(pt, env.bowlPos) < 0.09) {
      this._triggerWobble(env.fillingBowl, 0.03);
      this.audio.playPlop(0.8);
    } else if (this._distXZ(pt, env.plateRestPos) < 0.11) {
      this._triggerWobble(env.plateGroup, 0.02);
      this.audio.playCeramicClink(0.95);
    } else if (this._distXZ(pt, env.cupRestPos) < 0.06) {
      this._triggerWobble(env.waterCupGroup, 0.04);
      this.audio.playWaterDrop(1.1);
    }
  }

  _resetNewBatch() {
    // Cleanly remove previous gyoza and re-attach panCluster to hotPlateGroup!
    for (const g of this.panGyoza) {
      if (g.group.parent) g.group.parent.remove(g.group);
    }
    this.panGyoza = [];

    this.env.hotPlateGroup.add(this.panCluster);
    this.panCluster.position.set(0, this.env.panSurfaceY + 0.0008, 0);
    this.panCluster.rotation.set(0, 0, 0);

    this.env.hanetsukiWing.visible = false;
    this.env.hanetsukiWing.material.opacity = 0;
    this.env.hanetsukiWing.position.set(0, 0.0004, 0);
    this.env.starchPuddle.material.opacity = 0;
    this.env.lidFogMat.opacity = 0;
    this.env.cupLiquid.scale.y = 1.0;
    this.env.cupLiquid.position.y = 0.0275;
    this.env.cupLiquid.visible = true;
    this.env.plateGroup.position.copy(this.env.plateRestPos);
    this.env.plateGroup.rotation.set(0, 0, 0);

    this.audio.setSizzle(0, 4000);
    this.steamProgress = 0;
    this.hand.visible = true;
    this.spawnNextWrapper(true);
    this.applyCameraPreset('wrap', false);
  }

  update(dt, nowSec) {
    const { env } = this;
    this.idleTime += dt;

    // 1. Peel fresh wrapper animation
    if (this.peelAnim && this.activeGyoza) {
      this.peelAnim.t += dt / this.peelAnim.dur;
      const e = easeOutCubic(Math.min(1, this.peelAnim.t));
      this.activeGyoza.group.position.lerpVectors(this.peelAnim.start, this.peelAnim.end, e);
      this.activeGyoza.group.position.y += Math.sin(e * Math.PI) * 0.045;
      if (this.peelAnim.t >= 1) this.peelAnim = null;
    }

    // 2. Wooden spoon scooping juicy filling animation
    if (this.scoopAnim) {
      this.scoopAnim.t += dt / this.scoopAnim.dur;
      const t = Math.min(1, this.scoopAnim.t);
      if (t < 0.35) {
        const u = easeInOutCubic(t / 0.35);
        env.woodenSpoon.position.lerpVectors(this.scoopAnim.p0, this.scoopAnim.pDip, u);
        env.woodenSpoon.rotation.z = THREE.MathUtils.lerp(0.22, -0.35, u);
      } else if (t < 0.72) {
        const u = easeInOutCubic((t - 0.35) / 0.37);
        env.woodenSpoon.position.lerpVectors(this.scoopAnim.pDip, this.scoopAnim.pDrop, u);
        env.woodenSpoon.position.y += Math.sin(u * Math.PI) * 0.045;
        env.woodenSpoon.rotation.z = THREE.MathUtils.lerp(-0.35, 0.45, u);
      } else {
        if (!this.scoopAnim.dropped) {
          this.scoopAnim.dropped = true;
          env.spoonScoop.visible = false;
          this.audio.playPlop(0.85);
          if (this.activeGyoza) {
            this.activeGyoza.setState({
              fillScale: this.scoopAnim.isExtra ? 1.14 : 1.0,
              fold: Math.max(this.activeGyoza.fold, 0.08),
            });
            this.state = 'FOLD_PLEAT';
          }
        }
        const u = easeInOutCubic((t - 0.72) / 0.28);
        env.woodenSpoon.position.lerpVectors(this.scoopAnim.pDrop, this.scoopAnim.p0, u);
        env.woodenSpoon.rotation.z = THREE.MathUtils.lerp(0.45, env.spoonRestRot.z, u);
      }
      if (t >= 1) {
        env.woodenSpoon.position.copy(env.spoonRestPos);
        env.woodenSpoon.rotation.copy(env.spoonRestRot);
        this.scoopAnim = null;
      }
    }

    // 3. Wrapped gyoza gliding onto the sizzling hot plate!
    if (this.flyGyozaAnim) {
      const a = this.flyGyozaAnim;
      a.t += dt / a.dur;
      const e = easeInOutCubic(Math.min(1, a.t));
      a.gyoza.group.position.lerpVectors(a.startPos, a.endPos, e);
      a.gyoza.group.position.y += Math.sin(e * Math.PI) * 0.075;
      a.gyoza.group.rotation.y = THREE.MathUtils.lerp(a.startRotY, a.endRotY, e);

      if (a.t >= 1) {
        // Attach cleanly inside panCluster!
        this.panCluster.add(a.gyoza.group);
        a.gyoza.group.position.set(a.pose.x, 0.0008, a.pose.z);
        a.gyoza.group.rotation.set(0, a.pose.rotY, 0);
        this.panGyoza.push(a.gyoza);
        this.flyGyozaAnim = null;

        // Instant gratifying oil sizzle (じゅっ!) + tiny popping oil bubbles!
        this.audio.playSizzleBurst(0.48, 0.55);
        this.audio.setSizzle(0.14 + this.panGyoza.length * 0.04, 5200);
        const landWorld = new THREE.Vector3();
        a.gyoza.group.getWorldPosition(landWorld);
        this.steam.emitBurst(landWorld, 5, { spread: 0.03, speedY: 0.05, scale: 0.05, opacity: 0.24, life: 1.4 });

        if (this.panGyoza.length >= MAX_BATCH) {
          this._enterCookPhase();
        } else {
          this.spawnNextWrapper(true);
        }
      }
    }

    // 4. Pouring milky flour-water onto sizzling hot plate -> BIG ジュワァァーッ!
    if (this.pourAnim) {
      const a = this.pourAnim;
      a.t += dt / a.dur;
      const t = Math.min(1, a.t);
      if (t < 0.25) {
        const u = easeOutCubic(t / 0.25);
        env.waterCupGroup.position.lerpVectors(a.startPos, a.pourPos, u);
        env.waterCupGroup.position.y += Math.sin(u * Math.PI) * 0.03;
        env.waterCupGroup.rotation.z = THREE.MathUtils.lerp(0, -1.12, u);
      } else if (t < 0.78) {
        const u = (t - 0.25) / 0.53;
        env.waterCupGroup.position.set(
          a.pourPos.x + Math.sin(u * Math.PI * 2) * 0.025,
          a.pourPos.y,
          a.pourPos.z + Math.cos(u * Math.PI * 2) * 0.018
        );
        env.waterCupGroup.rotation.z = -1.18 - u * 0.18;

        // Liquid stream pouring from glass lip to griddle!
        env.pourStream.visible = true;
        env.pourStream.position.set(env.waterCupGroup.position.x + 0.042, env.panSurfaceY + 0.056, env.waterCupGroup.position.z);

        // Drain cup liquid smoothly & spread frothy white starch puddle across pan!
        const rem = Math.max(0.08, 1 - u * 0.92);
        env.cupLiquid.scale.y = rem;
        env.cupLiquid.position.y = 0.007 + 0.020 * rem;
        env.starchPuddle.material.opacity = Math.min(0.82, u * 1.15);
        env.starchPuddle.scale.setScalar(0.35 + u * 0.72);

        if (!a.sizzleFired) {
          a.sizzleFired = true;
          this.audio.playSizzleBurst(1.0, 1.45);
          this.audio.setSizzle(0.88, 6600);
        }
        // Thick dramatic burst of steam on pour!
        if (Math.random() < 0.55) {
          this.steam.emitPuff(new THREE.Vector3(env.hpPos.x, env.panSurfaceY + 0.016, env.hpPos.z), {
            spread: 0.075, speedY: 0.095, scale: 0.088, opacity: 0.36, life: 1.9,
          });
        }
      } else {
        env.pourStream.visible = false;
        env.cupLiquid.visible = false;
        const u = easeInOutCubic((t - 0.78) / 0.22);
        env.waterCupGroup.position.lerpVectors(a.pourPos, a.startPos, u);
        env.waterCupGroup.rotation.z = THREE.MathUtils.lerp(-1.32, 0, u);
      }
      if (t >= 1) {
        env.waterCupGroup.position.copy(env.cupRestPos);
        env.waterCupGroup.rotation.set(0, 0, 0);
        env.pourStream.visible = false;
        this.pourAnim = null;
        this.state = 'PUT_LID';
      }
    }

    // 5. Tempered-glass lid placing / lifting
    if (this.lidAnim) {
      const a = this.lidAnim;
      a.t += dt / a.dur;
      const e = easeInOutCubic(Math.min(1, a.t));
      env.lidGroup.position.lerpVectors(a.startPos, a.endPos, e);
      env.lidGroup.position.y += Math.sin(e * Math.PI) * 0.075;
      env.lidGroup.rotation.x = THREE.MathUtils.lerp(a.startRot.x, a.endRot.x, e);
      env.lidGroup.rotation.y = THREE.MathUtils.lerp(a.startRot.y, a.endRot.y, e);
      env.lidGroup.rotation.z = THREE.MathUtils.lerp(a.startRot.z, a.endRot.z, e);

      if (a.t >= 1) {
        env.lidGroup.position.copy(a.endPos);
        env.lidGroup.rotation.copy(a.endRot);
        if (a.type === 'put') {
          this.audio.playLidClack(false);
          this.audio.setSizzle(0.68, 1250); // cozy muffled steaming sound under lid!
          this.state = 'STEAMING';
          this.steamProgress = 0;
        } else {
          this.state = 'FLIP_PLATE';
          env.lidFogMat.opacity = 0.08;
        }
        this.lidAnim = null;
      }
    }

    // 6. Steaming transformation under the fogging glass lid!
    if (this.state === 'STEAMING') {
      this.steamProgress = Math.min(1, this.steamProgress + dt / 4.2);
      const p = this.steamProgress;

      // Condensation fog blooms across glass underside, then clears slightly as water evaporates
      env.lidFogMat.opacity = Math.sin(Math.min(1, p * 1.15) * Math.PI * 0.65) * 0.54;

      // Milky starch puddle evaporates down into golden crispy lacy hanetsuki wings!
      env.starchPuddle.material.opacity = Math.max(0, 0.82 * (1 - p * 1.12));
      env.hanetsukiWing.visible = p > 0.25;
      env.hanetsukiWing.material.opacity = THREE.MathUtils.clamp((p - 0.25) / 0.65, 0, 1);

      // Gyoza gradually steam translucent & develop rich golden-brown Maillard bottoms!
      for (const g of this.panGyoza) {
        g.setState({ cook: p });
      }

      // Audio slowly brightens as liquid boils off into crispy frying
      this.audio.setSizzle(0.62 - p * 0.14, 1200 + p * 1400);

      // Focused jet of steam shooting out of the stainless lid vent hole!
      const ventPos = new THREE.Vector3(env.hpPos.x + 0.056, env.panSurfaceY + 0.038, env.hpPos.z - 0.040);
      this.steam.update(dt, ventPos, 8.5, 16, {
        spread: 0.012, speedY: 0.11, scale: 0.068, opacity: 0.36, life: 1.7,
      });

      if (p >= 1) {
        this.state = 'LIFT_LID';
        this.audio.setSizzle(0.50, 2900);
        this._triggerWobble(env.lidGroup, 0.02);
      }
    } else {
      // Ongoing ambient steam & sizzle bubbles depending on phase
      let sOrigin = null;
      let sRate = 0, bRate = 0;
      if (this.state === 'POUR_WATER' || this.state === 'PUT_LID' || this.state === 'LIFT_LID' || this.state === 'FLIP_PLATE') {
        sOrigin = new THREE.Vector3(env.hpPos.x, env.panSurfaceY + 0.022, env.hpPos.z);
        sRate = this.state === 'PUT_LID' ? 9.0 : (this.state === 'LIFT_LID' ? 5.5 : 4.5);
        bRate = this.state === 'PUT_LID' ? 24 : 12;
      } else if (this.panGyoza.length > 0 && (this.state === 'SCOOP' || this.state === 'FOLD_PLEAT' || this.state === 'PLACE_ON_PAN')) {
        sOrigin = new THREE.Vector3(env.hpPos.x, env.panSurfaceY + 0.018, env.hpPos.z);
        sRate = 1.8 + this.panGyoza.length * 0.4;
        bRate = 6 + this.panGyoza.length * 2;
      } else if (this.state === 'ENJOY') {
        sOrigin = new THREE.Vector3(env.plateRestPos.x, env.plateRestPos.y + 0.042, env.plateRestPos.z);
        sRate = 4.2;
        bRate = 0;
      }
      this.steam.update(dt, sOrigin, sRate, bRate, {
        spread: 0.066, speedY: 0.068, scale: 0.082, opacity: 0.30, life: 2.1,
      });
    }

    // 7. 180° Hanetsuki Flip onto Dark Kuro-Mino Stoneware Plate!
    if (this.flipAnim) {
      const a = this.flipAnim;
      a.t += dt / a.dur;
      const t = Math.min(1, a.t);
      if (t < 0.34) {
        // Plate lifts and arcs upside-down cleanly over the sizzling gyoza ring!
        const u = easeInOutCubic(t / 0.34);
        env.plateGroup.position.lerpVectors(a.plateStart, new THREE.Vector3(a.panCenter.x, a.panCenter.y + 0.038, a.panCenter.z), u);
        env.plateGroup.position.y += Math.sin(u * Math.PI) * 0.09;
        env.plateGroup.rotation.x = THREE.MathUtils.lerp(0, Math.PI, u);
      } else {
        // Together, plate + hanetsuki gyoza ring lift, flip 180° upright, and settle into serving position!
        const u = easeInOutCubic((t - 0.34) / 0.66);
        const arcY = Math.sin(u * Math.PI) * 0.12;
        env.plateGroup.position.lerpVectors(
          new THREE.Vector3(a.panCenter.x, a.panCenter.y + 0.038, a.panCenter.z),
          env.plateRestPos,
          u
        );
        env.plateGroup.position.y += arcY;
        env.plateGroup.rotation.x = THREE.MathUtils.lerp(Math.PI, Math.PI * 2, u);

        // Hanetsuki gyoza cluster flips 180° upside-down with crispy golden bottoms & lacy wings facing UP!
        this.panCluster.position.lerpVectors(a.panCenter, a.serveCenter, u);
        this.panCluster.position.y += arcY;
        this.panCluster.rotation.x = THREE.MathUtils.lerp(0, Math.PI, u);
        env.hanetsukiWing.position.y = THREE.MathUtils.lerp(0.0004, 0.0024, u);

        if (u > 0.65 && !a.stageChime) {
          a.stageChime = true;
          this.audio.playRevealChord();
          this.applyCameraPreset('serve', false);
        }
      }
      if (t >= 1) {
        env.plateGroup.position.copy(env.plateRestPos);
        env.plateGroup.rotation.set(0, 0, 0);
        this.panCluster.position.copy(a.serveCenter);
        this.panCluster.rotation.set(Math.PI, 0, 0);
        this.audio.setSizzle(0, 4000);
        this.steam.emitBurst(a.serveCenter, 10, { spread: 0.07, speedY: 0.075, scale: 0.085, opacity: 0.34, life: 2.2 });
        this.flipAnim = null;
        this.state = 'ENJOY';
      }
    }

    // 8. Dipping golden gyoza into soy-rayu saucer & taking a crispy bite!
    if (this.eatAnim) {
      const a = this.eatAnim;
      a.t += dt / a.dur;
      const t = Math.min(1, a.t);
      if (t < 0.45) {
        const u = easeInOutCubic(t / 0.45);
        a.gyoza.group.position.lerpVectors(a.startPos, a.dipPos, u);
        a.gyoza.group.position.y += Math.sin(u * Math.PI) * 0.065;
        a.gyoza.group.rotation.z = Math.sin(u * Math.PI) * 0.35;
      } else {
        if (!a.dipped) {
          a.dipped = true;
          this._triggerSoyRipple();
          this.audio.playWaterDrop(0.95);
        }
        const u = easeInOutCubic((t - 0.45) / 0.55);
        a.gyoza.group.position.lerpVectors(a.dipPos, a.eatPos, u);
        if (u > 0.68 && !a.bitten) {
          a.bitten = true;
          this.audio.playCrispyCrunch();
          this._spawnCrumbs(a.gyoza.group.position.clone());
        }
        if (u > 0.72) {
          const shrink = Math.max(0.001, 1 - (u - 0.72) / 0.28);
          a.gyoza.group.scale.setScalar(shrink);
        }
      }
      if (t >= 1) {
        a.gyoza.group.visible = false;
        this.eatAnim = null;
      }
    }

    // 9. Soy sauce concentric ripple ring
    if (this.soyRippleAge >= 0) {
      this.soyRippleAge += dt;
      const u = this.soyRippleAge / 0.65;
      if (u >= 1) {
        this.soyRippleAge = -1;
        env.soyRipple.material.opacity = 0;
      } else {
        env.soyRipple.scale.setScalar(0.6 + u * 2.4);
        env.soyRipple.material.opacity = (1 - u) * 0.55;
      }
    }

    // 10. Crispy golden hanetsuki crumbs physics
    for (const c of env.crumbs) {
      if (c.life <= 0) continue;
      c.life += dt;
      if (c.life >= c.maxLife) {
        c.life = 0;
        c.mesh.visible = false;
        continue;
      }
      c.vy -= 1.6 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y = Math.max(0.012, c.mesh.position.y + c.vy * dt);
      c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += 5 * dt;
      c.mesh.rotation.y += 4 * dt;
    }

    // 11. Subtle natural spring wobbles on touched props
    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const w = this.wobbles[i];
      w.t += dt / w.dur;
      if (w.t >= 1) {
        w.obj.rotation.z = w.baseRotZ;
        this.wobbles.splice(i, 1);
      } else {
        w.obj.rotation.z = w.baseRotZ + Math.sin(w.t * Math.PI * 3) * w.amp * (1 - w.t);
      }
    }

    // 12. Subtle real-world idle invitation ONLY after 10s of inactivity (ZERO arrows/glows!)
    if (this.idleTime > 10.0) {
      this.idleTime = 4.0; // gentle repeat every ~6s if still waiting
      if (this.state === 'SCOOP') this._triggerWobble(env.woodenSpoon, 0.08);
      else if (this.state === 'FOLD_PLEAT' && this.activeGyoza) this._triggerWobble(this.activeGyoza.group, 0.05);
      else if (this.state === 'PLACE_ON_PAN' && this.activeGyoza) this._triggerWobble(this.activeGyoza.group, 0.07);
      else if (this.state === 'POUR_WATER') this._triggerWobble(env.waterCupGroup, 0.06);
      else if (this.state === 'PUT_LID' || this.state === 'LIFT_LID') this._triggerWobble(env.lidGroup, 0.04);
      else if (this.state === 'FLIP_PLATE') this._triggerWobble(env.plateGroup, 0.03);
    }

    // 13. Smooth first-person hand presence (reaches naturally from bottom-right when active, tucks quietly at edge otherwise!)
    if (this.state === 'ENJOY' || this.state === 'STEAMING' || this.flipAnim) {
      this.handTarget.set(0.32, 0.08, 0.42);
    } else if (!this.handActive) {
      // Resting gently near lower-right edge of active workspace
      const anchorX = (this.state === 'POUR_WATER' || this.state === 'PUT_LID' || this.state === 'LIFT_LID' || this.state === 'FLIP_PLATE')
        ? env.hpPos.x + 0.14
        : this.boardCenter.x + 0.11;
      const anchorZ = (this.state === 'POUR_WATER' || this.state === 'PUT_LID' || this.state === 'LIFT_LID' || this.state === 'FLIP_PLATE')
        ? env.hpPos.z + 0.18
        : this.boardCenter.z + 0.11;
      this.handTarget.set(anchorX, this.boardCenter.y + 0.048 + Math.sin(nowSec * 2.1) * 0.0025, anchorZ);
    }
    const hk = 1 - Math.exp(-dt * 9.0);
    this.hand.position.lerp(this.handTarget, hk);
    this.hand.userData.setPinch(this.handPinchTarget);

    // Subtle pilot LED warmth pulse on hot plate
    env.pilotLedMat.emissiveIntensity = 1.9 + Math.sin(nowSec * 3.5) * 0.25;
  }
}
