import type { Repo } from '../db/repo';
import { pseudonym } from '../pilots/service';

export type NameOf = (pilotId: string, callsign: string) => string;

/**
 * Apply public-name rules to any payload: every object that carries both a
 * `pilotId` and a `callsign` (event data, crew members, MVP entries…) gets the
 * moderated name. One generic pass so a new field holding a pilot's name
 * cannot slip past the consent rules.
 */
export function moderateNames<T>(value: T, nameOf: NameOf): T {
  if (Array.isArray(value)) return value.map((v) => moderateNames(v, nameOf)) as T;
  if (!value || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = moderateNames(v, nameOf);
  if (typeof src.pilotId === 'string' && typeof src.callsign === 'string') {
    out.callsign = nameOf(src.pilotId, src.callsign);
  }
  return out as T;
}

/**
 * Names for archived data, from the pilots table as it is now (a name hidden
 * later stays hidden in old results too). Unknown ids are bots / the assist AI.
 */
export function dbNameOf(repo: Repo, namesHidden: boolean): NameOf {
  const cache = new Map<string, string>();
  return (pilotId, callsign) => {
    let n = cache.get(pilotId);
    if (n === undefined) {
      const p = repo.getPilot(pilotId);
      n = !p
        ? callsign
        : namesHidden || p.callsign_hidden === 1 || p.show_name !== 1
          ? pseudonym(p.code)
          : p.callsign;
      cache.set(pilotId, n);
    }
    return n;
  };
}
