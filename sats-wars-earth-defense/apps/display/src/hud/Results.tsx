import { formatClock, ROLES, SEAT_IDS, SEATS, CITY_IDS } from '@swed/shared';
import type { MatchResult, PublicMatchState, RoleId, SeatId, SeatStats } from '@swed/shared';
import { joinInfo } from '../net';
import { useSyncExternalStore } from 'react';

export const REASON_LABEL: Record<MatchResult['reason'], { ja: string; en: string }> = {
  BOSS_DESTROYED: { ja: 'NULL CORE 撃破', en: 'NULL CORE destroyed' },
  CORE_DESTROYED: { ja: 'RAIJIN コア損壊', en: 'RAIJIN core lost' },
  CITIES_LOST: { ja: '防衛都市が陥落', en: 'Too many cities fell' },
  TIME_UP: { ja: '時間切れ', en: 'Time ran out' },
  ABORTED: { ja: '作戦中止（運営）', en: 'Stopped by operator' },
};

/** What each role's work is counted in (each role is celebrated for its own job). */
const WORK_LABEL: Record<RoleId, string> = {
  GUNNER: 'HITS',
  DEFENSE: 'GUARDS',
  POWER: 'ROUTES',
  ENGINEER: 'REPAIRS',
};
function work(id: SeatId, st: SeatStats): number {
  const role = SEATS[id].role;
  return role === 'GUNNER'
    ? st.hits
    : role === 'DEFENSE'
      ? st.blocks
      : role === 'POWER'
        ? st.routes
        : st.repairs;
}

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
            [
              '撃墜 DOWNED',
              String(s.stats.enemiesDestroyed),
              `INTERCEPT ${s.stats.threatsIntercepted}`,
            ],
            ['修理 REPAIRS', String(s.stats.repairs)],
            ['回路復旧 RE-ROUTES', String(s.stats.routesFixed), `OVERLOAD ${s.stats.overloads}`],
            ['必殺技 OVERDRIVE', String(s.stats.overdrives)],
            // Counts only, never who paid (spec §8.2): how the crew got through the blackouts.
            [
              '炉心停止の復旧 BLACKOUTS',
              `${s.stats.blackouts - s.stats.blackoutsFailed} / ${s.stats.blackouts}`,
              `仲間 ${s.stats.blackoutsByRoute} · sats ${s.stats.blackoutsByPulse}`,
            ],
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
              <th style={{ textAlign: 'right' }}>WORK</th>
              <th style={{ textAlign: 'right' }}>COMBOS</th>
              <th style={{ textAlign: 'right' }}>SYNC NOW</th>
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
                    <td>
                      {seat.displayName}
                      {seat.bot ? <small style={{ color: 'var(--sw-muted)' }}> BOT</small> : null}
                    </td>
                    <td>
                      {SEATS[id].labelJa}{' '}
                      <small style={{ color: 'var(--sw-muted)' }}>
                        {ROLES[SEATS[id].role].labelEn}
                      </small>
                    </td>
                    <td className="num sw-num">
                      {work(id, seat.stats)} <small>{WORK_LABEL[SEATS[id].role]}</small>
                    </td>
                    <td className="num sw-num">{seat.stats.combos}</td>
                    <td className="num sw-num">{seat.stats.syncs}</td>
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
