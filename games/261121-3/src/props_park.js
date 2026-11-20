// 公園の2つのセット（歩く道／木かげのレジャーシート）。three.js r170、すべて手続き生成。
//
// 公開 API
// ─────────────────────────────────────────────────────────────────────────────
// createPicnicSet(renderer) → THREE.Group
//   木かげの芝生に敷いた赤白ギンガムのレジャーシート。シート 1.6(X) × 1.4(Z)、中心が原点、上面 y=0
//   （弁当箱を置く x∈[-0.35,0.35], z∈[-0.55,0.35] はほぼ真っ平ら ±1mm）。芝の地面は y=-0.005。
//   木の幹の根元は (-1.0, 0, -1.1)。
//   userData = {
//     env           : PMREM 環境マップ（青空・太陽・緑の地面）→ scene.environment に
//     envIntensity  : 推奨 scene.environmentIntensity
//     fogColor (THREE.Color), fogNear, fogFar : scene.fog = new THREE.Fog(fogColor, fogNear, fogFar) 推奨。
//                    背景（scene.background）も fogColor にするとよい。
//     sun           : 太陽ライト。※ THREE.SpotLight（遠方 30m・狭角・decay 0 で平行光と同等）。
//                    木もれ日は sun.map（毎フレーム描き直すライトクッキー）で光そのものを斑にしているので、
//                    上に置いた立体にも正しい向きで斑と影が落ちる。castShadow=true, mapSize 2048。
//                    影の範囲は光の円錐（Picnic: 原点まわり半径 ≈2.4m、Walk: カメラ前方 ≈4m）。
//                    ※ sun.position / sun.map は各セットが管理するので外から動かさないこと（強さ・色は可）。
//     hemi          : HemisphereLight
//     update(dt, t) : 毎フレーム呼ぶ（草の揺れ・木もれ日の揺れ・葉の落下）
//     setWarmth(k)  : 0..1。1 で光が傾いて金色がかる（終わりの場面）。0 が通常。
//                    親シーンの scene.fog.color（と Color の背景）も合わせて変える。
//     leaves: { burst(n), setRate(perSec) } : 葉がひらひら舞い落ち、シート/芝に着地して
//                    12〜18秒残り、風で飛ばされて消える。上限 40 枚。弁当箱の領域には着地させない。
//     blanket: { w: 1.6, d: 1.4 }
//   }
//
// createWalkSet(renderer) → THREE.Group
//   公園の遊歩道。カメラは原点付近に固定、世界（userData.world）が +Z へ流れる。
//   砂利道は幅 1.6、中心 x=-0.35（カメラは道の右寄りを歩く）、-Z へまっすぐ。道は world-local z=-13.6 で
//   芝生に丸く終わり、その先にレジャーシート（中心 world-local (0.45, -14.6)）と、その左奥に大きな木の根元。
//   p≈1 で画面上部にシートの手前の端と木の根元が見える（縦長画面でも）。
//   userData = {
//     env, envIntensity, fogColor, fogNear, fogFar, sun(SpotLight), hemi, update(dt, t),
//     setProgress(p) : 0..1、全体で 12m 進む。連続・可逆（p の関数として位置が決まる）。
//     camera: { position: Vector3(0,0.85,0), target: Vector3(0,0,-1.214)（俯角 35°）, fov: 50（縦 fov） }
//     bagAnchor: Vector3(0.04, 0.86, -0.55)  … バッグの持ち手の頂点（推奨カメラで画面上端より上・中央やや右）
//     world: Group（流れる側。position.z = p*12）
//   }
//
// 共有: 芝テクスチャ・砂利・樹皮・ギンガムなどはモジュール内でキャッシュし、2つのセットで共有する。
// 草の葉は InstancedMesh（頂点シェーダで揺れ・Walk では流れに合わせて折り返し）。
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, makeNoise, fbm, makeCanvas, canvasTexture, paintPixels, shadowAll } from './texutil.js';

const C = {};
const once = (k, f) => (C[k] !== undefined ? C[k] : (C[k] = f()));
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const srgb = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

// 縦横で周期の違うタイル可能ノイズ
function tileNoise(seed, px, py) {
  const r = rng(seed), p = new Float32Array(px * py);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = p[y0 * px + x0], b = p[y0 * px + x1], c = p[y1 * px + x0], d = p[y1 * px + x1];
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// 高さ canvas → ノーマル（＋ラフネス）テクスチャ
function heightMaps(hc, strength, roughFn, ch = 0) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [nc, nx] = makeCanvas(w, h);
  const ni = nx.createImageData(w, h), nd = ni.data;
  let rc = null, rx, ri, rd;
  if (roughFn) { [rc, rx] = makeCanvas(w, h); ri = rx.createImageData(w, h); rd = ri.data; }
  const H = (x, y) => src[((((y + h) % h) * w) + ((x + w) % w)) * 4 + ch] / 255;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    nd[i] = (-dx * l * 0.5 + 0.5) * 255; nd[i + 1] = (dy * l * 0.5 + 0.5) * 255; nd[i + 2] = (l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    if (rd) { const v = roughFn(src[i + ch] / 255) * 255; rd[i] = rd[i + 1] = rd[i + 2] = v; rd[i + 3] = 255; }
  }
  nx.putImageData(ni, 0, 0);
  const out = { normal: canvasTexture(nc, { srgb: false, repeat: [1, 1] }) };
  if (rc) { rx.putImageData(ri, 0, 0); out.rough = canvasTexture(rc, { srgb: false, repeat: [1, 1] }); }
  return out;
}

// タイル境界をまたぐスタンプを4方向に複製して描く
function stampWrap(ctxs, imgs, N, x, y, rot, sx, sy, w, h) {
  const xs = [x], ys = [y], m = Math.max(w * sx, h * sy);
  if (x < m) xs.push(x + N); if (x > N - m) xs.push(x - N);
  if (y < m) ys.push(y + N); if (y > N - m) ys.push(y - N);
  for (const X of xs) for (const Y of ys) for (let k = 0; k < ctxs.length; k++) {
    const c = ctxs[k];
    c.setTransform(Math.cos(rot) * sx, Math.sin(rot) * sx, -Math.sin(rot) * sy, Math.cos(rot) * sy, X, Y);
    c.drawImage(imgs[k], -w / 2, -h * 0.85, w, h);
  }
}

