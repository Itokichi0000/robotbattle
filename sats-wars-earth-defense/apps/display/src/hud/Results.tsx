import { CITY_IDS, formatClock } from '@swed/shared';
import type { MatchResult, PublicMatchState } from '@swed/shared';
import { useSyncExternalStore } from 'react';
import { joinInfo } from '../net';

export const REASON_LABEL: Record<MatchResult['reason'], { ja: string; en: string }> = {
  BOSS_DESTROYED: { ja: 'NULL CORE 撃破', en: 'NULL CORE destroyed' },
  MECH_DESTROYED: { ja: '雷神が倒れた（直すが足りなかった）', en: 'RAIJIN fell' },
  CITIES_LOST: { ja: '都市を守りきれなかった', en: 'Too many cities fell' },
  TIME_UP: { ja: '時間切れ（撃つが足りなかった）', en: 'Time ran out' },
  ABORTED: { ja: '作戦中止（運営）', en: 'Stopped by operator' },
};

/** Debrief: what the crowd did together. Never who paid, never how much. */
export function Results({ s, mt }: { s: PublicMatchState; mt: number }) {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  const r = s.result;
  const win = r?.outcome === 'VICTORY';
  const defended = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const left = s.phaseEndsAt !== null ? s.phaseEndsAt - mt : 0;
  const f = s.stats.free;
  const p = s.stats.paid;
  const stats: Array<[string, string, string?]> = [
    ['守った都市 CITIES HELD', `${defended} / ${CITY_IDS.length}`],
    ['参加 PLAYERS', String(s.stats.peakPlayers)],
    ['撃つ ATTACK', String(f.ATTACK + p.ATTACK), `ダメージ ${s.stats.damageToBoss}`],
    ['守る DEFEND', String(f.DEFEND + p.DEFEND), `防いだ攻撃 ${s.stats.strikesBlocked}`],
    ['直す REPAIR', String(f.REPAIR + p.REPAIR), `回復 ${s.stats.repaired}`],
    [
      'Lightning の一撃',
      String(s.stats.lightning),
      s.stats.virtual > 0 ? `うち VIRTUAL ${s.stats.virtual}` : undefined,
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
