// scene_park.js — 3. 公園のレジャーシート（ぱかっ！→ おなじ！→ 食べる（ママがまねをする）→ デザート → おしまい）
//
// 公開 API
//   import { createParkScene } from './scene_park.js';
//   createParkScene(ctx) → { group, env, envIntensity, background, fog, enter(), exit(), update(dt, t) }
//     enter() は ctx.state（slots / furikake / shake / day）だけから箱・中身・ふた・バッグを毎回作り直す。
//   ステップ（go() の1か所で切り替え。トークンで古い非同期を無視）:
//     P1 自分のふたを開ける → P2 ママのふた → P3 食べる（ママの菜箸が同じ物を食べる）
//     → P4a バッグからデザート容器 → P4b 容器のふた → P4c いちご → P5 おしまい（バッグに触ると ctx.nextDay()）
//   運ぶ操作（carry）はこのファイル内の beginCarry / carry.update / returnHome で統一:
//     down で同フレームに少し持ち上がる → 指の 26px 上を通る水平面の点へばねで追従（移動方向へ傾く）
//     → 行き先なら吸い寄せ（弾む＋音）、それ以外・pointercancel はやさしく元へ（boing）。
//   置き方（m、シート上面 y=0）: 子どもの箱 (0,0,0.22)、ママの箱 (-0.02,0,0.03)、トート (0.10,0,-0.34)、
//     ふたの置き場 子ども (0.185,0,0.235) ママ (0.215,0,0.02)、デザート容器 (-0.02,0,0.37)、その ふた (0.10,0,0.40)。
import * as THREE from 'three';
import { createPicnicSet } from './props_park.js';
import { createBento, createFood, createRiceLump, createDessertTub } from './props_food.js';
import { createChopsticks, createToteBag } from './props_kitchen.js';
import { MAMA_SLOTS, MAMA_SHAPES } from './state.js';
import { spring } from './tween.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CHILD_POS = V(0, 0, 0.22);
const MAMA_POS = V(-0.02, 0, 0.03);
const TOTE_POS = V(0.10, 0, -0.34);
const CHILD_LID_REST = V(0.185, 0, 0.235);
const MAMA_LID_REST = V(0.215, 0, 0.02);
const TUB_SPOT = V(-0.02, 0, 0.37);
const TUB_LID_REST = V(0.10, 0, 0.40);
// 「自分の口のほう」: 縦長ではシート手前、横長（奥行きが入らない）では箱の左
const EAT_DEST = V(0, 0.002, 0.43), EAT_DEST_W = V(-0.215, 0.002, 0.25);
const BERRY_DEST = V(-0.02, 0.002, 0.50), BERRY_DEST_W = V(-0.16, 0.002, 0.39);
const PITCH = THREE.MathUtils.degToRad(50);
const DIR = V(0, Math.sin(PITCH), Math.cos(PITCH));
const RICE_BITES = 3;

