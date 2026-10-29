import { enemyPositionAt } from '@swed/game-engine';
import type { Direction, PublicMatchState } from '@swed/shared';

/**
 * Low-density tactical radar, bottom-left, shown only in combat (spec §9.1). Top = RAIJIN's
 * front. Red wedges are sectors with a telegraphed strike; blips are the swarm.
 */
const R = 120;
const SECTOR_START: Record<Direction, number> = { FRONT: -45, RIGHT: 45, REAR: 135, LEFT: 225 };

function arc(startDeg: number, endDeg: number, r: number) {
  const a0 = ((startDeg - 90) * Math.PI) / 180;
  const a1 = ((endDeg - 90) * Math.PI) / 180;
  return `M 0 0 L ${Math.cos(a0) * r} ${Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r} Z`;
}

export function Radar({ s, mt }: { s: PublicMatchState; mt: number }) {
  if (s.enemies.length === 0 && s.threats.length === 0) return null;
  const hot = new Set(s.threats.map((t) => t.dir));
  return (
    <div className="radar">
      <span className="lbl">TACTICAL 戦術レーダー</span>
      <svg viewBox="-130 -130 260 260" width={260} height={260} aria-hidden>
        <circle r={R} fill="rgba(5,11,19,0.78)" stroke="rgba(91,202,218,0.45)" />
        <circle r={R * 0.66} fill="none" stroke="rgba(91,202,218,0.18)" />
        <circle r={R * 0.33} fill="none" stroke="rgba(91,202,218,0.18)" />
        {[45, 135, 225, 315].map((d) => (
          <line
            key={d}
            x1={0}
            y1={0}
            x2={Math.cos(((d - 90) * Math.PI) / 180) * R}
            y2={Math.sin(((d - 90) * Math.PI) / 180) * R}
            stroke="rgba(91,202,218,0.22)"
          />
        ))}
        {(Object.keys(SECTOR_START) as Direction[]).map((d) =>
          hot.has(d) ? (
            <path
              key={d}
              d={arc(SECTOR_START[d], SECTOR_START[d] + 90, R)}
              fill="rgba(239,89,107,0.22)"
              stroke="rgba(239,89,107,0.7)"
            />
          ) : null,
        )}
        {s.enemies.map((e) => {
          const p = enemyPositionAt(e.orbit, e.spawnedAt, mt);
          const dist = Math.min(1, Math.hypot(p.x, p.z) / 140);
          const b = ((p.bearing - 90) * Math.PI) / 180;
          const x = Math.cos(b) * dist * R;
          const y = Math.sin(b) * dist * R;
          const boss = e.kind === 'NULL_CORE';
          return boss ? (
            <rect
              key={e.id}
              x={x - 7}
              y={y - 7}
              width={14}
              height={14}
              fill="none"
              stroke="#ef596b"
              strokeWidth={2}
              transform={`rotate(45 ${x} ${y})`}
            />
          ) : (
            <circle key={e.id} cx={x} cy={y} r={e.kind === 'STRIKER' ? 5 : 3.5} fill="#ef596b" />
          );
        })}
        <path d="M0 -9 L7 7 L0 3 L-7 7 Z" fill="#5bcada" />
        <text x={0} y={-R - 4} textAnchor="middle" fill="#93aebc" fontSize={12} letterSpacing="2">
          FRONT
        </text>
      </svg>
    </div>
  );
}
