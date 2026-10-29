import type { ReactNode } from 'react';
import { PHASE_LABELS, ROLE_LABELS, SPECIAL_LABELS, STATUS_LABELS } from '@sats-wars/shared';
import type { RaidLike, RaidView } from '../view';
import { Icon, ROLE_ICON } from './icons';
import { Gauge, Lamp, type Tone, fmtClock, fmtSecs, useFlash } from './primitives';

type Lx = (ja: string, en: string) => string;

export type LinkState = 'connected' | 'connecting' | 'offline';

/** "WAVE 02" style tag for the phase (Japanese label underneath). */
function waveTag(raid: RaidLike): string | null {
  switch (raid.phase) {
    case 'INTRO_TRAINING':
      return 'WAVE 00';
    case 'WAVE_1':
      return 'WAVE 01';
    case 'WAVE_2':
      return 'WAVE 02';
    case 'WAVE_3':
      return 'WAVE 03';
    case 'FINAL_WAVE':
      return 'FINAL';
    default:
      return null;
  }
}

/**
 * The top telemetry band (spec 3.2): WAVE, mission clock, pilots aboard,
 * NULL CORE integrity, SYNC, reserve and cities. Every value comes from the
 * raid snapshot; the bars mark the special's real thresholds from config.
 */
export function TelemetryStrip({
  raid,
  view,
  locale,
  link,
  controls,
}: {
  raid: RaidLike;
  view: RaidView;
  locale: 'ja' | 'en';
  link?: LinkState;
  /** System buttons at the right end (sound, pause, menu…). */
  controls?: ReactNode;
}) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const phase =
    raid.status === 'LIVE' || raid.status === 'ENDED'
      ? PHASE_LABELS[raid.phase]
      : STATUS_LABELS[raid.status];
  const wave = raid.status === 'LIVE' || raid.status === 'PAUSED' ? waveTag(raid) : null;
  const sp = raid.config.special;
  const live = raid.status === 'LIVE';
  const clockTone: Tone = live && view.timeLeftMs < 60_000 ? 'danger' : 'idle';
  const citiesTone: Tone =
    view.citiesStanding <= view.minCities
      ? 'danger'
      : view.citiesStanding <= view.minCities + 1
        ? 'act'
        : 'idle';
  const bossHit = useFlash(view.boss ? Math.round(view.boss.hp) : null, 450);
  const humans = raid.crew.filter((m) => !m.isBot).length;
  const bots = raid.crew.length - humans;
  const hostiles = raid.enemies.filter((e) => e.hp > 0).length;
  return (
    <header className="hud-telemetry" data-testid="raid-header">
      <div className="hud-tm-cell hud-tm-phase">
        <span className="hud-tm-wave hud-num">{wave ?? 'SATS WARS'}</span>
        <span className="hud-tm-phase-name">
          {L(phase.ja, phase.en)}
          {view.boss && live && (
            <span className="hud-tag hud-tone-danger hud-tm-bosswarn">{L('ボス', 'BOSS')}</span>
          )}
        </span>
      </div>
      <div className={`hud-tm-cell hud-tm-core${bossHit ? ' is-hit' : ''}`}>
        <span className="hud-label">
          CORE INTEGRITY
          {view.bossBarrier && (
            <span className="hud-tag hud-tone-act" data-testid="boss-barrier" role="status">
              {L('バリア', 'BARRIER')}
            </span>
          )}
        </span>
        {view.boss ? (
          <span className="hud-tm-core-row">
            <b className="hud-num hud-tm-big">{Math.round(view.boss.hp)}</b>
            <Gauge
              value={view.boss.hp}
              max={view.boss.hpMax}
              tone="danger"
              segments={30}
              label={L('NULL CORE 耐久', 'NULL CORE integrity')}
              testId="boss-hp"
              showValue={false}
            />
          </span>
        ) : (
          <span className="hud-tm-none">
            {hostiles
              ? L(`敵 ${hostiles} 機を捕捉`, `${hostiles} hostiles`)
              : L('敵影なし', 'NO CONTACT')}
          </span>
        )}
      </div>
      <div className="hud-tm-cell hud-tm-sync">
        <span className="hud-label">SYNC</span>
        <span className="hud-tm-core-row">
          <b className="hud-num hud-tm-mid">
            {Math.round(raid.sync)}
            <small>%</small>
          </b>
          <Gauge
            value={raid.sync}
            tone="info"
            segments={10}
            marker={sp.syncMinimum}
            label="SYNC"
            testId="sync"
            size="sm"
            showValue={false}
          />
        </span>
      </div>
      <div className="hud-tm-cell hud-tm-reserve">
        <span className="hud-label">{L('予備電源', 'RESERVE')}</span>
        <span className="hud-tm-core-row">
          <b className="hud-num hud-tm-mid">{Math.round(raid.reserveEnergy)}</b>
          <Gauge
            value={raid.reserveEnergy}
            tone="info"
            segments={10}
            marker={sp.energyMinimum}
            label={L('予備電源', 'Reserve')}
            size="sm"
            showValue={false}
          />
        </span>
      </div>
      {raid.special.status !== 'LOCKED' && (
        <div
          className={`hud-tm-cell hud-tm-special is-${raid.special.status.toLowerCase()}`}
          role="status"
          data-testid="special-status"
        >
          <span className="hud-label">{L('神雷風陣', 'SHINRAI FUJIN')}</span>
          <span className="hud-tm-special-row">
            {view.specialOpen && view.specialSecondsLeft !== null ? (
              <>
                <b className="hud-num hud-tm-mid">{fmtSecs(view.specialSecondsLeft)}</b>
                {(['GUNNER', 'GUARDIAN', 'ROUTER'] as const).map((r) => (
                  <span
                    key={r}
                    className={`hud-sp-pip${raid.special.contributors[r] ? ' is-done' : ''}`}
                    title={L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}
                  >
                    <Icon name={ROLE_ICON[r]} size={14} />
                    <span className="hud-sr">
                      {L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}
                      {raid.special.contributors[r] ? L('：完了', ': done') : L('：未', ': open')}
                    </span>
                  </span>
                ))}
              </>
            ) : (
              <span>
                {L(SPECIAL_LABELS[raid.special.status].ja, SPECIAL_LABELS[raid.special.status].en)}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="hud-tm-spacer" />
      <div className={`hud-tm-cell hud-tm-clock hud-tone-${clockTone}`}>
        <span className="hud-label">{L('残り時間', 'MISSION TIME')}</span>
        <b
          className="hud-num hud-tm-big"
          data-testid="raid-clock"
          aria-label={L('残り時間', 'Time left')}
        >
          {fmtClock(view.timeLeftMs)}
        </b>
      </div>
      <div className={`hud-tm-cell hud-tm-cities hud-tone-${citiesTone}`}>
        <span className="hud-label">{L('都市', 'CITIES')}</span>
        <b
          className="hud-num hud-tm-big"
          aria-label={L(
            `都市 ${view.citiesStanding}/8（${view.minCities}を下回ると陥落）`,
            `Cities ${view.citiesStanding}/8 (falls below ${view.minCities})`,
          )}
        >
          {view.citiesStanding}
          <small>/8</small>
        </b>
      </div>
      <div className="hud-tm-cell hud-tm-crew">
        <span className="hud-label">{L('搭乗', 'CREW')}</span>
        <b
          className="hud-num hud-tm-mid"
          aria-label={L(`パイロット ${humans}人`, `${humans} pilots`)}
        >
          <Icon name="crew" size={14} />
          {humans}
          {bots > 0 && <small>+{bots}</small>}
        </b>
      </div>
      <div className="hud-tm-cell hud-tm-system">
        {link && (
          <Lamp tone={link === 'connected' ? 'ok' : link === 'connecting' ? 'act' : 'danger'}>
            <span data-testid="conn-pill" data-state={link}>
              {link === 'connected'
                ? 'LINK'
                : link === 'connecting'
                  ? L('再接続', 'RELINK')
                  : L('切断', 'OFFLINE')}
            </span>
          </Lamp>
        )}
        {controls}
      </div>
    </header>
  );
}
