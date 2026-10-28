'use client';
import { useEffect, useState } from 'react';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { RESULT_REASON_LABELS, STATUS_LABELS, TEAM_META } from '@sats-wars/shared';
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
            <p className="sw-display mt-2 text-4xl font-black" style={{ color: r.winnerTeamId ? TEAM_META[r.winnerTeamId].color : undefined }}>
              {r.winnerTeamId ? L(`${TEAM_META[r.winnerTeamId].nameJa}の勝利！`, `${TEAM_META[r.winnerTeamId].nameEn} WINS!`) : RESULT_REASON_LABELS[r.reason][locale]}
            </p>
            <p className="mt-1">{RESULT_REASON_LABELS[r.reason][locale]}</p>
            <p className="mt-2">
              HP {r.finalHp.RAIJIN} - {r.finalHp.FUJIN} · {L('地域', 'Regions')} {r.regionCounts.RAIJIN} - {r.regionCounts.FUJIN}
            </p>
          </>
        ) : (
          <p className="mt-2">{L('試合はまだ終わっていません', 'Match still in progress')}</p>
        )}
      </section>
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('激突の記録', 'Clashes')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-off/60">
              <th className="text-left">#</th>
              <th>{L('雷神→', 'RAIJIN→')}</th>
              <th>{L('風神→', 'FUJIN→')}</th>
              <th>HP</th>
            </tr>
          </thead>
          <tbody>
            {snap.clashes.map((c) => (
              <tr key={c.clashIndex} className="border-t border-white/5 text-center">
                <td className="text-left">{c.clashIndex + 1}</td>
                <td>
                  {c.outcome.RAIJIN.damageDealt}
                  {c.outcome.RAIJIN.special ? ' ⚡' : ''}
                </td>
                <td>
                  {c.outcome.FUJIN.damageDealt}
                  {c.outcome.FUJIN.special ? ' 🌀' : ''}
                </td>
                <td>
                  {c.outcome.RAIJIN.hpAfter} - {c.outcome.FUJIN.hpAfter}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="sw-panel p-4">
        <JapanMap2D regions={snap.regions} locale={locale} className="mx-auto h-80 w-full" />
      </section>
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('チーム貢献トップ', 'Top contributors')}</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          {(['RAIJIN', 'FUJIN'] as const).map((t) => (
            <ol key={t} className="list-decimal pl-5" style={{ color: TEAM_META[t].color }}>
              {snap.leaders[t].map((l) => (
                <li key={l.participantId}>
                  <span className="text-off">
                    {l.nickname}
                    {l.isBot ? ' (BOT)' : ''} — {l.score}
                  </span>
                </li>
              ))}
            </ol>
          ))}
        </div>
      </section>
      <a href="/play" className="sw-btn flex items-center justify-center bg-amber text-navy">
        {L('次の試合に参加', 'Join the next match')}
      </a>
    </main>
  );
}
