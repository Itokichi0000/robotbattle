import type { CrewMember } from '@sats-wars/shared';
import { ROLE_LABELS, ROLES } from '@sats-wars/shared';
import { ROLE_SEAT_COLORS } from './CockpitBay';
import type { ArenaDirector } from './director';

const DOTS = 20;

/**
 * Small always-on view of the cockpit for the venue HUD (spec E3: コックピット
 * 群は小さくオーバーレイ): one row of seat lamps per role. Lamps light up on
 * boarding and on a mission success, so the room sees the crew working
 * without reading names. Re-rendered by the HUD's ticker.
 */
export function CockpitStrip({
  crew,
  director,
  locale,
}: {
  crew: CrewMember[];
  director: ArenaDirector;
  locale: 'ja' | 'en';
}) {
  const t = director.time;
  return (
    <div className="sw-cockpit-strip" aria-label={locale === 'ja' ? 'コックピット' : 'Cockpit'}>
      {ROLES.map((role) => {
        const members = crew.filter((m) => m.role === role);
        return (
          <div key={role} className="sw-cockpit-row">
            <span className="sw-cockpit-role" style={{ color: ROLE_SEAT_COLORS[role] }}>
              {ROLE_LABELS[role].icon} {members.length}
            </span>
            <span className="sw-cockpit-dots">
              {members.slice(0, DOTS).map((m) => {
                const lit =
                  t - (director.pulsedAt.get(m.pilotId) ?? -99) < 1.5 ||
                  t - (director.boardedAt.get(m.pilotId) ?? -99) < 3;
                return (
                  <i
                    key={m.pilotId}
                    className={lit ? 'is-lit' : ''}
                    style={{ background: lit ? ROLE_SEAT_COLORS[role] : undefined }}
                  />
                );
              })}
              {members.length > DOTS && <b>+{members.length - DOTS}</b>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
