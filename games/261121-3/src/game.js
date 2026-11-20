// game.js — 場面の骨格（生成・切り替え・保存）
//
// 公開 API
//   import { createGame } from './game.js';
//   const game = createGame({ engine, input, audio, hints, tweens, state, save });
//   game.start() → Promise（state.stage の場面だけ生成して入り、フェードイン。ほかの場面は
//        初めて行くときに、白フェードの裏で生成する＝起動が速く、生成の引っかかりが見えない）
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
import { createWalkScene } from './scene_walk.js';
import { createParkScene } from './scene_park.js';
import { resetState } from './state.js';

export function createGame(base) {
  const { engine, hints, state, save } = base;
  const scenes = {};
  let current = null, currentName = null, busy = false;

  const ctx = Object.assign({}, base, {
    goto, nextDay,
    current: () => currentName,
  });

  const facs = { kitchen: createKitchenScene, walk: createWalkScene, park: createParkScene };
  function ensure(name) {
    if (!scenes[name] && facs[name]) {
      try { scenes[name] = facs[name](ctx); } catch (e) { console.error('scene build failed', name, e); }
    }
    return scenes[name];
  }
  const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

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
    try { engine.renderer.compile(engine.scene, engine.camera); } catch (e) { /* 任意の最適化 */ }
  }
  function detach() {
    if (!current) return;
    try { current.exit(); } catch (e) { console.error(e); }
    engine.scene.remove(current.group);
    hints.clear();
    current = null;
  }

  async function goto(stage) {
    if (busy || !facs[stage]) return;
    busy = true;
    try {
      if (base.input && base.input.cancel) base.input.cancel();
      await engine.fade(1, 0.45, '#fff');
      detach();
      state.stage = stage;
      save.store(state);
      if (!scenes[stage]) { await twoFrames(); ensure(stage); }
      if (!scenes[stage]) { stage = currentName && scenes[currentName] ? currentName : 'kitchen'; ensure(stage); state.stage = stage; }
      attach(stage);
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
    let first = facs[state.stage] ? state.stage : 'kitchen';
    if (!ensure(first)) { first = 'kitchen'; if (!ensure(first)) throw new Error('no scenes'); }
    state.stage = first;
    attach(first);
    busy = false;
    await engine.fade(0, 0.8, '#fff');
  }

  function update(dt, t) {
    if (current && current.update) current.update(dt, t);
  }

  return { start, update, ctx };
}
