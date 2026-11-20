// scene_walk.js — 2. 公園まで歩く（子どもの目の高さ。ママがさげたバッグが目の前で揺れる）
//
// 公開 API
//   import { createWalkScene } from './scene_walk.js';
//   createWalkScene(ctx) → { group, env, envIntensity, background, fog, enter(), exit(), update(dt, t) }
//     ctx = game.ctx（engine, input, audio, hints, tweens, state, goto …）
//   進行: setProgress を約 11 秒で 0→1（台形の速度）。p=1 で足音が止まりバッグが落ち着き、0.7 秒後 ctx.goto('park')。
//   操作: バッグを down でつかみ、指の左右で振り子の角度 θ が追従（±50°）。離すとその勢いで揺れ続ける。tap ではじく。
//   state.shake: 子どもが加えた揺れ（半往復ごとの振れ幅）だけ増える（上限 1）。歩くだけの揺れでは増えない。
//   カメラ: バッグが横幅いっぱい近くに大きく、持ち手の頂点（ママの手）は必ず画面上端の外。
//          画面比が変わったら解き直す（engine.setShot を距離固定で使う）。足音に合わせてごく小さく上下。
import * as THREE from 'three';
import { createWalkSet } from './props_park.js';
import { createToteBag } from './props_kitchen.js';
import { createBento } from './props_food.js';

const G = 9.8;
const WALK_T = 11;           // 歩く時間（ゲーム内秒）
const ACC_T = 1.2, DEC_T = 1.6;
const MAX_TH = THREE.MathUtils.degToRad(50);

