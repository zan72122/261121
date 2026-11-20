// 朝の台所のセットと小物（three.js r170、手続き生成のみ・外部画像なし）。
// 単位 m、Y 上、天板上面 y=0、遊ぶ人は +Z 側から見下ろす。各 Group の原点は「置いたときの底面中心」（特記以外）。
//
// ── 公開 API ───────────────────────────────────────────────────────────────
// createKitchenSet(renderer) → Group（ワールド原点に置く）
//   天板: オークのブッチャーブロック x∈[-1.3,1.3] z∈[-0.80,+0.50] 上面 y=0、手前縁 R12mm、厚さ 40mm
//   奥の壁 z=-0.80: 白いサブウェイタイル。窓 x∈[-0.74,-0.06] y∈[0.13,1.02]、窓台の上面 y=0.13（z -0.87..-0.76）
//   小物: 立てかけたまな板 (x≈0.70)、陶器のツールスタンド＋木べら (x≈0.60,z≈-0.64)、バジルの鉢 (x≈-0.64,z≈-0.65)
//   ライト（Group 内）: 太陽 DirectionalLight（左奥上、影 2048、影カメラは x∈[-0.85,0.85] z∈[-0.85,0.55] を覆う）＋ HemisphereLight
//   userData.env          : PMREM 環境テクスチャ（scene.environment に入れる）
//   userData.envIntensity : 推奨 scene.environmentIntensity（0.6）
//   userData.sun          : DirectionalLight
//   userData.update(dt,t) : 窓の光のごくわずかなゆらぎ
// createRiceCooker() → Group 幅0.25×奥行0.29×高さ0.21、正面 +Z
//   userData.api = {
//     button            : 開くボタンの Object3D（直径0.04、正面上部 y≈0.125）
//     pressButton()     : 押し込み→戻る（120ms）
//     open(), close(), isOpen（getter）
//     lidBounce()       : 開いたふたの小さな揺れ
//     riceCenterLocal   : Vector3（ごはん上面の中心、takeScoop で下がる）, riceRadius (0.088)
//     takeScoop()       : ごはんが少し減ってすくった跡（4回まで。戻り値=残り回数）
//     shamojiRest       : {position, quaternion}（ローカル。しゃもじがごはんに刺さり内がまの手前ふちにもたれる姿勢）
//     steamVentLocal    : Vector3（蒸気口。ふたの角度に追従して毎フレーム更新）
//     lamp(on)          : オレンジのランプ
//   }, userData.update(dt,t)（ふたは後ろヒンジで 85°、約0.35秒でぱかっと跳ね上がり少しオーバーシュート）
// createSteam({max=70}) → Group（ワールド原点に置く）
//   userData.api = { emit(originWorld, count, {spread=0.05, speed=0.25, size=0.06}), setWisp(originWorld|null, perSecond) }
//   userData.update(dt,t)
// createShamoji() → Group 長さ0.21。原点=頭の上面中心、頭は XZ 平面、柄は +Z
//   userData.api = { setLoaded(bool), length: 0.21 }
// createPlate() → Group 直径0.25 白磁
//   userData.api = { radius: 0.125, surfaceY: 0.0068, spots: Vector3[10]（ローカル。spots[2k]=ママ, spots[2k+1]=子ども） }
// createShaker() → Group 直径0.042×高さ0.085 ガラスびん＋赤キャップ
//   userData.api = { setPour(k 0..1), capWorld(out?), emitGrains(n) }, userData.update(dt,t)
// createChopsticks() → Group 長さ0.33、原点=箸先（つまむ点）、+Y へ伸びる
//   userData.api = { setGrip(k 0..1, width=0.02) }, userData.update(dt,t)
// createToteBag() → Group 幅0.27×奥行0.15×高さ0.20 生成り帆布＋紺の持ち手
//   userData.api = { size:{w,d,h}, mouthLocal, insideLocal(i)（0=下, 1=上）, setHandles(k), handleTopLocal, squash(amount) }
//   userData.update(dt,t)
// ────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, makeNoise, fbm, makeCanvas, canvasTexture, paintPixels, normalFromHeight, radialTexture, roundedRectShape, shadowAll } from './texutil.js';

// ── 共通 ────────────────────────────────────────────────────────────────────
const _cache = new Map();
function cached(key, make) { if (!_cache.has(key)) _cache.set(key, make()); return _cache.get(key); }
const sg = (v) => (v < 0 ? -1 : 1);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const follow = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

/** 色・高さ・ラフネスを1回のループで塗る。fn(x,y,o) で o.r,o.g,o.b(0..255), o.h(0..1), o.ro(0..1) を設定。 */
function paintMaps(w, h, fn) {
  const [cc, cx] = makeCanvas(w, h), [hc, hx] = makeCanvas(w, h), [rc, rx] = makeCanvas(w, h);
  const ci = cx.createImageData(w, h), hi = hx.createImageData(w, h), ri = rx.createImageData(w, h);
  const C = ci.data, Hd = hi.data, R = ri.data;
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0.5 };
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    fn(x, y, o);
    C[i] = o.r; C[i + 1] = o.g; C[i + 2] = o.b; C[i + 3] = 255;
    const hv = o.h * 255; Hd[i] = Hd[i + 1] = Hd[i + 2] = hv; Hd[i + 3] = 255;
    const rv = o.ro * 255; R[i] = R[i + 1] = R[i + 2] = rv; R[i + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0); rx.putImageData(ri, 0, 0);
  return { color: cc, height: hc, rough: rc };
}
function wrapTex(t, rx = 1, ry = 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true; return t; }