// ─── 芝テクスチャ（1024、0.6m で1周期）──────────────────────────────────────
function grassTex() {
  return once('grass', () => {
    const N = 1024, S = 0.6, R = rng(11);
    const [cc, cx] = makeCanvas(N);
    cx.fillStyle = 'rgb(44,54,22)'; cx.fillRect(0, 0, N, N);
    // 房（数枚の葉）のスプライト。上（=奥, -Z）へ立ち上がるように描く
    const SW = 40, SH = 64;
    const tuft = (base, tip, nBl, len, spread, dry) => {
      const [c, x] = makeCanvas(SW, SH);
      for (let b = 0; b < nBl; b++) {
        const a = (R() - 0.5) * spread, L = len * (0.55 + R() * 0.45), wd = 1.6 + R() * 1.8;
        const bx = SW / 2 + (R() - 0.5) * 8, by = SH - 4;
        const tx = bx + Math.sin(a) * L, ty = by - Math.cos(a) * L;
        const cx2 = bx + Math.sin(a * 0.5) * L * 0.6 + (R() - 0.5) * 4, cy2 = by - L * 0.55;
        const grad = (ctx, c0, c1) => { const g = ctx.createLinearGradient(bx, by, tx, ty); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
        const jit = 0.85 + R() * 0.3;
        const col = (c3, k) => `rgb(${clamp255(c3[0] * k) | 0},${clamp255(c3[1] * k) | 0},${clamp255(c3[2] * k) | 0})`;
        for (const [ctx, g] of [[x, grad(x, col(base, jit), col(dry && R() < 0.5 ? [150, 140, 80] : tip, jit))]]) {
          ctx.fillStyle = g; ctx.beginPath();
          ctx.moveTo(bx - wd / 2, by); ctx.quadraticCurveTo(cx2 - wd / 2, cy2, tx, ty); ctx.quadraticCurveTo(cx2 + wd / 2, cy2, bx + wd / 2, by); ctx.closePath(); ctx.fill();
        }
      }
      return [c];
    };
    const sets = [
      tuft([30, 46, 16], [70, 98, 34], 7, 46, 1.6, false),
      tuft([34, 52, 18], [86, 116, 40], 7, 50, 1.4, false),
      tuft([40, 60, 20], [104, 134, 46], 8, 52, 1.3, false),
      tuft([44, 64, 22], [118, 146, 52], 8, 54, 1.2, false),
      tuft([46, 66, 24], [130, 156, 60], 7, 50, 1.3, true),
      tuft([40, 62, 26], [108, 142, 62], 8, 56, 1.1, false),
      tuft([60, 66, 30], [146, 150, 76], 5, 40, 1.8, true),
    ];
    const n1 = makeNoise(4, 8);
    // 下地の枯れ草
    for (let i = 0; i < 500; i++) {
      const x = R() * N, y = R() * N;
      stampWrap([cx], sets[6], N, x, y, R() * 6.28, 0.8, 0.8, SW, SH);
    }
    const clover = () => {
      // シロツメクサの葉（3枚の丸い小葉、淡い白斑）
      const ccx = R() * N, ccy = R() * N, cnt = 6 + (R() * 16) | 0;
      for (let k = 0; k < cnt; k++) {
        const x = ccx + (R() - 0.5) * 70, y = ccy + (R() - 0.5) * 70, s = 4.5 + R() * 3.5, rot = R() * 6.28;
        for (const [ctx, isH] of [[cx, false]]) {
          for (const X of [x, x - N, x + N]) for (const Y of [y, y - N, y + N]) {
            if (X < -30 || X > N + 30 || Y < -30 || Y > N + 30) continue;
            ctx.setTransform(1, 0, 0, 1, X, Y); ctx.rotate(rot);
            for (let l = 0; l < 3; l++) {
              ctx.rotate(2.094);
              ctx.fillStyle = isH ? '#d8d8d8' : `rgb(${58 + R() * 14 | 0},${96 + R() * 18 | 0},${38 + R() * 10 | 0})`;
              ctx.beginPath(); ctx.ellipse(0, -s * 0.9, s * 0.8, s, 0, 0, 6.283); ctx.fill();
              if (!isH) { ctx.fillStyle = 'rgba(190,210,170,0.35)'; ctx.beginPath(); ctx.ellipse(0, -s * 0.75, s * 0.42, s * 0.22, 0, 0, 6.283); ctx.fill(); }
            }
          }
        }
      }
    };
    const total = 5200;
    for (let i = 0; i < total; i++) {
      const x = R() * N, y = R() * N;
      const m = fbm(n1, (x / N) * 8, (y / N) * 8, 3);
      const layer = i / total;
      let k = Math.floor(layer * 4.2 + (m - 0.5) * 2.2 + (R() - 0.5) * 1.6);
      k = Math.max(0, Math.min(5, k));
      const s = 0.7 + R() * 0.55;
      stampWrap([cx], sets[k], N, x, y, (R() - 0.5) * 1.1, s, s * (0.8 + R() * 0.4), SW, SH);
      if (i === 2600) for (let c = 0; c < 9; c++) clover();
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    const map = canvasTexture(cc, { repeat: [1, 1], aniso: 8 });
    const hm = heightMaps(cc, 5.0, (h) => 0.98 - h * 0.5, 1);
    return { map, normal: hm.normal, rough: hm.rough, S };
  });
}

// 広い範囲の色むら・縁のゆらぎ用ノイズ（256、タイル）
function macroTex() {
  return once('macro', () => {
    const n = makeNoise(21, 8), n2 = makeNoise(22, 32);
    const c = paintPixels(256, 256, (x, y) => {
      const v = fbm(n, x / 32, y / 32, 3) * 0.75 + fbm(n2, x / 8, y / 8, 2) * 0.25;
      const w = fbm(n2, x / 8 + 7.3, y / 8 + 3.1, 3);
      return [v * 255, w * 255, 0];
    });
    return canvasTexture(c, { srgb: false, repeat: [1, 1] });
  });
}

// ─── 砂利（512、0.28m で1周期）────────────────────────────────────────────
function gravelTex() {
  return once('gravel', () => {
    const N = 512, S = 0.28, R = rng(31);
    const hn = makeNoise(5, 64);
    const cc = paintPixels(N, N, (x, y) => {
      const v = fbm(hn, x / 8, y / 8, 3), e = R() * 18;
      return [168 + v * 36 + e, 152 + v * 32 + e, 124 + v * 28 + e];
    });
    const cx = cc.getContext('2d');
    const cols = [[214, 200, 170], [204, 196, 180], [192, 170, 134], [228, 218, 196], [176, 154, 124], [234, 228, 214], [170, 162, 150], [210, 190, 156], [222, 206, 176]];
    const SP = 32, sprites = [];
    for (let k = 0; k < 18; k++) {
      const [c, x] = makeCanvas(SP);
      const pts = [], np = 9, ph = R() * 6;
      for (let i = 0; i < np; i++) {
        const a = (i / np) * 6.283, r = SP * 0.42 * (0.78 + 0.22 * Math.sin(a * 2 + ph) * R() + 0.12 * R());
        pts.push([SP / 2 + Math.cos(a) * r * (k % 3 === 0 ? 1.25 : 1), SP / 2 + Math.sin(a) * r * 0.85]);
      }
      const path = (ctx) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
      const col = cols[k % cols.length];
      path(x); x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fill();
      x.save(); path(x); x.clip();
      const g = x.createRadialGradient(SP * 0.45, SP * 0.42, 1, SP / 2, SP / 2, SP * 0.5);
      g.addColorStop(0, 'rgba(255,255,250,0.22)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(40,30,20,0.35)');
      x.fillStyle = g; x.fillRect(0, 0, SP, SP);
      for (let i = 0; i < 14; i++) { x.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '60,50,40'},${0.05 + R() * 0.08})`; x.fillRect(R() * SP, R() * SP, 1 + R() * 2, 1 + R() * 2); }
      x.restore();
      sprites.push([c]);
    }
    for (let i = 0; i < 6500; i++) {
      const x = R() * N, y = R() * N, s = (0.16 + Math.pow(R(), 1.8) * 0.42);
      const sp = sprites[(R() * sprites.length) | 0];
      stampWrap([cx], sp, N, x, y, R() * 6.28, s, s, SP, SP * 1.176);
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    const map = canvasTexture(cc, { repeat: [1, 1], aniso: 8 });
    const hm = heightMaps(cc, 2.6, (h) => 0.98 - h * 0.25, 1);
    return { map, normal: hm.normal, rough: hm.rough, S };
  });
}

// ─── 樹皮（512、0.4m 周期。縦の裂け目）────────────────────────────────────
function barkTex() {
  return once('bark', () => {
    const N = 512, n1 = tileNoise(41, 10, 4), n2 = tileNoise(42, 32, 16), n3 = tileNoise(43, 64, 64), n4 = tileNoise(44, 6, 6);
    const [hc, hx] = makeCanvas(N); const himg = hx.createImageData(N, N);
    const [cc, cx] = makeCanvas(N); const cimg = cx.createImageData(N, N);
    for (let y = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, i += 4) {
      const u = x / N, v = y / N;
      const warp = fbm(n2, u * 32, v * 16, 3) * 1.6;
      const w = u * 10 + warp + fbm(n1, u * 10, v * 4, 2) * 0.8;
      const fr = Math.abs((w % 1 + 1) % 1 - 0.5) * 2; // 0=ridge center
      let ridge = smooth(0.95, 0.35, fr);
      const crack = fbm(n3, u * 64, v * 64, 2);
      ridge *= 0.75 + 0.25 * crack;
      if (Math.abs(((v * 16 + warp * 2) % 1) - 0.5) < 0.04) ridge *= 0.55;
      const fine = fbm(n3, u * 64 + 11, v * 64, 2);
      const hgt = ridge * 0.8 + fine * 0.2;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hgt * 255; himg.data[i + 3] = 255;
      const lich = smooth(0.55, 0.75, fbm(n4, u * 6, v * 6, 2)) * ridge;
      const b = 0.35 + 0.65 * hgt;
      let r = 108 * b + 18, g = 96 * b + 16, bl = 84 * b + 14;
      r = r * (1 - lich * 0.35) + 150 * lich * 0.35; g = g * (1 - lich * 0.35) + 156 * lich * 0.35; bl = bl * (1 - lich * 0.35) + 128 * lich * 0.35;
      const e = (fine - 0.5) * 22;
      cimg.data[i] = clamp255(r + e); cimg.data[i + 1] = clamp255(g + e); cimg.data[i + 2] = clamp255(bl + e); cimg.data[i + 3] = 255;
    }
    hx.putImageData(himg, 0, 0); cx.putImageData(cimg, 0, 0);
    const hm = heightMaps(hc, 4.5, (h) => 0.98 - h * 0.12);
    return { map: canvasTexture(cc, { repeat: [1, 1] }), normal: hm.normal, rough: hm.rough, T: 0.4 };
  });
}

// ─── ギンガムチェック（512 = チェック2つ分 0.08m）──────────────────────────
function ginghamTex() {
  return once('gingham', () => {
    const N = 512, TH = 4, R = rng(51), nt = N / TH;
    const jw = new Float32Array(nt), jf = new Float32Array(nt);
    for (let i = 0; i < nt; i++) { jw[i] = 0.94 + R() * 0.1; jf[i] = 0.94 + R() * 0.1; }
    const red = [168, 22, 32], wht = [226, 222, 212];
    const [cc, cx] = makeCanvas(N), [hc, hx] = makeCanvas(N);
    const ci = cx.createImageData(N, N), hi = hx.createImageData(N, N);
    const fz = makeNoise(52, 128);
    for (let y = 0, k = 0; y < N; y++) for (let x = 0; x < N; x++, k += 4) {
      const i = (x / TH) | 0, j = (y / TH) | 0, fx = (x % TH + 0.5) / TH, fy = (y % TH + 0.5) / TH;
      const warpTop = ((i + j) & 1) === 0;
      const isRed = warpTop ? x < N / 2 : y < N / 2;
      const across = warpTop ? fx : fy, along = warpTop ? fy : fx;
      const sh = 0.93 + 0.07 * Math.sin(Math.PI * across);
      const jit = warpTop ? jw[i] : jf[j];
      const f = 0.96 + fz(x / 2, y / 2) * 0.08;
      const b = isRed ? red : wht, m = sh * jit * f;
      ci.data[k] = clamp255(b[0] * m); ci.data[k + 1] = clamp255(b[1] * m); ci.data[k + 2] = clamp255(b[2] * m); ci.data[k + 3] = 255;
      const h = (0.25 + 0.75 * Math.sin(Math.PI * across) * (0.55 + 0.45 * Math.sin(Math.PI * along))) * 255;
      hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = h; hi.data[k + 3] = 255;
    }
    cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0);
    const hm = heightMaps(hc, 1.6, (h) => 0.92 - h * 0.12);
    return { map: canvasTexture(cc, { repeat: [1, 1], aniso: 8 }), normal: hm.normal, rough: hm.rough, T: 0.08 };
  });
}

// ─── ベンチの木 ───────────────────────────────────────────────────────────
function woodTex() {
  return once('wood', () => {
    const W = 512, H = 128, n = tileNoise(61, 4, 32), n2 = tileNoise(62, 64, 32);
    const [hc, hx] = makeCanvas(W, H); const hi = hx.createImageData(W, H);
    const [cc, cx] = makeCanvas(W, H); const ci = cx.createImageData(W, H);
    for (let y = 0, k = 0; y < H; y++) for (let x = 0; x < W; x++, k += 4) {
      const u = x / W, v = y / H;
      const g = v * 22 + fbm(n, u * 4, v * 32, 3) * 3;
      const ring = Math.pow(Math.abs(Math.sin(g * Math.PI)), 0.6);
      const fine = fbm(n2, u * 64, v * 32, 2);
      const b = 0.72 + 0.18 * ring + 0.1 * fine;
      ci.data[k] = clamp255(138 * b); ci.data[k + 1] = clamp255(112 * b); ci.data[k + 2] = clamp255(88 * b); ci.data[k + 3] = 255;
      const h = (ring * 0.4 + fine * 0.6) * 255;
      hi.data[k] = hi.data[k + 1] = hi.data[k + 2] = h; hi.data[k + 3] = 255;
    }
    cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0);
    const hm = heightMaps(hc, 1.5, (h) => 0.8 - h * 0.15);
    return new THREE.MeshStandardMaterial({ map: canvasTexture(cc), normalMap: hm.normal, roughnessMap: hm.rough, roughness: 1 });
  });
}

// ─── 葉（落ち葉・舞う葉の葉脈テクスチャと形）───────────────────────────────
function leafMaterial() {
  return once('leafMat', () => {
    const [c, x] = makeCanvas(64, 128);
    x.fillStyle = '#dcdcd0'; x.fillRect(0, 0, 64, 128);
    const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 128);
    x.strokeStyle = 'rgba(255,255,235,0.55)'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(32, 128); x.lineTo(32, 0); x.stroke();
    x.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = 118 - i * 12;
      x.strokeStyle = 'rgba(255,255,235,0.33)';
      x.beginPath(); x.moveTo(32, y); x.quadraticCurveTo(44, y - 8, 62, y - 18); x.stroke();
      x.beginPath(); x.moveTo(32, y); x.quadraticCurveTo(20, y - 8, 2, y - 18); x.stroke();
    }
    return new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.6, side: THREE.DoubleSide });
  });
}
function leafGeometry() {
  return once('leafGeo', () => {
    const L = 0.065, W = 0.034, ST = 12, pos = [], uv = [], idx = [];
    for (let i = 0; i <= ST; i++) {
      const s = i / ST;
      const hw = (W / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.08)), 0.8) * (1 - 0.35 * s) * (s > 0.97 ? 0.2 : 1);
      for (let c = -1; c <= 1; c++) {
        const x = c * hw;
        pos.push(x, 0.12 * (x * x) / (W / 2) + 0.004 * Math.sin(Math.PI * s), (0.5 - s) * L);
        uv.push(0.5 + c * 0.5 * (hw / (W / 2)), s);
      }
    }
    for (let i = 0; i < ST; i++) for (let c = 0; c < 2; c++) {
      const a = i * 3 + c, b = a + 1, d = a + 3, e = a + 4;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

// ─── 地面マテリアル（芝。path 指定で砂利道とブレンド）─────────────────────────
function groundMaterial(path) {
  const g = grassTex(), mac = macroTex(), gv = path ? gravelTex() : null;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  if (path) m.defines = { HAS_PATH: '' };
  m.customProgramCacheKey = () => 'parkGround' + (path ? 1 : 0);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      gMap: { value: g.map }, gNor: { value: g.normal }, gRough: { value: g.rough }, gMacro: { value: mac }, gS: { value: 1 / g.S },
    });
    if (path) Object.assign(sh.uniforms, {
      pMap: { value: gv.map }, pNor: { value: gv.normal }, pRough: { value: gv.rough }, pS: { value: 1 / gv.S },
      pGeo: { value: new THREE.Vector3(path.cx, path.hw, path.zEnd) },
    });
    sh.vertexShader = 'varying vec3 vGP; varying vec3 vTX; varying vec3 vTY; varying vec3 vTZ;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      vGP = position; vTX = normalize(normalMatrix * vec3(1.,0.,0.)); vTY = normalize(normalMatrix * vec3(0.,1.,0.)); vTZ = normalize(normalMatrix * vec3(0.,0.,1.));`);
    sh.fragmentShader = `varying vec3 vGP; varying vec3 vTX; varying vec3 vTY; varying vec3 vTZ;
      uniform sampler2D gMap, gNor, gRough, gMacro; uniform float gS;
      #ifdef HAS_PATH
      uniform sampler2D pMap, pNor, pRough; uniform float pS; uniform vec3 pGeo;
      #endif
      vec3 gN; float gR;
      ` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 gp = vGP.xz;
        vec2 uvA = vec2(gp.x, -gp.y) * gS;
        vec4 mc = texture2D(gMacro, gp * 0.09);
        vec4 mc2 = texture2D(gMacro, gp * 0.31 + 0.37);
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * uvA * 0.63 + vec2(0.37, 0.11);
        float bl = smoothstep(0.38, 0.62, mc2.g);
        vec3 gc = mix(texture2D(gMap, uvA).rgb, texture2D(gMap, uvB).rgb, bl);
        gc *= mix(0.8, 1.14, mc.r);
        gc = mix(gc, gc * vec3(1.16, 1.04, 0.7), smoothstep(0.55, 0.85, mc2.r) * 0.55);
        gN = mix(texture2D(gNor, uvA).xyz, texture2D(gNor, uvB).xyz, bl) * 2. - 1.;
        gR = mix(texture2D(gRough, uvA).r, texture2D(gRough, uvB).r, bl);
        #ifdef HAS_PATH
          vec2 pu = vec2(gp.x, -gp.y) * pS;
          vec2 pu2 = mat2(0.6, 0.8, -0.8, 0.6) * pu * 0.71 + vec2(0.21, 0.53);
          float pb = smoothstep(0.4, 0.6, mc.g);
          vec3 pc = mix(texture2D(pMap, pu).rgb, texture2D(pMap, pu2).rgb, pb);
          vec3 pn = mix(texture2D(pNor, pu).xyz, texture2D(pNor, pu2).xyz, pb) * 2. - 1.;
          float pr = mix(texture2D(pRough, pu).r, texture2D(pRough, pu2).r, pb);
          pc *= mix(0.9, 1.06, mc2.g);
          float dx = abs(gp.x - pGeo.x);
          float zc = pGeo.z + pGeo.y;
          float dd = gp.y > zc ? dx : length(vec2(dx, gp.y - zc));
          float en = texture2D(gMacro, gp * 1.7).g;
          float pm = 1. - smoothstep(pGeo.y - 0.02, pGeo.y + 0.02, dd + (en - 0.5) * 0.12);
          pc *= mix(1.0, 0.78, smoothstep(pGeo.y - 0.14, pGeo.y + 0.02, dd));
          gc = mix(gc, pc, pm); gN = mix(gN, pn, pm); gR = mix(gR, pr, pm);
        #endif
        diffuseColor.rgb *= gc;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gR;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(vTX * gN.x * 1.2 - vTZ * gN.y * 1.2 + vTY * gN.z);');
  };
  return m;
}

// ─── 草の葉（InstancedMesh、頂点シェーダで揺れ／折り返し／隠し）────────────────
function bladeGeometry() {
  return once('bladeGeo', () => {
    // 高さ1・幅1 の基準。5頂点 3三角形。+Z へゆるく曲がる
    const pos = [-0.5, 0, 0, 0.5, 0, 0, -0.34, 0.5, 0.09, 0.34, 0.5, 0.09, 0.02, 1, 0.3];
    const t = [0, 0, 0.5, 0.5, 1];
    const nrm = [];
    for (let i = 0; i < 5; i++) { const v = new THREE.Vector3(0, 1, 0.55).normalize(); nrm.push(v.x, v.y, v.z); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    return g;
  });
}
const SWAY_VERT = `
  vec4 swP = vec4(transformed, 1.0);
  vT = aT;
  #ifdef USE_INSTANCING
    mat4 swM = instanceMatrix;
    if (uWrap.z > 0.5) swM[3].z = mod(swM[3].z + uWrap.w - uWrap.x, uWrap.y) + uWrap.x;
    swP = swM * swP;
    vec3 root = swM[3].xyz;
    float ph = root.x * 2.7 + root.z * 1.9;
    float s = sin(uTime * 1.9 + ph) * 0.55 + sin(uTime * 3.3 + ph * 1.3 + root.z) * 0.25 + uGust * (0.6 + 0.4 * sin(ph));
    float k = aT * aT;
    swP.x += s * 0.009 * k * uSway; swP.z += s * 0.004 * k * uSway;
    float wz = root.z - uWrap.w;
    bool hide = false;
    if (uPath.y > 0.0) {
      float dx = abs(root.x - uPath.x), zc = uPath.z + uPath.y;
      float dd = wz > zc ? dx : length(vec2(dx, wz - zc));
      if (dd < uPath.y - 0.035) hide = true;
    }
    if (uSheet.z > 0.0) { vec2 q = abs(vec2(root.x, wz) - uSheet.xy); if (q.x < uSheet.z && q.y < uSheet.w) hide = true; }
    if (hide) swP = vec4(root, 1.0);
  #endif
  vec4 mvPosition = modelViewMatrix * swP;
  gl_Position = projectionMatrix * mvPosition;
`;
function swayUniforms() {
  return {
    uTime: { value: 0 }, uGust: { value: 0 }, uSway: { value: 1 },
    uWrap: { value: new THREE.Vector4(0, 1, 0, 0) }, uPath: { value: new THREE.Vector4(0, 0, 0, 0) }, uSheet: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}
function patchSway(mat, U, grad) {
  mat.customProgramCacheKey = () => 'parkSway' + (grad ? 1 : 0) + (mat.isMeshDepthMaterial ? 'd' : '');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uTime, uGust, uSway; uniform vec4 uWrap, uPath, uSheet; attribute float aT; varying float vT;\n' + sh.vertexShader
      .replace('#include <project_vertex>', SWAY_VERT)
      .replace('#include <worldpos_vertex>', THREE.ShaderChunk.worldpos_vertex.replace('worldPosition = instanceMatrix * worldPosition;', 'worldPosition = swP;'));
    if (!mat.isMeshDepthMaterial) {
      sh.fragmentShader = 'varying float vT;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + (grad ? 'diffuseColor.rgb *= mix(0.38, 1.0, vT);' : ''));
    }
  };
  return mat;
}
function makeSwayMesh(geo, count, U, grad, matOpts) {
  const mat = patchSway(new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 0.62, side: THREE.DoubleSide }, matOpts)), U, grad);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.customDepthMaterial = patchSway(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U, false);
  mesh.frustumCulled = false;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
// 草の葉を pts（[x,z,lean]）に植える
function plantBlades(pts, U, seed) {
  const R = rng(seed), mesh = makeSwayMesh(bladeGeometry(), pts.length, U, true);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const tips = [[104, 136, 44], [120, 150, 50], [92, 126, 40], [134, 156, 58], [112, 146, 56], [146, 152, 70]];
  pts.forEach(([x, z, yaw], i) => {
    const h = 0.03 + Math.pow(R(), 1.3) * 0.05;
    e.set((R() - 0.4) * 0.5, yaw !== undefined ? yaw + (R() - 0.5) * 1.2 : R() * 6.283, (R() - 0.5) * 0.5, 'YXZ');
    q.setFromEuler(e); s.set(0.0032 + R() * 0.0022, h, h); p.set(x, -0.006, z);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    const t = tips[(R() * tips.length) | 0], k = 0.85 + R() * 0.3;
    mesh.setColorAt(i, col.copy(srgb(t[0] * k, t[1] * k, t[2] * k)));
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// シロツメクサの花（頭花＋茎）
function cloverGeometry() {
  return once('cloverGeo', () => {
    const n = makeNoise(71, 16);
    const head = new THREE.IcosahedronGeometry(0.0085, 2);
    const p = head.attributes.position, cols = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z);
      const d = 1 + (n(x * 900 + 8, z * 900 + y * 500) - 0.5) * 0.35;
      p.setXYZ(i, x * d, y * d * 0.82 + 0.052, z * d);
      const low = smooth(0.0, -0.007, y);
      const c = new THREE.Color().lerpColors(srgb(246, 246, 238), srgb(200, 176, 150), low * 0.8);
      cols.push(c.r, c.g, c.b);
    }
    head.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    head.deleteAttribute('uv'); head.computeVertexNormals();
    const stem = new THREE.CylinderGeometry(0.0009, 0.0013, 0.05, 5, 3);
    stem.translate(0, 0.025, 0); stem.deleteAttribute('uv');
    const sc = [];
    for (let i = 0; i < stem.attributes.position.count; i++) { const c = srgb(96, 128, 60); sc.push(c.r, c.g, c.b); }
    stem.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    const g = mergeGeometries([head.index ? head.toNonIndexed() : head, stem.toNonIndexed()]);
    const t = [], P = g.attributes.position;
    for (let i = 0; i < P.count; i++) t.push(Math.min(1, Math.max(0, P.getY(i) / 0.06)));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    return g;
  });
}
function plantClover(pts, U, seed) {
  const R = rng(seed), mesh = makeSwayMesh(cloverGeometry(), pts.length, U, false, { vertexColors: true, roughness: 0.8 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  pts.forEach(([x, z], i) => {
    const s = 0.75 + R() * 0.45;
    e.set((R() - 0.5) * 0.35, R() * 6.28, (R() - 0.5) * 0.35);
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, -0.006, z), q.setFromEuler(e), new THREE.Vector3(s, s * (0.7 + R() * 0.5), s)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// 地面に落ちている葉（静止）
function fallenLeaves(pts, seed) {
  const R = rng(seed), mesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial(), pts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const cols = [[150, 112, 58], [128, 90, 48], [168, 150, 72], [110, 120, 52], [176, 132, 70]];
  pts.forEach(([x, y, z], i) => {
    e.set((R() - 0.5) * 0.25, R() * 6.28, (R() - 0.5) * 0.25);
    const s = 0.7 + R() * 0.5;
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e), new THREE.Vector3(s, s, s)));
    const c = cols[(R() * cols.length) | 0]; mesh.setColorAt(i, srgb(c[0], c[1], c[2]));
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// ─── 木の幹の根元 ───────────────────────────────────────────────────────────
function barkMaterial() {
  return once('barkMat', () => {
    const b = barkTex();
    return new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughnessMap: b.rough, roughness: 1, vertexColors: true });
  });
}
function makeTrunk(seed, R0, H, clip = null) {
  const T = barkTex().T, r = rng(seed), n = tileNoise(seed + 3, 8, 8), nm = makeNoise(seed + 9, 32);
  const RS = 72, HS = 46;
  const roots = []; const nr = 5 + ((r() * 2) | 0);
  for (let k = 0; k < nr; k++) roots.push({ a: (k / nr) * 6.283 + (r() - 0.5) * 0.7, s: 0.45 + r() * 0.55 });
  const angd = (a, b) => { let d = (a - b) % 6.283; if (d > 3.1416) d -= 6.283; if (d < -3.1416) d += 6.283; return d; };
  const rep = Math.max(2, Math.round((6.283 * R0 * 1.25) / T));
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= HS; j++) {
    const y = -0.1 + (H + 0.1) * Math.pow(j / HS, 1.7), yb = Math.max(0, y);
    for (let i = 0; i <= RS; i++) {
      const th = (i / RS) * 6.283;
      let rr = 1 + 0.5 * Math.exp(-yb / 0.22) + 0.2 * Math.exp(-yb / 0.9);
      for (const ro of roots) rr += ro.s * 0.95 * Math.exp(-Math.pow(angd(th, ro.a) / 0.26, 2)) * Math.exp(-yb / 0.26);
      rr += (fbm(n, (i / RS) * 8, y * 2.2, 3) - 0.5) * 0.2;
      rr *= R0;
      const lean = y * 0.035;
      pos.push(Math.cos(th) * rr + lean, y, Math.sin(th) * rr);
      uv.push((i / RS) * rep, y / T);
      const moss = (1 - smooth(0.0, 0.4, y)) * smooth(0.45, 0.7, fbm(nm, i / 6, y * 6, 3));
      const dark = 1 - 0.35 * (1 - smooth(-0.05, 0.12, y));
      const c = new THREE.Color(dark, dark, dark).lerp(new THREE.Color(0.5, 0.62, 0.32), moss * 0.6);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < HS; j++) for (let i = 0; i < RS; i++) {
    const a = j * (RS + 1) + i, b = a + 1, c = a + RS + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // 地表に張る根
  const rg = [];
  for (const ro of roots) {
    let L = (0.3 + r() * 0.4) * (R0 / 0.25) * (0.6 + ro.s * 0.6) + 0.15;
    let pts;
    for (let tries = 0; tries < 8; tries++) {
      pts = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5, d = R0 * 1.05 + t * L, a = ro.a + Math.sin(t * 3 + seed) * 0.12 * t;
        pts.push(new THREE.Vector3(Math.cos(a) * d, R0 * 0.2 * (1 - t) - t * t * 0.07, Math.sin(a) * d));
      }
      if (!clip || pts.every((p) => clip(p.x, p.z))) break;
      L *= 0.75;
    }
    if (clip && !pts.every((p) => clip(p.x, p.z))) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const TS = 22, RD = 10, rad = R0 * 0.36 * ro.s + 0.025;
    const tg = new THREE.TubeGeometry(curve, TS, rad, RD, false);
    const P = tg.attributes.position, U = tg.attributes.uv, cl = [];
    const circ = 6.283 * rad;
    for (let i = 0; i <= TS; i++) {
      const t = i / TS, c = curve.getPointAt(t), tap = 1 - 0.78 * t;
      for (let j = 0; j <= RD; j++) {
        const k = i * (RD + 1) + j;
        const vx = P.getX(k) - c.x, vy = P.getY(k) - c.y, vz = P.getZ(k) - c.z;
        P.setXYZ(k, c.x + vx * tap, c.y + vy * tap * 0.7, c.z + vz * tap);
        U.setXY(k, (j / RD) * Math.max(1, Math.round(circ / T * 2)) * 0.5, (t * L) / T);
        const cc = 0.72 + 0.15 * t; cl.push(cc, cc * 1.02, cc * 0.95);
      }
    }
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    tg.computeVertexNormals();
    rg.push(tg);
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, barkMaterial()));
  if (rg.length) grp.add(new THREE.Mesh(mergeGeometries(rg), barkMaterial()));
  shadowAll(grp);
  grp.userData.radius = R0 * 1.6;
  return grp;
}

// ─── ベンチ ───────────────────────────────────────────────────────────────
function makeBench() {
  return once('bench', () => {
    const wood = woodTex();
    const metal = new THREE.MeshStandardMaterial({ color: srgb(70, 66, 60), roughness: 0.5, metalness: 0.55 });
    const wg = [], mg = [];
    const add = (arr, w, h, d, x, y, z, rx = 0, r = 0.008) => {
      const g = new RoundedBoxGeometry(w, h, d, 2, r); g.rotateX(rx); g.translate(x, y, z); arr.push(g);
    };
    const len = 1.6;
    for (let i = 0; i < 4; i++) add(wg, len, 0.032, 0.088, 0, 0.43, -0.16 + i * 0.105);
    for (let i = 0; i < 2; i++) add(wg, len, 0.1, 0.028, 0, 0.6 + i * 0.13, -0.235 - i * 0.035, -0.24);
    for (const sx of [-0.62, 0.62]) {
      add(mg, 0.05, 0.42, 0.055, sx, 0.21, 0.17, 0, 0.01);
      add(mg, 0.05, 0.42, 0.055, sx, 0.21, -0.25, 0, 0.01);
      add(mg, 0.05, 0.46, 0.05, sx, 0.62, -0.28, -0.24, 0.01);
      add(mg, 0.05, 0.05, 0.5, sx, 0.395, -0.04, 0, 0.01);
      add(mg, 0.05, 0.035, 0.42, sx, 0.62, 0.0, 0.05, 0.01);
      add(mg, 0.05, 0.1, 0.05, sx, 0.62 - 0.07, 0.17, 0, 0.01);
      add(mg, 0.09, 0.012, 0.1, sx, 0.004, 0.17, 0, 0.004);
      add(mg, 0.09, 0.012, 0.1, sx, 0.004, -0.25, 0, 0.004);
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(mergeGeometries(wg), wood), new THREE.Mesh(mergeGeometries(mg), metal));
    shadowAll(g);
    return g;
  });
}

// ─── 植え込み（ツツジ風。葉の房カード＋暗い芯）────────────────────────────────
function hedgeParts() {
  return once('hedge', () => {
    const mk = (flowers, seed) => {
      const R = rng(seed), [c, x] = makeCanvas(256);
      for (let i = 0; i < 40; i++) {
        const a = R() * 6.283, d = 16 + R() * 90, px = 128 + Math.cos(a) * d * 0.9, py = 128 + Math.sin(a) * d * 0.9;
        x.save(); x.translate(px, py); x.rotate(a + Math.PI / 2 + (R() - 0.5) * 0.8);
        const L = 20 + R() * 12, W = L * 0.4, k = 0.75 + R() * 0.5;
        const g = x.createLinearGradient(-W, 0, W, 0);
        g.addColorStop(0, `rgb(${30 * k | 0},${58 * k | 0},${20 * k | 0})`); g.addColorStop(0.5, `rgb(${52 * k | 0},${92 * k | 0},${30 * k | 0})`); g.addColorStop(1, `rgb(${36 * k | 0},${66 * k | 0},${22 * k | 0})`);
        x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, W, L, 0, 0, 6.283); x.fill();
        x.strokeStyle = `rgba(150,180,110,0.35)`; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, L * 0.9); x.lineTo(0, -L * 0.9); x.stroke();
        x.restore();
      }
      if (flowers) for (let f = 0; f < 4; f++) {
        const px = 70 + R() * 116, py = 70 + R() * 116, rs = 13 + R() * 5;
        for (let p = 0; p < 5; p++) {
          x.save(); x.translate(px, py); x.rotate((p / 5) * 6.283 + f);
          const g = x.createRadialGradient(0, -rs * 0.5, 2, 0, -rs * 0.5, rs * 0.7);
          g.addColorStop(0, 'rgb(236,120,170)'); g.addColorStop(1, 'rgb(200,62,120)');
          x.fillStyle = g; x.beginPath(); x.ellipse(0, -rs * 0.55, rs * 0.42, rs * 0.6, 0, 0, 6.283); x.fill(); x.restore();
        }
        x.fillStyle = 'rgba(150,30,80,0.7)'; x.beginPath(); x.arc(px, py, 4, 0, 6.283); x.fill();
      }
      return canvasTexture(c);
    };
    const opts = { alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 };
    const leafM = new THREE.MeshStandardMaterial(Object.assign({ map: mk(false, 81) }, opts));
    const flowM = new THREE.MeshStandardMaterial(Object.assign({ map: mk(true, 82) }, opts));
    const coreM = new THREE.MeshStandardMaterial({ color: srgb(26, 40, 16), roughness: 0.95 });
    return { leafM, flowM, coreM };
  });
}
function makeHedge(seed, len) {
  const { leafM, flowM, coreM } = hedgeParts(), R = rng(seed), n = makeNoise(seed, 16);
  const a = len / 2, b = 0.42, c = 0.36, cy = 0.24;
  const g = new THREE.Group();
  const core = new THREE.SphereGeometry(1, 40, 20), P = core.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), d = 0.92 + n(x * 3 + 5, z * 3 + y * 2) * 0.1;
    P.setXYZ(i, x * a * d, y * b * d + cy, z * c * d);
  }
  core.computeVertexNormals();
  g.add(new THREE.Mesh(core, coreM));
  const card = new THREE.PlaneGeometry(0.13, 0.13);
  const cnt = Math.round(len * 520);
  const lm = new THREE.InstancedMesh(card, leafM, cnt), fm = new THREE.InstancedMesh(card, flowM, Math.round(cnt * 0.12));
  let li = 0, fi = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  while (li < lm.count || fi < fm.count) {
    const u = R() * 6.283, v = Math.acos(1 - 2 * R()) ;
    const dx = Math.sin(v) * Math.cos(u), dy = Math.cos(v), dz = Math.sin(v) * Math.sin(u);
    if (dy < -0.35) continue;
    const off = 0.96 + R() * 0.12;
    const p = new THREE.Vector3(dx * a * off, dy * b * off + cy, dz * c * off);
    nrm.set(dx / a, dy / b, dz / c).normalize();
    nrm.x += (R() - 0.5) * 0.9; nrm.y += (R() - 0.5) * 0.9 + 0.2; nrm.z += (R() - 0.5) * 0.9; nrm.normalize();
    q.setFromUnitVectors(up, nrm); q2.setFromAxisAngle(up, R() * 6.283); q.multiply(q2);
    const s = 0.8 + R() * 0.5;
    m.compose(p, q, new THREE.Vector3(s, s, s));
    const fl = fi < fm.count && R() < 0.2 && dy > 0.1;
    if (fl) fm.setMatrixAt(fi++, m); else if (li < lm.count) lm.setMatrixAt(li++, m);
  }
  g.add(lm, fm);
  shadowAll(g);
  return g;
}

