import type { Role } from '@sats-wars/shared';
import { ROLE_LABELS } from '@sats-wars/shared';
import { resultSentence, successLabel } from '../board';
import { Icon, ROLE_ICON } from '../hud/icons';
import { Gauge, Key } from '../hud/primitives';
import { Minigame } from '../minigames';
import { useKeys } from '../minigames/common';
import {
  EngineerInstruments,
  GuardianInstruments,
  type InstrumentProps,
  RouterInstruments,
} from '../stations/Instruments';
import type { RaidLike } from '../view';
import type { Lx, Mission } from './useMission';

const UNIT: Record<Exclude<Role, 'GUNNER'>, string> = {
  GUARDIAN: 'FUJIN SHIELD CONTROL',
  ROUTER: 'POWER DISTRIBUTION',
  ENGINEER: 'DAMAGE CONTROL',
};

const ACTION: Record<Exclude<Role, 'GUNNER'>, { ja: string; en: string }> = {
  GUARDIAN: { ja: '防御展開', en: 'BRACE' },
  ROUTER: { ja: '経路接続', en: 'ROUTE POWER' },
  ENGINEER: { ja: '修理開始', en: 'REPAIR' },
};

/**
 * Guardian, router and engineer stations on the same frame as the gunner:
 * the station's instruments in the bottom bar (real state, the engine's
 * recommended targets), replaced by the live instrument while a mission runs;
 * the server's verdict just above the bar. ENGAGE with the button, Space or
 * Enter.
 */
export function RoleHud({
  role,
  mission,
  raid,
  locale,
  L,
}: {
  role: Exclude<Role, 'GUNNER'>;
  mission: Mission;
  raid: RaidLike;
  locale: 'ja' | 'en';
  L: Lx;
}) {
  const { phase, live, cooldownLeft, busy, options, chosen } = mission;
  const playing = phase.k === 'playing' || phase.k === 'sending';
  const canEngage = live && !busy && cooldownLeft === 0 && phase.k === 'idle' && options.length > 0;
  useKeys((e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      mission.sortie();
    }
  }, canEngage);
  const gameNow = mission.board.gameMs;
  const inst: InstrumentProps = {
    raid,
    view: mission.view,
    options,
    chosenKey: chosen?.key ?? null,
    onPick: mission.pick,
    gameNow,
    L,
    disabled: playing,
  };
  const energy =
    role === 'GUARDIAN'
      ? {
          label: 'SHIELD POWER',
          value: raid.robots[1]!.energy,
          tone: 'fujin' as const,
          hint: L('風神の電力：シールドが強くなる', 'Fujin energy: stronger shields'),
        }
      : role === 'ROUTER'
        ? {
            label: 'RESERVE',
            value: raid.reserveEnergy,
            tone: 'info' as const,
            hint: L('予備電源：神雷風陣に必要', 'Reserve: needed for the special'),
          }
        : null;
  const result = phase.k === 'result' ? phase.result : null;
  return (
    <>
      <div className="hud-zone-center">
        {result ? (
          <p
            className={`hud-result is-center ${result.success >= 0.6 ? 'is-good' : result.success > 0 ? 'is-ok' : 'is-miss'}`}
            role="status"
            data-testid="task-result"
          >
            <b>{successLabel(result.success, L)}</b>
            <span>
              {resultSentence(result, L).replace(successLabel(result.success, L), '').trim()}
            </span>
          </p>
        ) : phase.k === 'timeout' ? (
          <p className="hud-result is-center is-miss" role="status">
            {L('時間切れ — 次はすばやく', 'Time up — be quicker')}
          </p>
        ) : null}
      </div>
      <div
        className={`hud-deck hud-deck-role hud-deck-${role.toLowerCase()}`}
        data-testid="station-deck"
      >
        <section className="hud-deck-left">
          <span className="hud-station-id">
            <Icon name={ROLE_ICON[role]} size={16} />
            <b>{L(ROLE_LABELS[role].ja, ROLE_LABELS[role].en)}</b>
            <span className="hud-label">{UNIT[role]}</span>
          </span>
          {energy && (
            <div className="hud-charge">
              <span className="hud-label">{energy.label}</span>
              <b className="hud-num hud-charge-num">{Math.round(energy.value)}</b>
              <Gauge
                value={energy.value}
                tone={energy.tone}
                segments={12}
                label={energy.hint}
                showValue={false}
              />
              <span className="hud-hint">{energy.hint}</span>
            </div>
          )}
        </section>
        <section className="hud-deck-mid">
          {playing ? (
            // The live instrument takes the station's own panel, low on the
            // screen, so the battlefield and the threatened city stay in view.
            <div className="hud-instrument hud-instrument-live" data-testid="minigame">
              <Minigame
                key={phase.task.taskId}
                task={phase.task}
                locale={locale}
                offsetMs={phase.k === 'playing' ? phase.offsetMs : 0}
                onSubmit={(input) => mission.submit(phase.task, input)}
                disabled={phase.k === 'sending'}
              />
              {phase.k === 'sending' && (
                <p className="hud-hint hud-center-note">{L('判定待ち…', 'Awaiting verdict…')}</p>
              )}
            </div>
          ) : (
            <>
              {role === 'GUARDIAN' && <GuardianInstruments {...inst} />}
              {role === 'ROUTER' && <RouterInstruments {...inst} />}
              {role === 'ENGINEER' && <EngineerInstruments {...inst} />}
            </>
          )}
        </section>
        <section className="hud-deck-act">
          <button
            type="button"
            className={`hud-trigger is-engage${canEngage ? ' is-armed' : ''}`}
            onClick={() => mission.sortie()}
            disabled={!canEngage}
            data-testid="sortie"
          >
            <Icon name={ROLE_ICON[role]} size={22} />
            <span className="hud-trigger-word">
              {!live
                ? raid.status === 'PAUSED'
                  ? L('一時停止', 'HOLD')
                  : L('待機', 'STANDBY')
                : cooldownLeft > 0
                  ? L(`次の出撃まで ${cooldownLeft}`, `NEXT IN ${cooldownLeft}`)
                  : playing
                    ? L('作業中', 'IN PROGRESS')
                    : L(ACTION[role].ja, ACTION[role].en)}
            </span>
            <Key k="Space" />
          </button>
          {mission.error && phase.k !== 'playing' && (
            <p className="hud-error" role="alert">
              {mission.error}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
