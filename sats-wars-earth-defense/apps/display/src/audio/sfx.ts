import type { MatchEvent } from '@swed/shared';

/**
 * Original sound effects synthesised with Web Audio (no third-party samples, spec §3.5).
 * Every cue is rate-limited so a crowd mashing buttons never turns into noise.
 */

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private last = new Map<string, number>();
  private hum: { stop: () => void } | null = null;

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 4;
        const master = ctx.createGain();
        master.gain.value = this.volume;
        master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.master = master;
        this.noise = buf;
      }
      await this.ctx.resume();
      return this.ready;
    } catch {
      return false;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private gate(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? 0) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  private env(gain: number, attack: number, decay: number, at = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    gain: number,
    attack: number,
    decay: number,
    at = 0,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + at;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    o.connect(this.env(gain, attack, decay, at));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private hiss(
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    gain: number,
    attack: number,
    decay: number,
    at = 0,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    const t = ctx.currentTime + at;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    src.connect(bq).connect(this.env(gain, attack, decay, at));
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  /** Low hangar machinery drone or battle-ready hum, crossfaded by scene. */
  ambience(kind: 'hangar' | 'battle' | 'none'): void {
    if (!this.ready) return;
    this.hum?.stop();
    this.hum = null;
    if (kind === 'none') return;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(kind === 'hangar' ? 0.05 : 0.035, ctx.currentTime, 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'hangar' ? 240 : 400;
    lp.connect(g).connect(this.master!);
    const oscs = (kind === 'hangar' ? [55, 82.4, 110.3] : [41.2, 61.7, 123.5]).map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return o;
    });
    this.hum = {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
        setTimeout(() => oscs.forEach((o) => o.stop()), 2_500);
      },
    };
  }

  onEvent(e: MatchEvent): void {
    if (!this.ready) return;
    switch (e.type) {
      case 'action':
        if (e.paid) {
          // Lightning action: crack + rolling thunder, then a bright chime.
          this.hiss('highpass', 9000, 2500, 0.5, 0.002, 0.25);
          this.tone('sine', 55, 30, 0.8, 0.02, 1.6, 0.05);
          this.hiss('lowpass', 900, 80, 0.45, 0.05, 1.8, 0.05);
          this.tone('sine', 220, 440, 0.12, 0.25, 0.9);
          [784, 1046.5, 1318.5].forEach((f, i) =>
            this.tone('sine', f, f, 0.06, 0.01, 0.8, 0.6 + i * 0.09),
          );
          if (e.kind === 'ATTACK') this.tone('sine', 70, 22, 0.9, 0.005, 2.2, 0.3);
          break;
        }
        // Free taps arrive in batches; one gated sound per action keeps a crowd listenable.
        if (e.kind === 'ATTACK') {
          if (!this.gate('fire', 140)) return;
          this.tone('sine', 90, 32, Math.min(0.7, 0.25 + e.count * 0.05), 0.005, 0.5);
          this.hiss('lowpass', 1800, 200, 0.25, 0.003, 0.35);
        } else if (e.kind === 'DEFEND') {
          if (!this.gate('shield', 220)) return;
          this.tone('triangle', 520, 780, 0.1, 0.02, 0.5);
          this.tone('triangle', 523, 784, 0.1, 0.02, 0.5);
        } else {
          if (this.gate('repair', 300)) this.tone('sine', 880, 1320, 0.07, 0.01, 0.3);
        }
        break;
      case 'threat_warning':
        if (!this.gate('warn', 1_400)) return;
        this.tone('square', 880, 880, 0.05, 0.005, 0.11);
        this.tone('square', 660, 660, 0.05, 0.005, 0.11, 0.15);
        break;
      case 'strike_blocked':
        this.tone('square', 1250, 900, 0.07, 0.003, 0.25);
        this.hiss('highpass', 3000, 6000, 0.12, 0.003, 0.3);
        this.tone('sine', 1760, 1760, 0.06, 0.01, 0.4, 0.08);
        break;
      case 'strike_hit':
        this.tone('sine', 70, 25, 0.8, 0.01, 1.8);
        this.hiss('lowpass', 1400, 80, 0.6, 0.01, 2);
        break;
      case 'mech_hit':
        this.tone('sine', 110, 40, 0.6, 0.005, 0.45);
        this.hiss('lowpass', 2400, 300, 0.4, 0.004, 0.5);
        break;
      case 'boss_destroyed':
        this.tone('sine', 70, 25, 0.9, 0.01, 2.2);
        this.hiss('lowpass', 900, 80, 0.7, 0.01, 2.6);
        break;
      case 'player_joined':
        if (!e.bot && this.gate('join', 300)) this.tone('sine', 660, 990, 0.08, 0.01, 0.2);
        break;
      case 'phase_changed':
        if (e.to === 'BATTLE') {
          [110, 164.8, 220].forEach((f) => this.tone('sawtooth', f, f * 0.98, 0.07, 0.05, 1.4));
        }
        if (e.to === 'VICTORY')
          [392, 523.3, 659.3, 784].forEach((f, i) =>
            this.tone('triangle', f, f, 0.12, 0.02, 1.4, i * 0.12),
          );
        if (e.to === 'DEFEAT')
          [220, 207.7, 196].forEach((f, i) =>
            this.tone('sawtooth', f, f * 0.97, 0.08, 0.04, 1.2, i * 0.25),
          );
        break;
    }
  }
}

export const sfx = new Sfx();
