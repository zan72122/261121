/* 10_world.js — ベランダの世界：床・腰壁・手すり・空（太陽/月/星/雲）・遠景・光・環境マップ・
   立水栓・水受けパン・素焼きの丸鉢・伏せたブリキのバケツ・かざぐるま・床の濡れじみ。
   G.World.create(scene, renderer, quality) → world */
(function () {
  'use strict';
  var U = G.U, L = G.L;
  var World = G.World = {};

  function V3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

  /* 任意サイズの画素キャンバスを複数同時に作る。fn(x, y, u, v, outs) outs[k] = [r,g,b,a]
     generator（1行ごとに yield）。下書き（U.Q > 1）では画素を間引き、x, y は本来の大きさの画素座標で渡す */
  function* pixels(w0, h0, n, fn) {
    var w = U.qsize(w0), h = U.qsize(h0), qx = w0 / w, qy = h0 / h;
    var cs = [], ctxs = [], imgs = [], outs = [], k;
    for (k = 0; k < n; k++) {
      var c = U.makeCanvas(w, h); c._q = qx; cs.push(c); var cx = c.getContext('2d'); ctxs.push(cx);
      imgs.push(cx.createImageData(w, h)); outs.push([0, 0, 0, 255]);
    }
    for (var y = 0; y < h; y++) {
      var yy = qy > 1 ? Math.floor((y + 0.5) * qy) : y;
      for (var x = 0; x < w; x++) {
        for (k = 0; k < n; k++) { var o = outs[k]; o[0] = o[1] = o[2] = 0; o[3] = 255; }
        fn(qx > 1 ? Math.floor((x + 0.5) * qx) : x, yy, (x + 0.5) / w, (y + 0.5) / h, outs);
        var i = (y * w + x) * 4;
        for (k = 0; k < n; k++) { var d = imgs[k].data, oo = outs[k]; d[i] = oo[0]; d[i + 1] = oo[1]; d[i + 2] = oo[2]; d[i + 3] = oo[3]; }
      }
      yield;
    }
    for (k = 0; k < n; k++) ctxs[k].putImageData(imgs[k], 0, 0);
    return cs;
  }
  function b255(x) { return x <= 0 ? 0 : (x >= 1 ? 255 : (x * 255) | 0); }
  function setRGB(o, r, g, b) { o[0] = b255(r); o[1] = b255(g); o[2] = b255(b); }
  function setG(o, v) { o[0] = o[1] = o[2] = b255(v); }

  /* ───────────────────────── 手続きテクスチャ ───────────────────────── */
  function* floorTex(S, tileM) {
    // 下書き（間引き率 q）では、細かい粒は平均されて薄まり、細い目地は画素より細いので、幅を広げて淡く描く
    var q = U.Q, fq = 1 / Math.sqrt(q), jw = tileM / S * q;
    var cs = yield* pixels(S, S, 3, function (x, y, u, v, o) {
      var big = U.fbm(u * 2, v * 2, 3, 11, 2);
      var mid = U.fbm(u * 9, v * 9, 3, 23, 9);
      var fine = U.noise2(x * 0.5, y * 0.5, 31, S * 0.5);
      var g = U.hash2(x, y, 5), spk = U.hash2(x, y, 7);
      var j = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)) * tileM;
      var joint = q > 1 ? (1 - U.smooth(0.0, jw, j)) * 0.6 : 1 - U.smooth(0.0015, 0.004, j);
      var stain = U.smooth(0.56, 0.78, U.fbm(u * 4 + 3, v * 4 + 1, 4, 41, 4));
      var c = 0.63 + (big - 0.5) * 0.08 + (mid - 0.5) * 0.09 + ((fine - 0.5) * 0.06 + (g - 0.5) * 0.07) * fq;
      if (spk > 0.992) c -= 0.12 * fq; else if (spk < 0.006) c += 0.09 * fq;
      c -= stain * 0.035;
      c *= 1 - joint * 0.3;
      setRGB(o[0], c * 1.05, c * 1.0, c * 0.9 - stain * 0.01);
      var hh = 0.5 + (fine - 0.5) * 0.35 + (g - 0.5) * 0.22 + (mid - 0.5) * 0.25 - joint * 0.6;
      if (spk > 0.986) hh -= 0.25;
      setG(o[1], hh);
      setG(o[2], 0.86 + (g - 0.5) * 0.1 - stain * 0.14 + joint * 0.06);
    });
    return { map: cs[0], normal: (yield* U.heightToNormalG(cs[1], 1.4)), rough: cs[2] };
  }

  function* wallTex(W, H) {
    // 1.5m 幅 × 1.05m 高さ。横方向だけタイル
    var per = W / 2;
    var cs = yield* pixels(W, H, 2, function (x, y, u, v, o) {
      var hb = (1 - v) * 1.05; // 床からの高さ
      var sp = U.noise2(x / 2, y / 2, 3, per);
      var sp2 = U.noise2(x / 5, y / 5, 9, W / 5);
      var g = U.hash2(x, y, 13);
      var mott = U.fbm(u * 3, v * 2.1, 4, 17, 3);
      var c = 0.90 + (mott - 0.5) * 0.05 + (g - 0.5) * 0.025 + (sp - 0.5) * 0.02;
      // 下のほうの雨はね汚れ
      var dn = U.fbm(u * 18, v * 9, 3, 29, 18);
      var splash = (1 - U.smooth(0.0, 0.26, hb)) * (0.45 + 0.75 * dn);
      // 上からの雨だれ（縦すじ）
      var st = U.fbm(u * 60, v * 1.6, 3, 37, 60);
      var streak = U.smooth(0.6, 0.82, st) * U.smooth(0.25, 1.0, hb) * 0.6;
      var ao = 1 - U.smooth(0.0, 0.025, hb);
      c -= splash * 0.13 + streak * 0.07 + ao * 0.12;
      setRGB(o[0], c * 0.995, c * 0.985, c * 0.955 - splash * 0.02);
      setG(o[1], 0.5 + (sp - 0.5) * 0.5 + (sp2 - 0.5) * 0.35 + (g - 0.5) * 0.15);
    });
    return { map: cs[0], normal: (yield* U.heightToNormalG(cs[1], 1.0)) };
  }

  function* terracottaTex(W, H) {
    var cs = yield* pixels(W, H, 2, function (x, y, u, v, o) {
      var m = U.fbm(u * 8, v * 4, 4, 51, 8);
      var f = U.noise2(x / 1.5, y / 1.5, 53, W / 1.5);
      var g = U.hash2(x, y, 55);
      var salt = U.smooth(0.62, 0.8, U.fbm(u * 5 + 2, v * 3, 4, 57, 5)) * 0.5;
      var r = 0.70 + (m - 0.5) * 0.12 + (g - 0.5) * 0.05, gg = 0.39 + (m - 0.5) * 0.07 + (g - 0.5) * 0.03, b = 0.25 + (m - 0.5) * 0.05;
      if (g > 0.993) { r *= 0.7; gg *= 0.7; b *= 0.7; }
      r = U.lerp(r, 0.78, salt); gg = U.lerp(gg, 0.66, salt); b = U.lerp(b, 0.56, salt);
      setRGB(o[0], r, gg, b);
      var ring = Math.sin(v * 140) * 0.08;
      setG(o[1], 0.5 + (f - 0.5) * 0.4 + (g - 0.5) * 0.15 + ring);
    });
    return { map: cs[0], normal: (yield* U.heightToNormalG(cs[1], 1.0)) };
  }

  function* soilTex(S) {
    var cs = yield* pixels(S, S, 2, function (x, y, u, v, o) {
      var cl = U.fbm(u * 14, v * 14, 3, 61, 14);
      var fn = U.noise2(x / 1.6, y / 1.6, 63, S / 1.6);
      var g = U.hash2(x, y, 65), p = U.hash2(x >> 1, y >> 1, 67), bk = U.noise2(x / 3, y / 1.2, 69, S / 3);
      var c = 0.25 + (cl - 0.5) * 0.18 + (fn - 0.5) * 0.12 + (g - 0.5) * 0.06;
      var pore = U.smooth(0.42, 0.3, cl);
      c *= 1 - pore * 0.5;
      var r = c * 1.18, gg = c * 0.92, b = c * 0.70;
      if (bk > 0.82) { r = 0.36; gg = 0.24; b = 0.15; } // 樹皮のかけら
      var white = 0;
      if (p > 0.988) { white = 1; r = 0.82; gg = 0.80; b = 0.76; } // パーライトの白い粒
      setRGB(o[0], r, gg, b);
      setG(o[1], 0.45 + (cl - 0.5) * 0.5 + (fn - 0.5) * 0.4 + white * 0.25 - pore * 0.2);
    });
    return { map: cs[0], normal: (yield* U.heightToNormalG(cs[1], 2.0)) };
  }

  function* zincTex(S) {
    var N = 12, pts = [], i, j;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) pts.push([(i + U.hash2(i, j, 71)) / N, (j + U.hash2(i, j, 73)) / N, U.hash2(i, j, 75), U.hash2(i, j, 77)]);
    var cs = yield* pixels(S, S, 2, function (x, y, u, v, o) {
      var ci = Math.floor(u * N), cj = Math.floor(v * N), best = 9, sec = 9, val = 0, val2 = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
        if (ii < 0) { ii += N; ox = -1; } else if (ii >= N) { ii -= N; ox = 1; }
        if (jj < 0) { jj += N; oy = -1; } else if (jj >= N) { jj -= N; oy = 1; }
        var p = pts[jj * N + ii], dx = p[0] + ox - u, dy = p[1] + oy - v, d = dx * dx + dy * dy;
        if (d < best) { sec = best; best = d; val = p[2]; val2 = p[3]; } else if (d < sec) sec = d;
      }
      var edge = U.smooth(0.0, 0.0006, Math.sqrt(sec) - Math.sqrt(best));
      var fern = U.noise2(x / 2, y / 2, 79, S / 2);
      var c = 0.84 + val * 0.08 + (fern - 0.5) * 0.04 * val2;
      c *= 0.93 + 0.07 * edge;
      setRGB(o[0], c, c * 1.005, c * 1.02);
      setG(o[1], 0.34 + val2 * 0.14 + (1 - edge) * 0.06);
    });
    return { map: cs[0], rough: cs[1] };
  }

  function* stoneTex(S) {
    var cs = yield* pixels(S, S, 1, function (x, y, u, v, o) {
      var m = U.fbm(u * 6, v * 6, 3, 81, 6), g = U.hash2(x, y, 83), s = U.hash2(x >> 1, y >> 1, 85);
      var c = 0.62 + (m - 0.5) * 0.08 + (g - 0.5) * 0.1;
      if (s > 0.94) c -= 0.25; else if (s < 0.05) c += 0.12;
      setRGB(o[0], c, c * 0.99, c * 0.97);
    });
    return { map: cs[0] };
  }

  function* brushedTex(S) {
    var cs = yield* pixels(S, S, 1, function (x, y, u, v, o) {
      var col = U.noise2(x * 0.7, y * 0.02, 91, S * 0.7) * 0.6 + U.hash2(x, 0, 93) * 0.4;
      setG(o[0], 0.22 + col * 0.16);
    });
    return { rough: cs[0] };
  }

  function* bumpsTex() {
    var cs = yield* pixels(32, 32, 1, function (x, y, u, v, o) {
      var h = 0;
      for (var k = 0; k < 4; k++) {
        var cx = (k % 2) * 0.5 + 0.25, cy = (k < 2 ? 0.25 : 0.75), sh = (k < 2 ? 0 : 0.25);
        var dx = ((u - cx - sh + 1.5) % 1) - 0.5, dy = v - cy, d = Math.sqrt(dx * dx * 4 + dy * dy * 4);
        h = Math.max(h, 1 - U.smooth(0.0, 0.32, d));
      }
      setG(o[0], 0.3 + h * 0.6);
    });
    return { normal: (yield* U.heightToNormalG(cs[0], 2.5)) };
  }

  /* ───────────────────────── 時刻の表 ───────────────────────── */
  // 色は sRGB の 16 進。zen/hor: 空, glow: 太陽まわりの光, sun: 平行光の色, hs/hg: 半球光, far: 遠景の明るさ
  var KEYS = [
    { t: 0.00, zen: 0x0b1733, hor: 0x23365a, glow: 0x000000, cloud: 0x2a3550, sun: 0xa9bde6, sunI: 0.55, hs: 0x5a6c9a, hg: 0x2a2c34, hI: 1.0, exp: 1.25, night: 1, far: 0x1b2232, haze: 0.18, cover: 0.62, env: 1.0 },
    { t: 0.19, zen: 0x0b1733, hor: 0x23365a, glow: 0x000000, cloud: 0x2a3550, sun: 0xa9bde6, sunI: 0.55, hs: 0x5a6c9a, hg: 0x2a2c34, hI: 1.0, exp: 1.25, night: 1, far: 0x1b2232, haze: 0.18, cover: 0.62, env: 1.0 },
    { t: 0.235, zen: 0x253c6c, hor: 0x9a8496, glow: 0xb86a58, cloud: 0x7a6a80, sun: 0xb8b4d0, sunI: 0.35, hs: 0x77809e, hg: 0x3a3634, hI: 1.0, exp: 1.3, night: 0.6, far: 0x40404e, haze: 0.35, cover: 0.6, env: 1.0 },
    { t: 0.265, zen: 0x6688c8, hor: 0xf6b89c, glow: 0xffb27a, cloud: 0xf6c4b4, sun: 0xffb682, sunI: 1.9, hs: 0xd0bcc4, hg: 0x6e6056, hI: 0.75, exp: 1.08, night: 0.12, far: 0x8a8078, haze: 0.45, cover: 0.58, env: 1.0 },
    { t: 0.30, zen: 0x4a88dc, hor: 0xb4cfe8, glow: 0xfff0d6, cloud: 0xffffff, sun: 0xfff0dc, sunI: 3.0, hs: 0xcadcf0, hg: 0x8e857a, hI: 0.7, exp: 1.0, night: 0, far: 0xc8c6c0, haze: 0.42, cover: 0.58, env: 1.0 },
    { t: 0.50, zen: 0x3f7fd8, hor: 0xb0cdec, glow: 0xfffaf0, cloud: 0xffffff, sun: 0xfffaf2, sunI: 3.3, hs: 0xc6dcf4, hg: 0x908a80, hI: 0.7, exp: 0.95, night: 0, far: 0xd8d8d4, haze: 0.40, cover: 0.6, env: 1.0 },
    { t: 0.64, zen: 0x5a8bcc, hor: 0xe4dccc, glow: 0xffe2b4, cloud: 0xfff4e4, sun: 0xffe6c4, sunI: 3.0, hs: 0xd4d8e0, hg: 0x8e8070, hI: 0.75, exp: 1.0, night: 0, far: 0xb8b0a4, haze: 0.42, cover: 0.6, env: 1.0 },
    { t: 0.72, zen: 0x46609e, hor: 0xffa060, glow: 0xff8a3c, cloud: 0xffb48c, sun: 0xffa45c, sunI: 2.7, hs: 0xffa86c, hg: 0x7a5038, hI: 1.35, exp: 1.05, night: 0, far: 0x4a3430, haze: 0.30, cover: 0.58, env: 1.0 },
    { t: 0.77, zen: 0x2c3c72, hor: 0xd8785c, glow: 0xe2603a, cloud: 0xc07070, sun: 0xff7a48, sunI: 0.7, hs: 0x9e7c96, hg: 0x3c3038, hI: 0.95, exp: 1.25, night: 0.3, far: 0x3a2e36, haze: 0.3, cover: 0.6, env: 1.0 },
    { t: 0.82, zen: 0x13234e, hor: 0x46486e, glow: 0x50283a, cloud: 0x3a3a58, sun: 0xa9bde6, sunI: 0.45, hs: 0x55628c, hg: 0x24242a, hI: 0.9, exp: 1.2, night: 0.8, far: 0x22263a, haze: 0.22, cover: 0.62, env: 1.0 },
    { t: 0.86, zen: 0x0b1733, hor: 0x23365a, glow: 0x000000, cloud: 0x2a3550, sun: 0xa9bde6, sunI: 0.55, hs: 0x5a6c9a, hg: 0x2a2c34, hI: 1.0, exp: 1.25, night: 1, far: 0x1b2232, haze: 0.18, cover: 0.62, env: 1.0 },
    { t: 1.00, zen: 0x0b1733, hor: 0x23365a, glow: 0x000000, cloud: 0x2a3550, sun: 0xa9bde6, sunI: 0.55, hs: 0x5a6c9a, hg: 0x2a2c34, hI: 1.0, exp: 1.25, night: 1, far: 0x1b2232, haze: 0.18, cover: 0.62, env: 1.0 }
  ];
  var CKEYS = ['zen', 'hor', 'glow', 'cloud', 'sun', 'hs', 'hg', 'far'];
  var NKEYS = ['sunI', 'hI', 'exp', 'night', 'haze', 'cover', 'env'];
  KEYS.forEach(function (k) { CKEYS.forEach(function (n) { k[n] = new THREE.Color(k[n]); }); });

  // 平行光（太陽）の向き
  var SUN_KEYS = [
    [0.00, [0.0, -1, 0.05]], [0.18, [-0.70, -0.30, 0.65]], [0.25, [-0.70, 0.0, 0.71]], [0.27, [-0.66, 0.10, 0.74]],
    [0.30, [-0.55, 0.55, 0.65]], [0.40, [-0.35, 0.85, 0.42]], [0.50, [-0.05, 0.96, 0.28]], [0.62, [0.30, 0.65, -0.70]],
    [0.72, [0.45, 0.12, -0.88]], [0.77, [0.46, 0.0, -0.89]], [0.84, [0.45, -0.3, -0.84]], [1.00, [0.0, -1, 0.05]]
  ];
  // 空に描く太陽の円盤の向き（縦画面でも夕日が家並みの向こうに見えるよう、前寄りに描く）
  var SUNVIS_KEYS = [
    [0.00, [0.0, -1, 0.05]], [0.18, [-0.70, -0.30, 0.65]], [0.25, [-0.70, 0.0, 0.71]], [0.27, [-0.66, 0.10, 0.74]],
    [0.30, [-0.55, 0.55, 0.65]], [0.50, [-0.05, 0.96, 0.28]], [0.60, [0.08, 0.55, -0.83]], [0.68, [0.075, 0.17, -0.98]],
    [0.72, [0.07, 0.085, -0.99]], [0.765, [0.065, -0.005, -1]], [0.80, [0.06, -0.06, -1]], [0.84, [0.45, -0.3, -0.84]], [1.00, [0.0, -1, 0.05]]
  ];
  var MOON_LIGHT = new THREE.Vector3(-0.28, 0.62, -0.73).normalize();

  function lerpKeys(keys, t, out) {
    for (var i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i][0] && t <= keys[i + 1][0]) {
        var a = keys[i], b = keys[i + 1], f = (t - a[0]) / (b[0] - a[0]);
        out.set(U.lerp(a[1][0], b[1][0], f), U.lerp(a[1][1], b[1][1], f), U.lerp(a[1][2], b[1][2], f)).normalize();
        return out;
      }
    }
    return out;
  }

  /* ───────────────────────── GLSL ───────────────────────── */
  var NOISE_GLSL = [
    'float hsh(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
    'float vno(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hsh(i),hsh(i+vec2(1.0,0.0)),u.x), mix(hsh(i+vec2(0.0,1.0)),hsh(i+vec2(1.0,1.0)),u.x), u.y); }',
    'float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<OCT;i++){ s+=a*vno(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }',
    'float cloudAt(vec3 d, float tm, float cover){',
    '  vec2 uv = d.xz/(max(d.y,0.0)+0.14);',
    '  uv = uv*vec2(0.55,1.1) + vec2(tm*0.006, tm*0.002);',
    '  float n = fbm(uv);',
    '  float c = smoothstep(cover, cover+0.28, n);',
    '  return c*smoothstep(-0.01,0.05,d.y);',
    '}'
  ].join('\n');

  var SKY_VS = 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }';
  var SKY_FS = [
    'uniform vec3 uZen, uHor, uGlow, uCloud, uSunVis, uMoon, uSunCol;',
    'uniform float uTime, uNight, uCover, uSunAmt;',
    'varying vec3 vW;',
    NOISE_GLSL,
    'void main(){',
    '  vec3 d = normalize(vW - cameraPosition);',
    '  float h = d.y;',
    '  float k = pow(smoothstep(-0.02, 0.42, h), 0.7);',
    '  vec3 col = mix(uHor, uZen, k);',
    '  col = mix(col, uHor*0.7, smoothstep(0.0,-0.1,h));',
    '  float mu = max(dot(d, uSunVis), 0.0);',
    '  float hz = 1.0 - smoothstep(0.0, 0.5, h);',
    '  col += uGlow * (pow(mu, 5.0)*0.45*(0.4+0.6*hz) + pow(mu, 60.0)*0.9 + pow(mu, 900.0)*3.0);',
    '  float disc = smoothstep(0.99994, 0.99997, dot(d, uSunVis)) * smoothstep(-0.012, 0.0, h);',
    '  vec3 sunDisc = mix(vec3(1.0,0.45,0.18), vec3(1.0,0.95,0.86), smoothstep(0.02,0.25,uSunVis.y)) * 40.0 * uSunAmt;',
    '  float mm = dot(d, uMoon);',
    '  float md = smoothstep(0.99994, 0.99995, mm);',
    '  vec3 mx = normalize(cross(uMoon, vec3(0.0,1.0,0.0))); vec3 my = cross(mx, uMoon);',
    '  vec2 mp = vec2(dot(d,mx), dot(d,my))*90.0;',
    '  col += vec3(0.25,0.3,0.42)*pow(max(mm,0.0), 400.0)*0.25*uNight;',
    '  float c = cloudAt(d, uTime, uCover);',
    // 月の模様と雲の細部は、それが見える画素だけで計算する（結果は同じ。空の大半で重いノイズを省く）
    '  float mA = md*smoothstep(0.3,0.8,uNight)*(1.0-c*0.85);',
    '  if (mA > 0.0) {',
    '    float maria = vno(mp*0.9+3.0)*0.6 + vno(mp*2.1)*0.4;',
    '    vec3 moonC = vec3(1.05,1.03,0.96)*(0.75+0.35*maria);',
    '    col = mix(col, moonC*2.2, mA);',
    '  }',
    '  if (c > 0.0) {',
    '    float c2 = fbm(d.xz/(max(h,0.0)+0.14)*2.3 + uTime*0.01);',
    '    vec3 cc = uCloud*(0.72+0.38*c2) + uGlow*pow(mu,4.0)*0.8;',
    '    col = mix(col, cc, c*0.78);',
    '  }',
    '  col += sunDisc*disc*(1.0-c*0.7);',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var ENV_FS = [
    'uniform vec3 uZen, uHor, uGlow, uSun, uGround;',
    'varying vec3 vW;',
    'void main(){',
    '  vec3 d = normalize(vW);',
    '  float h = d.y;',
    '  vec3 col = mix(uHor, uZen, pow(smoothstep(0.0, 0.7, h), 0.7));',
    '  float mu = max(dot(d, normalize(uSun)), 0.0);',
    '  col += uGlow*(pow(mu,6.0)*0.5);',
    '  col += uGlow*pow(mu, 400.0)*25.0;',
    '  col = mix(col, uGround, smoothstep(0.02, -0.08, h));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var STAR_VS = [
    'attribute float aSize; attribute float aSeed; attribute float aIdx;',
    'uniform float uTime, uNight, uCover, uFlare, uFlareIdx, uPR;',
    'varying float vB; varying float vF; varying vec3 vC;',
    NOISE_GLSL,
    'void main(){',
    '  vec3 d = normalize(position);',
    '  float cl = cloudAt(d, uTime, uCover);',
    '  float tw = 0.65 + 0.35*sin(uTime*(2.0+aSeed*5.0) + aSeed*40.0) * sin(uTime*(1.3+aSeed*3.1) + aSeed*17.0);',
    '  float f = (abs(aIdx - uFlareIdx) < 0.5) ? uFlare : 0.0;',
    '  vF = f;',
    '  vB = (aSize*0.5)*tw*(1.0-cl*0.92)*uNight*smoothstep(0.0, 0.05, d.y) + f*3.0;',
    '  vC = mix(vec3(0.8,0.88,1.0), vec3(1.0,0.9,0.75), fract(aSeed*7.3));',
    '  vec4 mv = modelViewMatrix*vec4(position,1.0);',
    '  gl_Position = projectionMatrix*mv;',
    '  gl_PointSize = (2.0 + aSize*1.6 + f*18.0)*uPR;',
    '}'
  ].join('\n');
  var STAR_FS = [
    'varying float vB; varying float vF; varying vec3 vC;',
    'void main(){',
    '  vec2 p = gl_PointCoord - 0.5;',
    '  float r = length(p);',
    '  float a = smoothstep(0.5, 0.0, r); a = a*a;',
    '  float spike = vF * (smoothstep(0.05,0.0,abs(p.x))+smoothstep(0.05,0.0,abs(p.y))) * smoothstep(0.5,0.0,r);',
    '  vec3 c = vC*vB*(a + spike*0.6);',
    '  gl_FragColor = vec4(c, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var BAND_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  var BAND_FS = [
    'uniform sampler2D map; uniform sampler2D winMap;',
    'uniform vec3 uLight, uHaze; uniform float uHazeAmt, uNight;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 c = texture2D(map, vUv);',
    '  if (c.a < 0.02) discard;',
    '  vec3 col = c.rgb*uLight;',
    '  col = mix(col, uHaze, uHazeAmt);',
    '  col += texture2D(winMap, vUv).rgb * uNight * 1.5;',
    '  gl_FragColor = vec4(col, c.a);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  /* ───────────────────────── 遠景の絵 ───────────────────────── */
  // s: 絵の縮尺（遠くに見せるため小さく描く）, y0: 壁の上端に隠れる線の高さ（実寸）。絵の中の高さ 0 がその線
  function paintBand(W, H, yb, yt, arcLen, seed, far, s, y0) {
    var rnd = U.rng(seed);
    var cc = U.makeCanvas(W, H), cw = U.makeCanvas(W, H);
    var c = cc.getContext('2d'), w = cw.getContext('2d');
    w.fillStyle = '#000'; w.fillRect(0, 0, W, H);
    var sx = W / arcLen * s, sy = H / (yt - yb) * s;
    arcLen = arcLen / s; yb = -40;
    function X(m) { return m * sx; }
    function Y(y) { return (yt - y0) * sy / s - y * sy; }
    function pick(a) { return a[(rnd() * a.length) | 0]; }
    function win(x0, y0, ww, hh, p) {
      // 昼の窓（ガラス）と、夜に灯る窓
      c.fillStyle = pick(['#5d6974', '#6a7680', '#55606a', '#7a8590']);
      c.fillRect(X(x0), Y(y0 + hh), Math.max(1, ww * sx), Math.max(1, hh * sy));
      if (rnd() < p) {
        w.fillStyle = pick(['#ffcf8c', '#ffd9a0', '#ffe8c8', '#f4f0e6', '#ffc070']);
        w.globalAlpha = 0.55 + rnd() * 0.45;
        w.fillRect(X(x0), Y(y0 + hh), Math.max(1, ww * sx), Math.max(1, hh * sy));
        w.globalAlpha = 1;
      }
    }
    function tree(cx, top, rad, col) {
      var n = 7 + ((rnd() * 8) | 0);
      for (var i = 0; i < n; i++) {
        var a = rnd() * Math.PI * 2, rr = rad * (0.3 + rnd() * 0.6);
        var px = cx + Math.cos(a) * rad * 0.7, py = top - rad + Math.sin(a) * rad * 0.5 - rnd() * rad * 0.5;
        c.fillStyle = col[(rnd() * col.length) | 0];
        c.beginPath(); c.ellipse(X(px), Y(py), rr * sx, rr * sy, 0, 0, Math.PI * 2); c.fill();
      }
      c.fillRect(X(cx - rad * 0.8), Y(top - rad * 1.2), rad * 1.6 * sx, (top - rad * 1.2 - yb) * sy);
    }
    var greens = ['#3e5236', '#46603c', '#364a30', '#52663f', '#2f4229'];
    var m;
    if (far) {
      // 遠い山なみ
      c.fillStyle = '#8c98a4';
      c.beginPath(); c.moveTo(0, H);
      for (m = 0; m <= arcLen; m += 1) c.lineTo(X(m), Y(3.5 + U.fbm(m / 30, 0.5, 4, seed) * 7));
      c.lineTo(W, H); c.closePath(); c.fill();
      c.fillStyle = '#a2a8ac'; c.fillRect(0, Y(1.2), W, H);
      for (m = 0; m < arcLen;) {
        var bw = 10 + rnd() * 26, top = 1.5 + Math.pow(rnd(), 1.8) * 11;
        if (rnd() < 0.25) { m += bw * 0.4; continue; }
        c.fillStyle = pick(['#c4c4c0', '#b8b6b0', '#cfcac0', '#a8acb0', '#d6d4ce', '#b0a89e']);
        c.fillRect(X(m), Y(top), bw * sx, (top - yb) * sy);
        c.fillStyle = 'rgba(0,0,0,0.10)'; c.fillRect(X(m + bw * 0.8), Y(top), bw * 0.2 * sx, (top - yb) * sy);
        for (var fy = top - 0.9; fy > -1.5; fy -= 0.75) {
          c.fillStyle = 'rgba(70,80,90,0.25)'; c.fillRect(X(m), Y(fy), bw * sx, Math.max(1, 0.2 * sy));
          for (var fx = m + 0.6; fx < m + bw - 0.8; fx += 1.4) if (rnd() < 0.3) { w.fillStyle = pick(['#ffd8a0', '#ffe8c8', '#f6f2ea']); w.globalAlpha = 0.5 + rnd() * 0.5; w.fillRect(X(fx), Y(fy + 0.35), Math.max(1, 0.8 * sx), Math.max(1, 0.4 * sy)); w.globalAlpha = 1; }
        }
        m += bw + rnd() * 6;
      }
      for (m = 0; m < arcLen; m += 8 + rnd() * 20) tree(m, 1.0 + rnd() * 2.2, 2 + rnd() * 3, ['#5c6a58', '#66725e', '#56624f']);
    } else {
      c.fillStyle = '#5a5650'; c.fillRect(0, Y(1.0), W, H);
      for (m = -3; m < arcLen;) {
        var r = rnd();
        if (r < 0.58) {
          var hw = 7 + rnd() * 6, eave = 1.6 + rnd() * 1.8, rh = 1.4 + rnd() * 1.2;
          var wallC = pick(['#d8d0c0', '#c8c0b2', '#e0dcd2', '#b8b0a4', '#cfc6b4', '#a89c8c']);
          var roofC = pick(['#4a4e56', '#3e444e', '#5a4a40', '#6a6460', '#3a3f46', '#55606c']);
          c.fillStyle = wallC; c.fillRect(X(m), Y(eave), hw * sx, (eave - yb) * sy);
          win(m + 1.2, eave - 1.3, 1.6, 0.9, 0.45); win(m + hw - 3.0, eave - 1.3, 1.2, 0.9, 0.35);
          c.fillStyle = roofC; c.beginPath();
          if (rnd() < 0.5) { // 切妻を正面に
            c.moveTo(X(m - 0.4), Y(eave)); c.lineTo(X(m + hw / 2), Y(eave + rh)); c.lineTo(X(m + hw + 0.4), Y(eave));
          } else { // 寄棟
            c.moveTo(X(m - 0.4), Y(eave)); c.lineTo(X(m + hw * 0.3), Y(eave + rh * 0.8)); c.lineTo(X(m + hw * 0.7), Y(eave + rh * 0.8)); c.lineTo(X(m + hw + 0.4), Y(eave));
          }
          c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(X(m - 0.4), Y(eave), (hw + 0.8) * sx, Math.max(1, 0.15 * sy));
          if (rnd() < 0.3) { c.fillStyle = '#6a6a68'; c.fillRect(X(m + hw * 0.7), Y(eave + rh * 0.8 + 0.8), 0.25 * sx, 0.8 * sy); }
          m += hw + rnd() * 2.5;
        } else if (r < 0.85) {
          var tr = 2.0 + rnd() * 2.0;
          tree(m + tr, 3.6 + rnd() * 3.2, tr, greens);
          m += tr * 1.6;
        } else {
          // 低いアパート（2階建て）
          var aw = 14 + rnd() * 8, at = 3.6 + rnd() * 2.0;
          c.fillStyle = pick(['#d4d0c8', '#c8c4ba', '#bcb8ae']); c.fillRect(X(m), Y(at), aw * sx, (at - yb) * sy);
          c.fillStyle = '#7a7874'; c.fillRect(X(m), Y(at), aw * sx, Math.max(1, 0.25 * sy));
          for (var ax = m + 1; ax < m + aw - 2; ax += 3.2) { win(ax, at - 1.4, 1.8, 0.9, 0.4); win(ax, at - 3.9, 1.8, 0.9, 0.4); }
          m += aw + rnd() * 3;
        }
      }
      // 電柱と電線
      var poles = [];
      for (m = 6 + rnd() * 8; m < arcLen; m += 26 + rnd() * 14) poles.push(m);
      c.fillStyle = '#5e5c5a';
      poles.forEach(function (p) {
        var top = 8.4 + rnd() * 0.6;
        c.fillRect(X(p - 0.14), Y(top), Math.max(1.5, 0.28 * sx), (top - yb) * sy);
        c.fillRect(X(p - 0.9), Y(top - 0.45), 1.8 * sx, Math.max(1, 0.12 * sy));
        if (rnd() < 0.4) c.fillRect(X(p + 0.15), Y(top - 1.3), 0.6 * sx, 0.7 * sy);
      });
      c.strokeStyle = 'rgba(50,50,52,0.75)'; c.lineWidth = 1;
      for (var i = 0; i < poles.length - 1; i++) {
        var a = poles[i], b = poles[i + 1];
        [8.2, 7.95, 7.3].forEach(function (hy, k) {
          var oy = (k === 0 ? -0.7 : (k === 1 ? 0.7 : 0));
          c.beginPath(); c.moveTo(X(a + oy * 0.5), Y(hy)); c.quadraticCurveTo(X((a + b) / 2), Y(hy - 0.9), X(b + oy * 0.5), Y(hy)); c.stroke();
        });
      }
    }
    return { color: cc, win: cw };
  }

  /* ───────────────────────── 本体 ───────────────────────── */
  World.create = function (scene, renderer, quality) {
    quality = quality || { low: false, shadows: true, shadowSize: 1024, particles: 500 };
    var low = !!quality.low;
    var world = {};
    var aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
    renderer.shadowMap.enabled = !!quality.shadows;
    if (quality.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    function T(canvas, srgb, rx, ry) {
      var t = U.tex(canvas, { srgb: srgb, repeat: (rx ? [rx, ry || rx] : null), aniso: aniso });
      return t;
    }
    function mesh(geo, mat, cast, recv) {
      var m = new THREE.Mesh(geo, mat); m.castShadow = !!cast && !!quality.shadows; m.receiveShadow = !!recv; return m;
    }

    /* ── 光 ── */
    var hemi = new THREE.HemisphereLight(0xcadcf0, 0x8e857a, 0.7); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    scene.add(sun); scene.add(sun.target);
    if (quality.shadows) {
      sun.castShadow = true;
      var ss = quality.shadowSize || 1024; sun.shadow.mapSize.set(ss, ss);
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.015;
      sun.shadow.radius = 3;
    }
    var SH_MIN = new THREE.Vector3(-1.3, 0, -0.7), SH_MAX = new THREE.Vector3(1.3, 1.7, 1.2);
    var SH_C = SH_MIN.clone().add(SH_MAX).multiplyScalar(0.5);
    var _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _p = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    function fitShadow(dir) {
      sun.position.copy(SH_C).addScaledVector(dir, 6);
      sun.target.position.copy(SH_C);
      sun.target.updateMatrixWorld();
      if (!quality.shadows) return;
      _bz.copy(dir);
      _bx.crossVectors(UP, _bz); if (_bx.lengthSq() < 1e-6) _bx.set(1, 0, 0); _bx.normalize();
      _by.crossVectors(_bz, _bx);
      var l = 1e9, r = -1e9, b = 1e9, t = -1e9, n = 1e9, f = -1e9;
      for (var i = 0; i < 8; i++) {
        _p.set(i & 1 ? SH_MAX.x : SH_MIN.x, i & 2 ? SH_MAX.y : SH_MIN.y, i & 4 ? SH_MAX.z : SH_MIN.z).sub(sun.position);
        var x = _p.dot(_bx), y = _p.dot(_by), z = -_p.dot(_bz);
        l = Math.min(l, x); r = Math.max(r, x); b = Math.min(b, y); t = Math.max(t, y); n = Math.min(n, z); f = Math.max(f, z);
      }
      var cam = sun.shadow.camera;
      cam.left = l - 0.02; cam.right = r + 0.02; cam.bottom = b - 0.02; cam.top = t + 0.02; cam.near = Math.max(0.05, n - 0.5); cam.far = f + 0.5;
      cam.updateProjectionMatrix();
    }

    /* ── 空のドーム ── */
    var OCT = low ? 3 : 5;
    var skyU = {
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() }, uSunVis: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
      uTime: { value: 0 }, uNight: { value: 0 }, uCover: { value: 0.6 }, uSunAmt: { value: 1 }
    };
    var skyMat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, defines: { OCT: OCT } });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), skyMat);
    // 不透明な物の後に描く（深度テストで、壁や床に隠れた画素の重い空の計算を省く。見た目は同じ）
    dome.renderOrder = 50; dome.frustumCulled = false; scene.add(dome);

    /* ── 星 ── */
    var starRnd = U.rng(4242), NS = 360, sPos = new Float32Array(NS * 3), sSize = new Float32Array(NS), sSeed = new Float32Array(NS), sIdx = new Float32Array(NS);
    var starDirs = [];
    for (var si = 0; si < NS; si++) {
      var az, el;
      if (si < 210) { az = (starRnd() * 2 - 1) * 0.55; el = 0.01 + starRnd() * 0.32; }
      else { az = (starRnd() * 2 - 1) * Math.PI; el = 0.01 + Math.asin(starRnd()) ; }
      var dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = -Math.cos(az) * Math.cos(el);
      var sd = new THREE.Vector3(dx, dy, dz); starDirs.push(sd);
      sPos[si * 3] = dx * 140; sPos[si * 3 + 1] = dy * 140; sPos[si * 3 + 2] = dz * 140;
      sSize[si] = Math.pow(starRnd(), 3.0) * 2.2 + 0.25; sSeed[si] = starRnd(); sIdx[si] = si;
    }
    var sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
    sGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 1));
    sGeo.setAttribute('aIdx', new THREE.BufferAttribute(sIdx, 1));
    var starU = { uTime: skyU.uTime, uNight: { value: 0 }, uCover: skyU.uCover, uFlare: { value: 0 }, uFlareIdx: { value: -1 }, uPR: { value: renderer.getPixelRatio() } };
    var starMat = new THREE.ShaderMaterial({ uniforms: starU, vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, defines: { OCT: OCT } });
    var stars = new THREE.Points(sGeo, starMat); stars.renderOrder = -9; stars.frustumCulled = false; scene.add(stars);

    /* ── 遠景（家並み・木・電柱） ── */
    var bandU = [];
    function band(R, yb, yt, seed, far, order, sc, y0) {
      var th = Math.PI * 2 / 3, arc = R * th;
      var W = low ? 1024 : 2048, Hh = low ? 128 : 256;
      var p = paintBand(W, Hh, yb, yt, arc, seed, far, sc, y0);
      var mt = T(p.color, true), wt = T(p.win, true);
      mt.anisotropy = wt.anisotropy = 1;
      var u = { map: { value: mt }, winMap: { value: wt }, uLight: { value: new THREE.Color(1, 1, 1) }, uHaze: { value: new THREE.Color() }, uHazeAmt: { value: 0.4 }, uNight: { value: 0 } };
      var mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BAND_VS, fragmentShader: BAND_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      var g = new THREE.CylinderGeometry(R, R, yt - yb, 96, 1, true, Math.PI - th / 2, th);
      var m = new THREE.Mesh(g, mat); m.position.set(0, (yt + yb) / 2, 3); m.renderOrder = order; m.frustumCulled = false;
      // カメラの高さ・距離が変わっても、手すりの上端をかすめる視線が絵の「高さ 0」に当たるよう帯を上下させる
      var baseY = (yt + yb) / 2;
      m.onBeforeRender = function (rn, sc2, cam) {
        var cy = cam.position.y, cz = cam.position.z;
        var slope = (cy - 1.16) / Math.max(0.5, cz + 0.6);
        var yLine = cy - slope * (cz - 3 + R);
        m.position.y = baseY + (yLine - y0);
        m.updateMatrixWorld();
      };
      scene.add(m); u.far = far; bandU.push(u);
    }
    band(110, -4, 14, 777, true, -8, 0.42, -1.2);
    band(55, -3, 7, 333, false, -7, 0.32, 0.0);

    /* ── 環境マップ（空の色の簡単なシーン） ── */
    var pmrem = new THREE.PMREMGenerator(renderer);
    var envU = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uGround: { value: new THREE.Color() } };
    var envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: envU, vertexShader: SKY_VS, fragmentShader: ENV_FS, side: THREE.BackSide, depthWrite: false })));
    var envRT = null, envKey = -1, envTimer = 0, envDirty = true;
    // 作り直しのたびに新しい描画先を確保しない（同じものに描き直す）。GPU のメモリ確保と、材質の環境の差し替えを避ける
    var pmAlloc = pmrem._allocateTargets;
    if (typeof pmAlloc === 'function') {
      pmrem._allocateTargets = function () {
        if (envRT && this._pingPongRenderTarget && envRT.width === this._pingPongRenderTarget.width && envRT.height === this._pingPongRenderTarget.height) return envRT;
        return pmAlloc.call(this);
      };
    }
    function buildEnv() {
      var rt = pmrem.fromScene(envScene, 0.02, 0.1, 50);
      if (rt !== envRT) {
        scene.environment = rt.texture;
        if (envRT) envRT.dispose();
        envRT = rt;
      }
      envDirty = false; envTimer = 0;
    }

    /* ── 床 ── */
    var FT = 1.5, fS = low ? 256 : 512;
    var ft = U.prog(function () { return floorTex(fS, FT); });
    var floorW = 12, floorD = 8.6, floorCZ = (-0.6 + 8) / 2;
    var fmap = T(ft.map, true, floorW / FT, floorD / FT), fnor = T(ft.normal, false, floorW / FT, floorD / FT), frou = T(ft.rough, false, floorW / FT, floorD / FT);
    // 目地を x≈-0.95 / 0.55、z≈0.75 に寄せる
    var offU = 1 - (((-0.95 + 6) / FT) % 1), offV = 1 - (((0.5 - (0.75 - floorCZ) / floorD) * floorD / FT) % 1);
    [fmap, fnor, frou].forEach(function (t) { t.offset.set(offU, offV); });
    var floorMat = new THREE.MeshStandardMaterial({ map: fmap, normalMap: fnor, roughnessMap: frou, roughness: 1, metalness: 0, color: 0xe8e6e2 });
    floorMat.normalScale.set(0.6, 0.6);
    var floor = mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat, false, true);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, floorCZ); scene.add(floor);

    // 壁ぎわの汚れの帯と、物の足元の陰り
    (function () {
      var c = U.makeCanvas(512, 32), x = c.getContext('2d');
      var img = x.createImageData(512, 32), d = img.data;
      for (var j = 0; j < 32; j++) for (var i = 0; i < 512; i++) {
        var v = j / 31, n = U.fbm(i / 24, j / 6, 3, 101, 512 / 24);
        var a = Math.pow(1 - v, 2.2) * (0.55 + 0.6 * n);
        var k = (j * 512 + i) * 4; d[k] = d[k + 1] = d[k + 2] = b255(a); d[k + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      var t = T(c, false, 6, 1); t.wrapT = THREE.ClampToEdgeWrapping;
      var m = mesh(new THREE.PlaneGeometry(12, 0.3), new THREE.MeshStandardMaterial({ color: 0x2c2822, alphaMap: t, transparent: true, opacity: 0.38, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), false, true);
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.0008, -0.6 + 0.15); m.renderOrder = 1; scene.add(m);
      // 足元の陰り（x∈[-0.9,0.9], z∈[-0.6,0.3]）
      var c2 = U.makeCanvas(256, 128), x2 = c2.getContext('2d');
      x2.fillStyle = '#000'; x2.fillRect(0, 0, 256, 128);
      function blob(wx, wz, rx, rz, a) {
        var px = (wx + 0.9) / 1.8 * 256, pz = (wz + 0.6) / 0.9 * 128;
        var g = x2.createRadialGradient(px, pz, 0, px, pz, 1);
        g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(0.55, 'rgba(255,255,255,' + (a * 0.55) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x2.save(); x2.translate(px, pz); x2.scale(rx / 1.8 * 256, rz / 0.9 * 128); x2.translate(-px, -pz);
        x2.fillStyle = g; x2.beginPath(); x2.arc(px, pz, 1, 0, Math.PI * 2); x2.fill(); x2.restore();
      }
      blob(L.PLANTER[0], L.PLANTER[2], 0.24, 0.24, 0.8);
      blob(L.BUCKET[0], L.BUCKET[2], 0.155, 0.155, 0.8);
      blob(L.PAN[0], L.PAN[2], 0.27, 0.27, 0.55);
      var t2 = T(c2, false);
      var m2 = mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t2, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), false, false);
      m2.rotation.x = -Math.PI / 2; m2.position.set(0, 0.001, -0.15); m2.renderOrder = 1; scene.add(m2);
    })();

    /* ── 濡れたしみ ── */
    var WX0 = -1.3, WX1 = 1.1, WZ0 = -0.6, WZ1 = 0.9, WW = 128, WH = 96;
    var wetV = new Float32Array(WW * WH), wetN = new Float32Array(WW * WH);
    for (var wi = 0; wi < WW * WH; wi++) wetN[wi] = U.fbm((wi % WW) / 5, Math.floor(wi / WW) / 4, 4, 111);
    var wetC = U.makeCanvas(WW, WH), wetX = wetC.getContext('2d'), wetImg = wetX.createImageData(WW, WH);
    for (wi = 0; wi < WW * WH; wi++) wetImg.data[wi * 4 + 3] = 255;
    wetX.putImageData(wetImg, 0, 0);
    var wetT = U.tex(wetC, {}); wetT.anisotropy = 1;
    var wetMat = new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: 0.12, metalness: 0, alphaMap: wetT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    var wetMesh = mesh(new THREE.PlaneGeometry(WX1 - WX0, WZ1 - WZ0), wetMat, false, true);
    wetMesh.rotation.x = -Math.PI / 2; wetMesh.position.set((WX0 + WX1) / 2, 0.0015, (WZ0 + WZ1) / 2); wetMesh.renderOrder = 2; wetMesh.visible = false; scene.add(wetMesh);
    var wetAny = false, wetDirty = false, wetAcc = 0, wetRnd = U.rng(99);
    function splat(x, z, r, a) {
      var ci = (x - WX0) / (WX1 - WX0) * WW, cj = (z - WZ0) / (WZ1 - WZ0) * WH;
      var rx = r / (WX1 - WX0) * WW, rz = r / (WZ1 - WZ0) * WH;
      var i0 = Math.max(0, Math.floor(ci - rx * 2)), i1 = Math.min(WW - 1, Math.ceil(ci + rx * 2));
      var j0 = Math.max(0, Math.floor(cj - rz * 2)), j1 = Math.min(WH - 1, Math.ceil(cj + rz * 2));
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
        var dx = (i + 0.5 - ci) / rx, dz = (j + 0.5 - cj) / rz, e = Math.exp(-(dx * dx + dz * dz));
        var k = j * WW + i; wetV[k] = Math.min(1.6, wetV[k] + a * e);
      }
    }
    world.wetFloor = function (x, z, amount) {
      if (!(amount > 0)) return;
      if (x < WX0 - 0.1 || x > WX1 + 0.1 || z < WZ0 - 0.1 || z > WZ1 + 0.1) return;
      var a = Math.min(1.5, amount);
      splat(x, z, 0.045 + a * 0.03, a * 0.35);
      for (var k = 0; k < 2; k++) splat(x + (wetRnd() - 0.5) * 0.1, z + (wetRnd() - 0.5) * 0.08, 0.02 + wetRnd() * 0.025, a * 0.25);
      wetAny = true; wetDirty = true;
    };
    function updateWet(dt) {
      if (!wetAny) return;
      wetAcc += dt;
      if (wetAcc < 0.1) return;
      var dry = wetAcc / 40, any = false, d = wetImg.data;
      wetAcc = 0;
      for (var k = 0; k < WW * WH; k++) {
        var v = wetV[k];
        if (v > 0) { v -= dry; if (v < 0) v = 0; wetV[k] = v; any = true; }
        var a = (v - 0.32 * wetN[k]) * 7.0; a = a < 0 ? 0 : (a > 1 ? 1 : a);
        d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = (a * 230) | 0;
      }
      wetX.putImageData(wetImg, 0, 0); wetT.needsUpdate = true;
      wetMesh.visible = any; wetAny = any; wetDirty = false;
    }

    /* ── 腰壁・笠木・手すり ── */
    var wt = U.prog(function () { return wallTex(low ? 256 : 512, low ? 192 : 384); });
    var wallMat = new THREE.MeshStandardMaterial({ map: T(wt.map, true, 8, 1), normalMap: T(wt.normal, false, 8, 1), roughness: 0.93, metalness: 0, color: 0xf4f2ee });
    wallMat.normalScale.set(0.45, 0.45);
    var wallF = mesh(new THREE.PlaneGeometry(12, L.WALL_H), wallMat, false, true);
    wallF.position.set(0, L.WALL_H / 2, L.WALL_Z); scene.add(wallF);
    var wallBack = mesh(new THREE.BoxGeometry(12, L.WALL_H, 0.15), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95 }), false, false);
    wallBack.position.set(0, L.WALL_H / 2, L.WALL_Z - 0.0751); scene.add(wallBack);
    var alu = new THREE.MeshStandardMaterial({ color: 0xc4c6c6, metalness: 0.85, roughness: 0.36 });
    var coping = mesh(new THREE.BoxGeometry(12, 0.035, 0.22), alu, false, true);
    coping.position.set(0, L.WALL_H + 0.0175, L.WALL_Z - 0.085); scene.add(coping);
    var lip = mesh(new THREE.BoxGeometry(12, 0.05, 0.008), alu, false, true);
    lip.position.set(0, L.WALL_H + 0.01, L.WALL_Z + 0.029); scene.add(lip);
    var rail = mesh(new THREE.CylinderGeometry(0.021, 0.021, 12, 20, 1), alu, false, true);
    rail.rotation.z = Math.PI / 2; rail.scale.set(1, 1, 0.85); rail.position.set(0, 1.128, L.WALL_Z - 0.07); scene.add(rail);
    var postG = new THREE.BoxGeometry(0.022, 0.05, 0.03);
    for (var px = -5.5; px <= 5.6; px += 1.1) {
      var pm = mesh(postG, alu, false, false); pm.position.set(px + 0.12, 1.105, L.WALL_Z - 0.07); scene.add(pm);
    }
    // 隣との隔て板
    var panelMat = new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.6, metalness: 0 });
    var frameMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.4, metalness: 0.6 });
    [-2.3, 2.3].forEach(function (x) {
      var pn = mesh(new THREE.BoxGeometry(0.012, 1.75, 1.7), panelMat, false, true); pn.position.set(x, 0.08 + 0.875, L.WALL_Z + 0.85); scene.add(pn);
      var f1 = mesh(new THREE.BoxGeometry(0.04, 1.85, 0.04), frameMat, false, true); f1.position.set(x, 0.925, L.WALL_Z + 1.72); scene.add(f1);
      var f2 = mesh(new THREE.BoxGeometry(0.04, 0.04, 1.74), frameMat, false, true); f2.position.set(x, 1.85, L.WALL_Z + 0.87); scene.add(f2);
      var f3 = mesh(new THREE.BoxGeometry(0.04, 0.04, 1.74), frameMat, false, true); f3.position.set(x, 0.06, L.WALL_Z + 0.87); scene.add(f3);
    });

    /* ── 立水栓 ── */
    var bt = U.run(brushedTex(64));
    var steel = new THREE.MeshStandardMaterial({ color: 0xd2d4d6, metalness: 1, roughness: 1, roughnessMap: T(bt.rough, false, 1, 1) });
    var chrome = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, metalness: 1, roughness: 0.07 });
    var darkM = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 });
    var tapG = new THREE.Group(); scene.add(tapG);
    var TX = L.TAP_X, TZ = L.TAP_POST_Z;
    (function () {
      var s = new THREE.Shape(), a = 0.0325, r = 0.006;
      s.moveTo(-a + r, -a); s.lineTo(a - r, -a); s.quadraticCurveTo(a, -a, a, -a + r); s.lineTo(a, a - r); s.quadraticCurveTo(a, a, a - r, a);
      s.lineTo(-a + r, a); s.quadraticCurveTo(-a, a, -a, a - r); s.lineTo(-a, -a + r); s.quadraticCurveTo(-a, -a, -a + r, -a);
      var g = new THREE.ExtrudeGeometry(s, { depth: 0.85, bevelEnabled: false, curveSegments: 3 });
      g.rotateX(-Math.PI / 2);
      var post = mesh(g, steel, true, true); post.position.set(TX, 0, TZ); tapG.add(post);
      var cap = mesh(new THREE.BoxGeometry(0.069, 0.006, 0.069), steel, true, true); cap.position.set(TX, 0.853, TZ); tapG.add(cap);
      var base = mesh(new THREE.BoxGeometry(0.1, 0.008, 0.1), steel, false, true); base.position.set(TX, 0.004, TZ); tapG.add(base);
    })();
    var FY = 0.70, FZ0 = TZ + 0.0325;
    var esc = mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.008, 32), chrome, true, true); esc.rotation.x = Math.PI / 2; esc.position.set(TX, FY, FZ0 + 0.004); tapG.add(esc);
    var body = mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.09, 28), chrome, true, true); body.rotation.x = Math.PI / 2; body.position.set(TX, FY, FZ0 + 0.045); tapG.add(body);
    var bodyEnd = mesh(new THREE.SphereGeometry(0.0165, 24, 12), chrome, true, false); bodyEnd.position.set(TX, FY, FZ0 + 0.09); tapG.add(bodyEnd);
    var HZ = L.TAP_HANDLE[2], HY = 0.775;
    var bonnet = mesh(new THREE.CylinderGeometry(0.0145, 0.016, HY - FY - 0.008, 28), chrome, true, true); bonnet.position.set(TX, (FY + HY - 0.008) / 2, HZ); tapG.add(bonnet);
    var nut = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 6), chrome, true, true); nut.position.set(TX, FY + 0.02, HZ); tapG.add(nut);
    var spoutCurve = new THREE.CubicBezierCurve3(new THREE.Vector3(TX, FY, FZ0 + 0.085), new THREE.Vector3(TX, FY, L.TAP_OUT[2] - 0.02), new THREE.Vector3(TX, FY - 0.005, L.TAP_OUT[2]), new THREE.Vector3(TX, L.TAP_OUT[1] + 0.03, L.TAP_OUT[2]));
    var spout = mesh(new THREE.TubeGeometry(spoutCurve, 24, 0.011, 20, false), chrome, true, true); tapG.add(spout);
    var tip = mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.03, 24), chrome, true, true); tip.position.set(TX, L.TAP_OUT[1] + 0.015, L.TAP_OUT[2]); tapG.add(tip);
    var hole = mesh(new THREE.CircleGeometry(0.0085, 20), darkM, false, false); hole.rotation.x = Math.PI / 2; hole.position.set(TX, L.TAP_OUT[1] - 0.0005, L.TAP_OUT[2]); tapG.add(hole);
    // 十字ハンドル
    var handle = new THREE.Group(); handle.position.set(TX, HY, HZ); tapG.add(handle);
    var armG = new THREE.CapsuleGeometry(0.0068, 0.056, 6, 14); armG.rotateZ(Math.PI / 2);
    var arm1 = mesh(armG, chrome, true, false); arm1.scale.set(1, 0.85, 1); handle.add(arm1);
    var arm2 = mesh(armG, chrome, true, false); arm2.rotation.y = Math.PI / 2; arm2.scale.set(1, 0.85, 1); handle.add(arm2);
    var hub = mesh(new THREE.CylinderGeometry(0.0135, 0.015, 0.018, 28), chrome, true, false); hub.position.y = 0.001; handle.add(hub);
    var blue = mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.002, 24), new THREE.MeshStandardMaterial({ color: 0x1f5fc8, roughness: 0.3, metalness: 0.1 }), false, false);
    blue.position.y = 0.0105; handle.add(blue);
    world.tap = {
      handle: handle, handlePos: new THREE.Vector3(TX, HY, HZ), outlet: V3(L.TAP_OUT),
      setTurn: function (rad) { handle.rotation.y = rad; }
    };

    /* ── 水受けパン ── */
    (function () {
      var st = U.prog(function () { return stoneTex(low ? 128 : 256); });
      var sm = new THREE.MeshStandardMaterial({ map: T(st.map, true, 2.5, 2.5), roughness: 0.72, color: 0xf2f0ec });
      function rr(sh, a, r, hole) {
        sh.moveTo(-a + r, -a); sh.lineTo(a - r, -a); sh.quadraticCurveTo(a, -a, a, -a + r); sh.lineTo(a, a - r); sh.quadraticCurveTo(a, a, a - r, a);
        sh.lineTo(-a + r, a); sh.quadraticCurveTo(-a, a, -a, a - r); sh.lineTo(-a, -a + r); sh.quadraticCurveTo(-a, -a, -a + r, -a);
        return sh;
      }
      var outer = rr(new THREE.Shape(), 0.197, 0.025), inner = rr(new THREE.Path(), 0.172, 0.012);
      outer.holes.push(inner);
      var g = new THREE.ExtrudeGeometry(outer, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6 });
      g.rotateX(-Math.PI / 2);
      var rim = mesh(g, sm, false, true); rim.position.set(L.PAN[0], 0.003, L.PAN[2]); scene.add(rim);
      var bg = new THREE.ExtrudeGeometry(rr(new THREE.Shape(), 0.176, 0.014), { depth: 0.022, bevelEnabled: false, curveSegments: 6 });
      bg.rotateX(-Math.PI / 2);
      var bot = mesh(bg, sm, false, true); bot.position.set(L.PAN[0], 0, L.PAN[2]); scene.add(bot);
      var dr = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.002, 28), steel, false, true); dr.position.set(L.PAN[0] + 0.115, 0.0225, L.PAN[2] + 0.115); scene.add(dr);
      var slotG = new THREE.BoxGeometry(0.03, 0.0012, 0.0035);
      for (var k = -2; k <= 2; k++) { var s = mesh(slotG, darkM, false, false); s.scale.x = 1 - Math.abs(k) * 0.2; s.position.set(L.PAN[0] + 0.115, 0.0233, L.PAN[2] + 0.115 + k * 0.0075); scene.add(s); }
    })();

    /* ── 素焼きの丸鉢 ── */
    var tc = U.prog(function () { return terracottaTex(low ? 256 : 512, low ? 128 : 256); });
    var potMat = new THREE.MeshStandardMaterial({ map: T(tc.map, true, 2, 1), normalMap: T(tc.normal, false, 2, 1), roughness: 0.88, metalness: 0 });
    potMat.normalScale.set(0.3, 0.3);
    var planterG = new THREE.Group(); planterG.position.set(L.PLANTER[0], 0, L.PLANTER[2]); scene.add(planterG);
    function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg); }
    var potPts = [[0.001, 0.012], [0.132, 0.012], [0.136, 0.016], [0.140, 0.03], [0.165, 0.14], [0.186, 0.240], [0.188, 0.252], [0.196, 0.256], [0.2015, 0.262], [0.203, 0.27],
      [0.203, 0.293], [0.2005, 0.300], [0.196, 0.3025], [0.190, 0.3025], [0.1865, 0.299], [0.1855, 0.29], [0.1848, 0.27], [0.178, 0.22]];
    var pot = mesh(lathe(potPts, 64), potMat, true, true); planterG.add(pot);
    var saucerPts = [[0.001, 0.0], [0.150, 0.0], [0.156, 0.003], [0.168, 0.028], [0.172, 0.034], [0.170, 0.038], [0.165, 0.037], [0.162, 0.032], [0.152, 0.013], [0.14, 0.012], [0.001, 0.012]];
    var saucer = mesh(lathe(saucerPts, 64), potMat, true, true); planterG.add(saucer);
    // 土
    var sT = U.prog(function () { return soilTex(low ? 128 : 256); });
    var soilMap = T(sT.map, true, 1.5, 1.5), soilNor = T(sT.normal, false, 1.5, 1.5);
    var soilMat = new THREE.MeshStandardMaterial({ map: soilMap, normalMap: soilNor, roughness: 0.97, metalness: 0, vertexColors: true });
    var NR = 22, NSeg = 56, SR = L.SOIL_R;
    var soilGeo = new THREE.BufferGeometry();
    var sp = new Float32Array((NR * NSeg + 1) * 3), suv = new Float32Array((NR * NSeg + 1) * 2), scol = new Float32Array((NR * NSeg + 1) * 3), sidx = [];
    var sBaseR = new Float32Array(NR * NSeg + 1), sNoise = new Float32Array(NR * NSeg + 1);
    var hx = L.PLANT_BASE[0] - L.PLANTER[0], hz = L.PLANT_BASE[2] - L.PLANTER[2];
    sp[0] = 0; sp[1] = 0; sp[2] = 0; suv[0] = 0.5; suv[1] = 0.5;
    for (var ri = 1; ri <= NR; ri++) {
      var rr = SR * Math.pow(ri / NR, 1.35);
      for (var sj = 0; sj < NSeg; sj++) {
        var ang = sj / NSeg * Math.PI * 2, vi = 1 + (ri - 1) * NSeg + sj;
        var xx = Math.cos(ang) * rr, zz = Math.sin(ang) * rr;
        sp[vi * 3] = xx; sp[vi * 3 + 2] = zz; suv[vi * 2] = xx / (SR * 2) + 0.5; suv[vi * 2 + 1] = 0.5 - zz / (SR * 2);
        sNoise[vi] = (U.noise2(xx * 120 + 5, zz * 120 + 5, 121) - 0.5) * 0.004 * (ri < NR ? 1 : 0);
      }
    }
    for (var q = 0; q < NSeg; q++) sidx.push(0, 1 + (q + 1) % NSeg, 1 + q);
    for (ri = 1; ri < NR; ri++) for (q = 0; q < NSeg; q++) {
      var a0 = 1 + (ri - 1) * NSeg + q, a1 = 1 + (ri - 1) * NSeg + (q + 1) % NSeg, b0 = a0 + NSeg, b1 = a1 + NSeg;
      sidx.push(a0, a1, b1, a0, b1, b0);
    }
    soilGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    soilGeo.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
    soilGeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
    soilGeo.setIndex(sidx);
    var soil = mesh(soilGeo, soilMat, false, true); soil.position.y = L.SOIL_Y; planterG.add(soil);
    var holeV = -1;
    function setHole(h) {
      h = U.clamp01(h);
      if (Math.abs(h - holeV) < 0.002) return;
      holeV = h;
      var nv = NR * NSeg + 1;
      for (var i = 0; i < nv; i++) {
        var x = sp[i * 3], z = sp[i * 3 + 2], dx = x - hx, dz = z - hz, r = Math.sqrt(dx * dx + dz * dz), rw = Math.sqrt(x * x + z * z);
        var bowl = r < 0.047 ? Math.pow(1 - (r / 0.047) * (r / 0.047), 0.55) : 0;
        var mound = Math.exp(-Math.pow((r - 0.066) / 0.016, 2));
        var dome = 0.004 * (1 - (rw / SR) * (rw / SR));
        var edge = U.smooth(SR * 0.9, SR, rw);
        sp[i * 3 + 1] = (-0.06 * bowl + 0.009 * mound) * h + dome + sNoise[i] - edge * 0.003;
        var shade = 1 - 0.65 * bowl * h - 0.25 * edge;
        scol[i * 3] = scol[i * 3 + 1] = scol[i * 3 + 2] = shade;
      }
      soilGeo.attributes.position.needsUpdate = true; soilGeo.attributes.color.needsUpdate = true;
      soilGeo.computeVertexNormals();
    }
    setHole(1);
    var DRY = new THREE.Color(1.22, 1.08, 0.95), WET = new THREE.Color(0.40, 0.35, 0.33), POTWET = new THREE.Color(0.8, 0.74, 0.72);
    function setMoisture(m) {
      m = U.clamp01(m);
      soilMat.color.copy(DRY).lerp(WET, m);
      soilMat.roughness = U.lerp(0.97, 0.55, m);
      potMat.color.setRGB(1, 1, 1).lerp(POTWET, m * 0.35);
    }
    setMoisture(0);
    // 支柱（イボ竹）
    var bm = U.run(bumpsTex());
    var stakeLen = 1.38 - 0.17;
    var stakeMat = new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.38, metalness: 0.0, normalMap: T(bm.normal, false, 1, Math.round(stakeLen / 0.022)) });
    var stake = mesh(new THREE.CylinderGeometry(0.0055, 0.0055, stakeLen, 14, 1, true), stakeMat, true, true);
    stake.position.set(L.STAKE[0] - L.PLANTER[0], 0.17 + stakeLen / 2, L.STAKE[2] - L.PLANTER[2]); planterG.add(stake);
    var stakeCap = mesh(new THREE.SphereGeometry(0.0065, 14, 8), new THREE.MeshStandardMaterial({ color: 0x2a5a2c, roughness: 0.45 }), true, false);
    stakeCap.scale.y = 0.8; stakeCap.position.set(stake.position.x, 1.38, stake.position.z); planterG.add(stakeCap);
    world.planter = { group: planterG, center: V3(L.PLANT_BASE), soilY: L.SOIL_Y, soilR: L.SOIL_R, setMoisture: setMoisture, setHole: setHole };

    /* ── 伏せたブリキのバケツ ── */
    var zt = U.prog(function () { return zincTex(low ? 128 : 256); });
    var zincMat = new THREE.MeshStandardMaterial({ map: T(zt.map, true, 5, 2), roughnessMap: T(zt.rough, false, 5, 2), roughness: 1, metalness: 1, color: 0xc4c8ca });
    var bucketG = new THREE.Group(); bucketG.position.set(L.BUCKET[0], 0, L.BUCKET[2]); scene.add(bucketG);
    var bPts = [[0.106, 0.012], [0.1135, 0.0005], [0.1195, 0.002], [0.1215, 0.0065], [0.119, 0.0105], [0.1145, 0.0125], [0.1135, 0.02]];
    function bR(y) { return 0.1135 - (0.1135 - 0.0855) * (y - 0.02) / (0.196 - 0.02); }
    [0.052, 0.13].forEach(function (yy) { bPts.push([bR(yy - 0.006), yy - 0.006], [bR(yy) + 0.0028, yy], [bR(yy + 0.006), yy + 0.006]); });
    bPts.push([0.0855, 0.196], [0.0878, 0.1985], [0.0878, 0.2022], [0.0848, 0.2035], [0.0815, 0.2005], [0.0805, 0.1985], [0.001, 0.1985]);
    var bucket = mesh(lathe(bPts, 64), zincMat, true, true); bucketG.add(bucket);
    // 耳とつる（床に寝ている）
    [-1, 1].forEach(function (s) {
      var ear = mesh(new THREE.BoxGeometry(0.004, 0.03, 0.022), zincMat, true, true); ear.position.set(s * 0.115, 0.03, 0); ear.rotation.z = s * 0.15; bucketG.add(ear);
    });
        var ringAmp = 0, ringPh = 0;
    world.bucket = {
      group: bucketG, top: new THREE.Vector3(L.BUCKET[0], L.BUCKET_TOP_Y, L.BUCKET[2]), topR: 0.085,
      ring: function (s) { ringAmp = Math.min(1, ringAmp + (s == null ? 0.5 : s)); }
    };

    /* ── かざぐるま ── */
    var pwC = V3(L.PINWHEEL_C), PR = 0.09;
    var pinG = new THREE.Group(); pinG.position.copy(pwC); scene.add(pinG);
    var rotor = new THREE.Group(); pinG.add(rotor);
    (function () {
      var NSb = 14, NRb = 7, pos = [], col = [], idx = [], base = 0;
      var cols = [[0.96, 0.95, 0.92], [0.98, 0.78, 0.10], [0.10, 0.45, 0.80], [0.95, 0.45, 0.62]]; // 赤と緑はトマトとまぎれるので使わない
      var tmp = new THREE.Color();
      for (var b = 0; b < 4; b++) {
        var a0 = b * Math.PI / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2;
        var C0x = Math.cos(a0) * PR, C0y = Math.sin(a0) * PR, C1x = Math.cos(a1) * PR, C1y = Math.sin(a1) * PR;
        tmp.setRGB(cols[b][0], cols[b][1], cols[b][2], THREE.SRGBColorSpace);
        for (var i = 0; i <= NSb; i++) {
          var s = i / NSb, k = U.smooth(0.42, 1.0, s);
          var ex = U.lerp(C0x, C1x, s), ey = U.lerp(C0y, C1y, s);
          var kk = k * k;
          var tx = U.lerp(ex, 0.006 * Math.cos(a1), kk), ty = U.lerp(ey, 0.006 * Math.sin(a1), kk);
          var tz = Math.sin(k * Math.PI) * 0.034 + kk * 0.012;
          for (var j = 0; j <= NRb; j++) {
            var r = j / NRb;
            pos.push(tx * r, ty * r, tz * r + Math.sin(Math.PI * r) * 0.008 * k);
            var sh = 0.92 + 0.08 * r;
            col.push(tmp.r * sh, tmp.g * sh, tmp.b * sh);
          }
        }
        for (i = 0; i < NSb; i++) for (j = 0; j < NRb; j++) {
          var p0 = base + i * (NRb + 1) + j, p1 = p0 + 1, p2 = p0 + NRb + 1, p3 = p2 + 1;
          idx.push(p0, p2, p1, p1, p2, p3);
        }
        base += (NSb + 1) * (NRb + 1);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      var m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide });
      var blades = mesh(g, m, true, false); rotor.add(blades);
      var bead = mesh(new THREE.SphereGeometry(0.0062, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.35 }), true, false);
      bead.position.z = 0.016; rotor.add(bead);
      var pin = mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 6), chrome, false, false); pin.rotation.x = Math.PI / 2; pin.position.z = 0.004; rotor.add(pin);
    })();
    // 軸（細い竹ひご）: 土の左手前から羽根の中心の後ろまで
    (function () {
      var top = new THREE.Vector3(pwC.x, pwC.y + 0.004, pwC.z - 0.012);
      var bot = new THREE.Vector3(L.PLANTER[0] - 0.10, L.SOIL_Y - 0.06, L.PLANTER[2] + 0.095);
      var len = top.distanceTo(bot);
      var g = new THREE.CylinderGeometry(0.0028, 0.0032, len, 8);
      var st = mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9c79a, roughness: 0.6 }), true, false);
      st.position.copy(top).add(bot).multiplyScalar(0.5);
      st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
      scene.add(st);
      var holder = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 8), new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.5 }), false, false);
      holder.rotation.x = Math.PI / 2; holder.position.set(0, 0.004, -0.008); pinG.add(holder);
    })();
    var pwSpeed = 0, pwAng = 0, gust = 0, gustT = 3 + Math.random() * 4, pwRnd = U.rng(7);
    world.pinwheel = {
      group: pinG, center: pwC.clone(), radius: PR, speed: 0,
      addSpin: function (imp) { pwSpeed = U.clamp(pwSpeed + (imp || 0), -45, 45); }
    };

    /* ── 時刻 ── */
    world.sunDir = new THREE.Vector3(-0.55, 0.55, 0.65).normalize();
    world.night = 0;
    var cur = {}; CKEYS.forEach(function (n) { cur[n] = new THREE.Color(); });
    var sunL = new THREE.Vector3(), sunVis = new THREE.Vector3(), moonVis = new THREE.Vector3(), tmpC = new THREE.Color();
    var timeNow = -1;
    world.setTime = function (t) {
      t = t - Math.floor(t);
      timeNow = t;
      var i = 0;
      while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
      var a = KEYS[i], b = KEYS[i + 1], f = U.clamp01((t - a.t) / (b.t - a.t));
      CKEYS.forEach(function (n) { cur[n].copy(a[n]).lerp(b[n], f); });
      NKEYS.forEach(function (n) { cur[n] = U.lerp(a[n], b[n], f); });
      var night = cur.night; world.night = night;

      lerpKeys(SUN_KEYS, t, sunL);
      lerpKeys(SUNVIS_KEYS, t, sunVis);
      // 光の向き: 太陽（地平線より下なら地平線すれすれ）と月を夜らしさで混ぜる
      var sl = _p.copy(sunL); if (sl.y < 0.06) { sl.y = 0.06; sl.normalize(); }
      var mw = U.smooth(0.25, 0.75, night);
      world.sunDir.copy(sl).multiplyScalar(1 - mw).addScaledVector(MOON_LIGHT, mw).normalize();
      fitShadow(world.sunDir);
      sun.color.copy(cur.sun); sun.intensity = cur.sunI;
      hemi.color.copy(cur.hs); hemi.groundColor.copy(cur.hg); hemi.intensity = cur.hI;
      renderer.toneMappingExposure = cur.exp;

      // 月（空の中、正面のやや左上をゆっくり動く）
      var mp = ((t + 0.25) % 1) / 0.5; // 0.75→0, 0.25→1
      moonVis.set(-0.13 + 0.12 * mp, 0.07 + 0.06 * Math.sin(mp * Math.PI), -1).normalize();

      skyU.uZen.value.copy(cur.zen); skyU.uHor.value.copy(cur.hor); skyU.uGlow.value.copy(cur.glow); skyU.uCloud.value.copy(cur.cloud);
      skyU.uSunVis.value.copy(sunVis); skyU.uMoon.value.copy(moonVis);
      skyU.uNight.value = night; skyU.uCover.value = cur.cover;
      skyU.uSunAmt.value = U.smooth(-0.03, 0.02, sunVis.y);
      starU.uNight.value = U.smooth(0.35, 0.95, night);
      bandU.forEach(function (u) {
        u.uLight.value.copy(cur.far);
        u.uHaze.value.copy(cur.hor).lerp(cur.zen, 0.15);
        u.uHazeAmt.value = u.far ? Math.min(0.85, cur.haze * 1.6) : cur.haze;
        u.uNight.value = U.smooth(0.2, 0.8, night);
      });
      // 環境マップ用の色
      envU.uZen.value.copy(cur.zen).lerp(cur.hor, 0.45); envU.uHor.value.copy(cur.hor);
      envU.uGlow.value.copy(cur.sun).multiplyScalar(cur.sunI * 0.25 * (1 - mw));
      envU.uSun.value.copy(sunL);
      envU.uGround.value.copy(cur.hg).multiplyScalar(0.55).lerp(tmpC.copy(cur.hs), 0.15);
      var q = low ? 0.02 : 0.01, key = Math.round(t / q);
      if (key !== envKey) { envKey = key; envDirty = true; }
      if (!envRT) buildEnv();
    };

    /* ── 星のきらめき ── */
    var flare = 0;
    world.twinkle = function (dir) {
      if (world.night < 0.4 || !dir) return false;
      var d = _by.copy(dir).normalize(), best = -2, bi = -1;
      for (var i = 0; i < starDirs.length; i++) {
        if (starDirs[i].y < 0.02) continue;
        var dt = starDirs[i].dot(d);
        if (dt > best) { best = dt; bi = i; }
      }
      if (bi < 0 || best < Math.cos(0.6)) return false;
      starU.uFlareIdx.value = bi; flare = 1;
      return true;
    };

    /* ── 毎フレーム ── */
    world.update = function (dt, time) {
      dt = Math.min(dt || 0, 0.1);
      skyU.uTime.value = time || 0;
      // 環境マップは移り変わりのときだけ間引いて作り直す
      envTimer += dt;
      if (envDirty && envTimer > (low ? 0.6 : 0.3)) buildEnv();
      // かざぐるま
      gustT -= dt;
      if (gustT < 0) { gust = 0.6 + pwRnd() * 1.6; gustT = 5 + pwRnd() * 9; }
      var torque = gust > 0 ? 3.0 : 0; gust = Math.max(0, gust - dt);
      pwSpeed += torque * dt;
      pwSpeed *= Math.exp(-0.55 * dt);
      if (Math.abs(pwSpeed) < 0.25) pwSpeed = U.damp(pwSpeed, 0, 1.5, dt);
      pwAng += pwSpeed * dt; rotor.rotation.z = -pwAng;
      world.pinwheel.speed = pwSpeed;
      // バケツの震え
      if (ringAmp > 0.0005) {
        ringPh += dt;
        ringAmp *= Math.exp(-5 * dt);
        bucketG.rotation.z = ringAmp * 0.02 * Math.sin(ringPh * 55);
        bucketG.rotation.x = ringAmp * 0.015 * Math.sin(ringPh * 47 + 1.3);
        bucketG.position.y = Math.abs(Math.sin(ringPh * 60)) * ringAmp * 0.0015;
      } else if (ringAmp > 0) { ringAmp = 0; bucketG.rotation.set(0, 0, 0); bucketG.position.y = 0; }
      // 星
      if (flare > 0) { flare = Math.max(0, flare - dt * 0.8); starU.uFlare.value = flare * flare * (3 - 2 * flare); }
      stars.visible = starU.uNight.value > 0 || starU.uFlare.value > 0;   // 昼は明るさ 0 の加算なので描かない
      // 床のしみ
      updateWet(dt);
    };

    world.setTime(0.30);
    return world;
  };
})();
