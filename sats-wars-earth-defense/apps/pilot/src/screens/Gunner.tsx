import { useStore, useTicker } from '@swed/client';
import { enemyPositionAt, recommendTarget } from '@swed/game-engine';
import type { GunnerSeatId, PublicEnemy, PublicMatchState } from '@swed/shared';
import { COLORS, IconCrosshair, IconLock, IconWarning } from '@swed/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, Gauge, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * GUNNER console (spec §5.3, §9.3, ref 06): drag the reticle onto a target (or tap it) →
 * LOCK → CHARGE → FIRE. Firing the moment the charge completes is a PERFECT SHOT, judged on
 * the server clock. The scope shows where the swarm is relative to RAIJIN's facing, red when
 * an enemy has a telegraphed attack running.
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
          haptic(e.perfect ? 60 : 30);
          const extra = `${e.perfect ? ' PERFECT' : ''}${e.link ? ` LINK×${e.link}` : ''}`;
          setMsg({
            text: e.killed
              ? L(`撃墜！ −${e.damage}${extra}`, `DOWN! −${e.damage}${extra}`)
              : L(
                  `命中 −${e.damage}${e.weak ? ' 弱点' : ''}${extra}`,
                  `HIT −${e.damage}${e.weak ? ' WEAK' : ''}${extra}`,
                ),
            tone: 'ok',
          });
        }
        if (e.type === 'weapon_charged' && e.seatId === seat) {
          haptic(15);
          setMsg({
            text: L('チャージ完了 — 今撃てば PERFECT!', 'Charged — fire now for PERFECT!'),
            tone: 'ok',
          });
        }
        if (e.type === 'team_combo')
          setMsg({ text: `LINK ×${e.link}  +${e.gain} SYNC`, tone: 'ok' });
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

  // PERFECT window: from the moment the charge completes, for perfectShotMs (server judges).
  const sinceReady = mt - g.readyAt;
  const perfectNow = !!target && !cooling && sinceReady >= 0 && sinceReady <= s.hints.perfectShotMs;

  // Drag-to-aim: the reticle follows the finger; releasing near a target locks it.
  const svgRef = useRef<SVGSVGElement>(null);
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const toSvg = (ev: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  const nearest = (pt: { x: number; y: number }) => {
    let best: { id: string; d: number } | null = null;
    for (const e of s.enemies) {
      if (e.arrivesAt > mt) continue;
      const p = scopeXY(e, mt);
      const d = Math.hypot(p.x - pt.x, Math.max(14, Math.min(H - 22, p.y)) - pt.y);
      if (d <= 46 && (!best || d < best.d)) best = { id: e.id, d };
    }
    return best?.id ?? null;
  };
  const aimId = aim ? nearest(aim) : null;

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
    label = perfectNow ? L('今！', 'NOW!') : L('発射', 'FIRE');
    sub = lowEnergy ? L('エネルギー不足', 'LOW ENERGY') : perfectNow ? 'PERFECT SHOT' : 'FIRE';
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
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="scope"
          role="group"
          aria-label={L('照準スコープ（ドラッグで照準）', 'Target scope (drag to aim)')}
          onPointerDown={(ev) => {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            setAim(toSvg(ev));
          }}
          onPointerMove={(ev) => {
            if (aim) setAim(toSvg(ev));
          }}
          onPointerUp={(ev) => {
            const id = nearest(toSvg(ev));
            setAim(null);
            if (id) void act({ actionType: 'LOCK', payload: { targetId: id } });
          }}
          onPointerCancel={() => setAim(null)}
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
              >
                {e.id === aimId ? (
                  <circle r={r + 12} fill="none" stroke="#f2ad4d" strokeDasharray="4 4" />
                ) : null}
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
          {aim ? (
            <g
              transform={`translate(${aim.x.toFixed(1)} ${aim.y.toFixed(1)})`}
              pointerEvents="none"
            >
              <circle r={14} fill="none" stroke="#f2ad4d" strokeWidth={1.5} />
              <path d="M-24 0h14M10 0h14M0 -24v14M0 10v14" stroke="#f2ad4d" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        <div className="vp-foot">
          [ RETICLE / CHARGE ]{' '}
          {L('ドラッグで照準・満タンの瞬間に発射', 'Drag to aim · fire on full charge')}
        </div>
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
          className={`btn fire${primary ? '' : ' busy'}${perfectNow ? ' perfect' : ''}`}
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
