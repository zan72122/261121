// tween.js — エンジンの dt で進むトゥイーン（setTimeout 不使用。非表示中はエンジンが止まるので一緒に止まる）
//
// 公開 API
//   import { createTweens, ease, spring } from './tween.js';
//   const tweens = createTweens();             // main.js が1つ作り、engine.onUpdate で tweens.update(dt) を呼ぶ
//   tweens.update(dt)
//   tweens.to(obj, props, dur, { ease, delay, onUpdate, onDone, tag }) → handle
//       props の値は 数値 / {x,y,z} / {x,y,z,w} / {r,g,b} など。obj[key] が Vector3・Euler・Color・Quaternion
//       なら成分ごとに補間（Quaternion は slerp。終値に Quaternion を渡す）。例:
//       tweens.to(mesh.position, { y: 0.1 }, 0.3)  /  tweens.to(mesh, { position: new Vector3(0,1,0), rotation: {z: 1} }, 0.5)
//       ease は関数か名前（'outBack' など）。省略時 inOutCubic。dur=0 なら次の update で即終値。
//   handle: { cancel(), promise, done(bool) }
//       promise は完了で true に解決。cancel()/kill されたものは「解決しない」（場面を出たあとの続きが走らない）。
//   tweens.value({ from=0, to=1, dur, ease, delay, onUpdate(v), onDone, tag }) → handle
//   tweens.wait(sec) → Promise（kill されたら解決しない）
//   tweens.kill(tagOrObj)   … その tag、またはその obj を対象にしたトゥイーン／wait を止める
//   tweens.killAll()
//   tweens.scope() → 子スコープ（同じ to/value/wait/kill/killAll/scope を持つ）。scope.killAll() はそのスコープ
//       （と孫スコープ）で作ったものだけを止める。場面は enter で scope を作り、exit で killAll する。
//   ease: { linear, inOutCubic, outCubic, inCubic, outBack, outElastic, outBounce, inOutSine, outQuad }
//   spring(current, target, velRef, stiffness=120, damping=14, dt)
//       数値: velRef = { v: 0 } を渡し、新しい値を返す。
//       Vector3: current をその場で更新（velRef は Vector3）し、current を返す。
import * as THREE from 'three';

export const ease = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

const COMP = ['x', 'y', 'z', 'w', 'r', 'g', 'b'];

function resolveEase(e) {
  if (typeof e === 'function') return e;
  if (typeof e === 'string' && ease[e]) return ease[e];
  return ease.inOutCubic;
}

export function spring(current, target, velRef, stiffness = 120, damping = 14, dt = 1 / 60) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  if (typeof current === 'number') {
    let x = current, v = velRef.v || 0;
    for (let i = 0; i < steps; i++) { v += ((target - x) * stiffness - v * damping) * h; x += v * h; }
    velRef.v = v;
    return x;
  }
  for (let i = 0; i < steps; i++) {
    for (const k of ['x', 'y', 'z']) {
      velRef[k] += ((target[k] - current[k]) * stiffness - velRef[k] * damping) * h;
      current[k] += velRef[k] * h;
    }
  }
  return current;
}

export function createTweens() {
  let list = [];
  let scopeSeq = 1;

  // 1件 = { obj, tag, scopes:Set, delay, dur, t, ease, apply(k), onUpdate, onDone, started, dead, resolve }
  function makeApply(obj, props) {
    const parts = [];
    for (const key of Object.keys(props)) {
      const end = props[key];
      const cur = obj[key];
      if (typeof end === 'number') {
        parts.push({ kind: 'num', key, end, start: 0 });
      } else if (cur && cur.isQuaternion) {
        parts.push({ kind: 'quat', key, end: end.isQuaternion ? end.clone() : new THREE.Quaternion().setFromEuler(new THREE.Euler(end.x || 0, end.y || 0, end.z || 0)), start: new THREE.Quaternion() });
      } else if (cur && typeof cur === 'object' && end && typeof end === 'object') {
        const comps = COMP.filter((c) => typeof end[c] === 'number' && typeof cur[c] === 'number');
        parts.push({ kind: 'vec', key, comps, end: comps.map((c) => end[c]), start: comps.map(() => 0) });
      }
    }
    return {
      begin() {
        for (const p of parts) {
          if (p.kind === 'num') p.start = obj[p.key];
          else if (p.kind === 'quat') p.start.copy(obj[p.key]);
          else p.start = p.comps.map((c) => obj[p.key][c]);
        }
      },
      set(k) {
        for (const p of parts) {
          if (p.kind === 'num') obj[p.key] = p.start + (p.end - p.start) * k;
          else if (p.kind === 'quat') obj[p.key].slerpQuaternions(p.start, p.end, k);
          else {
            const o = obj[p.key];
            for (let i = 0; i < p.comps.length; i++) o[p.comps[i]] = p.start[i] + (p.end[i] - p.start[i]) * k;
          }
        }
      },
    };
  }

  function add(item, scopes) {
    item.scopes = scopes;
    item.t = 0; item.started = false; item.dead = false;
    item.promise = new Promise((res) => { item.resolve = res; });
    list.push(item);
    const handle = {
      promise: item.promise,
      cancel() { item.dead = true; },
      done: () => item.dead,
    };
    return handle;
  }

  function update(dt) {
    if (!list.length) return;
    const cur = list.slice();
    for (const it of cur) {
      if (it.dead) continue;
      let step = dt;
      if (it.delay > 0) { it.delay -= dt; if (it.delay > 0) continue; step = -it.delay; it.delay = 0; }
      if (!it.started) { it.started = true; if (it.begin) it.begin(); }
      it.t += step;
      const raw = it.dur > 0 ? Math.min(1, it.t / it.dur) : 1;
      const k = it.ease ? it.ease(raw) : raw;
      try {
        if (it.set) it.set(k);
        if (it.onUpdate) it.onUpdate(it.valueOf ? it.valueOf(k) : k, raw);
      } catch (e) { console.error(e); it.dead = true; continue; }
      if (raw >= 1) {
        it.dead = true;
        try { if (it.onDone) it.onDone(); } catch (e) { console.error(e); }
        it.resolve(true);
      }
    }
    list = list.filter((it) => !it.dead);
  }

  function makeApi(scopeChain) {
    const api = {
      to(obj, props, dur = 0.5, o = {}) {
        const ap = makeApply(obj, props);
        return add({ obj, tag: o.tag, delay: o.delay || 0, dur, ease: resolveEase(o.ease), begin: ap.begin, set: ap.set, onUpdate: o.onUpdate, onDone: o.onDone }, scopeChain);
      },
      value({ from = 0, to = 1, dur = 0.5, ease: e, delay = 0, onUpdate, onDone, tag } = {}) {
        return add({ obj: null, tag, delay, dur, ease: resolveEase(e), valueOf: (k) => from + (to - from) * k, onUpdate, onDone }, scopeChain);
      },
      wait(sec = 0) {
        return add({ obj: null, tag: undefined, delay: sec, dur: 0, ease: ease.linear }, scopeChain).promise;
      },
      kill(tagOrObj) {
        for (const it of list) {
          if (!inScope(it)) continue;
          if (it.tag === tagOrObj || (tagOrObj != null && it.obj === tagOrObj)) it.dead = true;
        }
      },
      killAll() { for (const it of list) if (inScope(it)) it.dead = true; },
      scope() { return makeApi(scopeChain.concat(scopeSeq++)); },
    };
    const myId = scopeChain[scopeChain.length - 1];
    function inScope(it) { return myId === 0 || it.scopes.includes(myId); }
    return api;
  }

  const root = makeApi([0]);
  root.update = update;
  return root;
}
