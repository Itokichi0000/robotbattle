import type { RegionId, RoundEndReason, TeamId } from '@sats-wars/shared';
import { REGION_INFO, TEAM_META } from '@sats-wars/shared';

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

/**
 * Seconds; looping clips ignore duration. Punches are short because the crowd
 * can land several per second: a long wind-up would always be interrupted.
 */
export const CLIP_DURATION: Record<ClipName, number> = {
  Idle: 2.4,
  Intro: 2.2,
  AttackLight: 0.45,
  AttackHeavy: 0.6,
  Guard: 0.8,
  HitReact: 0.4,
  Special: 1.6,
  Victory: 2.0,
  Defeat: 1.4,
};
export const LOOPING_CLIPS: ReadonlySet<ClipName> = new Set(['Idle', 'Victory']);

export type CameraPresetName =
  | 'intro'
  | 'overview'
  | 'mapFocus'
  | 'clash'
  | 'specialRAIJIN'
  | 'specialFUJIN'
  | 'final'
  | 'victoryRAIJIN'
  | 'victoryFUJIN';

export type EffectKind =
  | 'impact'
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
  /** For impact/lightning/wind: the ATTACKING team (the effect lands on the other robot). */
  teamId: TeamId | null;
  regionId: RegionId | null;
  /** Director time (s) at which the effect starts. */
  at: number;
  intensity: number;
}

export interface Banner {
  kind: 'round' | 'fight' | 'special' | 'pinch' | 'ko' | 'timeup' | 'draw' | 'champion' | 'opening';
  teamId: TeamId | null;
  textJa: string;
  textEn: string;
  /** Smaller second line (e.g. who landed the finishing blow). */
  subJa?: string;
  subEn?: string;
  until: number;
}

export interface RobotCue {
  clip: ClipName;
  /** Director time the clip started. */
  start: number;
  /** 0 = home position, 1 = fully advanced to the centre. */
  advance: number;
}

export type Cue =
  | { kind: 'seasonStart' }
  | {
      kind: 'roundStart';
      roundIndex: number;
      roundsTotal: number;
      regionId: RegionId;
      hpMax: number;
      hp: Record<TeamId, number>;
    }
  | {
      kind: 'zap';
      teamId: TeamId;
      nickname: string;
      damage: number;
      special: boolean;
      pinch: boolean;
      ko: boolean;
      /** Authoritative HP after this punch. */
      hp: Record<TeamId, number>;
    }
  | {
      kind: 'roundEnd';
      winner: TeamId | null;
      reason: RoundEndReason;
      regionId: RegionId;
      finisher: string | null;
    }
  | { kind: 'seasonEnd'; winner: TeamId | null; regionCounts: Record<TeamId, number> }
  | { kind: 'cheer'; teamId: TeamId };

export interface DirectorSettings {
  reducedMotion: boolean;
  /** 0..1 multiplier for camera shake. */
  shakeScale: number;
  /** Always use the short special-move cut. */
  shortSpecials: boolean;
}

type Scheduled = { at: number; run: () => void; order: number };

const TEAMS: TeamId[] = ['RAIJIN', 'FUJIN'];
const other = (t: TeamId): TeamId => (t === 'RAIJIN' ? 'FUJIN' : 'RAIJIN');

/** Robots stand this far in during a round so punches read clearly. */
const FIGHT_ADVANCE = 0.45;