/** パラメトリック面 f(u,v,out)。u は周方向（closedU なら継ぎ目の法線を平均）。UV は弧長 / uLen, vLen。 */
function paramSurface(nu, nv, f, { closedU = true, uLen = 1, vLen = 1, color = null } = {}) {
  const cols = nu + 1, P = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = new THREE.Vector3(); f(i / nu, j / nv, p); P.push(p); }
  const pos = new Float32Array(P.length * 3), uv = new Float32Array(P.length * 2);
  for (let k = 0; k < P.length; k++) { pos[k * 3] = P[k].x; pos[k * 3 + 1] = P[k].y; pos[k * 3 + 2] = P[k].z; }
  for (let j = 0; j <= nv; j++) { let acc = 0; for (let i = 0; i <= nu; i++) { const k = j * cols + i; if (i) acc += P[k].distanceTo(P[k - 1]); uv[k * 2] = acc / uLen; } }
  for (let i = 0; i <= nu; i++) { let acc = 0; for (let j = 0; j <= nv; j++) { const k = j * cols + i; if (j) acc += P[k].distanceTo(P[k - cols]); uv[k * 2 + 1] = acc / vLen; } }
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * cols + i, b = a + cols, c = a + 1, d = b + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) {
    const col = new Float32Array(P.length * 3);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const k = j * cols + i; const c = color(i / nu, j / nv, P[k]); col[k * 3] = c; col[k * 3 + 1] = c; col[k * 3 + 2] = c; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closedU) {
    const n = g.attributes.normal;
    for (let j = 0; j <= nv; j++) {
      const a = j * cols, b = a + nu;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}
/** 超楕円の点（θ=π/2 が +Z 正面）。dn で外向き法線方向へオフセット。 */
function superPoint(th, a, b, n, dn, out) {
  const c = Math.cos(th), s = Math.sin(th);
  const ac = Math.abs(c), as = Math.abs(s);
  let x = a * sg(c) * Math.pow(ac, 2 / n), z = b * sg(s) * Math.pow(as, 2 / n);
  if (dn) {
    let nx = sg(c) * Math.pow(ac, 2 - 2 / n) / a, nz = sg(s) * Math.pow(as, 2 - 2 / n) / b;
    const l = Math.hypot(nx, nz) || 1; x += nx / l * dn; z += nz / l * dn;
  }
  out.x = x; out.z = z;
  return out;
}
/** リング列 [{y,a,b,n}] をつないだ面 */
function loftRings(rings, nu, opts) {
  const nv = rings.length - 1;
  return paramSurface(nu, nv, (u, v, p) => {
    const r = rings[Math.round(v * nv)];
    superPoint(u * Math.PI * 2, r.a, r.b, r.n ?? 3.4, 0, p); p.y = r.y;
  }, opts);
}
/** 影：shadowAll のあと、userData.noShadow のものは外す */
function applyShadows(g) {
  shadowAll(g, true, true);
  g.traverse((o) => { if (o.isMesh && o.userData.noShadow) { o.castShadow = false; o.receiveShadow = false; } if (o.isMesh && o.userData.noCast) o.castShadow = false; });
  return g;
}
/** 接地のやわらかい影（AO）。楕円の板。 */
function contactShadow(w, d, opacity = 0.5) {
  const tex = cached('csTex', () => radialTexture(128, [[0, 'rgba(0,0,0,1)'], [0.4, 'rgba(0,0,0,0.6)'], [0.72, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]));
  const geo = cached('csGeo', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.scale.set(w, 1, d); m.position.y = 0.0006; m.renderOrder = -1; m.userData.noShadow = true;
  return m;
}

function placeAt(o, x, y, z) { o.position.set(x, y, z); return o; }

// ── テクスチャ ──────────────────────────────────────────────────────────────
// ブッチャーブロック（オーク）: 1024×512 = 1.0m(u) × 0.608m(v)、幅 30mm の細板 20 本、板は u 方向
function woodMaps() {
  return cached('wood', () => {
    const W = 1024, H = 512, NS = 20, SH = H / NS;
    const r = rng(11), n1 = makeNoise(5, 256), n2 = makeNoise(9, 256), n3 = makeNoise(21, 128);
    const strips = [];
    for (let s = 0; s < NS; s++) {
      const m = 1 + Math.floor(r() * 2), joints = [];
      for (let k = 0; k < m; k++) joints.push(((k + 0.2 + r() * 0.6) / m) * W);
      const segs = joints.map(() => {
        const dark = r();
        return { k: 0.74 + dark * 0.34, warm: r() * 0.12 - 0.04, seed: r() * 50, flat: r() < 0.35 };
      });
      strips.push({ joints, segs });
    }
    const maps = paintMaps(W, H, (x, y, o) => {
      const si = Math.floor(y / SH), ly = y - si * SH, st = strips[si];
      let seg = 0; for (let k = 0; k < st.joints.length; k++) if (x >= st.joints[k]) seg = k + 1;
      seg %= st.joints.length; const sgm = st.segs[seg];
      let jd = 1e9; for (const j of st.joints) jd = Math.min(jd, Math.abs(x - j), Math.abs(x - j + W), Math.abs(x - j - W));
      const sd = Math.min(ly, SH - ly);
      const q = fbm(n1, x * 0.012 + sgm.seed, y * 0.18 + sgm.seed, 3);
      let lines;
      if (sgm.flat) { // 板目: ゆるい山形
        const ph = (y + sgm.seed * 7) * 0.55 + Math.sin(x * 0.006 + sgm.seed) * 9 + q * 14;
        lines = 0.5 + 0.5 * Math.sin(ph);
      } else lines = 0.5 + 0.5 * Math.sin((y + sgm.seed * 3) * 1.25 + q * 9);
      lines = Math.pow(lines, 3);
      const pore = n2(x * 0.45, y * 1.6) > 0.8 ? 1 : 0;
      const mott = fbm(n3, x * 0.01, y * 0.03, 2);
      let k = sgm.k * (0.94 + 0.1 * mott) * (1 - 0.13 * lines) * (1 - 0.12 * pore);
      let R = 198 * k * (1 + sgm.warm), G = 148 * k, B = 98 * k * (1 - sgm.warm * 1.5);
      let h = 0.62 + 0.06 * (1 - lines) - 0.12 * pore + 0.04 * q;
      let ro = 0.5 + 0.12 * (q - 0.5) + 0.15 * pore + 0.06 * lines;
      const e = Math.min(sd, jd);
      if (e < 1.2) { const f = 1 - e / 1.2; R *= 1 - 0.12 * f; G *= 1 - 0.14 * f; B *= 1 - 0.16 * f; h -= 0.12 * f; ro += 0.06 * f; }
      o.r = R; o.g = G; o.b = B; o.h = clamp01(h); o.ro = clamp01(ro);
    });
    return {
      map: canvasTexture(maps.color, { aniso: 8 }),
      normal: normalFromHeight(maps.height, 1.6),
      rough: canvasTexture(maps.rough, { srgb: false, aniso: 8 }),
    };
  });
}
function woodMat(tint = 0xffffff, key = 'oak') {
  return cached('woodMat_' + key, () => {
    const t = woodMaps();
    const m = new THREE.MeshPhysicalMaterial({ color: tint, map: wrapTex(t.map), normalMap: wrapTex(t.normal), roughnessMap: wrapTex(t.rough), roughness: 1, clearcoat: 0.28, clearcoatRoughness: 0.32, normalScale: new THREE.Vector2(0.6, 0.6) });
    return m;
  });
}
// サブウェイタイル: 512px = 0.30m、タイル 0.15×0.075、目地 2mm
function tileMaps() {
  return cached('tile', () => {
    const S = 512, TW = 256, TH = 128, GH = 1.3, BV = 8;
    const n = makeNoise(31, 64), r = rng(3);
    const tint = []; for (let i = 0; i < 64; i++) tint.push(0.975 + r() * 0.03);
    const maps = paintMaps(S, S, (x, y, o) => {
      const row = Math.floor(y / TH), off = (row % 2) * (TW / 2);
      const xx = x + off, col = Math.floor(xx / TW) % 2;
      const lx = xx % TW, ly = y % TH;
      const d = Math.min(lx, TW - lx, ly, TH - ly) - GH;
      const id = (row * 3 + col * 7) % 64;
      if (d < 0) {
        const g = 0.97 + 0.05 * n(x * 0.3, y * 0.3);
        o.r = 214 * g; o.g = 210 * g; o.b = 201 * g; o.h = 0.05; o.ro = 0.85;
      } else {
        const e = Math.min(1, d / BV);
        const wav = fbm(n, x / 40 + id, y / 40, 2);
        const t = tint[id] * (0.985 + 0.015 * e);
        o.r = 250 * t; o.g = 250 * t; o.b = 246 * t;
        o.h = 0.2 + 0.7 * Math.sqrt(e) + 0.05 * wav;
        o.ro = 0.07 + 0.05 * wav;
      }
    });
    return { map: canvasTexture(maps.color), normal: normalFromHeight(maps.height, 3.2), rough: canvasTexture(maps.rough, { srgb: false }) };
  });
}
// ごはん粒: 512px = 0.05m
function riceMaps() {
  return cached('rice', () => {
    const S = 512;
    const [cc, cx] = makeCanvas(S), [hc, hx] = makeCanvas(S);
    cx.fillStyle = '#c9c3b6'; cx.fillRect(0, 0, S, S);
    hx.fillStyle = '#222'; hx.fillRect(0, 0, S, S);
    const r = rng(77);
    for (let i = 0; i < 560; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, L = 31 + r() * 6, Wd = 17 + r() * 3;
      const tone = 246 + r() * 9;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const px = x + ox, py = y + oy;
        if (px < -L || px > S + L || py < -L || py > S + L) continue;
        for (const [ctx, kind] of [[cx, 0], [hx, 1]]) {
          ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.scale(1, Wd / L);
          const g = ctx.createRadialGradient(-L * 0.12, -L * 0.18, 0, 0, 0, L);
          if (kind === 0) { g.addColorStop(0, `rgb(${tone + 2},${tone + 2},${tone})`); g.addColorStop(0.8, `rgb(${tone - 8},${tone - 8},${tone - 11})`); g.addColorStop(0.93, `rgb(${tone - 22},${tone - 22},${tone - 27})`); g.addColorStop(1, `rgb(${tone - 34},${tone - 35},${tone - 40})`); }
          else { g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#d8d8d8'); g.addColorStop(0.92, '#707070'); g.addColorStop(1, '#404040'); }
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, L, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }
    }
    return { map: wrapTex(canvasTexture(cc)), normal: wrapTex(normalFromHeight(hc, 3.2)) };
  });
}
function riceMat() {
  return cached('riceMat', () => {
    const t = riceMaps();
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.36, emissive: 0x141413, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  });
}
// 細かいノイズのノーマル（樹脂のゆず肌・陶器など）
function fineNoiseNormal(key, freq, strength) {
  return cached('fn_' + key, () => {
    const n = makeNoise(41 + freq, 64);
    const c = paintPixels(256, 256, (x, y) => { const v = fbm(n, x / freq, y / freq, 3) * 255; return [v, v, v]; });
    return wrapTex(normalFromHeight(c, strength));
  });
}

// ── 環境マップ ─────────────────────────────────────────────────────────────
function buildEnv(renderer) {
  const es = new THREE.Scene();
  es.background = new THREE.Color(0xb9b0a3);
  const room = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial({ color: 0xcdc3b4, side: THREE.BackSide }));
  room.position.y = 1; es.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x7d5c3e }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.95; es.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 0.98, 0.9) }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 2.9; es.add(ceil);
  // 左奥の窓（明るい）
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.8, 5.4) }));
  win.position.set(-1.3, 1.3, -3.9); es.add(win);
  // 壁ぎわの白い面（奥）
  const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.2), new THREE.MeshBasicMaterial({ color: 0xeeeae2 }));
  back.position.set(1.2, 0.3, -3.95); es.add(back);
  // 手前（遊ぶ人の後ろ）のやわらかい壁
  const front = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: 0xd8cebf }));
  front.position.set(0, 1, 3.95); front.rotation.y = Math.PI; es.add(front);
  // 天井の照明（ぼんやり）
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.05, 1.8) }));
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0.4, 2.85, 0.6); es.add(lamp);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(es, 0.03).texture;
  pm.dispose();
  return tex;
}

