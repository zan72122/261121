/* 00_core.js — 共有の名前空間・数学・手続きテクスチャの道具・配置の定数。
   すべてのモジュールは window.G にぶら下がる。three.js は r158 (グローバル THREE)。 */
(function () {
  'use strict';
  var G = window.G = { VERSION: 1 };
  var U = G.U = {};

  U.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  U.clamp01 = function (x) { return x < 0 ? 0 : (x > 1 ? 1 : x); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.smooth = function (a, b, x) { var t = U.clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  /* フレームレートに依存しない追従。lambda が大きいほど速い */
  U.damp = function (cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); };
  U.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.hash2 = function (ix, iy, seed) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((seed | 0) + 1, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  /* 値ノイズ [0,1]。period を渡すとその周期でタイル可能（整数） */
  U.noise2 = function (x, y, seed, period) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
    if (period) {
      x0 = ((x0 % period) + period) % period; x1 = ((x1 % period) + period) % period;
      y0 = ((y0 % period) + period) % period; y1 = ((y1 % period) + period) % period;
    }
    var a = U.hash2(x0, y0, seed), b = U.hash2(x1, y0, seed), c = U.hash2(x0, y1, seed), d = U.hash2(x1, y1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  /* fbm [0,1]。period を渡すとタイル可能（基本周期。オクターブごとに倍） */
  U.fbm = function (x, y, oct, seed, period) {
    var s = 0, amp = 0.5, norm = 0, f = 1;
    for (var i = 0; i < (oct || 4); i++) {
      s += amp * U.noise2(x * f, y * f, (seed | 0) + i * 17, period ? period * f : 0);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  };

  U.makeCanvas = function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
  /* ───── 下書き → 裏で清書（最初の場面をすぐ出すための仕組み） ─────
     重い手続きテクスチャは generator 関数で書き、1行ごとに yield する。
     U.prog(make) は、まず縮小した下書き（U.Q 倍に間引いた画素で同じ式を評価）をその場で作って返し、
     本来の大きさの清書は U.bg に積んで、遊んでいる間に少しずつ（1フレーム数ミリ秒ずつ）作る。
     できあがったら、下書きのキャンバスから作ったテクスチャの絵を差し替える（材質はそのまま）。 */
  U.Q = 1;
  U.run = function (gen) { var r; do { r = gen.next(); } while (!r.done); return r.value; };
  /* 下書きの間引き率 q で作るキャンバスの大きさ */
  U.qsize = function (n) { return U.Q > 1 ? Math.max(8, Math.round(n / U.Q)) : n; };
  U.bg = { jobs: [], cur: null };
  U.prog = function (make, q) {
    var old = U.Q; U.Q = q || 4;
    var d;
    try { d = U.run(make()); } finally { U.Q = old; }
    U.bg.jobs.push({ make: make, draft: d });
    return d;
  };
  function swapCanvas(oldC, newC) {
    var ts = oldC && oldC._t; if (!ts) return;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      t.dispose();                 // 大きさが変わるので GPU 側を作り直させる
      t.image = newC; t.needsUpdate = true;
    }
    newC._t = ts; oldC._t = null;
  }
  function finishJob(job, full) {
    var d = job.draft;
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k) && d[k] && d[k].getContext && full[k]) {
      swapCanvas(d[k], full[k]); d[k] = full[k];   // 下書きの入れ物を清書で置き換える（キャッシュも清書になる）
    }
    if (job.done) job.done(d);
  }
  U.bgBusy = function () { return !!(U.bg.cur || U.bg.jobs.length); };
  /* ms ミリ秒まで裏の清書を進める。1つ仕上げて差し替えたら、そのフレームはそこで止める（転送の重なりを避ける） */
  U.bgTick = function (ms) {
    var B = U.bg, t0 = performance.now(), old = U.Q;
    U.Q = 1;
    try {
      while (performance.now() - t0 < ms) {
        if (!B.cur) {
          if (!B.jobs.length) break;
          B.cur = B.jobs.shift(); B.cur.gen = B.cur.make();
        }
        var r = B.cur.gen.next();
        if (r.done) { var job = B.cur; B.cur = null; finishJob(job, r.value); break; }
      }
    } catch (e) {
      B.cur = null;   // 清書に失敗しても下書きのまま遊べる
      if (window.console) console.error(e);
    } finally { U.Q = old; }
  };

  /* 画素ごとの関数でキャンバスを作る。fn(u, v, out) : u,v は 0..1、out[0..3] に 0..255 を入れる */
  U.pixelCanvasG = function* (size0, fn) {
    var size = U.qsize(size0);
    var c = U.makeCanvas(size, size), ctx = c.getContext('2d');
    c._q = size0 / size;
    var img = ctx.createImageData(size, size), d = img.data, out = [0, 0, 0, 255];
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        out[0] = out[1] = out[2] = 0; out[3] = 255;
        fn((x + 0.5) / size, (y + 0.5) / size, out);
        var i = (y * size + x) * 4; d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
      }
      yield;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
  U.pixelCanvas = function (size, fn) { return U.run(U.pixelCanvasG(size, fn)); };
  /* 高さ(グレースケール canvas の R) から法線マップ canvas を作る。タイル前提で端は回り込む。
     下書き（間引いた高さ）では、1画素の幅が広いぶん強さを割って、清書に近い傾きにする */
  U.heightToNormalG = function* (heightCanvas, strength) {
    var w = heightCanvas.width, h = heightCanvas.height;
    var src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    var c = U.makeCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    var s = (strength || 1) * 2.0 / (heightCanvas._q || 1);
    c._q = heightCanvas._q || 1;
    function H(x, y) { x = (x + w) % w; y = (y + h) % h; return src[(y * w + x) * 4] / 255; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (H(x + 1, y) - H(x - 1, y)) * s, dy = (H(x, y + 1) - H(x, y - 1)) * s;
        var inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 4;
        d[i] = (-dx * inv * 0.5 + 0.5) * 255; d[i + 1] = (dy * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
      if ((y & 3) === 3) yield;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
  U.heightToNormal = function (heightCanvas, strength) { return U.run(U.heightToNormalG(heightCanvas, strength)); };
  /* canvas → THREE.CanvasTexture。opts: {srgb, repeat:[x,y], aniso} */
  U.tex = function (canvas, opts) {
    opts = opts || {};
    var t = new THREE.CanvasTexture(canvas);
    if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
    t.anisotropy = opts.aniso || 4;
    t.needsUpdate = true;
    (canvas._t || (canvas._t = [])).push(t);   // 清書ができたら差し替えるため
    return t;
  };

  /* ───── 配置の定数（メートル、Y が上、カメラは +Z 側から -Z を見る、+X が画面右） ───── */
  G.L = {
    FLOOR_Y: 0,
    WALL_Z: -0.60,            // 腰壁の手前の面
    WALL_H: 1.05,             // 腰壁の高さ（その上に笠木と手すり、手すり上端 y≈1.15）
    TAP_X: -0.44,             // 立水栓（柱）の x
    TAP_POST_Z: -0.40,        // 柱の中心 z
    TAP_OUT: [-0.44, 0.60, -0.18],     // 吐水口（水が出る点）
    TAP_HANDLE: [-0.44, 0.80, -0.30],  // ハンドルの中心（上向きの三角/十字ハンドル）
    PAN: [-0.44, 0.0, -0.18],          // 水受けパンの中心。上面 y=0.03、0.40×0.40
    CAN_HOME: [-0.44, 0.03, -0.18],    // じょうろの定位置（底の中心）。吐水口の真下
    CAN_CARRY_Z: 0.12,                 // 持って運ぶときの z
    CAN_X_MIN: -0.60, CAN_X_MAX: -0.14, // 持っているときの底中心 x の範囲
    CAN_Y_MAX: 0.85,
    BUCKET: [-0.06, 0.0, -0.20],       // 伏せたブリキのバケツ。上面 y=0.20、上面半径 0.085
    BUCKET_TOP_Y: 0.20,
    PLANTER: [0.30, 0.0, -0.15],       // 素焼きの丸鉢。上端半径 0.20、高さ 0.30
    PLANTER_R: 0.20,
    SOIL_Y: 0.27, SOIL_R: 0.185,       // 土の面
    PLANT_BASE: [0.30, 0.27, -0.15],   // 苗を植える点（土の面）
    STAKE: [0.335, 0.27, -0.17],       // 支柱の根元。上端 y=1.38
    PINWHEEL_C: [0.12, 0.48, 0.00],   // かざぐるまの羽根の中心。半径 0.09。軸は鉢の左手前の土に刺さる
    SEEDLING_START: [0.02, 0.0, 0.45],// 最初にポット苗が置いてある床の点（ポット底の中心）
    PLANT_TOP_Y: 1.32                  // 育ちきった株のてっぺんの y
  };
})();
