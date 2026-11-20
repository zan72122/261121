/* 08-props.js — 小道具: 買い物かご(Props.basket) と エコバッグ(Props.bag)。
   形状・素材・テクスチャは最初の1回だけ作ってキャッシュし、呼ぶたびに新しい Group を返す。 */
(function () {
  'use strict';
  var T = window.THREE;
  var Props = (window.Props = {});
  var PI = Math.PI;

  /* ───────── 角の丸い長方形の周(上から見て)。t は周の長さ、背面中央(-Z)から +X へ回る ───────── */
  function rrSegs(w, d, r) {
    var hw = w / 2, hd = d / 2, a = hw - r, b = hd - r;
    var arc = PI * r / 2;
    function line(x0, z0, x1, z1, nx, nz) {
      return { len: Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)), corner: false,
        at: function (f) { return [x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, nx, nz]; } };
    }
    function corner(cx, cz, th0) {
      return { len: arc, corner: true,
        at: function (f) { var th = th0 + f * PI / 2, c = Math.cos(th), s = Math.sin(th); return [cx + r * c, cz + r * s, c, s]; } };
    }
    return [
      line(0, -hd, a, -hd, 0, -1),
      corner(a, -b, -PI / 2),
      line(hw, -b, hw, b, 1, 0),
      corner(a, b, 0),
      line(a, hd, -a, hd, 0, 1),
      corner(-a, b, PI / 2),
      line(-hw, b, -hw, -b, -1, 0),
      corner(-a, -b, PI),
      line(-a, -hd, 0, -hd, 0, -1)
    ];
  }
  function rrLen(segs) { var L = 0; for (var i = 0; i < segs.length; i++) L += segs[i].len; return L; }
  /* s は 0..1 の周の割合 */
  function rrAt(segs, L, s) {
    var t = (((s % 1) + 1) % 1) * L;
    for (var i = 0; i < segs.length; i++) {
      if (t <= segs[i].len || i === segs.length - 1) return segs[i].at(U.clamp(t / segs[i].len, 0, 1));
      t -= segs[i].len;
    }
  }

  /* 頂点の格子(rows×cols、各点 [x,y,z,u,v]) から面を作る。
     行(i)を進む向き × 列(j)を進む向き の外積が表になる並び: 行=上/断面方向, 列=周の進行方向 */
  function gridGeo(grid) {
    var rows = grid.length, cols = grid[0].length;
    var pos = [], uv = [], idx = [];
    for (var i = 0; i < rows; i++) for (var j = 0; j < cols; j++) {
      var p = grid[i][j];
      pos.push(p[0], p[1], p[2]); uv.push(p[3], p[4]);
    }
    for (i = 0; i < rows - 1; i++) for (j = 0; j < cols - 1; j++) {
      var a = i * cols + j, b = (i + 1) * cols + j, c = i * cols + j + 1, d2 = (i + 1) * cols + j + 1;
      idx.push(a, b, c, b, d2, c);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  /* 周の継ぎ目(j=0 と j=cols-1)、断面の継ぎ目(i=0 と i=rows-1) の法線をそろえる */
  function weldNormals(g, rows, cols, seamCols, seamRows) {
    var n = g.attributes.normal, v = new T.Vector3(), w = new T.Vector3();
    function avg(a, b) {
      v.fromBufferAttribute(n, a); w.fromBufferAttribute(n, b); v.add(w).normalize();
      n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
    }
    var i, j;
    if (seamCols) for (i = 0; i < rows; i++) avg(i * cols, i * cols + cols - 1);
    if (seamRows) for (j = 0; j < cols; j++) avg(j, (rows - 1) * cols + j);
    if (seamCols && seamRows) {
      v.set(0, 0, 0);
      var c4 = [0, cols - 1, (rows - 1) * cols, rows * cols - 1];
      for (i = 0; i < 4; i++) { w.fromBufferAttribute(n, c4[i]); v.add(w); }
      v.normalize();
      for (i = 0; i < 4; i++) n.setXYZ(c4[i], v.x, v.y, v.z);
    }
    n.needsUpdate = true;
  }

  /* 角丸の長方形の断面(閉じた輪、反時計回り: 外側を上へ)。[o, y] の配列 */
  function roundRectProfile(o0, o1, y0, y1, rad, seg) {
    var pts = [];
    function arc(cx, cy, a0) {
      for (var k = 0; k <= seg; k++) { var a = a0 + k / seg * PI / 2; pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); }
    }
    arc(o1 - rad, y0 + rad, -PI / 2);
    arc(o1 - rad, y1 - rad, 0);
    arc(o0 + rad, y1 - rad, PI / 2);
    arc(o0 + rad, y0 + rad, PI);
    pts.push([pts[0][0], pts[0][1]]);
    return pts;
  }
  function profLens(prof) {
    var acc = [0];
    for (var k = 1; k < prof.length; k++) {
      var dx = prof[k][0] - prof[k - 1][0], dy = prof[k][1] - prof[k - 1][1];
      acc.push(acc[k - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    return acc;
  }

  /* ═════════════════════ 買い物かご ═════════════════════ */
  var B = null;
  var BK = {
    H: 0.24, yTop: 0.226, floorY: 0.016,
    botW: 0.44, botD: 0.30, botR: 0.034,
    topW: 0.484, topD: 0.344, topR: 0.044,
    pitch: 0.022, shell: 0.0035
  };

  function basketTextures() {
    var TW = 64, TH = 512, yT = BK.yTop;
    var holeW = 0.0125 / BK.pitch * TW;
    var rows = [];
    for (var k = 0; k < 4; k++) { var y0 = 0.033 + k * 0.042; rows.push([y0, y0 + 0.033]); }
    function cy(y) { return (1 - y / yT) * TH; }
    function holes(ctx, inset, rad) {
      for (var k = 0; k < rows.length; k++) {
        var x0 = (TW - holeW) / 2 + inset, x1 = (TW + holeW) / 2 - inset;
        var top = cy(rows[k][1]) + inset, bot = cy(rows[k][0]) - inset;
        rr(ctx, x0, top, x1 - x0, bot - top, rad);
        ctx.fill();
      }
    }
    var alpha = U.tex(TW, TH, function (ctx, w, h) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#000'; holes(ctx, 0, 6);
    }, { data: true });
    var color = U.tex(TW, TH, function (ctx, w, h) {
      ctx.fillStyle = '#6d7883'; ctx.fillRect(0, 0, w, h);
      /* 型の段差(上の帯と下の帯の線) */
      function band(y, c, lw) { ctx.fillStyle = c; ctx.fillRect(0, cy(y) - lw / 2, w, lw); }
      band(0.207, 'rgba(255,255,255,0.18)', 3); band(0.2035, 'rgba(0,0,0,0.12)', 3);
      band(0.022, 'rgba(255,255,255,0.14)', 3); band(0.018, 'rgba(0,0,0,0.10)', 3);
      /* 穴のふちの陰 */
      ctx.strokeStyle = 'rgba(30,40,50,0.22)'; ctx.lineWidth = 4;
      for (var k = 0; k < rows.length; k++) {
        var x0 = (TW - holeW) / 2, top = cy(rows[k][1]), bot = cy(rows[k][0]);
        rr(ctx, x0 - 1, top - 1, holeW + 2, bot - top + 2, 7); ctx.stroke();
      }
      U.speckle(ctx, w, h, { seed: 11, n: 700, size: 1.2, alpha: 0.05 });
    });
    var bump = U.tex(TW, TH, function (ctx, w, h) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#555'; holes(ctx, -3, 8);
      ctx.fillStyle = '#000'; holes(ctx, 0, 6);
      ctx.fillStyle = '#ddd'; ctx.fillRect(0, cy(0.2035) - 2, w, 4); ctx.fillRect(0, cy(0.018) - 2, w, 4);
    }, { data: true });
    [alpha, color, bump].forEach(function (t) { t.wrapS = T.RepeatWrapping; t.wrapT = T.ClampToEdgeWrapping; });
    return { alpha: alpha, color: color, bump: bump };
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* 側面: 下の輪 → 上の輪 をつなぐ。u は穴の列の数(角は穴なしの柱に固定) */
  function basketWallGeo(inset, y0) {
    var segsT = rrSegs(BK.topW - 2 * inset, BK.topD - 2 * inset, BK.topR - inset);
    var segsB = rrSegs(BK.botW - 2 * inset, BK.botD - 2 * inset, BK.botR - inset);
    var refT = rrSegs(BK.topW, BK.topD, BK.topR);
    var desc = [], u = 0, k, s, cs = 10;
    for (k = 0; k < segsT.length; k++) {
      if (segsT[k].corner) {
        for (s = (k === 0 ? 0 : 1); s <= cs; s++) desc.push([k, s / cs, u]);
      } else {
        var n = Math.max(1, Math.round(refT[k].len / BK.pitch));
        for (s = (k === 0 ? 0 : 1); s <= n; s++) desc.push([k, s / n, u + s]);
        u += n;
      }
    }
    var rows = 10, grid = [];
    for (var i = 0; i <= rows; i++) {
      var f = i / rows, y = y0 + (BK.yTop - y0) * f;
      var fb = y / BK.yTop; /* 壁の傾きは y=0..yTop で線形 */
      var row = [];
      for (var j = 0; j < desc.length; j++) {
        var a = segsB[desc[j][0]].at(desc[j][1]), b = segsT[desc[j][0]].at(desc[j][1]);
        row.push([a[0] + (b[0] - a[0]) * fb, y, a[1] + (b[1] - a[1]) * fb, desc[j][2], y / BK.yTop]);
      }
      grid.push(row);
    }
    var g = gridGeo(grid);
    weldNormals(g, rows + 1, desc.length, true, false);
    return g;
  }

  function basketRimGeo() {
    var segs = rrSegs(BK.topW + 0.002, BK.topD + 0.002, BK.topR + 0.001);
    var L = rrLen(segs), N = 120;
    var prof = roundRectProfile(-0.0085, 0.008, 0.213, BK.H, 0.0055, 4);
    var pl = profLens(prof), PL = pl[pl.length - 1];
    var grid = [];
    for (var k = 0; k < prof.length; k++) {
      var row = [];
      for (var j = 0; j <= N; j++) {
        var p = rrAt(segs, L, j / N), o = prof[k][0];
        row.push([p[0] + p[2] * o, prof[k][1], p[1] + p[3] * o, j / N * 40, pl[k] / PL]);
      }
      grid.push(row);
    }
    var g = gridGeo(grid);
    weldNormals(g, prof.length, N + 1, true, true);
    return g;
  }

  function basketHandleGeo(side) {
    var z = function (y, extra) { return (BK.botD / 2 + (BK.topD - BK.botD) / 2 * (y / BK.yTop)) + extra; };
    var pts = [
      [-0.208, 0.229, 0.1905], [-0.205, 0.205, z(0.205, 0.012)], [-0.192, 0.172, z(0.172, 0.0085)],
      [-0.16, 0.152, z(0.152, 0.0075)], [-0.08, 0.148, z(0.148, 0.0075)], [0, 0.148, z(0.148, 0.0075)],
      [0.08, 0.148, z(0.148, 0.0075)], [0.16, 0.152, z(0.152, 0.0075)], [0.192, 0.172, z(0.172, 0.0085)],
      [0.205, 0.205, z(0.205, 0.012)], [0.208, 0.229, 0.1905]
    ].map(function (p) { return new T.Vector3(p[0], p[1], p[2] * side); });
    var curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
    var g = new T.TubeGeometry(curve, 90, 0.0052, 12, false);
    return g;
  }

  function buildBasket() {
    var tx = basketTextures();
    var wallMat = new T.MeshStandardMaterial({
      color: 0xffffff, map: tx.color, alphaMap: tx.alpha, alphaTest: 0.5, bumpMap: tx.bump, bumpScale: 1.2,
      roughness: 0.52, metalness: 0, side: T.DoubleSide
    });
    var rimTex = U.tex(256, 64, function (ctx, w, h) {
      ctx.fillStyle = '#6d7883'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { seed: 5, n: 300, size: 1.2, alpha: 0.05 });
    }, { repeat: [1, 1] });
    var rimMat = new T.MeshStandardMaterial({ color: 0xffffff, map: rimTex, roughness: 0.48, metalness: 0 });
    /* 床: 格子の凹凸(穴は抜かない) */
    var FP = 0.019;
    var floorCol = U.tex(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#6b7681'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3d454d'; rr(ctx, 30, 30, 68, 68, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; rr(ctx, 27, 27, 74, 74, 12); ctx.stroke();
      U.speckle(ctx, w, h, { seed: 8, n: 200, size: 1.2, alpha: 0.05 });
    });
    var floorBump = U.tex(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#666'; rr(ctx, 26, 26, 76, 76, 12); ctx.fill();
      ctx.fillStyle = '#000'; rr(ctx, 30, 30, 68, 68, 10); ctx.fill();
    }, { data: true });
    [floorCol, floorBump].forEach(function (t) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1 / FP, 1 / FP); });
    var floorMat = new T.MeshStandardMaterial({ color: 0xffffff, map: floorCol, bumpMap: floorBump, bumpScale: 1.5, roughness: 0.55 });

    var shape = new T.Shape();
    (function () {
      var w = BK.botW - 0.006, d = BK.botD - 0.006, r = BK.botR - 0.003, hw = w / 2, hd = d / 2;
      shape.moveTo(-hw + r, -hd); shape.lineTo(hw - r, -hd); shape.absarc(hw - r, -hd + r, r, -PI / 2, 0, false);
      shape.lineTo(hw, hd - r); shape.absarc(hw - r, hd - r, r, 0, PI / 2, false);
      shape.lineTo(-hw + r, hd); shape.absarc(-hw + r, hd - r, r, PI / 2, PI, false);
      shape.lineTo(-hw, -hd + r); shape.absarc(-hw + r, -hd + r, r, PI, PI * 1.5, false);
    })();
    var floorGeo = new T.ExtrudeGeometry(shape, { depth: BK.floorY - 0.004, bevelEnabled: false, curveSegments: 10 });
    floorGeo.rotateX(-PI / 2); floorGeo.translate(0, 0.004, 0);

    var handleMat = new T.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0 });
    var pinGeo = new T.CylinderGeometry(0.0075, 0.0075, 0.014, 20);
    pinGeo.rotateZ(PI / 2);

    B = {
      outer: basketWallGeo(0, 0), inner: basketWallGeo(BK.shell, 0.006), rim: basketRimGeo(), floor: floorGeo,
      hF: basketHandleGeo(1), hB: basketHandleGeo(-1), pin: pinGeo,
      wallMat: wallMat, rimMat: rimMat, floorMat: floorMat, handleMat: handleMat
    };
  }

  Props.basket = function () {
    if (!B) buildBasket();
    var g = new T.Group();
    g.name = 'basket';
    g.add(new T.Mesh(B.outer, B.wallMat));
    g.add(new T.Mesh(B.inner, B.wallMat));
    g.add(new T.Mesh(B.rim, B.rimMat));
    g.add(new T.Mesh(B.floor, B.floorMat));
    var hf = new T.Mesh(B.hF, B.handleMat), hb = new T.Mesh(B.hB, B.handleMat);
    g.add(hf); g.add(hb);
    [1, -1].forEach(function (sz) {
      [-1, 1].forEach(function (sx) {
        var p = new T.Mesh(B.pin, B.handleMat);
        p.position.set(sx * 0.21, 0.229, sz * 0.1905);
        g.add(p);
      });
    });
    var slots = [];
    [-0.07, 0.07].forEach(function (z) { [-0.15, 0, 0.15].forEach(function (x) { slots.push({ x: x, z: z }); }); });
    g.userData = { floorY: BK.floorY, rimY: BK.H, slots: slots };
    U.shadow(g);
    return g;
  };

  /* ═════════════════════ エコバッグ ═════════════════════ */
  var G2 = null;
  var BG = { W: 0.36, D: 0.16, H: 0.38, R: 0.028 };

  function bagShape() {
    var segs = rrSegs(BG.W, BG.D, BG.R), L = rrLen(segs);
    var rnd = U.rng(42);
    var wr = [];
    for (var k = 0; k < 11; k++) wr.push({ s: rnd(), a: (rnd() < 0.5 ? -1 : 1) * (0.003 + rnd() * 0.004), w: 0.007 + rnd() * 0.014, top: rnd() });
    /* 布の面の位置: s(周 0..1), y */
    function at(s, y) {
      var p = rrAt(segs, L, s), x = p[0], z = p[1], nx = p[2], nz = p[3];
      var t = y / BG.H;
      var onFace = Math.abs(nz) > 0.7, across;
      if (onFace) across = 1 - Math.pow(x / (BG.W / 2), 2);
      else across = 1 - Math.pow(z / (BG.D / 2), 2);
      across = U.clamp(across, 0, 1);
      var off = 0, dy = 0;
      /* 胴のふくらみ */
      off += (onFace ? 0.016 : 0.005) * Math.sin(PI * Math.min(1, t * 1.05)) * (1 - 0.35 * t) * across;
      /* マチは口の近くで少し内へ折れる */
      if (!onFace) off -= 0.016 * Math.pow(t, 2.2) * across;
      /* 縦のしわ */
      var sL = s * L;
      for (var k = 0; k < wr.length; k++) {
        var dd = sL - wr[k].s * L; dd -= Math.round(dd / L) * L;
        var hShape = 0.35 + 0.65 * Math.sin(PI * U.clamp(t * 1.1 + (wr[k].top - 0.5) * 0.4, 0, 1));
        off += wr[k].a * Math.exp(-(dd * dd) / (wr[k].w * wr[k].w)) * hShape * U.smooth(t * 4);
      }
      /* 口のふちのゆるい波 */
      var top = U.smooth((t - 0.78) / 0.22);
      off += top * 0.005 * Math.sin(2 * PI * s * 5 + 0.7) * (0.5 + 0.5 * across);
      dy += top * (0.006 * Math.sin(2 * PI * s * 3 + 1.3) + 0.0025 * Math.sin(2 * PI * s * 7 + 0.2));
      return [x + nx * off, y + dy, z + nz * off, nx, nz];
    }
    return { at: at, L: L, segs: segs };
  }

  function bagTextures(L) {
    /* 織り目(凹凸): 平織り */
    var weave = U.tex(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
      var r = U.rng(9), p = 8;
      for (var i = 0; i < w / p; i++) for (var j = 0; j < h / p; j++) {
        var v = 150 + Math.floor(r() * 60);
        ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        ctx.beginPath();
        if ((i + j) % 2) ctx.ellipse(i * p + p / 2, j * p + p / 2, p * 0.62, p * 0.36, 0, 0, 6.2832);
        else ctx.ellipse(i * p + p / 2, j * p + p / 2, p * 0.36, p * 0.62, 0, 0, 6.2832);
        ctx.fill();
      }
    }, { data: true });
    weave.wrapS = weave.wrapT = T.RepeatWrapping;

    var CW = 2048, CH = 1024;
    var body = U.tex(CW, CH, function (ctx, w, h) {
      ctx.fillStyle = '#cdbd9e'; ctx.fillRect(0, 0, w, h);
      var r = U.rng(21);
      for (var i = 0; i < 60; i++) {
        var gx = r() * w, gy = r() * h, gr = 40 + r() * 160;
        var gd = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        var c = r() < 0.5 ? '150,130,95' : '255,250,235';
        gd.addColorStop(0, 'rgba(' + c + ',0.07)'); gd.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = gd; ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      }
      /* 糸のむら(細い横筋・縦筋) */
      for (i = 0; i < 120; i++) {
        ctx.globalAlpha = 0.015 + r() * 0.025;
        ctx.fillStyle = r() < 0.5 ? '#8c7a5a' : '#fffaf0';
        if (r() < 0.5) ctx.fillRect(0, r() * h, w, 1 + r() * 1.5); else ctx.fillRect(r() * w, 0, 1 + r() * 1.5, h);
      }
      ctx.globalAlpha = 1;
      U.speckle(ctx, w, h, { seed: 31, n: 5000, size: 1.0, alpha: 0.08, dark: '#6b5a3c', light: '#fffaf0' });
      /* 底の近くの薄い汚れ */
      var gb = ctx.createLinearGradient(0, h, 0, h - 120);
      gb.addColorStop(0, 'rgba(120,100,70,0.12)'); gb.addColorStop(1, 'rgba(120,100,70,0)');
      ctx.fillStyle = gb; ctx.fillRect(0, h - 120, w, 120);
      /* 前面中央のりんごのプリント */
      var kx = w / L, ky = h / BG.H, size = 0.125;
      var ap = appleCanvas(512);
      ctx.save();
      ctx.translate(0.5 * w, (1 - 0.43) * h);
      ctx.scale(-1, 1); /* 前面は周の向きが -X なので左右を戻す */
      ctx.globalAlpha = 0.93;
      ctx.drawImage(ap, -size * kx / 2, -size * ky / 2, size * kx, size * ky);
      ctx.restore();
    });

    var hem = U.tex(128, 64, function (ctx, w, h) {
      ctx.fillStyle = '#cbbb9c'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { seed: 4, n: 300, size: 1, alpha: 0.08, dark: '#6b5a3c' });
      ctx.fillStyle = 'rgba(120,105,80,0.55)';
      for (var i = 0; i < 6; i++) { ctx.fillRect(i * w / 6 + 2, h * 0.86, w / 6 * 0.62, 2); ctx.fillRect(i * w / 6 + 2, h * 0.11, w / 6 * 0.62, 2); }
    });
    hem.wrapS = T.RepeatWrapping;
    var strap = U.tex(64, 256, function (ctx, w, h) {
      ctx.fillStyle = '#cabb9b'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { seed: 6, n: 400, size: 1, alpha: 0.08, dark: '#6b5a3c' });
      ctx.fillStyle = 'rgba(120,105,80,0.55)';
      for (var i = 0; i < 16; i++) { ctx.fillRect(w * 0.1, i * h / 16 + 2, 2, h / 16 * 0.6); ctx.fillRect(w * 0.88, i * h / 16 + 2, 2, h / 16 * 0.6); }
    });
    strap.wrapS = strap.wrapT = T.RepeatWrapping;
    return { weave: weave, body: body, hem: hem, strap: strap };
  }

  /* りんご1つ(葉1枚)の版画風の絵。背景透明、少しかすれ */
  function appleCanvas(S) {
    var c = U.canvas(S, S), ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(S / 2, S * 0.56); ctx.scale(S * 0.84, S * 0.84);
    /* 実 */
    ctx.beginPath();
    ctx.moveTo(0, -0.30);
    ctx.bezierCurveTo(0.14, -0.42, 0.47, -0.40, 0.48, -0.06);
    ctx.bezierCurveTo(0.49, 0.22, 0.30, 0.42, 0.14, 0.40);
    ctx.bezierCurveTo(0.07, 0.395, 0.04, 0.37, 0, 0.37);
    ctx.bezierCurveTo(-0.04, 0.37, -0.07, 0.395, -0.14, 0.40);
    ctx.bezierCurveTo(-0.30, 0.42, -0.49, 0.22, -0.48, -0.06);
    ctx.bezierCurveTo(-0.47, -0.40, -0.14, -0.42, 0, -0.30);
    ctx.closePath();
    ctx.fillStyle = '#b02a24'; ctx.fill();
    /* つやの三日月(版を1色足した感じ) */
    ctx.beginPath();
    ctx.moveTo(-0.33, -0.18);
    ctx.bezierCurveTo(-0.30, -0.28, -0.20, -0.31, -0.12, -0.28);
    ctx.bezierCurveTo(-0.22, -0.24, -0.29, -0.16, -0.31, -0.06);
    ctx.closePath();
    ctx.fillStyle = '#cf6a5c'; ctx.fill();
    /* くぼみの線 */
    ctx.strokeStyle = '#8e2620'; ctx.lineWidth = 0.022; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.05, -0.30); ctx.quadraticCurveTo(0, -0.25, 0.05, -0.30); ctx.stroke();
    /* 軸 */
    ctx.strokeStyle = '#5a3a24'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(0, -0.28); ctx.quadraticCurveTo(0.0, -0.40, 0.05, -0.50); ctx.stroke();
    /* 葉 */
    ctx.save();
    ctx.translate(0.05, -0.43); ctx.rotate(-0.45);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(0.08, -0.11, 0.24, -0.11, 0.32, 0);
    ctx.bezierCurveTo(0.24, 0.09, 0.08, 0.09, 0, 0);
    ctx.closePath();
    ctx.fillStyle = '#557a3c'; ctx.fill();
    ctx.strokeStyle = '#86a868'; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.moveTo(0.02, 0); ctx.quadraticCurveTo(0.16, -0.015, 0.29, 0); ctx.stroke();
    ctx.restore();
    ctx.restore();
    /* かすれ: 布の目に沿った細い抜けと点の抜け */
    ctx.globalCompositeOperation = 'destination-out';
    var r = U.rng(77);
    for (var i = 0; i < S; i += 4) {
      ctx.globalAlpha = 0.10 + r() * 0.18; ctx.fillRect(0, i, S, 1);
      ctx.globalAlpha = 0.06 + r() * 0.12; ctx.fillRect(i, 0, 1, S);
    }
    for (i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.3 + r() * 0.6;
      ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.6 + r() * 2.2, 0, 6.2832); ctx.fill();
    }
    for (i = 0; i < 14; i++) { /* こすれた筋 */
      ctx.globalAlpha = 0.18 + r() * 0.2;
      var x = r() * S, y = r() * S;
      ctx.fillRect(x, y, 20 + r() * 70, 2 + r() * 3);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    return c;
  }

  function clothMat(map, weave, rep, opt) {
    var m = new T.MeshStandardMaterial(Object.assign({
      color: 0xffffff, map: map, bumpMap: weave, bumpScale: 1.1, roughness: 0.92, metalness: 0
    }, opt || {}));
    return m;
  }
  function darkenBack(m, k) {
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb *= ' + k.toFixed(2) + ';');
    };
    m.customProgramCacheKey = function () { return 'darkBack' + k; };
    return m;
  }

  function buildBag() {
    var sh = bagShape(), L = sh.L;
    var tx = bagTextures(L);
    var WT = 0.011; /* 織り目1枚の大きさ(m) */

    /* 胴 */
    var N = 112, R = 26, grid = [], i, j;
    for (i = 0; i <= R; i++) {
      var y = BG.H * i / R, row = [];
      for (j = 0; j <= N; j++) {
        var p = sh.at(j / N, y);
        row.push([p[0], p[1], p[2], j / N, y / BG.H]);
      }
      grid.push(row);
    }
    var bodyGeo = gridGeo(grid);
    weldNormals(bodyGeo, R + 1, N + 1, true, false);
    var weaveB = tx.weave.clone(); weaveB.needsUpdate = true; weaveB.repeat.set(L / WT, BG.H / WT);
    var bodyMat = darkenBack(clothMat(tx.body, weaveB, null, { side: T.DoubleSide }), 0.7);

    /* 口の折り返し(厚い帯) */
    var prof = roundRectProfile(-0.0028, 0.0028, -0.03, 0.0005, 0.0013, 2);
    var pl = profLens(prof), PL = pl[pl.length - 1];
    var hg = [];
    for (var k = 0; k < prof.length; k++) {
      var hrow = [];
      for (j = 0; j <= N; j++) {
        var q = sh.at(j / N, BG.H + prof[k][1]), o = prof[k][0];
        hrow.push([q[0] + q[3] * o, q[1], q[2] + q[4] * o, j / N * L / 0.027, pl[k] / PL]);
      }
      hg.push(hrow);
    }
    var hemGeo = gridGeo(hg);
    weldNormals(hemGeo, prof.length, N + 1, true, true);
    var weaveH = tx.weave.clone(); weaveH.needsUpdate = true; weaveH.repeat.set(2.4, 0.6);
    var hemMat = clothMat(tx.hem, weaveH, null, { bumpScale: 0.7 });

    /* 底(布の底面と底板) */
    var bshape = new T.Shape();
    (function () {
      var w = BG.W, d = BG.D, r = BG.R, hw = w / 2, hd = d / 2;
      bshape.moveTo(-hw + r, -hd); bshape.lineTo(hw - r, -hd); bshape.absarc(hw - r, -hd + r, r, -PI / 2, 0, false);
      bshape.lineTo(hw, hd - r); bshape.absarc(hw - r, hd - r, r, 0, PI / 2, false);
      bshape.lineTo(-hw + r, hd); bshape.absarc(-hw + r, hd - r, r, PI / 2, PI, false);
      bshape.lineTo(-hw, -hd + r); bshape.absarc(-hw + r, -hd + r, r, PI, PI * 1.5, false);
    })();
    var bottomGeo = new T.ShapeGeometry(bshape, 8);
    bottomGeo.rotateX(PI / 2); bottomGeo.translate(0, 0.0015, 0);
    var boardGeo = new T.RoundedBoxGeometry(BG.W - 0.022, 0.006, BG.D - 0.022, 2, 0.0025);
    boardGeo.translate(0, 0.006, 0);
    var weaveS = tx.weave.clone(); weaveS.needsUpdate = true; weaveS.repeat.set(30, 12);
    var boardMat = clothMat(null, weaveS, null, { color: 0xb3a88f, bumpScale: 0.6 });

    /* 持ち手 */
    function strapGeo(sz) {
      var x0 = 0.072, lean = 0.30;
      var cps = [[-x0, -0.05], [-x0, -0.012], [-x0 - 0.006, 0.05], [-x0 + 0.002, 0.12], [-0.045, 0.172], [0, 0.19],
        [0.045, 0.172], [x0 - 0.002, 0.12], [x0 + 0.006, 0.05], [x0, -0.012], [x0, -0.05]];
      /* 前面の x に当たる周の割合 s を探す */
      function sOf(x) {
        var best = 0, bd = 1e9;
        for (var n = 0; n <= 400; n++) {
          var s = sz > 0 ? 0.25 + n / 400 * 0.5 : (n / 400 * 0.5 + 0.75) % 1;
          var pp = rrAt(sh.segs, L, s), dd = Math.abs(pp[0] - x) + (pp[1] * sz < 0 ? 9 : 0);
          if (dd < bd) { bd = dd; best = s; }
        }
        return best;
      }
      var pts = cps.map(function (c) {
        var h = c[1], s = sOf(c[0]);
        var surf = sh.at(s, BG.H + Math.min(h, 0));
        var zf = Math.abs(surf[2]) + 0.005 + (h > 0 ? 0.0006 : 0);
        var y = h > 0 ? BG.H + h + (surf[1] - BG.H) : surf[1];
        return new T.Vector3(c[0], y, sz * (zf + lean * Math.max(0, h)));
      });
      var curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
      var M = 80, frames = [], up = new T.Vector3();
      var pr = roundRectProfile(-0.015, 0.015, -0.0016, 0.0016, 0.0012, 2);
      var ppl = profLens(pr), PPL = ppl[ppl.length - 1];
      var len = curve.getLength(), sg = [];
      for (var k = 0; k < pr.length; k++) sg.push([]);
      for (var m = 0; m <= M; m++) {
        var tt = m / M, P = curve.getPointAt(tt), Tg = curve.getTangentAt(tt);
        var hh = P.y - BG.H, le = hh > 0 ? lean * U.smooth(hh / 0.03) : 0;
        up.set(0, -le, 1).normalize().multiplyScalar(sz); /* 布の面の外向き */
        var Wd = new T.Vector3().crossVectors(up, Tg).normalize();
        var Nn = new T.Vector3().crossVectors(Tg, Wd).normalize();
        for (k = 0; k < pr.length; k++) {
          var a = pr[k][0], b = pr[k][1];
          sg[k].push([P.x + Wd.x * a + Nn.x * b, P.y + Wd.y * a + Nn.y * b, P.z + Wd.z * a + Nn.z * b,
            (a + 0.015) / 0.03, tt * len / 0.06]);
        }
      }
      var gg = gridGeo(sg);
      weldNormals(gg, pr.length, M + 1, false, true);
      return gg;
    }
    var weaveSt = tx.weave.clone(); weaveSt.needsUpdate = true; weaveSt.repeat.set(2.5, 5);
    var strapMat = clothMat(tx.strap, weaveSt, null, { bumpScale: 0.7 });

    G2 = {
      body: bodyGeo, hem: hemGeo, bottom: bottomGeo, board: boardGeo, sF: strapGeo(1), sB: strapGeo(-1),
      bodyMat: bodyMat, hemMat: hemMat, boardMat: boardMat, strapMat: strapMat
    };
  }

  Props.bag = function () {
    if (!G2) buildBag();
    var g = new T.Group();
    g.name = 'bag';
    g.add(new T.Mesh(G2.body, G2.bodyMat));
    g.add(new T.Mesh(G2.hem, G2.hemMat));
    g.add(new T.Mesh(G2.bottom, G2.bodyMat));
    g.add(new T.Mesh(G2.board, G2.boardMat));
    g.add(new T.Mesh(G2.sF, G2.strapMat));
    g.add(new T.Mesh(G2.sB, G2.strapMat));
    g.userData = { mouthY: BG.H, innerW: BG.W - 0.024, innerD: BG.D - 0.03 };
    U.shadow(g);
    return g;
  };
})();
