// hints.js — 「次の1操作」の示し方（SPEC §4）。光の輪・運ぶ先の光・放置で強まる手がかり・指のお手本
//
// 公開 API
//   import { createHints } from './hints.js';
//   const hints = createHints(engine, tweens, audio, input);   // input は操作中（input.active）に進めないため
//   hints.set({ target: Object3D, gesture: 'tap' | 'drag', dest?: Object3D | Vector3,
//               radius?: 世界 m（光の輪の大きさ。省略時は target のバウンディング球）,
//               destRadius = 0.06（運ぶ先の光る円の半径 m）,
//               nudge?: (level) => void,   // level 1 = その物がカタッと揺れて音（4秒〜3.5秒ごと）, 2 = 9秒〜（台所ならママの菜箸がこんこん）
//               tip?: () => Vector3,       // 指先が触れる点（省略時は target の上面中央）
//               destPoint?: () => Vector3 })// drag で指が運んでいく先（省略時は dest の上面中央）
//       target / dest が動いても毎フレーム追従する。set し直すとタイマーは 0 から。
//   hints.poke()   … 操作があったらレベル0に戻す（main.js が input.onAnyDown で呼ぶ）
//   hints.clear()  … 何も示さない（場面を出るとき game が呼ぶ）
//   hints.update(dt)  … main.js が毎フレーム呼ぶ
//   hints.level    … 0: 光の輪だけ, 1: 4秒〜, 2: 9秒〜, 3: 13秒〜（指のお手本を約3.5秒ごと）
//   hints.idle     … 放置秒
//   hints.ring / hints.finger … 表示用 Object3D（engine.scene 直下に置かれる）
import * as THREE from 'three';
import { makeCanvas, canvasTexture } from './texutil.js';

// 光の輪: 通常合成（明るい木の天板の上でも暖色に見える）。濃いめの金色の芯＋外側のやわらかい縁＋内側のうっすらした光
function ringTexture() {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  const img = ctx.createImageData(S, S);
  const R0 = 0.7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
    const core = Math.exp(-Math.pow((r - R0) / 0.075, 2));            // 輪の芯
    const halo = Math.exp(-Math.pow((r - R0) / 0.2, 2)) * 0.5;         // やわらかい縁
    const inner = 0.16 * Math.max(0, 1 - r / R0) * (r < R0 ? 1 : 0);   // 内側のうっすら
    const a = Math.min(1, core * 0.95 + halo + inner) * (r < 1 ? 1 : 0) * Math.min(1, (1 - r) * 12);
    // 色: 芯は濃い金色（やや橙）、縁へ行くほど明るい山吹色
    const k = Math.min(1, core * 1.2);
    const i = (y * S + x) * 4;
    img.data[i] = 255; img.data[i + 1] = Math.round(196 - 62 * k); img.data[i + 2] = Math.round(92 - 72 * k); img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c);
}
// 運ぶ先: 通常合成のうすい金色の円＋ふち
function discTexture() {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
    const fill = 0.5 * (1 - Math.pow(Math.min(1, r / 0.86), 3));
    const edge = Math.exp(-Math.pow((r - 0.86) / 0.07, 2)) * 1.0;
    const a = Math.min(1, fill + edge) * Math.min(1, Math.max(0, (1 - r) * 10));
    const i = (y * S + x) * 4;
    img.data[i] = 255; img.data[i + 1] = Math.round(184 - 44 * edge); img.data[i + 2] = Math.round(70 - 50 * edge); img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c);
}

