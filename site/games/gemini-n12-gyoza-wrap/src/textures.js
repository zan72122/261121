import * as THREE from 'three';

const loader = new THREE.TextureLoader();

function loadTex(url, { srgb = false, repeat = [1, 1], wrap = THREE.RepeatWrapping, anisotropy = 4, rotation = 0 } = {}) {
  const tex = loader.load(url);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  if (rotation) {
    tex.center.set(0.5, 0.5);
    tex.rotation = rotation;
  }
  return tex;
}

export function loadPBRSet(basePath, files, opts = {}) {
  const maps = {};
  if (files.map) maps.map = loadTex(`${basePath}/${files.map}`, { ...opts, srgb: true });
  if (files.normalMap) maps.normalMap = loadTex(`${basePath}/${files.normalMap}`, { ...opts, srgb: false });
  if (files.roughnessMap) maps.roughnessMap = loadTex(`${basePath}/${files.roughnessMap}`, { ...opts, srgb: false });
  if (files.metalnessMap) maps.metalnessMap = loadTex(`${basePath}/${files.metalnessMap}`, { ...opts, srgb: false });
  if (files.aoMap) maps.aoMap = loadTex(`${basePath}/${files.aoMap}`, { ...opts, srgb: false });
  return maps;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2D(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2D(x0, y0, seed);
  const b = hash2D(x1, y0, seed);
  const c = hash2D(x0, y1, seed);
  const d = hash2D(x1, y1, seed);
  return (a + (b - a) * u) + ((c - a) + (a - b - c + d) * u) * v;
}

function fbm2D(u, v, baseFreq, octaves, seed) {
  let val = 0;
  let amp = 0.5;
  let freq = baseFreq;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise2D(u * freq, v * freq, freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / norm;
}

function heightToNormalCanvas(heightData, size, strength = 2.0, flipY = true) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (heightData[y * size + xp] - heightData[y * size + xm]) * strength;
      const dy = (heightData[yp * size + x] - heightData[ym * size + x]) * strength;
      let nx = -dx;
      let ny = flipY ? dy : -dy;
      let nz = 1.0;
      const inv = 1.0 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const idx = (y * size + x) * 4;
      d[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = flipY;
  return tex;
}

/**
 * Photorealistic Japanese gyoza wheat wrapper skin PBR maps (512x512).
 * flipY = false so v = 0 maps directly to uv.y = 0 (center/pan-bottom) and v = 1 maps to uv.y = 1 (outer/top rim).
 */
export function createGyozaSkinMaps() {
  const size = 512;
  const cDiff = document.createElement('canvas');
  const cRough = document.createElement('canvas');
  cDiff.width = cRough.width = size;
  cDiff.height = cRough.height = size;
  const ctxD = cDiff.getContext('2d');
  const ctxR = cRough.getContext('2d');
  const imgD = ctxD.createImageData(size, size);
  const imgR = ctxR.createImageData(size, size);
  const hData = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size; // 0 = center/bottom, 1 = outer rim/crest
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = fbm2D(u, v, 8, 4, 101);
      const n2 = fbm2D(u, v, 24, 3, 211);
      const dust = Math.max(0, fbm2D(u, v, 14, 4, 307) - 0.50) * 1.9;
      const grain = hash2D(x, y, 409) * 0.04;

      // Natural warm unbleached translucent wheat flour dough (warm creamy ivory, never cool putty grey!)
      let r = 236 + (n1 - 0.5) * 14 + dust * 14 + grain * 10;
      let g = 220 + (n1 - 0.5) * 14 + dust * 14 + grain * 9;
      let b = 186 + (n1 - 0.5) * 15 + dust * 15 + grain * 9;

      // Subtle warm translucent thickness variation (slightly darker/warmer in stretched belly)
      const bellyBand = Math.exp(-Math.pow((v - 0.48) / 0.25, 2));
      r -= bellyBand * 7;
      g -= bellyBand * 10;
      b -= bellyBand * 14;

      // Delicate slightly whiter powdery outer rim edge
      const rimDust = Math.pow(v, 3.0) * 10;
      r += rimDust; g += rimDust * 0.95; b += rimDust * 0.9;

      const idx = (y * size + x) * 4;
      imgD.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      imgD.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      imgD.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      imgD.data[idx + 3] = 255;

      const rough = Math.min(0.95, Math.max(0.50, 0.68 + (n2 - 0.5) * 0.16 + dust * 0.24));
      const rv = Math.round(rough * 255);
      imgR.data[idx] = imgR.data[idx + 1] = imgR.data[idx + 2] = rv;
      imgR.data[idx + 3] = 255;

      hData[y * size + x] = n1 * 0.5 + n2 * 0.35 + dust * 0.25 + grain;
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxR.putImageData(imgR, 0, 0);

  const map = new THREE.CanvasTexture(cDiff);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.flipY = false;

  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.flipY = false;

  const normalMap = heightToNormalCanvas(hData, size, 1.35, false);
  return { map, roughnessMap, normalMap };
}

/**
 * Photorealistic cooked/seared gyoza skin map (512x512, flipY = false!).
 * v = 0.00..0.38 -> crispy golden-brown Maillard seared FLAT BOTTOM!
 * v = 0.40..0.72 -> moist steamed translucent belly with subtle green chive/pork shadow inside!
 * v = 0.72..1.00 -> delicate warm steamed pale-ivory pleated crest!
 */
export function createCookedGyozaSkinMaps() {
  const size = 512;
  const cDiff = document.createElement('canvas');
  const cRough = document.createElement('canvas');
  cDiff.width = cRough.width = size;
  cDiff.height = cRough.height = size;
  const ctxD = cDiff.getContext('2d');
  const ctxR = cRough.getContext('2d');
  const imgD = ctxD.createImageData(size, size);
  const imgR = ctxR.createImageData(size, size);
  const hData = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size; // 0 = FLAT PAN-SEARED BOTTOM, 1 = TOP PLEATED CREST
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = fbm2D(u, v, 8, 4, 503);
      const n2 = fbm2D(u, v, 24, 4, 607);
      const crisp = fbm2D(u, v, 44, 3, 709);

      // Steamed translucent wheat dough (slightly glistening warm ivory-cream)
      let r = 232 + (n1 - 0.5) * 14;
      let g = 216 + (n1 - 0.5) * 14;
      let b = 180 + (n1 - 0.5) * 16;

      // Subtle translucent glow of pork+nira filling dimly visible inside steamed mid-belly!
      const bellyZone = Math.exp(-Math.pow((v - 0.56) / 0.16, 2));
      const chiveHint = Math.max(0, fbm2D(u, v, 14, 3, 811) - 0.50) * 2.1;
      r -= bellyZone * (14 + chiveHint * 24);
      g -= bellyZone * (11 - chiveHint * 6);
      b -= bellyZone * (22 + chiveHint * 22);

      // Authentic crispy golden-amber Maillard sear strictly on the FLAT BOTTOM (v < 0.37)!
      // Irregular organic edge where oil bubbled up slightly along the bottom lip
      const edgeWobble = (n1 - 0.5) * 0.13 + (n2 - 0.5) * 0.05;
      const searMask = Math.min(1, Math.max(0, (0.37 + edgeWobble - v) / 0.11));
      // Inner center of flat bottom gets richest roasted chestnut-gold crust
      const coreBoost = Math.max(0, 1 - v / 0.34);
      const searLevel = Math.min(1, Math.max(0, searMask * (0.48 + coreBoost * 0.32 + n2 * 0.45)));
      const blisterChar = Math.max(0, searLevel - 0.72) * 2.9;

      // Rich appetizing fried gyoza golden-brown palette (deep honey -> roasted caramel -> crisp dark edge)
      const sr = 194 - searLevel * 74 - blisterChar * 42 + (crisp - 0.5) * 26;
      const sg = 122 - searLevel * 62 - blisterChar * 32 + (crisp - 0.5) * 18;
      const sb = 40 - searLevel * 24 - blisterChar * 14 + (crisp - 0.5) * 10;

      // Soft golden halo right above the sear line (oil-kissed transition)
      const halo = Math.exp(-Math.pow((v - (0.39 + edgeWobble)) / 0.07, 2)) * 0.35;
      r = r * (1 - halo) + 206 * halo;
      g = g * (1 - halo) + 158 * halo;
      b = b * (1 - halo) + 88 * halo;

      r = r * (1 - searMask) + sr * searMask;
      g = g * (1 - searMask) + sg * searMask;
      b = b * (1 - searMask) + sb * searMask;

      const idx = (y * size + x) * 4;
      imgD.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      imgD.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      imgD.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      imgD.data[idx + 3] = 255;

      // Steamed skin is softly moist (0.32..0.48); seared crust is crispy & slightly oil-glossed (0.34..0.56)
      const steamedRough = 0.34 + n2 * 0.16;
      const searedRough = 0.36 + crisp * 0.24 - blisterChar * 0.08;
      const rough = Math.min(0.82, Math.max(0.24, steamedRough * (1 - searMask) + searedRough * searMask));
      const rv = Math.round(rough * 255);
      imgR.data[idx] = imgR.data[idx + 1] = imgR.data[idx + 2] = rv;
      imgR.data[idx + 3] = 255;

      hData[y * size + x] = n1 * 0.35 + n2 * 0.28 + crisp * searMask * 0.85;
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxR.putImageData(imgR, 0, 0);

  const map = new THREE.CanvasTexture(cDiff);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.flipY = false;

  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.flipY = false;

  const normalMap = heightToNormalCanvas(hData, size, 2.5, false);
  return { map, roughnessMap, normalMap };
}

/**
 * Photorealistic gyoza filling (あん): minced pork + finely chopped pale cabbage + fresh green nira/scallion.
 */
export function createFillingMaps() {
  const size = 512;
  const cDiff = document.createElement('canvas');
  const cRough = document.createElement('canvas');
  cDiff.width = cRough.width = size;
  cDiff.height = cRough.height = size;
  const ctxD = cDiff.getContext('2d');
  const ctxR = cRough.getContext('2d');
  const rng = mulberry32(99173);

  ctxD.fillStyle = '#a86957';
  ctxD.fillRect(0, 0, size, size);
  ctxR.fillStyle = '#555555';
  ctxR.fillRect(0, 0, size, size);

  const hData = new Float32Array(size * size);
  const imgD = ctxD.getImageData(0, 0, size, size);
  const imgR = ctxR.getImageData(0, 0, size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const meat = fbm2D(u, v, 16, 4, 123);
      const fat = Math.max(0, fbm2D(u, v, 24, 3, 456) - 0.56) * 2.3;
      const idx = (y * size + x) * 4;
      const r = 152 + (meat - 0.5) * 48 + fat * 68;
      const g = 96 + (meat - 0.5) * 38 + fat * 76;
      const b = 80 + (meat - 0.5) * 32 + fat * 72;
      imgD.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      imgD.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      imgD.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      imgD.data[idx + 3] = 255;

      const rough = Math.min(0.65, Math.max(0.18, 0.34 + (1 - meat) * 0.22 - fat * 0.12));
      const rv = Math.round(rough * 255);
      imgR.data[idx] = imgR.data[idx + 1] = imgR.data[idx + 2] = rv;
      imgR.data[idx + 3] = 255;
      hData[y * size + x] = meat * 0.7 + fat * 0.3;
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxR.putImageData(imgR, 0, 0);

  function drawBits(count, colors, minS, maxS, roughHex, bumpDelta) {
    for (let i = 0; i < count; i++) {
      const cx = rng() * size;
      const cy = rng() * size;
      const w = minS + rng() * (maxS - minS);
      const h = minS * 0.7 + rng() * (maxS - minS) * 0.8;
      const ang = rng() * Math.PI * 2;
      const col = colors[Math.floor(rng() * colors.length)];
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const px = cx + ox, py = cy + oy;
          if (px < -30 || px > size + 30 || py < -30 || py > size + 30) continue;
          ctxD.save();
          ctxD.translate(px, py);
          ctxD.rotate(ang);
          ctxD.fillStyle = col;
          ctxD.beginPath();
          ctxD.roundRect(-w * 0.5, -h * 0.5, w, h, Math.min(w, h) * 0.25);
          ctxD.fill();
          ctxD.restore();

          ctxR.save();
          ctxR.translate(px, py);
          ctxR.rotate(ang);
          ctxR.fillStyle = roughHex;
          ctxR.fillRect(-w * 0.5, -h * 0.5, w, h);
          ctxR.restore();
        }
      }
      const rPx = Math.ceil(Math.max(w, h) * 0.6);
      for (let dy = -rPx; dy <= rPx; dy++) {
        for (let dx = -rPx; dx <= rPx; dx++) {
          const d2 = (dx * dx + dy * dy) / (rPx * rPx + 0.01);
          if (d2 < 1) {
            const x = ((Math.round(cx) + dx) % size + size) % size;
            const y = ((Math.round(cy) + dy) % size + size) % size;
            hData[y * size + x] += bumpDelta * (1 - d2);
          }
        }
      }
    }
  }

  drawBits(540, ['#d7dfb8', '#e2e6c8', '#c7d3a0', '#ebeadd'], 5, 14, '#464646', 0.28);
  drawBits(380, ['#9b5748', '#b76c5b', '#874639', '#d2a28e'], 5, 13, '#3b3b3b', 0.34);
  drawBits(480, ['#2f6b2c', '#3d7f35', '#245522', '#4c8e3e', '#5fa047'], 4, 12, '#4c4c4c', 0.32);

  const map = new THREE.CanvasTexture(cDiff);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;

  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  const normalMap = heightToNormalCanvas(hData, size, 3.6);
  return { map, roughnessMap, normalMap };
}

/**
 * Photorealistic lacy golden-amber Hanetsuki (羽根つき) crispy starch crust (512x512).
 * Uses domain-warped organic frothy steam bubbles + continuous golden toasted starch sheet
 * connecting the 5 gyoza footprints cleanly (NO geometric straight-line Voronoi wireframe!),
 * with clear cutout windows for the 5 seared gyoza bottoms so they fuse seamlessly!
 */
export function createHanetsukiWingMaps() {
  const size = 512;
  const cDiff = document.createElement('canvas');
  const cAlpha = document.createElement('canvas');
  const cRough = document.createElement('canvas');
  cDiff.width = cAlpha.width = cRough.width = size;
  cDiff.height = cAlpha.height = cRough.height = size;
  const ctxD = cDiff.getContext('2d');
  const ctxA = cAlpha.getContext('2d');
  const ctxR = cRough.getContext('2d');
  const imgD = ctxD.createImageData(size, size);
  const imgA = ctxA.createImageData(size, size);
  const imgR = ctxR.createImageData(size, size);
  const hData = new Float32Array(size * size);

  // Pre-compute the 5 gyoza ring footprint centers in UV space (matching ringRadius=0.0585 on 0.098 radius wing!)
  const ringRatio = 0.0585 / 0.196; // ~0.298 in UV space from (0.5, 0.5)
  const gyozaCenters = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI * 0.5 + (i % 2 === 0 ? 0.03 : -0.02);
    gyozaCenters.push({
      cx: 0.5 + Math.cos(angle) * ringRatio,
      cy: 0.5 + Math.sin(angle) * ringRatio,
      tx: -Math.sin(angle), // tangent along gyoza length
      ty: Math.cos(angle),
      nx: Math.cos(angle),  // radial normal across gyoza width
      ny: Math.sin(angle),
    });
  }

  // Generate varied organic steam-blister holes (clustered foamy bubbles, NOT uniform circles!)
  const rng = mulberry32(77351);
  const bubbles = [];
  for (let i = 0; i < 38; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.43;
    bubbles.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, rx: 0.015 + rng() * 0.020, ry: 0.011 + rng() * 0.018, rot: rng() * Math.PI });
  }
  for (let i = 0; i < 190; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.45;
    bubbles.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, rx: 0.005 + rng() * 0.011, ry: 0.004 + rng() * 0.009, rot: rng() * Math.PI });
  }
  for (let i = 0; i < 480; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.47;
    bubbles.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, rx: 0.002 + rng() * 0.0045, ry: 0.002 + rng() * 0.004, rot: rng() * Math.PI });
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const dxC = u - 0.5;
      const dyC = v - 0.5;
      const distC = Math.hypot(dxC, dyC);
      const ang = Math.atan2(dyC, dxC);

      const nBig = fbm2D(u, v, 6, 4, 71);
      const nMed = fbm2D(u, v, 16, 3, 173);
      const nFine = fbm2D(u, v, 36, 3, 277);
      const nCrisp = fbm2D(u, v, 64, 2, 431);

      // Domain-warped organic coordinates so bubbles look like real baked fried starch lace!
      const wu = u + (nMed - 0.5) * 0.032 + (nFine - 0.5) * 0.012;
      const wv = v + (nBig - 0.5) * 0.032 - (nFine - 0.5) * 0.012;

      // Irregular crisp outer perimeter
      const outerR = 0.45 + (nBig - 0.5) * 0.09 + Math.sin(ang * 5 + 0.5) * 0.020;
      const perimMask = Math.min(1, Math.max(0, (outerR - distC) / 0.045));

      // Compute proximity to the 5 seared gyoza bases:
      // Inside a gyoza base -> fade wing cleanly out so the ACTUAL golden seared gyoza bottom shows!
      // Just outside a gyoza base -> thick rich toasted golden collar!
      let minGyozaDist = 99;
      for (let i = 0; i < 5; i++) {
        const gc = gyozaCenters[i];
        const rx = u - gc.cx;
        const ry = v - gc.cy;
        const along = (rx * gc.tx + ry * gc.ty) / 0.125; // tight footprint hug — zero dark sliver gap!
        const across = (rx * gc.nx + ry * gc.ny) / 0.046;
        const ed = Math.hypot(along, across);
        if (ed < minGyozaDist) minGyozaDist = ed;
      }

      // Soft collar right around each gyoza base — continuous lacy crust works for 3, 4, or 5 gyoza with ZERO empty oval holes!
      const gyozaCutout = 1.0;
      const collarBoost = Math.exp(-Math.pow((minGyozaDist - 1.05) / 0.38, 2));

      // Base thin fried starch sheet with organic frothy holes punched through it
      let web = perimMask * (0.86 + collarBoost * 0.45 + (nMed - 0.5) * 0.28);
      let ridge = 0;

      if (web > 0.02 && gyozaCutout > 0.02) {
        for (let i = 0; i < bubbles.length; i++) {
          const b = bubbles[i];
          const bdx = wu - b.x;
          const bdy = wv - b.y;
          if (Math.abs(bdx) > b.rx * 2.2 && Math.abs(bdy) > b.ry * 2.2) continue;
          const c = Math.cos(b.rot), s = Math.sin(b.rot);
          const lx = (bdx * c + bdy * s) / b.rx;
          const ly = (-bdx * s + bdy * c) / b.ry;
          const d = Math.hypot(lx, ly);
          if (d < 1.45) {
            // Fewer holes right on the thickened collar around gyoza, more lacy open holes in center & outer rim
            const holeStrength = Math.max(0.25, 1.0 - collarBoost * 0.62);
            const cut = Math.min(1, Math.max(0, (d - 0.72) / 0.32));
            web *= 1.0 - (1.0 - cut) * holeStrength;
            if (d > 0.68 && d < 1.38) {
              ridge += (1.0 - Math.abs(d - 1.0) / 0.38) * 0.35;
            }
          }
        }
      }

      // Extra delicate wispy cracks near very outer thin lace edge
      if (distC > 0.36) {
        web -= Math.max(0, 0.54 - nFine) * 1.15;
      }

      const alpha = Math.min(1, Math.max(0, web * gyozaCutout));

      // Authentic rich golden-brown Japanese hanetsuki crust color:
      // Deep toasted amber-chestnut near gyoza bases & crispy bubble ridges, warm translucent honey gold in thin web!
      const toast = Math.min(1, Math.max(0,
        0.35 +
        collarBoost * 0.44 +
        ridge * 0.32 +
        nBig * 0.28 +
        (nCrisp - 0.5) * 0.22 -
        Math.max(0, distC - 0.36) * 1.25
      ));
      const r = 232 - toast * 86;
      const g = 176 - toast * 94;
      const b = 86 - toast * 58;

      const idx = (y * size + x) * 4;
      imgD.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      imgD.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      imgD.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      imgD.data[idx + 3] = 255;

      const av = Math.round(alpha * 255);
      imgA.data[idx] = imgA.data[idx + 1] = imgA.data[idx + 2] = av;
      imgA.data[idx + 3] = 255;

      const rough = Math.min(0.76, Math.max(0.24, 0.38 + nCrisp * 0.22 - ridge * 0.10));
      const rv = Math.round(rough * 255);
      imgR.data[idx] = imgR.data[idx + 1] = imgR.data[idx + 2] = rv;
      imgR.data[idx + 3] = 255;

      hData[y * size + x] = alpha * (0.4 + ridge * 0.65 + nFine * 0.35);
    }
  }
  ctxD.putImageData(imgD, 0, 0);
  ctxA.putImageData(imgA, 0, 0);
  ctxR.putImageData(imgR, 0, 0);

  const map = new THREE.CanvasTexture(cDiff);
  map.colorSpace = THREE.SRGBColorSpace;
  const alphaMap = new THREE.CanvasTexture(cAlpha);
  alphaMap.colorSpace = THREE.NoColorSpace;
  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  const normalMap = heightToNormalCanvas(hData, size, 3.0);

  return { map, alphaMap, roughnessMap, normalMap };
}

