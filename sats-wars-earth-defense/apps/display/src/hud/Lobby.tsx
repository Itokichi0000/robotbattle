import { SEAT_IDS, SEATS } from '@swed/shared';
import type { PublicMatchState, SeatId } from '@swed/shared';
import { IconPilot, ROLE_VAR } from '@swed/ui-tokens';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { joinInfo } from '../net';
import { screen } from '../scene/anchors';
import { STATION_OF } from '../scene/Raijin';
import { ACTS } from './acts';

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

function plateStatus(
  s: PublicMatchState | undefined,
  id: SeatId,
): { cls: string; who: string; st: string } {
  const seat = s?.seats[id];
  if (seat?.occupied && seat.bot) {
    // Operator demo bots are labelled as bots and give way to the first person who boards.
    return { cls: 'auto', who: seat.displayName ?? 'DEMO-BOT', st: 'DEMO-BOT 交代可' };
  }
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
  if (seat && !seat.open) return { cls: 'auto', who: 'AUTO SUPPORT', st: 'CLOSED 運営が閉鎖' };
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
  // Seats held by demo bots are still open to people.
  const humans = s ? SEAT_IDS.filter((id) => s.seats[id].occupied && !s.seats[id].bot).length : 0;
  return (
    <>
      <div className="lobby-title">
        <h1>
          SATS WARS<span>// EARTH DEFENSE</span>
        </h1>
        <div className="slogan">ONE MECH. EIGHT PILOTS. DEFEND JAPAN.</div>
        <div className="slogan-ja">8人の力で、日本を守れ。</div>
      </div>
      {/* How to play, readable before anyone scans (D-032): three steps and what sats do. */}
      <div className="mission how sw-frame">
        <div className="kick">HOW TO PLAY 遊び方</div>
        <ol>
          <li>
            <b>QR から搭乗（無料）</b>
            <span>スマホで右の QR を読み取り、8つの席から1つ選ぶ</span>
          </li>
          <li>
            <b>4つの役割で協力</b>
            <span>撃つ・守る・電力・修理。違う役割の成功をつなぐと 雷神ゲージ がたまる</span>
          </li>
          <li>
            <b>3幕を戦い抜く</b>
            <span>
              {ACTS.WAVE_1.ja} → {ACTS.WAVE_2.ja} → {ACTS.BOSS.ja}（ゲージ満タンで必殺技）
            </span>
          </li>
        </ol>
        <div className="sats">
          <b>sats の使いみち</b>
          <span>
            炉心停止の危機のときだけ、21 sats
            で即時復旧できる（任意）。払わなくても仲間の操作で直せる
          </span>
        </div>
      </div>
      <div className="pilots-count">
        <div className="n sw-num">
          {String(humans).padStart(2, '0')} <small>PILOTS / 08 SEATS</small>
        </div>
        <div className="pips">
          {SEAT_IDS.map((id) => (
            <i key={id} className={s?.seats[id].occupied && !s.seats[id].bot ? 'on' : ''}>
              {s?.seats[id].occupied && !s.seats[id].bot ? <IconPilot size={16} /> : null}
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
          {/* Typed by hand when a camera will not read the QR: no scheme, one line. */}
          <div className="url">{join ? join.joinUrl.replace(/^https?:\/\//, '') : '...'}</div>
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
