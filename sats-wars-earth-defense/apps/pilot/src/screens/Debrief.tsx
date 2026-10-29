import { CITY_IDS, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { useL } from '../ui';

/** After the fight: team result plus this pilot's own contribution. No money, ever. */
export function Debrief({ s, seat }: { s: PublicMatchState; seat: SeatId }) {
  const { L } = useL();
  const win = s.result?.outcome === 'VICTORY';
  const me = s.seats[seat].stats;
  const held = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const rows: Array<[string, string]> = [
    [L('命中', 'Hits'), String(me.hits)],
    [L('与ダメージ', 'Damage'), String(me.damage)],
    [L('防御', 'Guards'), `${me.blocks}${me.perfect ? ` (PERFECT ${me.perfect})` : ''}`],
    [L('連携参加', 'Combos joined'), String(me.combos)],
  ];
  return (
    <main className="screen debrief">
      <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? 'VICTORY' : 'DEFEAT'}</div>
      <p className="sub">
        {win
          ? L('撃退成功！日本を守り抜いた', 'Japan holds!')
          : L('防衛失敗…次こそ守ろう', 'Japan fell… next time')}
      </p>
      <section className="sw-frame card">
        <h3>
          {L('あなたの戦果', 'Your sortie')} — {L(SEATS[seat].labelJa, SEATS[seat].labelEn)}
        </h3>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="sw-num">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="sw-frame card">
        <h3>{L('チーム', 'Team')}</h3>
        <dl>
          <div>
            <dt>{L('防衛都市', 'Cities held')}</dt>
            <dd className="sw-num">
              {held} / {CITY_IDS.length}
            </dd>
          </div>
          <div>
            <dt>{L('チーム連携', 'Team combos')}</dt>
            <dd className="sw-num">{s.stats.combos}</dd>
          </div>
          <div>
            <dt>{L('撃墜', 'Downed')}</dt>
            <dd className="sw-num">{s.stats.enemiesDestroyed}</dd>
          </div>
        </dl>
      </section>
      <p className="note">
        {L('まもなく次の作戦の搭乗受付が始まります', 'Boarding for the next sortie opens shortly')}
      </p>
    </main>
  );
}
