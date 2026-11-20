// input.js — 指1本の Pointer Events 入力。当たり判定は画面空間（5歳児むけに大きめ）
//
// 公開 API
//   import { createInput } from './input.js';
//   const input = createInput(engine);
//   const h = input.add(object3D, {
//       radius?: 世界 m（省略時は object3D のバウンディング球）, pad = 22 (px), priority = 0,
//       center?: () => Vector3（判定の中心。省略時はバウンディング球の中心／radius 指定時は object の world 位置）,
//       enabled = true, down(ev), move(ev), up(ev), tap(ev) })
//     → { remove(), enabled (書き換え可), opts, object }
//     判定半径 = max(30px, radius × pxPerMeter) + pad。複数当たれば priority の高い順、同じなら (距離−半径) の小さい順。
//     object3D が engine.scene につながっていない／どこかの親が visible=false なら当たらない。
//     down で選ばれたハンドルが、その指を離すまで move/up/tap を受け取る（他の指は無視）。
//   ev: { x, y, startX, startY, dx, dy (start からの差), dist (累計移動 px), t (down からの秒), dt,
//         ray: THREE.Ray, plane(y, out?) → 水平面 y との交点 Vector3（交わらなければ前回の値）,
//         cancelled, handle, tap (up 時、累計 16px 未満なら true) }
//   up は必ず1回（blur・非表示・pointercancel では up({cancelled:true}) が呼ばれる。cancel 時は tap しない）。
//   tap は up の直後に呼ばれる（累計移動 16px 未満。時間は問わない）。
//   input.onAnyDown(fn(ev)) / input.onMiss(fn(ev)) … 解除関数を返す（onMiss = どのハンドルにも当たらなかった down）
//   input.active … いまハンドルを操作中なら true
//   input.cancel() … 進行中の操作を cancelled で終わらせる
import * as THREE from 'three';

