import type { TeamId } from '@sats-wars/shared';
import { mulberry32 } from '@sats-wars/game-engine';
import type { WallClock } from '../clock';
import type { Repo } from '../db/repo';
import type { MatchManager } from '../match/manager';

const BOT_NAMES: Record<TeamId, string[]> = {
  RAIJIN: ['雷丸', 'イナズマ', 'ゴロゴロ', 'Volt', 'Bolt', '太鼓番', 'Spark', '稲光'],
  FUJIN: ['疾風', 'ツムジ', 'そよ風', 'Gale', 'Breeze', '風袋番', 'Zephyr', '旋風'],
};

interface Bot {
  id: string;
  nickname: string;
  teamId: TeamId;
  /** Average seconds between punches; varies per bot so rounds differ. */
  meanGapSec: number;
  nextAt: number;
}

/**
 * Demo punchers for rehearsals and quiet periods. They are labelled BOT on
 * every screen, have no credit and never touch payments.
 */
export class DemoBots {
  private perTeam = 0;
  private bots: Bot[] = [];
  private rng = mulberry32(Date.now() & 0xffffffff);

  constructor(
    private repo: Repo,
    private manager: MatchManager,
    private wall: WallClock,
  ) {}

  get enabledPerTeam(): number {
    return this.perTeam;
  }

  setPerTeam(n: number, actor: string): void {
    const before = this.perTeam;
    this.perTeam = Math.max(0, Math.min(100, Math.floor(n)));
    this.repo.audit(actor, 'SET_DEMO_BOTS', null, { before, after: this.perTeam }, this.wall.now());
    this.bots = [];
    // Same tapping speeds on both sides: demo crowds must never tilt the battle.
    const gaps = Array.from({ length: this.perTeam }, () => 1.5 + this.rng() * 3);
    for (const teamId of ['RAIJIN', 'FUJIN'] as TeamId[]) {
      for (let i = 0; i < this.perTeam; i++) {
        const names = BOT_NAMES[teamId];
        this.bots.push({
          id: `bot-${teamId}-${i}`,
          nickname: `BOT ${names[i % names.length]}${i >= names.length ? Math.floor(i / names.length) + 1 : ''}`,
          teamId,
          meanGapSec: gaps[i]!,
          nextAt: 0,
        });
      }
    }
  }

  /** Called from the server tick loop. */
  step(): void {
    if (this.bots.length === 0) return;
    const rt = this.manager.current();
    if (rt.state.status !== 'LIVE' || rt.state.phase !== 'ROUND') return;
    const now = this.wall.now();
    for (const bot of this.bots) {
      if (bot.nextAt === 0) bot.nextAt = now + this.rng() * bot.meanGapSec * 1000;
      if (now < bot.nextAt) continue;
      // Exponential gaps feel like real, bursty crowds.
      bot.nextAt = now + -Math.log(1 - this.rng()) * bot.meanGapSec * 1000;
      if (rt.state.phase !== 'ROUND') return;
      rt.dispatch({ type: 'ZAP', participantId: bot.id, nickname: bot.nickname, teamId: bot.teamId });
    }
  }
}
