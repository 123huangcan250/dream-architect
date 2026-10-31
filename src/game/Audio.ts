/** Fully synthesized ambience and effects (no audio assets). */
export class DreamAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  volume = 0.6;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // Gentle reverb-ish feedback delay.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.37;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    delay.connect(lp).connect(fb).connect(delay);
    this.master.connect(ctx.destination);
    delay.connect(this.master);
    this.fx = delay;
    // Ambient pad: detuned oscillators through a slowly breathing filter.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.05;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 350;
    lfo.connect(lfoAmt).connect(filt.frequency);
    lfo.start();
    for (const f of [110, 164.81, 220.5, 277.18, 329.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g).connect(filt);
      o.start();
    }
    filt.connect(this.padGain).connect(this.master);
    this.padGain.connect(delay);
  }

  private fx: AudioNode | null = null;

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, slide = 0, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    if (this.fx) g.connect(this.fx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, gain: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  play(name: 'pickup' | 'lever' | 'grab' | 'drop' | 'solve' | 'align' | 'portal' | 'shift' | 'win' | 'step' | 'ui'): void {
    switch (name) {
      case 'pickup':
        [659, 880, 1174, 1568].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.12, 1, i * 0.07));
        break;
      case 'lever':
        this.noise(0.12, 0.25, 900);
        this.tone(180, 0.2, 'square', 0.05, 0.6);
        break;
      case 'grab':
        this.tone(440, 0.18, 'triangle', 0.1, 1.6);
        break;
      case 'drop':
        this.tone(520, 0.2, 'triangle', 0.08, 0.5);
        break;
      case 'align':
        [392, 494, 587, 784].forEach((f, i) => this.tone(f, 1.2, 'sine', 0.08, 1, i * 0.12));
        break;
      case 'solve':
        this.tone(196, 1.6, 'sine', 0.15, 2);
        break;
      case 'portal':
        this.noise(0.35, 0.05, 2400);
        break;
      case 'shift':
        this.tone(140, 0.9, 'sine', 0.12, 0.5);
        this.noise(0.5, 0.06, 500);
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 2.2, 'sine', 0.1, 1, i * 0.18));
        break;
      case 'step':
        this.noise(0.05, 0.03, 300);
        break;
      case 'ui':
        this.tone(880, 0.08, 'sine', 0.05);
        break;
    }
  }
}
