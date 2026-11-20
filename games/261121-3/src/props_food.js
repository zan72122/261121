// お弁当箱と食べ物（写実・手続き生成のみ）。単位 m、Y 上、原点はすべて「置いたときの底面の中心」。
//
// ── 公開 API ───────────────────────────────────────────────────────────────
// createFood(type, scale = 1) → Group
//   type: 'tamago' | 'karaage' | 'wiener' | 'broccoli' | 'tomato' | 'strawberry'
//   userData.food = { type, radius(水平半径), height, soft(0..1 置いたときの弾み) }
//   寸法(scale=1): tamago 0.036×0.024(高)×0.026（切り口は ±X）/ karaage φ≈0.034 高≈0.025
//     wiener 長0.046×太0.016（長さ X、少し Z に反る）/ broccoli 高0.032 房φ0.032
//     tomato φ0.026 高≈0.024 / strawberry 長0.032（横に寝た向き、へたが +X）
//   ジオメトリ・マテリアルは type ごとに共有（何個作っても再生成しない）。
// createRiceLump(size = 0.03) → Group  ごはんのひとかたまり（幅≈size、高≈0.6size）。
// createBento(kind) → Group   kind: 'child' | 'mama'（mama は 1.18 倍、group.scale は 1 のまま実寸で作る）
//   外形 child 0.170(X)×0.108(Z)×0.044(Y)、内側の深さ 0.037、左45%=ごはん室、右=おかず室（底にフリルレタス）
//   userData.update(dt, t)
//   userData.api = {
//     kind, scale, size:{w,d,h},
//     lid (Group, bento の子, 閉じた位置。原点=ふた下端の中心), lidClosedY,
//       ふた: 高さ 0.012×scale のかぶせぶた。child=黄色＋白い水玉、mama=杉の木目
//     setRice(level 0..1) なめらかに追従 / setRiceNow(level) / riceLevel（現在値）
//     riceTopLocal(out?) ごはん上面中心(ローカル) / riceRect {cx, cz, hw, hd}（ローカル XZ）
//     worldToRiceUV(p) → {u, v, inside}   u: -X→+X、v: 奥(-Z)→手前(+Z)、inside は ±0.08 の余裕
//     sprinkle(u, v, c?) → {u, v, c}  c: 0=のり 1=ごま 2=たまご 3=さけ（その色が主の、混ざったひとつまみ）
//                                     c 省略時は (u,v) から決まる色。返り値をそのまま保存すれば setFurikake で再現できる
//     setFurikake(list) / clearFurikake() / drawShape('heart'|'star'|'flower')（いったん消してから中央に大きく描く）
//     slotLocal(i, out?) / slotWorld(i, out?)  i=0..4 おかず室（0,1=奥 左右、2,3,4=手前 左中右）、5=ごはん上面中央
//                       y はおかずの底の高さの目安（place は type ごとに、上がふちの 0.5〜6mm 下に来るよう調整）
//                       slot 5 の y はその時点のごはんの高さ（後から setRice しても載っている物は動かない）
//     nearestSlot(worldPoint, isFree) → i | -1（箱の上 margin 0.03 以内でなければ -1）
//     containsXZ(worldPoint, margin = 0.03)
//     place(food, i) / take(i) → food / items[6]   （place した food の親は api.interior＝bento と同じ座標系）
//     interior (Group) / setInteriorVisible(bool)  ふたを閉じている間は false にする（ごはんの上の物がふたを突き抜けて見えない・中が透けない）
//     applyShake(amount 0..1, seed = 1)（place 時の姿勢を基準に毎回計算し直す＝何度呼んでもよい）
//       amount>0.55 かつ slot5 が空なら tomato が slot5 へ移る（items も移動。これは戻らない）
//   }
// createDessertTub() → Group  φ0.095×高0.045 の半透明の白い容器＋うすい緑のふた
//   userData.api = { lid, lidClosedY, berries:[Group,Group], radius, height }
// ────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, makeNoise, fbm, makeCanvas, canvasTexture, paintPixels, normalFromHeight, shadowAll } from './texutil.js';

// ───────── 小さな道具 ─────────
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function hash3(ix, iy, iz, s) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x1b873593) ^ Math.imul(s + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d, s);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf), x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf), x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}
function fbm3(x, y, z, oct = 3, s = 0) {
  let a = 0.5, f = 1, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return sum / n;
}

/** 法線を計算し、同じ位置にある頂点（UV の継ぎ目など）の法線を平均してなめらかにする */
function smoothSeams(geo) {
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 2e5) + ',' + Math.round(p.getY(i) * 2e5) + ',' + Math.round(p.getZ(i) * 2e5);
    let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(i);
  }
  const v = new THREE.Vector3();
  for (const l of map.values()) {
    if (l.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of l) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of l) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return geo;
}