// ── 台所セット ─────────────────────────────────────────────────────────────
export function createKitchenSet(renderer) {
  const G = new THREE.Group(); G.name = 'kitchenSet';
  const X0 = -1.3, X1 = 1.3, ZB = -0.8, ZF = 0.5, TH = 0.04, RE = 0.012;

  // 天板（断面を X 方向に掃引。UV はワールド寸法: u=x/1.0, v=弧長/0.608）
  {
    const prof = [];
    prof.push([ZB, 0]); prof.push([ZF - RE - 0.3, 0]);
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; prof.push([ZF - RE + Math.sin(a) * RE, -RE + Math.cos(a) * RE]); }
    for (let k = 1; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; prof.push([ZF - 0.004 + Math.cos(a) * 0.004, -TH + 0.004 - Math.sin(a) * 0.004]); }
    prof.push([ZB, -TH]);
    const pos = [], nrm = [], uv = [], idx = [];
    let s = 0;
    for (let i = 0; i < prof.length; i++) {
      if (i) s += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
      const p0 = prof[Math.max(0, i - 1)], p1 = prof[Math.min(prof.length - 1, i + 1)];
      const tz = p1[0] - p0[0], ty = p1[1] - p0[1], l = Math.hypot(tz, ty);
      const nz = -ty / l, ny = tz / l; // 外向き
      for (const x of [X0, X1]) { pos.push(x, prof[i][1], prof[i][0]); nrm.push(0, ny, nz); uv.push(x / 1.0, s / 0.608); }
    }
    for (let i = 0; i < prof.length - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const top = new THREE.Mesh(g, woodMat());
    top.name = 'counter'; top.userData.noCast = true;
    G.add(top);
    // 下の扉（白いキャビネット）
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.86, 0.02), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.45 }));
    cab.position.set(0, -TH - 0.43, ZF - 0.04); cab.userData.noShadow = true; G.add(cab);
  }

  // 奥の壁（タイル）と窓
  const WX0 = -0.74, WX1 = -0.06, WY0 = 0.13, WY1 = 1.02, WH = 1.5, REV = 0.07;
  {
    const t = tileMaps();
    const tileMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: wrapTex(t.map.clone()), normalMap: wrapTex(t.normal.clone()), roughnessMap: wrapTex(t.rough.clone()), roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.08, normalScale: new THREE.Vector2(1, 1), envMapIntensity: 3.2 });
    const addWall = (x0, x1, y0, y1) => {
      const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
      const uv = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + (x0 + x1) / 2) / 0.3, (p.getY(i) + (y0 + y1) / 2) / 0.3);
      const m = new THREE.Mesh(g, tileMat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, ZB); m.userData.noCast = true; G.add(m);
    };
    addWall(X0, WX0, 0, WH); addWall(WX1, X1, 0, WH); addWall(WX0, WX1, 0, WY0 - 0.025); addWall(WX0, WX1, WY1, WH);
    // 窓の見込み（白い塗り壁）
    const paint = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.7 });
    const rv = (w, h, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paint); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.userData.noCast = true; G.add(m); };
    rv(REV, WY1 - WY0, WX0, (WY0 + WY1) / 2, ZB - REV / 2, Math.PI / 2);
    rv(REV, WY1 - WY0, WX1, (WY0 + WY1) / 2, ZB - REV / 2, -Math.PI / 2);
    rv(WX1 - WX0, REV, (WX0 + WX1) / 2, WY1, ZB - REV / 2, 0, Math.PI / 2);
    // 窓枠（白い塗装の木）
    const frameMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f3ee, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const bar = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.005, w / 2.1, h / 2.1, d / 2.1)), frameMat); m.position.set(x, y, z); m.userData.noCast = true; G.add(m); return m; };
    const FZ = ZB - REV + 0.025, FW = 0.045;
    bar(WX1 - WX0, FW, 0.05, (WX0 + WX1) / 2, WY1 - FW / 2, FZ);
    bar(WX1 - WX0, FW, 0.05, (WX0 + WX1) / 2, WY0 + FW / 2, FZ);
    bar(FW, WY1 - WY0, 0.05, WX0 + FW / 2, (WY0 + WY1) / 2, FZ);
    bar(FW, WY1 - WY0, 0.05, WX1 - FW / 2, (WY0 + WY1) / 2, FZ);
    const MX = (WX0 + WX1) / 2;
    bar(0.05, WY1 - WY0 - 2 * FW, 0.045, MX, (WY0 + WY1) / 2, FZ + 0.004);
    // 障子（サッシ）枠
    for (const [a, b] of [[WX0 + FW, MX - 0.025], [MX + 0.025, WX1 - FW]]) {
      const cx = (a + b) / 2, w = b - a, y0 = WY0 + FW, y1 = WY1 - FW, SW = 0.03;
      bar(w, SW, 0.032, cx, y1 - SW / 2, FZ - 0.008); bar(w, SW, 0.032, cx, y0 + SW / 2, FZ - 0.008);
      bar(SW, y1 - y0, 0.032, a + SW / 2, (y0 + y1) / 2, FZ - 0.008); bar(SW, y1 - y0, 0.032, b - SW / 2, (y0 + y1) / 2, FZ - 0.008);
    }
    // ガラス（外の朝の光で白飛び気味）
    const gc = paintPixels(64, 256, (x, y) => {
      const t = y / 255; const n = Math.sin(x * 0.2 + y * 0.05) * 0.5 + 0.5;
      const sky = [238 - 8 * (1 - t), 243 - 4 * (1 - t), 250];
      const tree = t > 0.62 ? smooth(0.62, 0.95, t) * (0.6 + 0.4 * n) : 0;
      return [sky[0] * (1 - tree * 0.18), sky[1] * (1 - tree * 0.08), sky[2] * (1 - tree * 0.25)];
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(WX1 - WX0, WY1 - WY0), new THREE.MeshBasicMaterial({ map: canvasTexture(gc), color: new THREE.Color(1.75, 1.72, 1.66) }));
    glass.position.set(MX, (WY0 + WY1) / 2, ZB - REV + 0.01); glass.userData.noShadow = true; G.add(glass);
    // 窓台
    const sill = new THREE.Mesh(new RoundedBoxGeometry(WX1 - WX0 + 0.1, 0.026, 0.115, 3, 0.008), frameMat);
    sill.position.set(MX, WY0 - 0.013, ZB - REV + 0.0575 + 0.0); sill.userData.noCast = true;
    G.add(sill);
  }

  // 生活感の小物
  {
    // 立てかけたまな板（濃い色のアカシア）
    const bw = 0.24, bh = 0.36, bt = 0.018;
    const sh = roundedRectShape(bh, bw, 0.03);
    const hole = new THREE.Path(); hole.absellipse(bh / 2 - 0.045, 0, 0.011, 0.032, 0, Math.PI * 2, true, 0);
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: bt - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 16 });
    g.rotateZ(Math.PI / 2); g.translate(0, bh / 2, -(bt - 0.006) / 2);
    const board = new THREE.Mesh(g, woodMat(0xb9875f, 'acacia'));
    const tilt = 0.27;
    board.rotation.set(-tilt, -0.06, 0); board.position.set(0.70, 0.0015, ZB + 0.012 + Math.sin(tilt) * bh + 0.004);
    G.add(board);
    G.add(placeAt(contactShadow(0.3, 0.07, 0.35), 0.70, 0.0006, board.position.z - 0.01));

    // 陶器のツールスタンド＋木べら
    const crockMat = new THREE.MeshPhysicalMaterial({ color: 0xa9b5a0, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12, normalMap: fineNoiseNormal('ceramic', 14, 0.6), normalScale: new THREE.Vector2(0.15, 0.15) });
    const cp = [];
    const RO = 0.056, HH = 0.15;
    cp.push(new THREE.Vector2(0.0005, 0), new THREE.Vector2(0.045, 0), new THREE.Vector2(0.049, 0.002), new THREE.Vector2(0.051, 0.008));
    for (let k = 1; k <= 10; k++) { const t = k / 10; cp.push(new THREE.Vector2(0.051 + (RO - 0.051) * Math.sin(t * Math.PI * 0.5) - 0.002 * Math.sin(t * Math.PI), 0.008 + t * (HH - 0.014))); }
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI; cp.push(new THREE.Vector2(RO - 0.003 + Math.cos(a) * 0.003, HH - 0.006 + Math.sin(a) * 0.004 + 0.002)); }
    cp.push(new THREE.Vector2(RO - 0.007, HH - 0.02), new THREE.Vector2(RO - 0.009, 0.02), new THREE.Vector2(0.04, 0.012), new THREE.Vector2(0.0005, 0.012));
    const crock = new THREE.Mesh(new THREE.LatheGeometry(cp, 48), crockMat);
    const CX = 0.60, CZ = -0.66;
    crock.position.set(CX, 0, CZ); G.add(crock);
    G.add(placeAt(contactShadow(0.15, 0.15, 0.45), CX, 0.0006, CZ));
    const oak = woodMat();
    const tools = [
      { yaw: 0.3, lean: 0.12, head: 'paddle' }, { yaw: 2.2, lean: 0.18, head: 'spoon' }, { yaw: 4.1, lean: 0.14, head: 'slot' },
    ];
    for (const tl of tools) {
      const grp = new THREE.Group();
      const hp = []; const L = 0.25;
      for (let k = 0; k <= 12; k++) { const t = k / 12; hp.push(new THREE.Vector2(0.0058 - 0.0012 * t + (k === 12 ? -0.0058 : 0), t * L)); }
      hp.unshift(new THREE.Vector2(0.0001, 0));
      const handle = new THREE.Mesh(new THREE.LatheGeometry(hp, 12), oak); grp.add(handle);
      let head;
      if (tl.head === 'spoon') {
        head = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), oak);
        head.scale.set(1, 0.3, 1.35); head.rotation.x = Math.PI / 2; head.position.y = L + 0.028;
      } else {
        const s = new THREE.Shape(); s.absellipse(0, 0, 0.027, 0.04, 0, Math.PI * 2, false, 0);
        if (tl.head === 'slot') { const p = new THREE.Path(); p.absellipse(0, 0.004, 0.005, 0.022, 0, Math.PI * 2, true, 0); s.holes.push(p); }
        const hg = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 20 });
        hg.translate(0, 0, -0.001);
        head = new THREE.Mesh(hg, oak); head.position.y = L + 0.036;
      }
      grp.add(head);
      grp.position.set(CX, 0.015, CZ);
      grp.rotation.set(0, tl.yaw, tl.lean, 'YXZ');
      G.add(grp);
    }

    // バジルの鉢
    const PX = -0.64, PZ = -0.65;
    const terraN = makeNoise(51, 64);
    const terraMap = cached('terra', () => canvasTexture(paintPixels(256, 128, (x, y) => { const v = fbm(terraN, x / 6, y / 6, 3); const sp = terraN(x * 0.9, y * 0.9) > 0.86 ? 0.88 : 1; const k = (0.9 + 0.18 * v) * sp; return [186 * k, 104 * k, 66 * k]; })));
    const terra = new THREE.MeshStandardMaterial({ color: 0xffffff, map: terraMap, roughness: 0.92, normalMap: fineNoiseNormal('terra', 5, 1.2), normalScale: new THREE.Vector2(0.4, 0.4) });
    const pp = [new THREE.Vector2(0.0005, 0), new THREE.Vector2(0.036, 0), new THREE.Vector2(0.039, 0.003)];
    for (let k = 1; k <= 6; k++) { const t = k / 6; pp.push(new THREE.Vector2(0.039 + t * 0.012, 0.003 + t * 0.072)); }
    pp.push(new THREE.Vector2(0.056, 0.077), new THREE.Vector2(0.057, 0.08), new THREE.Vector2(0.057, 0.097), new THREE.Vector2(0.055, 0.1), new THREE.Vector2(0.051, 0.1), new THREE.Vector2(0.05, 0.085), new THREE.Vector2(0.0005, 0.085));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(pp, 40), terra); pot.position.set(PX, 0, PZ); G.add(pot);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1, normalMap: fineNoiseNormal('soil', 3, 3) }));
    soil.position.set(PX, 0.09, PZ); G.add(soil);
    G.add(placeAt(contactShadow(0.15, 0.15, 0.45), PX, 0.0006, PZ));
    const leafGeos = [], stemGeos = [];
    const r = rng(5);
    const leafBase = (() => {
      const s = new THREE.Shape(); s.moveTo(0, 0);
      s.bezierCurveTo(0.012, 0.006, 0.012, 0.026, 0, 0.036); s.bezierCurveTo(-0.012, 0.026, -0.012, 0.006, 0, 0);
      const g = new THREE.ShapeGeometry(s, 8); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, 28 * x * x - 6 * (y - 0.014) * (y - 0.014)); }
      g.computeVertexNormals(); return g;
    })();
    const up = new THREE.Vector3(0, 1, 0);
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + r() * 0.5, lean = 0.15 + r() * 0.25, h = 0.09 + r() * 0.06;
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
      const base = new THREE.Vector3(PX + Math.cos(a) * 0.012, 0.088, PZ + Math.sin(a) * 0.012);
      const st = new THREE.CylinderGeometry(0.0016, 0.0022, h, 5, 1);
      st.translate(0, h / 2, 0); st.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir)); st.translate(base.x, base.y, base.z);
      stemGeos.push(st);
      const pairs = 3 + Math.floor(r() * 2);
      for (let k = 0; k < pairs; k++) {
        const t = 0.35 + 0.65 * (k / (pairs - 1));
        const at = base.clone().addScaledVector(dir, h * t);
        for (let side = 0; side < 2; side++) {
          const lg = leafBase.clone();
          const sc = (1.25 - 0.55 * t) * (0.85 + r() * 0.3);
          lg.scale(sc, sc, sc);
          const yaw = a + (side ? Math.PI : 0) + k * 1.57 + (r() - 0.5) * 0.4;
          const e = new THREE.Euler(-(0.9 - 0.4 * t) - Math.PI / 2 + Math.PI / 2, yaw, 0, 'YXZ');
          lg.rotateX(-1.1 + 0.5 * t + (r() - 0.5) * 0.3); lg.rotateY(yaw);
          lg.translate(at.x, at.y, at.z);
          leafGeos.push(lg);
        }
      }
      const tip = leafBase.clone(); tip.scale(0.55, 0.55, 0.55); tip.rotateX(-0.3); tip.rotateY(a); const tp = base.clone().addScaledVector(dir, h); tip.translate(tp.x, tp.y, tp.z); leafGeos.push(tip);
    }
    const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x3f7f2c, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35, side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color(0x9fd080) });
    G.add(new THREE.Mesh(mergeGeometries(leafGeos), leafMat));
    G.add(new THREE.Mesh(mergeGeometries(stemGeos), new THREE.MeshStandardMaterial({ color: 0x5e8f3a, roughness: 0.6 })));
  }

  applyShadows(G);

  // ライト
  const sun = new THREE.DirectionalLight(0xffe2bd, 2.7);
  const target = new THREE.Object3D(); target.position.set(0, 0, -0.12); G.add(target);
  sun.position.set(-0.62, 1.05, -1.02);
  sun.target = target;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  {
    // 影カメラを x∈[-0.85,0.85], z∈[-0.85,0.55], y∈[0,0.45] にぴったり合わせる
    const m = new THREE.Matrix4().lookAt(sun.position, target.position, new THREE.Vector3(0, 1, 0));
    m.setPosition(sun.position); m.invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const x of [-0.85, 0.85]) for (const y of [0, 0.45]) for (const z of [-0.85, 0.55]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const c = sun.shadow.camera;
    c.left = x0; c.right = x1; c.bottom = y0; c.top = y1; c.near = Math.max(0.01, -z1 - 0.3); c.far = -z0 + 0.3;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.0025; sun.shadow.radius = 3;
  }
  G.add(sun);
  const hemi = new THREE.HemisphereLight(0xdde6f4, 0xa88a6a, 0.45);
  G.add(hemi);

  const env = buildEnv(renderer);
  G.userData.env = env;
  G.userData.envIntensity = 0.55;
  G.userData.sun = sun;
  G.userData.hemi = hemi;
  const baseI = sun.intensity;
  G.userData.update = (dt, t) => { sun.intensity = baseI * (1 + 0.015 * Math.sin(t * 0.7) + 0.01 * Math.sin(t * 1.9 + 1.3)); };
  return G;
}

