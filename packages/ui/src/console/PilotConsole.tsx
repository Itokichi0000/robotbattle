import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { CheerEmoji, Role } from '@sats-wars/shared';
import { CHEER_EMOJIS, ROLES, ROLE_LABELS } from '@sats-wars/shared';
import type { RaidClient } from '../client';
import { useGameNow } from '../hooks';
import { AllyPanel } from '../hud/Allies';
import { type CommsItem, CommsPanel, WarningPanel } from '../hud/Alerts';
import { CHEER_ICON, Icon, ROLE_ICON } from '../hud/icons';
import { fmtSecs, useReducedMotion } from '../hud/primitives';
import { TacticalMap } from '../hud/TacticalMap';
import { type LinkState, TelemetryStrip } from '../hud/Telemetry';
import { ResultCard } from '../Results';
import type { RaidLike } from '../view';
import { GunnerHud, type TargetDesignation } from './GunnerHud';
import { Hangar } from './Hangar';
import { RoleHud } from './RoleHud';
import { type SeatState, useMission, useSeatControl } from './useMission';

export interface ConsoleCallout {
  title: string;
  sub?: string;
  tone: 'ally' | 'enemy' | 'neutral';
}

export interface PilotConsoleProps {
  client: RaidClient;
  raid: RaidLike;
  seat: SeatState;
  onSeat: (patch: Partial<SeatState>) => void;
  locale: 'ja' | 'en';
  /** Easier minigames (bigger targets). Same effect per success: fairness is kept. */
  easy?: boolean;
  pilot: { callsign: string; detail?: ReactNode };
  /** The 3D battlefield. Without it, the tactical map is the backdrop (phones). */
  backdrop?: ReactNode;
  lobbyEndsAt?: number | null;
  /** Shown instead of the station list when boarding is not possible (pass needed, closed). */
  boardGate?: ReactNode;
  link?: LinkState;
  /** System buttons (sound, pause…) at the right of the telemetry band. */
  controls?: ReactNode;
  /** Extra pilot menu content (settings, passport…). */
  menu?: ReactNode;
  /** A cinematic announcement (venue director banner). */
  callout?: ConsoleCallout | null;
  comms?: CommsItem[];
  broadcast?: string | null;
  onCheer?: (e: CheerEmoji) => void;
  onLaunchNow?: () => void;
  onFocusStation?: (r: Role) => void;
  /** Buttons under the debrief (next raid, passport…). */
  debriefActions?: ReactNode;
  bestScore?: number | null;
  reducedMotion?: boolean;
  hangarExtra?: ReactNode;
  /** Written with the gunner's target so the 3D scene can box it (see ArenaScene). */
  designation?: { current: TargetDesignation | null };
}

type Screen = 'hangar' | 'battle' | 'debrief';

/**
 * The pilot console: one full-screen frame for the whole sortie. The 3D
 * battlefield (or the tactical map on phones) fills the screen; the HUD sits
 * on its edges — telemetry on top, comms and the primary warning in the upper
 * corners, Raijin and Fujin at the lower corners, the station's controls at
 * the bottom. Screens follow the raid state: hangar (not aboard or before
 * launch), battle, debrief. Every value is the server's.
 */