/** 高さ・色・ラフネスを1パスで描く。fn(x,y) → [r,g,b,height0..1,rough0..1] */
function paintMaps(w, h, fn, { normal = 2, wrap = true } = {}) {
  const [cc, cx] = makeCanvas(w, h), [hc, hx] = makeCanvas(w, h), [rc, rx] = makeCanvas(w, h);
  const ci = cx.createImageData(w, h), hi = hx.createImageData(w, h), ri = rx.createImageData(w, h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const v = fn(x, y);
    ci.data[i] = v[0]; ci.data[i + 1] = v[1]; ci.data[i + 2] = v[2]; ci.data[i + 3] = 255;
    const hh = clamp(v[3], 0, 1) * 255; hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hh; hi.data[i + 3] = 255;
    const rr = clamp(v[4], 0, 1) * 255; ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rr; ri.data[i + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0); rx.putImageData(ri, 0, 0);
  return { map: canvasTexture(cc), normalMap: normalFromHeight(hc, normal, { wrap, data: hi.data }), roughnessMap: canvasTexture(rc, { srgb: false }) };
}
function setWrap(maps, rx = 1, ry = 1) {
  for (const k in maps) { const t = maps[k]; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
  return maps;
}

const cache = new Map();
const cached = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

// ───────── 角丸長方形のスイープ（箱・ふた） ─────────
function rrOutline(w, d, r, K = 8) {
  const hx = w / 2 - r, hz = d / 2 - r, pts = [];
  const sg = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let c = 0; c < 4; c++) for (let k = 0; k <= K; k++) {
    const a = c * Math.PI / 2 + (k / K) * Math.PI / 2;
    pts.push({ cx: sg[c][0] * hx, cz: sg[c][1] * hz, nx: Math.cos(a), nz: Math.sin(a) });
  }
  return { pts, r, w, d };
}
/** prof: [[o(内向きの距離), y], ...]。uvScale m で 1 */
function sweepGeo(ol, prof, uvScale = 0.15) {
  const N = ol.pts.length, P = prof.length, pos = [], uv = [], idx = [];
  const at = (i, o) => { const p = ol.pts[i % N], rr = ol.r - o; return [p.cx + p.nx * rr, p.cz + p.nz * rr]; };
  const ulen = [0];
  for (let i = 1; i <= N; i++) { const a = at(i - 1, 0), b = at(i, 0); ulen.push(ulen[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  let vl = 0;
  for (let j = 0; j < P; j++) {
    if (j > 0) vl += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
    for (let i = 0; i <= N; i++) { const [x, z] = at(i, prof[j][0]); pos.push(x, prof[j][1], z); uv.push(ulen[i] / uvScale, vl / uvScale); }
  }
  for (let j = 0; j < P - 1; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, d = a + N + 1, c = d + 1;
    idx.push(a, d, b, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothSeams(g);
}
/** 平らな面（角丸長方形）。uvRect=[x0,z0,sx,sz] */
function capGeo(ol, o, y, up, uvRect) {
  const N = ol.pts.length, pos = [], nor = [], uv = [], idx = [], contour = [];
  const [x0, z0, sx, sz] = uvRect;
  for (let i = 0; i < N; i++) {
    const p = ol.pts[i], rr = ol.r - o, x = p.cx + p.nx * rr, z = p.cz + p.nz * rr;
    pos.push(x, y, z); nor.push(0, up ? 1 : -1, 0); uv.push((x - x0) / sx, 1 - (z - z0) / sz);
    contour.push(new THREE.Vector2(x, z));
  }
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) {
    // (x,z) の向きから上向き/下向きをそろえる
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
    const ny = (cx - ax) * (bz - az) - (cz - az) * (bx - ax); // (b-a)x(c-a) の y 成分
    const isUp = ny < 0 ? false : true;
    if (isUp === up) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function arcPts(out, cx, cy, r, a0, a1, n, skipFirst = false) {
  for (let k = skipFirst ? 1 : 0; k <= n; k++) { const a = lerp(a0, a1, k / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

// ───────── テクスチャ ─────────
// ごはん粒（タイル 0.030 m）
const RICE_TILE = 0.030;
function riceMaps() {
  return cached('tex:rice', () => {
    const S = 512, mm = S / (RICE_TILE * 1000);
    const [cc, cx] = makeCanvas(S), [hc, hx] = makeCanvas(S);
    cx.fillStyle = '#d6d0c4'; cx.fillRect(0, 0, S, S);
    hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
    const r = rng(77);
    const grains = [];
    for (let i = 0; i < 300; i++) grains.push({ x: r() * S, y: r() * S, a: r() * Math.PI, l: (2.3 + r() * 0.7) * mm, w: (1.25 + r() * 0.3) * mm, t: r() });
    const offs = [-S, 0, S];
    for (const g of grains) for (const ox of offs) for (const oy of offs) {
      const x = g.x + ox, y = g.y + oy;
      if (x < -g.l * 1.3 || x > S + g.l * 1.3 || y < -g.l * 1.3 || y > S + g.l * 1.3) continue;
      // 影
      cx.save(); cx.translate(x + 0.35 * mm, y + 0.45 * mm); cx.rotate(g.a); cx.scale(1, g.w / g.l);
      cx.fillStyle = 'rgba(150,140,122,0.22)'; cx.beginPath(); cx.arc(0, 0, g.l * 1.04, 0, Math.PI * 2); cx.fill(); cx.restore();
      // 粒
      cx.save(); cx.translate(x, y); cx.rotate(g.a); cx.scale(1, g.w / g.l);
      const gr = cx.createRadialGradient(-g.l * 0.15, -g.l * 0.25, 0, 0, 0, g.l);
      const tw = Math.round(g.t * 10);
      gr.addColorStop(0, `rgb(${255},${255},${252 - tw})`);
      gr.addColorStop(0.6, `rgb(${250 - tw},${249 - tw},${243 - tw})`);
      gr.addColorStop(0.9, `rgb(${240 - tw},${237 - tw},${228 - tw})`);
      gr.addColorStop(1, `rgb(${226 - tw},${221 - tw},${210 - tw})`);
      cx.fillStyle = gr; cx.beginPath(); cx.arc(0, 0, g.l, 0, Math.PI * 2); cx.fill(); cx.restore();
      // 高さ
      hx.save(); hx.translate(x, y); hx.rotate(g.a); hx.scale(1, g.w / g.l);
      const hg = hx.createRadialGradient(0, 0, 0, 0, 0, g.l);
      const base = 120 + g.t * 60 | 0;
      hg.addColorStop(0, `rgb(${base + 70},${base + 70},${base + 70})`);
      hg.addColorStop(0.7, `rgb(${base + 45},${base + 45},${base + 45})`);
      hg.addColorStop(1, `rgb(${base - 20},${base - 20},${base - 20})`);
      hx.fillStyle = hg; hx.beginPath(); hx.arc(0, 0, g.l, 0, Math.PI * 2); hx.fill(); hx.restore();
    }
    // ラフネス（すきまはマット、粒は少しつや）
    const hd = hx.getImageData(0, 0, S, S).data;
    const rc = paintPixels(S, S, (x, y) => { const h = hd[(y * S + x) * 4] / 255; const v = (0.78 - h * 0.45) * 255; return [v, v, v]; });
    return { map: canvasTexture(cc), normalMap: normalFromHeight(hc, 1.8, { data: hd }), roughnessMap: canvasTexture(rc, { srgb: false }) };
  });
}
function riceMaterial(rx, ry, key) {
  return cached('mat:rice:' + key, () => {
    const b = riceMaps();
    const m = {};
    for (const k in b) { const t = b[k].clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true; m[k] = t; }
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: m.map, normalMap: m.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: m.roughnessMap, roughness: 1, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 });
  });
}

function lettuceMaps() {
  return cached('tex:lettuce', () => {
    const n = makeNoise(11, 8), n2 = makeNoise(12, 32);
    const S = 256;
    return paintMaps(S, S, (x, y) => {
      const u = x / S, v = y / S;
      // 葉の付け根（左手前）から放射する葉脈（太い主脈＋細い側脈）、間はちぢれ
      const dx = u + 0.2, dy = 1.2 - v, ang = Math.atan2(dy, dx), rad = Math.hypot(dx, dy);
      const w = fbm(n, u * 8, v * 8, 3);
      const f1 = ang * 4.2 + w * 0.5, r1 = Math.abs(f1 - Math.round(f1));
      const f2 = ang * 11 + w * 0.9 + rad * 1.5, r2 = Math.abs(f2 - Math.round(f2));
      const main = smooth(0.07, 0.0, r1 / Math.max(0.4, rad)), side = smooth(0.05, 0.0, r2) * 0.55 * smooth(0.2, 0.6, rad);
      const vein = Math.max(main, side);
      const crink = 1 - Math.abs(fbm(n2, u * 32, v * 32, 3) * 2 - 1);
      const tone = fbm(n2, u * 8 + 5, v * 8, 2);
      let col = mixc([92, 150, 42], [120, 176, 56], tone);
      col = mixc(col, [70, 124, 34], smooth(0.55, 0.9, crink) * 0.35);
      col = mixc(col, [180, 218, 118], vein * 0.5);
      return [col[0], col[1], col[2], 0.35 + vein * 0.3 + crink * 0.35, 0.68 - vein * 0.12];
    }, { normal: 2.2 });
  });
}

// ───────── 食べ物 ─────────
function foodProto(type) {
  return cached('food:' + type, () => {
    const inner = new THREE.Group();
    const meta = FOOD_BUILDERS[type](inner);
    // 底面中心を原点に
    inner.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(inner);
    inner.position.x -= (bb.min.x + bb.max.x) / 2;
    inner.position.z -= (bb.min.z + bb.max.z) / 2;
    inner.position.y -= bb.min.y;
    const g = new THREE.Group();
    g.add(inner);
    shadowAll(g);
    const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    return { g, radius, height: bb.max.y - bb.min.y, soft: meta.soft };
  });
}

export function createFood(type, scale = 1) {
  const p = foodProto(type);
  const g = p.g.clone();
  g.scale.setScalar(scale);
  g.name = 'food:' + type;
  g.userData.food = { type, radius: p.radius * scale, height: p.height * scale, soft: p.soft };
  return g;
}

function sepalGeo(profile, n, len, width, lift, seed, droop = 0) {
  // profile(s) → [r, y]：上中心から表面に沿って s 進んだ点（回転体）
  const r = rng(seed), pos = [], idx = [];
  const A = 8, C = 4;
  for (let k = 0; k < n; k++) {
    const ph = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5, L = len * (0.8 + r() * 0.35), Wd = width * (0.85 + r() * 0.3);
    const dir = [Math.cos(ph), Math.sin(ph)], side = [-Math.sin(ph), Math.cos(ph)];
    const tw = (r() - 0.5) * 0.4, lf = lift * (0.6 + r() * 0.8);
    const base = pos.length / 3;
    for (let a = 0; a <= A; a++) {
      const t = a / A, s = 0.0006 + t * L;
      const [rr, yy] = profile(s);
      const hw = (Wd / 2) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.65)), 0.85) + 0.00025 * (1 - t);
      for (let c = 0; c <= C; c++) {
        const q = (c / C) * 2 - 1;
        const sw = q * hw, sang = tw * t;
        const sx = side[0] * Math.cos(sang) - dir[0] * Math.sin(sang), sz = side[1] * Math.cos(sang) - dir[1] * Math.sin(sang);
        const x = dir[0] * rr + sx * sw, z = dir[1] * rr + sz * sw;
        const y = yy + 0.0003 + lf * t * t - Math.abs(q) * 0.00025 + droop * Math.sin(t * Math.PI) * 0.0;
        pos.push(x, y, z);
      }
    }
    for (let a = 0; a < A; a++) for (let c = 0; c < C; c++) {
      const i0 = base + a * (C + 1) + c, i1 = i0 + 1, i2 = i0 + C + 1, i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function calyxMat() {
  return cached('mat:calyx', () => {
    const n = makeNoise(5, 8);
    const maps = paintMaps(64, 64, (x, y) => { const f = fbm(n, x / 8, y / 8, 3); const c = mixc([52, 96, 30], [92, 138, 46], f); return [c[0], c[1], c[2], f, 0.55]; }, { normal: 1 });
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: maps.map, normalMap: maps.normalMap, roughness: 0.6, side: THREE.DoubleSide });
  });
}

const FOOD_BUILDERS = {
  tamago(g) {
    const outer = (() => {
      const n = makeNoise(21, 6), n2 = makeNoise(22, 48);
      return setWrap(paintMaps(160, 160, (x, y) => {
        const u = x / 160, v = y / 160;
        const b = fbm(n, u * 6, v * 6, 3), sp = n2(u * 48, v * 48), st = fbm(n, u * 2 + 3, v * 12, 3);
        const burn = smooth(0.5, 0.8, b * 0.6 + st * 0.4);
        let c = mixc([240, 178, 28], [232, 164, 22], sp);
        c = mixc(c, [196, 118, 30], burn * 0.8);
        c = mixc(c, [246, 200, 70], smooth(0.35, 0.15, b) * 0.5);
        return [c[0], c[1], c[2], 0.5 + (b - 0.5) * 0.5 + sp * 0.12, 0.5 - burn * 0.12];
      }, { normal: 2 }));
    })();
    const cut = (() => {
      const S = 256;
      const [cc, cx] = makeCanvas(S), [hc, hx] = makeCanvas(S);
      const gr = cx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
      gr.addColorStop(0, '#f8d662'); gr.addColorStop(1, '#f0c040');
      cx.fillStyle = gr; cx.fillRect(0, 0, S, S);
      hx.fillStyle = '#999'; hx.fillRect(0, 0, S, S);
      const r = rng(31);
      // 巻いた層のうずまき（角の丸い四角のうずまき）
      const spiral = (ctx, col, lw, off) => {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        const turns = 4.2, steps = 600;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, ph = t * turns * Math.PI * 2 + 0.6;
          const k = 1 - t * 0.9;
          const hxs = (S / 2 - 6) * k, hys = (S / 2 - 6) * k;
          const c = Math.cos(ph), s = Math.sin(ph);
          const p = 0.8;
          const x = S / 2 + off + hxs * Math.sign(c) * Math.pow(Math.abs(c), p);
          const y = S / 2 + off + hys * Math.sign(s) * Math.pow(Math.abs(s), p) + Math.sin(ph * 2.3 + t * 9) * 3;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      spiral(cx, 'rgba(222,160,50,0.45)', 2.4, 0);
      spiral(cx, 'rgba(255,246,196,0.45)', 2.2, 2.6);
      spiral(hx, '#6a6a6a', 3, 0);
      // 小さな気泡
      for (let i = 0; i < 60; i++) {
        const x = r() * S, y = r() * S, rr = 0.8 + r() * 2;
        cx.fillStyle = 'rgba(232,186,80,0.35)'; cx.beginPath(); cx.arc(x, y, rr, 0, 7); cx.fill();
        hx.fillStyle = '#666'; hx.beginPath(); hx.arc(x, y, rr, 0, 7); hx.fill();
      }
      // ふちの焼き色
      cx.strokeStyle = 'rgba(214,156,60,0.4)'; cx.lineWidth = 10; cx.strokeRect(0, 0, S, S);
      return { map: canvasTexture(cc), normalMap: normalFromHeight(hc, 2.5, { wrap: false }) };
    })();
    const geo = new RoundedBoxGeometry(0.036, 0.024, 0.026, 4, 0.0068);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = (noise3(x * 160, y * 160, z * 160, 3) - 0.5) * 0.0011;
      // 上面は少しふくらみ、底は平ら
      const bulge = y > 0 ? 0.0009 * (1 - (x / 0.018) ** 2) * (1 - (z / 0.013) ** 2) : 0;
      p.setXYZ(i, x + d * Math.sign(x) * 0.6, y + bulge + (y > 0 ? d : 0), z + d * Math.sign(z) * 0.6);
    }
    smoothSeams(geo);
    const mOut = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: outer.map, normalMap: outer.normalMap, roughnessMap: outer.roughnessMap, roughness: 0.9, clearcoat: 0.15, clearcoatRoughness: 0.5 });
    const mCut = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: cut.map, normalMap: cut.normalMap, roughness: 0.62 });
    const mesh = new THREE.Mesh(geo, [mCut, mCut, mOut, mOut, mOut, mOut]);
    mesh.position.y = 0.012;
    g.add(mesh);
    return { soft: 0.6 };
  },

  karaage(g) {
    const maps = (() => {
      const n = makeNoise(41, 8), n2 = makeNoise(42, 64), n3 = makeNoise(43, 32);
      return setWrap(paintMaps(512, 256, (x, y) => {
        const u = x / 512, v = y / 256;
        const c0 = fbm(n, u * 8, v * 4, 3);
        const cr = n2(u * 64, v * 32), cr2 = fbm(n3, u * 32, v * 16, 2);
        let c = mixc([118, 56, 18], [200, 124, 48], smooth(0.28, 0.72, c0));
        c = mixc(c, [232, 170, 86], smooth(0.68, 0.9, cr) * 0.7);
        c = mixc(c, [84, 38, 14], smooth(0.3, 0.12, cr2) * 0.8);
        const h = c0 * 0.45 + cr * 0.35 + cr2 * 0.3;
        const rough = 0.32 + 0.45 * smooth(0.35, 0.7, fbm(n3, u * 8 + 3, v * 4, 2));
        return [c[0], c[1], c[2], h, rough];
      }, { normal: 5 }), 1, 1);
    })();
    const geo = new THREE.SphereGeometry(1, 44, 30);
    geo.rotateZ(Math.PI / 2);
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const big = fbm3(x * 1.3 + 4, y * 1.3, z * 1.3, 2, 5) - 0.5;
      const mid = fbm3(x * 3.5, y * 3.5 + 2, z * 3.5, 2, 6) - 0.5;
      const sm = noise3(x * 9, y * 9, z * 9, 7) - 0.5;
      const k = 1 + big * 0.55 + mid * 0.22 + sm * 0.07;
      let X = x * 0.0172 * k, Y = y * 0.0128 * k, Z = z * 0.0158 * k;
      if (Y < -0.0085) Y = -0.0085 + (Y + 0.0085) * 0.25;
      p.setXYZ(i, X, Y, Z);
      const cav = clamp(0.78 + (mid * 0.22 + sm * 0.07) * 6 + big * 0.6, 0.5, 1.12);
      col.push(cav, cav * 0.96, cav * 0.93);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    smoothSeams(geo);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughnessMap: maps.roughnessMap, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    g.add(new THREE.Mesh(geo, mat));
    return { soft: 0.3 };
  },

  wiener(g) {
    const L = 0.046, R = 0.008;
    const maps = (() => {
      const n = makeNoise(51, 8), n2 = makeNoise(52, 32);
      const W = 128, H = 256;
      const cuts = [0.33, 0.5, 0.67];
      return paintMaps(W, H, (x, y) => {
        const u = x / W, v = y / H;
        const f = fbm(n, u * 8, v * 8, 3), f2 = n2(u * 32, v * 32);
        let c = mixc([138, 30, 20], [178, 56, 32], f);
        c = mixc(c, [190, 74, 44], smooth(0.75, 1, f2) * 0.3);
        let h = 0.5 + f2 * 0.06, rough = 0.32;
        // 両端の皮のしわ
        const endk = Math.max(smooth(0.13, 0.03, v), smooth(0.87, 0.97, v));
        h += endk * 0.15 * Math.sin(u * Math.PI * 2 * 14 + f * 6);
        c = mixc(c, [120, 26, 16], endk * 0.4);
        // 斜めの切れ目（上側 u≈0.5）
        const du = Math.abs(u - 0.5);
        if (du < 0.2) {
          for (const vc of cuts) {
            const dist = Math.abs((v - vc) - 0.55 * (u - 0.5)) * H;
            const w = 4.6 * (1 - Math.pow(du / 0.2, 2));
            if (dist < w) {
              const k = dist / w;
              c = mixc([214, 138, 104], [176, 84, 58], k);
              h = 0.15 + k * 0.2; rough = 0.62;
            } else if (dist < w + 2.6) {
              const k = (dist - w) / 2.6;
              c = mixc([110, 22, 14], c, k);
              h = 0.75 - k * 0.2;
            }
          }
        }
        return [c[0], c[1], c[2], h, rough];
      }, { normal: 2.5, wrap: false });
    })();
    // 断面の半径の並び（両端は半球）
    const samples = [];
    const cap = 9;
    for (let k = 0; k <= cap; k++) { const a = -Math.PI / 2 + (k / cap) * Math.PI / 2; samples.push([-(L / 2 - R) + R * Math.sin(a), R * Math.cos(a)]); }
    const mid = 22;
    for (let k = 1; k < mid; k++) samples.push([-(L / 2 - R) + (k / mid) * (L - 2 * R), R]);
    for (let k = 0; k <= cap; k++) { const a = (k / cap) * Math.PI / 2; samples.push([(L / 2 - R) + R * Math.sin(a), R * Math.cos(a)]); }
    const M = 30, pos = [], uv = [], idx = [];
    let tot = 0; const sl = [0];
    for (let j = 1; j < samples.length; j++) { tot += Math.hypot(samples[j][0] - samples[j - 1][0], samples[j][1] - samples[j - 1][1]); sl.push(tot); }
    const bend = 0.0045;
    for (let j = 0; j < samples.length; j++) {
      const [s, rr0] = samples[j];
      const t = s / (L / 2);
      // 中心線: XZ 面で弧
      const cz = bend * (1 - t * t), dz = -2 * bend * t / (L / 2);
      const tl = Math.hypot(1, dz), nx = -dz / tl, nz = 1 / tl; // 水平の横方向
      for (let i = 0; i <= M; i++) {
        const u = i / M, a = u * Math.PI * 2 + Math.PI;
        const pinch = 1 - 0.05 * smooth(0.75, 1, Math.abs(t));
        const rr = rr0 * pinch;
        let y = Math.cos(a) * rr, sd = Math.sin(a) * rr;
        if (y < -R * 0.92) y = -R * 0.92 + (y + R * 0.92) * 0.3;
        pos.push(s + nx * sd, y + R, cz + nz * sd);
        uv.push(u, 1 - sl[j] / tot);
      }
    }
    for (let j = 0; j < samples.length - 1; j++) for (let i = 0; i < M; i++) {
      const a = j * (M + 1) + i, b = a + 1, d = a + M + 1, c = d + 1;
      idx.push(a, b, d, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    smoothSeams(geo);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap: maps.roughnessMap, roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.18 });
    g.add(new THREE.Mesh(geo, mat));
    return { soft: 0.45 };
  },

  broccoli(g) {
    const bud = (() => {
      const S = 256;
      const [cc, cx] = makeCanvas(S), [hc, hx] = makeCanvas(S);
      cx.fillStyle = '#3a5a2a'; cx.fillRect(0, 0, S, S);
      hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
      const r = rng(61);
      for (let i = 0; i < 1100; i++) {
        const x0 = r() * S, y0 = r() * S, rad = 2.6 + r() * 3.4, t = r();
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const x = x0 + ox, y = y0 + oy;
          if (x < -8 || x > S + 8 || y < -8 || y > S + 8) continue;
          const gr = cx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
          const l = 0.85 + t * 0.3;
          gr.addColorStop(0, `rgb(${170 * l | 0},${200 * l | 0},${120 * l | 0})`);
          gr.addColorStop(0.55, `rgb(${128 * l | 0},${168 * l | 0},${92 * l | 0})`);
          gr.addColorStop(1, `rgb(${70 * l | 0},${100 * l | 0},${56 * l | 0})`);
          cx.fillStyle = gr; cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.fill();
          const hg = hx.createRadialGradient(x, y, 0, x, y, rad);
          hg.addColorStop(0, '#fff'); hg.addColorStop(1, '#333');
          hx.fillStyle = hg; hx.beginPath(); hx.arc(x, y, rad, 0, 7); hx.fill();
        }
      }
      const m = { map: canvasTexture(cc), normalMap: normalFromHeight(hc, 2.5) };
      return setWrap(m, 12, 6);
    })();
    const geo = new THREE.SphereGeometry(1, 48, 30);
    geo.rotateZ(Math.PI / 2);
    const lobes = [], lr = rng(64);
    for (let k = 0; k < 15; k++) {
      const yy = 1 - (k + 0.5) / 15 * 1.0, rad = Math.sqrt(Math.max(0, 1 - yy * yy)), a = k * 2.39996 + lr() * 0.3;
      lobes.push([Math.cos(a) * rad, yy, Math.sin(a) * rad, 0.42 + lr() * 0.1]);
    }
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let b = 0;
      for (const L of lobes) { const d = Math.acos(clamp(x * L[0] + y * L[1] + z * L[2], -1, 1)); const v = 1 - Math.min(1, d / L[3]) ** 2; if (v > b) b = v; }
      const up = smooth(-0.3, 0.12, y);
      const sm = noise3(x * 9, y * 9, z * 9, 9) - 0.5;
      const k = 1 + (0.3 * Math.pow(b, 0.6) - 0.2) * up + sm * 0.035 * up;
      const X = x * 0.0175 * k, Z = z * 0.0165 * k;
      const Y = y > 0 ? y * 0.0135 * k : y * 0.0048;
      p.setXYZ(i, X, Y + 0.019, Z);
      // 頂点色: 房は緑、房の間の谷は暗く、下側は薄い黄緑
      const cr = 0.35 + 0.75 * Math.pow(b, 0.6);
      const top = [0.62 * cr, 0.8 * cr, 0.5 * cr], low = [1.15, 1.2, 0.85];
      const c = mixc(low, top, up);
      col.push(c[0], c[1], c[2]);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    smoothSeams(geo);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: bud.map, normalMap: bud.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.82 });
    g.add(new THREE.Mesh(geo, crownMat));
    const stemMaps = (() => {
      const n = makeNoise(62, 16);
      return setWrap(paintMaps(64, 128, (x, y) => { const f = n(x / 4, y / 32 * 4); const c = mixc([150, 186, 96], [184, 210, 128], f); return [c[0], c[1], c[2], f, 0.55]; }, { normal: 1.5 }), 1, 1);
    })();
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stemMaps.map, normalMap: stemMaps.normalMap, roughness: 0.55 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0044, 0.0054, 0.019, 14, 2), stemMat);
    stem.position.y = 0.0095; stem.rotation.z = 0.08;
    g.add(stem);
    for (const [a, tz] of [[0.55, 0.4], [-0.6, -0.3], [0.1, 2.2]]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0026, 0.011, 10, 1), stemMat);
      br.position.set(Math.sin(a) * 0.0035, 0.0145, Math.sin(tz) * 0.002);
      br.rotation.set(Math.sin(tz) * 0.5, 0, -a);
      g.add(br);
    }
    return { soft: 0.5 };
  },

  tomato(g) {
    const R = 0.013, sy = 0.9;
    const maps = (() => {
      const n = makeNoise(71, 8);
      return paintMaps(128, 64, (x, y) => {
        const u = x / 128, v = y / 64;
        const f = fbm(n, u * 8, v * 4, 3);
        let c = mixc([184, 18, 10], [206, 30, 14], f);
        const st = Math.pow(Math.abs(Math.sin(u * Math.PI * 5 + f)), 6) * smooth(0.45, 0.05, v);
        c = mixc(c, [222, 84, 26], st * 0.5 + smooth(0.12, 0.0, v) * 0.4);
        return [c[0], c[1], c[2], 0.5 + f * 0.1, 0.25];
      }, { normal: 0.6, wrap: false });
    })();
    const geo = new THREE.SphereGeometry(1, 40, 28);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const th = Math.acos(clamp(y, -1, 1)), ph = Math.atan2(z, x);
      const lobe = 1 + 0.018 * Math.cos(5 * ph) * Math.sin(th);
      let X = x * R * lobe, Y = y * R * sy, Z = z * R * lobe;
      Y -= 0.0022 * Math.exp(-(th * th) / 0.09);
      if (Y < -R * sy * 0.94) Y = -R * sy * 0.94 + (Y + R * sy * 0.94) * 0.3;
      p.setXYZ(i, X, Y + R * sy, Z);
    }
    smoothSeams(geo);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: maps.map, normalMap: maps.normalMap, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
    g.add(new THREE.Mesh(geo, mat));
    const prof = (s) => { const th = s / R; return [R * Math.sin(th), R * sy + R * sy * Math.cos(th) - 0.0022 * Math.exp(-(th * th) / 0.09)]; };
    const cal = new THREE.Mesh(sepalGeo(prof, 5, 0.0085, 0.0034, 0.0012, 7), calyxMat());
    g.add(cal);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.001, 0.0045, 8), calyxMat());
    st.position.set(0.0003, R * sy * 2 - 0.0022 + 0.0018, 0); st.rotation.z = -0.35;
    g.add(st);
    return { soft: 0.2 };
  },

  strawberry(g) {
    const H = 0.032;
    // 輪郭 (r, y) mm
    const mm = [[0, 0], [1.4, 0.4], [3.2, 2], [5.4, 5.2], [7.6, 9.4], [9.6, 14], [11.2, 18.8], [12.2, 23], [12.3, 26.4], [11.4, 29], [9.2, 30.8], [6, 31.9], [2.6, 31.8], [0, 31.2]];
    const curve = new THREE.SplineCurve(mm.map(([r, y]) => new THREE.Vector2(r * 0.001, y * 0.001 * (H / 0.032))));
    const pts = curve.getSpacedPoints(30);
    pts[0].x = 0; pts[pts.length - 1].x = 0;
    const maps = (() => {
      const W = 192, Hh = 192, cols = 22, rows = 13;
      const n = makeNoise(81, 8);
      return paintMaps(W, Hh, (x, y) => {
        const u = x / W, v = 1 - y / Hh; // v: 0=先、1=上
        const f = fbm(n, u * 8, v * 8, 3);
        const rv = (v - 0.06) / 0.82 * rows, ri = Math.round(rv);
        let best = 9, bx = 0, by = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = ri + dr; if (rr < 0 || rr > rows) continue;
          const cu = (u * cols + (rr % 2) * 0.5), ci = Math.round(cu);
          const ddx = (cu - ci) * (69 / cols) * (0.4 + 0.6 * Math.sin(Math.PI * clamp(v * 0.9 + 0.1, 0, 1))), ddy = (rv - rr) * (26 / rows);
          const d = Math.hypot(ddx, ddy);
          if (d < best) { best = d; bx = ddx; by = ddy; }
        }
        let c = mixc([176, 12, 28], [204, 26, 40], f);
        c = mixc(c, [214, 74, 70], smooth(0.8, 0.97, v) * 0.6);
        c = mixc(c, [170, 14, 26], smooth(0.12, 0.0, v) * 0.3);
        let h = 0.6 + f * 0.05, rough = 0.3;
        if (v > 0.03 && v < 0.93) {
          const dimple = Math.exp(-(best * best) / 0.5);
          h -= dimple * 0.35;
          c = mixc(c, [140, 8, 22], dimple * 0.35);
          const seed = Math.hypot(bx * 1.6, by * 0.9);
          if (seed < 0.42) { const k = seed / 0.42; c = mixc([236, 206, 104], [196, 150, 60], k); h = 0.5 + (1 - k) * 0.15; rough = 0.5; }
        }
        return [c[0], c[1], c[2], h, rough];
      }, { normal: 3.5, wrap: false });
    })();
    const geo = new THREE.LatheGeometry(pts, 44);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (noise3(x * 200, y * 120, z * 200, 4) - 0.5) * 0.06;
      p.setXYZ(i, x * 1.04 * k, y, z * 0.96 * k);
    }
    smoothSeams(geo);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.15 });
    const body = new THREE.Group();
    body.add(new THREE.Mesh(geo, mat));
    // へた: 上中心から外へ表面に沿う
    const top = pts.slice().reverse();
    const arc = [0]; for (let i = 1; i < top.length; i++) arc.push(arc[i - 1] + top[i].distanceTo(top[i - 1]));
    const prof = (s) => {
      let i = 1; while (i < arc.length - 1 && arc[i] < s) i++;
      const t = clamp((s - arc[i - 1]) / (arc[i] - arc[i - 1]), 0, 1);
      return [lerp(top[i - 1].x, top[i].x, t), lerp(top[i - 1].y, top[i].y, t)];
    };
    body.add(new THREE.Mesh(sepalGeo(prof, 8, 0.0105, 0.0036, 0.0018, 9), calyxMat()));
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0011, 0.006, 8), calyxMat());
    st.position.set(0, H - 0.0006 + 0.003, 0); st.rotation.x = 0.2;
    body.add(st);
    body.rotation.z = -1.28;
    g.add(body);
    return { soft: 0.3 };
  },
};

