import type { AlienAttack, RegionId, ResolvedAction, TeamId } from '@sats-wars/shared';
import { REGION_INFO } from '@sats-wars/shared';

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

/** Seconds; looping clips ignore duration. Attacks are short because many people act at once. */
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
  | 'specialStorm'
  | 'alienAttack'
  | 'landing';

export interface DirectorEffect {
  id: number;
  kind: EffectKind;
  /** Which god caused it (colour, origin). */
  teamId: TeamId | null;
  /** Where on the map it lands. */
  regionId: RegionId | null;
  /** Director time (s) at which the effect starts. */
  at: number;
  intensity: number;
}

export type BannerTone = 'ally' | 'alien' | 'neutral' | 'RAIJIN' | 'FUJIN';

export interface Banner {
  kind: 'opening' | 'wave' | 'boss' | 'combo' | 'liberated' | 'alienTurn' | 'fallen' | 'cleared' | 'gameover';
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
  /** 0 = home position, 1 = fully advanced to the centre. */
  advance: number;
}

export type Cue =
  | { kind: 'campaignStart' }
  | { kind: 'waveStart'; wave: number; boss: boolean }
  | {
      kind: 'action';
      action: ResolvedAction;
      regionId: RegionId;
      nickname: string;
      damage: number;
      kills: number;
      liberated: boolean;
    }
  | { kind: 'alienTurn'; attacks: AlienAttack[]; fell: RegionId[]; landed: RegionId[] }
  | { kind: 'landed'; regions: RegionId[] }
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'japanFallen'; reachedWave: number }
  | { kind: 'cheer' };

export interface DirectorSettings {
  reducedMotion: boolean;
  /** 0..1 multiplier for camera shake. */
  shakeScale: number;
  /** Always use the short combo cut. */
  shortSpecials: boolean;
}

type Scheduled = { at: number; run: () => void; order: number };

const GODS: TeamId[] = ['RAIJIN', 'FUJIN'];
const region = (id: RegionId) => REGION_INFO[id];

