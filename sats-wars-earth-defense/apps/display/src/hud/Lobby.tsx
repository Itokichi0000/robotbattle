import { CITY_IDS, CITY_POINTS, JAPAN_OUTLINES, SEAT_IDS, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { IconPilot, ROLE_VAR } from '@swed/ui-tokens';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { joinInfo } from '../net';
import { screen } from '../scene/anchors';
import { STATION_OF } from '../scene/Raijin';

/**
 * Attract + boarding overlay on the hangar (spec §4.1–4.2). Every seat plate is wired to the
 * physical station on RAIJIN it controls, so "eight pilots, one machine" reads at a glance.
 * The QR is the real join URL from the server; personal auth challenges never appear here.
 */

const ROW_LEFT = 64;
const ROW_W = 1920 - 128;
const GAP = 12;
const COL_W = (ROW_W - GAP * 7) / 8;
const PLATE_TOP = 1080 - 36 - 126;

function JapanMini() {
  const s = 7.5;
  const tx = (x: number) => 150 + x * s;
  const ty = (y: number) => 120 - y * s;
  return (
    <svg viewBox="0 0 300 240" width={300} height={240} aria-hidden>
      {JAPAN_OUTLINES.map((poly, i) => (
        <polygon
          key={i}
          points={poly.map((p) => `${tx(p.x).toFixed(1)},${ty(p.y).toFixed(1)}`).join(' ')}
          fill="rgba(91,202,218,0.12)"
          stroke="rgba(143,233,245,0.8)"
          strokeWidth={1}
        />
      ))}
      {CITY_IDS.map((id) => (
        <circle
          key={id}
          cx={tx(CITY_POINTS[id].x)}
          cy={ty(CITY_POINTS[id].y)}
          r={3}
          fill="#5bcada"
        />
      ))}
    </svg>
  );
}

function plateStatus(
  s: PublicMatchState | undefined,
  id: SeatId,
): { cls: string; who: string; st: string } {
  const seat = s?.seats[id];
  if (seat?.occupied) {
    return {
      cls: 'on',
      who: seat.displayName ?? 'PILOT',
      st: !seat.connected
        ? 'RECONNECTING 再接続中'
        : seat.ready
          ? 'READY 準備完了'
          : 'CONNECTED 搭乗',
    };
  }
  if (seat && !seat.open) return { cls: 'auto', who: 'AUTO SUPPORT', st: 'PHASE 2 で開放' };
  return { cls: 'wait', who: '—', st: seat?.auto ? 'WAITING / AUTO' : 'WAITING 募集中' };
}

function Leaders({ s }: { s: PublicMatchState | undefined }) {
  const paths = useRef(new Map<SeatId, SVGPathElement>());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      SEAT_IDS.forEach((id, i) => {
        const el = paths.current.get(id);
        const p = screen.get(`station:${STATION_OF[id]}`);
        if (!el) return;
        if (!p || !p.visible) {
          el.setAttribute('d', '');
          return;
        }
        const x0 = ROW_LEFT + i * (COL_W + GAP) + COL_W / 2;
        const y0 = PLATE_TOP;
        const ym = Math.max(p.y + 30, y0 - 46 - i * 6);
        el.setAttribute(
          'd',
          `M${x0.toFixed(1)} ${y0} L${x0.toFixed(1)} ${ym.toFixed(1)} L${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        );
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg className="leaders" viewBox="0 0 1920 1080" width={1920} height={1080} aria-hidden>
      {SEAT_IDS.map((id) => {
        const on = !!s?.seats[id].occupied;
        return (
          <g key={id}>
            <path
              ref={(el) => {
                if (el) paths.current.set(id, el);
              }}
              fill="none"
              stroke={on ? ROLE_VAR[SEATS[id].role] : 'rgba(147,174,188,0.35)'}
              strokeWidth={on ? 2 : 1}
              strokeDasharray={on ? undefined : '4 6'}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function Lobby({ s, attract }: { s: PublicMatchState | undefined; attract: boolean }) {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  const humans = s?.humans ?? 0;
  return (
    <>
      <div className="lobby-title">
        <h1>
          SATS WARS<span>// EARTH DEFENSE</span>
        </h1>
        <div className="slogan">ONE MECH. EIGHT PILOTS. DEFEND JAPAN.</div>
        <div className="slogan-ja">8人の力で、日本を守れ。</div>
      </div>
      {!attract ? (
        <div className="mission sw-frame">
          <div className="kick">MISSION 作戦</div>
          <h2>DEFEND JAPAN</h2>
          <p>日本列島を守れ — NULL SWARM 接近中</p>
          <JapanMini />
        </div>
      ) : null}
      <div className="pilots-count">
        <div className="n sw-num">
          {String(humans).padStart(2, '0')} <small>PILOTS / 08 SEATS</small>
        </div>
        <div className="pips">
          {SEAT_IDS.map((id) => (
            <i key={id} className={s?.seats[id].occupied ? 'on' : ''}>
              {s?.seats[id].occupied ? <IconPilot size={16} /> : null}
            </i>
          ))}
        </div>
        <div className="tag">{8 - humans} SEATS OPEN 空席 / ONE MECH, MANY PILOTS</div>
      </div>
      <div className="qr sw-frame">
        {join ? (
          <img src="/api/public/join.svg" alt={`Join: ${join.joinUrl}`} />
        ) : (
          <div style={{ width: 200, height: 200 }} />
        )}
        <div>
          <div className="scan">SCAN TO BECOME A PILOT</div>
          <div className="ja">パイロットとして参加する</div>
          <div className="url">{join?.joinUrl ?? '...'}</div>
          <div className="note">
            {join?.mode === 'sandbox'
              ? 'SANDBOX: DEMO GUEST で搭乗（テスト用・無料）'
              : 'Lightningウォレットでパイロット認証（無料）'}
          </div>
        </div>
      </div>
      {!attract ? (
        <>
          <Leaders s={s} />
          <div className="seat-row">
            {SEAT_IDS.map((id) => {
              const st = plateStatus(s, id);
              return (
                <div
                  key={id}
                  className={`seat-plate ${st.cls}`}
                  style={{ ['--role' as string]: ROLE_VAR[SEATS[id].role] }}
                >
                  <div className="no sw-num">{String(SEATS[id].no).padStart(2, '0')}</div>
                  <div className="nm">{SEATS[id].labelJa}</div>
                  <div className="en">
                    {SEATS[id].labelEn} / {SEATS[id].partJa}
                  </div>
                  <div className="who">{st.who}</div>
                  <div className="st">{st.st}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