// やさしい子どもの右手（半透明）。人差し指をのばし、ほかの指は軽くにぎる。指先が原点、手は +Z 側、つめは +Y。
function makeFinger() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xf0bfa0, emissive: 0x4a2418, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.5, depthWrite: true });
  const nailMat = new THREE.MeshStandardMaterial({ color: 0xfbe4da, emissive: 0x3a2018, roughness: 0.3, transparent: true, opacity: 0.5 });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  body.scale.setScalar(1.25); // 小さな物の上でも見えるよう、実寸より少し大きめ
  // 人差し指: 先が少し細い回転体（長さ 0.046、太さ φ0.016〜0.019）。関節で少しだけ曲がる
  const L = 0.046;
  const prof = [];
  for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI / 2; prof.push(new THREE.Vector2(Math.sin(a) * 0.0079, 0.0079 * (1 - Math.cos(a)))); }
  for (let k = 1; k <= 12; k++) { const t = k / 12; prof.push(new THREE.Vector2(0.0079 + 0.0017 * t + 0.0005 * Math.sin(t * Math.PI * 2), 0.0079 + t * (L - 0.0079))); }
  prof.push(new THREE.Vector2(0.0001, L + 0.002));
  const fgeo = new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2); // +Y → +Z
  const finger = new THREE.Mesh(fgeo, mat);
  finger.rotation.x = -0.12; // 指先がほんの少し下向き
  body.add(finger);
  // つめ
  const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), nailMat);
  nail.scale.set(0.0055, 0.0018, 0.0068); nail.position.set(0, 0.0068, 0.0085);
  finger.add(nail);
  // 手の甲（ふっくら丸い）
  const back = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat);
  back.scale.set(0.031, 0.017, 0.034); back.position.set(0.019, -0.002, L + 0.022);
  body.add(back);
  // にぎった中指・くすり指・小指（指の背が並ぶ）
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
    f.scale.set(0.0072 - k * 0.0005, 0.0082, 0.0105);
    f.position.set(0.0135 + k * 0.0128, -0.0085, L + 0.003 + k * 0.0045);
    body.add(f);
  }
  // 親指（人差し指の左側、内へ向く）
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0072, 0.018, 6, 14), mat);
  thumb.rotation.set(Math.PI / 2, 0.55, 0);
  thumb.position.set(-0.011, -0.007, L + 0.006);
  body.add(thumb);
  // 手首（手の甲の向こうへ少し）
  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.03, 8, 18), mat);
  wrist.rotation.x = Math.PI / 2; wrist.scale.set(1.2, 0.8, 1); wrist.position.set(0.022, -0.003, L + 0.06);
  body.add(wrist);
  // 奥行きだけ先に書く（半透明の重なりで中が透けて見えないように）
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const meshes = [];
  body.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const d = new THREE.Mesh(m.geometry, depthMat);
    d.position.copy(m.position); d.rotation.copy(m.rotation); d.scale.copy(m.scale); d.renderOrder = 39;
    m.parent.add(d);
  }
  root.traverse((o) => { if (o.isMesh) { if (o.material !== depthMat) o.renderOrder = 40; o.castShadow = false; o.receiveShadow = false; } });
  root.userData.mats = [mat, nailMat];
  root.visible = false;
  return root;
}