// ── 炊飯器 ─────────────────────────────────────────────────────────────────
function cookerMats() {
  return cached('cookerMats', () => ({
    body: new THREE.MeshPhysicalMaterial({ color: 0xf3f2ee, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12, normalMap: fineNoiseNormal('peel', 9, 0.6), normalScale: new THREE.Vector2(0.06, 0.06) }),
    under: new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.5 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xdcdde0, metalness: 0.6, roughness: 0.38 }),
    gasket: new THREE.MeshStandardMaterial({ color: 0xbfbfbb, roughness: 0.7 }),
    pot: new THREE.MeshStandardMaterial({ color: 0x3b3b3e, metalness: 0.35, roughness: 0.38 }),
    potRim: new THREE.MeshStandardMaterial({ color: 0xb8b9bc, metalness: 1, roughness: 0.28 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, metalness: 0 }),
    silver: new THREE.MeshPhysicalMaterial({ color: 0xe4e6e9, metalness: 0.85, roughness: 0.26, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x9a9b9e, metalness: 0.6, roughness: 0.35 }),
    keys: new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.35, metalness: 0.2 }),
    vent: new THREE.MeshPhysicalMaterial({ color: 0xe2e2df, roughness: 0.35, clearcoat: 0.4 }),
  }));
}
export function createRiceCooker() {
  const G = new THREE.Group(); G.name = 'riceCooker';
  const M = cookerMats();
  const N = 3.4;
  const PZ = -0.138, PY = 0.1545; // ヒンジ
  const bodyRings = [
    { y: 0, a: 0.0005, b: 0.0005 }, { y: 0, a: 0.105, b: 0.125 }, { y: 0.003, a: 0.116, b: 0.136 }, { y: 0.009, a: 0.1215, b: 0.1415 },
    { y: 0.02, a: 0.1245, b: 0.1445 }, { y: 0.05, a: 0.125, b: 0.145 }, { y: 0.1, a: 0.125, b: 0.145 }, { y: 0.13, a: 0.1245, b: 0.1445 },
    { y: 0.142, a: 0.1235, b: 0.1435 }, { y: 0.148, a: 0.1215, b: 0.1415 }, { y: 0.1515, a: 0.118, b: 0.138 },
    { y: 0.153, a: 0.112, b: 0.131, n: 3.1 }, { y: 0.1535, a: 0.108, b: 0.118, n: 2.5 }, { y: 0.1535, a: 0.1045, b: 0.1045, n: 2 },
    { y: 0.15, a: 0.1035, b: 0.1035, n: 2 }, { y: 0.13, a: 0.103, b: 0.103, n: 2 },
  ];
  const body = new THREE.Mesh(loftRings(bodyRings, 96), M.body); G.add(body);

  // 内がま
  const pp = [new THREE.Vector2(0.1025, 0.135), new THREE.Vector2(0.1025, 0.155), new THREE.Vector2(0.1015, 0.1575), new THREE.Vector2(0.099, 0.1585), new THREE.Vector2(0.0968, 0.157), new THREE.Vector2(0.0958, 0.153)];
  for (let k = 1; k <= 8; k++) pp.push(new THREE.Vector2(0.0958 - 0.0006 * k, 0.153 - k * 0.012));
  pp.push(new THREE.Vector2(0.085, 0.042), new THREE.Vector2(0.06, 0.036), new THREE.Vector2(0.0005, 0.035));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(pp, 72), M.pot); G.add(pot);
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.0995, 0.0018, 8, 72), M.potRim); rimRing.rotation.x = Math.PI / 2; rimRing.position.y = 0.157; G.add(rimRing);

  // ごはん
  const RR = 0.0952, NR = 26, NA = 72;
  const rn = makeNoise(13, 64);
  const rice = { base: 0.1335, dome: 0.0075, dents: [], scoops: 0 };
  const riceGeo = (() => {
    const pos = [], uv = [], idx = [];
    for (let k = 0; k <= NR; k++) for (let j = 0; j <= NA; j++) {
      const rr = (k / NR) * RR, a = (j / NA) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos.push(x, 0, z); uv.push(x / 0.065, z / 0.065);
    }
    for (let k = 0; k < NR; k++) for (let j = 0; j < NA; j++) {
      const a = k * (NA + 1) + j, b = a + NA + 1, c = a + 1, d = b + 1;
      idx.push(a, c, b, c, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  })();
  const riceH = (x, z) => {
    const rr = Math.hypot(x, z) / RR;
    let h = rice.base + rice.dome * (1 - rr * rr) + 0.0035 * smooth(0.82, 1, rr);
    h += (fbm(rn, x * 160 + 7, z * 160 + 3, 3) - 0.5) * 0.004;
    for (const d of rice.dents) {
      const q = Math.hypot(x - d.x, z - d.z) / d.r;
      h += -d.depth * Math.exp(-q * q * 2.2) + d.lip * Math.exp(-(q - 1.05) * (q - 1.05) * 14);
    }
    return h;
  };
  const rebuildRice = () => {
    const p = riceGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, riceH(p.getX(i), p.getZ(i)));
    p.needsUpdate = true; riceGeo.computeVertexNormals();
    // 中心の法線を平均（極の継ぎ目）
    riceGeo.computeBoundingSphere();
  };
  rebuildRice();
  const riceMesh = new THREE.Mesh(riceGeo, riceMat()); G.add(riceMesh);

  // 正面パネル（黒いガラス）＋ランプ＋ボタン
  const frontZ = (x, b = 0.145, a = 0.125) => b * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / a, N)), 1 / N);
  const bendToFront = (geo, zBase) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + frontZ(p.getX(i)) - zBase);
    return geo;
  };
  const panelGeo = bendToFront(new TessellateModifier(0.008, 8).modify(new RoundedBoxGeometry(0.13, 0.05, 0.006, 3, 0.0028).translate(0, 0, 0.145 + 0.0003)), 0.145);
  const panel = new THREE.Mesh(panelGeo, M.glass); panel.position.y = 0.072; G.add(panel);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x7a3a10, emissive: 0xff8a1e, emissiveIntensity: 0, roughness: 0.3 });
  const lampM = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.005, 0.003, 2, 0.0015), lampMat);
  lampM.position.set(-0.042, 0.083, frontZ(-0.042) + 0.0038); G.add(lampM);
  for (let k = 0; k < 3; k++) {
    const x = -0.012 + k * 0.022;
    const key = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0058, 0.0016, 24).rotateX(Math.PI / 2), M.keys);
    key.position.set(x, 0.066, frontZ(x) + 0.0042); G.add(key);
  }
  // 開くボタン（銀色、直径0.04）
  const btnRoot = new THREE.Group();
  const tiltB = 0.12;
  btnRoot.position.set(0, 0.127, frontZ(0) - 0.0025); btnRoot.rotation.x = -tiltB; G.add(btnRoot);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0215, 0.0022, 10, 48), M.bezel); bezel.position.z = 0.004; btnRoot.add(bezel);
  const bezelBack = new THREE.Mesh(new THREE.CylinderGeometry(0.0236, 0.0236, 0.008, 48).rotateX(Math.PI / 2), M.under); bezelBack.position.z = 0.0; btnRoot.add(bezelBack);
  const bp = [new THREE.Vector2(0.02, 0), new THREE.Vector2(0.0199, 0.003), new THREE.Vector2(0.0193, 0.0042), new THREE.Vector2(0.0175, 0.0052), new THREE.Vector2(0.012, 0.0058), new THREE.Vector2(0.0001, 0.006)];
  const button = new THREE.Mesh(new THREE.LatheGeometry(bp, 48).rotateX(Math.PI / 2), M.silver);
  button.name = 'cookerButton'; button.position.z = 0.002; btnRoot.add(button);

  // ふた（ヒンジ基準）
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, PY, PZ); G.add(lidPivot);
  const lidInner = new THREE.Group(); lidInner.position.set(0, -PY, -PZ); lidPivot.add(lidInner);
  const lidRings = [
    { y: 0.1535, a: 0.1165, b: 0.1365 }, { y: 0.1555, a: 0.1215, b: 0.1415 }, { y: 0.159, a: 0.1238, b: 0.1438 }, { y: 0.17, a: 0.1245, b: 0.1445 },
    { y: 0.182, a: 0.1235, b: 0.1435 }, { y: 0.192, a: 0.1195, b: 0.1395 }, { y: 0.199, a: 0.112, b: 0.132 }, { y: 0.204, a: 0.1, b: 0.12 },
    { y: 0.2075, a: 0.08, b: 0.1 }, { y: 0.2095, a: 0.05, b: 0.065 }, { y: 0.2102, a: 0.0005, b: 0.0005 },
  ];
  lidInner.add(new THREE.Mesh(loftRings(lidRings, 96), M.body));
  const under = new THREE.Mesh(loftRings([{ y: 0.1535, a: 0.0005, b: 0.0005 }, { y: 0.1535, a: 0.1165, b: 0.1365 }], 96), M.under); lidInner.add(under);
  const alu = new THREE.Mesh(new THREE.CircleGeometry(0.096, 64).rotateX(Math.PI / 2), M.alu); alu.position.y = 0.1525; lidInner.add(alu);
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(0.0975, 0.0026, 8, 72), M.gasket); gasket.rotation.x = Math.PI / 2; gasket.position.y = 0.1522; lidInner.add(gasket);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.004, 32), M.alu); knob.position.set(0, 0.1505, 0); lidInner.add(knob);
  // 蒸気口
  const VZ = -0.07;
  const vent = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.01, 0.034, 3, 0.0045), M.vent); vent.position.set(0, 0.2065, VZ); lidInner.add(vent);
  for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.002, 0.0028, 1, 0.0009), M.dark); s.position.set(0, 0.2112, VZ - 0.008 + k * 0.008); s.userData.noCast = true; lidInner.add(s); }
  // ヒンジ
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 20).rotateZ(Math.PI / 2), M.under); hinge.position.set(0, PY - 0.001, PZ - 0.003); G.add(hinge);

  G.add(contactShadow(0.31, 0.35, 0.55));
  applyShadows(G);
  riceMesh.castShadow = false;

  // 状態とアニメーション
  let isOpen = false, ang = 0, vel = 0, press = 0, pressT = -1;
  const OPEN = THREE.MathUtils.degToRad(85);
  const ventLocal = new THREE.Vector3();
  const riceCenterLocal = new THREE.Vector3(0, riceH(0, 0), 0);
  const shamojiRest = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const updateRest = () => {
    riceCenterLocal.set(0, riceH(0, 0), 0);
    const hz = -0.012, hy = riceH(0, hz) - 0.003;
    const cz = 0.0985, cy = 0.1585 + 0.0045; // ふち越しの接点（柄の下面ぶん上）
    const elev = Math.atan2(cy - hy, cz - hz);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -elev);
    shamojiRest.quaternion.copy(qy).multiply(qx);
    shamojiRest.position.set(Math.sin(0.2) * 0.0, hy, hz);
  };
  updateRest();
  const updateVent = () => { ventLocal.set(0, 0.2125, VZ); lidInner.updateMatrix(); lidPivot.updateMatrix(); ventLocal.applyMatrix4(lidInner.matrix).applyMatrix4(lidPivot.matrix); };
  updateVent();

  const api = {
    button,
    pressButton() { pressT = 0; },
    open() { if (!isOpen) { isOpen = true; vel = Math.max(vel, 3); } },
    close() { isOpen = false; },
    get isOpen() { return isOpen; },
    lidBounce() { if (isOpen) vel -= 1.6; },
    riceCenterLocal,
    riceRadius: 0.088,
    takeScoop() {
      if (rice.scoops >= 4) return 0;
      const r = rng(101 + rice.scoops * 17);
      const a = Math.PI / 2 + (rice.scoops % 2 ? 1 : -1) * (0.35 + r() * 0.45);
      const rr = 0.028 + r() * 0.025;
      rice.dents.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr - 0.01, r: 0.026 + r() * 0.006, depth: 0.0075, lip: 0.0018 });
      rice.base -= 0.0035; rice.scoops++;
      rebuildRice(); updateRest();
      return 4 - rice.scoops;
    },
    shamojiRest,
    steamVentLocal: ventLocal,
    lamp(on) { lampMat.emissiveIntensity = on ? 2.6 : 0; lampMat.color.set(on ? 0xffa040 : 0x7a3a10); },
  };
  G.userData.api = api;
  G.userData.update = (dt) => {
    dt = Math.min(dt, 0.04);
    // ふた: ばね（ζ≈0.5）
    const target = isOpen ? OPEN : 0;
    const steps = 4, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const w = 15, z = 0.48;
      const acc = w * w * (target - ang) - 2 * z * w * vel;
      vel += acc * h; ang += vel * h;
      if (ang < 0) { ang = 0; vel = Math.abs(vel) * 0.15; }
    }
    lidPivot.rotation.x = -ang;
    updateVent();
    // ボタン 120ms
    if (pressT >= 0) {
      pressT += dt;
      const t = pressT;
      press = t < 0.04 ? t / 0.04 : t < 0.12 ? 1 - (t - 0.04) / 0.08 : 0;
      if (t >= 0.12) { pressT = -1; press = 0; }
      button.position.z = 0.002 - 0.0035 * press;
    }
  };
  return G;
}

