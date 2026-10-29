import { formatClock, ROLES, SEAT_IDS, SEATS, CITY_IDS } from '@swed/shared';
import type { MatchResult, PublicMatchState } from '@swed/shared';
import { joinInfo } from '../net';
import { useSyncExternalStore } from 'react';

export const REASON_LABEL: Record<MatchResult['reason'], { ja: string; en: string }> = {
  BOSS_DESTROYED: { ja: 'NULL CORE 撃破', en: 'NULL CORE destroyed' },
  CORE_DESTROYED: { ja: 'RAIJIN コア損壊', en: 'RAIJIN core lost' },
  CITIES_LOST: { ja: '防衛都市が陥落', en: 'Too many cities fell' },
  TIME_UP: { ja: '時間切れ', en: 'Time ran out' },
  ABORTED: { ja: '作戦中止（運営）', en: 'Stopped by operator' },
};

/** Debrief: celebrates teamwork (cities held, combos, guards). No money is ever shown. */
export function Results({ s, mt }: { s: PublicMatchState; mt: number }) {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  const r = s.result;
  const win = r?.outcome === 'VICTORY';
  const defended = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const crew = SEAT_IDS.filter((id) => s.seats[id].occupied);
  const left = s.phaseEndsAt !== null ? s.phaseEndsAt - mt : 0;
  return (
    <div className="results">
      <div>
        <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? 'VICTORY' : 'DEFEAT'}</div>
        <div className="reason">
          {win ? '撃退成功' : '防衛失敗'} /{' '}
          {r ? `${REASON_LABEL[r.reason].ja}  ${REASON_LABEL[r.reason].en}` : ''}
        </div>
        <div className="stats">
          {[
            ['防衛都市 CITIES HELD', `${defended} / ${CITY_IDS.length}`],
            ['連携 TEAM COMBOS', String(s.stats.combos)],
            ['防御 GUARDS', String(s.stats.threatsBlocked), `PERFECT ${s.stats.perfectGuards}`],
            ['撃墜 DOWNED', String(s.stats.enemiesDestroyed)],
            ['迎撃 INTERCEPTS', String(s.stats.threatsIntercepted)],
            ['最高SYNC BEST SYNC', `${Math.round(s.stats.bestSync)}%`],
          ].map(([k, v, sub]) => (
            <div key={k} className="stat sw-frame">
              <div className="k">{k}</div>
              <div className="v sw-num">
                {v}
                {sub ? <small>{sub}</small> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="next">NEXT SORTIE {formatClock(left)} 次の作戦のパイロット募集中</div>
      </div>
      <div className="crew sw-frame">
        <h3>CREW 搭乗パイロット</h3>
        <table>
          <thead>
            <tr>
              <th>SEAT</th>
              <th>PILOT</th>
              <th>ROLE</th>
              <th style={{ textAlign: 'right' }}>HITS</th>
              <th style={{ textAlign: 'right' }}>GUARDS</th>
              <th style={{ textAlign: 'right' }}>COMBOS</th>
            </tr>
          </thead>
          <tbody>
            {crew.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--sw-muted)' }}>
                  AUTO SUPPORT のみ / AUTO SUPPORT only
                </td>
              </tr>
            ) : (
              crew.map((id) => {
                const seat = s.seats[id];
                return (
                  <tr key={id}>
                    <td className="sw-num">{String(SEATS[id].no).padStart(2, '0')}</td>
                    <td>{seat.displayName}</td>
                    <td>
                      {SEATS[id].labelJa}{' '}
                      <small style={{ color: 'var(--sw-muted)' }}>
                        {ROLES[SEATS[id].role].labelEn}
                      </small>
                    </td>
                    <td className="num sw-num">{seat.stats.hits}</td>
                    <td className="num sw-num">{seat.stats.blocks}</td>
                    <td className="num sw-num">{seat.stats.combos}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {join ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 20 }}>
            <img src="/api/public/join.svg" width={120} height={120} alt="Join QR" />
            <div style={{ fontSize: 18 }}>
              SCAN TO BECOME A PILOT
              <div style={{ color: 'var(--sw-muted)', fontSize: 14, marginTop: 4 }}>
                {join.joinUrl}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
