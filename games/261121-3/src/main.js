// main.js — 起動。engine → input / tweens / audio / hints / save → 保存の読込 → game 開始
//   WebGL が無い・初期化に失敗したときは代替画面（engine.showFallback）のまま終える。
//   最初の（と毎回の）pointerdown で audio.unlock() と hints.poke()。非表示で音を止め、復帰で再開。
import { createEngine, showFallback } from './engine.js';
import { createInput } from './input.js';
import { createTweens } from './tween.js';
import { createAudio } from './audio.js';
import { createHints } from './hints.js';
import { createSave } from './save.js';
import { createGame } from './game.js';
import { state, adoptSaved } from './state.js';
import { exposeShared } from './shared.js';

function boot() {
  let engine = null;
  try {
    exposeShared(); // later.js（歩く・公園）が同じ three.js・小物を使えるように
    engine = createEngine();
    if (!engine) return;
    const input = createInput(engine);
    const tweens = createTweens();
    const audio = createAudio();
    const hints = createHints(engine, tweens, audio, input);
    const save = createSave();
    adoptSaved(save.load());

    input.onAnyDown(() => { audio.unlock(); hints.poke(); });
    // pointerdown が canvas 以外で起きても解錠できるように
    window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
    engine.onPause(() => audio.suspend());
    engine.onResume(() => audio.resume());

    const game = createGame({ engine, input, audio, hints, tweens, state, save });
    engine.onUpdate((dt, t) => {
      tweens.update(dt);
      game.update(dt, t);
      hints.update(dt);
    });
    game.start().catch((e) => { console.error(e); showFallback(); });
  } catch (e) {
    console.error(e);
    showFallback();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
