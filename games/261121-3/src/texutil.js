// 手続きテクスチャ用の共通ユーティリティ（外部画像は使わない）。
// ctx.filter は iOS Safari で使えないので使わないこと。
import * as THREE from 'three';

/** 決定的な乱数 (0..1) */
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** タイル可能な 2D バリューノイズ。noise(x, y) は 0..1、period ごとに繰り返す。
 *  （起動を速くするため、period が 2 のべき乗なら剰余をビットマスクで求める。結果は剰余と同じ） */
export function makeNoise(seed = 1, period = 256) {
  const r = rng(seed);
  const p = new Float32Array(period * period);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const pow2 = period > 0 && (period & (period - 1)) === 0, mask = period - 1;
  const LIM = 1073741824; // 2^30: これより大きい整数部はビット演算できないので剰余で
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    let x0, y0, x1, y1;
    if (pow2 && xi > -LIM && xi < LIM && yi > -LIM && yi < LIM) {
      x0 = xi & mask; y0 = yi & mask; x1 = (x0 + 1) & mask; y1 = (y0 + 1) & mask;
    } else {
      x0 = ((xi % period) + period) % period; y0 = ((yi % period) + period) % period;
      x1 = (x0 + 1) % period; y1 = (y0 + 1) % period;
    }
    const r0 = y0 * period, r1 = y1 * period;
    const a = p[r0 + x0], b = p[r0 + x1];
    const c = p[r1 + x0], d = p[r1 + x1];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** フラクタルノイズ 0..1 */
export function fbm(noise, x, y, oct = 4, lac = 2, gain = 0.5) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
  return sum / norm;
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: false })];
}

/** canvas → THREE.CanvasTexture。色テクスチャは srgb=true、データ（normal/roughness）は false。 */
export function canvasTexture(canvas, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.needsUpdate = true;
  return t;
}

// paintPixels で塗った不透明な canvas の画素（normalFromHeight が canvas から読み戻さずに使う）
const PIXELS = new WeakMap();

/** 画素ごとに fn(x, y) → [r,g,b] (0..255) で塗る。小さめ(≤512)で使う。 */
export function paintPixels(w, h, fn) {
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let opaque = true;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const v = fn(x, y);
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v.length > 3 ? v[3] : 255;
    if (d[i + 3] !== 255) opaque = false;
  }
  ctx.putImageData(img, 0, 0);
  if (opaque) PIXELS.set(c, d); // 不透明なら canvas から読み戻しても同じ値
  return c;
}

/** グレースケールの高さ canvas → ノーマルマップ texture。strength は凹凸の強さ。
 *  data: その canvas に putImageData した不透明な画素（あれば canvas から読み戻さない＝GPU の待ちが無く速い。
 *        渡したあとに canvas へ描き足していないこと）。paintPixels の canvas は自動で使う。 */
export function normalFromHeight(heightCanvas, strength = 2, { repeat = null, wrap = true, data = null } = {}) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = data || PIXELS.get(heightCanvas) || heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // 高さ（0..1）を先に1回だけ取り出し、隣の画素の位置は行・列ごとに前もって求める（結果は同じ）
  const hv = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) hv[k] = src[k * 4] / 255;
  const ix = (v, n) => (wrap ? (v + n) % n : Math.min(n - 1, Math.max(0, v)));
  const xl = new Int32Array(w), xr = new Int32Array(w);
  for (let x = 0; x < w; x++) { xl[x] = ix(x - 1, w); xr[x] = ix(x + 1, w); }
  for (let y = 0, i = 0; y < h; y++) {
    const row = y * w, up = ix(y - 1, h) * w, dn = ix(y + 1, h) * w;
    for (let x = 0; x < w; x++, i += 4) {
      const dx = (hv[row + xr[x]] - hv[row + xl[x]]) * strength;
      const dy = (hv[dn + x] - hv[up + x]) * strength;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      d[i] = (-dx * l * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * l * 0.5 + 0.5) * 255; // three.js の normalMap は +Y 上（canvas の y は下向きなので反転）
      d[i + 2] = (l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: false, repeat });
}

/** やわらかい円形グラデーション（光の輪・影のしみ等に使う）。 */
export function radialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
  const [c, ctx] = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return canvasTexture(c);
}

/** 角丸長方形の Shape（x,z 平面用に使うときは ExtrudeGeometry 後に回転）。中心原点。 */
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 影の設定をまとめて付ける */
export function shadowAll(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}