// ───────── ごはんのひとかたまり ─────────
export function createRiceLump(size = 0.03) {
  const key = Math.round(size * 1e4);
  const p = cached('lump:' + key, () => {
    const R = size / 2;
    const geo = new THREE.SphereGeometry(1, 32, 20);
    geo.rotateZ(Math.PI / 2);
    const disp = (x, y, z) => {
      const k = 1 + (fbm3(x * 1.6, y * 1.6, z * 1.6, 2, 31) - 0.5) * 0.5;
      let X = x * R * k, Y = y * R * 0.62 * k, Z = z * R * 0.92 * k;
      if (Y < -R * 0.3) Y = -R * 0.3 + (Y + R * 0.3) * 0.15;
      return [X, Y + R * 0.34, Z];
    };
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) { const v = disp(pp.getX(i), pp.getY(i), pp.getZ(i)); pp.setXYZ(i, v[0], v[1], v[2]); }
    smoothSeams(geo);
    const mat = riceMaterial(size / RICE_TILE * 1.6, size / RICE_TILE * 0.8, 'lump' + key);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    // 表面の粒
    const grainGeo = cached('geo:grain', () => { const q = new THREE.SphereGeometry(1, 10, 6); q.scale(0.0024, 0.00115, 0.0012); return q; });
    const grainMat = cached('mat:grain', () => new THREE.MeshPhysicalMaterial({ color: 0xf8f6f0, roughness: 0.42, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }));
    const n = Math.round(clamp((size * size) / 0.0009 * 70, 24, 160));
    const im = new THREE.InstancedMesh(grainGeo, grainMat, n);
    const r = rng(key + 3), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let x, y, z;
      do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1 || y < -0.25);
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const d = disp(x, y, z);
      nrm.set(x, y / 0.62, z / 0.92).normalize();
      v.set(d[0], d[1], d[2]).addScaledVector(nrm, -0.0004);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2));
      s.setScalar(0.85 + r() * 0.3);
      m.compose(v, q, s);
      im.setMatrixAt(i, m);
    }
    g.add(im);
    shadowAll(g);
    return g;
  });
  const g = p.clone();
  g.name = 'riceLump';
  return g;
}

