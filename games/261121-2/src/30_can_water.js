/* 30_can_water.js — じょうろ（亜鉛めっき鋼板）・竹のざる・水（蛇口の水柱、シャワー、しずく、しぶき、あふれ、虹）
   G.Can.create(scene, quality) / G.Zaru.create(scene) / G.Water.create(scene, quality) */
(function () {
  'use strict';
  var G = window.G, U = G.U;
  var PI = Math.PI;
  var GRAV = 9.8;

  /* ════════════════════════════ 共有の小道具 ════════════════════════════ */
  var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  var _q1 = new THREE.Quaternion();
  var UP = new THREE.Vector3(0, 1, 0);

  /* 線分 a→b に沿って +Y 向きのジオメトリを置く */
  function placeAlong(mesh, ax, ay, az, bx, by, bz) {
    _v1.set(bx - ax, by - ay, bz - az);
    var len = _v1.length();
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    mesh.quaternion.setFromUnitVectors(UP, _v1.multiplyScalar(1 / len));
    return len;
  }

  /* ───── 亜鉛のスパングル（色と粗さ）。タイル可能 ───── */
  var zincCache = null;
  function zincTextures(low) {
    if (!zincCache) zincCache = U.prog(function () { return zincTexturesG(low); });
    return zincCache;
  }
  function* zincTexturesG(low) {
    var size = U.qsize(low ? 256 : 512), n = 14, rng = U.rng(731);
    var cells = [];
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      cells.push({ x: (i + 0.15 + rng() * 0.7) / n, y: (j + 0.15 + rng() * 0.7) / n, b: rng(), a: rng() * PI, k: 140 + rng() * 160, r: rng() });
    }
    var cc = U.makeCanvas(size), rc = U.makeCanvas(size);
    var cx = cc.getContext('2d'), rx = rc.getContext('2d');
    var ci = cx.createImageData(size, size), ri = rx.createImageData(size, size);
    var cd = ci.data, rd = ri.data;
    for (var py = 0; py < size; py++, yield) for (var px = 0; px < size; px++) {
      var u = (px + 0.5) / size, v = (py + 0.5) / size;
      var gi = Math.floor(u * n), gj = Math.floor(v * n);
      var d1 = 9, d2 = 9, best = null, bx = 0, by = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var ii = gi + di, jj = gj + dj;
        var wi = ((ii % n) + n) % n, wj = ((jj % n) + n) % n;
        var c = cells[wj * n + wi];
        var qx = c.x + (ii - wi) / n, qy = c.y + (jj - wj) / n;
        var dx = u - qx, dy = v - qy, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = c; bx = dx; by = dy; } else if (d < d2) d2 = d;
      }
      var edge = Math.sqrt(d2) - Math.sqrt(d1);
      var line = 1 - U.smooth(0.0, 0.006, edge);
      var ca = Math.cos(best.a), sa = Math.sin(best.a);
      var along = bx * ca + by * sa, across = -bx * sa + by * ca;
      /* 結晶の羽根もよう：主軸と、斜めの枝 */
      var f1 = 0.5 + 0.5 * Math.sin(along * best.k + Math.sin(across * 90) * 1.2);
      var f2 = 0.5 + 0.5 * Math.sin((along * 0.5 + Math.abs(across) * 0.87) * best.k * 0.8);
      var feather = f1 * 0.6 + f2 * 0.4;
      var mott = U.fbm(u * 6, v * 6, 3, 11, 6);
      var val = 0.73 + (best.b - 0.5) * 0.045 + (feather - 0.5) * 0.04 - line * 0.04 + (mott - 0.5) * 0.08;
      var k = (py * size + px) * 4;
      cd[k] = U.clamp(val * 255 * 0.985, 0, 255); cd[k + 1] = U.clamp(val * 255, 0, 255); cd[k + 2] = U.clamp(val * 255 * 1.02, 0, 255); cd[k + 3] = 255;
      var rough = 0.20 + best.r * 0.38 + (feather - 0.5) * 0.06 + line * 0.15 + (mott - 0.5) * 0.15;
      rd[k] = 0; rd[k + 1] = U.clamp(rough * 255, 0, 255); rd[k + 2] = 0; rd[k + 3] = 255;
    }
    cx.putImageData(ci, 0, 0); rx.putImageData(ri, 0, 0);
    return { map: cc, rough: rc };
  }

  /* ════════════════════════════ じょうろ ════════════════════════════ */
  var CAN_R = 0.11, CAN_H = 0.22;
  var ROSE_C = new THREE.Vector3(0.360, 0.270, 0);       // はす口の中心（局所）
  var ROSE_ELEV = 0.54, ROSE_YAW = 0.14;                   // はす口の向き（上向き / 奥向きの角度 rad）
  var ROSE_D = new THREE.Vector3(Math.cos(ROSE_ELEV) * Math.cos(ROSE_YAW), Math.sin(ROSE_ELEV), -Math.cos(ROSE_ELEV) * Math.sin(ROSE_YAW));
  var GRIP = new THREE.Vector3(0.050, 0.322, 0);          // 上の取っ手の中心（傾きの支点）
  var OPEN_C = new THREE.Vector3(-0.052, CAN_H, 0);       // 上の口の中心
  var LID_X = -0.008;                                      // ふたの切り口（x > LID_X がふた）

  function createCan(scene, quality) {
    quality = quality || {};
    var low = !!quality.low;
    var seg = low ? 28 : 48;
    var zt = zincTextures(low);
    var map = U.tex(zt.map, { srgb: true, repeat: [4, 1.3] });
    var rmap = U.tex(zt.rough, { repeat: [4, 1.3] });
    var zinc = new THREE.MeshStandardMaterial({ color: 0xffffff, map: map, roughnessMap: rmap, roughness: 1.0, metalness: 0.88, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 1.0 });
    var zincPlain = new THREE.MeshStandardMaterial({ color: 0xc3c6c6, map: map, roughnessMap: rmap, roughness: 1.0, metalness: 0.88, envMapIntensity: 1.0 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xb98d48, roughness: 0.38, metalness: 1.0 });

    var group = new THREE.Group(); group.name = 'can';
    var tiltG = new THREE.Group(); tiltG.position.copy(GRIP); group.add(tiltG);
    var body = new THREE.Group(); body.position.set(-GRIP.x, -GRIP.y, -GRIP.z); tiltG.add(body);
    var shadowList = [];
    function add(mesh, parent, cast) { (parent || body).add(mesh); mesh.receiveShadow = true; if (cast !== false && quality.shadows !== false) { mesh.castShadow = true; } shadowList.push(mesh); return mesh; }

    /* ── 胴（巻き縁・ビード入りの旋盤形） ── */
    var prof = [
      [0.1000, 0.0000], [0.1080, 0.0010], [0.1135, 0.0045], [0.1148, 0.0095], [0.1125, 0.0140], [0.1100, 0.0170],
      [0.1100, 0.0560], [0.1112, 0.0600], [0.1116, 0.0640], [0.1106, 0.0680], [0.1100, 0.0710],
      [0.1100, 0.1500], [0.1112, 0.1540], [0.1116, 0.1580], [0.1106, 0.1620], [0.1100, 0.1650],
      [0.1100, 0.2050], [0.1118, 0.2100], [0.1142, 0.2155], [0.1138, 0.2210], [0.1105, 0.2245], [0.1070, 0.2225], [0.1062, 0.2160]
    ];
    var pts = prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var bodyGeo = new THREE.LatheGeometry(pts, seg);
    (function () {
      var pos = bodyGeo.attributes.position, uv = bodyGeo.attributes.uv, n = pos.count;
      var col = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        var a = Math.atan2(z, x);
        uv.setXY(i, uv.getX(i), y / 0.23);
        /* 底のほうのくすみ、水あとの筋 */
        var dull = 0.80 + 0.20 * U.smooth(0.0, 0.07, y);
        var streak = 1 - 0.07 * U.noise2(a * 9, y * 14, 5) * (1 - U.smooth(0.05, 0.2, y));
        var c = dull * streak;
        col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * 1.01;
      }
      bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    })();
    add(new THREE.Mesh(bodyGeo, zinc));
    /* 底 */
    var bottom = new THREE.Mesh(new THREE.CircleGeometry(0.106, seg), zincPlain);
    bottom.rotation.x = -PI / 2; bottom.position.y = 0.004; add(bottom, body, false);
    var bottom2 = new THREE.Mesh(bottom.geometry, zincPlain); bottom2.rotation.x = PI / 2; bottom2.position.y = 0.003; add(bottom2, body, false);
    /* 胴のはんだ継ぎ目（たての筋） */
    var seam = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.19, 0.010), zincPlain);
    seam.position.set(0, 0.112, 0); seam.rotation.y = -PI * 0.5; seam.position.set(Math.cos(2.3) * 0.1110, 0.112, -Math.sin(2.3) * 0.1110); seam.rotation.y = 2.3;
    add(seam, body, false);

    /* ── ふた（前半分）と切り口の巻き ── */
    var lidShape = new THREE.Shape();
    var lr = 0.1075, la = Math.acos(LID_X / lr);
    lidShape.moveTo(LID_X, -Math.sqrt(lr * lr - LID_X * LID_X));
    lidShape.absarc(0, 0, lr, -la, la, false);
    lidShape.lineTo(LID_X, -Math.sqrt(lr * lr - LID_X * LID_X));
    var lidGeo = new THREE.ShapeGeometry(lidShape, low ? 12 : 24);
    (function () { var uv = lidGeo.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.0, uv.getY(i) * 2.0); })();
    lidGeo.rotateX(-PI / 2);
    /* わずかに盛り上がったふた */
    (function () { var p = lidGeo.attributes.position; for (var i = 0; i < p.count; i++) { var x = p.getX(i), z = p.getZ(i); var r = Math.sqrt(x * x + z * z); p.setY(i, 0.006 * (1 - (r / lr) * (r / lr)) * U.smooth(LID_X, LID_X + 0.03, x)); } lidGeo.computeVertexNormals(); })();
    var lid = new THREE.Mesh(lidGeo, zincPlain); lid.material = zincPlain; lid.position.y = 0.2205;
    var lidMat2 = zincPlain.clone(); lidMat2.side = THREE.DoubleSide; lid.material = lidMat2;
    add(lid);
    var chordLen = 2 * Math.sqrt(lr * lr - LID_X * LID_X);
    var lip = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, chordLen, 8), zincPlain);
    lip.rotation.x = PI / 2; lip.position.set(LID_X, 0.2215, 0); add(lip);

    /* ── 注ぎ口（先細りの管）・桟・はす口 ── */
    var rootX = 0.085, rootY = 0.040;
    var tip = ROSE_C.clone().addScaledVector(ROSE_D, -0.030);
    var spoutLen = Math.sqrt((tip.x - rootX) * (tip.x - rootX) + (tip.y - rootY) * (tip.y - rootY) + tip.z * tip.z);
    var spout = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0215, spoutLen, low ? 12 : 18, 1, true), zinc);
    (function () { var g = spout.geometry, n = g.attributes.position.count, c = new Float32Array(n * 3); for (var i = 0; i < c.length; i++) c[i] = 0.95; g.setAttribute('color', new THREE.BufferAttribute(c, 3)); })();
    placeAlong(spout, rootX, rootY, 0, tip.x, tip.y, tip.z); add(spout);
    /* 胴との付け根の当て板 */
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 18), zincPlain);
    placeAlong(collar, 0.104, 0.054, 0, 0.112, 0.061, 0); add(collar, body, false);
    /* 補強の桟（平たい帯） */
    var sx = U.lerp(rootX, tip.x, 0.56), sy = U.lerp(rootY, tip.y, 0.56) + 0.012;
    var stay = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 1, 0.010), zincPlain);
    var stayLen = placeAlong(stay, 0.108, 0.172, 0, sx, sy, 0); stay.scale.y = stayLen; add(stay);
    /* 管の先の真ちゅうの継ぎ輪 */
    var ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 14), brass);
    var tp = tip.clone().addScaledVector(ROSE_D, -0.004);
    placeAlong(ferrule, tp.x - ROSE_D.x * 0.006, tp.y - ROSE_D.y * 0.006, tp.z - ROSE_D.z * 0.006, tp.x + ROSE_D.x * 0.006, tp.y + ROSE_D.y * 0.006, tp.z + ROSE_D.z * 0.006); add(ferrule);
    /* はす口（じょうご形＋穴のある面） */
    var roseG = new THREE.Group(); roseG.position.copy(ROSE_C); roseG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ROSE_D); body.add(roseG);
    var cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0315, 0.0100, 0.030, low ? 16 : 24, 1, true), brass);
    cone.rotation.x = PI / 2; cone.position.z = -0.015; add(cone, roseG);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.0312, 0.0022, 6, low ? 16 : 28), brass); add(rim, roseG);
    var faceTex = (function () {
      var s = 128, c = U.makeCanvas(s), x = c.getContext('2d');
      x.fillStyle = '#c9a564'; x.fillRect(0, 0, s, s);
      var gr = x.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,240,200,0.20)'); gr.addColorStop(1, 'rgba(60,40,10,0.25)');
      x.fillStyle = gr; x.fillRect(0, 0, s, s);
      var holes = roseHoles();
      for (var i = 0; i < holes.length; i++) {
        var hx = s / 2 + holes[i][0] / 0.0315 * s / 2, hy = s / 2 - holes[i][1] / 0.0315 * s / 2;
        x.fillStyle = '#2a1e10'; x.beginPath(); x.arc(hx, hy, 2.0, 0, PI * 2); x.fill();
        x.fillStyle = 'rgba(255,235,180,0.5)'; x.beginPath(); x.arc(hx + 0.8, hy + 0.8, 1.0, 0, PI * 2); x.fill();
      }
      return U.tex(c, { srgb: true });
    })();
    var faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: faceTex, roughness: 0.42, metalness: 1.0 });
    var faceGeo = new THREE.CircleGeometry(0.0312, low ? 16 : 28);
    (function () { var p = faceGeo.attributes.position; for (var i = 0; i < p.count; i++) { var r = Math.sqrt(p.getX(i) * p.getX(i) + p.getY(i) * p.getY(i)); p.setZ(i, 0.004 * (1 - (r / 0.0312) * (r / 0.0312))); } faceGeo.computeVertexNormals(); })();
    var face = new THREE.Mesh(faceGeo, faceMat); add(face, roseG, false);

    /* ── 取っ手 ── */
    function strap(points, radius, flat, mat) {
      var curve = new THREE.CatmullRomCurve3(points.map(function (p) { return new THREE.Vector3(p[0], p[1], 0); }));
      var m = new THREE.Mesh(new THREE.TubeGeometry(curve, low ? 16 : 28, radius, low ? 6 : 8, false), mat || zincPlain);
      m.scale.z = flat; return m;
    }
    /* 背の取っ手（-X 側） */
    add(strap([[-0.104, 0.040], [-0.135, 0.050], [-0.160, 0.085], [-0.166, 0.130], [-0.158, 0.180], [-0.130, 0.212], [-0.104, 0.214]], 0.0058, 1.9));
    /* 上の弓形の取っ手（前のふたの上） */
    var topH = strap([[-0.004, 0.221], [-0.002, 0.262], [0.012, 0.302], [0.035, 0.322], [0.065, 0.322], [0.088, 0.300], [0.100, 0.262], [0.104, 0.224]], 0.0060, 1.9);
    add(topH);
    /* 取り付けの当て金と鋲 */
    var rivetGeo = new THREE.SphereGeometry(0.0035, 8, 6);
    [[-0.111, 0.040, 0, 1], [-0.111, 0.214, 0, 1], [-0.004, 0.2235, 0, 0], [0.104, 0.2235, 0, 0]].forEach(function (p) {
      var pl = new THREE.Mesh(new THREE.BoxGeometry(p[3] ? 0.003 : 0.016, p[3] ? 0.020 : 0.003, 0.016), zincPlain);
      pl.position.set(p[0], p[1], 0); add(pl, body, false);
      var rv = new THREE.Mesh(rivetGeo, zincPlain); rv.position.set(p[0] + (p[3] ? -0.002 : 0), p[1] + (p[3] ? 0 : 0.0015), 0); rv.scale.set(p[3] ? 0.5 : 1, p[3] ? 1 : 0.5, 1); add(rv, body, false);
    });

    /* ── 中の水面（水平を保ち、胴の内側だけに描く） ── */
    var rip = (function () {
      var s = low ? 128 : 256;
      var n = U.prog(function* () {
        var h = yield* U.pixelCanvasG(s, function (u, v, o) {
          var g = U.fbm(u * 6, v * 6, 4, 41, 6) * 255; o[0] = o[1] = o[2] = g;
        });
        return { normal: yield* U.heightToNormalG(h, 1.6) };
      }).normal;
      var t = U.tex(n, { repeat: [1, 1] }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    var waterMat = new THREE.MeshStandardMaterial({ color: 0x3e4648, roughness: 0.03, metalness: 0.0, normalMap: rip, envMapIntensity: 1.2 });
    waterMat.normalScale.set(0.55, 0.55); rip.repeat.set(2.5, 2.5);
    var invBody = new THREE.Matrix4();
    waterMat.onBeforeCompile = function (sh) {
      sh.uniforms.uInv = { value: invBody };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpC;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWpC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWpC;\nuniform mat4 uInv;')
        .replace('void main() {', 'void main() {\n vec3 lpC = (uInv * vec4(vWpC, 1.0)).xyz;\n if (lpC.y > 0.2155 || lpC.y < 0.0045 || dot(lpC.xz, lpC.xz) > 0.01085) discard;');
    };
    var surf = new THREE.Mesh(new THREE.CircleGeometry(0.19, low ? 24 : 40), waterMat);
    surf.rotation.x = -PI / 2; surf.visible = false; group.add(surf);
    surf.onBeforeRender = function () { invBody.copy(body.matrixWorld).invert(); };

    var st = { fill: 0, tilt: 0, slosh: 0, sl: 0, slv: 0 };
    function placeSurface() {
      var h = 0.006 + st.fill * 0.200;
      var vis = st.fill > 0.005;
      surf.visible = vis;
      if (!vis) return;
      /* 胴の軸上の高さ h の点を、傾きの支点まわりに回して置く */
      var dx = -GRIP.x, dy = h - GRIP.y, c = Math.cos(-st.tilt), s = Math.sin(-st.tilt);
      surf.position.set(GRIP.x + dx * c - dy * s, GRIP.y + dx * s + dy * c, 0);
      surf.rotation.set(-PI / 2, st.sl * 0.10, 0);
      var tt = performance.now() * 0.001; rip.offset.set((tt * 0.031) % 1, (tt * 0.017) % 1);
    }

    scene.add(group);
    var can = {
      group: group, R: CAN_R, H: CAN_H,
      body: body, tiltGroup: tiltG,
      setFill: function (f) { st.fill = U.clamp01(f); placeSurface(); },
      setTilt: function (rad) { st.tilt = U.clamp(rad, -0.3, 1.25); tiltG.rotation.z = -st.tilt; placeSurface(); },
      setSlosh: function (a) { st.slosh = U.clamp(a, -1, 1); st.sl = st.slosh; placeSurface(); },
      rosePos: function (out) { group.updateMatrixWorld(true); return body.localToWorld((out || new THREE.Vector3()).copy(ROSE_C).addScaledVector(ROSE_D, 0.004)); },
      roseDir: function (out) { group.updateMatrixWorld(true); out = out || new THREE.Vector3(); out.copy(ROSE_D).transformDirection(body.matrixWorld); return out; },
      openingPos: function (out) { group.updateMatrixWorld(true); return body.localToWorld((out || new THREE.Vector3()).copy(OPEN_C)); },
      gripPos: function (out) { group.updateMatrixWorld(true); return body.localToWorld((out || new THREE.Vector3()).copy(GRIP)); },
      /* 中の水面の世界の高さ（蛇口の水の toY に使える）。水がなければ底の高さ */
      waterY: function () { group.updateMatrixWorld(true); _v3.set(0, 0.006 + st.fill * 0.2, 0); body.localToWorld(_v3); return _v3.y; },
      setShadows: function (on) { for (var i = 0; i < shadowList.length; i++) shadowList[i].castShadow = !!on; }
    };
    return can;
  }

  /* はす口の穴（面の局所 xy、メートル）。六角に並べる */
  var holesCache = null;
  function roseHoles() {
    if (holesCache) return holesCache;
    var h = [], d = 0.0050;
    for (var j = -6; j <= 6; j++) for (var i = -6; i <= 6; i++) {
      var x = (i + (j & 1) * 0.5) * d, y = j * d * 0.866;
      if (x * x + y * y < 0.0245 * 0.0245) h.push([x, y]);
    }
    holesCache = h; return h;
  }

  G.Can = { create: createCan };

  /* ════════════════════════════ 竹のざる ════════════════════════════ */
  var ZR = 0.15, ZD = 0.05, ZFLAT = 0.055;
  function zaruY(r) { /* 内側の面の高さ */
    var t = U.clamp01((r - ZFLAT) / (ZR - ZFLAT));
    return 0.006 + (ZD - 0.006) * Math.pow(t, 1.6);
  }
  var weaveCache = null;
  function weaveCanvas() {
    if (!weaveCache) weaveCache = U.prog(weaveCanvasG);
    return weaveCache;
  }
  function* weaveCanvasG() {
    var s = U.qsize(512), n = 16, rng = U.rng(91), shades = [];
    for (var i = 0; i < n * 2; i++) shades.push(0.88 + rng() * 0.24);
    var col = U.makeCanvas(s), hgt = U.makeCanvas(s);
    var cx = col.getContext('2d'), hx = hgt.getContext('2d');
    var ci = cx.createImageData(s, s), hi = hx.createImageData(s, s);
    hgt._q = 512 / s;
    for (var py = 0; py < s; py++, yield) for (var px = 0; px < s; px++) {
      var u = (px + 0.5) / s * n, v = (py + 0.5) / s * n;
      var i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      var inV = fu > 0.07 && fu < 0.93, inH = fv > 0.09 && fv < 0.91;   /* V: v 方向にのびる帯（列 i）、H: u 方向（行 j） */
      var hOnTop = ((i + j) & 1) === 0;
      var top = -1; /* 0=H, 1=V */
      if (inV && inH) top = hOnTop ? 0 : 1; else if (inH) top = 0; else if (inV) top = 1;
      var k = (py * s + px) * 4;
      if (top < 0) { ci.data[k + 3] = 0; hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = 0; hi.data[k + 3] = 255; continue; }
      var across = top === 0 ? fv : fu, alongC = top === 0 ? u : v, id = top === 0 ? j : n + i;
      var w = (across - 0.08) / 0.84; var crown = Math.sin(U.clamp01(w) * PI);
      /* 上に出ている帯は中ほどが高く、下にくぐる所は低い */
      var phase = top === 0 ? fu : fv;
      var over = (top === 0 ? hOnTop : !hOnTop) ? 1 : 0;
      var bend = 0.55 + 0.45 * Math.cos((phase - 0.5) * PI * (over ? 1 : 0.0));
      var fib = U.noise2(alongC * 3, across * 40 + id * 7, 3);
      var node = Math.exp(-Math.pow(((alongC * 0.37 + id * 0.61) % 3) - 1.5, 2) * 60);
      var sh = shades[id] * (0.86 + 0.14 * crown) * (0.92 + 0.08 * fib) * (1 - 0.18 * node) * (top === (over ? 0 : 1) ? 1 : 0.9);
      ci.data[k] = U.clamp(206 * sh, 0, 255); ci.data[k + 1] = U.clamp(170 * sh, 0, 255); ci.data[k + 2] = U.clamp(112 * sh, 0, 255); ci.data[k + 3] = 255;
      var hv = (0.35 + 0.45 * crown * bend + 0.1 * fib) * 255;
      hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = hv; hi.data[k + 3] = 255;
    }
    cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0);
    return { col: col, nrm: yield* U.heightToNormalG(hgt, 2.5) };
  }

  function createZaru(scene) {
    var wc = weaveCanvas();
    var mapL = U.tex(wc.col, { srgb: true, repeat: [11, 2] }), nrmL = U.tex(wc.nrm, { repeat: [11, 2] });
    var mapC = U.tex(wc.col, { srgb: true, repeat: [1.5, 1.5] }), nrmC = U.tex(wc.nrm, { repeat: [1.5, 1.5] });
    var base = new THREE.Color(0xffffff), wetCol = new THREE.Color(0xb8a68a);
    function mat(m, nm) { return new THREE.MeshStandardMaterial({ color: 0xffffff, map: m, normalMap: nm, roughness: 0.72, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 }); }
    var mL = mat(mapL, nrmL), mC = mat(mapC, nrmC);
    mL.normalScale.set(0.8, 0.8); mC.normalScale.set(0.8, 0.8);
    var group = new THREE.Group(); group.name = 'zaru';
    var pts = [], N = 22, thick = 0.0;
    for (var i = 0; i <= N; i++) { var r = U.lerp(ZFLAT - 0.012, ZR, i / N); pts.push(new THREE.Vector2(r, zaruY(r) - 0.003)); }
    var bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), mL); bowl.castShadow = true; bowl.receiveShadow = true; group.add(bowl);
    var disc = new THREE.Mesh(new THREE.CircleGeometry(ZFLAT - 0.008, 32), mC); disc.rotation.x = -PI / 2; disc.position.y = 0.0032; disc.castShadow = true; disc.receiveShadow = true; group.add(disc);
    /* 縁の巻き（籐を斜めに巻いた太い輪） */
    var rimTex = (function () {
      var s = 256;
      var c = U.pixelCanvas(s, function (u, v, o) {   /* 細いすじは間引くと縞がにじむので、そのまま作る */
        var t = (u * 120 + v) % 1, b = Math.sin(t * PI);
        var f = U.noise2(u * 400, v * 8, 9);
        var sh = 0.62 + 0.38 * Math.pow(b, 0.5) * (0.9 + 0.1 * f);
        o[0] = 196 * sh; o[1] = 158 * sh; o[2] = 98 * sh;
      });
      return U.tex(c, { srgb: true });
    })();
    var rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: rimTex, roughness: 0.6, metalness: 0 });
    var rim = new THREE.Mesh(new THREE.TorusGeometry(ZR + 0.001, 0.0065, 10, 96), rimMat);
    rim.rotation.x = PI / 2; rim.position.y = ZD - 0.002; rim.castShadow = true; rim.receiveShadow = true; group.add(rim);
    var rim2 = new THREE.Mesh(new THREE.TorusGeometry(ZR - 0.010, 0.0035, 8, 96), rimMat);
    rim2.rotation.x = PI / 2; rim2.position.y = zaruY(ZR - 0.010) + 0.001; rim2.receiveShadow = true; group.add(rim2);
    /* 底の当て竹（下の輪） */
    var foot = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.004, 8, 64), rimMat);
    foot.rotation.x = PI / 2; foot.position.y = 0.0; foot.castShadow = true; group.add(foot);

    /* トマト7個の置き場所（転がったように少し不ぞろい） */
    var TR = 0.026, slots = [];
    function restY(r) {
      var y = 0;
      for (var k = -10; k <= 10; k++) {
        var rp = r + k * TR / 10; if (rp < 0) rp = -rp;
        var dx = k * TR / 10, h = zaruY(rp) + Math.sqrt(Math.max(0, TR * TR - dx * dx));
        if (h > y) y = h;
      }
      return y + 0.001;
    }
    var ring = [[0.060, 0.15], [0.062, 1.20], [0.058, 2.18], [0.063, 3.20], [0.060, 4.22], [0.061, 5.26]];
    slots.push(new THREE.Vector3(0.006, restY(0.007), -0.004));
    for (var q = 0; q < ring.length; q++) {
      var rr = ring[q][0], aa = ring[q][1];
      slots.push(new THREE.Vector3(Math.cos(aa) * rr, restY(rr), Math.sin(aa) * rr));
    }
    scene.add(group);
    var zaru = {
      group: group, slots: slots, R: ZR,
      setWet: function (w) {
        w = U.clamp01(w);
        var r = U.lerp(0.72, 0.26, w);
        mL.roughness = mC.roughness = r; rimMat.roughness = U.lerp(0.6, 0.24, w);
        mL.color.copy(base).lerp(wetCol, w); mC.color.copy(mL.color); rimMat.color.copy(mL.color);
      }
    };
    return zaru;
  }
  G.Zaru = { create: createZaru };

  /* ════════════════════════════ 水 ════════════════════════════ */
  var CHUNK_TONE = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

  /* ── 細い光の筋（粒） ── */
  var STREAK_VS = [
    'attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iPar;',
    'uniform vec2 uRes; uniform vec3 uSun; uniform float uTime; uniform float uLight;',
    'varying float vA; varying float vW; varying float vS; varying vec3 vCol;',
    'void main(){',
    '  vec3 head = iPos; vec3 tail = iPos - iVel * iPar.w;',
    '  vec4 hv = viewMatrix * vec4(head, 1.0); vec4 tv = viewMatrix * vec4(tail, 1.0);',
    '  vec4 hc = projectionMatrix * hv; vec4 tc = projectionMatrix * tv;',
    '  vec2 hs = hc.xy / hc.w * uRes * 0.5; vec2 ts = tc.xy / tc.w * uRes * 0.5;',
    '  vec2 d = hs - ts; float L = length(d); vec2 dir = L > 0.001 ? d / L : vec2(0.0, 1.0);',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  float wPix = iPar.x * projectionMatrix[1][1] * uRes.y * 0.5 / max(-hv.z, 0.01);',
    '  float wDraw = max(wPix, 0.75);',
    '  float a = iPar.y * min(1.0, wPix / 0.75 * 0.6 + 0.4);',
    '  vec4 base = mix(tc, hc, position.x);',
    '  vec2 off = nrm * position.y * wDraw + dir * (position.x * 2.0 - 1.0) * wDraw;',
    '  base.xy += off * 2.0 / uRes * base.w;',
    '  gl_Position = base;',
    '  vec3 A = normalize(iVel + vec3(0.0, 1e-4, 0.0));',
    '  vec3 V = normalize(cameraPosition - head);',
    '  vec3 Hh = normalize(uSun + V);',
    '  float glint = pow(1.0 - abs(dot(A, Hh)), 10.0);',
    '  float flick = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(iPar.z * 40.0 + uTime * 23.0 + head.y * 60.0), 3.0);',
    '  float back = pow(max(dot(-V, uSun), 0.0), 5.0);',
    '  float g = glint * flick * 1.6 + back * 0.8;',
    '  vCol = uLight * (vec3(0.80, 0.88, 0.96) * 0.85 + vec3(1.0, 0.97, 0.90) * g * 2.6);',
    '  vA = a * (0.50 + 0.45 * min(g, 1.0));',
    '  vW = position.y; vS = position.x;',
    '}'].join('\n');
  var STREAK_FS = [
    'uniform float uLight;',
    'varying float vA; varying float vW; varying float vS; varying vec3 vCol;',
    'void main(){',
    '  float e = 1.0 - vW * vW;',
    '  float a = vA * mix(0.55, 1.0, e) * smoothstep(0.0, 0.35, e) * mix(0.25, 1.0, vS);',
    '  vec3 edge = uLight * vec3(0.12, 0.16, 0.20);',
    '  gl_FragColor = vec4(mix(edge, vCol, smoothstep(0.25, 0.85, e)), a);',
    CHUNK_TONE,
    '}'].join('\n');

  /* ── 蛇口の水柱 ── */
  var STREAM_VS = [
    'uniform float uTopD, uBotD, uR, uV0, uTime;',
    'varying vec3 vN; varying vec3 vWp; varying float vD; varying float vT;',
    'void main(){',
    '  float t = -position.y;',
    '  float d = mix(uTopD, uBotD, t);',
    '  float v = sqrt(uV0 * uV0 + 19.6 * d);',
    '  float r = uR * sqrt(uV0 / v);',
    '  float grow = min(d * 5.0, 1.0);',
    '  r *= 1.0 + 0.10 * grow * sin(d * 70.0 - uTime * 38.0) + 0.05 * grow * sin(d * 151.0 - uTime * 61.0);',
    '  vec3 p = vec3(position.x * r, -d, position.z * r);',
    '  p.x += grow * 0.0010 * sin(uTime * 13.0 + d * 31.0);',
    '  p.z += grow * 0.0008 * cos(uTime * 11.0 + d * 27.0);',
    '  vN = normalize(mat3(modelMatrix) * vec3(position.x, 0.0, position.z));',
    '  vec4 wp = modelMatrix * vec4(p, 1.0); vWp = wp.xyz; vD = d; vT = t;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'].join('\n');
  var STREAM_FS = [
    'uniform vec3 uSun; uniform float uLight; uniform float uTime; uniform float uAlpha;',
    'varying vec3 vN; varying vec3 vWp; varying float vD; varying float vT;',
    'void main(){',
    '  vec3 V = normalize(cameraPosition - vWp); vec3 N = normalize(vN);',
    '  float ndv = abs(dot(N, V)); float fres = pow(1.0 - ndv, 2.5);',
    '  vec3 R = reflect(-V, N);',
    '  vec3 sky = mix(vec3(0.40, 0.38, 0.35), vec3(0.78, 0.88, 1.0), smoothstep(-0.2, 0.5, R.y));',
    '  float spec = pow(max(dot(R, uSun), 0.0), 40.0) * 5.0;',
    '  float lens = smoothstep(0.55, 0.98, ndv) * 0.30;',
    '  float ripple = 0.5 + 0.5 * sin(vD * 140.0 - uTime * 50.0 + N.x * 3.0);',
    '  float white = smoothstep(0.15, 0.6, vD) * 0.10 * ripple;',
    '  vec3 col = uLight * (sky * (0.30 + 0.9 * fres) + vec3(spec) + vec3(lens + white) * vec3(0.95, 0.98, 1.0));',
    '  float a = clamp(0.26 + 0.70 * fres + spec * 0.4 + lens + white, 0.0, 0.92) * uAlpha;',
    '  gl_FragColor = vec4(col, a);',
    CHUNK_TONE,
    '}'].join('\n');

  /* ── 輪（波紋）・泡・虹 ── */
  var QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var RING_FS = [
    'uniform float uA; uniform float uLight; uniform float uP;',
    'varying vec2 vUv;',
    'void main(){',
    '  float r = length(vUv - 0.5) * 2.0;',
    '  float w = mix(0.10, 0.05, uP);',
    '  float ring = exp(-pow((r - 0.82) / w, 2.0));',
    '  float inner = exp(-pow((r - 0.62) / (w * 1.4), 2.0)) * 0.45 * (1.0 - uP);',
    '  float a = (ring + inner) * uA;',
    '  gl_FragColor = vec4(uLight * vec3(0.85, 0.92, 1.0) * 1.1, a * 0.55);',
    CHUNK_TONE,
    '}'].join('\n');
  var FOAM_FS = [
    'uniform float uA; uniform float uLight; uniform float uTime;',
    'varying vec2 vUv;',
    'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'void main(){',
    '  vec2 p = vUv - 0.5; float r = length(p) * 2.0;',
    '  if (r > 1.0) discard;',
    '  float a = 0.0;',
    '  for (int k = 0; k < 2; k++) {',
    '    float sc = k == 0 ? 14.0 : 26.0;',
    '    vec2 q = p * sc + vec2(0.0, uTime * (k == 0 ? 0.6 : -0.9));',
    '    vec2 c = floor(q); vec2 f = fract(q) - 0.5;',
    '    float rr = 0.18 + 0.22 * h(c + float(k) * 7.0);',
    '    float life = fract(h(c * 1.7) + uTime * (0.8 + h(c) * 1.2));',
    '    float ring = smoothstep(rr, rr - 0.08, length(f)) - smoothstep(rr - 0.10, rr - 0.20, length(f)) * 0.7;',
    '    a += ring * step(0.35, h(c + 3.1)) * (1.0 - life);',
    '  }',
    '  float fall = 1.0 - smoothstep(0.25, 1.0, r);',
    '  a = clamp(a * fall + exp(-r * r * 30.0) * 0.5, 0.0, 1.0) * uA;',
    '  gl_FragColor = vec4(uLight * vec3(0.93, 0.96, 1.0), a * 0.75);',
    CHUNK_TONE,
    '}'].join('\n');
  var BOW_FS = [
    'uniform float uA; uniform float uLight;',
    'varying vec2 vUv;',
    'vec3 spec(float x){',
    '  vec3 c = vec3(0.0);',
    '  c.r = smoothstep(0.45, 0.85, x) * (1.0 - smoothstep(0.95, 1.0, x)) + smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.12, 0.30, x)) * 0.35;',
    '  c.g = smoothstep(0.20, 0.45, x) * (1.0 - smoothstep(0.55, 0.80, x));',
    '  c.b = smoothstep(0.0, 0.10, x) * (1.0 - smoothstep(0.30, 0.50, x));',
    '  return c;',
    '}',
    'void main(){',
    '  vec2 p = (vUv - vec2(0.5, 0.0)) * vec2(2.0, 2.0);',
    '  float r = length(p);',
    '  float x = (r - 0.80) / 0.16;',
    '  if (x < 0.0 || x > 1.0) discard;',
    '  float band = pow(sin(x * 3.14159), 1.5);',
    '  float ang = atan(p.y, p.x);',
    '  float ends = smoothstep(0.35, 0.95, ang) * (1.0 - smoothstep(1.75, 2.55, ang));',
    '  float mist = 0.55 + 0.45 * sin(p.x * 11.0 + p.y * 7.0) * sin(p.x * 5.0 - p.y * 13.0);',
    '  vec3 c = spec(1.0 - x) * band * ends * mist * uA * uLight * 0.22;',
    '  gl_FragColor = vec4(c, 1.0);',
    CHUNK_TONE,
    '}'].join('\n');

  /* 粒の種類 */
  var T_SHOWER = 0, T_SPLASH = 1, T_OVER = 2, T_DRIP = 3;

  function createWater(scene, quality) {
    quality = quality || {};
    var low = !!quality.low;
    var CAP = Math.max(60, Math.floor((quality.particles || 500) * (low ? 0.5 : 1)));
    var light = 1;
    var sun = new THREE.Vector3(-0.5, 0.6, 0.6).normalize();
    var resV = new THREE.Vector2(390, 844);

    /* ── 粒のプール（生きている粒は 0..alive-1 に詰める） ── */
    var quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    var P = new Float32Array(CAP * 3), Vv = new Float32Array(CAP * 3), PAR = new Float32Array(CAP * 4);
    var aP = new THREE.InstancedBufferAttribute(P, 3), aV = new THREE.InstancedBufferAttribute(Vv, 3), aPar = new THREE.InstancedBufferAttribute(PAR, 4);
    aP.setUsage(THREE.DynamicDrawUsage); aV.setUsage(THREE.DynamicDrawUsage); aPar.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('iPos', aP); quad.setAttribute('iVel', aV); quad.setAttribute('iPar', aPar);
    quad.instanceCount = 0;
    var LIFE = new Float32Array(CAP), MAXL = new Float32Array(CAP), KILLY = new Float32Array(CAP), TYPE = new Uint8Array(CAP), MASK = new Uint32Array(CAP), A0 = new Float32Array(CAP);
    var alive = 0;
    var streakU = { uRes: { value: resV }, uSun: { value: sun }, uTime: { value: 0 }, uLight: { value: 1 } };
    var streakMat = new THREE.ShaderMaterial({ uniforms: streakU, vertexShader: STREAK_VS, fragmentShader: STREAK_FS, transparent: true, depthWrite: false });
    var streaks = new THREE.Mesh(quad, streakMat);
    streaks.frustumCulled = false; streaks.renderOrder = 5;
    streaks.onBeforeRender = function (renderer) { renderer.getDrawingBufferSize(resV); };
    scene.add(streaks);

    function spawn(type, x, y, z, vx, vy, vz, life, killY, width, alpha, stretch) {
      if (alive >= CAP) return -1;
      var i = alive++;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      Vv[i * 3] = vx; Vv[i * 3 + 1] = vy; Vv[i * 3 + 2] = vz;
      PAR[i * 4] = width; PAR[i * 4 + 1] = alpha; PAR[i * 4 + 2] = Math.random(); PAR[i * 4 + 3] = stretch;
      LIFE[i] = 0; MAXL[i] = life; KILLY[i] = killY; TYPE[i] = type; MASK[i] = 0; A0[i] = alpha;
      return i;
    }
    function kill(i) {
      var j = --alive;
      if (i !== j) {
        P[i * 3] = P[j * 3]; P[i * 3 + 1] = P[j * 3 + 1]; P[i * 3 + 2] = P[j * 3 + 2];
        Vv[i * 3] = Vv[j * 3]; Vv[i * 3 + 1] = Vv[j * 3 + 1]; Vv[i * 3 + 2] = Vv[j * 3 + 2];
        PAR[i * 4] = PAR[j * 4]; PAR[i * 4 + 1] = PAR[j * 4 + 1]; PAR[i * 4 + 2] = PAR[j * 4 + 2]; PAR[i * 4 + 3] = PAR[j * 4 + 3];
        LIFE[i] = LIFE[j]; MAXL[i] = MAXL[j]; KILLY[i] = KILLY[j]; TYPE[i] = TYPE[j]; MASK[i] = MASK[j]; A0[i] = A0[j];
      }
    }
    function droplets(x, y, z, n, speed, killY, spread) {
      for (var k = 0; k < n; k++) {
        var a = Math.random() * PI * 2, up = 0.35 + Math.random() * 0.65;
        var s = speed * (0.4 + Math.random() * 0.8), hs = s * (spread || 0.6) * Math.sqrt(1 - up * up * 0.5);
        spawn(T_SPLASH, x, y + 0.002, z, Math.cos(a) * hs, s * up, Math.sin(a) * hs, 0.2 + Math.random() * 0.35, killY, 0.0007 + Math.random() * 0.0006, 0.75, 0.022);
      }
    }

    /* ── 波紋の輪 ── */
    var ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-PI / 2);
    var ringMat0 = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uLight: { value: 1 }, uP: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false });
    var rings = [], RN = low ? 8 : 16, ringNext = 0;
    for (var ri = 0; ri < RN; ri++) {
      var rm = new THREE.Mesh(ringGeo, ringMat0.clone()); rm.visible = false; rm.renderOrder = 4; scene.add(rm);
      rings.push({ m: rm, t: 0, dur: 1, size: 0.05 });
    }
    function ring(x, y, z, size, dur) {
      var r = rings[ringNext]; ringNext = (ringNext + 1) % RN;
      r.m.position.set(x, y + 0.0015, z); r.t = 0; r.dur = dur || 0.7; r.size = size || 0.05; r.m.visible = true;
    }

    /* ── 蛇口の水柱 ── */
    var streamGeo = new THREE.CylinderGeometry(1, 1, 1, low ? 10 : 14, low ? 24 : 40, true); streamGeo.translate(0, -0.5, 0);
    var streamU = { uTopD: { value: 0 }, uBotD: { value: 0 }, uR: { value: 0.004 }, uV0: { value: 0.35 }, uTime: { value: 0 }, uSun: { value: sun }, uLight: { value: 1 }, uAlpha: { value: 1 } };
    var stream = new THREE.Mesh(streamGeo, new THREE.ShaderMaterial({ uniforms: streamU, vertexShader: STREAM_VS, fragmentShader: STREAM_FS, transparent: true, depthWrite: false }));
    stream.frustumCulled = false; stream.visible = false; stream.renderOrder = 3; scene.add(stream);
    var foamU = { uA: { value: 0 }, uLight: { value: 1 }, uTime: { value: 0 } };
    var foamGeo = new THREE.PlaneGeometry(1, 1); foamGeo.rotateX(-PI / 2);
    var foam = new THREE.Mesh(foamGeo, new THREE.ShaderMaterial({ uniforms: foamU, vertexShader: QUAD_VS, fragmentShader: FOAM_FS, transparent: true, depthWrite: false }));
    foam.visible = false; foam.renderOrder = 4; scene.add(foam);
    var tap = { target: 0, rate: 0, from: new THREE.Vector3(), toY: 0, kind: 'can', called: 0, on: false, topD: 0, botD: 0, acc: 0, ringAcc: 0 };

    /* ── 虹 ── */
    var bowU = { uA: { value: 0 }, uLight: { value: 1 } };
    var bow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: bowU, vertexShader: QUAD_VS, fragmentShader: BOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    bow.geometry.translate(0, 0.5, 0);
    bow.visible = false; bow.renderOrder = 6; bow.frustumCulled = false; scene.add(bow);
    bow.onBeforeRender = function (r, s, cam) { bow.quaternion.copy(cam.quaternion); bow.updateMatrixWorld(); };
    var bowC = new THREE.Vector3(), bowHave = false;

    /* ── シャワーの状態 ── */
    var sh = { time: 0, lastCall: -1, srcY: 0, acc: 0 };
    var holes = roseHoles();
    var bx = new THREE.Vector3(), by = new THREE.Vector3(), dirN = new THREE.Vector3();
    var hits = {}, hitKinds = [];
    var now = 0;

    var water = {
      colliders: [], onHit: null, onDrip: null, rainbow: 0,
      setTapStream: function (rate, from, toY, kind) {
        tap.target = U.clamp01(rate || 0); tap.called = now;
        if (from) tap.from.copy(from);
        if (toY != null) tap.toY = toY;
        tap.kind = kind || 'can';
      },
      shower: function (pos, dir, rate, dt) {
        rate = U.clamp01(rate); if (rate <= 0.001) return;
        sh.lastCall = now; sh.srcY = pos.y;
        dirN.copy(dir).normalize();
        /* はす口の面の基底 */
        bx.crossVectors(dirN, UP); if (bx.lengthSq() < 1e-6) bx.set(1, 0, 0); bx.normalize();
        by.crossVectors(bx, dirN).normalize();
        var speed = 1.6 * (0.7 + 0.3 * rate);
        var budget = Math.floor(CAP * 0.82);
        sh.acc += rate * CAP * 1.9 * (dt || 0.016);
        var spreadTan = Math.tan(6 * PI / 180);
        while (sh.acc >= 1) {
          sh.acc -= 1;
          if (alive >= budget) { sh.acc = 0; break; }
          var hl = holes[(Math.random() * holes.length) | 0];
          var hx = hl[0], hy = hl[1], f = 1 / 0.0245;
          var jx = (Math.random() - 0.5) * 0.022, jy = (Math.random() - 0.5) * 0.022;
          var ox = hx * f * spreadTan + jx, oy = hy * f * spreadTan + jy;
          var s = speed * (0.95 + Math.random() * 0.1);
          var vx = (dirN.x + bx.x * ox + by.x * oy) * s, vy = (dirN.y + bx.y * ox + by.y * oy) * s, vz = (dirN.z + bx.z * ox + by.z * oy) * s;
          var x = pos.x + bx.x * hx + by.x * hy, y = pos.y + bx.y * hx + by.y * hy, z = pos.z + bx.z * hx + by.z * hy;
          /* フレームの間に出た分だけ先へ進めて、縞にならないように */
          var u = Math.random() * (dt || 0.016);
          x += vx * u; y += vy * u - 0.5 * GRAV * u * u; z += vz * u; vy -= GRAV * u;
          spawn(T_SHOWER, x, y, z, vx, vy, vz, 3.0, 0, 0.0009 + Math.random() * 0.0005, 0.9, 0.055);
        }
      },
      drip: function (pos, toY) {
        spawn(T_DRIP, pos.x, pos.y, pos.z, 0, -0.05, 0, 4.0, toY == null ? 0 : toY, 0.0016, 0.9, 0.012);
      },
      splash: function (pos, strength) {
        strength = strength == null ? 0.5 : U.clamp01(strength);
        droplets(pos.x, pos.y, pos.z, Math.round(6 + 26 * strength), 0.5 + 1.0 * strength, pos.y - 0.002, 0.7);
        ring(pos.x, pos.y, pos.z, 0.05 + 0.08 * strength, 0.8);
      },
      overflow: function (center, radius, rate) {
        rate = U.clamp01(rate); if (rate <= 0) return;
        var n = rate * 170 * 0.033;
        var k = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
        for (var i = 0; i < k; i++) {
          var a = Math.random() * PI * 2, c = Math.cos(a), s = Math.sin(a), sp = 0.10 + Math.random() * 0.18;
          spawn(T_OVER, center.x + c * radius, center.y + 0.002, center.z + s * radius, c * sp, 0.02 + Math.random() * 0.04, s * sp, 3.0, 0, 0.0013 + Math.random() * 0.0010, 0.9, 0.05);
        }
      },
      clear: function () {
        alive = 0; quad.instanceCount = 0;
        tap.on = false; tap.rate = 0; tap.target = 0; stream.visible = false; foam.visible = false;
        for (var i = 0; i < rings.length; i++) rings[i].m.visible = false;
        sh.time = 0; water.rainbow = 0; bow.visible = false;
      },
      update: function (dt, time, sunDir, lightLevel) {
        dt = Math.min(dt || 0, 0.05); now = time != null ? time : now + dt;
        if (sunDir) sun.copy(sunDir).normalize();
        light = lightLevel != null ? lightLevel : 0.22 + 0.78 * U.smooth(-0.08, 0.30, sun.y);
        streakU.uTime.value = now; streakU.uLight.value = light;
        streamU.uTime.value = now; streamU.uLight.value = light; foamU.uTime.value = now; foamU.uLight.value = light; bowU.uLight.value = light;

        /* ── 水柱 ── */
        if (now - tap.called > 0.15) tap.target = 0;
        tap.rate = U.damp(tap.rate, tap.target, 6, dt);
        var len = Math.max(0.01, tap.from.y - tap.toY);
        var v0 = 0.25 + 0.35 * tap.rate;
        if (tap.target > 0.01) {
          if (!tap.on) { tap.on = true; tap.topD = 0; tap.botD = 0; }
          tap.topD = 0;
          if (tap.botD < len) tap.botD = Math.min(len, tap.botD + Math.sqrt(v0 * v0 + 2 * GRAV * tap.botD) * dt + 0.002);
          else tap.botD = len;
        } else if (tap.on) {
          tap.topD += Math.sqrt(v0 * v0 + 2 * GRAV * tap.topD) * dt + 0.002;
          tap.botD = Math.min(len, tap.botD + Math.sqrt(v0 * v0 + 2 * GRAV * tap.botD) * dt);
          if (tap.topD >= len) tap.on = false;
        }
        stream.visible = tap.on;
        var landing = tap.on && tap.botD >= len - 1e-4;
        if (tap.on) {
          stream.position.copy(tap.from);
          streamU.uTopD.value = tap.topD; streamU.uBotD.value = tap.botD;
          var rr = Math.max(tap.rate, tap.target > 0.01 ? 0.15 : tap.rate);
          streamU.uR.value = 0.0028 + 0.0050 * Math.max(rr, 0.12);
          streamU.uV0.value = v0;
          streamU.uAlpha.value = U.clamp01(0.5 + rr);
        }
        if (landing) {
          var pan = tap.kind === 'pan';
          var fs = (pan ? 0.035 : 0.022) + 0.035 * tap.rate;
          foam.visible = true; foam.position.set(tap.from.x, tap.toY + 0.0012, tap.from.z); foam.scale.set(fs, 1, fs);
          foamU.uA.value = U.clamp01(0.4 + tap.rate);
          tap.acc += tap.rate * (pan ? 160 : 55) * dt;
          var vImp = Math.sqrt(v0 * v0 + 2 * GRAV * len);
          while (tap.acc >= 1) {
            tap.acc -= 1;
            var a = Math.random() * PI * 2, rad = streamU.uR.value * 1.5;
            droplets(tap.from.x + Math.cos(a) * rad, tap.toY, tap.from.z + Math.sin(a) * rad, 1, Math.min(1.1, vImp * (pan ? 0.32 : 0.22)), tap.toY - 0.001, pan ? 0.9 : 0.6);
          }
          tap.ringAcc += dt * (pan ? 5 : 3.5) * (0.4 + tap.rate);
          if (tap.ringAcc >= 1) { tap.ringAcc = 0; ring(tap.from.x, tap.toY, tap.from.z, (pan ? 0.07 : 0.05) + 0.06 * tap.rate * Math.random(), 0.6); }
        } else foam.visible = false;

        /* ── 粒 ── */
        for (var h = 0; h < hitKinds.length; h++) { var o = hits[hitKinds[h]]; o.n = 0; o.x = o.y = o.z = 0; }
        var cols = water.colliders || [], nc = cols.length;
        var sx = 0, sy = 0, sz = 0, sn = 0;
        var i = 0;
        while (i < alive) {
          var i3 = i * 3;
          var px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
          var vx = Vv[i3], vy = Vv[i3 + 1], vz = Vv[i3 + 2];
          var ty = TYPE[i];
          vy -= GRAV * dt;
          if (ty === T_SHOWER || ty === T_OVER) { var drag = 1 - 0.25 * dt; vx *= drag; vz *= drag; }
          var nx = px + vx * dt, ny = py + vy * dt, nz = pz + vz * dt;
          LIFE[i] += dt;
          var dead = LIFE[i] > MAXL[i];
          if (!dead && (ty === T_SHOWER || ty === T_OVER)) {
            for (var c = 0; c < nc; c++) {
              var C = cols[c];
              var hit = false;
              if (C.shape === 'sphere') {
                if (MASK[i] & (1 << (c & 31))) continue;
                var ddx = nx - C.x, ddy = ny - C.y, ddz = nz - C.z;
                if (ddx * ddx + ddy * ddy + ddz * ddz < C.r * C.r) {
                  hit = true; MASK[i] |= (1 << (c & 31));
                  var pass = C.pass != null ? C.pass : 0.6;
                  if (Math.random() >= pass) dead = true;
                  else { vx *= 0.75; vz *= 0.75; vy *= 0.6; vx += (Math.random() - 0.5) * 0.3; vz += (Math.random() - 0.5) * 0.3; }
                }
              } else {
                if (py >= C.y && ny < C.y) {
                  var ft = (py - C.y) / Math.max(1e-6, py - ny);
                  var hx2 = px + (nx - px) * ft, hz2 = pz + (nz - pz) * ft;
                  var ex = hx2 - C.x, ez = hz2 - C.z;
                  if (ex * ex + ez * ez < C.r * C.r) {
                    hit = true; dead = true; nx = hx2; ny = C.y; nz = hz2;
                    if (C.splash) {
                      if (Math.random() < 0.35) droplets(hx2, C.y, hz2, 1, 0.55, C.y - 0.003, 0.9);
                      if (Math.random() < 0.02) ring(hx2, C.y, hz2, 0.03, 0.45);
                    }
                  }
                }
              }
              if (hit) {
                var hk = hits[C.kind]; if (!hk) { hk = hits[C.kind] = { n: 0, x: 0, y: 0, z: 0 }; hitKinds.push(C.kind); }
                hk.n++; hk.x += nx; hk.y += ny; hk.z += nz;
                if (dead) break;
              }
            }
            if (!dead && ny <= 0) {
              var ft2 = py / Math.max(1e-6, py - ny); nx = px + (nx - px) * ft2; nz = pz + (nz - pz) * ft2; ny = 0;
              var hf = hits.floor; if (!hf) { hf = hits.floor = { n: 0, x: 0, y: 0, z: 0 }; hitKinds.push('floor'); }
              hf.n++; hf.x += nx; hf.z += nz;
              if (Math.random() < 0.25) droplets(nx, 0, nz, 1, 0.45, -0.001, 0.9);
              if (Math.random() < 0.012) ring(nx, 0, nz, 0.035, 0.5);
              dead = true;
            }
          } else if (!dead && ty === T_DRIP) {
            if (ny <= KILLY[i]) {
              var ky = KILLY[i];
              ring(nx, ky, nz, 0.045, 0.7); droplets(nx, ky, nz, 3, 0.45, ky - 0.002, 0.7);
              if (water.onDrip) water.onDrip(nx, ky, nz);
              dead = true;
            }
          } else if (!dead && vy < 0 && ny < KILLY[i]) dead = true;
          if (dead) { kill(i); continue; }
          P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz; Vv[i3] = vx; Vv[i3 + 1] = vy; Vv[i3 + 2] = vz;
          var lf = LIFE[i] / MAXL[i];
          PAR[i * 4 + 1] = A0[i] * (ty === T_SPLASH ? (1 - lf * lf) : (1 - U.smooth(0.85, 1.0, lf)));
          if (ty === T_SHOWER && LIFE[i] > 0.05 && LIFE[i] < 0.25) { sx += nx; sy += ny; sz += nz; sn++; }
          i++;
        }
        for (var h2 = 0; h2 < hitKinds.length; h2++) {
          var kk = hitKinds[h2], ob = hits[kk];
          if (ob.n > 0 && water.onHit) water.onHit(kk, ob.x / ob.n, ob.y / ob.n, ob.z / ob.n, ob.n);
        }
        quad.instanceCount = alive;
        aP.updateRange.offset = 0; aP.updateRange.count = alive * 3; aP.needsUpdate = true;
        aV.updateRange.offset = 0; aV.updateRange.count = alive * 3; aV.needsUpdate = true;
        aPar.updateRange.offset = 0; aPar.updateRange.count = alive * 4; aPar.needsUpdate = true;
        streaks.visible = alive > 0;

        /* ── 輪 ── */
        for (var r = 0; r < rings.length; r++) {
          var R = rings[r]; if (!R.m.visible) continue;
          R.t += dt; var p = R.t / R.dur;
          if (p >= 1) { R.m.visible = false; continue; }
          var s = R.size * (0.25 + 0.75 * Math.sqrt(p));
          R.m.scale.set(s, 1, s);
          R.m.material.uniforms.uA.value = (1 - p) * (1 - p); R.m.material.uniforms.uP.value = p; R.m.material.uniforms.uLight.value = light;
        }

        /* ── シャワーの時間と虹 ── */
        var showering = now - sh.lastCall < 0.12;
        sh.time = showering ? sh.time + dt : 0;
        var want = (showering && sh.time > 0.8 && sh.srcY > 0.70 && sn > 8) ? 1 : 0;
        water.rainbow = U.damp(water.rainbow, want, want ? 1.6 : 2.5, dt);
        if (water.rainbow < 0.004 && !want) water.rainbow = 0;
        if (sn > 0) {
          _v2.set(sx / sn, sy / sn, sz / sn);
          if (!bowHave) { bowC.copy(_v2); bowHave = true; } else bowC.lerp(_v2, 1 - Math.exp(-3 * dt));
        }
        bow.visible = water.rainbow > 0.004 && bowHave;
        if (bow.visible) {
          bow.position.set(bowC.x - 0.02, bowC.y - 0.15, bowC.z + 0.02);
          bow.scale.set(0.36, 0.36, 1);
          bowU.uA.value = water.rainbow;
        }
        if (!showering && sn === 0) bowHave = water.rainbow > 0.004 ? bowHave : false;
      }
    };
    return water;
  }
  G.Water = { create: createWater };
})();
