import { useEffect, useState } from 'react';
import type { Enemy, Weakpoint } from '@sats-wars/shared';
import { ENEMY_LABELS, WEAKPOINT_LABELS } from '@sats-wars/shared';
import { successLabel } from '../board';
import { ENEMY_ICON, Icon } from '../hud/icons';
import { Gauge, Key, Tag } from '../hud/primitives';
import { GunnerGame, SightFrame } from '../minigames/Gunner';
import { useKeys } from '../minigames/common';
import type { RaidLike } from '../view';
import type { Lx, Mission } from './useMission';

/**
 * What the gunner is aiming at, for the 3D designator (brackets around the
 * enemy in the world). A mutable ref so the sweep never re-renders the page.
 */
export interface TargetDesignation {
  enemyId: number;
  weakpoint?: Weakpoint;
  state: 'select' | 'track' | 'lock' | 'fired' | 'hit' | 'miss';
}

/**
 * GUNNER station (spec C-1), the vertical slice: Raijin's sight in the centre
 * of the battlefield and one trigger under it — ENGAGE when ready, FIRE while
 * tracking, Space for both. The bottom bar carries the real charge (Raijin's
 * energy, spent on a hit) and the target's real integrity.
 */
export function GunnerHud({
  mission,
  raid,
  locale,
  L,
  designation,
}: {
  mission: Mission;
  raid: RaidLike;
  locale: 'ja' | 'en';
  L: Lx;
  designation?: { current: TargetDesignation | null };
}) {
  const { phase, chosen, options, live, cooldownLeft, busy } = mission;
  const raijin = raid.robots[0]!;
  const targetId = chosen && 'enemyId' in chosen.choice ? chosen.choice.enemyId : undefined;
  const target: Enemy | null =
    targetId !== undefined ? (raid.enemies.find((e) => e.id === targetId) ?? null) : null;
  const wp = chosen && 'weakpoint' in chosen.choice ? chosen.choice.weakpoint : undefined;
  const playing = phase.k === 'playing' || phase.k === 'sending';
  const canEngage = live && !busy && cooldownLeft === 0 && phase.k === 'idle' && options.length > 0;

  // Feed the 3D designator: chosen target (select), the live sight (track,
  // lock, fired), then the server's verdict (hit/miss).
  const [aim, setAim] = useState<'track' | 'lock' | 'fired'>('track');
  const verdict =
    phase.k === 'result'
      ? phase.result.success > 0
        ? 'hit'
        : 'miss'
      : phase.k === 'timeout'
        ? 'miss'
        : null;
  const dState: TargetDesignation['state'] =
    phase.k === 'sending' ? 'fired' : playing ? aim : (verdict ?? 'select');
  useEffect(() => {
    if (!designation) return;
    designation.current =
      targetId === undefined ? null : { enemyId: targetId, weakpoint: wp, state: dState };
  }, [designation, targetId, wp, dState]);
  useEffect(
    () => () => {
      if (designation) designation.current = null;
    },
    [designation],
  );
  useKeys((e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      mission.sortie();
    }
  }, canEngage);

  const caption = target ? (
    <span className="hud-sight-target">
      <Icon name={ENEMY_ICON[target.kind]} size={14} />
      {L(ENEMY_LABELS[target.kind].ja, ENEMY_LABELS[target.kind].en)}
      {wp && <b>{L(WEAKPOINT_LABELS[wp].ja, WEAKPOINT_LABELS[wp].en)}</b>}
    </span>
  ) : chosen ? (
    <span className="hud-sight-target">
      <Icon name="energy" size={14} />
      {chosen.label}
    </span>
  ) : null;

  let center;
  if (playing) {
    center = (
      <div className="hud-instrument hud-instrument-gunner" data-testid="minigame">
        <GunnerGame
          key={phase.task.taskId}
          params={phase.task.params as Extract<typeof phase.task.params, { role: 'GUNNER' }>}
          locale={locale}
          offsetMs={phase.k === 'playing' ? phase.offsetMs : 0}
          onSubmit={(input) => mission.submit(phase.task, input)}
          disabled={phase.k === 'sending'}
          caption={caption}
          onAim={setAim}
        />
      </div>
    );
  } else {
    const result = phase.k === 'result' ? phase.result : null;
    const hit = !!result && result.success > 0;
    const dmg = result?.effect?.kind === 'DAMAGE' ? result.effect : null;
    const state = result
      ? hit
        ? 'result-hit'
        : 'result-miss'
      : phase.k === 'timeout'
        ? 'result-miss'
        : cooldownLeft > 0
          ? 'cooldown'
          : 'idle';
    const status = result ? (
      <span className={`hud-sight-word ${hit ? 'is-hit' : 'is-miss'}`}>
        {hit
          ? dmg?.note === 'BARRIER' && dmg.amount === 0
            ? L('バリアに阻まれた', 'BLOCKED')
            : 'HIT'
          : 'MISS'}
      </span>
    ) : phase.k === 'timeout' ? (
      <span className="hud-sight-word is-miss">{L('時間切れ', 'TIME OUT')}</span>
    ) : !live ? (
      <span className="hud-sight-word">
        {raid.status === 'PAUSED' ? L('一時停止', 'HOLD') : L('待機', 'STANDBY')}
      </span>
    ) : cooldownLeft > 0 ? (
      <span className="hud-sight-word">
        {L('再装填', 'RELOAD')} <b className="hud-num">{String(cooldownLeft).padStart(2, '0')}</b>
      </span>
    ) : phase.k === 'requesting' ? (
      <span className="hud-sight-word">{L('照準起動', 'ARMING')}</span>
    ) : options.length ? (
      <span className="hud-sight-word is-ready">READY</span>
    ) : (
      <span className="hud-sight-word">{L('目標なし', 'NO TARGET')}</span>
    );
    center = (
      <div className="hud-game hud-gunner">
        <SightFrame state={state} caption={caption} status={status}>
          <div className="hud-scope-idle" />
        </SightFrame>
        {result && (
          <p
            className={`hud-result ${result.success >= 0.6 ? 'is-good' : hit ? 'is-ok' : 'is-miss'}`}
            role="status"
            data-testid="task-result"
          >
            <b>{successLabel(result.success, L)}</b>
            {dmg ? (
              dmg.note === 'BARRIER' && dmg.amount === 0 ? (
                <span>
                  {L('最終決戦まで腕・脚を狙え', 'Aim at arms and legs until the finale')}
                </span>
              ) : (
                <span>
                  <b className="hud-num">−{Math.round(dmg.amount)}</b>
                  {dmg.defeated ? L(' 撃破', ' DESTROYED') : ''}
                  {dmg.note === 'WEAKEN'
                    ? L(' 攻撃弱化', ' weakened')
                    : dmg.note === 'DELAY'
                      ? L(' 攻撃遅延', ' delayed')
                      : ''}
                </span>
              )
            ) : result.effect?.kind === 'ENERGY' ? (
              <span>
                {L(
                  `雷鼓チャージ +${Math.round(result.effect.amount)}`,
                  `Drums +${Math.round(result.effect.amount)}`,
                )}
              </span>
            ) : null}
            {result.syncGain > 0 && <span className="hud-num">SYNC +{result.syncGain}</span>}
          </p>
        )}
        {phase.k === 'timeout' && (
          <p className="hud-result is-miss" role="status">
            {L('時間切れ — 次はすばやく', 'Time up — be quicker')}
          </p>
        )}
        {mission.error && (
          <p className="hud-error hud-center-error" role="alert">
            {mission.error}
          </p>
        )}
        <button
          type="button"
          className={`hud-trigger is-engage${canEngage ? ' is-armed' : ''}`}
          onClick={() => mission.sortie()}
          disabled={!canEngage}
          data-testid="sortie"
        >
          <Icon name="gunner" size={22} />
          <span className="hud-trigger-word">
            {cooldownLeft > 0
              ? L(`再装填 ${cooldownLeft}`, `RELOAD ${cooldownLeft}`)
              : L('照準開始', 'ENGAGE')}
          </span>
          <Key k="Space" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="hud-zone-center">{center}</div>
      <div className="hud-deck hud-deck-gunner" data-testid="station-deck">
        <section className="hud-deck-left">
          <span className="hud-station-id">
            <Icon name="gunner" size={16} />
            <b>{L('砲撃席', 'GUNNER')}</b>
            <span className="hud-label">RAIJIN FCS</span>
          </span>
          <div className="hud-charge">
            <span className="hud-label">CHARGE</span>
            <b className="hud-num hud-charge-num">{Math.round(raijin.energy)}</b>
            <Gauge
              value={raijin.energy}
              tone="act"
              segments={12}
              label={L(
                '雷神の電力（命中で消費・威力が上がる）',
                'Raijin energy (spent on a hit, boosts damage)',
              )}
              showValue={false}
            />
            <span className="hud-hint">
              {L('命中で消費・威力アップ', 'Spent on a hit · more damage')}
            </span>
          </div>
        </section>
        <section className="hud-deck-right" aria-label={L('目標', 'Target')}>
          {target ? (
            <div className={`hud-target${target.ai === 'TELEGRAPH' ? ' is-attacking' : ''}`}>
              <span className="hud-label">TARGET</span>
              <span className="hud-target-name">
                <Icon name={ENEMY_ICON[target.kind]} size={16} />
                {L(ENEMY_LABELS[target.kind].ja, ENEMY_LABELS[target.kind].en)}
                {target.ai === 'TELEGRAPH' && (
                  <Tag tone="danger">{L('攻撃準備中', 'CHARGING')}</Tag>
                )}
              </span>
              <Gauge
                value={target.hp}
                max={target.hpMax}
                tone="danger"
                segments={20}
                label={L('目標の耐久', 'Target integrity')}
              />
            </div>
          ) : (
            <div className="hud-target is-empty">
              <span className="hud-label">TARGET</span>
              <span className="hud-target-name">
                {chosen ? chosen.label : L('目標なし', 'No target')}
              </span>
              {chosen?.hint && <span className="hud-hint">{chosen.hint}</span>}
            </div>
          )}
          {options.length > 1 && !playing && (
            <div className="hud-aim" role="radiogroup" aria-label={L('狙う弱点', 'Aim point')}>
              {options.map((o, i) => {
                const e =
                  'enemyId' in o.choice
                    ? raid.enemies.find((x) => x.id === o.choice.enemyId)
                    : null;
                const w = 'weakpoint' in o.choice ? o.choice.weakpoint : undefined;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={chosen?.key === o.key}
                    className={`hud-aim-opt${chosen?.key === o.key ? ' is-on' : ''}`}
                    onClick={() => mission.pick(o.key)}
                    title={o.hint}
                    data-testid={`choice-${o.key}`}
                  >
                    {e && <Icon name={ENEMY_ICON[e.kind]} size={13} />}
                    <span>
                      {e && w ? (
                        <>
                          <span className="hud-aim-who">{enemyTag(e, raid.enemies, L)}</span>
                          {L(WEAKPOINT_LABELS[w].ja, WEAKPOINT_LABELS[w].en)}
                        </>
                      ) : (
                        o.label
                      )}
                    </span>
                    {i === 0 && <small>{L('推奨', 'REC')}</small>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Short enemy tag for the aim list: the kind without the 侵蝕 prefix, and a
 * letter when two of the same kind are up (偵察機A / 偵察機B).
 */
function enemyTag(e: Enemy, all: Enemy[], L: Lx): string {
  if (e.kind === 'BOSS') return 'NULL CORE ';
  const same = all.filter((x) => x.kind === e.kind).sort((a, z) => a.id - z.id);
  const letter = same.length > 1 ? String.fromCharCode(65 + same.indexOf(e)) : '';
  const ja = ENEMY_LABELS[e.kind].ja.replace(/^侵蝕/, '');
  const en = ENEMY_LABELS[e.kind].en.replace(/^Corruptor\s+/i, '');
  return L(`${ja}${letter}・`, `${letter ? `${en} ${letter}` : en} · `);
}
