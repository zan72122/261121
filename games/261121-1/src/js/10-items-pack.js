/* 10-items-pack.js — 品物（容器もの6種）: milk juice yogurt pudding egg cheese
   すべて実寸(メートル)、原点=底の中心、正面 +Z。パッケージに文字は入れない（模様と絵だけ）。 */
(function () {
  'use strict';
  var T = window.THREE;
  var PI = Math.PI;

  /* ───────── 小道具 ───────── */
  function V2(x, y) { return new T.Vector2(x, y); }

  /* 回転体。phiStart=-PI なので u=0.5 が正面(+Z)。v は高さで割り当てる。 */
  function lathe(pts, segs, y0, y1) {
    var g = new T.LatheGeometry(pts, segs || 48, -PI, 2 * PI);
    if (y1 != null) setVByY(g, y0, y1);
    return g;
  }
  function setVByY(g, y0, y1) {
    var p = g.attributes.position, uv = g.attributes.uv;
    for (var i = 0; i < p.count; i++) uv.setY(i, (p.getY(i) - y0) / (y1 - y0));
    uv.needsUpdate = true;
  }
  /* 回転体の継ぎ目の法線をそろえる */
  function fixSeam(g, segs, n) {
    var nr = g.attributes.normal, v = new T.Vector3();
    for (var j = 0; j < n; j++) {
      var a = j, b = segs * n + j;
      v.set(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize();
      nr.setXYZ(a, v.x, v.y, v.z); nr.setXYZ(b, v.x, v.y, v.z);
    }
    nr.needsUpdate = true;
  }
  function mesh(g, m, x, y, z) {
    var o = new T.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    return o;
  }
  function std(o) { return new T.MeshStandardMaterial(o); }
  function phys(o) { return new T.MeshPhysicalMaterial(o); }
  /* 透明プラスチック（屈折なし） */
  function clearPlastic(op, tint) {
    return phys({
      color: tint || 0xffffff, transparent: true, opacity: op, roughness: 0.06, metalness: 0,
      envMapIntensity: 1.7, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, side: T.DoubleSide
    });
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function circle(ctx, x, y, r, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fill();
  }
  /* しずく形（先が上） */
  function drop(ctx, x, y, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.bezierCurveTo(x + s * 0.25, y - s * 0.5, x + s * 0.7, y + s * 0.05, x + s * 0.7, y + s * 0.35);
    ctx.bezierCurveTo(x + s * 0.7, y + s * 0.75, x + s * 0.35, y + s, x, y + s);
    ctx.bezierCurveTo(x - s * 0.35, y + s, x - s * 0.7, y + s * 0.75, x - s * 0.7, y + s * 0.35);
    ctx.bezierCurveTo(x - s * 0.7, y + s * 0.05, x - s * 0.25, y - s * 0.5, x, y - s);
    ctx.fill();
  }
  /* 文字なしのバーコード */
  function barcode(ctx, x, y, w, h, seed) {
    ctx.fillStyle = '#fbfbf8'; ctx.fillRect(x, y, w, h);
    var r = U.rng(seed || 11), unit = w / 100, px = x + w * 0.08, end = x + w * 0.92;
    ctx.fillStyle = '#1a1a1a';
    while (px < end) {
      var bw = unit * (1 + Math.floor(r() * 3));
      if (px + bw > end) break;
      ctx.fillRect(px, y + h * 0.1, bw, h * 0.8);
      px += bw + unit * (1 + Math.floor(r() * 3));
    }
  }
  /* オレンジの輪切り */
  function orangeSlice(ctx, cx, cy, r) {
    circle(ctx, cx, cy, r, '#e2701a');
    circle(ctx, cx, cy, r * 0.9, '#fbe9c4');
    circle(ctx, cx, cy, r * 0.84, '#f7b03a');
    var n = 10;
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * 2 * PI + 0.06, a1 = ((i + 1) / n) * 2 * PI - 0.06;
      var g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 0.8);
      g.addColorStop(0, '#fbc75a'); g.addColorStop(1, '#f08a22');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos((a0 + a1) / 2) * r * 0.1, cy + Math.sin((a0 + a1) / 2) * r * 0.1);
      ctx.arc(cx, cy, r * 0.79, a0, a1); ctx.closePath(); ctx.fill();
    }
    circle(ctx, cx, cy, r * 0.09, '#fdf0d2');
    ctx.globalAlpha = 0.35;
    circle(ctx, cx - r * 0.3, cy - r * 0.35, r * 0.18, '#ffffff');
    ctx.globalAlpha = 1;
  }

  /* ───────── 1. 牛乳パック ───────── */
  Items.define('milk', { tall: true, sound: 'slosh', heavy: 0.8 }, function () {
    var W = 0.07, BH = 0.195, RH = 0.028, FH = 0.012;
    var BLUE = '#1f4f9e', BLUE2 = '#2f6cc0', SKY = '#a9cdee';

    function base(ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#fbfcfd'); g.addColorStop(1, '#eef2f6');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 上の濃い青の帯
      ctx.fillStyle = BLUE; ctx.fillRect(0, 0, w, h * 0.12);
      ctx.fillStyle = '#86b8e6'; ctx.fillRect(0, h * 0.12, w, h * 0.012);
      // 下の波
      ctx.fillStyle = '#8fc0ea';
      ctx.beginPath(); ctx.moveTo(0, h * 0.775);
      ctx.bezierCurveTo(w * 0.3, h * 0.735, w * 0.65, h * 0.835, w, h * 0.765);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = BLUE2;
      ctx.beginPath(); ctx.moveTo(0, h * 0.8);
      ctx.bezierCurveTo(w * 0.3, h * 0.76, w * 0.7, h * 0.86, w, h * 0.79);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = BLUE; ctx.fillRect(0, h * 0.955, w, h * 0.045);
    }
    function finish(ctx, w, h, seed) {
      U.speckle(ctx, w, h, { n: 900, size: 1.2, alpha: 0.05, seed: seed });
    }
    var front = U.tex(256, 712, function (ctx, w, h) {
      base(ctx, w, h);
      // 空色の窓
      var y0 = h * 0.17, y1 = h * 0.72;
      var g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, '#7fb0e2'); g.addColorStop(1, '#3f7fca');
      ctx.fillStyle = g; rrect(ctx, w * 0.09, y0, w * 0.82, y1 - y0, 26); ctx.fill();
      // 注がれるミルク
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(w * 0.56, y0 + 6);
      ctx.bezierCurveTo(w * 0.62, h * 0.26, w * 0.53, h * 0.36, w * 0.53, h * 0.47);
      ctx.lineTo(w * 0.49, h * 0.47);
      ctx.bezierCurveTo(w * 0.49, h * 0.36, w * 0.56, h * 0.27, w * 0.50, y0 + 6);
      ctx.fill();
      // コップ
      var gx0 = w * 0.29, gx1 = w * 0.71, gy0 = h * 0.42, gy1 = h * 0.69;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy0); ctx.lineTo(w * 0.66, gy1); ctx.lineTo(w * 0.34, gy1); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(w * 0.302, h * 0.47);
      ctx.quadraticCurveTo(w * 0.5, h * 0.455, w * 0.698, h * 0.47);
      ctx.lineTo(w * 0.662, h * 0.682); ctx.lineTo(w * 0.338, h * 0.682); ctx.fill();
      ctx.fillStyle = '#e4eef7'; ctx.fillRect(w * 0.6, h * 0.49, w * 0.04, h * 0.17);
      ctx.strokeStyle = 'rgba(70,110,160,0.55)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(w * 0.34, gy1); ctx.lineTo(w * 0.66, gy1); ctx.lineTo(gx1, gy0); ctx.stroke();
      // はねるしずく
      var dr = [[0.36, 0.44, 7], [0.65, 0.435, 6], [0.30, 0.41, 5], [0.71, 0.405, 4.5], [0.43, 0.425, 4], [0.59, 0.42, 4]];
      for (var i = 0; i < dr.length; i++) circle(ctx, w * dr[i][0], h * dr[i][1], dr[i][2], '#ffffff');
      // 波の上の白いしずく
      drop(ctx, w * 0.25, h * 0.88, 13, '#ffffff');
      drop(ctx, w * 0.5, h * 0.9, 9, '#dcecf9');
      drop(ctx, w * 0.75, h * 0.87, 11, '#ffffff');
      finish(ctx, w, h, 5);
    });
    var back = U.tex(256, 712, function (ctx, w, h) {
      base(ctx, w, h);
      // 表のような罫線の枠（文字なし）
      ctx.strokeStyle = '#2a5ea8'; ctx.lineWidth = 2;
      rrect(ctx, w * 0.12, h * 0.2, w * 0.76, h * 0.3, 8); ctx.stroke();
      ctx.lineWidth = 1.2;
      for (var i = 1; i < 6; i++) { var y = h * 0.2 + h * 0.3 * i / 6; ctx.beginPath(); ctx.moveTo(w * 0.12, y); ctx.lineTo(w * 0.88, y); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(w * 0.58, h * 0.2); ctx.lineTo(w * 0.58, h * 0.5); ctx.stroke();
      ctx.fillStyle = '#c9dcef';
      for (i = 0; i < 6; i++) ctx.fillRect(w * 0.17, h * 0.2 + h * 0.3 * (i + 0.35) / 6, w * (0.22 + (i % 3) * 0.06), h * 0.012);
      // しずくの模様
      for (i = 0; i < 3; i++) drop(ctx, w * (0.25 + i * 0.25), h * 0.6, 14, i === 1 ? BLUE2 : '#8fc0ea');
      finish(ctx, w, h, 6);
    });
    function side(code) {
      return U.tex(256, 712, function (ctx, w, h) {
        base(ctx, w, h);
        // 縦に流れるミルクの帯
        ctx.fillStyle = '#d6e8f8';
        ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.14);
        ctx.bezierCurveTo(w * 0.1, h * 0.35, w * 0.6, h * 0.5, w * 0.35, h * 0.76);
        ctx.lineTo(w * 0.65, h * 0.76);
        ctx.bezierCurveTo(w * 0.85, h * 0.5, w * 0.35, h * 0.35, w * 0.6, h * 0.14);
        ctx.fill();
        var r = U.rng(code ? 21 : 22);
        for (var i = 0; i < 9; i++) drop(ctx, w * (0.15 + r() * 0.7), h * (0.18 + r() * 0.5), 5 + r() * 8, r() < 0.5 ? '#8fc0ea' : BLUE2);
        if (code) barcode(ctx, w * 0.2, h * 0.6, w * 0.6, h * 0.1, 31);
        // 折り目の線
        finish(ctx, w, h, code ? 7 : 8);
      });
    }
    var roofT = U.tex(256, 160, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a62b4'); g.addColorStop(1, BLUE);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(0, h * 0.78);
      ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.95, w, h * 0.72);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = '#86b8e6';
      ctx.beginPath(); ctx.moveTo(0, h * 0.88);
      ctx.bezierCurveTo(w * 0.3, h * 0.74, w * 0.6, h * 1.02, w, h * 0.84);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      drop(ctx, w * 0.5, h * 0.38, 22, '#ffffff');
      circle(ctx, w * 0.32, h * 0.42, 5, '#cfe3f6'); circle(ctx, w * 0.68, h * 0.36, 4, '#cfe3f6');
      U.speckle(ctx, w, h, { n: 300, size: 1.2, alpha: 0.05, seed: 9 });
    });
    var plainT = U.tex(128, 128, function (ctx, w, h) {
      ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 300, size: 1, alpha: 0.06, seed: 4 });
    });
    function paper(map) { return std({ map: map, roughness: 0.5, metalness: 0 }); }
    var mPlain = paper(plainT);
    var body = new T.RoundedBoxGeometry(W, BH, W, 3, 0.0025);
    var grp = new T.Group();
    grp.add(mesh(body, [paper(side(true)), paper(side(false)), mPlain, mPlain, paper(front), paper(back)], 0, BH / 2, 0));

    // 屋根（前後の斜面）
    var halfZ = W / 2 - 0.0005, ridgeZ = 0.0018;
    var run = halfZ - ridgeZ, slope = Math.sqrt(run * run + RH * RH), tilt = Math.atan2(run, RH);
    var mRoof = paper(roofT);
    var pg = new T.PlaneGeometry(W - 0.001, slope);
    var f = mesh(pg, mRoof, 0, BH + RH / 2, (halfZ + ridgeZ) / 2); f.rotation.x = -tilt; grp.add(f);
    var b = mesh(pg, mRoof, 0, BH + RH / 2, -(halfZ + ridgeZ) / 2); b.rotation.order = 'YXZ'; b.rotation.y = PI; b.rotation.x = -tilt; grp.add(b);
    // 屋根の横の三角（少し内側へ折れ込む）
    var sh = new T.Shape();
    sh.moveTo(-halfZ, 0); sh.lineTo(halfZ, 0); sh.lineTo(0, RH); sh.closePath();
    var tg = new T.ShapeGeometry(sh);
    var mTri = std({ color: 0xe9eef4, roughness: 0.5 });
    var s1 = mesh(tg, mTri, W / 2 - 0.0025, BH, 0); s1.rotation.y = PI / 2; grp.add(s1);
    var s2 = mesh(tg, mTri, -W / 2 + 0.0025, BH, 0); s2.rotation.y = -PI / 2; grp.add(s2);
    // てっぺんの閉じ代
    var finT = U.tex(256, 48, function (ctx, w, h) {
      ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = BLUE; ctx.fillRect(0, h * 0.62, w, h * 0.38);
      ctx.fillStyle = '#c8d4e0'; for (var i = 0; i < 40; i++) ctx.fillRect(i * w / 40, 0, 1, h * 0.25);
    });
    var fin = mesh(new T.RoundedBoxGeometry(W - 0.001, FH + 0.002, 0.0036, 2, 0.0012), paper(finT), 0, BH + RH + FH / 2 - 0.001, 0);
    grp.add(fin);
    return grp;
  });

  /* ───────── 2. オレンジジュース（PET ボトル） ───────── */
  Items.define('juice', { tall: true, sound: 'slosh', heavy: 0.7 }, function () {
    var R = 0.0375, NR = 0.0145, Y_SH = 0.132, Y_NK = 0.188, Y_TOP = 0.199;
    function rad(y) {
      if (y < 0.006) { var t = y / 0.006; return R - 0.006 * (1 - Math.sqrt(1 - (1 - t) * (1 - t))) - 0.0005; }
      if (y < Y_SH) {
        // ラベルの所はわずかに細く
        var w = (y > 0.05 && y < 0.118) ? -0.0006 * Math.sin((y - 0.05) / 0.068 * PI) : 0;
        return R + w;
      }
      if (y < Y_NK) { var s = (y - Y_SH) / (Y_NK - Y_SH); return NR + (R - NR) * 0.5 * (1 + Math.cos(PI * s)); }
      return NR;
    }
    var shell = [V2(0, 0.0015), V2(R - 0.012, 0.0005), V2(R - 0.006, 0)], liq = [V2(0, 0.003), V2(R - 0.013, 0.002)];
    var y;
    function stepAt(y) { return y < 0.006 ? 0.0015 : y < Y_SH - 0.004 ? 0.008 : 0.0035; }
    for (y = 0.0; y <= Y_TOP + 1e-6; y += stepAt(y)) shell.push(V2(rad(y), y));
    shell.push(V2(NR - 0.0018, Y_TOP)); shell.push(V2(NR - 0.0018, Y_TOP - 0.004));
    var LY = 0.176;
    for (y = 0.003; y < LY; y += stepAt(y)) liq.push(V2(rad(y) - 0.0014, y));
    liq.push(V2(rad(LY) - 0.0014, LY)); liq.push(V2((rad(LY) - 0.0014) * 0.6, LY + 0.0004)); liq.push(V2(0, LY + 0.0004));

    var grp = new T.Group();
    var juiceT = U.tex(128, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f39522'); g.addColorStop(1, '#d9650a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 500, size: 1.3, alpha: 0.08, light: '#ffd27a', dark: '#b85a08', seed: 12 });
    });
    var mLiq = phys({ map: juiceT, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.1, metalness: 0 });
    var lg = lathe(liq, 36, 0, 0.2);
    grp.add(mesh(lg, mLiq));
    var sg = lathe(shell, 48);
    var mShell = clearPlastic(0.13, 0xf4f8fa);
    var sm = mesh(sg, mShell); sm.renderOrder = 2; grp.add(sm);
    // 首のリング
    var ring = lathe([V2(NR - 0.0005, 0.1905), V2(0.0178, 0.191), V2(0.0181, 0.1925), V2(0.0178, 0.194), V2(NR - 0.0005, 0.1945)], 48);
    var rm = mesh(ring, clearPlastic(0.35)); rm.renderOrder = 3; grp.add(rm);

    // ラベル
    var LY0 = 0.052, LY1 = 0.116;
    var labT = U.tex(512, 160, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fbd46a'); g.addColorStop(0.55, '#f7b23c'); g.addColorStop(1, '#ef9226');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 上下の緑の帯
      ctx.fillStyle = '#2f7a35'; ctx.fillRect(0, 0, w, 12); ctx.fillRect(0, h - 14, w, 14);
      ctx.fillStyle = '#fffbe9'; ctx.fillRect(0, 12, w, 3); ctx.fillRect(0, h - 17, w, 3);
      // 葉
      function leaf(x, y, a, s) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = '#3f8f3a';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.5, -s * 0.45, s, 0); ctx.quadraticCurveTo(s * 0.5, s * 0.45, 0, 0); ctx.fill();
        ctx.strokeStyle = '#2b6a2a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(s * 0.9, 0); ctx.stroke();
        ctx.restore();
      }
      leaf(300, 52, -0.5, 46); leaf(212, 48, -2.6, 40);
      // まるごとのオレンジ
      var og = ctx.createRadialGradient(318, 82, 6, 330, 95, 50);
      og.addColorStop(0, '#fbb04a'); og.addColorStop(1, '#de6d14');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(332, 96, 44, 0, 2 * PI); ctx.fill();
      // 輪切り
      orangeSlice(ctx, 256, 88, 56);
      orangeSlice(ctx, 186, 104, 36);
      // しぶき
      var r = U.rng(41);
      for (var i = 0; i < 14; i++) circle(ctx, 150 + r() * 230, 30 + r() * 110, 1.5 + r() * 4, 'rgba(255,240,200,0.8)');
      // 裏側：バーコードと縞
      barcode(ctx, 24, 44, 78, 64, 52);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (i = 0; i < 4; i++) ctx.fillRect(420 + i * 14, 30, 6, 100);
      U.speckle(ctx, w, h, { n: 500, size: 1.2, alpha: 0.05, seed: 13 });
    });
    var lab = new T.CylinderGeometry(R + 0.0003, R + 0.0003, LY1 - LY0, 48, 1, true, -PI, 2 * PI);
    grp.add(mesh(lab, phys({ map: labT, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.15 }), 0, (LY0 + LY1) / 2, 0));

    // キャップ（側面にきざみ）
    var nT = U.tex(512, 16, function (ctx, w, h) {
      var n = 60;
      for (var i = 0; i < w; i++) {
        var s = Math.sin((i / w) * n * 2 * PI);
        ctx.fillStyle = 'rgb(' + Math.round(128 + 110 * s) + ',128,' + Math.round(255 - 40 * Math.abs(s)) + ')';
        ctx.fillRect(i, 0, 1, h);
      }
    }, { data: true });
    var CR = 0.0158, C0 = 0.1985, C1 = 0.22;
    var cap = lathe([V2(0.0001, C0), V2(CR - 0.0004, C0), V2(CR, C0 + 0.0006), V2(CR, C1 - 0.0016), V2(CR - 0.0006, C1 - 0.0003), V2(CR - 0.0016, C1), V2(0, C1)], 64);
    var capCol = U.tex(64, 64, function (ctx, w, h) {
      ctx.fillStyle = '#2c7a3c'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 120, size: 1, alpha: 0.08, seed: 14 });
    });
    grp.add(mesh(cap, std({ map: capCol, normalMap: nT, normalScale: new T.Vector2(0.8, 0.8), roughness: 0.38 })));
    return grp;
  });

  /* ───────── 3. ヨーグルト大カップ ───────── */
  Items.define('yogurt', { sound: 'tok', heavy: 0.5 }, function () {
    var RB = 0.0355, RT = 0.0465, CH = 0.077;
    var pts = [V2(0, 0.0015), V2(RB - 0.004, 0.0015), V2(RB - 0.0025, 0), V2(RB - 0.0005, 0.0008), V2(RB, 0.003)];
    for (var i = 1; i <= 12; i++) { var t = i / 12; pts.push(V2(RB + (RT - RB) * t, 0.003 + (CH - 0.003) * t)); }
    pts.push(V2(RT + 0.0015, CH + 0.0005)); pts.push(V2(RT + 0.0018, CH + 0.0018));
    var cup = lathe(pts, 64, 0, CH);
    var cupT = U.tex(512, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fbfcfd'); g.addColorStop(1, '#eef1f4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 青い帯（上の縁が波）
      var bg = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.8);
      bg.addColorStop(0, '#2c74c6'); bg.addColorStop(1, '#1a539f');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(0, h * 0.3);
      for (var x = 0; x <= w; x += 8) ctx.lineTo(x, h * 0.3 + Math.sin(x / w * 4 * PI) * h * 0.035);
      ctx.lineTo(w, h * 0.8); ctx.lineTo(0, h * 0.8); ctx.fill();
      ctx.fillStyle = '#8cbdec'; ctx.fillRect(0, h * 0.8, w, h * 0.025);
      ctx.fillStyle = '#1a539f'; ctx.fillRect(0, h * 0.86, w, h * 0.01);
      // 正面：薄い青の丸の上に白いひとすくい
      var cx = w * 0.5, cy = h * 0.54;
      circle(ctx, cx, cy, h * 0.25, '#5e9bdc');
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, h * 0.25, 0, 2 * PI); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - 52, cy + 30);
      ctx.bezierCurveTo(cx - 58, cy + 4, cx - 34, cy - 10, cx - 18, cy - 8);
      ctx.bezierCurveTo(cx - 20, cy - 30, cx + 6, cy - 40, cx + 14, cy - 24);
      ctx.bezierCurveTo(cx + 22, cy - 34, cx + 34, cy - 44, cx + 26, cy - 54);
      ctx.bezierCurveTo(cx + 48, cy - 40, cx + 40, cy - 18, cx + 30, cy - 10);
      ctx.bezierCurveTo(cx + 54, cy - 6, cx + 62, cy + 16, cx + 52, cy + 30);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d3dee9'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - 38, cy + 8); ctx.quadraticCurveTo(cx - 4, cy - 2, cx + 30, cy + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 12, cy - 14); ctx.quadraticCurveTo(cx + 8, cy - 22, cx + 26, cy - 12); ctx.stroke();
      ctx.fillStyle = '#e9eef4'; ctx.fillRect(cx - 52, cy + 26, 104, 4);
      // しずく
      drop(ctx, cx - 82, cy - 22, 9, '#ffffff'); drop(ctx, cx + 84, cy - 12, 7, '#ffffff');
      circle(ctx, cx + 70, cy + 30, 4, '#ffffff'); circle(ctx, cx - 72, cy + 28, 3, '#ffffff');
      // 横の白い渦の模様
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 4;
      [w * 0.2, w * 0.8].forEach(function (sx) {
        ctx.beginPath();
        for (var a = 0; a < 4 * PI; a += 0.2) { var rr = 3 + a * 3.2; ctx.lineTo(sx + Math.cos(a) * rr, h * 0.55 + Math.sin(a) * rr); }
        ctx.stroke();
      });
      // 裏：バーコード
      barcode(ctx, 0, h * 0.36, 62, h * 0.3, 61);
      barcode(ctx, w - 30, h * 0.36, 30, h * 0.3, 62);
      U.speckle(ctx, w, h, { n: 900, size: 1.2, alpha: 0.04, seed: 15 });
    });
    var grp = new T.Group();
    grp.add(mesh(cup, phys({ map: cupT, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.2 })));
    // ふた
    var LR = RT + 0.0028, L0 = CH - 0.0005, L1 = 0.085;
    var lid = lathe([V2(RT + 0.0006, L0), V2(LR, L0 + 0.0003), V2(LR + 0.0003, L0 + 0.001), V2(LR + 0.0003, L1 - 0.0016),
      V2(LR - 0.0005, L1 - 0.0004), V2(LR - 0.0025, L1), V2(0, L1)], 64);
    var mLidSide = phys({ color: 0x1f5ba8, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    grp.add(mesh(lid, mLidSide));
    var topT = U.tex(256, 256, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w * 0.45, h * 0.42, 10, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#3a86d6'); g.addColorStop(1, '#1d56a3');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.43, 0, 2 * PI); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.39, 0, 2 * PI); ctx.stroke();
      // 白い渦
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath();
      for (var a = 0; a < 5 * PI; a += 0.15) { var rr = 4 + a * 4.2; ctx.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); }
      ctx.stroke();
      U.speckle(ctx, w, h, { n: 300, size: 1, alpha: 0.05, seed: 16 });
    });
    var top = mesh(new T.CircleGeometry(LR - 0.003, 48), phys({ map: topT, roughness: 0.28, clearcoat: 0.6 }), 0, L1 + 0.0001, 0);
    top.rotation.x = -PI / 2; grp.add(top);
    return grp;
  });

  /* ───────── 4. プリン ───────── */
  Items.define('pudding', { sound: 'tok', heavy: 0.3 }, function () {
    var RB = 0.0275, RT = 0.0415, CH = 0.066, SEG = 64;
    function cr(y) { return RB + (RT - RB) * (y / CH); }
    var pts = [V2(0, 0.0012), V2(RB - 0.003, 0.0012), V2(RB - 0.0015, 0), V2(RB, 0.0015)];
    for (var i = 1; i <= 12; i++) { var y = 0.0015 + (CH - 0.0015) * i / 12; pts.push(V2(cr(y), y)); }
    pts.push(V2(RT + 0.0025, CH + 0.0003)); pts.push(V2(RT + 0.0028, CH + 0.0016)); pts.push(V2(RT + 0.0001, CH + 0.0016));
    var cup = lathe(pts, SEG);
    // ふちに縦のひだ
    var p = cup.attributes.position;
    for (i = 0; i < p.count; i++) {
      var yy = p.getY(i);
      if (yy > 0.03 && yy < CH - 0.0005) {
        var x = p.getX(i), z = p.getZ(i), ph = Math.atan2(x, z);
        var f = U.smooth((yy - 0.03) / 0.022) * U.smooth((CH - yy) / 0.004);
        var k = 1 + 0.03 * f * (0.5 + 0.5 * Math.cos(32 * ph));
        p.setX(i, x * k); p.setZ(i, z * k);
      }
    }
    cup.computeVertexNormals(); fixSeam(cup, SEG, pts.length);
    var grp = new T.Group();
    // 中身：カラメルとカスタード
    var CY = 0.0105, TOP = 0.0625, IN = 0.0012;
    var car = [V2(0, 0.0018), V2(RB - 0.002, 0.0018)];
    for (i = 0; i <= 4; i++) { y = 0.0018 + (CY - 0.0018) * i / 4; car.push(V2(cr(y) - IN, y)); }
    car.push(V2(0, CY));
    var carT = U.tex(256, 64, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#7a3a12'); g.addColorStop(1, '#4a1e08');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 200, size: 1.5, alpha: 0.1, light: '#a5541c', dark: '#2a0f03', seed: 17 });
    });
    grp.add(mesh(lathe(car, 48, 0, CY), phys({ map: carT, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 })));
    var cus = [V2(0, CY), V2(cr(CY) - IN, CY)];
    // カラメルとの境目に少しにじみ
    for (i = 1; i <= 8; i++) { y = CY + (TOP - CY) * i / 8; cus.push(V2(cr(y) - IN, y)); }
    cus.push(V2(cr(TOP) - IN - 0.002, TOP + 0.0008)); cus.push(V2(0, TOP + 0.001));
    var cusT = U.tex(256, 128, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f0c44a'); g.addColorStop(0.85, '#e9b43a'); g.addColorStop(1, '#a8661e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      var r = U.rng(18);
      for (var j = 0; j < 60; j++) { ctx.globalAlpha = 0.25; circle(ctx, r() * w, r() * h * 0.85, 0.8 + r() * 1.6, '#e2b553'); }
      ctx.globalAlpha = 1;
      U.speckle(ctx, w, h, { n: 300, size: 1.2, alpha: 0.05, light: '#fff2c4', dark: '#c99540', seed: 19 });
    });
    grp.add(mesh(lathe(cus, 48, CY - 0.006, TOP), std({ map: cusT, roughness: 0.42 })));
    var cm = mesh(cup, clearPlastic(0.24)); cm.renderOrder = 2; grp.add(cm);
    // 金色のふた
    var foilT = U.tex(256, 256, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w * 0.4, h * 0.4, 8, w / 2, h / 2, w * 0.55);
      g.addColorStop(0, '#f3dc94'); g.addColorStop(1, '#c99a3e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(120,80,20,0.25)'; ctx.lineWidth = 1;
      for (var k = 0; k < 10; k++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, w * (0.44 + k * 0.006), 0, 2 * PI); ctx.stroke(); }
      // 中央にクリーム色の丸とプリンの絵
      circle(ctx, w / 2, h / 2, w * 0.33, '#7a3d16');
      circle(ctx, w / 2, h / 2, w * 0.31, '#fbf2dc');
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.66, w * 0.21, h * 0.05, 0, 0, 2 * PI); ctx.fill();
      ctx.strokeStyle = '#d9cdb8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#f3cd63';
      ctx.beginPath(); ctx.moveTo(w * 0.37, h * 0.65); ctx.lineTo(w * 0.42, h * 0.41); ctx.lineTo(w * 0.58, h * 0.41); ctx.lineTo(w * 0.63, h * 0.65); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6a2e0c';
      ctx.beginPath(); ctx.moveTo(w * 0.418, h * 0.43); ctx.lineTo(w * 0.42, h * 0.40); ctx.lineTo(w * 0.58, h * 0.40); ctx.lineTo(w * 0.582, h * 0.43);
      ctx.quadraticCurveTo(w * 0.57, h * 0.5, w * 0.555, h * 0.44); ctx.quadraticCurveTo(w * 0.52, h * 0.53, w * 0.5, h * 0.44);
      ctx.quadraticCurveTo(w * 0.46, h * 0.49, w * 0.445, h * 0.44); ctx.quadraticCurveTo(w * 0.43, h * 0.47, w * 0.418, h * 0.43); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(w * 0.44, h * 0.47, w * 0.02, h * 0.13);
      U.speckle(ctx, w, h, { n: 500, size: 1, alpha: 0.08, seed: 20 });
    });
    var FR = RT + 0.0028, FY = CH + 0.0016;
    var foilM = std({ map: foilT, metalness: 0.75, roughness: 0.32 });
    var foil = mesh(new T.CylinderGeometry(FR, FR, 0.0005, 64), foilM, 0, FY + 0.00025, 0);
    foil.rotation.y = PI / 2;
    grp.add(foil);
    // つまみ（右前）
    var tab = new T.Shape();
    tab.moveTo(-0.006, 0); tab.lineTo(0.006, 0); tab.quadraticCurveTo(0.0065, 0.008, 0.0035, 0.009); tab.lineTo(-0.0035, 0.009); tab.quadraticCurveTo(-0.0065, 0.008, -0.006, 0);
    var tg = new T.ShapeGeometry(tab, 8);
    var tm = mesh(tg, std({ color: 0xd8b25a, metalness: 0.75, roughness: 0.32, side: T.DoubleSide }));
    var piv = new T.Group(); piv.position.set(0, FY + 0.0004, 0); piv.rotation.y = PI / 4; grp.add(piv);
    tm.rotation.x = -PI / 2 + 0.25; tm.position.z = FR - 0.002; piv.add(tm);
    return grp;
  });

  /* ───────── 5. たまご6こパック ───────── */
  Items.define('egg', { sound: 'rattle', heavy: 0.4 }, function () {
    var PX = 0.048, PZ = 0.0475, FY = 0.033, CRr = 0.0226;
    var grp = new T.Group();
    // たまご（とがった方が下）
    var EL = 0.058, ER = 0.0213, ept = [];
    for (var i = 0; i <= 12; i++) {
      var t = (i / 12) * PI;
      var yy = EL * 0.5 * (1 - Math.cos(t));
      var rr = ER * Math.sin(t) * (1 - 0.1 * Math.cos(t)) * 1.0;
      ept.push(V2(Math.max(rr, 0.00001 * (i > 0 && i < 12 ? 1 : 0)), yy));
    }
    var eg = lathe(ept, 32);
    eg.computeVertexNormals(); fixSeam(eg, 32, ept.length);
    var eT = U.tex(256, 256, function (ctx, w, h) {
      ctx.fillStyle = '#eadcc6'; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 1500, size: 1.2, alpha: 0.06, light: '#ffffff', dark: '#b8a588', seed: 23 });
      U.speckle(ctx, w, h, { n: 60, size: 2.5, alpha: 0.05, dark: '#a08060', lightRatio: 0, seed: 24 });
    });
    var mE = [std({ map: eT, roughness: 0.72, color: 0xf6f2ec }), std({ map: eT, roughness: 0.74, color: 0xefe4d4 }), std({ map: eT, roughness: 0.72, color: 0xfaf6f0 })];
    var cells = [];
    for (var cx = -1; cx <= 1; cx++) for (var cz = -1; cz <= 1; cz += 2) cells.push([cx * PX, cz * PZ / 2]);
    var rnd = U.rng(25);
    cells.forEach(function (c, k) {
      var e = mesh(eg, mE[k % 3], c[0], 0.0036, c[1]);
      e.rotation.y = rnd() * 6.28; e.rotation.z = (rnd() - 0.5) * 0.05; e.rotation.x = (rnd() - 0.5) * 0.05;
      grp.add(e);
    });
    var mP = clearPlastic(0.2, 0xf6fbff);
    // 下のくぼみ
    var cupG = lathe([V2(0, 0.0012), V2(0.011, 0.0012), V2(0.0145, 0.0022), V2(0.0185, 0.008), V2(0.021, 0.017), V2(0.0222, 0.026), V2(CRr, FY)], 32);
    // 上のふくらみ
    var domeG = lathe([V2(CRr + 0.0002, FY + 0.0018), V2(0.0228, 0.044), V2(0.0218, 0.054), V2(0.0192, 0.0625), V2(0.0145, 0.0678), V2(0.008, 0.0698), V2(0, 0.07)], 32);
    cells.forEach(function (c) {
      var a = mesh(cupG, mP, c[0], 0, c[1]); a.renderOrder = 2; grp.add(a);
      var b = mesh(domeG, mP, c[0], 0, c[1]); b.renderOrder = 3; grp.add(b);
    });
    // つば（穴あきの板）上下2枚
    function plate(th) {
      var W = 0.155, D = 0.105, r = 0.008, s = new T.Shape();
      s.moveTo(-W / 2 + r, -D / 2); s.lineTo(W / 2 - r, -D / 2); s.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
      s.lineTo(W / 2, D / 2 - r); s.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2); s.lineTo(-W / 2 + r, D / 2);
      s.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r); s.lineTo(-W / 2, -D / 2 + r); s.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
      cells.forEach(function (c) { var hp = new T.Path(); hp.absarc(c[0], -c[1], CRr, 0, 2 * PI, true); s.holes.push(hp); });
      var g = new T.ExtrudeGeometry(s, { depth: th, bevelEnabled: false, curveSegments: 16 });
      g.rotateX(-PI / 2);
      return g;
    }
    var p1 = mesh(plate(0.0012), mP, 0, FY - 0.0006, 0); p1.renderOrder = 2; grp.add(p1);
    var p2 = mesh(plate(0.0012), mP, 0, FY + 0.0009, 0); p2.renderOrder = 3; grp.add(p2);
    // 前のラベル（つばの下に差し込まれた紙）
    var labT = U.tex(512, 64, function (ctx, w, h) {
      ctx.fillStyle = '#fbf8f1'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d9542a'; ctx.fillRect(0, 0, w, h * 0.2); ctx.fillRect(0, h * 0.8, w, h * 0.2);
      ctx.fillStyle = '#f1b83a'; ctx.fillRect(0, h * 0.2, w, h * 0.06); ctx.fillRect(0, h * 0.74, w, h * 0.06);
      // 黄色の窓に目玉焼きの絵
      ctx.fillStyle = '#f4c64a'; rrect(ctx, 96, h * 0.22, 210, h * 0.56, 8); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(170, h / 2, 46, 15, 0.05, 0, 2 * PI); ctx.fill();
      circle(ctx, 176, h / 2, 10, '#ee8a12'); circle(ctx, 173, h / 2 - 3, 3, '#fbd479');
      // たまご2つの絵
      ctx.fillStyle = '#fbf3e4'; ctx.beginPath(); ctx.ellipse(250, h / 2, 11, 14, 0, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#efdcbc'; ctx.beginPath(); ctx.ellipse(276, h / 2 + 1, 11, 14, 0.2, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#4c8e3a'; ctx.fillRect(28, h * 0.4, 52, h * 0.2);
      barcode(ctx, 360, h * 0.27, 110, h * 0.46, 71);
    });
    var lab = mesh(new T.BoxGeometry(0.128, 0.017, 0.0004), [
      std({ color: 0xf4f0e8, roughness: 0.7 }), std({ color: 0xf4f0e8, roughness: 0.7 }), std({ color: 0xf4f0e8, roughness: 0.7 }),
      std({ color: 0xf4f0e8, roughness: 0.7 }), std({ map: labT, roughness: 0.62 }), std({ color: 0xf4f0e8, roughness: 0.7 })], 0, FY - 0.0095, 0.0505);
    lab.rotation.x = 0.06;
    grp.add(lab);
    return grp;
  });

  /* ───────── 6. 穴あきチーズ ───────── */
  Items.define('cheese', { sound: 'thud', heavy: 0.4 }, function () {
    var R = 0.12, H = 0.06, HA = Math.asin(0.045 / R);
    var ch = Math.cos(HA), sh = Math.sin(HA);
    var rnd = U.rng(81), centers = [];
    var PASTE = '#efd27c';
    var dA = new T.Vector3(ch, 0, sh), dB = new T.Vector3(ch, 0, -sh), Y = new T.Vector3(0, 1, 0);

    function okCenter(c, r) {
      for (var i = 0; i < centers.length; i++) if (centers[i].c.distanceTo(c) < centers[i].r + r + 0.002) return false;
      return true;
    }
    function pasteBg(ctx, w, h, seed) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#efcd62'); g.addColorStop(1, '#e6bf52');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 1600, size: 1.4, alpha: 0.06, light: '#fff3c8', dark: '#c79a3a', seed: seed });
      // 小さなすじ穴
      var r = U.rng(seed + 1);
      for (var i = 0; i < 26; i++) {
        var x = r() * w, y = r() * h, s = 1 + r() * 2.2;
        ctx.fillStyle = 'rgba(150,110,30,0.35)';
        ctx.beginPath(); ctx.ellipse(x, y, s * 1.4, s, r() * 3, 0, 2 * PI); ctx.fill();
      }
    }
    function cutHole(ctx, px, py, pr) {
      var g = ctx.createRadialGradient(px, py, pr * 0.9, px, py, pr * 1.25);
      g.addColorStop(0, 'rgba(190,140,50,0.55)'); g.addColorStop(1, 'rgba(190,140,50,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr * 1.25, 0, 2 * PI); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(px, py, pr, 0, 2 * PI); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    var bowls = [];
    function addBowl(pos, inward, r) {
      centers.push({ c: pos.clone(), r: r });
      bowls.push({ p: pos.clone(), n: inward.clone(), r: r });
    }
    function rindEdge(ctx, x, y, w, h) {
      ctx.fillStyle = 'rgba(200,150,50,0.55)'; ctx.fillRect(x, y, w, h);
    }

    /* 側面（四角）: a は頂点から外へ 0..R、b は高さ 0..H */
    function sideFace(dir, inward, seed, flip) {
      var holes = [];
      for (var tries = 0; tries < 200 && holes.length < 7; tries++) {
        var r = 0.0035 + Math.pow(rnd(), 1.5) * 0.0075;
        var a = 0.028 + rnd() * (R - 0.04), b = r + 0.004 + rnd() * (H - 2 * r - 0.008);
        if (a + r > R - 0.006) continue;
        if (r > a * Math.sin(2 * HA) * 0.8) continue;
        var pos = dir.clone().multiplyScalar(a).addScaledVector(Y, b);
        if (!okCenter(pos, r)) continue;
        holes.push([a, b, r]); addBowl(pos, inward, r);
      }
      var tex = U.tex(512, 256, function (ctx, w, h) {
        pasteBg(ctx, w, h, seed);
        rindEdge(ctx, w * (1 - 0.004 / R), 0, w, h);
        holes.forEach(function (q) { cutHole(ctx, q[0] / R * w, (1 - q[1] / H) * h, q[2] / R * w); });
      });
      var p00 = new T.Vector3(), p10 = dir.clone().multiplyScalar(R), p11 = p10.clone().addScaledVector(Y, H), p01 = Y.clone().multiplyScalar(H);
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z, p01.x, p01.y, p01.z], 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      return mesh(g, std({ map: tex, alphaTest: 0.5, roughness: 0.45 }));
    }
    /* 上下（扇形） */
    function sector(y, up, holesOn, seed) {
      var holes = [];
      if (holesOn) {
        for (var tries = 0; tries < 300 && holes.length < 8; tries++) {
          var r = 0.003 + Math.pow(rnd(), 1.4) * 0.008;
          if (r > H / 2 - 0.004) r = H / 2 - 0.004;
          var x = 0.03 + rnd() * (R - 0.04), zmax = x * Math.tan(HA) - r - 0.003;
          if (zmax <= 0 || x + r > R * Math.cos(HA) - 0.004) continue;
          var z = (rnd() * 2 - 1) * zmax;
          var pos = new T.Vector3(x, y, z);
          if (!okCenter(pos, r)) continue;
          holes.push([x, z, r]); addBowl(pos, new T.Vector3(0, up ? -1 : 1, 0), r);
        }
      }
      var tex = U.tex(512, 512, function (ctx, w, h) {
        pasteBg(ctx, w, h, seed);
        // 外周の皮の色の縁
        ctx.strokeStyle = 'rgba(200,150,50,0.6)'; ctx.lineWidth = 0.004 / R * w;
        ctx.beginPath(); ctx.arc(0, h / 2, w * (1 - 0.002 / R), -HA - 0.05, HA + 0.05); ctx.stroke();
        holes.forEach(function (q) { cutHole(ctx, q[0] / R * w, (1 - (q[1] + R / 2) / R) * h, q[2] / R * w); });
      });
      var pos = [0, y, 0], uv = [0, 0.5], idx = [], N = 32;
      for (var i = 0; i <= N; i++) {
        var a = -HA + 2 * HA * i / N, px = R * Math.cos(a), pz = R * Math.sin(a);
        pos.push(px, y, pz); uv.push(px / R, (pz + R / 2) / R);
        if (i > 0) { if (up) idx.push(0, i + 1, i); else idx.push(0, i, i + 1); }
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return mesh(g, std({ map: tex, alphaTest: 0.5, roughness: 0.45 }));
    }

    var inner = new T.Group();
    inner.add(sector(H, true, true, 91));
    inner.add(sector(0, false, false, 92));
    inner.add(sideFace(dA, new T.Vector3(sh, 0, -ch), 93, false));
    inner.add(sideFace(dB, new T.Vector3(sh, 0, ch), 94, true));
    // 外周の皮
    var rindT = U.tex(256, 128, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#cf9533'); g.addColorStop(0.5, '#d9a440'); g.addColorStop(1, '#c88b2c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      U.speckle(ctx, w, h, { n: 900, size: 1.5, alpha: 0.08, light: '#f3d384', dark: '#9c6a20', seed: 95 });
      ctx.strokeStyle = 'rgba(150,100,30,0.18)'; ctx.lineWidth = 1;
      for (var i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, h * (0.1 + i * 0.11)); ctx.lineTo(w, h * (0.12 + i * 0.11)); ctx.stroke(); }
    });
    var rind = new T.CylinderGeometry(R, R, H, 32, 1, true, PI / 2 - HA, 2 * HA);
    inner.add(mesh(rind, std({ map: rindT, roughness: 0.5 }), 0, H / 2, 0));
    // 穴の内側（へこんだ球面）
    var bowlG = new T.SphereGeometry(1, 18, 7, 0, 2 * PI, 0, PI / 2);
    var bowlM = std({ color: 0xd9ad48, roughness: 0.5, side: T.BackSide });
    var up = new T.Vector3(0, 1, 0);
    bowls.forEach(function (bw) {
      var m = mesh(bowlG, bowlM, bw.p.x, bw.p.y, bw.p.z);
      m.scale.setScalar(bw.r);
      m.quaternion.setFromUnitVectors(up, bw.n);
      inner.add(m);
    });
    var grp = new T.Group();
    grp.add(inner);
    // 外寸の中心をそろえる
    inner.position.x = -R / 2;
    return grp;
  });
})();