export function createInput(engine) {
  const canvas = engine.renderer.domElement;
  const handles = [];
  const anyDown = [], misses = [];
  let pid = null;          // 追跡中のポインタ id
  let cur = null;          // 操作中のハンドル（無ければ null）
  let g = null;            // ジェスチャ情報
  const box = new THREE.Box3();
  const sph = new THREE.Sphere();
  const wp = new THREE.Vector3();

  const prevent = (e) => { if (e.cancelable) e.preventDefault(); };
  for (const t of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick', 'selectstart']) {
    canvas.addEventListener(t, prevent, { passive: false });
  }
  document.addEventListener('touchmove', prevent, { passive: false });
  document.addEventListener('gesturestart', prevent, { passive: false });
  document.addEventListener('dblclick', prevent, { passive: false });
  document.addEventListener('contextmenu', prevent, { passive: false });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) prevent(e); }, { passive: false });

  function attached(o) {
    let p = o;
    while (p) { if (!p.visible) return false; if (p === engine.scene) return true; p = p.parent; }
    return false;
  }
  function centerAndRadius(h) {
    const o = h.object, op = h.opts;
    if (op.radius != null) {
      const c = op.center ? op.center() : o.getWorldPosition(wp);
      return [c.clone ? c.clone() : new THREE.Vector3().copy(c), op.radius];
    }
    box.setFromObject(o);
    if (box.isEmpty()) { o.getWorldPosition(wp); return [op.center ? op.center().clone() : wp.clone(), 0.02]; }
    box.getBoundingSphere(sph);
    return [op.center ? op.center().clone() : sph.center.clone(), sph.radius];
  }
  function pick(x, y) {
    let best = null, bestScore = Infinity, bestPri = -Infinity;
    for (const h of handles) {
      if (!h.enabled || !attached(h.object)) continue;
      const [c, rad] = centerAndRadius(h);
      const p = engine.project(c);
      if (p.behind) continue;
      const rp = Math.max(30, rad * engine.pxPerMeter(c)) + (h.opts.pad == null ? 22 : h.opts.pad);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > rp) continue;
      const pri = h.opts.priority || 0;
      const score = d - rp;
      if (pri > bestPri || (pri === bestPri && score < bestScore)) { best = h; bestPri = pri; bestScore = score; }
    }
    return best;
  }

  function makeEv(x, y, now, cancelled) {
    const ray = engine.rayAt(x, y);
    const dt = (now - g.lastT) / 1000;
    const ev = {
      x, y, startX: g.sx, startY: g.sy, dx: x - g.sx, dy: y - g.sy, dist: g.dist,
      t: (now - g.t0) / 1000, dt, ray, cancelled: !!cancelled, handle: cur, tap: false,
      plane(py = 0, out) {
        const o = out || new THREE.Vector3();
        const dy = ray.direction.y;
        if (Math.abs(dy) > 1e-6) {
          const k = (py - ray.origin.y) / dy;
          if (k > 0) { o.copy(ray.origin).addScaledVector(ray.direction, k); g.lastPlane.set(py, o.clone()); return o; }
        }
        const prev = g.lastPlane.get(py);
        if (prev) return o.copy(prev);
        return o.copy(ray.origin).addScaledVector(ray.direction, 1).setY(py);
      },
    };
    return ev;
  }
  function call(fn, ev) { if (typeof fn === 'function') { try { fn(ev); } catch (e) { console.error(e); } } }
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e) {
    prevent(e);
    if (pid !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pid = e.pointerId;
    try { canvas.setPointerCapture(pid); } catch (err) { /* noop */ }
    const [x, y] = pos(e);
    const now = performance.now();
    g = { sx: x, sy: y, lx: x, ly: y, dist: 0, t0: now, lastT: now, lastPlane: new Map() };
    cur = pick(x, y);
    const ev = makeEv(x, y, now, false);
    for (const f of anyDown.slice()) call(f, ev);
    if (cur) call(cur.opts.down, ev);
    else for (const f of misses.slice()) call(f, ev);
  }
  function onMove(e) {
    if (e.pointerId !== pid || !g) return;
    prevent(e);
    const [x, y] = pos(e);
    const now = performance.now();
    g.dist += Math.hypot(x - g.lx, y - g.ly);
    g.lx = x; g.ly = y;
    if (cur) call(cur.opts.move, makeEv(x, y, now, false));
    g.lastT = now;
  }
  function finish(x, y, cancelled) {
    const now = performance.now();
    const h = cur;
    if (h) {
      const ev = makeEv(x, y, now, cancelled);
      ev.tap = !cancelled && g.dist < 16;
      call(h.opts.up, ev);
      if (ev.tap) call(h.opts.tap, ev);
    }
    try { if (pid !== null && canvas.hasPointerCapture && canvas.hasPointerCapture(pid)) canvas.releasePointerCapture(pid); } catch (err) { /* noop */ }
    pid = null; cur = null; g = null;
  }
  function onUp(e) {
    if (e.pointerId !== pid || !g) return;
    prevent(e);
    const [x, y] = pos(e);
    g.dist += Math.hypot(x - g.lx, y - g.ly);
    finish(x, y, false);
  }
  function onCancel(e) {
    if (e && e.pointerId !== undefined && e.pointerId !== pid) return;
    if (!g) return;
    finish(g.lx, g.ly, true);
  }
  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pid && g) onCancel(e); });
  window.addEventListener('blur', () => onCancel());
  document.addEventListener('visibilitychange', () => { if (document.hidden) onCancel(); });
  window.addEventListener('pagehide', () => onCancel());

  return {
    get active() { return !!cur; },
    add(object, opts = {}) {
      const h = { object, opts, enabled: opts.enabled !== false, remove() { const i = handles.indexOf(h); if (i >= 0) handles.splice(i, 1); } };
      handles.push(h);
      return h;
    },
    onAnyDown(fn) { anyDown.push(fn); return () => { const i = anyDown.indexOf(fn); if (i >= 0) anyDown.splice(i, 1); }; },
    onMiss(fn) { misses.push(fn); return () => { const i = misses.indexOf(fn); if (i >= 0) misses.splice(i, 1); }; },
    cancel() { onCancel(); },
  };
}