/**
 * Authentic Japanese woven oatmeal cotton-linen kitchen cloth (ふきん) with traditional subtle indigo stripes.
 */
export function createWovenClothMap() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Crisp plain-weave warp & weft threads!
      const warp = Math.sin(x * 1.45) * 0.5 + 0.5;
      const weft = Math.sin(y * 1.45) * 0.5 + 0.5;
      const checker = ((Math.floor(x / 2.2) + Math.floor(y / 2.2)) % 2 === 0) ? warp : weft;
      const slub = fbm2D(u, v, 14, 3, 613);

      // Warm unbleached natural Japanese linen base
      let r = 216 + (checker - 0.5) * 24 + (slub - 0.5) * 14;
      let g = 204 + (checker - 0.5) * 22 + (slub - 0.5) * 14;
      let b = 184 + (checker - 0.5) * 20 + (slub - 0.5) * 14;

      // Traditional woven Japanese muted navy-indigo border stripes along left & right edges
      const stripe =
        (u > 0.08 && u < 0.115) ||
        (u > 0.13 && u < 0.145) ||
        (u > 0.885 && u < 0.92) ||
        (u > 0.855 && u < 0.87);
      if (stripe) {
        const threadMix = 0.72 + checker * 0.25;
        r = r * (1 - threadMix) + 52 * threadMix;
        g = g * (1 - threadMix) + 68 * threadMix;
        b = b * (1 - threadMix) + 88 * threadMix;
      }

      const idx = (y * size + x) * 4;
      img.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      img.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      img.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Authentic Japanese Kuro-Mino speckled dark slate stoneware ceramic glaze map (512x512).
 */
