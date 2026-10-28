'use client';
import { useEffect, useRef, useState } from 'react';
import { ACTION_LABELS, REGION_INFO } from '@sats-wars/shared';
import type { MatchConnection } from '@/lib/connection';

interface Pop {
  id: number;
  text: string;
  big: boolean;
  at: number;
}

/** Max visible: a busy crowd shouldn't bury the map in text. */
const MAX_POPS = 7;
const LIFE_MS = 2600;

/**
 * "たろう ⚡ 東北 −45" for every move, so everyone who paid sees their own
 * name on the big screen within a second.
 */
export function ActionPopups({ conn, locale }: { conn: MatchConnection; locale: 'ja' | 'en' }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const id = useRef(0);
  useEffect(
    () =>
      conn.store.onEvent((e) => {
        if (e.type !== 'PLAYER_ACTION') return;
        const d = e.data;
        const a = ACTION_LABELS[d.action];
        const where = locale === 'ja' ? REGION_INFO[d.regionId].shortJa : REGION_INFO[d.regionId].labelEn;
        const what = d.liberated
          ? locale === 'ja'
            ? '奪還！'
            : 'liberated!'
          : d.action === 'SHIELD'
            ? locale === 'ja'
              ? '結界'
              : 'barrier'
            : d.kills > 0
              ? locale === 'ja'
                ? `撃破×${d.kills}`
                : `${d.kills} down`
              : `−${d.damage}`;
        const text = `${d.nickname} ${a.icon} ${where} ${what}`;
        const big = d.liberated || d.kills > 0 || d.action === 'COMBO';
        const now = Date.now();
        setPops((prev) => [...prev.filter((p) => now - p.at < LIFE_MS).slice(-(MAX_POPS - 1)), { id: ++id.current, text, big, at: now }]);
      }),
    [conn, locale],
  );
  // Sweep expired pops even when nobody acts.
  useEffect(() => {
    const t = setInterval(() => setPops((prev) => (prev.some((p) => Date.now() - p.at >= LIFE_MS) ? prev.filter((p) => Date.now() - p.at < LIFE_MS) : prev)), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="pointer-events-none absolute left-[1.2vw] top-[24%] flex w-[24%] flex-col items-start gap-[0.4vh]" data-testid="action-pops" aria-hidden>
      {pops.map((p) => (
        <div
          key={p.id}
          className={`sw-pop-in max-w-full truncate rounded-full bg-black/65 px-3 py-0.5 font-black ${p.big ? 'text-[1.5em] text-yellow-300' : 'text-[1.3em]'}`}
          style={{ borderLeft: '5px solid #25C8D7' }}
        >
          {p.text}
        </div>
      ))}
    </div>
  );
}

interface Bubble {
  id: number;
  emoji: string;
  nickname: string;
  x: number;
  at: number;
}

/** Free cheers float up from the bottom of the screen. */
export function CheerBubbles({ conn, reducedMotion }: { conn: MatchConnection; reducedMotion: boolean }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const id = useRef(0);
  useEffect(
    () =>
      conn.onCheer((c) => {
        const now = Date.now();
        setBubbles((prev) => [
          ...prev.filter((b) => now - b.at < 3000).slice(-14),
          { id: ++id.current, emoji: c.emoji, nickname: c.nickname, x: Math.random(), at: now },
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
          // Keep clear of the centre where the map is.
          style={{ left: `${b.x < 0.5 ? 4 + b.x * 50 : 66 + (b.x - 0.5) * 50}%` }}
        >
          <span className="text-[2.6em] leading-none">{b.emoji}</span>
          <span className="rounded bg-black/60 px-1.5 text-[0.85em] font-bold">{b.nickname}</span>
        </div>
      ))}
    </div>
  );
}
