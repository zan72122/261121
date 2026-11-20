// audio.js — Web Audio の合成だけで作る効果音・BGM・環境音（素材ファイルなし）
//
// 公開 API
//   import { createAudio } from './audio.js';
//   const audio = createAudio();
//   audio.unlock()      … 最初の pointerdown（とその後の pointerdown 毎）で呼ぶ。AudioContext を作成/resume。
//                          作れなければ以後すべて no-op（ゲームは続行）。
//   audio.suspend() / audio.resume()  … 非表示/復帰で呼ぶ（engine.onPause/onResume）
//   audio.ready         … 鳴らせる状態なら true
//   audio.play(name, { vol = 1, rate = 1, pan = 0, delay = 0 })
//       name: press pop popBig snap steam scoop plop shake pick place boing tick ceramic rattle step cloth
//             munch same sparkle whoosh leaf roll
//       rate は音の高さ（place は種類差に使う。0.8〜1.3 くらい）。rattle は vol で強さ（粒の数）が変わる。
//   audio.setMusic('morning' | 'walk' | 'picnic' | 'end' | null)   … ごく静かな生成 BGM をクロスフェード
//   audio.setAmbience('kitchen' | 'park' | null)                    … 環境音をクロスフェード
//   audio.steamHiss(on: boolean)                                     … 炊飯器の蒸気口のかすかな音
//   unlock 前の setMusic/setAmbience/steamHiss は覚えておき、unlock 後に鳴り始める。

