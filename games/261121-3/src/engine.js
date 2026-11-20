// engine.js — レンダラ・ループ・カメラ構図（ショット）・フェード
//
// 公開 API
//   import { createEngine, showFallback } from './engine.js';
//   const engine = createEngine();   // WebGL が作れなければ代替画面を出して null
//   showFallback()                   // 代替画面（#fb の静止画、無ければ暖色グラデーション）を出す
//
//   engine.scene / engine.camera (PerspectiveCamera near 0.02 far 60) / engine.renderer
//   engine.time            … 経過秒（エンジンの時計。非表示中は進まない）
//   engine.size            … { w, h } CSS px
//   engine.safe            … { top, right, bottom, left } Safe Area（CSS px）
//   engine.quality         … { low: false, particleScale: 1 }（重いと low=true, particleScale=0.5）
//   engine.onQuality(fn)   … quality が変わったら fn(quality)。解除関数を返す
//   engine.applyQuality(root) … root 内の影つきライトに現在の品質の影マップ寸法を当てる（場面を足したとき game が呼ぶ）
//   engine.onUpdate(fn)    … 毎フレーム fn(dt, t)。dt は最大 1/20 秒。解除関数を返す
//   engine.onPause(fn) / engine.onResume(fn) … 非表示/復帰（音を止める用）。解除関数を返す
//
//   engine.setShot({ target: Vector3, dir: Vector3 (target→カメラの向き), points: Vector3[],
//                    fov = 38, margin = 0.06, minDist?, maxDist?, up? }, duration = 0.8)
//       points がすべて Safe Area の内側（短辺×margin の余白つき）に入る最小距離を求め、
//       カメラ位置・注視点・fov を ease in-out で補間する。duration=0 で即座。
//       リサイズ・回転時は同じショットを即解き直す。戻り値: 解いたカメラ位置 Vector3。
//   engine.getShot()       … 現在のショット（{ ...shot, position, distance }）か null
//   engine.shake(amount = 0.01, dur = 0.3) … 小さなカメラ揺れ（amount は注視点までの距離に対する比）
//   engine.fade(alpha 0..1, dur = 0.45, color = '#fff') → Promise（#fade の不透明度。エンジンの時計で進む）
//   engine.project(worldVec3) → { x, y, behind }（CSS px）
//   engine.rayAt(x, y)     → THREE.Ray（CSS px から）
//   engine.pxPerMeter(worldVec3) → その奥行きで 1m が何 px か
import * as THREE from 'three';

export function showFallback() {
  try {
    const c = document.getElementById('c');
    if (c) c.style.display = 'none';
    const fb = document.getElementById('fb');
    const src = fb && fb.getAttribute('data-src');
    if (fb && src && src.startsWith('data:')) { fb.src = src; fb.style.display = 'block'; }
    else document.body.style.background = 'linear-gradient(160deg,#fff4e2 0%,#ffe2c4 45%,#f7c9a6 100%)';
    const f = document.getElementById('fade');
    if (f) f.style.opacity = '0';
  } catch (e) { /* 何もできない */ }
}

