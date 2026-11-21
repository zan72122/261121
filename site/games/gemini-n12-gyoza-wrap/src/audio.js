/**
 * Procedural Web Audio Foley & Cooking Sound Engine (Zero external audio files!).
 * Synthesizes authentic kitchen acoustics:
 *  - Soft wet dough plop & filling scoop
 *  - Tactile gyoza pleat pinches (きゅっ)
 *  - Dynamic oil & water sizzle (じゅっ / ジュワァァーッ) with live low-pass lid-muffling!
 *  - Water stream pouring onto hot griddle
 *  - Tempered glass + stainless steel lid clack (カチャン)
 *  - Crispy hanetsuki wing crackle (パリッ・サクッ)
 *  - Soy sauce dip splash & warm ceramic plate clink
 */
export class KitchenAudio {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.sizzleNode = null;
    this.sizzleFilter = null;
    this.sizzleGain = null;
    this.sizzleTarget = 0;
    this.sizzleCutoffTarget = 4200;
    this.unlocked = false;
  }

  unlock() {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.unlocked = true;

    // Generate 2.5s rich stereo pink/white hybrid noise buffer for realistic sizzling & steam
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.5);
    this.noiseBuffer = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = this.noiseBuffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.950 * b2 + w * 0.048;
        // Mix crisp high-frequency crackle with warm steam body
        const crackle = Math.random() > 0.996 ? (Math.random() * 2 - 1) * 1.4 : 0;
        data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2) * 1.3 + w * 0.34 + crackle));
      }
    }

    // Continuous looping sizzle bed (gain modulated smoothly by cooking state)
    this.sizzleNode = this.ctx.createBufferSource();
    this.sizzleNode.buffer = this.noiseBuffer;
    this.sizzleNode.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 650;

    this.sizzleFilter = this.ctx.createBiquadFilter();
    this.sizzleFilter.type = 'lowpass';
    this.sizzleFilter.frequency.value = 4200;
    this.sizzleFilter.Q.value = 0.7;

    this.sizzleGain = this.ctx.createGain();
    this.sizzleGain.gain.value = 0.0001;

    this.sizzleNode.connect(hp);
    hp.connect(this.sizzleFilter);
    this.sizzleFilter.connect(this.sizzleGain);
    this.sizzleGain.connect(this.ctx.destination);
    this.sizzleNode.start();
  }

  /** Smoothly sets continuous pan sizzle volume (0..1) & brightness (Hz, muffled ~1100Hz under lid, crisp ~6500Hz open!) */
  setSizzle(level, cutoffHz = 4800) {
    this.sizzleTarget = Math.max(0, Math.min(1, level));
    this.sizzleCutoffTarget = cutoffHz;
    if (!this.ctx || !this.sizzleGain) return;
    const t = this.ctx.currentTime;
    this.sizzleGain.gain.setTargetAtTime(Math.max(0.0001, this.sizzleTarget * 0.28), t, 0.14);
    this.sizzleFilter.frequency.setTargetAtTime(this.sizzleCutoffTarget, t, 0.18);
  }

  /** Soft juicy plop when scooping or placing filling */
  playPlop(pitch = 1.0) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(92 * pitch, t + 0.09);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Delicate dough pinch sound (きゅっ) with subtle musical lift per pleat! */
  playPleat(index = 0) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Short filtered noise rub + gentle soft pitched pop
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + index * 180;
    bp.Q.value = 2.4;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.001, t);
    ng.gain.linearRampToValueAtTime(0.08, t + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    src.connect(bp); bp.connect(ng); ng.connect(this.ctx.destination);
    src.start(t, Math.random() * 1.5, 0.08);

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    const pentatonic = [330, 370, 415, 494, 554, 659];
    const freq = pentatonic[index % pentatonic.length];
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 0.85, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    og.gain.setValueAtTime(0.001, t);
    og.gain.linearRampToValueAtTime(0.075, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og); og.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.10);
  }

  /** Instant crisp sizzle burst (じゅっ！) when raw gyoza touches oiled hot plate, or huge ジュワーッ on water pour! */
  playSizzleBurst(intensity = 0.5, duration = 0.55) {
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7800, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.38 * intensity, t + 0.045);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.ctx.destination);
    src.start(t, Math.random(), duration + 0.05);
  }

  /** Realistic metallic-glass clack (カチャン) when placing or lifting the hot plate lid */
  playLidClack(lift = false) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freqs = lift ? [680, 1420, 2380] : [480, 1120, 2150];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.94, t + 0.14);
      const amp = (i === 0 ? 0.14 : 0.06 / i);
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + (lift ? 0.12 : 0.18));
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.20);
    });
  }

  /** Warm ceramic clink (コトン) for stoneware plate or glass cup */
  playCeramicClink(pitch = 1.0) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(860 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(790 * pitch, t + 0.10);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g); g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** Super crisp hanetsuki wing crackle (パリッ！サクッ！) */
  playCrispyCrunch() {
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    // 3 rapid micro-snaps simulate flaky crisp starch crust shattering!
    [0, 0.032, 0.068].forEach((offset, i) => {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600 + i * 900;
      bp.Q.value = 1.1;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t + offset);
      g.gain.linearRampToValueAtTime(0.28 - i * 0.05, t + offset + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.055);
      src.connect(bp); bp.connect(g); g.connect(this.ctx.destination);
      src.start(t + offset, Math.random() * 1.5, 0.07);
    });
  }

  /** Liquid drop / soy sauce dip bloop (ちゃぽっ) */
  playWaterDrop(pitch = 1.0) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(780 * pitch, t + 0.065);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g); g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.10);
  }

  /** Subtle warm wooden-marimba chord when the golden hanetsuki gyoza flips onto the plate! */
  playRevealChord() {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.065);
      g.gain.setValueAtTime(0.001, t + i * 0.065);
      g.gain.linearRampToValueAtTime(0.085, t + i * 0.065 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + i * 0.065 + 0.55);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t + i * 0.065);
      osc.stop(t + i * 0.065 + 0.60);
    });
  }
}