// ─── レジャーシート ─────────────────────────────────────────────────────────
function blanketMaterial() {
  return once('blanketMat', () => {
    const t = ginghamTex();
    return new THREE.MeshPhysicalMaterial({
      map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: t.rough, roughness: 1,
      sheen: 0.6, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.9, 0.85, 0.85), side: THREE.DoubleSide,
    });
  });
}
function makeBlanket(seed = 3) {
  const W = 1.6, D = 1.4, T = ginghamTex().T;
  const g = new THREE.PlaneGeometry(W, D, 128, 112);
  g.rotateX(-Math.PI / 2);
  const P = g.attributes.position, U = g.attributes.uv;
  const n = makeNoise(seed, 64), r = rng(seed + 1);
  const ridges = [];
  for (let i = 0; i < 6; i++) {
    let x, z;
    do { x = (r() - 0.5) * 1.4; z = (r() - 0.5) * 1.2; } while (Math.abs(x) < 0.42 && z > -0.62 && z < 0.42);
    const a = r() * 3.14;
    ridges.push({ x, z, dx: Math.cos(a), dz: Math.sin(a), L: 0.08 + r() * 0.16, h: 0.002 + r() * 0.003 });
  }
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i);
    const e = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z));
    const flat = smooth(0.5, 0.36, Math.abs(x)) * smooth(0.7, 0.56, Math.abs(z + 0.1));
    let y = (fbm(n, x * 6 + 10, z * 6 + 10, 3) - 0.5) * 0.009;
    for (const rd of ridges) {
      const px = x - rd.x, pz = z - rd.z, t = Math.max(-rd.L, Math.min(rd.L, px * rd.dx + pz * rd.dz));
      const d = Math.hypot(px - t * rd.dx, pz - t * rd.dz);
      y += rd.h * 1.4 * Math.exp(-(d * d) / (0.014 * 0.014)) * (1 - Math.abs(t) / rd.L * 0.6);
    }
    y *= 1 - flat * 0.85;
    // 縁：少し波打ち、地面へ垂れる
    const s = Math.abs(x) / (W / 2) > Math.abs(z) / (D / 2) ? z * 3 + Math.sign(x) * 7 : x * 3 + Math.sign(z) * 13;
    const wave = (n(s * 2.2 + 30, 5) - 0.35) * 0.008;
    y += wave * Math.exp(-e / 0.06);
    y -= Math.pow(1 - smooth(0, 0.028, e), 2) * 0.0045;
    y = Math.max(y, -0.0046);
    P.setY(i, y);
    U.setXY(i, (x + W / 2) / T, (z + D / 2) / T);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, blanketMaterial());
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