export function createAudio() {
  let ac = null, failed = false, userPaused = false;
  let master, sfx, mus, amb, noiseBuf, brownBuf;
  let wantMusic = null, wantAmb = null, wantSteam = false;
  let musicCur = null, ambCur = null, steamNode = null;
  let schedTimer = 0;

  function init() {
    if (ac || failed) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return; }
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ac.createGain(); master.gain.value = 0.55;
      master.connect(comp); comp.connect(ac.destination);
      sfx = ac.createGain(); sfx.gain.value = 0.85; sfx.connect(master);
      mus = ac.createGain(); mus.gain.value = 0.16; mus.connect(master);
      amb = ac.createGain(); amb.gain.value = 0.5; amb.connect(master);
      // ノイズ素材
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      brownBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        d[i] = w;
        last = (last + 0.02 * w) / 1.02; b[i] = last * 3.5;
      }
      ac.onstatechange = () => { if (ac.state !== 'running' && !userPaused && !document.hidden) tryResume(); };
      // iOS: ジェスチャ内で無音を1回鳴らすと確実に解錠される
      const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050); s.connect(ac.destination); s.start(0);
    } catch (e) {
      console.warn('audio disabled', e);
      failed = true; ac = null;
    }
  }
  function tryResume() {
    try { if (ac && ac.state !== 'running' && ac.state !== 'closed') { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* noop */ }
  }
  const ok = () => !!ac && !failed && ac.state === 'running';

  // ---------- 合成の部品 ----------
  function out(pan, dest) {
    const target = dest || sfx;
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(target); return p; }
    return target;
  }
  function envGain(t, a, peak, dec, dest, hold = 0) {
    const g = ac.createGain();
    peak = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + dec);
    g.connect(dest);
    return g;
  }
  // 音程つきの音。f は [開始, 終了] か数値
  function tone(t, f, dur, { type = 'sine', vol = 0.3, a = 0.003, dest, sweep = 'exp', hold = 0 } = {}) {
    const o = ac.createOscillator(); o.type = type;
    const f0 = Array.isArray(f) ? f[0] : f, f1 = Array.isArray(f) ? f[1] : f;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) { if (sweep === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + hold + dur * 0.9); else o.frequency.linearRampToValueAtTime(f1, t + a + hold + dur * 0.9); }
    const g = envGain(t, a, vol, dur, dest, hold);
    o.connect(g); o.start(t); o.stop(t + a + hold + dur + 0.05);
    return o;
  }
  // フィルタを通したノイズ。fq は [開始, 終了] か数値
  function noise(t, dur, { type = 'bandpass', fq = 1000, Q = 1, vol = 0.2, a = 0.003, dest, hold = 0, brown = false } = {}) {
    const s = ac.createBufferSource(); s.buffer = brown ? brownBuf : noiseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = Q;
    const f0 = Array.isArray(fq) ? fq[0] : fq, f1 = Array.isArray(fq) ? fq[1] : fq;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + a + hold + dur);
    const g = envGain(t, a, vol, dur, dest, hold);
    s.connect(f); f.connect(g);
    const off = Math.random() * Math.max(0, 1.9 - (a + hold + dur) / s.playbackRate.value);
    s.start(t, off); s.stop(t + a + hold + dur + 0.05);
    return f;
  }
  const R = (a, b) => a + Math.random() * (b - a);

  // ---------- 効果音 ----------
  const SFX = {
    press(t, o, d) { // ボタンのカチッ（押す＋戻り）
      noise(t, 0.012, { type: 'highpass', fq: 3500, vol: 0.25 * o.vol, dest: d });
      tone(t, 1900 * o.rate, 0.025, { vol: 0.12 * o.vol, dest: d });
      tone(t, 600 * o.rate, 0.04, { type: 'triangle', vol: 0.1 * o.vol, dest: d });
      noise(t + 0.07, 0.01, { type: 'highpass', fq: 4000, vol: 0.12 * o.vol, dest: d });
    },
    pop(t, o, d) { // ぱかっ：明るく空洞感のあるポン＋空気
      tone(t, [320 * o.rate, 760 * o.rate], 0.11, { vol: 0.42 * o.vol, a: 0.002, dest: d });
      tone(t, [640 * o.rate, 1300 * o.rate], 0.06, { vol: 0.1 * o.vol, a: 0.002, dest: d });
      noise(t, 0.16, { type: 'bandpass', fq: [1800, 700], Q: 0.8, vol: 0.16 * o.vol, a: 0.004, dest: d });
      noise(t, 0.008, { type: 'highpass', fq: 2500, vol: 0.18 * o.vol, dest: d });
    },
    popBig(t, o, d) {
      SFX.pop(t, { vol: o.vol * 1.1, rate: o.rate * 0.9 }, d);
      SFX.sparkle(t + 0.06, { vol: o.vol * 0.9, rate: o.rate }, d);
      tone(t + 0.04, 1568 * o.rate, 0.9, { vol: 0.05 * o.vol, dest: d });
    },
    snap(t, o, d) { // ぱちん
      noise(t, 0.006, { type: 'highpass', fq: 5000, vol: 0.35 * o.vol, dest: d });
      tone(t, 2600 * o.rate, 0.02, { vol: 0.12 * o.vol, dest: d });
      tone(t, [1100 * o.rate, 800 * o.rate], 0.04, { type: 'triangle', vol: 0.16 * o.vol, dest: d });
      noise(t + 0.004, 0.05, { type: 'bandpass', fq: 1200, Q: 2, vol: 0.12 * o.vol, dest: d });
    },
    steam(t, o, d) { // しゅわー 1.2秒
      noise(t, 0.9, { type: 'highpass', fq: [5200, 2600], Q: 0.5, vol: 0.09 * o.vol, a: 0.12, hold: 0.15, dest: d });
      noise(t, 1.0, { type: 'bandpass', fq: [3800, 1800], Q: 0.6, vol: 0.06 * o.vol, a: 0.2, dest: d });
    },
    scoop(t, o, d) { // ごはんをすくう（しっとり）
      noise(t, 0.22, { type: 'lowpass', fq: [900, 300], Q: 0.7, vol: 0.22 * o.vol, a: 0.03, dest: d });
      noise(t + 0.02, 0.12, { type: 'bandpass', fq: 1500, Q: 1.5, vol: 0.05 * o.vol, a: 0.02, dest: d });
      tone(t, [180, 130], 0.12, { vol: 0.08 * o.vol, a: 0.02, dest: d });
    },
    plop(t, o, d) { // ごはんが落ちる（低くやわらかい）
      tone(t, [190 * o.rate, 85 * o.rate], 0.16, { vol: 0.35 * o.vol, a: 0.004, dest: d });
      noise(t, 0.1, { type: 'lowpass', fq: 500, vol: 0.2 * o.vol, a: 0.003, dest: d });
    },
    shake(t, o, d) { // しゃかっ（ふりかけ1振り）
      noise(t, 0.06, { type: 'bandpass', fq: R(3600, 4600) * o.rate, Q: 1.2, vol: 0.12 * o.vol, a: 0.006, dest: d });
      const n = 5 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) noise(t + R(0, 0.07), 0.008, { type: 'bandpass', fq: R(3000, 7000), Q: 3, vol: 0.09 * o.vol, a: 0.001, dest: d });
    },
    pick(t, o, d) { // 小さく「ぽっ」
      tone(t, [480 * o.rate, 880 * o.rate], 0.06, { vol: 0.2 * o.vol, a: 0.003, dest: d });
      noise(t, 0.03, { type: 'bandpass', fq: 1500, vol: 0.05 * o.vol, dest: d });
    },
    place(t, o, d) { // やわらかいトン
      tone(t, [240 * o.rate, 150 * o.rate], 0.09, { vol: 0.3 * o.vol, a: 0.003, dest: d });
      noise(t, 0.06, { type: 'lowpass', fq: 900 * o.rate, vol: 0.18 * o.vol, a: 0.002, dest: d });
      tone(t, 900 * o.rate, 0.03, { type: 'triangle', vol: 0.04 * o.vol, dest: d });
    },
    boing(t, o, d) { // やさしく戻る
      const osc = tone(t, [520 * o.rate, 300 * o.rate], 0.32, { type: 'sine', vol: 0.16 * o.vol, a: 0.01, dest: d });
      const lfo = ac.createOscillator(); lfo.frequency.value = 11;
      const lg = ac.createGain(); lg.gain.value = 18 * o.rate;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + 0.4);
    },
    tick(t, o, d) { // 菜箸のこんこん
      for (const k of [0, 0.13]) {
        tone(t + k, [1350 * o.rate, 1150 * o.rate], 0.04, { vol: 0.16 * o.vol, a: 0.001, dest: d });
        tone(t + k, 2900 * o.rate, 0.02, { vol: 0.05 * o.vol, a: 0.001, dest: d });
        noise(t + k, 0.015, { type: 'bandpass', fq: 2500, Q: 2, vol: 0.12 * o.vol, a: 0.001, dest: d });
      }
    },
    ceramic(t, o, d) { // 皿のチン
      const f = 2150 * o.rate;
      tone(t, f, 0.7, { vol: 0.12 * o.vol, a: 0.001, dest: d });
      tone(t, f * 2.71, 0.45, { vol: 0.05 * o.vol, a: 0.001, dest: d });
      tone(t, f * 5.2, 0.2, { vol: 0.025 * o.vol, a: 0.001, dest: d });
      noise(t, 0.006, { type: 'highpass', fq: 4000, vol: 0.12 * o.vol, dest: d });
    },
    rattle(t, o, d) { // ことこと（箱の中で転がる）
      const n = Math.max(2, Math.round(2 + 6 * Math.min(1.5, o.vol)));
      for (let i = 0; i < n; i++) {
        const k = t + (i / n) * 0.28 + R(-0.01, 0.01);
        const f = R(700, 1300) * o.rate;
        tone(k, [f, f * 0.8], 0.035, { type: 'triangle', vol: 0.09 * Math.min(1.2, o.vol), a: 0.001, dest: d });
        noise(k, 0.02, { type: 'bandpass', fq: R(1500, 2600), Q: 2, vol: 0.06 * Math.min(1.2, o.vol), a: 0.001, dest: d });
      }
    },
    step(t, o, d) { // 砂利道の足音
      noise(t, 0.08, { type: 'lowpass', fq: 400, vol: 0.12 * o.vol, a: 0.01, dest: d, brown: true });
      for (let i = 0; i < 9; i++) noise(t + R(0, 0.11), 0.01, { type: 'bandpass', fq: R(1500, 4500) * o.rate, Q: 2.5, vol: 0.05 * o.vol, a: 0.001, dest: d });
      noise(t, 0.12, { type: 'bandpass', fq: 1800, Q: 0.7, vol: 0.035 * o.vol, a: 0.01, dest: d });
    },
    cloth(t, o, d) { // 布バッグのごそっ
      noise(t, 0.22, { type: 'bandpass', fq: [700, 1600], Q: 0.8, vol: 0.12 * o.vol, a: 0.05, dest: d });
      noise(t + 0.05, 0.15, { type: 'highpass', fq: 2500, vol: 0.03 * o.vol, a: 0.04, dest: d });
    },
    munch(t, o, d) { // ぱくっ＋もぐもぐ
      tone(t, [260 * o.rate, 420 * o.rate], 0.05, { vol: 0.2 * o.vol, a: 0.002, dest: d });
      noise(t, 0.04, { type: 'bandpass', fq: 1200, Q: 1, vol: 0.12 * o.vol, a: 0.002, dest: d });
      for (const k of [0.3, 0.55, 0.8]) {
        noise(t + k, 0.1, { type: 'lowpass', fq: 520, Q: 0.8, vol: 0.18 * o.vol, a: 0.025, dest: d, brown: true });
        tone(t + k, [150, 120], 0.08, { vol: 0.06 * o.vol, a: 0.02, dest: d });
      }
    },
    same(t, o, d) { // おなじ！ 2つの鈴の和音
      for (const [f, k] of [[1046.5, 0], [1318.5, 0.09], [1568, 0.18]]) {
        tone(t + k, f * o.rate, 1.2, { vol: 0.1 * o.vol, a: 0.002, dest: d });
        tone(t + k, f * 2.01 * o.rate, 0.5, { vol: 0.03 * o.vol, a: 0.002, dest: d });
      }
    },
    sparkle(t, o, d) {
      const notes = [2093, 2349, 2637, 3136, 3520];
      notes.forEach((f, i) => tone(t + i * 0.045, f * o.rate, 0.4, { vol: 0.045 * o.vol, a: 0.002, dest: d }));
    },
    whoosh(t, o, d) {
      noise(t, 0.3, { type: 'bandpass', fq: [400 * o.rate, 1400 * o.rate], Q: 0.9, vol: 0.07 * o.vol, a: 0.12, dest: d });
    },
    leaf(t, o, d) {
      noise(t, 0.2, { type: 'highpass', fq: 3000, vol: 0.03 * o.vol, a: 0.05, dest: d });
      for (let i = 0; i < 5; i++) noise(t + R(0, 0.2), 0.012, { type: 'bandpass', fq: R(2500, 5000), Q: 2, vol: 0.03 * o.vol, a: 0.002, dest: d });
    },
    roll(t, o, d) { // ころころ
      const n = 7;
      for (let i = 0; i < n; i++) {
        const k = t + 0.06 * i + 0.01 * i * i;
        tone(k, [560 * o.rate, 470 * o.rate], 0.04, { type: 'triangle', vol: 0.11 * o.vol * (1 - i / (n + 2)), a: 0.002, dest: d });
      }
      noise(t, 0.5, { type: 'lowpass', fq: 350, vol: 0.05 * o.vol, a: 0.05, dest: d, brown: true });
    },
  };

  function play(name, opts = {}) {
    if (!ok()) return;
    const fn = SFX[name];
    if (!fn) return;
    try {
      const o = { vol: opts.vol == null ? 1 : opts.vol, rate: opts.rate || 1 };
      const t = ac.currentTime + 0.005 + (opts.delay || 0);
      fn(t, o, out(opts.pan || 0));
    } catch (e) { /* 音が出なくても続行 */ }
  }

  // ---------- 生成 BGM ----------
  // 音色: 'box'（オルゴール）/ 'mar'（マリンバ）
  function note(t, f, voice, vol, dest) {
    if (voice === 'box') {
      tone(t, f, 1.6, { vol: 0.32 * vol, a: 0.002, dest });
      tone(t, f * 2, 0.6, { vol: 0.07 * vol, a: 0.002, dest });
      tone(t, f * 3.01, 0.25, { vol: 0.03 * vol, a: 0.002, dest });
    } else {
      tone(t, f, 0.7, { vol: 0.34 * vol, a: 0.004, dest });
      tone(t, f * 3.93, 0.12, { vol: 0.06 * vol, a: 0.002, dest });
    }
  }
  const MIDI = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const MOODS = {
    morning: { bpm: 76, root: 72, scale: [0, 2, 4, 7, 9], voice: 'box', bass: [0, -3, -7, -5], dens: 0.42, vol: 0.9 },
    walk: { bpm: 92, root: 67, scale: [0, 2, 4, 7, 9], voice: 'mar', bass: [0, -5, -3, -5], dens: 0.5, vol: 0.85 },
    picnic: { bpm: 72, root: 65, scale: [0, 2, 4, 7, 9], voice: 'box', bass: [0, -3, -5, -7], dens: 0.38, vol: 0.9, second: 'mar' },
    end: { bpm: 60, root: 72, scale: [0, 2, 4, 7, 9], voice: 'box', bass: [0, -7, -3, -5], dens: 0.3, vol: 0.8 },
  };
  function startMusic(name) {
    const m = MOODS[name];
    if (!m) return null;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(1, ac.currentTime + 2.5);
    g.connect(mus);
    return { m, g, next: ac.currentTime + 0.3, step: 0, deg: 2, alive: true };
  }
  function stopMusic(st) {
    if (!st) return;
    st.alive = false;
    const t = ac.currentTime;
    st.g.gain.cancelScheduledValues(t); st.g.gain.setValueAtTime(Math.max(0.0001, st.g.gain.value), t);
    st.g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    setTimeout(() => { try { st.g.disconnect(); } catch (e) { /* noop */ } }, 2600);
  }
  function schedule() {
    if (!ok()) return;
    const st = musicCur;
    if (st && st.alive) {
      const m = st.m, eighth = 60 / m.bpm / 2;
      if (st.next < ac.currentTime - 0.5) st.next = ac.currentTime + 0.05; // 復帰直後の取りこぼしは捨てる
      while (st.next < ac.currentTime + 0.7) {
        const t = st.next, s = st.step;
        const bar = Math.floor(s / 8) % 4, inBar = s % 8;
        if (inBar === 0) note(t, MIDI(m.root - 12 + m.bass[bar]), 'mar', 0.35 * m.vol, st.g);
        if (inBar === 4 && Math.random() < 0.5) note(t, MIDI(m.root - 12 + m.bass[bar] + 7), 'mar', 0.2 * m.vol, st.g);
        const strong = inBar % 2 === 0;
        if (Math.random() < (strong ? m.dens + 0.15 : m.dens * 0.5)) {
          st.deg += Math.random() < 0.5 ? -1 : 1;
          if (Math.random() < 0.2) st.deg += Math.random() < 0.5 ? -1 : 1;
          st.deg = Math.max(0, Math.min(9, st.deg));
          const oct = Math.floor(st.deg / 5), idx = st.deg % 5;
          const voice = m.second && Math.random() < 0.3 ? m.second : m.voice;
          note(t + R(0, 0.012), MIDI(m.root + oct * 12 + m.scale[idx]), voice, (strong ? 0.6 : 0.45) * m.vol, st.g);
        }
        st.step++; st.next += eighth * (inBar % 2 === 0 ? 1.04 : 0.96); // ほんの少しはねる
      }
    }
    // 台所のかすかなコトコト
    if (ambCur && ambCur.name === 'kitchen' && ac.currentTime > ambCur.nextKnock) {
      const t = ac.currentTime + 0.05;
      for (const k of [0, R(0.18, 0.3)]) {
        tone(t + k, [R(380, 520), 300], 0.05, { type: 'triangle', vol: 0.025, a: 0.002, dest: ambCur.g });
        noise(t + k, 0.03, { type: 'bandpass', fq: 900, Q: 1.5, vol: 0.02, a: 0.002, dest: ambCur.g });
      }
      ambCur.nextKnock = ac.currentTime + R(7, 14);
    }
  }

  // ---------- 環境音 ----------
  function loopNoise(dest, { type, fq, Q = 0.7, vol, brown = false }) {
    const s = ac.createBufferSource(); s.buffer = brown ? brownBuf : noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = fq; f.Q.value = Q;
    const g = ac.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(dest); s.start();
    return { s, f, g };
  }
  function startAmb(name) {
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(1, ac.currentTime + 2.5);
    g.connect(amb);
    const st = { name, g, srcs: [], nextKnock: ac.currentTime + R(3, 6) };
    if (name === 'kitchen') {
      st.srcs.push(loopNoise(g, { type: 'lowpass', fq: 260, vol: 0.05, brown: true }));
    } else if (name === 'park') {
      const a = loopNoise(g, { type: 'bandpass', fq: 900, Q: 0.6, vol: 0.05 });
      const b = loopNoise(g, { type: 'highpass', fq: 3200, Q: 0.5, vol: 0.012 });
      const c = loopNoise(g, { type: 'lowpass', fq: 220, vol: 0.05, brown: true });
      // 風のうねり（ゆっくりした LFO で音量と帯域を揺らす）
      for (const [node, depth, rate, param] of [[a, 0.035, 0.09, 'gain'], [a, 450, 0.06, 'freq'], [b, 0.01, 0.13, 'gain']]) {
        const l = ac.createOscillator(); l.frequency.value = rate;
        const lg = ac.createGain(); lg.gain.value = depth;
        l.connect(lg); lg.connect(param === 'gain' ? node.g.gain : node.f.frequency); l.start();
        st.srcs.push({ s: l });
      }
      st.srcs.push(a, b, c);
    }
    return st;
  }
  function stopAmb(st) {
    if (!st) return;
    const t = ac.currentTime;
    st.g.gain.cancelScheduledValues(t); st.g.gain.setValueAtTime(Math.max(0.0001, st.g.gain.value), t);
    st.g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    setTimeout(() => { for (const x of st.srcs) { try { x.s.stop(); } catch (e) { /* noop */ } } try { st.g.disconnect(); } catch (e) { /* noop */ } }, 2600);
  }
  function applyWants() {
    if (!ac || failed) return;
    try {
      if ((musicCur ? musicCur.name : null) !== wantMusic) {
        stopMusic(musicCur); musicCur = null;
        if (wantMusic) { musicCur = startMusic(wantMusic); if (musicCur) musicCur.name = wantMusic; }
      }
      if ((ambCur ? ambCur.name : null) !== wantAmb) {
        stopAmb(ambCur); ambCur = null;
        if (wantAmb) ambCur = startAmb(wantAmb);
      }
      if (wantSteam && !steamNode) {
        steamNode = loopNoise(sfx, { type: 'highpass', fq: 3800, Q: 0.4, vol: 0.0001 });
        steamNode.g.gain.exponentialRampToValueAtTime(0.022, ac.currentTime + 0.8);
      } else if (!wantSteam && steamNode) {
        const n = steamNode; steamNode = null;
        n.g.gain.cancelScheduledValues(ac.currentTime);
        n.g.gain.setValueAtTime(Math.max(0.0001, n.g.gain.value), ac.currentTime);
        n.g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1);
        setTimeout(() => { try { n.s.stop(); } catch (e) { /* noop */ } }, 1300);
      }
    } catch (e) { /* noop */ }
  }

  return {
    get ready() { return ok(); },
    unlock() {
      if (failed) return;
      init();
      if (!ac) return;
      if (!userPaused) tryResume();
      applyWants();
      if (!schedTimer) schedTimer = setInterval(() => { try { schedule(); } catch (e) { /* noop */ } }, 180);
    },
    suspend() {
      userPaused = true;
      try { if (ac && ac.state === 'running') ac.suspend(); } catch (e) { /* noop */ }
    },
    resume() {
      userPaused = false;
      tryResume();
    },
    play,
    setMusic(name) { wantMusic = MOODS[name] ? name : null; applyWants(); },
    setAmbience(name) { wantAmb = name === 'kitchen' || name === 'park' ? name : null; applyWants(); },
    steamHiss(on) { wantSteam = !!on; applyWants(); },
  };
}
