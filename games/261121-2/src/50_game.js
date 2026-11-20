/* 50_game.js — 進行役：描画ループ・状態の流れ（phase）・指1本の入力・手がかり・カメラ・保存・性能管理。
   G.Game.s            … 状態（素のオブジェクト）
   G.Game.screenOf(v3) … 世界の点 → {x,y}（CSS px。当たり判定と同じ計算）
   ほかのモジュール（G.World / G.Plant / G.Can / G.Zaru / G.Water / G.Audio）をつないで、最後に起動する。 */
(function () {
  'use strict';
  var U = G.U, L = G.L, V3 = THREE.Vector3;
  var Game = G.Game = {};
  var PI = Math.PI;

  /* ───────── 調整用の定数（ここをいじれば手触りが変わる） ───────── */
  var K = {
    NEED: 0.62,            // 水の必要量（じょうろ1杯 = 1.0）
    WASH_NEED: 0.30,       // 洗いの必要量
    FILL_SEC: 4.5,         // 全開で空→満杯の秒
    POUR_SEC: 7,           // 全力で満杯→空の秒
    FOV: 32, PITCH: 7 * PI / 180, CAM_LAMBDA: 2.5, CAM_MARGIN: 0.05, CAM_UP: 0.65, BOX_Z: -0.15,
    HIT_MIN: 48, HIT_MAIN: 1.5, TAP_PX: 12,
    HINT1: 4, HINT2: 9, HINT_SND: 2.4, SPARK_P0: 1.6, SPARK_P1: 0.95, DRIP_EVERY: 2.2,
    TURN_MAX: PI * 1.5, TURN_PER_PX: 0.02, TAP_TOGGLE: 0.3,
    CAN_HOME_YAW: -1.0, CAN_CARRY_YAW: 0.45, CAN_LAMBDA: 18, CAN_SNAP_X: -0.36, CAN_Z_MOVE: 0.10,
    TILT_A: 0.36, TILT_B: 0.58, TILT_MAX: 0.95, POUR_A: 0.45, POUR_B: 0.9,
    SEED_SNAP: 0.16, PICK_DIST: 0.07, SEED_FLOOR: 0,
    SAVE_KEY: 'gf-261121-2'
  };
  var BOX = {
    WIDE: [-0.64, 0.57, -0.02, 1.42], PLANT: [-0.46, 0.60, -0.26, 1.00], HARVEST: [-0.30, 0.60, 0.05, 1.40],
    EAT: [-0.28, 0.17, 0.10, 0.52], SKY: [-0.64, 0.57, 0.0, 1.80]
  };
  var PHASE_BOX = { plant: 'PLANT', water: 'WIDE', night: 'SKY', harvest: 'HARVEST', wash: 'WIDE', eat: 'EAT', sunset: 'SKY', sleep: 'SKY' };
  var PHASES = ['plant', 'water', 'night', 'harvest', 'wash', 'eat', 'sunset', 'sleep'];
  var DAY = { plant: 1, water: 1, harvest: 1, wash: 1 };

  /* ───────── 小道具 ───────── */
  function snd(name, a, b) { try { if (G.Audio) G.Audio.play(name, a, b); } catch (e) { } }
  function ease(k) { return k * k * (3 - 2 * k); }
  function easeOut(k) { return 1 - (1 - k) * (1 - k); }
  function rnd() { return Math.random(); }

  var renderer, scene, camera, world, plant, can, zaru, water, canvas;
  var Wd = 390, Ht = 844, safe = { t: 0, r: 0, b: 0, l: 0 };
  var quality, low = false, dead = false;
  var s = null;
  var LATE = 6, RED = [];
  var HOME = new V3(), OUTLET = new V3(), HANDLE = new V3(), SEED_HOLE = new V3(L.PLANT_BASE[0], L.PLANT_BASE[1] + 0.16, L.PLANT_BASE[2]);
  var ZARU_POS = new V3(L.BUCKET[0], L.BUCKET_TOP_Y + 0.0035, L.BUCKET[2]);
  // 使い回しのベクトル
  var _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _rp = new V3(), _rd = new V3(), _ray = new V3(), _pp = new V3();
  var _scr = { x: 0, y: 0, ok: true };

  /* ───────── 状態 ───────── */
  function fresh() {
    return {
      v: 1, phase: 'plant', stage: 0, cycle: 0, watered: 0, fill: 0, canState: 'home', canX: -0.30,
      seedX: L.SEEDLING_START[0], picked: [false, false, false, false, false, false, false], inZaru: 0, washed: 0,
      eaten: 0, eatMask: 0, lateDone: false, pot: [-0.30, 0.42],
      // ここから下は保存しない（phase から決まる・毎フレーム変わる）
      time: 0.30, pt: 0, clock: 0, idle: 0, open: 0, flow: 0, tapDir: 1, thirst: 0, moist: 0, hole: 1,
      g: 0, fl: 0, fr: 0, rp: 0, lr: 0, leafWet: 0, zaruOn: false, zaruWet: 0,
      planted: false, rewarded: false, rewardDone: false, washDone: false, lateReady: false, lateFlying: false,
      waking: false, zaruNext: 0, sleepMusicT: 0
    };
  }

  /* ───────── 予定表（phase の中の時間で進むトゥイーン） ───────── */
  var tl = [], tlGen = 0;
  function at(delay, dur, step, end) { tl.push({ t0: s.pt + delay, dur: dur, step: step, end: end }); }
  function tween(delay, dur, key, from, to, fn) {
    at(delay, dur, function (k) { s[key] = from + (to - from) * (fn ? fn(k) : ease(k)); });
  }
  function runTimeline() {
    var gen = tlGen;
    for (var i = 0; i < tl.length; i++) {
      var e = tl[i];
      if (s.pt < e.t0) continue;
      var k = e.dur > 0 ? U.clamp01((s.pt - e.t0) / e.dur) : 1;
      if (e.step) e.step(k);
      if (k >= 1) {
        tl.splice(i, 1); i--;
        if (e.end) e.end();
        if (gen !== tlGen) return;
      }
    }
  }

  /* ───────── 保存 ───────── */
  var lastSaved = '', saveT = 0;
  function saveObj() {
    var cs = s.canState === 'home' ? 'home' : ((canAnim && canAnim.state === 'home') ? 'home' : 'floor');
    return JSON.stringify({ v: 1, phase: s.phase, stage: s.stage, cycle: s.cycle, watered: +s.watered.toFixed(3), fill: +s.fill.toFixed(3),
      canState: cs, canX: +canPos.x.toFixed(3), seedX: +s.seedX.toFixed(3), picked: s.picked, inZaru: s.inZaru, washed: +s.washed.toFixed(3),
      eaten: s.eaten, eatMask: s.eatMask, lateDone: s.lateDone, pot: s.pot });
  }
  function save(force) {
    try {
      var j = saveObj();
      if (!force && j === lastSaved) return;
      lastSaved = j;
      window.localStorage.setItem(K.SAVE_KEY, j);
    } catch (e) { }
  }
  function num(x, a, b) { return typeof x === 'number' && isFinite(x) && x >= a && x <= b; }
  function load() {
    var st = fresh();
    try {
      if (/[?&]reset\b/.test(location.search)) { try { window.localStorage.removeItem(K.SAVE_KEY); } catch (e0) { } return st; }
      var raw = window.localStorage.getItem(K.SAVE_KEY);
      if (!raw) return st;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1 || PHASES.indexOf(o.phase) < 0) return st;
      if (!num(o.stage, 0, 3) || (o.stage | 0) !== o.stage || !num(o.cycle, 0, 1e6) || !num(o.watered, 0, 5) || !num(o.fill, 0, 1)) return st;
      if (o.canState !== 'home' && o.canState !== 'floor') return st;
      if (!num(o.canX, -1, 1) || !num(o.seedX, -1, 1) || !num(o.inZaru, 0, 6) || !num(o.washed, 0, 5) || !num(o.eaten, 0, 6)) return st;
      if (!o.picked || o.picked.length !== 7 || !o.pot || o.pot.length !== 2 || !num(o.pot[0], -2, 2) || !num(o.pot[1], -2, 2)) return st;
      // phase と stage の組み合わせ
      if (o.phase === 'plant' && (o.stage !== 0 || o.cycle !== 0)) return st;
      if ((o.phase === 'water' || o.phase === 'night') && o.stage > 2) return st;
      if (['harvest', 'wash', 'eat', 'sunset', 'sleep'].indexOf(o.phase) >= 0 && o.stage !== 3) return st;
      st.phase = o.phase; st.stage = o.stage; st.cycle = o.cycle | 0; st.watered = o.watered; st.fill = o.fill;
      st.canState = o.canState; st.canX = U.clamp(o.canX, L.CAN_X_MIN, L.CAN_X_MAX); st.seedX = U.clamp(o.seedX, -0.6, 0.6);
      for (var i = 0; i < 7; i++) st.picked[i] = !!o.picked[i];
      st.inZaru = o.inZaru | 0; st.washed = o.washed; st.eaten = o.eaten | 0; st.eatMask = num(o.eatMask, 0, 63) ? (o.eatMask | 0) : 0;
      st.lateDone = !!o.lateDone; st.pot = [o.pot[0], o.pot[1]];
    } catch (e) { return fresh(); }
    return st;
  }

  /* ───────── 画面・カメラ ───────── */
  var probe = null;
  function readSafe() {
    try {
      if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
          'padding-top:var(--sat);padding-right:var(--sar);padding-bottom:var(--sab);padding-left:var(--sal);';
        document.body.appendChild(probe);
      }
      var cs = getComputedStyle(probe);
      safe.t = parseFloat(cs.paddingTop) || 0; safe.r = parseFloat(cs.paddingRight) || 0;
      safe.b = parseFloat(cs.paddingBottom) || 0; safe.l = parseFloat(cs.paddingLeft) || 0;
    } catch (e) { safe.t = safe.r = safe.b = safe.l = 0; }
  }
  var cam = { x: 0, y: 0.7, d: 5, init: false }, camT = { x: 0, y: 0, d: 0, ppm: 1 };
  var TAN_H = Math.tan(K.FOV * PI / 360);
  function camTarget(name) {
    var b = BOX[name] || BOX.WIDE;
    var bw = b[1] - b[0], bh = b[3] - b[2];
    var sw = Math.max(60, Wd - safe.l - safe.r), sh = Math.max(60, Ht - safe.t - safe.b);
    var mx = sw * K.CAM_MARGIN, my = sh * K.CAM_MARGIN, aw = sw - 2 * mx, ah = sh - 2 * my;
    var ppm = Math.min(aw / bw, ah / bh);
    var spX = aw - bw * ppm, spY = ah - bh * ppm;
    var cxs = safe.l + mx + spX * 0.5 + bw * ppm * 0.5;
    var cys = safe.t + my + spY * K.CAM_UP + bh * ppm * 0.5;
    camT.x = (b[0] + b[1]) * 0.5 - (cxs - Wd * 0.5) / ppm;
    camT.y = (b[2] + b[3]) * 0.5 + (cys - Ht * 0.5) / ppm;
    camT.d = (Ht * 0.5) / (ppm * TAN_H);
    camT.ppm = ppm;
  }
  function updateCamera(dt) {
    camTarget(PHASE_BOX[s.phase]);
    if (!cam.init) { cam.x = camT.x; cam.y = camT.y; cam.d = camT.d; cam.init = true; }
    else {
      cam.x = U.damp(cam.x, camT.x, K.CAM_LAMBDA, dt); cam.y = U.damp(cam.y, camT.y, K.CAM_LAMBDA, dt);
      cam.d = U.damp(cam.d, camT.d, K.CAM_LAMBDA, dt);
    }
    camera.position.set(cam.x, cam.y + Math.sin(K.PITCH) * cam.d, K.BOX_Z + Math.cos(K.PITCH) * cam.d);
    camera.lookAt(cam.x, cam.y, K.BOX_Z);
    camera.updateMatrixWorld();
  }
  var needResize = true;
  function applyResize() {
    needResize = false;
    var w = window.innerWidth || 390, h = window.innerHeight || 844;
    if (window.visualViewport && window.visualViewport.width > 0) { w = Math.round(window.visualViewport.width); h = Math.round(window.visualViewport.height); }
    Wd = Math.max(1, w); Ht = Math.max(1, h);
    readSafe();
    renderer.setPixelRatio(perf.pr);
    renderer.setSize(Wd, Ht, false);
    camera.aspect = Wd / Ht; camera.updateProjectionMatrix();
  }
  /* 世界の点 → 画面（CSS px）。out を渡せば使い回す */
  function screenOf(p, out) {
    out = out || { x: 0, y: 0, ok: true };
    _pp.copy(p).project(camera);
    out.x = (_pp.x + 1) * 0.5 * Wd; out.y = (1 - _pp.y) * 0.5 * Ht; out.ok = _pp.z < 1 && _pp.z > -1;
    return out;
  }
  Game.screenOf = function (v) { var o = screenOf(v, null); return { x: o.x, y: o.y }; };
  /* 世界の点のまわりで 1px が何 m か */
  function wpp(p) { return 2 * camera.position.distanceTo(p) * TAN_H / Ht; }
  /* 指のレイと z=一定 の面の交点 */
  function planePoint(px, py, z, out) {
    _ray.set(px / Wd * 2 - 1, -(py / Ht * 2 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
    var dz = _ray.z; if (Math.abs(dz) < 1e-5) dz = -1e-5;
    var t = (z - camera.position.z) / dz;
    if (t < 0) t = 0;
    return out.copy(camera.position).addScaledVector(_ray, t);
  }
  function rayDir(px, py, out) {
    return out.set(px / Wd * 2 - 1, -(py / Ht * 2 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
  }

  /* ───────── 物の状態（見た目に反映する値） ───────── */
  var canPos = new V3(), canYaw = K.CAN_HOME_YAW, canAnim = null, canTilt = 0, canSwing = 0, canSwingV = 0, canKick = 0, canKickV = 0;
  var canPrev = new V3(), canVel = new V3(), canVelPrev = new V3(), slosh = 0, sloshV = 0, lastSloshSnd = 0, canZProg = 0;
  var seedPos = new V3(), seedAnim = null, seedTilt = 0;
  var handleJig = 0, tapAnim = null, lastSqueak = 0;
  var zf = [], zfHop = [0, 0, 0, 0, 0, 0], zfBase = [];
  var pool = [], flyers = [];
  var hold = null, ptrId = null, ptr = { x: 0, y: 0, dx: 0, dy: 0, moved: 0 };

  function seedZ(x) { return U.lerp(L.SEEDLING_START[2], L.PLANT_BASE[2], U.smooth(-0.05, 0.22, x)); }
  function seedFloorY() { return plant.potH - 0.01; }
  function zaruSlotWorld(k, out) { return zaru.group.localToWorld(out.copy(zaru.slots[k])); }
  function canCenter(out) { return out.set(canPos.x, canPos.y + 0.13, canPos.z); }
  function tapClosed() { return s.open <= 0.001 && !tapAnim && s.flow < 0.03; }
  function canHeld() { return hold && hold.kind === 'can'; }

  /* ───────── 水しぶきの当たり ───────── */
  var COL = {
    pinwheel: { kind: 'pinwheel', shape: 'sphere', x: L.PINWHEEL_C[0], y: L.PINWHEEL_C[1], z: L.PINWHEEL_C[2], r: 0.09, pass: 0.7 },
    leaf0: { kind: 'leaf', shape: 'sphere', x: 0, y: -5, z: 0, r: 0.01, pass: 0.75 },
    leaf1: { kind: 'leaf', shape: 'sphere', x: 0, y: -5, z: 0, r: 0.01, pass: 0.75 },
    leaf2: { kind: 'leaf', shape: 'sphere', x: 0, y: -5, z: 0, r: 0.01, pass: 0.75 },
    metal: { kind: 'metal', shape: 'disc', x: L.BUCKET[0], y: L.BUCKET_TOP_Y + 0.0035, z: L.BUCKET[2], r: 0.085, splash: true },
    zaru: { kind: 'zaru', shape: 'disc', x: L.BUCKET[0], y: L.BUCKET_TOP_Y + 0.04, z: L.BUCKET[2], r: 0.15, splash: true },
    soil: { kind: 'soil', shape: 'disc', x: L.PLANT_BASE[0], y: L.SOIL_Y, z: L.PLANT_BASE[2], r: L.SOIL_R }
  };
  var KINDS = ['soil', 'leaf', 'pinwheel', 'metal', 'zaru', 'floor'];
  var hitAcc = {}, hitAvg = {}, hitFrac = {}, hitPos = {};
  KINDS.forEach(function (k) { hitAcc[k] = 0; hitAvg[k] = 0; hitFrac[k] = 0; hitPos[k] = new V3(); });
  var leafSpheres = [COL.leaf0, COL.leaf1, COL.leaf2], leafT = 0, colZaruOn = null;
  function updateColliders(dt) {
    leafT -= dt;
    if (leafT <= 0) {
      leafT = 0.5;
      var c = plant.canopy(), h = Math.max(0.05, c.y1 - c.y0), n = h > 0.3 ? 3 : 2;
      for (var i = 0; i < 3; i++) {
        var S = leafSpheres[i];
        if (i >= n || s.phase === 'plant') { S.y = -5; S.r = 0.001; continue; }
        S.x = c.x; S.z = c.z; S.y = c.y0 + h * (i + 0.5) / n;
        S.r = Math.max(0.05, Math.min(c.r, h / n * 0.75));
      }
    }
    if (colZaruOn !== s.zaruOn) {
      colZaruOn = s.zaruOn;
      water.colliders = [COL.pinwheel, COL.leaf0, COL.leaf1, COL.leaf2, s.zaruOn ? COL.zaru : COL.metal, COL.soil];
    }
  }
  function onHit(kind, x, y, z, n) {
    if (hitAcc[kind] === undefined) return;
    hitAcc[kind] += n; hitPos[kind].set(x, y, z);
  }

  /* ───────── 手がかりの絵（キャンバスで描く） ───────── */
  function canvasTex(c) { var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }
  function sparkleCanvas() {
    var S = 128, c = U.makeCanvas(S), x = c.getContext('2d'), h = S / 2;
    var g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,252,240,1)'); g.addColorStop(0.1, 'rgba(255,240,200,0.9)');
    g.addColorStop(0.3, 'rgba(255,220,160,0.25)'); g.addColorStop(1, 'rgba(255,205,140,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'lighter';
    function ray(ang, len, w, a) {
      x.save(); x.translate(h, h); x.rotate(ang);
      var lg = x.createLinearGradient(-len, 0, len, 0);
      lg.addColorStop(0, 'rgba(255,225,170,0)'); lg.addColorStop(0.5, 'rgba(255,250,232,' + a + ')'); lg.addColorStop(1, 'rgba(255,225,170,0)');
      x.fillStyle = lg; x.beginPath(); x.moveTo(-len, 0); x.quadraticCurveTo(0, -w, len, 0); x.quadraticCurveTo(0, w, -len, 0); x.fill();
      x.restore();
    }
    ray(0, h - 2, 6, 1); ray(PI / 2, h - 2, 6, 1); ray(PI / 4, h * 0.5, 3.5, 0.55); ray(-PI / 4, h * 0.5, 3.5, 0.55);
    return c;
  }
  function glowCanvas() {
    var S = 128, c = U.makeCanvas(S), x = c.getContext('2d'), h = S / 2;
    var g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,226,170,0.55)'); g.addColorStop(0.35, 'rgba(255,210,140,0.30)');
    g.addColorStop(0.7, 'rgba(255,190,120,0.08)'); g.addColorStop(1, 'rgba(255,180,110,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return c;
  }
  var FT = { x: 92, y: 62 };   // 指の腹（触れる点）のキャンバス上の位置
  function fingerCanvas() {
    var S = 256, c = U.makeCanvas(S), x = c.getContext('2d'), w = 80;
    function shape() {
      x.beginPath(); x.moveTo(-w / 2, w / 2); x.arc(0, w / 2, w / 2, PI, 0, false);
      x.lineTo(w / 2 + 4, 330); x.lineTo(-w / 2 - 4, 330); x.closePath();
    }
    x.save(); x.translate(92, 22); x.rotate(-0.42);
    x.shadowColor = 'rgba(40,50,70,0.7)'; x.shadowBlur = 18;
    shape(); x.fillStyle = 'rgba(248,249,252,0.95)'; x.fill();
    x.shadowBlur = 0; x.shadowColor = 'rgba(0,0,0,0)';
    shape(); x.strokeStyle = 'rgba(110,120,140,0.55)'; x.lineWidth = 3; x.stroke();
    var lg = x.createLinearGradient(-w / 2, 0, w / 2, 0);
    lg.addColorStop(0, 'rgba(196,204,218,0.65)'); lg.addColorStop(0.3, 'rgba(255,255,255,0)');
    lg.addColorStop(0.7, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(186,194,210,0.7)');
    shape(); x.fillStyle = lg; x.fill();
    // 爪
    var nx = -w * 0.29, ny = w * 0.16, nw = w * 0.58, nh = w * 0.66, r = w * 0.26;
    x.beginPath(); x.moveTo(nx + r, ny); x.lineTo(nx + nw - r, ny); x.quadraticCurveTo(nx + nw, ny, nx + nw, ny + r);
    x.lineTo(nx + nw, ny + nh); x.lineTo(nx, ny + nh); x.lineTo(nx, ny + r); x.quadraticCurveTo(nx, ny, nx + r, ny); x.closePath();
    x.fillStyle = 'rgba(255,255,255,0.75)'; x.fill(); x.strokeStyle = 'rgba(160,170,188,0.5)'; x.lineWidth = 2.5; x.stroke();
    // 第一関節のしわ
    x.strokeStyle = 'rgba(170,178,196,0.35)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(-w * 0.32, w * 1.55); x.quadraticCurveTo(0, w * 1.65, w * 0.32, w * 1.55); x.stroke();
    x.restore();
    // 遠い側をぼかして消す
    x.globalCompositeOperation = 'destination-out';
    var fg = x.createRadialGradient(92, 30, 120, 92, 30, 235);
    fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = fg; x.fillRect(0, 0, S, S);
    return c;
  }
  var hint = { spark: null, glow: null, finger: null, key: '', clock: 0, cyc: -1, sndT: 0, dripT: 0, fClock: 0 };
  function makeHints() {
    function spr(c, add, order) {
      var m = new THREE.SpriteMaterial({ map: canvasTex(c), transparent: true, depthTest: false, depthWrite: false,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
      var sp = new THREE.Sprite(m); sp.renderOrder = order; sp.visible = false; sp.frustumCulled = false; scene.add(sp);
      return sp;
    }
    hint.glow = spr(glowCanvas(), true, 30);
    hint.spark = spr(sparkleCanvas(), true, 31);
    hint.finger = spr(fingerCanvas(), false, 32);
    hint.finger.center.set(FT.x / 256, 1 - FT.y / 256);
  }

  /* ───────── 次に触る1つ ───────── */
  var tgt = { key: '', kind: '', idx: -1, pos: new V3(), to: new V3(), drag: false };
  function setT(kind, idx, drag) { tgt.kind = kind; tgt.idx = idx; tgt.drag = drag; tgt.key = kind + ':' + idx; return tgt; }
  function lowestRed() {
    var best = -1, by = 9;
    for (var i = 0; i < RED.length; i++) {
      var f = plant.fruits[RED[i]]; if (s.picked[RED[i]]) continue;
      if (f.pos.y < by) { by = f.pos.y; best = RED[i]; }
    }
    return best;
  }
  function waterTarget(need, done, toX) {
    if (done) {
      if (s.open > 0.001 || tapAnim) return handleT();
      return null;
    }
    if (s.open > 0.001 || (tapAnim && tapAnim.to > 0)) {
      if (s.canState === 'home' && s.fill < 1 && !canAnim) return null;
      return handleT();
    }
    if (s.fill > 0.12) {
      setT('can', 0, true); canCenter(tgt.pos); tgt.to.set(toX, 0.95, L.CAN_CARRY_Z); return tgt;
    }
    if (s.canState === 'home' || canAnim) return handleT();
    setT('can', 1, true); canCenter(tgt.pos); tgt.to.copy(HOME); tgt.to.y += 0.13; return tgt;
  }
  function handleT() { setT('handle', 0, false); tgt.pos.copy(HANDLE); return tgt; }
  function nextTarget() {
    if (dead) return null;
    switch (s.phase) {
      case 'plant':
        if (s.planted) return null;
        setT('seed', 0, true); tgt.pos.copy(seedPos); tgt.pos.y += 0.06; tgt.to.copy(SEED_HOLE); return tgt;
      case 'water':
        return waterTarget(K.NEED, s.watered >= K.NEED, -0.22);
      case 'wash':
        return waterTarget(K.WASH_NEED, s.washed >= K.WASH_NEED, -0.50);
      case 'harvest': {
        var i = lowestRed(); if (i < 0) return null;
        setT('fruit', i, true); tgt.pos.copy(plant.fruits[i].pos); tgt.to.copy(ZARU_POS); tgt.to.y += 0.08; return tgt;
      }
      case 'eat': {
        for (var k = 0; k < 6; k++) if (!(s.eatMask & (1 << k))) {
          setT('zfruit', k, false); zaruSlotWorld(k, tgt.pos); return tgt;
        }
        return null;
      }
      case 'sunset':
        if (!s.lateReady || s.lateFlying || s.picked[LATE]) return null;
        setT('late', LATE, true); tgt.pos.copy(plant.fruits[LATE].pos);
        tgt.to.copy(tgt.pos); tgt.to.x -= 0.10; tgt.to.y -= 0.28; tgt.to.z += 0.25; return tgt;
      case 'sleep':
        if (s.waking || s.pt < 5) return null;
        setT('can', 2, false); canCenter(tgt.pos); return tgt;
    }
    return null;
  }
  function wiggle(T) {
    switch (T.kind) {
      case 'handle': handleJig = 1; break;
      case 'can': canKickV -= 2.2; break;
      case 'seed': plant.poke(T.pos, 0.35); seedTilt += 0.0; break;
      case 'fruit': case 'late': plant.poke(T.pos, 0.3); break;
      case 'zfruit': zfHop[T.idx] = 0.001; break;
    }
  }
  function updateHints(dt) {
    var T = (hold || ptrId !== null) ? null : nextTarget();
    var key = T ? T.key : '';
    if (key !== hint.key) { hint.key = key; s.idle = 0; hint.clock = 0; hint.cyc = -1; hint.fClock = 0; hint.sndT = 0; }
    // 蛇口のしずく（ハンドルが次の1つで、水が止まっている間）
    if (T && T.kind === 'handle' && s.open <= 0.001 && s.flow < 0.01) {
      hint.dripT += dt;
      if (hint.dripT >= K.DRIP_EVERY) {
        hint.dripT = 0;
        var toY = (s.canState === 'home' && !canAnim) ? can.waterY() : 0.022;
        water.drip(OUTLET, toY);
      }
    } else hint.dripT = K.DRIP_EVERY * 0.6;
    if (!T) {
      hint.spark.visible = hint.finger.visible = false;
      var dest = null;
      if (hold) {
        if (hold.kind === 'seed' && !s.planted) dest = _c.copy(SEED_HOLE).setY(L.SOIL_Y + 0.03);
        else if (hold.kind === 'fruit' && hold.picked && hold.idx !== LATE) dest = _c.copy(ZARU_POS).setY(ZARU_POS.y + 0.04);
        else if (hold.kind === 'can' && s.fill <= 0.12 && s.open <= 0.001 && (s.phase === 'water' || s.phase === 'wash')) dest = _c.copy(HOME).setY(HOME.y + 0.05);
      }
      hint.glow.visible = !!dest;
      if (dest) {
        hint.clock += dt;
        var dp = 0.5 + 0.5 * Math.sin(hint.clock * PI * 2 / 1.1), dw = wpp(dest), ds = (150 + 30 * dp) * dw;
        hint.glow.position.copy(dest); hint.glow.scale.set(ds, ds, 1); hint.glow.material.opacity = 0.55 + 0.4 * dp;
      }
      return;
    }
    s.idle += dt; hint.clock += dt;
    var lvl = s.idle >= K.HINT2 ? 2 : (s.idle >= K.HINT1 ? 1 : 0);
    var per = lvl ? K.SPARK_P1 : K.SPARK_P0;
    var cyc = Math.floor(hint.clock / per), ph = (hint.clock - cyc * per) / per;
    if (cyc !== hint.cyc) { hint.cyc = cyc; if (lvl < 2 || (cyc & 1)) wiggle(T); }
    var w = wpp(T.pos);
    // きらめき：開いて消える
    var env = ph < 0.35 ? ease(ph / 0.35) : 1 - ease(U.clamp01((ph - 0.35) / 0.45));
    var sp = hint.spark;
    sp.visible = env > 0.01;
    sp.position.copy(T.pos);
    var size = (lvl ? 92 : 64) * (0.45 + 0.55 * env) * w;
    sp.scale.set(size, size, 1);
    sp.material.opacity = env * (lvl ? 1 : 0.9);
    sp.material.rotation = 0.35 * Math.sin(hint.clock * 0.9) + ph * 0.5;
    // 光のたまり
    var gl = hint.glow;
    gl.visible = lvl >= 1;
    if (gl.visible) {
      var pulse = 0.5 + 0.5 * Math.sin(hint.clock * PI * 2 / 1.2);
      var gs = (170 + 26 * pulse) * w;
      gl.position.copy(T.pos); gl.scale.set(gs, gs, 1);
      gl.material.opacity = U.clamp01((s.idle - K.HINT1) * 1.5) * (0.45 + 0.3 * pulse);
      hint.sndT -= dt;
      if (hint.sndT <= 0) { hint.sndT = K.HINT_SND; snd('hint'); }
    }
    // 指のお手本
    var f = hint.finger;
    f.visible = false;
    if (lvl >= 2) {
      hint.fClock += dt;
      var P = T.drag ? 3.0 : 2.0, q = hint.fClock % P, op = 0, sc = 1;
      var offX = 46 * w, offY = -70 * w;
      if (T.drag) {
        if (q < 0.45) { var k0 = easeOut(q / 0.45); _a.copy(T.pos); _a.x += offX * (1 - k0); _a.y += offY * (1 - k0); op = k0; sc = 1.15 - 0.15 * k0; }
        else if (q < 0.7) { _a.copy(T.pos); op = 1; sc = 1 - 0.07 * Math.sin((q - 0.45) / 0.25 * PI); }
        else if (q < 2.2) { _a.lerpVectors(T.pos, T.to, ease((q - 0.7) / 1.5)); op = 1; sc = 0.97; }
        else if (q < 2.65) { var k1 = ease((q - 2.2) / 0.45); _a.copy(T.to); _a.x += offX * k1; _a.y += offY * k1; op = 1 - k1; sc = 0.97 + 0.18 * k1; }
        else op = 0;
      } else {
        if (q < 0.5) { var k2 = easeOut(q / 0.5); _a.copy(T.pos); _a.x += offX * (1 - k2); _a.y += offY * (1 - k2); op = k2; sc = 1.15 - 0.15 * k2; }
        else if (q < 0.85) { _a.copy(T.pos); op = 1; sc = 1 - 0.09 * Math.sin((q - 0.5) / 0.35 * PI); }
        else if (q < 1.35) { var k3 = ease((q - 0.85) / 0.5); _a.copy(T.pos); _a.x += offX * k3; _a.y += offY * k3; op = 1 - k3; sc = 1 + 0.15 * k3; }
        else op = 0;
      }
      if (op > 0.01) {
        f.visible = true; f.position.copy(_a);
        var fs = 128 * sc * wpp(_a);
        f.scale.set(fs, fs, 1);
        f.material.opacity = 0.7 * op * U.clamp01(s.idle - K.HINT2 + 0.3);
      }
    } else hint.fClock = 0;
  }

  /* ───────── 当たり判定 ───────── */
  var cands = [];
  for (var ci = 0; ci < 24; ci++) cands.push({ kind: '', idx: 0, pos: new V3(), r: 0, w: 1 });
  var nc = 0;
  function cand(kind, idx, p, r, w) {
    if (nc >= cands.length) return;
    var c = cands[nc++]; c.kind = kind; c.idx = idx; c.pos.copy(p); c.r = r; c.w = w == null ? 1 : w;
  }
  function buildCands() {
    nc = 0;
    var ph = s.phase, day = !!DAY[ph];
    if (day) {
      cand('handle', 0, HANDLE, 0.05);
      if (!canHeld()) cand('can', 0, canCenter(_a), 0.13);
    }
    if (ph === 'sleep' && !s.waking) cand('can', 0, canCenter(_a), 0.13);
    if (ph === 'plant' && !s.planted && !seedAnim) { _a.copy(seedPos); _a.y += 0.05; cand('seed', 0, _a, 0.09); }
    if (ph !== 'plant' || s.planted) {
      for (var i = 0; i < 3; i++) { var S = leafSpheres[i]; if (S.y > 0) { _a.set(S.x, S.y, S.z + S.r * 0.5); cand('leaf', i, _a, S.r, 0.8); } }
    }
    if (ph !== 'eat') cand('pinwheel', 0, world.pinwheel.center, 0.09, 0.9);
    if (!s.zaruOn && ph !== 'eat') { _a.set(L.BUCKET[0], 0.14, L.BUCKET[2]); cand('bucket', 0, _a, 0.1, 0.9); }
    // 実
    if (s.fr > 0.05 && ph !== 'eat') {
      for (var j = 0; j < 7; j++) {
        if (s.picked[j]) continue;
        cand('fruit', j, plant.fruits[j].pos, 0.04, 1.1);
      }
    }
    if (ph === 'eat') {
      for (var k = 0; k < 6; k++) if (!(s.eatMask & (1 << k)) && zf[k].visible) cand('zfruit', k, zaruSlotWorld(k, _a), 0.035, 1.1);
    }
  }
  function pick(px, py) {
    buildCands();
    var T = (hint.key && !hold) ? tgt : null;
    var best = null, bs = 1e9;
    for (var i = 0; i < nc; i++) {
      var c = cands[i];
      screenOf(c.pos, _scr); if (!_scr.ok) continue;
      var rpx = Math.max(K.HIT_MIN, c.r / wpp(c.pos)) * c.w;
      var main = T && hint.key && ((T.kind === c.kind && T.idx === c.idx) || (T.kind === 'can' && c.kind === 'can') || (T.kind === 'late' && c.kind === 'fruit' && c.idx === LATE));
      if (main) rpx *= K.HIT_MAIN;
      var d = Math.sqrt((_scr.x - px) * (_scr.x - px) + (_scr.y - py) * (_scr.y - py));
      if (d > rpx) continue;
      var sc = d / rpx - (main ? 0.25 : 0);
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }

  /* ───────── 入力 ───────── */
  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    if (dead) return;
    if (ptrId !== null) return;          // 2本目以降の指は無視
    ptrId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (e1) { }
    try { if (G.Audio) G.Audio.init(); } catch (e2) { }
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.dx = ptr.x; ptr.dy = ptr.y; ptr.moved = 0;
    s.idle = 0;
    try { grab(ptr.x, ptr.y); } catch (err) { hold = null; }
  }
  function onMove(e) {
    if (e.pointerId !== ptrId) return;
    if (e.cancelable) e.preventDefault();
    var x = e.clientX, y = e.clientY;
    var mx = x - ptr.x;
    ptr.x = x; ptr.y = y;
    ptr.moved = Math.max(ptr.moved, Math.sqrt((x - ptr.dx) * (x - ptr.dx) + (y - ptr.dy) * (y - ptr.dy)));
    if (hold && hold.kind === 'handle') turnHandle(mx);
  }
  function onUp(e) {
    if (e.pointerId !== ptrId) return;
    release(false);
  }
  function release(forced) {
    var h = hold; hold = null; ptrId = null;
    if (!h) return;
    try { drop(h, forced); } catch (e) { }
  }

  function grab(px, py) {
    var ph = s.phase;
    var c = pick(px, py);
    if (!c) {
      // 空：夜は近くの星が光る
      if (world.night > 0.4) {
        rayDir(px, py, _d);
        if (world.twinkle(_d)) snd('star', Math.floor(rnd() * 8));
      }
      return;
    }
    switch (c.kind) {
      case 'handle':
        hold = { kind: 'handle', turned: false };
        snd('touch'); handleJig = 0.7;
        break;
      case 'can':
        if (ph === 'sleep') { wake(); return; }
        grabCan(px, py);
        break;
      case 'seed':
        hold = { kind: 'seed', off: new V3() };
        planePoint(px, py, L.SEEDLING_START[2], _a);
        screenOf(seedPos, _scr); planePoint(_scr.x, _scr.y, L.SEEDLING_START[2], _b);
        hold.off.subVectors(_b, _a);
        seedAnim = null;
        snd('touch'); plant.shake(0.45); snd('leaf');
        break;
      case 'leaf':
        plant.poke(c.pos, 0.85); snd('leaf');
        break;
      case 'pinwheel':
        screenOf(world.pinwheel.center, _scr);
        world.pinwheel.addSpin((px > _scr.x ? 1 : -1) * 16);
        snd('pinwheel', 0.6); lastPw = s.clock;
        break;
      case 'bucket':
        world.bucket.ring(0.8); snd('bucket', 0.85, rnd());
        break;
      case 'fruit':
        grabFruit(c.idx, px, py);
        break;
      case 'zfruit':
        eatFruit(c.idx);
        break;
    }
  }
  function grabFruit(i, px, py) {
    var ph = s.phase, f = plant.fruits[i];
    var red = (ph === 'harvest' && !f.late) || (ph === 'sunset' && f.late && s.lateReady);
    var stubborn = ph === 'harvest' && f.late;
    if (!red && !stubborn) { plant.poke(f.pos, 0.5); snd('boing'); return; }
    hold = { kind: 'fruit', idx: i, origin: f.pos.clone(), picked: false, can: red, fruit: null };
    snd('touch'); plant.poke(f.pos, 0.25);
    planePoint(px, py, hold.origin.z, _a); plant.pull(i, _a);
  }
  function grabCan(px, py) {
    if (canAnim) { canAnim = null; }
    var wasHome = s.canState === 'home';
    s.canState = 'held';
    hold = { kind: 'can', off: new V3(), fromHome: wasHome };
    planePoint(px, py, L.CAN_CARRY_Z, _a);
    screenOf(canPos, _scr); planePoint(_scr.x, _scr.y, L.CAN_CARRY_Z, _b);
    hold.off.subVectors(_b, _a);
    // 指より下にじょうろの底が来すぎないよう、つかんだ点のずれは控えめに
    hold.off.y = U.clamp(hold.off.y, -0.30, 0.05); hold.off.x = U.clamp(hold.off.x, -0.15, 0.15);
    canPos.y += 0.02;
    snd('lift');
    if (s.fill > 0.1) { sloshV += 1.5; }
  }
  function turnHandle(mx) {
    var h = hold;
    if (!h.turned && ptr.moved < K.TAP_PX) return;
    if (!h.turned) { h.turned = true; tapAnim = null; }
    if (mx === 0) return;
    if (s.open <= 0.01) s.tapDir = mx > 0 ? 1 : -1;
    var prev = s.open;
    s.open = U.clamp01(s.open + mx * s.tapDir * K.TURN_PER_PX / K.TURN_MAX);
    if (Math.abs(s.open - prev) > 0.0005 && s.clock - lastSqueak > 0.11) { lastSqueak = s.clock; snd('squeak', U.clamp01(Math.abs(mx) / 12)); }
  }
  function drop(h, forced) {
    switch (h.kind) {
      case 'handle':
        if (!h.turned && !forced) {
          tapAnim = { from: s.open, to: s.open > 0.3 ? 0 : 1, t: 0 };
          snd('squeak', 0.6); lastSqueak = s.clock;
        }
        break;
      case 'can': releaseCan(); break;
      case 'seed': releaseSeed(); break;
      case 'fruit': releaseFruit(h); break;
    }
  }

  /* ───────── 蛇口 ───────── */
  function updateTap(dt) {
    if (tapAnim) {
      tapAnim.t += dt / K.TAP_TOGGLE;
      var k = U.clamp01(tapAnim.t);
      s.open = U.lerp(tapAnim.from, tapAnim.to, ease(k));
      if (s.clock - lastSqueak > 0.12 && k < 0.9) { lastSqueak = s.clock; snd('squeak', 0.5); }
      if (k >= 1) tapAnim = null;
    }
    if (!DAY[s.phase] && !hold) { if (s.open > 0) { s.open = Math.max(0, s.open - dt * 2); } }
    s.flow = U.damp(s.flow, s.open, 6, dt);
    if (s.open <= 0 && s.flow < 0.004) s.flow = 0;
    handleJig *= Math.exp(-4 * dt);
    world.tap.setTurn(s.open * K.TURN_MAX * s.tapDir + handleJig * 0.06 * Math.sin(s.clock * 46));
    var mode = 'can', fill = s.fill;
    if (s.flow > 0.005) {
      var home = s.canState === 'home' && !canAnim;
      if (home) {
        water.setTapStream(s.flow, OUTLET, can.waterY(), 'can');
        s.fill = Math.min(1, s.fill + s.flow * dt / K.FILL_SEC);
        if (s.fill >= 1) {
          mode = 'over';
          _a.set(canPos.x, canPos.y + 0.222, canPos.z);
          water.overflow(_a, 0.112, s.flow);
          overT -= dt;
          if (overT <= 0) {
            overT = 0.25 + rnd() * 0.25;
            var an = rnd() * PI * 2;
            _b.set(_a.x + Math.cos(an) * 0.11, _a.y, _a.z + Math.sin(an) * 0.11);
            water.splash(_b, 0.25 + 0.2 * s.flow);
            var e = rnd() * PI * 2;
            world.wetFloor(L.PAN[0] + Math.cos(e) * 0.24, L.PAN[2] + Math.sin(e) * 0.24, 0.25 * s.flow);
          }
        }
      } else {
        mode = 'pan'; fill = 0;
        water.setTapStream(s.flow, OUTLET, 0.022, 'pan');
        overT -= dt;
        if (overT <= 0) { overT = 0.5 + rnd() * 0.4; var e2 = rnd() * PI * 2; world.wetFloor(L.PAN[0] + Math.cos(e2) * 0.23, L.PAN[2] + Math.sin(e2) * 0.23, 0.15 * s.flow); }
      }
    }
    try { if (G.Audio) G.Audio.tap(s.flow > 0.005 ? s.flow : 0, fill, mode); } catch (e3) { }
  }
  var overT = 0;

  /* ───────── じょうろ ───────── */
  function canBaseY(x, zp) { return 0.03 * (1 - zp); }
  function updateCan(dt) {
    canPrev.copy(canPos);
    if (canHeld()) {
      planePoint(ptr.x, ptr.y, L.CAN_CARRY_Z, _a);
      _a.add(hold.off);
      var tx = U.clamp(_a.x, L.CAN_X_MIN, L.CAN_X_MAX);
      var dist = Math.sqrt((canPos.x - HOME.x) * (canPos.x - HOME.x) + (canPos.y - HOME.y) * (canPos.y - HOME.y));
      canZProg = U.smooth(0, K.CAN_Z_MOVE, dist);
      var base = canBaseY(tx, canZProg);
      var ty = U.clamp(_a.y, base + 0.035, L.CAN_Y_MAX);
      canPos.x = U.damp(canPos.x, tx, K.CAN_LAMBDA, dt);
      canPos.y = U.damp(canPos.y, ty, K.CAN_LAMBDA, dt);
      canPos.z = U.lerp(HOME.z, L.CAN_CARRY_Z, canZProg);
      canYaw = U.lerp(K.CAN_HOME_YAW, K.CAN_CARRY_YAW, canZProg);
    } else if (canAnim) {
      canAnim.t += dt / canAnim.dur;
      var k = U.clamp01(canAnim.t), kk = canAnim.fall ? k * k : ease(k);
      canPos.lerpVectors(canAnim.from, canAnim.to, kk);
      if (!canAnim.fall) canPos.y += Math.sin(k * PI) * 0.04;
      canYaw = U.lerp(canAnim.yaw0, canAnim.yaw1, ease(k));
      if (k >= 1) {
        s.canState = canAnim.state; canAnim = null;
        snd('put'); canKickV += 1.2;
        if (s.fill > 0.1) sloshV += 2;
        save();
      }
    } else if (s.canState === 'home') { canPos.copy(HOME); canYaw = K.CAN_HOME_YAW; }
    else { canPos.set(U.clamp(canPos.x, L.CAN_X_MIN, L.CAN_X_MAX), 0, L.CAN_CARRY_Z); canYaw = K.CAN_CARRY_YAW; }

    // 速さ・揺れ
    var idt = dt > 1e-4 ? 1 / dt : 0;
    canVel.set((canPos.x - canPrev.x) * idt, (canPos.y - canPrev.y) * idt, 0);
    var acc = Math.sqrt((canVel.x - canVelPrev.x) * (canVel.x - canVelPrev.x) + (canVel.y - canVelPrev.y) * (canVel.y - canVelPrev.y)) * idt;
    canVelPrev.copy(canVel);
    var swingT = canHeld() ? U.clamp(canVel.x * 0.35, -0.2, 0.2) : 0;
    canSwingV += (60 * (swingT - canSwing) - 2 * 0.35 * Math.sqrt(60) * canSwingV) * dt; canSwing += canSwingV * dt;
    canKickV += (-220 * canKick - 2 * 0.22 * Math.sqrt(220) * canKickV) * dt; canKick += canKickV * dt;
    var tiltT = canHeld() ? U.smooth(K.TILT_A, K.TILT_B, canPos.y) * K.TILT_MAX + canSwing : 0;
    canTilt = U.damp(canTilt, tiltT, 9, dt);
    // 水のゆれ
    if (canHeld() && acc > 9 && s.fill > 0.05) {
      sloshV += U.clamp(-canVel.x * 0.6, -2, 2);
      if (s.clock - lastSloshSnd > 0.45) { lastSloshSnd = s.clock; snd('slosh', U.clamp01(acc / 30) * Math.min(1, s.fill * 2)); }
    }
    sloshV += (-70 * slosh - 2 * 0.12 * Math.sqrt(70) * sloshV) * dt; slosh += sloshV * dt;

    can.group.position.copy(canPos);
    can.group.rotation.y = canYaw;
    can.setTilt(U.clamp(canTilt + canKick * 0.5, -0.3, 1.25));
    can.setFill(s.fill);
    can.setSlosh(U.clamp(slosh, -1, 1));
  }
  function sendCanHome() {
    if (canHeld() || s.canState === 'home' || (canAnim && canAnim.state === 'home')) return;
    canAnim = { from: canPos.clone(), to: HOME.clone(), t: 0, dur: 0.45, yaw0: canYaw, yaw1: K.CAN_HOME_YAW, state: 'home', fall: false };
    s.canState = 'moving';
  }
  function releaseCan() {
    if (canPos.x < K.CAN_SNAP_X || (s.phase === 'wash' && s.washed >= K.WASH_NEED)) {
      canAnim = { from: canPos.clone(), to: HOME.clone(), t: 0, dur: 0.35, yaw0: canYaw, yaw1: K.CAN_HOME_YAW, state: 'home', fall: false };
    } else {
      var hgt = Math.max(0.01, canPos.y);
      canAnim = { from: canPos.clone(), to: new V3(canPos.x, 0, L.CAN_CARRY_Z), t: 0, dur: Math.max(0.16, Math.sqrt(2 * hgt / 9.8) * 1.4), yaw0: canYaw, yaw1: K.CAN_CARRY_YAW, state: 'floor', fall: true };
    }
    s.canState = 'moving';
  }

  /* ───────── 注ぐ ───────── */
  var pourSm = 0, pouring = false, rainbowDone = false, emptyDrips = 0, emptyT = 0, lastRing = 0, lastPoke = 0, lastFloor = 0, lastPw = 0, wasPour = false;
  function updatePour(dt) {
    var rate = 0;
    if (canHeld() && canTilt > K.POUR_A) {
      if (s.fill > 0) {
        rate = U.smooth(K.POUR_A, K.POUR_B, canTilt);
        can.rosePos(_rp); can.roseDir(_rd);
        water.shower(_rp, _rd, rate, dt);
        s.fill = Math.max(0, s.fill - rate * dt / K.POUR_SEC);
        if (s.fill <= 0) { emptyDrips = 4; emptyT = 0; }
      } else if (emptyDrips > 0) {
        emptyT -= dt;
        if (emptyT <= 0) { emptyT = 0.2 + rnd() * 0.25; emptyDrips--; can.rosePos(_rp); _rp.x += (rnd() - 0.5) * 0.02; water.drip(_rp, 0); }
      }
    }
    pouring = rate > 0;
    if (!pouring && wasPour) rainbowDone = false;
    wasPour = pouring;
    pourSm = U.damp(pourSm, rate / K.POUR_SEC, 3.3, dt);
    // 当たりの割合（0.3秒ほどの移動平均）
    var lam = 3.3, idt = dt > 1e-4 ? 1 / dt : 0, tot = 0;
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      hitAvg[k] = U.damp(hitAvg[k], hitAcc[k] * idt, lam, dt); hitAcc[k] = 0;
    }
    tot = hitAvg.soil + hitAvg.metal + hitAvg.zaru + hitAvg.floor + 0.25 * hitAvg.leaf + 0.3 * hitAvg.pinwheel + 1e-3;
    for (i = 0; i < KINDS.length; i++) hitFrac[KINDS[i]] = Math.min(1, hitAvg[KINDS[i]] / tot);
    var dW = pourSm * dt;
    if (dW > 1e-6) {
      var add = dW * (hitFrac.soil + 0.6 * hitFrac.leaf);
      if (s.phase === 'water') s.watered = Math.min(2, s.watered + add);
      else s.moist = Math.min(1, s.moist + add * 0.8);
      if (s.zaruOn) s.washed = Math.min(2, s.washed + dW * hitFrac.zaru * 1.4);
      if (hitFrac.leaf > 0.04) {
        s.leafWet = Math.min(1, s.leafWet + dW * hitFrac.leaf * 5);
        if (s.clock - lastPoke > 0.16) { lastPoke = s.clock; plant.poke(hitPos.leaf, 0.2 + 0.5 * hitFrac.leaf); }
      }
      if (hitFrac.pinwheel > 0.02) {
        var side = hitPos.pinwheel.x >= world.pinwheel.center.x ? 1 : -1;
        world.pinwheel.addSpin(side * hitFrac.pinwheel * pourSm * K.POUR_SEC * 40 * dt);
      }
      if (hitFrac.metal > 0.03 && s.clock - lastRing > 0.07 + rnd() * 0.08) {
        lastRing = s.clock; world.bucket.ring(0.2 + 0.5 * hitFrac.metal); snd('bucket', 0.35 + 0.6 * hitFrac.metal, rnd());
      }
      if (hitFrac.floor > 0.03 && s.clock - lastFloor > 0.1) {
        lastFloor = s.clock; world.wetFloor(hitPos.floor.x, hitPos.floor.z, hitFrac.floor * pourSm * K.POUR_SEC * 0.7);
      }
    }
    try {
      if (G.Audio) G.Audio.shower(pourSm * K.POUR_SEC > 0.02 ? U.clamp01(pourSm * K.POUR_SEC) : 0,
        { soil: hitFrac.soil, leaf: hitFrac.leaf, floor: hitFrac.floor, metal: hitFrac.metal, zaru: hitFrac.zaru });
    } catch (e) { }
    if (water.rainbow > 0.5 && !rainbowDone) { rainbowDone = true; snd('rainbow'); }
  }

  /* ───────── 苗 ───────── */
  function updateSeed(dt) {
    if (s.phase !== 'plant' || s.planted && !seedAnim) return;
    if (hold && hold.kind === 'seed') {
      planePoint(ptr.x, ptr.y, L.SEEDLING_START[2], _a); _a.add(hold.off);
      var tx = U.clamp(_a.x, -0.62, 0.6), ty = U.clamp(_a.y, seedFloorY(), 1.0);
      var px = seedPos.x;
      seedPos.x = U.damp(seedPos.x, tx, K.CAN_LAMBDA, dt);
      seedPos.y = U.damp(seedPos.y, ty, K.CAN_LAMBDA, dt);
      seedPos.z = seedZ(seedPos.x);
      seedTilt = U.damp(seedTilt, U.clamp(-(seedPos.x - px) / Math.max(dt, 1e-3) * 0.25, -0.35, 0.35), 8, dt);
      if (Math.abs(seedPos.x - L.PLANT_BASE[0]) < K.SEED_SNAP) plantIn();
    } else if (seedAnim) {
      seedAnim.t += dt / seedAnim.dur;
      var k = U.clamp01(seedAnim.t);
      seedPos.lerpVectors(seedAnim.from, seedAnim.to, seedAnim.fall ? k * k : ease(k));
      if (!seedAnim.fall) seedPos.y += Math.sin(k * PI) * 0.05;
      if (seedAnim.hole) s.hole = 1 - k;
      seedTilt = U.damp(seedTilt, 0, 10, dt);
      if (k >= 1) { var f = seedAnim.done; seedAnim = null; if (f) f(); }
    } else seedTilt = U.damp(seedTilt, 0, 10, dt);
    plant.root.position.copy(seedPos);
    plant.root.rotation.z = seedTilt;
  }
  function releaseSeed() {
    if (s.planted) return;
    seedAnim = { from: seedPos.clone(), to: new V3(seedPos.x, seedFloorY(), seedZ(seedPos.x)), t: 0, dur: Math.max(0.12, Math.sqrt(2 * Math.max(0.001, seedPos.y - seedFloorY()) / 9.8) * 1.3), fall: true,
      done: function () { snd('potBounce', 0.4); plant.shake(0.3); s.seedX = seedPos.x; save(); } };
  }
  function plantIn() {
    s.planted = true; hold = null;
    snd('touch');
    seedAnim = { from: seedPos.clone(), to: new V3(L.PLANT_BASE[0], L.PLANT_BASE[1], L.PLANT_BASE[2]), t: 0, dur: 0.35, fall: false, hole: true,
      done: function () {
        s.hole = 0; seedTilt = 0; plant.root.rotation.z = 0; snd('plantIn'); plant.shake(0.6);
        plant.dropPot(_a.set(s.pot[0], 0, s.pot[1]));
        at(1.2, 0.5, function (k) { s.thirst = ease(k); });
        at(1.2, 0, function () { snd('droop'); });
        at(1.9, 0, null, function () { enter('water'); });
      } };
  }

  /* ───────── 実（つまむ・運ぶ・食べる） ───────── */
  function poolGet() {
    for (var i = 0; i < pool.length; i++) if (!pool[i].busy) { pool[i].busy = true; var o = pool[i].obj; o.visible = true; o.userData.setCalyxOnly(false); o.userData.setWet(0); o.userData.setRipe(1); o.scale.set(1, 1, 1); o.rotation.set(0, rnd() * 6, 0); return pool[i]; }
    return null;
  }
  function poolPut(p) { p.busy = false; p.obj.visible = false; }
  function fly(p, from, kind, slot, dur, done) {
    for (var i = 0; i < flyers.length; i++) if (!flyers[i].on) {
      var f = flyers[i]; f.on = true; f.p = p; f.from.copy(from); f.kind = kind; f.slot = slot; f.t = 0; f.dur = dur; f.done = done;
      return f;
    }
    if (done) done(); if (p) poolPut(p); return null;
  }
  function flyTarget(f, out) {
    if (f.kind === 'mouth') return camera.localToWorld(out.set(0, -0.12, -0.45));
    return zaruSlotWorld(f.slot, out);
  }
  function updateFlyers(dt) {
    for (var i = 0; i < flyers.length; i++) {
      var f = flyers[i]; if (!f.on) continue;
      f.t += dt / f.dur;
      var k = U.clamp01(f.t);
      flyTarget(f, _b);
      var o = f.p.obj;
      o.position.lerpVectors(f.from, _b, f.kind === 'mouth' ? ease(k) : k);
      if (f.kind !== 'mouth') o.position.y += Math.sin(k * PI) * (f.kind === 'calyx' ? 0.10 : 0.13);
      else { var sc = 1 + 0.6 * k * k; o.scale.set(sc, sc, sc); }
      o.rotation.y += dt * 3;
      if (k >= 1) { f.on = false; var d = f.done; poolPut(f.p); if (d) d(); }
    }
    // 手に持っている実
    if (hold && hold.kind === 'fruit' && hold.picked && hold.fruit) {
      planePoint(ptr.x, ptr.y, hold.origin.z, _a); _a.y += 0.05;
      hold.fruit.obj.position.x = U.damp(hold.fruit.obj.position.x, _a.x, 20, dt);
      hold.fruit.obj.position.y = U.damp(hold.fruit.obj.position.y, _a.y, 20, dt);
      hold.fruit.obj.position.z = _a.z;
    }
    // ざるの実の小さな跳ね
    for (var q = 0; q < 6; q++) {
      var base = zfBase[q];
      if (zfHop[q] > 0) {
        zfHop[q] += dt;
        var hk = zfHop[q] / 0.28;
        zf[q].position.set(base.x, base.y + (hk < 1 ? Math.sin(hk * PI) * 0.014 : 0), base.z);
        if (hk >= 1) zfHop[q] = 0;
      }
    }
  }
  function updateHeldFruit() {
    if (!hold || hold.kind !== 'fruit') return;
    var h = hold;
    if (h.picked) return;
    planePoint(ptr.x, ptr.y, h.origin.z, _a);
    plant.pull(h.idx, _a);
    if (h.can && _a.distanceTo(h.origin) > K.PICK_DIST) {
      plant.pick(h.idx); s.picked[h.idx] = true; h.picked = true; snd('pluck');
      h.fruit = poolGet();
      if (h.fruit) { h.fruit.obj.position.copy(plant.fruits[h.idx].pos); h.fruit.obj.userData.setRipe(1); }
      if (h.idx === LATE) s.lateFlying = true;
    }
  }
  function releaseFruit(h) {
    if (!h.picked) {
      plant.pull(h.idx, null);
      snd('boing');
      return;
    }
    var p = h.fruit;
    if (!p) { landFruit(h.idx, -1); return; }
    _a.copy(p.obj.position);
    if (h.idx === LATE) {
      fly(p, _a, 'mouth', 0, 0.38, function () {
        snd('bite'); snd('yum'); s.lateDone = true; s.lateFlying = false; save();
        at(1.0, 0, null, function () { enter('sleep'); });
      });
      p.obj.visible = true; p.busy = true;
    } else {
      var slot = Math.min(5, s.zaruNext++);
      fly(p, _a, 'zaru', slot, 0.42, function () { landFruit(h.idx, slot); });
    }
  }
  function landFruit(idx, slot) {
    if (slot < 0) slot = Math.min(5, s.inZaru);
    zf[slot].visible = true; zf[slot].userData.setCalyxOnly(false);
    s.inZaru = Math.min(6, s.inZaru + 1);
    snd('drop');
    for (var q = 0; q < 6; q++) if (zf[q].visible) zfHop[q] = q === slot ? 0.001 : (rnd() < 0.6 ? 0.06 : 0);
    save();
    if (s.inZaru >= 6 && s.phase === 'harvest') {
      snd('sparkle');
      at(0.9, 0, null, function () { enter('wash'); });
    }
  }
  function eatFruit(k) {
    if (s.eatMask & (1 << k)) return;
    var p = poolGet();
    s.eatMask |= (1 << k);
    snd('touch');
    zaruSlotWorld(k, _a);
    zf[k].visible = false;
    if (!p) { biteDone(k); return; }
    p.obj.userData.setWet(1);
    fly(p, _a, 'mouth', k, 0.38, function () {
      biteDone(k);
      var c = poolGet();
      if (c) {
        c.obj.userData.setCalyxOnly(true);
        camera.localToWorld(_b.set(0, -0.12, -0.45));
        c.obj.position.copy(_b);
        fly(c, _b, 'calyx', k, 0.5, function () { zf[k].visible = true; zf[k].userData.setCalyxOnly(true); zfHop[k] = 0.001; });
      } else { zf[k].visible = true; zf[k].userData.setCalyxOnly(true); }
    });
  }
  function biteDone(k) {
    snd('bite', rnd());
    s.eaten = Math.min(6, s.eaten + 1);
    if (s.eaten % 2 === 0) at(0.25, 0, null, function () { snd('yum'); });
    save();
    if (s.eaten >= 6 && s.phase === 'eat') at(1.0, 0, null, function () { enter('sunset'); });
  }

  /* ───────── phase ───────── */
  function settleVisuals() {
    var st = s.stage;
    s.g = st >= 1 ? 1 : 0;
    s.fl = st >= 2 ? 1 : (st === 1 && s.watered >= K.NEED ? 1 : 0);
    s.fr = st >= 3 ? 1 : (st === 2 ? (s.watered >= K.NEED ? 1 : 0.8) : 0);
    s.rp = st >= 3 ? 1 : 0;
    s.lr = 0;
  }
  function zaruShow(on) {
    s.zaruOn = on; zaru.group.visible = on;
    if (!on) {
      for (var k = 0; k < 6; k++) { zf[k].visible = false; zf[k].userData.setCalyxOnly(false); zf[k].userData.setWet(0); }
      s.zaruWet = 0; zaru.setWet(0);
    }
  }
  function enter(ph) {
    s.phase = ph; s.pt = 0; tl.length = 0; tlGen++;
    s.idle = 0;
    switch (ph) {
      case 'plant':
        s.planted = false; s.hole = 1; s.thirst = 0; s.moist = 0;
        break;
      case 'water':
        s.rewarded = s.watered >= K.NEED; s.rewardDone = s.rewarded;
        break;
      case 'night': startNight(); break;
      case 'harvest':
        zaruShow(true); s.thirst = 0;
        break;
      case 'wash':
        zaruShow(true); s.washDone = s.washed >= K.WASH_NEED;
        break;
      case 'eat':
        zaruShow(true); sendCanHome();
        break;
      case 'sunset': startSunset(); break;
      case 'sleep': startSleep(); break;
    }
    save(true);
  }
  var prevThirst = 0;
  function phaseLogic(dt) {
    var ph = s.phase;
    if (ph === 'water') {
      var r = s.watered / K.NEED;
      var th = 1 - U.smooth(0.15, 0.55, r);
      if (prevThirst > 0.5 && th <= 0.5) { snd('perk'); plant.shake(0.8); }
      prevThirst = th; s.thirst = th;
      s.moist = Math.max(s.moist, U.clamp01(r));
      if (!s.rewarded && s.watered >= K.NEED) reward();
      if (s.rewardDone && !canHeld() && s.canState !== 'held' && tapClosed()) enter('night');
    } else prevThirst = s.thirst;
    if (ph === 'wash') {
      var wv = U.clamp01(s.washed / K.WASH_NEED);
      if (wv > s.zaruWet) s.zaruWet = wv;
      if (!s.washDone && s.washed >= K.WASH_NEED) { s.washDone = true; s.washAt = s.pt; snd('sparkle'); plant.shake(0.2); }
      if (s.washDone && s.pt - (s.washAt || 0) > 1.2 && !canHeld() && s.canState !== 'held' && tapClosed()) enter('eat');
    }
    if (ph === 'sleep' && !s.waking && s.pt > 1.5) {
      s.sleepMusicT -= dt;
      if (s.sleepMusicT <= 0) { s.sleepMusicT = 19; try { if (G.Audio) G.Audio.music('lullaby'); } catch (e) { } }
    }
    // 床に落ちた水が見えるよう、夜は葉の水玉も乾く
    if (ph !== 'water' && ph !== 'wash' && ph !== 'plant') s.leafWet = Math.max(0, s.leafWet - dt * 0.15);
    else s.leafWet = Math.max(0, s.leafWet - dt * 0.01);
  }
  function reward() {
    s.rewarded = true;
    snd('sparkle');
    if (s.stage === 0) { plant.shake(0.8); }
    else if (s.stage === 1) {
      tween(0.1, 2.2, 'fl', s.fl, 1, function (k) { return k; });
      for (var i = 0; i < 6; i++) (function (i) { at(0.15 + i * 0.37, 0, null, function () { snd('bloom', i); plant.shake(0.15); }); })(i);
    } else if (s.stage === 2) {
      tween(0.05, 0.6, 'fr', s.fr, 1);
      at(0.05, 0, null, function () { plant.bounceFruits(); snd('swell'); });
    }
    at(1.5 + (s.stage === 1 ? 1.0 : 0), 0, null, function () { s.rewardDone = true; });
    save();
  }
  function startNight() {
    var st = s.stage;
    hint.key = '';
    at(0, 0, null, function () { snd('dayPass'); });
    tween(0, 2.4, 'time', 0.30, 0.74);
    tween(2.4, 1.6, 'time', 0.74, 0.94);
    var m0 = s.moist, w0 = s.leafWet;
    tween(1.2, 3.0, 'moist', m0, 0);
    tween(1.2, 3.0, 'leafWet', w0, 0);
    at(4.2, 0, null, function () { s.watered = 0; if (st === 2) { zaruShow(true); if (!canAnim) { s.canState = 'home'; canPos.copy(HOME); canYaw = K.CAN_HOME_YAW; } } });
    at(4.15, 0, null, function () { snd('star', 2); });
    at(4.45, 0, null, function () { snd('star', 4); });
    at(4.8, 0, null, function () { snd('star', 6); });
    var mornDone = false;
    at(4.9, 2.6, function (k) {
      s.time = 0.94 + 0.36 * ease(k);
      if (!mornDone && s.time >= 1.22) { mornDone = true; snd('morning'); }
    });
    var g0 = 4.9 + (1.18 - 0.94) / 0.36 * 2.6, gd = st === 2 ? 2.6 : 2.4;
    if (st === 0) { tween(g0, 2.4, 'g', 0, 1); at(g0, 0, null, function () { snd('grow', 2.4); }); }
    else if (st === 1) { s.fl = 1; tween(g0, 2.4, 'fr', 0, 0.8); at(g0, 0, null, function () { snd('grow', 2.4); }); }
    else {
      tween(g0, 2.6, 'rp', 0, 1, function (k) { return k; });
      for (var i = 0; i < 6; i++) (function (i) { at(g0 + 0.15 + i * 0.42, 0, null, function () { snd('ripen', i); }); })(i);
    }
    at(Math.max(7.5, g0 + gd) + 0.5, 0, null, function () {
      s.time = 0.30; s.stage = st + 1; s.watered = 0; s.rewarded = false; s.rewardDone = false;
      if (s.stage <= 2) {
        enter('water');
        tween(0, 0.6, 'thirst', 0, 1); at(0, 0, null, function () { snd('droop'); });
      } else {
        s.moist = 0.35; s.picked = [false, false, false, false, false, false, false]; s.inZaru = 0; s.zaruNext = 0; s.washed = 0; s.eaten = 0; s.eatMask = 0; s.lateDone = false;
        enter('harvest');
      }
    });
  }
  function startSunset() {
    s.lateReady = false; s.lateFlying = false; s.lr = 0;
    at(0, 0, null, function () { snd('dayPass'); });
    tween(0, 3.0, 'time', 0.30, 0.72);
    tween(3.0, 1.6, 'lr', 0, 1);
    at(3.0, 0, null, function () { snd('ripen', 3); });
    at(3.8, 0, null, function () { snd('ripen', 5); });
    at(4.6, 0, null, function () { snd('sparkle'); plant.poke(plant.fruits[LATE].pos, 0.4); s.lateReady = true; });
  }
  function startSleep() {
    s.waking = false; s.sleepMusicT = 0;
    tween(0, 2.5, 'time', Math.min(s.time, 0.94), 0.94);
  }
  function wake() {
    if (s.waking) return;
    s.waking = true;
    snd('touch'); canKickV -= 3; snd('put');
    try { if (G.Audio) G.Audio.music(null); } catch (e) { }
    var mornDone = false, t0 = s.time;
    at(0, 2.6, function (k) {
      s.time = t0 + (1.30 - t0) * ease(k);
      if (!mornDone && s.time >= 1.22) { mornDone = true; snd('morning'); }
    });
    at(0.5, 0, null, function () {
      zaruShow(false);
      plant.resetFruits();
      s.picked = [false, false, false, false, false, false, false];
      s.g = 1; s.fl = 0; s.fr = 0; s.rp = 0; s.lr = 0; s.inZaru = 0; s.zaruNext = 0; s.washed = 0; s.eaten = 0; s.eatMask = 0; s.lateDone = false;
      s.cycle++; s.stage = 1; s.watered = 0; s.moist = 0;
    });
    at(2.9, 0, null, function () {
      s.time = 0.30; s.waking = false;
      enter('water');
      tween(0, 0.6, 'thirst', 0, 1); at(0, 0, null, function () { snd('droop'); });
    });
  }

  /* 保存から、その phase の落ち着いた状態を作る */
  function restore() {
    var ph = s.phase;
    s.time = 0.30;
    // じょうろ
    s.open = 0; s.flow = 0;
    if (ph === 'eat' || ph === 'sunset' || ph === 'sleep') s.canState = 'home';
    if (s.canState === 'floor') { canPos.set(s.canX, 0, L.CAN_CARRY_Z); canYaw = K.CAN_CARRY_YAW; } else { s.canState = 'home'; canPos.copy(HOME); canYaw = K.CAN_HOME_YAW; }
    // 苗とポット
    if (ph === 'plant') {
      s.stage = 0; s.watered = 0;
      seedPos.set(s.seedX, seedFloorY(), seedZ(s.seedX));
      plant.placePot(null);
      s.hole = 1;
    } else {
      seedPos.set(L.PLANT_BASE[0], L.PLANT_BASE[1], L.PLANT_BASE[2]);
      plant.placePot(_a.set(s.pot[0], 0, s.pot[1]));
      s.hole = 0;
    }
    plant.root.position.copy(seedPos);
    settleVisuals();
    zaruShow(false);
    if (ph === 'water') { s.thirst = 1 - U.smooth(0.15, 0.55, s.watered / K.NEED); s.moist = U.clamp01(s.watered / K.NEED); }
    if (ph === 'night') { s.watered = Math.max(s.watered, K.NEED); s.thirst = 0; s.moist = 1; settleVisuals(); }
    if (['harvest', 'wash', 'eat', 'sunset', 'sleep'].indexOf(ph) >= 0) {
      s.moist = 0.35; s.thirst = 0;
      zaruShow(true);
      var n = 0;
      if (ph === 'harvest') { for (var i = 0; i < 7; i++) if (RED.indexOf(i) >= 0 && s.picked[i]) n++; s.picked[LATE] = false; }
      else { for (var j = 0; j < 7; j++) s.picked[j] = RED.indexOf(j) >= 0 ? true : s.picked[j]; n = 6; }
      s.inZaru = n; s.zaruNext = n;
      if (ph === 'wash') s.zaruWet = U.clamp01(s.washed / K.WASH_NEED);
      if (ph === 'eat' || ph === 'sunset' || ph === 'sleep') { s.zaruWet = 1; s.washed = Math.max(s.washed, K.WASH_NEED); }
      if (ph === 'eat') { s.eaten = 0; for (var b = 0; b < 6; b++) if (s.eatMask & (1 << b)) s.eaten++; if (s.eaten >= 6) ph = s.phase = 'sunset'; }
      if (ph === 'sunset' || ph === 'sleep') { s.eatMask = 63; s.eaten = 6; }
      if (ph === 'sunset' && s.lateDone) ph = s.phase = 'sleep';
      if (ph === 'sleep') { s.lateDone = true; s.picked[LATE] = true; s.lr = 1; s.time = 0.72; }
      if (ph !== 'sleep') s.picked[LATE] = false;
      for (var q = 0; q < 6; q++) {
        zf[q].visible = q < n;
        zf[q].userData.setCalyxOnly(!!(s.eatMask & (1 << q)));
        zf[q].userData.setWet(s.zaruWet);
      }
    }
    for (var p = 0; p < 7; p++) plant.setPicked(p, !!s.picked[p]);
    applyVisuals(0);
    enter(ph);
  }

  /* ───────── 見た目への反映 ───────── */
  var lastTime = -1, lastMoist = -1, lastHole = -1, lastZW = -1;
  function applyVisuals(dt) {
    if (s.time !== lastTime) { lastTime = s.time; world.setTime(s.time); }
    if (Math.abs(s.moist - lastMoist) > 0.002) { lastMoist = s.moist; world.planter.setMoisture(s.moist); }
    if (Math.abs(s.hole - lastHole) > 0.002) { lastHole = s.hole; world.planter.setHole(s.hole); }
    plant.setGrowth(s.g); plant.setFlowers(s.fl); plant.setFruit(s.fr); plant.setRipe(s.rp); plant.setLateRipe(s.lr);
    plant.setThirst(s.thirst); plant.setWet(s.leafWet);
    if (s.zaruOn && Math.abs(s.zaruWet - lastZW) > 0.005) {
      lastZW = s.zaruWet; zaru.setWet(s.zaruWet * 0.8);
      for (var k = 0; k < 6; k++) zf[k].userData.setWet(s.zaruWet);
    }
  }
  var pwT = 0, ambT = 0;
  function sounds(dt) {
    var sp = Math.abs(world.pinwheel.speed);
    pwT -= dt;
    if (sp > 4 && pwT <= 0 && s.clock - lastPw > 0.3) { pwT = 0.5; snd('pinwheel', U.clamp01(sp / 30)); }
    ambT -= dt;
    if (ambT <= 0) { ambT = 1; try { if (G.Audio) G.Audio.ambience(s.time - Math.floor(s.time), world.night); } catch (e) { } }
    try { if (G.Audio) G.Audio.update(dt); } catch (e2) { }
  }

  /* ───────── 性能 ───────── */
  var perf = { pr: 1, maxPR: 1, acc: 0, n: 0, good: 0, cut: false, skip: 0 };
  function perfTick(rawMs) {
    if (perf.skip > 0) { perf.skip--; return; }
    perf.acc += rawMs; perf.n++;
    if (perf.acc < 1000) return;
    var avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
    if (avg > 38) {
      perf.good = 0;
      if (perf.pr > 0.75 + 1e-3) { perf.pr = Math.max(0.75, perf.pr * 0.85); renderer.setPixelRatio(perf.pr); renderer.setSize(Wd, Ht, false); perf.skip = 3; }
      else if (!perf.cut) {
        perf.cut = true;
        try {
          renderer.shadowMap.enabled = false;
          scene.traverse(function (o) { if (o.isLight && o.castShadow) o.castShadow = false; if (o.isMesh && o.material) { var m = o.material; if (m.length) m.forEach(function (x) { x.needsUpdate = true; }); else m.needsUpdate = true; } });
          if (can.setShadows) can.setShadows(false);
        } catch (e) { }
      }
    } else if (avg < 22) {
      perf.good++;
      if (perf.good >= 3 && perf.pr < perf.maxPR - 1e-3) { perf.good = 0; perf.pr = Math.min(perf.maxPR, perf.pr / 0.85); renderer.setPixelRatio(perf.pr); renderer.setSize(Wd, Ht, false); perf.skip = 3; }
    } else perf.good = 0;
  }

  /* ───────── ループ ───────── */
  var last = 0, running = false, frames = 0, veilOff = false, errCount = 0, rafId = 0;
  function update(dt) {
    s.clock += dt; s.pt += dt;
    runTimeline();
    if (hold && hold.kind === 'fruit') updateHeldFruit();
    updateTap(dt);
    updateCan(dt);
    updateSeed(dt);
    updatePour(dt);
    updateColliders(dt);
    phaseLogic(dt);
    updateCamera(dt);
    updateFlyers(dt);
    applyVisuals(dt);
    world.update(dt, s.clock);
    plant.update(dt, s.clock);
    water.update(dt, s.clock, world.sunDir, 1 - 0.7 * world.night);
    updateHints(dt);
    sounds(dt);
    saveT += dt;
    if (saveT > 2) { saveT = 0; save(); }
  }
  function frame(now) {
    rafId = 0;
    if (!running || dead) return;
    rafId = requestAnimationFrame(frame);
    var raw = last ? now - last : 16; last = now;
    var dt = Math.min(0.05, Math.max(0, raw / 1000));
    try {
      if (needResize) applyResize();
      update(dt);
      renderer.render(scene, camera);
      frames++;
      if (!veilOff && frames >= 4) { veilOff = true; var v = document.getElementById('veil'); if (v) v.className = 'off'; }
      perfTick(raw);
    } catch (e) {
      errCount++;
      if (errCount < 4 && window.console) console.error(e);
      if (hold) { hold = null; ptrId = null; }
    }
  }
  function start() { if (running || dead) return; running = true; last = 0; perf.skip = 2; if (!rafId) rafId = requestAnimationFrame(frame); }
  function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  function fallback() {
    dead = true; stop();
    try {
      var fb = document.getElementById('fallback');
      var img = window.__FALLBACK_IMG__;
      if (fb) {
        if (img && typeof img === 'string' && img.indexOf('data:') === 0) fb.style.backgroundImage = 'url("' + img + '")';
        else fb.style.background = 'linear-gradient(180deg, #a7c7e6 0%, #cfe0ee 55%, #efe9de 100%)';
        fb.className = 'on';
      }
      var v = document.getElementById('veil'); if (v) v.className = 'off';
      if (canvas) canvas.style.visibility = 'hidden';
      try { if (G.Audio) { G.Audio.tap(0, 0, 'can'); G.Audio.shower(0, {}); } } catch (e1) { }
    } catch (e) { }
  }

  /* ───────── 起動 ───────── */
  function boot() {
    try {
      canvas = document.getElementById('c');
      var q = location.search || '';
      var nav = window.navigator || {};
      low = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || /[?&]low\b/.test(q);
      low = !!low;
      quality = { low: low, shadows: !low, shadowSize: low ? 512 : 1024, particles: low ? 220 : 480 };
      perf.maxPR = Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2); perf.pr = perf.maxPR;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !low, powerPreference: 'high-performance', alpha: false });
      } catch (e0) { renderer = null; }
      if (!renderer || !renderer.getContext()) { fallback(); return; }
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = !!quality.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setPixelRatio(perf.pr);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(K.FOV, 1, 0.04, 400);
      world = G.World.create(scene, renderer, quality);
      plant = G.Plant.create(scene, quality);
      can = G.Can.create(scene, quality);
      zaru = G.Zaru.create(scene);
      water = G.Water.create(scene, quality);
      water.onHit = onHit;
      water.onDrip = function (x, y, z) { snd('drip', rnd()); };
      plant.onPotBounce = function (st) { snd('potBounce', st); };
      OUTLET.copy(world.tap.outlet); HANDLE.copy(world.tap.handlePos);
      // じょうろの定位置：口が吐水口の真下に来るよう
      can.group.position.set(0, 0, 0); can.group.rotation.y = K.CAN_HOME_YAW; can.setTilt(0);
      can.openingPos(_a);
      HOME.set(OUTLET.x - _a.x, L.CAN_HOME[1], OUTLET.z - _a.z);
      // ざる
      zaru.group.position.copy(ZARU_POS); zaru.group.visible = false; zaru.group.updateMatrixWorld(true);
      for (var k = 0; k < 6; k++) {
        var f = G.Plant.makeFruit(1); f.position.copy(zaru.slots[k]); f.rotation.y = k * 1.7; f.visible = false;
        zaru.group.add(f); zf.push(f); zfBase.push(zaru.slots[k].clone());
      }
      for (var p = 0; p < 4; p++) { var o = G.Plant.makeFruit(1); o.visible = false; scene.add(o); pool.push({ obj: o, busy: false }); }
      for (var fl = 0; fl < 6; fl++) flyers.push({ on: false, p: null, from: new V3(), kind: '', slot: 0, t: 0, dur: 1, done: null });
      plant.fruits.forEach(function (fr, i) { if (fr.late) LATE = i; else RED.push(i); });
      makeHints();

      s = Game.s = load();
      restore();
      if (s.phase === 'plant') { plant.root.position.copy(seedPos); }

      // 入力
      canvas.addEventListener('pointerdown', onDown, { passive: false });
      canvas.addEventListener('pointermove', onMove, { passive: false });
      canvas.addEventListener('pointerup', onUp, { passive: false });
      canvas.addEventListener('pointercancel', onUp, { passive: false });
      canvas.addEventListener('lostpointercapture', function (e) { if (e.pointerId === ptrId) release(true); });
      var stopper = function (e) { if (e.cancelable) e.preventDefault(); };
      ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart'].forEach(function (n) {
        document.addEventListener(n, stopper, { passive: false });
      });
      window.addEventListener('blur', function () { release(true); });
      var onResize = function () { needResize = true; };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', function () { needResize = true; release(true); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          release(true); stop(); save(true);
          try { if (G.Audio) { G.Audio.tap(0, 0, 'can'); G.Audio.shower(0, {}); G.Audio.setEnabled(false); } } catch (e) { }
        } else {
          try { if (G.Audio) G.Audio.setEnabled(true); } catch (e2) { }
          needResize = true; start();
        }
      });
      window.addEventListener('pagehide', function () { save(true); });
      // WebGL の文脈が消えたら待ち、戻らなければ代わりの絵
      var lostTimer = 0;
      canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault(); stop();
        lostTimer = setTimeout(function () { fallback(); }, 4000);
      }, false);
      canvas.addEventListener('webglcontextrestored', function () {
        if (lostTimer) { clearTimeout(lostTimer); lostTimer = 0; }
        if (!dead) { needResize = true; start(); }
      }, false);

      applyResize();
      updateCamera(0);
      if (!document.hidden) start();
    } catch (err) {
      if (window.console) console.error(err);
      fallback();
    }
  }
  Game.K = K;
  /* いま触ってほしい1つ（手がかりの対象）を画面座標で返す。なければ null */
  Game.target = function () {
    if (!s || dead) return null;
    var T = nextTarget(); if (!T) return null;
    var a = screenOf(T.pos, null), b = screenOf(T.to, null);
    return { kind: T.kind, idx: T.idx, drag: T.drag, x: a.x, y: a.y, tx: b.x, ty: b.y };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
