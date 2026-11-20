/* 04-hand.js — ママの手と前腕（クリーム色のニットの袖つき）。すべてコードで形を作る。
   Hand.create({ghost:false, sleeve:true, side:'R'}) -> {group, tip, hold, pose(name,dur), update(dt), setOpacity(a)}
   原点=手首。指は +Y、手の甲は +Z。右手を甲側から見ると親指は -X 側。side:'L' は鏡像。
   hold: 持っている物の位置に置かれる Object3D（grip=棒の中心、pinch/card=指のあいだ、point=人さし指の先）。 */
(function () {
  'use strict';
  var T = window.THREE;
  var PI = Math.PI;

  function sgnpow(v, e) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e); }
  function gauss(t) { return Math.exp(-t * t); }
  function sm(t) { return U.smooth(t); }
  function lin(c) { var k = new T.Color(c); return [k.r, k.g, k.b]; }

  /* ───────── 格子の形（周 N × 縦 M、継ぎ目と極の法線をならす） ───────── */
  function gridGeo(N, M, fn) {
    var n = (N + 1) * (M + 1);
    var pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    var o = { x: 0, y: 0, z: 0, u: 0, v: 0, r: 1, g: 1, b: 1 };
    var i, j, k = 0;
    for (j = 0; j <= M; j++) {
      for (i = 0; i <= N; i++) {
        o.r = o.g = o.b = 1;
        fn(i % N, j, o, i);
        pos[k * 3] = o.x; pos[k * 3 + 1] = o.y; pos[k * 3 + 2] = o.z;
        uv[k * 2] = o.u; uv[k * 2 + 1] = o.v;
        col[k * 3] = o.r; col[k * 3 + 1] = o.g; col[k * 3 + 2] = o.b;
        k++;
      }
    }
    var idx = [];
    for (j = 0; j < M; j++) {
      for (i = 0; i < N; i++) {
        var a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var nr = g.attributes.normal.array;
    for (j = 0; j <= M; j++) {
      var r0 = j * (N + 1);
      // 極（全部が同じ点）なら行全体を平均
      var dx = pos[r0 * 3] - pos[(r0 + (N >> 1)) * 3], dy = pos[r0 * 3 + 1] - pos[(r0 + (N >> 1)) * 3 + 1], dz = pos[r0 * 3 + 2] - pos[(r0 + (N >> 1)) * 3 + 2];
      var pole = dx * dx + dy * dy + dz * dz < 1e-14;
      var from = pole ? 0 : 0, to = pole ? N : 0;
      var sx = 0, sy = 0, sz = 0, q;
      if (pole) { for (q = from; q <= to; q++) { sx += nr[(r0 + q) * 3]; sy += nr[(r0 + q) * 3 + 1]; sz += nr[(r0 + q) * 3 + 2]; } }
      else { sx = nr[r0 * 3] + nr[(r0 + N) * 3]; sy = nr[r0 * 3 + 1] + nr[(r0 + N) * 3 + 1]; sz = nr[r0 * 3 + 2] + nr[(r0 + N) * 3 + 2]; }
      var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      sx /= l; sy /= l; sz /= l;
      var list = pole ? null : [0, N];
      if (pole) { for (q = 0; q <= N; q++) { nr[(r0 + q) * 3] = sx; nr[(r0 + q) * 3 + 1] = sy; nr[(r0 + q) * 3 + 2] = sz; } }
      else { for (q = 0; q < 2; q++) { var e = r0 + list[q]; nr[e * 3] = sx; nr[e * 3 + 1] = sy; nr[e * 3 + 2] = sz; } }
    }
    g.attributes.normal.needsUpdate = true;
    return g;
  }

  /* ───────── 寸法 ───────── */
  // 指: x, 付け根関節(MCP)の y, z, 節の長さ, 半径(付け根→先)
  var FING = [
    { x: -0.0285, y: 0.090, z: -0.0016, L: [0.036, 0.022, 0.011], r: [0.0090, 0.0082, 0.0074, 0.0068] }, // 人さし
    { x: -0.0095, y: 0.093, z: -0.0006, L: [0.042, 0.025, 0.012], r: [0.0093, 0.0085, 0.0077, 0.0071] }, // 中
    { x: 0.0095, y: 0.090, z: -0.0010, L: [0.038, 0.024, 0.0115], r: [0.0086, 0.0079, 0.0072, 0.0066] }, // 薬
    { x: 0.0275, y: 0.083, z: -0.0024, L: [0.029, 0.018, 0.010], r: [0.0076, 0.0070, 0.0064, 0.0059] }   // 小
  ];
  var THUMB = { x: -0.0225, y: 0.013, z: -0.0085, L: [0.046, 0.034, 0.020], r: [0.0128, 0.0108, 0.0097, 0.0090] };
  var SX = 1.06;          // 指の断面は少し横長
  var TIPS = 1.18;        // 指先の丸みを少し長く
  var BAR = { y: 0.080, z: -0.028, r: 0.015 };

  /* 指の1節: 関節中心(y=0)と次の関節(y=L)に半球を持つ、先細りのカプセル */
  function segRad(L, r0, r1, tip, y) {
    if (y <= 0) return r0;
    if (y <= L) { var t = y / L; return U.lerp(r0, r1, t) * (1 - 0.045 * Math.sin(PI * t)); }
    var s = U.clamp((y - L) / (r1 * (tip ? TIPS : 1)), 0, 1);
    var c = Math.cos(Math.asin(s));
    return r1 * (tip ? Math.pow(c, 0.75) : c);
  }
  function dorsalF(L, y) { return 1 - 0.07 * sm((y - 0.1 * L) / (0.4 * L)); }
  function padF(L, y) { return 1 + 0.10 * sm((y - 0.15 * L) / (0.5 * L)); }

  function segGeo(L, r0, r1, tip) {
    var N = 18, prof = [], k, a;
    var nb = 4, nt = tip ? 6 : 4, nB = 4;
    for (k = 0; k < nb; k++) { a = -PI / 2 + (PI / 2) * k / nb; prof.push([r0 * Math.sin(a), r0 * Math.cos(a)]); }
    for (k = 0; k <= nB; k++) { var t = k / nB; prof.push([t * L, U.lerp(r0, r1, t) * (1 - 0.045 * Math.sin(PI * t))]); }
    for (k = 1; k <= nt; k++) {
      a = (PI / 2) * k / nt;
      prof.push([L + r1 * Math.sin(a) * (tip ? TIPS : 1), k === nt ? 0 : r1 * (tip ? Math.pow(Math.cos(a), 0.75) : Math.cos(a))]);
    }
    var tot = L + r0 + r1 * (tip ? TIPS : 1);
    return gridGeo(N, prof.length - 1, function (i, j, o, ii) {
      var p = prof[j], f = 2 * PI * i / N, c = Math.cos(f), s = Math.sin(f);
      var y = p[0], x = p[1] * c * SX, z = p[1] * s;
      if (tip) { z *= z > 0 ? dorsalF(L, y) : padF(L, y); }
      o.x = x; o.y = y; o.z = z;
      o.u = ii / N; o.v = (y + r0) / tot;
      // 色: 指先と関節の背はほんのり赤み、腹側は明るめ
      var red = 0;
      if (tip) red += 0.8 * sm((y - 0.3 * L) / (0.9 * L));
      red += 0.45 * gauss(y / (r0 * 1.1)) * Math.max(0, s);
      var pal = Math.max(0, -s) * 0.6;
      o.r = 1 - 0.01 * red + 0.01 * pal;
      o.g = 1 - 0.075 * red + 0.0 * pal;
      o.b = 1 - 0.085 * red + 0.0 * pal;
    });
  }

  /* 爪: 末節の甲側にごく薄く沿わせる */
  function nailGeo(L, r0, r1, wf) {
    var nu = 6, nv = 9;
    var cap = r1 * TIPS, y0 = 0.33 * L, y1 = L + 0.62 * cap, yc = L + 0.22 * cap;
    var W = wf * r1 * SX;
    var cLun = lin(0xf1cfc4), cMid = lin(0xe7b2a6), cEdge = lin(0xf4e6da);
    function surf(x, y) { var r = segRad(L, r0, r1, true, y); var q = r * r - (x / SX) * (x / SX); return q > 0 ? dorsalF(L, y) * Math.sqrt(q) : 0; }
    var pos = [], col = [], uv = [], idx = [];
    for (var j = 0; j <= nv; j++) {
      var v = j / nv;
      var hw = W * (0.80 + 0.20 * Math.sqrt(Math.max(0, 1 - Math.pow(1 - Math.min(1, v / 0.35), 2))));
      if (v > 0.8) hw *= 1 - 0.18 * Math.pow((v - 0.8) / 0.2, 2);
      for (var i = 0; i <= nu; i++) {
        var u = -1 + 2 * i / nu;
        var x = u * hw;
        var y = U.lerp(y0, y1, v) + 0.0011 * u * u * Math.pow(1 - v, 3) - 0.0013 * u * u * Math.pow(v, 3);
        var z;
        if (y <= yc) z = surf(x, y);
        else { var d = y - yc; z = surf(x, yc) - 9 * d * d - 0.08 * d; z = Math.max(z, surf(x, y)); }
        z += 0.00032 + 0.00018 * (1 - u * u);
        pos.push(x, y, z);
        uv.push(i / nu, v);
        var c = v < 0.2 ? cLun : cMid, k2 = v < 0.2 ? v / 0.2 : 0;
        var cc = [U.lerp(c[0], cMid[0], k2), U.lerp(c[1], cMid[1], k2), U.lerp(c[2], cMid[2], k2)];
        if (v > 0.82) { var e = sm((v - 0.82) / 0.14); cc = [U.lerp(cc[0], cEdge[0], e), U.lerp(cc[1], cEdge[1], e), U.lerp(cc[2], cEdge[2], e)]; }
        col.push(cc[0], cc[1], cc[2]);
      }
    }
    for (j = 0; j < nv; j++) for (i = 0; i < nu; i++) {
      var a = j * (nu + 1) + i, b = a + 1, c2 = a + nu + 1, d2 = c2 + 1;
      idx.push(a, b, c2, b, d2, c2);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* 手のひら＋甲＋手首（ひとつながり） */
  var SLX = [-0.05, -0.0285, -0.0095, 0.0095, 0.0275, 0.05], SLY = [-0.002, -0.001, 0.002, 0.0, -0.007, -0.010];
  function slant(x) {
    if (x <= SLX[0]) return SLY[0];
    for (var i = 1; i < SLX.length; i++) if (x <= SLX[i]) return U.lerp(SLY[i - 1], SLY[i], (x - SLX[i - 1]) / (SLX[i] - SLX[i - 1]));
    return SLY[SLY.length - 1];
  }
  function palmGeo() {
    var NU = 32, NV = 30, Yb = -0.062, Yt = 0.099;
    return gridGeo(NU, NV, function (i, j, o, ii) {
      var th = PI * j / NV, c = -Math.cos(th), s = Math.sin(th);
      var yN = sgnpow(c, 0.85);
      var Y = Yb + (Yt - Yb) * (yN + 1) / 2;
      var sc = Math.pow(s, c > 0 ? 0.33 : 0.5);
      var f = 2 * PI * i / NU, cf = Math.cos(f), sf = Math.sin(f);
      var rx = Y <= -0.012 ? 0.0262 + 0.0016 * sm((-Y - 0.012) / 0.06) : 0.0262 + 0.0172 * sm((Y + 0.012) / 0.085);
      var rzB = 0.0105 + 0.0065 * (1 - sm((Y + 0.008) / 0.04));
      var rzP = 0.0125 + 0.0062 * (1 - sm((Y + 0.005) / 0.045));
      var e = 0.62 + 0.30 * (1 - sm((Y + 0.01) / 0.04));
      var xN = sgnpow(cf, e), zq = sgnpow(sf, e);
      var x = xN * rx, z = zq * (sf > 0 ? rzB : rzP);
      var back = Math.max(0, sf), palm = Math.max(0, -sf);
      var up = sm((Y + 0.005) / 0.03);
      if (sf > 0) z *= 1 - 0.30 * xN * xN * up;
      // 親指の付け根のふくらみ・小指側のふくらみ・手のひらのくぼみ・指の付け根のふくらみ
      var tn = gauss((xN + 0.72) / 0.42) * gauss((Y - 0.030) / 0.030);
      z -= 0.0060 * tn * palm; x -= 0.0028 * tn * (1 - back);
      var hy = gauss((xN - 0.74) / 0.40) * gauss((Y - 0.036) / 0.032);
      z -= 0.0030 * hy * palm;
      var hol = gauss(xN / 0.45) * gauss((Y - 0.052) / 0.022);
      z += 0.0026 * hol * palm;
      var dp = gauss((Y - 0.087) / 0.009);
      z -= 0.0014 * dp * palm;
      var kn = 0;
      for (var q = 0; q < 4; q++) kn += gauss((x - FING[q].x) / 0.0058);
      kn *= gauss((Y - 0.088) / 0.0075);
      z += 0.0021 * kn * back;
      // 甲の腱のごく浅いすじ
      var tdn = 0;
      for (q = 0; q < 4; q++) tdn += gauss((x - FING[q].x * 0.85) / 0.0035);
      z += 0.0004 * tdn * back * sm((Y - 0.02) / 0.04) * (1 - sm((Y - 0.08) / 0.01));
      // 横のアーチ
      z -= 0.0026 * xN * xN * up;
      if (cf < 0) x *= 1 - 0.10 * gauss((Y - 0.03) / 0.035);
      x *= sc; z *= sc;
      z -= 0.001;
      Y += slant(x) * sm((Y - 0.05) / 0.045);
      o.x = x; o.y = Y; o.z = z;
      o.u = ii / NU; o.v = j / NV;
      var red = 0.5 * kn * back + 0.3 * gauss((Y - 0.092) / 0.008);
      o.r = 1 - 0.01 * red + 0.008 * palm; o.g = 1 - 0.06 * red - 0.01 * palm; o.b = 1 - 0.07 * red - 0.01 * palm;
    });
  }

  /* 袖口（リブ）と袖 */
  function cuffGeo() {
    var pts = [], k;
    pts.push([0.0292, -0.072], [0.0292, -0.040], [0.0292, -0.003]);
    for (k = 1; k < 8; k++) { var a = PI - PI * k / 8; pts.push([0.0325 + 0.0033 * Math.cos(a), -0.003 + 0.0033 * Math.sin(a)]); }
    pts.push([0.0358, -0.003], [0.0364, -0.018], [0.0367, -0.035], [0.0364, -0.052], [0.0358, -0.066], [0.0345, -0.072]);
    var acc = [0];
    for (k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    var N = 64, ZS = 0.80;
    return gridGeo(N, pts.length - 1, function (i, j, o, ii) {
      var f = 2 * PI * i / N, p = pts[j];
      var inner = j <= 2;
      var r = p[0] * (1 + 0.012 * Math.sin(2 * f + 0.7));
      o.x = r * Math.cos(f); o.z = r * Math.sin(f) * ZS - 0.0012; o.y = p[1];
      o.u = ii / N * 8; o.v = acc[j] / 0.032;
      var d = inner ? 0.50 + 0.5 * sm((p[1] + 0.012) / 0.012) * 0.6 : 1;
      o.r = o.g = o.b = d;
    });
  }
  function sleeveGeo() {
    var N = 48, M = 22, y0 = -0.050, y1 = -0.55;
    return gridGeo(N, M, function (i, j, o, ii) {
      var t = j / M, y = U.lerp(y0, y1, Math.pow(t, 1.25));
      var f = 2 * PI * i / N;
      var d = -y - 0.05;
      var r = 0.0352 + 0.020 * sm(d / 0.12) * 0.25 + 0.024 * d;
      // ゆるいしわとたるみ
      var fold = 0.030 * Math.sin(2 * f + y * 9) + 0.018 * Math.sin(3 * f - y * 14 + 1.3);
      var bunch = 0.026 * Math.sin((d) * 95 + 1.5 * Math.cos(f)) * Math.exp(-d * 9) * sm(d / 0.02);
      r *= 1 + (fold * sm(d / 0.03) + bunch);
      o.x = r * Math.cos(f); o.z = r * Math.sin(f) * 0.9 - 0.001; o.y = y;
      o.u = ii / N * 8; o.v = -y / 0.032;
      var sh = 1 - 0.06 * Math.max(0, -Math.sin(f));
      o.r = o.g = o.b = sh;
    });
  }

  /* ───────── テクスチャ（キャンバス） ───────── */
  function heightToNormal(src, strength) {
    var w = src.width, h = src.height;
    var hd = src.getContext('2d').getImageData(0, 0, w, h).data;
    var c = U.canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    function H(x, y) { x = (x + w) % w; y = (y + h) % h; return hd[(y * w + x) * 4] / 255; }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      var l = Math.sqrt(dx * dx + dy * dy + 1), k = (y * w + x) * 4;
      d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  }
  function knitTex(rib) {
    var S = 256, cols = 8, rows = 8, cw = S / cols, rh = S / rows;
    var hc = U.canvas(S, S), hx = hc.getContext('2d');
    var cc = U.canvas(S, S), cx = cc.getContext('2d');
    var rnd = U.rng(rib ? 41 : 17);
    hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
    cx.fillStyle = rib ? '#d6c4a2' : '#ccb895'; cx.fillRect(0, 0, S, S);
    function leg(ctx, x, y, ang, rx, ry, inner, outer) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1, ry / rx);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, inner); g.addColorStop(0.65, inner); g.addColorStop(1, outer);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 2 * PI); ctx.fill(); ctx.restore();
    }
    for (var r = -1; r <= rows; r++) {
      for (var c = 0; c < cols; c++) {
        var purl = rib && (c % 4 >= 2);
        var x0 = c * cw + cw / 2, y0 = r * rh + rh / 2;
        var v = 0.92 + 0.08 * rnd();
        var lc = 'rgb(' + Math.round(245 * v) + ',' + Math.round(233 * v) + ',' + Math.round(210 * v) + ')';
        if (purl) {
          // 裏目: 横向きの小さなこぶ（奥まって暗い）
          for (var q = 0; q < 2; q++) {
            var yy = y0 + (q - 0.5) * rh * 0.5;
            leg(hx, x0, yy, 0, cw * 0.46, rh * 0.20, 'rgba(150,150,150,1)', 'rgba(0,0,0,0)');
            leg(cx, x0, yy, 0, cw * 0.46, rh * 0.20, 'rgba(232,218,190,1)', 'rgba(232,218,190,0)');
          }
        } else {
          for (var sd = -1; sd <= 1; sd += 2) {
            var lx = x0 + sd * cw * 0.22;
            leg(hx, lx, y0, -sd * 0.55, cw * 0.27, rh * 0.62, 'rgba(255,255,255,1)', 'rgba(0,0,0,0)');
            leg(cx, lx, y0, -sd * 0.55, cw * 0.27, rh * 0.62, lc, 'rgba(214,202,176,0)');
          }
        }
      }
    }
    U.speckle(cx, S, S, { n: 1500, size: 0.9, alpha: 0.10, light: '#fffaf0', dark: '#9c8a6a', seed: rib ? 5 : 9 });
    U.speckle(hx, S, S, { n: 900, size: 0.8, alpha: 0.12, light: '#ffffff', dark: '#000000', seed: 11 });
    var map = new T.CanvasTexture(cc);
    map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping; map.anisotropy = 4; map.needsUpdate = true;
    return { map: map, normal: heightToNormal(hc, rib ? 2.2 : 2.6) };
  }
  function skinTex() {
    return U.tex(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#e2b193'; ctx.fillRect(0, 0, w, h);
      var r = U.rng(23);
      for (var i = 0; i < 60; i++) {
        var x = r() * w, y = r() * h, rr = 10 + r() * 34;
        var g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        var c = r() < 0.5 ? '226,174,150' : '242,212,190';
        g.addColorStop(0, 'rgba(' + c + ',0.22)'); g.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      U.speckle(ctx, w, h, { n: 900, size: 0.7, alpha: 0.05, light: '#f8e2d2', dark: '#c99478', seed: 31 });
    });
  }

  /* ───────── 共有の形・質感（初回に作る） ───────── */
  var GEO = null, TEX = null;
  function shared() {
    if (GEO) return;
    GEO = { fing: [], nail: [], palm: palmGeo(), cuff: null, sleeve: null, web: new T.SphereGeometry(1, 18, 12) };
    var wc = new Float32Array(GEO.web.attributes.position.count * 3); wc.fill(1);
    GEO.web.setAttribute('color', new T.BufferAttribute(wc, 3));
    var all = FING.concat([THUMB]);
    for (var f = 0; f < all.length; f++) {
      var F = all[f], segs = [];
      for (var s = 0; s < 3; s++) segs.push(segGeo(F.L[s], F.r[s], F.r[s + 1], s === 2));
      GEO.fing.push(segs);
      GEO.nail.push(nailGeo(F.L[2], F.r[2], F.r[3], f === 4 ? 0.74 : 0.68));
    }
    TEX = { skin: skinTex() };
  }
  function sleeveShared() {
    if (GEO.cuff) return;
    GEO.cuff = cuffGeo(); GEO.sleeve = sleeveGeo();
    TEX.knit = knitTex(false); TEX.rib = knitTex(true);
  }

  /* ───────── 骨組み ───────── */
  function buildRig(m) {
    var root = new T.Group(), rig = { root: root, f: [], t: null };
    var all = FING.concat([THUMB]);
    for (var f = 0; f < 5; f++) {
      var F = all[f], nodes = [], parent = root;
      for (var s = 0; s < 3; s++) {
        var n = new T.Group();
        if (s === 0) { n.position.set(F.x, F.y, F.z); n.rotation.order = f === 4 ? 'ZYX' : 'ZXY'; }
        else n.position.set(0, F.L[s - 1], 0);
        parent.add(n); nodes.push(n); parent = n;
        if (m) n.add(m.mesh(GEO.fing[f][s], m.skin));
      }
      var last = nodes[2], Ld = F.L[2], rt = F.r[3];
      if (m) last.add(m.mesh(GEO.nail[f], m.nail));
      var tip = new T.Object3D(); tip.position.set(0, Ld + rt * TIPS, 0); last.add(tip);
      var pad = new T.Object3D(); var py = Ld * 0.75;
      pad.position.set(0, py, -segRad(Ld, F.r[2], rt, true, py) * padF(Ld, py)); last.add(pad);
      var midSide = new T.Object3D(); midSide.position.set(-segRad(F.L[1], F.r[1], F.r[2], false, F.L[1] * 0.5) * SX, F.L[1] * 0.5, 0); nodes[1].add(midSide);
      var o = { nodes: nodes, tip: tip, pad: pad, midSide: midSide };
      if (f < 4) rig.f.push(o); else rig.t = o;
    }
    return rig;
  }

  // 状態: 指4本×[開き, MCP, PIP, DIP] ＋ 親指[曲げ, ひねり, 開き, MCP, IP]
  function apply(rig, st) {
    for (var f = 0; f < 4; f++) {
      var n = rig.f[f].nodes, k = f * 4;
      n[0].rotation.set(-st[k + 1], 0, st[k]);
      n[1].rotation.x = -st[k + 2];
      n[2].rotation.x = -st[k + 3];
    }
    var t = rig.t.nodes;
    t[0].rotation.set(-st[16], st[17], st[18]);
    t[1].rotation.x = -st[19];
    t[2].rotation.x = -st[20];
  }

  /* ───────── 形（関節角度） ─────────
     指4本×[開き, MCP, PIP, DIP] ＋ 親指[曲げ, ひねり, 開き, MCP, IP]（ラジアン、曲げは手のひら側が正）。
     grip / pinch / card / point の親指（と一部の指）は、棒・指の腹・指の横に接するよう
     座標降下法で合わせた値を書き写したもの（毎回計算すると起動が遅くなるため）。 */
  var _v1 = new T.Vector3(), _v2 = new T.Vector3();
  var POSES = {
    open: [0.07, 0.1, 0.17, 0.1, 0, 0.12, 0.2, 0.12, -0.06, 0.16, 0.24, 0.14, -0.14, 0.22, 0.3, 0.16, -0.05, -0.8, 0.62, 0.2, 0.2],
    point: [0.03, 0.03, 0.05, 0.03, 0, 1.25, 1.5, 0.6, -0.03, 1.32, 1.5, 0.6, -0.08, 1.38, 1.45, 0.55, 0.5828, -0.6841, 0.407, -0.0872, 0.0953],
    grip: [0.02, 1.0688, 1.3391, 0.5312, 0, 1.2359, 1.4734, 0.5687, -0.02, 1.1031, 1.3969, 0.6156, -0.05, 0.7438, 1.1516, 0.4938, 0.5791, -0.8005, 1.2, 0.6709, 1.3],
    pinch: [0.05, 0.3719, 1.4656, 0.9562, 0, 0.75, 0.95, 0.45, -0.04, 0.9, 1.05, 0.5, -0.09, 1, 1.1, 0.5, 0.2603, -0.9005, 0.4017, 0.1568, -0.3],
    card: [0.05, 0.75, 1.2, 0.5, 0, 0.95, 1.35, 0.6, -0.03, 1.05, 1.4, 0.6, -0.07, 1.1, 1.4, 0.55, 0.516, -1.0334, 0.6457, -0.0329, -0.3]
  };

  /* ───────── 作る ───────── */
  function create(opts) {
    opts = opts || {};
    var ghost = !!opts.ghost, sleeve = opts.sleeve !== false && !ghost, side = opts.side === 'L' ? 'L' : 'R';
    shared();
    if (sleeve) sleeveShared();

    var mats = [], base = [];
    function addMat(m) { mats.push(m); base.push(m.opacity); return m; }
    var skin, nail, gm = null, pre = null;
    if (ghost) {
      gm = addMat(new T.MeshStandardMaterial({ color: 0xd9a07e, roughness: 0.6, metalness: 0, emissive: 0x24140c, transparent: true, opacity: 0.78, depthWrite: true }));
      pre = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, opacity: 1 });
      skin = nail = gm;
    } else {
      skin = addMat(new T.MeshPhysicalMaterial({
        color: 0xffffff, map: TEX.skin, vertexColors: true, roughness: 0.52, metalness: 0,
        sheen: 0.2, sheenColor: new T.Color(0xffc8b0), sheenRoughness: 0.55, specularIntensity: 0.4
      }));
      nail = addMat(new T.MeshPhysicalMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28,
        specularIntensity: 0.6, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      }));
    }
    var meshes = [];
    var M = {
      skin: skin, nail: nail,
      mesh: function (g, mat) {
        var me = new T.Mesh(g, mat);
        me.castShadow = !ghost; me.receiveShadow = !ghost;
        if (ghost) {
          me.renderOrder = 21;
          var p = new T.Mesh(g, pre); p.renderOrder = 20; p.castShadow = p.receiveShadow = false; me.add(p);
        }
        meshes.push(me);
        return me;
      }
    };
    var rig = buildRig(M);
    var root = rig.root;
    root.add(M.mesh(GEO.palm, skin));
    // 親指と人さし指のあいだの皮膚（水かき）
    var web = M.mesh(GEO.web, skin);
    rig.t.nodes[0].add(web);

    if (sleeve) {
      var knit = addMat(new T.MeshPhysicalMaterial({
        color: 0xffffff, map: TEX.knit.map, normalMap: TEX.knit.normal, normalScale: new T.Vector2(0.9, 0.9), vertexColors: true,
        roughness: 0.93, metalness: 0, sheen: 0.6, sheenColor: new T.Color(0xfff4e2), sheenRoughness: 0.75, side: T.DoubleSide
      }));
      var rib = addMat(new T.MeshPhysicalMaterial({
        color: 0xffffff, map: TEX.rib.map, normalMap: TEX.rib.normal, normalScale: new T.Vector2(1.0, 1.0), vertexColors: true,
        roughness: 0.93, metalness: 0, sheen: 0.6, sheenColor: new T.Color(0xfff4e2), sheenRoughness: 0.75, side: T.DoubleSide
      }));
      root.add(M.mesh(GEO.cuff, rib));
      root.add(M.mesh(GEO.sleeve, knit));
    }

    var group = new T.Group();
    if (side === 'L') root.scale.x = -1;
    group.add(root);
    var hold = new T.Object3D();
    root.add(hold);

    var cur = POSES.open.slice(), from = cur.slice(), to = cur.slice(), t = 0, dur = 0, name = 'open';
    // 水かきは開いた手の形で置く（親指に付いて動く）
    apply(rig, cur); root.updateMatrixWorld(true);
    (function () {
      var A = rig.t.nodes[1].localToWorld(new T.Vector3(0, -0.006, 0));
      var B = rig.f[0].nodes[0].localToWorld(new T.Vector3(0, -0.004, 0));
      var C = A.clone().lerp(B, 0.5); C.y -= 0.004; C.z -= 0.0015;
      var ax = B.clone().sub(A).normalize();
      var zz = new T.Vector3(0, 0, 1), yy = new T.Vector3().crossVectors(zz, ax).normalize();
      zz.crossVectors(ax, yy);
      var mtx = new T.Matrix4().makeBasis(ax, yy, zz);
      mtx.scale(new T.Vector3(A.distanceTo(B) * 0.52, 0.0115, 0.0072));
      mtx.setPosition(C);
      var inv = new T.Matrix4().copy(rig.t.nodes[0].matrixWorld).invert();
      mtx.premultiply(inv);
      mtx.decompose(web.position, web.quaternion, web.scale);
    })();

    function updHold() {
      root.updateMatrixWorld(true);
      if (name === 'grip') { hold.position.set(0, BAR.y, BAR.z); hold.quaternion.identity(); return; }
      if (name === 'point' || name === 'open') { hold.position.copy(root.worldToLocal(rig.f[0].tip.getWorldPosition(_v1))); hold.quaternion.identity(); return; }
      var a = rig.t.pad.getWorldPosition(_v1);
      var b = (name === 'card' ? rig.f[0].midSide : rig.f[0].pad).getWorldPosition(_v2);
      hold.position.copy(root.worldToLocal(a.lerp(b, 0.5)));
      if (name === 'card') {
        var q = rig.f[0].nodes[1].getWorldQuaternion(new T.Quaternion());
        var qr = root.getWorldQuaternion(new T.Quaternion()).invert();
        hold.quaternion.copy(qr.multiply(q));
      } else hold.quaternion.identity();
    }
    apply(rig, cur);

    var api = {
      group: group, tip: rig.f[0].tip, hold: hold, ghost: ghost, side: side,
      pose: function (n, d) {
        if (!POSES[n]) return;
        name = n; from = cur.slice(); to = POSES[n]; t = 0;
        dur = d == null ? 0.25 : Math.max(0, d);
        if (dur === 0) { cur = to.slice(); apply(rig, cur); updHold(); }
      },
      update: function (dt) {
        if (dur > 0 && t < dur) {
          t = Math.min(dur, t + (dt || 0));
          var k = sm(t / dur);
          for (var i = 0; i < cur.length; i++) cur[i] = U.lerp(from[i], to[i], k);
          apply(rig, cur); updHold();
        }
      },
      setOpacity: function (a) {
        a = U.clamp(a, 0, 1);
        root.visible = a > 0.002;
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          var tr = ghost || a < 0.999;
          if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
          m.opacity = base[i] * a;
        }
        if (!ghost) for (var j = 0; j < meshes.length; j++) meshes[j].castShadow = a > 0.5;
      }
    };
    updHold();
    return api;
  }

  window.Hand = { create: create };
})();