export function createParkScene(ctx) {
  const { engine, input, audio, hints, tweens, state } = ctx;
  const group = new THREE.Group();
  group.name = 'parkScene';
  const set = createPicnicSet(engine.renderer);
  group.add(set);
  // 手前（カメラ側）からの暖かい照り返し。日かげ側を向く布バッグや箱の正面が、緑がかって沈むのを防ぐ（影なし）
  const fill = new THREE.DirectionalLight(0xffeedd, 0.75);
  fill.position.set(0.4, 1.3, 2.2);
  group.add(fill); group.add(fill.target);
  const U = set.userData;
  const fog = new THREE.Fog(U.fogColor.clone(), U.fogNear, U.fogFar);
  const background = U.fogColor.clone();

  const dyn = new THREE.Group();   // 動く小物（enter のたびに作り直す）。原点・回転なし＝ワールド座標
  dyn.name = 'parkDyn';
  group.add(dyn);

  // ---- 場面の状態 ----
  let tw = null, hs = [], token = 0, life = 0, step = '', tubH = null, berryHs = [];
  let child, mama, cApi, mApi, tote, tApi, chop, chopApi, tub, tubApi, riceProxy;
  let childLid, mamaLid, tubLid;
  const lidState = new Map();      // lid → 'closed' | 'held' | 'opening' | 'open'
  let riceEaten = 0, riceOut = false, mamaRice = 0, eatenFoods = 0, totalFoods = 0;
  let mamaPending = 0, mamaChain = Promise.resolve();
  let tubState = 'hidden';         // hidden | peek | carried | placed
  let berryDone = false, finished = false;
  const sink = [];                 // ごはんの上の物（ごはんが減ると一緒に下がる）{ api, obj, y0, top0 }

  const tmp = V(0, 0, 0), tmp2 = V(0, 0, 0), tmpQ = new THREE.Quaternion();
  const plane = new THREE.Plane(V(0, 1, 0), 0);

  // ---- 共通の小道具 ----
  function rayPlane(x, y, py, out) {
    const r = engine.rayAt(x, y);
    plane.constant = -py;
    if (!r.intersectPlane(plane, out)) out.copy(r.origin).addScaledVector(r.direction, 0.5);
    return out;
  }
  // 画面の左上の外（菜箸の出入り口）
  function offscreenTopLeft(out) {
    return rayPlane(-engine.size.w * 0.18, -engine.size.h * 0.08, 0.16, out);
  }
  // 口の位置（画面の下の外、カメラのすぐ前）
  function mouthPoint(out) {
    const r = engine.rayAt(engine.size.w * 0.5, engine.size.h * 1.12);
    return out.copy(r.origin).addScaledVector(r.direction, 0.16);
  }
  function worldPos(o, out = V(0, 0, 0)) { return o.getWorldPosition(out); }

  // points が収まる構図。縦長で上下に余りがあるときは、物を画面の下寄りに置く（上の余白に奥の物が見える）
  const scratchCam = new THREE.PerspectiveCamera();
  let lastShot = null, shotSize = '';
  function shot(points, dur = 0.8, fov = 38, bias = 0.7) {
    lastShot = [points, fov, bias];
    shotSize = engine.size.w + 'x' + engine.size.h;
    const box = new THREE.Box3().setFromPoints(points);
    const target = box.getCenter(V(0, 0, 0));
    target.y = Math.min(target.y, 0.02);
    const s = { target, dir: DIR, points, fov, margin: 0.05 };
    let pos = engine.setShot(s, dur);
    if (!(bias > 0)) return;
    scratchCam.fov = fov; scratchCam.aspect = engine.size.w / engine.size.h; scratchCam.updateProjectionMatrix();
    scratchCam.position.copy(pos); scratchCam.up.set(0, 1, 0); scratchCam.lookAt(target); scratchCam.updateMatrixWorld(true);
    let lo = Infinity;
    for (const p of points) lo = Math.min(lo, tmp.copy(p).project(scratchCam).y);
    const mNdc = (2 * 0.05 * Math.min(engine.size.w, engine.size.h) + 2 * engine.safe.bottom) / engine.size.h;
    const free = lo + 1 - mNdc;
    if (free < 0.04) return;
    const d = pos.distanceTo(target);
    const up = V(0, 1, 0).applyQuaternion(scratchCam.quaternion);
    s.target = target.clone().addScaledVector(up, free * bias * d * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    engine.setShot(s, dur);
  }
  function reshot() { if (lastShot) shot(lastShot[0], 0, lastShot[1], lastShot[2]); }
  const wide = () => engine.size.w > engine.size.h * 1.05;
  const eatDest = () => (wide() ? EAT_DEST_W : EAT_DEST);
  const berryDest = () => (wide() ? BERRY_DEST_W : BERRY_DEST);
  const around = (p, r) => [V(p.x - r, 0, p.z - r), V(p.x + r, 0, p.z + r), V(p.x - r, 0, p.z + r), V(p.x + r, 0, p.z - r)];
  function p3Shot(dur) { shot([...childPts(0.01), ...mamaPts(0.0), ...around(eatDest(), 0.06)], dur); }
  function p4cShot(dur) { shot([...boxPts(TUB_SPOT, 0.11, 0.11, 0.05, 0.01), ...around(berryDest(), 0.05), ...childPts(0.0)], dur); }
  // 箱の外周（ふた込みの高さ）
  function boxPts(pos, w, d, h, pad = 0) {
    const out = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, h]) out.push(V(pos.x + sx * (w / 2 + pad), y, pos.z + sz * (d / 2 + pad)));
    return out;
  }
  const childPts = (pad = 0) => boxPts(CHILD_POS, 0.17, 0.108, 0.05, pad);
  const mamaPts = (pad = 0) => boxPts(MAMA_POS, 0.2006, 0.1275, 0.06, pad);

  // ぴょこっと跳ねる（ヒントの nudge と「主役以外に触った」反応）
  function hop(obj, h = 0.006, snd = 'tick', vol = 0.5, rate = 1) {
    if (!obj || !tw) return;
    if (obj.userData._hopY == null) { obj.userData._hopY = obj.position.y; obj.userData._hopRZ = obj.rotation.z; }
    const y0 = obj.userData._hopY, z0 = obj.userData._hopRZ;
    tw.kill(obj.position); tw.kill(obj.rotation);
    const rz = (Math.random() - 0.5) * 0.12;
    tw.to(obj.position, { y: y0 + h }, 0.09, { ease: 'outQuad' }).promise.then(() =>
      tw.to(obj.position, { y: y0 }, 0.32, { ease: 'outBounce', onDone: () => { delete obj.userData._hopY; } }));
    tw.to(obj.rotation, { z: z0 + rz }, 0.09).promise.then(() => tw.to(obj.rotation, { z: z0 }, 0.3, { ease: 'outBack' }));
    if (snd) audio.play(snd, { vol, rate });
  }
  function stopHop(obj) {
    if (obj && obj.userData._hopY != null) { tw.kill(obj.position); tw.kill(obj.rotation); obj.position.y = obj.userData._hopY; obj.rotation.z = obj.userData._hopRZ; delete obj.userData._hopY; }
  }
  const foodRate = { tamago: 0.9, karaage: 0.8, wiener: 1.05, broccoli: 1.15, tomato: 1.25, strawberry: 1.2 };
  const foodType = (o) => (o && o.userData.food && o.userData.food.type) || 'karaage';

  // ---- 運ぶ操作（carry）----
  const carry = { obj: null, tgt: V(0, 0, 0), vel: V(0, 0, 0), y: 0.07, q0: new THREE.Quaternion(), yFn: null, kind: '' };
  function aim(ev) {
    rayPlane(ev.x, ev.y - 26, carry.y, carry.tgt);
    if (carry.yFn) carry.tgt.y = carry.yFn(carry.tgt);
  }
  function beginCarry(obj, ev, height, kind, yFn = null) {
    stopHop(obj);
    tw.kill(obj.position); tw.kill(obj.quaternion); tw.kill(obj.scale);
    dyn.attach(obj);
    carry.obj = obj; carry.y = height; carry.yFn = yFn; carry.kind = kind;
    carry.vel.set(0, 0, 0);
    carry.q0.copy(obj.quaternion);
    aim(ev);
    obj.position.y += 0.015;   // 同じフレームで少し持ち上がる
    audio.play('pick', { rate: foodRate[foodType(obj)] || 1 });
  }
  function endCarry() { const o = carry.obj; carry.obj = null; carry.yFn = null; return o; }
  function updateCarry(dt) {
    const o = carry.obj;
    if (!o) return;
    spring(o.position, carry.tgt, carry.vel, 320, 30, dt);
    const ax = THREE.MathUtils.clamp(carry.vel.z * 0.9, -0.35, 0.35);
    const az = THREE.MathUtils.clamp(-carry.vel.x * 0.9, -0.35, 0.35);
    tmpQ.setFromEuler(new THREE.Euler(ax, 0, az));
    o.quaternion.copy(carry.q0).premultiply(tmpQ);
  }
  // 弧を描いて移る
  function arcTo(obj, to, dur, lift = 0.03, quat = null, ease = 'inOutCubic') {
    const from = obj.position.clone();
    const q0 = obj.quaternion.clone();
    return tw.value({
      dur, ease,
      onUpdate: (k) => {
        obj.position.lerpVectors(from, to, k);
        obj.position.y += Math.sin(Math.PI * k) * lift;
        if (quat) obj.quaternion.slerpQuaternions(q0, quat, k);
      },
    }).promise;
  }
  // 元の場所（親のローカル姿勢）へやさしく戻る
  function returnHome(obj, home, onDone) {
    audio.play('boing', { vol: 0.6 });
    home.parent.updateWorldMatrix(true, false);
    const wp = home.parent.localToWorld(home.pos.clone());
    const wq = home.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(home.quat);
    arcTo(obj, wp, 0.42, 0.03, wq, 'outCubic').then(() => {
      home.parent.attach(obj);
      obj.position.copy(home.pos); obj.quaternion.copy(home.quat);
      audio.play('place', { vol: 0.5, rate: foodRate[foodType(obj)] || 1 });
      if (onDone) onDone();
    });
  }
  // 自分の口へ（ぱくっ）
  function eatAnim(obj) {
    const to = mouthPoint(V(0, 0, 0));
    audio.play('whoosh', { vol: 0.25 });
    const s0 = obj.scale.x;
    tw.to(obj.scale, { x: s0 * 0.45, y: s0 * 0.45, z: s0 * 0.45 }, 0.34, { ease: 'inQuad' });
    return arcTo(obj, to, 0.34, 0.02, null, 'inCubic').then(() => {
      audio.play('munch');
      engine.shake(0.004, 0.2);
      if (obj.parent) obj.parent.remove(obj);
    });
  }

  // ---- ママの菜箸（キューで直列化）----
  const chopDir = V(-0.45, 0.85, -0.28).normalize();
  function enqueueMama(type) {
    const life0 = life;
    mamaPending++;
    mamaChain = mamaChain.then(() => (life0 === life ? mamaJob(type, life0) : new Promise(() => {}))).then(() => {
      if (life0 !== life) return;
      mamaPending--;
      checkProgress();
    });
  }
  async function mamaJob(type, life0) {
    const alive = () => life0 === life;
    let obj = null, idx = -1, lumpFromRice = false;
    if (type === 'rice') lumpFromRice = true;
    else if (type === 'strawberry') obj = tubApi.berries.find((b) => b.parent === tub) || null;
    else {
      idx = mApi.items.findIndex((f) => f && foodType(f) === type);
      obj = idx >= 0 ? mApi.items[idx] : null;
    }
    if (!obj && !lumpFromRice) return;
    // 目標点
    const gripAt = V(0, 0, 0);
    if (lumpFromRice) {
      mApi.riceTopLocal(gripAt); gripAt.x += 0.008; mama.localToWorld(gripAt); gripAt.y += 0.008;
    } else {
      const f = obj.userData.food || { height: 0.02 };
      worldPos(obj, gripAt); gripAt.y += (f.height || 0.02) * 0.5;
    }
    chop.visible = true;
    offscreenTopLeft(chop.position);
    chopApi.setGrip(0);
    await tw.wait(0.25);
    if (!alive()) return;
    await arcTo(chop, gripAt.clone().add(V(0, 0.07, 0)), 0.55, 0.04);
    if (!alive()) return;
    await tw.to(chop.position, { x: gripAt.x, y: gripAt.y, z: gripAt.z }, 0.22, { ease: 'outCubic' }).promise;
    if (!alive()) return;
    if (lumpFromRice) {
      mamaRice++;
      mApi.setRice(Math.max(0, 1 - mamaRice / RICE_BITES));
      obj = createRiceLump(0.03);
      obj.position.copy(gripAt); obj.position.y -= 0.009;
      obj.scale.setScalar(0.5);
      dyn.add(obj);
      tw.to(obj.scale, { x: 1, y: 1, z: 1 }, 0.15);
    }
    const width = lumpFromRice ? 0.022 : Math.min(0.03, ((obj.userData.food && obj.userData.food.radius) || 0.015) * 1.2);
    chopApi.setGrip(1, width);
    audio.play('tick', { vol: 0.35, rate: 1.3, pan: -0.3 });
    await tw.wait(0.2);
    if (!alive()) return;
    if (idx >= 0 && mApi.items[idx] === obj) mApi.items[idx] = null;
    for (let i = sink.length - 1; i >= 0; i--) if (sink[i].obj === obj) sink.splice(i, 1);
    chop.attach(obj);
    await tw.to(chop.position, { y: chop.position.y + 0.06 }, 0.22, { ease: 'outCubic' }).promise;
    if (!alive()) return;
    await arcTo(chop, offscreenTopLeft(V(0, 0, 0)), 0.5, 0.02, null, 'inCubic');
    if (!alive()) return;
    chop.remove(obj);
    chopApi.setGrip(0);
    audio.play('munch', { vol: 0.55, rate: 0.82, pan: -0.6, delay: 0.12 });
    await tw.wait(0.35);
  }

  // ---- ふたを開ける（P1 / P2 / P4b 共通）----
  // lid は閉じている間、箱（容器）の子。開いたら dyn へ移して rest に平置き。
  function lidHandlers(lid, owner, ownerApi, isMyTurn, rest, restYaw, popName, onOpened) {
    const g = { held: false, sx: 0, sz: 0, base: 0 };
    const restQ = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), restYaw);
    const setInterior = (v) => { if (ownerApi && ownerApi.setInteriorVisible) ownerApi.setInteriorVisible(v); };
    return {
      down(ev) {
        const st = lidState.get(lid);
        if (st === 'open') { hop(lid, 0.004, 'tick', 0.4); return; }
        if (st !== 'closed') return;
        if (!isMyTurn()) { hop(lid, 0.005, 'tick', 0.5); return; }
        lidState.set(lid, 'held');
        g.held = true;
        stopHop(lid);
        tw.kill(lid.position); tw.kill(lid.rotation);
        g.base = ownerApi.lidClosedY;
        const p = rayPlane(ev.x, ev.y, 0.05, V(0, 0, 0));
        g.sx = p.x; g.sz = p.z;
        setInterior(true);
        lid.position.y = g.base + 0.008;
        audio.play('tick', { vol: 0.6 });
      },
      move(ev) {
        if (!g.held) return;
        const p = rayPlane(ev.x, ev.y, 0.05, V(0, 0, 0));
        const dx = THREE.MathUtils.clamp((p.x - g.sx) * 0.35, -0.025, 0.025);
        const dz = THREE.MathUtils.clamp((p.z - g.sz) * 0.35, -0.025, 0.025);
        lid.position.set(dx, g.base + 0.01 + Math.hypot(dx, dz) * 0.5, dz);
        lid.rotation.set(dz * 3, 0, -dx * 3);
      },
      up(ev) {
        if (!g.held) return;
        g.held = false;
        if (ev.cancelled || ev.tap) {
          // ちらっと予告: 1cm 浮いてカタッと戻る
          const peek = ev.tap ? 0.012 : 0.004;
          tw.to(lid.rotation, { x: 0, y: 0, z: 0 }, 0.12);
          tw.to(lid.position, { x: 0, y: g.base + peek, z: 0 }, 0.12, { ease: 'outQuad' }).promise
            .then(() => tw.wait(ev.tap ? 0.22 : 0))
            .then(() => tw.to(lid.position, { y: g.base }, 0.24, { ease: 'outBounce' }).promise)
            .then(() => { setInterior(false); lidState.set(lid, 'closed'); audio.play('tick', { vol: 0.55, rate: 0.9 }); });
          return;
        }
        // ぱかっ！
        lidState.set(lid, 'opening');
        audio.play(popName);
        engine.shake(0.004, 0.25);
        dyn.attach(lid);
        const to = rest.clone();
        to.y = 0;
        arcTo(lid, to, 0.62, 0.09, restQ, 'inOutCubic').then(() => {
          lidState.set(lid, 'open');
          audio.play('place', { vol: 0.45, rate: 0.75 });
          delete lid.userData._hopY;
        });
        if (g.handle) { g.handle.opts.priority = 0; g.handle.opts.radius = 0.06; }
        if (onOpened) onOpened();
      },
      bind(h) { g.handle = h; },
    };
  }

  // ---- ステップ ----
  function go(name) {
    token++;
    step = name;
    const tok = token;
    const alive = () => tok === token;
    engine.scene.updateMatrixWorld(true);
    if (name === 'P1') {
      shot([...childPts(0.02), V(CHILD_LID_REST.x + 0.015, 0, CHILD_LID_REST.z)], 0);
      hints.set({
        target: childLid, gesture: 'drag', radius: 0.07,
        dest: CHILD_LID_REST, destRadius: 0.07,
        tip: () => worldPos(childLid, V(0, 0, 0)).add(V(0, 0.012, 0)),
        nudge: (lv) => hop(childLid, lv >= 2 ? 0.012 : 0.006, 'tick', lv >= 2 ? 0.8 : 0.55),
      });
    } else if (name === 'P1open') {
      hints.clear();
      tw.wait(0.45).then(() => { if (alive()) shot(childPts(-0.005), 1.2); });
      tw.wait(2.1).then(() => { if (alive()) go('P2'); });
    } else if (name === 'P2') {
      shot([...childPts(0.01), ...mamaPts(0.01), V(MAMA_LID_REST.x + 0.04, 0, MAMA_LID_REST.z)], 0.9);
      hints.set({
        target: mamaLid, gesture: 'drag', radius: 0.08,
        dest: MAMA_LID_REST, destRadius: 0.075,
        tip: () => worldPos(mamaLid, V(0, 0, 0)).add(V(0, 0.012, 0)),
        nudge: (lv) => hop(mamaLid, lv >= 2 ? 0.012 : 0.006, 'tick', lv >= 2 ? 0.8 : 0.55),
      });
    } else if (name === 'P2open') {
      hints.clear();
      tw.wait(0.5).then(() => { if (!alive()) return; shot([...childPts(0.0), ...mamaPts(0.0)], 1.0); });
      tw.wait(1.3).then(() => { if (!alive()) return; audio.play('same'); hop(child, 0.004, null); hop(mama, 0.004, null); });
      tw.wait(2.5).then(() => { if (alive()) go('P3'); });
    } else if (name === 'P3') {
      p3Shot(0.9);
      setHintP3();
      checkProgress();
    } else if (name === 'P4a') {
      hints.clear();
      shot([...childPts(0.0), ...mamaPts(0.0), ...boxPts(TOTE_POS, 0.3, 0.2, 0.25), V(TUB_SPOT.x, 0, TUB_SPOT.z + 0.06)], 1.0);
      tw.wait(0.9).then(() => {
        if (!alive()) return;
        // バッグが揺れて、口から容器が半分のぞく
        audio.play('cloth', { vol: 0.7 });
        tApi.squash(0.6);
        const r0 = tote.rotation.z;
        tw.value({ dur: 0.8, ease: 'linear', onUpdate: (k) => { tote.rotation.z = r0 + Math.sin(k * Math.PI * 4) * 0.06 * (1 - k); } });
        tub.visible = true; tubState = 'peek';
        tote.updateWorldMatrix(true, false);
        const top = tote.localToWorld(V(0, tApi.size.h - 0.024, 0));
        tub.position.copy(top).add(V(0, -0.04, 0));
        tub.rotation.set(0.12, 0.3, -0.08);
        tw.to(tub.position, { y: top.y }, 0.45, { ease: 'outBack' }).promise.then(() => {
          if (!alive()) return;
          engine.scene.updateMatrixWorld(true);
          hints.set({
            target: tub, gesture: 'drag', radius: 0.055, dest: TUB_SPOT, destRadius: 0.065,
            nudge: (lv) => { if (tubState === 'peek') { hop(tub, lv >= 2 ? 0.014 : 0.008, 'cloth', 0.4); tApi.squash(0.3); } },
          });
        });
      });
    } else if (name === 'P4b') {
      shot([...boxPts(TUB_SPOT, 0.11, 0.11, 0.05, 0.01), V(TUB_LID_REST.x + 0.06, 0, TUB_LID_REST.z), ...childPts(0.0)], 0.9);
      engine.scene.updateMatrixWorld(true);
      hints.set({
        target: tubLid, gesture: 'drag', radius: 0.05,
        dest: TUB_LID_REST, destRadius: 0.055,
        nudge: (lv) => hop(tubLid, lv >= 2 ? 0.01 : 0.005, 'tick', 0.6, 1.2),
      });
    } else if (name === 'P4c') {
      hints.clear();
      p4cShot(0.9);
      for (const h of berryHs) h.enabled = true;
      tw.wait(0.5).then(() => { if (alive()) setHintBerry(); });
    } else if (name === 'P5') {
      hints.clear();
      audio.setMusic('end');
      tw.value({ dur: 3, ease: 'inOutSine', onUpdate: (k) => U.setWarmth(k) });
      U.leaves.burst(5);
      U.leaves.setRate(0.5);
      shot([...childPts(0.0), ...mamaPts(0.0), ...boxPts(TOTE_POS, 0.3, 0.2, 0.22), ...boxPts(CHILD_LID_REST, 0.17, 0.11, 0.01), ...boxPts(MAMA_LID_REST, 0.2, 0.13, 0.01), ...boxPts(TUB_SPOT, 0.1, 0.1, 0.05), ...boxPts(TUB_LID_REST, 0.1, 0.1, 0.01)], 3.0);
      tw.wait(4).then(() => {
        if (!alive()) return;
        step = 'P5ready';
        engine.scene.updateMatrixWorld(true);
        hints.set({
          target: tote, gesture: 'tap', radius: 0.14,
          tip: () => tote.localToWorld(V(0, tApi.size.h * 0.85, 0)),
          nudge: (lv) => { audio.play('cloth', { vol: lv >= 2 ? 0.7 : 0.45 }); tApi.squash(lv >= 2 ? 0.6 : 0.35); },
        });
      });
    }
  }

  // P3 のヒント: 残っている物のうち手前の1つ（無ければごはん）
  function setHintP3() {
    if (step !== 'P3') return;
    engine.scene.updateMatrixWorld(true);
    let best = null, bz = -Infinity;
    for (const f of cApi.items) { if (!f || f.parent !== cApi.interior) continue; const z = worldPos(f, tmp).z + (f === cApi.items[5] ? 0.05 : 0); if (z > bz) { bz = z; best = f; } }
    if (!best && riceEaten + (riceOut ? 1 : 0) < RICE_BITES) best = riceProxy;
    if (!best) { hints.clear(); return; }
    const isRice = best === riceProxy;
    hints.set({
      target: best, gesture: 'drag', radius: isRice ? 0.032 : 0.024,
      dest: eatDest(), destRadius: 0.06,
      nudge: (lv) => {
        if (isRice) { hop(child, lv >= 2 ? 0.006 : 0.003, 'tick', 0.4); return; }
        hop(best, lv >= 2 ? 0.014 : 0.007, 'place', lv >= 2 ? 0.6 : 0.4, foodRate[foodType(best)] || 1);
      },
    });
  }
  function setHintBerry() {
    if (step !== 'P4c') return;
    const b = tubApi.berries.find((x) => x.parent === tub);
    if (!b) { hints.clear(); return; }
    engine.scene.updateMatrixWorld(true);
    hints.set({
      target: b, gesture: 'drag', radius: 0.024, dest: berryDest(), destRadius: 0.055,
      nudge: (lv) => hop(b, lv >= 2 ? 0.012 : 0.006, 'place', 0.45, 1.2),
    });
  }

  function checkProgress() {
    if (step === 'P3') {
      const left = cApi.items.some((f) => f) || carry.kind === 'food' || riceEaten < RICE_BITES;
      if (!left && mamaPending === 0 && eatenFoods >= totalFoods) {
        const tok = token;
        tw.wait(0.6).then(() => { if (tok === token) go('P4a'); });
      }
    } else if (step === 'P4c') {
      if (berryDone && mamaPending === 0) {
        const tok = token;
        tw.wait(0.5).then(() => { if (tok === token) go('P5'); });
      }
    }
  }

  // ---- 子どもの箱: 食べ物・ごはんを持つ ----
  function pickFromChild(ev) {
    const p = rayPlane(ev.x, ev.y, 0.03, V(0, 0, 0));
    const lp = child.worldToLocal(p.clone());
    const rr = cApi.riceRect;
    const inRice = Math.abs(lp.x - rr.cx) < rr.hw + 0.006 && Math.abs(lp.z) < rr.hd + 0.006;
    let best = -1, bd = Infinity;
    for (let i = 0; i < 6; i++) {
      const f = cApi.items[i];
      if (!f || f.parent !== cApi.interior) continue;
      const d = Math.hypot(worldPos(f, tmp).x - p.x, tmp.z - p.z);
      if (d < bd) { bd = d; best = i; }
    }
    if (inRice && cApi.items[5] && cApi.items[5].parent === cApi.interior) return { kind: 'food', i: 5 };
    if (best >= 0 && bd < 0.026) return { kind: 'food', i: best };
    if (inRice && riceEaten + (riceOut ? 1 : 0) < RICE_BITES) return { kind: 'rice' };
    if (best >= 0 && bd < 0.06) return { kind: 'food', i: best };
    return null;
  }
  function childBoxHandlers() {
    let held = null; // { kind, obj, home, i }
    return {
      down(ev) {
        if (step !== 'P3' || carry.obj) {
          if (lidState.get(childLid) === 'closed') hop(childLid, 0.004, 'tick', 0.45);
          else hop(child, 0.004, 'tick', 0.45);
          return;
        }
        const pk = pickFromChild(ev);
        if (!pk) { hop(child, 0.004, 'tick', 0.45); return; }
        if (pk.kind === 'food') {
          const f = cApi.items[pk.i];
          stopHop(f);
          const home = { parent: cApi.interior, pos: f.position.clone(), quat: f.quaternion.clone(), i: pk.i };
          cApi.items[pk.i] = null;
          for (let k = sink.length - 1; k >= 0; k--) if (sink[k].obj === f) { home.sinkRec = sink[k]; sink.splice(k, 1); }
          held = { kind: 'food', obj: f, home };
          beginCarry(f, ev, 0.07, 'food');
        } else {
          riceOut = true;
          cApi.setRice(Math.max(0, 1 - (riceEaten + 1) / RICE_BITES));
          const lump = createRiceLump(0.028);
          const at = cApi.riceTopLocal(V(0, 0, 0));
          child.localToWorld(at);
          lump.position.copy(at); lump.position.y -= 0.004;
          dyn.add(lump);
          held = { kind: 'rice', obj: lump, home: at.clone() };
          beginCarry(lump, ev, 0.07, 'food');
          audio.play('scoop', { vol: 0.5 });
        }
        hints.poke();
      },
      move(ev) { if (held && carry.obj === held.obj) aim(ev); },
      up(ev) {
        if (!held) return;
        const h = held; held = null;
        if (carry.obj !== h.obj) return;
        const drop = carry.tgt.clone();
        endCarry();
        const onBox = cApi.containsXZ(drop, 0.012) || mApi.containsXZ(drop, 0.005);
        if (ev.cancelled || onBox || step !== 'P3') {
          if (h.kind === 'food') {
            returnHome(h.obj, h.home, () => {
              cApi.items[h.home.i] = h.obj;
              if (h.home.sinkRec) sink.push(h.home.sinkRec);
              carry.kind = '';
              setHintP3();
            });
          } else {
            audio.play('boing', { vol: 0.6 });
            arcTo(h.obj, h.home, 0.35, 0.03, null, 'outCubic').then(() => {
              if (h.obj.parent) h.obj.parent.remove(h.obj);
              riceOut = false;
              cApi.setRice(Math.max(0, 1 - riceEaten / RICE_BITES));
              audio.play('plop', { vol: 0.5 });
              carry.kind = '';
              setHintP3();
            });
          }
          return;
        }
        // ぱくっ
        const type = h.kind === 'rice' ? 'rice' : foodType(h.obj);
        if (h.kind === 'rice') { riceOut = false; riceEaten++; } else eatenFoods++;
        carry.kind = '';
        eatAnim(h.obj).then(() => { setHintP3(); });
        enqueueMama(type);
        setHintP3();
        checkProgress();
      },
    };
  }

  // ---- デザート: 容器・いちご ----
  function tubHandlers() {
    return {
      down(ev) {
        if (tubState === 'peek' && step === 'P4a') {
          tubState = 'carried';
          const bagC = tote.localToWorld(V(0, 0, 0));
          beginCarry(tub, ev, 0.10, 'tub', (p) => {
            const d = Math.hypot(p.x - bagC.x, p.z - bagC.z);
            const k = THREE.MathUtils.smoothstep(d, 0.12, 0.24);
            return THREE.MathUtils.lerp(0.27, 0.10, k);
          });
          carry.tgt.y = Math.max(carry.tgt.y, tub.position.y + 0.04);
          audio.play('cloth', { vol: 0.4 });
          tApi.squash(0.4);
          hints.poke();
          return;
        }
        if (tubState === 'placed' && lidState.get(tubLid) !== 'held') hop(tub, 0.004, 'tick', 0.45, 1.3);
      },
      move(ev) { if (carry.obj === tub) aim(ev); },
      up() {
        if (carry.obj !== tub) return;
        endCarry();
        // どこで離しても、箱の横の見やすい場所へすっと置かれる
        const q = new THREE.Quaternion();
        arcTo(tub, TUB_SPOT.clone(), 0.5, 0.05, q, 'inOutCubic').then(() => {
          tubState = 'placed';
          if (tubH) tubH.enabled = false;
          audio.play('place', { vol: 0.6, rate: 0.9 });
          tub.position.y = 0.006;
          tw.to(tub.position, { y: 0 }, 0.25, { ease: 'outBounce' });
          go('P4b');
        });
      },
    };
  }
  function berryHandlers(b) {
    let home = null;
    return {
      down(ev) {
        if (step !== 'P4c' || b.parent !== tub || carry.obj) { hop(b, 0.004, 'place', 0.35, 1.2); return; }
        home = { parent: tub, pos: b.position.clone(), quat: b.quaternion.clone() };
        beginCarry(b, ev, 0.08, 'berry');
        hints.poke();
      },
      move(ev) { if (carry.obj === b) aim(ev); },
      up(ev) {
        if (carry.obj !== b) return;
        const drop = carry.tgt.clone();
        endCarry();
        const onTub = Math.hypot(drop.x - TUB_SPOT.x, drop.z - TUB_SPOT.z) < 0.065;
        if (ev.cancelled || onTub || step !== 'P4c') { returnHome(b, home, () => setHintBerry()); return; }
        berryDone = true;
        hints.clear();
        eatAnim(b);
        enqueueMama('strawberry');
        checkProgress();
      },
    };
  }

  // ---- 組み立て（enter のたび）----
  function build() {
    for (const c of dyn.children.slice()) dyn.remove(c);
    sink.length = 0;
    lidState.clear();
    const day = state.day | 0;
    const shake = Number.isFinite(state.shake) ? Math.min(1, Math.max(0, state.shake)) : 0;

    child = createBento('child'); cApi = child.userData.api;
    child.position.copy(CHILD_POS); dyn.add(child);
    cApi.setRiceNow(1);
    cApi.setFurikake(state.furikake || []);
    const slots = Array.isArray(state.slots) ? state.slots : [];
    for (let i = 0; i < 6; i++) if (slots[i]) cApi.place(createFood(slots[i], 1), i);
    cApi.applyShake(shake, day + 1);
    cApi.setInteriorVisible(false);

    mama = createBento('mama'); mApi = mama.userData.api;
    mama.position.copy(MAMA_POS); dyn.add(mama);
    mApi.setRiceNow(1);
    mApi.drawShape(MAMA_SHAPES[day % MAMA_SHAPES.length]);
    for (let i = 0; i < 6; i++) if (MAMA_SLOTS[i]) mApi.place(createFood(MAMA_SLOTS[i], 1.12), i);
    mApi.applyShake(shake, day + 1);
    mApi.setInteriorVisible(false);

    for (const [b, api] of [[child, cApi], [mama, mApi]]) {
      const f = api.items[5];
      if (f) sink.push({ api, obj: f, y0: f.position.y, top0: api.riceTopLocal(V(0, 0, 0)).y });
    }
    totalFoods = cApi.items.filter(Boolean).length;
    childLid = cApi.lid; mamaLid = mApi.lid;
    lidState.set(childLid, 'closed'); lidState.set(mamaLid, 'closed');

    riceProxy = new THREE.Object3D();
    cApi.riceTopLocal(riceProxy.position);
    child.add(riceProxy);

    tote = createToteBag(); tApi = tote.userData.api;
    // 薄い布の自己影で胴が真っ暗になるのを防ぐ（影は落とすが受けない）
    tote.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
    tote.position.copy(TOTE_POS); tote.rotation.y = 0.35;
    tApi.setHandles(0);
    dyn.add(tote);

    tub = createDessertTub(); tubApi = tub.userData.api;
    tub.visible = false; tubState = 'hidden';
    tubLid = tubApi.lid;
    lidState.set(tubLid, 'closed');
    dyn.add(tub);

    chop = createChopsticks(); chopApi = chop.userData.api;
    chop.quaternion.setFromUnitVectors(V(0, 1, 0), chopDir);
    chop.visible = false;
    dyn.add(chop);

    riceEaten = 0; riceOut = false; mamaRice = 0; eatenFoods = 0;
    mamaPending = 0; mamaChain = Promise.resolve();
    berryDone = false; finished = false;
    carry.obj = null; carry.kind = '';
    engine.applyQuality(group);
  }

  function addHandles() {
    const add = (obj, opts) => { const h = input.add(obj, opts); hs.push(h); if (opts.bind) opts.bind(h); return h; };
    // ふた
    add(childLid, Object.assign({ radius: 0.09, priority: 3, center: () => worldPos(childLid, V(0, 0, 0)).add(V(0, 0.01, 0)) },
      lidHandlers(childLid, child, cApi, () => step === 'P1', CHILD_LID_REST, -0.12, 'popBig', () => go('P1open'))));
    add(mamaLid, Object.assign({ radius: 0.1, priority: 3, center: () => worldPos(mamaLid, V(0, 0, 0)).add(V(0, 0.01, 0)) },
      lidHandlers(mamaLid, mama, mApi, () => step === 'P2', MAMA_LID_REST, 0.1, 'pop', () => go('P2open'))));
    const tubLidH = lidHandlers(tubLid, tub, { lidClosedY: tubApi.lidClosedY }, () => step === 'P4b', TUB_LID_REST, 0.4, 'pop', () => go('P4c'));
    add(tubLid, Object.assign({ radius: 0.05, priority: 4, pad: 26, center: () => worldPos(tubLid, V(0, 0, 0)) }, tubLidH));
    // 箱
    add(child, Object.assign({ radius: 0.095, priority: 2, center: () => worldPos(child, V(0, 0, 0)).add(V(0, 0.03, 0)) }, childBoxHandlers()));
    add(mama, {
      radius: 0.1, priority: 1, center: () => worldPos(mama, V(0, 0, 0)).add(V(0, 0.03, 0)),
      down() { if (lidState.get(mamaLid) === 'closed' && step !== 'P2') hop(mamaLid, 0.004, 'tick', 0.45); else if (lidState.get(mamaLid) !== 'held') hop(mama, 0.003, 'tick', 0.4, 0.9); },
    });
    // バッグ
    add(tote, {
      radius: 0.14, priority: 0, center: () => tote.localToWorld(V(0, 0.1, 0)),
      down() {
        if (step === 'P5ready' && !finished) {
          finished = true;
          hints.clear();
          audio.play('cloth', { vol: 0.8 });
          tApi.setHandles(1);
          tApi.squash(0.5);
          tw.to(tote.position, { y: 0.06 }, 0.6, { ease: 'outCubic' });
          const tok = token;
          tw.wait(0.5).then(() => { if (tok === token) ctx.nextDay(); });
          return;
        }
        if (tubState === 'peek' || tubState === 'carried') return;
        audio.play('cloth', { vol: 0.45 });
        tApi.squash(0.35);
      },
    });
    tubH = add(tub, Object.assign({ radius: 0.055, priority: 5, pad: 26, center: () => worldPos(tub, V(0, 0, 0)).add(V(0, 0.025, 0)) }, tubHandlers()));
    berryHs = tubApi.berries.map((b) => add(b, Object.assign({ radius: 0.02, priority: 6, pad: 18, enabled: false, center: () => worldPos(b, V(0, 0, 0)).add(V(0, 0.012, 0)) }, berryHandlers(b))));
  }

  return {
    group, env: U.env, envIntensity: U.envIntensity, background, fog,
    enter() {
      life++;
      tw = tweens.scope();
      fog.color.copy(U.fogColor);
      U.setWarmth(0);
      background.copy(U.fogColor); fog.color.copy(U.fogColor);
      U.leaves.setRate(0.05);
      build();
      addHandles();
      audio.setMusic('picnic');
      audio.setAmbience('park');
      go('P1');
    },
    exit() {
      life++; token++;
      for (const h of hs) { try { h.remove(); } catch (e) { /* noop */ } }
      hs = [];
      if (tw) tw.killAll();
      carry.obj = null; carry.kind = '';
      U.leaves.setRate(0);
    },
    update(dt, t) {
      U.update(dt, t);
      if (!child) return;
      child.userData.update(dt, t);
      mama.userData.update(dt, t);
      tote.userData.update(dt, t);
      chop.userData.update(dt, t);
      if (tub.userData.update) tub.userData.update(dt, t);
      cApi.riceTopLocal(riceProxy.position);
      // ごはんが減ったら、上の物も一緒に下がる
      for (const s of sink) {
        if (s.obj.parent !== s.api.interior) continue;
        s.obj.position.y = s.y0 + (s.api.riceTopLocal(tmp2).y - s.top0);
      }
      updateCarry(dt);
      if (lastShot && shotSize !== engine.size.w + 'x' + engine.size.h) {
        // 画面の向きが変わった: 構図を解き直し、行き先が変わるステップはヒントも置き直す
        if (step === 'P3') { p3Shot(0); setHintP3(); } else if (step === 'P4c') { p4cShot(0); setHintBerry(); } else reshot();
      }
    },
  };
}
