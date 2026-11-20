/* 30-shelf.js — 場面 shelf: スーパーの冷蔵ケースから品物を運んで、カートの上のかごへ6こ入れる。 */
(function () {
  'use strict';
  var T = window.THREE;
  var G = window.G;
  if (!T || !G || !G.addScene) return;

  var V3 = T.Vector3;
  var PI = Math.PI;
  var MAXN = 6;
  var SHELF_Y = [0.82, 1.12, 1.42, 1.72];
  var COL_X = [-0.22, 0, 0.22];
  var LAYOUT = [ // 下の段から
    ['carrot', 'cabbage', 'watermelon'],
    ['strawberry', 'tomato', 'apple'],
    ['pudding', 'egg', 'cheese'],
    ['milk', 'juice', 'yogurt']
  ];
  var RECOMMEND = ['apple', 'milk', 'egg', 'pudding', 'tomato', 'carrot', 'strawberry', 'juice', 'cabbage', 'yogurt', 'cheese', 'watermelon'];
  var TRAY = { tomato: 'tray', apple: 'tray', cabbage: 'mat' };
  var CART_Z = 0.6;
  var BASKET_Y = 0.46;
  var HOLD_Z = 0.15;

  /* ───────── 安全な呼び出し ───────── */
  function snd(name, o) {
    if (window.Sound && window.Sound.play) { try { window.Sound.play(name, o); } catch (e) { /* 無視 */ } }
  }
  function sndLoop(name, on, o) {
    if (window.Sound && window.Sound.loop) { try { window.Sound.loop(name, on, o); } catch (e) { /* 無視 */ } }
  }
  function hint(h) { if (G.hint) { try { G.hint(h); } catch (e) { if (window.console) console.error(e); } } }
  function info(k) { return (window.Items && Items.info[k]) || {}; }
  function itemSound(k) { return info(k).sound || 'tok'; }
  function heavy(k) { var h = info(k).heavy; return h == null ? 0.5 : h; }
  function easeOut(k) { return 1 - (1 - k) * (1 - k) * (1 - k); }
  function easeInOut(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function tween(dur, fn, o) {
    if (G.tween) return G.tween(dur, fn, o);
    fn(1); if (o && o.done) o.done(); return { stop: function () {} };
  }
  function after(sec, fn) {
    if (G.after) return G.after(sec, fn);
    fn(); return { stop: function () {} };
  }
  function stopTw(h) { if (h && h.stop) { try { h.stop(); } catch (e) { /* 無視 */ } } }
  function shake(obj, amp, dur) { if (G.shake && obj) { try { G.shake(obj, amp, dur); } catch (e) { /* 無視 */ } } }

  /* ───────── 素材（キャンバス） ───────── */
  function noiseTex(base, opts) {
    opts = opts || {};
    return U.tex(opts.size || 256, opts.size || 256, function (c, w, h) {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { n: opts.n || 900, size: opts.dot || 1.2, alpha: opts.alpha || 0.05, seed: opts.seed || 5 });
    }, { repeat: opts.repeat || [1, 1], data: !!opts.data });
  }

  function texFloor() {
    var tiles = ['#ddd7cc', '#d6d1c7', '#dbd6ce', '#d3cec5'];
    return U.tex(512, 512, function (c, w, h) {
      var r = U.rng(41);
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        c.fillStyle = tiles[i * 2 + j]; c.fillRect(i * 256, j * 256, 256, 256);
        var g = c.createLinearGradient(i * 256, j * 256, i * 256 + 256, j * 256 + 256);
        g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.04)');
        c.fillStyle = g; c.fillRect(i * 256, j * 256, 256, 256);
      }
      U.speckle(c, w, h, { n: 5000, size: 1.1, alpha: 0.16, seed: 9, dark: '#6b6258', light: '#ffffff', lightRatio: 0.35 });
      U.speckle(c, w, h, { n: 700, size: 2.0, alpha: 0.08, seed: 13, dark: '#8a7f70' });
      for (var k = 0; k < 40; k++) { // うすい汚れ
        c.globalAlpha = 0.025; c.fillStyle = '#7a7060';
        c.beginPath(); c.arc(r() * w, r() * h, 10 + r() * 40, 0, 6.283); c.fill();
      }
      c.globalAlpha = 1;
      c.fillStyle = '#b9b2a6';
      c.fillRect(0, 0, w, 2); c.fillRect(0, 255, w, 2); c.fillRect(0, 0, 2, h); c.fillRect(255, 0, 2, h);
    }, { repeat: [7 / 0.9, 5 / 0.9] });
  }
  function texFloorRough() {
    return U.tex(256, 256, function (c, w, h) {
      c.fillStyle = '#5a5a5a'; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { n: 2500, size: 1.2, alpha: 0.25, seed: 4, light: '#9a9a9a', dark: '#303030' });
      c.fillStyle = '#c8c8c8';
      c.fillRect(0, 0, w, 2); c.fillRect(0, 127, w, 2); c.fillRect(0, 0, 2, h); c.fillRect(127, 0, 2, h);
    }, { repeat: [7 / 0.9, 5 / 0.9], data: true });
  }
  function texWood() {
    return U.tex(512, 256, function (c, w, h) {
      var r = U.rng(77);
      var pw = 64;
      for (var x = 0; x < w; x += pw) {
        var tone = 0.9 + r() * 0.15;
        c.fillStyle = 'rgb(' + Math.round(196 * tone) + ',' + Math.round(160 * tone) + ',' + Math.round(118 * tone) + ')';
        c.fillRect(x, 0, pw, h);
        for (var i = 0; i < 26; i++) {
          var gx = x + r() * pw;
          c.strokeStyle = r() < 0.5 ? 'rgba(110,72,40,0.18)' : 'rgba(240,215,180,0.15)';
          c.lineWidth = 0.6 + r() * 1.6;
          c.beginPath(); c.moveTo(gx, 0);
          for (var y = 0; y <= h; y += 16) c.lineTo(gx + Math.sin(y * 0.03 + i) * 2.5 * r(), y);
          c.stroke();
        }
        c.fillStyle = 'rgba(70,45,25,0.35)'; c.fillRect(x, 0, 1.5, h);
      }
      U.speckle(c, w, h, { n: 800, size: 1, alpha: 0.06, seed: 3 });
    }, { repeat: [7 / 0.9, 1] });
  }
  function texWall() {
    return U.tex(256, 256, function (c, w, h) {
      c.fillStyle = '#eee9df'; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { n: 1800, size: 1, alpha: 0.05, seed: 21, dark: '#8c8070' });
    }, { repeat: [6, 3] });
  }
  function texBack() { // 冷蔵ケースの奥の壁: 上から下へやわらかく明るい
    return U.tex(64, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f6f8f8'); g.addColorStop(0.5, '#e4e9eb'); g.addColorStop(1, '#c9d1d5');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(120,130,135,0.10)';
      for (var y = 6; y < h; y += 10) for (var x = 4; x < w; x += 10) { c.beginPath(); c.arc(x + (y % 20 ? 5 : 0), y, 1.1, 0, 6.283); c.fill(); }
    });
  }
  function texHeader() {
    return U.tex(512, 128, function (c, w, h) {
      c.fillStyle = '#f7f8f6'; c.fillRect(0, 0, w, h);
      var g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#3f86b8'); g.addColorStop(0.5, '#5aa3c9'); g.addColorStop(1, '#3f86b8');
      c.fillStyle = g; c.fillRect(0, h * 0.30, w, h * 0.40);
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(0, h * 0.30, w, 2);
      c.fillStyle = '#9fc8dc'; c.fillRect(0, h * 0.78, w, 3);
      // 字のかわりに、牛乳・野菜の小さな絵の帯（円と葉）
      for (var i = 0; i < 9; i++) {
        var cx = 30 + i * 57, cy = h * 0.5;
        c.fillStyle = i % 2 ? 'rgba(255,255,255,0.85)' : 'rgba(250,236,190,0.9)';
        c.beginPath(); c.arc(cx, cy, 9, 0, 6.283); c.fill();
        c.fillStyle = 'rgba(120,190,110,0.9)';
        c.beginPath(); c.ellipse(cx + 9, cy - 9, 6, 3, -0.6, 0, 6.283); c.fill();
      }
      U.speckle(c, w, h, { n: 300, size: 1, alpha: 0.04 });
    });
  }
  function texRails() { // 4段分の値札レールを1枚に（字のない色札）
    var cols = [['#f2c94c', '#e8665a', '#7cc07a'], ['#e8665a', '#f2c94c', '#e8665a'], ['#f2c94c', '#7fb3e0', '#f2c94c'], ['#7fb3e0', '#f2a24c', '#7fb3e0']];
    return U.tex(1024, 256, function (c, w, h) {
      var rh = h / 4;
      for (var r = 0; r < 4; r++) {
        var y0 = (3 - r) * rh; // canvas は上から。v=0 が下
        var g = c.createLinearGradient(0, y0, 0, y0 + rh);
        g.addColorStop(0, '#fbfcfc'); g.addColorStop(0.15, '#e9eef0'); g.addColorStop(0.85, '#dfe5e8'); g.addColorStop(1, '#c9d0d4');
        c.fillStyle = g; c.fillRect(0, y0, w, rh);
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(0, y0 + 2, w, 2);
        for (var i = 0; i < 3; i++) {
          var cx = ((COL_X[i] + 0.35) / 0.70) * w;
          var tw = 120, th = rh * 0.62, tx = cx - tw / 2, ty = y0 + rh * 0.2;
          c.fillStyle = cols[r][i]; c.fillRect(tx, ty, tw, th);
          c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(tx + 6, ty + 5, tw * 0.45, th - 10);
          c.fillStyle = 'rgba(40,40,40,0.75)'; // しま模様（バーコード風）
          for (var b = 0; b < 12; b++) c.fillRect(tx + tw * 0.6 + b * 3.2, ty + 6, (b % 3) ? 1.2 : 2.2, th - 12);
          c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(tx, ty + th - 2, tw, 2);
        }
        c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, y0 + rh - 2, w, 2);
      }
    });
  }
  function texBase() { // 腰板: 白い板に通気口の溝
    return U.tex(256, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4f5f3'); g.addColorStop(1, '#e3e5e2');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      function slots(y0, n) {
        for (var r = 0; r < n; r++) {
          for (var i = 0; i < 6; i++) {
            var x = 14 + i * 39, y = y0 + r * 9;
            c.fillStyle = '#3d4246'; c.fillRect(x, y, 32, 3.5);
            c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillRect(x, y + 3.5, 32, 1);
          }
        }
      }
      slots(18, 3);
      slots(h - 46, 3);
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(0, h * 0.5, w, 1.5);
      U.speckle(c, w, h, { n: 400, size: 1, alpha: 0.04 });
    });
  }
  function texGrass() {
    return U.tex(128, 256, function (c, w, h) {
      c.fillStyle = '#3f7d3a'; c.fillRect(0, 0, w, h);
      var r = U.rng(8);
      for (var i = 0; i < 1400; i++) {
        var x = r() * w, y = r() * h;
        c.strokeStyle = r() < 0.5 ? 'rgba(110,170,90,0.55)' : 'rgba(30,80,30,0.5)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 4); c.stroke();
      }
    });
  }

  /* ───────── 形の小道具 ───────── */
  function tubeGeo(a, b, r, seg) {
    var dir = new V3().subVectors(b, a), len = dir.length();
    var g = new T.CylinderGeometry(r, r, len, seg || 20, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.normalize()));
    g.translate(a.x, a.y, a.z);
    return g;
  }
  function boxGeo(w, h, d, x, y, z) {
    var g = new T.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  function rbox(w, h, d, r, x, y, z) {
    var g = new T.RoundedBoxGeometry(w, h, d, 3, r);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  }
  function merge(list) {
    var BU = T.BufferGeometryUtils;
    var clean = list.map(function (g) { var n = g.index ? g.toNonIndexed() : g; ['uv1', 'uv2', 'color'].forEach(function (a) { if (n.attributes[a]) n.deleteAttribute(a); }); return n; });
    return BU.mergeGeometries(clean, false);
  }
  function std(o) { return new T.MeshStandardMaterial(o); }
  function mesh(geo, mat, cast, recv) {
    var m = new T.Mesh(geo, mat);
    m.castShadow = !!cast; m.receiveShadow = recv !== false;
    return m;
  }

  /* ───────── かごの代わり（Props が無い時だけ） ───────── */
  function fallbackBasket() {
    var g = new T.Group();
    var m = std({ color: 0x9aa0a4, roughness: 0.6 });
    var t = 0.012;
    g.add(mesh(rbox(0.44, t, 0.30, 0.005, 0, t / 2, 0), m, true));
    g.add(mesh(rbox(0.48, 0.24, t, 0.005, 0, 0.12, 0.17), m, true));
    g.add(mesh(rbox(0.48, 0.24, t, 0.005, 0, 0.12, -0.17), m, true));
    g.add(mesh(rbox(t, 0.24, 0.34, 0.005, 0.24, 0.12, 0), m, true));
    g.add(mesh(rbox(t, 0.24, 0.34, 0.005, -0.24, 0.12, 0), m, true));
    g.userData = { floorY: t, rimY: 0.24, slots: [{ x: -0.14, z: -0.07 }, { x: 0, z: -0.07 }, { x: 0.14, z: -0.07 }, { x: -0.14, z: 0.07 }, { x: 0, z: 0.07 }, { x: 0.14, z: 0.07 }] };
    return g;
  }

  /* ───────── 場面 ───────── */
  var S = {};

  S.build = function () {
    var self = this;
    var scene = (this.scene = new T.Scene());
    scene.background = new T.Color(0xe9e5de);
    scene.environment = G.env || null;
    scene.environmentIntensity = 0.9;
    this.camera = new T.PerspectiveCamera(35, 1, 0.05, 40);
    this.camera.position.set(0, 1.75, 3.1);
    this.camBase = new V3();
    this.camQuat = new T.Quaternion();
    this.camOff = 0;

    /* 光 */
    scene.add(new T.HemisphereLight(0xffffff, 0xd6cdbf, 0.32));
    var sun = (this.sun = new T.DirectionalLight(0xfff5e8, 2.1));
    sun.position.set(0.7, 4.4, 3.2);
    sun.target.position.set(0, 0.9, 0.1);
    sun.castShadow = true;
    var sm = G.low ? 512 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    var sc = sun.shadow.camera;
    sc.left = -1.7; sc.right = 1.7; sc.top = 1.8; sc.bottom = -1.6; sc.near = 1; sc.far = 9;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    var fill = new T.DirectionalLight(0xf0f5ff, 0.55);
    fill.position.set(-1.2, 1.6, 3);
    scene.add(fill);
    var spot = (this.spot = new T.SpotLight(0xf3f8ff, 0.9, 0, 0.95, 0.7, 0));
    spot.position.set(0, 2.0, 0.08);
    spot.target.position.set(0, 1.05, -0.35);
    scene.add(spot, spot.target);
    this.spotBase = spot.intensity;

    /* 床・壁 */
    var floor = mesh(new T.PlaneGeometry(7, 5), std({ map: texFloor(), roughnessMap: texFloorRough(), roughness: 0.75, metalness: 0, envMapIntensity: 0.9 }), false, true);
    floor.rotation.x = -PI / 2;
    floor.position.set(0, 0, 1.8);
    scene.add(floor);
    var wall = mesh(new T.PlaneGeometry(7, 3.4), std({ map: texWall(), roughness: 0.9 }), false, true);
    wall.position.set(0, 1.7, -0.72);
    scene.add(wall);
    var wood = texWood();
    var wain = mesh(merge([boxGeo(7, 0.92, 0.02, 0, 0.46, -0.70)]), std({ map: wood, roughness: 0.55, envMapIntensity: 0.6 }), false, true);
    scene.add(wain);
    var trim = mesh(merge([rbox(7, 0.03, 0.035, 0.008, 0, 0.935, -0.69), boxGeo(7, 0.08, 0.025, 0, 0.04, -0.685)]), std({ color: 0x8a6a4a, roughness: 0.5 }), false, true);
    scene.add(trim);

    /* 冷蔵ケース */
    var white = std({ color: 0xf4f5f2, roughness: 0.42, metalness: 0.05, roughnessMap: noiseTex('#a0a0a0', { data: true, n: 1200, alpha: 0.12, seed: 2 }) });
    var caseG = new T.Group();
    scene.add(caseG);
    // 側板（横から見た形を押し出す）
    var sh = new T.Shape();
    sh.moveTo(-0.66, 0); sh.lineTo(0.045, 0); sh.lineTo(0.045, 0.84);
    sh.quadraticCurveTo(0.03, 0.86, 0.03, 0.9);
    sh.lineTo(0.03, 1.92);
    sh.quadraticCurveTo(0.03, 2.02, 0.11, 2.02);
    sh.lineTo(0.11, 2.27); sh.lineTo(-0.66, 2.27); sh.lineTo(-0.66, 0);
    var sideGeo = new T.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
    sideGeo.rotateY(-PI / 2);
    var sL = sideGeo.clone(); sL.translate(-0.353, 0, 0); // x: -0.383..-0.353
    var sR = sideGeo.clone(); sR.translate(0.383, 0, 0);
    var body = [sL, sR,
      rbox(0.71, 0.25, 0.74, 0.01, 0, 2.145, -0.29),            // 庇
      boxGeo(0.71, 0.02, 0.06, 0, 2.03, -0.63)];
    caseG.add(mesh(merge(body), white, false, true));
    // 庇の前の帯（字のない模様）
    var header = mesh(new T.PlaneGeometry(0.76, 0.22), std({ map: texHeader(), roughness: 0.35 }), false, false);
    header.position.set(0, 2.145, 0.0815);
    caseG.add(header);
    // 奥の壁
    var backMap = texBack();
    var backMat = (this.backMat = std({ map: backMap, emissiveMap: backMap, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.6 }));
    var back = mesh(new T.PlaneGeometry(0.71, 1.24), backMat, false, true);
    back.position.set(0, 1.42, -0.60);
    caseG.add(back);
    // 棚板（4段まとめて1つ）
    var boards = [];
    SHELF_Y.forEach(function (y, i) {
      if (i === 0) boards.push(boxGeo(0.71, 0.03, 0.62, 0, y - 0.015, -0.31));
      else boards.push(rbox(0.70, 0.022, 0.58, 0.004, 0, y - 0.011, -0.30));
    });
    var shelfMat = std({ color: 0xe9ecec, roughness: 0.35, metalness: 0.25, roughnessMap: noiseTex('#909090', { data: true, n: 1500, alpha: 0.1, seed: 6 }) });
    caseG.add(mesh(merge(boards), shelfMat, false, true));
    // 値札レール（1枚のテクスチャ、1回の描画）
    var railGeos = [], railBodies = [];
    SHELF_Y.forEach(function (y, r) {
      var p = new T.PlaneGeometry(0.70, 0.04);
      var uv = p.attributes.uv;
      for (var i = 0; i < uv.count; i++) uv.setY(i, (r + uv.getY(i)) / 4);
      p.translate(0, y - 0.016, 0.0155);
      railGeos.push(p);
      railBodies.push(rbox(0.70, 0.046, 0.014, 0.004, 0, y - 0.016, 0.007));
    });
    caseG.add(mesh(merge(railGeos), std({ map: texRails(), roughness: 0.3, metalness: 0 }), false, false));
    caseG.add(mesh(merge(railBodies), std({ color: 0xd7dde0, roughness: 0.25, transparent: true, opacity: 0.55, depthWrite: false }), false, false));
    // LED（庇の下面と各棚板の下）
    var ledGeos = [];
    var lp = new T.PlaneGeometry(0.66, 0.025); lp.rotateX(PI / 2); lp.translate(0, 2.018, 0.05); ledGeos.push(lp);
    [1, 2, 3].forEach(function (i) {
      var q = new T.PlaneGeometry(0.64, 0.016); q.rotateX(PI / 2); q.translate(0, SHELF_Y[i] - 0.0235, -0.03); ledGeos.push(q);
    });
    var ledMat = (this.ledMat = new T.MeshBasicMaterial({ color: 0xffffff }));
    this.ledColor = new T.Color(0xffffff);
    caseG.add(mesh(merge(ledGeos), ledMat, false, false));
    // 庇の下の吹き出し口（黒い格子）
    var grille = mesh(boxGeo(0.66, 0.006, 0.045, 0, 2.016, -0.01), std({ color: 0x2b2f33, roughness: 0.6, metalness: 0.4 }), false, false);
    caseG.add(grille);
    // 腰板（通気口つき）と黒い蹴込み
    var base = mesh(new T.PlaneGeometry(0.71, 0.70), std({ map: texBase(), roughness: 0.45 }), false, true);
    base.position.set(0, 0.45, 0.04);
    caseG.add(base);
    var bumper = mesh(rbox(0.72, 0.04, 0.03, 0.012, 0, 0.80, 0.035), std({ color: 0xc9ced1, roughness: 0.22, metalness: 0.8 }), false, true);
    caseG.add(bumper);
    var kick = mesh(boxGeo(0.77, 0.10, 0.02, 0, 0.05, 0.0), std({ color: 0x1c1d1f, roughness: 0.7 }), false, true);
    caseG.add(kick);

    // 丸い物のトレーと敷物
    var trayGeo = merge([
      rbox(0.19, 0.008, 0.56, 0.003, 0, 0.004, 0),
      rbox(0.008, 0.02, 0.56, 0.003, -0.091, 0.01, 0), rbox(0.008, 0.02, 0.56, 0.003, 0.091, 0.01, 0),
      rbox(0.19, 0.02, 0.008, 0.003, 0, 0.01, 0.276), rbox(0.19, 0.02, 0.008, 0.003, 0, 0.01, -0.276)
    ]);
    var trayMat = std({ color: 0x18191b, roughness: 0.55, roughnessMap: noiseTex('#888888', { data: true, n: 900, alpha: 0.2, seed: 12 }) });
    var matGeo = rbox(0.205, 0.008, 0.57, 0.003, 0, 0.004, 0);
    var grassMat = std({ map: texGrass(), roughness: 0.9 });
    this.cols = [];
    LAYOUT.forEach(function (row, r) {
      row.forEach(function (kind, ci) {
        if (!window.Items || !Items.has(kind)) return;
        var y = SHELF_Y[r];
        var t = TRAY[kind];
        if (t === 'tray') { var tm = mesh(trayGeo, trayMat, false, true); tm.position.set(COL_X[ci], y, -0.30); caseG.add(tm); y += 0.008; }
        if (t === 'mat') { var mm = mesh(matGeo, grassMat, false, true); mm.position.set(COL_X[ci], y, -0.30); caseG.add(mm); y += 0.008; }
        self.cols.push({ kind: kind, x: COL_X[ci], y: y, row: r, zs: null, items: [] });
      });
    });

    /* カート */
    var cart = (this.cart = new T.Group());
    cart.position.set(0, 0, CART_Z);
    scene.add(cart);
    var body2 = (this.cartBody = new T.Group()); // 沈み・揺れ用
    cart.add(body2);
    var chrome = std({ color: 0xdfe3e6, metalness: 1, roughness: 0.22 });
    var tr = 0.0085, fx = 0.215, fz = 0.145, top = 0.452, low = 0.13;
    var tubes = [];
    function rect(y, x, z) {
      var c = [new V3(-x, y, -z), new V3(x, y, -z), new V3(x, y, z), new V3(-x, y, z)];
      for (var i = 0; i < 4; i++) tubes.push(tubeGeo(c[i], c[(i + 1) % 4], tr));
      c.forEach(function (p) { var s = new T.SphereGeometry(tr * 1.02, 16, 10); s.translate(p.x, p.y, p.z); tubes.push(s); });
    }
    rect(top, fx, fz);
    rect(low, fx - 0.01, fz - 0.005);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        tubes.push(tubeGeo(new V3(sx * (fx - 0.01), 0.075, sz * (fz - 0.005)), new V3(sx * fx, top, sz * fz), tr));
      });
    });
    for (var i = -2; i <= 2; i++) tubes.push(tubeGeo(new V3(i * 0.08, low, -fz + 0.005), new V3(i * 0.08, low, fz - 0.005), tr * 0.6, 12));
    // 持ち手の支柱（手前側）
    [-1, 1].forEach(function (sx) {
      tubes.push(tubeGeo(new V3(sx * fx, top, fz), new V3(sx * (fx - 0.005), 0.60, fz + 0.11), tr));
      tubes.push(tubeGeo(new V3(sx * (fx - 0.01), low, fz - 0.005), new V3(sx * fx, top, fz), tr * 0.8));
    });
    body2.add(mesh(merge(tubes), chrome, true, true));
    // 車輪の取り付け（キャスターの金具）
    var forks = [];
    var wheelPos = [[-fx + 0.01, -fz + 0.005], [fx - 0.01, -fz + 0.005], [-fx + 0.01, fz - 0.005], [fx - 0.01, fz - 0.005]];
    wheelPos.forEach(function (w) {
      forks.push(rbox(0.05, 0.012, 0.034, 0.004, w[0], 0.074, w[1]));
      forks.push(boxGeo(0.006, 0.04, 0.03, w[0] - 0.012, 0.052, w[1]));
      forks.push(boxGeo(0.006, 0.04, 0.03, w[0] + 0.012, 0.052, w[1]));
    });
    body2.add(mesh(merge(forks), chrome, true, true));
    // 赤い樹脂の持ち手
    var hb = new T.CapsuleGeometry(0.016, 0.42, 8, 32);
    hb.rotateZ(PI / 2);
    hb.translate(0, 0.605, fz + 0.115);
    body2.add(mesh(hb, std({ color: 0xc8322c, roughness: 0.36 }), true, true));
    // 車輪（黒いゴム）
    var tire = new T.CylinderGeometry(0.034, 0.034, 0.018, 32);
    tire.rotateX(PI / 2);
    var hub = new T.CylinderGeometry(0.016, 0.016, 0.021, 24);
    hub.rotateX(PI / 2);
    var rubber = std({ color: 0x161616, roughness: 0.85 });
    var hubMat = std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.7 });
    this.wheels = [];
    wheelPos.forEach(function (w) {
      var wg = new T.Group();
      wg.position.set(w[0], 0.034, w[1]);
      // 車輪は右へ転がる向き（軸が z）。少しずらして本物らしく
      wg.add(mesh(tire, rubber, true, true));
      var hm = mesh(hub, hubMat, false, true);
      wg.add(hm);
      var spoke = mesh(boxGeo(0.03, 0.004, 0.022, 0, 0, 0), hubMat, false, false);
      wg.add(spoke);
      cart.add(wg);
      self.wheels.push(wg);
    });
    // かご
    var basket = null;
    if (window.Props && Props.basket) { try { basket = Props.basket(); } catch (e) { if (window.console) console.error(e); basket = null; } }
    if (!basket) basket = fallbackBasket();
    basket.position.set(0, BASKET_Y, 0);
    U.shadow(basket, true, true);
    body2.add(basket);
    this.basket = basket;
    var bu = basket.userData || {};
    if (!bu.slots || !bu.slots.length) bu.slots = fallbackBasket().userData.slots;
    if (bu.floorY == null) bu.floorY = 0.012;
    if (bu.rimY == null) bu.rimY = 0.24;
    var mx = 0, mz = 0;
    bu.slots.forEach(function (s) { mx = Math.max(mx, Math.abs(s.x)); mz = Math.max(mz, Math.abs(s.z)); });
    this.inX = Math.min(0.215, mx + 0.075);
    this.inZ = Math.min(0.145, mz + 0.07);
    scene.updateMatrixWorld(true);
    var bb = new T.Box3().setFromObject(basket);
    this.basketBoxLocal = bb.clone().translate(new V3(0, -BASKET_Y, -CART_Z)); // かご原点基準
    // カートの当たり判定用の目印（かごの中心あたり）
    var proxy = (this.cartProxy = new T.Object3D());
    proxy.position.set(0, BASKET_Y + 0.05, 0);
    proxy.userData = { r: 0.36, cy: 0, cart: true };
    body2.add(proxy);

    /* ママの腕（1本を使い回す） */
    this.arm = null;
    if (window.Hand && Hand.create) {
      try {
        var a = Hand.create({ sleeve: true, side: 'R' });
        if (a && a.group) {
          this.arm = a;
          extendSleeve(a.group);
          a.group.visible = false;
          scene.add(a.group);
        }
      } catch (e) { if (window.console) console.error(e); this.arm = null; }
    }

    this.plane = new T.Plane(new V3(0, 0, 1), -HOLD_Z);
    this.plane2 = new T.Plane(new V3(0, 0, 1), -HOLD_Z);
    this.tmpA = new V3(); this.tmpB = new V3();
    this.ray = new T.Raycaster();
    this.recs = [];
    this.inBasket = [];
    this.held = null;
    this.spring = { y: 0, vy: 0, r: 0, vr: 0 };
    this.lastCartX = 0;
  };

  /* 袖を肩の方へ長くのばす（横長の画面で袖の切れ目が見えないように） */
  function extendSleeve(group) {
    group.updateMatrixWorld(true);
    var low = null, lowY = Infinity, box = new T.Box3();
    group.traverse(function (m) {
      if (!m.isMesh) return;
      box.setFromObject(m);
      if (box.min.y < lowY) { lowY = box.min.y; low = { m: m, w: box.max.x - box.min.x, cx: (box.max.x + box.min.x) / 2, cz: (box.max.z + box.min.z) / 2 }; }
    });
    if (!low || lowY > -0.3) return;
    var r = low.w / 2 * 0.9;
    var len = 2.2, y0 = lowY + 0.03;
    var g = new T.CylinderGeometry(r * 1.02, r * 1.25, len, 48, 8, true);
    g.translate(0, y0 - len / 2, 0);
    g.scale(1, 1, 0.9);
    var pos = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(pos.count * 3);
    for (var i = 0; i < pos.count; i++) {
      uv.setXY(i, uv.getX(i) * 8, -pos.getY(i) / 0.032);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1 - 0.06 * Math.max(0, -pos.getZ(i) / r);
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    var ext = new T.Mesh(g, low.m.material);
    ext.position.set(low.cx, 0, low.cz);
    ext.castShadow = true;
    (low.m.parent || group).add(ext);
  }

  /* ───────── 状態の復元 ───────── */
  S.enter = function () {
    var self = this;
    if (window.Sound && Sound.ambience) { try { Sound.ambience('store'); } catch (e) { /* 無視 */ } }
    sndLoop('cartRoll', false);
    this.gen = (this.gen || 0) + 1;
    if (G.env) this.scene.environment = G.env;
    stopTw(this.armTw);
    this.held = null;
    this.phase = 'pick';
    this.going = false;
    this.armTw = null;
    this.cartTw = null;
    // 古い品物を外す
    this.recs.forEach(function (r) { if (r.c.parent) r.c.parent.remove(r.c); });
    this.recs = [];
    this.inBasket = [];
    // カート・光・腕を元に
    this.cart.position.set(0, 0, CART_Z);
    this.cartBody.position.set(0, 0, 0);
    this.cartBody.rotation.set(0, 0, 0);
    this.spring = { y: 0, vy: 0, r: 0, vr: 0 };
    this.lastCartX = 0;
    this.wheels.forEach(function (w) { w.rotation.set(0, 0, 0); });
    this.camOff = 0;
    this.setDim(0);
    if (this.arm) this.arm.group.visible = false;

    var st = G.state || (G.state = {});
    if (!Array.isArray(st.basket)) st.basket = [];
    if (st.basket.length > MAXN) { st.basket = st.basket.slice(0, MAXN); if (G.save) G.save(); }
    var bk = st.basket.slice();

    // 棚
    this.cols.forEach(function (col) {
      if (Items._prototype) Items._prototype(col.kind); // 実測の寸法を先に
      var inf = info(col.kind);
      var d = inf.d || 0.1;
      var z0 = Math.min(-0.07, -0.025 - d / 2);
      col.zs = [z0, z0 - (d + 0.018), z0 - 2 * (d + 0.022)];
      col.items = [];
      var used = bk.filter(function (k) { return k === col.kind; }).length;
      var left = Math.max(0, 3 - used);
      // 残りは手前から詰める
      for (var i = 0; i < left; i++) {
        var rec = self.makeRec(col.kind);
        rec.col = col;
        col.items.push(rec);
        self.scene.add(rec.c);
        self.placeHome(rec, i);
        castOf(rec, i === 0);   // 奥の品物は影を落とさない(描画を軽く)
      }
    });
    // かご
    bk.forEach(function (k, i) {
      var rec = self.makeRec(k);
      rec.where = 'basket';
      var ps = self.basketPose(i, k);
      rec.c.position.set(ps.x, ps.y, ps.z);
      rec.c.rotation.set(ps.rx, ps.ry, ps.rz);
      self.basket.add(rec.c);
      self.inBasket.push(rec);
    });
    this.n = bk.length;
    if (this.n >= MAXN) this.toPush(true);
    else this.updateHint();
  };

  S.exit = function () {
    sndLoop('cartRoll', false);
    this.held = null;
    hint(null);
    if (this.arm) this.arm.group.visible = false;
  };

  function castOf(rec, on) {
    rec.inner.traverse(function (m) {
      if (m.isMesh) m.castShadow = on && !(m.material && m.material.transparent && m.material.opacity < 0.5);
    });
  }

  S.makeRec = function (kind) {
    var inner = Items.make(kind);
    var hop = new T.Group();
    hop.add(inner);
    var c = new T.Group();
    c.add(hop);
    var u = inner.userData || {};
    var rec = { kind: kind, c: c, hop: hop, inner: inner, col: null, where: 'shelf', busy: false, tw: null, yaw: 0 };
    c.userData = { kind: kind, w: u.w, h: u.h, d: u.d, r: u.r, cy: u.cy, rec: rec };
    this.recs.push(rec);
    return rec;
  };

  /* 棚の上の i 番目（0=先頭）の置き場所 */
  S.homeOf = function (rec, i) {
    var col = rec.col;
    var seed = (col.row * 3 + COL_X.indexOf(col.x)) * 7 + i * 3 + 1;
    var r = U.rng(seed), r1 = r(), r2 = r();
    var round = TRAY[col.kind] === 'tray';
    var yaw = round ? r1 * PI * 2 : (r1 - 0.5) * 0.09;
    return { x: col.x + (r2 - 0.5) * 0.008, y: col.y, z: col.zs[Math.min(i, 2)], yaw: yaw };
  };
  S.placeHome = function (rec, i) {
    var h = this.homeOf(rec, i);
    rec.c.position.set(h.x, h.y, h.z);
    rec.c.rotation.set(0, h.yaw, 0);
    rec.yaw = h.yaw;
  };

  /* かごの i 番目の置き方（かごのローカル座標）。同じ i・kind なら毎回同じ */
  S.basketPose = function (i, kind) {
    var bu = this.basket.userData;
    var slot = bu.slots[i % bu.slots.length];
    var inf = info(kind);
    var w = inf.w || 0.08, d = inf.d || 0.08, h = inf.h || 0.08;
    var r = U.rng(101 + i * 17);
    var wide = w >= 0.15;
    var ry = (wide ? PI / 2 : 0) + (r() - 0.5) * 0.5;
    var cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
    var hx = cs * w / 2 + sn * d / 2, hz = sn * w / 2 + cs * d / 2;
    var lx = Math.max(0, this.inX - hx), lz = Math.max(0, this.inZ - hz);
    var x = U.clamp(slot.x + (r() - 0.5) * 0.02, -lx, lx);
    var z = U.clamp(slot.z + (r() - 0.5) * 0.02, -lz, lz);
    var y = bu.floorY;
    var stacked = false;
    var prev = this._poses || (this._poses = {});
    for (var j = 0; j < i; j++) {
      var p = prev[j];
      if (!p) continue;
      var ox = Math.min(x + hx, p.x + p.hx) - Math.max(x - hx, p.x - p.hx);
      var oz = Math.min(z + hz, p.z + p.hz) - Math.max(z - hz, p.z - p.hz);
      if (ox > 0.015 && oz > 0.015 && ox * oz > 0.2 * (4 * hx * hz)) {
        var top = p.y + p.h * 0.55;
        if (top > y) { y = top; stacked = true; }
      }
    }
    // かごのふちより上に出すぎない
    y = Math.min(y, bu.rimY - h * 0.6);
    y = Math.max(y, bu.floorY);
    var tilt = stacked ? 0.12 : 0.03;
    var ps = { x: x, y: y, z: z, ry: ry, rx: (r() - 0.5) * tilt, rz: (r() - 0.5) * tilt, hx: hx, hz: hz, h: h };
    prev[i] = ps;
    return ps;
  };

  /* ───────── 手がかり ───────── */
  S.recommend = function () {
    var bk = (G.state && G.state.basket) || [];
    for (var i = 0; i < RECOMMEND.length; i++) {
      var k = RECOMMEND[i];
      if (bk.indexOf(k) >= 0) continue;
      var col = this.colOf(k);
      if (col && col.items.length) return col.items[0];
    }
    for (var j = 0; j < this.cols.length; j++) if (this.cols[j].items.length) return this.cols[j].items[0];
    return null;
  };
  S.colOf = function (k) {
    for (var i = 0; i < this.cols.length; i++) if (this.cols[i].kind === k) return this.cols[i];
    return null;
  };
  S.updateHint = function () {
    var self = this;
    if (this.phase !== 'pick' || this.n >= MAXN) return;
    var rec = this.recommend();
    if (!rec) { hint(null); return; }
    hint({
      key: 'pick',
      target: rec.c,
      to: this.basket,
      wiggle: function () { self.wiggleItem(rec); }
    });
  };
  S.wiggleItem = function (rec) {
    if (!rec || rec.where !== 'shelf' || this.phase !== 'pick') return;
    if (!rec.busy) {
      stopTw(rec.hopTw);
      var hop = rec.hop;
      rec.hopTw = tween(0.5, function (k) {
        var a = Math.sin(PI * Math.min(1, k * 1.25));
        hop.position.y = Math.max(0, a) * 0.04 + (k > 0.8 ? Math.sin((k - 0.8) / 0.2 * PI) * 0.006 : 0);
        hop.rotation.z = Math.sin(k * PI * 2) * 0.06 * (1 - k);
      }, { ease: G.ease && G.ease.linear, done: function () { hop.position.y = 0; hop.rotation.z = 0; rec.hopTw = null; } });
    }
    this.pointAt(rec);
  };

  /* ママの腕が右の外から入って、品物を指さして、引っこむ */
  S.pointAt = function (rec) {
    var arm = this.arm;
    if (!arm || this.armTw) return;
    var g = arm.group;
    var u = rec.c.userData;
    var T0 = new V3();
    rec.c.getWorldPosition(T0);
    T0.y += (u.cy || 0.04) + 0.01;
    T0.z += (u.d || 0.08) / 2 + 0.035;
    T0.x += (u.w || 0.08) * 0.25;
    // 指の向き: 左・少し下・少し奥へ。腕は右上の手前へ伸びる
    var dir = new V3(-1, -0.5, -0.32).normalize();
    var zc = new V3(0, 0.35, 1);
    zc.addScaledVector(dir, -zc.dot(dir)).normalize();
    var xa = new V3().crossVectors(dir, zc).normalize();
    var m = new T.Matrix4().makeBasis(xa, dir, zc);
    var q = new T.Quaternion().setFromRotationMatrix(m);
    try { arm.pose('point', 0); } catch (e) { /* 無視 */ }
    try { if (arm.update) arm.update(0.5); } catch (e2) { /* 無視 */ }
    g.position.set(0, 0, 0);
    g.quaternion.copy(q);
    g.updateMatrixWorld(true);
    var tipOff = new V3(0, 0.17, 0).applyQuaternion(q);
    if (arm.tip) { arm.tip.getWorldPosition(tipOff); }
    var W = new V3().subVectors(T0, tipOff);
    var out = new V3().copy(W).addScaledVector(dir, -2.6);
    g.position.copy(out);
    g.visible = true;
    var self = this;
    var cur = new V3(), gen = this.gen;
    this.armTw = tween(2.5, function (k) {
      var t = k * 2.5;
      if (t < 0.6) cur.lerpVectors(out, W, easeOut(t / 0.6));
      else if (t < 1.9) { cur.copy(W).addScaledVector(dir, 0.014 * Math.sin((t - 0.6) * 10) * Math.max(0, 1 - (t - 0.6) / 1.3)); }
      else cur.lerpVectors(W, out, easeInOut((t - 1.9) / 0.6));
      g.position.copy(cur);
    }, { ease: G.ease && G.ease.linear, done: function () { if (gen === self.gen) { g.visible = false; self.armTw = null; } } });
  };

  /* ───────── 光を少し落とす（6こ入った後） ───────── */
  S.setDim = function (v) {
    var a = 1 - 0.22 * v;
    this.ledMat.color.setScalar(a);
    this.spot.intensity = this.spotBase * (1 - 0.35 * v);
    this.backMat.emissiveIntensity = 0.2 * (1 - 0.4 * v);
  };

  S.toPush = function (instant) {
    var self = this;
    this.phase = 'push';
    if (this.arm) this.arm.group.visible = false;
    if (instant) this.setDim(1);
    else tween(1.2, function (k) { self.setDim(k); });
    hint({
      key: 'cart',
      target: this.basket,
      to: function () { var p = new V3(); self.cart.getWorldPosition(p); p.x += 0.5; p.y = BASKET_Y + 0.12; return p; },
      wiggle: function () { self.cartWiggle(); }
    });
  };

  S.cartWiggle = function () {
    if (this.phase !== 'push' || this.going || this.cartTw) return;
    var self = this, cart = this.cart;
    snd('squeak', { vol: 0.7 });
    var gen = this.gen;
    this.cartTw = tween(0.8, function (k) {
      cart.position.x = Math.sin(k * PI * 3) * 0.035 * (1 - k);
    }, { ease: G.ease && G.ease.linear, done: function () { if (gen === self.gen) { cart.position.x = 0; self.cartTw = null; } } });
  };

  S.startPush = function () {
    if (this.going) return;
    var self = this, cart = this.cart;
    this.going = true;
    this.phase = 'going';
    stopTw(this.cartTw); this.cartTw = null;
    hint(null);
    snd('cart');
    sndLoop('cartRoll', true, { vol: 0.8 });
    this.spring.vr += 0.6;
    this.inBasket.forEach(function (r, i) { after(0.05 + i * 0.04, function () { shake(r.inner, 0.03, 0.5); }); });
    var x0 = cart.position.x, gen = this.gen;
    tween(2.0, function (k) {
      cart.position.x = x0 + 3.6 * (0.3 * k + 0.7 * k * k);
      self.camOff = 0.16 * U.smooth(k * 1.4);
    }, {
      ease: G.ease && G.ease.linear,
      done: function () {
        sndLoop('cartRoll', false);
        if (gen === self.gen && G.go) G.go('register');
      }
    });
  };

  /* ───────── 入力 ───────── */
  S.pickables = function () {
    var list = [];
    if (this.phase === 'going') return list;
    this.cols.forEach(function (col) {
      var r = col.items[0];
      if (r && r.where === 'shelf' && !r.busy) list.push(r.c);
    });
    this.inBasket.forEach(function (r) { if (r.where === 'basket' && !r.busy) list.push(r.c); });
    list.push(this.cartProxy);
    return list;
  };

  S.pickAt = function (p, list, margin) {
    if (G.pick) return G.pick(p, list, margin);
    // 予備: 画面上で一番近い物
    var best = null, bd = Infinity, cam = this.camera, v = new V3();
    var vw = (G.view && G.view.w) || window.innerWidth, vh = (G.view && G.view.h) || window.innerHeight;
    list.forEach(function (o) {
      o.getWorldPosition(v); v.y += (o.userData.cy || 0);
      var r = o.userData.r || 0.1;
      var c = v.clone().project(cam), e = v.clone().add(new V3(r, 0, 0)).project(cam);
      var sx = (c.x + 1) / 2 * vw, sy = (1 - c.y) / 2 * vh, rp = Math.abs(e.x - c.x) / 2 * vw;
      var d = Math.hypot(sx - p.x, sy - p.y) - rp;
      if (d < (margin || 24) && d < bd) { bd = d; best = o; }
    });
    return best;
  };

  S.onPlane = function (p, plane, out) {
    if (G.onPlane) return G.onPlane(p, plane, out);
    this.ray.setFromCamera(p.ndc, this.camera);
    return this.ray.ray.intersectPlane(plane, out);
  };
  S.toScreen = function (v) {
    if (G.screen) return G.screen(v);
    var c = v.clone().project(this.camera);
    var vw = (G.view && G.view.w) || window.innerWidth, vh = (G.view && G.view.h) || window.innerHeight;
    return { x: (c.x + 1) / 2 * vw, y: (1 - c.y) / 2 * vh };
  };

  S.down = function (p) {
    if (this.held || this.going) return;
    var hit = this.pickAt(p, this.pickables(), 26);
    if (!hit) return;
    if (hit === this.cartProxy) {
      if (this.phase === 'push') this.startPush();
      else { this.spring.vr += 0.35; this.spring.vy -= 0.08; snd('squeak', { vol: 0.6 }); }
      return;
    }
    var rec = hit.userData.rec;
    if (!rec) return;
    if (rec.where === 'basket') {
      if (this.phase === 'push') { this.startPush(); return; }
      shake(rec.inner, 0.04, 0.4);
      snd(itemSound(rec.kind), { vol: 0.8 });
      return;
    }
    if (rec.where === 'shelf') {
      if (this.phase !== 'pick' || this.n >= MAXN) {
        shake(rec.inner, 0.05, 0.45);
        snd(itemSound(rec.kind));
        return;
      }
      this.startHold(rec, p);
    }
  };

  function copyP(p) { return { x: p.x, y: p.y, ndc: p.ndc ? p.ndc.clone() : new T.Vector2() }; }

  S.startHold = function (rec, p) {
    stopTw(rec.tw); rec.tw = null;
    rec.where = 'held';
    var u = rec.c.userData;
    var P = this.onPlane(p, this.plane, new V3()) || rec.c.position.clone();
    var cy = u.cy || 0.04;
    this.held = {
      rec: rec,
      p: copyP(p),
      off: new T.Vector2(U.clamp(rec.c.position.x - P.x, -0.15, 0.15), U.clamp(rec.c.position.y + cy - P.y, -0.15, 0.15) + 0.03),
      vx: 0,
      lastX: rec.c.position.x,
      rz: 0
    };
    // その場で少し手前へ持ち上げる（すぐに見える反応）
    rec.c.position.z += 0.06;
    rec.c.position.y += 0.025;
    snd('lift');
  };

  S.move = function (p) {
    if (this.held) this.held.p = copyP(p);
  };

  S.up = function (p) {
    var H = this.held;
    if (!H) return;
    this.held = null;
    var rec = H.rec;
    if (p && !p.cancel) H.p = copyP(p);
    if (!p || p.cancel) { this.goBack(rec, false); return; }
    var tap = (p.dist || 0) < 10 && (p.t == null || p.t < 0.45);
    if (tap) { this.goBack(rec, true); return; }
    if (this.n < MAXN && this.inDropZone(p)) this.dropIn(rec);
    else this.goBack(rec, false);
  };

  S.inDropZone = function (p) {
    var b = this.basketBoxLocal, bw = this.basket;
    bw.updateMatrixWorld(true);
    var mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    var v = new V3();
    for (var i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      bw.localToWorld(v);
      var s = this.toScreen(v);
      mnx = Math.min(mnx, s.x); mxx = Math.max(mxx, s.x); mny = Math.min(mny, s.y); mxy = Math.max(mxy, s.y);
    }
    var cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, hw = (mxx - mnx) / 2 * 1.3, hh = (mxy - mny) / 2 * 1.3;
    if (Math.abs(p.x - cx) <= hw && Math.abs(p.y - cy) <= hh) return true;
    var shelf = this.toScreen(new V3(0, SHELF_Y[0], 0));
    return p.y > shelf.y;
  };

  S.goBack = function (rec, tapped) {
    var self = this, col = rec.col;
    var idx = col.items.indexOf(rec);
    if (idx < 0) idx = 0;
    var h = this.homeOf(rec, idx);
    rec.where = 'back';
    rec.busy = true;
    var c = rec.c;
    var p0 = c.position.clone(), q0 = c.quaternion.clone();
    var q1 = new T.Quaternion().setFromEuler(new T.Euler(0, h.yaw, 0));
    var p1 = new V3(h.x, h.y, h.z);
    var gen = this.gen;
    var dur = tapped ? 0.18 : U.clamp(0.25 + p0.distanceTo(p1) * 0.35, 0.3, 0.6);
    if (!tapped) snd('back');
    rec.tw = tween(dur, function (k) {
      c.position.lerpVectors(p0, p1, k);
      c.position.y += Math.sin(PI * k) * (tapped ? 0.005 : 0.03);
      c.quaternion.slerpQuaternions(q0, q1, k);
    }, {
      ease: G.ease && G.ease.out,
      done: function () {
        if (gen !== self.gen) return;
        c.position.copy(p1); c.quaternion.copy(q1);
        rec.yaw = h.yaw;
        rec.where = 'shelf'; rec.busy = false; rec.tw = null;
        if (tapped) { shake(rec.inner, 0.05, 0.45); snd(itemSound(rec.kind)); }
        else snd('tok', { vol: 0.35 });
        self.updateHint();
      }
    });
  };

  S.dropIn = function (rec) {
    var self = this, col = rec.col;
    var i = this.n;
    this.n++;
    if (!Array.isArray(G.state.basket)) G.state.basket = [];
    G.state.basket.push(rec.kind);
    if (G.save) G.save();
    var ci = col.items.indexOf(rec);
    if (ci >= 0) col.items.splice(ci, 1);
    rec.where = 'fly';
    rec.busy = true;
    hint(null);
    var ps = this.basketPose(i, rec.kind);
    var c = rec.c;
    var basket = this.basket;
    var p0 = c.position.clone(), q0 = c.quaternion.clone();
    var bq = new T.Quaternion();
    var lq = new T.Quaternion().setFromEuler(new T.Euler(ps.rx, ps.ry, ps.rz));
    var e = new V3(), q1 = new T.Quaternion();
    var gen = this.gen;
    var lift = Math.max(0.06, (basket.userData.rimY + BASKET_Y + 0.12) - p0.y);
    rec.tw = tween(0.5, function (k) {
      basket.updateMatrixWorld(true);
      e.set(ps.x, ps.y, ps.z); basket.localToWorld(e);
      basket.getWorldQuaternion(bq); q1.multiplyQuaternions(bq, lq);
      c.position.lerpVectors(p0, e, k);
      c.position.y += Math.sin(PI * Math.min(1, k * 1.1)) * Math.min(lift, 0.18) * (1 - k * 0.3);
      c.quaternion.slerpQuaternions(q0, q1, k);
    }, {
      ease: G.ease && G.ease.inOut,
      done: function () {
        if (gen !== self.gen) return;
        rec.tw = null;
        basket.add(c);
        c.position.set(ps.x, ps.y, ps.z);
        c.rotation.set(ps.rx, ps.ry, ps.rz);
        rec.where = 'basket'; rec.busy = false;
        self.inBasket.push(rec);
        var hv = heavy(rec.kind);
        snd('drop', { vol: hv });
        snd(itemSound(rec.kind), { vol: 0.8, delay: 0.05 });
        self.spring.vy -= 0.12 + 0.25 * hv;
        self.spring.vr += (ps.x > 0 ? -1 : 1) * 0.15;
        self.inBasket.forEach(function (r) { if (r !== rec) shake(r.inner, 0.015, 0.3); });
        if (self.n >= MAXN) after(0.45, function () { if (gen === self.gen && self.phase === 'pick') self.toPush(false); });
        else self.updateHint();
      }
    });
    // 同じ列の残りが前へすべってくる
    after(0.3, function () { if (gen === self.gen) self.slideCol(col); });
  };

  S.slideCol = function (col) {
    var self = this, first = true, gen = this.gen;
    col.items.forEach(function (rec, i) {
      if (rec.where !== 'shelf' || rec.busy) return;
      castOf(rec, i === 0);
      var h = self.homeOf(rec, i);
      var c = rec.c;
      var z0 = c.position.z, x0 = c.position.x, y0 = c.position.y;
      if (Math.abs(z0 - h.z) < 0.002) return;
      var yaw0 = rec.yaw;
      if (first) { snd('slide', { vol: 0.8 }); first = false; }
      stopTw(rec.tw);
      rec.tw = tween(0.5, function (k) {
        c.position.set(U.lerp(x0, h.x, k), y0 + (h.y - y0) * k, U.lerp(z0, h.z, k));
        c.rotation.set(0, U.lerp(yaw0, h.yaw, k), 0);
      }, {
        ease: G.ease && G.ease.out, delay: i * 0.08,
        done: function () { if (gen !== self.gen) return; rec.tw = null; rec.yaw = h.yaw; if (i === 0) snd('tok', { vol: 0.3 }); }
      });
    });
  };

  /* ───────── 毎フレーム ───────── */
  S.update = function (dt) {
    var t = G.time || 0;
    // 持っている物を指へ
    var H = this.held;
    if (H) {
      var rec = H.rec, c = rec.c, u = c.userData, cy = u.cy || 0.04;
      var P = this.onPlane(H.p, this.plane, this.tmpA);
      if (P) {
        var f = U.smooth((1.0 - P.y) / 0.38);
        var zt = U.lerp(HOLD_Z, CART_Z, f);
        this.plane2.constant = -zt;
        var Q = this.onPlane(H.p, this.plane2, this.tmpB) || P;
        H.off.x = U.damp(H.off.x, 0, 6, dt);
        H.off.y = U.damp(H.off.y, 0.035, 6, dt);
        var tx = U.clamp(Q.x + H.off.x, -2.5, 2.5);
        var ty = Q.y + H.off.y - cy;
        var rimW = this.cart.position.y + this.cartBody.position.y + BASKET_Y + this.basket.userData.rimY;
        if (f > 0.25) ty = Math.max(ty, U.lerp(0.1, rimW + 0.02, U.smooth((f - 0.25) / 0.4)));
        ty = U.clamp(ty, 0.05, 2.0 - (u.h || 0.1));
        c.position.x = U.damp(c.position.x, tx, 22, dt);
        c.position.y = U.damp(c.position.y, ty, 22, dt);
        c.position.z = U.damp(c.position.z, zt, 18, dt);
      }
      var vx = (c.position.x - H.lastX) / Math.max(dt, 1e-3);
      H.lastX = c.position.x;
      H.vx = U.damp(H.vx, vx, 10, dt);
      H.rz = U.damp(H.rz, U.clamp(-H.vx * 0.22, -0.35, 0.35), 10, dt);
      c.rotation.set(0.1 + Math.sin(t * 3.1) * 0.03, U.damp(c.rotation.y, 0, 4, dt) + Math.sin(t * 2.3) * 0.004, H.rz + Math.sin(t * 2.7) * 0.035);
    }
    // カートの沈み・揺れ（ばね）
    var s = this.spring;
    s.vy += (-140 * s.y - 9 * s.vy) * dt; s.y += s.vy * dt;
    s.vr += (-90 * s.r - 6 * s.vr) * dt; s.r += s.vr * dt;
    s.y = U.clamp(s.y, -0.03, 0.02); s.r = U.clamp(s.r, -0.06, 0.06);
    this.cartBody.position.y = s.y;
    this.cartBody.rotation.z = s.r * 0.25;
    this.cartBody.rotation.x = s.r * 0.12;
    // 車輪
    var dx = this.cart.position.x - this.lastCartX;
    this.lastCartX = this.cart.position.x;
    if (dx) this.wheels.forEach(function (w) { w.rotation.z -= dx / 0.034; });
    // カメラがほんの少し追う
    if (this.camOff) {
      this.camera.position.copy(this.camBase);
      this.camera.position.x += this.camOff;
    }
    if (this.arm && this.arm.update) { try { this.arm.update(dt); } catch (e) { /* 無視 */ } }
  };

  S.layout = function () {
    if (G.fit) G.fit(this.camera, { center: new V3(0, 1.2, 0.25), w: 0.82, h: 2.0, pitch: 0.5 });
    else { this.camera.position.set(0, 1.75, 3.1); this.camera.lookAt(0, 1.15, 0.2); }
    this.camBase.copy(this.camera.position);
    if (this.camOff) this.camera.position.x += this.camOff;
    var sm = G.low ? 512 : 1024;
    if (this.sun.shadow.mapSize.x !== sm) {
      this.sun.shadow.mapSize.set(sm, sm);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  };

  G.addScene('shelf', S);
})();