// ─── 環境マップ（PMREM）──────────────────────────────────────────────────
const ENV = new WeakMap();
function makeEnv(renderer) {
  if (ENV.has(renderer)) return ENV.get(renderer);
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sunDir: { value: new THREE.Vector3(-0.45, 0.8, -0.4).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vP); float h = d.y;
        float az = atan(d.z, d.x);
        vec3 sky = mix(vec3(0.78, 0.86, 0.95) * 1.25, vec3(0.22, 0.42, 0.86), pow(max(h, 0.0), 0.55));
        float s = max(dot(d, sunDir), 0.0);
        sky += vec3(1.0, 0.95, 0.86) * (pow(s, 900.0) * 120.0 + pow(s, 12.0) * 0.5);
        float top = 0.05 + 0.05 * sin(az * 5.0) * sin(az * 3.0 + 1.0) + 0.03 * sin(az * 17.0);
        vec3 col = sky;
        if (h < top) col = mix(vec3(0.10, 0.17, 0.06), vec3(0.2, 0.3, 0.12), smoothstep(0.0, top, h)) * 1.4;
        if (h < 0.0) col = mix(vec3(0.24, 0.34, 0.11), vec3(0.16, 0.24, 0.08), smoothstep(0.0, -0.4, h)) * 1.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sc, 0.0).texture;
  pm.dispose();
  ENV.set(renderer, tex);
  return tex;
}

