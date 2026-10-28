import { mulberry32 } from '@sats-wars/game-engine';
import type { WallClock } from '../clock';
import type { Repo } from '../db/repo';
import type { MatchManager } from '../match/manager';

const BOT_NAMES = ['雷丸', 'イナズマ', '疾風', 'ツムジ', 'Volt', 'Gale', '太鼓番', '風袋番', 'Spark', 'Zephyr'];

interface Bot {
  id: string;
  nickname: string;
  /** Average seconds between actions; varies per bot so the pace feels human. */
  meanGapSec: number;
  nextAt: number;
}

/**
 * Demo defenders for rehearsals. They are labelled BOT on every screen, have
 * no credit, never touch payments, and always use the おすすめ (AUTO) action.
 * Off by default: in this game every action moves the aliens too, so bots
 * playing on their own would decide the campaign without any paying player.
 */
export class DemoBots {
  private count = 0;
  private bots: Bot[] = [];
  private rng = mulberry32(Date.now() & 0xffffffff);

  constructor(
    private repo: Repo,
    private manager: MatchManager,
    private wall: WallClock,
  ) {}

  get enabledCount(): number {
    return this.count;
  }

  setCount(n: number, actor: string): void {
    const before = this.count;
    this.count = Math.max(0, Math.min(50, Math.floor(n)));
    this.repo.audit(actor, 'SET_DEMO_BOTS', null, { before, after: this.count }, this.wall.now());
    this.bots = Array.from({ length: this.count }, (_, i) => ({
      id: `bot-${i}`,
      nickname: `BOT ${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? Math.floor(i / BOT_NAMES.length) + 1 : ''}`,
      meanGapSec: 2 + this.rng() * 4,
      nextAt: 0,
    }));
  }

  /** Called from the server tick loop. */
  step(): void {
    if (this.bots.length === 0) return;
    const rt = this.manager.current();
    if (rt.state.status !== 'LIVE') return;
    const now = this.wall.now();
    for (const bot of this.bots) {
      if (bot.nextAt === 0) bot.nextAt = now + this.rng() * bot.meanGapSec * 1000;
      if (now < bot.nextAt) continue;
      bot.nextAt = now + -Math.log(1 - this.rng()) * bot.meanGapSec * 1000;
      if (rt.state.status !== 'LIVE') return;
      rt.dispatch({ type: 'ACT', participantId: bot.id, nickname: bot.nickname, action: 'AUTO' });
    }
  }
}
