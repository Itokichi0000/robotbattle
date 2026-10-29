'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RaidResult } from '@sats-wars/shared';
import { Logo } from '@/components/Logo';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Row {
  raidId: string;
  eventId: string;
  score: number;
  outcome: string;
  endedAt: number;
  result: RaidResult | null;
}

/**
 * Team scores compared only under the same rules (config hash) and the same
 * assist setting; raids with demo bots are excluded by the server.
 */
export function LeaderboardView() {
  const { L } = useI18n();
  const [assisted, setAssisted] = useState(false);
  const [data, setData] = useState<{ configHash: string; raids: Row[] } | null>(null);
  useEffect(() => {
    api<{ configHash: string; raids: Row[] }>(`/api/leaderboard?assisted=${assisted ? 1 : 0}`)
      .then(setData)
      .catch(() => setData({ configHash: '-', raids: [] }));
  }, [assisted]);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4" data-testid="leaderboard">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      <h1 className="sw-display text-2xl">
        {L('チームスコア ランキング', 'Team score leaderboard')}
      </h1>
      <p className="text-sm text-muted">
        {L(
          '同じルール（設定ハッシュ）どうしで比べています。お金は関係ありません。',
          'Only raids with the same rules (config hash) are compared. Money plays no part.',
        )}
        {data && <span className="ml-1 font-mono">#{data.configHash}</span>}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={`sw-btn px-3 ${!assisted ? 'bg-teal text-navy' : 'bg-navy-3'}`}
          onClick={() => setAssisted(false)}
        >
          {L('通常', 'Standard')}
        </button>
        <button
          type="button"
          className={`sw-btn px-3 ${assisted ? 'bg-teal text-navy' : 'bg-navy-3'}`}
          onClick={() => setAssisted(true)}
        >
          {L('AI支援あり', 'With AI assist')}
        </button>
      </div>
      <ol className="sw-panel flex flex-col divide-y divide-line">
        {data?.raids.length === 0 && (
          <li className="p-4 text-muted">{L('まだ記録がありません', 'No records yet')}</li>
        )}
        {data?.raids.map((r, i) => (
          <li key={r.raidId} className="flex items-center justify-between gap-2 p-3">
            <span className="w-8 font-black">{i + 1}</span>
            <Link
              className="flex-1 underline-offset-2 hover:underline"
              href={`/results/${r.raidId}`}
            >
              {r.outcome === 'SUCCEEDED' ? '🏆 ' : '🔥 '}
              {new Date(r.endedAt).toLocaleString()} · {r.eventId}
            </Link>
            <span className="font-black tabular-nums">{Math.round(r.score)}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