export function PilotConsole(props: PilotConsoleProps) {
  const { client, raid, seat, onSeat, locale } = props;
  const L = useCallback((ja: string, en: string) => (locale === 'ja' ? ja : en), [locale]);
  const gameNow = useGameNow(client.gameNow);
  const reduced = useReducedMotion(!!props.reducedMotion);
  const mission = useMission({ client, raid, seat, onSeat, easy: props.easy, L, gameNow });
  const seatCtl = useSeatControl({ client, raid, seat, onSeat, L, gameNow });
  const { view } = mission;
  const lobby = raid.status === 'LOBBY_OPEN' || raid.status === 'CREATED';
  const screen: Screen =
    raid.status === 'ENDED' ? 'debrief' : !seat.boarded || lobby ? 'hangar' : 'battle';
  const [menuOpen, setMenuOpen] = useState(false);

  // Boarding (spec 2.6): the hatch opens over ~0.9 s while the HUD powers up.
  // Pure decoration on top: input works at once, any key or tap skips it, and
  // it never waits for anything (the raid clock is the server's).
  const [booting, setBooting] = useState(false);
  const [hatch, setHatch] = useState(false);
  const prevScreen = useRef<Screen>(screen);
  useEffect(() => {
    if (screen === 'battle' && prevScreen.current !== 'battle') {
      setBooting(true);
      setHatch(!reduced);
      const id = setTimeout(() => setBooting(false), 1400);
      const id2 = setTimeout(() => setHatch(false), 1000);
      prevScreen.current = screen;
      return () => {
        clearTimeout(id);
        clearTimeout(id2);
      };
    }
    prevScreen.current = screen;
  }, [screen, reduced]);
  useEffect(() => {
    if (!hatch) return;
    const skip = () => setHatch(false);
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('pointerdown', skip, { once: true });
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [hatch]);

  // A robot took damage: a short red edge on the HUD (repairs do not flash).
  const hullSum = raid.robots.reduce((s, r) => s + r.health, 0);
  const prevHull = useRef(hullSum);
  const [hitAt, setHitAt] = useState(0);
  useEffect(() => {
    if (hullSum < prevHull.current - 0.5) setHitAt(Date.now());
    prevHull.current = hullSum;
  }, [hullSum]);
  const [, force] = useState(0);
  useEffect(() => {
    if (!hitAt) return;
    const id = setTimeout(() => force((x) => x + 1), 520);
    return () => clearTimeout(id);
  }, [hitAt]);
  const hitFlash = Date.now() - hitAt < 500;
  const lethal = Object.values(view.threats).some((t) => t?.lethal);

  const role = seat.role;
  const specialMine =
    view.specialOpen &&
    role &&
    role !== 'ENGINEER' &&
    !raid.special.contributors[role] &&
    screen === 'battle';

  const menuButton = (
    <button
      type="button"
      className="hud-icon-btn"
      aria-label={L('メニュー', 'Menu')}
      aria-expanded={menuOpen}
      onClick={() => setMenuOpen((v) => !v)}
      data-testid="console-menu"
    >
      <Icon name="menu" size={18} />
    </button>
  );

  return (
    <div
      className={`hud-root hud-console${props.backdrop ? ' has-3d' : ' has-map'}`}
      data-screen={screen}
      data-role={role ?? 'none'}
      data-boot={booting ? '1' : '0'}
      data-reduced={reduced ? '1' : '0'}
    >
      <div className="hud-backdrop">
        {props.backdrop ?? (
          <TacticalMap
            view={view}
            locale={locale}
            maxHp={raid.config.cityMaxHp}
            className="hud-map-backdrop"
          />
        )}
      </div>
      <div
        className={`hud-edge${hitFlash ? ' is-hit' : ''}${lethal && screen === 'battle' ? ' is-lethal' : ''}`}
        aria-hidden="true"
      />

      {screen === 'battle' && (
        <TelemetryStrip
          raid={raid}
          view={view}
          locale={locale}
          link={props.link}
          controls={
            <>
              <span className="hud-tm-pilot" title={L('パイロット', 'Pilot')}>
                <Icon name="pilot" size={14} />
                <span data-testid="callsign">{props.pilot.callsign}</span>
              </span>
              {props.controls}
              {menuButton}
            </>
          }
        />
      )}

      {screen !== 'battle' && (
        <>
          <header className="hud-topbar">
            <span className="hud-brand">
              SATS WARS <span>· EARTH DEFENSE</span>
            </span>
            <span className="hud-topbar-sys">
              {props.link && (
                <span
                  className={`hud-lamp hud-tone-${props.link === 'connected' ? 'ok' : props.link === 'connecting' ? 'act' : 'danger'}`}
                >
                  <i aria-hidden="true" />
                  <span data-testid="conn-pill" data-state={props.link}>
                    {props.link === 'connected'
                      ? 'NETWORK OK'
                      : props.link === 'connecting'
                        ? L('再接続中', 'RELINKING')
                        : L('切断', 'OFFLINE')}
                  </span>
                </span>
              )}
              {screen === 'debrief' && (
                <span className="hud-tm-pilot">
                  <Icon name="pilot" size={14} />
                  <span data-testid="callsign">{props.pilot.callsign}</span>
                </span>
              )}
              {props.controls}
              {menuButton}
            </span>
          </header>
        </>
      )}

      {screen === 'hangar' && (
        <>
          <Hangar
            raid={raid}
            view={view}
            seat={seat}
            locale={locale}
            L={L}
            pilot={props.pilot}
            lobbyEndsAt={props.lobbyEndsAt}
            boardGate={props.boardGate}
            seatCtl={seatCtl}
            onLaunchNow={props.onLaunchNow}
            onFocusStation={props.onFocusStation}
            extra={props.hangarExtra}
          />
        </>
      )}

      {screen === 'battle' && role && (
        <>
          <div className="hud-zone-tl">
            <CommsPanel
              items={[
                ...(props.broadcast
                  ? [{ id: 'broadcast', text: props.broadcast, tone: 'ops' as const }]
                  : []),
                ...(props.comms ?? []),
              ]}
              locale={locale}
            />
            {props.onCheer && <CheerRow onCheer={props.onCheer} L={L} />}
          </div>
          <div className="hud-zone-tr">
            <WarningPanel raid={raid} view={view} locale={locale} gameNow={gameNow} myRole={role} />
          </div>
          <AllyPanel robot={raid.robots[0]!} crew={raid.crew} locale={locale} side="left" />
          <AllyPanel robot={raid.robots[1]!} crew={raid.crew} locale={locale} side="right" />
          {specialMine && view.specialSecondsLeft !== null && (
            <div className="hud-sp-prompt" role="status" data-testid="special-prompt">
              <Icon name="sync" size={16} />
              <b>{L('神雷風陣 発動窓', 'SHINRAI FUJIN WINDOW')}</b>
              <span className="hud-num">{fmtSecs(view.specialSecondsLeft)}</span>
              <span>
                {L(
                  `あなたの${ROLE_LABELS[role].ja}の成功が必要`,
                  `Your ${ROLE_LABELS[role].en} success is needed`,
                )}
              </span>
            </div>
          )}
          {role === 'GUNNER' ? (
            <GunnerHud
              mission={mission}
              raid={raid}
              locale={locale}
              L={L}
              designation={props.designation}
            />
          ) : (
            <RoleHud role={role} mission={mission} raid={raid} locale={locale} L={L} />
          )}
        </>
      )}

      {screen === 'debrief' && raid.result && (
        <div className="hud-debrief-wrap">
          <ResultCard result={raid.result} locale={locale} bestScore={props.bestScore} />
          {props.debriefActions && (
            <div className="hud-debrief-actions">{props.debriefActions}</div>
          )}
        </div>
      )}

      {hatch && role && (
        <div className="hud-boarding" aria-hidden="true" data-testid="boarding">
          <i className="hud-boarding-plate is-top" />
          <i className="hud-boarding-plate is-bottom" />
          <span className="hud-boarding-word">
            <span className="hud-label">COCKPIT ONLINE</span>
            <b>
              {role === 'GUNNER'
                ? L('雷神 火器管制 起動', 'RAIJIN FIRE CONTROL ONLINE')
                : role === 'GUARDIAN'
                  ? L('風神 防御管制 起動', 'FUJIN SHIELD CONTROL ONLINE')
                  : role === 'ROUTER'
                    ? L('配電盤 接続', 'POWER BUS LINKED')
                    : L('整備ステーション 起動', 'DAMAGE CONTROL ONLINE')}
            </b>
          </span>
        </div>
      )}

      {props.callout && screen !== 'debrief' && (
        <div
          className={`hud-callout is-${props.callout.tone}`}
          role="status"
          data-testid="console-callout"
        >
          <b>{props.callout.title}</b>
          {props.callout.sub && <span>{props.callout.sub}</span>}
        </div>
      )}

      {raid.status === 'PAUSED' && (
        <div className="hud-hold" role="status">
          <span className="hud-label">HOLD</span>
          <b>{L('一時停止中', 'Paused')}</b>
        </div>
      )}

      {menuOpen && (
        <aside
          className="hud-menu"
          aria-label={L('メニュー', 'Menu')}
          data-testid="console-menu-panel"
        >
          <header>
            <span className="hud-label">SYSTEM</span>
            <button
              type="button"
              className="hud-icon-btn"
              onClick={() => setMenuOpen(false)}
              aria-label={L('閉じる', 'Close')}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          {screen === 'battle' && (
            <section>
              <span className="hud-label">{L('ステーション変更', 'Change station')}</span>
              <ul className="hud-menu-stations">
                {ROLES.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      className={`hud-menu-station${role === r ? ' is-mine' : ''}`}
                      onClick={() => void seatCtl.pickSeat(r).then(() => setMenuOpen(false))}
                      disabled={seatCtl.busy || role === r || seatCtl.seatLeft > 0}
                      data-testid={`change-${r}`}
                    >
                      <Icon name={ROLE_ICON[r]} size={16} />
                      {L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}
                      <span className="hud-num">{view.crewByRole[r]}</span>
                      {view.needed === r && (
                        <span className="hud-tag hud-tone-act">{L('要請', 'NEEDED')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {seatCtl.seatLeft > 0 && (
                <p className="hud-hint">
                  {L(`変更できるまで ${seatCtl.seatLeft}秒`, `Change in ${seatCtl.seatLeft}s`)}
                </p>
              )}
              {seatCtl.error && <p className="hud-error">{seatCtl.error}</p>}
            </section>
          )}
          {props.menu}
        </aside>
      )}
    </div>
  );
}

function CheerRow({
  onCheer,
  L,
}: {
  onCheer: (e: CheerEmoji) => void;
  L: (ja: string, en: string) => string;
}) {
  const [sent, setSent] = useState<CheerEmoji | null>(null);
  return (
    <div className="hud-cheers" role="group" aria-label={L('応援（無料）', 'Cheer (free)')}>
      {CHEER_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          className={`hud-cheer${sent === e ? ' is-sent' : ''}`}
          onClick={() => {
            onCheer(e);
            setSent(e);
            setTimeout(() => setSent((s) => (s === e ? null : s)), 900);
          }}
          aria-label={L(`応援：${CHEER_ICON[e].ja}`, `Cheer: ${CHEER_ICON[e].en}`)}
          title={L(CHEER_ICON[e].ja, CHEER_ICON[e].en)}
        >
          <Icon name={CHEER_ICON[e].icon} size={16} />
        </button>
      ))}
    </div>
  );
}
