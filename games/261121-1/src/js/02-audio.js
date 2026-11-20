/* 02-audio.js — すべての音を Web Audio API で合成する（音声ファイルなし）
 * グローバル: window.Sound
 *   Sound.unlock()
 *   Sound.play(name, {vol:1, pitch:0, delay:0})
 *   Sound.loop(name, on, {vol:1})      'fridgeHum' | 'cartRoll'
 *   Sound.ambience(name)               'home' | 'store' | null
 *   Sound.pause() / Sound.resume()
 */
(function () {
  'use strict';

  var noop = function () {};
  var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) {
    window.Sound = { unlock: noop, play: noop, loop: noop, ambience: noop, pause: noop, resume: noop };
    return;
  }

  var ctx = null;
  var master = null, comp = null, sfxBus = null, loopBus = null, ambBus = null;
  var whiteBuf = null, brownBuf = null;
  var ready = false;        // ctx を作れて、バスもできた
  var userPaused = false;   // pause() 中
  var MAX_VOICES = 16;
  var voices = [];          // 数える効果音ボイス
  var lastAt = {};          // 名前 → 最後に鳴らした ctx 時刻
  var wantAmb = null;       // 望まれている環境音
  var curAmb = null;        // いま鳴っている環境音オブジェクト
  var schedTimer = null;
  var loops = {};

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }

  // ---------------------------------------------------------------- 初期化
  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    whiteBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var w = whiteBuf.getChannelData(0), b = brownBuf.getChannelData(0);
    var last = 0, i;
    for (i = 0; i < len; i++) {
      var r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    // ループの継ぎ目をなめらかに
    var fade = 256;
    for (i = 0; i < fade; i++) {
      var k = i / fade;
      w[i] *= k; w[len - 1 - i] *= k;
      b[i] *= k; b[len - 1 - i] *= k;
    }
  }

  function build() {
    if (ctx) return true;
    try {
      ctx = new AC();
    } catch (e) { ctx = null; return false; }
    try {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 10;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(comp);
      comp.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      loopBus = ctx.createGain(); loopBus.gain.value = 1; loopBus.connect(master);
      ambBus = ctx.createGain(); ambBus.gain.value = 1; ambBus.connect(master);
      makeNoise();
      ctx.onstatechange = function () {
        try {
          if (!userPaused && ctx.state !== 'running' && ctx.state !== 'closed') {
            var p = ctx.resume(); if (p && p.catch) p.catch(noop);
          }
        } catch (e) {}
      };
      window.addEventListener('touchend', tryResume, { passive: true });
      window.addEventListener('pointerup', tryResume, { passive: true });
      ready = true;
      return true;
    } catch (e2) {
      ready = false;
      return false;
    }
  }

  function tryResume() {
    try {
      if (ctx && !userPaused && ctx.state !== 'running' && ctx.state !== 'closed') {
        var p = ctx.resume(); if (p && p.catch) p.catch(noop);
      }
    } catch (e) {}
  }

  function silentKick() {
    try {
      var b = ctx.createBuffer(1, 1, 22050);
      var s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      s.onended = function () { try { s.disconnect(); } catch (e) {} };
    } catch (e) {}
  }

  // ---------------------------------------------------------------- ボイス
  function Voice(dest, counted, vol) {
    this.nodes = [];
    this.end = 0;
    this.done = false;
    this.counted = counted;
    this.out = ctx.createGain();
    this.out.gain.value = vol;
    this.out.connect(dest);
    this.nodes.push(this.out);
    if (counted) voices.push(this);
  }
  Voice.prototype.add = function () {
    for (var i = 0; i < arguments.length; i++) this.nodes.push(arguments[i]);
  };
  Voice.prototype.at = function (t) { if (t > this.end) this.end = t; };
  Voice.prototype.finish = function () {
    var self = this;
    function check() {
      if (self.done) return;
      var left = self.end - ctx.currentTime;
      if (left > 0.02) { setTimeout(check, Math.min(1000, left * 1000 + 60)); return; }
      self.kill();
    }
    setTimeout(check, Math.max(30, (this.end - ctx.currentTime) * 1000 + 80));
  };
  Voice.prototype.kill = function () {
    if (this.done) return;
    this.done = true;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      try { if (n.stop) n.stop(0); } catch (e) {}
      try { n.disconnect(); } catch (e2) {}
    }
    this.nodes.length = 0;
    if (this.counted) {
      var k = voices.indexOf(this);
      if (k >= 0) voices.splice(k, 1);
    }
  };
  Voice.prototype.steal = function () {
    var self = this;
    try {
      var t = ctx.currentTime;
      self.out.gain.cancelScheduledValues(t);
      self.out.gain.setValueAtTime(self.out.gain.value, t);
      self.out.gain.linearRampToValueAtTime(0, t + 0.03);
    } catch (e) {}
    var k = voices.indexOf(self);
    if (k >= 0) voices.splice(k, 1);
    self.counted = false;
    setTimeout(function () { self.kill(); }, 60);
  };

  // ---------------------------------------------------------------- 部品
  // a: 立ち上がり, h: 保持, d: 減衰
  function envAHD(param, t, a, h, d, peak) {
    peak = Math.max(peak, 0.0002);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (h > 0) param.setValueAtTime(peak, t + a + h);
    param.exponentialRampToValueAtTime(0.0001, t + a + h + d);
    return t + a + h + d;
  }

  // o: {t, f, f1, gt, pts:[[dt,f],...], type, a, h, d, g, dest, det}
  function tone(v, o) {
    var t = o.t, a = num(o.a, 0.003), h = num(o.h, 0), d = num(o.d, 0.1);
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + num(o.gt, a + h + d));
    if (o.pts) {
      for (var i = 0; i < o.pts.length; i++) osc.frequency.linearRampToValueAtTime(o.pts[i][1], t + o.pts[i][0]);
    }
    if (o.det) osc.detune.setValueAtTime(o.det, t);
    var g = ctx.createGain();
    var end = envAHD(g.gain, t, a, h, d, num(o.g, 0.3));
    osc.connect(g);
    g.connect(o.dest || v.out);
    osc.start(t);
    osc.stop(end + 0.03);
    v.add(osc, g);
    v.at(end + 0.03);
    return osc;
  }

  // o: {t, ft, f, f1, q, a, h, d, g, dest, brown}
  function noise(v, o) {
    var t = o.t, a = num(o.a, 0.002), h = num(o.h, 0), d = num(o.d, 0.05);
    var src = ctx.createBufferSource();
    src.buffer = o.brown ? brownBuf : whiteBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + num(o.gt, a + h + d));
    f.Q.value = num(o.q, 1);
    var g = ctx.createGain();
    var end = envAHD(g.gain, t, a, h, d, num(o.g, 0.2));
    src.connect(f); f.connect(g); g.connect(o.dest || v.out);
    src.start(t, Math.random() * 1.5);
    src.stop(end + 0.03);
    v.add(src, f, g);
    v.at(end + 0.03);
    return f;
  }

  // オルゴールの音（基音＋オクターブ＋金属的な倍音）
  function mbox(v, t, freq, g, d, dest) {
    tone(v, { t: t, f: freq, a: 0.002, d: d, g: g, dest: dest });
    tone(v, { t: t, f: freq * 2.0, a: 0.002, d: d * 0.45, g: g * 0.22, dest: dest });
    tone(v, { t: t, f: freq * 5.43, a: 0.001, d: 0.06, g: g * 0.07, dest: dest });
  }

  function knock(v, t, f, g, d) {
    tone(v, { t: t, f: f, f1: f * 0.62, a: 0.002, d: d, g: g });
    noise(v, { t: t, ft: 'bandpass', f: f * 6, q: 1.2, a: 0.001, d: 0.018, g: g * 0.35 });
  }

  function glassRing(v, t, g, p) {
    tone(v, { t: t, f: 3150 * p, a: 0.002, d: 0.45, g: g });
    tone(v, { t: t, f: 5020 * p, a: 0.002, d: 0.3, g: g * 0.6 });
    tone(v, { t: t, f: 7390 * p, a: 0.001, d: 0.15, g: g * 0.35 });
  }

  function scanBeep(v, t, f, len, g) {
    // 澄んだ基音＋少しの倍音。立ち上がり鋭く、切れよく
    tone(v, { t: t, f: f, a: 0.002, h: len, d: 0.018, g: g });
    tone(v, { t: t, f: f, type: 'triangle', a: 0.002, h: len, d: 0.016, g: g * 0.25, det: 4 });
    tone(v, { t: t, f: f * 2, a: 0.002, h: len, d: 0.012, g: g * 0.06 });
    tone(v, { t: t, f: f * 3, a: 0.002, h: len * 0.8, d: 0.01, g: g * 0.025 });
  }

  // 車輪がころがる音（cart 用）
  function rollOnce(v, t, dur, g) {
    var src = ctx.createBufferSource();
    src.buffer = whiteBuf; src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
    var am = ctx.createGain(); am.gain.value = 0.5;
    var lfo = ctx.createOscillator(); lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(17, t);
    lfo.frequency.linearRampToValueAtTime(11, t + dur);
    var lfoG = ctx.createGain(); lfoG.gain.value = 0.45;
    lfo.connect(lfoG); lfoG.connect(am.gain);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    var eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.linearRampToValueAtTime(g, t + 0.08);
    eg.gain.setValueAtTime(g, t + 0.25);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(am); am.connect(lp); lp.connect(eg); eg.connect(v.out);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    v.add(src, bp, am, lfo, lfoG, lp, eg);
    v.at(t + dur + 0.05);
    // 低いゴロゴロ
    noise(v, { t: t, brown: true, ft: 'lowpass', f: 260, f1: 120, q: 0.7, a: 0.06, h: 0.2, d: dur - 0.3, g: g * 1.2 });
    // カタカタ
    for (var i = 0; i < 12; i++) {
      var k = i / 12;
      var tt = t + 0.03 + k * dur * 0.75 + rnd(0, 0.06);
      noise(v, { t: tt, ft: 'bandpass', f: rnd(1800, 3200) * (1 - 0.4 * k), q: 3, a: 0.001, d: 0.012, g: g * 0.5 * (1 - k) });
    }
  }

  // ---------------------------------------------------------------- 効果音
  var S = {};

  S.tap = function (v, t, p) {
    tone(v, { t: t, f: 820 * p, f1: 480 * p, a: 0.002, d: 0.05, g: 0.22 });
    noise(v, { t: t, ft: 'bandpass', f: 2400 * p, q: 1.5, a: 0.001, d: 0.015, g: 0.06 });
  };

  S.lift = function (v, t, p) {
    noise(v, { t: t, ft: 'bandpass', f: 700 * p, f1: 1900 * p, q: 0.9, a: 0.03, d: 0.12, g: 0.09 });
    tone(v, { t: t + 0.04, f: 380 * p, f1: 640 * p, a: 0.004, d: 0.06, g: 0.16 });
  };

  S.drop = function (v, t, p, o) {
    var w = clamp(num(o.vol, 1), 0.3, 2);
    var fs = p / (0.7 + 0.3 * w);
    tone(v, { t: t, f: 210 * fs, f1: 120 * fs, type: 'triangle', a: 0.002, d: 0.12, g: 0.4 });
    noise(v, { t: t, ft: 'lowpass', f: 1400 * fs, q: 0.8, a: 0.001, d: 0.06, g: 0.3 });
    tone(v, { t: t, f: 640 * fs, f1: 560 * fs, a: 0.001, d: 0.05, g: 0.08 });
    tone(v, { t: t + 0.065, f: 180 * fs, f1: 120 * fs, type: 'triangle', a: 0.002, d: 0.06, g: 0.12 });
    noise(v, { t: t + 0.065, ft: 'bandpass', f: 1200 * fs, q: 1, a: 0.001, d: 0.02, g: 0.06 });
  };

  S.back = function (v, t, p) {
    knock(v, t, 330 * p, 0.28, 0.08);
  };

  S.slide = function (v, t, p) {
    noise(v, { t: t, ft: 'bandpass', f: 1700 * p, f1: 900 * p, q: 1.3, a: 0.03, h: 0.14, d: 0.1, g: 0.08 });
    noise(v, { t: t, brown: true, ft: 'lowpass', f: 500, q: 0.7, a: 0.03, h: 0.14, d: 0.08, g: 0.1 });
    knock(v, t + 0.27, 300 * p, 0.25, 0.08);
  };

  S.slosh = function (v, t, p) {
    noise(v, { t: t, ft: 'lowpass', f: 900 * p, f1: 400 * p, q: 1, a: 0.01, d: 0.16, g: 0.12 });
    for (var i = 0; i < 5; i++) {
      var f = rnd(320, 720) * p;
      tone(v, { t: t + rnd(0, 0.14), f: f, f1: f * rnd(1.6, 2.2), a: 0.003, d: rnd(0.03, 0.06), g: rnd(0.05, 0.1) });
    }
  };

  S.rattle = function (v, t, p) {
    var tt = t;
    for (var i = 0; i < 7; i++) {
      var g = 0.16 * (1 - i / 8);
      noise(v, { t: tt, ft: 'bandpass', f: rnd(1800, 2800) * p, q: 3, a: 0.001, d: 0.016, g: g });
      tone(v, { t: tt, f: rnd(900, 1300) * p, a: 0.001, d: 0.02, g: g * 0.25, type: 'triangle' });
      tt += rnd(0.028, 0.045);
    }
  };

  S.tok = function (v, t, p) {
    tone(v, { t: t, f: 1350 * p, f1: 1080 * p, type: 'triangle', a: 0.001, d: 0.045, g: 0.22 });
    tone(v, { t: t, f: 2750 * p, a: 0.001, d: 0.025, g: 0.06 });
    noise(v, { t: t, ft: 'highpass', f: 3000, q: 0.7, a: 0.001, d: 0.01, g: 0.08 });
  };

  S.crinkle = function (v, t, p) {
    var n = 14 + Math.floor(Math.random() * 6);
    for (var i = 0; i < n; i++) {
      noise(v, { t: t + rnd(0, 0.26), ft: 'bandpass', f: rnd(3000, 7000) * p, q: rnd(1, 4), a: 0.001, d: rnd(0.006, 0.02), g: rnd(0.04, 0.12) });
    }
    noise(v, { t: t, ft: 'highpass', f: 2500, q: 0.7, a: 0.02, h: 0.12, d: 0.1, g: 0.025 });
  };

  S.thud = function (v, t, p) {
    tone(v, { t: t, f: 150 * p, f1: 72 * p, a: 0.003, d: 0.15, g: 0.45 });
    noise(v, { t: t, ft: 'lowpass', f: 450 * p, q: 0.7, a: 0.002, d: 0.08, g: 0.3 });
  };

  S.beep = function (v, t, p) {
    scanBeep(v, t, 2400 * p, 0.075, 0.3);
  };

  S.beepFinger = function (v, t, p) {
    scanBeep(v, t, 1950 * p, 0.045, 0.22);
    var t2 = t + 0.12;
    tone(v, { t: t2, f: 2250 * p, f1: 2800 * p, gt: 0.09, a: 0.003, h: 0.07, d: 0.025, g: 0.22 });
    tone(v, { t: t2, f: 2250 * p, f1: 2800 * p, gt: 0.09, type: 'triangle', a: 0.003, h: 0.07, d: 0.02, g: 0.05 });
  };

  S.bagRustle = function (v, t, p) {
    noise(v, { t: t, ft: 'bandpass', f: 1600 * p, f1: 1100 * p, q: 0.8, a: 0.012, d: 0.17, g: 0.16 });
    for (var i = 0; i < 6; i++) {
      noise(v, { t: t + rnd(0, 0.12), ft: 'bandpass', f: rnd(1500, 3500) * p, q: 1.5, a: 0.002, d: rnd(0.015, 0.04), g: rnd(0.04, 0.09) });
    }
    tone(v, { t: t + 0.06, f: 130 * p, f1: 80 * p, a: 0.004, d: 0.1, g: 0.25 });
    noise(v, { t: t + 0.06, ft: 'lowpass', f: 500, q: 0.7, a: 0.003, d: 0.07, g: 0.16 });
  };

  S.pay = function (v, t, p) {
    var ns = [1319, 1760, 2217];
    for (var i = 0; i < ns.length; i++) {
      var last = i === ns.length - 1;
      tone(v, { t: t + i * 0.085, f: ns[i] * p, a: 0.003, h: last ? 0.04 : 0.03, d: last ? 0.4 : 0.1, g: 0.18 });
      tone(v, { t: t + i * 0.085, f: ns[i] * 2 * p, a: 0.003, h: 0.02, d: last ? 0.2 : 0.06, g: 0.03 });
    }
  };

  S.print = function (v, t, p) {
    var dur = 1.2;
    var src = ctx.createBufferSource(); src.buffer = whiteBuf; src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200 * p; bp.Q.value = 1.6;
    var am = ctx.createGain(); am.gain.value = 0.5;
    var lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 38;
    var lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    var eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.linearRampToValueAtTime(0.12, t + 0.04);
    eg.gain.setValueAtTime(0.12, t + dur - 0.1);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(am); am.connect(eg); eg.connect(v.out);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    v.add(src, bp, am, lfo, lg, eg);
    v.at(t + dur + 0.05);
    // 紙送りモーターのうなり
    tone(v, { t: t, f: 410 * p, pts: [[0.6, 430 * p], [1.2, 400 * p]], type: 'triangle', a: 0.05, h: dur - 0.15, d: 0.1, g: 0.025 });
    tone(v, { t: t, f: 140 * p, type: 'sawtooth', a: 0.05, h: dur - 0.15, d: 0.1, g: 0.012 });
  };

  S.tear = function (v, t, p) {
    noise(v, { t: t, ft: 'bandpass', f: 1500 * p, f1: 3600 * p, q: 0.7, a: 0.01, h: 0.06, d: 0.1, g: 0.12 });
    var tt = t;
    for (var i = 0; i < 18; i++) {
      noise(v, { t: tt, ft: 'bandpass', f: rnd(2000, 5000) * p, q: 2, a: 0.001, d: rnd(0.004, 0.012), g: rnd(0.06, 0.15) });
      tt += rnd(0.006, 0.013);
    }
  };

  S.cart = function (v, t, p) {
    rollOnce(v, t, 1.5, 0.22);
    S.squeak(v, t + 0.05, p * 0.95, { vol: 0.6 });
  };

  S.squeak = function (v, t, p) {
    tone(v, { t: t, f: 1750 * p, pts: [[0.05, 2300 * p], [0.12, 1900 * p]], type: 'triangle', a: 0.02, h: 0.04, d: 0.07, g: 0.06 });
    tone(v, { t: t, f: 3500 * p, pts: [[0.05, 4600 * p], [0.12, 3800 * p]], a: 0.02, h: 0.03, d: 0.06, g: 0.012 });
  };

  S.doorOpen = function (v, t, p) {
    tone(v, { t: t, f: 230 * p, f1: 95 * p, a: 0.002, d: 0.08, g: 0.35 });
    noise(v, { t: t, ft: 'lowpass', f: 700, q: 0.8, a: 0.002, d: 0.05, g: 0.2 });
    noise(v, { t: t + 0.03, ft: 'bandpass', f: 500, f1: 1400, q: 0.7, a: 0.05, d: 0.2, g: 0.04 });
    glassRing(v, t + 0.13, 0.03, p);
    glassRing(v, t + 0.19, 0.018, p * 1.12);
  };

  S.doorClose = function (v, t, p) {
    tone(v, { t: t, f: 95 * p, f1: 45 * p, a: 0.004, d: 0.25, g: 0.5 });
    noise(v, { t: t, ft: 'lowpass', f: 320, q: 0.7, a: 0.003, d: 0.15, g: 0.35 });
    noise(v, { t: t, ft: 'bandpass', f: 1200, q: 1, a: 0.001, d: 0.025, g: 0.08 });
    tone(v, { t: t + 0.02, f: 62 * p, a: 0.02, d: 0.45, g: 0.08 });
    glassRing(v, t + 0.07, 0.014, p);
  };

  S.growl = function (v, t, p) {
    var dur = 1.3;
    var osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88 * p, t);
    var pts = [[0.25, 70], [0.5, 98], [0.8, 66], [1.05, 84], [1.3, 58]];
    for (var i = 0; i < pts.length; i++) osc.frequency.linearRampToValueAtTime(pts[i][1] * p, t + pts[i][0]);
    var wob = ctx.createOscillator(); wob.frequency.value = 5.5;
    var wobG = ctx.createGain(); wobG.gain.value = 5;
    wob.connect(wobG); wobG.connect(osc.frequency);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280; lp.Q.value = 7;
    var lfo = ctx.createOscillator(); lfo.frequency.setValueAtTime(8, t); lfo.frequency.linearRampToValueAtTime(5, t + dur);
    var lfoG = ctx.createGain(); lfoG.gain.value = 110;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    var eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.linearRampToValueAtTime(0.3, t + 0.08);
    eg.gain.linearRampToValueAtTime(0.16, t + 0.3);
    eg.gain.linearRampToValueAtTime(0.34, t + 0.55);
    eg.gain.linearRampToValueAtTime(0.12, t + 0.82);
    eg.gain.linearRampToValueAtTime(0.26, t + 1.02);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    osc.connect(lp); lp.connect(eg); eg.connect(v.out);
    osc.start(t); wob.start(t); lfo.start(t);
    var e = t + dur + 0.1;
    osc.stop(e); wob.stop(e); lfo.stop(e);
    v.add(osc, wob, wobG, lp, lfo, lfoG, eg);
    v.at(e);
    tone(v, { t: t, f: 52 * p, pts: [[0.6, 46 * p], [1.3, 40 * p]], a: 0.1, h: 0.9, d: 0.3, g: 0.12 });
    // こぽこぽ
    for (var k = 0; k < 4; k++) {
      var f = rnd(180, 300) * p;
      tone(v, { t: t + 0.2 + k * 0.27 + rnd(0, 0.08), f: f, f1: f * 1.9, a: 0.004, d: 0.045, g: 0.05 });
    }
  };

  S.lonely = function (v, t, p) {
    var f = 587.33 * p; // D5
    tone(v, { t: t, f: f, a: 0.006, d: 1.0, g: 0.2 });
    tone(v, { t: t, f: f * 2, a: 0.004, d: 0.35, g: 0.04 });
    tone(v, { t: t, f: f * 3.98, a: 0.002, d: 0.08, g: 0.02 });
    tone(v, { t: t + 0.01, f: f * 0.998, a: 0.01, d: 0.9, g: 0.05, det: -6 });
  };

  S.place = function (v, t, p) {
    knock(v, t, 380 * p, 0.24, 0.06);
    glassRing(v, t + 0.004, 0.018, p);
  };

  S.magnet = function (v, t, p) {
    noise(v, { t: t, ft: 'highpass', f: 2200, q: 0.7, a: 0.001, d: 0.012, g: 0.3 });
    tone(v, { t: t, f: 1150 * p, a: 0.001, d: 0.03, g: 0.12, type: 'triangle' });
    tone(v, { t: t, f: 320 * p, f1: 240 * p, a: 0.001, d: 0.04, g: 0.14 });
  };

  S.happy = function (v, t, p) {
    var ns = [76, 79, 83, 88]; // E5 G5 B5 E6
    for (var i = 0; i < ns.length; i++) {
      var last = i === ns.length - 1;
      mbox(v, t + i * 0.13, mtof(ns[i]) * p, last ? 0.16 : 0.13, last ? 1.3 : 0.7);
    }
    mbox(v, t + 3 * 0.13 + 0.01, mtof(72) * p, 0.06, 1.1); // 下に C5 を添える
  };

  S.hint = function (v, t, p) {
    mbox(v, t, 2637 * p, 0.05, 0.4);
    mbox(v, t + 0.07, 3520 * p, 0.04, 0.5);
  };

  S.chime = function (v, t, p) {
    var a = [[0, 739.99], [0.42, 587.33]]; // F#5 → D5
    for (var i = 0; i < a.length; i++) {
      var tt = t + a[i][0], f = a[i][1] * p;
      tone(v, { t: tt, f: f, a: 0.004, d: 1.3, g: 0.17 });
      tone(v, { t: tt, f: f * 2.01, a: 0.003, d: 0.6, g: 0.04 });
      tone(v, { t: tt, f: f * 3.0, a: 0.002, d: 0.25, g: 0.015 });
    }
  };

  S.keys = function (v, t, p) {
    for (var i = 0; i < 7; i++) {
      var tt = t + rnd(0, 0.2);
      var f = rnd(3200, 5600) * p;
      var d = rnd(0.06, 0.14);
      tone(v, { t: tt, f: f, a: 0.001, d: d, g: 0.035 });
      tone(v, { t: tt, f: f * 1.47, a: 0.001, d: d * 0.7, g: 0.02 });
      noise(v, { t: tt, ft: 'highpass', f: 4000, q: 0.7, a: 0.001, d: 0.006, g: 0.05 });
    }
  };

  S.whoosh = function (v, t, p) {
    var src = ctx.createBufferSource(); src.buffer = whiteBuf; src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(350 * p, t);
    bp.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.28);
    bp.frequency.exponentialRampToValueAtTime(450 * p, t + 0.7);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
    src.connect(bp); bp.connect(g); g.connect(v.out);
    src.start(t, Math.random()); src.stop(t + 0.76);
    v.add(src, bp, g);
    v.at(t + 0.76);
  };

  // 自作のゆっくりした旋律（拍=0.5秒）
  var ENDING_MEL = [
    [0, 72, 1], [1, 76, 1], [2, 81, 1],
    [3, 79, 1.5], [4.5, 77, 0.5], [5, 76, 1],
    [6, 74, 1], [7, 77, 1], [8, 81, 1],
    [9, 84, 2], [11, 83, 0.5], [11.5, 81, 0.5],
    [12, 79, 1], [13, 76, 1], [14, 74, 1],
    [15, 71, 1], [16, 72, 3]
  ];
  var ENDING_BASS = [
    [0, 48], [1, 55], [2, 60],
    [3, 45], [4, 52], [5, 57],
    [6, 41], [7, 48], [8, 53],
    [9, 48], [10, 55], [11, 60],
    [12, 43], [13, 50], [14, 55],
    [15, 43], [16, 48], [16.15, 55], [16.3, 60], [16.45, 64]
  ];
  S.ending = function (v, t, p) {
    var B = 0.5;
    var i;
    for (i = 0; i < ENDING_MEL.length; i++) {
      var m = ENDING_MEL[i];
      mbox(v, t + m[0] * B, mtof(m[1]) * p, 0.14, 0.5 + m[2] * 0.6);
    }
    for (i = 0; i < ENDING_BASS.length; i++) {
      var b = ENDING_BASS[i];
      mbox(v, t + b[0] * B, mtof(b[1]) * p, 0.06, 0.9);
    }
    // 全体をゆっくり消す
    var g = v.out.gain, base = g.value;
    g.setValueAtTime(base, t);
    g.setValueAtTime(base, t + 7.0);
    g.linearRampToValueAtTime(base * 0.55, t + 9.0);
    g.linearRampToValueAtTime(0, t + 10.2);
    v.at(t + 10.3);
  };

  // ---------------------------------------------------------------- play
  function play(name, opts) {
    try {
      if (!ready || !ctx) return;
      var fn = S[name];
      if (!fn) return;
      opts = opts || {};
      var vol = clamp(num(opts.vol, 1), 0, 3);
      if (vol <= 0) return;
      var pitch = clamp(num(opts.pitch, 0), -36, 36);
      var delay = Math.max(0, num(opts.delay, 0));
      var t = ctx.currentTime + delay + 0.005;
      var la = lastAt[name];
      if (la !== undefined && Math.abs(t - la) < 0.03) return;
      lastAt[name] = t;
      while (voices.length >= MAX_VOICES) {
        var vi = 0;
        while (vi < voices.length - 1 && voices[vi].keep) vi++;
        voices[vi].steal();
      }
      var v = new Voice(sfxBus, true, vol);
      if (name === 'ending') v.keep = true;
      fn(v, t, Math.pow(2, pitch / 12), opts);
      v.finish();
    } catch (e) {}
  }

  // ---------------------------------------------------------------- ループ
  var LOOPS = {
    fridgeHum: function (L) {
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.8;
      var g1 = ctx.createGain(); g1.gain.value = 0.5;
      o1.connect(lp); lp.connect(g1);
      var o2 = ctx.createOscillator(); o2.frequency.value = 100.4;
      var g2 = ctx.createGain(); g2.gain.value = 0.35;
      o2.connect(g2);
      var o3 = ctx.createOscillator(); o3.frequency.value = 150;
      var g3 = ctx.createGain(); g3.gain.value = 0.06;
      o3.connect(g3);
      var mix = ctx.createGain(); mix.gain.value = 0.85;
      g1.connect(mix); g2.connect(mix); g3.connect(mix);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
      var lg = ctx.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(mix.gain);
      var ns = ctx.createBufferSource(); ns.buffer = brownBuf; ns.loop = true;
      var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 300;
      var ng = ctx.createGain(); ng.gain.value = 0.15;
      ns.connect(nf); nf.connect(ng);
      mix.connect(L.out); ng.connect(L.out);
      L.nodes.push(o1, lp, g1, o2, g2, o3, g3, mix, lfo, lg, ns, nf, ng);
      L.srcs = [o1, o2, o3, lfo, ns];
      L.base = 0.07;
    },
    cartRoll: function (L) {
      var src = ctx.createBufferSource(); src.buffer = whiteBuf; src.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.9;
      var am = ctx.createGain(); am.gain.value = 0.5;
      var lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 15;
      var lg = ctx.createGain(); lg.gain.value = 0.42;
      lfo.connect(lg); lg.connect(am.gain);
      var lfo2 = ctx.createOscillator(); lfo2.frequency.value = 3.3;
      var lg2 = ctx.createGain(); lg2.gain.value = 0.15;
      lfo2.connect(lg2); lg2.connect(am.gain);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      src.connect(bp); bp.connect(am); am.connect(lp); lp.connect(L.out);
      var rs = ctx.createBufferSource(); rs.buffer = brownBuf; rs.loop = true;
      var rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 220;
      var rg = ctx.createGain(); rg.gain.value = 0.9;
      rs.connect(rf); rf.connect(rg); rg.connect(L.out);
      L.nodes.push(src, bp, am, lfo, lg, lfo2, lg2, lp, rs, rf, rg);
      L.srcs = [src, lfo, lfo2, rs];
      L.base = 0.16;
    }
  };

  function loop(name, on, opts) {
    try {
      if (!ready || !ctx || !LOOPS[name]) return;
      opts = opts || {};
      var vol = clamp(num(opts.vol, 1), 0, 3);
      var t = ctx.currentTime;
      var L = loops[name];
      if (on) {
        if (L) {
          if (L.stopTimer) { clearTimeout(L.stopTimer); L.stopTimer = null; }
          L.out.gain.cancelScheduledValues(t);
          L.out.gain.setValueAtTime(L.out.gain.value, t);
          L.out.gain.linearRampToValueAtTime(L.base * vol, t + 0.25);
          return;
        }
        L = { nodes: [], srcs: [], out: ctx.createGain(), base: 0.1, stopTimer: null };
        L.out.gain.value = 0.0001;
        L.out.connect(loopBus);
        LOOPS[name](L);
        for (var i = 0; i < L.srcs.length; i++) {
          if (L.srcs[i].buffer) L.srcs[i].start(t, Math.random()); else L.srcs[i].start(t);
        }
        L.out.gain.setValueAtTime(0.0001, t);
        L.out.gain.linearRampToValueAtTime(L.base * vol, t + 0.3);
        loops[name] = L;
      } else {
        if (!L || L.stopTimer) return;
        L.out.gain.cancelScheduledValues(t);
        L.out.gain.setValueAtTime(L.out.gain.value, t);
        L.out.gain.linearRampToValueAtTime(0, t + 0.35);
        L.stopTimer = setTimeout(function () {
          if (loops[name] === L) delete loops[name];
          killLoop(L);
        }, 500);
      }
    } catch (e) {}
  }

  function killLoop(L) {
    var i;
    for (i = 0; i < L.srcs.length; i++) { try { L.srcs[i].stop(0); } catch (e) {} }
    for (i = 0; i < L.nodes.length; i++) { try { L.nodes[i].disconnect(); } catch (e2) {} }
    try { L.out.disconnect(); } catch (e3) {}
    L.nodes.length = 0; L.srcs.length = 0;
  }

  // ---------------------------------------------------------------- 環境音
  // 店内音楽（自作・8分音符=0.375秒 × 32 = 12秒で一巡）
  var STORE_STEP = 0.375, STORE_LEN = 32;
  var STORE_MEL = {
    0: 72, 2: 77, 3: 79, 4: 81, 6: 79, 7: 77,
    8: 74, 10: 77, 12: 76, 14: 72,
    16: 74, 18: 77, 19: 81, 20: 84, 22: 82, 23: 81,
    24: 79, 26: 76, 28: 77
  };
  var STORE_ROOT = { 0: 53, 4: 53, 8: 50, 12: 48, 16: 46, 20: 53, 24: 48, 28: 53 };

  function makeAmb(name) {
    var A = { name: name, nodes: [], srcs: [], gain: ctx.createGain(), next: 0, step: 0, nextBeep: 0, nextTick: 0, tick: 0, dead: false };
    A.gain.gain.value = 0.0001;
    A.gain.connect(ambBus);
    var t = ctx.currentTime;
    if (name === 'store') {
      // 空調のさーっ
      var s = ctx.createBufferSource(); s.buffer = whiteBuf; s.loop = true;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
      var g = ctx.createGain(); g.gain.value = 0.035;
      s.connect(lp); lp.connect(hp); hp.connect(g); g.connect(A.gain);
      A.nodes.push(s, lp, hp, g); A.srcs.push(s);
      // 遠くの音楽
      A.music = ctx.createGain(); A.music.gain.value = 0.32;
      var mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 2600;
      A.music.connect(mlp); mlp.connect(A.gain);
      A.nodes.push(A.music, mlp);
      A.far = ctx.createBiquadFilter(); A.far.type = 'lowpass'; A.far.frequency.value = 3500;
      A.far.connect(A.gain);
      A.nodes.push(A.far);
      A.next = t + 0.3;
      A.nextBeep = t + rnd(3, 7);
    } else if (name === 'home') {
      var s2 = ctx.createBufferSource(); s2.buffer = brownBuf; s2.loop = true;
      var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 380;
      var g2 = ctx.createGain(); g2.gain.value = 0.045;
      s2.connect(lp2); lp2.connect(g2); g2.connect(A.gain);
      A.nodes.push(s2, lp2, g2); A.srcs.push(s2);
      A.clock = ctx.createGain(); A.clock.gain.value = 1;
      A.clock.connect(A.gain);
      A.nodes.push(A.clock);
      A.nextTick = t + 0.5;
    }
    for (var i = 0; i < A.srcs.length; i++) A.srcs[i].start(t, Math.random());
    A.gain.gain.setValueAtTime(0.0001, t);
    A.gain.gain.linearRampToValueAtTime(1, t + 1.2);
    return A;
  }

  function fadeAmb(A) {
    if (!A || A.dead) return;
    A.dead = true;
    try {
      var t = ctx.currentTime;
      A.gain.gain.cancelScheduledValues(t);
      A.gain.gain.setValueAtTime(A.gain.gain.value, t);
      A.gain.gain.linearRampToValueAtTime(0, t + 1.2);
    } catch (e) {}
    setTimeout(function () {
      var i;
      for (i = 0; i < A.srcs.length; i++) { try { A.srcs[i].stop(0); } catch (e) {} }
      for (i = 0; i < A.nodes.length; i++) { try { A.nodes[i].disconnect(); } catch (e2) {} }
      try { A.gain.disconnect(); } catch (e3) {}
      A.nodes.length = 0; A.srcs.length = 0;
    }, 1500);
  }

  function schedule() {
    try {
      var A = curAmb;
      if (!A || A.dead || !ctx || ctx.state !== 'running') return;
      var now = ctx.currentTime, ahead = now + 0.4;
      var v;
      if (A.name === 'store') {
        if (A.next < now - 1) A.next = now + 0.1; // 長く止まっていたら追いつかない
        while (A.next < ahead) {
          var st = A.step, tt = A.next;
          var m = STORE_MEL[st], r = STORE_ROOT[st];
          if (m !== undefined || r !== undefined || STORE_ROOT[st - 2] !== undefined) {
            v = new Voice(A.music, false, 1);
            if (m !== undefined) mbox(v, tt, mtof(m), 0.1, 0.9);
            if (r !== undefined) mbox(v, tt, mtof(r), 0.05, 1.0);
            if (STORE_ROOT[st - 2] !== undefined) mbox(v, tt, mtof(STORE_ROOT[st - 2] + 7), 0.035, 0.7);
            v.finish();
          }
          A.step = (A.step + 1) % STORE_LEN;
          A.next += STORE_STEP;
          if (A.step === 0) A.next += STORE_STEP * 2; // 一巡ごとに少し間
        }
        if (A.nextBeep < now - 1) A.nextBeep = now + rnd(4, 9);
        if (A.nextBeep < ahead) {
          v = new Voice(A.far, false, 1);
          scanBeep(v, A.nextBeep, rnd(2250, 2650), 0.07, 0.018);
          v.finish();
          A.nextBeep += rnd(6, 14);
        }
      } else if (A.name === 'home') {
        if (A.nextTick < now - 1) A.nextTick = now + 0.1;
        while (A.nextTick < ahead) {
          v = new Voice(A.clock, false, 1);
          var hi = (A.tick % 2) === 0;
          noise(v, { t: A.nextTick, ft: 'bandpass', f: hi ? 3600 : 2900, q: 4, a: 0.001, d: 0.012, g: 0.035 });
          tone(v, { t: A.nextTick, f: hi ? 2100 : 1750, a: 0.001, d: 0.02, g: 0.008 });
          v.finish();
          A.tick++;
          A.nextTick += 1.0;
        }
      }
    } catch (e) {}
  }

  function applyAmb() {
    if (!ready || !ctx) return;
    var name = (wantAmb === 'home' || wantAmb === 'store') ? wantAmb : null;
    if (curAmb && !curAmb.dead && curAmb.name === name) return;
    if (curAmb) { fadeAmb(curAmb); curAmb = null; }
    if (name) curAmb = makeAmb(name);
    if (!schedTimer) schedTimer = setInterval(schedule, 100);
    schedule();
  }

  function ambience(name) {
    try {
      wantAmb = name || null;
      applyAmb();
    } catch (e) {}
  }

  // ---------------------------------------------------------------- 解除・一時停止
  function unlock() {
    try {
      var fresh = !ctx;
      if (!build()) return;
      if (!userPaused && ctx.state !== 'running') {
        var p = ctx.resume(); if (p && p.catch) p.catch(noop);
      }
      if (fresh) silentKick();
      applyAmb();
    } catch (e) {}
  }

  function pause() {
    try {
      userPaused = true;
      if (ctx && ctx.state === 'running') { var p = ctx.suspend(); if (p && p.catch) p.catch(noop); }
    } catch (e) {}
  }

  function resume() {
    try {
      userPaused = false;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { var p = ctx.resume(); if (p && p.catch) p.catch(noop); }
    } catch (e) {}
  }

  window.Sound = {
    unlock: unlock,
    play: play,
    loop: loop,
    ambience: ambience,
    pause: pause,
    resume: resume
  };
})();