/**
 * Turns server-confirmed game events into camera moves, robot clips, effects
 * and sounds. It never decides anything: every number shown comes from the
 * server. Many people can act per second, so per-action reactions are short
 * and the heavy effects/sounds are throttled.
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
  /** Audio hooks: 'hit', 'thunder', 'wind', 'shield', 'capture', 'charge', 'special', 'victory', 'ko', 'intro'. */
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
      case 'campaignStart':
        return this.playCampaignStart();
      case 'waveStart':
        return this.playWaveStart(cue.wave, cue.boss);
      case 'action':
        return this.playAction(cue);
      case 'alienTurn':
        return this.playAlienTurn(cue);
      case 'landed':
        for (const id of cue.regions) this.emitEffect('landing', null, id, this.time, 0.8);
        return;
      case 'waveCleared':
        return this.playWaveCleared(cue.wave);
      case 'japanFallen':
        return this.playJapanFallen(cue.reachedWave);
      case 'cheer':
        if (this.throttle('cheer', 0.5)) {
          this.cheerSide = 1 - this.cheerSide;
          this.emitEffect('chargeAura', GODS[this.cheerSide]!, null, this.time, 0.35);
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
      if (!LOOPING_CLIPS.has(r.clip) && r.clip !== 'Defeat' && this.time - r.start > CLIP_DURATION[r.clip] + 0.05) {
        this.setClip(t, 'Idle', 0);
      }
    }
  }

  /** Remaining scheduled items (for tests). */
  get pending(): number {
    return this.queue.length;
  }

  /** Back to a calm stance (new campaign loaded, preview reset). */
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

  private playCampaignStart(): void {
    const s = this.startTime();
    this.at(s, () => {
      this.setCamera('intro');
      for (const t of GODS) this.setClip(t, 'Intro', 0);
      this.sound('intro', null);
      this.setBanner({
        kind: 'opening',
        tone: 'ally',
        textJa: '地球防衛軍 出動！',
        textEn: 'EARTH DEFENSE FORCE, LAUNCH!',
        subJa: '雷神と風神が手を組んだ。エイリアンから日本を守れ',
        subEn: 'Raijin and Fujin join forces. Defend Japan from the aliens',
        until: s + 3.5,
      });
    });
    this.at(s + 0.9, () => {
      for (const t of GODS) this.emitEffect('shockwave', t, null, this.time, 0.8);
      this.addShake(0.5);
    });
    this.at(s + 2.6, () => this.setCamera('overview'));
    this.busyUntil = s + 2.6;
  }

  private playWaveStart(wave: number, boss: boolean): void {
    const s = this.startTime();
    this.at(s, () => {
      this.setCamera('mapFocus');
      this.sound(boss ? 'special' : 'intro', null);
      this.setBanner(
        boss
          ? {
              kind: 'boss',
              tone: 'alien',
              textJa: `ウェーブ${wave} 母艦接近！`,
              textEn: `WAVE ${wave}: MOTHERSHIP INCOMING!`,
              subJa: '雷神の雷撃と合体技で落とせ',
              subEn: 'Bring it down with Raijin and the combo',
              until: s + 2.4,
            }
          : {
              kind: 'wave',
              tone: 'alien',
              textJa: `ウェーブ${wave}`,
              textEn: `WAVE ${wave}`,
              subJa: 'エイリアンが来る！',
              subEn: 'Aliens incoming!',
              until: s + 1.8,
            },
      );
    });
    this.at(s + 1.8, () => this.setCamera('overview'));
    this.busyUntil = s + 1.8;
  }

  private playAction(cue: Extract<Cue, { kind: 'action' }>): void {
    const id = cue.regionId;
    if (cue.action === 'COMBO') return this.playCombo(cue);
    if (cue.action === 'SHIELD') {
      this.emitEffect('shield', null, id, this.time, 1);
      if (this.throttle('sfx-shield', 0.15)) this.sound('shield', null);
      if (!this.busy) for (const t of GODS) if (this.robots[t].clip === 'Idle') this.setClip(t, 'Guard', 0);
    } else {
      const god: TeamId = cue.action === 'RAIJIN' ? 'RAIJIN' : 'FUJIN';
      this.emitEffect('impact', god, id, this.time, cue.kills ? 1 : 0.6);
      if (this.throttle(`sig-${god}`, 0.3)) {
        this.emitEffect(god === 'RAIJIN' ? 'lightning' : 'wind', god, id, this.time, 0.9);
        this.sound(god === 'RAIJIN' ? 'thunder' : 'wind', god);
      }
      if (this.throttle(`hit-${god}`, 0.08)) this.sound('hit', god);
      if (!this.busy) {
        const r = this.robots[god];
        const canSwing = r.clip === 'Idle' || r.clip === 'Guard' || this.time - r.start > CLIP_DURATION[r.clip] * 0.6;
        if (canSwing) this.setClip(god, god === 'RAIJIN' ? 'AttackHeavy' : 'AttackLight', 0.25);
      }
    }
    if (cue.kills > 0) {
      this.emitEffect('sparks', null, id, this.time, Math.min(1.2, 0.5 + cue.kills * 0.25));
      if (this.throttle('shake', 0.15)) this.addShake(0.15);
    }
    if (cue.liberated) {
      this.emitEffect('regionPulse', 'FUJIN', id, this.time, 1.2);
      this.sound('capture', null);
      this.setBanner({
        kind: 'liberated',
        tone: 'ally',
        textJa: `${region(id).labelJa} 奪還！`,
        textEn: `${region(id).labelEn} LIBERATED!`,
        subJa: `${cue.nickname} がとりかえした`,
        subEn: `taken back by ${cue.nickname}`,
        until: this.time + 2.4,
      });
    }
  }

  private playCombo(cue: Extract<Cue, { kind: 'action' }>): void {
    const short = this.settings.shortSpecials || this.settings.reducedMotion;
    const dur = short ? 1.0 : 1.8;
    const s = this.time;
    if (!short) this.setCamera('final');
    for (const t of GODS) {
      this.setClip(t, 'Special', 0.3);
      this.emitEffect('specialStorm', t, null, this.time, short ? 0.5 : 1);
    }
    this.emitEffect('lightning', 'RAIJIN', cue.regionId, this.time, 1.5);
    this.emitEffect('wind', 'FUJIN', cue.regionId, this.time, 1.5);
    this.emitEffect('sparks', null, cue.regionId, this.time, 1.4);
    this.addShake(0.8);
    this.sound('special', null);
    this.setBanner({
      kind: 'combo',
      tone: 'ally',
      textJa: '合体技 風神雷神！',
      textEn: 'FŪJIN-RAIJIN COMBO!',
      subJa: `${cue.nickname} が ${region(cue.regionId).labelJa} を一掃`,
      subEn: `${cue.nickname} wipes out ${region(cue.regionId).labelEn}`,
      until: s + dur + 1,
    });
    if (!short) this.at(s + dur, () => this.setCamera('overview'));
    this.busyUntil = Math.max(this.busyUntil, s + dur);
  }

  private playAlienTurn(cue: Extract<Cue, { kind: 'alienTurn' }>): void {
    const s = this.startTime();
    const intro = this.settings.reducedMotion ? 0.6 : 1.0;
    this.at(s, () => {
      this.setCamera('mapFocus');
      this.sound('charge', null);
      this.setBanner({
        kind: 'alienTurn',
        tone: 'alien',
        textJa: 'エイリアンの攻撃！',
        textEn: 'ALIEN ATTACK!',
        subJa: cue.attacks.length ? `${cue.attacks.length}つの地方が攻撃された` : '結界ですべて防いだ！',
        subEn: cue.attacks.length ? `${cue.attacks.length} regions under fire` : 'Every attack blocked!',
        until: s + intro + 1.6,
      });
    });
    this.at(s + intro, () => {
      for (const a of cue.attacks) {
        this.emitEffect('alienAttack', null, a.regionId, this.time, a.damage > a.absorbed ? 1 : 0.4);
        if (a.absorbed > 0) this.emitEffect('shield', null, a.regionId, this.time, 1);
      }
      for (const id of cue.landed) this.emitEffect('landing', null, id, this.time, 0.8);
      if (cue.attacks.length) {
        this.addShake(0.5);
        this.sound('hit', null);
        for (const t of GODS) this.setClip(t, 'HitReact', 0);
      }
    });
    let end = s + intro + 1.4;
    if (cue.fell.length) {
      this.at(s + intro + 1.2, () => {
        for (const id of cue.fell) this.emitEffect('regionPulse', null, id, this.time, 1.2);
        this.sound('ko', null);
        this.setBanner({
          kind: 'fallen',
          tone: 'alien',
          textJa: `${cue.fell.map((id) => region(id).labelJa).join('・')} がとられた！`,
          textEn: `${cue.fell.map((id) => region(id).labelEn).join(', ')} captured!`,
          subJa: 'エイリアンを全部倒せば取り返せる',
          subEn: 'Defeat every alien there to take it back',
          until: s + intro + 3.6,
        });
      });
      end += 1.4;
    }
    this.at(end, () => this.setCamera('overview'));
    this.busyUntil = end;
  }

  private playWaveCleared(wave: number): void {
    const s = this.startTime();
    this.at(s, () => {
      for (const t of GODS) this.setClip(t, 'Victory', 0);
      this.sound('victory', null);
      this.setBanner({
        kind: 'cleared',
        tone: 'ally',
        textJa: `ウェーブ${wave} クリア！`,
        textEn: `WAVE ${wave} CLEARED!`,
        subJa: '街が少し回復した',
        subEn: 'Cities repaired a little',
        until: s + 2.2,
      });
    });
    this.at(s + 2.0, () => {
      for (const t of GODS) this.setClip(t, 'Idle', 0);
    });
    this.busyUntil = s + 1.2;
  }

  private playJapanFallen(reachedWave: number): void {
    const s = this.startTime();
    this.at(s, () => {
      this.setCamera('final');
      for (const t of GODS) this.setClip(t, 'Defeat', 0);
      this.sound('ko', null);
      this.setBanner({
        kind: 'gameover',
        tone: 'alien',
        textJa: '日本陥落…',
        textEn: 'JAPAN HAS FALLEN…',
        subJa: `記録：ウェーブ${reachedWave} ・ まもなく再出撃！`,
        subEn: `Reached wave ${reachedWave} — redeploying soon!`,
        until: s + 30,
      });
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
