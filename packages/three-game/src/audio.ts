/**
 * Procedurally synthesised sound effects (Web Audio). No audio files are used,
 * so there are no licensing questions; see assets/LICENSES.md.
 * Browsers require a user gesture before audio can start: call unlock() from a click.
 */
export type SfxName =
  | 'hit'
  | 'thunder'
  | 'wind'
  | 'capture'
  | 'shield'
  | 'charge'
  | 'special'
  | 'victory'
  | 'ko'
  | 'intro'
  | 'tick';

export class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;
  muted = false;

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      await this.ctx.resume();
      this.applyVolume();
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'hit':
        this.noiseBurst(t, 0.35, 1200, 'lowpass', 0.9);
        this.tone(t, 70, 30, 0.45, 'sine', 1.0);
        break;
      case 'thunder':
        this.noiseBurst(t, 1.4, 500, 'lowpass', 0.8);
        for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.06, 0.05, 4000, 'highpass', 0.4);
        break;
      case 'wind':
        this.noiseSweep(t, 1.1, 300, 2400, 0.55);
        break;
      case 'capture':
        this.tone(t, 660, 660, 0.12, 'triangle', 0.35);
        this.tone(t + 0.1, 990, 990, 0.2, 'triangle', 0.35);
        break;
      case 'shield':
        this.tone(t, 440, 460, 0.4, 'sine', 0.25);
        this.tone(t, 880, 900, 0.4, 'sine', 0.15);
        break;
      case 'charge':
        this.tone(t, 200, 800, 0.35, 'sawtooth', 0.15);
        break;
      case 'special':
        this.tone(t, 120, 900, 1.6, 'sawtooth', 0.18);
        this.noiseSweep(t, 1.6, 200, 5000, 0.3);
        this.tone(t + 1.6, 55, 25, 1.2, 'sine', 1.0);
        this.noiseBurst(t + 1.6, 1.0, 900, 'lowpass', 0.8);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(t + i * 0.14, f, f, 0.5, 'triangle', 0.3),
        );
        break;
      case 'ko':
        this.tone(t, 400, 60, 1.2, 'square', 0.2);
        break;
      case 'intro':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.32, 110, 45, 0.35, 'sine', 1.0);
        break;
      case 'tick':
        this.tone(t, 1200, 1200, 0.06, 'square', 0.12);
        break;
    }
  }

  private envGain(t: number, dur: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    return g;
  }

  private tone(
    t: number,
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    peak: number,
  ): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(this.envGain(t, dur, peak));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(
    t: number,
    dur: number,
    freq: number,
    type: BiquadFilterType,
    peak: number,
  ): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f);
    f.connect(this.envGain(t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private noiseSweep(t: number, dur: number, f0: number, f1: number, peak: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    f.frequency.exponentialRampToValueAtTime(f0, t + dur);
    src.connect(f);
    f.connect(this.envGain(t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}
