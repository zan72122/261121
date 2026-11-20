/* 11-items-produce.js — 品物（青果など6種）: いちごパック・トマト・りんご・にんじん・キャベツ・すいか。
   どれも原点=底の中心、正面 +Z、実寸メートル。模様はすべてキャンバスで描く。 */
(function () {
  'use strict';
  var T = window.THREE;
  var PI = Math.PI, TAU = Math.PI * 2;

  /* ───── 小道具 ───── */
  function smooth(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(i, j, k) { var n = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); }
  /* 3D の値ノイズ（-1..1） */
  function noise(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    function h(a, b, c) { return hash(ix + a, iy + b, iz + c); }
    var x00 = lerp(h(0, 0, 0), h(1, 0, 0), fx), x10 = lerp(h(0, 1, 0), h(1, 1, 0), fx);
    var x01 = lerp(h(0, 0, 1), h(1, 0, 1), fx), x11 = lerp(h(0, 1, 1), h(1, 1, 1), fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
  }
  function fbm(x, y, z) { return noise(x, y, z) * 0.6 + noise(x * 2.1, y * 2.1, z * 2.1) * 0.28 + noise(x * 4.3, y * 4.3, z * 4.3) * 0.12; }

  /* 格子の曲面: fn(u,v) -> [x,y,z]。wrap:true なら u=0 と u=1 の法線をそろえる。 */
  function grid(nu, nv, fn, wrap) {
    var pos = [], uv = [], idx = [], i, j;
    for (j = 0; j <= nv; j++) {
      for (i = 0; i <= nu; i++) {
        var p = fn(i / nu, j / nv);
        pos.push(p[0], p[1], p[2]);
        uv.push(i / nu, j / nv);
      }
    }
    for (j = 0; j < nv; j++) {
      for (i = 0; i < nu; i++) {
        var a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (wrap) {
      var n = g.attributes.normal;
      for (j = 0; j <= nv; j++) {
        var i0 = j * (nu + 1), i1 = i0 + nu;
        var sx = n.getX(i0) + n.getX(i1), sy = n.getY(i0) + n.getY(i1), sz = n.getZ(i0) + n.getZ(i1);
        var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        n.setXYZ(i0, sx / l, sy / l, sz / l); n.setXYZ(i1, sx / l, sy / l, sz / l);
      }
    }
    return g;
  }
  /* 回転体: prof(v) -> [r, y]、deform(x,y,z,u,v) で変形してよい */
  function lathe(nu, nv, prof, deform) {
    return grid(nu, nv, function (u, v) {
      var p = prof(v), a = u * TAU;
      var x = p[0] * Math.sin(a), y = p[1], z = p[0] * Math.cos(a);
      return deform ? deform(x, y, z, u, v, p[0]) : [x, y, z];
    }, true);
  }
  function std(o) { o.side = o.side || T.DoubleSide; return new T.MeshStandardMaterial(o); }
  function phys(o) { o.side = o.side || T.DoubleSide; return new T.MeshPhysicalMaterial(o); }
  function mesh(g, m, parent) { var x = new T.Mesh(g, m); if (parent) parent.add(x); return x; }
  function rgb(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }
  /* 色むら（やわらかい大きなしみ） */
  function blotch(ctx, w, h, n, seed, col, alpha, size) {
    var r = U.rng(seed);
    for (var i = 0; i < n; i++) {
      var x = r() * w, y = r() * h, s = size * (0.4 + r());
      var gr = ctx.createRadialGradient(x, y, 0, x, y, s);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * (0.4 + 0.6 * r());
      ctx.fillStyle = gr;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
      if (x < s) ctx.fillRect(x - s + w, y - s, s * 2, s * 2);
      if (x > w - s) ctx.fillRect(x - s - w, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  /* 細い葉（へた用）: 長さ1、根元が原点、+X へ伸び、先が下へ反る */
  function leafGeom(len, wid, droop, lift) {
    return grid(6, 2, function (u, v) {
      var s = u, w = wid * Math.pow(Math.sin(PI * Math.min(1, s * 0.92 + 0.06)), 0.8) * (1 - s * 0.55);
      var c = (v - 0.5) * 2;
      var x = len * s;
      var y = lift * Math.sin(s * PI * 0.6) - droop * s * s - Math.abs(c) * w * 0.25;
      return [x, y, c * w];
    });
  }
  function merge(list) { return T.BufferGeometryUtils.mergeGeometries(list, false); }
  function xform(g, px, py, pz, rx, ry, rz, s) {
    var m = new T.Matrix4().compose(new T.Vector3(px, py, pz),
      new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ')), new T.Vector3(s, s, s));
    return g.clone().applyMatrix4(m);
  }
  /* 星形のへた（中心が原点、上が +Y） */
  function calyxGeom(n, len, wid, droop, lift, stemH, stemR, seed) {
    var r = U.rng(seed), list = [], base = leafGeom(1, wid / len, droop / len, lift / len);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + (r() - 0.5) * 0.5, s = len * (0.8 + 0.35 * r());
      list.push(xform(base, 0, 0, 0, 0, a, (r() - 0.3) * 0.3, s));
    }
    var st = new T.CylinderGeometry(stemR * 0.8, stemR, stemH, 8, 1);
    st.translate(0, stemH / 2, 0);
    st.rotateZ(0.15);
    st.deleteAttribute('normal'); st.computeVertexNormals();
    list.push(st);
    return merge(list);
  }
  function greenTex(seed, base) {
    return U.tex(64, 64, function (c, w, h) {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 12, seed, '#9cb050', 0.35, 14);
      blotch(c, w, h, 10, seed + 1, '#2b4a16', 0.35, 12);
      c.globalAlpha = 0.35; c.strokeStyle = '#c8d890'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke(); c.globalAlpha = 1;
    });
  }

  /* ═════════ 1. いちごパック ═════════ */
  Items.define('strawberry', { tall: false, sound: 'crinkle', heavy: 0.3 }, function () {
    var G = new T.Group();
    var L = 0.034, R = 0.0145;
    function prof(v) {
      var k = 0.7;
      if (v <= k) {
        var t = v / k;
        return [Math.max(0.0004, R * Math.pow(Math.sin(t * PI / 2), 0.95) * (1 - 0.06 * Math.pow(t, 6))), L * 0.7 * t];
      }
      var a = (v - k) / (1 - k) * PI / 2, r = R * 0.94 * Math.cos(a);
      return [r, L * 0.7 + L * 0.26 * Math.sin(a) - 0.05 * L * Math.pow(1 - r / R, 4)];
    }
    /* 粒の形を3通り */
    var berryG = [], v;
    for (v = 0; v < 3; v++) {
      (function (seed) {
        berryG.push(lathe(32, 11, prof, function (x, y, z, u, vv, rr) {
          var nx = x / (R), nz = z / R;
          var f = 1 + 0.07 * fbm(nx * 1.3 + seed * 3, y / L * 1.6, nz * 1.3) + 0.025 * Math.cos(u * TAU * 3 + seed);
          var flat = 1 + (seed - 1) * 0.08;
          return [x * f * flat, y, z * f / flat];
        }));
      })(v);
    }
    var seedTex = function (bump) {
      return U.tex(512, 256, function (c, w, h) {
        var r = U.rng(bump ? 11 : 11), i, j;
        if (bump) { c.fillStyle = '#808080'; c.fillRect(0, 0, w, h); }
        else {
          var g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, '#d8a47a'); g.addColorStop(0.07, '#c8473c'); g.addColorStop(0.2, '#ad1a1f');
          g.addColorStop(0.7, '#9e1219'); g.addColorStop(1, '#8a0e16');
          c.fillStyle = g; c.fillRect(0, 0, w, h);
          blotch(c, w, h, 40, 5, '#6e0810', 0.35, 40);
          blotch(c, w, h, 30, 6, '#d0302a', 0.3, 30);
        }
        var rows = 15, per = 22;
        for (j = 0; j < rows; j++) {
          for (i = 0; i < per; i++) {
            var x = (i + (j % 2) * 0.5 + (r() - 0.5) * 0.3) / per * w;
            var y = ((j + 0.7 + (r() - 0.5) * 0.3) / (rows + 0.6)) * h;
            var sx = 4.2, sy = 4.6;
            if (bump) {
              c.fillStyle = '#3a3a3a';
              c.beginPath(); c.ellipse(x, y, sx * 1.5, sy * 1.5, 0, 0, TAU); c.fill();
              c.fillStyle = '#d8d8d8';
              c.beginPath(); c.ellipse(x, y - 1, sx * 0.55, sy * 0.75, 0, 0, TAU); c.fill();
            } else {
              c.fillStyle = 'rgba(70,0,8,0.45)';
              c.beginPath(); c.ellipse(x, y, sx * 1.4, sy * 1.4, 0, 0, TAU); c.fill();
              c.fillStyle = r() < 0.3 ? '#c99a3a' : '#e3c560';
              c.beginPath(); c.ellipse(x, y - 1, sx * 0.55, sy * 0.75, 0, 0, TAU); c.fill();
              c.fillStyle = 'rgba(255,250,210,0.6)';
              c.beginPath(); c.arc(x - 0.6, y - 2, 0.9, 0, TAU); c.fill();
            }
          }
        }
        if (!bump) U.speckle(c, w, h, { n: 900, size: 1, alpha: 0.12, seed: 8 });
      }, { data: bump });
    };
    var berryM = phys({
      map: seedTex(false), bumpMap: seedTex(true), bumpScale: 2.0,
      roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.3, side: T.FrontSide
    });
    var calG = calyxGeom(7, 0.0095, 0.0024, 0.006, 0.0015, 0.004, 0.0009, 4);
    var calM = std({ map: greenTex(3, '#3f6a22'), roughness: 0.65 });

    var Y = new T.Vector3(0, 1, 0);
    var spheres = [];
    function berry(px, py, pz, dir, s, roll, gi) {
      var piv = new T.Group();
      var inner = new T.Group();
      inner.position.y = -L * 0.5;
      mesh(berryG[gi % 3], berryM, inner);
      var cal = mesh(calG, calM, inner);
      cal.position.y = L * 0.955;
      cal.rotation.y = roll * 2;
      piv.add(inner);
      dir = new T.Vector3(dir[0], dir[1], dir[2]).normalize();
      var q = new T.Quaternion().setFromUnitVectors(Y, dir);
      var qr = new T.Quaternion().setFromAxisAngle(Y, roll);
      piv.quaternion.copy(q.multiply(qr));
      piv.scale.setScalar(s);
      piv.position.set(px, py, pz);
      G.add(piv);
      for (var k = -1; k <= 1; k += 2) {
        spheres.push([px + dir.x * L * 0.2 * k * s, py + dir.y * L * 0.2 * k * s, pz + dir.z * L * 0.2 * k * s, R * 0.95 * s]);
      }
    }
    var rr = U.rng(21), i;
    var floorY = 0.0035;
    /* 下の段: 手前と奥に4粒ずつ。へたは壁側、先は中央 */
    for (i = 0; i < 4; i++) {
      var x = -0.048 + i * 0.032 + (rr() - 0.5) * 0.004;
      var s1 = 0.92 + rr() * 0.14, s2 = 0.92 + rr() * 0.14;
      berry(x, floorY + R * s1 * 0.98, 0.022, [(rr() - 0.5) * 0.4, 0.12, 1], s1, rr() * TAU, i);
      berry(x + (rr() - 0.5) * 0.006, floorY + R * s2 * 0.98, -0.022, [(rr() - 0.5) * 0.4, 0.12, -1], s2, rr() * TAU, i + 1);
    }
    /* 上の段: まん中に3粒、少し起き上がる */
    berry(-0.034, 0.033, 0.003, [-0.5, 0.35, 0.35], 1.02, 1.2, 2);
    berry(0.002, 0.035, -0.004, [0.15, 0.4, -1], 1.06, 2.4, 0);
    berry(0.036, 0.032, 0.006, [0.6, 0.3, 0.5], 0.98, 0.4, 1);

    /* 透明トレー */
    var ringN = 72;
    var rings = [
      [0.0, 0.0, 0.0012], [0.05, 0.03, 0.0012], [0.062, 0.042, 0.0016], [0.0655, 0.0455, 0.004],
      [0.067, 0.047, 0.012], [0.0705, 0.0505, 0.031], [0.0725, 0.0525, 0.0345], [0.0752, 0.0552, 0.0348],
      [0.0762, 0.0562, 0.033], [0.0764, 0.0564, 0.031]
    ];
    var trayG = grid(ringN, rings.length - 1, function (u, vv) {
      var k = Math.round(vv * (rings.length - 1)), rg = rings[k];
      var a = u * TAU, ca = Math.cos(a), sa = Math.sin(a), n = 0.22;
      var x = rg[0] * (ca < 0 ? -1 : 1) * Math.pow(Math.abs(ca), n);
      var z = rg[1] * (sa < 0 ? -1 : 1) * Math.pow(Math.abs(sa), n);
      return [x, rg[2], z];
    }, true);
    var trayM = phys({
      color: 0xf4f8fa, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.26,
      depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6
    });
    var tray = mesh(trayG, trayM, G);
    tray.renderOrder = 2;

    /* ゆるくかかった薄いフィルム */
    var FX = 0.0745, FZ = 0.0545, nfx = 30, nfz = 22, hf = [], ix, iz;
    function env(x, z) {
      var best = 0.0345;
      for (var k = 0; k < spheres.length; k++) {
        var sp = spheres[k], dx = x - sp[0], dz = z - sp[2], d2 = sp[3] * sp[3] - dx * dx - dz * dz;
        if (d2 > 0) { var y = sp[1] + Math.sqrt(d2) + 0.0012; if (y > best) best = y; }
      }
      return best;
    }
    var envH = [];
    for (iz = 0; iz <= nfz; iz++) for (ix = 0; ix <= nfx; ix++) {
      var e = env((ix / nfx * 2 - 1) * FX, (iz / nfz * 2 - 1) * FZ);
      envH.push(e); hf.push(e);
    }
    for (var it = 0; it < 14; it++) {
      var nh = hf.slice();
      for (iz = 1; iz < nfz; iz++) for (ix = 1; ix < nfx; ix++) {
        var id = iz * (nfx + 1) + ix;
        var av = (hf[id - 1] + hf[id + 1] + hf[id - nfx - 1] + hf[id + nfx + 1]) * 0.25;
        nh[id] = Math.max(envH[id], av);
      }
      for (ix = 0; ix <= nfx; ix++) { nh[ix] = 0.0352; nh[nfz * (nfx + 1) + ix] = 0.0352; }
      for (iz = 0; iz <= nfz; iz++) { nh[iz * (nfx + 1)] = 0.0352; nh[iz * (nfx + 1) + nfx] = 0.0352; }
      hf = nh;
    }
    var filmG = grid(nfx, nfz, function (u, vv) {
      var id = Math.round(vv * nfz) * (nfx + 1) + Math.round(u * nfx);
      var x = (u * 2 - 1) * FX, z = (vv * 2 - 1) * FZ;
      var edge = Math.min(u, 1 - u, vv, 1 - vv);
      var wr = 0.0012 * noise(x * 180, z * 140, 3) * smooth(0, 0.1, edge);
      return [x, hf[id] + wr + 0.0004, z];
    });
    var filmM = phys({
      color: 0xffffff, roughness: 0.12, transparent: true, opacity: 0.13, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.8
    });
    var film = mesh(filmG, filmM, G);
    film.renderOrder = 3;
    return G;
  });

  /* ═════════ 2. トマト ═════════ */
  Items.define('tomato', { tall: false, sound: 'thud', heavy: 0.3 }, function () {
    var G = new T.Group();
    var RX = 0.0375, RY = 0.0285;
    var bodyG = grid(48, 32, function (u, v) {
      var phi = u * TAU, th = (1 - v) * PI;           /* v=1 が上 */
      var sy = Math.cos(th), sr = Math.sin(th);
      var x = sr * Math.sin(phi), z = sr * Math.cos(phi), y = sy;
      var lobe = 0.5 + 0.5 * Math.cos(6 * phi + 0.35 * Math.sin(3 * phi + 1));
      var up = smooth(-0.1, 0.85, y);
      var rr = 1 - 0.05 * (1 - lobe) * up * (1 - smooth(0.88, 1, y) * 0.6) - 0.012 * (1 - lobe) * (1 - up)
        + 0.018 * fbm(x * 1.4 + 2, y * 1.4, z * 1.4);
      x *= rr; z *= rr; y *= rr;
      if (y > 0.82) y -= 0.22 * smooth(0.82, 1, y) * (1 - smooth(0.995, 1, y) * 0.3);
      if (y < -0.86) y = -0.86 + (y + 0.86) * 0.35;
      return [x * RX, (y + 0.905) * RY, z * RX];
    }, true);
    var tex = U.tex(512, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#c75a20'); g.addColorStop(0.1, '#cc4a1e'); g.addColorStop(0.28, '#c3301a');
      g.addColorStop(0.7, '#b8241a'); g.addColorStop(1, '#a81e17');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 40, 2, '#8e1410', 0.3, 40);
      blotch(c, w, h, 25, 3, '#d8501e', 0.25, 35);
      var r = U.rng(9);
      /* 肩の放射状のすじ（黄み） */
      for (var i = 0; i < 160; i++) {
        var x = r() * w, len = h * (0.1 + 0.25 * r());
        c.globalAlpha = 0.08 + 0.12 * r();
        c.strokeStyle = r() < 0.5 ? '#e08a2a' : '#a01812';
        c.lineWidth = 1 + 2 * r();
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (r() - 0.5) * 6, len); c.stroke();
      }
      c.globalAlpha = 1;
      U.speckle(c, w, h, { n: 700, size: 1, alpha: 0.1, light: '#ffd0a0', dark: '#600000', seed: 4 });
    });
    var rough = U.tex(128, 128, function (c, w, h) {
      c.fillStyle = '#404040'; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 20, 7, '#707070', 0.5, 18);
    }, { data: true });
    var bodyM = phys({ map: tex, roughnessMap: rough, roughness: 0.6, clearcoat: 0.5, clearcoatRoughness: 0.18, side: T.FrontSide });
    mesh(bodyG, bodyM, G);
    var top = (0.905 + 0.78) * RY;
    var cal = mesh(calyxGeom(5, 0.0165, 0.0032, 0.007, 0.0028, 0.0075, 0.0015, 7), std({ map: greenTex(6, '#4c7426'), roughness: 0.6 }), G);
    cal.position.set(0, top - 0.0012, 0);
    return G;
  });

  /* ═════════ 3. りんご ═════════ */
  Items.define('apple', { tall: false, sound: 'thud', heavy: 0.4 }, function () {
    var G = new T.Group();
    var pts = [[0, 0.0065], [0.006, 0.0048], [0.014, 0.0018], [0.024, 0.0022], [0.033, 0.009], [0.0395, 0.022],
      [0.0425, 0.038], [0.0422, 0.052], [0.0385, 0.064], [0.03, 0.0718], [0.019, 0.0738], [0.011, 0.0712],
      [0.0045, 0.0655], [0, 0.0625]];
    var curve = new T.SplineCurve(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }));
    var NV = 40, sp = curve.getSpacedPoints(NV);
    sp[0].x = 0; sp[NV].x = 0;
    var bodyG = lathe(48, NV, function (v) { var p = sp[Math.round(v * NV)]; return [p.x, p.y]; },
      function (x, y, z, u, v) {
        var phi = u * TAU;
        var bot = 1 - smooth(0.0, 0.035, y);
        var f = 1 + 0.035 * fbm(Math.cos(phi) * 1.2 + 1, y * 18, Math.sin(phi) * 1.2) + 0.03 * Math.cos(5 * phi) * bot
          + 0.02 * Math.cos(phi + 0.6) * smooth(0.02, 0.07, y);
        return [x * f, y + 0.0015 * Math.cos(phi) * smooth(0.04, 0.075, y), z * f];
      });
    var tex = U.tex(512, 512, function (c, w, h) {
      /* v=0（下）がキャンバスの下 */
      c.fillStyle = '#b8bd58'; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 20, 1, '#d6c862', 0.4, 60);
      var r = U.rng(31), x, i;
      /* 赤の地: 列ごとに濃さ（陽の当たらない側は黄緑がのぞく） */
      for (x = 0; x < w; x += 2) {
        var u = x / w, cover = 0.92 - 0.6 * Math.pow(smooth(0.35, 0.0, Math.abs(u - 0.62)), 1.3) + 0.08 * noise(u * 9, 1, 2);
        var gr = c.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(120,20,25,0.3)');
        gr.addColorStop(0.08, 'rgba(140,22,28,' + (cover * 0.85).toFixed(3) + ')');
        gr.addColorStop(0.5, 'rgba(160,26,32,' + cover.toFixed(3) + ')');
        gr.addColorStop(0.9, 'rgba(150,30,30,' + (cover * 0.9).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(150,120,50,0.4)');
        c.fillStyle = gr; c.fillRect(x, 0, 2, h);
      }
      /* 縦のかすり */
      for (i = 0; i < 900; i++) {
        x = r() * w;
        var y0 = r() * h * 0.6, len = h * (0.15 + 0.5 * r());
        c.globalAlpha = 0.15 + 0.3 * r();
        var k = r();
        c.strokeStyle = k < 0.45 ? '#7a0c14' : k < 0.8 ? '#b8262c' : '#c9a04a';
        c.lineWidth = 0.8 + 2 * r();
        c.beginPath(); c.moveTo(x, y0); c.bezierCurveTo(x + (r() - 0.5) * 8, y0 + len * 0.3, x + (r() - 0.5) * 8, y0 + len * 0.6, x + (r() - 0.5) * 6, y0 + len); c.stroke();
      }
      c.globalAlpha = 1;
      blotch(c, w, h, 25, 4, '#5e0a10', 0.25, 50);
      /* 軸のまわりと底の色 */
      var gt = c.createLinearGradient(0, 0, 0, h * 0.12);
      gt.addColorStop(0, 'rgba(150,140,60,0.9)'); gt.addColorStop(1, 'rgba(150,140,60,0)');
      c.fillStyle = gt; c.fillRect(0, 0, w, h * 0.12);
      var gb = c.createLinearGradient(0, h, 0, h * 0.9);
      gb.addColorStop(0, 'rgba(170,150,70,0.9)'); gb.addColorStop(1, 'rgba(170,150,70,0)');
      c.fillStyle = gb; c.fillRect(0, h * 0.9, w, h * 0.1);
      /* 点々（皮目） */
      for (i = 0; i < 1400; i++) {
        c.globalAlpha = 0.35 + 0.4 * r();
        c.fillStyle = r() < 0.7 ? '#e8d9a8' : '#f4ecd0';
        c.beginPath(); c.ellipse(r() * w, r() * h, 0.6 + r() * 0.9, 0.9 + r() * 1.2, 0, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    });
    var bump = U.tex(256, 256, function (c, w, h) {
      c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
      U.speckle(c, w, h, { n: 1200, size: 0.9, alpha: 0.35, seed: 12 });
    }, { data: true });
    var bodyM = phys({ map: tex, bumpMap: bump, bumpScale: 0.4, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35, side: T.FrontSide });
    mesh(bodyG, bodyM, G);
    var stemC = new T.CatmullRomCurve3([new T.Vector3(0, 0.0615, 0), new T.Vector3(0.0006, 0.069, 0.0002),
      new T.Vector3(0.0022, 0.0755, 0.0008), new T.Vector3(0.0048, 0.0795, 0.0016)]);
    var stemG = new T.TubeGeometry(stemC, 10, 0.00125, 8, false);
    var stemM = std({ color: 0x5b4126, roughness: 0.8, map: greenTex(9, '#6a4a2a') });
    mesh(stemG, stemM, G);
    var cap = mesh(new T.SphereGeometry(0.00125, 8, 6), stemM, G);
    cap.position.set(0.0048, 0.0795, 0.0016);
    return G;
  });

  /* ═════════ 4. にんじん3本 ═════════ */
  Items.define('carrot', { tall: false, sound: 'thud', heavy: 0.4 }, function () {
    var G = new T.Group();
    var tex = U.tex(256, 512, function (c, w, h) {
      /* v=0 が先（キャンバス下）、v=1 が肩（上） */
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8c6a2a'); g.addColorStop(0.025, '#c86a20'); g.addColorStop(0.1, '#e07422');
      g.addColorStop(0.6, '#e27a26'); g.addColorStop(0.95, '#d86a1c'); g.addColorStop(1, '#b86418');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 40, 3, '#c25814', 0.3, 30);
      blotch(c, w, h, 30, 4, '#f09040', 0.2, 30);
      var r = U.rng(41), i;
      for (i = 0; i < 260; i++) {
        var y = r() * h, x = r() * w, len = w * (0.15 + 0.4 * r());
        c.globalAlpha = 0.18 + 0.3 * r();
        c.strokeStyle = r() < 0.7 ? '#9a4610' : '#f6a050';
        c.lineWidth = 0.8 + 1.4 * r();
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + len / 2, y + (r() - 0.5) * 4, x + len, y + (r() - 0.5) * 3); c.stroke();
      }
      for (i = 0; i < 70; i++) {
        c.globalAlpha = 0.5; c.fillStyle = '#7a3a10';
        c.beginPath(); c.ellipse(r() * w, r() * h, 1.5, 0.9, 0, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
      U.speckle(c, w, h, { n: 500, size: 1, alpha: 0.1, seed: 5 });
    });
    var bump = U.tex(256, 512, function (c, w, h) {
      c.fillStyle = '#909090'; c.fillRect(0, 0, w, h);
      var r = U.rng(41), i;
      for (i = 0; i < 260; i++) {
        var y = r() * h, x = r() * w, len = w * (0.15 + 0.4 * r());
        r(); c.globalAlpha = 0.7; c.strokeStyle = '#303030'; c.lineWidth = 0.8 + 1.4 * r();
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + len / 2, y + (r() - 0.5) * 4, x + len, y + (r() - 0.5) * 3); c.stroke();
      }
      c.globalAlpha = 1;
    }, { data: true });
    var carM = phys({ map: tex, bumpMap: bump, bumpScale: 1.6, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5, side: T.FrontSide });
    var stemM = std({ map: greenTex(12, '#55802c'), roughness: 0.6 });

    function radius(t, Rm) {
      /* t=0 先, t=1 肩 */
      var r = Rm * Math.pow(t, 0.72) * (0.25 + 0.75 * smooth(0, 0.6, t) * 0.4 + 0.45);
      r = Math.max(0.0007, Math.min(r, Rm));
      if (t > 0.94) r *= Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.94) / 0.06, 2)) * 0.96 + 0.04);
      return r;
    }
    var defs = [
      { L: 0.172, R: 0.0132, z: -0.024, y: 0, yaw: -0.11, bend: 0.006, seed: 1 },
      { L: 0.165, R: 0.0125, z: 0.024, y: 0, yaw: 0.13, bend: -0.007, seed: 2 },
      { L: 0.168, R: 0.0128, z: 0.0005, y: 0.0098, yaw: 0.025, bend: 0.004, seed: 3 }
    ];
    var X0 = -0.08, stems = [], tapePts = [], XT = 0.032;
    var baseStem = new T.CylinderGeometry(0.0009, 0.0012, 1, 6, 1);
    baseStem.translate(0, 0.5, 0);
    defs.forEach(function (d) {
      var g = lathe(32, 30, function (v) {
        var t = v, y = d.L * t, r = radius(t, d.R);
        if (t > 0.94) y = d.L * 0.94 + d.L * 0.06 * Math.sqrt(1 - Math.pow(1 - (t - 0.94) / 0.06, 2)) * 0.5;
        if (v === 0) r = 0;
        return [r, y];
      }, function (x, y, z, u) {
        var t = y / d.L;
        var f = 1 + 0.05 * fbm(x * 120 + d.seed * 5, y * 60, z * 120) + 0.015 * noise(u * 8, t * 30, d.seed);
        return [x * f, y, z * f + d.bend * Math.pow(1 - t, 2)];
      });
      /* 寝かせる: 太い方が -X、先が +X */
      g.rotateZ(PI / 2);       /* (x,y) -> (-y, x): 肩が -L */
      g.translate(d.L, 0, 0);  /* 肩が x=0, 先が x=+L */
      var m = mesh(g, carM);
      var piv = new T.Group();
      piv.add(m);
      var tilt = Math.asin((d.R - 0.0015) / d.L);
      piv.rotation.set(0, d.yaw, -tilt, 'YXZ');
      piv.position.set(X0, d.y + d.R, d.z);
      G.add(piv);
      /* 葉の茎 */
      var r = U.rng(d.seed * 7 + 2);
      for (var k = 0; k < 4; k++) {
        var a = (k / 4) * TAU + r() * 0.8, rad = d.R * 0.35 * r();
        var len = 0.012 + 0.016 * r();
        var sg = baseStem.clone();
        var mtx = new T.Matrix4().compose(
          new T.Vector3(X0 - 0.001, d.y + d.R + Math.sin(a) * rad, d.z + Math.cos(a) * rad),
          new T.Quaternion().setFromEuler(new T.Euler((r() - 0.5) * 0.6 + d.yaw, 0, PI / 2 - 0.25 - 0.45 * r(), 'YXZ')),
          new T.Vector3(1 + 0.3 * r(), len, 1 + 0.3 * r()));
        sg.applyMatrix4(mtx);
        stems.push(sg);
      }
      /* テープ位置での断面の円 */
      var tt = 1 - XT / d.L;
      tapePts.push([d.z + Math.sin(-d.yaw) * XT * 0 + Math.sin(d.yaw) * -XT, d.y + d.R - Math.sin(tilt) * XT * 0, radius(tt, d.R) * 1.0]);
    });
    var sm = merge(stems);
    mesh(sm, stemM, G);
    /* 切り口（茎の先の明るい面）は省略: 茎の色むらで代用 */

    /* 束ねるテープ（3本の断面の外形をなぞる帯） */
    var cz = 0, cy = 0;
    tapePts.forEach(function (p) { cz += p[0] / 3; cy += p[1] / 3; });
    var NT = 96, outline = [];
    for (var i = 0; i <= NT; i++) {
      var a = i / NT * TAU, dz = Math.cos(a), dy = Math.sin(a), best = -1, bp = null;
      tapePts.forEach(function (p) {
        var s = (p[0] - cz) * dz + (p[1] - cy) * dy + p[2];
        if (s > best) { best = s; bp = [p[0] + dz * (p[2] + 0.0007), p[1] + dy * (p[2] + 0.0007)]; }
      });
      outline.push(bp);
    }
    /* 地面より下は平らに */
    var XTP = X0 + XT;
    var tapeG = grid(NT, 3, function (u, v) {
      var p = outline[Math.round(u * NT)];
      var x = XTP + (v - 0.5) * 0.011;
      return [x, Math.max(p[1], 0.0003), p[0]];
    });
    var tapeTex = U.tex(128, 32, function (c, w, h) {
      c.fillStyle = '#3a3f98'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#5a60b8'; c.fillRect(0, 0, w, 3); c.fillRect(0, h - 3, w, 3);
      U.speckle(c, w, h, { n: 200, size: 1, alpha: 0.1, seed: 2 });
    });
    mesh(tapeG, std({ map: tapeTex, roughness: 0.4 }), G);
    return G;
  });

  /* ═════════ 5. キャベツ ═════════ */
  Items.define('cabbage', { tall: false, sound: 'thud', heavy: 1 }, function () {
    var G = new T.Group();
    var RX = 0.0835, RY = 0.0745;
    var r0 = U.rng(55), leaves = [], i;
    for (i = 0; i < 5; i++) leaves.push({ th: 0.35 + 0.25 * r0(), ph: i / 5 * TAU + r0() * 0.6, a: 0.75 + 0.25 * r0(), s: r0() * 10 });
    for (i = 0; i < 6; i++) leaves.push({ th: 1.35 + 0.35 * r0(), ph: i / 6 * TAU + 0.4 + r0() * 0.5, a: 1.0 + 0.25 * r0(), s: r0() * 10 });
    leaves.forEach(function (l) {
      l.c = new T.Vector3(Math.sin(l.th) * Math.sin(l.ph), Math.cos(l.th), Math.sin(l.th) * Math.cos(l.ph));
      var ref = Math.abs(l.c.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
      l.e1 = new T.Vector3().crossVectors(l.c, ref).normalize();
      l.e2 = new T.Vector3().crossVectors(l.c, l.e1);
    });
    var tmp = new T.Vector3();
    /* 方向 p での半径倍率と、重なり具合 */
    function cab(x, y, z) {
      var rr = 1, layer = 0, edge = 0;
      for (var k = 0; k < leaves.length; k++) {
        var l = leaves[k], d = x * l.c.x + y * l.c.y + z * l.c.z;
        var ang = Math.acos(Math.max(-1, Math.min(1, d)));
        tmp.set(x, y, z);
        var aa = Math.atan2(tmp.dot(l.e2), tmp.dot(l.e1));
        var lim = l.a + 0.07 * Math.sin(aa * 5 + l.s) + 0.04 * Math.sin(aa * 11 + l.s * 2);
        var cov = smooth(lim, lim - 0.07, ang);
        rr += cov * (0.016 + 0.012 * Math.sin(PI * Math.min(1, ang / lim)));
        layer += cov;
        edge += cov * smooth(lim - 0.25, lim - 0.03, ang);
      }
      rr += 0.008 * fbm(x * 3 + 4, y * 3, z * 3);
      return [rr, layer, edge];
    }
    var cols = [];
    var bodyG = grid(56, 40, function (u, v) {
      var phi = u * TAU, th = (1 - v) * PI;
      var x = Math.sin(th) * Math.sin(phi), y = Math.cos(th), z = Math.sin(th) * Math.cos(phi);
      var c = cab(x, y, z), rr = c[0];
      var py = y * rr;
      if (py < -0.82) py = -0.82 + (py + 0.82) * 0.25;
      var shade = 1 - 0.05 * Math.min(c[1], 3) + 0.12 * c[2];
      var top = smooth(0.2, 1, y);
      cols.push(shade * lerp(0.86, 1.0, top), shade * lerp(0.95, 1.0, top), shade * lerp(0.8, 0.9, top));
      return [x * rr * RX, py * RY, z * rr * RX];
    }, true);
    bodyG.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    bodyG.computeBoundingBox();
    var minY = bodyG.boundingBox.min.y;

    function veinDraw(c, w, h, bump) {
      var r = U.rng(bump ? 77 : 77), i, k;
      if (bump) { c.fillStyle = '#7a7a7a'; c.fillRect(0, 0, w, h); }
      else {
        var g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#d9e6a6'); g.addColorStop(0.35, '#b9d283'); g.addColorStop(0.75, '#9cbf68'); g.addColorStop(1, '#c8d898');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        blotch(c, w, h, 50, 9, '#7fa84e', 0.35, 40);
        blotch(c, w, h, 40, 10, '#e2ebb4', 0.3, 30);
      }
      /* 下から扇状に広がる太い葉脈 */
      var N = 9;
      for (i = 0; i < N; i++) {
        var x0 = (i + r() * 0.6) / N * w, xs = x0, ys = h;
        var segs = 26, ang = (r() - 0.5) * 0.4;
        for (k = 0; k < segs; k++) {
          var t = k / segs, nx = xs + Math.sin(ang) * h * 0.035, ny = ys - h * 0.035;
          ang += (r() - 0.5) * 0.25;
          var lw = (bump ? 1.2 : 1) * Math.max(1.2, 13 * Math.pow(1 - t, 1.3));
          c.globalAlpha = bump ? 1 : 0.85 - 0.4 * t;
          c.strokeStyle = bump ? '#f0f0f0' : '#eef3d8';
          c.lineWidth = lw; c.lineCap = 'round';
          c.beginPath(); c.moveTo(xs, ys); c.lineTo(nx, ny); c.stroke();
          if (k % 3 === 1 && t < 0.85) {
            for (var sd = -1; sd <= 1; sd += 2) {
              var bx = nx, by = ny, ba = ang + sd * (0.7 + 0.3 * r());
              c.lineWidth = Math.max(0.8, lw * 0.35);
              c.globalAlpha = bump ? 0.8 : 0.5;
              c.beginPath(); c.moveTo(bx, by);
              for (var q = 0; q < 5; q++) {
                bx += Math.sin(ba) * h * 0.03; by -= Math.cos(ba) * h * 0.03 * 0.9; ba += (r() - 0.5) * 0.3 + sd * 0.05;
                c.lineTo(bx, by);
              }
              c.stroke();
            }
          }
          xs = nx; ys = ny;
          if (ys < h * 0.05) break;
        }
      }
      c.globalAlpha = 1;
      if (!bump) U.speckle(c, w, h, { n: 900, size: 1.2, alpha: 0.07, seed: 6 });
    }
    var bodyTex = U.tex(512, 256, function (c, w, h) { veinDraw(c, w, h, false); });
    var bodyBump = U.tex(512, 256, function (c, w, h) { veinDraw(c, w, h, true); }, { data: true });
    var bodyM = phys({ map: bodyTex, bumpMap: bodyBump, bumpScale: 2.5, vertexColors: true, roughness: 0.62, sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0xe8f0d0, side: T.FrontSide });
    var body = mesh(bodyG, bodyM, G);
    body.position.y = -minY;

    /* 外葉: 少し浮いた曲面を3枚、ふちが外へ反る */
    var leafTex = U.tex(256, 256, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8fb35a'); g.addColorStop(0.6, '#a6c470'); g.addColorStop(1, '#d6e2a8');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 30, 21, '#6e9a40', 0.35, 30);
      var r = U.rng(5), k;
      /* まん中の太い葉脈（下が太い）と脇の葉脈 */
      for (k = 0; k < 30; k++) {
        var t = k / 30, y = h * (1 - t), xm = w / 2 + Math.sin(t * 3) * 6;
        c.strokeStyle = '#eef2d6'; c.globalAlpha = 0.9;
        c.lineWidth = Math.max(2, 22 * (1 - t));
        c.beginPath(); c.moveTo(xm, y); c.lineTo(w / 2 + Math.sin((t + 1 / 30) * 3) * 6, y - h / 30); c.stroke();
        if (k % 3 === 0) {
          for (var sd = -1; sd <= 1; sd += 2) {
            c.lineWidth = Math.max(1, 5 * (1 - t)); c.globalAlpha = 0.6;
            c.beginPath(); c.moveTo(xm, y);
            c.quadraticCurveTo(xm + sd * w * 0.2, y - h * 0.08, xm + sd * w * (0.4 + 0.1 * r()), y - h * (0.2 + 0.05 * r()));
            c.stroke();
          }
        }
      }
      c.globalAlpha = 1;
      U.speckle(c, w, h, { n: 500, size: 1.2, alpha: 0.08, seed: 3 });
    });
    var leafM = phys({ map: leafTex, roughness: 0.6, sheen: 0.4, sheenRoughness: 0.6, sheenColor: 0xe8f0d0 });
    var outerDefs = [[0.3, 0.12], [2.4, 0.42], [4.4, 0.7]];
    outerDefs.forEach(function (od, n) {
      var ph0 = od[0], plen = 1.9;
      var lg = grid(18, 12, function (u, v) {
        var phi = ph0 + (u - 0.5) * plen;
        var thTop = 0.95 + od[1] + 0.12 * Math.sin(u * PI * 3 + n) + 0.15 * Math.pow(Math.abs(u - 0.5) * 2, 2);
        var th = lerp(thTop, 2.65, v);
        var x = Math.sin(th) * Math.sin(phi), y = Math.cos(th), z = Math.sin(th) * Math.cos(phi);
        var c = cab(x, y, z), side = Math.pow(Math.abs(u - 0.5) * 2, 3);
        var curl = 0.09 * Math.pow(1 - v, 3) + 0.05 * side * (1 - v * 0.6);
        var rr = c[0] + 0.012 + curl + 0.006 * noise(u * 7, v * 5, n);
        var py = y * rr;
        if (py < -0.82) py = -0.82 + (py + 0.82) * 0.25;
        return [x * rr * RX, py * RY - minY + 0.0005, z * rr * RX];
      });
      /* テクスチャの下が葉の根元（v=1 が根元） */
      var uv = lg.attributes.uv;
      for (var q = 0; q < uv.count; q++) uv.setY(q, 1 - uv.getY(q) * 0.95);
      mesh(lg, leafM, G);
    });

    /* 底の白い芯 */
    var coreTex = U.tex(128, 128, function (c, w, h) {
      c.fillStyle = '#e8ead0'; c.fillRect(0, 0, w, h);
      for (var k = 0; k < 6; k++) {
        c.strokeStyle = 'rgba(160,170,110,0.35)'; c.lineWidth = 2;
        c.beginPath(); c.arc(w / 2, h / 2, 10 + k * 9, 0, TAU); c.stroke();
      }
      U.speckle(c, w, h, { n: 200, size: 1.5, alpha: 0.15, dark: '#8a8a50', seed: 2 });
    });
    var core = mesh(new T.CylinderGeometry(0.017, 0.02, 0.006, 32, 1), std({ map: coreTex, roughness: 0.7, side: T.FrontSide }), G);
    core.position.y = 0.0028;
    return G;
  });

  /* ═════════ 6. すいか（くし形） ═════════ */
  Items.define('watermelon', { tall: false, sound: 'thud', heavy: 0.9 }, function () {
    var G = new T.Group();
    var A = 0.1, R = 0.116, TH = 27 * PI / 180, yc = R - 0.006;
    function fy(y) { var h0 = 0.004; return y < h0 ? h0 - (h0 - y) * 0.22 : y; }
    var rindG = grid(16, 48, function (u, v) {
      var th = (u * 2 - 1) * TH, ps = v * PI, x = -A * Math.cos(ps), s = Math.sin(ps);
      var bump = 1 + 0.006 * noise(u * 6, v * 9, 1);
      return [x, fy(yc - R * s * Math.cos(th) * bump), R * s * Math.sin(th) * bump];
    });
    var rindTex = U.tex(256, 512, function (c, w, h) {
      c.fillStyle = '#5c8a3a'; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 40, 2, '#7aa04c', 0.3, 30);
      var r = U.rng(17), k, y;
      var centers = [0.08, 0.5, 0.92];
      for (k = 0; k < centers.length; k++) {
        c.fillStyle = '#1d3415';
        c.beginPath();
        var pts = [];
        for (y = 0; y <= h; y += 4) {
          var hw = w * (0.085 + 0.03 * Math.sin(y * 0.05 + k) + 0.035 * (r() - 0.5) + 0.03 * ((y / 4) % 2 ? 1 : -1) * r());
          pts.push([w * centers[k] + Math.sin(y * 0.02 + k * 2) * 6, hw]);
        }
        pts.forEach(function (p, i) { var yy = i * 4; if (i === 0) c.moveTo(p[0] - p[1], yy); else c.lineTo(p[0] - p[1], yy); });
        for (var i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i][0] + pts[i][1], i * 4);
        c.closePath(); c.fill();
      }
      blotch(c, w, h, 30, 5, '#2c4a1c', 0.25, 25);
      U.speckle(c, w, h, { n: 800, size: 1.1, alpha: 0.12, light: '#b8cc88', dark: '#0e1a08', seed: 7 });
    });
    var rindRough = U.tex(128, 128, function (c, w, h) {
      c.fillStyle = '#707070'; c.fillRect(0, 0, w, h);
      blotch(c, w, h, 20, 8, '#a0a0a0', 0.5, 18);
    }, { data: true });
    var rindM = phys({ map: rindTex, roughnessMap: rindRough, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    mesh(rindG, rindM, G);

    /* 切り口のテクスチャ: 軸(ρ=0)がキャンバスの下、皮(ρ=R)が上。横は x */
    function faceDraw(c, w, h, mode) {
      var cx = w / 2, cy = h, ax = w / 2, ay = h;
      function ell(dx, dy, col) {
        c.fillStyle = col; c.beginPath(); c.ellipse(cx, cy, Math.max(1, ax - dx), Math.max(1, ay - dy), 0, PI, TAU); c.closePath(); c.fill();
      }
      var r = U.rng(mode === 1 ? 33 : 33), i;
      if (mode === 0) {
        ell(0, 0, '#2d5422');
        ell(8, 7, '#7ea252');
        ell(12, 11, '#cfe0a8');
        ell(17, 15, '#e8efc8');
        var g = c.createRadialGradient(cx, cy, 10, cx, cy, h);
        ell(21, 19, '#ee9e98');
        ell(26, 24, '#e2545a');
        ell(34, 31, '#d8323c');
        blotch(c, w, h, 50, 4, '#f06068', 0.25, 22);
        blotch(c, w, h, 40, 6, '#b81e2a', 0.25, 22);
        /* 細い繊維（中心から外へ） */
        for (i = 0; i < 400; i++) {
          var a = PI + r() * PI, k0 = 0.1 + 0.6 * r();
          c.strokeStyle = r() < 0.5 ? 'rgba(255,170,170,0.18)' : 'rgba(150,10,25,0.15)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * (ax - 34) * k0, cy + Math.sin(a) * (ay - 31) * k0);
          c.lineTo(cx + Math.cos(a) * (ax - 34) * (k0 + 0.12), cy + Math.sin(a) * (ay - 31) * (k0 + 0.12));
          c.stroke();
        }
        U.speckle(c, w, h, { n: 1500, size: 1.1, alpha: 0.18, light: '#ffc8c8', dark: '#900010', lightRatio: 0.7, seed: 9 });
        void g;
      } else {
        c.fillStyle = mode === 1 ? '#808080' : '#909090'; c.fillRect(0, 0, w, h);
        if (mode === 1) U.speckle(c, w, h, { n: 2500, size: 1.2, alpha: 0.5, seed: 9 });
        else {
          /* 粗さ: 果肉はところどころ鏡のように（きらめき） */
          c.fillStyle = '#606060';
          c.beginPath(); c.ellipse(cx, cy, ax - 22, ay - 20, 0, PI, TAU); c.fill();
          U.speckle(c, w, h, { n: 2500, size: 1, alpha: 0.6, light: '#202020', dark: '#909090', lightRatio: 0.6, seed: 10 });
        }
      }
      /* 種 */
      var rs = U.rng(91);
      for (i = 0; i < 26; i++) {
        var aa = PI + 0.15 + rs() * (PI - 0.3), kk = 0.42 + 0.3 * rs();
        var sx = cx + Math.cos(aa) * (ax - 34) * kk, sy = cy + Math.sin(aa) * (ay - 31) * kk;
        var white = rs() < 0.15;
        c.save(); c.translate(sx, sy); c.rotate(aa + PI / 2);
        if (mode === 0) {
          c.fillStyle = white ? '#e8d8b8' : '#1a0e0a';
          c.beginPath(); c.ellipse(0, 0, white ? 3 : 4.2, white ? 5 : 7.5, 0, 0, TAU); c.fill();
          if (!white) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(-1.2, -2, 1, 2, 0, 0, TAU); c.fill(); }
        } else if (mode === 1) {
          c.fillStyle = '#c8c8c8'; c.beginPath(); c.ellipse(0, 0, 4.2, 7.5, 0, 0, TAU); c.fill();
        } else {
          c.fillStyle = '#303030'; c.beginPath(); c.ellipse(0, 0, 4.2, 7.5, 0, 0, TAU); c.fill();
        }
        c.restore();
      }
    }
    var faceTex = U.tex(512, 256, function (c, w, h) { faceDraw(c, w, h, 0); });
    var faceBump = U.tex(512, 256, function (c, w, h) { faceDraw(c, w, h, 1); }, { data: true });
    var faceRough = U.tex(512, 256, function (c, w, h) { faceDraw(c, w, h, 2); }, { data: true });
    var faceM = phys({ map: faceTex, bumpMap: faceBump, bumpScale: 0.8, roughnessMap: faceRough, roughness: 0.75, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    [-1, 1].forEach(function (sg) {
      var fg = grid(48, 14, function (u, v) {
        var ps = u * PI, x = -A * Math.cos(ps), s = Math.sin(ps), rho = v * R * s;
        var wob = 0.0007 * noise(u * 20, v * 6, sg);
        return [x, fy(yc - rho * Math.cos(TH)) + wob * 0.5, sg * (rho * Math.sin(TH) + wob)];
      });
      var uv = fg.attributes.uv, pos = fg.attributes.position;
      for (var q = 0; q < uv.count; q++) {
        var x = pos.getX(q), y = pos.getY(q);
        uv.setXY(q, (x + A) / (2 * A), (yc - y) / Math.cos(TH) / R);
      }
      mesh(fg, faceM, G);
    });
    /* 底を y=0 に */
    G.updateMatrixWorld(true);
    var bb = new T.Box3().setFromObject(G);
    G.children.forEach(function (m) { m.position.y -= bb.min.y; });
    return G;
  });
})();
