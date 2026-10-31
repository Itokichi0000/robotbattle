import { CITY_IDS } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { useL } from '../ui';

/** After the fight: the team result. Nobody's payments are listed, ever. */
export function Debrief({ s }: { s: PublicMatchState }) {
  const { L } = useL();
  const win = s.result?.outcome === 'VICTORY';
  const held = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const taps = s.stats.free.ATTACK + s.stats.free.DEFEND + s.stats.free.REPAIR;
  const reason =
    s.result?.reason === 'CITIES_LOST'
      ? L('都市を守りきれなかった', 'Too many cities fell')
      : s.result?.reason === 'MECH_DESTROYED'
        ? L('雷神が倒れた（直すが足りなかった）', 'RAIJIN fell (not enough repairs)')
        : s.result?.reason === 'TIME_UP'
          ? L('時間切れ（撃つが足りなかった）', 'Out of time (not enough attacks)')
          : '';
  return (
    <main className="screen debrief">
      <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? 'VICTORY' : 'DEFEAT'}</div>
      <p className="sub">
        {win ? L('撃退成功！日本を守り抜いた', 'Japan holds!') : L('防衛失敗…', 'Japan fell…')}
        {reason ? <small>{reason}</small> : null}
      </p>
      <section className="sw-frame card">
        <h3>{L('みんなの戦果', 'The crowd')}</h3>
        <dl>
          <div>
            <dt>{L('守った都市', 'Cities held')}</dt>
            <dd className="sw-num">
              {held} / {CITY_IDS.length}
            </dd>
          </div>
          <div>
            <dt>{L('参加', 'Players')}</dt>
            <dd className="sw-num">{s.stats.peakPlayers}</dd>
          </div>
          <div>
            <dt>{L('タップ', 'Taps')}</dt>
            <dd className="sw-num">{taps}</dd>
          </div>
          <div>
            <dt>{L('Lightning の一撃', 'Lightning actions')}</dt>
            <dd className="sw-num">{s.stats.lightning}</dd>
          </div>
        </dl>
      </section>
      <p className="note">
        {L(
          'このまま待つと次の作戦に自動で参加します',
          'Stay here: you join the next round automatically',
        )}
      </p>
    </main>
  );
}
