import type { TeamId } from '@sats-wars/shared';
import type { ArenaDirector, MusicCue } from './director';
import { MusicPlayer } from './music';

/**
 * Procedurally synthesised sound effects and music (Web Audio). No audio files
 * are used, so there are no licensing questions; see assets/LICENSES.md.
 * Browsers require a user gesture before audio can start: call unlock() from a click.
 *
 * Every sound runs through a stereo panner (Raijin on the left, Fujin on the
 * right) and sends a little to a synthesised hall reverb; heavy blows layer a
 * sub-bass thump under a sharp crack.
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
  | 'tick'
  | 'impact'
  | 'explosion'
  | 'whoosh'
  | 'riser'
  | 'alarm'
  | 'shatter';

export interface PlayOptions {
  /** -1 (left) … 1 (right). */
  pan?: number;
}

/** Raijin stands on the left of the venue screen, Fujin on the right. */
export function panFor(teamId: TeamId | null): number {
  return teamId === 'RAIJIN' ? -0.45 : teamId === 'FUJIN' ? 0.45 : 0;
}

export class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private musicPlayer: MusicPlayer | null = null;
  private musicCue: MusicCue | null = null;
  volume = 0.7;
  muted = false;
  /** Background music on/off (the venue may play its own). */
  musicEnabled = true;

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
        // Hall reverb from a generated impulse: decaying stereo noise (no recordings).
        const conv = this.ctx.createConvolver();
        conv.buffer = hallImpulse(this.ctx, 2.4);
        this.reverb = this.ctx.createGain();
        this.reverb.gain.value = 0.22;
        this.reverb.connect(conv);
        conv.connect(this.master);
        this.musicPlayer = new MusicPlayer(this.ctx, this.master, this.noise);
      }
      await this.ctx.resume();
      this.applyVolume();
      if (this.musicCue) this.setMusic(this.musicCue);
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

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (!on) this.musicPlayer?.stop();
    else if (this.musicCue) this.setMusic(this.musicCue);
  }

  /** Switch the score's intensity (remembered until audio is unlocked). */
  setMusic(cue: MusicCue): void {
    this.musicCue = cue;
    if (!this.musicPlayer || !this.musicEnabled || this.ctx?.state !== 'running') return;
    this.musicPlayer.play(cue);
  }

  private applyVolume(): void {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  play(name: SfxName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime;
    const out = this.bus(opts.pan ?? 0, name === 'tick' ? 0 : 1);
    switch (name) {
      case 'hit':
        this.noiseBurst(out, t, 0.35, 1200, 'lowpass', 0.9);
        this.tone(out, t, 70, 30, 0.45, 'sine', 1.0);
        break;
      case 'thunder':
        this.noiseBurst(out, t, 1.4, 500, 'lowpass', 0.8);
        for (let i = 0; i < 4; i++) this.noiseBurst(out, t + i * 0.06, 0.05, 4000, 'highpass', 0.4);
        break;
      case 'wind':
        this.noiseSweep(out, t, 1.1, 300, 2400, 0.55);
        break;
      case 'capture':
        this.tone(out, t, 660, 660, 0.12, 'triangle', 0.35);
        this.tone(out, t + 0.1, 990, 990, 0.2, 'triangle', 0.35);
        break;
      case 'shield':
        this.tone(out, t, 440, 460, 0.4, 'sine', 0.25);
        this.tone(out, t, 880, 900, 0.4, 'sine', 0.15);
        break;
      case 'charge':
        this.tone(out, t, 200, 800, 0.35, 'sawtooth', 0.15);
        break;
      case 'special':
        this.tone(out, t, 120, 900, 1.6, 'sawtooth', 0.18);
        this.noiseSweep(out, t, 1.6, 200, 5000, 0.3);
        this.tone(out, t + 1.6, 55, 25, 1.2, 'sine', 1.0);
        this.noiseBurst(out, t + 1.6, 1.0, 900, 'lowpass', 0.8);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(out, t + i * 0.14, f, f, 0.5, 'triangle', 0.3),
        );
        break;
      case 'ko':
        this.tone(out, t, 400, 60, 1.2, 'square', 0.2);
        break;
      case 'intro':
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.32, 110, 45, 0.35, 'sine', 1.0);
        break;
      case 'tick':
        this.tone(out, t, 1200, 1200, 0.06, 'square', 0.12);
        break;
      case 'impact':
        // Sharp crack on top, a body, and a sub-bass thump you feel more than hear.
        this.noiseBurst(out, t, 0.06, 3500, 'highpass', 0.8);
        this.noiseBurst(out, t, 0.35, 900, 'lowpass', 0.9);
        this.tone(out, t, 62, 30, 0.6, 'sine', 1.2);
        break;
      case 'explosion':
        this.noiseSweepDown(out, t, 1.6, 2400, 160, 1.0);
        this.tone(out, t, 55, 26, 1.1, 'sine', 1.1);
        // Crackle as debris settles.
        for (let i = 0; i < 6; i++)
          this.noiseBurst(out, t + 0.15 + Math.random() * 0.9, 0.03, 5000, 'highpass', 0.25);
        break;
      case 'whoosh':
        this.noiseSweep(out, t, 0.7, 400, 3200, 0.5);
        break;
      case 'riser':
        this.tone(out, t, 80, 640, 1.8, 'sawtooth', 0.12);
        this.noiseSweep(out, t, 1.8, 300, 6000, 0.25);
        break;
      case 'alarm':
        for (let i = 0; i < 2; i++) {
          this.tone(out, t + i * 0.5, 880, 880, 0.22, 'square', 0.12);
          this.tone(out, t + i * 0.5 + 0.25, 660, 660, 0.22, 'square', 0.12);
        }
        break;
      case 'shatter':
        // A hologram breaking: bright glassy pings over a noise burst.
        this.noiseBurst(out, t, 0.5, 2600, 'highpass', 0.6);
        [1760, 2349, 3136].forEach((f, i) =>
          this.tone(out, t + i * 0.04, f, f * 0.98, 0.5, 'triangle', 0.12),
        );
        this.tone(out, t, 90, 40, 0.5, 'sine', 0.7);
        break;
    }
  }

  /** A per-sound bus: panner → master, plus a send to the reverb. */
  private bus(pan: number, send: number): AudioNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    let node: AudioNode = input;
    if (pan && 'createStereoPanner' in ctx) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      input.connect(p);
      node = p;
    }
    node.connect(this.master!);
    if (send && this.reverb) node.connect(this.reverb);
    return input;
  }

  private envGain(out: AudioNode, t: number, dur: number, peak: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
  }

  private tone(
    out: AudioNode,
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
    o.connect(this.envGain(out, t, dur, peak));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(
    out: AudioNode,
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
    f.connect(this.envGain(out, t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private noiseSweep(
    out: AudioNode,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    peak: number,
  ): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    f.frequency.exponentialRampToValueAtTime(f0, t + dur);
    src.connect(f);
    f.connect(this.envGain(out, t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** A low-passed roar that darkens as it fades (explosions). */
  private noiseSweepDown(
    out: AudioNode,
    t: number,
    dur: number,
    f0: number,
    f1: number,
    peak: number,
  ): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f);
    f.connect(this.envGain(out, t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}

/** Stereo impulse response: early reflections and an exponential tail. */
function hallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const u = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - u, 3.2) * (u < 0.02 ? 0.4 : 1);
    }
  }
  return buf;
}

/**
 * Connect the director's sound and music cues to an SfxEngine (venue screen
 * and offline demo use the same wiring). Returns an unsubscribe function.
 */
export function connectDirectorAudio(director: ArenaDirector, sfx: SfxEngine): () => void {
  sfx.setMusic(director.music);
  const offs = [
    director.onSound((name, teamId) => sfx.play(name as SfxName, { pan: panFor(teamId) })),
    director.onMusic((cue) => sfx.setMusic(cue)),
  ];
  return () => offs.forEach((o) => o());
}