// ─── 木もれ日（太陽 SpotLight のライトクッキー）─────────────────────────────
// 葉むらの影スプライト（黒の不透明度＝日をさえぎる率、穴＝木もれ日）。2枚1組で、ずらすと斑がまたたく。
function canopySprites(seed, edgeHoles) {
  const S = 256, R = rng(seed), [a, ax] = makeCanvas(S), [b, bx] = makeCanvas(S);
  const blobs = [];
  for (let i = 0; i < 300; i++) {
    const rr = 0.04 + R() * 0.08, ang = R() * 6.283, d = Math.pow(R(), 0.6) * (0.5 - rr);
    // 縁ほどまばら
    if (R() < smooth(0.25, 0.45, d) * 0.55) continue;
    blobs.push([0.5 + Math.cos(ang) * d, 0.5 + Math.sin(ang) * d, rr]);
  }
  for (const ctx of [ax, bx]) for (const [x, y, rr] of blobs) {
    const g = ctx.createRadialGradient(x * S, y * S, 0, x * S, y * S, rr * S);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * S, y * S, rr * S, 0, 6.283); ctx.fill();
  }
  const holes = [];
  for (let i = 0; i < 1500; i++) {
    const ang = R() * 6.283, d = Math.sqrt(R()) * 0.5;
    const pEdge = edgeHoles ? 0.18 + 0.82 * smooth(0.12, 0.4, d) : 0.5;
    if (R() > pEdge) continue;
    holes.push([0.5 + Math.cos(ang) * d, 0.5 + Math.sin(ang) * d, (0.006 + Math.pow(R(), 2.2) * 0.03) * (0.6 + d * 1.6)]);
  }
  ax.globalCompositeOperation = bx.globalCompositeOperation = 'destination-out';
  for (const [x, y, rr] of holes) for (const [ctx, j] of [[ax, 0], [bx, 1]]) {
    const ox = j ? (R() - 0.5) * 0.008 : 0, oy = j ? (R() - 0.5) * 0.008 : 0, k = j ? 0.8 + R() * 0.5 : 1;
    const X = (x + ox) * S, Y = (y + oy) * S, r2 = rr * S * k;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, r2);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r2, 0, 6.283); ctx.fill();
  }
  ax.globalCompositeOperation = bx.globalCompositeOperation = 'source-over';
  return [a, b];
}
class Dapple {
  constructor(group, light, size = 512) {
    [this.cv, this.cx] = makeCanvas(size);
    this.size = size;
    this.tex = canvasTexture(this.cv, { srgb: false });
    this.tex.generateMipmaps = false; this.tex.minFilter = THREE.LinearFilter;
    light.map = this.tex;
    this.group = group; this.light = light; this.canopies = []; this.shiftZ = 0; this.acc = 1; this.dirty = true;
    this.v = new THREE.Vector3();
  }
  add(x, z, r, seed, edge = true, alpha = 0.72) {
    const key = 'canopy' + seed + (edge ? 'e' : '');
    const spr = once(key, () => canopySprites(seed, edge));
    this.canopies.push({ x, z, r, spr, rot: seed * 1.7, alpha, ph: seed * 0.37 });
  }
  proj(x, z) {
    const v = this.v.set(x, 0, z).applyMatrix4(this.group.matrixWorld).applyMatrix4(this.light.shadow.matrix);
    return [v.x * this.size, (1 - v.y) * this.size];
  }
  paint(dt, t, gust) {
    this.acc += dt;
    if (this.acc < 1 / 30 && !this.dirty) return;
    this.acc = 0; this.dirty = false;
    const L = this.light, ctx = this.cx, S = this.size;
    this.group.updateWorldMatrix(true, false);
    L.updateWorldMatrix(false, false); L.target.updateWorldMatrix(false, false);
    L.shadow.updateMatrices(L);
    const o = this.proj(0, 0), ax = this.proj(1, 0), az = this.proj(0, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
    for (const c of this.canopies) {
      const cz = c.z + this.shiftZ;
      if (cz - c.r > 8 || cz + c.r < -14) continue;
      const w = 1 + gust * 0.6;
      const sA = [Math.sin(t * 0.9 + c.ph) * 0.014 * w, Math.sin(t * 0.7 + c.ph * 2) * 0.01 * w];
      const sB = [sA[0] + Math.sin(t * 2.1 + c.ph * 3) * 0.012 * w, sA[1] + Math.cos(t * 1.7 + c.ph) * 0.012 * w];
      for (const [img, s, rot] of [[c.spr[0], sA, c.rot], [c.spr[1], sB, c.rot + Math.sin(t * 0.8 + c.ph) * 0.004 * w]]) {
        ctx.setTransform(ax[0] - o[0], ax[1] - o[1], az[0] - o[0], az[1] - o[1], o[0], o[1]);
        ctx.translate(c.x + s[0], cz + s[1]); ctx.rotate(rot);
        ctx.globalAlpha = c.alpha;
        ctx.drawImage(img, -c.r, -c.r, c.r * 2, c.r * 2);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

// 太陽（遠方の狭角 SpotLight）とヘミライト
function makeSun(group, target, radius, dir) {
  const sun = new THREE.SpotLight(0xfff4e6, 3.2, 0, Math.atan(radius / 30), 0.15, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.00012; sun.shadow.normalBias = 0.006;
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(dir.clone().normalize(), 30);
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a8a3a, 0.22);
  group.add(hemi);
  return { sun, hemi };
}
function sunDir(azDeg, elDeg) {
  const a = THREE.MathUtils.degToRad(azDeg), e = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
function gustAt(t) {
  return Math.max(0, Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1.3)) * 1.2 + 0.1 * Math.sin(t * 1.3);
}

// ─── 舞い落ちる葉 ─────────────────────────────────────────────────────────
function makeLeafFall(avoid, area) {
  const MAX = 40, mesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial(), MAX);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const R = rng(99), Z = new THREE.Matrix4().makeScale(0, 0, 0);
  const L = [];
  const cols = [[96, 140, 40], [124, 160, 50], [150, 172, 62], [110, 150, 46], [168, 176, 70]];
  for (let i = 0; i < MAX; i++) { L.push({ st: 0, age: 0 }); mesh.setMatrixAt(i, Z); const c = cols[i % cols.length]; mesh.setColorAt(i, srgb(c[0], c[1], c[2])); }
  mesh.instanceColor.needsUpdate = true;
  let rate = 0, accum = 0, next = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  function spawn(delayH = 0) {
    let k = L.findIndex((l) => l.st === 0);
    if (k < 0) { let best = -1, ba = -1; L.forEach((l, i) => { if (l.st === 2 && l.age > ba) { ba = l.age; best = i; } }); k = best >= 0 ? best : next; }
    next = (k + 1) % MAX;
    let lx, lz;
    for (let tries = 0; tries < 30; tries++) {
      lx = (R() - 0.5) * area[0]; lz = (R() - 0.5) * area[1];
      if (!(lx > avoid[0] && lx < avoid[1] && lz > avoid[2] && lz < avoid[3])) break;
    }
    const h = 1.3 + R() * 0.5 + delayH;
    const l = L[k];
    Object.assign(l, { st: 1, age: 0, lx, lz, h, y: h, v: 0.28 + R() * 0.12, A: 0.06 + R() * 0.08, w: 2.2 + R() * 1.6, ph: R() * 6.28, yaw: R() * 6.28, spin: (R() - 0.5) * 1.5, rest: 12 + R() * 6, dx: (R() - 0.5) * 0.3, dz: (R() - 0.5) * 0.3 });
  }
  function update(dt) {
    if (rate > 0) { accum += dt * rate; while (accum >= 1) { accum -= 1; spawn(); } }
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const l = L[i];
      if (l.st === 0) continue;
      any = true; l.age += dt;
      if (l.st === 1) {
        l.y -= l.v * dt;
        const f = l.y / l.h; // 1→0
        const sw = Math.sin(l.age * l.w + l.ph);
        p.set(l.lx + l.dx * f + sw * l.A * Math.min(1, f * 4), Math.max(0.003, l.y), l.lz + l.dz * f + Math.cos(l.age * l.w * 0.5 + l.ph) * l.A * 0.5 * Math.min(1, f * 4));
        const fl = Math.min(1, f * 5);
        e.set(Math.cos(l.age * l.w + l.ph) * 0.9 * fl, l.yaw + l.spin * l.age, sw * 0.6 * fl, 'YXZ');
        if (l.y <= 0.003) { l.st = 2; l.age = 0; l.fx = p.x; l.fz = p.z; l.fyaw = l.yaw + l.spin * (l.h / l.v); }
      } else if (l.st === 2) {
        p.set(l.fx, 0.003, l.fz); e.set(0, l.fyaw, 0);
        if (l.age > l.rest) { l.st = 3; l.age = 0; }
      } else {
        const a = l.age;
        p.set(l.fx + a * a * 0.9, 0.003 + Math.max(0, Math.sin(a * 5)) * 0.04 * a, l.fz + a * a * 0.25);
        e.set(Math.sin(a * 9) * a, l.fyaw + a * 4, a * 2);
        if (a > 1.6) { l.st = 0; mesh.setMatrixAt(i, Z); continue; }
      }
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s));
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }
  return {
    mesh, update,
    api: { burst(n = 8) { for (let i = 0; i < n; i++) spawn(R() * 0.8); }, setRate(r) { rate = Math.max(0, r || 0); } },
  };
}

// ─── シーン共通の仕上げ ─────────────────────────────────────────────────────
function rootScene(o) { while (o.parent) o = o.parent; return o.isScene ? o : null; }

// ═══ Picnic ═══════════════════════════════════════════════════════════════
export function createPicnicSet(renderer) {
  const group = new THREE.Group(); group.name = 'picnicSet';
  const env = makeEnv(renderer);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), groundMaterial(null));
  ground.position.y = -0.005; ground.receiveShadow = true;
  group.add(ground);

