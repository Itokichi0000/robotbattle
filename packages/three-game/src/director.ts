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
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];

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
};
export const LOOPING_CLIPS: ReadonlySet<ClipName> = new Set(['Idle', 'Victory']);

export type CameraPresetName = 'intro' | 'overview' | 'boss' | 'mapFocus' | 'special' | 'final';

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
  | { kind: 'boarded'; callsign: string; robot: TeamId }
  | { kind: 'telegraph'; enemyId: number; enemyKind: EnemyKind; targets: RegionId[] }
  | {
      kind: 'task';
      role: Role;
      robot: TeamId;
      success: number;
      effect: TaskEffect | null;
      callsign: string;
      assist: boolean;
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
  camera: { preset: CameraPresetName; since: number } = { preset: 'overview', since: 0 };
  shake = 0;
  banner: Banner | null = null;
  /** Until this time a cinematic owns the camera and robot clips. */
  busyUntil = 0;
  settings: DirectorSettings = { reducedMotion: false, shakeScale: 1, shortSpecials: false };
  /** Slow-motion factor for rehearsal/preview only (1 = real time). */
  timeScale = 1;

  private queue: Scheduled[] = [];
  private order = 0;
  private effectId = 0;
  private lastFx: Record<string, number> = {};
  private cheerSide = 0;
  private effectListeners = new Set<(e: DirectorEffect) => void>();
  private bannerListeners = new Set<(b: Banner | null) => void>();
  private soundListeners = new Set<(sound: string, teamId: TeamId | null) => void>();

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
  /** Audio hooks: 'hit', 'thunder', 'wind', 'shield', 'capture', 'charge', 'special', 'victory', 'ko', 'intro', 'tick'. */
  onSound(l: (sound: string, teamId: TeamId | null) => void) {
    this.soundListeners.add(l);
    return (): void => {
      this.soundListeners.delete(l);
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
        if (this.throttle('boarded', 0.6))
          this.emitEffect('chargeAura', cue.robot, null, { kind: 'robot', id: cue.robot }, 0.4);
        return;
      case 'telegraph':
        if (this.throttle('sfx-alarm', 1.5)) this.sound('tick', null);
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
        this.sound('ko', null);
        this.addShake(0.5);
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
      case 'cheer':
        if (this.throttle('cheer', 0.5)) {
          this.cheerSide = 1 - this.cheerSide;
          this.emitEffect(
            'chargeAura',
            GODS[this.cheerSide]!,
            null,
            { kind: 'robot', id: GODS[this.cheerSide]! },
            0.35,
          );
        }
        return;
    }
  }

  update(dt: number): void {
    this.time += Math.max(0, Math.min(dt, 0.25)) * this.timeScale;
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
    while (this.queue.length && this.queue[0]!.at <= this.time) this.queue.shift()!.run();
    const decay = this.settings.reducedMotion ? 10 : 3.2;
    this.shake = Math.max(0, this.shake - dt * decay);
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

  /** Back to a calm stance (new raid loaded, preview reset). */
  reset(): void {
    this.queue = [];
    this.busyUntil = this.time;
    for (const t of GODS) this.setClip(t, 'Idle', 0);
    this.setCamera('overview');
    this.setBanner(null);
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
    this.at(s + 0.9, () => {
      for (const t of GODS) this.emitEffect('shockwave', t, null, { kind: 'robot', id: t }, 0.8);
      this.addShake(0.4);
    });
    this.at(s + (short ? 1 : 2.6), () => this.setCamera('overview'));
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
      if (!short) this.setCamera('boss');
      this.sound('special', null);
      this.addShake(0.6);
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
    this.at(s + (short ? 0.2 : 3), () => this.setCamera('overview'));
    this.busyUntil = s + (short ? 0.2 : 3);
  }

  private playTask(cue: Extract<Cue, { kind: 'task' }>): void {
    if (cue.success <= 0 || !cue.effect) return;
    const e = cue.effect;
    const free = (t: TeamId) =>
      !this.busy &&
      (this.robots[t].clip === 'Idle' ||
        this.time - this.robots[t].start > CLIP_DURATION[this.robots[t].clip] * 0.6);
    switch (e.kind) {
      case 'DAMAGE': {
        const to: FxTarget = { kind: 'enemy', id: e.enemyId };
        this.emitEffect('impact', 'RAIJIN', null, to, e.defeated ? 1 : 0.6);
        if (this.throttle('sig-RAIJIN', 0.3)) {
          this.emitEffect('lightning', 'RAIJIN', { kind: 'robot', id: 'RAIJIN' }, to, 0.9);
          this.sound('thunder', 'RAIJIN');
        }
        if (this.throttle('hit-RAIJIN', 0.08)) this.sound('hit', 'RAIJIN');
        if (free('RAIJIN'))
          this.setClip('RAIJIN', e.weakpoint === 'CORE' ? 'AttackHeavy' : 'AttackLight', 0.25);
        return;
      }
      case 'SHIELD': {
        const to: FxTarget = { kind: 'city', id: e.cityId };
        this.emitEffect('shield', 'FUJIN', null, to, 1);
        if (this.throttle('sig-FUJIN', 0.3))
          this.emitEffect('wind', 'FUJIN', { kind: 'robot', id: 'FUJIN' }, to, 0.9);
        if (this.throttle('sfx-shield', 0.15)) this.sound('shield', 'FUJIN');
        if (free('FUJIN')) this.setClip('FUJIN', 'Guard', 0);
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
    if (cue.robotHit && !this.busy) this.setClip(cue.robotHit, 'HitReact', 0);
    if (cue.hits.some((h) => h.damage > 0) && this.throttle('attack-shake', 0.4)) {
      this.addShake(cue.enemyKind === 'BOSS' ? 0.5 : 0.25);
      this.sound('hit', null);
    }
  }

  private playDefeated(cue: Extract<Cue, { kind: 'enemyDefeated' }>): void {
    this.emitEffect(
      'explosion',
      null,
      null,
      { kind: 'enemy', id: cue.enemyId },
      cue.enemyKind === 'BOSS' ? 2 : 1,
    );
    this.sound('ko', null);
    this.addShake(cue.enemyKind === 'BOSS' ? 0.9 : 0.3);
    if (cue.enemyKind === 'BOSS') return;
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

  private playSpecialOpen(): void {
    const s = this.startTime();
    this.at(s, () => {
      for (const t of GODS) this.emitEffect('chargeAura', t, null, { kind: 'robot', id: t }, 1);
      this.sound('charge', null);
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
    this.busyUntil = Math.max(this.busyUntil, s + 0.5);
  }

  private playSpecial(cue: Extract<Cue, { kind: 'specialResolved' }>): void {
    const s = this.startTime();
    const short = this.settings.shortSpecials || this.settings.reducedMotion;
    const boss: FxTarget | null = cue.bossId !== null ? { kind: 'enemy', id: cue.bossId } : null;
    if (cue.outcome === 'FAILED') {
      this.at(s, () => {
        for (const h of cue.cityHits)
          this.emitEffect('beam', null, boss, { kind: 'city', id: h.cityId }, 1.2);
        this.addShake(0.7);
        this.sound('ko', null);
        for (const t of GODS) this.setClip(t, 'HitReact', 0);
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
      this.busyUntil = s + 1.2;
      return;
    }
    const full = cue.outcome === 'ACTIVATED';
    const dur = short ? 1.2 : full ? 4.5 : 2;
    this.at(s, () => {
      if (!short) this.setCamera(full ? 'special' : 'final');
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
    this.at(s + (short ? 0.4 : full ? 2 : 0.8), () => {
      this.emitEffect('lightning', 'RAIJIN', { kind: 'robot', id: 'RAIJIN' }, boss, 1.6);
      this.emitEffect('wind', 'FUJIN', { kind: 'robot', id: 'FUJIN' }, boss, 1.6);
      if (boss) this.emitEffect('explosion', null, null, boss, full ? 1.6 : 0.9);
      this.addShake(full ? 1 : 0.5);
    });
    if (!short) this.at(s + dur, () => this.setCamera('overview'));
    this.busyUntil = Math.max(this.busyUntil, s + dur);
  }

  private playEnded(r: RaidResult): void {
    const s = this.startTime();
    const won = r.outcome === 'SUCCEEDED';
    this.at(s, () => {
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
    this.busyUntil = s + 1;
  }

  // ---- primitives -------------------------------------------------------

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
