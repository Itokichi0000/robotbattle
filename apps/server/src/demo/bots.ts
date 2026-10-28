import type { TeamId } from '@sats-wars/shared';
import { type Rng, chooseAction, mulberry32 } from '@sats-wars/game-engine';
import type { WallClock } from '../clock';
import type { Repo } from '../db/repo';
import type { MatchManager } from '../match/manager';
import { newId, newToken, sha256 } from '../auth/tokens';

const BOT_NAMES_RAIJIN = [
  '雷丸',
  'イナズマ',
  'ゴロゴロ',
  'Volt',
  'Bolt',
  '太鼓番',
  'Spark',
  '稲光',
];
const BOT_NAMES_FUJIN = ['疾風', 'ツムジ', 'そよ風', 'Gale', 'Breeze', '風袋番', 'Zephyr', '旋風'];

interface BotPlan {
  participantId: string;
  teamId: TeamId;
  /** Game ms at which each remaining AP is spent. */
  schedule: number[];
}

/**
 * Demo participants for rehearsals and unattended demos. Bots are clearly
 * labelled (isBot) on every screen and never touch payments.
 */
export class DemoBots {
  private perTeam = 0;
  private bots: BotPlan[] = [];
  private rng: Rng = mulberry32(Date.now() & 0xffffffff);
  private lastWaveGameMs = 0;
  private matchId: string | null = null;

  constructor(
    private repo: Repo,
    private manager: MatchManager,
    private wall: WallClock,
  ) {
    manager.onMatchChanged(() => {
      this.bots = [];
      this.matchId = null;
    });
  }

  get enabledPerTeam(): number {
    return this.perTeam;
  }

  setPerTeam(n: number, actor: string): void {
    const before = this.perTeam;
    this.perTeam = Math.max(0, Math.min(200, Math.floor(n)));
    this.repo.audit(actor, 'SET_DEMO_BOTS', null, { before, after: this.perTeam }, this.wall.now());
  }

  /** Called from the server tick loop. */
  step(): void {
    const rt = this.manager.current();
    const s = rt.state;
    if (this.perTeam === 0) return;
    const accepting = s.status === 'LOBBY' || s.status === 'LIVE';
    if (!accepting) return;
    if (this.matchId !== rt.matchId) {
      this.matchId = rt.matchId;
      this.bots = [];
      this.lastWaveGameMs = s.gameMs;
      for (let i = 0; i < this.perTeam; i++) {
        this.spawn('RAIJIN');
        this.spawn('FUJIN');
      }
    }
    // Small reinforcement waves keep the demo lively until joins close.
    if (
      s.status === 'LIVE' &&
      s.gameMs < s.config.joinCloseMs &&
      s.gameMs - this.lastWaveGameMs >= 30_000
    ) {
      this.lastWaveGameMs = s.gameMs;
      this.spawn('RAIJIN');
      this.spawn('FUJIN');
    }
    if (s.status !== 'LIVE') return;
    for (const bot of this.bots) {
      while (bot.schedule.length && bot.schedule[0]! <= rt.state.gameMs) {
        bot.schedule.shift();
        const plan = chooseAction(rt.state, bot.teamId, 'balanced', this.rng);
        if (!plan) continue;
        rt.dispatch({
          type: 'ACTION',
          participantId: bot.participantId,
          clientActionId: newId('bot'),
          actionType: plan.actionType,
          regionId: plan.regionId,
        });
      }
    }
  }

  private spawn(teamId: TeamId): void {
    const rt = this.manager.current();
    const s = rt.state;
    const names = teamId === 'RAIJIN' ? BOT_NAMES_RAIJIN : BOT_NAMES_FUJIN;
    const participantId = newId('bot');
    const n = this.bots.filter((b) => b.teamId === teamId).length;
    const nickname = `BOT ${names[n % names.length]}${n >= names.length ? Math.floor(n / names.length) + 1 : ''}`;
    const now = this.wall.now();
    const ap = s.config.apPerParticipant;
    rt.dispatch({ type: 'ADD_PARTICIPANT', participantId, teamId, nickname, isBot: true, ap }, () =>
      this.repo.insertParticipant({
        id: participantId,
        match_id: rt.matchId,
        team_id: teamId,
        nickname_sanitized: nickname,
        nickname_hidden: 0,
        session_id_hash: sha256(newToken()),
        device_hash: null,
        source: 'DEMO',
        status: 'ACTIVE',
        joined_at: now,
        confirmed_at: now,
        ap_total: ap,
        sponsored_pass_id: null,
      }),
    );
    const start = Math.max(2_000, s.gameMs + 1_000);
    const end = s.config.actionCloseMs - 2_000;
    const schedule = Array.from(
      { length: ap },
      () => start + this.rng() * Math.max(1, end - start),
    ).sort((a, b) => a - b);
    this.bots.push({ participantId, teamId, schedule });
  }
}
