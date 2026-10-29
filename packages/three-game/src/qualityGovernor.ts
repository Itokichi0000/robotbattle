import type { Quality } from './layout';

/**
 * Automatic quality reduction for the venue screen (spec D6/E3: "GPU高負荷
 * 検知時の自動品質低減", 30 fps stable on low). Feed it the measured FPS about
 * once a second; it answers with a new level when one is due:
 *
 *   - below `lowFps` for `downAfterS` → one step down (high → medium → low);
 *   - still below `floorFps` on low for `twoDAfterS` → '2d' (the 2D battle view);
 *   - above `highFps` for `upAfterS` → one step back up, never above `ceiling`
 *     (what the operators chose).
 *
 * Hysteresis and long windows keep it from flapping during a short spike
 * (a boss entrance, a garbage collection pause).
 */
export type GovernorLevel = Quality | '2d';

export interface GovernorOptions {
  ceiling: Quality;
  lowFps?: number;
  floorFps?: number;
  highFps?: number;
  downAfterS?: number;
  twoDAfterS?: number;
  upAfterS?: number;
}

const ORDER: Quality[] = ['low', 'medium', 'high'];

export class QualityGovernor {
  level: GovernorLevel;
  private belowSince: number | null = null;
  private floorSince: number | null = null;
  private aboveSince: number | null = null;
  private readonly o: Required<GovernorOptions>;

  constructor(opts: GovernorOptions) {
    this.o = {
      lowFps: 24,
      floorFps: 15,
      highFps: 50,
      downAfterS: 6,
      twoDAfterS: 20,
      upAfterS: 30,
      ...opts,
    };
    this.level = opts.ceiling;
  }

  /** `t` in seconds (any monotonic clock). Returns the new level when it changes. */
  sample(fps: number, t: number): GovernorLevel | null {
    if (this.level === '2d' || !Number.isFinite(fps) || fps <= 0) return null;
    const o = this.o;
    this.belowSince = fps < o.lowFps ? (this.belowSince ?? t) : null;
    this.aboveSince = fps > o.highFps ? (this.aboveSince ?? t) : null;
    this.floorSince = fps < o.floorFps && this.level === 'low' ? (this.floorSince ?? t) : null;

    const i = ORDER.indexOf(this.level);
    if (this.floorSince !== null && t - this.floorSince >= o.twoDAfterS) return this.set('2d');
    if (this.belowSince !== null && t - this.belowSince >= o.downAfterS && i > 0)
      return this.set(ORDER[i - 1]!);
    if (
      this.aboveSince !== null &&
      t - this.aboveSince >= o.upAfterS &&
      i < ORDER.indexOf(o.ceiling)
    )
      return this.set(ORDER[i + 1]!);
    return null;
  }

  private set(level: GovernorLevel): GovernorLevel {
    this.level = level;
    this.belowSince = this.aboveSince = this.floorSince = null;
    return level;
  }
}