export function createWalkScene(ctx) {
  const { engine, input, audio, hints, tweens, state } = ctx;
  const group = new THREE.Group();
  group.name = 'walkScene';
  const set = createWalkSet(engine.renderer);
  group.add(set);
  // 手前（カメラ側）からの暖かい照り返し。日かげ側を向く布バッグや箱の正面が、緑がかって沈むのを防ぐ（影なし）
  const fill = new THREE.DirectionalLight(0xffeedd, 1.0);
  fill.position.set(0.4, 1.3, 2.2);
  group.add(fill); group.add(fill.target);
  const U = set.userData;
  const fog = new THREE.Fog(U.fogColor.clone(), U.fogNear, U.fogFar);

  // ---- バッグ（振り子）----
  const anchor = U.bagAnchor.clone();
  const swing = new THREE.Group();          // 支点 = ママの手（持ち手の頂点）
  swing.position.copy(anchor);
  group.add(swing);
  let tote = null, boxes = [], hT = 0.379, L = 0.28;
  const bagMid = new THREE.Object3D();      // ヒントの光の輪の中心（バッグの胴の真ん中）

  function buildBag() {
    if (tote) swing.remove(tote);
    tote = createToteBag();
    // 薄い布の自己影で胴が真っ暗になるのを防ぐ（影は落とすが受けない）
    tote.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    const api = tote.userData.api;
    api.setHandles(1);
    // 持ち手を立てた形に一気に合わせる
    for (let i = 0; i < 40; i++) tote.userData.update(0.05, 0);
    hT = api.handleTopLocal.y;
    L = hT - api.size.h * 0.5;
    tote.position.set(-api.handleTopLocal.x, -hT, -api.handleTopLocal.z);
    swing.add(tote);
    bagMid.position.set(0, api.size.h * 0.5, api.size.d * 0.3);
    tote.add(bagMid);
    // 中のお弁当箱（ふたは閉じたまま）
    boxes = [];
    const mama = createBento('mama'), child = createBento('child');
    mama.position.copy(api.insideLocal(0)); child.position.copy(api.insideLocal(1));
    for (const b of [mama, child]) { b.userData.api.setInteriorVisible(false); tote.add(b); boxes.push(b); }
    engine.applyQuality(group);
  }

  // ---- カメラ ----
  const camFov = 50, PITCH = THREE.MathUtils.degToRad(27);
  const scratch = new THREE.PerspectiveCamera(camFov, 1, 0.02, 60);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  let solvedFor = '';
  let camLook = new THREE.Vector3(), camPos = new THREE.Vector3();
  function bagCenterRest(out) { return out.set(anchor.x, anchor.y - L, anchor.z); }
  function solveCamera(dur) {
    const w = engine.size.w, h = engine.size.h, a = w / h;
    const T = Math.tan(THREE.MathUtils.degToRad(camFov / 2));
    const half = (tote ? tote.userData.api.size.w : 0.27) / 2;
    const C = bagCenterRest(new THREE.Vector3());
    // 横は幅の 9 割まで、縦は高さの半分まで（広い画面ではこちらで決まる）
    const r = Math.max(half / (T * a * 0.9), 0.1 / (T * 0.5));
    const d = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const P = C.clone().addScaledVector(d, r);
    scratch.aspect = a; scratch.fov = camFov; scratch.updateProjectionMatrix();
    scratch.position.copy(P);
    // バッグはなるべく画面の下寄りに。ただし手（支点）は必ず上端の外
    let yb = -0.22, look = new THREE.Vector3();
    for (; yb < 0.6; yb += 0.02) {
      const beta = Math.atan(-yb * T);  // 正 = 上を向く
      const fwd = d.clone().negate().applyAxisAngle(new THREE.Vector3(1, 0, 0), beta);
      look.copy(P).addScaledVector(fwd, r);
      scratch.lookAt(look); scratch.updateMatrixWorld(true);
      tmp.copy(anchor).project(scratch);
      if (tmp.y > 1.08) break;
    }
    camPos.copy(P); camLook.copy(look);
    engine.setShot({ target: look, dir: P.clone().sub(look), points: [], minDist: r, maxDist: r, fov: camFov }, dur);
    solvedFor = w + 'x' + h;
  }

  // ---- 振り子の状態 ----
  const ph = { th: 0, w: 0, grab: false, thT: 0, phi0: 0, th0: 0, lastTurn: 0, lastSign: 0, childT: 99 };
  let tw = null, hs = [], token = 0, tWalk = 0, prog = 0, arrived = false, leaving = false;
  let stepT = 0, stepSide = 1, stepPhase = 0, bob = 0, hintSide = 1;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -anchor.z);
  const hit = new THREE.Vector3();
  function pointerAngle(ev) {
    if (!ev.ray.intersectPlane(plane, hit)) return null;
    return Math.atan2(hit.x - anchor.x, Math.max(0.05, anchor.y - hit.y));
  }
  function speedAt(t) {
    const v = 1 / (WALK_T - ACC_T / 2 - DEC_T / 2);
    if (t <= 0) return 0;
    if (t < ACC_T) return v * t / ACC_T;
    if (t < WALK_T - DEC_T) return v;
    if (t < WALK_T) return v * (WALK_T - t) / DEC_T;
    return 0;
  }
  function progAt(t) {
    const v = 1 / (WALK_T - ACC_T / 2 - DEC_T / 2);
    if (t <= 0) return 0;
    if (t < ACC_T) return 0.5 * v * t * t / ACC_T;
    if (t < WALK_T - DEC_T) return v * (t - ACC_T / 2);
    if (t < WALK_T) return 1 - 0.5 * v * (WALK_T - t) * (WALK_T - t) / DEC_T;
    return 1;
  }
  function kick(wv) { ph.w += wv; }
  function bagCenterWorld(out) { return tote.localToWorld(out.set(0, tote.userData.api.size.h * 0.5, 0)); }

  // 揺れの折り返し（音と shake の記録）
  function onTurn(thTurn) {
    const half = Math.abs(thTurn - ph.lastTurn) / 2;
    ph.lastTurn = thTurn;
    if (half > 0.12) {
      const vol = Math.min(1, (half - 0.08) * 1.5);
      audio.play('rattle', { vol, pan: Math.max(-0.6, Math.min(0.6, thTurn * 0.8)), rate: 0.95 + Math.random() * 0.1 });
      if (half > 0.45) { audio.play('cloth', { vol: Math.min(0.7, half * 0.6) }); tote.userData.api.squash(Math.min(0.5, half * 0.4)); }
    }
    if (ph.childT < 2.5 && half > 0.15) {
      state.shake = Math.min(1, (state.shake || 0) + (half - 0.15) * 0.24);
    }
  }

  function setHint() {
    engine.scene.updateMatrixWorld(true); // hints は set 時の外接球から中心を測る（親の行列が古いとずれる）
    hints.set({
      target: bagMid, gesture: 'drag', radius: 0.11,
      tip: () => bagCenterWorld(new THREE.Vector3()).add(tmp2.set(0, 0.02, 0.08)),
      destPoint: () => bagCenterWorld(new THREE.Vector3()).add(tmp2.set(0.2 * hintSide, 0.02, 0.08)),
      nudge(level) {
        hintSide = -hintSide;
        kick((level >= 2 ? 1.1 : 0.7) * (ph.th >= 0 ? -1 : 1));
        audio.play('rattle', { vol: level >= 2 ? 0.55 : 0.35 });
        if (level >= 2) audio.play('cloth', { vol: 0.35 });
      },
    });
  }

  function addInput() {
    hs.push(input.add(tote, {
      radius: 0.16, pad: 30, priority: 1,
      center: () => bagCenterWorld(new THREE.Vector3()),
      down(ev) {
        if (leaving) return;
        ph.childT = 0;
        const a = pointerAngle(ev);
        ph.grab = a != null; ph.phi0 = a || 0; ph.th0 = ph.th; ph.thT = ph.th;
        audio.play('cloth', { vol: 0.35 });
        audio.play('rattle', { vol: 0.25 });
        tote.userData.api.squash(0.25);
      },
      move(ev) {
        if (!ph.grab || leaving) return;
        ph.childT = 0;
        const a = pointerAngle(ev);
        if (a == null) return;
        ph.thT = THREE.MathUtils.clamp(ph.th0 + (a - ph.phi0) * 1.15, -MAX_TH, MAX_TH);
      },
      up(ev) {
        const wasGrab = ph.grab;
        ph.grab = false;
        if (ev.cancelled || !wasGrab) return;
        ph.childT = 0;
      },
      tap(ev) {
        if (leaving) return;
        // はじく: 指が中心の右なら左へ、左なら右へ
        const c = engine.project(bagCenterWorld(tmp));
        const dir = ev.x >= c.x ? -1 : 1;
        kick(dir * 2.2);
        ph.childT = 0;
        audio.play('rattle', { vol: 0.5 });
      },
    }));
    // 何もない所に触れても、バッグが小さく揺れる（無反応にしない）
    const off = input.onMiss((ev) => {
      if (leaving || !tote) return;
      const c = engine.project(bagCenterWorld(tmp));
      kick((ev.x >= c.x ? 1 : -1) * 0.6);
      audio.play('rattle', { vol: 0.2 });
    });
    hs.push({ remove: off });
  }

  function finish(tok) {
    if (arrived) return;
    arrived = true;
    tw.wait(0.7).then(() => {
      if (tok !== token) return;
      leaving = true;
      ph.grab = false;
      ctx.goto('park');
    });
  }

  return {
    group,
    env: U.env, envIntensity: U.envIntensity,
    background: U.fogColor.clone(),
    fog,
    enter() {
      token++;
      tw = tweens.scope();
      buildBag();
      tWalk = 0; prog = 0; arrived = false; leaving = false;
      stepT = 0.35; stepSide = 1; stepPhase = 0; bob = 0;
      Object.assign(ph, { th: 0.12, w: 0, grab: false, thT: 0, lastTurn: 0, lastSign: 0, childT: 99 });
      if (!Number.isFinite(state.shake)) state.shake = 0;
      U.setProgress(0);
      fog.color.copy(U.fogColor);
      solveCamera(0);
      audio.setMusic('walk');
      audio.setAmbience('park');
      addInput();
      setHint();
    },
    exit() {
      token++;
      for (const h of hs) { try { h.remove(); } catch (e) { /* noop */ } }
      hs = [];
      if (tw) tw.killAll();
      ph.grab = false;
      leaving = true;
    },
    update(dt, t) {
      if (!tote) return;
      if ((engine.size.w + 'x' + engine.size.h) !== solvedFor) solveCamera(0);
      // 進行
      if (!arrived) {
        tWalk += dt;
        prog = progAt(tWalk);
        U.setProgress(prog);
        if (tWalk >= WALK_T) finish(token);
      }
      const v = speedAt(tWalk) / (1 / (WALK_T - ACC_T / 2 - DEC_T / 2)); // 0..1
      // 足音
      if (v > 0.25) {
        stepT -= dt;
        if (stepT <= 0) {
          stepT += 0.55;
          stepSide = -stepSide;
          audio.play('step', { vol: 0.35 + 0.4 * v, pan: 0.25 * stepSide, rate: 0.95 + Math.random() * 0.1 });
        }
      }
      stepPhase += (dt / 0.55) * v;
      // 振り子
      ph.childT += dt;
      const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / sub;
      const damp = arrived ? 3.2 : 0.95;
      for (let i = 0; i < sub; i++) {
        let acc;
        if (ph.grab) acc = 150 * (ph.thT - ph.th) - 17 * ph.w;
        else {
          acc = -(G / L) * Math.sin(ph.th) - damp * ph.w;
          acc += 1.1 * v * Math.sin(Math.PI * stepPhase + 0.4); // 歩行の小さな加振（2歩で1往復）
        }
        ph.w += acc * h;
        ph.th += ph.w * h;
        if (ph.th > MAX_TH * 1.25) { ph.th = MAX_TH * 1.25; ph.w = Math.min(0, ph.w) * 0.5; }
        if (ph.th < -MAX_TH * 1.25) { ph.th = -MAX_TH * 1.25; ph.w = Math.max(0, ph.w) * 0.5; }
        const sgn = Math.sign(ph.w);
        if (sgn !== 0 && ph.lastSign !== 0 && sgn !== ph.lastSign) onTurn(ph.th);
        if (sgn !== 0) ph.lastSign = sgn;
      }
      swing.rotation.set(
        0.04 * v * Math.sin(Math.PI * 2 * stepPhase) - 0.03 * ph.w * 0.1,
        0.12 * Math.sin(ph.th * 1.3) + 0.03 * Math.sin(t * 0.9),
        ph.th,
      );
      // 中の箱は少し遅れて片寄る
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const target = THREE.MathUtils.clamp(-ph.w * 0.004, -0.02, 0.02);
        b.position.x += (target - b.position.x) * Math.min(1, dt * 14);
        b.rotation.z = -b.position.x * 2;
      }
      tote.userData.update(dt, t);
      U.update(dt, t);
      // カメラのごく小さな上下（engine が毎フレーム基準位置に戻すので、ここで足す）
      const by = 0.006 * v * Math.abs(Math.sin(Math.PI * stepPhase));
      bob += (by - bob) * Math.min(1, dt * 12);
      if (bob > 1e-5) { engine.camera.position.y += bob; engine.camera.updateMatrixWorld(true); }
    },
  };
}
