'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { GameEvent, PublicRaidSnapshot } from '@sats-wars/shared';
import { ENEMY_LABELS, SPECIAL_LABELS } from '@sats-wars/shared';
import { JapanMapMini, ResultCard, cityName, fmtClock, raidView } from '@sats-wars/ui';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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
  const highlights = snap.recentEvents.map((e) => highlight(e, L)).filter((x): x is { t: number; text: string } => !!x);
  return (
    <main className="swc-root mx-auto flex max-w-3xl flex-col gap-4 p-4" data-testid="results">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      {snap.result ? <ResultCard result={snap.result} locale={locale} bestScore={snap.bestScore} /> : <p className="sw-panel p-4">{L('作戦はまだ続いています', 'The raid is still going')}</p>}
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('最後の日本', 'Japan at the end')}</h2>
        <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
      </section>
      {highlights.length > 0 && (
        <section className="sw-panel p-4" data-testid="highlights">
          <h2 className="font-black">{L('ハイライト（終盤）', 'Highlights (final minutes)')}</h2>
          <ol className="mt-2 flex flex-col gap-1 text-sm">
            {highlights.map((h, i) => (
              <li key={i}>
                <span className="tabular-nums text-muted">{fmtClock(h.t)}</span> {h.text}
              </li>
            ))}
          </ol>
        </section>
      )}
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

function highlight(e: GameEvent, L: (ja: string, en: string) => string): { t: number; text: string } | null {
  const t = e.gameMs;
  switch (e.type) {
    case 'ENEMY_DEFEATED':
      return { t, text: `💥 ${L(ENEMY_LABELS[e.data.kind].ja, ENEMY_LABELS[e.data.kind].en)} ${L('撃破', 'destroyed')}${e.data.callsign ? ` — ${e.data.callsign}` : ''}` };
    case 'CITY_DESTROYED':
      return { t, text: `🔥 ${cityName(e.data.cityId, L)} ${L('陥落', 'fell')}` };
    case 'CITY_REBUILT':
      return { t, text: `🏗 ${cityName(e.data.cityId, L)} ${L('再建', 'rebuilt')} — ${e.data.callsign}` };
    case 'SPECIAL_RESOLVED':
      return { t, text: `⚡🌀 ${L(SPECIAL_LABELS[e.data.outcome].ja, SPECIAL_LABELS[e.data.outcome].en)}` };
    case 'PHASE_CHANGED':
      return null;
    default:
      return null;
  }
}
