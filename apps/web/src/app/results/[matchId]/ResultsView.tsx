'use client';
import { useEffect, useState } from 'react';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { REGION_INFO, ROUND_END_LABELS, STATUS_LABELS, TEAM_META } from '@sats-wars/shared';
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
              {r.winnerTeamId
                ? L(`${TEAM_META[r.winnerTeamId].nameJa} 全国制覇！`, `${TEAM_META[r.winnerTeamId].nameEn} conquers Japan!`)
                : L('引き分け', 'Draw')}
            </p>
            <p className="mt-2 text-lg font-bold">
              {L('雷神', 'RAIJIN')} {r.regionCounts.RAIJIN} – {r.regionCounts.FUJIN} {L('風神', 'FUJIN')}
            </p>
          </>
        ) : (
          <p className="mt-2">{L('シーズンはまだ終わっていません', 'Season still in progress')}</p>
        )}
      </section>
      <section className="sw-panel p-4">
        <h2 className="font-black">{L('各ラウンドの記録', 'Rounds')}</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-off/60">
              <th className="text-left">#</th>
              <th className="text-left">{L('地方', 'Region')}</th>
              <th>{L('勝者', 'Winner')}</th>
              <th>{L('決まり手', 'How')}</th>
              <th>{L('パンチ数', 'Punches')}</th>
            </tr>
          </thead>
          <tbody>
            {snap.rounds.map((round) => (
              <tr key={round.index} className="border-t border-white/5 text-center">
                <td className="text-left">{round.index + 1}</td>
                <td className="text-left">{L(REGION_INFO[round.regionId].labelJa, REGION_INFO[round.regionId].labelEn)}</td>
                <td style={{ color: round.winnerTeamId ? TEAM_META[round.winnerTeamId].color : undefined }}>
                  {round.winnerTeamId ? `${TEAM_META[round.winnerTeamId].symbol} ${L(TEAM_META[round.winnerTeamId].nameJa, TEAM_META[round.winnerTeamId].nameEn)}` : '—'}
                </td>
                <td>
                  {ROUND_END_LABELS[round.endReason][locale]}
                  {round.finisher ? ` (${round.finisher.nickname})` : ''}
                </td>
                <td className="tabular-nums">
                  {round.zaps.RAIJIN} – {round.zaps.FUJIN}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="sw-panel p-4">
        <JapanMap2D regions={snap.regions} locale={locale} className="mx-auto h-80 w-full" />
      </section>
      <a href="/play" className="sw-btn flex items-center justify-center bg-amber text-navy">
        {L('次のシーズンで遊ぶ', 'Play the next season')}
      </a>
    </main>
  );
}
