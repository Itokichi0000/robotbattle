'use client';
import { useEffect, useRef, useState } from 'react';
import type { TeamId } from '@sats-wars/shared';
import { TEAM_META } from '@sats-wars/shared';
import type { MatchConnection } from '@/lib/connection';

interface Pop {
  id: number;
  teamId: TeamId;
  text: string;
  big: boolean;
  at: number;
}

/** Max visible per side: a busy crowd shouldn't bury the robots in text. */
const MAX_PER_SIDE = 6;
const LIFE_MS = 2200;

/**
 * "たろう ⚡ −10" for every punch, in the attacker's column, so everyone who
 * paid sees their own name on the big screen within a second.
 */
export function ZapPopups({ conn }: { conn: MatchConnection }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const id = useRef(0);
  useEffect(
    () =>
      conn.store.onEvent((e) => {
        if (e.type !== 'ZAP') return;
        const d = e.data;
        const sym = TEAM_META[d.teamId].symbol;
        const text = d.code === 'KO' ? `${d.nickname} ${sym} KO!!` : d.special ? `${d.nickname} ${sym} 必殺 −${d.damage}` : `${d.nickname} ${sym} −${d.damage}`;
        const now = Date.now();
        setPops((prev) => {
          const alive = prev.filter((p) => now - p.at < LIFE_MS);
          const mine = alive.filter((p) => p.teamId === d.teamId);
          const drop = mine.length >= MAX_PER_SIDE ? new Set(mine.slice(0, mine.length - MAX_PER_SIDE + 1).map((p) => p.id)) : null;
          return [...alive.filter((p) => !drop?.has(p.id)), { id: ++id.current, teamId: d.teamId, text, big: d.special || d.code === 'KO', at: now }];
        });
      }),
    [conn],
  );
  // Sweep expired pops even when nobody punches.
  useEffect(() => {
    const t = setInterval(() => setPops((prev) => (prev.some((p) => Date.now() - p.at >= LIFE_MS) ? prev.filter((p) => Date.now() - p.at < LIFE_MS) : prev)), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      {(['RAIJIN', 'FUJIN'] as const).map((t) => (
        <div
          key={t}
          className={`pointer-events-none absolute top-[24%] flex w-[22%] flex-col gap-[0.4vh] ${t === 'RAIJIN' ? 'left-[1.2vw] items-start' : 'right-[1.2vw] items-end'}`}
          data-testid={`zap-pops-${t}`}
          aria-hidden
        >
          {pops
            .filter((p) => p.teamId === t)
            .map((p) => (
              <div
                key={p.id}
                className={`sw-pop-in max-w-full truncate rounded-full bg-black/65 px-3 py-0.5 font-black ${p.big ? 'text-[1.6em] text-yellow-300' : 'text-[1.35em]'}`}
                style={{ borderLeft: t === 'RAIJIN' ? `5px solid ${TEAM_META[t].color}` : undefined, borderRight: t === 'FUJIN' ? `5px solid ${TEAM_META[t].color}` : undefined }}
              >
                {p.text}
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

interface Bubble {
  id: number;
  teamId: TeamId;
  emoji: string;
  nickname: string;
  x: number;
  at: number;
}

/** Free cheers float up from the bottom of each team's half. */
export function CheerBubbles({ conn, reducedMotion }: { conn: MatchConnection; reducedMotion: boolean }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const id = useRef(0);
  useEffect(
    () =>
      conn.onCheer((c) => {
        const now = Date.now();
        setBubbles((prev) => [
          ...prev.filter((b) => now - b.at < 3000).slice(-14),
          { id: ++id.current, teamId: c.teamId, emoji: c.emoji, nickname: c.nickname, x: Math.random(), at: now },
        ]);
      }),
    [conn],
  );
  useEffect(() => {
    const t = setInterval(() => setBubbles((prev) => (prev.length ? prev.filter((b) => Date.now() - b.at < 3000) : prev)), 600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[16%] h-[40%] overflow-hidden" aria-hidden data-testid="cheers">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className={`absolute bottom-0 flex flex-col items-center ${reducedMotion ? '' : 'sw-cheer-up'}`}
          style={{ left: `${b.teamId === 'RAIJIN' ? 4 + b.x * 30 : 66 + b.x * 30}%` }}
        >
          <span className="text-[2.6em] leading-none">{b.emoji}</span>
          <span className="rounded bg-black/60 px-1.5 text-[0.85em] font-bold" style={{ color: TEAM_META[b.teamId].color }}>
            {b.nickname}
          </span>
        </div>
      ))}
    </div>
  );
}