export function createStonewareGlazeMap() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(55123);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Subtle potter's wheel concentric throwing rings
      const wheel = Math.sin(v * Math.PI * 52) * 0.5 + 0.5;
      const glaze = fbm2D(u, v, 8, 4, 887);
      const speck = hash2D(x, y, 919);

      let r = 34 + glaze * 18 + wheel * 3;
      let g = 38 + glaze * 19 + wheel * 3;
      let b = 45 + glaze * 22 + wheel * 4;

      // Warm mineral kiln iron flecks
      if (speck > 0.988) {
        r += 26; g += 18; b += 10;
      } else if (speck < 0.018) {
        r -= 14; g -= 14; b -= 14;
      }

      const idx = (y * size + x) * 4;
      img.data[idx] = Math.min(255, Math.max(0, Math.round(r)));
      img.data[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      img.data[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Subtle artisanal kiln mineral dots
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(95, 82, 68, 0.35)' : 'rgba(18, 20, 24, 0.45)';
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 0.7 + rng() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createContactShadowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0.0, 'rgba(14, 10, 6, 0.72)');
  grad.addColorStop(0.55, 'rgba(14, 10, 6, 0.40)');
  grad.addColorStop(0.82, 'rgba(14, 10, 6, 0.13)');
  grad.addColorStop(1.0, 'rgba(14, 10, 6, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRectContactShadowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    const pad = 16 + i * 2.2;
    const rad = 28 - i * 0.8;
    ctx.fillStyle = 'rgba(14, 10, 6, 0.045)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, Math.max(8, rad));
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSteamTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const dist = Math.hypot(u - 0.5, v - 0.5) * 2.0;
      const falloff = Math.max(0, 1 - dist * dist);
      const wisp = fbm2D(u, v, 4, 4, 991);
      const detail = fbm2D(u + 0.3, v + 0.1, 8, 3, 733);
      const a = Math.pow(falloff, 1.6) * Math.max(0, (wisp * 0.7 + detail * 0.3 - 0.22) * 1.45);
      const idx = (y * size + x) * 4;
      img.data[idx] = 252;
      img.data[idx + 1] = 250;
      img.data[idx + 2] = 246;
      img.data[idx + 3] = Math.min(255, Math.max(0, Math.round(a * 215)));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCondensationMaps() {
  const size = 512;
  const cRough = document.createElement('canvas');
  cRough.width = cRough.height = size;
  const ctxR = cRough.getContext('2d');
  const hData = new Float32Array(size * size);
  const rng = mulberry32(31415);

  ctxR.fillStyle = '#484848';
  ctxR.fillRect(0, 0, size, size);

  for (let i = 0; i < 650; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r = 1.5 + Math.pow(rng(), 2.2) * 6.5;
    const grad = ctxR.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, '#101010');
    grad.addColorStop(0.75, '#181818');
    grad.addColorStop(1, '#585858');
    ctxR.fillStyle = grad;
    ctxR.beginPath();
    ctxR.arc(cx, cy, r, 0, Math.PI * 2);
    ctxR.fill();

    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d < 1) {
          const x = ((Math.round(cx) + dx) % size + size) % size;
          const y = ((Math.round(cy) + dy) % size + size) % size;
          hData[y * size + x] = Math.max(hData[y * size + x], Math.sqrt(1 - d * d) * (r / 6.5));
        }
      }
    }
  }
  const roughnessMap = new THREE.CanvasTexture(cRough);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  const normalMap = heightToNormalCanvas(hData, size, 2.8);
  return { roughnessMap, normalMap };
}