  const blanket = makeBlanket(3);
  group.add(blanket);

  const trunk = makeTrunk(7, 0.27, 6, (x, z) => !(x - 1.0 > -0.92 && z - 1.1 > -0.82));
  trunk.position.set(-1.0, 0, -1.1);
  group.add(trunk);

  // 草の葉
  const U = swayUniforms();
  const R = rng(123), pts = [], hw = 0.8, hd = 0.7;
  while (pts.length < 6000) {
    const x = (R() - 0.5) * 3.6, z = -1.7 + R() * 2.9;
    const ex = Math.abs(x) - hw, ez = Math.abs(z) - hd;
    const inside = ex < 0 && ez < 0;
    if (inside && Math.max(ex, ez) < -0.004) continue;
    const de = inside ? 0 : Math.hypot(Math.max(ex, 0), Math.max(ez, 0));
    const dt = Math.hypot(x + 1.0, z + 1.1);
    if (dt < 0.42) continue;
    const w = 0.22 + 1.6 * Math.exp(-de / 0.07) + 0.4 * Math.exp(-(dt - 0.42) / 0.1);
    if (R() * 2.2 > w) continue;
    // 縁のものはシート側へ倒れる
    let yaw;
    if (de < 0.04) yaw = ex > ez ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : (z > 0 ? Math.PI : 0);
    pts.push([x, z, yaw]);
  }
  group.add(plantBlades(pts, U, 5));
  const cl = [];
  while (cl.length < 70) {
    const x = (R() - 0.5) * 3.4, z = -1.6 + R() * 2.7;
    if (Math.abs(x) < hw + 0.02 && Math.abs(z) < hd + 0.02) continue;
    if (Math.hypot(x + 1, z + 1.1) < 0.5) continue;
    if (R() < 0.5) { cl.push([x, z]); for (let k = 0; k < 3; k++) cl.push([x + (R() - 0.5) * 0.12, z + (R() - 0.5) * 0.12]); }
  }
  group.add(plantClover(cl, U, 6));
  const fl = [];
  for (let i = 0; i < 16; i++) {
    const x = (R() - 0.5) * 3.2, z = -1.6 + R() * 2.6;
    if (Math.abs(x) < hw + 0.03 && Math.abs(z) < hd + 0.03) continue;
    fl.push([x, -0.001, z]);
  }
  fl.push([-0.62, 0.002, -0.55], [0.66, 0.002, 0.52]);
  group.add(fallenLeaves(fl, 8));

