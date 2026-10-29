import type {
  CityHit,
  EnemyKind,
  RaidPhase,
  RaidResult,
  RegionId,
  Role,
  TaskEffect,
  TeamId,
} from '@sats-wars/shared';
import { CITY_INFO, ENEMY_LABELS, PHASE_LABELS, ROLE_LABELS } from '@sats-wars/shared';

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
  'Walk',
  'Dash',
  'Hover',
  'ShieldDeploy',
  'Charge',
  'Boarding',
  'HitHeavy',
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

/** Spec D1/D2 names that are the same motion as one of ours (GLBs carry both names). */
export const SPEC_CLIP_ALIASES = {
  Punch: 'AttackLight',
  HeavyAttack: 'AttackHeavy',
  HitLight: 'HitReact',
} as const satisfies Record<string, ClipName>;

/** Required animations per robot (spec D1 RAIJIN / D2 FUJIN). */
export const REQUIRED_CLIPS = {
  RAIJIN: [
    'Idle',
    'Walk',
    'Dash',
    'Punch',
    'HeavyAttack',
    'Guard',
    'HitLight',
    'HitHeavy',
    'Charge',
    'Special',
    'Victory',
    'Defeat',
    'Boarding',
  ],
  FUJIN: [
    'Idle',
    'Walk',
    'Dash',
    'Hover',
    'Guard',
    'ShieldDeploy',
    'HitLight',
    'HitHeavy',
    'Charge',
    'Special',
    'Victory',
    'Defeat',
    'Boarding',
  ],
} as const;

/** Our clip for a spec name (aliases resolved). */
export function resolveClip(name: string): ClipName | null {
  if ((CLIP_NAMES as readonly string[]).includes(name)) return name as ClipName;
  return (SPEC_CLIP_ALIASES as Record<string, ClipName>)[name] ?? null;
}

/** Seconds; looping clips ignore duration. Attacks are short because many pilots act at once. */
export const CLIP_DURATION: Record<ClipName, number> = {
  Idle: 2.4,
  Intro: 2.2,
  AttackLight: 0.45,
  AttackHeavy: 0.6,
  Guard: 0.8,
  HitReact: 0.5,
  Special: 1.6,
  Victory: 2.0,
  Defeat: 1.4,
  Walk: 1.2,
  Dash: 0.6,
  Hover: 1.6,
  ShieldDeploy: 0.9,
  Charge: 1.2,
  Boarding: 2.4,
  HitHeavy: 0.9,
};
export const LOOPING_CLIPS: ReadonlySet<ClipName> = new Set(['Idle', 'Victory']);

/**
 * Seconds into a clip at which the blow lands (the "hit marker"). The bolt, the
 * crack, the sound and the hit-stop are timed to it so they land together.
 * Artist GLBs deliver the same markers (docs/art/ART_BRIEF.md).
 */
export const CLIP_HIT_TIME: Partial<Record<ClipName, number>> = {
  AttackLight: 0.08,
  AttackHeavy: 0.33,
  Special: 1.04,
  HitReact: 0,
  HitHeavy: 0,
};

/**
 * Camera sequences (spec D6): intro, overview (= WideBattle), boss, mapFocus
 * (= ThreatFocus), cityDefense, gunnerImpact, routerPulse, repairRecovery,
 * cockpit, specialCharge, special (= SpecialHit), final (= Victory/Defeat).
 */
export type CameraPresetName =
  | 'intro'
  | 'overview'
  | 'boss'
  | 'mapFocus'
  | 'cityDefense'
  | 'gunnerImpact'
  | 'routerPulse'
  | 'repairRecovery'
  | 'cockpit'
  | 'specialCharge'
  | 'special'
  | 'final'
  | 'hangar'
  | 'hangarRaijin'
  | 'hangarFujin';

/** What an effect points at; the scene resolves it to a world position. */
export type FxTarget =
  | { kind: 'city'; id: RegionId }
  | { kind: 'enemy'; id: number }
  | { kind: 'robot'; id: TeamId }
  | { kind: 'reserve' };

export type EffectKind =
  | 'impact'
  | 'sparks'
  | 'shockwave'
  | 'lightning'
  | 'wind'
  | 'shield'
  | 'energy'
  | 'repair'
  | 'beam'
  | 'cityBlast'
  | 'explosion'
  | 'chargeAura'
  | 'specialStorm'
  | 'syncPulse';

export interface DirectorEffect {
  id: number;
  kind: EffectKind;
  /** Which robot caused it (colour). */
  teamId: TeamId | null;
  from: FxTarget | null;
  to: FxTarget | null;
  /** Director time (s) at which the effect starts. */
  at: number;
  intensity: number;
}

export type BannerTone = 'ally' | 'enemy' | 'neutral' | 'RAIJIN' | 'FUJIN';

export interface Banner {
  kind:
    | 'opening'
    | 'phase'
    | 'boss'
    | 'special'
    | 'specialResult'
    | 'cityLost'
    | 'cityRebuilt'
    | 'defeated'
    | 'victory'
    | 'defeat';
  tone: BannerTone;
  textJa: string;
  textEn: string;
  subJa?: string;
  subEn?: string;
  until: number;
}

export interface RobotCue {
  clip: ClipName;
  /** Director time the clip started. */
  start: number;
  /** 0 = home position, 1 = fully advanced. */
  advance: number;
}

