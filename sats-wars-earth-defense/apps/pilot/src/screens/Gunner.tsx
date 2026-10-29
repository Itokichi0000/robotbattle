import { useStore, useTicker } from '@swed/client';
import { enemyPositionAt, recommendTarget } from '@swed/game-engine';
import type { GunnerSeatId, PublicEnemy, PublicMatchState } from '@swed/shared';
import { COLORS, IconCrosshair, IconLock, IconWarning } from '@swed/ui-tokens';
import { useEffect, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, Gauge, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * GUNNER console (spec §5.3, §9.3, ref 06): target scope → LOCK → CHARGE → FIRE.
 * One or two taps; the server decides hit and damage. The scope shows where the swarm is
 * relative to RAIJIN's facing, red when an enemy has a telegraphed attack running.
 */

const W = 360;
const H = 210;

function scopeXY(e: PublicEnemy, mt: number) {
  const p = enemyPositionAt(e.orbit, e.spawnedAt, mt);
  const horiz = Math.hypot(p.x, p.z);
  const elev = (Math.atan2(p.y - 9, horiz) * 180) / Math.PI;
  const b = Math.max(-125, Math.min(125, p.bearing));
  return {
    x: W / 2 + (b / 125) * (W / 2 - 22),
    y: H - 26 - elev * 4.2,
    off: Math.abs(p.bearing) > 125,
    dist: horiz,
  };
}

const KIND_LABEL: Record<string, string> = {
  DRONE: 'NULL DRONE',
  STRIKER: 'NULL STRIKER',
  NULL_CORE: 'NULL CORE',
};

export function Gunner({ seat }: { seat: GunnerSeatId }) {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(80);
  const s = st.snap?.state as PublicMatchState;
  const mt = store.matchTime(now);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' }>({
    text: '',
    tone: 'info',
  });

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'weapon_fired' && e.seatId === seat && !e.auto) {
          haptic(30);
          setMsg({
            text: e.killed
              ? L(`撃墜！ −${e.damage}`, `DOWN! −${e.damage}`)
              : L(
                  `命中 −${e.damage}${e.weak ? ' 弱点' : ''}`,
                  `HIT −${e.damage}${e.weak ? ' WEAK' : ''}`,
                ),
            tone: 'ok',
          });
        }
        if (e.type === 'weapon_charged' && e.seatId === seat) {
          haptic(15);
          setMsg({ text: L('チャージ完了 — FIRE!', 'Charged — FIRE!'), tone: 'ok' });
        }
        if (e.type === 'team_combo')
          setMsg({ text: `LINK ESTABLISHED +${e.gain} SYNC`, tone: 'ok' });
      }),
    [seat, L],
  );

  const g = s.gunners[seat];
  const target = g.targetId ? s.enemies.find((e) => e.id === g.targetId) : undefined;
  const best = recommendTarget(s.enemies, s.threats, mt);
  const cooling = !!target && mt < g.lastFiredAt + s.hints.weaponCooldownMs && mt < g.readyAt;
  const charging = !!target && mt < g.readyAt && !cooling;
  const chargePct = target
    ? Math.min(100, Math.max(0, ((mt - g.lockedAt) / Math.max(1, g.readyAt - g.lockedAt)) * 100))
    : 0;
  const armHp = s.parts[seat === 'GUNNER_L' ? 'ARM_L' : 'ARM_R'];
  const lowEnergy = s.energy.weapon < s.hints.weaponCost;
  const threatBy = new Map(s.threats.map((t) => [t.sourceId, t] as const));

  const act = async (action: Parameters<typeof sendAction>[1]) => {
    if (pending) return;
    haptic();
    setPending(true);
    const r = await sendAction(seat, action);
    setPending(false);
    if (!r.accepted) setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
    else if (action.actionType === 'LOCK')
      setMsg({
        text:
          seat === 'GUNNER_R'
            ? L('弱点ロック — 全砲撃の威力UP', 'Weak point locked — all guns boosted')
            : L('ロックオン — チャージ中', 'Locked — charging'),
        tone: 'info',
      });
  };

  const step = !target ? 0 : mt < g.readyAt ? 1 : 2;
  let label = seat === 'GUNNER_R' ? L('弱点ロック', 'WEAK LOCK') : L('ロックオン', 'LOCK ON');
  let sub = 'LOCK ON';
  let primary: (() => void) | null = () =>
    act({ actionType: 'LOCK', payload: best ? { targetId: best.id } : {} });
  let fill = 0;
  if (target && cooling) {
    label = L('冷却中', 'COOLING');
    sub = `${((g.readyAt - mt) / 1000).toFixed(1)}s`;
    primary = null;
    fill = 100 - ((g.readyAt - mt) / s.hints.weaponCooldownMs) * 100;
  } else if (target && charging) {
    label = L('チャージ中', 'CHARGING');
    sub = `${Math.round(chargePct)}%`;
    primary = null;
    fill = chargePct;
  } else if (target) {
    label = L('発射', 'FIRE');
    sub = lowEnergy ? L('エネルギー不足', 'LOW ENERGY') : 'FIRE';
    primary = () => act({ actionType: 'FIRE', payload: {} });
    fill = 100;
  }

  const chips = [...s.enemies]
    .filter((e) => e.arrivesAt <= mt)
    .sort(
      (a, b) =>
        (threatBy.get(a.id)?.impactAt ?? Infinity) - (threatBy.get(b.id)?.impactAt ?? Infinity) ||
        (a.kind === 'NULL_CORE' ? -1 : 1),
    )
    .slice(0, 4);

  return (
    <div className="console" style={{ ['--acc' as string]: COLORS.action }}>
      <PilotHeader s={s} mt={mt} seat={seat} connected={st.connected} />
      <section
        className="viewport sw-frame"
        style={{ ['--sw-frame-accent' as string]: COLORS.action }}
      >
        <div className="vp-k">
          <IconCrosshair size={16} /> TARGET LOCK
          {target ? (
            <span className="vp-right">
              {KIND_LABEL[target.kind]} · HP {Math.round((target.hp / target.maxHp) * 100)}%
            </span>
          ) : null}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="scope"
          role="group"
          aria-label={L('照準スコープ', 'Target scope')}
        >
          {[0.25, 0.5, 0.75].map((k) => (
            <line key={k} x1={0} x2={W} y1={H * k} y2={H * k} stroke="rgba(68,96,112,0.35)" />
          ))}
          <line
            x1={W / 2}
            x2={W / 2}
            y1={0}
            y2={H}
            stroke="rgba(68,96,112,0.5)"
            strokeDasharray="3 5"
          />
          <text
            x={W / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize="10"
            fill="#93aebc"
            letterSpacing="2"
          >
            FRONT
          </text>
          <text x={8} y={H - 6} fontSize="10" fill="#93aebc">
            L
          </text>
          <text x={W - 14} y={H - 6} fontSize="10" fill="#93aebc">
            R
          </text>
          {s.enemies.map((e) => {
            const p = scopeXY(e, mt);
            const th = threatBy.get(e.id);
            const locked = e.id === g.targetId;
            const weak = e.weakUntil > mt;
            const color = th ? '#ef596b' : '#e5eef3';
            const r = e.kind === 'NULL_CORE' ? 16 : e.kind === 'STRIKER' ? 9 : 6;
            const arriving = e.arrivesAt > mt;
            return (
              <g
                key={e.id}
                transform={`translate(${p.x.toFixed(1)} ${Math.max(14, Math.min(H - 22, p.y)).toFixed(1)})`}
                className={arriving ? 'arriving' : 'tappable'}
                onClick={
                  arriving
                    ? undefined
                    : () => act({ actionType: 'LOCK', payload: { targetId: e.id } })
                }
              >
                <circle r={24} fill="transparent" />
                {e.kind === 'DRONE' ? (
                  <path
                    d={`M0 ${-r} L${r} 0 L0 ${r} L${-r} 0 Z`}
                    fill={color}
                    opacity={arriving ? 0.35 : 0.9}
                  />
                ) : null}
                {e.kind === 'STRIKER' ? (
                  <path
                    d={`M0 ${-r} L${r} ${-r / 2} L${r} ${r / 2} L0 ${r} L${-r} ${r / 2} L${-r} ${-r / 2} Z`}
                    fill={color}
                    opacity={arriving ? 0.35 : 0.9}
                  />
                ) : null}
                {e.kind === 'NULL_CORE' ? (
                  <>
                    <circle r={r} fill="none" stroke="#ef596b" strokeWidth={3} />
                    <circle r={r * 0.45} fill="#ef596b" />
                  </>
                ) : null}
                {weak ? (
                  <circle r={r + 6} fill="none" stroke="#ef596b" strokeDasharray="3 3" />
                ) : null}
                {locked ? (
                  <>
                    <path
                      d="M-22 -10v-12h12M10 -22h12v12M22 10v12h-12M-10 22h-12v-12"
                      fill="none"
                      stroke="#f2ad4d"
                      strokeWidth={2.5}
                    />
                    <circle
                      r={19}
                      fill="none"
                      stroke="#f2ad4d"
                      strokeWidth={2}
                      strokeDasharray={`${(chargePct / 100) * 119} 200`}
                      transform="rotate(-90)"
                    />
                  </>
                ) : null}
                {th ? (
                  <text
                    y={r + 15}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#ef596b"
                  >
                    {Math.max(0, (th.impactAt - mt) / 1000).toFixed(1)}s
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div className="vp-foot">[ RETICLE / CHARGE ]</div>
      </section>
      <Flow steps={['LOCK', 'CHARGE', 'FIRE']} active={step} />
      <div className="chips" role="group" aria-label={L('目標', 'Targets')}>
        {chips.map((e) => {
          const th = threatBy.get(e.id);
          return (
            <button
              key={e.id}
              className={`chip${e.id === g.targetId ? ' on' : ''}${th ? ' hot' : ''}`}
              onClick={() => act({ actionType: 'LOCK', payload: { targetId: e.id } })}
            >
              {th ? <IconWarning size={14} /> : <IconLock size={14} />}
              <span>
                {e.kind === 'NULL_CORE' ? 'CORE' : e.kind === 'STRIKER' ? 'STRIKER' : 'DRONE'}
              </span>
              <small className="sw-num">
                {th
                  ? `${Math.max(0, (th.impactAt - mt) / 1000).toFixed(1)}s`
                  : `${Math.round((e.hp / e.maxHp) * 100)}%`}
              </small>
            </button>
          );
        })}
        {chips.length === 0 ? (
          <span className="chips-empty">
            {L('目標なし — 敵の接近を待機', 'No targets — swarm inbound')}
          </span>
        ) : null}
      </div>
      <div className="thumb">
        <button
          className={`btn fire${primary ? '' : ' busy'}`}
          disabled={!primary || pending || armHp <= 0}
          onClick={primary ?? undefined}
          style={{ ['--fill' as string]: `${fill}%` }}
        >
          <span className="lbl">
            {pending ? L('送信中…', 'Sending…') : armHp <= 0 ? L('主砲故障', 'GUN DOWN') : label}
          </span>
          <small>{sub}</small>
        </button>
        <Gauge
          label={L('武器エネルギー', 'WEAPON ENERGY')}
          value={s.energy.weapon}
          max={s.hints.laneMax}
          right={`${s.energy.weapon} / ${s.hints.laneMax}  (−${s.hints.weaponCost})`}
        />
      </div>
      <SystemLine text={msg.text} tone={msg.tone} connected={st.connected} mt={mt} s={s} />
    </div>
  );
}