// ── 湯気 ───────────────────────────────────────────────────────────────────
function puffTexture() {
  return cached('puff', () => {
    const n = makeNoise(61, 32);
    const c = paintPixels(128, 128, (x, y) => {
      const dx = (x - 63.5) / 64, dy = (y - 63.5) / 64, r = Math.hypot(dx, dy);
      const f = Math.pow(clamp01(1 - r), 1.8);
      const v = f * (0.55 + 0.6 * fbm(n, x / 14, y / 14, 3));
      const c = clamp01(v) * 255; return [c, c, c];
    });
    return canvasTexture(c, { srgb: false });
  });
}
export function createSteam({ max = 70 } = {}) {
  const G = new THREE.Group(); G.name = 'steam';
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  const aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  for (const a of [aPos, aSize, aAlpha, aRot]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos); geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha); geo.setAttribute('aRot', aRot);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puffTexture() } },
    vertexShader: `attribute vec3 aPos; attribute float aSize; attribute float aAlpha; attribute float aRot;
      varying vec2 vUv; varying float vA;
      void main(){ vUv = uv; vA = aAlpha; vec4 mv = viewMatrix * vec4(aPos, 1.0);
        float c = cos(aRot), s = sin(aRot); vec2 p = vec2(c*position.x - s*position.y, s*position.x + c*position.y) * aSize;
        mv.xy += p; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying float vA;
      void main(){ float a = texture2D(map, vUv).r * vA; if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.25, 1.25, 1.27), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  mesh.matrixWorldAutoUpdate = false; // ワールド座標で描く
  G.add(mesh);
  const P = []; // {x,y,z,vx,vy,vz,age,life,size,rot,vr}
  const r = rng(7);
  let wisp = null, wispRate = 0, acc = 0;
  const spawn = (o, spread, speed, size) => {
    if (P.length >= max) P.shift();
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    P.push({ x: o.x + Math.cos(a) * d, y: o.y, z: o.z + Math.sin(a) * d, vx: (r() - 0.5) * 0.04, vy: speed * (0.7 + r() * 0.6), vz: (r() - 0.5) * 0.04,
      age: 0, life: 1.5 + r() * 1.0, size: size * (0.6 + r() * 0.5), rot: r() * 6.28, vr: (r() - 0.5) * 0.8, ph: r() * 10 });
  };
  G.userData.api = {
    emit(originWorld, count, { spread = 0.05, speed = 0.25, size = 0.06 } = {}) { for (let i = 0; i < count; i++) spawn(originWorld, spread, speed, size); },
    setWisp(originWorld, perSecond = 6) { wisp = originWorld ? originWorld.clone() : null; wispRate = perSecond; },
  };
  G.userData.update = (dt, t) => {
    if (wisp && wispRate > 0) { acc += dt * wispRate; while (acc >= 1) { acc -= 1; spawn(wisp, 0.012, 0.12, 0.035); } }
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) { if ((P[i].age += dt) >= P[i].life) P.splice(i, 1); }
    for (const p of P) {
      const k = p.age / p.life;
      p.vy *= Math.exp(-0.9 * dt);
      p.vx += Math.sin(t * 1.7 + p.ph) * 0.03 * dt; p.vz += Math.cos(t * 1.3 + p.ph) * 0.02 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt;
      aPos.setXYZ(n, p.x, p.y, p.z);
      aSize.setX(n, p.size * (1 + 2.4 * k));
      aAlpha.setX(n, 0.55 * smooth(0, 0.12, k) * Math.pow(1 - k, 1.6));
      aRot.setX(n, p.rot);
      n++;
    }
    geo.instanceCount = n;
    for (const a of [aPos, aSize, aAlpha, aRot]) a.needsUpdate = true;
  };
  return G;
}

// ── しゃもじ ───────────────────────────────────────────────────────────────
function dotsNormal() {
  return cached('dots', () => {
    const S = 128, R = 5.5, step = 21.33;
    const c = paintPixels(S, S, (x, y) => {
      let v = 0;
      for (let j = -1; j <= 6; j++) for (let i = -1; i <= 6; i++) {
        const cx = i * step + (j % 2 ? step / 2 : 0), cy = j * step;
        const d = Math.hypot(x - cx, y - cy); if (d < R) v = Math.max(v, Math.sqrt(1 - (d / R) * (d / R)));
      }
      const c = v * 255; return [c, c, c];
    });
    return wrapTex(normalFromHeight(c, 3), 1 / 0.012, 1 / 0.012);
  });
}
export function createShamoji() {
  const G = new THREE.Group(); G.name = 'shamoji';
  const mat = cached('shamojiMat', () => new THREE.MeshPhysicalMaterial({ color: 0xf6f5f0, roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.5, normalMap: dotsNormal(), normalScale: new THREE.Vector2(0.7, 0.7), sheen: 0.3, sheenColor: new THREE.Color(0xffffff) }));
  const geo = cached('shamojiGeo', () => {
    const rx = 0.036, ry = 0.042, j = 0.55;
    const s = new THREE.Shape();
    s.moveTo(rx * Math.sin(j), -ry * Math.cos(j));
    s.absellipse(0, 0, rx, ry, -Math.PI / 2 + j, Math.PI * 1.5 - j, false, 0);
    s.quadraticCurveTo(-0.012, -0.045, -0.0115, -0.062);
    s.lineTo(-0.0135, -0.155);
    s.absarc(0, -0.155, 0.0135, Math.PI, Math.PI * 2, false);
    s.lineTo(0.0115, -0.062);
    s.quadraticCurveTo(0.012, -0.045, rx * Math.sin(j), -ry * Math.cos(j));
    const depth = 0.0035, bev = 0.0013;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 40, steps: 1 });
    g.rotateX(-Math.PI / 2); // 形の Y → -Z、押し出し → +Y
    g.translate(0, -(depth + bev), 0); // 上面 y=0
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      // ※ rotateX(-90) で形の -Y（柄）は +Z になる
      const d = Math.hypot(x, z) / 0.04;
      let dy = d < 1 ? -0.0028 * (1 - d * d) : 0;
      if (z > 0.05) dy += (z - 0.05) * (z - 0.05) * 0.3;
      p.setY(i, p.getY(i) + dy);
    }
    g.computeBoundingSphere();
    return g;
  });
  const m = new THREE.Mesh(geo, mat); G.add(m);
  // ごはんの小山
  const moundGeo = cached('moundGeo', () => {
    const g = new THREE.SphereGeometry(0.026, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const n = makeNoise(17, 32), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (fbm(n, x * 300 + 5, z * 300 + y * 200, 2) - 0.5) * 0.25;
      p.setXYZ(i, x * k * 1.1, y * 0.72 * k, z * k);
    }
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 0.05, p.getZ(i) / 0.05 + p.getY(i) / 0.05);
    g.computeVertexNormals(); return g;
  });
  const mound = new THREE.Mesh(moundGeo, riceMat()); mound.position.set(0, -0.0035, -0.002); mound.visible = false; G.add(mound);
  applyShadows(G);
  G.userData.api = { setLoaded(b) { mound.visible = !!b; }, length: 0.21 };
  return G;
}

// ── 皿 ─────────────────────────────────────────────────────────────────────
export function createPlate() {
  const G = new THREE.Group(); G.name = 'plate';
  const mat = cached('plateMat', () => new THREE.MeshPhysicalMaterial({ color: 0xf6f5f1, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.0 }));
  const geo = cached('plateGeo', () => {
    const pts = [[0.0005, 0.004], [0.066, 0.004], [0.07, 0.0025], [0.0725, 0.0004], [0.075, 0], [0.0778, 0.0004], [0.0795, 0.002], [0.083, 0.0045], [0.1, 0.0095], [0.112, 0.0145], [0.12, 0.0185], [0.1238, 0.0208], [0.1252, 0.0222], [0.1250, 0.0234], [0.1238, 0.0239], [0.1222, 0.0234], [0.112, 0.0182], [0.1, 0.0128], [0.092, 0.0092], [0.087, 0.0076], [0.08, 0.0069], [0.05, 0.0068], [0.0005, 0.0068]];
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 96);
  });
  G.add(new THREE.Mesh(geo, mat));
  G.add(contactShadow(0.21, 0.21, 0.45));
  applyShadows(G);
  const sY = 0.0068, spots = [];
  // ペア0は中央、ペア1..4はまわりに（各ペアの2つは接線方向に並ぶ）
  spots.push(new THREE.Vector3(-0.021, sY, 0), new THREE.Vector3(0.021, sY, 0));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, R = 0.068, t = 0.021;
    const cx = Math.cos(a) * R, cz = Math.sin(a) * R, tx = -Math.sin(a), tz = Math.cos(a);
    spots.push(new THREE.Vector3(cx - tx * t, sY, cz - tz * t), new THREE.Vector3(cx + tx * t, sY, cz + tz * t));
  }
  G.userData.api = { radius: 0.125, surfaceY: sY, spots };
  return G;
}

// ── ふりかけびん ───────────────────────────────────────────────────────────
function furikakeTex() {
  return cached('furiTex', () => {
    const S = 256;
    const [c, x] = makeCanvas(S), [hc, hx] = makeCanvas(S);
    x.fillStyle = '#7a6434'; x.fillRect(0, 0, S, S); hx.fillStyle = '#444'; hx.fillRect(0, 0, S, S);
    const r = rng(9);
    const draw = (n, col, f) => { for (let i = 0; i < n; i++) { const px = r() * S, py = r() * S, s = f(); x.fillStyle = col[Math.floor(r() * col.length)]; const h = 140 + r() * 115; hx.fillStyle = `rgb(${h},${h},${h})`; for (const ctx of [x, hx]) { if (ctx === hx) { ctx.fillStyle = `rgb(${h},${h},${h})`; } ctx.save(); ctx.translate(px, py); ctx.rotate(r() * 6.28); ctx.beginPath(); ctx.ellipse(0, 0, s[0], s[1], 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } } };
    draw(650, ['#e7b52f', '#f0c443', '#d99e22', '#f3d061'], () => [2.6 + r() * 2.6, 2 + r() * 1.8]); // たまご
    draw(260, ['#eadfc3', '#d9c8a2'], () => [2.4, 1.2]); // ごま
    draw(380, ['#1f2a14', '#2b3a1a', '#141a0e'], () => [2.5 + r() * 4.5, 1.2 + r() * 2]); // のり
    draw(120, ['#c8653d', '#b65733'], () => [1.5 + r(), 1.2 + r()]); // さけ
    return { map: wrapTex(canvasTexture(c), 3, 1), normal: wrapTex(normalFromHeight(hc, 2), 3, 1) };
  });
}
function glassMat(side) {
  return cached('glass' + side, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.08, depthWrite: false, side, envMapIntensity: 1.6, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
        float lum = dot(outgoingLight, vec3(0.3, 0.59, 0.11));
        diffuseColor.a = clamp(diffuseColor.a + fr * 0.55 + lum * 0.45, 0.0, 0.95);
        gl_FragColor = vec4(outgoingLight, diffuseColor.a);`);
    };
    return m;
  });
}
export function createShaker() {
  const G = new THREE.Group(); G.name = 'shaker';
  const pivot = new THREE.Group(); pivot.position.y = 0.0425; G.add(pivot);
  const jar = new THREE.Group(); jar.position.y = -0.0425; pivot.add(jar);
  const R = 0.021;
  const outer = cached('jarOuter', () => {
    const p = [[0.0005, 0], [0.016, 0], [0.019, 0.0007], [0.0205, 0.0025], [R, 0.005], [R, 0.058], [0.0205, 0.0625], [0.0192, 0.0658], [0.018, 0.067], [0.018, 0.069]];
    return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  });
  const inner = cached('jarInner', () => {
    const p = [[0.0005, 0.004], [0.017, 0.004], [0.0188, 0.0055], [0.0192, 0.008], [0.0192, 0.057], [0.0185, 0.062], [0.0168, 0.066]];
    return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  });
  const gIn = new THREE.Mesh(inner, glassMat(THREE.BackSide)); gIn.renderOrder = 2; gIn.userData.noShadow = true;
  const gOut = new THREE.Mesh(outer, glassMat(THREE.FrontSide)); gOut.renderOrder = 3; gOut.userData.noCast = true;
  // 中身
  const ft = furikakeTex();
  const contMat = cached('furiMat', () => new THREE.MeshStandardMaterial({ map: ft.map, normalMap: ft.normal, roughness: 0.85 }));
  const contGeo = cached('furiGeo', () => {
    const g = new THREE.CylinderGeometry(0.0189, 0.0186, 0.04, 40, 1, true);
    g.translate(0, 0.02, 0);
    const top = new THREE.CircleGeometry(0.0189, 40).rotateX(-Math.PI / 2);
    const n = makeNoise(4, 16), p = top.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.04 + 0.0025 * (1 - (x * x + z * z) / 0.00036) + (n(x * 400 + 4, z * 400 + 4) - 0.5) * 0.002); }
    const uv = top.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 20, p.getZ(i) * 20);
    top.computeVertexNormals();
    return mergeGeometries([g, top]);
  });
  const contents = new THREE.Mesh(contGeo, contMat); contents.position.y = 0.0045; contents.scale.set(0.98, 1, 0.98);
  jar.add(contents);
  jar.add(gIn); jar.add(gOut);
  // キャップ（赤い樹脂、側面にローレット）
  const capMat = cached('capMat', () => {
    const c = paintPixels(256, 8, (x) => { const v = (0.5 + 0.5 * Math.cos((x / 256) * Math.PI * 2 * 60)) * 255; return [v, v, v]; });
    return new THREE.MeshPhysicalMaterial({ color: 0xc41f1c, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2, normalMap: normalFromHeight(c, 1.2) });
  });
  const capGeo = cached('capGeo', () => {
    const p = [[0.0001, 0.085], [0.017, 0.085], [0.0205, 0.0846], [0.0218, 0.0836], [0.0223, 0.082], [0.0223, 0.0685], [0.0218, 0.0675], [0.019, 0.0672]].reverse();
    return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 64);
  });
  const cap = new THREE.Mesh(capGeo, capMat); jar.add(cap);
  const holes = cached('holesGeo', () => {
    const gs = [];
    for (let k = 0; k < 7; k++) { const a = k === 0 ? 0 : (k - 1) / 6 * Math.PI * 2, rr = k === 0 ? 0 : 0.0075; const g = new THREE.CircleGeometry(0.0017, 12).rotateX(-Math.PI / 2); g.translate(Math.cos(a) * rr + 0.004, 0.08505, Math.sin(a) * rr); gs.push(g); }
    return mergeGeometries(gs);
  });
  const holeM = new THREE.Mesh(holes, cached('holeMat', () => new THREE.MeshStandardMaterial({ color: 0x1a0a08, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }))); holeM.userData.noShadow = true; jar.add(holeM);
  const cs = contactShadow(0.07, 0.07, 0.5); G.add(cs);
  applyShadows(G);

  // 粒（ワールド座標）
  const MAXG = 180;
  const grainGeo = cached('grainGeo', () => new THREE.IcosahedronGeometry(0.0011, 0));
  const grainMat = cached('grainMat', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  const grains = new THREE.InstancedMesh(grainGeo, grainMat, MAXG);
  grains.matrixWorldAutoUpdate = false; grains.frustumCulled = false; grains.count = 0; grains.castShadow = false;
  const gcols = [new THREE.Color(0xe6b432), new THREE.Color(0x1f2a14), new THREE.Color(0xe8dcc0), new THREE.Color(0x2b3a1a)];
  for (let i = 0; i < MAXG; i++) grains.setColorAt(i, gcols[i % 4]);
  G.add(grains);
  const GP = [];
  const r = rng(23);
  let pour = 0, pourT = 0;
  const tmp = new THREE.Vector3(), dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), ds = new THREE.Vector3();
  const capWorld = (out = new THREE.Vector3()) => { jar.updateWorldMatrix(true, false); return jar.localToWorld(out.set(0.004, 0.0855, 0)); };
  G.userData.api = {
    setPour(k) { pourT = clamp01(k); },
    capWorld,
    emitGrains(n) {
      capWorld(tmp);
      for (let i = 0; i < n; i++) {
        if (GP.length >= MAXG) GP.shift();
        GP.push({ x: tmp.x + (r() - 0.5) * 0.014, y: tmp.y - 0.003, z: tmp.z + (r() - 0.5) * 0.014, vx: (r() - 0.5) * 0.08, vy: -0.05 - r() * 0.15, vz: (r() - 0.5) * 0.08, y0: tmp.y, rx: r() * 6, ry: r() * 6, c: Math.floor(r() * 4) });
      }
    },
  };
  G.userData.update = (dt) => {
    dt = Math.min(dt, 0.05);
    pour = follow(pour, pourT, dt, 10);
    pivot.rotation.z = -pour * Math.PI;
    contents.position.y = 0.0045 + 0.0335 * smooth(0.45, 0.85, pour);
    G.updateWorldMatrix(true, false);
    cs.material.opacity = 0.5 * (1 - clamp01(G.matrixWorld.elements[13] / 0.04)) * (1 - pour);
    let n = 0;
    for (let i = GP.length - 1; i >= 0; i--) {
      const p = GP[i];
      p.vy += (-9.8 - p.vy * 6) * dt; p.vx *= Math.exp(-4 * dt); p.vz *= Math.exp(-4 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += dt * 9;
      if (p.y < p.y0 - 0.1) GP.splice(i, 1);
    }
    for (const p of GP) {
      dq.setFromEuler(new THREE.Euler(p.rx, p.ry, 0)); ds.set(1, p.c === 1 || p.c === 3 ? 0.4 : 1, 1);
      dm.compose(tmp.set(p.x, p.y, p.z), dq, ds);
      grains.setMatrixAt(n, dm); grains.setColorAt(n, gcols[p.c]); n++;
    }
    grains.count = n;
    grains.instanceMatrix.needsUpdate = true; if (grains.instanceColor) grains.instanceColor.needsUpdate = true;
  };
  return G;
}

