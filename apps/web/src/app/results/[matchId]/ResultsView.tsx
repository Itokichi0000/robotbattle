'use client';
import { useEffect, useState } from 'react';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { STATUS_LABELS } from '@sats-wars/shared';
import { JapanMap2D } from '@/components/JapanMap2D';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function ResultsView({ matchId }: { matchId: string }) {
  const { L, locale } = useI18n();
  const [snap, setSnap] = useState<PublicMatchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ snapshot: PublicMatchSnapshot }>(`/api/matches/${encodeURIComponent(matchId)}/snapshot`)
      .then((r) => setSnap(r.snapshot))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [matchId]);
  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!snap) return <p className="p-6">{L('読み込み中…', 'Loading…')}</p>;
  const r = snap.result;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Logo size="sm" />
      <section className="sw-panel p-5 text-center" data-testid="results">
        <p className="text-sm text-off/70">
          {STATUS_LABELS[snap.status][locale]} · {snap.matchId.slice(-8)}
        </p>
        {r ? (
          <>
            <p className="sw-display mt-2 text-4xl font-black text-fuchsia-200">
              {r.reason === 'CANCELLED' ? L('中止', 'Cancelled') : L(`ウェーブ${r.reachedWave}まで守りぬいた！`, `Held out until wave ${r.reachedWave}!`)}
            </p>
            <p className="mt-2 text-sm text-off/75">{L(`クリアしたウェーブ ${r.wavesCleared}`, `Waves cleared: ${r.wavesCleared}`)}</p>
          </>
        ) : (
          <p className="mt-2">{L('防衛戦はまだ続いています', 'The defence is still going')}</p>
        )}
      </section>
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('みんなの記録', 'Team record')}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {(
            [
              [L('出撃', 'Moves'), (r?.stats ?? snap.stats).actions],
              [L('撃破', 'Kills'), (r?.stats ?? snap.stats).kills],
              [L('合体技', 'Combos'), (r?.stats ?? snap.stats).combos],
              [L('敵ターン', 'Alien turns'), (r?.stats ?? snap.stats).alienTurns],
              [L('とられた', 'Captured'), (r?.stats ?? snap.stats).regionsLost],
              [L('奪還', 'Liberated'), (r?.stats ?? snap.stats).regionsLiberated],
            ] as const
          ).map(([k, val]) => (
            <div key={k} className="rounded bg-black/30 p-2">
              <dt className="text-off/65">{k}</dt>
              <dd className="sw-display text-2xl font-black tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="sw-panel p-4">
        <JapanMap2D regions={snap.regions} enemies={snap.enemies} cityHpMax={snap.config.cityHpMax} locale={locale} className="mx-auto h-80 w-full" />
      </section>
      <a href="/play" className="sw-btn flex items-center justify-center bg-amber text-navy">
        {L('次の防衛戦に参加する', 'Join the next defence')}
      </a>
    </main>
  );
}
