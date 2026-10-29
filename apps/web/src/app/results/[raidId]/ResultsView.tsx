'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicRaidSnapshot } from '@sats-wars/shared';
import { JapanMapMini, ResultCard, raidView } from '@sats-wars/ui';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ReplayPlayer } from './ReplayPlayer';

/** Shareable result page for one raid (no personal data beyond moderated callsigns). */
export function ResultsView({ raidId }: { raidId: string }) {
  const { L, locale } = useI18n();
  const [snap, setSnap] = useState<PublicRaidSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ snapshot: PublicRaidSnapshot }>(`/api/raids/${encodeURIComponent(raidId)}/snapshot`)
      .then((r) => setSnap(r.snapshot))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [raidId]);
  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!snap) return <p className="p-6">{L('読み込み中…', 'Loading…')}</p>;
  const view = raidView(snap, snap.gameMs);
  return (
    <main className="swc-root mx-auto flex max-w-3xl flex-col gap-4 p-4" data-testid="results">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      {snap.result ? (
        <ResultCard result={snap.result} locale={locale} bestScore={snap.bestScore} />
      ) : (
        <p className="sw-panel p-4">{L('作戦はまだ続いています', 'The raid is still going')}</p>
      )}
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('最後の日本', 'Japan at the end')}</h2>
        <div className="mx-auto max-w-md">
          <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
        </div>
      </section>
      {(snap.status === 'ENDED' || snap.status === 'CANCELLED') && <ReplayPlayer snap={snap} />}
      <p className="text-xs text-muted">
        {L('ルール', 'Rules')} {snap.configVersion} · {snap.configHash} · {snap.raidId}
      </p>
      <div className="flex gap-2">
        <Link className="sw-btn sw-focus bg-amber px-4 py-3 text-navy" href="/play">
          {L('次の作戦に搭乗', 'Board the next raid')}
        </Link>
        <Link className="sw-btn sw-focus bg-navy-3 px-4 py-3" href="/leaderboard">
          {L('ランキング', 'Leaderboard')}
        </Link>
      </div>
    </main>
  );
}
