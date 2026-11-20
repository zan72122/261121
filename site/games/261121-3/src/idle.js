// idle.js — 遊んでいる間に、重い下ごしらえを1つずつ片付ける小さな待ち行列。
//   createIdleQueue({ engine, input, canRun })
//     q.add(fn)  … fn() は同期でも Promise でもよい。1回に1つだけ、次の条件のときに実行する:
//       ・指が画面に触れていない（操作中・離した直後 0.35 秒は待つ）
//       ・canRun() が true（場面の切り替え中などは false）
//       ・描画の直後（フレームの合間）。前の仕事のあと 2 フレームは空ける
//     実行に時間がかかった直後のフレームは engine.skipPerf() で動的解像度の計測から外す。
export function createIdleQueue({ engine, input, canRun }) {
  const jobs = [];
  let running = false, lastTouch = -1e9, gap = 0, scheduled = false;
  input.onAnyDown(() => { lastTouch = performance.now(); });
  window.addEventListener('pointerup', () => { lastTouch = performance.now(); }, { passive: true });

  function ready() {
    if (document.hidden) return false;
    if (input.active) { lastTouch = performance.now(); return false; }
    if (performance.now() - lastTouch < 350) return false;
    return !canRun || canRun();
  }
  function tick() {
    scheduled = false;
    if (running || !jobs.length) return;
    if (gap > 0 || !ready()) { gap = Math.max(0, gap - 1); schedule(); return; }
    // rAF の直後に setTimeout で回す＝このフレームの描画は済んでいる
    setTimeout(run, 0);
  }
  async function run() {
    if (running || !jobs.length) return;
    if (!ready()) { schedule(); return; }
    running = true;
    const fn = jobs.shift();
    const t0 = performance.now();
    try { await fn(); } catch (e) { console.warn('background prep failed', e); }
    if (performance.now() - t0 > 30 && engine.skipPerf) engine.skipPerf();
    running = false; gap = 2;
    schedule();
  }
  function schedule() {
    if (scheduled || !jobs.length) return;
    scheduled = true;
    requestAnimationFrame(tick);
  }
  return {
    add(fn) { jobs.push(fn); schedule(); },
    get size() { return jobs.length + (running ? 1 : 0); },
  };
}
