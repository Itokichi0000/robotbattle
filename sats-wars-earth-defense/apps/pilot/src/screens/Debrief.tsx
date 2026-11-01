import { SQUAD_IDS } from '@swed/shared';
import type { PublicMatchState } from '@swed/shared';
import { useL } from '../ui';

/** After the fight: the team result. Nobody's payments are listed, ever. */
export function Debrief({ s }: { s: PublicMatchState }) {
  const { L } = useL();
  const win = s.result?.outcome === 'VICTORY';
  const held = SQUAD_IDS.filter((id) => !s.squads[id].lost).length;
  const taps = s.stats.free.ATTACK + s.stats.free.DEFEND + s.stats.free.REPAIR;
  const reason =
    s.result?.reason === 'SQUADS_LOST'
      ? L('部隊を守りきれなかった', 'Too many squads fell')
      : s.result?.reason === 'MECH_DESTROYED'
        ? L('雷神が倒れた（直すが足りなかった）', 'RAIJIN fell (not enough repairs)')
        : s.result?.reason === 'TIME_UP'
          ? L(
              '母艦が地球に到達（撃つが足りなかった）',
              'The mothership reached Earth (not enough attacks)',
            )
          : '';
  return (
    <main className="screen debrief">
      <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? 'VICTORY' : 'DEFEAT'}</div>
      <p className="sub">
        {win ? L('撃退成功！地球を守り抜いた', 'Earth is safe!') : L('防衛失敗…', 'Earth fell…')}
        {reason ? <small>{reason}</small> : null}
      </p>
      <section className="sw-frame card">
        <h3>{L('みんなの戦果', 'The crowd')}</h3>
        <dl>
          <div>
            <dt>{L('残った部隊', 'Squads left')}</dt>
            <dd className="sw-num">
              {held} / {SQUAD_IDS.length}
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
