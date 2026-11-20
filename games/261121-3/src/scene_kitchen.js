// scene_kitchen.js — 第1幕「朝の台所」。進行（K0〜K5）・操作・ヒント・構図。
//
// 公開 API
//   import { createKitchenScene } from './scene_kitchen.js';
//   const scene = createKitchenScene(ctx);   // ctx は game.js のもの
//   → { group, env, envIntensity, background, fog: null, enter(), exit(), update(dt, t) }
//   enter() は毎回 ctx.state から組み立て直す（台所は常に空の子どもの箱から。state.rice/furikake/slots も空に揃える）。
//   最後にバッグが持ち上がったら ctx.goto('walk')。
//
// 置き方（ワールド m。天板上面 y=0、遊ぶ人は +Z 側）
//   炊飯器 (0,0,-0.58) / 皿 (0,0,-0.25) / ママの箱 (-0.02,0,0.03) / 子どもの箱 (0,0,0.215)
//   ふりかけ (-0.175,0,0.115) / ふた: 子ども (0.185,0,0.235) ママ (0.215,0,0.035) / トート (0.40,0,-0.20)
//   菜箸は使わないとき画面左上の外（カメラから毎フレーム求め直す）
//
// ステップ: K0 炊飯器を開ける → K1 ごはん2回 → K2 ふりかけ（6回以上）→ K3 おかず5つ（ママとおなじ）
//           → K3b おなじ！の間 → K4 ふた2枚 → K5 バッグに2つ → 持ち上がる → walk
import * as THREE from 'three';
import { createKitchenSet, createRiceCooker, createSteam, createShamoji, createPlate, createShaker, createChopsticks, createToteBag } from './props_kitchen.js';
import { createBento, createFood, createRiceLump } from './props_food.js';
import { FOODS, MAMA_SLOTS, MAMA_SHAPES } from './state.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const POS = {
  cooker: V(0, 0, -0.58),
  plate: V(0, 0, -0.25),
  mama: V(-0.02, 0, 0.03),
  child: V(0, 0, 0.215),
  shaker: V(-0.175, 0, 0.115),
  childLid: V(0.16, 0, 0.238), childLidYaw: Math.PI / 2 - 0.07,
  mamaLid: V(0.168, 0, 0.022), mamaLidYaw: Math.PI / 2 + 0.05,
  tote: V(0.36, 0, -0.27), toteYaw: 0.25,
};
const LIFT_PX = 26;          // 運ぶ物は指より少し上に見せる
const SHOT_DIR = V(0, 1.22, 1); // 俯角 ≈ 51°
const FOOD_SOUND = { tamago: 1.15, karaage: 0.88, wiener: 1.25, broccoli: 1.0, tomato: 1.1 };

