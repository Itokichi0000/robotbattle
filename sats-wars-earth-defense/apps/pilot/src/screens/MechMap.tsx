import { SEAT_IDS, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { ROLE_VAR } from '@swed/ui-tokens';

/**
 * RAIJIN-01 front silhouette with the eight stations numbered where they physically are,
 * so pilots understand they share one machine. `mine` highlights the pilot's own seat.
 */
const STATION_XY: Record<SeatId, [number, number]> = {
  GUNNER_L: [44, 190],
  GUNNER_R: [196, 190],
  SHIELD_L: [52, 78],
  SHIELD_R: [188, 78],
  POWER_CORE: [120, 104],
  POWER_ROUTER: [120, 58],
  ENGINEER_LEGS: [120, 236],
  ENGINEER_CORE: [120, 146],
};

export function MechMap({ s, mine }: { s: PublicMatchState | undefined; mine?: SeatId | null }) {
  return (
    <svg className="mechmap" viewBox="0 0 240 290" role="img" aria-label="RAIJIN-01 stations">
      <g fill="rgba(38,56,68,0.55)" stroke="rgba(147,174,188,0.7)" strokeWidth="1.5">
        <path d="M104 22h32l4 22h-40z" />
        <path d="M84 48h72l10 70-22 18H96l-22-18z" />
        <path d="M30 56h46l6 36-12 14H38L28 92z" />
        <path d="M164 56h46l2 36-10 14h-32l-12-14z" />
        <path d="M36 108h26l4 70H34z" />
        <path d="M178 108h26l2 70h-32z" />
        <path d="M34 178h24l-2 42h-18z" />
        <path d="M182 178h24l-2 42h-20z" />
        <path d="M92 136h56l6 24H86z" />
        <path d="M88 160h28l-4 72H90z" />
        <path d="M124 160h28l-2 72h-22z" />
        <path d="M84 232h34v18H80z" />
        <path d="M122 232h34l4 18h-38z" />
      </g>
      {SEAT_IDS.map((id) => {
        const [x, y] = STATION_XY[id];
        const seat = s?.seats[id];
        const on = !!seat?.occupied;
        const me = mine === id;
        const col = ROLE_VAR[SEATS[id].role];
        return (
          <g key={id} transform={`translate(${x} ${y})`}>
            <circle
              r={me ? 15 : 12}
              fill={on ? col : 'rgba(5,11,19,0.9)'}
              stroke={col}
              strokeWidth={me ? 3 : 1.5}
              strokeDasharray={seat && !seat.open ? '3 3' : undefined}
            />
            <text
              textAnchor="middle"
              dy="4.5"
              fontSize="12"
              fontWeight="700"
              fill={on ? '#050b13' : '#e5eef3'}
            >
              {SEATS[id].no}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