/**
 * Turns server-confirmed game events into camera moves, robot clips, effects
 * and HP updates. It never decides outcomes: HP shown is always a value the
 * server already sent, applied the moment the punch arrives, so the HUD can't
 * drift from the truth even when the crowd taps faster than animations play.
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
  /** Until this time a cinematic owns the camera and robot clips. */
  busyUntil = 0;
  settings: DirectorSettings = { reducedMotion: false, shakeScale: 1, shortSpecials: false };
  /** Slow-motion factor for rehearsal/preview only (1 = real time). */
  timeScale = 1;

  private queue: Scheduled[] = [];
  private order = 0;
  private effectId = 0;
  private inRound = false;
  private lastSpecialAt = -100;
  private pinchAnnounced: Record<TeamId, boolean> = { RAIJIN: false, FUJIN: false };
  private lastFx: Record<string, number> = {};
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
  /** Audio hooks: 'hit', 'thunder', 'wind', 'capture', 'charge', 'special', 'victory', 'ko', 'intro', 'cheer'. */
  onSound(l: (sound: string, teamId: TeamId | null) => void) {
    this.soundListeners.add(l);
    return (): void => {
      this.soundListeners.delete(l);
    };
  }

  /** Snap HUD HP to authoritative values (snapshot load, resync). */
  syncHp(hp: Record<TeamId, number>, hpMax?: number): void {
    if (hpMax) this.hpMax = hpMax;
    this.displayHp = { ...hp };
    for (const l of this.hpListeners) l(this.displayHp);
  }

  /** Put robots in fighting stance without the intro (joining mid-round). */
  enterRound(hp: Record<TeamId, number>, hpMax: number): void {
    this.inRound = true;
    this.syncHp(hp, hpMax);
    for (const t of TEAMS) this.setClip(t, 'Idle', FIGHT_ADVANCE);
  }

  /** True while a cinematic (intro/special/KO/result) is playing or queued. */
  get busy(): boolean {
    return this.busyUntil > this.time;
  }

  play(cue: Cue): void {
    switch (cue.kind) {
      case 'seasonStart':
        return this.playSeasonStart();
      case 'roundStart':
        return this.playRoundStart(cue);
      case 'zap':
        return this.playZap(cue);
      case 'roundEnd':
        return this.playRoundEnd(cue);
      case 'seasonEnd':
        return this.playSeasonEnd(cue);
      case 'cheer':
        if (this.throttle(`cheer-${cue.teamId}`, 0.6)) {
          this.emitEffect('chargeAura', cue.teamId, null, this.time, 0.35);
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
    for (const t of TEAMS) {
      const r = this.robots[t];
      if (!LOOPING_CLIPS.has(r.clip) && r.clip !== 'Defeat' && this.time - r.start > CLIP_DURATION[r.clip] + 0.05) {
        this.setClip(t, 'Idle', this.inRound ? FIGHT_ADVANCE : 0);
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
    return Math.max(this.time, Math.min(this.busyUntil, this.time + 3));
  }

  private playSeasonStart(): void {
    const s = this.startTime();
    this.inRound = false;
    this.at(s, () => {
      this.setCamera('intro');
      for (const t of TEAMS) this.setClip(t, 'Intro', 0);
      this.sound('intro', null);
      this.setBanner({
        kind: 'opening',
        teamId: null,
        textJa: '雷神 vs 風神',
        textEn: 'RAIJIN vs FUJIN',
        subJa: '新しいシーズン開幕！ 8つの地方を奪い合え',
        subEn: 'New season! Fight for 8 regions of Japan',
        until: s + 3.5,
      });
    });
    this.at(s + 0.9, () => {
      for (const t of TEAMS) this.emitEffect('shockwave', t, null, this.time, 0.8);
      this.addShake(0.5);
    });
    this.at(s + 2.6, () => this.setCamera('overview'));
    this.busyUntil = s + 2.6;
  }

  private playRoundStart(cue: Extract<Cue, { kind: 'roundStart' }>): void {
    const s = this.startTime();
    const info = REGION_INFO[cue.regionId];
    const intro = this.settings.reducedMotion ? 1.0 : 1.8;
    this.at(s, () => {
      this.inRound = true;
      this.pinchAnnounced = { RAIJIN: false, FUJIN: false };
      this.syncHp(cue.hp, cue.hpMax);
      this.setCamera('mapFocus');
      for (const t of TEAMS) this.setClip(t, 'Idle', 0);
      this.emitEffect('regionPulse', null, cue.regionId, this.time, 1);
      this.setBanner({
        kind: 'round',
        teamId: null,
        textJa: `第${cue.roundIndex + 1}戦\u3000${info.labelJa}をかけて！`,
        textEn: `ROUND ${cue.roundIndex + 1} — fight for ${info.labelEn}!`,
        subJa: `${cue.roundIndex + 1} / ${cue.roundsTotal}`,
        subEn: `${cue.roundIndex + 1} / ${cue.roundsTotal}`,
        until: s + intro,
      });
    });
    this.at(s + intro, () => {
      this.setCamera('overview');
      for (const t of TEAMS) {
        this.setClip(t, 'Guard', FIGHT_ADVANCE);
        this.emitEffect('shockwave', t, null, this.time, 0.6);
      }
      this.addShake(0.3);
      this.sound('intro', null);
      this.setBanner({ kind: 'fight', teamId: null, textJa: 'FIGHT!', textEn: 'FIGHT!', until: s + intro + 1.0 });
    });
    this.busyUntil = s + intro;
  }

  private playZap(cue: Extract<Cue, { kind: 'zap' }>): void {
    const me = cue.teamId;
    const foe = other(me);
    // HP is the server's number, shown immediately.
    this.displayHp = { ...cue.hp };
    for (const l of this.hpListeners) l(this.displayHp);

    // Every punch gets a hit flash; heavier effects are throttled so a crowd
    // of 100 tapping doesn't turn into a white-out or a strobe.
    this.emitEffect('impact', me, null, this.time, cue.special ? 1.4 : cue.pinch ? 0.9 : 0.6);
    if (this.throttle(`hit-${me}`, 0.08)) this.sound('hit', me);
    if (this.throttle(`sig-${me}`, 0.3) || cue.special) {
      this.emitEffect(me === 'RAIJIN' ? 'lightning' : 'wind', me, null, this.time, cue.special ? 1.5 : 0.7);
      this.sound(me === 'RAIJIN' ? 'thunder' : 'wind', me);
    }
    if (this.throttle('shake', 0.15)) this.addShake(cue.special || cue.ko ? 0.8 : 0.12);

    if (cue.pinch && !this.pinchAnnounced[me]) {
      this.pinchAnnounced[me] = true;
      this.emitEffect('chargeAura', me, null, this.time, 1);
      this.sound('charge', me);
      if (!cue.special && !cue.ko) {
        this.setBanner({
          kind: 'pinch',
          teamId: me,
          textJa: `${TEAM_META[me].nameJa}ピンチ！ パンチ1.5倍`,
          textEn: `${TEAM_META[me].nameEn} in a pinch! Punches ×1.5`,
          until: this.time + 1.8,
        });
      }
    }

    if (cue.special) return this.playSpecial(me, cue.nickname, cue.damage);
    if (this.busy) return; // a cinematic owns the robots; effects/HP still update.

    const r = this.robots[me];
    const canSwing =
      r.clip === 'Idle' || r.clip === 'Guard' || r.clip === 'HitReact' || this.time - r.start > CLIP_DURATION[r.clip] * 0.6;
    if (canSwing) {
      const heavy = cue.pinch || r.clip === 'AttackLight';
      this.setClip(me, heavy ? 'AttackHeavy' : 'AttackLight', 0.75);
    }
    const f = this.robots[foe];
    if (f.clip === 'Idle' || f.clip === 'Guard') this.setClip(foe, 'HitReact', FIGHT_ADVANCE);
  }

  private playSpecial(me: TeamId, nickname: string, damage: number): void {
    const short = this.settings.shortSpecials || this.settings.reducedMotion || this.time - this.lastSpecialAt < 8;
    this.lastSpecialAt = this.time;
    const dur = short ? 0.9 : 1.6;
    const s = this.time;
    if (!short) this.setCamera(me === 'RAIJIN' ? 'specialRAIJIN' : 'specialFUJIN');
    this.setClip(me, 'Special', 0.75);
    this.setClip(other(me), 'HitReact', FIGHT_ADVANCE);
    this.emitEffect('specialStorm', me, null, this.time, short ? 0.5 : 1);
    this.sound('special', me);
    this.setBanner({
      kind: 'special',
      teamId: me,
      textJa: `${TEAM_META[me].specialJa}！`,
      textEn: `${TEAM_META[me].specialEn}!`,
      subJa: `${nickname} の必殺技 −${damage}`,
      subEn: `${nickname}'s special −${damage}`,
      until: s + dur + 0.8,
    });
    if (!short) this.at(s + dur, () => this.setCamera('overview'));
    this.busyUntil = Math.max(this.busyUntil, s + dur);
  }

  private playRoundEnd(cue: Extract<Cue, { kind: 'roundEnd' }>): void {
    const s = Math.max(this.time, Math.min(this.busyUntil, this.time + 0.6));
    const info = REGION_INFO[cue.regionId];
    const w = cue.winner;
    this.at(s, () => {
      this.inRound = false;
      if (w) {
        const loser = other(w);
        this.setCamera(w === 'RAIJIN' ? 'victoryRAIJIN' : 'victoryFUJIN');
        this.setClip(w, 'Victory', 0.3);
        this.setClip(loser, cue.reason === 'KO' ? 'Defeat' : 'HitReact', 0.2);
        this.emitEffect('shockwave', w, null, this.time, 1);
        this.addShake(cue.reason === 'KO' ? 0.9 : 0.4);
        this.sound(cue.reason === 'KO' ? 'ko' : 'victory', w);
        this.setBanner({
          kind: cue.reason === 'KO' ? 'ko' : 'timeup',
          teamId: w,
          textJa: cue.reason === 'KO' ? `KO！ ${TEAM_META[w].nameJa}の勝ち` : `タイムアップ！ ${TEAM_META[w].nameJa}の勝ち`,
          textEn: cue.reason === 'KO' ? `KO! ${TEAM_META[w].nameEn} WINS` : `TIME UP! ${TEAM_META[w].nameEn} WINS`,
          subJa:
            cue.reason === 'KO' && cue.finisher
              ? `とどめ：${cue.finisher}\u3000→ ${info.labelJa}ゲット！`
              : `${info.labelJa}ゲット！（残りHPが多い）`,
          subEn:
            cue.reason === 'KO' && cue.finisher
              ? `Finisher: ${cue.finisher} → ${info.labelEn} captured!`
              : `${info.labelEn} captured (more HP left)`,
          until: s + 4.2,
        });
      } else {
        this.setCamera('final');
        for (const t of TEAMS) this.setClip(t, 'Guard', 0);
        this.sound('victory', null);
        this.setBanner({
          kind: 'draw',
          teamId: null,
          textJa: '引き分け！',
          textEn: 'DRAW!',
          subJa: `${info.labelJa}はどちらのものにもならない`,
          subEn: `${info.labelEn} stays neutral`,
          until: s + 4.2,
        });
      }
    });
    if (w) {
      this.at(s + 2.6, () => {
        this.setCamera('mapFocus');
        this.emitEffect('regionPulse', w, cue.regionId, this.time, 1.2);
        this.sound('capture', w);
      });
    }
    this.at(s + 5, () => {
      for (const t of TEAMS) this.setClip(t, 'Idle', 0);
      this.setCamera('overview');
    });
    this.busyUntil = s + 5;
  }

  private playSeasonEnd(cue: Extract<Cue, { kind: 'seasonEnd' }>): void {
    const s = this.startTime();
    const w = cue.winner;
    const score = `${cue.regionCounts.RAIJIN} – ${cue.regionCounts.FUJIN}`;
    this.at(s, () => {
      this.inRound = false;
      if (w) {
        this.setCamera(w === 'RAIJIN' ? 'victoryRAIJIN' : 'victoryFUJIN');
        this.setClip(w, 'Victory', 0);
        this.setClip(other(w), 'Defeat', 0);
        this.emitEffect('specialStorm', w, null, this.time, 0.7);
        this.sound('victory', w);
        this.setBanner({
          kind: 'champion',
          teamId: w,
          textJa: `${TEAM_META[w].nameJa} 全国制覇！`,
          textEn: `${TEAM_META[w].nameEn} CONQUERS JAPAN!`,
          subJa: `雷神 ${score} 風神`,
          subEn: `RAIJIN ${score} FUJIN`,
          until: s + 30,
        });
      } else {
        this.setCamera('final');
        for (const t of TEAMS) this.setClip(t, 'Guard', 0);
        this.setBanner({
          kind: 'draw',
          teamId: null,
          textJa: 'シーズン引き分け！',
          textEn: 'SEASON DRAW!',
          subJa: `雷神 ${score} 風神`,
          subEn: `RAIJIN ${score} FUJIN`,
          until: s + 30,
        });
      }
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

  private emitEffect(kind: EffectKind, teamId: TeamId | null, regionId: RegionId | null, at: number, intensity: number): void {
    const scaled = this.settings.reducedMotion ? intensity * 0.5 : intensity;
    const e: DirectorEffect = { id: ++this.effectId, kind, teamId, regionId, at, intensity: scaled };
    for (const l of this.effectListeners) l(e);
  }
}
