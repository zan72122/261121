/* 20_plant.js — ミニトマトの株（ビニールポットの苗 → 育ちきった株、つぼみ・花・青い実・赤い実）
   G.Plant.create(scene, quality) → plant
   茎・葉柄・果房・がく・花びらは update の中で毎フレーム CPU で形を作り直す（数個のドローコールで、
   しおれ・ゆれ・しなりを自由に動かすため）。実は1個ずつのメッシュ（色が実ごとに違うため）。 */
(function () {
  'use strict';
  var U = G.U;
  var R = 0.026;          // 実の半径
  var TOPY = 0.86;        // 実のてっぺん（へたの付け根）の高さ（R 単位、実の中心から）
  var D2R = Math.PI / 180;
  var V = THREE.Vector3;
  var UP = new V(0, 1, 0), DOWN = new V(0, -1, 0), YAX = new V(0, 1, 0);

  /* v を単位軸 a のまわりに ang 回す（その場で） */
  function rotAxis(v, a, ang) {
    var c = Math.cos(ang), s = Math.sin(ang), d = (a.x * v.x + a.y * v.y + a.z * v.z) * (1 - c);
    var cx = a.y * v.z - a.z * v.y, cy = a.z * v.x - a.x * v.z, cz = a.x * v.y - a.y * v.x;
    v.set(v.x * c + cx * s + a.x * d, v.y * c + cy * s + a.y * d, v.z * c + cz * s + a.z * d);
    return v;
  }
  function spring(o, key, velKey, target, k, zeta, dt) {
    var c = 2 * zeta * Math.sqrt(k);
    o[velKey] += (k * (target - o[key]) - c * o[velKey]) * dt;
    o[key] += o[velKey] * dt;
  }

  /* ───────── 動的メッシュ（管と格子の「区画」を並べた1つのジオメトリ） ───────── */
  function Dyn(useColor) { this.slots = []; this.nv = 0; this.ni = 0; this.useColor = !!useColor; }
  Dyn.prototype.tube = function (nr, nrad, vrep) {
    var s = { tube: true, nr: nr, nrad: nrad, v0: this.nv, vrep: vrep || 1, hidden: false, cs: [], sn: [] };
    for (var j = 0; j <= nrad; j++) { s.cs.push(Math.cos(j / nrad * Math.PI * 2)); s.sn.push(Math.sin(j / nrad * Math.PI * 2)); }
    s.n = nr * (nrad + 1);
    this.nv += s.n; this.ni += (nr - 1) * nrad * 6; this.slots.push(s); return s;
  };
  Dyn.prototype.grid = function (nu, nv) {
    var s = { tube: false, nu: nu, nv: nv, v0: this.nv, hidden: false };
    s.n = nu * nv;
    this.nv += s.n; this.ni += (nu - 1) * (nv - 1) * 6; this.slots.push(s); return s;
  };
  Dyn.prototype.build = function () {
    var n = this.nv, i, j, k = 0, s, si, a, b, q;
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3); this.uvs = new Float32Array(n * 2);
    if (this.useColor) this.col = new Float32Array(n * 3);
    var idx = n > 65000 ? new Uint32Array(this.ni) : new Uint16Array(this.ni);
    for (si = 0; si < this.slots.length; si++) {
      s = this.slots[si];
      if (s.tube) {
        var w = s.nrad + 1;
        for (i = 0; i < s.nr; i++) for (j = 0; j <= s.nrad; j++) {
          q = (s.v0 + i * w + j) * 2; this.uvs[q] = j / s.nrad; this.uvs[q + 1] = i / (s.nr - 1) * s.vrep;
        }
        for (i = 0; i < s.nr - 1; i++) for (j = 0; j < s.nrad; j++) {
          a = s.v0 + i * w + j; b = a + w;
          idx[k++] = a; idx[k++] = a + 1; idx[k++] = b;
          idx[k++] = a + 1; idx[k++] = b + 1; idx[k++] = b;
        }
      } else {
        for (i = 0; i < s.nu - 1; i++) for (j = 0; j < s.nv - 1; j++) {
          a = s.v0 + i * s.nv + j; b = a + s.nv;
          idx[k++] = a; idx[k++] = b; idx[k++] = b + 1;
          idx[k++] = a; idx[k++] = b + 1; idx[k++] = a + 1;
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aNor = new THREE.BufferAttribute(this.nor, 3); this.aNor.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('normal', this.aNor);
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    if (this.col) { this.aCol = new THREE.BufferAttribute(this.col, 3); this.aCol.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('color', this.aCol); }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new V(), 3);
    this.geo = geo;
    return geo;
  };
  /* 格子の UV: 幅方向 → テクスチャ u の [u0,u1]（flip で左右反転）、長さ方向 → v 0..1 */
  Dyn.prototype.setGridUV = function (s, u0, u1, flip) {
    for (var i = 0; i < s.nu; i++) for (var j = 0; j < s.nv; j++) {
      var q = (s.v0 + i * s.nv + j) * 2, tv = j / (s.nv - 1);
      this.uvs[q] = flip ? u1 - tv * (u1 - u0) : u0 + tv * (u1 - u0); this.uvs[q + 1] = i / (s.nu - 1);
    }
  };
  Dyn.prototype.hide = function (s) {
    if (s.hidden) return; s.hidden = true;
    this.pos.fill(0, s.v0 * 3, (s.v0 + s.n) * 3);
  };
  Dyn.prototype.color = function (s, c) {
    var col = this.col; if (!col) return;
    for (var i = s.v0 * 3, e = (s.v0 + s.n) * 3; i < e; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
  };
  Dyn.prototype.commit = function () {
    this.aPos.needsUpdate = true; this.aNor.needsUpdate = true; if (this.aCol) this.aCol.needsUpdate = true;
  };
  var _t = new V(), _n = new V(), _b = new V();
  Dyn.prototype.writeTube = function (s, P, Rr) {
    s.hidden = false;
    var pos = this.pos, nor = this.nor, nr = s.nr, nrad = s.nrad, o = s.v0 * 3, cs = s.cs, sn = s.sn;
    for (var i = 0; i < nr; i++) {
      var pa = P[i > 0 ? i - 1 : 0], pc = P[i < nr - 1 ? i + 1 : nr - 1];
      _t.subVectors(pc, pa); var tl = _t.length();
      if (tl < 1e-9) _t.set(0, 1, 0); else _t.multiplyScalar(1 / tl);
      if (i === 0) { if (Math.abs(_t.y) < 0.9) _n.set(0, 1, 0); else _n.set(1, 0, 0); }
      _n.addScaledVector(_t, -_n.dot(_t)); var nl = _n.length();
      if (nl < 1e-5) { if (Math.abs(_t.y) < 0.9) _n.set(0, 1, 0); else _n.set(1, 0, 0); _n.addScaledVector(_t, -_n.dot(_t)); nl = _n.length(); }
      _n.multiplyScalar(1 / nl);
      _b.crossVectors(_t, _n);
      var p = P[i], r = Rr[i];
      for (var j = 0; j <= nrad; j++) {
        var nx = _n.x * cs[j] + _b.x * sn[j], ny = _n.y * cs[j] + _b.y * sn[j], nz = _n.z * cs[j] + _b.z * sn[j];
        pos[o] = p.x + nx * r; pos[o + 1] = p.y + ny * r; pos[o + 2] = p.z + nz * r;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; o += 3;
      }
    }
  };
  var _gp = new V();
  Dyn.prototype.writeGrid = function (s, fn, ctx) {
    s.hidden = false;
    var pos = this.pos, nor = this.nor, nu = s.nu, nv = s.nv, o = s.v0 * 3, i, j;
    for (i = 0; i < nu; i++) for (j = 0; j < nv; j++) {
      fn(ctx, i / (nu - 1), j / (nv - 1), _gp, i, j);
      pos[o] = _gp.x; pos[o + 1] = _gp.y; pos[o + 2] = _gp.z; o += 3;
    }
    var b0 = s.v0 * 3;
    for (i = 0; i < nu; i++) for (j = 0; j < nv; j++) {
      var i0 = i > 0 ? i - 1 : 0, i1 = i < nu - 1 ? i + 1 : i, j0 = j > 0 ? j - 1 : 0, j1 = j < nv - 1 ? j + 1 : j;
      var pa = b0 + (i1 * nv + j) * 3, pb = b0 + (i0 * nv + j) * 3, pc = b0 + (i * nv + j1) * 3, pd = b0 + (i * nv + j0) * 3;
      var ux = pos[pa] - pos[pb], uy = pos[pa + 1] - pos[pb + 1], uz = pos[pa + 2] - pos[pb + 2];
      var vx = pos[pc] - pos[pd], vy = pos[pc + 1] - pos[pd + 1], vz = pos[pc + 2] - pos[pd + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-14) { nx = 0; ny = 1; nz = 0; l = 1; }
      var q = b0 + (i * nv + j) * 3; nor[q] = nx / l; nor[q + 1] = ny / l; nor[q + 2] = nz / l;
    }
  };
  /* 帯（花びら・がく）: ctx.C[i] 中心線, ctx.Wv[i] 半幅ベクトル, ctx.Nv[i] 反りベクトル */
  function ribbonFn(ctx, u, v, out, i) {
    var vv = v * 2 - 1;
    out.copy(ctx.C[i]).addScaledVector(ctx.Wv[i], vv).addScaledVector(ctx.Nv[i], vv * vv);
  }
  var RIB = { C: [], Wv: [], Nv: [] };
  for (var ri = 0; ri < 8; ri++) { RIB.C.push(new V()); RIB.Wv.push(new V()); RIB.Nv.push(new V()); }

  /* ───────── 手続きテクスチャ ───────── */
  function makeLeafTextures() {
    var S = 512, W = S / 2, Hh = S;
    var c = U.makeCanvas(S, S), ctx = c.getContext('2d');
    var hc = U.makeCanvas(S, S), hx = hc.getContext('2d');
    hx.fillStyle = 'rgb(140,140,140)'; hx.fillRect(0, 0, S, S);
    var noiseC = U.pixelCanvas(128, function (u, v, out) {
      var n = U.fbm(u * 6, v * 6, 4, 11, 6), m = U.fbm(u * 20, v * 20, 2, 5, 20);
      var x = U.clamp01((n * 0.65 + m * 0.35 - 0.5) * 1.8 + 0.5) * 255; out[0] = out[1] = out[2] = x;
    });
    for (var vi = 0; vi < 2; vi++) drawLeaflet(ctx, hx, vi * W, W, Hh, vi, noiseC);
    var img = ctx.getImageData(0, 0, S, S), d = img.data;
    for (var i = 0; i < d.length; i += 4) if (d[i + 3] < 8) { d[i] = 64; d[i + 1] = 98; d[i + 2] = 40; }
    var tex = new THREE.DataTexture(new Uint8Array(d), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
    tex.needsUpdate = true;
    var nrm = U.tex(U.heightToNormal(hc, 2.2), {});
    return { map: tex, normal: nrm };
  }
  /* 小葉1枚。キャンバスの上が付け根（短い小葉柄）、下が先。v=0 が付け根になる */
  function drawLeaflet(ctx, hx, ox, W, Hh, variant, noiseC) {
    var rnd = U.rng(31 + variant * 17);
    var cx = ox + W * 0.5, yA = Hh * 0.012, yT = Hh * 0.985, len = yT - yA;
    var st = 0.07, maxHW = W * 0.43, asym = variant === 1 ? 0.86 : 1.0;
    var teeth = 13 + variant * 2, ph = rnd(), N = 170, i, t;
    function midX(t) { return cx + W * 0.03 * Math.sin(Math.PI * t) * (variant ? 1 : 0.35); }
    function Y(t) { return yA + t * len; }
    function hw(t, side) {
      if (t < st) return W * 0.012 * (1 - t / st * 0.3);
      var tb = (t - st) / (1 - st);
      var f = Math.pow(Math.sin(Math.PI * Math.pow(tb, 0.6)), 0.8);
      var sc = side < 0 ? asym : 1;
      if (variant === 1 && side < 0) f *= 0.25 + 0.75 * U.smooth(0.0, 0.2, tb);   // 斜めの付け根
      var s = (tb * teeth + ph + (side < 0 ? 0.41 : 0)) % 1;
      var saw = s < 0.7 ? s / 0.7 : (1 - s) / 0.3;
      var tooth = (saw - 0.55) * maxHW * 0.11 * (0.35 + f) * U.smooth(0.02, 0.12, tb) * (1 - U.smooth(0.88, 1, tb));
      var notch = Math.pow(Math.max(0, Math.sin(tb * Math.PI * 2.6 + side * 0.8 + variant * 1.7)), 16) * maxHW * 0.16 * (1 - tb);
      return Math.max(W * 0.006, maxHW * sc * f + tooth - notch);
    }
    function outline(c2) {
      c2.beginPath();
      for (i = 0; i <= N; i++) { t = i / N; c2[i ? 'lineTo' : 'moveTo'](midX(t) - hw(t, -1), Y(t)); }
      for (i = N; i >= 0; i--) { t = i / N; c2.lineTo(midX(t) + hw(t, 1), Y(t)); }
      c2.closePath();
    }
    // 色
    ctx.save(); outline(ctx);
    var gr = ctx.createLinearGradient(cx - maxHW, 0, cx + maxHW, 0);
    gr.addColorStop(0, '#36611f'); gr.addColorStop(0.5, '#447329'); gr.addColorStop(1, '#36611f');
    ctx.fillStyle = gr; ctx.fill(); ctx.clip();
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.22;
    ctx.drawImage(noiseC, ox, 0, W, Hh);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // 葉脈（色）と溝（高さ）
    hx.save(); outline(hx); hx.clip();
    hx.globalAlpha = 0.45; hx.drawImage(noiseC, ox, 0, W, Hh); hx.globalAlpha = 1;
    function vein(x0, y0, qx, qy, x1, y1, wid, col, hcol) {
      ctx.strokeStyle = col; ctx.lineWidth = wid; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(qx, qy, x1, y1); ctx.stroke();
      hx.strokeStyle = hcol; hx.lineWidth = wid * 1.4; hx.beginPath(); hx.moveTo(x0, y0); hx.quadraticCurveTo(qx, qy, x1, y1); hx.stroke();
    }
    ctx.lineCap = hx.lineCap = 'round';
    for (var side = -1; side <= 1; side += 2) {
      var nVein = 7;
      for (var k = 0; k < nVein; k++) {
        var t0 = st + 0.02 + (k + 0.3) / nVein * 0.78 + (rnd() - 0.5) * 0.03;
        var t1 = Math.min(0.97, t0 + 0.13 + 0.04 * rnd());
        var x0 = midX(t0), y0 = Y(t0), x1 = midX(t1) + side * hw(t1, side) * 0.82, y1 = Y(t1);
        var qx = midX(t0) + side * hw(t0, side) * 0.55, qy = Y(t0 + 0.035);
        vein(x0, y0, qx, qy, x1, y1, W * 0.011, 'rgba(120,160,80,0.45)', 'rgb(105,105,105)');
        // 細かい網目
        for (var m = 0; m < 5; m++) {
          var tt = t0 + (t1 - t0) * (m + 0.5) / 5, xa = U.lerp(x0, x1, (m + 0.5) / 5), ya = Y(tt) - (1 - (m + 0.5) / 5) * 4;
          var xb = xa + side * (6 + rnd() * 10), yb = ya + 10 + rnd() * 14;
          vein(xa, ya, (xa + xb) / 2 - side * 3, (ya + yb) / 2, xb, yb, W * 0.004, 'rgba(110,150,70,0.22)', 'rgb(125,125,125)');
        }
      }
    }
    // 主脈
    for (i = 0; i < 40; i++) {
      var ta = i / 40, tb2 = (i + 1) / 40, wv = U.lerp(W * 0.034, W * 0.006, ta);
      vein(midX(ta), Y(ta), midX((ta + tb2) / 2), Y((ta + tb2) / 2), midX(tb2), Y(tb2), wv, '#82a855', 'rgb(90,90,90)');
    }
    // ふちを少し濃く
    outline(ctx); ctx.strokeStyle = 'rgba(28,50,18,0.4)'; ctx.lineWidth = W * 0.03; ctx.stroke();
    // 付け根の小葉柄は茎の色
    ctx.fillStyle = '#6f9a45'; ctx.fillRect(cx - W * 0.016, yA, W * 0.032, len * st);
    ctx.restore(); hx.restore();
  }
  function makeStemTex() {
    return U.tex(U.pixelCanvas(128, function (u, v, out) {
      var x = Math.floor(u * 128), y = Math.floor(v * 128);
      var str = U.noise2(u * 40, 0.5, 3, 40), n = U.fbm(u * 8, v * 8, 3, 4, 8);
      var k = 0.82 + 0.22 * str + 0.2 * (n - 0.5);
      var r = 92 * k, gg = 138 * k, b = 58 * k;
      var hsh = U.hash2(x, y, 9);
      if (hsh > 0.975) { r = r * 0.5 + 95; gg = gg * 0.5 + 105; b = b * 0.5 + 80; }
      out[0] = r; out[1] = gg; out[2] = b;
    }), { srgb: true, repeat: [1, 1] });
  }
  function makeSoilTex() {
    return U.tex(U.pixelCanvas(128, function (u, v, out) {
      var x = Math.floor(u * 128), y = Math.floor(v * 128);
      var n = U.fbm(u * 10, v * 10, 4, 21, 10), k = 0.55 + 0.9 * n;
      var r = 58 * k, g = 42 * k, b = 30 * k;
      var h = U.hash2(x, y, 3);
      if (h > 0.988) { r = 205; g = 200; b = 190; } else if (h < 0.02) { r *= 0.5; g *= 0.5; b *= 0.5; }
      out[0] = r; out[1] = g; out[2] = b;
    }), { srgb: true, repeat: [2, 2] });
  }

  /* 実の色（緑 → 黄緑 → 橙 → 赤） */
  var STOPS = [[-0.25, 0x3a6a1d], [0, 0x5a942c], [0.2, 0xa3b63c], [0.35, 0xdca22e], [0.5, 0xe9802a], [0.66, 0xe2521e], [0.82, 0xcf2c16], [1.0, 0xb8160c], [1.3, 0xa8120a]];
  STOPS = STOPS.map(function (s) { return { p: s[0], c: new THREE.Color(s[1]) }; });
  function ripeColor(r, out) {
    if (r <= STOPS[0].p) return out.copy(STOPS[0].c);
    for (var i = 1; i < STOPS.length; i++) if (r <= STOPS[i].p) {
      var a = STOPS[i - 1], b = STOPS[i]; return out.lerpColors(a.c, b.c, (r - a.p) / (b.p - a.p));
    }
    return out.copy(STOPS[STOPS.length - 1].c);
  }
  function fruitOBC(shader) {
    shader.uniforms.uColA = this.userData.uA; shader.uniforms.uColB = this.userData.uB;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uColA;\nuniform vec3 uColB;\nvarying vec3 vLp;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'float hh = clamp(vLp.y / 0.026 * 0.55 + 0.5, 0.0, 1.0);\n' +
        'vec3 fcol = mix(uColA, uColB, smoothstep(0.15, 0.98, hh));\n' +
        'float ang = atan(vLp.z, vLp.x);\n' +
        'float stp = sin(ang * 9.0 + sin(ang * 3.0 + hh * 4.0) * 1.6) * smoothstep(0.45, 1.0, hh);\n' +
        'fcol *= 1.0 + 0.06 * stp;\n' +
        'vec4 diffuseColor = vec4( fcol, opacity );');
  }
  function fruitMaterial() {
    var m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 });
    m.userData.uA = { value: new THREE.Color() }; m.userData.uB = { value: new THREE.Color() };
    m.onBeforeCompile = fruitOBC;
    return m;
  }
  function setFruitColor(m, r) {
    var off = 0.14 * U.smooth(0.02, 0.2, r);
    ripeColor(r + off, m.userData.uA.value); ripeColor(r - 0.15, m.userData.uB.value);
  }
  function leafOBC(shader) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb *= vec3(1.25, 1.3, 1.12);');
  }
  function makeLeafMat(rs) {
    var m = new THREE.MeshStandardMaterial({ map: rs.leafTex.map, normalMap: rs.leafTex.normal, normalScale: new THREE.Vector2(0.9, 0.9),
      alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    m.onBeforeCompile = leafOBC;
    return m;
  }

  /* がく（へた）の帯を書く: dyn の区画 slots に、付け根 top・実の向き A（下向き）で */
  var _er = new V(), _et = new V(), _dir = new V(), _cn = new V();
  function writeCalyx(dyn, slots, nSep, top, A, e1, e2, a0, a1, slen, swid, rot) {
    var nu = slots[0].nu;
    for (var k = 0; k < slots.length; k++) {
      if (k >= nSep || slen < 1e-5) { dyn.hide(slots[k]); continue; }
      var th = rot + k / nSep * Math.PI * 2 + (k % 2) * 0.12;
      _er.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
      _et.copy(e1).multiplyScalar(-Math.sin(th)).addScaledVector(e2, Math.cos(th));
      var C = RIB.C, step = slen / (nu - 1);
      C[0].copy(top).addScaledVector(_er, swid * 0.3);
      for (var i = 0; i < nu; i++) {
        var u = i / (nu - 1), al = U.lerp(a0, a1, Math.pow(u, 1.4)) + (k % 2 ? 0.08 : -0.05);
        _dir.copy(A).multiplyScalar(Math.cos(al)).addScaledVector(_er, Math.sin(al));
        if (i > 0) C[i].copy(C[i - 1]).addScaledVector(_dir, step);
        var hwid = swid * 0.5 * Math.max(0.04, Math.pow(1 - u, 0.9) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 2))));
        RIB.Wv[i].copy(_et).multiplyScalar(hwid);
        _cn.crossVectors(_dir, _et); RIB.Nv[i].copy(_cn).multiplyScalar(-hwid * 0.35);
      }
      dyn.writeGrid(slots[k], ribbonFn, RIB);
    }
  }

  /* ───────── 共有の資源 ───────── */
  var RS = null;
  function res() {
    if (RS) return RS;
    RS = {};
    RS.leafTex = makeLeafTextures();
    RS.stemTex = makeStemTex();
    RS.stemMat = new THREE.MeshStandardMaterial({ map: RS.stemTex, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
    RS.flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    RS.soilMat = new THREE.MeshStandardMaterial({ map: makeSoilTex(), roughness: 0.95, metalness: 0 });
    RS.potMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.34, metalness: 0, side: THREE.DoubleSide });
    // 水玉
    var dg = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dg.scale(1, 0.55, 1);
    RS.dropGeo = dg;
    RS.dropMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb3bd, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22,
      clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
    // 実の形
    var fg = new THREE.SphereGeometry(R, 40, 28), p = fg.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), rr = Math.sqrt(x * x + z * z) / R;
      y *= 0.92;
      var lob = 1 + 0.012 * Math.sin(a * 5 + 0.5) * (1 - Math.abs(y) / R);
      x *= lob; z *= lob;
      if (y > 0) y -= R * 0.06 * Math.exp(-(rr * rr) / 0.09);
      p.setXYZ(i, x, y, z);
    }
    fg.computeVertexNormals();
    RS.fruitGeo = fg;
    // 単体の実のへた（がく＋短い軸）
    var cd = new Dyn(false), slots = [];
    for (var k = 0; k < 6; k++) slots.push(cd.grid(6, 3));
    var stub = cd.tube(4, 6, 1);
    cd.build();
    var top = new V(0, R * TOPY, 0), A = new V(0, -1, 0);
    writeCalyx(cd, slots, 6, top, A, new V(1, 0, 0), new V(0, 0, 1), 1.45, 2.05, 0.0135, 0.0032, 0.3);
    cd.writeTube(stub, [new V(0, R * TOPY - 0.001, 0), new V(0, R * TOPY + 0.003, 0), new V(0.0006, R * TOPY + 0.0065, 0), new V(0.0015, R * TOPY + 0.0095, 0)],
      [0.0016, 0.0014, 0.0013, 0.0013]);
    RS.calyxGeo = cd.geo;
    RS.calyxGeo.boundingSphere = new THREE.Sphere(new V(0, R * TOPY, 0), 0.02);
    return RS;
  }

  /* ───────── 単体のトマト ───────── */
  function makeFruit(ripe) {
    var rs = res();
    var grp = new THREE.Group();
    var m = fruitMaterial(), cur = ripe || 0; setFruitColor(m, cur);
    var fm = new THREE.Mesh(rs.fruitGeo, m); fm.castShadow = true; fm.receiveShadow = true;
    var cm = new THREE.Mesh(rs.calyxGeo, rs.stemMat); cm.castShadow = true; cm.receiveShadow = true;
    var ND = 12, drops = new THREE.InstancedMesh(rs.dropGeo, rs.dropMat, ND), rnd = U.rng(77), mtx = new THREE.Matrix4();
    var dq = new THREE.Quaternion(), dp = new V(), dsc = new V(), dn = new V();
    for (var i = 0; i < ND; i++) {
      var th = rnd() * Math.PI * 2, ph = Math.acos(U.lerp(0.75, -0.35, rnd()));
      dn.set(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.92, Math.sin(ph) * Math.sin(th)).normalize();
      dp.copy(dn).multiplyScalar(R * 0.99); dq.setFromUnitVectors(YAX, dn); var s = 0.0018 + 0.0022 * rnd(); dsc.set(s, s, s);
      mtx.compose(dp, dq, dsc); drops.setMatrixAt(i, mtx);
    }
    drops.count = 0; drops.visible = false;
    grp.add(fm); grp.add(cm); grp.add(drops);
    var calyxOnly = false, wet = 0;
    grp.userData.fruitMesh = fm;
    grp.userData.setRipe = function (r) { if (r === cur) return; cur = r; setFruitColor(m, r); };
    grp.userData.setWet = function (w) {
      w = U.clamp01(w); if (w === wet) return; wet = w;
      drops.count = Math.round(ND * w); drops.visible = w > 0.01 && !calyxOnly;
      m.roughness = U.lerp(0.32, 0.16, w); m.clearcoatRoughness = U.lerp(0.12, 0.03, w);
    };
    grp.userData.setCalyxOnly = function (b) { calyxOnly = !!b; fm.visible = !calyxOnly; drops.visible = !calyxOnly && wet > 0.01; };
    return grp;
  }

  /* ───────── 株 ───────── */
  // 葉: 付け根の高さ（育ちきったときの茎の長さ方向の位置）, 向き（度。0=右 +X, 90=手前 +Z, -90=奥）, 長さ
  var LEAF_H = [0.03, 0.065, 0.10, 0.135, 0.17, 0.23, 0.30, 0.37, 0.50, 0.60, 0.82, 0.93];
  var LEAF_AZ = [-158, -28, 172, -72, -128, -20, -170, -44, -150, -96, -24, -140];
  var LEAF_LEN = [0.20, 0.24, 0.28, 0.32, 0.34, 0.36, 0.37, 0.37, 0.36, 0.34, 0.31, 0.27];
  // 果房: 枝の折れ線（房の座標: x=外向き, y=上, z=横）と、実の中心（育ちきった大きさのとき）
  var TRUSS = [
    { H: 0.42, az: 80, rach: [[0, 0, 0], [0.028, 0.012, 0], [0.050, 0.0, -0.006], [0.068, -0.02, 0.004], [0.086, -0.055, -0.004], [0.097, -0.07, 0.006]],
      fr: [{ j: 2, c: [0.055, -0.048, -0.036] }, { j: 3, c: [0.075, -0.062, 0.030] }, { j: 4, c: [0.093, -0.112, -0.028] }, { j: 5, c: [0.106, -0.122, 0.038] }] },
    { H: 0.72, az: 100, rach: [[0, 0, 0], [0.028, 0.012, 0], [0.048, 0.0, 0.004], [0.066, -0.02, -0.004], [0.083, -0.055, 0.002]],
      fr: [{ j: 2, c: [0.050, -0.050, 0.032] }, { j: 3, c: [0.070, -0.066, -0.034] }, { j: 4, c: [0.090, -0.118, 0.008], late: true }] }
  ];
  var Y_LIE, Q_TILT = new THREE.Quaternion();
  (function () { // 横倒しのポットの姿勢（側面の線が床に付く）
    var r1 = 0.0355, y1 = -0.079, r2 = 0.053, y2 = 0.0095, th = Math.atan2(y2 - y1, r2 - r1);
    Y_LIE = r1 * Math.sin(th) - y1 * Math.cos(th) + 0.0004;
    Q_TILT.setFromAxisAngle(new V(0, 0, 1), th);
  })();

  function create(scene, quality) {
    quality = quality || {};
    var low = !!quality.low;
    var rs = res();
    var plant = {};
    var root = new THREE.Group(); root.name = 'tomatoPlant'; scene.add(root);
    plant.root = root;

    var g = 0, A = 0.2, gScale = 0.5;
    var thirstT = 0, TH = { w: 0, v: 0 };
    var flowersV = 0, fruitV = 0, ripeV = 0, lateV = 0, wetV = 0;
    var stemOsc = { x: 0, vx: 0, z: 0, vz: 0 };
    var rnd = U.rng(20261121);

    var tubes = new Dyn(false), leafD = new Dyn(false), flD = new Dyn(true);
    var nS = low ? 18 : 28, radS = low ? 6 : 8, radT = low ? 4 : 5, nR = low ? 6 : 8;
    var lnu = low ? 4 : 7, lnv = low ? 3 : 5, pnu = low ? 4 : 5, snu = low ? 3 : 4;
    var stemSlot = tubes.tube(nS + 1, radS, 12);
    var stemP = [], stemD = [], stemRad = [];
    for (var i = 0; i <= nS; i++) { stemP.push(new V()); stemD.push(new V()); stemRad.push(0); }

    // ── 葉
    var leaves = [];
    function addLeaf(k, H, az, len, pairs, inter, apex) {
      var lf = { k: k, H: H, az: az * D2R, len: len, apex: apex, slot: tubes.tube(nR, radT, 2), R: [], Rr: [], lfs: [],
        osc: { e: 0, ev: 0, a: 0, av: 0, fl: 0 }, ph: k * 1.7 + 0.3, mid: new V(), o: new V(), b: new V(), vis: false };
      for (var q = 0; q < nR; q++) { lf.R.push(new V()); lf.Rr.push(0); }
      function addLf(u, side, size, ang, hang, variant) {
        var s = leafD.grid(lnu, lnv);
        lf.lfs.push({ slot: s, u: u, side: side, size: size, ang: ang, hang: hang, variant: variant,
          B: new V(), D: new V(), N: new V(), Wd: new V(), len: 0, wid: 0, fold: 0, droop: 0, curl: 0, vis: false, ph: rnd() * 6.28, rr: (rnd() - 0.5) * 0.7 });
      }
      addLf(1, 0, 1, 0, 0.2, 0);
      var us, sz, an;
      if (pairs === 3) { us = [0.80, 0.56, 0.31]; sz = [0.84, 0.74, 0.52]; an = [0.95, 1.12, 1.3]; }
      else { us = [0.72, 0.40]; sz = [0.8, 0.6]; an = [1.0, 1.25]; }
      for (var p = 0; p < us.length; p++) for (var sd = 1; sd >= -1; sd -= 2) addLf(us[p] + sd * 0.025, sd, sz[p], an[p], 0.1 + 0.07 * p, 1);
      if (inter) for (var sd2 = 1; sd2 >= -1; sd2 -= 2) addLf(0.44 - sd2 * 0.02, sd2, 0.2, 1.35, 0.3, 1);
      leaves.push(lf);
      return lf;
    }
    for (var k = 0; k < LEAF_H.length; k++) addLeaf(k, LEAF_H[k], LEAF_AZ[k], LEAF_LEN[k], k < 3 ? 2 : 3, k >= 4 && k <= 10, false);
    var apexLeaf = addLeaf(12, 0, 35, 0.075, 2, false, true);
    // 節で茎が少しジグザグに折れる
    var kinks = LEAF_H.map(function (h, k) { return { h: h, x: -Math.cos(LEAF_AZ[k] * D2R) * 0.06, z: -Math.sin(LEAF_AZ[k] * D2R) * 0.06 }; });

    // ── 果房と実
    var units = [], trusses = [];
    TRUSS.forEach(function (td, ti) {
      var tr = { H: td.H, az: td.az * D2R, rach: td.rach, slot: tubes.tube(td.rach.length, radT, 1), RP: [], Rr: [], units: [],
        rv: new V(), rvv: new V(), rvT: new V(), sv: new V(), svv: new V(), svT: new V(), held: -1, target: new V(), ph: ti * 2.1 };
      td.rach.forEach(function () { tr.RP.push(new V()); tr.Rr.push(0); });
      td.fr.forEach(function (fd) {
        var idx = units.length;
        var mat = fruitMaterial(); setFruitColor(mat, 0);
        var mesh = new THREE.Mesh(rs.fruitGeo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = false;
        root.add(mesh);
        var u = { index: idx, tr: tr, j: fd.j, c: fd.c, late: !!fd.late, mesh: mesh, mat: mat,
          ped: tubes.tube(5, radT, 1), sep: [], pet: [], cone: flD.tube(4, 6, 1),
          nSep: (idx % 3 === 1) ? 6 : 5, nPet: (idx % 3 === 1) ? 6 : 5, rot: rnd() * 6.28,
          fd: [0.0, 0.32, 0.12, 0.5, 0.06, 0.24, 0.42][idx], gd: [0, 0.12, 0.05, 0.2, 0.03, 0.1, 0.18][idx],
          rd: [0.0, 0.3, 0.12, 0.42, 0.06, 0.22][idx] || 0,
          fallT: -1, bs: 0, bsv: 0, ripe: -1, spin: new THREE.Quaternion().setFromAxisAngle(YAX, rnd() * 6.28),
          top: new V(), A: new V(0, -1, 0), center: new V(),
          pub: { index: idx, late: !!fd.late, picked: false, pos: new V() } };
        for (var s = 0; s < 6; s++) { u.sep.push(tubes.grid(snu, 3)); u.pet.push(flD.grid(pnu, 3)); }
        units.push(u); tr.units.push(u);
      });
      trusses.push(tr);
    });
    plant.fruits = units.map(function (u) { return u.pub; });

    // ── メッシュ化
    tubes.build(); leafD.build(); flD.build();
    leaves.forEach(function (lf) {
      lf.lfs.forEach(function (sp) { leafD.setGridUV(sp.slot, sp.variant * 0.5, sp.variant * 0.5 + 0.5, sp.side < 0); });
    });
    var leafMat = makeLeafMat(rs);
    var tubeMesh = new THREE.Mesh(tubes.geo, rs.stemMat), leafMesh = new THREE.Mesh(leafD.geo, leafMat), flMesh = new THREE.Mesh(flD.geo, rs.flowerMat);
    [tubeMesh, leafMesh, flMesh].forEach(function (m) { m.frustumCulled = false; m.receiveShadow = true; root.add(m); });
    tubeMesh.castShadow = true; leafMesh.castShadow = true;
    // 水玉
    var ND = low ? 32 : 70, drops = new THREE.InstancedMesh(rs.dropGeo, rs.dropMat, ND), dropSpec = [];
    drops.frustumCulled = false; drops.count = 0; drops.visible = false; root.add(drops);
    (function () {
      var pool = [];
      leaves.forEach(function (lf) { if (lf.k >= 1 && !lf.apex) lf.lfs.forEach(function (sp) { if (sp.size > 0.45) pool.push(sp); }); });
      for (var d = 0; d < ND; d++) dropSpec.push({ sp: pool[Math.floor(rnd() * pool.length)], u: 0.25 + 0.55 * rnd(), v: 0.32 + 0.36 * rnd(), s: 0.0016 + 0.0024 * rnd() });
    })();

    // ── ポットと根鉢
    var potPts = [[0.0, -0.0785], [0.030, -0.0785], [0.0333, -0.0772], [0.0482, 0.0072], [0.0490, 0.0100], [0.0506, 0.0117], [0.0523, 0.0112],
      [0.0530, 0.0095], [0.0524, 0.0074], [0.0507, 0.0064], [0.0355, -0.0790], [0.0345, -0.0803], [0.0300, -0.0807], [0.0, -0.0807]].map(function (q) { return new THREE.Vector2(q[0], q[1]); });
    var potGeo = new THREE.LatheGeometry(potPts, 40);
    (function () {
      var p = potGeo.attributes.position;
      for (var q = 0; q < p.count; q++) {
        var x = p.getX(q), y = p.getY(q), z = p.getZ(q), r = Math.sqrt(x * x + z * z); if (r < 0.001) continue;
        var a = Math.atan2(z, x), kk = 1 + 0.014 * (U.noise2((a + Math.PI) * 2.2, y * 30, 7, 0) - 0.5) * 2 * U.smooth(0.004, -0.06, y);
        p.setX(q, x * kk); p.setZ(q, z * kk);
      }
      potGeo.computeVertexNormals();
    })();
    var pot = new THREE.Mesh(potGeo, rs.potMat); pot.receiveShadow = true; pot.name = 'vinylPot';
    root.add(pot);
    plant.pot = pot; plant.potH = 0.09;
    var ball = new THREE.Mesh(new THREE.CylinderGeometry(0.0468, 0.0330, 0.077, 24, 1), rs.soilMat);
    ball.position.y = -0.0395; ball.receiveShadow = true; root.add(ball);
    plant.onPotBounce = null;

    // ── 一時変数
    var _P = new V(), _Dd = new V(), _q = new THREE.Quaternion(), _ax = new V(), _o = new V(), _up = new V(), _bb = new V();
    var _d = new V(), _T = new V(), _tmp = new V(), _tmp2 = new V(), _m4 = new THREE.Matrix4(), _sc = new V();
    var _qF = new THREE.Quaternion(), _qH = new THREE.Quaternion(), _Q = new V(), _e1 = new V(), _e2 = new V();
    var DD = new V(-0.85, 0, 0.5).normalize();   // しおれた茎の先が垂れる向き
    var PED = [new V(), new V(), new V(), new V(), new V()], PEDR = [0, 0, 0, 0, 0], CONE = [new V(), new V(), new V(), new V()], CONER = [0, 0, 0, 0];
    var maxY = 0.2, maxR = 0.1;
    var col = new THREE.Color(), colBud = new THREE.Color(0xa9bd52), colOpen = new THREE.Color(0xf6d21c), colDry = new THREE.Color(0xc9a646), colCone = new THREE.Color(0xe2b812);

    function stemAt(h, outP, outD) {
      var ds = A / nS, f = U.clamp(h / ds, 0, nS - 1e-4), i = Math.floor(f), t = f - i;
      outP.lerpVectors(stemP[i], stemP[i + 1], t); if (outD) outD.copy(stemD[i + 1]);
      return U.lerp(stemRad[i], stemRad[i + 1], t);
    }

    function computeStem(time) {
      var Ls = A, ds = Ls / nS, W = TH.w, Wd = Math.max(W, -0.15), Lw = 0.06 + 0.10 * g;
      var sx = stemOsc.x + 0.010 * Math.sin(time * 1.1) + 0.006 * Math.sin(time * 2.3 + 1.0);
      var sz = stemOsc.z + 0.008 * Math.sin(time * 0.9 + 2.0) + 0.005 * Math.sin(time * 2.9);
      var dir = _d.set(-0.03, 1, -0.01).normalize();
      stemP[0].set(0, 0, 0); stemD[0].copy(dir);
      for (var i = 0; i < nS; i++) {
        var s = (i + 0.5) * ds;
        var kx = 0.22 * Math.sin(s * 6.1 + 2.4) + 0.12 * Math.sin(s * 13 + 2), kz = 0.2 * Math.sin(s * 5.3 + 2.1) + 0.12 * Math.sin(s * 11.7);
        for (var q = 0; q < kinks.length; q++) { var kn = kinks[q]; if (kn.h < Ls - 0.02 && Math.abs(s - kn.h) < ds * 0.5) { kx += kn.x / ds; kz += kn.z / ds; } }
        var dd = Wd * 0.14 / Ls;
        if (s > Ls - Lw) dd += Wd * 2.0 / Lw * (0.5 + (s - (Ls - Lw)) / Lw);
        kx += DD.x * dd; kz += DD.z * dd;
        var sw = 2 * s / (Ls * Ls); kx += sx * sw; kz += sz * sw;
        var km = Math.sqrt(kx * kx + kz * kz);
        if (km > 1e-7) { _ax.set(kz / km, 0, -kx / km); rotAxis(dir, _ax, km * ds); }
        stemP[i + 1].copy(stemP[i]).addScaledVector(dir, ds); stemD[i + 1].copy(dir);
      }
      var rb = U.lerp(0.0030, 0.0056, U.smooth(0, 1, g));
      for (i = 0; i <= nS; i++) {
        var s2 = i * ds;
        stemRad[i] = rb * (1 - 0.42 * s2 / Ls) * Math.min(1, 0.4 + (Ls - s2) / 0.03 * 0.6);
        if (stemP[i].y > maxY) maxY = stemP[i].y;
      }
      tubes.writeTube(stemSlot, stemP, stemRad);
    }

    function leafletFn(sp, u, v, out) {
      var vv = v * 2 - 1, av = Math.abs(vv);
      var z = sp.fold * av * sp.wid * 0.5 - sp.droop * sp.len * u * u * 0.45 - sp.curl * av * av * av * sp.wid * 0.4;
      out.copy(sp.B).addScaledVector(sp.D, u * sp.len).addScaledVector(sp.Wd, vv * sp.wid * 0.5).addScaledVector(sp.N, z);
    }

    function computeLeaf(lf, time) {
      var h = lf.apex ? A - 0.006 : lf.H, i, q;
      if (!lf.apex && A < h + 0.004) {
        if (lf.vis) { lf.vis = false; tubes.hide(lf.slot); lf.lfs.forEach(function (sp) { sp.vis = false; leafD.hide(sp.slot); }); }
        return;
      }
      lf.vis = true;
      var W = TH.w, age = lf.apex ? 0.02 : A - h;
      var sa = lf.apex ? 1 : 0.1 + 0.9 * U.smooth(0, 0.12, age);
      var Lk = lf.apex ? lf.len * (0.6 + 0.4 * g) : lf.len * sa * gScale;
      var young = lf.apex ? 1 : 1 - U.smooth(0.0, 0.18, age);
      var rs0 = stemAt(h, _P, _Dd);
      _q.setFromUnitVectors(UP, _Dd);
      var os = lf.osc, wind = 0.03 * Math.sin(time * 1.9 + lf.ph) + 0.015 * Math.sin(time * 3.3 + lf.ph * 2.0);
      var az = lf.az + os.a + 0.4 * wind;
      var o = lf.o.set(Math.cos(az), 0, Math.sin(az)).applyQuaternion(_q);
      _up.copy(_Dd);
      var b = lf.b.crossVectors(o, _up).normalize();
      var eH = U.lerp(0.62, 1.25, young), eW = U.lerp(-0.85, -0.05, young);
      var e = U.lerp(eH, eW, W) + os.e + wind;
      var bend = U.lerp(0.95, 1.25, W) * (1 - young * 0.7);
      var Rl = Lk * 0.70, ds = Rl / (nR - 1);
      var Rp = lf.R;
      Rp[0].copy(_P).addScaledVector(o, rs0 * 0.7);
      _d.copy(o); rotAxis(_d, b, e);
      for (i = 1; i < nR; i++) {
        Rp[i].copy(Rp[i - 1]).addScaledVector(_d, ds);
        rotAxis(_d, b, -bend / (nR - 1) * (0.3 + 1.4 * i / (nR - 1)));
      }
      var r0 = 0.0009 + 0.0024 * Lk / 0.3;
      for (i = 0; i < nR; i++) lf.Rr[i] = r0 * (1 - 0.62 * i / (nR - 1));
      tubes.writeTube(lf.slot, Rp, lf.Rr);
      lf.mid.copy(Rp[nR >> 1]);
      // 小葉
      var fl = os.fl;
      for (q = 0; q < lf.lfs.length; q++) {
        var sp = lf.lfs[q];
        var f = Math.min(sp.u, 1) * (nR - 1), ii = Math.min(Math.floor(f), nR - 2), t = f - ii;
        sp.B.lerpVectors(Rp[ii], Rp[ii + 1], t); _T.subVectors(Rp[ii + 1], Rp[ii]).normalize();
        var D = sp.D;
        if (sp.side === 0) D.copy(_T);
        else D.copy(_T).multiplyScalar(Math.cos(sp.ang)).addScaledVector(b, sp.side * Math.sin(sp.ang)).normalize();
        var beta = sp.hang + 0.22 + W * 1.0 - young * 0.35;
        _ax.crossVectors(D, UP); var al = _ax.length();
        if (al > 1e-3) { _ax.multiplyScalar(1 / al); rotAxis(D, _ax, -beta); }
        var N = sp.N.copy(UP).addScaledVector(D, -D.y);
        if (N.lengthSq() < 0.01) N.copy(o);
        N.normalize();
        var roll = sp.rr + sp.side * (0.15 + 0.5 * W) + (0.05 + fl * 0.6) * Math.sin(time * (3.1 + fl * 20) + sp.ph);
        if (sp.side === 0) roll = (0.04 + fl * 0.5) * Math.sin(time * (2.7 + fl * 20) + sp.ph);
        rotAxis(N, D, roll);
        sp.Wd.crossVectors(N, D);
        sp.len = Lk * 0.40 * sp.size; sp.wid = sp.len * 0.6;
        sp.fold = 0.2 + 0.35 * W + young * 0.55;
        sp.droop = U.lerp(0.3, 1.1, W) * (1 - young * 0.5);
        sp.curl = 0.12 + 0.25 * W;
        sp.B.addScaledVector(D, 0.001);
        sp.vis = sp.len > 0.002;
        if (sp.vis) {
          leafD.writeGrid(sp.slot, leafletFn, sp);
          var ty = sp.B.y + D.y * sp.len; if (ty > maxY) maxY = ty;
          var rx = sp.B.x + D.x * sp.len * 0.7, rz = sp.B.z + D.z * sp.len * 0.7, rr = Math.sqrt(rx * rx + rz * rz); if (rr > maxR) maxR = rr;
        } else leafD.hide(sp.slot);
      }
    }

    // 房の座標 → 株の座標
    function trussPt(tr, x, y, z, ts, qrot, out) {
      out.copy(_o).multiplyScalar(x).addScaledVector(_up, y).addScaledVector(_bb, z).multiplyScalar(ts);
      if (qrot) out.applyQuaternion(qrot);
      return out.add(_Q);
    }

    function hideUnit(u) {
      tubes.hide(u.ped); for (var s = 0; s < 6; s++) { tubes.hide(u.sep[s]); flD.hide(u.pet[s]); } flD.hide(u.cone);
      u.mesh.visible = false;
    }

    function computeTruss(tr, time, dt) {
      var ts = U.smooth(0.78, 0.92, g), bsc = U.smooth(0.84, 0.93, g), i, s;
      if (ts < 0.002 || A < tr.H + 0.01) {
        tubes.hide(tr.slot); tr.units.forEach(hideUnit);
        tr.units.forEach(function (u) { u.center.set(0, tr.H, 0); });
        return;
      }
      var rs0 = stemAt(tr.H, _Q, _Dd);
      _q.setFromUnitVectors(UP, _Dd);
      _o.set(Math.cos(tr.az), 0, Math.sin(tr.az)).applyQuaternion(_q); _up.copy(_Dd); _bb.crossVectors(_o, _up).normalize();
      _Q.addScaledVector(_o, rs0 * 0.6);
      // 引っぱり
      tr.rvT.set(0, 0, 0); tr.svT.set(0, 0, 0);
      if (tr.held >= 0) {
        var hu = units[tr.held];
        trussPt(tr, hu.c[0], hu.c[1], hu.c[2], ts, null, _tmp);      // ふだんの実の位置
        _tmp2.subVectors(tr.target, _tmp); var dl = _tmp2.length(); if (dl > 0.08) _tmp2.multiplyScalar(0.08 / dl);
        var a = _tmp.sub(_Q), bvec = _tmp2.add(a);
        var la = a.length(), lb = bvec.length();
        if (la > 1e-4 && lb > 1e-4) {
          _ax.crossVectors(a, bvec); var sn = _ax.length(), cs = a.dot(bvec);
          var ang = Math.min(0.95, Math.atan2(sn, cs));
          if (sn > 1e-8) tr.rvT.copy(_ax).multiplyScalar(ang / sn);
          tr.svT.copy(a).multiplyScalar(U.clamp(lb - la, -0.01, 0.04) / la);
        }
      }
      var kk = tr.held >= 0 ? 260 : 75, zz = tr.held >= 0 ? 0.75 : 0.11, cc = 2 * zz * Math.sqrt(kk);
      tr.rvv.x += (kk * (tr.rvT.x - tr.rv.x) - cc * tr.rvv.x) * dt; tr.rvv.y += (kk * (tr.rvT.y - tr.rv.y) - cc * tr.rvv.y) * dt; tr.rvv.z += (kk * (tr.rvT.z - tr.rv.z) - cc * tr.rvv.z) * dt;
      tr.rv.addScaledVector(tr.rvv, dt);
      tr.svv.x += (kk * (tr.svT.x - tr.sv.x) - cc * tr.svv.x) * dt; tr.svv.y += (kk * (tr.svT.y - tr.sv.y) - cc * tr.svv.y) * dt; tr.svv.z += (kk * (tr.svT.z - tr.sv.z) - cc * tr.svv.z) * dt;
      tr.sv.addScaledVector(tr.svv, dt);
      _ax.copy(tr.rv).addScaledVector(_bb, 0.035 * Math.sin(time * 1.4 + tr.ph)).addScaledVector(_o, 0.02 * Math.sin(time * 2.1 + tr.ph));
      var ang2 = _ax.length();
      if (ang2 > 1e-7) { _ax.multiplyScalar(1 / ang2); _qF.setFromAxisAngle(_ax, ang2); _qH.setFromAxisAngle(_ax, ang2 * 0.45); }
      else { _qF.identity(); _qH.identity(); }
      for (i = 0; i < tr.rach.length; i++) {
        var rp = tr.rach[i];
        trussPt(tr, rp[0], rp[1], rp[2], ts, i === 0 ? null : (i === 1 ? _qH : _qF), tr.RP[i]);
        if (i > 0) tr.RP[i].addScaledVector(tr.sv, i === 1 ? 0.35 : 1);
        tr.Rr[i] = U.lerp(0.0021, 0.0013, i / (tr.rach.length - 1)) * Math.max(0.35, ts);
      }
      tr.RP[0].copy(_Q).addScaledVector(_o, -rs0 * 0.5);
      tubes.writeTube(tr.slot, tr.RP, tr.Rr);

      for (var q = 0; q < tr.units.length; q++) {
        var u = tr.units[q], J = tr.RP[u.j];
        var top = trussPt(tr, u.c[0], u.c[1] + R * TOPY, u.c[2], ts, _qF, u.top);
        top.add(tr.sv);
        _tmp.subVectors(top, J); var pl = _tmp.length(); _tmp.multiplyScalar(1 / Math.max(pl, 1e-6));
        var Av = u.A.copy(_tmp).multiplyScalar(0.45).addScaledVector(DOWN, 0.55).normalize();
        // 果柄（関節のふくらみ付き）
        PED[0].copy(J);
        PED[1].lerpVectors(J, top, 0.3).addScaledVector(UP, 0.004 * ts);
        PED[2].lerpVectors(J, top, 0.58).addScaledVector(UP, 0.0035 * ts);
        PED[3].copy(top).addScaledVector(Av, -0.0045 * ts);
        PED[4].copy(top);
        var pr = Math.max(0.4, ts);
        PEDR[0] = 0.0012 * pr; PEDR[1] = 0.0011 * pr; PEDR[2] = 0.0016 * pr; PEDR[3] = 0.0012 * pr; PEDR[4] = 0.0013 * pr;
        if (u.pub.picked) {
          _tmp2.copy(PED[2]);
          for (i = 1; i < 5; i++) PED[i].lerpVectors(J, _tmp2, i / 4);
          PEDR[3] = 0.0014 * pr; PEDR[4] = 0.0012 * pr;
          tubes.writeTube(u.ped, PED, PEDR);
          for (s = 0; s < 6; s++) { tubes.hide(u.sep[s]); flD.hide(u.pet[s]); } flD.hide(u.cone); u.mesh.visible = false;
          u.center.copy(_tmp2);
          continue;
        }
        tubes.writeTube(u.ped, PED, PEDR);
        // 実の向きに垂直な2軸
        _e1.crossVectors(Av, _o); if (_e1.lengthSq() < 1e-6) _e1.set(1, 0, 0); _e1.normalize(); _e2.crossVectors(Av, _e1);
        var op = U.smooth(u.fd, u.fd + 0.4, flowersV);
        var frRaw = fruitV > 0 ? U.smooth(u.gd, u.gd + 0.75, fruitV) : -1;
        // がく
        var a0 = U.lerp(0.22, 1.15, op), a1 = U.lerp(-0.05, 1.7, op), sl = U.lerp(0.0095, 0.013, op);
        if (frRaw >= 0) { var ff = U.smooth(0, 0.3, frRaw + 0.05); a0 = U.lerp(a0, 1.42, ff); a1 = U.lerp(a1, 2.05, ff); sl = U.lerp(sl, 0.012 + 0.0025 * frRaw, ff); }
        writeCalyx(tubes, u.sep, bsc > 0.001 ? u.nSep : 0, top, Av, _e1, _e2, a0, a1, sl * bsc, 0.0027 * bsc, u.rot);
        // 花びら
        var showPet = bsc > 0.001 && (frRaw < 0 || (u.fallT >= 0 && u.fallT < 1.3));
        if (showPet) {
          var fall = frRaw >= 0 ? u.fallT : -1;
          var opn = fall >= 0 ? 1 : op;
          var p0 = U.lerp(0.1, 1.3, opn), p1 = U.lerp(-0.22, 2.6, opn) + (fall > 0 ? fall * 0.8 : 0);
          var plen = U.lerp(0.009, 0.017, opn) * bsc, pwid = U.lerp(0.0026, 0.0046, opn) * bsc, nu = pnu;
          col.copy(colBud).lerp(colOpen, U.smooth(0.0, 0.5, op)); if (fall >= 0) col.lerp(colDry, U.smooth(0, 1, fall));
          for (s = 0; s < 6; s++) {
            if (s >= u.nPet) { flD.hide(u.pet[s]); continue; }
            var th = u.rot + (s + 0.5) / u.nPet * Math.PI * 2;
            _er.copy(_e1).multiplyScalar(Math.cos(th)).addScaledVector(_e2, Math.sin(th));
            _et.copy(_e1).multiplyScalar(-Math.sin(th)).addScaledVector(_e2, Math.cos(th));
            var C = RIB.C;
            C[0].copy(top).addScaledVector(Av, 0.0012 * bsc).addScaledVector(_er, 0.0009 * bsc);
            if (fall > 0) C[0].addScaledVector(DOWN, 0.04 * fall + 0.3 * fall * fall).addScaledVector(_er, 0.03 * fall + 0.004 * s * fall);
            for (i = 0; i < nu; i++) {
              var uu = i / (nu - 1), al = U.lerp(p0, p1, Math.pow(uu, 1.25));
              _dir.copy(Av).multiplyScalar(Math.cos(al)).addScaledVector(_er, Math.sin(al));
              if (i > 0) C[i].copy(C[i - 1]).addScaledVector(_dir, plen / (nu - 1));
              var hw = pwid * 0.5 * Math.max(0.05, Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * uu)), 0.75));
              RIB.Wv[i].copy(_et).multiplyScalar(hw);
              _cn.crossVectors(_dir, _et); RIB.Nv[i].copy(_cn).multiplyScalar(hw * 0.25);
            }
            flD.writeGrid(u.pet[s], ribbonFn, RIB); flD.color(u.pet[s], col);
          }
        } else for (s = 0; s < 6; s++) flD.hide(u.pet[s]);
        // しべ（円すい）
        var cs2 = bsc * U.smooth(0.15, 0.6, op);
        if (frRaw < 0 && cs2 > 0.01) {
          for (i = 0; i < 4; i++) CONE[i].copy(top).addScaledVector(Av, (0.001 + 0.011 * i / 3) * cs2);
          CONER[0] = 0.0027 * cs2; CONER[1] = 0.0024 * cs2; CONER[2] = 0.0016 * cs2; CONER[3] = 0.0004 * cs2;
          flD.writeTube(u.cone, CONE, CONER); flD.color(u.cone, colCone);
        } else flD.hide(u.cone);
        // 実
        if (frRaw >= 0) {
          var sc = 0.17 + 0.83 * frRaw, bb = 1 + u.bs;
          u.center.copy(top).addScaledVector(Av, R * TOPY * sc * (1 + u.bs * 0.6));
          _tmp.copy(Av).negate(); u.mesh.quaternion.setFromUnitVectors(YAX, _tmp).multiply(u.spin);
          u.mesh.position.copy(u.center); u.mesh.scale.set(sc * bb, sc * (1 + u.bs * 0.3), sc * bb);
          u.mesh.visible = true;
        } else { u.mesh.visible = false; u.center.copy(top).addScaledVector(Av, 0.006); }
      }
    }

    function computeDrops() {
      if (wetV <= 0.001) { if (drops.visible) { drops.visible = false; drops.count = 0; } return; }
      drops.visible = true; drops.count = Math.round(ND * wetV);
      for (var d = 0; d < drops.count; d++) {
        var ds = dropSpec[d], sp = ds.sp;
        if (!sp.vis) { _sc.set(0, 0, 0); _m4.compose(_tmp.set(0, 0, 0), _q.identity(), _sc); drops.setMatrixAt(d, _m4); continue; }
        leafletFn(sp, ds.u, ds.v, _tmp);
        _tmp2.copy(sp.N); if (_tmp2.y < 0) _tmp2.negate();
        _tmp.addScaledVector(_tmp2, 0.0004);
        _q.setFromUnitVectors(YAX, _tmp2);
        var s = ds.s * U.clamp(sp.len / 0.09, 0.5, 1.15); _sc.set(s, s, s);
        _m4.compose(_tmp, _q, _sc); drops.setMatrixAt(d, _m4);
      }
      drops.instanceMatrix.needsUpdate = true;
    }

    // ── ポットの落下
    var potA = null, _qa = new THREE.Quaternion(), _qs = new THREE.Quaternion();
    function lieQuat(psi, spin, out) {
      _qa.setFromAxisAngle(YAX, psi); _qs.setFromAxisAngle(YAX, spin);
      return out.copy(_qa).multiply(Q_TILT).multiply(_qs);
    }
    plant.dropPot = function (floorTarget) {
      root.updateWorldMatrix(true, false);
      if (pot.parent !== scene) scene.attach(pot);
      var p0 = pot.position.clone(), tgt = new V(floorTarget.x, 0, floorTarget.z);
      var dx = tgt.x - p0.x, dz = tgt.z - p0.z, dist = Math.sqrt(dx * dx + dz * dz);
      var y1 = p0.y - 0.035, ya = Math.max(y1, 0.34) + 0.05, gg = 9.8;
      var v0 = Math.sqrt(2 * gg * (ya - y1)), T1 = v0 / gg + Math.sqrt(2 * (ya - Y_LIE) / gg);
      potA = { t: 0, p0: p0, q0: pot.quaternion.clone(), tgt: tgt, dx: dx, dz: dz, dist: dist, psi: dist > 1e-4 ? Math.atan2(dx, dz) : 0,
        y1: y1, v0: v0, T0: 0.12, T1: T1, h1: 0.03, h2: 0.009, stage: 0, qL: new THREE.Quaternion() };
      potA.Tb1 = 2 * Math.sqrt(2 * potA.h1 / gg); potA.Tb2 = 2 * Math.sqrt(2 * potA.h2 / gg); potA.Tr = 0.95;
    };
    function bounceCb(s) { if (plant.onPotBounce) plant.onPotBounce(s); }
    function updatePot(dt) {
      var a = potA; if (!a) return;
      a.t += dt;
      var t = a.t, gg = 9.8, fr, x, z, y, spin = 0;
      var tB1 = a.T0 + a.T1, tB2 = tB1 + a.Tb1, tR = tB2 + a.Tb2, tE = tR + a.Tr;
      function hz(f) { x = a.p0.x + a.dx * f; z = a.p0.z + a.dz * f; }
      if (t < a.T0) {
        var k = t / a.T0; pot.position.set(a.p0.x, a.p0.y - 0.035 * k * k, a.p0.z); pot.quaternion.copy(a.q0); return;
      }
      if (t < tB1) {
        var tau = t - a.T0; fr = tau / a.T1; hz(0.5 * fr);
        y = a.y1 + a.v0 * tau - 0.5 * gg * tau * tau;
        lieQuat(a.psi, 0, a.qL); pot.quaternion.copy(a.q0).slerp(a.qL, U.smooth(0, 1, fr * 1.1));
        pot.position.set(x, y, z); return;
      }
      if (a.stage < 1) { a.stage = 1; bounceCb(1.0); }
      var f2, roll;
      if (t < tB2) { fr = (t - tB1) / a.Tb1; f2 = U.lerp(0.5, 0.7, fr); y = Y_LIE + 4 * a.h1 * fr * (1 - fr); }
      else if (t < tR) { if (a.stage < 2) { a.stage = 2; bounceCb(0.45); } fr = (t - tB2) / a.Tb2; f2 = U.lerp(0.7, 0.8, fr); y = Y_LIE + 4 * a.h2 * fr * (1 - fr); }
      else if (t < tE) { if (a.stage < 3) { a.stage = 3; bounceCb(0.18); } fr = (t - tR) / a.Tr; f2 = 0.8 + 0.2 * (1 - (1 - fr) * (1 - fr)); y = Y_LIE; }
      else { f2 = 1; y = Y_LIE; potA = null; }
      hz(f2);
      roll = (f2 - 0.5) * a.dist;
      spin = -roll / 0.043;
      lieQuat(a.psi, spin, pot.quaternion);
      pot.position.set(x, y, z);
    }
    plant.placePot = function (floorPos) {
      potA = null;
      if (floorPos) {
        if (pot.parent !== scene) scene.add(pot);
        pot.position.set(floorPos.x, Y_LIE, floorPos.z); lieQuat(0.7, 0.4, pot.quaternion);
      } else {
        root.add(pot); pot.position.set(0, 0, 0); pot.quaternion.identity();
      }
    };

    // ── 設定
    function applyRipe() {
      units.forEach(function (u) {
        var r = u.late ? lateV : U.smooth(u.rd, u.rd + 0.55, ripeV);
        if (r !== u.ripe) { u.ripe = r; setFruitColor(u.mat, r); }
      });
    }
    plant.setGrowth = function (v) { v = U.clamp01(v); if (v === g) return; g = v; A = 0.20 + 0.85 * g; gScale = 0.72 + 0.28 * U.smooth(0, 0.55, g); };
    plant.setThirst = function (v) { thirstT = U.clamp01(v); };
    plant.setFlowers = function (v) { flowersV = U.clamp01(v); };
    plant.setFruit = function (v) {
      v = U.clamp01(v); if (v === fruitV) return;
      if (fruitV <= 0 && v > 0) units.forEach(function (u) { u.fallT = U.smooth(u.fd, u.fd + 0.4, flowersV) > 0.3 ? 0 : 99; });
      if (v <= 0) units.forEach(function (u) { u.fallT = -1; });
      fruitV = v;
    };
    plant.setRipe = function (v) { v = U.clamp01(v); if (v === ripeV) return; ripeV = v; applyRipe(); };
    plant.setLateRipe = function (v) { v = U.clamp01(v); if (v === lateV) return; lateV = v; applyRipe(); };
    plant.setWet = function (v) {
      v = U.clamp01(v); if (v === wetV) return; wetV = v;
      leafMat.roughness = U.lerp(0.62, 0.4, v);
      units.forEach(function (u) { u.mat.roughness = U.lerp(0.32, 0.18, v); u.mat.clearcoatRoughness = U.lerp(0.12, 0.03, v); });
    };
    plant.pull = function (index, worldPoint) {
      var u = units[index]; if (!u) return;
      var tr = u.tr;
      if (!worldPoint || u.pub.picked) { if (tr.held === index) { tr.held = -1; stemOsc.vx += (rnd() - 0.5) * 0.15; stemOsc.vz += (rnd() - 0.5) * 0.15; } return; }
      root.updateWorldMatrix(true, false);
      tr.held = index; tr.target.copy(worldPoint); root.worldToLocal(tr.target);
    };
    plant.pick = function (index) {
      var u = units[index]; if (!u) return;
      u.pub.picked = true; if (u.tr.held === index) u.tr.held = -1;
      u.tr.rvv.multiplyScalar(1.3);
      stemOsc.vx += (rnd() - 0.5) * 0.2; stemOsc.vz += (rnd() - 0.5) * 0.2;
    };
    plant.setPicked = function (index, b) { var u = units[index]; if (u) { u.pub.picked = !!b; if (b && u.tr.held === index) u.tr.held = -1; } };
    plant.resetFruits = function () {
      units.forEach(function (u) { u.pub.picked = false; u.fallT = -1; u.bs = 0; u.bsv = 0; });
      trusses.forEach(function (tr) { tr.held = -1; tr.rv.set(0, 0, 0); tr.rvv.set(0, 0, 0); tr.sv.set(0, 0, 0); tr.svv.set(0, 0, 0); });
      flowersV = 0; fruitV = 0; ripeV = 0; lateV = 0; applyRipe();
    };
    plant.bounceFruits = function () { units.forEach(function (u, i) { u.bsv += 1.6 + 0.4 * Math.sin(i * 2.3); }); };
    var _pk = new V();
    plant.poke = function (worldPos, strength) {
      strength = U.clamp01(strength == null ? 0.6 : strength);
      root.updateWorldMatrix(true, false);
      _pk.copy(worldPos); root.worldToLocal(_pk);
      leaves.forEach(function (lf) {
        if (!lf.vis) return;
        var d = lf.mid.distanceTo(_pk), f = Math.exp(-(d / 0.14) * (d / 0.14));
        if (f < 0.02) return;
        lf.osc.ev += (rnd() < 0.5 ? -1 : 1) * strength * f * (3 + 2 * rnd());
        lf.osc.av += (rnd() - 0.5) * strength * f * 4;
        lf.osc.fl = Math.max(lf.osc.fl, strength * f);
      });
      var dh = _pk.y - A * 0.6, fs = Math.exp(-(dh / 0.35) * (dh / 0.35)), hl = Math.sqrt(_pk.x * _pk.x + _pk.z * _pk.z) + 1e-4;
      stemOsc.vx -= _pk.x / hl * strength * fs * 0.35; stemOsc.vz -= _pk.z / hl * strength * fs * 0.35;
      trusses.forEach(function (tr) {
        var d = Math.abs(_pk.y - tr.H + 0.06); if (d < 0.15) { tr.rvv.x += (rnd() - 0.5) * strength * 1.2; tr.rvv.z += (rnd() - 0.5) * strength * 1.2; }
      });
    };
    plant.shake = function (strength) {
      strength = U.clamp01(strength == null ? 0.7 : strength);
      var a = rnd() * 6.28;
      stemOsc.vx += Math.cos(a) * strength * 0.9; stemOsc.vz += Math.sin(a) * strength * 0.9;
      leaves.forEach(function (lf) { lf.osc.ev += (rnd() - 0.5) * strength * 5; lf.osc.av += (rnd() - 0.5) * strength * 3; lf.osc.fl = Math.max(lf.osc.fl, strength * 0.7); });
      trusses.forEach(function (tr) { tr.rvv.x += (rnd() - 0.5) * strength * 2.5; tr.rvv.z += (rnd() - 0.5) * strength * 2.5; });
    };
    var _wt = new V();
    plant.topY = function () {
      root.updateWorldMatrix(true, false);
      return _wt.set(0, maxY + 0.01, 0).applyMatrix4(root.matrixWorld).y;
    };
    plant.canopy = function () {
      root.updateWorldMatrix(true, false);
      _wt.set(0, 0, 0).applyMatrix4(root.matrixWorld);
      return { x: _wt.x, z: _wt.z, r: Math.max(0.06, maxR * 0.85), y0: _wt.y + 0.03, y1: plant.topY() };
    };

    plant.update = function (dt, time) {
      dt = Math.min(Math.max(dt || 0, 0), 0.05); time = time || 0;
      spring(TH, 'w', 'v', thirstT, 34, 0.42, dt);
      if (TH.w < -0.3) TH.w = -0.3;
      spring(stemOsc, 'x', 'vx', 0, 20, 0.12, dt); spring(stemOsc, 'z', 'vz', 0, 20, 0.12, dt);
      leaves.forEach(function (lf) {
        spring(lf.osc, 'e', 'ev', 0, 70, 0.1, dt); spring(lf.osc, 'a', 'av', 0, 55, 0.1, dt);
        lf.osc.fl *= Math.exp(-2.2 * dt);
      });
      units.forEach(function (u) {
        spring(u, 'bs', 'bsv', 0, 160, 0.14, dt);
        if (u.fallT >= 0 && u.fallT < 50) u.fallT += dt;
      });
      maxY = 0.05; maxR = 0.05;
      computeStem(time);
      for (var i = 0; i < leaves.length; i++) computeLeaf(leaves[i], time);
      for (i = 0; i < trusses.length; i++) computeTruss(trusses[i], time, dt);
      computeDrops();
      tubes.commit(); leafD.commit(); flD.commit();
      updatePot(dt);
      root.updateWorldMatrix(true, false);
      for (i = 0; i < units.length; i++) units[i].pub.pos.copy(units[i].center).applyMatrix4(root.matrixWorld);
    };

    plant.setGrowth(0); g = -1; plant.setGrowth(0);
    plant.update(0, 0);
    return plant;
  }

  G.Plant = { FRUIT_R: R, create: create, makeFruit: makeFruit };
})();