// ───────── ふりかけの粒（canvas に描く） ─────────
const FURI_W = [0.34, 0.26, 0.22, 0.18];
function pickC(r) { let x = r(); for (let i = 0; i < 4; i++) { if ((x -= FURI_W[i]) < 0) return i; } return 0; }
function drawGrain(ctx, x, y, c, r, mm) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI * 2);
  const poly = (rad, nv, irr, sx = 1) => {
    ctx.beginPath();
    for (let k = 0; k < nv; k++) { const a = (k / nv) * Math.PI * 2, rr = rad * (1 - irr + r() * irr); const px = Math.cos(a) * rr * sx, py = Math.sin(a) * rr; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  };
  const shadow = (f) => { ctx.save(); ctx.translate(0.25 * mm, 0.3 * mm); ctx.fillStyle = 'rgba(90,75,50,0.28)'; f(); ctx.fill(); ctx.restore(); };
  if (c === 0) { // のり
    const s = (0.55 + r() * 0.9) * mm, sx = 0.6 + r() * 0.9, nv = 5 + (r() * 3 | 0);
    const st = r(); // 形を2回描くため同じ乱数列を使う
    const rr2 = rng((st * 1e9) | 0);
    const draw = () => { ctx.beginPath(); for (let k = 0; k < nv; k++) { const a = (k / nv) * Math.PI * 2, rr = s * (0.45 + rr2() * 0.55); const px = Math.cos(a) * rr * sx, py = Math.sin(a) * rr; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); };
    const seed = (st * 1e9) | 0;
    shadow(() => { const t = rng(seed); ctx.beginPath(); for (let k = 0; k < nv; k++) { const a = (k / nv) * Math.PI * 2, rr = s * (0.45 + t() * 0.55); const px = Math.cos(a) * rr * sx, py = Math.sin(a) * rr; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); });
    draw();
    const l = r() * 14 | 0;
    ctx.fillStyle = `rgb(${22 + l},${34 + l},${18 + l})`; ctx.fill();
    ctx.strokeStyle = 'rgba(110,130,80,0.35)'; ctx.lineWidth = Math.max(0.6, 0.12 * mm); ctx.stroke();
  } else if (c === 1) { // ごま
    const a = (1.2 + r() * 0.25) * mm, b = a * (0.55 + r() * 0.08);
    const tear = () => { ctx.beginPath(); ctx.moveTo(-a, 0); ctx.bezierCurveTo(-a * 0.6, -b * 1.15, a * 0.7, -b * 1.05, a, 0); ctx.bezierCurveTo(a * 0.7, b * 1.05, -a * 0.6, b * 1.15, -a, 0); ctx.closePath(); };
    shadow(tear);
    tear();
    const gr = ctx.createRadialGradient(-a * 0.15, -b * 0.3, 0, 0, 0, a);
    const l = r() * 18 | 0;
    gr.addColorStop(0, `rgb(${246 - l},${232 - l},${196 - l})`); gr.addColorStop(0.7, `rgb(${222 - l},${196 - l},${142 - l})`); gr.addColorStop(1, `rgb(${180 - l},${150 - l},${98 - l})`);
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,70,0.5)'; ctx.lineWidth = Math.max(0.5, 0.08 * mm); ctx.beginPath(); ctx.moveTo(-a * 0.7, 0); ctx.lineTo(a * 0.75, 0); ctx.stroke();
  } else if (c === 2) { // たまご
    const s = (0.45 + r() * 0.55) * mm;
    shadow(() => { ctx.beginPath(); ctx.arc(0, 0, s, 0, 7); });
    poly(s, 7, 0.35, 0.8 + r() * 0.4);
    const gr = ctx.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.1);
    gr.addColorStop(0, '#fde27a'); gr.addColorStop(0.6, '#f4c32e'); gr.addColorStop(1, '#d99a1a');
    ctx.fillStyle = gr; ctx.fill();
  } else { // さけ
    const s = (0.55 + r() * 0.65) * mm;
    shadow(() => { ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 7); });
    poly(s, 7, 0.3, 1);
    ctx.save(); ctx.scale(1, 0.55 + r() * 0.2);
    const gr = ctx.createLinearGradient(-s, 0, s, 0);
    gr.addColorStop(0, '#f39a6a'); gr.addColorStop(0.5, '#e8714a'); gr.addColorStop(1, '#f4a77e');
    ctx.fillStyle = gr; ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,214,190,0.55)'; ctx.lineWidth = Math.max(0.5, 0.1 * mm);
    ctx.beginPath(); ctx.moveTo(-s * 0.6, -s * 0.1); ctx.lineTo(s * 0.6, s * 0.05); ctx.stroke();
  }
  ctx.restore();
}

