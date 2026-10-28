import type { ReplayEvent, ReplayFrame, ReplayResponse } from '@sats-wars/shared';
import type { Repo } from '../db/repo';
import { dbNameOf, moderateNames } from './names';

const FRAME_MS = 2000;
const CACHE_MS = 60_000;

interface Cached {
  at: number;
  key: string;
  value: ReplayResponse;
}

/**
 * Replays of finished raids, built from the event log. Events are stored with
 * the callsigns pilots typed, so names are moderated here exactly like on the
 * live venue screen: the callsign only with the pilot's consent and not hidden,
 * `PILOT-xxxxx` otherwise (bots and the assist AI keep their labels). Boards are
 * sampled every 2 s of game time instead of sent with every event, which keeps
 * a 100-pilot raid around a megabyte.
 */
export class ReplayService {
  private cache = new Map<string, Cached>();

  constructor(
    private repo: Repo,
    private now: () => number,
  ) {}

  build(raidId: string, namesHidden: boolean): ReplayResponse | null {
    const key = `${raidId}:${namesHidden ? 1 : 0}`;
    const hit = this.cache.get(raidId);
    if (hit && hit.key === key && this.now() - hit.at < CACHE_MS) return hit.value;
    const raid = this.repo.getRaid(raidId);
    if (!raid || (raid.status !== 'ENDED' && raid.status !== 'CANCELLED')) return null;
    const nameOf = dbNameOf(this.repo, namesHidden);
    const raw = this.repo.loadEvents(raidId, 0, 50_000);
    const frames: ReplayFrame[] = [];
    const events: ReplayEvent[] = [];
    let nextFrameAt = 0;
    let lastPhase: string | null = null;
    for (const e of raw) {
      const { patch: _patch, ...rest } = e;
      events.push(moderateNames(rest as ReplayEvent, nameOf));
      const phaseChanged = e.patch.phase !== lastPhase;
      if (e.gameMs >= nextFrameAt || phaseChanged || e.type === 'RAID_ENDED') {
        frames.push({ gameMs: e.gameMs, board: moderateNames(e.patch, nameOf) });
        nextFrameAt = Math.floor(e.gameMs / FRAME_MS) * FRAME_MS + FRAME_MS;
        lastPhase = e.patch.phase;
      }
    }
    const value: ReplayResponse = {
      raidId,
      configHash: raid.config_hash,
      endGameMs: raw.length ? raw[raw.length - 1]!.gameMs : 0,
      frameMs: FRAME_MS,
      frames,
      events,
    };
    this.cache.set(raidId, { at: this.now(), key, value });
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
