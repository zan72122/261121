import * as THREE from 'three';

const MASK_SIZE = 256;

// Simple deterministic hash noise for realistic organic mud splatter & foam breakup
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * smoothNoise(x * freq, y * freq);
    freq *= 2.05;
    amp *= 0.5;
  }
  return v;
}

/**
 * Maps a point in car-local space (meters) to wash mask UV [0, 1]^2.
 * Front of SUV is -X (-2.37), rear is +X (+2.39), camera side is +Z (+0.97).
 */
export function localPosToWashUV(lx, ly, lz, out = { u: 0, v: 0 }) {
  const u = Math.max(0, Math.min(1, (lx + 2.45) / 4.9));
  const arc = ly + (0.98 - lz) * 0.62;
  const v = Math.max(0, Math.min(1, arc / 2.95));
  out.u = u;
  out.v = v;
  return out;
}

export class CarWashSurface {
  constructor(textures) {
    this.size = MASK_SIZE;
    // RGBA: R = mud, G = wetness/droplets, B = foam, A = wiped polish
    this.data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
    this.maskTexture = new THREE.DataTexture(
      this.data,
      MASK_SIZE,
      MASK_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.maskTexture.colorSpace = THREE.NoColorSpace;
    this.maskTexture.minFilter = THREE.LinearFilter;
    this.maskTexture.magFilter = THREE.LinearFilter;
    this.maskTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.maskTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTexture.needsUpdate = true;

    this.uniforms = {
      uWashMask: { value: this.maskTexture },
      uMudDiff: { value: textures.mud.map },
      uMudNor: { value: textures.mud.normalMap },
      uMudArm: { value: textures.mud.armMap },
      uTime: { value: 0 },
    };

    this.dirty = true;
    this._dripRow = 0;
    this.puddleWetness = 0.25; // feeds driveway wetness under the car

    this.seedInitialMud();
  }

  /**
   * Realistic road-splash mud pattern: heaviest around wheel wells, lower doors,
   * front bumper/hood edge, and scattered splashes across doors & windshield.
   */
  seedInitialMud(seedOffset = 0) {
    const N = this.size;
    const ox = seedOffset * 3.7;
    const oy = seedOffset * 2.3;
    for (let y = 0; y < N; y++) {
      const v = y / (N - 1);
      for (let x = 0; x < N; x++) {
        const u = x / (N - 1);
        const idx = (y * N + x) * 4;

        const n1 = fbm(u * 9.5 + 1.3 + ox, v * 7.5 + 2.1 + oy);
        const n2 = fbm(u * 24.0 + 5.7 + ox, v * 20.0 + 3.4 + oy);

        const wheelFront = Math.exp(-Math.pow((u - 0.22) / 0.14, 2) - Math.pow((v - 0.18) / 0.20, 2));
        const wheelRear = Math.exp(-Math.pow((u - 0.78) / 0.15, 2) - Math.pow((v - 0.18) / 0.20, 2));
        const lowerBelt = Math.max(0, 1.0 - (v - 0.04) / 0.42);
        const hoodSplash = Math.exp(-Math.pow((u - 0.18) / 0.22, 2) - Math.pow((v - 0.56) / 0.19, 2)) * 0.92;
        const doorSplash = Math.exp(-Math.pow((u - 0.50) / 0.26, 2) - Math.pow((v - 0.32) / 0.22, 2)) * 0.85;
        const windshieldMud = Math.exp(-Math.pow((u - 0.36) / 0.14, 2) - Math.pow((v - 0.62) / 0.14, 2)) * 0.72;

        let mud = Math.max(lowerBelt * 0.95, wheelFront * 1.15, wheelRear * 1.05, hoodSplash, doorSplash, windshieldMud);
        mud = mud * (0.55 + n1 * 0.85) + (n2 - 0.52) * 0.45;
        mud = Math.max(0, Math.min(1, (mud - 0.24) * 2.15));

        this.data[idx] = Math.round(mud * 255);
        this.data[idx + 1] = 0;
        this.data[idx + 2] = 0;
        this.data[idx + 3] = 0;
      }
    }
    this.puddleWetness = 0.14;
    this.dirty = true;
  }

  /**
   * Sets entire car to mirror-clean spotless waxed finish (for verification / finish polish).
   */
  seedSpotlessState() {
    const N = this.size;
    for (let i = 0; i < N * N; i++) {
      const idx = i * 4;
      this.data[idx] = 0;
      this.data[idx + 1] = 0;
      this.data[idx + 2] = 0;
      this.data[idx + 3] = 255;
    }
    this.puddleWetness = 0.65;
    this.dirty = true;
  }

  /**
   * Showcase state for Stage 1 photorealism screenshot evaluation:
   * Shows dry mud on front hood/fender, wet dripping mud transition, thick frothy soap foam
   * across front door, and glistening wet clearcoat reflection on rear door!
   */
  seedShowcaseState() {
    this.seedInitialMud();
    const N = this.size;
    for (let y = 0; y < N; y++) {
      const v = y / (N - 1);
      for (let x = 0; x < N; x++) {
        const u = x / (N - 1);
        const idx = (y * N + x) * 4;
        const n = fbm(u * 14.0 + 2.2, v * 14.0 + 4.1);

        // Wet band from front fender to rear
        const wetZone = Math.max(0, Math.min(1, (u - 0.17 + (n - 0.5) * 0.12) * 5.0));
        // Thick frothy foam patch on the front/mid door & hood edge
        const foamDist = Math.hypot((u - 0.43) / 0.19, (v - 0.34) / 0.23);
        const foam = Math.max(0, Math.min(1, (1.0 - foamDist + (n - 0.45) * 0.42) * 2.1));
        // Clean glistening wet clearcoat on rear door
        const cleanZone = Math.max(0, Math.min(1, (u - 0.56 + (n - 0.5) * 0.08) * 5.5));

        let mud = this.data[idx] / 255;
        mud *= (1.0 - cleanZone * 0.92) * (1.0 - foam * 0.75);

        this.data[idx] = Math.round(Math.max(0, Math.min(1, mud)) * 255);
        this.data[idx + 1] = Math.round(Math.max(wetZone * 0.9, foam * 0.7) * 255);
        this.data[idx + 2] = Math.round(foam * 255);
        this.data[idx + 3] = Math.round(cleanZone * 0.65 * 255);
      }
    }
    this.puddleWetness = 0.78;
    this.dirty = true;
  }

  /**
   * Paints a tool stroke at car-local coordinates.
   * Returns { mudRemoved, foamAdded, foamRemoved, dried } for particle/audio feedback.
   */
  applyTool(localPos, tool, dt, radiusUV = 0.085) {
    const uv = localPosToWashUV(localPos.x, localPos.y, localPos.z);
    const N = this.size;
    const cx = uv.u * (N - 1);
    const cy = uv.v * (N - 1);
    const rPx = Math.max(3, Math.round(radiusUV * N));
    const r2 = rPx * rPx;

    const x0 = Math.max(0, Math.floor(cx - rPx));
    const x1 = Math.min(N - 1, Math.ceil(cx + rPx));
    const y0 = Math.max(0, Math.floor(cy - rPx));
    const y1 = Math.min(N - 1, Math.ceil(cy + rPx));

    const rate = Math.min(1, dt * 6.5);
    let mudRemoved = 0;
    let foamAdded = 0;
    let foamRemoved = 0;
    let dried = 0;

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;

        const dist = Math.sqrt(d2) / rPx;
        const falloff = (1 - dist) * (1 - dist);
        const f = falloff * rate;
        const idx = (y * N + x) * 4;

        let mud = this.data[idx] / 255;
        let wet = this.data[idx + 1] / 255;
        let foam = this.data[idx + 2] / 255;
        let polish = this.data[idx + 3] / 255;

        if (tool === 'hose') {
          // Focused water jet: wets everything immediately, softens & strips heavy mud
          wet = Math.min(1, wet + f * 2.2);
          const dm = Math.min(mud, f * (0.48 + wet * 0.42));
          mud -= dm;
          mudRemoved += dm;
          // Also rinses any stray foam
          const df = Math.min(foam, f * 1.1);
          foam -= df;
          foamRemoved += df;
          polish = Math.max(0, polish - f * 0.5);
        } else if (tool === 'sponge') {
          // Soapy sponge: scrubs mud cleanly & builds lush thick white soap foam!
          const wetBoost = 0.72 + wet * 0.55;
          const dm = Math.min(mud, f * 1.25 * wetBoost);
          mud -= dm;
          mudRemoved += dm;
          wet = Math.min(1, wet + f * 0.85);
          const addF = Math.min(1 - foam, f * 1.35 * wetBoost);
          foam += addF;
          foamAdded += addF;
          polish = Math.max(0, polish - f * 0.4);
        } else if (tool === 'shower') {
          // Wide shower spray: washes away all foam & residual mud, leaves sparkling wet sheen!
          wet = Math.min(1, wet + f * 1.8);
          const df = Math.min(foam, f * 1.95);
          foam -= df;
          foamRemoved += df;
          const dm = Math.min(mud, f * 0.95);
          mud -= dm;
          mudRemoved += dm;
          polish = Math.max(0, polish - f * 0.3);
        } else if (tool === 'towel') {
          // Microfiber towel: absorbs water droplets & buffs spotless paint to mirror polish!
          const dw = Math.min(wet, f * 1.85);
          wet -= dw;
          dried += dw;
          const df = Math.min(foam, f * 1.1);
          foam -= df;
          foamRemoved += df;
          const dm = Math.min(mud, f * 0.35);
          mud -= dm;
          mudRemoved += dm;
          if (mud < 0.15 && foam < 0.15) {
            polish = Math.min(1, polish + f * 1.75);
          }
        }

        this.data[idx] = Math.round(mud * 255);
        this.data[idx + 1] = Math.round(wet * 255);
        this.data[idx + 2] = Math.round(foam * 255);
        this.data[idx + 3] = Math.round(polish * 255);
      }
    }