// ───────── お弁当箱 ─────────
function bentoMaterials(kind) {
  return cached('mat:bento:' + kind, () => {
    if (kind === 'child') {
      const dots = (() => {
        const W = 512, Hh = 336;
        const [c, x] = makeCanvas(W, Hh);
        x.fillStyle = '#f3cd52'; x.fillRect(0, 0, W, Hh);
        const n = makeNoise(91, 16);
        const sp = 24, rad = 4.2;
        for (let j = -1; j * sp * 0.866 < Hh + sp; j++) for (let i = -1; i * sp < W + sp; i++) {
          const px = i * sp + (j % 2 ? sp / 2 : 0) + (n(i, j) - 0.5) * 1.5, py = j * sp * 0.866 + 10;
          x.fillStyle = 'rgba(255,253,244,0.88)'; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
        }
        return canvasTexture(c);
      })();
      return {
        outer: new THREE.MeshPhysicalMaterial({ color: 0xf2d983, roughness: 0.34, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
        inner: new THREE.MeshPhysicalMaterial({ color: 0xf6f4ee, roughness: 0.32, clearcoat: 0.2, clearcoatRoughness: 0.3 }),
        lidSkirt: new THREE.MeshPhysicalMaterial({ color: 0xf3cd52, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
        lidTop: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: dots, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
      };
    }
    const wood = (() => {
      const n = makeNoise(95, 8), n2 = makeNoise(96, 64);
      return setWrap(paintMaps(128, 512, (x, y) => {
        const u = x / 128, v = y / 512;
        const w = fbm(n, u * 2, v * 8, 3);
        const p = v * 56 + (w - 0.5) * 3.2;
        const f = p - Math.floor(p);
        const late = smooth(0.62, 0.86, f) * smooth(1.0, 0.9, f);
        const fib = n2(u * 4, v * 64);
        let c = mixc([236, 206, 160], [226, 192, 142], fbm(n, u * 4 + 9, v * 2, 2));
        c = mixc(c, [196, 148, 96], late * 0.75);
        c = mixc(c, [214, 176, 126], fib * 0.25);
        return [c[0], c[1], c[2], 0.6 - late * 0.25 + fib * 0.1, 0.5 + late * 0.1];
      }, { normal: 1.2 }), 1, 1);
    })();
    const woodTop = {};
    for (const k in wood) woodTop[k] = wood[k];
    return {
      outer: new THREE.MeshPhysicalMaterial({ color: 0x1d2840, roughness: 0.58, clearcoat: 0.1, clearcoatRoughness: 0.6 }),
      inner: new THREE.MeshPhysicalMaterial({ color: 0x222d47, roughness: 0.5 }),
      lidSkirt: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
      lidTop: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: woodTop.map, normalMap: woodTop.normalMap, roughnessMap: woodTop.roughnessMap, roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    };
  });
}

function bentoDims(kind) {
  const s = kind === 'mama' ? 1.18 : 1;
  const W = 0.170 * s, D = 0.108 * s, H = 0.044 * s, R = 0.022 * s, t = 0.0028 * s, floorY = 0.007 * s;
  const innerL = -W / 2 + t, innerW = W - 2 * t, dth = 0.0022 * s;
  const xd = innerL + innerW * 0.45;
  const rice = { x0: innerL, x1: xd - dth / 2 }; rice.cx = (rice.x0 + rice.x1) / 2; rice.hw = (rice.x1 - rice.x0) / 2;
  const ok = { x0: xd + dth / 2, x1: W / 2 - t };
  const hd = (D - 2 * t) / 2;
  const LH = 0.012 * s, tp = 0.0022 * s;
  return { s, W, D, H, R, t, floorY, innerL, innerW, dth, xd, rice, ok, hd, LH, tp, lidClosedY: H + 0.0002 * s - (LH - tp) };
}

function bentoGeos(kind) {
  return cached('geo:bento:' + kind, () => {
    const B = bentoDims(kind), { s, W, D, H, R, t, floorY } = B;
    const ol = rrOutline(W, D, R, 8);
    const bb = 0.004 * s, fi = 0.003 * s;
    const outerP = [];
    arcPts(outerP, bb, bb, bb, -Math.PI / 2, -Math.PI, 5); // (o,y): o=bb - bb*sin...
    // 上の arcPts は (cx + r cos, cy + r sin) → a=-90°: (bb, 0)、a=-180°: (0, bb)
    outerP.push([0, H - t / 2]);
    arcPts(outerP, t / 2, H - t / 2, t / 2, Math.PI, Math.PI / 2, 4, true);
    const innerP = [];
    arcPts(innerP, t / 2, H - t / 2, t / 2, Math.PI / 2, 0, 4);
    innerP.push([t, floorY + fi]);
    arcPts(innerP, t + fi, floorY + fi, fi, Math.PI, Math.PI * 1.5, 5, true);
    const uvr = [-W / 2, -D / 2, W, D];
    const outer = mergeGeometries([sweepGeo(ol, outerP), capGeo(ol, bb, 0, false, uvr)]);
    const inner = mergeGeometries([sweepGeo(ol, innerP), capGeo(ol, t + fi, floorY, true, uvr)]);
    const divH = H - 0.0035 * s - floorY + 0.001 * s;
    const divider = new RoundedBoxGeometry(B.dth, divH, D - 2 * t + 0.0006 * s, 2, B.dth * 0.45);
    divider.translate(B.xd, floorY - 0.001 * s + divH / 2, 0);
    // ふた
    const g = 0.0006 * s, tl = 0.0018 * s, ri = 0.0015 * s, re = 0.0035 * s, lr = tl / 2, { LH, tp } = B;
    const lp = [];
    arcPts(lp, -g + ri, LH - tp - ri, ri, Math.PI / 2, Math.PI, 4);
    lp.push([-g, lr]);
    arcPts(lp, -g - tl / 2, lr, lr, 0, -Math.PI, 6, true);
    // 上の arc: (cx + r cos, cy + r sin) a=0→(-g, lr), a=-90°→(cx, 0), a=-180°→(-g-tl, lr)
    lp.push([-g - tl, LH - re]);
    arcPts(lp, -g - tl + re, LH - re, re, Math.PI, Math.PI / 2, 6, true);
    const LW = W + 2 * (g + tl), LD = D + 2 * (g + tl);
    const luv = [-LW / 2, -LD / 2, LW, LD];
    const lidSkirt = mergeGeometries([sweepGeo(ol, lp, kind === 'mama' ? 0.15 : 0.15), capGeo(ol, -g + ri, LH - tp, false, luv)]);
    const lidTop = capGeo(ol, -g - tl + re, LH, true, luv);
    return { outer, inner, divider, lidSkirt, lidTop };
  });
}

function lettuceGeo(kind) {
  return cached('geo:lettuce:' + kind, () => {
    const B = bentoDims(kind), { s, floorY, hd } = B, { x0, x1 } = B.ok;
    const GX = 52, GZ = 56, pos = [], uv = [], col = [], idx = [];
    const clampIn = makeClampInner(B, 0.0007 * s);
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
      const u = i / (GX - 1), v = j / (GZ - 1);
      let x = lerp(x0, x1, u), z = lerp(-hd, hd, v);
      const ex = Math.min(x - x0, x1 - x), ez = Math.min(z + hd, hd - z), e = Math.min(ex, ez);
      const edge = smooth(0.013 * s, 0, e);
      const wz = smooth(-0.004 * s, 0.004 * s, ex - ez);
      const nn = fbm3(x * 90 / s, 0.3, z * 90 / s, 3, 13);
      const ruf = Math.sin((x / s) * 2 * Math.PI / 0.011 + nn * 4) * wz + Math.sin((z / s) * 2 * Math.PI / 0.011 + nn * 4 + 1.3) * (1 - wz);
      // 端は壁ぎわで立ち上がり、フリル状に波打つ
      const inward = edge * (0.0012 * s) * (ruf * 0.5 + 0.5);
      if (ex < ez) x += (x - x0 < x1 - x ? 1 : -1) * inward; else z += (z + hd < hd - z ? 1 : -1) * inward;
      const y = floorY + 0.0058 * s + (nn - 0.5) * 0.0045 * s + edge * (0.0115 * s + 0.0042 * s * ruf) + edge * edge * 0.002 * s;
      // 外側（壁）へ寄せる
      const c = clampIn(x, z);
      x = clamp(c[0], x0 + 0.0004 * s, x1); z = c[1];
      pos.push(x, y, z); uv.push(u * 1.1, 1 - v * 1.1 * (hd * 2) / (x1 - x0));
      const dk = 1 - edge * 0.3 - (ruf * 0.5 + 0.5) * edge * 0.25 - (0.5 - nn) * 0.3;
      col.push(dk * (1 - edge * 0.08), dk, dk * (1 - edge * 0.1));
    }
    for (let j = 0; j < GZ - 1; j++) for (let i = 0; i < GX - 1; i++) {
      const a = j * GX + i, b = a + 1, d = a + GX, c = d + 1;
      idx.push(a, d, b, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}
function makeClampInner(B, eps) {
  const hx = (B.W - 2 * B.t) / 2 - eps, hz = (B.D - 2 * B.t) / 2 - eps, rr = B.R - B.t - eps;
  return (x, z) => {
    x = clamp(x, -hx, hx); z = clamp(z, -hz, hz);
    const ax = Math.abs(x) - (hx - rr), az = Math.abs(z) - (hz - rr);
    if (ax > 0 && az > 0) { const l = Math.hypot(ax, az); if (l > rr) { const k = rr / l; x = Math.sign(x) * (hx - rr + ax * k); z = Math.sign(z) * (hz - rr + az * k); } }
    return [x, z];
  };
}

const lettuceMat = () => cached('mat:lettuce', () => {
  const m = lettuceMaps();
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: m.map, normalMap: m.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: m.roughnessMap, roughness: 1, side: THREE.DoubleSide });
});

// 休む向き（yaw は box ローカル）
const REST = {
  tamago: { yaw: Math.PI / 2 + 0.08 },
  karaage: { yaw: 0.7 },
  wiener: { yaw: Math.PI / 2 - 0.42 },
  broccoli: { yaw: 0.4 },
  tomato: { yaw: 1.1 },
  strawberry: { yaw: 0.3 },
};

export function createBento(kind) {
  kind = kind === 'mama' ? 'mama' : 'child';
  const B = bentoDims(kind), { s, W, D, H, floorY, hd } = B;
  const G = bentoGeos(kind), M = bentoMaterials(kind);
  const root = new THREE.Group();
  root.name = 'bento:' + kind;
  root.add(new THREE.Mesh(G.outer, M.outer));
  root.add(new THREE.Mesh(G.inner, M.inner));
  // 中身（仕切り・レタス・ごはん・おかず）は interior にまとめ、ふたを閉じている間は隠せるようにする
  const interior = new THREE.Group();
  interior.name = 'bentoInterior';
  root.add(interior);
  const divMesh = new THREE.Mesh(G.divider, M.inner);
  interior.add(divMesh);
  const lettuce = new THREE.Mesh(lettuceGeo(kind), lettuceMat());
  interior.add(lettuce);
  // ふた
  const lid = new THREE.Group();
  lid.name = 'bentoLid:' + kind;
  lid.add(new THREE.Mesh(G.lidSkirt, M.lidSkirt));
  lid.add(new THREE.Mesh(G.lidTop, M.lidTop));
  lid.position.y = B.lidClosedY;
  root.add(lid);

  // ごはん
  const rc = B.rice, GX = 24, GZ = 32;
  const riceGeo = new THREE.BufferGeometry();
  const rpos = new Float32Array(GX * GZ * 3), ruv = [], ridx = [];
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) ruv.push(i / (GX - 1), 1 - j / (GZ - 1));
  for (let j = 0; j < GZ - 1; j++) for (let i = 0; i < GX - 1; i++) { const a = j * GX + i, b = a + 1, d = a + GX, c = d + 1; ridx.push(a, d, b, b, d, c); }
  riceGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  riceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  riceGeo.setIndex(ridx);
  const riceMesh = new THREE.Mesh(riceGeo, riceMaterial((rc.hw * 2) / RICE_TILE, (hd * 2) / RICE_TILE, kind));
  interior.add(riceMesh);
  // ふりかけ canvas
  const FH = 512, FW = Math.round(FH * rc.hw / hd);
  const [fcan, fctx] = makeCanvas(FW, FH);
  const ftex = canvasTexture(fcan);
  const furiMat = new THREE.MeshStandardMaterial({ map: ftex, transparent: true, roughness: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const furiMesh = new THREE.Mesh(riceGeo, furiMat);
  furiMesh.renderOrder = 1;
  interior.add(furiMesh);
  const mmPx = FH / (hd * 2 * 1000);

  const clampIn = makeClampInner(B, 0.0005 * s);
  const Hf = H - 0.004 * s - floorY;
  const riceH = (x, z, L) => {
    if (L <= 0.001) return floorY - 0.002 * s;
    const dx = (x - rc.cx) / rc.hw, dz = z / hd;
    const d = Math.pow(Math.pow(Math.abs(dx), 4) + Math.pow(Math.abs(dz), 4), 0.25);
    const Rr = 0.25 + 1.25 * L;
    const sh = smooth(Rr, Rr - 0.5, d);
    const peak = Hf * (0.42 + 0.58 * Math.min(1, L));
    const dome = 0.0026 * s * Math.min(1, L) * Math.max(0, 1 - d * d);
    const lump = (fbm3(x * 140 / s, 1.7, z * 140 / s, 2, 21) - 0.5) * 0.0016 * s * sh;
    const st = smooth(0, 0.12, L);
    return floorY - 0.0018 * s + (peak * sh + 0.0018 * s + dome + lump) * st * (sh > 0.001 ? 1 : 0.6);
  };
  let riceLevel = 0, riceTarget = 0, riceVel = 0, riceShown = -1;
  const buildRice = (L) => {
    let k = 0;
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++, k += 3) {
      const u = i / (GX - 1), v = j / (GZ - 1);
      let x = lerp(rc.x0, rc.x1, u), z = lerp(-hd, hd, v);
      const c = clampIn(x, z); x = Math.min(c[0], rc.x1 - 0.0003 * s); z = c[1];
      rpos[k] = x; rpos[k + 1] = riceH(x, z, L); rpos[k + 2] = z;
    }
    riceGeo.attributes.position.needsUpdate = true;
    riceGeo.computeVertexNormals();
    riceGeo.computeBoundingSphere();
    const vis = L > 0.004;
    riceMesh.visible = furiMesh.visible = vis;
    riceShown = L;
  };
  buildRice(0);

  // ふりかけ
  let furi = [];
  const sprinkleDraw = (u, v, c) => {
    const seed = (Math.imul(Math.round(u * 8191), 73856093) ^ Math.imul(Math.round(v * 8191), 19349663) ^ Math.imul(c + 1, 83492791)) >>> 0;
    const r = rng(seed || 1);
    const n = 7 + (r() * 9 | 0);
    const cx0 = u * FW, cy0 = v * FH;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(-2 * Math.log(1 - r() * 0.98)) * 2.6 * mmPx;
      const cc = r() < 0.55 ? c : pickC(r);
      drawGrain(fctx, cx0 + Math.cos(a) * rad, cy0 + Math.sin(a) * rad, cc, r, mmPx);
    }
  };
  const clearFuri = () => { fctx.clearRect(0, 0, FW, FH); ftex.needsUpdate = true; };

  const items = [null, null, null, null, null, null];
  const ok = B.ok, okcx = (ok.x0 + ok.x1) / 2, okw = ok.x1 - ok.x0;
  const SLOTS = [
    [okcx - okw * 0.245, -hd * 0.47], [okcx + okw * 0.245, -hd * 0.47],
    [okcx - okw * 0.33, hd * 0.47], [okcx, hd * 0.5], [okcx + okw * 0.33, hd * 0.47],
  ];
  const slotY = floorY + 0.0075 * s;
  const v3 = new THREE.Vector3();
  const rimTop = H - 0.0005 * s;

  const api = {
    kind, scale: s, size: { w: W, d: D, h: H }, lid, lidClosedY: B.lidClosedY, items, interior,
    setInteriorVisible(v) { interior.visible = !!v; },
    riceRect: { cx: rc.cx, cz: 0, hw: rc.hw, hd },
    get riceLevel() { return riceLevel; },
    setRice(level) { riceTarget = clamp(level, 0, 1); },
    setRiceNow(level) { riceTarget = riceLevel = clamp(level, 0, 1); riceVel = 0; buildRice(riceLevel); },
    riceTopLocal(out = new THREE.Vector3()) { return out.set(rc.cx, Math.max(floorY, riceH(rc.cx, 0, riceLevel)), 0); },
    worldToRiceUV(wp) {
      root.updateWorldMatrix(true, false);
      v3.copy(wp); root.worldToLocal(v3);
      const u = (v3.x - rc.x0) / (rc.hw * 2), v = (v3.z + hd) / (hd * 2);
      return { u, v, inside: u > -0.08 && u < 1.08 && v > -0.08 && v < 1.08 };
    },
    sprinkle(u, v, c) {
      u = clamp(u, 0, 1); v = clamp(v, 0, 1);
      if (!(c >= 0 && c <= 3)) c = pickC(rng(((u * 7919 + v * 104729) * 1000) | 0 || 1));
      c = c | 0;
      sprinkleDraw(u, v, c); ftex.needsUpdate = true;
      const e = { u, v, c }; furi.push(e); return e;
    },
    setFurikake(list) { clearFuri(); furi = []; for (const e of list || []) { sprinkleDraw(clamp(e.u, 0, 1), clamp(e.v, 0, 1), (e.c | 0) & 3); furi.push({ u: e.u, v: e.v, c: (e.c | 0) & 3 }); } ftex.needsUpdate = true; },
    clearFurikake() { furi = []; clearFuri(); },
    drawShape(name) {
      clearFuri(); furi = [];
      const r = rng(name === 'star' ? 202 : name === 'flower' ? 303 : 101);
      const unit = rc.hw * (name === 'star' ? 0.9 : name === 'flower' ? 0.8 : 0.74); // 形の 1 単位 (m)
      const inside = (X, Y) => { // Y 上向き
        if (name === 'star') {
          const a = Math.atan2(X, Y), rr = Math.hypot(X, Y);
          const seg = Math.PI / 5, k = ((a % (2 * seg)) + 2 * seg) % (2 * seg);
          const t = Math.abs(k - seg) / seg; // 0=くぼみ、1=先
          const ro = 1.02, ri = 0.44;
          // 星の辺に沿った半径
          const ang = (1 - t) * seg;
          const px = ri * Math.sin(seg), py = ri * Math.cos(seg);
          const lim = (ro * px) / (px * Math.cos(ang) + (ro - py) * Math.sin(ang)) ;
          return rr <= Math.min(ro, Math.max(ri, lim)) ? 1 : 0;
        }
        if (name === 'flower') {
          const a = Math.atan2(X, Y), rr = Math.hypot(X, Y);
          if (rr < 0.3) return 2;
          return rr <= 0.5 + 0.5 * Math.pow(Math.abs(Math.cos(2.5 * a)), 0.9) ? 1 : 0;
        }
        const x = X * 1.1, y = Y * 1.1 + 0.12;
        const q = x * x + y * y - 1;
        return q * q * q - x * x * y * y * y <= 0 ? 1 : 0;
      };
      const edgeOf = (X, Y) => { const e = 0.07; return inside(X + e, Y) && inside(X - e, Y) && inside(X, Y + e) && inside(X, Y - e) ? 0 : 1; };
      const step = 1.05 * mmPx;
      const cx0 = FW / 2, cy0 = FH / 2;
      const ext = unit * 1.3 * 1000 * mmPx;
      for (let py = cy0 - ext; py < cy0 + ext; py += step * 0.866) for (let px = cx0 - ext; px < cx0 + ext; px += step) {
        const x = px + (r() - 0.5) * step * 0.9, y = py + (r() - 0.5) * step * 0.9;
        const X = (x - cx0) / (unit * 1000 * mmPx), Y = -(y - cy0) / (unit * 1000 * mmPx);
        const ins = inside(X, Y);
        if (!ins) continue;
        let c;
        if (name === 'flower') c = ins === 2 ? 2 : (r() < 0.8 ? 3 : 1);
        else if (edgeOf(X, Y)) c = 0;
        else c = name === 'star' ? (r() < 0.8 ? 2 : 1) : (r() < 0.7 ? 3 : (r() < 0.5 ? 1 : 2));
        if (r() < 0.12) continue;
        drawGrain(fctx, x, y, c, r, mmPx);
      }
      ftex.needsUpdate = true;
    },
    slotLocal(i, out = new THREE.Vector3()) {
      if (i === 5) { api.riceTopLocal(out); out.y -= 0.003 * s; return out; }
      const p = SLOTS[clamp(i | 0, 0, 4)];
      return out.set(p[0], slotY, p[1]);
    },
    slotWorld(i, out = new THREE.Vector3()) { api.slotLocal(i, out); root.updateWorldMatrix(true, false); return root.localToWorld(out); },
    containsXZ(wp, margin = 0.03) {
      root.updateWorldMatrix(true, false);
      v3.copy(wp); root.worldToLocal(v3);
      return Math.abs(v3.x) <= W / 2 + margin && Math.abs(v3.z) <= D / 2 + margin;
    },
    nearestSlot(wp, isFree = () => true) {
      if (!api.containsXZ(wp, 0.03)) return -1;
      root.updateWorldMatrix(true, false);
      const lp = root.worldToLocal(v3.copy(wp)).clone();
      let best = -1, bd = Infinity;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < 6; i++) {
        if (!isFree(i)) continue;
        api.slotLocal(i, tmp);
        const d = (tmp.x - lp.x) ** 2 + (tmp.z - lp.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    place(food, i) {
      const f = food.userData.food || { type: 'karaage', height: 0.025, radius: 0.017 };
      interior.add(food);
      const p = api.slotLocal(i, new THREE.Vector3());
      if (i < 5) p.y = Math.min(rimTop - f.height, Math.max(p.y, rimTop - 0.006 * s - f.height));
      food.position.copy(p);
      const rest = REST[f.type] || { yaw: 0 };
      food.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rest.yaw + (i === 5 ? 0.3 : (i - 2) * 0.06));
      food.userData._base = { p: food.position.clone(), q: food.quaternion.clone(), slot: i };
      items[i] = food;
    },
    take(i) {
      const f = items[i] || null;
      items[i] = null;
      if (f) delete f.userData._base;
      return f;
    },
    applyShake(amount, seed = 1) {
      amount = clamp(amount || 0, 0, 1);
      if (amount <= 0) return;
      // トマトがごはんの上へ転がる
      if (amount > 0.55 && !items[5]) {
        const k = items.findIndex((f, j) => j < 5 && f && f.userData.food && f.userData.food.type === 'tomato');
        if (k >= 0) {
          const f = items[k]; items[k] = null; items[5] = f;
          const p = api.slotLocal(5, new THREE.Vector3());
          const rr = rng(seed * 131 + 7);
          p.x += rc.hw * (0.25 + rr() * 0.2); p.z = clamp(SLOTS[k][1] * 0.6, -hd * 0.5, hd * 0.5);
          p.y = riceH(p.x, p.z, riceLevel) - 0.003 * s;
          f.position.copy(p);
          // 転がったあと：へたは上寄りのまま少し傾く
          f.quaternion.setFromEuler(new THREE.Euler(0.5, rr() * 6, 0.35));
          f.userData._base = { p: p.clone(), q: f.quaternion.clone(), slot: 5 };
        }
      }
      const r0 = rng(seed * 7919 + 13), ba = r0() * Math.PI * 2, bx = Math.cos(ba), bz = Math.sin(ba);
      for (let i = 0; i < 6; i++) {
        const f = items[i]; if (!f || !f.userData._base) continue;
        const rr = rng(seed * 1000 + i * 97 + 1), base = f.userData._base;
        const fr = (f.userData.food && f.userData.food.radius) || 0.016;
        const mag = 0.0045 * s * amount;
        let x = base.p.x + (bx * 0.6 + (rr() * 2 - 1) * 0.6) * mag;
        let z = base.p.z + (bz * 0.6 + (rr() * 2 - 1) * 0.6) * mag;
        // 壁を突き抜けない
        if (i < 5) { x = clamp(x, ok.x0 + fr * 0.75, ok.x1 - fr * 0.75); z = clamp(z, -hd + fr * 0.75, hd - fr * 0.75); }
        else { x = clamp(x, rc.x0 + fr, rc.x1 - fr); z = clamp(z, -hd + fr, hd - fr); }
        const tx = (rr() * 2 - 1) * 0.22 * amount + bz * 0.08 * amount, tz = (rr() * 2 - 1) * 0.22 * amount - bx * 0.08 * amount, yaw = (rr() * 2 - 1) * 0.4 * amount;
        f.position.set(x, base.p.y + fr * Math.min(0.3, Math.abs(tx) + Math.abs(tz)) * 0.35, z);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, yaw, tz));
        f.quaternion.copy(base.q).premultiply(q);
      }
    },
  };
  root.userData.api = api;
  root.userData.update = (dt) => {
    if (Math.abs(riceTarget - riceLevel) > 0.0005 || Math.abs(riceVel) > 0.0005) {
      riceVel += (riceTarget - riceLevel) * 70 * dt;
      riceVel *= Math.exp(-dt * 11);
      riceLevel += riceVel * dt;
      if (Math.abs(riceTarget - riceLevel) < 0.0005 && Math.abs(riceVel) < 0.0005) { riceLevel = riceTarget; riceVel = 0; }
    }
    if (Math.abs(riceShown - riceLevel) > 0.0003) buildRice(Math.max(0, riceLevel));
  };
  shadowAll(root);
  furiMesh.castShadow = false;
  divMesh.castShadow = false; // 薄いので影マップでふたに筋が出る
  return root;
}

// ───────── デザート容器 ─────────
export function createDessertTub() {
  const P = cached('tub', () => {
    const v = (r, y) => new THREE.Vector2(r, y);
    const body = [v(0, 0), v(0.039, 0)];
    for (let k = 1; k <= 5; k++) { const a = -Math.PI / 2 + (k / 5) * Math.PI / 2; body.push(v(0.039 + 0.0062 * Math.cos(a) * 1, 0.0062 + 0.0062 * Math.sin(a))); }
    body.push(v(0.0472, 0.042), v(0.0482, 0.0428), v(0.0484, 0.0446), v(0.0476, 0.045), v(0.0466, 0.0447), v(0.0458, 0.042));
    body.push(v(0.0443, 0.0068));
    for (let k = 1; k <= 5; k++) { const a = (k / 5) * Math.PI / 2; body.push(v(0.0443 - 0.005 + 0.005 * Math.cos(a), 0.0068 - 0.005 * Math.sin(a) + 0.0)); }
    body.push(v(0, 0.0018));
    const lid = [v(0, 0.0058), v(0.0476, 0.0058), v(0.0487, 0.005), v(0.0488, 0.0008), v(0.0494, 0), v(0.0502, 0.0007), v(0.0503, 0.0062), v(0.0496, 0.0077), v(0.048, 0.0082), v(0.040, 0.0085), v(0, 0.0088)];
    const bodyGeo = new THREE.LatheGeometry(body, 56);
    const lidGeo = new THREE.LatheGeometry(lid, 56);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f3ee, roughness: 0.34, transparent: true, opacity: 0.8, clearcoat: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
    const lidMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe0b2, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2, sheen: 0.2 });
    return { bodyGeo, lidGeo, bodyMat, lidMat };
  });
  const g = new THREE.Group();
  g.name = 'dessertTub';
  const body = new THREE.Mesh(P.bodyGeo, P.bodyMat);
  body.renderOrder = 2;
  g.add(body);
  const lid = new THREE.Group();
  lid.name = 'dessertLid';
  lid.add(new THREE.Mesh(P.lidGeo, P.lidMat));
  const lidClosedY = 0.045 - 0.0058;
  lid.position.y = lidClosedY;
  g.add(lid);
  const berries = [createFood('strawberry'), createFood('strawberry')];
  berries[0].position.set(-0.017, 0.0018, 0.004); berries[0].rotation.y = 0.5;
  berries[1].position.set(0.018, 0.0018, -0.005); berries[1].rotation.y = Math.PI + 0.9;
  for (const b of berries) g.add(b);
  shadowAll(g);
  body.castShadow = true; body.receiveShadow = false;
  g.userData.api = { lid, lidClosedY, berries, radius: 0.0503, height: 0.045 };
  return g;
}