  // 光
  const baseDir = { az: 32, el: 58 };
  const { sun, hemi } = makeSun(group, new THREE.Vector3(-0.1, 0, -0.25), 2.4, sunDir(baseDir.az, baseDir.el));
  const dapple = new Dapple(group, sun, 512);
  dapple.add(-1.2, -0.85, 2.2, 1, true, 0.82);
  dapple.add(1.9, -2.3, 1.3, 2, true, 0.6);
  dapple.add(-2.3, 0.9, 1.2, 3, true, 0.6);

  const fall = makeLeafFall([-0.36, 0.36, -0.56, 0.36], [1.5, 1.3]);
  group.add(fall.mesh);

  const fogColor = srgb(214, 226, 206);
  const fog0 = fogColor.clone(), fogW = srgb(236, 218, 180);
  const sun0 = sun.color.clone(), sunW = srgb(255, 184, 112), hs0 = hemi.color.clone(), hsW = srgb(255, 226, 200);
  let warmth = 0;
  function setWarmth(k) {
    k = Math.min(1, Math.max(0, k || 0)); warmth = k;
    const d = sunDir(baseDir.az + 22 * k, baseDir.el - 24 * k);
    sun.position.copy(sun.target.position).addScaledVector(d, 30);
    sun.color.lerpColors(sun0, sunW, k); sun.intensity = 3.2 - 0.5 * k;
    hemi.color.lerpColors(hs0, hsW, k * 0.6); hemi.intensity = 0.22 - 0.04 * k;
    const sc = rootScene(group), prev = fogColor.clone();
    fogColor.lerpColors(fog0, fogW, k);
    if (sc) {
      if (sc.fog) sc.fog.color.copy(fogColor);
      if (sc.background && sc.background.isColor && sc.background.equals(prev)) sc.background.copy(fogColor);
    }
    dapple.dirty = true;
  }