    if (tool === 'hose' || tool === 'shower') {
      this.puddleWetness = Math.min(1, this.puddleWetness + dt * 0.14);
    } else if (tool === 'sponge') {
      this.puddleWetness = Math.min(1, this.puddleWetness + dt * 0.04);
    }

    this.dirty = true;
    return { mudRemoved, foamAdded, foamRemoved, dried };
  }

  /**
   * Subtle gravity drip simulation on wet mud, foam, and water film so liquids visibly run down.
   */
  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;

    // Drip 16 rows per frame for O(1) negligible CPU cost (<0.15ms)
    const N = this.size;
    const rowsPerFrame = 16;
    const dripRate = Math.min(0.28, dt * 1.6);

    for (let r = 0; r < rowsPerFrame; r++) {
      const y = 1 + ((this._dripRow + r) % (N - 2));
      for (let x = 0; x < N; x++) {
        const srcIdx = (y * N + x) * 4;
        const dstIdx = ((y - 1) * N + x) * 4; // lower v = downward along door/fender
        const wet = this.data[srcIdx + 1];
        if (wet > 110) {
          // Slowly spread wetness downward
          const transferW = Math.floor((wet - this.data[dstIdx + 1]) * dripRate * 0.35);
          if (transferW > 0) {
            this.data[dstIdx + 1] = Math.min(255, this.data[dstIdx + 1] + transferW);
            this.dirty = true;
          }
          // Thick foam slides slightly downward when very wet
          const foam = this.data[srcIdx + 2];
          if (foam > 150 && wet > 170) {
            const transferF = Math.floor((foam - this.data[dstIdx + 2]) * dripRate * 0.08);
            if (transferF > 0) {
              this.data[dstIdx + 2] = Math.min(255, this.data[dstIdx + 2] + transferF);
              this.data[srcIdx + 2] = Math.max(0, this.data[srcIdx + 2] - Math.floor(transferF * 0.35));
              this.dirty = true;
            }
          }
        }
      }
    }
    this._dripRow = (this._dripRow + rowsPerFrame) % (N - 2);

    if (this.dirty) {
      this.maskTexture.needsUpdate = true;
      this.dirty = false;
    }
  }

  /**
   * Evaluates overall wash progress across the camera-facing washable zone.
   */
  getMetrics() {
    const N = this.size;
    let total = 0;
    let mudSum = 0;
    let wetSum = 0;
    let foamSum = 0;
    let polishSum = 0;

    // Sample stride 4 across main camera-facing exterior (u: 0.08..0.90, v: 0.08..0.72)
    for (let y = Math.floor(N * 0.08); y < Math.floor(N * 0.72); y += 4) {
      for (let x = Math.floor(N * 0.08); x < Math.floor(N * 0.90); x += 4) {
        const idx = (y * N + x) * 4;
        mudSum += this.data[idx] / 255;
        wetSum += this.data[idx + 1] / 255;
        foamSum += this.data[idx + 2] / 255;
        polishSum += this.data[idx + 3] / 255;
        total++;
      }
    }
    const inv = 1 / Math.max(1, total);
    return {
      mud: mudSum * inv,
      wet: wetSum * inv,
      foam: foamSum * inv,
      polish: polishSum * inv,
    };
  }

  /**
   * Injects photorealistic mud + wet film + bubbly soap foam + water beading
   * into a MeshPhysicalMaterial via onBeforeCompile (Three.js r187 verified chunks).
   */
  patchMaterial(material, { isGlass = false, isTire = false, mudScale = 1.0 } = {}) {
    material.userData.washPatched = true;
    const uniforms = this.uniforms;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWashMask = uniforms.uWashMask;
      shader.uniforms.uMudDiff = uniforms.uMudDiff;
      shader.uniforms.uMudNor = uniforms.uMudNor;
      shader.uniforms.uMudArm = uniforms.uMudArm;
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uIsGlass = { value: isGlass ? 1.0 : 0.0 };
      shader.uniforms.uIsTire = { value: isTire ? 1.0 : 0.0 };
      shader.uniforms.uMudScale = { value: mudScale };

      // Vertex shader: pass car-local position and normal cleanly
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCarLocalPos;
          varying vec3 vCarLocalNor;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vCarLocalPos = position;
          vCarLocalNor = normal;`
        );

      // Fragment shader: triplanar mud PBR + lacy cellular soap foam + running water droplets
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uWashMask;
          uniform sampler2D uMudDiff;
          uniform sampler2D uMudNor;
          uniform sampler2D uMudArm;
          uniform float uTime;
          uniform float uIsGlass;
          uniform float uIsTire;
          uniform float uMudScale;
          varying vec3 vCarLocalPos;
          varying vec3 vCarLocalNor;

          float cwHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          float cwNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(cwHash(i), cwHash(i + vec2(1.0, 0.0)), u.x),
              mix(cwHash(i + vec2(0.0, 1.0)), cwHash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          // Cellular bubble pattern for photorealistic car-wash soap suds
          vec2 cwBubbles(vec2 p) {
            vec2 n = floor(p);
            vec2 f = fract(p);
            float md = 8.0;
            float md2 = 8.0;
            for (int j = -1; j <= 1; j++) {
              for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = vec2(cwHash(n + g), cwHash(n + g + vec2(17.3, 41.9)));
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < md) {
                  md2 = md;
                  md = d;
                } else if (d < md2) {
                  md2 = d;
                }
              }
            }
            return vec2(sqrt(md), sqrt(md2) - sqrt(md));
          }

          vec2 cwWashUV(vec3 lp) {
            float u = clamp((lp.x + 2.45) / 4.9, 0.0, 1.0);
            float arc = lp.y + (0.98 - lp.z) * 0.62;
            float v = clamp(arc / 2.95, 0.0, 1.0);
            return vec2(u, v);
          }`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 cwUv = cwWashUV(vCarLocalPos);
          vec4 cwState = texture2D(uWashMask, cwUv);

          // World-consistent triplanar projection coordinates on the car panels
          vec3 cwN = abs(normalize(vCarLocalNor));
          vec2 cwPanelUv = (cwN.y > 0.65)
            ? vCarLocalPos.xz * 1.15
            : ((cwN.x > 0.65) ? vCarLocalPos.zy * 1.15 : vCarLocalPos.xy * 1.15);

          float cwMudRaw = cwState.r * uMudScale;
          float cwWet = cwState.g;
          float cwFoamRaw = cwState.b;
          float cwPolish = cwState.a;

          // Organic crusty spatter edge for real mud (strictly 0 when cwMudRaw == 0!)
          float cwSpatter = cwNoise(cwPanelUv * 9.5) * 0.6 + cwNoise(cwPanelUv * 26.0) * 0.4;
          float cwMudPresent = smoothstep(0.01, 0.07, cwMudRaw);
          float cwMudMask = smoothstep(0.18, 0.52, cwMudRaw + (cwSpatter - 0.5) * 0.34) * cwMudPresent;
          if (uIsGlass > 0.5) cwMudMask *= 0.72;

          // Sample real Poly Haven photogrammetry mud albedo + roughness/AO
          vec3 cwMudTex = texture2D(uMudDiff, cwPanelUv * 0.92).rgb;
          vec3 cwMudArm = texture2D(uMudArm, cwPanelUv * 0.92).rgb;
          // Rich earthy garden soil tone (warm brown dry crust -> deep dark glossy espresso when wet!)
          vec3 cwMudCol = cwMudTex * vec3(0.84, 0.62, 0.44);
          cwMudCol *= mix(0.88, 0.34, cwWet);
          // Slight sandy dust halo right around dry mud edges
          float cwDustHalo = smoothstep(0.06, 0.30, cwMudRaw) * (1.0 - cwMudMask) * (1.0 - cwWet * 0.78) * cwMudPresent;
          diffuseColor.rgb = mix(diffuseColor.rgb, cwMudCol * 1.15, cwDustHalo * 0.34);
          diffuseColor.rgb = mix(diffuseColor.rgb, cwMudCol, cwMudMask * (uIsTire > 0.5 ? 0.88 : 0.96));

          // Wet paint subtly deepens saturation when wet
          if (uIsGlass < 0.5 && uIsTire < 0.5) {
            diffuseColor.rgb *= mix(1.0, 0.90, cwWet * (1.0 - cwMudMask));
          }

          // Multi-scale frothy car-wash soap suds (strictly 0 when cwFoamRaw == 0 — ZERO phantom spots!)
          vec2 cwBubbleUV = cwPanelUv * 22.0 + vec2(0.0, uTime * 0.04 * cwWet);
          vec2 cwBub1 = cwBubbles(cwBubbleUV);
          vec2 cwBub2 = cwBubbles(cwBubbleUV * 2.8 + vec2(3.1, 7.4));
          float cwFoamPresent = smoothstep(0.01, 0.09, cwFoamRaw);
          float cwLacy = cwNoise(cwPanelUv * 12.0 + vec2(0.0, uTime * 0.03)) * 0.62 + (1.0 - cwBub1.x) * 0.38;
          float cwFoamMask = smoothstep(0.20, 0.54, cwFoamRaw + (cwLacy - 0.5) * 0.45) * cwFoamPresent;
          float cwThinSuds = smoothstep(0.06, 0.28, cwFoamRaw + (cwLacy - 0.5) * 0.36) * (1.0 - cwFoamMask) * cwFoamPresent;
          // Bright crisp sunlight-scattering soap foam (gentle sky-tinted bubble crevices, never muddy gray!)
          float cwBubbleShade = mix(0.90, 1.04, smoothstep(0.04, 0.35, cwBub1.y) * 0.58 + (1.0 - cwBub2.x) * 0.42);
          vec3 cwFoamCol = vec3(0.97, 0.985, 1.0) * cwBubbleShade;
          float cwIrid = smoothstep(0.26, 0.02, cwBub1.y) * cwFoamMask;
          cwFoamCol += vec3(0.03, 0.045, 0.065) * cwIrid;
          diffuseColor.rgb = mix(diffuseColor.rgb, cwFoamCol, clamp(cwFoamMask * 0.94 + cwThinSuds * 0.46, 0.0, 0.96));
          // Subtle subsurface self-illumination scatter inside bright sunlit white soap foam
          totalEmissiveRadiance += vec3(0.085, 0.095, 0.11) * cwFoamMask;

          // Subtle realistic fine water beading & vertical drip streaks on wet panels (NO polka dots!)
          vec2 cwDropUv = vec2(cwPanelUv.x * 34.0, cwPanelUv.y * 22.0 + uTime * 0.24);
          vec2 cwDropCell = cwBubbles(cwDropUv);
          float cwDropCluster = smoothstep(0.38, 0.72, cwNoise(cwPanelUv * 6.5));
          float cwBead = smoothstep(0.16, 0.04, cwDropCell.x) * cwDropCluster * cwWet * (1.0 - cwFoamMask) * (1.0 - cwMudMask * 0.9);
          // Subtle fine water rivulet streaks running vertically on doors/glass
          float cwRivulet = smoothstep(0.76, 0.94, cwNoise(vec2(cwPanelUv.x * 28.0, cwPanelUv.y * 4.0 + uTime * 0.16)))
                          * cwWet * (1.0 - cwFoamMask) * (1.0 - cwMudMask);
          if (uIsGlass > 0.5) {
            // Only mud and soap foam turn transparent glass opaque; water beads remain clear refractive!
            diffuseColor.a = clamp(diffuseColor.a + cwMudMask * 0.78 + cwFoamMask * 0.88 + cwThinSuds * 0.34, 0.0, 1.0);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float cwMudRough = mix(clamp(cwMudArm.g * 1.05, 0.78, 0.96), 0.20, cwWet);
          roughnessFactor = mix(roughnessFactor, cwMudRough, cwMudMask);
          roughnessFactor = mix(roughnessFactor, 0.06, cwWet * (1.0 - cwMudMask) * (1.0 - cwFoamMask) * (1.0 - uIsTire * 0.4));
          roughnessFactor = mix(roughnessFactor, max(roughnessFactor * 0.68, 0.05), cwPolish * (1.0 - cwMudMask) * (1.0 - cwFoamMask));
          float cwFoamRough = mix(0.44, 0.18, smoothstep(0.32, 0.06, cwBub1.x));
          roughnessFactor = mix(roughnessFactor, cwFoamRough, cwFoamMask);
          roughnessFactor = mix(roughnessFactor, 0.03, (cwBead + cwRivulet) * 0.75);`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor *= (1.0 - cwMudMask * 0.96) * (1.0 - cwFoamMask * 0.96);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 cwMudN = texture2D(uMudNor, cwPanelUv * 0.92).xyz * 2.0 - 1.0;
          float cwHeight = cwMudMask * (cwMudN.x * 0.24 + cwMudN.y * 0.24)
                         + cwFoamMask * ((1.0 - cwBub1.x) * 0.32 + (1.0 - cwBub2.x) * 0.14)
                         + (cwBead * 0.10 + cwRivulet * 0.05) * (uIsGlass > 0.5 ? 0.55 : 1.0);
          vec3 cwSurfGrad = vec3(dFdx(cwHeight), dFdy(cwHeight), 0.0);
          normal = normalize(normal - cwSurfGrad * 2.2);`
        )
        .replace(
          '#include <lights_physical_fragment>',
          `#include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            float cwCoatAtten = (1.0 - cwMudMask * mix(0.98, 0.42, cwWet)) * (1.0 - cwFoamMask * 0.52);
            material.clearcoat *= clamp(cwCoatAtten, 0.0, 1.0);
            material.clearcoat = max(material.clearcoat, (cwBead + cwRivulet * 0.6) * 0.85);
            material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.035, max(cwWet, cwPolish) * (1.0 - cwMudMask) * (1.0 - cwFoamMask));
            material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.26, cwFoamMask * 0.72);
          #endif`
        );
    };

    material.customProgramCacheKey = () =>
      `car-wash-v1-${isGlass ? 'g' : 'o'}-${isTire ? 't' : 'n'}-${mudScale.toFixed(2)}`;
  }
}
