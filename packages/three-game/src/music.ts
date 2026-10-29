import type { MusicCue } from './director';

/**
 * Procedural score (Web Audio, no files): a four-bar loop in D minor whose
 * layers follow the raid. calm = pad only (lobby); wave = pad, bass, light
 * kick; battle = + snare and eighth hats; boss = taiko-style drums (Raijin's
 * thunder drums), sixteenth hats and an arpeggio; victory = a bright major
 * pad; defeat = a low pad. The cue changes on the next bar.
 */

export const MUSIC_BPM = 116;
export const STEPS_PER_BAR = 16;
/** Seconds per sixteenth note. */
export const STEP_SECONDS = 60 / MUSIC_BPM / 4;

export type Voice = 'kick' | 'snare' | 'hat' | 'taiko' | 'bass' | 'pad' | 'lead';

export interface NoteEvent {
  step: number;
  voice: Voice;
  /** Hz (pitched voices). */
  freq?: number;
  /** Length in steps. */
  steps: number;
  /** 0..1 */
  vel: number;
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Dm – B♭ – F – C (i–VI–III–VII); roots in the bass register, chords for the pad.
const ROOTS = [38, 34, 41, 36];
const CHORDS = [
  [62, 65, 69],
  [58, 62, 65],
  [60, 65, 69],
  [60, 64, 67],
];
// Victory: D major lift (D – G – A – D).
const BRIGHT_ROOTS = [38, 43, 45, 38];
const BRIGHT_CHORDS = [
  [62, 66, 69],
  [62, 67, 71],
  [64, 69, 73],
  [62, 66, 69],
];

/** The notes of one bar (`bar` counts from 0; the progression repeats every 4). */
export function musicBar(cue: MusicCue, bar: number): NoteEvent[] {
  const i = ((bar % 4) + 4) % 4;
  const bright = cue === 'victory';
  const root = (bright ? BRIGHT_ROOTS : ROOTS)[i]!;
  const chord = (bright ? BRIGHT_CHORDS : CHORDS)[i]!;
  const out: NoteEvent[] = [];
  const padVel = cue === 'calm' || cue === 'defeat' ? 0.22 : 0.16;
  const padShift = cue === 'defeat' ? -12 : 0;
  for (const n of chord)
    out.push({ step: 0, voice: 'pad', freq: midi(n + padShift), steps: 16, vel: padVel });
  if (cue === 'calm' || cue === 'defeat' || cue === 'victory') {
    out.push({ step: 0, voice: 'bass', freq: midi(root), steps: 12, vel: 0.25 });
    return out;
  }
  // Bass: eighths (wave), with octave pops (battle), driving sixteenths (boss).
  const bassEvery = cue === 'boss' ? 1 : 2;
  for (let s = 0; s < 16; s += bassEvery) {
    const up = cue !== 'wave' && s % 8 === 6;
    out.push({
      step: s,
      voice: 'bass',
      freq: midi(root + (up ? 12 : 0)),
      steps: bassEvery,
      vel: s % 4 === 0 ? 0.42 : 0.3,
    });
  }
  // Kick on the beat; boss adds pushes before beats 3 and 1.
  const kicks = cue === 'wave' ? [0, 8] : cue === 'battle' ? [0, 6, 8] : [0, 4, 8, 12, 14];
  for (const s of kicks)
    out.push({ step: s, voice: 'kick', steps: 1, vel: s % 8 === 0 ? 0.9 : 0.7 });
  if (cue !== 'wave')
    for (const s of [4, 12]) out.push({ step: s, voice: 'snare', steps: 1, vel: 0.6 });
  const hatEvery = cue === 'boss' ? 1 : cue === 'battle' ? 2 : 4;
  for (let s = cue === 'wave' ? 2 : 0; s < 16; s += hatEvery)
    out.push({ step: s, voice: 'hat', steps: 1, vel: s % 2 === 0 ? 0.32 : 0.18 });
  if (cue === 'boss') {
    for (const s of [0, 3, 6, 10]) out.push({ step: s, voice: 'taiko', steps: 2, vel: 0.85 });
    // Arpeggio over the chord, an octave up.
    for (let s = 0; s < 16; s += 2)
      out.push({
        step: s,
        voice: 'lead',
        freq: midi(chord[(s / 2) % 3]! + 12),
        steps: 2,
        vel: 0.2,
      });
  }
  return out;
}

/**
 * Plays musicBar() on a Web Audio graph with a look-ahead scheduler. Output
 * goes to `destination` (the SFX master, so mute and volume apply).
 */
export class MusicPlayer {
  private cue: MusicCue | null = null;
  private next: MusicCue | null = null;
  private bar = 0;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly out: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
    level = 0.32,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.out.connect(destination);
  }

  /** Switch to `cue` on the next bar (starts at once if stopped). */
  play(cue: MusicCue): void {
    if (!this.timer) {
      this.cue = cue;
      this.bar = 0;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.schedule(), 25);
      return;
    }
    this.next = cue;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cue = this.next = null;
  }

  setLevel(level: number): void {
    this.out.gain.setTargetAtTime(level, this.ctx.currentTime, 0.2);
  }

  private schedule(): void {
    if (!this.cue) return;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      if (this.step === 0 && this.next) {
        this.cue = this.next;
        this.next = null;
      }
      for (const n of musicBar(this.cue, this.bar))
        if (n.step === this.step) this.voice(n, this.nextTime);
      this.nextTime += STEP_SECONDS;
      this.step = (this.step + 1) % STEPS_PER_BAR;
      if (this.step === 0) this.bar++;
    }
  }

  private env(t: number, attack: number, dur: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out);
    return g;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, to: AudioNode) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f);
    f.connect(this.env(t, 0.003, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private voice(n: NoteEvent, t: number): void {
    const len = n.steps * STEP_SECONDS;
    switch (n.voice) {
      case 'kick':
        this.osc('sine', 140, 42, t, 0.28, this.env(t, 0.004, 0.3, n.vel));
        return;
      case 'snare':
        this.noiseHit(t, 0.16, 'bandpass', 1800, n.vel * 0.7);
        this.osc('triangle', 190, 150, t, 0.1, this.env(t, 0.003, 0.12, n.vel * 0.3));
        return;
      case 'hat':
        this.noiseHit(t, 0.045, 'highpass', 7200, n.vel * 0.5);
        return;
      case 'taiko':
        // Low drum body plus a felt-like thump.
        this.osc('sine', 110, 52, t, 0.45, this.env(t, 0.004, 0.5, n.vel));
        this.noiseHit(t, 0.12, 'lowpass', 420, n.vel * 0.5);
        return;
      case 'bass': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420;
        f.connect(this.env(t, 0.01, len * 0.95, n.vel));
        this.osc('sawtooth', n.freq!, n.freq!, t, len, f);
        return;
      }
      case 'pad': {
        // Two detuned saws through a soft filter, slow in and out.
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1100;
        f.connect(this.env(t, 0.5, len, n.vel * 0.35));
        this.osc('sawtooth', n.freq! * 0.997, n.freq! * 0.997, t, len, f);
        this.osc('sawtooth', n.freq! * 1.003, n.freq! * 1.003, t, len, f);
        return;
      }
      case 'lead': {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 2400;
        f.connect(this.env(t, 0.005, len * 0.9, n.vel));
        this.osc('square', n.freq!, n.freq!, t, len, f);
        return;
      }
    }
  }
}
