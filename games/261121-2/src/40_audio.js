/* 40_audio.js — 音。すべて Web Audio の合成（音ファイルなし・声なし）。three.js には依存しない。
   G.Audio.init / setEnabled / update / tap / shower / ambience / music / play
   AudioContext が作れないときや init 前は、すべて何もせずに戻る。 */
(function () {
  'use strict';
  var G = window.G = window.G || {};
  var A = G.Audio = {};

  var ctx = null, ok = false, tried = false, enabled = true;
  var bus = {};                 // 出力の系統
  var BUF = {};                 // ノイズバッファ（1回だけ作る）
  var voices = 0;               // 鳴っている一発音の数
  var MAX_VOICES = 80, MAX_GRAIN = 46;
  var lastPlay = {};            // 名前ごとの最後に鳴らした時刻（間引き）
  var lastSet = [];             // setT の前回値

  /* ───────── 小道具 ───────── */
  function rnd() { return Math.random(); }
  function rr(a, b) { return a + (b - a) * Math.random(); }
  function num(x, d) { x = +x; return (x === x && isFinite(x)) ? x : d; }
  function c01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  var PENTA = [0, 2, 4, 7, 9];
  /* 五音音階（ド・レ・ミ・ソ・ラ）。i=0 が base(MIDI) */
  function penta(i, base) {
    i = Math.round(i); var o = Math.floor(i / 5), k = ((i % 5) + 5) % 5;
    return mtof((base || 72) + 12 * o + PENTA[k]);
  }
  function now() { return ctx.currentTime; }
  /* AudioParam をなめらかに目標へ。値がほとんど変わらないときは予定を積まない */
  function setT(param, v, tc, eps) {
    var id = param.__aid;
    if (id === undefined) { id = param.__aid = lastSet.length; lastSet.push(NaN); }
    var lv = lastSet[id];
    if (lv === lv && Math.abs(lv - v) <= (eps || 0.0015) && !(v === 0 && lv !== 0)) return;
    lastSet[id] = v;
    try { param.setTargetAtTime(v, now(), tc); } catch (e) { }
  }
  function fin(src, list) {
    voices++;
    src.onended = function () {
      voices--;
      for (var i = 0; i < list.length; i++) { try { list[i].disconnect(); } catch (e) { } }
    };
  }
  function filt(type, f, q) {
    var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b;
  }
  function loopSrc(buf) {
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(0, rnd() * (buf.duration - 0.1)); return s;
  }

  /* 正弦などの一音。opt: type, f1(滑り先), gt(滑り時間), att, dest, lp, vib(深さHz), vr(速さ), vd(深さの減衰秒), detune */
  function tone(t, f, dec, peak, opt) {
    if (voices > MAX_VOICES || f <= 0 || f > 12000) return null;
    opt = opt || {};
    var att = opt.att || 0.003;
    var o = ctx.createOscillator(); o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (opt.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t + (opt.gt || dec));
    if (opt.detune) o.detune.value = opt.detune;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
    o.connect(g);
    var list = [o, g], out = g, end = t + att + dec + 0.03;
    if (opt.lp) { var lp = filt('lowpass', opt.lp, 0.7); g.connect(lp); out = lp; list.push(lp); }
    if (opt.vib) {
      var l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = opt.vr || 6;
      lg.gain.setValueAtTime(opt.vib, t);
      if (opt.vd) lg.gain.exponentialRampToValueAtTime(Math.max(0.5, opt.vib * 0.03), t + opt.vd);
      l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(end); list.push(l, lg);
    }
    out.connect(opt.dest || bus.sfx);
    o.start(t); o.stop(end);
    fin(o, list);
    return o;
  }
  /* ノイズの一発。opt: buf('w'|'p'|'b'), type, f, q, f1(掃引先), att, dest, rate(再生速度) */
  function noise(t, dec, peak, opt) {
    if (voices > MAX_VOICES) return null;
    opt = opt || {};
    var buf = BUF[opt.buf || 'w'], att = opt.att || 0.002;
    var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    if (opt.rate) s.playbackRate.value = opt.rate;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + att + dec);
    var list = [s, g], head = s;
    if (opt.type) {
      var b = filt(opt.type, opt.f || 1000, opt.q === undefined ? 0.7 : opt.q);
      if (opt.f1) { b.frequency.setValueAtTime(opt.f || 1000, t); b.frequency.exponentialRampToValueAtTime(opt.f1, t + att + dec); }
      s.connect(b); head = b; list.push(b);
    }
    head.connect(g); g.connect(opt.dest || bus.sfx);
    s.start(t, rnd() * (buf.duration - 0.6)); s.stop(t + att + dec + 0.03);
    fin(s, list);
    return s;
  }
  /* モード合成（金属・木・ベル）。parts: [[倍率, 振幅, 減衰秒, detune(cent)], ...] */
  function modal(t, f, parts, peak, dest, att) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (f * p[0] > 9500) continue;
      tone(t, f * p[0], p[2], peak * p[1], { dest: dest, att: att || 0.0015, detune: p[3] || 0 });
    }
  }
  /* 泡の共鳴（Minnaert）：生まれた泡は水面に上がりながら音程が上がる短い正弦 */
  function bubble(t, f, dur, peak, dest) {
    tone(t, f, dur, peak, { f1: f * rr(1.25, 1.9), gt: dur, att: 0.0015, dest: dest || bus.water });
  }

  /* ───────── 楽器 ───────── */
  // ブリキのバケツの底（周囲を留めた円板）＋胴の鳴り。非整数倍音がそれぞれの速さで減衰
  var TIN = [[1, 1, 0.55], [1, 0.5, 0.5, 9], [2.08, 0.55, 0.34], [3.41, 0.36, 0.22], [3.89, 0.26, 0.18], [5.0, 0.16, 0.12], [5.95, 0.1, 0.09]];
  function tin(t, peak, f, dest) {
    modal(t, f, TIN, peak, dest);
    noise(t, 0.006, peak * 0.25, { type: 'highpass', f: 2500, dest: dest });
  }
  // オルゴールの歯：基音＋弱い2倍＋すぐ消える高いモード（片持ち梁 6.27 倍）
  function musicBox(t, f, peak, dest) {
    modal(t, f, [[1, 1, 1.7], [1, 0.3, 1.2, 4], [2, 0.12, 0.6], [6.27, 0.035, 0.07]], peak, dest || bus.music, 0.002);
  }
  // ベル・チャイム
  function bell(t, f, peak, dec, dest) {
    modal(t, f, [[1, 1, dec], [2.0, 0.22, dec * 0.45], [2.76, 0.12, dec * 0.3], [5.4, 0.04, dec * 0.12]], peak, dest || bus.sfx, 0.002);
  }
  // 木琴（マリンバ風に丸く）：基音＋4倍がすぐ消える＋ばちの柔らかい当たり
  function xylo(t, f, peak, dest) {
    modal(t, f, [[1, 1, 0.6], [3.98, 0.13, 0.11], [9.2, 0.03, 0.04]], peak, dest, 0.002);
    noise(t, 0.012, peak * 0.2, { buf: 'p', type: 'lowpass', f: 900, dest: dest });
  }
  // 竹・木の当たり
  function wood(t, f, peak, dest) {
    modal(t, f, [[1, 1, 0.08], [2.62, 0.4, 0.045], [4.9, 0.16, 0.025]], peak, dest);
  }

  /* ───────── 初期化 ───────── */
  function makeBuffers() {
    var sr = ctx.sampleRate, n = Math.floor(sr * 2.5), i;
    var w = ctx.createBuffer(1, n, sr), p = ctx.createBuffer(1, n, sr), b = ctx.createBuffer(1, n, sr);
    var wd = w.getChannelData(0), pd = p.getChannelData(0), bd = b.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0, mp = 0, mb = 0;
    for (i = 0; i < n; i++) {
      var x = Math.random() * 2 - 1;
      wd[i] = x * 0.7;
      // ピンク（Paul Kellet）
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.96900 * b2 + x * 0.1538520;
      b3 = 0.86650 * b3 + x * 0.3104856; b4 = 0.55000 * b4 - x * 0.5329522; b5 = -0.7616 * b5 - x * 0.0168980;
      pd[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
      // 茶色（漏れのある積分）
      br = (br + 0.02 * x) / 1.02; bd[i] = br;
      if (Math.abs(pd[i]) > mp) mp = Math.abs(pd[i]);
      if (Math.abs(br) > mb) mb = Math.abs(br);
    }
    // ループの継ぎ目を短くなじませる
    var fade = Math.floor(sr * 0.02);
    for (i = 0; i < n; i++) { pd[i] *= 0.7 / mp; bd[i] *= 0.7 / mb; }
    for (i = 0; i < fade; i++) {
      var k = i / fade, j = n - fade + i;
      wd[j] = wd[j] * (1 - k) + wd[i] * k; pd[j] = pd[j] * (1 - k) + pd[i] * k; bd[j] = bd[j] * (1 - k) + bd[i] * k;
    }
    BUF.w = w; BUF.p = p; BUF.b = b;
  }
  function makeReverb() {
    // ベランダの小さな響き：減衰するノイズ、時間とともに高域が先に消える
    var sr = ctx.sampleRate, n = Math.floor(sr * 1.3), ir = ctx.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), y = 0;
      for (var i = 0; i < n; i++) {
        var tt = i / sr, a = 0.85 - 0.75 * Math.min(1, tt / 1.0);
        y += ((Math.random() * 2 - 1) - y) * a;
        d[i] = y * Math.exp(-tt * 4.2) * (i < sr * 0.004 ? i / (sr * 0.004) : 1) * 0.5;
      }
    }
    var cv = ctx.createConvolver(); cv.normalize = true; cv.buffer = ir; return cv;
  }
  function build() {
    makeBuffers();
    var pre = ctx.createGain();
    var hp = filt('highpass', 45, 0.7);
    var hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 5000; hs.gain.value = -5;
    var lp = filt('lowpass', 9500, 0.6);
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.25;
    var master = ctx.createGain(); master.gain.value = 0.62;
    pre.connect(hp); hp.connect(hs); hs.connect(lp); lp.connect(comp); comp.connect(master); master.connect(ctx.destination);
    bus.pre = pre; bus.master = master;
    var rev = makeReverb(), revOut = ctx.createGain(); revOut.gain.value = 0.9;
    rev.connect(revOut); revOut.connect(pre);
    function mk(level, send) {
      var g = ctx.createGain(); g.gain.value = level; g.connect(pre);
      if (send) { var s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); }
      return g;
    }
    bus.sfx = mk(1, 0.12); bus.water = mk(1, 0.05); bus.amb = mk(1, 0); bus.music = mk(1, 0.32);
  }

  A.init = function () {
    if (ok) { if (enabled) resume(); return; }
    if (tried) return;
    tried = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e1) { ctx = new AC(); }
      if (!ctx || !ctx.createGain) { ctx = null; return; }
      build();
      // iOS：無音を1つ鳴らしてロックを外す
      try { var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(0); } catch (e2) { }
      ok = true;
      resume();
    } catch (e) { ok = false; ctx = null; }
  };
  function resume() { try { if (ctx && ctx.state !== 'running' && ctx.resume) { var p = ctx.resume(); if (p && p.catch) p.catch(function () { }); } } catch (e) { } }

  A.setEnabled = function (on) {
    enabled = !!on;
    if (!ok) return;
    try {
      if (enabled) resume();
      else if (ctx.suspend) { var p = ctx.suspend(); if (p && p.catch) p.catch(function () { }); }
    } catch (e) { }
  };

  /* ───────── 蛇口の水（鳴りっぱなし） ───────── */
  var W = null;   // 持続ノード
  var tapS = { rate: 0, fill: 0, mode: 'can', fRes: 350 };
  function buildTap() {
    W = {};
    var src = loopSrc(BUF.w), brn = loopSrc(BUF.b);
    // 落ちる水柱のさーっ（空気中の水流・当たりのしぶき）
    W.hissF = filt('bandpass', 2400, 0.55); W.hissG = ctx.createGain(); W.hissG.gain.value = 0;
    src.connect(W.hissF); W.hissF.connect(W.hissG); W.hissG.connect(bus.water);
    // じょうろの中の空気柱の共鳴（閉管：基音と3倍）
    W.r1 = filt('bandpass', 350, 6); W.r1G = ctx.createGain(); W.r1G.gain.value = 0;
    W.r2 = filt('bandpass', 1050, 8); W.r2G = ctx.createGain(); W.r2G.gain.value = 0;
    src.connect(W.r1); W.r1.connect(W.r1G); W.r1G.connect(bus.water);
    src.connect(W.r2); W.r2.connect(W.r2G); W.r2G.connect(bus.water);
    // 水受けのびちゃびちゃ：中高域を、ゆらぐ振幅で
    W.panF = filt('bandpass', 1700, 0.9); W.panAM = ctx.createGain(); W.panAM.gain.value = 0.6; W.panG = ctx.createGain(); W.panG.gain.value = 0;
    src.connect(W.panF); W.panF.connect(W.panAM); W.panAM.connect(W.panG); W.panG.connect(bus.water);
    W.pl = ctx.createOscillator(); W.pl.frequency.value = 13; W.plG = ctx.createGain(); W.plG.gain.value = 0.35;
    W.pl.connect(W.plG); W.plG.connect(W.panAM.gain); W.pl.start();
    // あふれるじょぼじょぼ：低い水音を、ごぼごぼの周期で
    W.ovF = filt('lowpass', 700, 1.6); W.ovAM = ctx.createGain(); W.ovAM.gain.value = 0.55; W.ovG = ctx.createGain(); W.ovG.gain.value = 0;
    brn.connect(W.ovF); W.ovF.connect(W.ovAM); W.ovAM.connect(W.ovG); W.ovG.connect(bus.water);
    W.ol = ctx.createOscillator(); W.ol.frequency.value = 5.5; W.olG = ctx.createGain(); W.olG.gain.value = 0.45;
    W.ol.connect(W.olG); W.olG.connect(W.ovAM.gain); W.ol.start();
    W.sp = { b: 0, t: 0, s: 0 };
  }
  A.tap = function (rate, fill, mode) {
    if (!ok) return;
    try {
      if (!W) buildTap();
      var r = c01(num(rate, 0)), f = c01(num(fill, 0));
      mode = (mode === 'pan' || mode === 'over') ? mode : 'can';
      tapS.rate = r; tapS.fill = f; tapS.mode = mode;
      // 空気柱の長さ L（じょうろの深さ約 0.22m ＋ 口の補正）から f = c / 4L
      var L = 0.22 * (1 - Math.min(f, 0.97)) + 0.03, fr = Math.min(2300, 343 / (4 * L));
      tapS.fRes = fr;
      var can = mode === 'can' ? 1 : (mode === 'over' ? 0.35 : 0);
      var pan = mode === 'pan' ? 1 : 0, ov = mode === 'over' ? 1 : 0;
      var sr = Math.sqrt(r);
      setT(W.hissG.gain, r * (0.09 + 0.05 * pan + 0.03 * ov), 0.06);
      setT(W.r1.frequency, fr, 0.12, 3);
      setT(W.r2.frequency, Math.min(6000, fr * 3), 0.12, 6);
      setT(W.r1G.gain, sr * can * (0.55 + 0.25 * f), 0.08);
      setT(W.r2G.gain, sr * can * 0.22, 0.08);
      setT(W.panG.gain, r * pan * 0.32, 0.07);
      setT(W.ovG.gain, sr * ov * 0.38, 0.1);
    } catch (e) { }
  };
  function tapGrains(dt) {
    var s = tapS, r = s.rate;
    if (r < 0.01 || !W) return;
    var sp = W.sp, t0 = now() + 0.02;
    if (s.mode === 'can') {
      // 水の中に巻き込まれた泡の粒：共鳴のまわりで鳴る
      sp.b = spawn(sp.b, dt, 16 + 30 * r, function (o) {
        var f = Math.max(220, Math.min(2600, s.fRes * rr(0.6, 1.6)));
        bubble(t0 + o, f, rr(0.03, 0.09), 0.06 * r * rr(0.4, 1));
      });
      // 空のうちはブリキの底を水がたたく
      if (s.fill < 0.12) sp.t = spawn(sp.t, dt, 22 * r * (1 - s.fill / 0.12), function (o) {
        tin(t0 + o, 0.025 * rr(0.5, 1), rr(800, 980), bus.water);
      });
    } else if (s.mode === 'pan') {
      sp.b = spawn(sp.b, dt, 38 * r, function (o) { bubble(t0 + o, rr(1200, 3000), rr(0.015, 0.04), 0.045 * r * rr(0.4, 1)); });
      sp.s = spawn(sp.s, dt, 14 * r, function (o) {
        noise(t0 + o, rr(0.02, 0.05), 0.07 * r, { type: 'bandpass', f: rr(1400, 3200), q: 1.2, dest: bus.water });
      });
    } else {
      // ごぼっ：大きな泡がゆっくり上がる（低い・おかしみ）
      sp.b = spawn(sp.b, dt, 5 + 6 * r, function (o) {
        var f = rr(170, 400); tone(t0 + o, f, rr(0.08, 0.15), 0.1 * r, { f1: f * rr(1.8, 2.4), att: 0.01, dest: bus.water });
      });
      sp.s = spawn(sp.s, dt, 24 * r, function (o) { bubble(t0 + o, rr(900, 2400), rr(0.02, 0.05), 0.04 * r); });
      if (rnd() < dt * 2) setT(W.ol.frequency, rr(4, 7.5), 0.2, 0.3);
    }
  }
  /* ポアソンの粒の発生：残り時間を返す */
  function spawn(left, dt, rate, fn) {
    if (rate <= 0.01) return rnd() * 0.05;
    left -= dt;
    var n = 0;
    while (left <= 0 && n < 4) {
      if (voices < MAX_GRAIN) fn(rnd() * Math.min(dt, 0.05));
      left += -Math.log(1 - rnd() * 0.999) / rate; n++;
    }
    if (left < 0) left = 0;
    return left;
  }

  /* ───────── シャワー（鳴りっぱなし） ───────── */
  var S = null;
  var shS = { rate: 0, soil: 0, leaf: 0, floor: 0, metal: 0, zaru: 0 };
  function buildShower() {
    S = {};
    var pk = loopSrc(BUF.p), wh = loopSrc(BUF.w);
    function chain(src, type, f, q, f2) {
      var a = filt(type, f, q), g = ctx.createGain(); g.gain.value = 0; src.connect(a);
      if (f2) { var b = filt('lowpass', f2, 0.6); a.connect(b); b.connect(g); } else a.connect(g);
      g.connect(bus.water); return g;
    }
    S.air = chain(wh, 'bandpass', 3000, 0.6, 6000);      // 空中を落ちる粒のかすかなさー
    S.soil = chain(pk, 'bandpass', 1300, 0.45, 3000);    // 土：やわらかい
    S.leaf = chain(wh, 'bandpass', 3800, 1.0);           // 葉：ぱらぱら
    S.floor = chain(wh, 'bandpass', 2300, 1.1);          // 床：ぴちゃぴちゃ
    S.zaru = chain(wh, 'bandpass', 3200, 1.3, 5500);     // 竹ざる：さらさら
    S.sp = { leaf: 0, floor: 0, metal: 0, zaru: 0, soil: 0 };
  }
  A.shower = function (rate, mix) {
    if (!ok) return;
    try {
      if (!S) buildShower();
      var r = c01(num(rate, 0)); mix = mix || {};
      shS.rate = r;
      shS.soil = c01(num(mix.soil, 0)); shS.leaf = c01(num(mix.leaf, 0)); shS.floor = c01(num(mix.floor, 0));
      shS.metal = c01(num(mix.metal, 0)); shS.zaru = c01(num(mix.zaru, 0));
      setT(S.air.gain, r * 0.03, 0.08);
      setT(S.soil.gain, r * shS.soil * 0.5, 0.1);
      setT(S.leaf.gain, r * shS.leaf * 0.14, 0.08);
      setT(S.floor.gain, r * shS.floor * 0.16, 0.08);
      setT(S.zaru.gain, r * shS.zaru * 0.18, 0.08);
    } catch (e) { }
  };
  function showerGrains(dt) {
    var s = shS, r = s.rate;
    if (r < 0.01 || !S) return;
    var sp = S.sp, t0 = now() + 0.02;
    sp.leaf = spawn(sp.leaf, dt, 45 * r * s.leaf, function (o) {
      // 葉を打つ粒：短いはじけ＋葉の軽いしなり
      noise(t0 + o, rr(0.006, 0.018), 0.06 * rr(0.4, 1), { type: 'bandpass', f: rr(1800, 4200), q: 1.4, dest: bus.water });
    });
    sp.floor = spawn(sp.floor, dt, 40 * r * s.floor, function (o) {
      bubble(t0 + o, rr(1300, 3300), rr(0.012, 0.03), 0.05 * rr(0.4, 1));
    });
    sp.soil = spawn(sp.soil, dt, 18 * r * s.soil, function (o) {
      noise(t0 + o, rr(0.02, 0.04), 0.035, { buf: 'p', type: 'lowpass', f: 700, dest: bus.water });
    });
    sp.metal = spawn(sp.metal, dt, 13 * r * s.metal, function (o) {
      // 端に当たるとカン（高い）、まん中だとコン（低い）
      var kan = rnd() < 0.5;
      tin(t0 + o, (kan ? 0.045 : 0.06) * rr(0.5, 1), kan ? rr(860, 940) : rr(560, 600), bus.water);
    });
    sp.zaru = spawn(sp.zaru, dt, 28 * r * s.zaru, function (o) {
      if (rnd() < 0.35) wood(t0 + o, rr(1500, 2300), 0.025, bus.water);
      else noise(t0 + o, rr(0.008, 0.02), 0.05, { type: 'bandpass', f: rr(2500, 4500), q: 2, dest: bus.water });
    });
  }

  /* ───────── 外の空気 ───────── */
  var M = null;
  var amS = { t: 0.3, night: 0, on: false, chime: 25, wind: 0 };
  function buildAmb() {
    M = {};
    var br = loopSrc(BUF.b), pk = loopSrc(BUF.p);
    M.city = ctx.createGain(); M.city.gain.value = 0;
    var lp = filt('lowpass', 230, 0.6); br.connect(lp); lp.connect(M.city); M.city.connect(bus.amb);
    M.wind = ctx.createGain(); M.wind.gain.value = 0;
    M.windF = filt('bandpass', 520, 0.6); pk.connect(M.windF); M.windF.connect(M.wind); M.wind.connect(bus.amb);
  }
  A.ambience = function (t, night) {
    if (!ok) return;
    try {
      if (!M) buildAmb();
      amS.t = num(t, 0.3); amS.night = c01(num(night, 0)); amS.on = true;
      var day = 1 - amS.night;
      setT(M.city.gain, 0.05 + 0.07 * day, 1.0, 0.004);
    } catch (e) { }
  };
  function ambTick(dt) {
    if (!M || !amS.on) return;
    var day = 1 - amS.night;
    // 風は気まぐれにゆっくり強弱
    if (rnd() < dt * 0.4) {
      amS.wind = rr(0.2, 1);
      setT(M.wind.gain, (0.012 + 0.03 * amS.wind) * (0.4 + 0.6 * day), 1.6, 0.003);
      setT(M.windF.frequency, rr(380, 700), 2.0, 20);
    }
    amS.chime -= dt;
    if (amS.chime <= 0) {
      amS.chime = rr(30, 70);
      if (day > 0.5 && voices < MAX_GRAIN) {
        // 遠くの風鈴：ガラスの非整数倍音、ごく小さく
        var t0 = now() + 0.05, f = rr(1650, 1900);
        var parts = [[1, 1, 2.0], [2.32, 0.3, 0.9], [4.25, 0.1, 0.4]];
        modal(t0, f, parts, 0.028 * day, bus.amb);
        if (rnd() < 0.6) modal(t0 + rr(0.35, 0.8), f * rr(0.99, 1.01), parts, 0.017 * day, bus.amb);
      }
    }
  }

  /* ───────── 曲 ───────── */
  var song = null;
  // オリジナルの子守歌（五音音階・ゆっくり）。[MIDI, 拍]、bass は小節頭の低い音
  var LULLABY = [
    [76, 1], [79, 1], [81, 1], [79, 1], [76, 1], [74, 1], [72, 2],
    [74, 1], [76, 1], [79, 1], [76, 1], [74, 3], [0, 1],
    [76, 1], [79, 1], [81, 1], [84, 1], [81, 1], [79, 1], [76, 2],
    [74, 1], [76, 1], [74, 1], [69, 1], [72, 4]
  ];
  var BASS = [60, 57, 62, 55, 60, 57, 55, 60];
  A.music = function (name) {
    if (!ok) return;
    try {
      stopSong();
      if (name !== 'lullaby') return;
      var g = ctx.createGain(); g.gain.value = 1; g.connect(bus.music);
      song = g;
      var beat = 0.36, t = now() + 0.08, b = 0, bar = 0, i;
      for (i = 0; i < LULLABY.length; i++) {
        var n = LULLABY[i];
        if (n[0]) musicBox(t + b * beat + (rnd() - 0.5) * 0.012, mtof(n[0]), 0.2, g);
        b += n[1];
      }
      for (bar = 0; bar < BASS.length; bar++) musicBox(t + bar * 4 * beat, mtof(BASS[bar]), 0.11, g);
      musicBox(t + (b - 4) * beat + beat * 0.5, mtof(79), 0.07, g);
      musicBox(t + (b - 4) * beat + beat * 1.0, mtof(84), 0.06, g);
    } catch (e) { }
  };
  function stopSong() {
    if (!song) return;
    var g = song; song = null;
    try {
      g.gain.setTargetAtTime(0, now(), 0.12);
      setTimeout(function () { try { g.disconnect(); } catch (e) { } }, 900);
    } catch (e) { }
  }

  /* ───────── 一発音 ───────── */
  var GAP = { star: 0.03, drip: 0.035, grow: 0.3, dayPass: 1.0, morning: 0.8, rainbow: 0.6, sparkle: 0.12, pinwheel: 0.12 };
  var P = {};
  P.touch = function (t) {
    tone(t, 720, 0.05, 0.14, { f1: 480, gt: 0.04 });
    noise(t, 0.018, 0.07, { type: 'bandpass', f: 1300, q: 2 });
  };
  P.squeak = function (t, a) {
    a = c01(num(a, 0.5));
    var dur = 0.22 - 0.1 * a, f0 = rr(620, 700) * (1 + 0.3 * a);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.45, t + dur);
    // こすれの引っかかり（stick-slip）で周波数がふるえる
    var l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = rr(28, 40); lg.gain.value = f0 * 0.04;
    l.connect(lg); lg.connect(o.frequency);
    var bp = filt('bandpass', 1400, 2.5), lp = filt('lowpass', 2600, 0.7), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13, t + 0.025);
    g.gain.setValueAtTime(0.13, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(bus.sfx);
    o.start(t); l.start(t); o.stop(t + dur + 0.03); l.stop(t + dur + 0.03);
    fin(o, [o, l, lg, bp, lp, g]);
  };
  P.drip = function (t, a) {
    a = c01(num(a, rnd()));
    var f = 850 + 700 * a;
    tone(t, f, 0.07, 0.3, { f1: f * 1.8, gt: 0.06, att: 0.002 });
    noise(t, 0.006, 0.05, { type: 'bandpass', f: 3000, q: 1 });
  };
  P.lift = function (t) {
    var f = rr(1800, 2000), parts = [[1, 1, 0.06], [1.52, 0.6, 0.05], [2.33, 0.35, 0.035]];
    modal(t, f, parts, 0.13); modal(t + 0.038, f * 1.12, parts, 0.1);
    noise(t, 0.02, 0.05, { type: 'bandpass', f: 3500, q: 1 });
  };
  P.put = function (t) {
    modal(t, rr(290, 320), [[1, 1, 0.18], [1.59, 0.5, 0.12], [2.14, 0.35, 0.09], [2.65, 0.25, 0.07], [3.6, 0.12, 0.05]], 0.22);
    noise(t, 0.06, 0.22, { buf: 'b', type: 'lowpass', f: 320, q: 0.8 });
  };
  P.slosh = function (t, a) {
    a = c01(num(a, 0.6));
    noise(t, 0.2 + 0.1 * a, 0.12 + 0.2 * a, { buf: 'p', type: 'bandpass', f: 1300, f1: 450, q: 1.3, att: 0.01 });
    var n = 2 + Math.round(a * 2);
    for (var i = 0; i < n; i++) bubble(t + rr(0.03, 0.16), rr(350, 750), rr(0.06, 0.12), (0.05 + 0.08 * a) * rr(0.6, 1), bus.sfx);
  };
  P.splash = function (t, a) {
    a = c01(num(a, 0.6));
    noise(t, 0.2 + 0.2 * a, 0.12 + 0.25 * a, { type: 'bandpass', f: 2000, f1: 900, q: 0.7, att: 0.004 });
    var n = 3 + Math.round(5 * a);
    for (var i = 0; i < n; i++) bubble(t + rr(0.03, 0.3), rr(900, 2500), rr(0.015, 0.04), 0.05 * rr(0.5, 1), bus.sfx);
  };
  P.plantIn = function (t) {
    noise(t, 0.14, 0.35, { buf: 'b', type: 'lowpass', f: 750, f1: 240, q: 0.7, att: 0.008 });
    tone(t, 140, 0.1, 0.2, { f1: 90 });
  };
  P.potBounce = function (t, a) {
    a = c01(num(a, 0.6));
    noise(t, 0.03, 0.08 + 0.18 * a, { type: 'bandpass', f: rr(1200, 1600), q: 2.5 });
    tone(t, rr(620, 700), 0.05, 0.04 + 0.1 * a, { type: 'triangle', f1: 520 });
  };
  P.droop = function (t) {
    // くた〜：ゆるく下がってふにゃっと揺れ、最後にぽふ
    tone(t, 560, 0.62, 0.2, { type: 'triangle', f1: 230, gt: 0.6, att: 0.03, lp: 1800, vib: 14, vr: 5 });
    noise(t + 0.52, 0.1, 0.12, { buf: 'b', type: 'lowpass', f: 420 });
  };
  P.perk = function (t) {
    // ばねで跳ね上がる＋しゃきーんの明るい響き
    tone(t, 260, 0.2, 0.22, { type: 'triangle', f1: 1150, gt: 0.14, lp: 3200 });
    tone(t + 0.1, 1150, 0.35, 0.12, { vib: 70, vr: 19, vd: 0.3 });
    bell(t + 0.12, 1568, 0.11, 0.6);
    bell(t + 0.16, 2093, 0.06, 0.5);
  };
  P.grow = function (t, a) {
    var len = Math.max(0.3, Math.min(5, num(a, 1.5)));
    var steps = Math.max(4, Math.round(len * 7));
    for (var i = 0; i < steps; i++) {
      var tt = t + (i / steps) * len, f = penta(Math.floor(i * 9 / steps), 64) * (i % 2 ? 1.06 : 1);
      tone(tt, f, 0.07, i % 2 ? 0.08 : 0.12, { type: 'triangle', f1: f * 1.25, gt: 0.05, att: 0.008, lp: 2800 });
    }
  };
  P.bloom = function (t, a) {
    var f = penta(c01(num(a, 0) / 6) * 6, 67);
    tone(t, f * 0.7, 0.2, 0.25, { f1: f, gt: 0.03, att: 0.003 });
    noise(t, 0.04, 0.06, { type: 'bandpass', f: 1500, q: 0.8 });
    bell(t + 0.04, f * 2, 0.04, 0.4);
  };
  P.swell = function (t) {
    tone(t, 260, 0.16, 0.22, { f1: 520, gt: 0.12, att: 0.02 });
    tone(t + 0.1, 520, 0.07, 0.09, { f1: 700, gt: 0.05 });
  };
  P.ripen = function (t, a) {
    xylo(t, penta(Math.round(c01(num(a, 0) / 6) * 6), 72), 0.32);
  };
  P.pluck = function (t) {
    noise(t, 0.012, 0.25, { type: 'bandpass', f: 2200, q: 1.5 });
    tone(t, 950, 0.04, 0.18, { f1: 500 });
    tone(t + 0.005, 300, 0.09, 0.06, { type: 'triangle' });
  };
  P.boing = function (t) {
    // びよ〜ん：ばねの振動で音程がゆれながらおさまる
    tone(t, 170, 0.75, 0.28, { type: 'triangle', f1: 240, gt: 0.5, att: 0.005, lp: 2000, vib: 60, vr: 11, vd: 0.7 });
  };
  P.drop = function (t) {
    var f = rr(520, 600);
    noise(t, 0.05, 0.15, { buf: 'b', type: 'lowpass', f: 500 });
    wood(t, f, 0.21); wood(t + 0.11, f * 1.1, 0.1); wood(t + 0.18, f * 1.05, 0.05);
  };
  P.bite = function (t, a) {
    a = c01(num(a, rnd()));
    var k = 1 + 0.3 * a;
    tone(t, 220 * k, 0.04, 0.22, { f1: 140 * k });
    for (var i = 0; i < 4; i++) noise(t + 0.008 + i * rr(0.008, 0.014), rr(0.008, 0.016), 0.24 * (1 - i * 0.18), { type: 'bandpass', f: rr(2300, 3800) * k, q: 1.5 });
    noise(t + 0.02, 0.12, 0.17, { buf: 'p', type: 'bandpass', f: 1800 * k, f1: 700 * k, q: 2 });
  };
  P.yum = function (t) {
    xylo(t, mtof(72), 0.16);
    xylo(t + 0.2, mtof(76), 0.2);
  };
  P.sparkle = function (t) {
    for (var i = 0; i < 5; i++) bell(t + i * 0.06, penta(5 + i, 72), 0.11 * (1 - i * 0.1), 0.5);
  };
  P.rainbow = function (t) {
    for (var i = 0; i <= 10; i++) tone(t + i * 0.09, penta(i, 72), 1.1, 0.07, { att: 0.02, dest: bus.music });
    for (var j = 0; j <= 10; j += 2) tone(t + j * 0.09, penta(j, 72) * 2, 0.4, 0.015, { att: 0.02, dest: bus.music });
  };
  P.bucket = function (t, a, b) {
    a = c01(num(a, 0.7)); b = c01(num(b, rnd()));
    tin(t, 0.1 + 0.17 * a, 470 * (1 + 0.35 * b));
  };
  P.pinwheel = function (t, a) {
    a = c01(num(a, 0.5));
    var rate = 12 + 28 * a, n = Math.min(20, Math.round(rate * 0.5));
    for (var i = 0; i < n; i++) {
      var tt = t + i / rate + rr(-0.004, 0.004), v = 0.3 * (1 - 0.5 * i / n);
      noise(tt, 0.006, v, { type: 'bandpass', f: rr(1700, 2100), q: 2 });
      if (i % 2 === 0) tone(tt, rr(1100, 1300), 0.012, v * 0.25, { type: 'triangle' });
    }
  };
  P.leaf = function (t) {
    noise(t, 0.12, 0.12, { buf: 'p', type: 'highpass', f: 1800, att: 0.01 });
    noise(t, 0.025, 0.3, { type: 'bandpass', f: 3000, q: 0.7 });
    noise(t + 0.03, 0.025, 0.2, { type: 'bandpass', f: 3400, q: 0.7 });
    noise(t + 0.065, 0.02, 0.13, { type: 'bandpass', f: 2700, q: 0.7 });
  };
  P.dayPass = function (t) {
    // 和音のパッドが、ゆっくり暗く・低くなる
    var lp = filt('lowpass', 1800, 0.5), g = ctx.createGain();
    lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(450, t + 2.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13, t + 0.6);
    g.gain.setTargetAtTime(0.0001, t + 1.1, 0.35);
    lp.connect(g); g.connect(bus.music);
    var fs = [261.6, 329.6, 392.0, 523.3], list = [lp, g], first = null;
    for (var i = 0; i < fs.length; i++) {
      var o = ctx.createOscillator(); o.type = i === 3 ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(fs[i], t); o.frequency.exponentialRampToValueAtTime(fs[i] * 0.84, t + 2.2);
      o.detune.value = (i - 1.5) * 4;
      var og = ctx.createGain(); og.gain.value = i === 3 ? 0.4 : 0.3;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + 2.8);
      list.push(o, og); if (!first) first = o;
    }
    fin(first, list);
  };
  P.morning = function (t) {
    var ns = [72, 76, 79, 84];
    for (var i = 0; i < ns.length; i++) bell(t + i * 0.28, mtof(ns[i]), 0.2 - i * 0.02, 1.4);
  };
  P.star = function (t, a) {
    musicBox(t, penta(Math.max(0, Math.min(7, Math.round(num(a, rnd() * 7)))), 72), 0.22, bus.music);
  };
  P.hint = function (t) {
    bell(t, 1568, 0.08, 0.5);
  };

  A.play = function (name, a, b) {
    if (!ok || !enabled) return;
    try {
      var fn = P[name];
      if (!fn || !P.hasOwnProperty(name)) return;
      var t = now(), gap = GAP[name] || 0.045;
      if (lastPlay[name] !== undefined && t - lastPlay[name] < gap) return;
      lastPlay[name] = t;
      fn(t + 0.008, a, b);
    } catch (e) { }
  };

  A.update = function (dt) {
    if (!ok || !enabled) return;
    try {
      if (ctx.state !== 'running') return;
      dt = num(dt, 0.016); if (dt > 1) dt = dt / 1000;   // ミリ秒で渡されても
      dt = Math.max(0, Math.min(0.1, dt));
      tapGrains(dt); showerGrains(dt); ambTick(dt);
    } catch (e) { }
  };
})();