// ── 菜箸 ───────────────────────────────────────────────────────────────────
export function createChopsticks() {
  const G = new THREE.Group(); G.name = 'chopsticks';
  const L = 0.33;
  const mat = cached('bambooMat', () => {
    const n = makeNoise(71, 64);
    const maps = paintMaps(32, 512, (x, y, o) => {
      const v = 1 - y / 511;
      const fib = fbm(n, x * 0.7, y * 0.02, 3);
      const node = Math.exp(-Math.pow((v - 0.74) * 90, 2));
      const tipDark = smooth(0.12, 0.0, v) * 0.25;
      const band = (v > 0.9 && v < 0.93) || (v > 0.945 && v < 0.955) ? 0.45 : 0; // 頭の焼き帯
      let k = (0.9 + 0.18 * fib) * (1 - 0.25 * node) * (1 - tipDark) * (1 - band);
      o.r = 222 * k; o.g = 186 * k; o.b = 124 * k;
      o.h = 0.5 + 0.25 * fib + 0.2 * node; o.ro = 0.5 + 0.15 * fib;
    });
    return new THREE.MeshPhysicalMaterial({ map: canvasTexture(maps.color), normalMap: normalFromHeight(maps.height, 1.2, { wrap: false }), roughnessMap: canvasTexture(maps.rough, { srgb: false }), roughness: 1, clearcoat: 0.25, clearcoatRoughness: 0.4 });
  });
  const geo = cached('stickGeo', () => {
    const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.0009, 0.0002), new THREE.Vector2(0.0014, 0.0012)];
    const NN = 40;
    for (let k = 1; k <= NN; k++) { const t = k / NN, y = 0.0012 + t * (L - 0.004); pts.push(new THREE.Vector2(0.0014 + (0.0043 - 0.0014) * Math.pow(t, 0.9), y)); }
    pts.push(new THREE.Vector2(0.0038, L - 0.0008), new THREE.Vector2(0.0025, L), new THREE.Vector2(0, L));
    return new THREE.LatheGeometry(pts, 14);
  });
  const sticks = [new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat)];
  for (const s of sticks) G.add(s);
  applyShadows(G);
  let gap = 0.05, gapT = 0.05;
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  const place = () => {
    for (let i = 0; i < 2; i++) {
      const sx = i ? 1 : -1;
      const tip = new THREE.Vector3(sx * (gap / 2 + 0.0012), 0, sx * 0.0008);
      const top = new THREE.Vector3(sx * 0.0085, 0.3, sx * -0.0035);
      d.subVectors(top, tip).normalize();
      sticks[i].position.copy(tip); sticks[i].quaternion.setFromUnitVectors(up, d);
    }
  };
  place();
  G.userData.api = { setGrip(k, width = 0.02) { gapT = THREE.MathUtils.lerp(0.05, width, clamp01(k)); } };
  G.userData.update = (dt) => { const g0 = gap; gap = follow(gap, gapT, Math.min(dt, 0.05), 18); if (Math.abs(g0 - gap) > 1e-6) place(); };
  return G;
}

