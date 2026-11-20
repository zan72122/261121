/* 40-register.js — 場面 register（レジ）。かごの品物を読み取り口のガラスの上へ通して「ぴっ！」→ エコバッグへ。
   全部終わるとママがカードをかざし、レシートが出る → 引っぱって切る → おうちへ。
   台の上面 y=0、奥 -Z、手前(子ども側) +Z。 */
(function () {
  'use strict';
  var T = window.THREE;
  if (!T || !window.G || typeof G.addScene !== 'function') return;

  var PI = Math.PI;
  var V3 = T.Vector3;

  /* ───────── 配置 ───────── */
  var GLASS = { x: 0, z: -0.10, half: 0.10 };            // 読み取り口の窓 0.20×0.20
  var ZONE = GLASS.half + 0.06;                          // ぴっ判定の四角（各辺 +0.06）
  var BASKET_POS = new V3(0, 0, 0.30);
  var BAG_POS = new V3(-0.02, 0, -0.44);
  var PIL = { x: 0.25, z: -0.16 };                        // レジの柱
  var PAD = new V3(0.25, 0.0612, -0.125);                 // カード読み取りパッドの中心（上面）
  var SLOT = new V3(0.25, 0.041, -0.0815);                // レシートの出口
  var HOLD_PLANE = 0.30;                                  // 指で動かす水平面
  var HOLD_B = 0.27, SCAN_B = 0.07, BAG_B = 0.45;         // 持っている品物の底の高さ（ふつう／ガラスの上／バッグの上）
  var SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
  var DEFAULT = ['milk', 'egg', 'apple', 'tomato', 'pudding', 'carrot'];
  var REC_W = 0.074, REC_MAX = 0.22, REC_H0 = SLOT.y;

  /* ───────── 小道具 ───────── */
  function snd(name, o) { var S = window.Sound; if (S && typeof S.play === 'function') { try { S.play(name, o || {}); } catch (e) {} } }
  function E(n) { return (G.ease && G.ease[n]) || function (k) { return k; }; }
  function hint(o) { if (typeof G.hint === 'function') { try { G.hint(o); } catch (e) {} } }
  function shake(o, a, d) { if (o && typeof G.shake === 'function') G.shake(o, a, d); }
  function puff(p, o) { if (typeof G.puff === 'function') G.puff(p, o); }
  function icon(kind) {
    if (typeof G.icon === 'function') { try { return G.icon(kind); } catch (e) {} }
    return null;
  }
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function rrShape(w, h, r) {
    var s = new T.Shape(), hw = w / 2, hh = h / 2;
    s.moveTo(-hw + r, -hh); s.lineTo(hw - r, -hh); s.absarc(hw - r, -hh + r, r, -PI / 2, 0, false);
    s.lineTo(hw, hh - r); s.absarc(hw - r, hh - r, r, 0, PI / 2, false);
    s.lineTo(-hw + r, hh); s.absarc(-hw + r, hh - r, r, PI / 2, PI, false);
    s.lineTo(-hw, -hh + r); s.absarc(-hw + r, -hh + r, r, PI, PI * 1.5, false);
    return s;
  }
  function rbox(w, h, d, seg, r) {
    if (T.RoundedBoxGeometry) return new T.RoundedBoxGeometry(w, h, d, seg || 3, r);
    return new T.BoxGeometry(w, h, d);
  }

  var live = [];
  function tw(dur, fn, o) { var h = G.tween(dur, fn, o || {}); live.push(h); return h; }
  function later(sec, fn) { var h = G.after(sec, fn); live.push(h); return h; }
  function stopAll() { for (var i = 0; i < live.length; i++) { try { live[i].stop(); } catch (e) {} } live.length = 0; }

  /* ───────── テクスチャ ───────── */
  function laminateMaps() {
    var col = U.tex(512, 512, function (c, w, h) {
      c.fillStyle = '#eceae5'; c.fillRect(0, 0, w, h);
      var r = U.rng(11);
      for (var i = 0; i < 60; i++) {
        var x = r() * w, y = r() * h, rad = 30 + r() * 90;
        var g = c.createRadialGradient(x, y, 0, x, y, rad);
        var dark = r() < 0.5;
        g.addColorStop(0, dark ? 'rgba(150,145,135,0.06)' : 'rgba(255,255,255,0.07)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      U.speckle(c, w, h, { seed: 5, n: 6000, size: 0.6, alpha: 0.14, light: '#ffffff', dark: '#8e897f', lightRatio: 0.45 });
      U.speckle(c, w, h, { seed: 9, n: 500, size: 0.9, alpha: 0.12, dark: '#a8a296', lightRatio: 0 });
    }, { repeat: [3, 2.5] });
    var rough = U.tex(256, 256, function (c, w, h) {
      c.fillStyle = '#7a7a7a'; c.fillRect(0, 0, w, h);
      var r = U.rng(4);
      for (var i = 0; i < 30; i++) {
        var x = r() * w, y = r() * h, rad = 20 + r() * 60;
        var g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, r() < 0.5 ? 'rgba(40,40,40,0.25)' : 'rgba(200,200,200,0.2)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      U.speckle(c, w, h, { seed: 2, n: 1500, size: 0.7, alpha: 0.2 });
    }, { data: true, repeat: [3, 2.5] });
    return { col: col, rough: rough };
  }
  function brushedRough() {
    return U.tex(256, 64, function (c, w, h) {
      c.fillStyle = '#5a5a5a'; c.fillRect(0, 0, w, h);
      var r = U.rng(21);
      for (var i = 0; i < 260; i++) {
        c.globalAlpha = 0.08 + r() * 0.15;
        c.fillStyle = r() < 0.5 ? '#202020' : '#9a9a9a';
        c.fillRect(r() * w - 40, r() * h, 40 + r() * 160, 0.6 + r() * 0.8);
      }
      c.globalAlpha = 1;
    }, { data: true, repeat: [4, 1] });
  }
  function floorMaps() {
    var col = U.tex(512, 512, function (c, w, h) {
      var cols = ['#dedad1', '#e4e0d7', '#d9d5cc', '#e1ddd3'];
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        c.fillStyle = cols[i * 2 + j]; c.fillRect(i * 256, j * 256, 256, 256);
      }
      U.speckle(c, w, h, { seed: 31, n: 5000, size: 1.0, alpha: 0.18, light: '#f6f4ee', dark: '#9d978a' });
      U.speckle(c, w, h, { seed: 33, n: 300, size: 2.2, alpha: 0.12, dark: '#8a8476', lightRatio: 0.2 });
      c.strokeStyle = 'rgba(150,144,132,0.55)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, 1); c.lineTo(w, 1); c.moveTo(0, 257); c.lineTo(w, 257);
      c.moveTo(1, 0); c.lineTo(1, h); c.moveTo(257, 0); c.lineTo(257, h); c.stroke();
    }, { repeat: [20, 20] });
    var rough = U.tex(128, 128, function (c, w, h) {
      c.fillStyle = '#5c5c5c'; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { seed: 3, n: 600, size: 1.2, alpha: 0.25 });
      c.fillStyle = '#d0d0d0'; c.fillRect(0, 0, w, 1); c.fillRect(0, 64, w, 1); c.fillRect(0, 0, 1, h); c.fillRect(64, 0, 1, h);
    }, { data: true, repeat: [20, 20] });
    return { col: col, rough: rough };
  }
  function laserTex(seed, lines) {
    return U.tex(256, 256, function (c, w, h) {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.lineCap = 'round';
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < lines.length; i++) {
          var a = lines[i][0], off = lines[i][1];
          var dx = Math.cos(a), dy = Math.sin(a), nx = -dy * off, ny = dx * off;
          c.strokeStyle = pass === 0 ? 'rgba(255,30,20,0.35)' : 'rgba(255,120,100,0.95)';
          c.lineWidth = pass === 0 ? 9 : 2.2;
          c.shadowColor = 'rgba(255,20,10,1)';
          c.shadowBlur = pass === 0 ? 14 : 4;
          c.beginPath();
          c.moveTo(128 + nx - dx * 170, 128 + ny - dy * 170);
          c.lineTo(128 + nx + dx * 170, 128 + ny + dy * 170);
          c.stroke();
        }
      }
      c.shadowBlur = 0;
      void seed;
    });
  }
  function radialTex(stops) {
    return U.tex(128, 128, function (c, w, h) {
      var g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
  }
  function padTex() {
    return U.tex(256, 208, function (c, w, h) {
      c.fillStyle = '#26292e'; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { seed: 7, n: 600, size: 0.8, alpha: 0.12 });
      c.strokeStyle = 'rgba(190,198,206,0.55)'; c.lineWidth = 4;
      rr(c, 10, 10, w - 20, h - 20, 22); c.stroke();
      c.strokeStyle = 'rgba(235,240,245,0.9)'; c.lineCap = 'round';
      for (var i = 0; i < 4; i++) {
        c.lineWidth = 9;
        c.beginPath();
        c.arc(78, h / 2, 26 + i * 30, -0.75, 0.75);
        c.stroke();
      }
    });
  }
  function beamTex() {
    return U.tex(64, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(255,60,40,1)');
      g.addColorStop(0.15, 'rgba(255,40,30,0.75)');
      g.addColorStop(0.7, 'rgba(255,30,20,0.25)');
      g.addColorStop(1, 'rgba(255,20,10,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      var g2 = c.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.12, 'rgba(0,0,0,0)');
      g2.addColorStop(0.88, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = g2; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
    });
  }
  function lineTex() {
    return U.tex(256, 32, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,30,20,0)'); g.addColorStop(0.5, 'rgba(255,120,100,1)'); g.addColorStop(1, 'rgba(255,30,20,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      var g2 = c.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.1, 'rgba(0,0,0,0)');
      g2.addColorStop(0.9, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = g2; c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
    });
  }
  function wallTex() {
    return U.tex(256, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#efece6'); g.addColorStop(0.75, '#e6e2da'); g.addColorStop(0.86, '#d9d4cb');
      g.addColorStop(0.861, '#9fa3a6'); g.addColorStop(1, '#8e9295');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h * 0.85, { seed: 12, n: 900, size: 1, alpha: 0.06 });
      c.fillStyle = 'rgba(160,155,146,0.35)';
      for (var i = 0; i < 4; i++) c.fillRect(i * 64, 0, 1.5, h * 0.86);
    }, { repeat: [6, 1] });
  }

  /* 手のひらの絵（指を読ませた時の画面） */
  var handIcon = null;
  function getHandIcon() {
    if (handIcon) return handIcon;
    var cv = U.canvas(256, 256), c = cv.getContext('2d');
    function shape() {
      c.beginPath();
      rr(c, 70, 112, 116, 112, 46);
      var fx = [86, 113, 140, 166], fh = [92, 108, 104, 84], fw = 25;
      for (var i = 0; i < 4; i++) { rr(c, fx[i] - fw / 2, 150 - fh[i], fw, fh[i] + 20, fw / 2); }
      c.save();
      c.translate(80, 170); c.rotate(-0.85);
      rr(c, -14, -78, 28, 92, 14);
      c.restore();
    }
    function path() {
      c.beginPath();
      c.moveTo(0, 0);
      var parts = [];
      void parts;
    }
    void path;
    // 外形の線（太く描いてから中を塗りつぶす → 外側だけ残る）
    var subs = [
      function () { rr(c, 70, 112, 116, 112, 46); },
      function () { rr(c, 86 - 12.5, 58, 25, 112, 12.5); },
      function () { rr(c, 113 - 12.5, 42, 25, 128, 12.5); },
      function () { rr(c, 140 - 12.5, 46, 25, 124, 12.5); },
      function () { rr(c, 166 - 12.5, 66, 25, 104, 12.5); },
      function () { c.save(); c.translate(80, 176); c.rotate(-0.9); rr(c, -14, -80, 28, 94, 14); c.restore(); }
    ];
    void shape;
    var i;
    c.lineJoin = 'round';
    c.strokeStyle = '#d49a78'; c.lineWidth = 12;
    for (i = 0; i < subs.length; i++) { subs[i](); c.stroke(); }
    var g = c.createLinearGradient(0, 40, 0, 230);
    g.addColorStop(0, '#fbdcc6'); g.addColorStop(1, '#f2c09f');
    c.fillStyle = g;
    for (i = 0; i < subs.length; i++) { subs[i](); c.fill(); }
    // 指のしわと手のひらの陰
    c.strokeStyle = 'rgba(200,140,110,0.45)'; c.lineWidth = 3; c.lineCap = 'round';
    [[86, 120], [113, 112], [140, 114], [166, 124]].forEach(function (q) { c.beginPath(); c.moveTo(q[0] - 7, q[1]); c.lineTo(q[0] + 7, q[1]); c.stroke(); });
    c.beginPath(); c.moveTo(96, 190); c.quadraticCurveTo(130, 205, 168, 178); c.stroke();
    handIcon = cv;
    return cv;
  }

  /* ───────── 場面の中身 ───────── */
  var S = {};               // build で作る物
  var recs = [];            // 品物の記録
  var held = null, lastP = null;
  var phase = 'scan';       // scan | pay | print | receipt | tear | leave
  var bagCount = 0;
  var receiptDown = false;
  var fx = { flash: 0, boost: 0, red: 0, lamp: 0, pay: 0, beam: null, t: 0, flutter: 0 };
  var scr = { mode: 'idle', img: null, t: 0, hold: 0, acc: 1, dirty: true };
  var _v = new V3(), _v2 = new V3(), _plane = new T.Plane(new V3(0, 1, 0), -HOLD_PLANE);
  var _ray = new T.Raycaster(), _q = new T.Quaternion(), _e = new T.Euler();

  /* ───────── 画面（レジのモニター） ───────── */
  function drawScreen() {
    var c = S.scrCtx, w = S.scrCv.width, h = S.scrCv.height, t = fx.t, g, i;
    if (scr.mode === 'idle') {
      g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d8f1f6'); g.addColorStop(1, '#a9d8e6');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (i = 0; i < 5; i++) {
        var x = w * (0.5 + 0.38 * Math.sin(t * (0.21 + i * 0.07) + i * 1.9));
        var y = h * (0.5 + 0.32 * Math.cos(t * (0.17 + i * 0.05) + i * 1.3));
        var rad = 50 + 22 * i % 60;
        g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(255,255,255,0.65)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    } else if (scr.mode === 'paid') {
      var pulse = 0.5 + 0.5 * Math.sin(t * 3);
      g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
      g.addColorStop(0, 'rgb(' + Math.round(210 + 20 * pulse) + ',248,220)'); g.addColorStop(1, '#86d5a3');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      var k = Math.min(1, scr.t / 0.3), s = E('back')(k);
      c.save(); c.translate(w * 0.42, h / 2); c.scale(s, s);
      c.fillStyle = '#9fd1ee'; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 6;
      rr(c, -70, -45, 140, 90, 12); c.fill(); c.stroke();
      c.restore();
      c.save(); c.translate(w * 0.42 + 92, h / 2); c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineCap = 'round';
      for (i = 0; i < 3; i++) { c.lineWidth = 9; c.beginPath(); c.arc(0, 0, 16 + i * 20, -0.7, 0.7); c.globalAlpha = Math.max(0, Math.min(1, scr.t * 3 - i * 0.4)); c.stroke(); }
      c.globalAlpha = 1; c.restore();
    } else {
      g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f6fcfd'); g.addColorStop(1, '#ddf0f4');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      var kk = Math.min(1, scr.t / 0.28), sc = 0.35 + 0.65 * E('back')(kk);
      var fa = 1 - Math.min(1, scr.t / 0.5);
      c.save();
      c.shadowColor = 'rgba(40,210,110,1)'; c.shadowBlur = 22 + 20 * fa;
      c.strokeStyle = 'rgb(' + Math.round(70 + 60 * fa) + ',214,128)'; c.lineWidth = 12;
      rr(c, 12, 12, w - 24, h - 24, 20); c.stroke();
      c.restore();
      if (scr.img) {
        var sz = h * 0.86 * sc;
        c.save();
        c.shadowColor = 'rgba(0,40,60,0.25)'; c.shadowBlur = 14; c.shadowOffsetY = 6;
        c.drawImage(scr.img, w / 2 - sz / 2, h / 2 - sz / 2, sz, sz);
        c.restore();
      }
    }
    S.scrTex.needsUpdate = true;
  }
  function scrShow(img) {
    scr.mode = 'icon'; scr.img = img; scr.t = 0; scr.hold = 3.2; scr.dirty = true;
  }
  function scrPaid() { scr.mode = 'paid'; scr.t = 0; scr.hold = 2.6; scr.dirty = true; }
  function updScreen(dt) {
    scr.t += dt;
    scr.acc += dt;
    if (scr.mode !== 'idle') {
      scr.hold -= dt;
      if (scr.hold <= 0 && phase !== 'pay') { scr.mode = 'idle'; scr.dirty = true; }
    }
    var anim = scr.mode === 'idle' || scr.mode === 'paid' || scr.t < 0.6;
    if (scr.dirty || (anim && scr.acc >= 1 / 30)) {
      scr.acc = 0; scr.dirty = false;
      drawScreen();
    }
  }

  /* ───────── レシート ───────── */
  var PATH = null;
  function paperPath() {
    if (PATH) return PATH;
    PATH = [];
    var y = 0, z = 0, th = 0.12, floorY = -REC_H0 + 0.0016, ds = 0.001;
    for (var i = 0; i <= 260; i++) {
      PATH.push([y, z]);
      var s = i * ds;
      if (y <= floorY + 1e-5) th = 0;
      else th = Math.min(0.12 + s * 9, 1.3);
      y -= Math.sin(th) * ds; z += Math.cos(th) * ds;
      if (y < floorY) y = floorY;
    }
    return PATH;
  }
  var NSEG = 48;
  function makePaperGeo() {
    var g = new T.BufferGeometry();
    var n = (NSEG + 1) * 2;
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(n * 3), 3));
    var idx = [];
    for (var i = 0; i < NSEG; i++) { var a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    return g;
  }
  /* L: 出ている長さ。flat=true はまっすぐ（切って飛ぶ時） */
  function setPaper(L, flat) {
    var g = S.paperGeo, pos = g.attributes.position.array, uv = g.attributes.uv.array, P = paperPath();
    L = Math.max(0.001, L);
    for (var i = 0; i <= NSEG; i++) {
      var s = L * i / NSEG, y, z;
      if (flat) { y = 0; z = s; }
      else {
        var f = s / 0.001, i0 = Math.min(P.length - 2, Math.floor(f)), fr = f - i0;
        y = U.lerp(P[i0][0], P[i0 + 1][0], fr); z = U.lerp(P[i0][1], P[i0 + 1][1], fr);
      }
      var v = 1 - (L - s) / REC_MAX;
      for (var j = 0; j < 2; j++) {
        var k = i * 2 + j;
        pos[k * 3] = (j === 0 ? -1 : 1) * REC_W / 2; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        uv[k * 2] = j; uv[k * 2 + 1] = v;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    S.paperLen = L;
  }
  function paperPoint(s, out) {
    var P = paperPath(), f = Math.min(s, S.paperLen) / 0.001, i0 = Math.min(P.length - 2, Math.floor(f));
    out.set(0, P[i0][0], P[i0][1]);
    return S.paper.localToWorld(out);
  }
  function drawReceipt(list) {
    var c = S.recCtx, w = S.recCv.width, h = S.recCv.height, i;
    c.fillStyle = '#fbfaf6'; c.fillRect(0, 0, w, h);
    U.speckle(c, w, h, { seed: 41, n: 900, size: 0.8, alpha: 0.05, dark: '#9a968c' });
    c.fillStyle = '#d9d8d3'; c.fillRect(24, 22, w - 48, 2); c.fillRect(24, 30, w - 48, 2);
    var top = 46, bottom = h - 118, n = list.length;
    var per = n ? Math.min(150, (bottom - top) / n) : 0;
    var sz = Math.min(per * 0.84, 136);
    for (i = 0; i < n; i++) {
      var cy = top + per * (i + 0.5);
      var img = icon(list[i]);
      if (img) {
        c.globalAlpha = 0.95;
        c.drawImage(img, w / 2 - sz / 2, cy - sz / 2, sz, sz);
        c.globalAlpha = 1;
      }
      if (i < n - 1) { c.fillStyle = '#dcdbd6'; c.fillRect(30, top + per * (i + 1) - 1, w - 60, 2); }
    }
    c.fillStyle = '#d9d8d3'; c.fillRect(24, bottom + 6, w - 48, 2);
    var r = U.rng(77), x = 40;
    c.fillStyle = '#3b3b3a';
    while (x < w - 44) {
      var bw = 2 + Math.floor(r() * 4);
      c.fillRect(x, bottom + 26, bw, 62);
      x += bw + 2 + Math.floor(r() * 4);
    }
    S.recTex.needsUpdate = true;
  }

  /* ───────── 品物 ───────── */
  function makeRec(kind) {
    var obj = Items.make(kind);
    var ud = obj.userData || {};
    var bob = new T.Group(); bob.add(obj);
    var root = new T.Group(); root.add(bob);
    var h = ud.h || 0.08;
    var rec = {
      kind: kind, obj: obj, bob: bob, root: root,
      w: ud.w || 0.08, h: h, d: ud.d || 0.08, cy: ud.cy != null ? ud.cy : h / 2,
      tall: !!(Items.info[kind] && Items.info[kind].tall),
      state: 'basket', scanned: false, beeps: 0, inZone: false,
      home: new V3(), homeQ: new T.Quaternion(), holdQ: new T.Quaternion(), yaw: 0, tx: 0, tz: 0
    };
    root.userData = { r: Math.max(ud.r || 0.06, 0.06), cy: rec.cy, rec: true };
    return rec;
  }
  function recOf(root) { for (var i = 0; i < recs.length; i++) if (recs[i].root === root) return recs[i]; return null; }

  function placeInBasket(rec, i) {
    var ud = S.basket.userData || {};
    var slots = ud.slots && ud.slots.length ? ud.slots : [{ x: -0.15, z: -0.07 }, { x: 0, z: -0.07 }, { x: 0.15, z: -0.07 }, { x: -0.15, z: 0.07 }, { x: 0, z: 0.07 }, { x: 0.15, z: 0.07 }];
    var s = slots[i % slots.length], layer = Math.floor(i / slots.length);
    var r = U.rng(31 + i * 17 + rec.kind.length * 7);
    var wide = rec.w >= 0.15;
    rec.yaw = (wide ? PI / 2 : 0) + (r() - 0.5) * (wide ? 0.35 : 0.9);
    var tilt = rec.tall ? 0.05 : 0.1;
    _e.set((r() - 0.5) * tilt, rec.yaw, (r() - 0.5) * tilt, 'YXZ');
    rec.homeQ.setFromEuler(_e);
    rec.holdQ.setFromEuler(_e.set(0, rec.yaw, 0, 'YXZ'));
    rec.home.set(s.x + (r() - 0.5) * 0.02, (ud.floorY || 0.02) + 0.004 + layer * 0.075, s.z + (r() - 0.5) * 0.02).add(BASKET_POS);
    rec.root.position.copy(rec.home);
    rec.root.quaternion.copy(rec.homeQ);
    S.scene.add(rec.root);
  }
  var BAGSPOT = [[-0.085, 0.012], [0.085, -0.012], [0, 0.0], [-0.04, -0.02], [0.045, 0.02], [-0.11, -0.012], [0.11, 0.015], [0.02, -0.015], [-0.02, 0.02]];
  function bagSlot(i, rec, outP, outQ) {
    var ud = S.bag.userData || {};
    var mouth = ud.mouthY || 0.38, iw = ud.innerW || 0.33;
    var sp = BAGSPOT[i % BAGSPOT.length], r = U.rng(91 + i * 13);
    var top = rec.tall ? mouth + 0.065 : mouth - 0.075 + Math.min(i, 8) * 0.011;
    outP.set(sp[0] * iw / 0.33, Math.max(0.012, top - rec.h), sp[1]);
    var yaw = (rec.w < rec.d ? PI / 2 : 0) + (r() - 0.5) * 0.3;
    outQ.setFromEuler(_e.set((r() - 0.5) * 0.08, yaw, (r() - 0.5) * 0.1, 'YXZ'));
  }

  function recommended() {
    var best = null, bs = -1e9;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.state !== 'basket') continue;
      var s = r.root.position.z + (r.root.position.y + r.h) * 1.5;
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }
  function hop(rec) {
    if (!rec) return;
    tw(0.5, function (k) {
      if (rec.state === 'flying') return;
      rec.bob.position.y = Math.abs(Math.sin(k * PI * 2)) * 0.03 * (1 - k * 0.6);
      if (k >= 1) rec.bob.position.y = 0;
    }, { ease: E('linear') });
  }
  function scanWiggle() {
    hop(recommended());
    fx.boost = 1.6;
  }
  function bagWiggle() { shake(S.bag, 0.025, 0.5); }
  function nextHint() {
    if (phase !== 'scan') return;
    if (held) {
      if (held.scanned) hint({ key: 'bag', target: held.root, to: S.bag, wiggle: bagWiggle });
      return;
    }
    var r = recommended();
    if (r) hint({ key: 'scan', target: r.root, to: S.glass, wiggle: scanWiggle });
    else hint(null);
  }

  /* 持っている品物の底の高さ: ガラスに近づくと下がり、バッグの上では口より上へ */
  function holdBottom(x, z) {
    var dx = Math.max(Math.abs(x - GLASS.x) - GLASS.half, 0), dz = Math.max(Math.abs(z - GLASS.z) - GLASS.half, 0);
    var fG = 1 - U.smooth((Math.sqrt(dx * dx + dz * dz) - 0.03) / 0.15);
    var bx = Math.max(Math.abs(x - BAG_POS.x) - 0.2, 0), bz = Math.max(Math.abs(z - BAG_POS.z) - 0.1, 0);
    var fB = 1 - U.smooth(Math.sqrt(bx * bx + bz * bz) / 0.1);
    return U.lerp(U.lerp(HOLD_B, SCAN_B, fG), BAG_B, fB);
  }
  function setLastP(p) {
    if (!p) { lastP = null; return; }
    if (!lastP) lastP = { x: 0, y: 0, ndc: new T.Vector2() };
    lastP.x = p.x; lastP.y = p.y;
    if (p.ndc) lastP.ndc.copy(p.ndc);
    else lastP.ndc.set(p.x / G.view.w * 2 - 1, -(p.y / G.view.h) * 2 + 1);
  }
  function followTarget(rec) {
    if (!lastP) return;
    _plane.constant = -HOLD_PLANE;
    var hit = G.onPlane(lastP, _plane, _v);
    if (hit) {
      rec.tx = U.clamp(hit.x, -0.7, 0.7);
      rec.tz = U.clamp(hit.z, -0.65, 0.6);
    }
  }
  function updHeld(dt) {
    var rec = held;
    if (!rec) return;
    followTarget(rec);
    var p = rec.root.position;
    p.x = U.damp(p.x, rec.tx, 22, dt);
    p.z = U.damp(p.z, rec.tz, 22, dt);
    p.y = U.damp(p.y, holdBottom(p.x, p.z), 18, dt);
    rec.root.quaternion.slerp(rec.holdQ, 1 - Math.exp(-10 * dt));
    var inside = Math.abs(p.x - GLASS.x) <= ZONE && Math.abs(p.z - GLASS.z) <= ZONE;
    if (inside && !rec.inZone) doScan(rec, SCALE[rec.beeps % SCALE.length]);
    rec.inZone = inside;
  }

  function grab(rec, p) {
    held = rec;
    rec.state = 'held';
    rec.inZone = false;
    rec.root.position.copy(rec.home);
    setLastP(p);
    followTarget(rec);
    snd('lift');
    // 触れた瞬間に「ふわっ」と持ち上がる
    var p0 = rec.root.position;
    p0.y += 0.025;
    tw(0.18, function (k) { var s = 1 + 0.06 * Math.sin(k * PI); rec.bob.scale.set(s, s, s); }, { ease: E('linear') });
  }

  /* ───────── ぴっ！ ───────── */
  function scanFx(x, z, h, wd) {
    fx.flash = 1;
    fx.red = 0.15;
    fx.beam = { t: 0, dur: 0.24, x: x, z: z, h: Math.max(0.06, h), w: Math.max(0.12, Math.min(0.26, wd)) };
  }
  function doScan(rec, pitch) {
    rec.beeps++;
    snd('beep', { pitch: pitch });
    var p = rec.root.position;
    scanFx(p.x, p.z, p.y + rec.h + 0.02, Math.max(rec.w, rec.d) + 0.05);
    // 品物が小さく弾む
    tw(0.3, function (k) {
      var s = Math.sin(k * PI);
      rec.bob.position.y = s * 0.024;
      var q = Math.sin(k * PI * 2) * (1 - k) * 0.07;
      rec.bob.scale.set(1 + q, 1 - q, 1 + q);
      if (k >= 1) { rec.bob.position.y = 0; rec.bob.scale.set(1, 1, 1); }
    }, { ease: E('linear') });
    scrShow(icon(rec.kind));
    fx.lamp = 1;
    var first = !rec.scanned;
    rec.scanned = true;
    if (first && held === rec) nextHint();
  }
  function fingerScan(pt) {
    snd('beepFinger');
    scanFx(U.clamp(pt.x, -0.07, 0.07), U.clamp(pt.z, GLASS.z - 0.07, GLASS.z + 0.07), 0.12, 0.16);
    scrShow(getHandIcon());
    fx.lamp = 1;
  }

  /* ───────── 動き ───────── */
  function back(rec, quick) {
    rec.state = 'flying';
    var from = rec.root.position.clone(), fq = rec.root.quaternion.clone();
    if (!quick) snd('back');
    tw(quick ? 0.26 : 0.42, function (k) {
      rec.root.position.lerpVectors(from, rec.home, k);
      rec.root.position.y += Math.sin(k * PI) * 0.03;
      rec.root.quaternion.slerpQuaternions(fq, rec.homeQ, k);
    }, {
      ease: E('out'), done: function () {
        rec.root.position.copy(rec.home); rec.root.quaternion.copy(rec.homeQ);
        rec.state = 'basket';
        if (!quick) snd('drop', { vol: 0.5 });
        nextHint();
      }
    });
  }
  function tapBack(rec) {
    var inf = Items.info[rec.kind] || {};
    snd(inf.sound || 'tok');
    shake(rec.obj, 0.04, 0.4);
    back(rec, true);
  }
  function autoScan(rec) {
    rec.state = 'auto';
    var from = rec.root.position.clone(), fq = rec.root.quaternion.clone();
    var to = new V3(GLASS.x, SCAN_B, GLASS.z);
    tw(0.38, function (k) {
      rec.root.position.lerpVectors(from, to, k);
      rec.root.quaternion.slerpQuaternions(fq, rec.holdQ, k);
    }, {
      ease: E('inOut'), done: function () {
        doScan(rec, 0);
        later(0.4, function () { flyToBag(rec); });
      }
    });
    nextHint();
  }
  function flyToBag(rec) {
    if (rec.state === 'bag') return;
    rec.state = 'flying';
    rec.inZone = false;
    var lp = new V3(), lq = new T.Quaternion();
    bagSlot(bagCount++, rec, lp, lq);
    S.bagRoot.updateMatrixWorld(true);
    var end = S.contents.localToWorld(lp.clone());
    var from = rec.root.position.clone(), fq = rec.root.quaternion.clone();
    var mouth = (S.bag.userData.mouthY || 0.38);
    var ctrl = new V3(U.lerp(from.x, end.x, 0.75), Math.max(from.y, mouth) + rec.h + 0.1, U.lerp(from.z, end.z, 0.75));
    var a = new V3(), b = new V3();
    tw(0.55, function (k) {
      a.lerpVectors(from, ctrl, k); b.lerpVectors(ctrl, end, k);
      rec.root.position.lerpVectors(a, b, k);
      rec.root.quaternion.slerpQuaternions(fq, lq, k);
    }, {
      ease: E('inOut'), done: function () {
        S.contents.add(rec.root);
        rec.root.position.copy(lp); rec.root.quaternion.copy(lq);
        rec.state = 'bag';
        landed(rec);
      }
    });
  }
  function bagBulge(n) {
    var m = Math.min(n, 9);
    return { x: 1 + 0.012 * m, z: 1 + 0.035 * m };
  }
  function landed(rec) {
    snd('bagRustle');
    var n = 0, i;
    for (i = 0; i < recs.length; i++) if (recs[i].state === 'bag') n++;
    var b0 = bagBulge(n - 1), b1 = bagBulge(n);
    tw(0.6, function (k) {
      var w = Math.sin(k * PI * 3) * (1 - k) * 0.05;
      S.bag.scale.set(U.lerp(b0.x, b1.x, k) * (1 + w), 1 - w * 0.4, U.lerp(b0.z, b1.z, k) * (1 + w));
    }, { ease: E('linear') });
    shake(S.bag, 0.02, 0.45);
    rec.root.getWorldPosition(_v);
    _v.y += rec.h;
    puff(_v, { n: 6, color: 0xfff6dc, size: 0.025, up: 0.12, spread: 0.08, life: 0.7 });
    var st = G.state;
    var bi = st.basket.indexOf(rec.kind);
    if (bi >= 0) st.basket.splice(bi, 1);
    st.scanned.push(rec.kind);
    G.save();
    checkDone();
  }
  function checkDone() {
    if (phase !== 'scan') return;
    for (var i = 0; i < recs.length; i++) if (recs[i].state !== 'bag') { nextHint(); return; }
    phase = 'pay';
    hint(null);
    later(0.6, startPay);
  }

  /* ───────── お会計 ───────── */
  var ARM_OFF = new V3(1.0, 0.17, -0.10), ARM_HOVER = new V3(0, 0, 0), ARM_TAP = new V3(0, 0, 0);
  function startPay() {
    phase = 'pay';
    hint(null);
    drawReceipt(G.state.scanned.slice());
    var A = S.arm;
    A.visible = true;
    A.position.copy(ARM_OFF);
    if (S.hand && S.hand.pose) { try { S.hand.pose('card', 0); } catch (e) {} }
    tw(0.95, function (k) { A.position.lerpVectors(ARM_OFF, ARM_HOVER, k); A.rotation.z = 0.25 * (1 - k); }, {
      ease: E('out'), done: function () {
        tw(0.22, function (k) { A.position.lerpVectors(ARM_HOVER, ARM_TAP, k); }, {
          ease: E('inOut'), done: function () {
            snd('pay');
            fx.pay = 1;
            scrPaid();
            later(0.5, function () {
              tw(0.25, function (k) { A.position.lerpVectors(ARM_TAP, ARM_HOVER, k); }, {
                ease: E('out'), done: function () {
                  tw(0.8, function (k) { A.position.lerpVectors(ARM_HOVER, ARM_OFF, k); A.rotation.z = 0.25 * k; }, {
                    ease: E('inOut'), done: function () { A.visible = false; }
                  });
                  later(0.35, startPrint);
                }
              });
            });
          }
        });
      }
    });
  }
  function startPrint() {
    phase = 'print';
    S.paper.visible = true;
    S.paper.position.copy(SLOT);
    S.paper.rotation.set(0, 0, 0);
    setPaper(0.001, false);
    snd('print');
    tw(1.2, function (k) { setPaper(REC_MAX * k, false); }, {
      ease: E('linear'), done: function () {
        setPaper(REC_MAX, false);
        phase = 'receipt';
        hint({
          key: 'receipt',
          target: function () { return paperPoint(REC_MAX * 0.55, _v2); },
          to: function () { return paperPoint(REC_MAX, new V3()).add(new V3(0, 0, 0.2)); },
          wiggle: function () {
            tw(1.0, function (k) { fx.flutter = Math.sin(k * PI * 5) * (1 - k); }, { ease: E('linear') });
            snd('crinkle', { vol: 0.4 });
          }
        });
      }
    });
  }
  function tear() {
    if (phase !== 'receipt') return;
    phase = 'tear';
    hint(null);
    snd('tear');
    fx.flutter = 0;
    var P = S.paper;
    var from = P.position.clone();
    setPaper(REC_MAX, true);
    P.position.y += 0.004;
    var lp = new V3(0.07, (S.bag.userData.mouthY || 0.38) - 0.15, 0.015);
    S.bagRoot.updateMatrixWorld(true);
    var end = S.contents.localToWorld(lp.clone());
    var ctrl = new V3(U.lerp(from.x, end.x, 0.4), end.y + 0.35, U.lerp(from.z, end.z, 0.5));
    var a = new V3(), b = new V3();
    var r0 = new T.Euler(0, 0, 0), r1 = new T.Euler(-PI / 2 + 0.12, 0.25, 0.05);
    tw(1.05, function (k) {
      a.lerpVectors(from, ctrl, k); b.lerpVectors(ctrl, end, k);
      P.position.lerpVectors(a, b, k);
      var fl = Math.sin(k * PI * 4) * Math.sin(k * PI) * 0.5;
      P.rotation.set(U.lerp(r0.x, r1.x, U.smooth(k * 1.3)), U.lerp(r0.y, r1.y, k) + fl * 0.6, fl);
    }, {
      ease: E('inOut'), done: function () {
        S.contents.add(P);
        P.position.copy(lp);
        P.rotation.copy(r1);
        snd('bagRustle', { vol: 0.6 });
        snd('happy');
        shake(S.bag, 0.02, 0.45);
        _v.set(BAG_POS.x, (S.bag.userData.mouthY || 0.38) + 0.05, BAG_POS.z);
        puff(_v, { n: 10, color: 0xfff1c8, size: 0.03, up: 0.16, spread: 0.12, life: 0.9 });
        var st = G.state;
        st.receipt = st.scanned.slice();
        st.bag = st.scanned.slice();
        st.basket = [];
        G.save();
        later(1.2, leave);
      }
    });
  }
  function leave() {
    phase = 'leave';
    var y0 = S.bagRoot.position.y;
    snd('whoosh');
    tw(0.7, function (k) {
      S.bagRoot.position.y = y0 + 0.1 * k;
      S.bagRoot.rotation.z = 0.035 * Math.sin(k * PI);
      S.bagRoot.rotation.x = -0.03 * k;
    }, { ease: E('out'), done: function () { G.go('home2'); } });
  }

  /* ───────── 当たり ───────── */
  function rayHits(p, obj) {
    if (!obj || !S.camera) return false;
    _ray.setFromCamera(p.ndc || new T.Vector2(p.x / G.view.w * 2 - 1, -(p.y / G.view.h) * 2 + 1), S.camera);
    return _ray.intersectObject(obj, true).length > 0;
  }
  function glassPoint(p) {
    _plane.constant = -0.002;
    var hit = G.onPlane(p, _plane, _v);
    if (!hit) return null;
    var m = 0.025;
    if (Math.abs(hit.x - GLASS.x) <= GLASS.half + m && Math.abs(hit.z - GLASS.z) <= GLASS.half + m) return hit;
    return null;
  }
  function nearReceipt(p) {
    if (!S.paper.visible || !G.screen) return false;
    var best = 1e9;
    for (var i = 0; i <= 8; i++) {
      var q = G.screen(paperPoint(S.paperLen * i / 8, _v2));
      var dx = q.x - p.x, dy = q.y - p.y;
      best = Math.min(best, dx * dx + dy * dy);
    }
    return best < 46 * 46;
  }

  /* ───────── 作る ───────── */
  function build() {
    var sc = (this.scene = new T.Scene());
    S.scene = sc;
    this.camera = S.camera = new T.PerspectiveCamera(35, 1, 0.05, 60);
    sc.background = new T.Color(0xe3e0d9);
    sc.fog = new T.Fog(0xe3e0d9, 3.6, 9);
    sc.environment = G.env;
    sc.environmentIntensity = 0.9;

    sc.add(new T.HemisphereLight(0xfffaf2, 0x8a8478, 0.4));
    var dl = (S.sun = new T.DirectionalLight(0xfff4e6, 2.2));
    dl.position.set(-0.55, 2.4, 1.0);
    dl.target.position.set(0, 0, -0.1);
    dl.castShadow = true;
    var cam = dl.shadow.camera;
    cam.left = -0.9; cam.right = 0.9; cam.top = 0.9; cam.bottom = -0.9; cam.near = 0.5; cam.far = 5;
    dl.shadow.bias = -0.0004;
    dl.shadow.normalBias = 0.015;
    dl.shadow.radius = 2;
    S.shadowSize = G.low ? 512 : 1024;
    dl.shadow.mapSize.set(S.shadowSize, S.shadowSize);
    sc.add(dl); sc.add(dl.target);

    // 読み取りの瞬間の赤い光（常に置いて強さ 0 にしておく＝シェーダの作り直しを避ける）
    S.red = new T.PointLight(0xff2214, 0, 0.9, 2);
    S.red.position.set(GLASS.x, 0.025, GLASS.z);
    sc.add(S.red);

    /* 店の床と壁 */
    var fm = floorMaps();
    var floor = new T.Mesh(new T.PlaneGeometry(12, 12), new T.MeshStandardMaterial({ map: fm.col, roughnessMap: fm.rough, roughness: 0.6, metalness: 0 }));
    floor.rotation.x = -PI / 2; floor.position.set(0, -0.88, -3);
    floor.receiveShadow = true;
    sc.add(floor);
    var wall = new T.Mesh(new T.PlaneGeometry(12, 2.6), new T.MeshStandardMaterial({ map: wallTex(), roughness: 0.85 }));
    wall.position.set(0, -0.88 + 1.3 - 0.0, -2.3);
    wall.material.map.repeat.set(6, 1);
    // 壁の下 14% が幅木になるよう UV を合わせる
    sc.add(wall);

    /* レジ台 */
    var lam = laminateMaps();
    var topMat = new T.MeshStandardMaterial({ map: lam.col, roughnessMap: lam.rough, roughness: 0.5, metalness: 0 });
    var top = new T.Mesh(rbox(1.584, 0.04, 1.284, 3, 0.004), topMat);
    top.position.set(0, -0.02, -0.10);
    top.receiveShadow = true;
    sc.add(top);
    var steel = S.steel = new T.MeshStandardMaterial({ color: 0xd4d7da, metalness: 1, roughness: 0.32, roughnessMap: brushedRough() });
    var bandF = new T.Mesh(rbox(1.6, 0.042, 0.012, 2, 0.003), steel);
    bandF.position.set(0, -0.021, 0.548); sc.add(bandF);
    var bandB = bandF.clone(); bandB.position.z = -0.748; sc.add(bandB);
    var bandL = new T.Mesh(rbox(0.012, 0.042, 1.3, 2, 0.003), steel);
    bandL.position.set(-0.796, -0.021, -0.10); sc.add(bandL);
    var bandR = bandL.clone(); bandR.position.x = 0.796; sc.add(bandR);
    var cab = new T.Mesh(new T.BoxGeometry(1.5, 0.84, 1.2), new T.MeshStandardMaterial({ color: 0xcfcdc8, roughness: 0.6, map: lam.col }));
    cab.position.set(0, -0.042 - 0.42, -0.12);
    cab.receiveShadow = true;
    sc.add(cab);
    var kick = new T.Mesh(new T.BoxGeometry(1.48, 0.1, 0.01), new T.MeshStandardMaterial({ color: 0x5b5f63, roughness: 0.5 }));
    kick.position.set(0, -0.83, 0.48); sc.add(kick);

    /* 読み取り口 */
    var win = new T.Group();
    win.position.set(GLASS.x, 0, GLASS.z);
    sc.add(win);
    var frameShape = rrShape(0.236, 0.236, 0.014);
    var hole = rrShape(0.2, 0.2, 0.004);
    frameShape.holes.push(hole);
    var frameGeo = new T.ExtrudeGeometry(frameShape, { depth: 0.0015, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 8 });
    frameGeo.rotateX(-PI / 2);
    var frame = new T.Mesh(frameGeo, steel);
    frame.position.y = 0.0002;
    frame.receiveShadow = true; frame.castShadow = false;
    win.add(frame);
    var well = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), new T.MeshStandardMaterial({ color: 0x07090b, roughness: 0.55, metalness: 0.2 }));
    well.rotation.x = -PI / 2; well.position.y = 0.0006;
    well.receiveShadow = true;
    win.add(well);
    S.laserTexA = laserTex(1, [[0.55, 0], [-0.55, 0], [0.55, 40], [-0.55, -40], [0, 0], [1.2, 16], [-1.2, -16]]);
    S.laserTexA.center.set(0.5, 0.5);
    S.laserTexB = laserTex(2, [[0.25, -24], [-0.25, 24], [PI / 2, 0], [0.9, 50], [-0.9, -50]]);
    S.laserTexB.center.set(0.5, 0.5);
    function laserMat(tex) {
      return new T.MeshBasicMaterial({ map: tex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.6 });
    }
    S.laserA = new T.Mesh(new T.PlaneGeometry(0.196, 0.196), laserMat(S.laserTexA));
    S.laserA.rotation.x = -PI / 2; S.laserA.position.y = 0.001; S.laserA.renderOrder = 2;
    win.add(S.laserA);
    S.laserB = new T.Mesh(new T.PlaneGeometry(0.196, 0.196), laserMat(S.laserTexB));
    S.laserB.rotation.x = -PI / 2; S.laserB.position.y = 0.0012; S.laserB.renderOrder = 3;
    win.add(S.laserB);
    S.glass = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), new T.MeshPhysicalMaterial({
      color: 0x101418, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.6
    }));
    S.glass.rotation.x = -PI / 2; S.glass.position.y = 0.0018; S.glass.renderOrder = 4;
    S.glass.userData.r = 0.1;
    win.add(S.glass);
    // ガラスの上のにじむ赤い光
    S.haloTex = radialTex([[0, 'rgba(255,60,40,0.9)'], [0.45, 'rgba(255,30,20,0.35)'], [1, 'rgba(255,0,0,0)']]);
    S.halo = new T.Mesh(new T.PlaneGeometry(0.42, 0.42), new T.MeshBasicMaterial({ map: S.haloTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.1 }));
    S.halo.rotation.x = -PI / 2; S.halo.position.y = 0.0025; S.halo.renderOrder = 5;
    S.halo.userData.noPick = true;
    win.add(S.halo);

    /* 赤い光の帯（品物の下から体をなめる） */
    S.beam = new T.Mesh(new T.PlaneGeometry(1, 1).translate(0, 0.5, 0), new T.MeshBasicMaterial({ map: beamTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0, side: T.DoubleSide }));
    S.beam.renderOrder = 6; S.beam.visible = false; S.beam.userData.noPick = true;
    sc.add(S.beam);
    S.beamLine = new T.Mesh(new T.PlaneGeometry(1, 0.012), new T.MeshBasicMaterial({ map: lineTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    S.beamLine.rotation.x = -PI / 2; S.beamLine.renderOrder = 6; S.beamLine.visible = false;
    sc.add(S.beamLine);

    /* レジの柱 */
    var plast = new T.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.5, metalness: 0.05, roughnessMap: lam.rough });
    var dark = new T.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.35, metalness: 0.1 });
    var base = new T.Mesh(rbox(0.16, 0.06, 0.13, 3, 0.01), plast);
    base.position.set(PIL.x, 0.03, -0.15);
    sc.add(base);
    var post = new T.Mesh(rbox(0.05, 0.17, 0.03, 2, 0.008), plast);
    post.position.set(PIL.x, 0.135, -0.198);
    sc.add(post);
    var head = new T.Group();
    head.position.set(PIL.x, 0.228, -0.198);
    head.rotation.set(-0.78, -0.12, 0, 'YXZ');
    sc.add(head);
    head.add(new T.Mesh(rbox(0.205, 0.17, 0.026, 3, 0.011), dark));
    S.scrCv = U.canvas(384, 272);
    S.scrCtx = S.scrCv.getContext('2d');
    S.scrTex = new T.CanvasTexture(S.scrCv);
    S.scrTex.colorSpace = T.SRGBColorSpace;
    S.scrTex.anisotropy = 4;
    var screen = new T.Mesh(new T.PlaneGeometry(0.17, 0.12), new T.MeshBasicMaterial({ map: S.scrTex, toneMapped: false }));
    screen.position.set(0, 0.012, 0.0132);
    head.add(screen);
    // 画面の表面の映り込み
    var scrGlass = new T.Mesh(new T.PlaneGeometry(0.17, 0.12), new T.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.2 }));
    scrGlass.position.set(0, 0.012, 0.0136);
    head.add(scrGlass);
    // 緑のランプ
    S.lampMat = new T.MeshStandardMaterial({ color: 0x1d4a2c, roughness: 0.3, emissive: 0x2bff74, emissiveIntensity: 0.12 });
    var lamp = new T.Mesh(new T.CylinderGeometry(0.0055, 0.0055, 0.003, 24), S.lampMat);
    lamp.rotation.x = PI / 2; lamp.position.set(0.072, -0.068, 0.0135);
    head.add(lamp);
    S.lampGlow = new T.Sprite(new T.SpriteMaterial({ map: radialTex([[0, 'rgba(160,255,190,1)'], [0.3, 'rgba(60,255,120,0.5)'], [1, 'rgba(0,255,80,0)']]), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    S.lampGlow.scale.set(0.05, 0.05, 1); S.lampGlow.position.set(0.072, -0.068, 0.02);
    S.lampGlow.userData.noPick = true;
    head.add(S.lampGlow);
    // カード読み取りパッド
    var pt = padTex();
    S.padMat = new T.MeshStandardMaterial({ map: pt, roughness: 0.4, emissive: 0x3cff8a, emissiveMap: pt, emissiveIntensity: 0 });
    var pad = new T.Mesh(new T.PlaneGeometry(0.078, 0.063), S.padMat);
    pad.rotation.x = -PI / 2; pad.position.copy(PAD);
    pad.receiveShadow = true;
    sc.add(pad);
    S.padGlow = new T.Mesh(new T.PlaneGeometry(0.14, 0.12), new T.MeshBasicMaterial({ map: radialTex([[0, 'rgba(120,255,170,0.8)'], [1, 'rgba(0,255,100,0)']]), transparent: true, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    S.padGlow.rotation.x = -PI / 2; S.padGlow.position.copy(PAD); S.padGlow.position.y += 0.002;
    sc.add(S.padGlow);
    // レシートの出口（細い溝）
    var slot = new T.Mesh(rbox(0.086, 0.007, 0.006, 2, 0.002), new T.MeshStandardMaterial({ color: 0x050607, roughness: 0.8 }));
    slot.position.set(SLOT.x, SLOT.y, -0.0855);
    sc.add(slot);
    var lip = new T.Mesh(rbox(0.096, 0.005, 0.012, 2, 0.002), dark);
    lip.position.set(SLOT.x, SLOT.y + 0.0065, -0.083);
    sc.add(lip);
    U.shadow(base); U.shadow(post); U.shadow(head, true, false); U.shadow(lip);
    screen.castShadow = false; scrGlass.castShadow = false;

    /* かご */
    S.basket = (window.Props && Props.basket) ? safe(Props.basket) : null;
    if (!S.basket) S.basket = fallbackBasket();
    S.basket.position.copy(BASKET_POS);
    sc.add(S.basket);

    /* エコバッグ */
    S.bagRoot = new T.Group();
    S.bagRoot.position.copy(BAG_POS);
    sc.add(S.bagRoot);
    S.bag = (window.Props && Props.bag) ? safe(Props.bag) : null;
    if (!S.bag) S.bag = fallbackBag();
    S.bagRoot.add(S.bag);
    S.contents = new T.Group();
    S.bagRoot.add(S.contents);

    /* レシート */
    S.recCv = U.canvas(256, 760);
    S.recCtx = S.recCv.getContext('2d');
    S.recTex = new T.CanvasTexture(S.recCv);
    S.recTex.colorSpace = T.SRGBColorSpace;
    S.recTex.anisotropy = 4;
    S.paperGeo = makePaperGeo();
    S.paper = new T.Mesh(S.paperGeo, new T.MeshStandardMaterial({ map: S.recTex, roughness: 0.85, side: T.DoubleSide }));
    S.paper.castShadow = true; S.paper.receiveShadow = true;
    S.paper.visible = false;
    S.paperLen = 0.001;
    setPaper(0.001, false);
    sc.add(S.paper);

    /* ママの腕とカード */
    S.arm = new T.Group();
    S.arm.visible = false;
    sc.add(S.arm);
    var wrist = new T.Group();
    wrist.rotation.set(-PI / 2 + 0.25, PI / 2, 0, 'YXZ');   // 指は -X（左）へ、手の甲は上（少し手前）
    S.arm.add(wrist);
    var cardGeo = new T.ExtrudeGeometry(rrShape(0.054, 0.086, 0.0035), { depth: 0.0008, bevelEnabled: false, curveSegments: 6 });
    cardGeo.translate(0, 0, -0.0004);
    var card = new T.Mesh(cardGeo, new T.MeshPhysicalMaterial({ color: 0x9fcfea, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    card.castShadow = true;
    S.hand = null;
    if (window.Hand && typeof Hand.create === 'function') {
      try { S.hand = Hand.create({ sleeve: true, side: 'R' }); } catch (e) { S.hand = null; }
    }
    if (S.hand && S.hand.group) {
      wrist.add(S.hand.group);
      try { S.hand.pose('card', 0); } catch (e2) {}
      var holdObj = S.hand.hold || null;
      if (holdObj) {
        holdObj.add(card);
        card.position.set(0, 0.03, 0);   // 指のあいだから先へ出る
      } else {
        wrist.add(card);
        card.position.set(0, 0.10, -0.016);
      }
    } else {
      S.hand = null;
      wrist.add(card);
      card.position.set(0, 0.10, -0.016);
    }
    S.card = card;
    S.wrist = wrist;
    // 腕の位置: カードの中心がパッドの真上に来るよう、手首の位置を逆算する
    S.arm.position.set(0, 0, 0); S.arm.rotation.set(0, 0, 0);
    S.arm.updateMatrixWorld(true);
    var cw = card.getWorldPosition(new V3());
    ARM_HOVER.set(PAD.x - cw.x, PAD.y + 0.05 - cw.y, PAD.z - cw.z);
    ARM_TAP.set(PAD.x - cw.x, PAD.y + 0.012 - cw.y, PAD.z - cw.z);
    ARM_OFF.set(ARM_HOVER.x + 0.75, ARM_HOVER.y + 0.06, ARM_HOVER.z + 0.02);
  }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  function fallbackBasket() {
    var g = new T.Group(), m = new T.MeshStandardMaterial({ color: 0x8a9097, roughness: 0.5, side: T.DoubleSide });
    var f = new T.Mesh(new T.BoxGeometry(0.46, 0.02, 0.32), m); f.position.y = 0.01; g.add(f);
    [[0, 0.12, 0.17, 0.48, 0.24, 0.01], [0, 0.12, -0.17, 0.48, 0.24, 0.01], [0.24, 0.12, 0, 0.01, 0.24, 0.34], [-0.24, 0.12, 0, 0.01, 0.24, 0.34]].forEach(function (b) {
      var w = new T.Mesh(new T.BoxGeometry(b[3], b[4], b[5]), m); w.position.set(b[0], b[1], b[2]); g.add(w);
    });
    g.userData = { floorY: 0.02, rimY: 0.24, slots: [{ x: -0.15, z: -0.07 }, { x: 0, z: -0.07 }, { x: 0.15, z: -0.07 }, { x: -0.15, z: 0.07 }, { x: 0, z: 0.07 }, { x: 0.15, z: 0.07 }] };
    U.shadow(g);
    return g;
  }
  function fallbackBag() {
    var g = new T.Group(), m = new T.MeshStandardMaterial({ color: 0xe8dfcc, roughness: 0.9, side: T.DoubleSide });
    [[0, 0.19, 0.08, 0.36, 0.38, 0.004], [0, 0.19, -0.08, 0.36, 0.38, 0.004], [0.18, 0.19, 0, 0.004, 0.38, 0.16], [-0.18, 0.19, 0, 0.004, 0.38, 0.16], [0, 0.002, 0, 0.36, 0.004, 0.16]].forEach(function (b) {
      var w = new T.Mesh(new T.BoxGeometry(b[3], b[4], b[5]), m); w.position.set(b[0], b[1], b[2]); g.add(w);
    });
    g.userData = { mouthY: 0.38, innerW: 0.336, innerD: 0.13 };
    U.shadow(g);
    return g;
  }

  /* ───────── 入る ───────── */
  function clearItems() {
    for (var i = 0; i < recs.length; i++) { var r = recs[i].root; if (r.parent) r.parent.remove(r); }
    recs.length = 0;
    while (S.contents.children.length) S.contents.remove(S.contents.children[0]);
  }
  function enter() {
    stopAll();
    hint(null);
    held = null; lastP = null; receiptDown = false;
    clearItems();
    bagCount = 0;
    phase = 'scan';
    fx.flash = fx.boost = fx.red = fx.lamp = fx.pay = fx.flutter = 0; fx.beam = null;
    S.beam.visible = false; S.beamLine.visible = false;
    scr.mode = 'idle'; scr.dirty = true; scr.img = null;
    S.bagRoot.position.copy(BAG_POS); S.bagRoot.rotation.set(0, 0, 0);
    S.bag.rotation.set(0, 0, 0); S.bag.position.set(0, 0, 0);
    S.paper.visible = false;
    if (S.paper.parent !== S.scene) S.scene.add(S.paper);
    S.paper.position.copy(SLOT); S.paper.rotation.set(0, 0, 0);
    setPaper(0.001, false);
    S.arm.visible = false;
    var ss = G.low ? 512 : 1024;
    if (ss !== S.shadowSize) {
      S.shadowSize = ss;
      S.sun.shadow.mapSize.set(ss, ss);
      if (S.sun.shadow.map) { S.sun.shadow.map.dispose(); S.sun.shadow.map = null; }
    }

    if (window.Sound && typeof Sound.ambience === 'function') { try { Sound.ambience('store'); } catch (e) {} }

    var st = G.state;
    function has(k) { return typeof k === 'string' && Items.has(k); }
    st.basket = (Array.isArray(st.basket) ? st.basket : []).filter(has);
    st.scanned = (Array.isArray(st.scanned) ? st.scanned : []).filter(has);
    if (!st.basket.length && !st.scanned.length) {
      st.basket = DEFAULT.filter(has);
    }
    G.save();

    var i, r;
    for (i = 0; i < st.basket.length; i++) {
      r = makeRec(st.basket[i]);
      recs.push(r);
      placeInBasket(r, i);
    }
    var lp = new V3(), lq = new T.Quaternion();
    for (i = 0; i < st.scanned.length; i++) {
      r = makeRec(st.scanned[i]);
      r.state = 'bag'; r.scanned = true;
      recs.push(r);
      bagSlot(bagCount++, r, lp, lq);
      r.root.position.copy(lp); r.root.quaternion.copy(lq);
      S.contents.add(r.root);
    }
    var b = bagBulge(st.scanned.length);
    S.bag.scale.set(b.x, 1, b.z);

    if (!st.basket.length) {
      phase = 'pay';
      later(0.7, startPay);
    } else nextHint();
  }

  function exit() {
    stopAll();
    held = null; lastP = null; receiptDown = false;
  }

  function layout() {
    if (!S.camera) return;
    G.fit(S.camera, { center: new V3(0.02, 0.12, -0.05), w: 0.66, h: 1.05, pitch: 0.9 });
  }

  /* ───────── 毎フレーム ───────── */
  function update(dt) {
    fx.t += dt;
    var t = fx.t;
    updHeld(dt);

    // レーザーの模様: ゆっくり回って明滅。ぴっの瞬間は強く光る
    S.laserTexA.rotation += dt * 0.22;
    S.laserTexB.rotation -= dt * 0.13;
    var blink = fx.boost > 0 ? fx.boost * (0.5 + 0.5 * Math.sin(t * 22)) * 0.6 : 0;
    var base = 0.55 + 0.12 * Math.sin(t * 2.3) + 0.06 * Math.sin(t * 7.1);
    S.laserA.material.opacity = Math.min(1, base + fx.flash * 0.6 + blink);
    S.laserB.material.opacity = Math.min(1, base * 0.75 + fx.flash * 0.6 + blink);
    S.halo.material.opacity = 0.1 + 0.03 * Math.sin(t * 2.3) + fx.flash * 0.85 + blink * 0.5;
    fx.flash = Math.max(0, fx.flash - dt * 3.2);
    fx.boost = Math.max(0, fx.boost - dt * 0.9);

    // 赤い PointLight（0.15 秒）
    if (fx.red > 0) { fx.red = Math.max(0, fx.red - dt); S.red.intensity = 0.05 * (fx.red / 0.15); }
    else S.red.intensity = 0;

    // 赤い光の帯
    var bm = fx.beam;
    if (bm) {
      bm.t += dt;
      var k = Math.min(1, bm.t / bm.dur);
      var z = bm.z + 0.09 - 0.18 * k;
      var a = Math.sin(k * PI);
      S.beam.visible = true; S.beamLine.visible = true;
      S.beam.position.set(bm.x, 0.002, z);
      S.beam.scale.set(bm.w, bm.h, 1);
      S.beam.material.opacity = 0.75 * a;
      S.beamLine.position.set(GLASS.x, 0.0028, U.clamp(z, GLASS.z - 0.1, GLASS.z + 0.1));
      S.beamLine.scale.set(0.2, 1, 1);
      S.beamLine.material.opacity = a;
      if (k >= 1) { fx.beam = null; S.beam.visible = false; S.beamLine.visible = false; }
    }

    // 緑のランプとパッド
    fx.lamp = Math.max(0, fx.lamp - dt * 1.4);
    S.lampMat.emissiveIntensity = 0.12 + 3 * fx.lamp;
    S.lampGlow.material.opacity = Math.min(1, fx.lamp * 1.2);
    if (fx.pay > 0) fx.pay = Math.max(0, fx.pay - dt * 0.45);
    S.padMat.emissiveIntensity = 1.3 * fx.pay;
    S.padGlow.material.opacity = 0.9 * fx.pay;
    if (fx.pay > 0) fx.lamp = Math.max(fx.lamp, fx.pay * 0.8);

    updScreen(dt);

    if (S.hand && S.arm.visible && typeof S.hand.update === 'function') { try { S.hand.update(dt); } catch (e) {} }

    // レシートのひらひら
    if (S.paper.visible && (phase === 'receipt' || phase === 'print')) {
      var fl = fx.flutter + 0.08 * Math.sin(t * 1.7) * (phase === 'receipt' ? 1 : 0);
      S.paper.rotation.set(-0.02 * Math.abs(fl), 0, 0.06 * fl);
    }
  }

  /* ───────── 指 ───────── */
  function down(p) {
    if (held) release(held, { cancel: true, dist: 99, t: 1 });
    if (phase === 'leave' || phase === 'tear') return;
    if (phase === 'receipt' && nearReceipt(p)) { receiptDown = true; return; }
    var gp = glassPoint(p);
    if (gp) { fingerScan(gp); return; }
    if (phase === 'scan') {
      var list = [];
      for (var i = 0; i < recs.length; i++) if (recs[i].state === 'basket') list.push(recs[i].root);
      var hit = list.length ? G.pick(p, list, 24) : null;
      var rec = hit ? recOf(hit) : null;
      if (rec) { grab(rec, p); return; }
    }
    if (rayHits(p, S.bag)) { shake(S.bag, 0.03, 0.5); snd('bagRustle'); return; }
    if (rayHits(p, S.basket)) { shake(S.basket, 0.012, 0.35); snd('tap', { vol: 0.6 }); }
  }
  function move(p) {
    if (receiptDown) {
      if (p.dist >= 24) { receiptDown = false; tear(); }
      return;
    }
    if (held) setLastP(p);
  }
  function up(p) {
    if (receiptDown) {
      receiptDown = false;
      if (!p.cancel) tear();
      return;
    }
    if (held) release(held, p);
  }
  function release(rec, p) {
    held = null;
    setLastP(null);
    if (rec.state !== 'held') return;
    if (rec.scanned) { flyToBag(rec); nextHint(); return; }
    if (!p.cancel && p.dist < 12 && p.t < 0.45) { tapBack(rec); return; }
    if (!p.cancel && rec.root.position.z < BASKET_POS.z - 0.2) { autoScan(rec); return; }
    back(rec, false);
  }

  G.addScene('register', {
    build: build,
    enter: enter,
    exit: exit,
    layout: layout,
    update: update,
    down: down,
    move: move,
    up: up
  });
})();
