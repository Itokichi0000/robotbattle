'use client';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { RESULT_REASON_LABELS, TEAM_META } from '@sats-wars/shared';
import { useI18n } from '@/lib/i18n';
import type { Me } from './PlayApp';
import type { PlaySession } from './session';

export function Finished({
  snap,
  me,
  session,
  onNext,
  stale,
}: {
  snap: PublicMatchSnapshot;
  me: Me;
  session: PlaySession;
  onNext: () => void;
  stale: boolean;
}) {
  const { L, locale } = useI18n();
  const result = stale ? null : snap.result;
  const won = result?.winnerTeamId === session.teamId;
  const c = me.contribution;
  return (
    <div className="flex flex-col gap-4" data-testid="finished">
      <section className="sw-panel p-5 text-center">
        {stale ? (
          <p className="text-lg font-bold">
            {L('前の試合は終了しました。', 'Your previous match has ended.')}
          </p>
        ) : result ? (
          <>
            <p className="text-sm text-off/70">{RESULT_REASON_LABELS[result.reason][locale]}</p>
            <p
              className="sw-display mt-2 text-4xl font-black"
              style={{
                color: result.winnerTeamId ? TEAM_META[result.winnerTeamId].color : undefined,
              }}
            >
              {result.winnerTeamId
                ? L(
                    `${TEAM_META[result.winnerTeamId].nameJa}の勝利！`,
                    `${TEAM_META[result.winnerTeamId].nameEn} WINS!`,
                  )
                : L('引き分け', 'DRAW')}
            </p>
            {result.winnerTeamId && (
              <p className="mt-2 text-xl font-bold">
                {won
                  ? L('🎉 あなたのチームの勝ち！', '🎉 Your team won!')
                  : L('ナイスファイト！', 'Nice fight!')}
              </p>
            )}
            <p className="mt-2 text-sm text-off/80">
              HP {result.finalHp.RAIJIN} - {result.finalHp.FUJIN} ／ {L('地域', 'Regions')}{' '}
              {result.regionCounts.RAIJIN} - {result.regionCounts.FUJIN}
            </p>
          </>
        ) : (
          <p className="text-lg font-bold">
            {L('最終決戦中！会場スクリーンを見てね', 'Final showdown! Watch the screen')}
          </p>
        )}
      </section>
      {c && (
        <section className="sw-panel p-4">
          <h2 className="font-black">{L('あなたの貢献', 'Your contribution')}</h2>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
            {[
              [L('占領', 'Captures'), c.captures],
              [L('争奪', 'Contests'), c.contests],
              [L('防衛・奪還', 'Holds'), c.breaks],
              [L('シールド', 'Shields'), c.shields],
              [L('シールド破壊', 'Shield breaks'), c.shieldBreaks],
              [L('充電', 'Charges'), c.charges],
            ].map(([label, v]) => (
              <div key={String(label)} className="rounded-lg bg-black/30 p-2">
                <dt className="text-xs text-off/70">{label}</dt>
                <dd className="text-2xl font-black">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <a
        className="sw-btn flex items-center justify-center bg-white/10 py-3"
        href={`/results/${me.matchId}`}
      >
        {L('試合結果を見る', 'View match results')}
      </a>
      <button className="sw-btn bg-amber py-3 text-navy" onClick={onNext} data-testid="next-match">
        {L('次の試合に参加する', 'Join the next match')}
      </button>
    </div>
  );
}