export function createKitchenScene(ctx) {
  const { engine, input, audio, hints, tweens, state } = ctx;
  const group = new THREE.Group();
  group.name = 'kitchenScene';
  const set = createKitchenSet(engine.renderer);
  group.add(set);

  // ---- enter ごとに作り直すもの ----
  let dyn = null, tw = null, hs = [];
  let cooker, steam, shamoji, plate, shaker, chop, tote, mama, child, childLid, mamaLid;
  let C, M; // child / mama bento api
  let childFoods = {}, mamaFoods = {};
  let step = '', token = 0;
  let carry = null;
  let flags = {};
  let hintKey = '';
  let mamaQ = [], mamaRunning = false, mamaDone = new Set(), mamaCur = null, chopFree = true;
  let pourOn = 0, lastSprinkleT = 0, sprinkleDist = 0, lastPX = 0, lastPY = 0;
  const tmpV = V(), tmpV2 = V(), tmpQ = new THREE.Quaternion();
  const box3 = new THREE.Box3();

  // ======================= 小さな道具 =======================
  function planePoint(x, y, py, out) {
    const r = engine.rayAt(x, y);
    if (Math.abs(r.direction.y) < 1e-5) return null;
    const k = (py - r.origin.y) / r.direction.y;
    if (k <= 0) return null;
    return out.copy(r.origin).addScaledVector(r.direction, k);
  }
  // 見た目の上で「どこの上にあるか」: 宙に浮いた点 p を画面上の位置のまま高さ y の面へ落とした点（視差を消す）
  function seen(p, y) {
    const sp = engine.project(p);
    return planePoint(sp.x, sp.y, y, V()) || V(p.x, y, p.z);
  }
  function worldPos(o, out = V()) { o.updateWorldMatrix(true, false); return o.getWorldPosition(out); }
  function worldQuat(o, out = new THREE.Quaternion()) { o.updateWorldMatrix(true, false); return o.getWorldQuaternion(out); }
  function yawQ(a) { return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, a); }

  function stopWiggle(obj) {
    const u = obj.userData;
    if (u.wig) { tw.kill(u.wig.tag); obj.rotation[u.wig.axis] = u.wig.base; u.wig = null; }
    if (u.squish) { tw.kill(u.squish.tag); obj.scale.setScalar(u.squish.s); u.squish = null; }
  }
  function wiggle(obj, amp = 0.06, axis = 'z', dur = 0.55, n = 2.5) {
    if (obj.userData.busy) return;
    stopWiggle(obj);
    const base = obj.rotation[axis], tag = {};
    obj.userData.wig = { axis, base, tag };
    tw.value({ dur, ease: 'linear', tag, onUpdate: (k) => { obj.rotation[axis] = base + amp * Math.sin(k * Math.PI * 2 * n) * (1 - k) * (1 - k); }, onDone: () => { obj.rotation[axis] = base; obj.userData.wig = null; } });
  }
  function squish(obj, amt = 0.12) {
    if (obj.userData.busy) return;
    stopWiggle(obj);
    const s = obj.scale.x, tag = {};
    obj.userData.squish = { s, tag };
    tw.value({ dur: 0.5, ease: 'linear', tag, onUpdate: (k) => { const w = Math.sin(k * Math.PI * 3) * (1 - k) * amt; obj.scale.set(s * (1 + w * 0.6), s * (1 - w), s * (1 + w * 0.6)); }, onDone: () => { obj.scale.setScalar(s); obj.userData.squish = null; } });
  }
  function bump(obj, amt = 0.05) { // 箱が小さく沈んで戻る
    tw.kill(obj.scale);
    obj.scale.set(1, 1, 1);
    tw.to(obj.scale, { x: 1 + amt * 0.4, y: 1 - amt, z: 1 + amt * 0.4 }, 0.06, { ease: 'outQuad' }).promise.then(() => tw.to(obj.scale, { x: 1, y: 1, z: 1 }, 0.45, { ease: 'outElastic' }));
  }
  // dyn 座標（=ワールド）での弧を描く移動
  function arcTo(obj, toPos, toQuat, dur, lift = 0, e = 'inOutCubic') {
    stopWiggle(obj);
    tw.kill(obj);
    const p0 = obj.position.clone(), q0 = obj.quaternion.clone(), p1 = toPos.clone(), q1 = toQuat ? toQuat.clone() : null;
    return tw.value({ dur, ease: e, tag: obj, onUpdate: (k) => {
      obj.position.lerpVectors(p0, p1, k);
      obj.position.y += Math.sin(Math.PI * clamp(k, 0, 1)) * lift;
      if (q1) obj.quaternion.slerpQuaternions(q0, q1, clamp(k, 0, 1));
    } }).promise;
  }
  function addHandle(obj, opts) { opts.basePri = opts.priority || 0; const h = input.add(obj, opts); hs.push(h); return h; }
  // いまの主役の当たり判定を最優先にする（小さく映る横画面でも、近くの別の物に指を取られない）
  const FOCUS = { K0: ['cooker'], K1: ['shamoji'], K2: ['shaker'], K3: ['childFood'], K4: ['lid'], K5: ['bento'] };
  function applyFocus() {
    const f = FOCUS[step] || [];
    for (const h of hs) h.opts.priority = h.opts.basePri + (f.includes(h.opts.role) ? 10 : 0);
  }
  function cornersOf(objs, pad = 0) {
    const pts = [];
    for (const o of objs) {
      if (!o) continue;
      if (o.isVector3) { pts.push(o.clone()); continue; }
      o.updateWorldMatrix(true, true);
      box3.setFromObject(o);
      if (box3.isEmpty()) continue;
      box3.expandByScalar(pad);
      const a = box3.min, b = box3.max;
      for (let i = 0; i < 8; i++) pts.push(V(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z));
    }
    return pts;
  }
  // 構図: objs が収まる最小の距離。縦長の画面では余る縦の余白を「奥」側に回し、手前の物が画面下寄りに大きく映るようにする
  let lastShot = null, lastAspect = 0;
  function shot(objs, dur = 0.8, opts = {}) {
    lastShot = { objs, opts };
    doShot(dur);
  }
  function doShot(dur) {
    if (!lastShot) return;
    const { objs, opts } = lastShot;
    const { pad = 0.01, margin = 0.05, fill = 0.8 } = opts;
    let dir = opts.dir || SHOT_DIR;
    // 横長の画面では俯角を少し浅く（≈45°）して奥行きを縮め、物を大きく映す
    if (engine.size.w > engine.size.h) dir = V(dir.x, dir.y * 0.82, dir.z);
    const pts = cornersOf(objs, pad);
    if (!pts.length) return;
    const bb = new THREE.Box3().setFromPoints(pts);
    const asp = engine.size.w / Math.max(1, engine.size.h);
    lastAspect = asp;
    const sinT = dir.y / dir.length();
    const width = bb.max.x - bb.min.x;
    const needDepth = (width / asp) / sinT * fill - (bb.max.y - bb.min.y) * 0.6;
    if (opts.anchor !== false && needDepth > bb.max.z - bb.min.z) {
      const back = V((bb.min.x + bb.max.x) / 2, 0, bb.max.z - needDepth);
      pts.push(back);
      bb.expandByPoint(back);
    }
    const tgt = bb.getCenter(V());
    engine.setShot({ target: tgt, dir, points: pts, fov: 38, margin }, dur);
  }

  // ======================= 菜箸（ママ） =======================
  const chopDir = V(-0.55, 0.74, 0.38).normalize();
  const chopQuat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, chopDir);
  function chopRest(out = V()) {
    const w = engine.size.w, h = engine.size.h;
    const p = planePoint(-0.22 * w - 40, 0.08 * h, 0.16, out);
    if (!p) return out.set(-0.6, 0.4, -0.2);
    return p;
  }
  function chopTo(p, dur, lift = 0.04, e = 'inOutCubic') { chop.visible = true; return arcTo(chop, p, chopQuat, dur, lift, e); }

  async function mamaPlace(type) {
    const food = mamaFoods[type];
    const fd = food.userData.food;
    const slot = MAMA_SLOTS.indexOf(type);
    chop.userData.api.setGrip(0);
    const grab = worldPos(food).add(V(0, fd.height * 0.55, 0));
    await chopTo(grab.clone().add(V(0, 0.03, 0)), 0.45, 0.05);
    await chopTo(grab, 0.12, 0, 'outCubic');
    chop.userData.api.setGrip(1, clamp(fd.radius * 1.5, 0.012, 0.03));
    audio.play('tick', { vol: 0.35, rate: 1.3, pan: -0.3 });
    await tw.wait(0.1);
    food.userData.busy = true;
    stopWiggle(food);
    chop.attach(food);
    const dst = M.slotWorld(slot).add(V(0, fd.height * 0.55 + 0.003, 0));
    await chopTo(dst, 0.6, 0.07);
    M.place(food, slot);
    food.userData.busy = false;
    audio.play(type === 'tomato' ? 'roll' : 'place', { rate: FOOD_SOUND[type] * 0.95, vol: 0.8, pan: -0.15 });
    chop.userData.api.setGrip(0);
    await chopTo(dst.clone().add(V(-0.02, 0.05, 0.01)), 0.14, 0, 'outCubic');
  }
  function mamaEnqueue(type) {
    if (mamaDone.has(type) || mamaQ.includes(type) || mamaCur === type) return;
    mamaQ.push(type);
    if (!mamaRunning) runMama();
  }
  async function runMama() {
    mamaRunning = true; chopFree = false;
    while (mamaQ.length) {
      const f = mamaQ.shift();
      mamaCur = f;
      await mamaPlace(f);
      mamaDone.add(f); mamaCur = null;
      refreshHint();
    }
    await chopTo(chopRest(), 0.45, 0.02);
    mamaRunning = false; chopFree = true;
    checkK3();
  }
  async function chopPoke(point) {
    if (!chopFree || carry) return false;
    chopFree = false;
    chop.userData.api.setGrip(0.4);
    const above = point.clone().add(V(0, 0.035, 0));
    await chopTo(above, 0.5, 0.04);
    for (let i = 0; i < 2; i++) {
      await chopTo(point, 0.08, 0, 'inCubic');
      audio.play('tick', { vol: 0.7, rate: 1.05 });
      await chopTo(above, 0.14, 0, 'outCubic');
    }
    await tw.wait(0.15);
    await chopTo(chopRest(), 0.5, 0.03);
    chopFree = true;
    return true;
  }

  // ======================= 運ぶ（共通の手ざわり） =======================
  // opts: { obj, y, quat (持っている間の姿勢), offset?: Vector3 (指の点→物の原点), onMove?(ev,c), onDrop(ev,c) }
  function startCarry(ev, opts) {
    const obj = opts.obj;
    stopWiggle(obj);
    tw.kill(obj);
    dyn.attach(obj);
    obj.userData.busy = false;
    const c = Object.assign({ offset: V(), quat: obj.quaternion.clone() }, opts, {
      target: obj.position.clone(), finger: obj.position.clone(), q0: obj.quaternion.clone(), blend: 0,
      vel: V(), lean: V(), t: 0, moved: false, sx: ev.x, sy: ev.y,
      fingerAt(y) { return planePoint(this.sx, this.sy, y, V()) || V(this.finger.x, y, this.finger.z); },
    });
    carry = c;
    updateCarryTarget(ev);
    obj.position.lerp(c.target, 0.4); // 同じフレームで持ち上がる
    audio.play('pick', { rate: opts.pickRate || 1 });
    return c;
  }
  function updateCarryTarget(ev) {
    const c = carry; if (!c) return;
    c.sx = ev.x; c.sy = ev.y;
    if (planePoint(ev.x, ev.y - LIFT_PX, c.y, tmpV)) { c.finger.copy(tmpV); c.target.copy(tmpV).add(c.offset); }
    if (ev.dist > 16) c.moved = true;
  }
  function carryMove(ev) { if (!carry) return; updateCarryTarget(ev); if (carry.onMove) carry.onMove(ev, carry); }
  function carryUp(ev) {
    const c = carry; if (!c) return;
    carry = null;
    if (!ev.cancelled) updateCarryTarget(ev);
    c.cancelled = !!ev.cancelled;
    try { c.onDrop(ev, c); } catch (e) { console.error(e); }
  }
  function carryHandlers(begin) {
    // begin(ev) → startCarry した c か null（null なら軽い反応だけ）
    let mine = false;
    return {
      down(ev) { mine = !carry && !!begin(ev); },
      move(ev) { if (mine) carryMove(ev); },
      up(ev) { if (mine) { mine = false; carryUp(ev); } },
    };
  }
  function updateCarry(dt, t) {
    const c = carry; if (!c) return;
    const o = c.obj;
    c.t += dt;
    tmpV2.copy(o.position);
    const k = 1 - Math.exp(-dt * 26);
    o.position.lerp(c.target, k);
    if (dt > 0) { tmpV2.subVectors(o.position, tmpV2).divideScalar(dt); c.vel.lerp(tmpV2, 1 - Math.exp(-dt * 12)); }
    c.blend = Math.min(1, c.blend + dt / 0.16);
    const lx = clamp(c.vel.z * 0.9, -0.28, 0.28), lz = clamp(-c.vel.x * 0.9, -0.28, 0.28);
    const sway = Math.min(1, c.vel.length() * 4) * 0.03 * Math.sin(t * 9);
    c.lean.x += (lx - c.lean.x) * Math.min(1, dt * 10);
    c.lean.z += (lz + sway - c.lean.z) * Math.min(1, dt * 10);
    tmpQ.setFromEuler(new THREE.Euler(c.lean.x * (c.leanK || 1), 0, c.lean.z * (c.leanK || 1)));
    o.quaternion.slerpQuaternions(c.q0, c.quat, c.blend).premultiply(tmpQ);
    if (c.onFrame) c.onFrame(dt, c);
  }

  // ======================= 反応（主役でないとき） =======================
  function reactFood(food) {
    const type = food.userData.food.type;
    if (type === 'tamago') { audio.play('place', { rate: 1.5, vol: 0.4 }); squish(food, 0.14); }
    else if (type === 'tomato') { audio.play('roll', { vol: 0.6 }); wiggle(food, 0.35, 'x', 0.7, 2); }
    else if (type === 'broccoli') { audio.play('cloth', { vol: 0.35, rate: 1.6 }); wiggle(food, 0.12, 'z', 0.5, 3); }
    else if (type === 'wiener') { audio.play('place', { rate: 1.3, vol: 0.45 }); wiggle(food, 0.18, 'y', 0.5, 2); }
    else { audio.play('place', { rate: 0.9, vol: 0.45 }); wiggle(food, 0.12, 'z', 0.5, 2); }
  }
  function reactBento(b) {
    audio.play('tick', { vol: 0.6, rate: b === mama ? 0.85 : 1.0 });
    wiggle(b, 0.035, 'z', 0.45, 2);
  }
  function reactCooker() {
    const api = cooker.userData.api;
    if (api.isOpen) {
      api.lidBounce();
      steam.userData.api.emit(cooker.localToWorld(api.riceCenterLocal.clone()).add(V(0, 0.02, 0)), 8, { spread: 0.05, speed: 0.22, size: 0.06 });
      audio.play('steam', { vol: 0.35 });
    } else {
      audio.play('tick', { vol: 0.5, rate: 0.8 });
      wiggle(cooker, 0.02, 'z', 0.4, 2);
    }
  }

  // ======================= ヒント =======================
  function setHint(key, o) {
    if (key === hintKey) return;
    hintKey = key;
    if (!o) { hints.clear(); return; }
    hints.set(o);
  }
  function nudgeFor(obj, react, pokeAt) {
    return (level) => {
      if (level >= 2 && pokeAt && chopFree && !carry) { chopPoke(pokeAt()); react(1); return; }
      react(level);
    };
  }
  function pokeBeside(obj, dx = -0.035) {
    return () => {
      obj.updateWorldMatrix(true, true);
      box3.setFromObject(obj);
      const c = box3.getCenter(V());
      return V(box3.min.x + dx, Math.max(0, box3.min.y) + 0.002, c.z);
    };
  }
  function riceTopWorld() { return child.localToWorld(C.riceTopLocal(V())).add(V(0, 0.002, 0)); }
  function nextGuide() { for (const f of FOODS) if (!state.slots.includes(f)) return f; return null; }
  function firstFreeSlot() { for (let i = 0; i < 5; i++) if (!C.items[i]) return i; return C.items[5] ? 0 : 5; }

  function refreshHint() {
    const s = step;
    if (s === 'K0') {
      const btn = cooker.userData.api.button;
      setHint('K0', { target: btn, gesture: 'tap', radius: 0.04,
        nudge: nudgeFor(btn, () => { audio.play('tick', { vol: 0.6, rate: 0.9 }); wiggle(cooker, 0.025, 'z', 0.45, 2); }, () => cooker.localToWorld(V(-0.05, 0.215, 0.06))) });
    } else if (s === 'K1') {
      if (flags.shamojiBusy) { setHint('K1-busy', null); return; }
      setHint('K1', { target: shamoji, gesture: 'drag', dest: child, radius: 0.06, destRadius: 0.05,
        tip: () => shamojiGrip(), destPoint: () => riceTopWorld(),
        nudge: nudgeFor(shamoji, () => { audio.play('tick', { vol: 0.6 }); cooker.userData.api.lidBounce(); wiggle(shamoji, 0.06, 'y', 0.45, 2); }, () => cooker.localToWorld(V(0.06, 0.16, 0.08))) });
    } else if (s === 'K2') {
      if (flags.shakerBusy) { setHint('K2-busy', null); return; }
      setHint('K2', { target: shaker, gesture: 'drag', dest: child, radius: 0.04, destRadius: 0.045,
        destPoint: () => riceTopWorld(),
        nudge: nudgeFor(shaker, () => { audio.play('shake', { vol: 0.5 }); wiggle(shaker, 0.14, 'z', 0.5, 3); }, pokeBeside(shaker)) });
    } else if (s === 'K3') {
      const g = nextGuide();
      if (g !== flags.guide) { flags.guide = g; flags.childActed = false; }
      if (!g || !(mamaDone.has(g) || flags.childActed)) { setHint('K3-wait', null); return; }
      const f = childFoods[g];
      if (f.userData.busy) { setHint('K3-busy', null); return; }
      setHint('K3-' + g, { target: f, gesture: 'drag', dest: child, radius: 0.028, destRadius: 0.035,
        destPoint: () => C.slotWorld(firstFreeSlot()),
        nudge: nudgeFor(f, () => reactFood(f), () => worldPos(f).add(V(-0.03, 0.001, 0.018))) });
    } else if (s === 'K4') {
      const lid = !flags.closed.child ? childLid : !flags.closed.mama ? mamaLid : null;
      const b = lid === childLid ? child : mama;
      if (!lid || lid.userData.busy) { setHint('K4-wait', null); return; }
      setHint('K4-' + (lid === childLid ? 'c' : 'm'), { target: lid, gesture: 'drag', dest: b, radius: 0.07, destRadius: 0.075,
        destPoint: () => worldPos(b).add(V(0, b.userData.api.size.h, 0)),
        nudge: nudgeFor(lid, () => { audio.play('tick', { vol: 0.6, rate: 1.2 }); wiggle(lid, 0.05, 'z', 0.45, 2); }, pokeBeside(lid, 0.0)) });
    } else if (s === 'K5') {
      const b = !flags.bagged.has('mama') ? mama : !flags.bagged.has('child') ? child : null;
      if (!b || b.userData.busy) { setHint('K5-wait', null); return; }
      setHint('K5-' + (b === mama ? 'm' : 'c'), { target: b, gesture: 'drag', dest: tote, radius: 0.08, destRadius: 0.1,
        destPoint: () => tote.localToWorld(V(0, 0.2, 0)),
        nudge: nudgeFor(b, () => reactBento(b), pokeBeside(b)) });
    } else setHint('none', null);
  }

  // ======================= ステップ =======================
  function go(s) {
    token++;
    step = s;
    const tok = token;
    applyFocus();
    const f = STEP[s];
    if (f) f(tok);
    refreshHint();
  }
  const alive = (tok) => tok === token;

  const STEP = {
    K0() {
      shot([cooker, plate, mama, child], 0);
    },
    K1() {
      shot([cooker, child, mama], 0.8, { pad: 0.0 });
    },
    K2() {
      audio.steamHiss(false);
      shot([mama, child, shaker], 0.8, { pad: 0.012 });
    },
    K3() {
      shot([plate, mama, child], 0.8, { pad: 0.005 });
      mamaEnqueue(FOODS[0]);
    },
    async K3b(tok) {
      shot([mama, child], 0.7, { pad: 0.02 });
      await tw.wait(0.35);
      if (!alive(tok)) return;
      audio.play('same');
      await tw.wait(0.8);
      if (!alive(tok)) return;
      go('K4');
    },
    K4() {
      shot([mama, child, childLid, mamaLid], 0.8, { pad: 0.01 });
    },
    K5() {
      const tb = [];
      for (const x of [-0.14, 0.14]) for (const z of [-0.08, 0.08]) for (const y of [0, 0.21]) tb.push(tote.localToWorld(V(x, y, z)));
      // 左手前から見る構図へ回り込む（右奥のバッグが箱の真上に並び、縦長の画面に収まる）
      shot([mama, child, ...tb], 1.0, { pad: 0.01, dir: V(-0.55, 1.3, 1), anchor: false });
    },
    async K6(tok) { // バッグが持ち上がる
      const api = tote.userData.api;
      const tb = [];
      for (const x of [-0.14, 0.14]) for (const z of [-0.08, 0.08]) for (const y of [0, 0.75]) tb.push(tote.localToWorld(V(x, y, z)));
      shot([...tb], 1.2, { pad: 0.02, dir: V(-0.55, 1.0, 1), anchor: false, margin: 0.12 });
      await tw.wait(0.25);
      api.setHandles(1);
      audio.play('cloth', { vol: 0.9 });
      await tw.wait(0.55);
      if (!alive(tok)) return;
      audio.play('whoosh', { vol: 0.5 });
      const y0 = tote.position.y, r0 = tote.rotation.z;
      await tw.value({ dur: 0.9, ease: 'inOutCubic', onUpdate: (k) => {
        tote.position.y = y0 + 0.55 * k;
        tote.rotation.z = r0 + 0.06 * Math.sin(k * Math.PI * 2.2) * (1 - k * 0.5);
      } }).promise;
      if (!alive(tok)) return;
      ctx.goto('walk');
    },
  };

  // ---- K0: 炊飯器を開ける ----
  function openCooker() {
    const api = cooker.userData.api;
    if (flags.cookerOpen) return;
    flags.cookerOpen = true;
    api.pressButton();
    audio.play('press');
    api.open();
    audio.play('pop', { delay: 0.05 });
    audio.play('steam', { delay: 0.08 });
    api.lamp(false);
    const origin = cooker.localToWorld(api.riceCenterLocal.clone()).add(V(0, 0.02, 0));
    steam.userData.api.emit(origin, Math.round(36 * (engine.quality.particleScale || 1)), { spread: 0.07, speed: 0.34, size: 0.08 });
    flags.wispRate = 1.5;
    engine.shake(0.006, 0.3);
    setHint('K0-done', null);
    const tok = token;
    tw.wait(0.22).then(() => { shamoji.visible = true; });
    tw.wait(0.5).then(() => { if (alive(tok)) go('K1'); });
  }

  // ---- K1: しゃもじ ----
  function shamojiRestPose() {
    const api = cooker.userData.api;
    cooker.updateWorldMatrix(true, false);
    return { p: cooker.localToWorld(api.shamojiRest.position.clone()), q: cooker.quaternion.clone().multiply(api.shamojiRest.quaternion) };
  }
  const shamojiCarryQ = yawQ(0.5).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.28));
  const SHAMOJI_GRIP = 0.075;
  function shamojiGrip() { return shamoji.localToWorld(V(0, 0.004, SHAMOJI_GRIP)); }
  function beginShamoji(ev) {
    if (step !== 'K1' || flags.shamojiBusy) { if (flags.cookerOpen && !flags.shamojiBusy) { audio.play('tick', { vol: 0.5 }); wiggle(shamoji, 0.05, 'y'); } return null; }
    if (!flags.shamojiLoaded) {
      cooker.userData.api.takeScoop();
      shamoji.userData.api.setLoaded(true);
      flags.shamojiLoaded = true;
      audio.play('scoop');
    }
    const hd = V(0, 0, SHAMOJI_GRIP).applyQuaternion(shamojiCarryQ); hd.y = 0;
    return startCarry(ev, { obj: shamoji, y: 0.10, quat: shamojiCarryQ, offset: hd.negate(), leanK: 0.6, onDrop: dropShamoji });
  }
  async function dropShamoji(ev, c) {
    const head = shamoji.position;
    const over = !c.cancelled && (C.containsXZ(seen(head, 0.04), 0.06) || C.containsXZ(c.fingerAt(0.04), 0.04));
    const rest = shamojiRestPose();
    if (!over) {
      if (c.moved) audio.play('boing');
      shamoji.userData.busy = true;
      await arcTo(shamoji, rest.p, rest.q, 0.5, 0.05, 'outCubic');
      shamoji.userData.busy = false;
      return;
    }
    flags.shamojiBusy = true; shamoji.userData.busy = true;
    refreshHint();
    const tok = token;
    const rt = riceTopWorld();
    const above = rt.clone().add(V(0.005, 0.075, 0));
    const tilt = shamojiCarryQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5));
    await arcTo(shamoji, above, tilt, 0.22, 0.01, 'outCubic');
    // ごはんのかたまりが落ちる
    shamoji.userData.api.setLoaded(false);
    flags.shamojiLoaded = false;
    const lump = createRiceLump(0.048);
    lump.position.copy(shamoji.position).add(V(0, -0.012, 0));
    lump.rotation.y = 0.4;
    dyn.add(lump);
    const n = state.rice + 1;
    const land = riceTopWorld().add(V(0, n === 1 ? -0.012 : -0.006, 0));
    await tw.to(lump.position, { x: land.x, y: land.y, z: land.z }, 0.2, { ease: 'inCubic' }).promise;
    audio.play('plop');
    state.rice = Math.min(2, n);
    C.setRice(state.rice / 2);
    bump(child, 0.04);
    tw.to(lump.scale, { x: 1.5, y: 0.25, z: 1.5 }, 0.22, { ease: 'outCubic' }).promise.then(() => { dyn.remove(lump); });
    await arcTo(shamoji, rest.p, rest.q, 0.55, 0.06, 'inOutCubic');
    audio.play('tick', { vol: 0.4, rate: 0.9 });
    shamoji.userData.busy = false;
    flags.shamojiBusy = false;
    if (!alive(tok)) return;
    if (state.rice >= 2) go('K2'); else refreshHint();
  }

  // ---- K2: ふりかけ ----
  function shakerUsable() { return (step === 'K2' || step === 'K3' || step === 'K3b' || step === 'K4') && !flags.closed.child && !flags.shakerBusy; }
  function beginShaker(ev) {
    if (!shakerUsable()) { audio.play('tick', { vol: 0.5, rate: 1.6 }); wiggle(shaker, 0.1, 'z', 0.5, 3); return null; }
    pourOn = 0; sprinkleDist = 0; lastPX = ev.x; lastPY = ev.y; lastSprinkleT = 0;
    flags.sprinkledThisCarry = 0;
    return startCarry(ev, { obj: shaker, y: 0.08, quat: new THREE.Quaternion(), leanK: 0.5, pickRate: 1.2,
      onMove: (e) => { sprinkleDist += Math.hypot(e.x - lastPX, e.y - lastPY); lastPX = e.x; lastPY = e.y; },
      onFrame: shakerFrame, onDrop: dropShaker });
  }
  function shakerFrame(dt, c) {
    const api = shaker.userData.api;
    const riceY = riceTopWorld().y;
    // びんの口の「見た目の位置」か、指そのものが、ごはんの上にあれば振り出す（指をごはんに置く子も、びんを重ねる子も通る）
    let uv = C.worldToRiceUV(seen(api.capWorld(tmpV2), riceY));
    const inR = (q, m) => q.u > -m && q.u < 1 + m && q.v > -m && q.v < 1 + m;
    let over = !flags.closed.child && inR(uv, 0.04);
    if (!over && !flags.closed.child) {
      const fu = C.worldToRiceUV(c.fingerAt(riceY));
      if (inR(fu, 0.12)) { over = true; uv = fu; }
    }
    api.setPour(over ? 1 : 0);
    pourOn = over ? pourOn + dt : 0;
    lastSprinkleT += dt;
    if (pourOn > 0.16) {
      const moving = sprinkleDist >= 10 && lastSprinkleT >= 1 / 14;
      const still = lastSprinkleT >= 0.28;
      if (moving || still) {
        sprinkleDist = 0; lastSprinkleT = 0;
        api.emitGrains(Math.round(5 * (engine.quality.particleScale || 1)) + 1);
        audio.play('shake', { vol: 0.55, rate: 0.9 + Math.random() * 0.25 });
        if (state.furikake.length < 400) {
          const e = C.sprinkle(clamp(uv.u, 0, 1), clamp(uv.v, 0, 1));
          state.furikake.push({ u: e.u, v: e.v, c: e.c });
        }
        flags.sprinkledThisCarry++;
      }
    }
  }
  async function dropShaker(ev, c) {
    const api = shaker.userData.api;
    api.setPour(0);
    flags.shakerBusy = true; shaker.userData.busy = true;
    if (!flags.sprinkledThisCarry && c.moved) audio.play('boing');
    refreshHint();
    const tok = token;
    await arcTo(shaker, POS.shaker, new THREE.Quaternion(), 0.5, 0.04, 'inOutCubic');
    audio.play('place', { rate: 1.4, vol: 0.5 });
    shaker.userData.busy = false; flags.shakerBusy = false;
    if (!alive(tok)) return;
    if (step === 'K2' && state.furikake.length >= 6) go('K3'); else refreshHint();
  }

  // ---- K3: おかず ----
  function foodCenter(f) { return () => worldPos(f, V()).add(V(0, f.userData.food.height * 0.5, 0)); }
  function beginChildFood(food) {
    return (ev) => {
      const k = food.userData.k;
      if (step === 'K3') flags.childActed = true;
      if (step !== 'K3' || food.userData.busy || flags.closed.child) { reactFood(food); if (step === 'K3') refreshHint(); return null; }
      if (k.slot >= 0) { C.take(k.slot); state.slots[k.slot] = null; k.from = k.slot; k.slot = -1; } else k.from = -1;
      setHint('K3-carry', null);
      return startCarry(ev, { obj: food, y: 0.07, quat: food.quaternion.clone(), leanK: 1, pickRate: FOOD_SOUND[k.type], onDrop: (e, c) => dropChildFood(food, c) });
    };
  }
  function clampIntoBox(b, p) {
    const api = b.userData.api;
    const lp = b.worldToLocal(p.clone());
    lp.x = clamp(lp.x, -api.size.w / 2, api.size.w / 2); lp.z = clamp(lp.z, -api.size.d / 2, api.size.d / 2);
    return b.localToWorld(lp);
  }
  function dropChildFood(food, c) {
    const k = food.userData.k;
    const p = seen(food.position, 0.035), fp = c.fingerAt(0.035);
    const over = !c.cancelled && !flags.closed.child && (C.containsXZ(p, 0.05) || C.containsXZ(fp, 0.03));
    if (over) {
      const q = clampIntoBox(child, C.containsXZ(p, 0.05) ? p : fp);
      let i = C.nearestSlot(q, () => true);
      if (i < 0) i = C.nearestSlot(q, (j) => !C.items[j]);
      const occ = C.items[i];
      if (occ && occ !== food) {
        if (k.from >= 0) { // 入れ替え
          const ok = occ.userData.k;
          C.take(i); state.slots[i] = null;
          dyn.attach(occ);
          moveToSlot(occ, k.from, false);
          ok.slot = k.from;
        } else i = C.nearestSlot(q, (j) => !C.items[j]);
      }
      moveToSlot(food, i, true);
    } else if (k.from >= 0) {
      if (c.moved) audio.play('boing');
      moveToSlot(food, k.from, false);
    } else {
      if (c.moved) audio.play('boing');
      food.userData.busy = true;
      arcTo(food, k.home, k.homeQ, 0.5, 0.04, 'outCubic').then(() => { food.userData.busy = false; refreshHint(); });
      refreshHint();
    }
  }
  async function moveToSlot(food, i, fresh) {
    const k = food.userData.k;
    const p0 = food.position.clone(), q0 = food.quaternion.clone();
    C.place(food, i);
    state.slots[i] = k.type; k.slot = i;
    const p1 = worldPos(food), q1 = worldQuat(food);
    dyn.attach(food);
    food.position.copy(p0); food.quaternion.copy(q0);
    food.userData.busy = true;
    refreshHint();
    const tok = token;
    await arcTo(food, p1, q1, fresh ? 0.24 : 0.4, fresh ? 0.018 : 0.03, 'outCubic');
    if (C.items[i] === food) C.place(food, i);
    food.userData.busy = false;
    audio.play(k.type === 'tomato' ? 'roll' : 'place', { rate: FOOD_SOUND[k.type] });
    bump(child, 0.02);
    if (!alive(tok)) return;
    if (step === 'K3') { for (const t of FOODS) if (state.slots.includes(t)) mamaEnqueue(t); const g = nextGuide(); if (g) mamaEnqueue(g); }
    refreshHint();
    checkK3();
  }
  function checkK3() {
    if (step !== 'K3' || carry || mamaRunning) return;
    if (!FOODS.every((f) => state.slots.includes(f))) return;
    if (!FOODS.every((f) => mamaDone.has(f))) return;
    for (const f of Object.values(childFoods)) if (f.userData.busy) return;
    go('K3b');
  }

  // ---- K4: ふた ----
  function beginLid(lid, b, who) {
    return (ev) => {
      if (flags.closed[who] || lid.userData.busy) return null;
      if (step !== 'K4') { audio.play('tick', { vol: 0.5, rate: 1.2 }); wiggle(lid, 0.05, 'z'); return null; }
      setHint('K4-carry', null);
      return startCarry(ev, { obj: lid, y: 0.09, quat: new THREE.Quaternion(), leanK: 0.35, pickRate: 1.1, onDrop: (e, c) => dropLid(lid, b, who, c) });
    };
  }
  async function dropLid(lid, b, who, c) {
    const api = b.userData.api;
    const over = !c.cancelled && (api.containsXZ(seen(lid.position, 0.045), 0.06) || api.containsXZ(c.fingerAt(0.045), 0.03));
    lid.userData.busy = true;
    const tok = token;
    if (!over) {
      if (c.moved) audio.play('boing');
      await arcTo(lid, lid.userData.home, lid.userData.homeQ, 0.5, 0.04, 'outCubic');
      lid.userData.busy = false;
      refreshHint();
      return;
    }
    flags.closed[who] = true;
    const top = b.localToWorld(V(0, api.lidClosedY, 0));
    await arcTo(lid, top.clone().add(V(0, 0.025, 0)), b.quaternion, 0.18, 0.005, 'outCubic');
    await arcTo(lid, top, b.quaternion, 0.09, 0, 'inCubic');
    b.add(lid);
    lid.position.set(0, api.lidClosedY, 0); lid.quaternion.identity();
    api.setInteriorVisible(false);
    audio.play('snap', { rate: who === 'mama' ? 0.9 : 1.05 });
    bump(b, 0.05);
    lid.userData.busy = false;
    if (lidHandles[who]) lidHandles[who].enabled = false;
    if (!alive(tok)) return;
    if (flags.closed.child && flags.closed.mama) { await tw.wait(0.35); if (alive(tok)) go('K5'); }
    else refreshHint();
  }

  // ---- K5: バッグ ----
  function beginBento(b, who) {
    return (ev) => {
      if (step === 'K5' && !flags.bagged.has(who) && !b.userData.busy) {
        setHint('K5-carry', null);
        b.userData.home = b.position.clone();
        return startCarry(ev, { obj: b, y: 0.22, quat: new THREE.Quaternion(), leanK: 0.45, pickRate: 0.9, onDrop: (e, c) => dropBento(b, who, c) });
      }
      if (flags.bagged.has(who)) { audio.play('cloth', { vol: 0.5 }); tote.userData.api.squash(0.3); return null; }
      if (flags.closed[who]) { audio.play('tick', { vol: 0.55, rate: 1.15 }); wiggle(b.userData.api.lid, 0.05, 'z', 0.4); return null; }
      reactBento(b);
      return null;
    };
  }
  async function dropBento(b, who, c) {
    const near = (p) => {
      const lp = tote.worldToLocal(p.clone());
      return Math.abs(lp.x) < 0.135 + 0.09 && Math.abs(lp.z) < 0.075 + 0.09;
    };
    const over = !c.cancelled && (near(seen(b.position, 0.2)) || near(c.fingerAt(0.2)));
    b.userData.busy = true;
    const tok = token;
    if (!over) {
      if (c.moved) audio.play('boing');
      await arcTo(b, b.userData.home, new THREE.Quaternion(), 0.55, 0.04, 'outCubic');
      b.userData.busy = false;
      refreshHint();
      return;
    }
    flags.bagged.add(who);
    const idx = flags.bagCount++;
    refreshHint();
    const tq = worldQuat(tote);
    const mouth = tote.localToWorld(V(0, 0.27, 0));
    await arcTo(b, mouth, tq, 0.25, 0.01, 'outCubic');
    const inside = tote.localToWorld(tote.userData.api.insideLocal(idx));
    await arcTo(b, inside, tq, 0.28, 0, 'inCubic');
    tote.attach(b);
    audio.play('cloth', { vol: 0.85 });
    tote.userData.api.squash(0.55);
    b.userData.busy = false;
    if (!alive(tok)) return;
    if (flags.bagCount >= 2) go('K6'); else refreshHint();
  }

  const lidHandles = {};

  // ======================= 組み立て =======================
  function disposeTree(root) {
    root.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
  }
  function build() {
    if (dyn) { group.remove(dyn); disposeTree(dyn); }
    dyn = new THREE.Group(); dyn.name = 'kitchenDyn';
    group.add(dyn);

    cooker = createRiceCooker(); cooker.position.copy(POS.cooker); dyn.add(cooker);
    steam = createSteam({ max: 70 }); dyn.add(steam);
    shamoji = createShamoji(); dyn.add(shamoji);
    plate = createPlate(); plate.position.copy(POS.plate); dyn.add(plate);
    shaker = createShaker(); shaker.position.copy(POS.shaker); dyn.add(shaker);
    chop = createChopsticks(); dyn.add(chop);
    tote = createToteBag(); tote.position.copy(POS.tote); tote.rotation.y = POS.toteYaw; dyn.add(tote);
    tote.userData.api.setHandles(0);

    mama = createBento('mama'); mama.position.copy(POS.mama); dyn.add(mama);
    child = createBento('child'); child.position.copy(POS.child); dyn.add(child);
    M = mama.userData.api; C = child.userData.api;
    M.setRiceNow(1);
    M.drawShape(MAMA_SHAPES[((state.day | 0) % 3 + 3) % 3]);
    C.setRiceNow(0);
    M.setInteriorVisible(true); C.setInteriorVisible(true);

    // ふたは箱の右に平置き
    childLid = C.lid; mamaLid = M.lid;
    for (const [lid, p, yaw] of [[childLid, POS.childLid, POS.childLidYaw], [mamaLid, POS.mamaLid, POS.mamaLidYaw]]) {
      dyn.attach(lid);
      lid.position.copy(p); lid.quaternion.copy(yawQ(yaw));
      lid.userData.home = p.clone(); lid.userData.homeQ = yawQ(yaw);
      lid.userData.busy = false;
    }

    // 皿のおかず
    childFoods = {}; mamaFoods = {};
    plate.updateWorldMatrix(true, false);
    FOODS.forEach((type, k) => {
      for (const who of ['mama', 'child']) {
        const f = createFood(type, who === 'mama' ? 1.12 : 1);
        const spot = plate.localToWorld(plate.userData.api.spots[2 * k + (who === 'mama' ? 0 : 1)].clone());
        f.position.copy(spot);
        const yaw = (type === 'wiener' ? 0.5 : type === 'tamago' ? -0.25 : 0.3) + (who === 'mama' ? 0.08 : -0.08) + k * 0.4;
        f.quaternion.copy(yawQ(yaw));
        f.userData.k = { type, who, home: spot.clone(), homeQ: f.quaternion.clone(), slot: -1, from: -1 };
        f.userData.busy = false;
        dyn.add(f);
        (who === 'mama' ? mamaFoods : childFoods)[type] = f;
      }
    });

    // 炊飯器の初期状態
    const capi = cooker.userData.api;
    capi.lamp(true);
    shamoji.visible = false;
    cooker.updateWorldMatrix(true, true);
    const rp = shamojiRestPose();
    shamoji.position.copy(rp.p); shamoji.quaternion.copy(rp.q);
    shamoji.userData.api.setLoaded(false);
    shamoji.userData.busy = false;

    // 菜箸は左上の外
    chop.quaternion.copy(chopQuat);
    chopRest(chop.position);
    chop.userData.api.setGrip(0);
  }

  function addInputs() {
    // 炊飯器（K0 は前上部ぜんたいが大きなボタン）
    addHandle(cooker, { role: 'cooker', radius: 0.12, priority: 2, center: () => worldPos(cooker.userData.api.button),
      down() { if (step === 'K0' && !flags.cookerOpen) openCooker(); else reactCooker(); } });
    addHandle(shamoji, Object.assign({ role: 'shamoji', radius: 0.06, priority: 4, center: () => shamojiGrip() }, carryHandlers(beginShamoji)));
    addHandle(plate, { role: 'plate', radius: 0.12, priority: 0, down() { audio.play('ceramic'); wiggle(plate, 0.012, 'z', 0.4, 3); } });
    addHandle(shaker, Object.assign({ role: 'shaker', radius: 0.045, priority: 3, center: () => worldPos(shaker).add(V(0, 0.045, 0)) }, carryHandlers(beginShaker)));
    addHandle(tote, { role: 'tote', priority: 0, down() { audio.play('cloth', { vol: 0.5 }); tote.userData.api.squash(0.35); } });
    addHandle(mama, Object.assign({ role: 'bento', priority: 1 }, carryHandlers(beginBento(mama, 'mama'))));
    addHandle(child, Object.assign({ role: 'bento', priority: 1 }, carryHandlers(beginBento(child, 'child'))));
    lidHandles.child = addHandle(childLid, Object.assign({ role: 'lid', priority: 2, radius: 0.08, center: () => worldPos(childLid) }, carryHandlers(beginLid(childLid, child, 'child'))));
    lidHandles.mama = addHandle(mamaLid, Object.assign({ role: 'lid', priority: 2, radius: 0.09, center: () => worldPos(mamaLid) }, carryHandlers(beginLid(mamaLid, mama, 'mama'))));
    for (const type of FOODS) {
      const cf = childFoods[type], mf = mamaFoods[type];
      addHandle(cf, Object.assign({ role: 'childFood', radius: Math.max(0.022, cf.userData.food.radius + 0.006), priority: 5, center: foodCenter(cf) }, carryHandlers(beginChildFood(cf))));
      addHandle(mf, { role: 'mamaFood', radius: mf.userData.food.radius, priority: 3, center: foodCenter(mf), pad: 8,
        down() { if (!mf.userData.busy) reactFood(mf); if (step === 'K3') { flags.childActed = true; refreshHint(); } } });
    }
  }

  return {
    group,
    env: set.userData.env || null,
    envIntensity: set.userData.envIntensity != null ? set.userData.envIntensity : 0.6,
    background: new THREE.Color(0xe8e0d4),
    fog: null,
    enter() {
      tw = tweens.scope();
      hs = [];
      carry = null; hintKey = ''; lastShot = null;
      mamaQ = []; mamaRunning = false; mamaDone = new Set(); mamaCur = null; chopFree = true;
      flags = { cookerOpen: false, shamojiLoaded: false, shamojiBusy: false, shakerBusy: false, closed: { child: false, mama: false }, bagged: new Set(), bagCount: 0, childActed: false, wispRate: 5, sprinkledThisCarry: 0 };
      // 台所は空の箱から（state もそれに揃える）
      state.rice = 0; state.furikake = []; state.slots = [null, null, null, null, null, null];
      build();
      addInputs();
      audio.setMusic('morning');
      audio.setAmbience('kitchen');
      audio.steamHiss(true);
      engine.applyQuality(group);
      group.updateMatrixWorld(true);
      go('K0');
    },
    exit() {
      for (const h of hs) h.remove();
      hs = [];
      carry = null;
      if (tw) tw.killAll();
      audio.steamHiss(false);
      token++;
      step = '';
    },
    update(dt, t) {
      if (!dyn) return;
      if (set.userData.update) set.userData.update(dt, t);
      updateCarry(dt, t);
      // 画面の向きが変わったら構図を組み直す（縦と横で余白の回し方が違う）
      if (lastShot && Math.abs(engine.size.w / Math.max(1, engine.size.h) - lastAspect) > 0.02) doShot(0.4);
      for (const o of [cooker, steam, shaker, chop, tote, mama, child]) if (o && o.userData.update) o.userData.update(dt, t);
      // 湯気の細い筋（ふたの角度に追従）
      if (flags.wispRate > 0) steam.userData.api.setWisp(cooker.localToWorld(cooker.userData.api.steamVentLocal.clone()), flags.wispRate);
      // 菜箸は使わないとき画面の左上の外（回転・リサイズにも追従）
      if (chopFree) {
        chopRest(tmpV); chop.position.lerp(tmpV, Math.min(1, dt * 8));
        if (chop.position.distanceToSquared(tmpV) < 1e-4) chop.visible = false; // 画面外で影だけ落ちないように
      }
    },
  };
}
