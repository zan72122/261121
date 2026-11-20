// game.js — 場面の骨格（生成・切り替え・保存）
//
// 公開 API
//   import { createGame } from './game.js';
//   const game = createGame({ engine, input, audio, hints, tweens, state, save });
//   game.start() → Promise（state.stage の場面だけ生成して入り、フェードイン。
//        歩く・公園は別ファイル later.js にあり、最初の場面が見えてから裏で読み込む。
//        さらに遊んでいる間（指が離れているフレームの合間）に、テクスチャ → 歩く → 公園 の順で1つずつ
//        前もって作り、シェーダも裏でコンパイルしておく（idle.js）。間に合わなければ従来どおり
//        初めて行くときに白フェードの裏で作る）
//   game.update(dt, t)   … main.js が毎フレーム呼ぶ（現在の場面の update を呼ぶ）
//   game.ctx             … 場面に渡す ctx
//
// 場面に渡す ctx
//   { engine, input, audio, hints, tweens, state, save, goto(stage), nextDay(), current() }
//   goto('kitchen'|'walk'|'park') → Promise: 白フェードアウト(0.45s) → 現場面 exit()・group を外す・hints.clear
//        → state.stage = stage; save.store(state) → 新場面の group を追加・環境差し替え → enter() → フェードイン。
//        遷移中に呼んでも無視（二重遷移しない）。
//   nextDay() → resetState(day+1)、保存、kitchen へ。
//
// 場面ファクトリ（scene_*.js）: createXxxScene(ctx) →
//   { group: THREE.Group, env: Texture|null, envIntensity?: number, background?: Color|Texture|null,
//     fog?: THREE.Fog|null, enter(), exit(), update(dt, t) }
//   enter() は毎回 state から作り直す。exit() では自分の input ハンドル・tween スコープを片付ける。
import { createKitchenScene } from './scene_kitchen.js';
import { resetState } from './state.js';
import { loadLater } from './later_loader.js';
import { createIdleQueue } from './idle.js';
import * as THREE from 'three';

export function createGame(base) {
  const { engine, hints, state, save } = base;
  const scenes = {};
  let current = null, currentName = null, busy = false;

  const ctx = Object.assign({}, base, {
    goto, nextDay,
    current: () => currentName,
  });

  // walk / park のファクトリは later.js が読み込まれてから埋まる
  const facs = { kitchen: createKitchenScene, walk: null, park: null };
  const STAGES = ['kitchen', 'walk', 'park'];
  function adoptLater(L) {
    if (L) { facs.walk = L.createWalkScene; facs.park = L.createParkScene; }
    return L;
  }
  function ensure(name) {
    if (!scenes[name] && facs[name]) {
      try { scenes[name] = facs[name](ctx); } catch (e) { console.error('scene build failed', name, e); }
    }
    return scenes[name];
  }
  /** 場面のファクトリを用意（later.js が要れば読み込む。失敗は1回だけ読み直す） */
  async function needFactory(name) {
    if (facs[name]) return true;
    for (let i = 0; i < 2 && !facs[name]; i++) {
      try { adoptLater(await loadLater()); } catch (e) { console.warn('later.js load failed', e); }
    }
    return !!facs[name];
  }
  const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // シェーダを描画前にコンパイル（KHR_parallel_shader_compile があれば待つ間も止まらない）
  async function compileFor(s, intoScene) {
    const r = engine.renderer;
    let tmp = null, target = intoScene;
    if (!target) {
      tmp = new THREE.Scene();
      tmp.environment = s.env || null;
      tmp.environmentIntensity = s.envIntensity != null ? s.envIntensity : 1;
      tmp.background = s.background != null ? s.background : null;
      tmp.fog = s.fog || null;
      tmp.add(s.group);
      tmp.updateMatrixWorld(true);
      target = tmp;
    }
    try {
      if (r.compileAsync && r.extensions.has('KHR_parallel_shader_compile')) await r.compileAsync(target, engine.camera);
      else r.compile(target, engine.camera);
    } catch (e) { /* 任意の最適化 */ }
    if (tmp && s.group.parent === tmp) tmp.remove(s.group);
  }

  function attach(name) {
    const s = scenes[name];
    currentName = name; current = s;
    engine.scene.add(s.group);
    engine.scene.environment = s.env || null;
    engine.scene.environmentIntensity = s.envIntensity != null ? s.envIntensity : 1;
    engine.scene.background = s.background != null ? s.background : null;
    engine.scene.fog = s.fog || null;
    engine.applyQuality(s.group);
    try { s.enter(); } catch (e) { console.error(e); }
  }
  function detach() {
    if (!current) return;
    try { current.exit(); } catch (e) { console.error(e); }
    engine.scene.remove(current.group);
    hints.clear();
    current = null;
  }

  async function goto(stage) {
    if (busy || !STAGES.includes(stage)) return;
    busy = true;
    try {
      if (base.input && base.input.cancel) base.input.cancel();
      const prev = currentName;
      await engine.fade(1, 0.45, '#fff');
      detach();
      state.stage = stage;
      save.store(state);
      if (!scenes[stage]) { await twoFrames(); if (await needFactory(stage)) ensure(stage); }
      if (!scenes[stage]) { stage = prev && scenes[prev] ? prev : 'kitchen'; ensure(stage); state.stage = stage; }
      attach(stage);
      await compileFor(current, engine.scene);
      await engine.fade(0, 0.6, '#fff');
    } finally { busy = false; }
  }
  function nextDay() {
    if (busy) return Promise.resolve();
    resetState(state.day + 1);
    save.store(state);
    return goto('kitchen');
  }

  async function start() {
    engine.fade(1, 0, '#fff');
    busy = true;
    let first = STAGES.includes(state.stage) ? state.stage : 'kitchen';
    if (first !== 'kitchen' && !(await needFactory(first))) first = 'kitchen';
    if (!ensure(first)) { first = 'kitchen'; if (!ensure(first)) throw new Error('no scenes'); }
    state.stage = first;
    attach(first);
    await compileFor(current, engine.scene);
    busy = false;
    await engine.fade(0, 0.8, '#fff');
    prepareRest();
  }

  // ---- 遊んでいる間の下ごしらえ ----
  function prepareRest() {
    if (!base.input) return;
    const q = createIdleQueue({ engine, input: base.input, canRun: () => !busy });
    q.add(async () => { try { adoptLater(await loadLater()); } catch (e) { /* 行くときにもう一度試す */ } });
    q.add(() => {
      if (!facs.walk || !window.__bentoLater.warmSteps) return;
      // テクスチャ・形を1つずつ（1回の仕事を小さく）
      for (const step of window.__bentoLater.warmSteps(engine.renderer)) q.add(step);
      for (const name of ['walk', 'park']) {
        q.add(() => { if (!scenes[name] && !busy) ensure(name); });
        q.add(() => (scenes[name] && scenes[name] !== current ? compileFor(scenes[name], null) : null));
      }
    });
  }

  function update(dt, t) {
    if (current && current.update) current.update(dt, t);
  }

  return { start, update, ctx };
}
