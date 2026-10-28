import type { ClashRecord, RegionId, TeamId } from '@sats-wars/shared';
import { TEAM_META } from '@sats-wars/shared';

/** Animation clip names shared by procedural robots and GLB assets. */
export const CLIP_NAMES = [
  'Idle',
  'Intro',
  'AttackLight',
  'AttackHeavy',
  'Guard',
  'HitReact',
  'Special',
  'Victory',
  'Defeat',
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/** Seconds; looping clips ignore duration. */
export const CLIP_DURATION: Record<ClipName, number> = {
  Idle: 2.4,
  Intro: 2.2,
  AttackLight: 1.0,
  AttackHeavy: 1.1,
  Guard: 0.8,
  HitReact: 0.7,
  Special: 3.0,
  Victory: 2.0,
  Defeat: 1.4,
};
export const LOOPING_CLIPS: ReadonlySet<ClipName> = new Set(['Idle', 'Victory']);

export type CameraPresetName =
  | 'intro'
  | 'overview'
  | 'clash'
  | 'specialRAIJIN'
  | 'specialFUJIN'
  | 'final'
  | 'victoryRAIJIN'
  | 'victoryFUJIN';

export type EffectKind =
  | 'sparks'
  | 'shockwave'
  | 'lightning'
  | 'wind'
  | 'regionPulse'
  | 'shield'
  | 'chargeAura'
  | 'specialStorm';

export interface DirectorEffect {
  id: number;
  kind: EffectKind;
  teamId: TeamId | null;
  regionId: RegionId | null;
  /** Director time (s) at which the effect starts. */
  at: number;
  intensity: number;
}

export interface Banner {
  kind: 'special' | 'clash' | 'ko' | 'victory' | 'draw';
  teamId: TeamId | null;
  textJa: string;
  textEn: string;
  until: number;
}

export interface RobotCue {
  clip: ClipName;
  /** Director time the clip started. */
  start: number;
  /** 0 = home position, 1 = fully advanced to the clash point. */
  advance: number;
}

export type Cue =
  | { kind: 'intro' }
  | { kind: 'capture'; regionId: RegionId; teamId: TeamId }
  | { kind: 'contest'; regionId: RegionId; teamId: TeamId }
  | { kind: 'shield'; regionId: RegionId; teamId: TeamId }
  | { kind: 'charge'; teamId: TeamId }
  | { kind: 'clash'; clash: ClashRecord }
  | { kind: 'final' }
  | { kind: 'result'; winner: TeamId | null };

export interface DirectorSettings {
  reducedMotion: boolean;
  /** 0..1 multiplier for camera shake. */
  shakeScale: number;
  /** Replace long special-move cinematics with a short version. */
  shortSpecials: boolean;
}

type Scheduled = { at: number; run: () => void; order: number };

const TEAMS: TeamId[] = ['RAIJIN', 'FUJIN'];

/**
 * Turns server-confirmed game events into a timeline of camera moves, robot
 * clips, effects and HP updates. It never decides outcomes: HP shown is always
 * a value the server already sent. If the cinematic lags or is skipped, the HUD
 * is forced back in sync with `syncHp`.
 */
export class ArenaDirector {
  time = 0;
  robots: Record<TeamId, RobotCue> = {
    RAIJIN: { clip: 'Idle', start: 0, advance: 0 },
    FUJIN: { clip: 'Idle', start: 0, advance: 0 },
  };
  camera: { preset: CameraPresetName; since: number } = { preset: 'overview', since: 0 };
  displayHp: Record<TeamId, number> = { RAIJIN: 100, FUJIN: 100 };
  hpMax = 100;
  shake = 0;
  banner: Banner | null = null;
  busyUntil = 0;
  settings: DirectorSettings = { reducedMotion: false, shakeScale: 1, shortSpecials: false };
  /** Slow-motion factor for rehearsal/preview only (1 = real time). */
  timeScale = 1;

  private queue: Scheduled[] = [];
  private order = 0;
  private effectId = 0;
  private finalLocked = false;
  private effectListeners = new Set<(e: DirectorEffect) => void>();
  private hpListeners = new Set<(hp: Record<TeamId, number>) => void>();
  private bannerListeners = new Set<(b: Banner | null) => void>();
  private soundListeners = new Set<(sound: string, teamId: TeamId | null) => void>();

  onEffect(l: (e: DirectorEffect) => void) {
    this.effectListeners.add(l);
    return (): void => {
      this.effectListeners.delete(l);
    };
  }
  onHp(l: (hp: Record<TeamId, number>) => void) {
    this.hpListeners.add(l);
    return (): void => {
      this.hpListeners.delete(l);
    };
  }
  onBanner(l: (b: Banner | null) => void) {
    this.bannerListeners.add(l);
    return (): void => {
      this.bannerListeners.delete(l);
    };
  }
  /** Audio hooks: 'hit', 'thunder', 'wind', 'capture', 'shield', 'charge', 'special', 'victory', 'ko'. */
  onSound(l: (sound: string, teamId: TeamId | null) => void) {
    this.soundListeners.add(l);
    return (): void => {
      this.soundListeners.delete(l);
    };
  }

  /** Snap HUD HP to authoritative values (snapshot load, resync, lagging cinematic). */
  syncHp(hp: Record<TeamId, number>, hpMax?: number): void {
    if (hpMax) this.hpMax = hpMax;
    this.displayHp = { ...hp };
    for (const l of this.hpListeners) l(this.displayHp);
  }

  /** True while a cinematic (clash/special/result) is playing or queued. */
  get busy(): boolean {
    return this.busyUntil > this.time;
  }

  play(cue: Cue): void {
    switch (cue.kind) {
      case 'intro':
        return this.playIntro();
      case 'capture':
        this.emitEffect('regionPulse', cue.teamId, cue.regionId, this.time, 1);
        this.sound('capture', cue.teamId);
        return;
      case 'contest':
        this.emitEffect('regionPulse', cue.teamId, cue.regionId, this.time, 0.6);
        return;
      case 'shield':
        this.emitEffect('shield', cue.teamId, cue.regionId, this.time, 1);
        this.sound('shield', cue.teamId);
        return;
      case 'charge':
        this.emitEffect('chargeAura', cue.teamId, null, this.time, 1);
        this.sound('charge', cue.teamId);
        return;
      case 'clash':
        return this.playClash(cue.clash);
      case 'final':
        if (!this.busy) this.setCamera('final');
        this.finalLocked = true;
        return;
      case 'result':
        return this.playResult(cue.winner);
    }
  }

  update(dt: number): void {
    this.time += Math.max(0, Math.min(dt, 0.25)) * this.timeScale;
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.queue.length && this.queue[0]!.at <= this.time) this.queue.shift()!.run();
    const decay = this.settings.reducedMotion ? 10 : 3.2;
    this.shake = Math.max(0, this.shake - dt * decay);
    if (this.banner && this.banner.until <= this.time) this.setBanner(null);
    for (const t of TEAMS) {
      const r = this.robots[t];
      if (
        !LOOPING_CLIPS.has(r.clip) &&
        r.clip !== 'Defeat' &&
        this.time - r.start > CLIP_DURATION[r.clip] + 0.05
      ) {
        this.setClip(t, 'Idle', r.advance);
      }
    }
  }

  /** Remaining scheduled items (for tests). */
  get pending(): number {
    return this.queue.length;
  }

  // ---- sequences --------------------------------------------------------

  private at(time: number, run: () => void): void {
    this.queue.push({ at: time, run, order: this.order++ });
  }

  private startTime(): number {
    // Never queue cinematics too far behind real time; skip ahead instead.
    return Math.max(this.time, Math.min(this.busyUntil, this.time + 4));
  }

  private playIntro(): void {
    const s = this.startTime();
    this.at(s, () => {
      this.setCamera('intro');
      for (const t of TEAMS) this.setClip(t, 'Intro', 0);
      this.sound('intro', null);
    });
    this.at(s + 0.9, () => {
      for (const t of TEAMS) this.emitEffect('shockwave', t, null, this.time, 0.8);
      this.addShake(0.5);
    });
    this.at(s + 2.6, () => this.setCamera(this.finalLocked ? 'final' : 'overview'));
    this.busyUntil = s + 2.6;
  }

  private playClash(clash: ClashRecord): void {
    let s = this.startTime();
    const specials = TEAMS.filter((t) => clash.outcome[t].special);
    const short = this.settings.shortSpecials || this.settings.reducedMotion;
    if (specials.length) {
      const dur = short ? 1.4 : 3.2;
      const s0 = s;
      this.at(s0, () => {
        this.setCamera(
          specials.length === 2
            ? 'clash'
            : specials[0] === 'RAIJIN'
              ? 'specialRAIJIN'
              : 'specialFUJIN',
        );
        for (const t of specials) {
          this.setClip(t, 'Special', 0);
          this.emitEffect('specialStorm', t, null, this.time, short ? 0.5 : 1);
          this.sound('special', t);
        }
        const t0 = specials[0]!;
        const both = specials.length === 2;
        this.setBanner({
          kind: 'special',
          teamId: both ? null : t0,
          textJa: both
            ? `${TEAM_META.RAIJIN.specialJa} × ${TEAM_META.FUJIN.specialJa}`
            : `${TEAM_META[t0].nameJa}「${TEAM_META[t0].specialJa}」`,
          textEn: both
            ? `${TEAM_META.RAIJIN.specialEn} × ${TEAM_META.FUJIN.specialEn}`
            : `${TEAM_META[t0].nameEn}: ${TEAM_META[t0].specialEn}`,
          until: s0 + dur + 2.2,
        });
      });
      s += dur;
    }
    const hitAt = s + 1.0;
    this.at(s, () => {
      this.setCamera('clash');
      this.setClip('RAIJIN', 'AttackHeavy', 1);
      this.setClip('FUJIN', 'AttackLight', 1);
      if (!specials.length) {
        this.setBanner({
          kind: 'clash',
          teamId: null,
          textJa: `第${clash.clashIndex + 1}激突！`,
          textEn: `CLASH ${clash.clashIndex + 1}!`,
          until: s + 2.2,
        });
      }
    });
    this.at(hitAt, () => {
      this.emitEffect('sparks', null, null, this.time, 1);
      this.emitEffect('shockwave', null, null, this.time, 1);
      // Each team's signature effect lands on the opponent.
      this.emitEffect(
        'lightning',
        'RAIJIN',
        null,
        this.time,
        clash.outcome.RAIJIN.special ? 1.5 : 1,
      );
      this.emitEffect('wind', 'FUJIN', null, this.time, clash.outcome.FUJIN.special ? 1.5 : 1);
      this.addShake(0.6 + (specials.length ? 0.4 : 0));
      this.sound('hit', null);
      this.sound('thunder', 'RAIJIN');
      this.sound('wind', 'FUJIN');
      for (const t of TEAMS) this.setClip(t, 'HitReact', 0.6);
      this.displayHp = { RAIJIN: clash.outcome.RAIJIN.hpAfter, FUJIN: clash.outcome.FUJIN.hpAfter };
      for (const l of this.hpListeners) l(this.displayHp);
    });
    let end = hitAt + 1.8;
    if (clash.ko.length) {
      this.at(hitAt + 0.8, () => {
        for (const t of clash.ko) this.setClip(t, 'Defeat', 0);
        this.sound('ko', null);
        this.setBanner({
          kind: 'ko',
          teamId: null,
          textJa: clash.ko.length === 2 ? '相打ち KO！' : `${TEAM_META[clash.ko[0]!].nameJa} KO！`,
          textEn: clash.ko.length === 2 ? 'DOUBLE KO!' : `${TEAM_META[clash.ko[0]!].nameEn} KO!`,
          until: hitAt + 3.5,
        });
      });
      end = hitAt + 2.2;
    }
    this.at(end, () => {
      for (const t of TEAMS) if (this.robots[t].clip !== 'Defeat') this.setClip(t, 'Idle', 0);
      this.setCamera(this.finalLocked ? 'final' : 'overview');
    });
    this.busyUntil = end + 0.2;
  }

  private playResult(winner: TeamId | null): void {
    const s = this.startTime();
    this.finalLocked = true;
    this.at(s, () => {
      if (winner) {
        this.setCamera(winner === 'RAIJIN' ? 'victoryRAIJIN' : 'victoryFUJIN');
        this.setClip(winner, 'Victory', 0);
        const loser: TeamId = winner === 'RAIJIN' ? 'FUJIN' : 'RAIJIN';
        this.setClip(loser, 'Defeat', 0);
        this.emitEffect('specialStorm', winner, null, this.time, 0.7);
        this.sound('victory', winner);
        this.setBanner({
          kind: 'victory',
          teamId: winner,
          textJa: `${TEAM_META[winner].nameJa}の勝利！`,
          textEn: `${TEAM_META[winner].nameEn} WINS!`,
          until: s + 30,
        });
      } else {
        this.setCamera('final');
        for (const t of TEAMS) this.setClip(t, 'Guard', 0);
        this.setBanner({
          kind: 'draw',
          teamId: null,
          textJa: '引き分け！',
          textEn: 'DRAW!',
          until: s + 30,
        });
      }
    });
    this.busyUntil = s + 1;
  }

  // ---- primitives -------------------------------------------------------

  private setClip(teamId: TeamId, clip: ClipName, advance: number): void {
    this.robots[teamId] = { clip, start: this.time, advance };
  }

  private setCamera(preset: CameraPresetName): void {
    if (this.camera.preset !== preset) this.camera = { preset, since: this.time };
  }

  private addShake(amount: number): void {
    if (this.settings.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount * this.settings.shakeScale);
  }

  private setBanner(b: Banner | null): void {
    this.banner = b;
    for (const l of this.bannerListeners) l(b);
  }

  private sound(name: string, teamId: TeamId | null): void {
    for (const l of this.soundListeners) l(name, teamId);
  }

  private emitEffect(
    kind: EffectKind,
    teamId: TeamId | null,
    regionId: RegionId | null,
    at: number,
    intensity: number,
  ): void {
    const scaled = this.settings.reducedMotion ? intensity * 0.5 : intensity;
    const e: DirectorEffect = {
      id: ++this.effectId,
      kind,
      teamId,
      regionId,
      at,
      intensity: scaled,
    };
    for (const l of this.effectListeners) l(e);
  }
}
