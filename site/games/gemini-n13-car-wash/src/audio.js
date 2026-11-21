/**
 * Lightweight 100% offline procedural Web Audio foley engine for realistic car-wash soundscape.
 * Unlocks cleanly on first pointer interaction (iOS Safari compatible).
 */
export class CarWashAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.loops = {};
    this.unlocked = false;
    this.lastPopTime = 0;
    this.lastSqueakTime = 0;
  }

  unlock() {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // Pre-generate 2-second seamless white/pinkish noise buffer
    const sr = this.ctx.sampleRate;
    const len = sr * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, sr);
    const out = this.noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      out[i] = (b0 + b1 + b2 + white * 0.35) * 0.45;
    }

    this._buildContinuousLoops();
    this.unlocked = true;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _makeNoiseLoop(filterType, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, filter, gain };
  }

  _buildContinuousLoops() {
    // Pressurized garden hose spray + metallic impact splash
    this.loops.hoseHiss = this._makeNoiseLoop('bandpass', 2800, 0.9);
    this.loops.hoseImpact = this._makeNoiseLoop('bandpass', 920, 1.4);

    // Wide gentle shower rain rinse
    this.loops.shower = this._makeNoiseLoop('bandpass', 1850, 0.65);

    // Juicy foamy sponge scrubbing
    this.loops.sponge = this._makeNoiseLoop('bandpass', 720, 1.8);

    // Soft velvety microfiber cloth wipe
    this.loops.towel = this._makeNoiseLoop('highpass', 2400, 0.7);
  }

  /**
   * Smoothly modulates continuous tool foley every frame based on active tool, contact, and drag speed.
   */
  updateContinuous(tool, active, onCar, speedNorm, elapsed) {
    if (!this.unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;
    const tau = 0.055;

    const hoseG = active && tool === 'hose' ? 0.32 : 0;
    const impactG = active && tool === 'hose' && onCar ? 0.36 : 0;
    const showerG = active && tool === 'shower' ? (onCar ? 0.38 : 0.24) : 0;
    const spongeG = active && tool === 'sponge' && onCar ? Math.min(0.36, 0.08 + speedNorm * 0.30) : 0;
    const towelG = active && tool === 'towel' && onCar ? Math.min(0.22, 0.04 + speedNorm * 0.20) : 0;

    this.loops.hoseHiss.gain.gain.setTargetAtTime(hoseG, now, tau);
    this.loops.hoseImpact.gain.gain.setTargetAtTime(impactG, now, tau);
    this.loops.hoseImpact.filter.frequency.setTargetAtTime(840 + Math.sin(elapsed * 19) * 160, now, 0.04);

    this.loops.shower.gain.gain.setTargetAtTime(showerG, now, tau);
    this.loops.shower.filter.frequency.setTargetAtTime(onCar ? 1650 : 2250, now, 0.06);

    this.loops.sponge.gain.gain.setTargetAtTime(spongeG, now, tau);
    this.loops.sponge.filter.frequency.setTargetAtTime(580 + speedNorm * 520, now, 0.05);

    this.loops.towel.gain.gain.setTargetAtTime(towelG, now, tau);

    // Occasional satisfying squeaky-clean glass/clearcoat chirp when buffing with towel
    if (active && tool === 'towel' && onCar && speedNorm > 0.42 && elapsed - this.lastSqueakTime > 0.65) {
      if (Math.random() < 0.35) {
        this.lastSqueakTime = elapsed;
        this._playCleanSqueak();
      }
    }
  }

  _playCleanSqueak() {
    if (!this.unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    const base = 1850 + Math.random() * 450;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.24, now + 0.07);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.045, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  playToolPickup(toolId) {
    if (!this.unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (toolId === 'sponge') {
      // Wet foamy water plop lifting sponge from bucket
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.09);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (toolId === 'hose' || toolId === 'shower') {
      // Crisp metallic brass/chrome tap clink
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      const f = toolId === 'hose' ? 680 : 880;
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, now + 0.075);
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.095);
    } else {
      // Soft cloth swoosh
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = 1900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.15, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      src.connect(flt);
      flt.connect(g);
      g.connect(this.master);
      src.start(now);
      src.stop(now + 0.17);
    }
  }

  playBubblePop() {
    if (!this.unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPopTime < 0.05) return;
    this.lastPopTime = now;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    const startF = 480 + Math.random() * 280;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(startF * 1.9, now + 0.055);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /**
   * Cheerful realistic car-lock double-chirp + sparkling sunlit acoustic chime when wash finishes!
   */
  playSparklingFinish() {
    if (!this.unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Gentle real car-lock happy double chirp ("pi-pi!")
    [0, 0.16].forEach((delay) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1480, now + delay);
      g.gain.setValueAtTime(0.001, now + delay);
      g.gain.linearRampToValueAtTime(0.11, now + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.085);
      osc.connect(g);
      g.connect(this.master);
      osc.start(now + delay);
      osc.stop(now + delay + 0.09);
    });

    // Warm sunlit acoustic celesta/chime arpeggio (C5 - E5 - G5 - C6)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const t = now + 0.32 + i * 0.11;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.72);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  }
}