export function createEngine() {
  const canvas = document.getElementById('c');
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no gl');
  } catch (e) {
    console.warn('WebGL unavailable', e);
    showFallback();
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
  camera.position.set(0, 0.5, 0.6);
  camera.lookAt(0, 0, 0);
  scene.add(camera);

  const fadeEl = document.getElementById('fade');
  const ups = [], pauses = [], resumes = [], qualityFns = [];
  const errCount = new Map();

  // ---- Safe Area ----
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const safe = { top: 0, right: 0, bottom: 0, left: 0 };
  function readSafe() {
    try {
      const cs = getComputedStyle(probe);
      safe.top = parseFloat(cs.paddingTop) || 0; safe.right = parseFloat(cs.paddingRight) || 0;
      safe.bottom = parseFloat(cs.paddingBottom) || 0; safe.left = parseFloat(cs.paddingLeft) || 0;
    } catch (e) { /* noop */ }
  }

  // ---- サイズ・動的解像度 ----
  const size = { w: 1, h: 1 };
  const maxPR = Math.min(window.devicePixelRatio || 1, 2);
  const minPR = Math.min(maxPR, 0.6);
  let pr = maxPR;
  const quality = { low: false, particleScale: 1 };
  function measure() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    return [w, h];
  }
  function applySize(force) {
    const [w, h] = measure();
    if (!force && w === size.w && h === size.h) return false;
    size.w = w; size.h = h;
    readSafe();
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (shot) resolveShot(true);
    return true;
  }
  function setPR(v) {
    pr = v;
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
  }
  function shadowSizeFor(light) {
    if (!light.userData.__baseShadow) light.userData.__baseShadow = light.shadow.mapSize.x || 1024;
    const b = light.userData.__baseShadow;
    return quality.low ? Math.max(512, b / 2) : b;
  }
  function applyQuality(root) {
    (root || scene).traverse((o) => {
      if (o.isLight && o.castShadow && o.shadow) {
        const s = shadowSizeFor(o);
        if (o.shadow.mapSize.x !== s) {
          o.shadow.mapSize.set(s, s);
          if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
        }
      }
    });
  }
  let avgMs = 16, slowT = 0, fastT = 0;
  function perf(rawDt) {
    avgMs += (rawDt * 1000 - avgMs) * 0.08;
    if (avgMs > 36) slowT += rawDt; else slowT = 0;
    if (avgMs < 22) fastT += rawDt; else fastT = 0;
    if (slowT > 1.5) {
      slowT = 0;
      if (pr > minPR + 1e-3) { setPR(Math.max(minPR, pr * 0.85)); avgMs = 30; }
      else if (!quality.low) {
        quality.low = true; quality.particleScale = 0.5;
        applyQuality(scene);
        for (const f of qualityFns.slice()) { try { f(quality); } catch (e) { console.error(e); } }
      }
    }
    if (fastT > 4) {
      fastT = 0;
      if (pr < maxPR) { setPR(maxPR); avgMs = 20; }
    }
  }

  // ---- ショット ----
  let shot = null;
  const curLook = new THREE.Vector3(0, 0, 0);
  let curFov = 38;
  const anim = { active: false, t: 0, dur: 0, fromPos: new THREE.Vector3(), fromLook: new THREE.Vector3(), fromFov: 38, toPos: new THREE.Vector3(), toLook: new THREE.Vector3(), toFov: 38 };
  const scratchCam = new THREE.PerspectiveCamera();
  const tmpV = new THREE.Vector3();
  const basePos = camera.position.clone();
  const UP = new THREE.Vector3(0, 1, 0);
  const ALT_UP = new THREE.Vector3(0, 0, -1);
  function upFor(dir, s) {
    if (s && s.up) return s.up;
    return Math.abs(dir.y) > 0.995 ? ALT_UP : UP;
  }
  function safeNdc(margin) {
    const m = margin * Math.min(size.w, size.h);
    const l = safe.left + m, r = size.w - safe.right - m, t = safe.top + m, b = size.h - safe.bottom - m;
    return { l: (2 * l) / size.w - 1, r: (2 * r) / size.w - 1, t: 1 - (2 * t) / size.h, b: 1 - (2 * b) / size.h };
  }
  function fits(d, s, dir, rect, tanH, aspect) {
    scratchCam.position.copy(s.target).addScaledVector(dir, d);
    scratchCam.up.copy(upFor(dir, s));
    scratchCam.lookAt(s.target);
    scratchCam.updateMatrixWorld(true);
    const inv = scratchCam.matrixWorldInverse;
    for (const p of s.points) {
      tmpV.copy(p).applyMatrix4(inv);
      const z = -tmpV.z;
      if (z < 0.05) return false;
      const nx = tmpV.x / z / tanH / aspect, ny = tmpV.y / z / tanH;
      if (nx < rect.l || nx > rect.r || ny < rect.b || ny > rect.t) return false;
    }
    return true;
  }
  function solve(s) {
    const dir = s.dir.clone().normalize();
    const fov = s.fov || 38;
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const aspect = size.w / size.h;
    const rect = safeNdc(s.margin == null ? 0.06 : s.margin);
    let lo = s.minDist != null ? s.minDist : 0.05;
    let hi = s.maxDist != null ? s.maxDist : 40;
    let d;
    if (!s.points || !s.points.length || fits(lo, s, dir, rect, tanH, aspect)) d = lo;
    else if (!fits(hi, s, dir, rect, tanH, aspect)) d = hi;
    else {
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid, s, dir, rect, tanH, aspect)) hi = mid; else lo = mid; }
      d = hi;
    }
    return { pos: s.target.clone().addScaledVector(dir, d), look: s.target.clone(), fov, d, dir };
  }
  function resolveShot(immediate) {
    const r = solve(shot);
    shot.position = r.pos.clone(); shot.distance = r.d;
    anim.toPos.copy(r.pos); anim.toLook.copy(r.look); anim.toFov = r.fov;
    if (immediate && !anim.active) { basePos.copy(r.pos); curLook.copy(r.look); curFov = r.fov; }
  }
  function setShot(s, duration = 0.8) {
    shot = Object.assign({ fov: 38, margin: 0.06 }, s);
    shot.target = s.target.clone();
    shot.dir = s.dir.clone();
    shot.points = (s.points || []).map((p) => p.clone());
    anim.fromPos.copy(basePos); anim.fromLook.copy(curLook); anim.fromFov = curFov;
    resolveShot(false);
    if (duration > 0) { anim.active = true; anim.t = 0; anim.dur = duration; }
    else { anim.active = false; basePos.copy(anim.toPos); curLook.copy(anim.toLook); curFov = anim.toFov; }
    return anim.toPos.clone();
  }
  const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let shakeAmt = 0, shakeDur = 0, shakeT = 0;
  function updateCamera(dt, t) {
    if (anim.active) {
      anim.t += dt;
      const k = inOut(Math.min(1, anim.t / anim.dur));
      basePos.lerpVectors(anim.fromPos, anim.toPos, k);
      curLook.lerpVectors(anim.fromLook, anim.toLook, k);
      curFov = anim.fromFov + (anim.toFov - anim.fromFov) * k;
      if (anim.t >= anim.dur) anim.active = false;
    }
    camera.position.copy(basePos);
    if (camera.fov !== curFov) { camera.fov = curFov; camera.updateProjectionMatrix(); }
    tmpV.copy(basePos).sub(curLook);
    camera.up.copy(upFor(tmpV.normalize(), shot));
    camera.lookAt(curLook);
    if (shakeT < shakeDur) {
      shakeT += dt;
      const k = 1 - shakeT / shakeDur;
      const a = shakeAmt * k * k * basePos.distanceTo(curLook);
      camera.translateX(Math.sin(t * 61.0) * a);
      camera.translateY(Math.sin(t * 47.0 + 1.3) * a);
    }
    camera.updateMatrixWorld(true);
  }

  // ---- フェード ----
  let fadeA = parseFloat(fadeEl ? getComputedStyle(fadeEl).opacity : '0') || 0;
  let fadeJob = null;
  function fade(alpha, dur = 0.45, color = '#fff') {
    if (fadeEl) fadeEl.style.background = color;
    if (fadeJob) { fadeJob.resolve(); fadeJob = null; }
    return new Promise((resolve) => {
      if (!(dur > 0)) { fadeA = alpha; if (fadeEl) fadeEl.style.opacity = String(alpha); resolve(); return; }
      fadeJob = { from: fadeA, to: alpha, t: 0, dur, resolve };
    });
  }
  function updateFade(dt) {
    if (!fadeJob) return;
    fadeJob.t += dt;
    const k = Math.min(1, fadeJob.t / fadeJob.dur);
    fadeA = fadeJob.from + (fadeJob.to - fadeJob.from) * k;
    if (fadeEl) fadeEl.style.opacity = fadeA.toFixed(3);
    if (k >= 1) { const j = fadeJob; fadeJob = null; j.resolve(); }
  }

  // ---- 投影ユーティリティ ----
  const pv = new THREE.Vector3();
  function project(v) {
    pv.copy(v).applyMatrix4(camera.matrixWorldInverse);
    const behind = pv.z > -camera.near;
    pv.copy(v).project(camera);
    return { x: (pv.x + 1) * 0.5 * size.w, y: (1 - pv.y) * 0.5 * size.h, behind };
  }
  const rc = new THREE.Raycaster();
  const nd = new THREE.Vector2();
  function rayAt(x, y) {
    nd.set((x / size.w) * 2 - 1, 1 - (y / size.h) * 2);
    rc.setFromCamera(nd, camera);
    return rc.ray.clone();
  }
  function pxPerMeter(v) {
    pv.copy(v).applyMatrix4(camera.matrixWorldInverse);
    const depth = -pv.z;
    if (depth <= 1e-4) return 0;
    return size.h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth);
  }

  // ---- ループ ----
  let raf = 0, last = -1, running = false, lost = false;
  const engine = {
    scene, camera, renderer, time: 0, size, safe, quality,
    onUpdate(fn) { ups.push(fn); return () => { const i = ups.indexOf(fn); if (i >= 0) ups.splice(i, 1); }; },
    onPause(fn) { pauses.push(fn); return () => { const i = pauses.indexOf(fn); if (i >= 0) pauses.splice(i, 1); }; },
    onResume(fn) { resumes.push(fn); return () => { const i = resumes.indexOf(fn); if (i >= 0) resumes.splice(i, 1); }; },
    onQuality(fn) { qualityFns.push(fn); return () => { const i = qualityFns.indexOf(fn); if (i >= 0) qualityFns.splice(i, 1); }; },
    applyQuality, setShot, fade, project, rayAt, pxPerMeter,
    getShot() { return shot ? Object.assign({}, shot, { position: anim.toPos.clone(), distance: shot.distance }) : null; },
    shake(amount = 0.01, dur = 0.3) { shakeAmt = amount; shakeDur = dur; shakeT = 0; },
  };

  function frame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (last < 0) { last = now; return; } // 復帰直後は dt を作らない
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 1 / 20);
    engine.time += dt;
    applySize(false);
    perf(Math.min(raw, 0.25));
    updateCamera(dt, engine.time);
    updateFade(dt);
    for (const f of ups.slice()) {
      try { f(dt, engine.time); } catch (e) {
        const n = (errCount.get(f) || 0) + 1; errCount.set(f, n);
        if (n <= 3) console.error(e);
      }
    }
    if (!lost) {
      try { renderer.render(scene, camera); } catch (e) { if ((errCount.get(frame) || 0) < 3) { errCount.set(frame, (errCount.get(frame) || 0) + 1); console.error(e); } }
    }
  }
  function start() {
    if (running) return;
    running = true; last = -1;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  let paused = false;
  function pause() {
    if (paused) return;
    paused = true; stop();
    for (const f of pauses.slice()) { try { f(); } catch (e) { console.error(e); } }
  }
  function resume() {
    if (!paused || document.hidden) return;
    paused = false; slowT = fastT = 0;
    applySize(true);
    start();
    for (const f of resumes.slice()) { try { f(); } catch (e) { console.error(e); } }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', () => { if (!document.hidden) resume(); });

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', () => { lost = false; applySize(true); }, false);

  const onResize = () => { applySize(true); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { onResize(); setTimeout(onResize, 250); setTimeout(onResize, 700); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  applySize(true);
  if (document.hidden) paused = true; else start();
  return engine;
}
