/* 20-home.js — 場面 home1 / home2：台所と冷蔵庫。
   同じ THREE.Scene と中の物を2つの場面名で共有する（作るのは1回だけ）。
   home1: からっぽの冷蔵庫 → たまご1こ → ぐぅ〜 → エコバッグで買い物へ
   home2: バッグから冷蔵庫へしまう → 扉を閉める → レシートをマグネットで貼る → 夕方の光 */
(function () {
  'use strict';
  var T = window.THREE, G = window.G, U = window.U, Items = window.Items;
  if (!T || !G || !G.addScene || !U) {
    if (window.console) console.warn('20-home: THREE / G / U が無いので場面を登録しない');
    return;
  }

  /* ───────── 小道具 ───────── */
  var PI = Math.PI, D2R = PI / 180;
  function V(x, y, z) { return new T.Vector3(x || 0, y || 0, z || 0); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }
  function low() { return !!G.low; }
  function vw() { return (G.view && G.view.w) || window.innerWidth || 390; }
  function vh() { return (G.view && G.view.h) || window.innerHeight || 844; }

  function play(name, o) { try { var s = window.Sound; if (s && s.play) s.play(name, o || {}); } catch (e) { /* 音は無くてよい */ } }
  function sloop(name, on, o) { try { var s = window.Sound; if (s && s.loop) s.loop(name, on, o || {}); } catch (e) { /* */ } }
  function amb(name) { try { var s = window.Sound; if (s && s.ambience) s.ambience(name); } catch (e) { /* */ } }
  function puff(pos, o) { try { if (G.puff) G.puff(pos, o); } catch (e) { /* */ } }
  function glow(obj, o) {
    try { if (G.glow) return G.glow(obj, o) || null; } catch (e) { /* */ }
    return null;
  }
  function unglow(h) { try { if (h && h.remove) h.remove(); } catch (e) { /* */ } }
  function st() {
    var s = G.state || (G.state = {});
    if (!Array.isArray(s.basket)) s.basket = [];
    if (!Array.isArray(s.scanned)) s.scanned = [];
    if (!Array.isArray(s.bag)) s.bag = [];
    if (!Array.isArray(s.fridge)) s.fridge = [];
    if (!Array.isArray(s.receipt)) s.receipt = [];
    if (typeof s.trip !== 'number') s.trip = 0;
    return s;
  }
  function save() { try { if (G.save) G.save(); } catch (e) { /* */ } }
  function isKind(k) { return typeof k === 'string' && Items && Items.order && Items.order.indexOf(k) >= 0; }
  function info(k) { return (Items && Items.info && Items.info[k]) || {}; }

  /* ───────── 時間の仕事（update の dt で進む。場面を出る・入り直すと全部消える） ───────── */
  var EASE = {
    linear: function (k) { return k; },
    out: function (k) { return 1 - (1 - k) * (1 - k) * (1 - k); },
    inn: function (k) { return k * k * k; },
    inOut: function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    back: function (k) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
  };
  var jobs = [];
  function tween(dur, fn, ease, done) {
    var j = { t: 0, dur: Math.max(dur, 1e-4), fn: fn, ease: EASE[ease || 'out'] || EASE.out, done: done, dead: false };
    j.stop = function () { j.dead = true; };
    jobs.push(j);
    return j;
  }
  function later(sec, fn) { return tween(sec, null, 'linear', fn); }
  function runJobs(dt) {
    var list = jobs.slice();
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      if (j.dead) continue;
      j.t += dt;
      var k = Math.min(1, j.t / j.dur);
      try { if (j.fn) j.fn(j.ease(k), k); } catch (e) { j.dead = true; if (window.console) console.error(e); continue; }
      if (k >= 1 && !j.dead) {
        j.dead = true;
        try { if (j.done) j.done(); } catch (e2) { if (window.console) console.error(e2); }
      }
    }
    jobs = jobs.filter(function (q) { return !q.dead; });
  }

  /* ───────── 形を合わせる ───────── */
  function rbox(w, h, d, seg, r) {
    if (T.RoundedBoxGeometry) return new T.RoundedBoxGeometry(w, h, d, seg || 3, Math.min(r || 0.004, Math.min(w, h, d) * 0.49));
    return new T.BoxGeometry(w, h, d);
  }
  var _q = new T.Quaternion(), _e = new T.Euler(), _one = V(1, 1, 1), _m4 = new T.Matrix4();
  function part(geo, x, y, z, rx, ry, rz) {
    if (geo.index) geo = geo.toNonIndexed();
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m4.compose(V(x, y, z), _q, _one);
    geo.applyMatrix4(_m4);
    return geo;
  }
  function merged(list, mat) {
    var BGU = T.BufferGeometryUtils, g = null;
    try { if (BGU && BGU.mergeGeometries) g = BGU.mergeGeometries(list, false); } catch (e) { g = null; }
    if (g) return new T.Mesh(g, mat);
    var grp = new T.Group();
    list.forEach(function (q) { grp.add(new T.Mesh(q, mat)); });
    return grp;
  }

  /* ───────── 素材（キャンバス） ───────── */
  function grain(ctx, x0, y0, w, h, o) {
    var r = U.rng(o.seed || 1), i;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
    ctx.fillStyle = o.base; ctx.fillRect(x0, y0, w, h);
    for (i = 0; i < 7; i++) {
      ctx.globalAlpha = 0.04 + 0.07 * r();
      ctx.fillStyle = r() < 0.5 ? o.dark : o.light;
      ctx.fillRect(x0, y0 + r() * h, w, h * (0.08 + 0.3 * r()));
    }
    var n = o.lines || Math.max(8, Math.round(h / 2.0));
    for (i = 0; i < n; i++) {
      var yy = y0 + r() * h, amp = 0.6 + r() * (o.wave || 3), fq = 0.002 + r() * 0.012, ph = r() * 6.28;
      ctx.globalAlpha = 0.04 + 0.13 * r();
      ctx.strokeStyle = r() < 0.8 ? o.dark : o.light;
      ctx.lineWidth = 0.4 + r() * 1.5;
      ctx.beginPath();
      for (var xx = 0; xx <= w + 16; xx += 16) {
        var yv = yy + Math.sin(xx * fq + ph) * amp + Math.sin(xx * fq * 3.1 + ph * 2) * amp * 0.3;
        if (xx === 0) ctx.moveTo(x0 + xx, yv); else ctx.lineTo(x0 + xx, yv);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  var TEX = {};
  function makeTextures() {
    // 細かい粗さむら（共用）
    TEX.rough = U.tex(256, 256, function (ctx, w, h) {
      ctx.fillStyle = 'rgb(205,205,205)'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 2600, size: 1.1, alpha: 0.18, seed: 5 });
      U.speckle(ctx, w, h, { n: 120, size: 6, alpha: 0.05, seed: 9 });
    }, { data: true, repeat: [3, 3] });
    // ヘアライン（取っ手の金属）
    TEX.brush = U.tex(64, 256, function (ctx, w, h) {
      ctx.fillStyle = 'rgb(150,150,150)'; ctx.fillRect(0, 0, w, h);
      var r = U.rng(4);
      for (var i = 0; i < 260; i++) {
        var c = 110 + Math.floor(r() * 90);
        ctx.fillStyle = 'rgb(' + c + ',' + c + ',' + c + ')';
        ctx.fillRect(r() * w, 0, 0.6 + r(), h);
      }
    }, { data: true });
    // 床（明るい木目のフローリング。1枚 = 1.2m 四方、板幅 15cm）
    TEX.floor = U.tex(1024, 1024, function (ctx, w, h) {
      var rows = 8, rh = h / rows, r = U.rng(11);
      var pal = ['#cba679', '#c39d6e', '#d1ae82', '#c09868', '#d4b28a', '#c8a274'];
      for (var row = 0; row < rows; row++) {
        var joints = [], x = r() * w * 0.6;
        while (x < w) { joints.push(x); x += 330 + r() * 520; }
        if (!joints.length) joints.push(0);
        for (var i = 0; i < joints.length; i++) {
          var a = joints[i], b = i + 1 < joints.length ? joints[i + 1] : joints[0] + w;
          var o = { base: pal[Math.floor(r() * pal.length)], dark: '#6f4b2c', light: '#ecd5ad', seed: row * 31 + i * 7 + 1, wave: 2.2 };
          grain(ctx, a, row * rh, b - a, rh, o);
          if (b > w) grain(ctx, a - w, row * rh, b - a, rh, o);
          ctx.fillStyle = 'rgba(60,40,24,0.55)';
          ctx.fillRect(a - 1, row * rh, 2, rh);
        }
        ctx.fillStyle = 'rgba(55,36,20,0.5)'; ctx.fillRect(0, row * rh, w, 2);
        ctx.fillStyle = 'rgba(255,242,220,0.18)'; ctx.fillRect(0, row * rh + 2, w, 1);
      }
    }, { repeat: [10 / 1.2, 7 / 1.2] });
    TEX.floorRough = U.tex(256, 256, function (ctx, w, h) {
      ctx.fillStyle = 'rgb(120,120,120)'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 1500, size: 1.4, alpha: 0.2, seed: 21 });
      for (var row = 0; row < 8; row++) { ctx.fillStyle = 'rgb(220,220,220)'; ctx.fillRect(0, row * 32, w, 1); }
    }, { data: true, repeat: [10 / 1.2, 7 / 1.2] });
    // 壁紙（白っぽい織物調。1枚 = 1m）
    TEX.wall = U.tex(512, 512, function (ctx, w, h) {
      ctx.fillStyle = '#e3dccf'; ctx.fillRect(0, 0, w, h);
      var r = U.rng(17);
      for (var i = 0; i < 900; i++) {
        ctx.globalAlpha = 0.035 + 0.04 * r();
        ctx.fillStyle = r() < 0.5 ? '#ffffff' : '#c9c1b4';
        var x = r() * w, y = r() * h;
        if (r() < 0.5) ctx.fillRect(x, y, 6 + r() * 18, 1); else ctx.fillRect(x, y, 1, 6 + r() * 18);
      }
      ctx.globalAlpha = 1;
      U.speckle(ctx, w, h, { n: 1600, size: 0.8, alpha: 0.06, seed: 18, dark: '#8a8070' });
    }, { repeat: [6, 2.6] });
    // 下台の扉（木目。幅 2.63m × 高さ 0.77m をそのまま1枚に）
    TEX.cab = U.tex(2048, 600, function (ctx, w, h) {
      grain(ctx, 0, 0, w, h, { base: '#d9c09a', dark: '#8f6a43', light: '#f1dfc0', seed: 41, lines: 380, wave: 4 });
      var mods = 6, mw = w / mods, drawerH = h * 0.2;
      ctx.fillStyle = 'rgba(70,50,32,0.85)';
      for (var i = 0; i <= mods; i++) ctx.fillRect(Math.round(i * mw) - 3, 0, 6, h);
      ctx.fillRect(0, drawerH - 3, w, 6);
      ctx.fillRect(0, 0, w, 3); ctx.fillRect(0, h - 3, w, 3);
      ctx.fillStyle = 'rgba(255,245,225,0.25)';
      for (i = 0; i < mods; i++) ctx.fillRect(Math.round(i * mw) + 3, drawerH + 3, 1, h - drawerH - 6);
    });
    // 窓のすりガラス（上が明るい）
    TEX.glass = U.tex(256, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#f4f6f4'); g.addColorStop(1, '#e2e6e4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      var g2 = ctx.createRadialGradient(w * 0.3, h * 0.25, 4, w * 0.3, h * 0.25, w * 0.7);
      g2.addColorStop(0, 'rgba(255,255,250,0.7)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 900, size: 1.2, alpha: 0.05, seed: 3, dark: '#9aa09a' });
    });
    // 柔らかい光の円（置ける場所）
    TEX.disc = U.tex(128, 128, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    // 扉のすきまの光のにじみ（右が明るい）
    TEX.halo = U.tex(64, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(w, 0, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-in';
      var g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.12, 'rgba(0,0,0,1)'); g2.addColorStop(0.88, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    });
    TEX.egg = U.tex(256, 128, function (ctx, w, h) {
      ctx.fillStyle = '#f4eee3'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 900, size: 0.9, alpha: 0.08, seed: 8, dark: '#a89070', lightRatio: 0.3 });
      U.speckle(ctx, w, h, { n: 40, size: 5, alpha: 0.04, seed: 2, dark: '#c8b090', lightRatio: 0.2 });
    });
  }

  /* ───────── 冷蔵庫の寸法 ───────── */
  var FR = { w: 0.70, h: 1.75, d: 0.68, front: 0.34, cabFront: 0.28, inW: 0.62, inBack: -0.22, inBot: 0.62, inTop: 1.70 };
  var DOOR_REST = 1.5, DOOR_OPEN = 110;
  var ROWS = { a: 1.424, b: 1.144, c: 0.864, d: 0.642 };
  var COLS = [-0.2, 0, 0.2];
  var SLOT_Z = 0.0;
  var SLOTS = [], SLOT = {};
  ['a', 'b', 'c', 'd'].forEach(function (row) {
    COLS.forEach(function (x, i) {
      var s = { id: row + i, row: row, col: i, x: x, y: ROWS[row], z: SLOT_Z, pos: V(x, ROWS[row], SLOT_Z) };
      SLOTS.push(s); SLOT[s.id] = s;
    });
  });
  var PRODUCE = ['tomato', 'apple', 'carrot', 'cabbage', 'watermelon', 'strawberry'];
  function allowed(kind, slot) { return !(info(kind).tall && slot.row === 'd'); }

  /* ───────── 世界（1回だけ作る） ───────── */
  var W = null;

  function buildWorld() {
    if (W) return W;
    makeTextures();
    W = {};
    var scene = (W.scene = new T.Scene());
    scene.background = new T.Color(0xe6e0d6);
    scene.environment = G.env || null;
    scene.environmentIntensity = 0.9;
    W.camera = new T.PerspectiveCamera(35, vw() / vh(), 0.05, 40);
    W.camera.position.set(0, 1.0, 3.2);

    // 光
    var sun = (W.sun = new T.DirectionalLight(0xfff3e2, 2.2));
    sun.position.set(-2.4, 3.6, 2.8);
    sun.target.position.set(0, 0.8, 0);
    sun.castShadow = true;
    var sm = low() ? 512 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    var sc = sun.shadow.camera;
    sc.left = -1.9; sc.right = 1.9; sc.top = 1.9; sc.bottom = -1.9; sc.near = 0.5; sc.far = 9;
    scene.add(sun); scene.add(sun.target);
    W.hemi = new T.HemisphereLight(0xf4f6ff, 0xb39a7e, 0.4);
    scene.add(W.hemi);
    W.fLight = new T.PointLight(0xfff6ea, 0, 2.0, 1);
    W.fLight.position.set(0, 1.62, 0.1);
    scene.add(W.fLight);

    buildRoom(scene);
    buildFridge(scene);
    buildStoolAndBag(scene);
    return W;
  }

  function buildRoom(scene) {
    // 床
    var floor = new T.Mesh(new T.PlaneGeometry(10, 7),
      new T.MeshStandardMaterial({ map: TEX.floor, roughnessMap: TEX.floorRough, roughness: 0.75, metalness: 0 }));
    floor.rotation.x = -PI / 2;
    floor.position.set(0, 0, -0.36 + 3.5);
    floor.receiveShadow = true;
    scene.add(floor);
    // 壁
    var wall = new T.Mesh(new T.PlaneGeometry(6.4, 2.8),
      new T.MeshStandardMaterial({ map: TEX.wall, color: 0xd6cdbd, roughness: 0.92, metalness: 0 }));
    wall.position.set(0, 1.4, -0.36);
    wall.receiveShadow = true;
    scene.add(wall);
    // 横の壁（とても広い画面でも端が見えないように）
    var sideMat = new T.MeshStandardMaterial({ map: TEX.wall, color: 0xd6cdbd, roughness: 0.92 });
    [-1, 1].forEach(function (s) {
      var sw = new T.Mesh(new T.PlaneGeometry(7, 2.8), sideMat);
      sw.rotation.y = -s * PI / 2;
      sw.position.set(s * 3.2, 1.4, -0.36 + 3.5);
      sw.receiveShadow = true;
      scene.add(sw);
    });

    // カウンター（左右）
    var cabMat = new T.MeshStandardMaterial({ map: TEX.cab, roughness: 0.55, roughnessMap: TEX.rough, metalness: 0 });
    var topMat = new T.MeshPhysicalMaterial({ color: 0xf6f4ef, roughness: 0.28, roughnessMap: TEX.rough, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.2 });
    var kickMat = new T.MeshStandardMaterial({ color: 0x3e3a36, roughness: 0.8 });
    var pullMat = new T.MeshStandardMaterial({ color: 0xb8b8b6, metalness: 1, roughness: 0.32, roughnessMap: TEX.brush });
    var CW = 2.63;
    [-1, 1].forEach(function (s) {
      var cx = s * (0.37 + CW / 2);
      var body = new T.Mesh(new T.BoxGeometry(CW, 0.77, 0.57), cabMat);
      body.position.set(cx, 0.08 + 0.385, -0.36 + 0.285);
      U.shadow(body, true, true);
      scene.add(body);
      var kick = new T.Mesh(new T.BoxGeometry(CW, 0.08, 0.5), kickMat);
      kick.position.set(cx, 0.04, -0.36 + 0.25);
      kick.receiveShadow = true;
      scene.add(kick);
      var top = new T.Mesh(rbox(CW + 0.01, 0.034, 0.62, 2, 0.006), topMat);
      top.position.set(cx, 0.85 + 0.017, -0.36 + 0.31);
      U.shadow(top, true, true);
      scene.add(top);
      // 引き出しの取っ手（6つを1つの形に）
      var pulls = [];
      for (var i = 0; i < 6; i++) {
        var mx = cx - CW / 2 + (i + 0.5) * (CW / 6);
        pulls.push(part(rbox(0.16, 0.012, 0.014, 2, 0.005), mx, 0.85 - 0.077, 0.21 + 0.022));
        pulls.push(part(new T.CylinderGeometry(0.004, 0.004, 0.02, 10), mx - 0.065, 0.85 - 0.077, 0.21 + 0.01, PI / 2));
        pulls.push(part(new T.CylinderGeometry(0.004, 0.004, 0.02, 10), mx + 0.065, 0.85 - 0.077, 0.21 + 0.01, PI / 2));
      }
      var pm = merged(pulls, pullMat);
      U.shadow(pm, true, false);
      scene.add(pm);
    });

    // 窓（左のカウンターの上。発光するすりガラス＋白い枠）
    W.winMat = new T.MeshBasicMaterial({ map: TEX.glass, color: 0xffffff });
    var glass = new T.Mesh(new T.PlaneGeometry(0.86, 0.78), W.winMat);
    glass.position.set(-1.25, 1.56, -0.355);
    scene.add(glass);
    var frameMat = new T.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.35, metalness: 0.3 });
    var fr = [];
    fr.push(part(rbox(0.96, 0.05, 0.05, 2, 0.006), -1.25, 1.56 + 0.415, -0.34));
    fr.push(part(rbox(0.96, 0.05, 0.05, 2, 0.006), -1.25, 1.56 - 0.415, -0.34));
    fr.push(part(rbox(0.05, 0.88, 0.05, 2, 0.006), -1.25 - 0.455, 1.56, -0.34));
    fr.push(part(rbox(0.05, 0.88, 0.05, 2, 0.006), -1.25 + 0.455, 1.56, -0.34));
    fr.push(part(rbox(0.03, 0.78, 0.035, 2, 0.006), -1.25, 1.56, -0.345));
    fr.push(part(rbox(1.02, 0.025, 0.09, 2, 0.006), -1.25, 1.56 - 0.45, -0.32));
    var frame = merged(fr, frameMat);
    U.shadow(frame, true, true);
    scene.add(frame);
  }

  function buildFridge(scene) {
    var steel = (W.steel = new T.MeshPhysicalMaterial({
      color: 0xd0cabf, roughness: 0.24, roughnessMap: TEX.rough, metalness: 0.1,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.0
    }));
    var liner = new T.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.4, roughnessMap: TEX.rough, metalness: 0 });
    var linerBack = new T.MeshStandardMaterial({ color: 0xd6d8d4, roughness: 0.45, roughnessMap: TEX.rough, metalness: 0, side: T.BackSide });
    var metal = new T.MeshStandardMaterial({ color: 0xd8dadc, metalness: 1, roughness: 0.25, roughnessMap: TEX.brush });
    var gasket = new T.MeshStandardMaterial({ color: 0x9c9fa2, roughness: 0.75 });
    var dark = new T.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.7 });
    var F = (W.fridge = new T.Group());
    scene.add(F);

    // 箱（外板）
    var shell = [];
    shell.push(part(rbox(0.04, 1.75, 0.62, 3, 0.01), -0.33, 0.875, -0.03));
    shell.push(part(rbox(0.04, 1.75, 0.62, 3, 0.01), 0.33, 0.875, -0.03));
    shell.push(part(rbox(0.70, 0.05, 0.62, 3, 0.01), 0, 1.725, -0.03));
    shell.push(part(new T.BoxGeometry(0.66, 1.70, 0.04), 0, 0.875, -0.32));
    shell.push(part(new T.BoxGeometry(0.62, 0.57, 0.56), 0, 0.05 + 0.285, -0.02)); // 冷凍室の箱
    var shellMesh = merged(shell, steel);
    U.shadow(shellMesh, true, true);
    F.add(shellMesh);
    var kick = new T.Mesh(new T.BoxGeometry(0.66, 0.05, 0.05), dark);
    kick.position.set(0, 0.025, 0.27);
    F.add(kick);

    // 庫内（白い樹脂。裏面だけ描く箱 = 前が開いた内張り）
    var inner = new T.Mesh(new T.BoxGeometry(0.62, FR.inTop - FR.inBot, FR.cabFront - FR.inBack), linerBack);
    inner.position.set(0, (FR.inTop + FR.inBot) / 2, (FR.cabFront + FR.inBack) / 2);
    inner.receiveShadow = true;
    F.add(inner);
    // 棚受けのレール
    var rails = [];
    [ROWS.a, ROWS.b, ROWS.c].forEach(function (y) {
      rails.push(part(rbox(0.012, 0.01, 0.38, 2, 0.003), -0.304, y - 0.012, -0.03));
      rails.push(part(rbox(0.012, 0.01, 0.38, 2, 0.003), 0.304, y - 0.012, -0.03));
    });
    rails.push(part(rbox(0.5, 0.012, 0.012, 2, 0.004), 0, FR.inTop - 0.03, FR.inBack + 0.01)); // 奥の吹き出し口
    rails.push(part(rbox(0.5, 0.012, 0.012, 2, 0.004), 0, FR.inTop - 0.06, FR.inBack + 0.01));
    var railMesh = merged(rails, liner);
    railMesh.receiveShadow = true;
    F.add(railMesh);

    // ガラス棚 3枚＋前の白い帯
    var glassMat = new T.MeshStandardMaterial({
      color: 0xd8f0e6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false, envMapIntensity: 1.6
    });
    var bands = [];
    [ROWS.a, ROWS.b, ROWS.c].forEach(function (y) {
      var g = new T.Mesh(new T.BoxGeometry(0.612, 0.007, 0.36), glassMat);
      g.position.set(0, y - 0.0035, -0.03);
      g.renderOrder = 2;
      F.add(g);
      bands.push(part(rbox(0.614, 0.022, 0.014, 2, 0.004), 0, y - 0.008, 0.152));
    });
    var bandMesh = merged(bands, liner);
    U.shadow(bandMesh, false, true);
    F.add(bandMesh);

    // 野菜ケース（浅い引き出し。上が開いている）
    var cris = new T.MeshStandardMaterial({ color: 0xf4f7f7, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false });
    var cp = [];
    cp.push(part(new T.BoxGeometry(0.6, 0.006, 0.36), 0, 0.636, -0.03));
    cp.push(part(new T.BoxGeometry(0.6, 0.075, 0.006), 0, 0.636 + 0.0375, 0.15));
    cp.push(part(new T.BoxGeometry(0.006, 0.06, 0.36), -0.297, 0.636 + 0.03, -0.03));
    cp.push(part(new T.BoxGeometry(0.006, 0.06, 0.36), 0.297, 0.636 + 0.03, -0.03));
    cp.push(part(new T.BoxGeometry(0.6, 0.06, 0.006), 0, 0.636 + 0.03, -0.21));
    var crisMesh = merged(cp, cris);
    crisMesh.renderOrder = 2;
    F.add(crisMesh);
    var lip = new T.Mesh(rbox(0.6, 0.016, 0.016, 2, 0.005), liner);
    lip.position.set(0, 0.636 + 0.075, 0.152);
    F.add(lip);

    // 庫内灯
    W.lampMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 0, roughness: 0.3 });
    var lamp = new T.Mesh(rbox(0.22, 0.01, 0.05, 2, 0.004), W.lampMat);
    lamp.position.set(0, FR.inTop - 0.006, 0.17);
    F.add(lamp);

    // 置き場所の光の円
    W.slotGlow = {};
    var discGeo = new T.CircleGeometry(0.085, 40);
    SLOTS.forEach(function (s) {
      var m = new T.Mesh(discGeo, new T.MeshBasicMaterial({
        map: TEX.disc, color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending
      }));
      m.rotation.x = -PI / 2;
      m.position.set(s.x, s.y + 0.003, s.z);
      m.renderOrder = 3;
      m.visible = false;
      m.userData.lv = 0;
      F.add(m);
      W.slotGlow[s.id] = m;
    });

    // たまご立てとたまご（a段の左奥）
    var cupMat = new T.MeshPhysicalMaterial({ color: 0xfbfbf8, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
    var prof = [V(0, 0), V(0.021, 0), V(0.022, 0.003), V(0.013, 0.008), V(0.0105, 0.013), V(0.012, 0.017), V(0.019, 0.026),
      V(0.0215, 0.033), V(0.0205, 0.034), V(0.0175, 0.028), V(0.009, 0.02), V(0.0, 0.019)];
    var pts = prof.map(function (p) { return new T.Vector2(p.x, p.y); });
    var cup = new T.Mesh(new T.LatheGeometry(pts, 48), cupMat);
    U.shadow(cup, true, true);
    var eggCup = (W.eggCup = new T.Group());
    eggCup.position.set(-0.245, ROWS.a, 0.17);
    eggCup.scale.setScalar(1.2);
    eggCup.add(cup);
    var ep = [], H = 0.057, R = 0.0215;
    for (var i = 0; i <= 40; i++) {
      var ph = i / 40 * PI;
      ep.push(new T.Vector2(Math.max(1e-5, R * Math.sin(ph) * (1 - 0.1 * Math.cos(ph))), (1 - Math.cos(ph)) / 2 * H));
    }
    var egg = new T.Mesh(new T.LatheGeometry(ep, 48), new T.MeshStandardMaterial({ map: TEX.egg, color: 0xe6b98f, roughness: 0.55 }));
    U.shadow(egg, true, true);
    var eggPivot = (W.egg = new T.Group());
    eggPivot.position.set(0, 0.021, 0);
    eggPivot.add(egg);
    eggCup.add(eggPivot);
    F.add(eggCup);
    W.eggCenter = V(-0.245, ROWS.a + 0.055, 0.17);

    // 冷凍室の引き出し
    var drawer = (W.drawer = new T.Group());
    var dfront = new T.Mesh(rbox(0.696, 0.515, 0.06, 4, 0.012), steel);
    dfront.position.set(0, 0.05 + 0.2575, FR.cabFront + 0.03);
    U.shadow(dfront, true, true);
    drawer.add(dfront);
    var dh = [];
    dh.push(part(rbox(0.42, 0.022, 0.024, 3, 0.008), 0, 0.515, FR.front + 0.03));
    dh.push(part(new T.CylinderGeometry(0.007, 0.007, 0.03, 16), -0.19, 0.515, FR.front + 0.012, PI / 2));
    dh.push(part(new T.CylinderGeometry(0.007, 0.007, 0.03, 16), 0.19, 0.515, FR.front + 0.012, PI / 2));
    var dHandle = merged(dh, metal);
    U.shadow(dHandle, true, false);
    drawer.add(dHandle);
    F.add(drawer);

    // 上の扉（右側が蝶番。蝶番の縦軸 = x:+0.35, z:+0.28）
    var door = (W.door = new T.Group());
    door.position.set(0.35, 0, FR.cabFront);
    F.add(door);
    var DW = 0.696, DH = 1.15, DY = 0.58 + DH / 2, DX = -DW / 2;
    W.doorDim = { w: DW, h: DH, y: DY, x: DX };
    var panel = new T.Mesh(rbox(DW, DH, 0.06, 4, 0.012), steel);
    panel.position.set(DX, DY, 0.03);
    U.shadow(panel, true, true);
    door.add(panel);
    var dl = new T.Mesh(rbox(0.62, 1.07, 0.02, 2, 0.008), liner);
    dl.position.set(DX, DY, -0.008);
    dl.receiveShadow = true;
    door.add(dl);
    var gk = [];
    gk.push(part(new T.BoxGeometry(0.66, 0.016, 0.012), DX, DY + DH / 2 - 0.022, -0.004));
    gk.push(part(new T.BoxGeometry(0.66, 0.016, 0.012), DX, DY - DH / 2 + 0.022, -0.004));
    gk.push(part(new T.BoxGeometry(0.016, DH - 0.044, 0.012), DX - 0.322, DY, -0.004));
    gk.push(part(new T.BoxGeometry(0.016, DH - 0.044, 0.012), DX + 0.322, DY, -0.004));
    door.add(merged(gk, gasket));
    // ドアポケット 3段
    var pocketMat = new T.MeshStandardMaterial({ color: 0xf2f6f6, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false });
    var pk = [], pkBand = [];
    [[0.70, 0.10], [1.02, 0.075], [1.34, 0.075]].forEach(function (q) {
      var y = q[0], h = q[1];
      pk.push(part(new T.BoxGeometry(0.54, 0.006, 0.09), DX, y, -0.065));
      pk.push(part(new T.BoxGeometry(0.56, h, 0.006), DX, y + h / 2, -0.112));
      pk.push(part(new T.BoxGeometry(0.006, h, 0.09), DX - 0.277, y + h / 2, -0.065));
      pk.push(part(new T.BoxGeometry(0.006, h, 0.09), DX + 0.277, y + h / 2, -0.065));
      pkBand.push(part(rbox(0.565, 0.014, 0.012, 2, 0.004), DX, y + h, -0.112));
    });
    var pocket = merged(pk, pocketMat);
    pocket.renderOrder = 2;
    door.add(pocket);
    door.add(merged(pkBand, liner));
    // 取っ手（扉の左端、縦長の金属）
    var hd = [];
    hd.push(part(rbox(0.022, 0.5, 0.024, 3, 0.008), DX - DW / 2 + 0.045, 1.17, 0.06 + 0.032));
    hd.push(part(new T.CylinderGeometry(0.0075, 0.0075, 0.03, 16), DX - DW / 2 + 0.045, 1.17 + 0.22, 0.06 + 0.014, PI / 2));
    hd.push(part(new T.CylinderGeometry(0.0075, 0.0075, 0.03, 16), DX - DW / 2 + 0.045, 1.17 - 0.22, 0.06 + 0.014, PI / 2));
    var handle = (W.handle = merged(hd, metal));
    U.shadow(handle, true, false);
    handle.userData.r = 0.27;
    door.add(handle);
    W.handleCenter = V(DX - DW / 2 + 0.045, 1.17, 0.06 + 0.032); // 扉の中の座標

    // すきまの光
    W.leakMat = new T.MeshBasicMaterial({ color: 0xfff3dc, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    var leak = new T.Mesh(new T.PlaneGeometry(0.005, 1.08), W.leakMat);
    leak.position.set(-0.3478, DY, FR.cabFront + 0.03);
    F.add(leak);
    W.haloMat = new T.MeshBasicMaterial({ map: TEX.halo, color: 0xffeccc, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
    var halo = new T.Mesh(new T.PlaneGeometry(0.07, 1.16), W.haloMat);
    halo.position.set(-0.35 - 0.035, DY, FR.cabFront + 0.045);
    halo.renderOrder = 4;
    F.add(halo);
    var hg = new T.PlaneGeometry(0.024, 1.12), uv = hg.attributes.uv;
    for (var ui = 0; ui < uv.count; ui++) uv.setX(ui, 1 - uv.getX(ui));
    var halo2 = new T.Mesh(hg, W.haloMat);
    halo2.position.set(-0.348 + 0.012, DY, FR.front + 0.003);
    halo2.renderOrder = 4;
    F.add(halo2);
  }

  function buildStoolAndBag(scene) {
    var oak = new T.MeshStandardMaterial({
      map: U.tex(512, 256, function (ctx, w, h) { grain(ctx, 0, 0, w, h, { base: '#d3b48a', dark: '#87633e', light: '#efdcbd', seed: 61, lines: 140 }); }),
      roughness: 0.6, roughnessMap: TEX.rough
    });
    var stool = new T.Group();
    var top = new T.Mesh(rbox(0.42, 0.025, 0.30, 3, 0.006), oak);
    top.position.y = 0.12 - 0.0125;
    stool.add(top);
    var legs = [];
    legs.push(part(rbox(0.024, 0.096, 0.27, 2, 0.005), -0.17, 0.048, 0));
    legs.push(part(rbox(0.024, 0.096, 0.27, 2, 0.005), 0.17, 0.048, 0));
    legs.push(part(rbox(0.32, 0.04, 0.016, 2, 0.004), 0, 0.07, 0.1));
    stool.add(merged(legs, oak));
    U.shadow(stool, true, true);
    stool.position.set(-0.1, 0, 0.64);
    scene.add(stool);

    var root = (W.bagRoot = new T.Group());
    root.position.set(-0.1, 0.12, 0.64);
    scene.add(root);
    var bag = null;
    try { if (window.Props && Props.bag) bag = Props.bag(); } catch (e) { bag = null; }
    if (!bag) bag = fallbackBag();
    var ud = bag.userData || {};
    W.bagInfo = { mouthY: ud.mouthY || 0.38, innerW: ud.innerW || 0.32, innerD: ud.innerD || 0.13 };
    U.shadow(bag, true, true);
    root.add(bag);
    W.bag = bag;
    W.bagContent = new T.Group();
    bag.add(W.bagContent);
    W.bagCenter = V(0, 0.2, 0);
  }

  function fallbackBag() {
    var g = new T.Group();
    var m = new T.MeshStandardMaterial({ color: 0xe9e0cc, roughness: 0.95, roughnessMap: TEX.rough, side: T.DoubleSide });
    var ps = [];
    ps.push(part(new T.BoxGeometry(0.36, 0.004, 0.16), 0, 0.002, 0));
    ps.push(part(new T.BoxGeometry(0.36, 0.38, 0.004), 0, 0.19, 0.08));
    ps.push(part(new T.BoxGeometry(0.36, 0.38, 0.004), 0, 0.19, -0.08));
    ps.push(part(new T.BoxGeometry(0.004, 0.38, 0.16), -0.18, 0.19, 0));
    ps.push(part(new T.BoxGeometry(0.004, 0.38, 0.16), 0.18, 0.19, 0));
    g.add(merged(ps, m));
    var hm = new T.Mesh(new T.TorusGeometry(0.08, 0.008, 10, 40, PI), m);
    hm.position.set(0, 0.38, 0.08);
    g.add(hm);
    g.userData = { mouthY: 0.38, innerW: 0.34, innerD: 0.14 };
    return g;
  }

  /* ───────── 画面への投影・当たり判定 ───────── */
  var _pv = V(), _ray = new T.Raycaster(), _ndc = new T.Vector2();
  function scr(v) {
    var c = W.camera;
    _pv.copy(v).project(c);
    return { x: (_pv.x + 1) / 2 * vw(), y: (1 - _pv.y) / 2 * vh(), z: _pv.z };
  }
  function pxRadius(center, r) {
    var c = W.camera, d = c.position.distanceTo(center);
    return r / (Math.max(0.05, d) * Math.tan(c.fov * D2R / 2)) * (vh() / 2);
  }
  function setRay(p) {
    if (p.ndc) _ndc.copy(p.ndc); else _ndc.set(p.x / vw() * 2 - 1, -(p.y / vh()) * 2 + 1);
    _ray.setFromCamera(_ndc, W.camera);
    return _ray.ray;
  }
  var _pl = new T.Plane(), _hit = V();
  function onZ(ndc, z, out) {
    _ray.setFromCamera(ndc, W.camera);
    _pl.set(V(0, 0, 1), -z);
    return _ray.ray.intersectPlane(_pl, out || V());
  }
  // 点の集まりを画面に写した四角
  function rectOf(points, obj) {
    var r = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }, w = V();
    for (var i = 0; i < points.length; i++) {
      w.copy(points[i]);
      if (obj) obj.localToWorld(w);
      var s = scr(w);
      r.x0 = Math.min(r.x0, s.x); r.y0 = Math.min(r.y0, s.y); r.x1 = Math.max(r.x1, s.x); r.y1 = Math.max(r.y1, s.y);
    }
    return r;
  }
  function inRect(p, r, m) { return p.x >= r.x0 - m && p.x <= r.x1 + m && p.y >= r.y0 - m && p.y <= r.y1 + m; }
  function boxPoints(b) {
    var a = [];
    for (var i = 0; i < 8; i++) a.push(V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    return a;
  }
  function nearest(p, cands, margin) {
    var best = null, bd = 1e9;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], s = scr(c.center);
      var d = Math.sqrt((s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y)) - pxRadius(c.center, c.r);
      if (d < margin && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /* ───────── 物の小さな動き（揺れ・跳ね・つぶれ）。model に掛ける ───────── */
  var fxList = [];
  function fxOf(m) {
    var f = m.userData.fx;
    if (!f) {
      f = m.userData.fx = {
        base: { y: m.position.y, rz: m.rotation.z, rx: m.rotation.x, sx: m.scale.x, sy: m.scale.y, sz: m.scale.z },
        hop: null, wob: null, sq: null, sag: 1, sagT: 1, tilt: 0, tiltT: 0
      };
    }
    if (fxList.indexOf(m) < 0) fxList.push(m);
    return f;
  }
  function hop(m, h, dur) { var f = fxOf(m); f.hop = { t: 0, dur: dur || 0.4, h: h || 0.04 }; }
  function wobble(m, amp, dur, fq) { var f = fxOf(m); f.wob = { t: 0, dur: dur || 0.9, a: amp || 0.25, f: fq || 13 }; }
  function squash(m, amp, dur) { var f = fxOf(m); f.sq = { t: 0, dur: dur || 0.45, a: amp || 0.12 }; }
  function sag(m, v, tilt) { var f = fxOf(m); f.sagT = v; f.tiltT = tilt || 0; }
  function fxReset(m) {
    var f = m.userData.fx;
    if (!f) return;
    m.position.y = f.base.y; m.rotation.z = f.base.rz; m.rotation.x = f.base.rx;
    m.scale.set(f.base.sx, f.base.sy, f.base.sz);
    m.userData.fx = null;
    var i = fxList.indexOf(m);
    if (i >= 0) fxList.splice(i, 1);
  }
  function runFx(dt) {
    for (var i = fxList.length - 1; i >= 0; i--) {
      var m = fxList[i], f = m.userData.fx;
      if (!f) { fxList.splice(i, 1); continue; }
      var y = f.base.y, rz = f.base.rz, sq = 0, k;
      if (f.hop) {
        f.hop.t += dt; k = Math.min(1, f.hop.t / f.hop.dur);
        y += f.hop.h * Math.sin(PI * k);
        if (k >= 1) { f.hop = null; }
      }
      if (f.wob) {
        f.wob.t += dt; k = Math.min(1, f.wob.t / f.wob.dur);
        rz += f.wob.a * Math.sin(f.wob.t * f.wob.f) * Math.pow(1 - k, 1.6);
        if (k >= 1) f.wob = null;
      }
      if (f.sq) {
        f.sq.t += dt; k = Math.min(1, f.sq.t / f.sq.dur);
        sq = f.sq.a * Math.sin(k * PI * 3) * (1 - k);
        if (k >= 1) f.sq = null;
      }
      f.sag = damp(f.sag, f.sagT, 5, dt);
      f.tilt = damp(f.tilt, f.tiltT, 5, dt);
      m.position.y = y;
      m.rotation.z = rz + f.tilt;
      m.scale.set(f.base.sx * (1 + sq * 0.5) * (1 + (1 - f.sag) * 0.35), f.base.sy * (1 - sq) * f.sag, f.base.sz * (1 + sq * 0.5));
    }
  }

  /* ───────── 位置の移動（弧を描いて）。wrapper / group の position に掛ける ───────── */
  var movers = [];
  function stopMove(o) { movers = movers.filter(function (m) { return m.o !== o; }); }
  function moveTo(o, to, dur, arc, done, ease) {
    stopMove(o);
    movers.push({ o: o, from: o.position.clone(), to: to.clone(), t: 0, dur: dur, arc: arc || 0, done: done, rz: o.rotation.z, ease: EASE[ease || 'inOut'] });
  }
  function runMovers(dt) {
    var list = movers.slice();
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (movers.indexOf(m) < 0) continue;
      m.t += dt;
      var k = Math.min(1, m.t / m.dur), e = m.ease(k);
      m.o.position.lerpVectors(m.from, m.to, e);
      m.o.position.y += m.arc * Math.sin(PI * k);
      m.o.rotation.z = m.rz * (1 - e);
      if (k >= 1) {
        var j = movers.indexOf(m);
        if (j >= 0) movers.splice(j, 1);
        if (m.done) { try { m.done(); } catch (e2) { if (window.console) console.error(e2); } }
      }
    }
  }

  /* ───────── 遊びの状態 ───────── */
  var R = null;          // enter ごとに作り直す
  var epoch = 0;

  function newRun(mode) {
    return {
      mode: mode,
      door: { ang: DOOR_REST, vel: 0, target: DOOR_REST, drag: null, wig: 0, open5: false, full: false, isOpen: false },
      fitems: [],        // {k, s, obj}
      bagObjs: [],       // state.bag と同じ順の wrapper
      active: null, activeGlow: null,
      carry: null, pending: null,
      busy: false, leaving: false, ending: false, endReady: false,
      introDone: false, introRun: false,
      placedNow: [],
      zoom: 0, shakeT: 0, shakeA: 0,
      evening: 0,
      light: 0,
      receipt: null, hand: null, handTip: null, handFollow: false,
      hintSig: '', doorWasOpen: false,
      drawerT: -1,
      lastDown: 0
    };
  }

  function makeItem(k) {
    var w = new T.Group();
    var m = Items.make(k);
    var inf = info(k);
    if ((inf.w || 0.1) > 0.175) m.rotation.y = 0.75;
    w.add(m);
    w.userData = { kind: k, model: m, h: inf.h || 0.08, r: Math.max(0.045, (inf.r || 0.06) * 0.85), cy: inf.cy != null ? inf.cy : (inf.h || 0.08) / 2 };
    return w;
  }
  function itemCenter(w, out) {
    out = out || V();
    w.getWorldPosition(out);
    out.y += w.userData.cy;
    return out;
  }
  function removeObj(o) { if (o && o.parent) o.parent.remove(o); }

  function occupied(id, except) {
    for (var i = 0; i < R.fitems.length; i++) {
      var e = R.fitems[i];
      if (e !== except && e.s === id) return e;
    }
    return null;
  }
  function freeFor(kind, except) {
    return SLOTS.filter(function (s) { return allowed(kind, s) && !occupied(s.id, except); });
  }
  function recommend(kind) {
    var order;
    if (info(kind).tall) order = ['a', 'b', 'c'];
    else if (PRODUCE.indexOf(kind) >= 0) order = ['d', 'c', 'b', 'a'];
    else order = ['b', 'c', 'a', 'd'];
    for (var i = 0; i < order.length; i++) {
      for (var c = 0; c < 3; c++) {
        var s = SLOT[order[i] + c];
        if (allowed(kind, s) && !occupied(s.id)) return s;
      }
    }
    var f = freeFor(kind);
    return f.length ? f[0] : null;
  }
  function syncFridge() {
    var s = st();
    s.fridge = R.fitems.map(function (e) { return { k: e.k, s: e.s }; });
    save();
  }
  function placeFridgeObj(e) {
    var s = SLOT[e.s];
    e.obj.position.copy(s.pos);
    e.obj.rotation.set(0, 0, 0);
    W.scene.add(e.obj);
  }

  /* 状態から冷蔵庫の中身を作り直す（壊れた中身は直す） */
  function buildFridgeItems() {
    var s = st(), used = {}, keep = [];
    s.fridge.forEach(function (e) {
      if (!e || !isKind(e.k)) return;
      var slot = SLOT[e.s];
      if (!slot || used[slot.id] || !allowed(e.k, slot)) slot = null;
      if (!slot) {
        for (var i = 0; i < SLOTS.length; i++) {
          if (!used[SLOTS[i].id] && allowed(e.k, SLOTS[i])) { slot = SLOTS[i]; break; }
        }
      }
      if (!slot) return;
      used[slot.id] = true;
      keep.push({ k: e.k, s: slot.id });
    });
    s.fridge = keep;
    R.fitems = keep.map(function (e) {
      var o = { k: e.k, s: e.s, obj: makeItem(e.k) };
      placeFridgeObj(o);
      return o;
    });
  }

  /* バッグの中の位置（バッグの model の中の座標） */
  function bagPos(i, active, w) {
    var B = W.bagInfo, h = w.userData.h;
    if (active) return V(0, Math.max(0.02, B.mouthY - h * 0.32), 0.0);
    var j = i === 0 ? 4 : i - 1;
    var x = ((j % 3) - 1) * B.innerW * 0.28;
    var z = (Math.floor(j / 3) % 2 ? -1 : 1) * B.innerD * 0.16;
    return V(x, Math.max(0.01, B.mouthY - h + 0.022), z);
  }
  function layoutBag(animate) {
    for (var i = 0; i < R.bagObjs.length; i++) {
      var w = R.bagObjs[i];
      if (R.carry && R.carry.obj === w) continue;
      var act = (w === R.active);
      var to = bagPos(i, act, w);
      if (animate) moveTo(w, to, 0.35, act ? 0.03 : 0, null, 'out');
      else { stopMove(w); w.position.copy(to); }
    }
  }
  function buildBagItems(list) {
    R.bagObjs = list.map(function (k) {
      var w = makeItem(k);
      W.bagContent.add(w);
      return w;
    });
    layoutBag(false);
  }

  /* home2: 部屋が足りなければ古い順に「食べた」ことにする */
  function ensureRoom() {
    var s = st();
    if (s.bag.length > 12) s.bag = s.bag.slice(0, 12);
    var free = function () { return 12 - s.fridge.length; };
    while (free() < s.bag.length && s.fridge.length) s.fridge.shift();
    var tallNeed = s.bag.filter(function (k) { return info(k).tall; }).length;
    var abcFree = function () {
      var used = {};
      s.fridge.forEach(function (e) { used[e.s] = 1; });
      return SLOTS.filter(function (q) { return q.row !== 'd' && !used[q.id]; }).length;
    };
    var guard = 20;
    while (abcFree() < tallNeed && guard-- > 0) {
      var idx = -1;
      for (var i = 0; i < s.fridge.length; i++) { var sl = SLOT[s.fridge[i].s]; if (sl && sl.row !== 'd') { idx = i; break; } }
      if (idx < 0) break;
      s.fridge.splice(idx, 1);
    }
  }
  /* 次の1こが置けない時（背の高い物で a,b,c が埋まった等）: 背の低い物を d へ移すか、古い物を食べる */
  function makeRoomFor(kind) {
    if (freeFor(kind).length) return;
    var i, dFree = SLOTS.filter(function (q) { return q.row === 'd' && !occupied(q.id); });
    if (info(kind).tall && dFree.length) {
      for (i = 0; i < R.fitems.length; i++) {
        var e = R.fitems[i];
        if (SLOT[e.s].row !== 'd' && !info(e.k).tall) {
          e.s = dFree[0].id;
          moveTo(e.obj, SLOT[e.s].pos, 0.45, 0.05);
          syncFridge();
          return;
        }
      }
    }
    for (i = 0; i < R.fitems.length; i++) {
      var q = R.fitems[i];
      if (allowed(kind, SLOT[q.s])) {
        R.fitems.splice(i, 1);
        var o = q.obj;
        tween(0.3, function (k) { o.scale.setScalar(Math.max(0.001, 1 - k)); }, 'inn', function () { removeObj(o); });
        syncFridge();
        return;
      }
    }
  }

  /* ───────── 光（昼 → 夕方） ───────── */
  var DAY = { sun: new T.Color(0xfff3e2), sunI: 2.2, sky: new T.Color(0xf4f6ff), gnd: new T.Color(0xb39a7e), hemiI: 0.4, env: 0.9, win: new T.Color(0xffffff), bg: new T.Color(0xe6e0d6) };
  var EVE = { sun: new T.Color(0xff9550), sunI: 1.9, sky: new T.Color(0xffc89a), gnd: new T.Color(0x987050), hemiI: 0.42, env: 0.5, win: new T.Color(0xffc48a), bg: new T.Color(0xd9c2a8) };
  function setEvening(k) {
    R.evening = k;
    W.sun.color.copy(DAY.sun).lerp(EVE.sun, k);
    W.sun.intensity = U.lerp(DAY.sunI, EVE.sunI, k);
    W.hemi.color.copy(DAY.sky).lerp(EVE.sky, k);
    W.hemi.groundColor.copy(DAY.gnd).lerp(EVE.gnd, k);
    W.hemi.intensity = U.lerp(DAY.hemiI, EVE.hemiI, k);
    W.scene.environmentIntensity = U.lerp(DAY.env, EVE.env, k);
    W.winMat.color.copy(DAY.win).lerp(EVE.win, k);
    W.scene.background.copy(DAY.bg).lerp(EVE.bg, k);
  }

  /* ───────── レシート ───────── */
  function receiptKinds() {
    var s = st();
    var ks = (s.receipt && s.receipt.length) ? s.receipt : (R.placedNow.length ? R.placedNow : s.fridge.map(function (e) { return e.k; }));
    ks = ks.filter(isKind).slice(0, 8);
    if (!ks.length) ks = ['egg'];
    return ks;
  }
  function makeReceipt(kinds) {
    var n = kinds.length;
    var L = clamp(0.12 + n * 0.022, 0.16, 0.26);
    var CW = 192, CH = Math.round(CW * L / 0.075);
    var tex = U.tex(CW, CH, function (ctx, w, h) {
      var teeth = 12, tw = w / teeth, td = 6, i;
      ctx.beginPath();
      ctx.moveTo(0, td);
      for (i = 0; i < teeth; i++) { ctx.lineTo(i * tw + tw / 2, 0); ctx.lineTo((i + 1) * tw, td); }
      ctx.lineTo(w, h - td);
      for (i = teeth; i > 0; i--) { ctx.lineTo(i * tw - tw / 2, h); ctx.lineTo((i - 1) * tw, h - td); }
      ctx.closePath();
      ctx.fillStyle = '#fbfaf5';
      ctx.fill();
      ctx.save(); ctx.clip();
      U.speckle(ctx, w, h, { n: 500, size: 0.8, alpha: 0.05, seed: 7, dark: '#9a9488' });
      var top = w * 0.24, bot = w * 0.42, area = h - top - bot, cell = area / n;
      var size = Math.min(w * 0.9, cell * 1.08);
      for (i = 0; i < n; i++) {
        var cy = top + cell * (i + 0.5);
        var ic = null;
        try { if (G.icon) ic = G.icon(kinds[i]); } catch (e) { ic = null; }
        if (ic) ctx.drawImage(ic, (w - size) / 2, cy - size / 2, size, size);
        else { ctx.fillStyle = '#d9d4ca'; ctx.beginPath(); ctx.arc(w / 2, cy, size * 0.35, 0, 6.283); ctx.fill(); }
        if (i < n - 1) {
          ctx.fillStyle = 'rgba(150,150,146,0.55)';
          for (var x = w * 0.12; x < w * 0.88; x += 7) ctx.fillRect(x, top + cell * (i + 1), 4, 1);
        }
      }
      var r = U.rng(13), bx = w * 0.16, by = h - bot + w * 0.12;
      ctx.fillStyle = 'rgba(40,40,40,0.88)';
      while (bx < w * 0.84) {
        var bw = 1 + Math.floor(r() * 3.2);
        ctx.fillRect(bx, by, bw, w * 0.24);
        bx += bw + 1 + Math.floor(r() * 3);
      }
      ctx.restore();
    });
    var geo = new T.PlaneGeometry(0.075, L, 1, 16);
    geo.translate(0, -L / 2, 0);
    var pa = geo.attributes.position;
    for (var i = 0; i < pa.count; i++) {
      var v = -pa.getY(i) / L; // 0 = 上, 1 = 下
      pa.setZ(i, 0.0015 * Math.sin(PI * v) + 0.007 * Math.pow(Math.max(0, v - 0.7) / 0.3, 2));
    }
    geo.computeVertexNormals();
    var paper = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, alphaTest: 0.5, side: T.DoubleSide }));
    paper.position.y = 0.012;
    paper.receiveShadow = true;
    var g = new T.Group();
    g.add(paper);
    var mag = new T.Group();
    var mm = new T.MeshPhysicalMaterial({ color: 0xc41f28, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
    var disc = new T.Mesh(new T.CylinderGeometry(0.0165, 0.018, 0.010, 40), mm);
    disc.rotation.x = PI / 2;
    disc.position.z = 0.006;
    mag.add(disc);
    var dome = new T.Mesh(new T.SphereGeometry(0.0165, 40, 12, 0, PI * 2, 0, PI * 0.28), mm);
    dome.rotation.x = PI / 2;
    dome.position.z = 0.0062;
    mag.add(dome);
    U.shadow(mag, true, false);
    g.add(mag);
    /* 扉に貼った時に絵が見分けられる大きさにする(マグネットは実物大のまま) */
    g.scale.setScalar(1.7);
    mag.scale.setScalar(1.15 / 1.7);
    g.userData = { L: L * 1.7, mag: mag };
    return g;
  }
  var RECEIPT_LOCAL = V(-0.348, 1.52, 0.0615);
  function stickReceipt(g) {
    W.door.add(g);
    g.position.copy(RECEIPT_LOCAL);
    g.rotation.set(0, 0, 0.035);
  }

  /* ───────── 手がかり ───────── */
  var hintFns = {};
  function handleWorld(out) { return W.door.localToWorld((out || V()).copy(W.handleCenter)); }
  hintFns.handleTo = function () { return handleWorld().add(V(0.4, 0, 0)); };
  // 開いた扉の、画面に見えている内側の点
  function doorStripPoint() {
    var out = V(), best = null;
    for (var lx = -0.64; lx <= -0.05; lx += 0.03) {
      out.set(lx, 1.15, -0.03);
      W.door.localToWorld(out);
      var s = scr(out);
      if (s.x <= vw() * 0.93 && s.x >= 0) { best = out.clone(); break; }
    }
    if (!best) { best = V(-0.06, 1.15, -0.03); W.door.localToWorld(best); }
    return best;
  }
  hintFns.strip = function () { return doorStripPoint(); };
  hintFns.stripTo = function () { return doorStripPoint().add(V(-0.4, 0, 0)); };
  hintFns.putTo = function () {
    if (!R || !R.active) return V(0, 1.2, 0);
    var s = recommend(R.active.userData.kind);
    return s ? s.pos.clone().add(V(0, R.active.userData.cy, 0)) : V(0, 1.2, 0);
  };
  hintFns.wigDoor = function () {
    if (!R || R.door.drag || R.busy) return;
    tween(0.7, function (k, raw) { R.door.wig = (7 - DOOR_REST) * Math.sin(PI * raw); }, 'linear', function () { R.door.wig = 0; });
    play('tap', { vol: 0.4 });
  };
  hintFns.wigBag = function () {
    if (!R || R.leaving) return;
    wobble(W.bag, 0.07, 1.1, 9);
    play('keys', { vol: 0.6 });
  };
  hintFns.wigPut = function () {
    if (!R || !R.active || (R.carry && R.carry.obj === R.active)) return;
    hop(R.active.userData.model, 0.035, 0.38);
  };
  hintFns.wigClose = function () {
    if (!R || R.door.drag) return;
    tween(0.7, function (k, raw) { R.door.wig = -6 * Math.sin(PI * raw); }, 'linear', function () { R.door.wig = 0; });
  };

  function setHint(sig, h) {
    if (!R || R.hintSig === sig) return;
    R.hintSig = sig;
    try { if (G.hint) G.hint(h); } catch (e) { if (window.console) console.error(e); }
  }
  function refreshHint() {
    if (!R) return;
    var s = st(), open = R.door.isOpen;
    if (R.leaving || R.busy || R.introRun || R.ending) { setHint('none', null); return; }
    var bagHint = { key: 'bag', target: W.bag, to: null, wiggle: hintFns.wigBag };
    var openHint = { key: 'open', target: W.handle, to: hintFns.handleTo, wiggle: hintFns.wigDoor };
    if (R.mode === 'home1') {
      if (R.introDone) setHint('bag', bagHint);
      else if (!open) setHint('open', openHint);
      else setHint('none', null);
      return;
    }
    if (s.done) { setHint(R.endReady ? 'bag' : 'none', R.endReady ? bagHint : null); return; }
    if (R.bagObjs.length) {
      if (open && R.active) setHint('put:' + R.active.id, { key: 'put', target: R.active, to: hintFns.putTo, wiggle: hintFns.wigPut });
      else if (!open) setHint('open', openHint);
      else setHint('none', null);
    } else {
      if (open) setHint('close', { key: 'close', target: hintFns.strip, to: hintFns.stripTo, wiggle: hintFns.wigClose });
      else setHint('none', null);
    }
  }

  /* バッグの「次の1こ」を出す／しまう */
  function refreshBag(animate) {
    if (!R) return;
    var s = st();
    var want = null;
    if (R.mode === 'home2' && !s.done && !R.ending && R.door.isOpen && R.bagObjs.length) want = R.bagObjs[0];
    if (R.carry && R.carry.from === 'bag') want = R.carry.obj;
    if (want !== R.active) {
      if (R.activeGlow) { unglow(R.activeGlow); R.activeGlow = null; }
      R.active = want;
      if (want && !(R.carry && R.carry.obj === want)) {
        makeRoomFor(want.userData.kind);
        R.activeGlow = glow(want, { color: 0xfff0c0, size: 1.4 });
        hop(want.userData.model, 0.03, 0.4);
      }
      layoutBag(animate !== false);
    }
    // 空のバッグはくたっとする
    if (R.mode === 'home2') {
      if (!R.bagObjs.length) sag(W.bag, 0.9, 0.045); else sag(W.bag, 1, 0);
    }
  }

  /* ───────── 扉 ───────── */
  function doorUpdate(dt) {
    var D = R.door;
    if (D.drag) {
      D.ang = damp(D.ang, D.drag.want, 28, dt);
      D.vel = 0;
    } else {
      var opening = D.target > 30;
      var K = opening ? 46 : 26, C = opening ? 8.5 : 10.5;
      D.vel += ((D.target - D.ang) * K - D.vel * C) * dt;
      D.ang += D.vel * dt;
      if (D.ang > DOOR_OPEN + 3) { D.ang = DOOR_OPEN + 3; D.vel = -Math.abs(D.vel) * 0.3; }
      if (!opening && D.ang < DOOR_REST) { D.ang = DOOR_REST; D.vel = 0; }
    }
    D.ang = clamp(D.ang, 0, DOOR_OPEN + 3);
    // 出来事
    if (!D.open5 && D.ang > 5) { D.open5 = true; onDoorOpened(); }
    if (D.open5 && !D.drag && D.target <= DOOR_REST && D.ang <= DOOR_REST + 0.35) {
      D.open5 = false; D.ang = DOOR_REST; D.vel = 0; onDoorClosed();
    }
    if (!D.full && D.ang > 100) { D.full = true; onDoorFull(); }
    if (D.full && D.ang < 40) D.full = false;
    // 「開いている」（物を出し入れできる）
    var isOpen = D.isOpen ? (D.ang > 45) : (D.ang > 75);
    if (isOpen !== D.isOpen) { D.isOpen = isOpen; refreshBag(); refreshHint(); }
    W.door.rotation.y = (D.ang + D.wig) * D2R;
    // 庫内灯・すきま光
    var a = D.ang + D.wig;
    var lightOn = a > 0.8 ? 1 : 0;
    R.light = damp(R.light, lightOn, 14, dt);
    W.fLight.intensity = 0.45 * R.light;
    W.lampMat.emissiveIntensity = 2.2 * R.light;
    var leakK = a < 0.4 ? 0 : a < 1.0 ? (a - 0.4) / 0.6 : a < 6 ? 1 : a < 16 ? 1 - (a - 6) / 10 : 0;
    W.leakMat.opacity = 0.9 * leakK * R.light;
    W.haloMat.opacity = 0.55 * leakK * R.light * (1 - R.evening * 0.3);
  }
  function onDoorOpened() {
    play('doorOpen');
    sloop('fridgeHum', true, { vol: 0.7 });
    var n = low() ? 2 : 4;
    for (var i = 0; i < n; i++) {
      (function (i) {
        later(0.08 + i * 0.14, function () {
          puff(V(-0.25 + Math.random() * 0.4, 0.68 + Math.random() * 0.1, 0.33), {
            n: low() ? 3 : 5, color: 0xf2f6ff, size: 0.045, up: -0.04, spread: 0.12, life: 1.3
          });
        });
      })(i);
    }
  }
  function onDoorClosed() {
    play('doorClose');
    sloop('fridgeHum', true, { vol: 0.18 });
    refreshBag(); refreshHint();
    if (R.mode === 'home2' && !st().done && !R.ending && !R.bagObjs.length && !R.carry) startEnding();
  }
  function onDoorFull() {
    if (R.mode === 'home1' && !R.introDone && !R.introRun) startIntro();
  }
  function grabDoor(p) {
    var D = R.door;
    var fromOpen = D.target > 30 || D.ang > 30;
    var base = D.ang + (fromOpen ? -4 : 4);
    D.drag = { base: base, fromOpen: fromOpen, want: clamp(base, 0, DOOR_OPEN) };
    D.vel = 0;
    if (fromOpen) play('tap', { vol: 0.35 });
    sloop('fridgeHum', true, { vol: fromOpen ? 0.7 : 0.25 });
  }
  function dragDoor(p) {
    var D = R.door;
    if (!D.drag) return;
    D.drag.want = clamp(D.drag.base + (p.dx || 0) / (vw() * 0.45) * 110, 0, DOOR_OPEN);
  }
  function releaseDoor(p) {
    var D = R.door, d = D.drag;
    if (!d) return;
    D.drag = null;
    var tap = !p.cancel && (p.dist || 0) < 12;
    if (tap) D.target = d.fromOpen ? DOOR_REST : DOOR_OPEN;
    else D.target = D.ang > (d.fromOpen ? 80 : 30) ? DOOR_OPEN : DOOR_REST;
    if (p.cancel) D.target = D.ang > 30 ? DOOR_OPEN : DOOR_REST;
  }
  function closeDoorSoft() {
    var D = R.door;
    D.drag = null;
    D.target = DOOR_REST;
  }
  var DOOR_FRONT = [V(-0.35, 0.58, 0.34), V(0.35, 0.58, 0.34), V(-0.35, 1.73, 0.34), V(0.35, 1.73, 0.34)];
  var DRAWER_FRONT = [V(-0.35, 0.05, 0.34), V(0.35, 0.05, 0.34), V(-0.35, 0.57, 0.34), V(0.35, 0.57, 0.34)];
  function hitDoor(p) {
    var D = R.door;
    if (D.ang < 30 && D.target < 30) return inRect(p, rectOf(DOOR_FRONT), 14);
    // 開いている: 扉の見えている所＋画面の右端 25%
    var pts = [];
    [-0.696, -0.35, 0].forEach(function (x) { [0.58, 1.73].forEach(function (y) { pts.push(V(x, y, 0.06)); pts.push(V(x, y, -0.12)); }); });
    var r = rectOf(pts, W.door);
    var x0 = Math.min(r.x0 - 30, vw() * 0.75);
    return p.x >= x0 && p.x <= Math.max(r.x1 + 40, vw()) && p.y >= r.y0 - 60 && p.y <= r.y1 + 60;
  }

  /* ───────── home1 の小さなお話 ───────── */
  function startIntro() {
    R.introRun = true;
    refreshHint();
    tween(0.8, function (k) { R.zoom = k; }, 'inOut');
    later(0.6, function () { wobble(W.egg, 0.32, 1.2, 11); play('lonely'); });
    later(1.4, function () { play('growl'); R.shakeT = 0.9; R.shakeA = 0.007; });
    later(2.8, function () {
      var z0 = R.zoom;
      tween(0.9, function (k) { R.zoom = z0 * (1 - k); }, 'inOut');
      hop(W.bag, 0.06, 0.45);
      squash(W.bag, 0.08, 0.5);
      play('bagRustle', { vol: 0.6 });
      R.introRun = false;
      R.introDone = true;
      refreshHint();
    });
  }

  /* バッグにさわって買い物へ */
  function goShopping() {
    R.leaving = true;
    setHint('none', null);
    if (R.carry) cancelCarry();
    play('keys');
    hop(W.bag, 0.05, 0.25);
    var y0 = W.bagRoot.position.y;
    later(0.18, function () {
      tween(0.55, function (k) { W.bagRoot.position.y = y0 + 0.28 * k; }, 'back');
    });
    if (R.door.ang > 3) closeDoorSoft();
    later(0.35, function () { play('chime'); });
    later(1.05, function () { try { G.go('shelf'); } catch (e) { if (window.console) console.error(e); } });
  }
  function newTrip() {
    var s = st();
    s.done = false; s.basket = []; s.scanned = []; s.bag = [];
    while (12 - s.fridge.length < 6 && s.fridge.length) s.fridge.shift();
    save();
    goShopping();
  }

  /* ───────── home2 の終わり ───────── */
  function startEnding() {
    var s = st();
    R.ending = true;
    R.busy = true;
    setHint('none', null);
    var kinds = receiptKinds();
    s.done = true;
    s.trip = (s.trip || 0) + 1;
    s.receipt = kinds.slice();
    save();
    var rc = makeReceipt(kinds);
    R.receipt = rc;
    var finalW = function () { return W.door.localToWorld(RECEIPT_LOCAL.clone()); };
    var cam = W.camera;
    var halfW = function (z) { return Math.tan(cam.fov * D2R / 2) * cam.aspect * Math.max(0.3, cam.position.z - z); };
    var startP = V(cam.position.x + halfW(0.75) + 0.3, 1.62, 0.75);
    var H = null;
    try { if (window.Hand && Hand.create) H = Hand.create({ sleeve: true, side: 'R' }); } catch (e) { H = null; }
    rc.position.copy(startP);
    W.scene.add(rc);
    var stuck = function () {
      stickReceipt(rc);
      play('magnet');
      squash(rc.userData.mag, 0.25, 0.35);
      R.busy = false;
      afterStuck();
    };
    if (H && H.group) {
      R.hand = H;
      R.handTip = H.tip || H.group;
      U.shadow(H.group, true, false);
      H.group.rotation.set(0, 0, PI / 2 + 0.22);
      W.scene.add(H.group);
      try { H.pose('pinch', 0.2); } catch (e) { /* */ }
      R.handP = startP.clone();
      R.handFollow = true;
      var near = function () { return finalW().add(V(0.05, 0.03, 0.1)); };
      tween(1.3, function (k) { R.handP.lerpVectors(startP, near(), k); }, 'inOut', function () {
        var a = R.handP.clone();
        tween(0.28, function (k) { R.handP.lerpVectors(a, finalW().add(V(0, 0, 0.004)), k); }, 'out', function () {
          R.handFollow = 'free';
          stuck();
          later(0.25, function () {
            try { H.pose('open', 0.25); } catch (e) { /* */ }
            var b = R.handP.clone(), c = startP.clone().add(V(0.25, 0.08, 0.1));
            tween(1.0, function (k) { R.handP.lerpVectors(b, c, k); }, 'inOut', function () {
              removeObj(H.group);
              R.hand = null; R.handFollow = false;
            });
          });
        });
      });
    } else {
      var s0 = startP.clone();
      tween(1.1, function (k) {
        rc.position.lerpVectors(s0, finalW(), k);
        rc.position.z += 0.08 * Math.sin(PI * k);
        rc.rotation.set(0, W.door.rotation.y, 0.4 * (1 - k));
      }, 'inOut', stuck);
    }
  }
  function afterStuck() {
    later(0.2, function () {
      play('ending');
      var e0 = R.evening;
      tween(3.0, function (k) { setEvening(U.lerp(e0, 1, k)); }, 'inOut');
      var n = low() ? 3 : 6;
      for (var i = 0; i < n; i++) {
        later(0.15 + i * 0.35, function () {
          puff(V(-0.45 + Math.random() * 0.9, 0.5 + Math.random() * 1.3, 0.42), {
            n: low() ? 3 : 5, color: 0xfff0c0, size: 0.018, up: 0.07, spread: 0.12, life: 1.1
          });
        });
      }
    });
    later(3.5, function () {
      R.ending = false;
      R.endReady = true;
      refreshHint();
    });
  }

  /* ───────── 品物を運ぶ ───────── */
  function startCarry(w, from, entry, p) {
    stopMove(w);
    if (R.activeGlow && from === 'bag') { unglow(R.activeGlow); R.activeGlow = null; }
    W.scene.attach(w);
    w.rotation.set(0, 0, 0);
    var c = V(); w.getWorldPosition(c);
    R.carry = { obj: w, from: from, entry: entry, zp: from === 'bag' ? 0.6 : 0.12, ndc: new T.Vector2(), inside: false, near: null, lastX: c.x };
    setRay(p); R.carry.ndc.copy(_ndc);
    play('lift');
    squash(w.userData.model, 0.08, 0.3);
  }
  function carryInside(ndc) {
    var P = onZ(ndc, 0.6, V());
    if (!P) return false;
    return R.door.ang > 60 && P.x > -0.44 && P.x < 0.44 && P.y > 0.48 && P.y < 1.9;
  }
  function carryUpdate(dt) {
    var c = R.carry;
    if (!c) return;
    var inside = carryInside(c.ndc);
    c.inside = inside;
    c.zp = damp(c.zp, inside ? 0.1 : 0.6, 9, dt);
    var P = onZ(c.ndc, c.zp, _hit);
    var w = c.obj, ud = w.userData;
    if (P) {
      var ty = P.y - ud.cy;
      if (inside) ty = clamp(ty, FR.inBot + 0.01, FR.inTop - ud.h - 0.01);
      else ty = Math.max(0.01, ty);
      var tx = inside ? clamp(P.x, -0.3 + 0.04, 0.3 - 0.04) : P.x;
      var px = w.position.x;
      w.position.x = damp(w.position.x, tx, 26, dt);
      w.position.y = damp(w.position.y, ty, 26, dt);
      w.position.z = damp(w.position.z, c.zp, 26, dt);
      var vx = (w.position.x - px) / Math.max(dt, 1e-3);
      w.rotation.z = damp(w.rotation.z, clamp(-vx * 0.12, -0.35, 0.35), 10, dt);
    }
    // いちばん近い置ける場所
    var free = freeFor(ud.kind, c.entry), best = null, bd = 1e9;
    var fx = (c.ndc.x + 1) / 2 * vw(), fy = (1 - c.ndc.y) / 2 * vh();
    for (var i = 0; i < free.length; i++) {
      var s = scr(V(free[i].x, free[i].y + ud.cy, free[i].z));
      var d = (s.x - fx) * (s.x - fx) + (s.y - fy) * (s.y - fy);
      if (d < bd) { bd = d; best = free[i]; }
    }
    c.near = best;
    c.free = free;
  }
  function dropCarry(p) {
    var c = R.carry;
    if (!c) return;
    setRay(p); c.ndc.copy(_ndc);
    carryUpdate(0);
    var inside = !p.cancel && carryInside(c.ndc);
    var slot = inside ? c.near : null;
    R.carry = null;
    var w = c.obj, kind = w.userData.kind, s = st();
    if (slot) {
      if (c.from === 'bag') {
        var idx = R.bagObjs.indexOf(w);
        if (idx >= 0) R.bagObjs.splice(idx, 1);
        var bi = s.bag.indexOf(kind);
        if (bi >= 0) s.bag.splice(bi, 1);
        var e = { k: kind, s: slot.id, obj: w };
        R.fitems.push(e);
        R.placedNow.push(kind);
        R.active = null;
        syncFridge();
      } else {
        c.entry.s = slot.id;
        syncFridge();
      }
      moveTo(w, slot.pos, 0.32, 0.045, function () {
        play('place');
        play(info(kind).sound || 'tok', { vol: 0.8 });
        squash(w.userData.model, 0.14, 0.45);
      });
      refreshHint();
      if (c.from === 'bag') later(0.4, function () { refreshBag(); refreshHint(); });
    } else {
      returnCarry(c);
    }
  }
  function returnCarry(c) {
    var w = c.obj;
    play('back', { vol: 0.7 });
    if (c.from === 'bag') {
      W.bagContent.attach(w);
      var i = Math.max(0, R.bagObjs.indexOf(w));
      R.active = null;
      moveTo(w, bagPos(i, false, w), 0.4, 0.06, function () { refreshBag(); refreshHint(); }, 'out');
    } else {
      moveTo(w, SLOT[c.entry.s].pos, 0.35, 0.04, null, 'out');
    }
  }
  function cancelCarry() {
    var c = R.carry;
    if (!c) return;
    R.carry = null;
    returnCarry(c);
  }

  function slotGlowUpdate(dt) {
    var c = R.carry;
    SLOTS.forEach(function (s) {
      var m = W.slotGlow[s.id], t = 0;
      if (c && c.free && c.free.indexOf(s) >= 0) t = (c.near === s && c.inside) ? 0.95 : 0.32;
      m.userData.lv = damp(m.userData.lv, t, 10, dt);
      m.material.opacity = m.userData.lv * (0.85 + 0.15 * Math.sin(clock * 5));
      m.visible = m.userData.lv > 0.01;
      var sc = 1 + (c && c.near === s ? 0.15 : 0);
      m.scale.setScalar(damp(m.scale.x, sc, 8, dt));
    });
  }

  /* ───────── 入力 ───────── */
  function down(p) {
    if (!R || R.leaving) return;
    sloop('fridgeHum', true, { vol: R.door.ang > 5 ? 0.7 : 0.18 });
    if (R.busy) return;
    if (R.carry) cancelCarry();
    R.pending = null;
    var s = st(), D = R.door;
    var open = D.ang > 60;

    // 1) バッグの次の1こ
    if (R.mode === 'home2' && R.active && open && !s.done) {
      var a = R.active;
      if (nearest(p, [{ center: itemCenter(a), r: a.userData.r + 0.02 }], 26)) {
        startCarry(a, 'bag', null, p);
        return;
      }
    }
    // 2) 庫内の品物・たまご
    if (open) {
      var cands = R.fitems.map(function (e) { return { center: itemCenter(e.obj), r: e.obj.userData.r, e: e }; });
      cands.push({ center: W.eggCenter, r: 0.035, egg: true });
      var hit = nearest(p, cands, 10);
      if (hit) {
        if (hit.egg) { wobble(W.egg, 0.3, 1.1, 12); play('lonely'); return; }
        R.pending = { type: 'fitem', e: hit.e };
        squash(hit.e.obj.userData.model, 0.05, 0.25);
        return;
      }
    }
    // 3) エコバッグ
    var bb = new T.Box3().setFromObject(W.bag);
    if (inRect(p, rectOf(boxPoints(bb)), 18)) {
      if (R.mode === 'home1') { goShopping(); return; }
      if (s.done) { newTrip(); return; }
      wobble(W.bag, 0.06, 0.8, 10);
      play('bagRustle', { vol: 0.7 });
      if (R.active) hop(R.active.userData.model, 0.03, 0.35);
      return;
    }
    // 4) 扉
    if (hitDoor(p)) { grabDoor(p); return; }
    // 5) 冷凍室の引き出し
    if (inRect(p, rectOf(DRAWER_FRONT), 6)) {
      play('tok', { vol: 0.8 });
      var dz = W.drawer;
      tween(0.35, function (k, raw) { dz.position.z = 0.01 * Math.sin(PI * raw) * (1 - raw * 0.3); }, 'linear', function () { dz.position.z = 0; });
    }
  }
  function move(p) {
    if (!R) return;
    if (R.door.drag) { dragDoor(p); return; }
    if (R.pending && R.pending.type === 'fitem' && (p.dist || 0) > 10 && !R.busy) {
      var e = R.pending.e;
      R.pending = null;
      if (R.fitems.indexOf(e) >= 0) startCarry(e.obj, 'fridge', e, p);
    }
    if (R.carry) { setRay(p); R.carry.ndc.copy(_ndc); }
  }
  function up(p) {
    if (!R) return;
    if (R.door.drag) { releaseDoor(p); return; }
    if (R.carry) { dropCarry(p); return; }
    if (R.pending && R.pending.type === 'fitem') {
      var e = R.pending.e;
      R.pending = null;
      if (!p.cancel && R.fitems.indexOf(e) >= 0) {
        wobble(e.obj.userData.model, 0.22, 0.8, 13);
        hop(e.obj.userData.model, 0.015, 0.25);
        play(info(e.k).sound || 'tok', { vol: 0.8 });
      }
    }
  }

  /* ───────── 入る・出る ───────── */
  function clearRun() {
    epoch++;
    jobs = [];
    movers = [];
    fxList.slice().forEach(fxReset);
    fxList = [];
    if (!R) return;
    if (R.activeGlow) unglow(R.activeGlow);
    R.fitems.forEach(function (e) { removeObj(e.obj); });
    R.bagObjs.forEach(removeObj);
    if (R.carry) removeObj(R.carry.obj);
    if (R.receipt) removeObj(R.receipt);
    if (R.hand && R.hand.group) removeObj(R.hand.group);
    R = null;
  }
  function enterMode(mode) {
    buildWorld();
    clearRun();
    // 取り残しの品物（念のため）
    W.bagContent.children.slice().forEach(removeObj);
    W.scene.children.slice().forEach(function (o) { if (o.userData && ((o.userData.kind && o.userData.model) || o.userData.mag)) removeObj(o); });
    W.door.children.slice().forEach(function (o) { if (o.userData && o.userData.mag) removeObj(o); });
    R = newRun(mode);
    var s = st();
    if (s.done == null) s.done = false;
    W.door.rotation.y = DOOR_REST * D2R;
    W.bagRoot.position.set(-0.1, 0.12, 0.64);
    W.drawer.position.z = 0;
    SLOTS.forEach(function (q) { var m = W.slotGlow[q.id]; m.userData.lv = 0; m.material.opacity = 0; m.visible = false; });
    buildFridgeItems();
    if (mode === 'home2') {
      if (!s.done) {
        s.bag = s.bag.filter(isKind);
        if (!s.bag.length) {
          var sc = (s.scanned || []).filter(isKind);
          s.bag = sc.length ? sc.slice() : ['milk', 'egg', 'apple', 'tomato', 'pudding', 'carrot'];
        }
        ensureRoom();
        // ensureRoom が state.fridge を減らしたので作り直す
        R.fitems.forEach(function (e) { removeObj(e.obj); });
        buildFridgeItems();
        save();
        buildBagItems(s.bag);
        setEvening(0);
      } else {
        s.bag = [];
        R.receipt = makeReceipt(receiptKinds());
        stickReceipt(R.receipt);
        setEvening(1);
        R.endReady = true;
        save();
      }
      if (!R.bagObjs.length) { var f = fxOf(W.bag); f.sag = f.sagT = 0.9; f.tilt = f.tiltT = 0.045; }
    } else {
      setEvening(0);
    }
    amb('home');
    sloop('fridgeHum', true, { vol: 0.18 });
    refreshBag(false);
    refreshHint();
  }

  /* ───────── カメラ ───────── */
  var camBase = null, camZoomDir = V();
  function layout() {
    buildWorld();
    var cam = W.camera;
    var sm = low() ? 512 : 1024, sh = W.sun.shadow;
    if (sh.mapSize.x !== sm) {
      sh.mapSize.set(sm, sm);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    var aspect = vw() / vh();
    cam.aspect = aspect;
    var done = false;
    try {
      if (G.fit) { G.fit(cam, { center: V(0, 0.86, 0.3), w: 0.86, h: 1.84, pitch: 0.07 }); done = true; }
    } catch (e) { done = false; }
    if (!done) {
      cam.fov = 35;
      var vfov = cam.fov * D2R, dist = Math.max(1.75 * 1.1 / (2 * Math.tan(vfov / 2)), 0.86 * 1.1 / (2 * Math.tan(vfov / 2) * aspect));
      cam.position.set(0, 0.86 + Math.sin(0.07) * dist, 0.3 + Math.cos(0.07) * dist);
      cam.lookAt(0, 0.86, 0.3);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    camBase = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    camZoomDir.copy(V(0, 1.15, 0.05)).sub(camBase.pos).multiplyScalar(0.16);
  }
  function cameraUpdate(dt) {
    if (!camBase || !R) return;
    var cam = W.camera;
    cam.position.copy(camBase.pos).addScaledVector(camZoomDir, R.zoom);
    if (R.shakeT > 0) {
      R.shakeT -= dt;
      var t = clock, a = R.shakeA * Math.min(1, R.shakeT / 0.3);
      cam.position.x += a * Math.sin(t * 57);
      cam.position.y += a * 0.6 * Math.sin(t * 73 + 1);
    }
    cam.quaternion.copy(camBase.quat);
  }

  var clock = 0;
  function update(dt) {
    if (!R) return;
    dt = Math.min(dt || 0.016, 0.05);
    clock += dt;
    runJobs(dt);
    if (!R) return;
    doorUpdate(dt);
    runMovers(dt);
    carryUpdate(dt);
    runFx(dt);
    slotGlowUpdate(dt);
    cameraUpdate(dt);
    if (R.hand) {
      try { if (R.hand.update) R.hand.update(dt); } catch (e) { /* */ }
      if (R.handFollow && R.handP) {
        var g = R.hand.group, tw = V();
        g.updateMatrixWorld(true);
        R.handTip.getWorldPosition(tw);
        g.position.add(R.handP.clone().sub(tw));
        if (R.handFollow === true && R.receipt) {
          R.receipt.position.copy(R.handP);
          R.receipt.rotation.set(0, W.door.rotation.y, 0.035);
        }
      }
    }
  }

  function exit() {
    try { if (G.hint) G.hint(null); } catch (e) { /* */ }
    sloop('fridgeHum', false);
    if (R) {
      if (R.carry) { var c = R.carry; R.carry = null; returnCarry(c); }
      R.door.drag = null;
      R.pending = null;
      R.hintSig = '';
    }
    jobs = [];
  }

  /* ───────── 場面の登録 ───────── */
  function def(mode) {
    return {
      build: function () { buildWorld(); this.scene = W.scene; this.camera = W.camera; },
      enter: function () {
        buildWorld();
        this.scene = W.scene; this.camera = W.camera;
        if (G.env && !W.scene.environment) W.scene.environment = G.env;
        enterMode(mode);
      },
      exit: exit,
      layout: layout,
      update: update,
      down: down,
      move: move,
      up: up
    };
  }
  G.addScene('home1', def('home1'));
  G.addScene('home2', def('home2'));

  // 確かめ用の小さな入口（ゲームの中からは使わない）
  G._home = {
    open: function () { if (R) { R.door.target = DOOR_OPEN; } },
    close: function () { if (R) closeDoorSoft(); },
    run: function () { return R; },
    world: function () { return W; }
  };
})();
