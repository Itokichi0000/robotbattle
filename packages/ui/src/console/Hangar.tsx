import { type ReactNode, useState } from 'react';
import type { Role } from '@sats-wars/shared';
import { ROLES, ROLE_LABELS } from '@sats-wars/shared';
import { Icon, ROLE_ICON } from '../hud/icons';
import { fmtClock, fmtSecs } from '../hud/primitives';
import { TrainingPanel } from '../Training';
import type { RaidLike, RaidView } from '../view';
import type { Lx, SeatState } from './useMission';

const ROBOT_OF: Record<Role, { ja: string; en: string }> = {
  GUNNER: { ja: '雷神', en: 'RAIJIN' },
  GUARDIAN: { ja: '風神', en: 'FUJIN' },
  ROUTER: { ja: '両機', en: 'BOTH' },
  ENGINEER: { ja: '両機', en: 'BOTH' },
};

/**
 * Screen A (spec 2): the hangar. The robots are the backdrop; the pilot's ID
 * sits bottom-left, mission control bottom-right with the station list (role,
 * robot, pilots aboard, the station the robots need), then 搭乗する. Once
 * aboard: READY until launch. Practice is a secondary entry. Boarding uses
 * the same server calls as before; nothing here decides anything.
 */
export function Hangar({
  raid,
  view,
  seat,
  locale,
  L,
  pilot,
  lobbyEndsAt,
  boardGate,
  seatCtl,
  onLaunchNow,
  onFocusStation,
  extra,
}: {
  raid: RaidLike;
  view: RaidView;
  seat: SeatState;
  locale: 'ja' | 'en';
  L: Lx;
  pilot: { callsign: string; detail?: ReactNode };
  lobbyEndsAt?: number | null;
  /** Shown instead of the station list when boarding is not possible (pass, closed). */
  boardGate?: ReactNode;
  seatCtl: { pickSeat: (r: Role) => Promise<void>; busy: boolean; error: string | null };
  onLaunchNow?: () => void;
  /** The selected station (the 3D hangar looks at its robot). */
  onFocusStation?: (r: Role) => void;
  extra?: ReactNode;
}) {
  const [selected, setSelected] = useState<Role | null>(seat.role);
  const [practice, setPractice] = useState(false);
  const live = raid.status === 'LIVE' || raid.status === 'PAUSED';
  const lobbyLeft = lobbyEndsAt ? Math.max(0, Math.ceil((lobbyEndsAt - Date.now()) / 1000)) : null;
  const sel = selected ?? seat.role;
  const ready = seat.boarded && !live;
  const choose = (r: Role) => {
    setSelected(r);
    onFocusStation?.(r);
  };
  const confirm = () => {
    if (sel && (!seat.boarded || sel !== seat.role)) void seatCtl.pickSeat(sel);
  };
  return (
    <div className="hud-hangar" data-testid="hangar">
      <div className="hud-hangar-title">
        <span className="hud-label">{live ? 'MISSION IN PROGRESS' : 'HANGAR · DEPLOYMENT'}</span>
        <h1>
          {live
            ? L('作戦進行中 — 合流せよ', 'Mission under way — join in')
            : L('出撃準備', 'Prepare to launch')}
        </h1>
        <p className="hud-hangar-count">
          {live ? (
            <>
              <span className="hud-label">{L('残り', 'T-MINUS')}</span>
              <b className="hud-num">{fmtClock(view.timeLeftMs)}</b>
            </>
          ) : lobbyLeft !== null ? (
            <>
              <span className="hud-label">{L('発進まで', 'LAUNCH IN')}</span>
              <b className="hud-num" data-testid="lobby-countdown">
                {fmtSecs(lobbyLeft)}
              </b>
            </>
          ) : (
            <span className="hud-label">
              {L('最初のパイロットを待機中', 'Waiting for the first pilot')}
            </span>
          )}
          <span className="hud-hangar-crew">
            <Icon name="crew" size={14} />
            <b className="hud-num">{raid.crew.filter((m) => !m.isBot).length}</b>
            {L('人 搭乗', ' aboard')}
            {raid.crew.some((m) => m.isBot) && (
              <small>
                {L(
                  `＋BOT ${raid.crew.filter((m) => m.isBot).length}`,
                  ` + ${raid.crew.filter((m) => m.isBot).length} bots`,
                )}
              </small>
            )}
          </span>
        </p>
        {onLaunchNow && !live && (
          <button type="button" className="hud-btn" onClick={onLaunchNow} data-testid="launch-now">
            <Icon name="launch" size={16} />
            {L('すぐ発進', 'Launch now')}
          </button>
        )}
      </div>

      <section className="hud-pilot-id" aria-label={L('パイロット', 'Pilot')}>
        <span className="hud-label">PILOT ID</span>
        <b className="hud-pilot-name">
          <Icon name="pilot" size={16} />
          <span data-testid="callsign">{pilot.callsign}</span>
        </b>
        {pilot.detail}
      </section>

      <section className="hud-mission" aria-label={L('ミッションコントロール', 'Mission control')}>
        <span className="hud-label">MISSION CONTROL · {L('ステーション', 'STATIONS')}</span>
        {boardGate && !seat.boarded ? (
          boardGate
        ) : (
          <>
            <div
              className="hud-stations"
              role="radiogroup"
              aria-label={L('ステーションを選ぶ', 'Choose a station')}
            >
              {ROLES.map((r) => {
                const lab = ROLE_LABELS[r];
                const isSel = sel === r;
                const isMine = seat.boarded && seat.role === r;
                const needed = live && view.needed === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    className={`hud-station${isSel ? ' is-sel' : ''}${isMine ? ' is-mine' : ''}`}
                    onClick={() => choose(r)}
                    disabled={seatCtl.busy}
                    data-testid={`seat-${r}`}
                  >
                    <Icon name={ROLE_ICON[r]} size={22} />
                    <span className="hud-station-main">
                      <b>{L(lab.ja, lab.en)}</b>
                      <span>{L(lab.doJa, lab.doEn)}</span>
                    </span>
                    <span className="hud-station-robot hud-label">
                      {L(ROBOT_OF[r].ja, ROBOT_OF[r].en)}
                    </span>
                    <span
                      className="hud-station-crew hud-num"
                      aria-label={L(`${view.crewByRole[r]}人`, `${view.crewByRole[r]} pilots`)}
                    >
                      <Icon name="crew" size={12} />
                      {view.crewByRole[r]}
                    </span>
                    {isMine ? (
                      <span className="hud-tag hud-tone-ok">{L('搭乗中', 'ABOARD')}</span>
                    ) : needed ? (
                      <span className="hud-tag hud-tone-act">{L('要請', 'NEEDED')}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {ready && sel === seat.role ? (
              <p className="hud-ready" data-testid="cockpit-wait" role="status">
                <Icon name="check" size={16} />
                <b>{L('出撃準備完了', 'READY')}</b>
                <span>
                  {L(
                    '発進を待て。ステーションはまだ変えられる',
                    'Stand by for launch. You can still switch stations',
                  )}
                </span>
              </p>
            ) : (
              <button
                type="button"
                className="hud-trigger is-board"
                onClick={confirm}
                disabled={!sel || seatCtl.busy || (seat.boarded && sel === seat.role)}
                data-testid="board-confirm"
              >
                <Icon name={sel ? ROLE_ICON[sel] : 'station'} size={20} />
                <span className="hud-trigger-word">
                  {!sel
                    ? L('ステーションを選択', 'Choose a station')
                    : seat.boarded
                      ? L(`${ROLE_LABELS[sel].ja}に移る`, `Move to ${ROLE_LABELS[sel].en}`)
                      : L(`${ROLE_LABELS[sel].ja}に搭乗する`, `Board as ${ROLE_LABELS[sel].en}`)}
                </span>
              </button>
            )}
          </>
        )}
        {seatCtl.error && (
          <p className="hud-error" role="alert">
            {seatCtl.error}
          </p>
        )}
      </section>

      <div className="hud-hangar-foot">
        <button
          type="button"
          className="hud-btn"
          aria-expanded={practice}
          onClick={() => setPractice((v) => !v)}
          data-testid="practice-toggle"
        >
          <Icon name="sim" size={16} />
          {L('練習（本番に影響なし）', 'Practice (no effect on the raid)')}
        </button>
        {extra}
      </div>

      {practice && (
        <div className="hud-sim-sheet">
          <TrainingPanel
            locale={locale}
            initialRole={sel ?? 'GUNNER'}
            onClose={() => setPractice(false)}
          />
        </div>
      )}
    </div>
  );
}