export type Cue =
  | { kind: 'raidStart' }
  | { kind: 'phase'; phase: RaidPhase }
  | { kind: 'boarded'; callsign: string; robot: TeamId; pilotId?: string }
  | { kind: 'telegraph'; enemyId: number; enemyKind: EnemyKind; targets: RegionId[] }
  | {
      kind: 'task';
      role: Role;
      robot: TeamId;
      success: number;
      effect: TaskEffect | null;
      callsign: string;
      assist: boolean;
      pilotId?: string;
    }
  | {
      kind: 'attack';
      enemyId: number;
      enemyKind: EnemyKind;
      hits: CityHit[];
      robotHit: TeamId | null;
      jam: boolean;
    }
  | { kind: 'enemySpawned'; enemyId: number; enemyKind: EnemyKind }
  | { kind: 'enemyDefeated'; enemyId: number; enemyKind: EnemyKind; callsign: string | null }
  | { kind: 'cityDestroyed'; cityId: RegionId }
  | { kind: 'cityRebuilt'; cityId: RegionId; callsign: string }
  | { kind: 'specialOpen' }
  | { kind: 'specialProgress'; role: Role; callsign: string }
  | {
      kind: 'specialResolved';
      outcome: 'ACTIVATED' | 'FALLBACK' | 'FAILED';
      damage: number;
      bossId: number | null;
      cityHits: CityHit[];
    }
  | { kind: 'raidEnded'; result: RaidResult }
  | { kind: 'cheer' };

/**
 * Authored camera moves for the cinematics (poses in CAMERA_SHOTS, layout.ts).
 * A shot eases from its first pose to its second and then holds.
 */
export type ShotName =
  | 'specialRise'
  | 'specialLaunch'
  | 'bossImpact'
  | 'heroes'
  | 'bossReveal'
  | 'bossGlare'
  | 'bossDown'
  | 'cityFall';

/** Background music intensity (procedural score, music.ts). */
export type MusicCue = 'calm' | 'wave' | 'battle' | 'boss' | 'victory' | 'defeat';

export interface DirectorSettings {
  reducedMotion: boolean;
  /** 0..1 multiplier for camera shake. */
  shakeScale: number;
  /** Always use the short special cut. */
  shortSpecials: boolean;
}

type Scheduled = { at: number; run: () => void; order: number };

const GODS: TeamId[] = ['RAIJIN', 'FUJIN'];
const city = (id: RegionId) => CITY_INFO[id];

/**
 * Turns server-confirmed raid events into camera moves, robot clips, effects
 * and sounds. It never decides anything: every number shown comes from the
 * server. Dozens of pilots act per minute, so per-action reactions are short
 * and the heavy effects/sounds are throttled (no strobing, ≤2 Hz flashes).
 */
export class ArenaDirector {
  time = 0;
  robots: Record<TeamId, RobotCue> = {
    RAIJIN: { clip: 'Idle', start: 0, advance: 0 },
    FUJIN: { clip: 'Idle', start: 0, advance: 0 },
  };
  /**
   * `preset` is where the camera rests; a `shot` (cinematic move) overrides it
   * until it is cleared. `anchor` makes the shot relative to a target (a city).
   */
  camera: {
    preset: CameraPresetName;
    since: number;
    shot: ShotName | null;
    anchor: FxTarget | null;
  } = { preset: 'overview', since: 0, shot: null, anchor: null };
  shake = 0;
  /**
   * Presentation speed this frame: the rehearsal `timeScale` times any hit-stop
   * or slow motion. Only the show slows down; the raid clock is the server's.
   */
  scale = 1;
  /** Unscaled seconds since start (hit-stops and flashes are timed in real time). */
  realTime = 0;
  /** Screen accents for the grade pass, 0..1. Always 0 with reduced motion. */
  flash = 0;
  flashTone: 'ally' | 'enemy' = 'ally';
  aberration = 0;
  /** Cinema bars during the big cinematics. */
  letterbox = false;
  music: MusicCue = 'calm';
  banner: Banner | null = null;
  /** Until this time a cinematic owns the camera and robot clips. */
  busyUntil = 0;
  settings: DirectorSettings = { reducedMotion: false, shakeScale: 1, shortSpecials: false };
  /** Slow-motion factor for rehearsal/preview only (1 = real time). */
  timeScale = 1;
  /** Cockpit seats: when each pilot boarded (lamp lights) and last succeeded (pulse). */
  boardedAt = new Map<string, number>();
  pulsedAt = new Map<string, number>();

  private warps: Array<{ until: number; scale: number }> = [];
  private lastHitStop = -100;
  private lastFlash = -100;
  private queue: Scheduled[] = [];
  private order = 0;
  private effectId = 0;
  private lastFx: Record<string, number> = {};
  private cheerSide = 0;
  private cheerLevel = 0;
  private cheerAt = 0;

  /** 0.3 (a lone cheer) … 1 (a roaring room), from the recent cheer rate. */
  cheerIntensity(): number {
    const level = this.cheerLevel * Math.exp(-(this.time - this.cheerAt) / 5);
    return Math.min(1, 0.3 + level / 15);
  }
  private effectListeners = new Set<(e: DirectorEffect) => void>();
  private bannerListeners = new Set<(b: Banner | null) => void>();
  private soundListeners = new Set<(sound: string, teamId: TeamId | null) => void>();
  private letterboxListeners = new Set<(on: boolean) => void>();
  private musicListeners = new Set<(cue: MusicCue) => void>();

