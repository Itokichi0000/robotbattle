'use client';
import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '@sats-wars/shared';
import { effectSentence } from '@sats-wars/ui';
import type { RaidConnection } from '@/lib/connection';

interface Pop {
  id: number;
  text: string;
  tone: 'good' | 'miss' | 'cheer' | 'big';
  at: number;
}

/** Max visible: a busy crowd shouldn't bury the screen in text. */
const MAX_POPS = 7;
const LIFE_MS = 2800;

/**
 * 「サトシ 🛡 東京にシールド+45」 for every finished mission, so each pilot sees
 * their own name on the big screen within a second. Names arrive already
 * moderated by the server (pseudonym unless the pilot opted in).
 */
export function ActionPopups({ conn, locale }: { conn: RaidConnection; locale: 'ja' | 'en' }) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [pops, setPops] = useState<Pop[]>([]);
  const id = useRef(0);
  useEffect(() => {
    const push = (text: string, tone: Pop['tone']) =>
      setPops((p) => [...p.filter((x) => Date.now() - x.at < LIFE_MS).slice(-(MAX_POPS - 1)), { id: ++id.current, text, tone, at: Date.now() }]);
    const offs = [
      conn.store.onEvent((e) => {
        if (e.type === 'TASK_RESOLVED') {
          const d = e.data;
          const who = d.assist ? L('AI支援', 'AI assist') : d.callsign;
          push(`${who} ${ROLE_LABELS[d.role].icon} ${d.success > 0 ? effectSentence(d.effect, L) : L('ミス', 'missed')}`, d.success > 0 ? 'good' : 'miss');
        } else if (e.type === 'ENEMY_DEFEATED' && e.data.callsign) {
          push(L(`💥 ${e.data.callsign} が撃破！`, `💥 ${e.data.callsign} took it down!`), 'big');
        } else if (e.type === 'CITY_REBUILT') {
          push(L(`🏗 ${e.data.callsign} が再建！`, `🏗 ${e.data.callsign} rebuilt it!`), 'big');
        } else if (e.type === 'PILOT_BOARDED' && !e.data.isBot) {
          push(L(`🚀 ${e.data.callsign} が搭乗`, `🚀 ${e.data.callsign} boarded`), 'cheer');
        }
      }),
      conn.onCheer((c) => push(`${c.emoji} ${c.callsign}`, 'cheer')),
    ];
    const gc = setInterval(() => setPops((p) => p.filter((x) => Date.now() - x.at < LIFE_MS)), 500);
    return () => {
      offs.forEach((o) => o());
      clearInterval(gc);
    };
  }, [conn, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ul className="pointer-events-none flex flex-col items-start gap-[0.4vh]" aria-live="off" data-testid="action-popups">
      {pops.map((p) => (
        <li
          key={p.id}
          className={`sw-pop-in rounded-full px-[1vw] py-[0.3vh] text-[1.4vw] font-bold shadow-lg ${
            p.tone === 'big' ? 'bg-amber text-navy' : p.tone === 'good' ? 'bg-navy-3/90 text-off' : p.tone === 'cheer' ? 'bg-teal/80 text-navy' : 'bg-navy-2/80 text-muted'
          }`}
        >
          {p.text}
        </li>
      ))}
    </ul>
  );
}