  group.userData = {
    env, envIntensity: 0.35, fogColor, fogNear: 2.2, fogFar: 9, sun, hemi,
    blanket: { w: 1.6, d: 1.4 },
    leaves: fall.api,
    setWarmth,
    update(dt, t) {
      const g = gustAt(t);
      U.uTime.value = t; U.uGust.value = g;
      dapple.paint(dt, t, g);
      fall.update(Math.min(dt, 0.05));
    },
  };
  group.userData.update(0, 0);
  return group;
}

// ═══ Walk ═════════════════════════════════════════════════════════════════
export function createWalkSet(renderer) {
  const group = new THREE.Group(); group.name = 'walkSet';
  const env = makeEnv(renderer);
  const world = new THREE.Group(); group.add(world);
  const PATH = { cx: -0.35, hw: 0.8, zEnd: -13.6 };
  const SHEET = { x: 0.45, z: -14.6 };
  const DIST = 12;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 44).rotateX(-Math.PI / 2).translate(0, 0, -14), groundMaterial(PATH));
  ground.position.y = -0.005; ground.receiveShadow = true;
  world.add(ground);

  // 流れてくるもの（world-local 座標）
  const trunks = [[1.3, -3.4, 0.2, 11], [-1.75, -6.2, 0.23, 12], [1.45, -9.3, 0.24, 13], [-1.95, -0.9, 0.21, 14], [SHEET.x - 1.0, SHEET.z - 1.1, 0.3, 7]];
  for (const [x, z, r, s] of trunks) { const t = makeTrunk(s, r, s === 7 ? 6 : 4.5, s === 7 ? (lx, lz) => !(lx - 1.0 > -0.92 && lz - 1.1 > -0.82) : null); t.position.set(x, 0, z); if (s !== 7) t.rotation.y = s; world.add(t); }
  const benchA = makeBench().clone(); benchA.position.set(1.05, 0, -6.6); benchA.rotation.y = Math.PI / 2; world.add(benchA);
  const benchB = makeBench().clone(); benchB.position.set(-1.62, 0, -10.8); benchB.rotation.y = -Math.PI / 2; world.add(benchB);
  const h1 = makeHedge(31, 1.4); h1.position.set(1.6, 0, -1.2); h1.rotation.y = Math.PI / 2; world.add(h1);
  const h2 = makeHedge(32, 1.8); h2.position.set(-1.75, 0, -3.3); h2.rotation.y = Math.PI / 2; world.add(h2);
  const h3 = makeHedge(33, 1.5); h3.position.set(1.25, 0, -11.2); h3.rotation.y = Math.PI / 2 + 0.1; world.add(h3);
  const sheet = makeBlanket(9); sheet.position.set(SHEET.x, 0, SHEET.z); sheet.rotation.y = 0.04; world.add(sheet);
  const R = rng(77), fl = [];
  for (let i = 0; i < 34; i++) {
    const onPath = R() < 0.6, z = 1 - R() * 17;
    const x = onPath ? PATH.cx + (R() - 0.5) * 1.5 : PATH.cx + (R() < 0.5 ? -1 : 1) * (0.85 + R() * 1.5);
    fl.push([x, onPath ? -0.003 : -0.002, z]);
  }
  world.add(fallenLeaves(fl, 9));

  // 草の葉（カメラ前後の窓で折り返して流す）
  const U = swayUniforms();
  const WZ0 = -7.5, WL = 9.5;
  U.uWrap.value.set(WZ0, WL, 1, 0);
  U.uPath.value.set(PATH.cx, PATH.hw, PATH.zEnd, 0);
  U.uSheet.value.set(SHEET.x, SHEET.z, 0.79, 0.69);
  const pts = [];
  while (pts.length < 6500) {
    const z = WZ0 + R() * WL;
    let x;
    if (R() < 0.6) { const side = R() < 0.5 ? -1 : 1; x = PATH.cx + side * (PATH.hw - 0.02 + Math.abs(R() + R() - 1) * 0.35 + (R() < 0.3 ? -0.04 * R() : 0)); }
    else x = PATH.cx + (R() - 0.5) * 6;
    let yaw;
    const d = Math.abs(x - PATH.cx) - PATH.hw;
    if (d > -0.03 && d < 0.05 && R() < 0.6) yaw = x > PATH.cx ? -Math.PI / 2 : Math.PI / 2;
    pts.push([x, z, yaw]);
  }
  group.add(plantBlades(pts, U, 15));
  const cl = [];
  while (cl.length < 90) {
    const x = PATH.cx + (R() < 0.5 ? -1 : 1) * (PATH.hw + 0.05 + R() * 2.2), z = WZ0 + R() * WL;
    cl.push([x, z]); if (R() < 0.6) cl.push([x + (R() - 0.5) * 0.1, z + (R() - 0.5) * 0.1]);
  }
  group.add(plantClover(cl, U, 16));

  // 光
  const { sun, hemi } = makeSun(group, new THREE.Vector3(0.1, 0, -2.3), 3.8, sunDir(-62, 55));
  const dapple = new Dapple(group, sun, 512);
  // 木の葉むらの影は、幹から影の方向へずれた所に落ちる（幹の影の先端が葉むらの影に溶ける）
  const sd = [0.883, 0.469];
  trunks.forEach(([x, z, r, s], i) => dapple.add(x + sd[0] * 2.6, z + sd[1] * 2.6, s === 7 ? 2.9 : 2.5, 4 + i, true, s === 7 ? 0.8 : 0.74));
  // 画面外（左奥）の木の影
  dapple.add(-1.1, -3.0, 2.2, 2, true, 0.66);
  dapple.add(-0.7, -9.6, 2.4, 3, true, 0.7);
  dapple.add(-1.4, -12.4, 2.0, 1, true, 0.62);

  const camera = { position: new THREE.Vector3(0, 0.85, 0), target: new THREE.Vector3(0, 0, -0.85 / Math.tan(THREE.MathUtils.degToRad(35))), fov: 50 };
  const bagAnchor = new THREE.Vector3(0.04, 0.86, -0.55);
  let prog = 0;
  function setProgress(p) {
    prog = Math.min(1, Math.max(0, p || 0));
    const off = prog * DIST;
    world.position.z = off;
    U.uWrap.value.w = off;
    dapple.shiftZ = off; dapple.dirty = true;
  }
  group.userData = {
    env, envIntensity: 0.35, fogColor: srgb(216, 226, 208), fogNear: 3.2, fogFar: 13, sun, hemi, world,
    camera, bagAnchor, setProgress,
    update(dt, t) {
      const g = gustAt(t);
      U.uTime.value = t; U.uGust.value = g;
      dapple.paint(dt, t, g);
    },
  };
  setProgress(0);
  group.userData.update(0, 0);
  return group;
}
