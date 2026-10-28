'use client';
import { useMemo } from 'react';
import type { GameEvent } from '@sats-wars/shared';
import { useI18n } from '@/lib/i18n';
import { eventMessage } from '@/lib/messages';
import { teamColor } from './TeamBits';

export function EventFeed({
  events,
  limit = 6,
  large = false,
}: {
  events: GameEvent[];
  limit?: number;
  large?: boolean;
}) {
  const { locale } = useI18n();
  const msgs = useMemo(
    () =>
      events
        .map((e) => eventMessage(e, locale))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .slice(-limit)
        .reverse(),
    [events, limit, locale],
  );
  return (
    <ul className="flex flex-col gap-1" aria-live="polite" aria-relevant="additions">
      {msgs.map((m, i) => (
        <li
          key={m.seq}
          className={`rounded-lg px-3 py-1 font-bold ${large ? (m.big ? 'text-2xl' : 'text-xl') : 'text-sm'} ${i === 0 ? 'bg-white/10' : 'bg-black/30 text-off/80'}`}
          style={{ borderLeft: `4px solid ${teamColor(m.teamId)}` }}
        >
          {m.text}
        </li>
      ))}
    </ul>
  );
}