  onEffect(l: (e: DirectorEffect) => void) {
    this.effectListeners.add(l);
    return (): void => {
      this.effectListeners.delete(l);
    };
  }
  onBanner(l: (b: Banner | null) => void) {
    this.bannerListeners.add(l);
    return (): void => {
      this.bannerListeners.delete(l);
    };
  }
  /**
   * Audio hooks: 'hit', 'thunder', 'wind', 'shield', 'capture', 'charge', 'special', 'victory',
   * 'ko', 'intro', 'tick', 'impact', 'explosion', 'whoosh', 'riser', 'alarm', 'shatter'.
   */
  onSound(l: (sound: string, teamId: TeamId | null) => void) {
    this.soundListeners.add(l);
    return (): void => {
      this.soundListeners.delete(l);
    };
  }

  onLetterbox(l: (on: boolean) => void) {
    this.letterboxListeners.add(l);
    return (): void => {
      this.letterboxListeners.delete(l);
    };
  }
  onMusic(l: (cue: MusicCue) => void) {
    this.musicListeners.add(l);
    return (): void => {
      this.musicListeners.delete(l);
    };
  }

  /** True while a cinematic is playing or queued. */
  get busy(): boolean {
    return this.busyUntil > this.time;
  }

  play(cue: Cue): void {
    switch (cue.kind) {
      case 'raidStart':
        return this.playRaidStart();
      case 'phase':
        return this.playPhase(cue.phase);
      case 'boarded':
        if (cue.pilotId) this.boardedAt.set(cue.pilotId, this.time);
        if (this.throttle('boarded', 0.6))
          this.emitEffect('chargeAura', cue.robot, null, { kind: 'robot', id: cue.robot }, 0.4);
        // The robot kneels to take its new pilot aboard (not more than every 8 s).
        if (
          !this.busy &&
          this.robots[cue.robot].clip === 'Idle' &&
          this.throttle(`board-${cue.robot}`, 8)
        )
          this.setClip(cue.robot, 'Boarding', 0);
        // New pilots light their seats: a short look inside, at most every 25 s.
        if (this.throttle('cockpit-board', 25)) this.beat('cockpit', 2.4);
        return;
      case 'telegraph':
        if (this.throttle('sfx-alarm', 1.5)) this.sound('tick', null);
        if (cue.enemyKind !== 'BOSS' && cue.targets.length) this.beat('mapFocus', 2);
        return;
      case 'task':
        return this.playTask(cue);
      case 'attack':
        return this.playAttack(cue);
      case 'enemySpawned':
        if (cue.enemyKind === 'BOSS') return this.playBossEntrance();
        this.emitEffect('shockwave', null, null, { kind: 'enemy', id: cue.enemyId }, 0.5);
        return;
      case 'enemyDefeated':
        return this.playDefeated(cue);
      case 'cityDestroyed':
        this.emitEffect('cityBlast', null, null, { kind: 'city', id: cue.cityId }, 1.2);
        this.sound('shatter', null);
        this.sound('alarm', null);
        this.addShake(0.5);
        this.hitStop(0.1);
        this.accent('enemy', 0.7);
        this.cityFallShot(cue.cityId);
        this.setBanner({
          kind: 'cityLost',
          tone: 'enemy',
          textJa: `${city(cue.cityId).cityJa} 機能停止！`,
          textEn: `${city(cue.cityId).cityEn} is down!`,
          subJa: `${city(cue.cityId).facilityJa}が止まった ・ 整備席で復旧できる`,
          subEn: `${city(cue.cityId).facilityEn} lost — engineers can rebuild it`,
          until: this.time + 2.6,
        });
        return;
      case 'cityRebuilt':
        this.emitEffect('repair', 'FUJIN', null, { kind: 'city', id: cue.cityId }, 1.2);
        this.sound('capture', null);
        this.setBanner({
          kind: 'cityRebuilt',
          tone: 'ally',
          textJa: `${city(cue.cityId).cityJa} 復旧！`,
          textEn: `${city(cue.cityId).cityEn} restored!`,
          subJa: `整備：${cue.callsign}`,
          subEn: `by ${cue.callsign}`,
          until: this.time + 2.4,
        });
        return;
      case 'specialOpen':
        return this.playSpecialOpen();
      case 'specialProgress':
        this.emitEffect('syncPulse', null, null, null, 1);
        this.sound('charge', null);
        return;
      case 'specialResolved':
        return this.playSpecial(cue);
      case 'raidEnded':
        return this.playEnded(cue.result);
      case 'cheer': {
        // Louder rooms glow brighter: the aura follows the cheer rate (decaying
        // count over ~5 s), still emitted at most twice a second.
        const k = Math.exp(-(this.time - this.cheerAt) / 5);
        this.cheerLevel = this.cheerLevel * k + 1;
        this.cheerAt = this.time;
        if (this.throttle('cheer', 0.5)) {
          this.cheerSide = 1 - this.cheerSide;
          this.emitEffect(
            'chargeAura',
            GODS[this.cheerSide]!,
            null,
            { kind: 'robot', id: GODS[this.cheerSide]! },
            this.cheerIntensity(),
          );
          if (this.cheerLevel >= 12 && this.throttle('cheer-wave', 4))
            this.emitEffect('syncPulse', null, null, null, 0.6);
        }
        return;
      }
    }
  }

