import type { RaidResult } from '@sats-wars/shared';
import { ROLE_LABELS, SPECIAL_LABELS } from '@sats-wars/shared';
import { fmtClock } from './Hud';

type Lx = (ja: string, en: string) => string;

const REASON: Record<RaidResult['reason'], { ja: string; en: string }> = {
  BOSS_DEFEATED: { ja: 'NULL CORE 撃破', en: 'NULL CORE destroyed' },
  TIMEOUT: { ja: '時間切れ', en: 'Time ran out' },
  CITIES_LOST: { ja: '日本陥落（都市が足りない）', en: 'Japan fell (too few cities)' },
  ADMIN_END: { ja: '運営により終了', en: 'Ended by staff' },
  CANCELLED: { ja: '中止', en: 'Cancelled' },
};

const MVP_ICON: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ROLE_LABELS).map(([k, v]) => [k, v.icon])),
  SYNC: '🤝',
};
const MVP_NAME: Record<string, { ja: string; en: string }> = {
  GUNNER: { ja: '最優秀砲撃手', en: 'Top gunner' },
  GUARDIAN: { ja: '最優秀守護者', en: 'Top guardian' },
  ROUTER: { ja: '最優秀接続手', en: 'Top router' },
  ENGINEER: { ja: '最優秀整備士', en: 'Top engineer' },
  SYNC: { ja: '連携の要', en: 'Heart of the team' },
};

/** End-of-raid card: outcome, score breakdown and MVPs (names already moderated by the server). */
export function ResultCard({
  result,
  locale,
  bestScore,
}: {
  result: RaidResult;
  locale: 'ja' | 'en';
  bestScore?: number | null;
}) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const won = result.outcome === 'SUCCEEDED';
  const s = result.score;
  const rows: Array<[string, number]> = [
    [L('都市の生存', 'Cities saved'), s.citySurvival],
    [L('撃破の速さ', 'Speed'), s.speed],
    [L('連携（SYNC）', 'Teamwork (SYNC)'), s.coordination],
    [L('ボス撃破', 'Boss defeated'), s.bossDefeat],
  ];
  return (
    <section className={`swc-resultcard ${won ? 'is-win' : 'is-lose'}`} data-testid="result-card">
      <h2 className="swc-result-title">
        {won
          ? L('地球防衛 成功！', 'EARTH DEFENDED!')
          : result.outcome === 'CANCELLED'
            ? L('作戦中止', 'Raid cancelled')
            : L('防衛失敗…', 'Defence failed…')}
      </h2>
      <p className="swc-muted">
        {L(REASON[result.reason].ja, REASON[result.reason].en)}
        {result.clearTimeMs !== null
          ? L(`（${fmtClock(result.clearTimeMs)}で撃破）`, ` (at ${fmtClock(result.clearTimeMs)})`)
          : ''}
        {' ・ '}
        {L(`残った都市 ${result.survivingCities}/8`, `${result.survivingCities}/8 cities left`)}
        {' ・ '}
        {L(SPECIAL_LABELS[result.special].ja, SPECIAL_LABELS[result.special].en)}
      </p>
      <div className="swc-score">
        <span className="swc-score-total" data-testid="score-total">
          {Math.round(s.total)}
        </span>
        <span className="swc-muted">{L('チームスコア', 'Team score')}</span>
        {bestScore != null && (
          <span className="swc-muted">
            {L(
              `同じルールの最高 ${Math.round(bestScore)}`,
              `Best with same rules ${Math.round(bestScore)}`,
            )}
          </span>
        )}
      </div>
      <dl className="swc-score-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{Math.round(v)}</dd>
          </div>
        ))}
      </dl>
      {Object.keys(result.mvps).length > 0 && (
        <ul className="swc-mvps" aria-label="MVP">
          {Object.entries(result.mvps).map(([k, m]) =>
            m ? (
              <li key={k}>
                <span aria-hidden="true">{MVP_ICON[k]}</span> {L(MVP_NAME[k]!.ja, MVP_NAME[k]!.en)}
                ：<b>{m.callsign}</b>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <p className="swc-muted swc-small">
        {L(`パイロット ${result.pilots}人`, `${result.pilots} pilots`)}
        {result.bots > 0 ? L(`＋デモ機 ${result.bots}`, ` + ${result.bots} demo bots`) : ''}
        {result.assisted ? L('・AI支援あり', ' · AI assist') : ''}
      </p>
    </section>
  );
}