// ── トートバッグ ───────────────────────────────────────────────────────────
function canvasMaps() {
  return cached('canvasMaps', () => {
    const S = 256, P = 8;
    const n = makeNoise(81, 64), n2 = makeNoise(83, 256);
    const maps = paintMaps(S, S, (x, y, o) => {
      const i = Math.floor(x / P), j = Math.floor(y / P), fx = (x % P + 0.5) / P, fy = (y % P + 0.5) / P;
      const warpTop = (i + j) % 2 === 0;
      const slubW = 0.85 + 0.3 * n2(i * 3.1, y * 0.03), slubF = 0.85 + 0.3 * n2(x * 0.03, j * 3.7 + 50);
      const wH = Math.sin(Math.PI * fx) * (warpTop ? 1 : 0.55) * slubW;
      const fH = Math.sin(Math.PI * fy) * (warpTop ? 0.55 : 1) * slubF;
      const h = Math.max(wH, fH);
      const fleck = n2(x * 0.7, y * 0.7) > 0.93 ? 0.8 : 1;
      const k = (0.86 + 0.14 * h) * (0.96 + 0.06 * fbm(n, x / 20, y / 20, 2)) * fleck;
      o.r = 233 * k; o.g = 223 * k; o.b = 201 * k; o.h = h * 0.8; o.ro = 0.9 - 0.08 * h;
    });
    return { map: wrapTex(canvasTexture(maps.color)), normal: wrapTex(normalFromHeight(maps.height, 1.6)), rough: wrapTex(canvasTexture(maps.rough, { srgb: false })) };
  });
}
function webbingMat() {
  return cached('webMat', () => {
    const c = paintPixels(64, 64, (x, y) => { const v = (0.5 + 0.5 * Math.sin((x / 64) * Math.PI * 2 * 16)) * 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(y / 64 * Math.PI * 2 * 16 + (Math.floor(x / 2) % 2) * Math.PI)); const g = v * 255; return [g, g, g]; });
    return new THREE.MeshStandardMaterial({ color: 0x1f2c4c, roughness: 0.8, side: THREE.DoubleSide, normalMap: wrapTex(normalFromHeight(c, 0.9), 1, 1) });
  });
}
export function createToteBag() {
  const G = new THREE.Group(); G.name = 'toteBag';
  const W = 0.27, D = 0.15, H = 0.2, A = W / 2, B = D / 2, NE = 6, T = 0.0024;
  const inner = new THREE.Group(); G.add(inner);
  const topMod = (th) => { const s = Math.sin(th); return -0.009 * Math.pow(Math.abs(s), 3) + 0.0022 * Math.sin(3 * th + 0.7) + 0.0015 * Math.sin(5 * th + 2.1); };
  const pinch = (th) => -0.006 * Math.pow(Math.abs(Math.sin(th)), 4);
  const bulge = (th, y) => {
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    const corner = Math.min(1, 4 * c * c * s * s * 1.0);
    return 0.006 * Math.pow(Math.sin(Math.PI * clamp01(y / H)), 0.8) * (1 - 0.7 * corner);
  };
  // 断面プロファイル: [sKind, dn, y, topW] … sKind=0 は中心、1 は外周
  const prof = [];
  prof.push([0, 0, 0]); prof.push([0.55, -0.005, 0]); prof.push([1, -0.01, 0]);
  for (let k = 1; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; prof.push([1, -0.01 + 0.01 * Math.sin(a), 0.01 - 0.01 * Math.cos(a)]); }
  for (let k = 1; k <= 12; k++) prof.push([1, 0, 0.01 + (k / 12) * (H - 0.012)]);
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI; prof.push([1, -T / 2 + (T / 2) * Math.cos(a), H - T / 2 + (T / 2) * Math.sin(a), 1]); }
  for (let k = 1; k <= 8; k++) prof.push([1, -T, H - T / 2 - (k / 8) * (H - 0.012)]);
  for (let k = 1; k <= 3; k++) { const a = (k / 3) * Math.PI / 2; prof.push([1, -T - 0.01 + 0.01 * Math.cos(a), T + 0.01 - 0.01 * Math.sin(a)]); }
  prof.push([0.5, -T - 0.008, T]); prof.push([0, 0, T]);
  const NV = prof.length - 1, INNER0 = 7 + 12 + 4; // 内側の開始インデックス付近
  const wn = makeNoise(91, 16);
  const creases = [[0.55, 0.05, 0.0018], [2.45, 0.045, 0.0015], [3.75, 0.05, 0.0016], [5.6, 0.04, 0.0014], [1.25, 0.06, -0.001]];
  const wrinkle = (th, y) => {
    const u = ((th / (Math.PI * 2)) % 1 + 1) % 1;
    let d = (fbm(wn, u * 16, y * 30, 3) - 0.5) * 0.005 * smooth(0.0, 0.03, y);
    for (const [c, wdt, a] of creases) { let dt = Math.abs(th - c); dt = Math.min(dt, Math.PI * 2 - dt); d -= a * Math.exp(-(dt / wdt) * (dt / wdt)) * smooth(0.02, 0.09, y) * (1 - smooth(H - 0.03, H, y) * 0.6); }
    d += 0.0007 * smooth(H - 0.027, H - 0.024, y); // 口の折り返しの段
    return d;
  };
  const bodyPoint = (th, y, dn, out, kind = 1) => {
    const w = smooth(H - 0.07, H, y);
    const yy = y + topMod(th) * w;
    const extra = bulge(th, y) + pinch(th) * w + wrinkle(th, y);
    superPoint(th, A * kind, B * kind, NE, kind > 0.01 ? dn + extra * kind : 0, out);
    out.y = yy;
    return out;
  };
  const cm = canvasMaps();
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cm.map, normalMap: cm.normal, roughnessMap: cm.rough, roughness: 1, vertexColors: true, side: THREE.FrontSide, normalScale: new THREE.Vector2(0.7, 0.7) });
  const geo = paramSurface(128, NV, (u, v, p) => {
    const pr = prof[Math.round(v * NV)];
    bodyPoint(u * Math.PI * 2, pr[2], pr[1], p, pr[0]);
  }, { uLen: 0.032, vLen: 0.032, color: (u, v, p) => {
    const j = Math.round(v * NV);
    if (j > INNER0) return 0.5 + 0.45 * smooth(0, H, p.y); // 内側は暗め
    return 0.86 + 0.14 * smooth(0, 0.03, p.y);
  } });
  const body = new THREE.Mesh(geo, bagMat); inner.add(body);

  // 持ち手（紺のテープ 2本）
  const SW = 0.025, STH = 0.0024, HX = 0.06, LOOP = 0.2;
  const strapGeos = [0, 1].map(() => {
    const NP = 70, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NP + 1) * 8 * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((NP + 1) * 8 * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((NP + 1) * 8 * 2), 2));
    const idx = [];
    for (let i = 0; i < NP; i++) for (let f = 0; f < 4; f++) { const a = i * 8 + f * 2, b = a + 1, c = a + 8, d = c + 1; idx.push(a, c, b, b, c, d); }
    g.setIndex(idx); g.userData.NP = NP; return g;
  });
  const webM = webbingMat();
  const straps = strapGeos.map((g) => { const m = new THREE.Mesh(g, webM); m.frustumCulled = false; inner.add(m); return m; });
  const tmpP = new THREE.Vector3(), tA = new THREE.Vector3();
  const thFor = (x, front) => { const c = Math.pow(Math.min(1, Math.abs(x) / A), NE / 2) * sg(x); const th = Math.acos(c); return front ? th : -th; };
  const apex = new THREE.Vector3();
  const buildStrap = (si, k) => {
    const front = si === 0, zs = front ? 1 : -1;
    const path = [], nrm = [];
    const NFACE = 14;
    // 面に縫い付けた部分（y 0.125 → 口）
    const thL = thFor(-HX, front), thR = thFor(HX, front);
    const top = (th) => bodyPoint(th, H - 0.0005, 0.0013, new THREE.Vector3());
    const PA = top(thL), PB = top(thR);
    const faceSeg = (th, rev) => { const pts = []; for (let i = 0; i <= NFACE; i++) { const t = i / NFACE, y = 0.125 + t * (H - 0.0005 - 0.125); pts.push(bodyPoint(th, y, 0.0013 + 0.0004, new THREE.Vector3())); } return rev ? pts.reverse() : pts; };
    // 輪の部分
    const O = PA.clone().add(PB).multiplyScalar(0.5), xa = PB.clone().sub(PA), hw = xa.length() / 2; xa.normalize();
    const lean1 = -Math.atan2(Math.abs(O.z) - 0.004, LOOP * 0.92), lean0 = 2.55;
    const phi = THREE.MathUtils.lerp(lean0, lean1, k);
    const loop = [], loopN = [];
    const NL = 40;
    for (let i = 1; i < NL; i++) {
      const s = i / NL;
      const lx = -hw * Math.cos(Math.PI * s);
      const lv = LOOP * Math.pow(Math.sin(Math.PI * s), 0.75) * (0.92 + 0.08 * k);
      const ph = phi * smooth(0, 0.06, lv) ; // 根元は立ってから倒れる
      const up = new THREE.Vector3(0, Math.cos(ph), Math.sin(ph) * zs);
      const p = O.clone().addScaledVector(xa, lx).addScaledVector(up, lv);
      p.y -= (1 - k) * 0.03 * Math.pow(Math.sin(Math.PI * s), 1.5);
      if (p.y < STH * 0.6) p.y = STH * 0.6; // カウンターに着いたら寝る
      loop.push(p);
      loopN.push(new THREE.Vector3().crossVectors(xa, up).multiplyScalar(zs).normalize());
    }
    const fa = faceSeg(thL, false), fb = faceSeg(thR, true);
    for (const p of fa) { path.push(p); nrm.push(new THREE.Vector3(0, 0, zs)); }
    for (let i = 0; i < loop.length; i++) { path.push(loop[i]); nrm.push(loopN[i]); }
    for (const p of fb) { path.push(p); nrm.push(new THREE.Vector3(0, 0, zs)); }
    if (k > 0.999 || si === 0) apex.copy(loop[Math.floor(loop.length / 2)]);
    // 面の法線を近い点で補正
    for (let i = 0; i < path.length; i++) if (i < fa.length || i >= fa.length + loop.length) {
      const th = i < fa.length ? thL : thR; const q = bodyPoint(th, path[i].y, 0.01, new THREE.Vector3()); nrm[i].copy(q.sub(bodyPoint(th, path[i].y, 0, new THREE.Vector3()))).normalize();
    }
    const g = strapGeos[si], NP = g.userData.NP;
    const pos = g.attributes.position.array, nr = g.attributes.normal.array, uv = g.attributes.uv.array;
    const M = path.length;
    let acc = 0;
    for (let i = 0; i <= NP; i++) {
      const f = (i / NP) * (M - 1), i0 = Math.floor(f), i1 = Math.min(M - 1, i0 + 1), t = f - i0;
      const p = tmpP.lerpVectors(path[i0], path[i1], t);
      const n = new THREE.Vector3().lerpVectors(nrm[i0], nrm[i1], t).normalize();
      const pn = path[Math.min(M - 1, i1 + (i1 === i0 ? 0 : 0))], pp = path[Math.max(0, i0 - (t < 0.5 ? 1 : 0))];
      const tg = tA.subVectors(path[Math.min(M - 1, i0 + 1)], path[Math.max(0, i0 === i1 ? i0 - 1 : i0)]).normalize();
      const w = new THREE.Vector3().crossVectors(tg, n).normalize();
      n.crossVectors(w, tg).normalize();
      if (i) acc += 1 / NP;
      const corners = [[1, 1], [-1, 1], [-1, 1], [-1, -1], [-1, -1], [1, -1], [1, -1], [1, 1]];
      const fn = [n, n, w.clone().negate(), w.clone().negate(), n.clone().negate(), n.clone().negate(), w, w];
      for (let c = 0; c < 8; c++) {
        const [cw, cn] = corners[c], o = (i * 8 + c) * 3;
        pos[o] = p.x + w.x * cw * SW / 2 + n.x * (cn * STH / 2); pos[o + 1] = p.y + w.y * cw * SW / 2 + n.y * (cn * STH / 2); pos[o + 2] = p.z + w.z * cw * SW / 2 + n.z * (cn * STH / 2);
        nr[o] = fn[c].x; nr[o + 1] = fn[c].y; nr[o + 2] = fn[c].z;
        uv[(i * 8 + c) * 2] = (cw * 0.5 + 0.5); uv[(i * 8 + c) * 2 + 1] = acc * 0.5 / 0.03;
      }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    g.computeBoundingSphere();
  };
  // k=1 の頂点を求める
  buildStrap(0, 1); const apexF = apex.clone(); buildStrap(1, 1); const handleTopLocal = apexF.add(apex).multiplyScalar(0.5);
  let hk = 0, hkT = 0, built = -1;
  buildStrap(0, 0); buildStrap(1, 0); built = 0;
  const cs = contactShadow(0.32, 0.2, 0.55); G.add(cs);
  applyShadows(G);
  let sq = 0, sqV = 0;
  const api = {
    size: { w: W, d: D, h: H },
    mouthLocal: new THREE.Vector3(0, H, 0),
    insideLocal(i) { return new THREE.Vector3(0, T + 0.002 + (i ? 0.056 : 0), 0); },
    setHandles(k) { hkT = clamp01(k); },
    handleTopLocal,
    squash(amount = 0.5) { sqV += 2.2 * amount; },
  };
  G.userData.api = api;
  G.userData.update = (dt) => {
    dt = Math.min(dt, 0.05);
    hk = follow(hk, hkT, dt, 9);
    if (Math.abs(hk - built) > 1e-4) { buildStrap(0, hk); buildStrap(1, hk); built = hk; }
    const w = 22, z = 0.22; sqV += (-w * w * sq - 2 * z * w * sqV) * dt; sq += sqV * dt;
    inner.scale.set(1 + sq * 0.04, 1 - sq * 0.06, 1 + sq * 0.05);
    G.updateWorldMatrix(true, false);
    cs.material.opacity = 0.55 * (1 - clamp01(G.matrixWorld.elements[13] / 0.05));
  };
  return G;
}
