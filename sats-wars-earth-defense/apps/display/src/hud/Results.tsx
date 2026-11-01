import { SQUAD_IDS, formatClock } from '@swed/shared';
import type { MatchResult, PublicMatchState } from '@swed/shared';
import { useSyncExternalStore } from 'react';
import { joinInfo } from '../net';

export const REASON_LABEL: Record<MatchResult['reason'], { ja: string; en: string }> = {
  BOSS_DESTROYED: { ja: 'エイリアン母艦 NULL CORE 撃破', en: 'Mothership destroyed' },
  MECH_DESTROYED: { ja: '雷神が倒れた（直すが足りなかった）', en: 'RAIJIN fell' },
  SQUADS_LOST: { ja: '部隊を守りきれなかった', en: 'Too many squads fell' },
  TIME_UP: { ja: '母艦が地球に到達（撃つが足りなかった）', en: 'The mothership reached Earth' },
  ABORTED: { ja: '作戦中止（運営）', en: 'Stopped by operator' },
};

/** Debrief: what the crowd did together. Never who paid, never how much. */
export function Results({ s, mt }: { s: PublicMatchState; mt: number }) {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  const r = s.result;
  const win = r?.outcome === 'VICTORY';
  const defended = SQUAD_IDS.filter((id) => !s.squads[id].lost).length;
  const left = s.phaseEndsAt !== null ? s.phaseEndsAt - mt : 0;
  const f = s.stats.free;
  const stats: Array<[string, string, string?]> = [
    ['残った部隊 SQUADS', `${defended} / ${SQUAD_IDS.length}`],
    ['参加 PLAYERS', String(s.stats.peakPlayers), `発進スワイプ ${s.stats.launched}人`],
    ['砲撃班 GUNNERS', String(f.ATTACK), `ダメージ ${s.stats.damageToBoss}`],
    ['防衛班 GUARDS', String(f.DEFEND), `防いだ攻撃 ${s.stats.strikesBlocked}`],
    ['整備班 ENGINEERS', String(f.REPAIR), `回復 ${s.stats.repaired}`],
    [
      '雷を呼んだ回数',
      String(s.stats.lightning),
      `弱点に直撃 ${s.stats.boltHits}/${s.stats.bolts}${s.stats.virtual > 0 ? `・うち VIRTUAL ${s.stats.virtual}` : ''}`,
    ],
  ];
  return (
    <div className="results">
      <div>
        <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? 'VICTORY' : 'DEFEAT'}</div>
        <div className="reason">
          {win ? '撃退成功' : '防衛失敗'} /{' '}
          {r ? `${REASON_LABEL[r.reason].ja}  ${REASON_LABEL[r.reason].en}` : ''}
        </div>
        <div className="stats">
          {stats.map(([k, v, sub]) => (
            <div key={k} className="stat sw-frame">
              <div className="k">{k}</div>
              <div className="v sw-num">
                {v}
                {sub ? <small>{sub}</small> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="next">
          NEXT ROUND {formatClock(left)} 次の作戦まで — このまま参加できます
        </div>
      </div>
      <div className="crew sw-frame">
        <h3>次はあなたも / JOIN THE NEXT ROUND</h3>
        <p className="join-lead">
          スマホでQRを読むだけ。ボタンは「撃つ・守る・直す」の3つ。
          <br />
          タップは無料。21 sats を送ると同じ行動の大きい版になります（任意）。
        </p>
        {join ? (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginTop: 16 }}>
            <img src="/api/public/join.svg" width={180} height={180} alt="Join QR" />
            <div style={{ fontSize: 20 }}>
              SCAN TO JOIN
              <div style={{ color: 'var(--sw-muted)', fontSize: 15, marginTop: 4 }}>
                {join.joinUrl.replace(/^https?:\/\//, '')}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