export function createHints(engine, tweens, audio, input) {
  const scene = engine.scene;
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, opacity: 0, toneMapped: false }));
  ring.renderOrder = 30; ring.visible = false;
  scene.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, depthWrite: false, opacity: 0, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  disc.rotation.x = -Math.PI / 2; disc.renderOrder = 25; disc.visible = false;
  scene.add(disc);
  const finger = makeFinger();
  scene.add(finger);

  let cur = null;
  let idle = 0, level = 0, nextNudge = 4, nextDemo = 13, ringA = 0, phase = 0;
  let demo = null; // { t, dur, kind }
  const box = new THREE.Box3(), sph = new THREE.Sphere();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  function measure(obj) {
    box.setFromObject(obj);
    const wp = obj.getWorldPosition(new THREE.Vector3());
    if (box.isEmpty()) return { center: new THREE.Vector3(), top: new THREE.Vector3(), r: 0.03, wp };
    box.getBoundingSphere(sph);
    const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    return { center: sph.center.clone().sub(wp), top: top.sub(wp), r: sph.radius, wp };
  }

  function set(o) {
    if (!o || !o.target) { clear(); return; }
    const m = measure(o.target);
    cur = {
      target: o.target, gesture: o.gesture === 'drag' ? 'drag' : 'tap', dest: o.dest || null,
      radius: o.radius != null ? o.radius : Math.max(0.02, m.r), destRadius: o.destRadius || 0.06, nudge: o.nudge,
      tipFn: o.tip, destFn: o.destPoint, cOff: m.center, topOff: m.top, dOff: null,
    };
    if (cur.dest && cur.dest.isObject3D) { const dm = measure(cur.dest); cur.dOff = dm.top; }
    poke();
    ring.visible = true; disc.visible = !!cur.dest;
  }
  function clear() {
    cur = null; demo = null;
    ring.visible = false; disc.visible = false; finger.visible = false;
    ringA = 0; ring.material.opacity = 0; disc.material.opacity = 0;
    idle = 0; level = 0;
  }
  function poke() {
    idle = 0; level = 0; nextNudge = 4; nextDemo = 13;
    if (demo) { demo = null; finger.visible = false; }
  }
  function targetCenter(out) { return cur.target.getWorldPosition(out).add(cur.cOff); }
  function tipPoint(out) { if (cur.tipFn) return out.copy(cur.tipFn()); return cur.target.getWorldPosition(out).add(cur.topOff); }
  function destPoint(out) {
    if (cur.destFn) return out.copy(cur.destFn());
    if (!cur.dest) return tipPoint(out);
    if (cur.dest.isVector3) return out.copy(cur.dest);
    return cur.dest.getWorldPosition(out).add(cur.dOff);
  }

  // ---- 指のお手本 ----
  const bodyDir = new THREE.Vector3();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), toCam = new THREE.Vector3();
  function calcBodyDir(tip) {
    const cam = engine.camera;
    camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    camUp.setFromMatrixColumn(cam.matrixWorld, 1);
    toCam.copy(cam.position).sub(tip).normalize();
    // 画面右下から伸びて、少し上（カメラ側）から触れる
    bodyDir.copy(camRight).multiplyScalar(0.6).addScaledVector(camUp, -0.6).addScaledVector(toCam, 0.35).normalize();
    bodyDir.y = Math.max(bodyDir.y, 0.45); bodyDir.normalize();
  }
  function orientFinger(tip, press) {
    finger.position.copy(tip);
    finger.lookAt(tmp2.copy(tip).add(bodyDir));
    const s = 1 - 0.08 * press;
    finger.scale.set(1 + 0.06 * press, 1, s);
  }
  function startDemo() {
    demo = { t: 0, dur: cur.gesture === 'drag' ? 2.6 : 1.7 };
    finger.visible = true;
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  function updateDemo(dt) {
    demo.t += dt;
    const t = demo.t, lift = 0.05;
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    tipPoint(A);
    calcBodyDir(A);
    let alpha, press = 0;
    if (cur.gesture === 'tap') {
      // 0-0.3 現れる / 0.3-0.65 下りる / 0.65-0.85 押す / 0.85-1.2 上がる / 1.2-1.7 消える
      const down = sm(0.25, 0.65, t) - sm(0.85, 1.2, t);
      press = sm(0.62, 0.72, t) - sm(0.82, 0.9, t);
      P.copy(A).addScaledVector(bodyDir, lift * 1.2 * (1 - down));
      alpha = sm(0, 0.3, t) * (1 - sm(1.2, 1.7, t));
    } else {
      destPoint(B);
      // 0-0.3 現れる / 0.3-0.6 下りる / 0.6-0.75 押す / 0.75-1.9 運ぶ（弧） / 1.9-2.1 離す / 2.1-2.6 上がって消える
      const down = sm(0.25, 0.6, t);
      const carry = sm(0.75, 1.9, t);
      const up = sm(2.0, 2.4, t);
      press = sm(0.55, 0.7, t) * (1 - sm(1.9, 2.05, t));
      P.lerpVectors(A, B, carry);
      P.addScaledVector(bodyDir, lift * 1.2 * (1 - down) + up * lift);
      P.y += Math.sin(Math.PI * carry) * 0.035;
      alpha = sm(0, 0.3, t) * (1 - sm(2.1, 2.6, t));
    }
    orientFinger(P, press);
    const op = 0.6 * alpha;
    for (const m of finger.userData.mats) m.opacity = op;
    finger.visible = op > 0.005;
    if (t >= demo.dur) { demo = null; finger.visible = false; }
  }

  function update(dt) {
    if (!cur) return;
    if (!cur.target.parent) { clear(); return; }
    phase += dt;
    const busy = input && input.active;
    if (!busy) {
      idle += dt;
      let fire = 0;
      if (idle >= 9 && level < 2) fire = 2;
      else if (idle >= nextNudge) fire = idle >= 9 ? 2 : 1;
      if (fire) {
        level = Math.max(level, fire);
        try { if (cur.nudge) cur.nudge(fire); } catch (e) { console.error(e); }
        nextNudge = idle + 3.5;
      }
      if (idle >= nextDemo) {
        level = 3;
        if (!demo) startDemo();
        nextDemo = idle + 3.5 + (cur.gesture === 'drag' ? 1.0 : 0);
      }
    } else if (demo) { demo = null; finger.visible = false; }
    if (demo) updateDemo(dt);

    // 光の輪（物の大きさに合わせる・脈打つ）。操作中はうすく
    targetCenter(tmp);
    ring.position.copy(tmp);
    const pulse = 0.5 + 0.5 * Math.sin(phase * (level >= 1 ? 4.2 : 3.2));
    const goal = busy ? 0.3 : 0.62 + 0.3 * pulse + (level >= 1 ? 0.08 : 0);
    ringA += (goal - ringA) * Math.min(1, dt * 6);
    ring.material.opacity = ringA;
    const rr = cur.radius * 2.0 * (1.12 + 0.08 * pulse);
    ring.scale.set(rr, rr, 1);
    if (cur.dest) {
      destPoint(tmp);
      disc.position.copy(tmp); disc.position.y += 0.002;
      const dr = cur.destRadius * (1 + 0.05 * Math.sin(phase * 2.4));
      disc.scale.set(dr, dr, dr);
      const dGoal = busy ? 1.0 : 0.72 + 0.18 * Math.sin(phase * 2.4);
      disc.material.opacity += (dGoal - disc.material.opacity) * Math.min(1, dt * 5);
    }
  }

  return {
    set, clear, poke, update,
    get level() { return level; },
    get idle() { return idle; },
    ring, finger, disc,
  };
}