  update(dt: number): void {
    const real = Math.max(0, Math.min(dt, 0.25));
    this.realTime += real;
    if (this.warps.length) this.warps = this.warps.filter((w) => w.until > this.realTime);
    let warp = 1;
    for (const w of this.warps) warp = Math.min(warp, w.scale);
    this.scale = this.timeScale * warp;
    this.time += real * this.scale;
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.queue.length && this.queue[0]!.at <= this.time) this.queue.shift()!.run();
    const decay = this.settings.reducedMotion ? 10 : 3.2;
    this.shake = Math.max(0, this.shake - dt * decay);
    this.flash = Math.max(0, this.flash - real * 3.5);
    this.aberration = Math.max(0, this.aberration - real * 2.5);
    if (this.banner && this.banner.until <= this.time) this.setBanner(null);
    for (const t of GODS) {
      const r = this.robots[t];
      if (
        !LOOPING_CLIPS.has(r.clip) &&
        r.clip !== 'Defeat' &&
        this.time - r.start > CLIP_DURATION[r.clip] + 0.05
      )
        this.setClip(t, 'Idle', 0);
    }
  }

  /** Remaining scheduled items (for tests). */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * The hangar before launch (pilot screens, spec 2.6): a low 3/4 look at the
   * robot whose station is being chosen, or at both. Never over a cinematic;
   * the raid start takes the camera back to the arena.
   */
  hangarView(focus: TeamId | 'BOTH' | null): void {
    if (this.busy) return;
    this.setCamera(
      focus === null
        ? 'overview'
        : focus === 'BOTH'
          ? 'hangar'
          : focus === 'RAIJIN'
            ? 'hangarRaijin'
            : 'hangarFujin',
    );
  }

  /** Back to a calm stance (new raid loaded, preview reset). */
  reset(): void {
    this.queue = [];
    this.warps = [];
    this.boardedAt.clear();
    this.pulsedAt.clear();
    this.busyUntil = this.time;
    this.flash = this.aberration = 0;
    for (const t of GODS) this.setClip(t, 'Idle', 0);
    this.setCamera('overview');
    this.setBanner(null);
    this.setLetterbox(false);
    this.setMusic('calm');
  }

  // ---- sequences --------------------------------------------------------

  private at(time: number, run: () => void): void {
    this.queue.push({ at: time, run, order: this.order++ });
  }

  private startTime(): number {
    // Never queue cinematics too far behind real time; skip ahead instead.
    return Math.max(this.time, Math.min(this.busyUntil, this.time + 3));
  }

  private playRaidStart(): void {
    const s = this.startTime();
    const short = this.settings.reducedMotion;
    this.at(s, () => {
      if (!short) this.setCamera('intro');
      for (const t of GODS) this.setClip(t, 'Intro', 0);
      this.sound('intro', null);
      this.setMusic('wave');
      this.setBanner({
        kind: 'opening',
        tone: 'ally',
        textJa: '雷神・風神 出撃！',
        textEn: 'RAIJIN & FUJIN, LAUNCH!',
        subJa: '全パイロットに通達。地球を守れ！',
        subEn: 'All pilots: defend the Earth!',
        until: s + 3,
      });
    });
    // Touchdown: the stage takes the weight of both gods.
    this.at(s + 0.9, () => {
      for (const t of GODS) this.emitEffect('shockwave', t, null, { kind: 'robot', id: t }, 0.8);
      this.addShake(0.4);
      this.hitStop(0.08);
      this.accent('ally', 0.45);
      this.sound('impact', null);
    });
    this.at(s + (short ? 1 : 2.6), () => this.setCamera('overview'));
    // Step up to the line after landing.
    if (!short) this.at(s + 2.25, () => GODS.forEach((t) => this.setClip(t, 'Walk', 0)));
    this.busyUntil = s + (short ? 1 : 2.6);
  }

  private playPhase(phase: RaidPhase): void {
    if (
      phase === 'INTRO_TRAINING' ||
      phase === 'SUCCEEDED' ||
      phase === 'FAILED' ||
      phase === 'LOBBY'
    )
      return;
    const s = this.startTime();
    const label = PHASE_LABELS[phase];
    this.at(s, () => {
      this.sound('intro', null);
      this.setMusic(phase === 'FINAL_WAVE' ? 'boss' : phase === 'WAVE_1' ? 'wave' : 'battle');
      this.setBanner({
        kind: 'phase',
        tone: phase === 'FINAL_WAVE' ? 'enemy' : 'neutral',
        textJa: label.ja,
        textEn: label.en.toUpperCase(),
        subJa: phase === 'FINAL_WAVE' ? 'ボスのコアが硬化！ 神雷風陣で突破せよ' : undefined,
        subEn:
          phase === 'FINAL_WAVE' ? 'The core hardens — break it with Shinrai Fujin' : undefined,
        until: s + 2.2,
      });
    });
    this.busyUntil = Math.max(this.busyUntil, s + 0.6);
  }

  private playBossEntrance(): void {
    const s = this.startTime();
    const short = this.settings.reducedMotion || this.settings.shortSpecials;
    this.at(s, () => {
      if (!short) {
        this.setCamera('boss');
        this.setShot('bossReveal');
        this.setLetterbox(true);
      }
      this.sound('special', null);
      this.setMusic('boss');
      this.addShake(0.6);
      this.accent('enemy', 0.5);
      this.setBanner({
        kind: 'boss',
        tone: 'enemy',
        textJa: '虚蝕巨核 NULL CORE 出現！',
        textEn: 'NULL CORE HAS ARRIVED!',
        subJa: '弱点：コア・腕・脚',
        subEn: 'Weak points: core, arm, leg',
        until: s + 3.2,
      });
    });
    this.at(s + (short ? 0.2 : 3), () => {
      this.setCamera('overview');
      this.setLetterbox(false);
    });
    this.busyUntil = s + (short ? 0.2 : 3);
  }

  private playTask(cue: Extract<Cue, { kind: 'task' }>): void {
    if (cue.success <= 0 || !cue.effect) return;
    if (cue.pilotId) this.pulsedAt.set(cue.pilotId, this.time);
    const e = cue.effect;
    const free = (t: TeamId) =>
      !this.busy &&
      (this.robots[t].clip === 'Idle' ||
        this.time - this.robots[t].start > CLIP_DURATION[this.robots[t].clip] * 0.6);
    switch (e.kind) {
      case 'DAMAGE': {
        const to: FxTarget = { kind: 'enemy', id: e.enemyId };
        const clip: ClipName = e.weakpoint === 'CORE' ? 'AttackHeavy' : 'AttackLight';
        const swing = free('RAIJIN');
        if (swing) this.setClip('RAIJIN', clip, 0.25);
        // The bolt leaves Raijin on the strike frame of its swing, so the bolt,
        // the crack, the sound and the hit-stop land together. A robot already
        // mid-swing (a busy crowd) shows the hit at once.
        const land = () => {
          this.emitEffect('impact', 'RAIJIN', null, to, e.defeated ? 1 : 0.6);
          // The core barrier deflects the bolt: a ripple instead of a crack.
          if (e.note === 'BARRIER' && this.throttle('barrier', 0.5))
            this.emitEffect('shockwave', null, null, to, 0.4);
          if (this.throttle('sig-RAIJIN', 0.3)) {
            this.emitEffect('lightning', 'RAIJIN', { kind: 'robot', id: 'RAIJIN' }, to, 0.9);
            this.sound('thunder', 'RAIJIN');
          }
          if (this.throttle('hit-RAIJIN', 0.08)) this.sound('hit', 'RAIJIN');
          if (swing && clip === 'AttackHeavy' && e.note !== 'BARRIER') {
            this.hitStop(0.06);
            if (this.throttle('sfx-impact', 0.5)) this.sound('impact', 'RAIJIN');
          }
        };
        if (swing && CLIP_HIT_TIME[clip]) this.at(this.time + CLIP_HIT_TIME[clip]!, land);
        else land();
        if (e.defeated && e.enemyKind !== 'BOSS') this.beat('gunnerImpact', 2);
        return;
      }
      case 'SHIELD': {
        const to: FxTarget = { kind: 'city', id: e.cityId };
        this.emitEffect('shield', 'FUJIN', null, to, 1);
        if (this.throttle('sig-FUJIN', 0.3))
          this.emitEffect('wind', 'FUJIN', { kind: 'robot', id: 'FUJIN' }, to, 0.9);
        if (this.throttle('sfx-shield', 0.15)) this.sound('shield', 'FUJIN');
        if (free('FUJIN')) this.setClip('FUJIN', 'ShieldDeploy', 0);
        return;
      }
      case 'ENERGY': {
        const to: FxTarget =
          e.sink === 'RESERVE' ? { kind: 'reserve' } : { kind: 'robot', id: e.sink };
        if (this.throttle('energy', 0.25)) {
          this.emitEffect(
            'energy',
            e.sink === 'FUJIN' ? 'FUJIN' : 'RAIJIN',
            { kind: 'reserve' },
            to,
            0.8,
          );
          this.sound('charge', null);
        }
        // A gunner with nothing to shoot charges Raijin's drums; big transfers charge the receiver.
        const charged: TeamId | null =
          cue.role === 'GUNNER' ? 'RAIJIN' : e.sink !== 'RESERVE' && e.amount >= 15 ? e.sink : null;
        if (charged && free(charged) && this.throttle(`charge-${charged}`, 3))
          this.setClip(charged, 'Charge', 0);
        if (e.sink === 'RESERVE' && e.amount >= 10) this.beat('routerPulse', 1.8);
        return;
      }
      case 'REPAIR': {
        const r = e.repair;
        const to: FxTarget =
          r.type === 'ROBOT'
            ? { kind: 'robot', id: r.robot }
            : r.type === 'CITY'
              ? { kind: 'city', id: r.cityId }
              : { kind: 'reserve' };
        if (this.throttle('repair', 0.25)) this.emitEffect('repair', cue.robot, null, to, 0.8);
        if (r.type === 'ROBOT' && e.amount >= 15) this.beat('repairRecovery', 1.8);
        return;
      }
    }
  }

  private playAttack(cue: Extract<Cue, { kind: 'attack' }>): void {
    const from: FxTarget = { kind: 'enemy', id: cue.enemyId };
    for (const h of cue.hits) {
      const to: FxTarget = { kind: 'city', id: h.cityId };
      this.emitEffect('beam', null, from, to, h.damage > 0 ? 1 : 0.5);
      if (h.absorbed > 0) this.emitEffect('shield', 'FUJIN', null, to, 1.1);
      if (h.damage > 0)
        this.emitEffect('impact', null, null, to, Math.min(1.2, 0.4 + h.damage / 40));
    }
    // The blow that also struck a machine shows where it came from: a beam
    // from the attacker into the robot and a burst on its armour.
    if (cue.robotHit && this.throttle(`robot-hit-${cue.robotHit}`, 0.4)) {
      const robot: FxTarget = { kind: 'robot', id: cue.robotHit };
      this.emitEffect('beam', null, from, robot, 1);
      this.emitEffect('impact', null, null, robot, cue.enemyKind === 'BOSS' ? 1.1 : 0.7);
    }
    if (cue.robotHit && !this.busy) {
      this.setClip(cue.robotHit, cue.enemyKind === 'BOSS' ? 'HitHeavy' : 'HitReact', 0);
      if (cue.enemyKind === 'BOSS') {
        this.hitStop(0.07);
        this.accent('enemy', 0.4);
        this.sound('impact', cue.robotHit);
      }
    }
    // Fujin braces when its barrier soaks a blow.
    else if (
      !this.busy &&
      cue.hits.some((h) => h.absorbed > 0) &&
      this.robots.FUJIN.clip === 'Idle'
    )
      this.setClip('FUJIN', 'Guard', 0);
    // A barrier that soaked a real hit: show the defended city.
    if (cue.hits.some((h) => h.absorbed >= 20)) this.beat('cityDefense', 2);
    if (cue.hits.some((h) => h.damage > 0) && this.throttle('attack-shake', 0.4)) {
      this.addShake(cue.enemyKind === 'BOSS' ? 0.5 : 0.25);
      this.sound('hit', null);
    }
  }

  private playDefeated(cue: Extract<Cue, { kind: 'enemyDefeated' }>): void {
    if (cue.enemyKind === 'BOSS') return this.playBossDown(cue);
    this.emitEffect('explosion', null, null, { kind: 'enemy', id: cue.enemyId }, 1);
    this.sound('explosion', null);
    this.addShake(0.3);
    this.hitStop(0.06);
    if (this.throttle('banner-defeat', 2.5)) {
      this.setBanner({
        kind: 'defeated',
        tone: 'ally',
        textJa: `${ENEMY_LABELS[cue.enemyKind].ja} 撃破！`,
        textEn: `${ENEMY_LABELS[cue.enemyKind].en} destroyed!`,
        subJa: cue.callsign ? `とどめ：${cue.callsign}` : undefined,
        subEn: cue.callsign ? `final blow: ${cue.callsign}` : undefined,
        until: this.time + 1.8,
      });
    }
  }

  /**
   * NULL CORE breaks apart: a chain of blasts over two seconds, the last one in
   * slow motion, seen from low on the stage. The result sequence follows.
   */
  private playBossDown(cue: Extract<Cue, { kind: 'enemyDefeated' }>): void {
    const s = this.startTime();
    const short = this.settings.reducedMotion || this.settings.shortSpecials;
    const boss: FxTarget = { kind: 'enemy', id: cue.enemyId };
    if (short) {
      this.at(s, () => {
        this.emitEffect('explosion', null, null, boss, 2);
        this.sound('explosion', null);
        this.addShake(0.9);
      });
      this.busyUntil = Math.max(this.busyUntil, s + 0.3);
      return;
    }
    this.at(s, () => {
      this.setCamera('boss');
      this.setShot('bossDown');
      this.setLetterbox(true);
      this.setBanner({
        kind: 'defeated',
        tone: 'ally',
        textJa: 'NULL CORE 撃破！',
        textEn: 'NULL CORE DESTROYED!',
        subJa: cue.callsign ? `とどめ：${cue.callsign}` : undefined,
        subEn: cue.callsign ? `final blow: ${cue.callsign}` : undefined,
        until: s + 2.6,
      });
    });
    [0, 0.45, 0.9].forEach((dt, i) =>
      this.at(s + dt, () => {
        this.emitEffect('explosion', null, null, boss, 1 + i * 0.3);
        this.sound('explosion', null);
        this.addShake(0.35);
      }),
    );
    this.at(s + 1.4, () => {
      this.emitEffect('explosion', null, null, boss, 2.2);
      this.emitEffect('shockwave', null, null, boss, 1.4);
      this.sound('impact', null);
      this.sound('explosion', null);
      this.hitStop(0.18);
      this.slowMo(1.1, 0.35);
      this.accent('ally', 1);
      this.addShake(1);
    });
    this.at(s + 2.4, () => {
      this.setCamera('overview');
      this.setLetterbox(false);
    });
    this.busyUntil = Math.max(this.busyUntil, s + 2.4);
  }

  private playSpecialOpen(): void {
    const s = this.startTime();
    const short = this.settings.reducedMotion || this.settings.shortSpecials;
    if (!short) {
      // Charge-up: both gods glow, then a look at the pilots inside, back to the fight.
      // Each step only if nothing else took the camera meanwhile.
      this.at(s, () => this.setCamera('specialCharge'));
      this.at(s + 1.8, () => this.camera.preset === 'specialCharge' && this.setCamera('cockpit'));
      this.at(s + 3.6, () => this.camera.preset === 'cockpit' && this.setCamera('overview'));
    }
    this.at(s, () => {
      for (const t of GODS) this.emitEffect('chargeAura', t, null, { kind: 'robot', id: t }, 1);
      this.setClip('RAIJIN', 'Charge', 0);
      this.setClip('FUJIN', 'Hover', 0);
      this.sound('charge', null);
      if (!short) this.sound('riser', null);
      this.setBanner({
        kind: 'special',
        tone: 'ally',
        textJa: '神雷風陣 起動準備',
        textEn: 'SHINRAI FUJIN — STAND BY',
        subJa: `${ROLE_LABELS.GUNNER.ja}・${ROLE_LABELS.GUARDIAN.ja}・${ROLE_LABELS.ROUTER.ja}を別々の3人で成功させよう！`,
        subEn: 'Three different pilots: gunner, guardian and router!',
        until: s + 3.5,
      });
    });
    this.busyUntil = Math.max(this.busyUntil, s + (short ? 0.5 : 3.6));
  }

  /**
   * The finale's three outcomes. ACTIVATED is the long cut: a low look up at
   * both gods powering up, a push toward NULL CORE as the bolt and the wind
   * fly, the blow in slow motion, the boss reeling, then the heroes. FALLBACK
   * is the same strike, shorter and weaker; FAILED turns the camera to the boss
   * as its beam answers. Reduced motion / short specials keep the quick cut.
   */
  private playSpecial(cue: Extract<Cue, { kind: 'specialResolved' }>): void {
    const s = this.startTime();
    const short = this.settings.shortSpecials || this.settings.reducedMotion;
    const boss: FxTarget | null = cue.bossId !== null ? { kind: 'enemy', id: cue.bossId } : null;
    if (cue.outcome === 'FAILED') {
      this.at(s, () => {
        if (!short) {
          this.setShot('bossGlare');
          this.setLetterbox(true);
        }
        for (const h of cue.cityHits)
          this.emitEffect('beam', null, boss, { kind: 'city', id: h.cityId }, 1.2);
        this.addShake(0.7);
        this.accent('enemy', 0.8);
        this.hitStop(0.1);
        this.sound('ko', null);
        this.sound('explosion', null);
        for (const t of GODS) this.setClip(t, 'HitHeavy', 0);
        this.setBanner({
          kind: 'specialResult',
          tone: 'enemy',
          textJa: '神雷風陣 発動失敗…',
          textEn: 'SHINRAI FUJIN FAILED…',
          subJa: 'ヌルビームが全都市を襲う！',
          subEn: 'NULL BEAM hits every city!',
          until: s + 3,
        });
      });
      if (!short)
        this.at(s + 2.2, () => {
          this.setCamera('overview');
          this.setLetterbox(false);
        });
      this.busyUntil = s + (short ? 1.2 : 2.2);
      return;
    }
    const full = cue.outcome === 'ACTIVATED';
    // Seconds from the start: the strike lands on Raijin's slam (Special hit marker).
    const strike = short ? 0.4 : full ? 2 : 0.9;
    const dur = short ? 1.2 : full ? 5.6 : 2.6;
    this.at(s, () => {
      if (!short) {
        this.setCamera(full ? 'special' : 'final');
        this.setShot(full ? 'specialRise' : 'specialLaunch');
        this.setLetterbox(true);
      }
      for (const t of GODS) {
        this.setClip(t, 'Special', 0.3);
        this.emitEffect('specialStorm', t, null, { kind: 'robot', id: t }, full ? 1 : 0.6);
      }
      this.sound('special', null);
      this.setBanner({
        kind: 'specialResult',
        tone: 'ally',
        textJa: full ? '神雷風陣、発動！' : '雷風連撃（不完全）',
        textEn: full ? 'SHINRAI FUJIN!' : 'PARTIAL COMBO',
        subJa: `NULL CORE に ${cue.damage} ダメージ`,
        subEn: `${cue.damage} damage to NULL CORE`,
        until: s + dur + 1,
      });
    });
    if (full && !short)
      this.at(s + 1.5, () => {
        this.setShot('specialLaunch');
        this.sound('whoosh', null);
      });
    this.at(s + strike, () => {
      this.emitEffect('lightning', 'RAIJIN', { kind: 'robot', id: 'RAIJIN' }, boss, 1.6);
      this.emitEffect('wind', 'FUJIN', { kind: 'robot', id: 'FUJIN' }, boss, 1.6);
      if (boss) {
        this.emitEffect('explosion', null, null, boss, full ? 1.8 : 0.9);
        this.emitEffect('shockwave', null, null, boss, full ? 1.4 : 0.7);
      }
      this.addShake(full ? 1 : 0.5);
      this.sound('impact', null);
      this.hitStop(full ? 0.16 : 0.08);
      this.accent('ally', full ? 1 : 0.5);
      if (full && !short) this.slowMo(0.9, 0.3);
    });
    if (full && !short) {
      this.at(s + strike + 0.25, () => this.setShot('bossImpact'));
      this.at(s + strike + 2.1, () => this.setShot('heroes'));
    }
    if (!short)
      this.at(s + dur, () => {
        this.setCamera('overview');
        this.setLetterbox(false);
      });
    this.busyUntil = Math.max(this.busyUntil, s + dur);
  }

  private playEnded(r: RaidResult): void {
    const s = this.startTime();
    const won = r.outcome === 'SUCCEEDED';
    // The crew first (cockpit), then the gods' pose for the result.
    const lead = this.settings.reducedMotion ? 0 : 2.4;
    if (lead) this.at(s, () => this.setCamera('cockpit'));
    this.at(s, () => {
      this.setLetterbox(false);
      this.setMusic(won ? 'victory' : 'defeat');
    });
    this.at(s + lead, () => {
      this.setCamera('final');
      for (const t of GODS) this.setClip(t, won ? 'Victory' : 'Defeat', 0);
      this.sound(won ? 'victory' : 'ko', null);
      this.setBanner(
        won
          ? {
              kind: 'victory',
              tone: 'ally',
              textJa: '地球防衛成功！',
              textEn: 'EARTH DEFENDED!',
              subJa: `生存都市 ${r.survivingCities}/8 ・ スコア ${r.score.total}`,
              subEn: `${r.survivingCities}/8 cities standing · score ${r.score.total}`,
              until: s + 30,
            }
          : r.outcome === 'CANCELLED'
            ? {
                kind: 'defeat',
                tone: 'neutral',
                textJa: '作戦中止',
                textEn: 'RAID CANCELLED',
                until: s + 30,
              }
            : {
                kind: 'defeat',
                tone: 'enemy',
                textJa: '防衛失敗…',
                textEn: 'DEFENCE FAILED…',
                subJa:
                  r.reason === 'CITIES_LOST'
                    ? `都市が${r.survivingCities}つに・次の作戦で取り返そう`
                    : '時間切れ・次の作戦で取り返そう',
                subEn:
                  r.reason === 'CITIES_LOST'
                    ? 'Too many cities lost — next raid!'
                    : 'Out of time — next raid!',
                until: s + 30,
              },
      );
    });
    this.busyUntil = s + lead + 1;
  }

  // ---- primitives -------------------------------------------------------

  /**
   * A short camera beat on something that just happened (spec D6), then back
   * to the wide view. Never during a cinematic, never with reduced motion, at
   * most one every 12 s so a busy raid does not turn into a jump-cut montage.
   */
  private beat(preset: CameraPresetName, seconds: number): void {
    if (this.settings.reducedMotion || this.busy || this.camera.preset !== 'overview') return;
    if (this.camera.shot) return;
    if (!this.throttle('camera-beat', 12)) return;
    this.setCamera(preset);
    const since = this.camera.since;
    this.at(this.time + seconds, () => {
      if (this.camera.preset === preset && this.camera.since === since) this.setCamera('overview');
    });
  }

  /** True at most once per `interval` seconds for a key. */
  private throttle(key: string, interval: number): boolean {
    const last = this.lastFx[key] ?? -100;
    if (this.time - last < interval) return false;
    this.lastFx[key] = this.time;
    return true;
  }

  private setClip(teamId: TeamId, clip: ClipName, advance: number): void {
    this.robots[teamId] = { clip, start: this.time, advance };
  }

  private setCamera(preset: CameraPresetName): void {
    if (this.pinnedCamera) preset = this.pinnedCamera;
    if (this.camera.preset !== preset || this.camera.shot)
      this.camera = { preset, since: this.time, shot: null, anchor: null };
  }

  /**
   * Art review and broadcast framing (`/arena?cam=overview`): hold one preset
   * and ignore the cues' camera moves. Everything else still plays.
   */
  pinCamera(preset: CameraPresetName | null): void {
    this.pinnedCamera = preset;
    if (preset) this.camera = { preset, since: this.time, shot: null, anchor: null };
  }

  private pinnedCamera: CameraPresetName | null = null;

  /** Start an authored camera move (never with reduced motion). */
  private setShot(shot: ShotName, anchor: FxTarget | null = null): void {
    if (this.settings.reducedMotion || this.pinnedCamera) return;
    this.camera = { ...this.camera, since: this.time, shot, anchor };
  }

  /** A fallen city: a short push in on it, unless a cinematic owns the camera. */
  private cityFallShot(cityId: RegionId): void {
    if (this.settings.reducedMotion || this.busy || this.camera.preset !== 'overview') return;
    if (!this.throttle('city-fall', 8)) return;
    this.setShot('cityFall', { kind: 'city', id: cityId });
    const since = this.camera.since;
    this.at(this.time + 2, () => {
      if (this.camera.shot === 'cityFall' && this.camera.since === since)
        this.setCamera('overview');
    });
  }

  /**
   * Freeze the show for a few frames on a heavy blow (real seconds). At most
   * one every 0.45 s, so a busy crowd never turns into a stutter.
   */
  private hitStop(seconds: number): void {
    if (this.realTime - this.lastHitStop < 0.45) return;
    this.lastHitStop = this.realTime;
    this.warps.push({ until: this.realTime + seconds, scale: 0.03 });
  }

  /** Slow the show down (real seconds) for the finale's blow. */
  private slowMo(seconds: number, scale: number): void {
    this.warps.push({ until: this.realTime + seconds, scale });
  }

  /**
   * A brief glow and colour fringe on the screen for big moments. Never with
   * reduced motion, and at most twice a second (≤2 Hz, no strobing).
   */
  private accent(tone: 'ally' | 'enemy', amount: number): void {
    if (this.settings.reducedMotion) return;
    if (this.realTime - this.lastFlash < 0.5) return;
    this.lastFlash = this.realTime;
    this.flashTone = tone;
    this.flash = Math.min(1, Math.max(this.flash, amount));
    this.aberration = Math.min(1, Math.max(this.aberration, amount * 0.8));
  }

  private setLetterbox(on: boolean): void {
    if (this.letterbox === on) return;
    this.letterbox = on;
    for (const l of this.letterboxListeners) l(on);
  }

  private setMusic(cue: MusicCue): void {
    if (this.music === cue) return;
    this.music = cue;
    for (const l of this.musicListeners) l(cue);
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
    from: FxTarget | null,
    to: FxTarget | null,
    intensity: number,
  ): void {
    const scaled = this.settings.reducedMotion ? intensity * 0.5 : intensity;
    const e: DirectorEffect = {
      id: ++this.effectId,
      kind,
      teamId,
      from,
      to,
      at: this.time,
      intensity: scaled,
    };
    for (const l of this.effectListeners) l(e);
  }
}
