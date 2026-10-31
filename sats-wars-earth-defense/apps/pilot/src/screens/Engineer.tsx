import { useStore, useTicker } from '@swed/client';
import { ENGINEER_COVERAGE, MECH_PART_IDS, PARTS } from '@swed/shared';
import type { EngineerSeatId, MechPartId, PublicMatchState } from '@swed/shared';
import { COLORS, IconWrench } from '@swed/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, Gauge, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * ENGINEER console (spec §5.6, §9.6): RAIJIN's silhouette with damaged parts in red.
 * SCAN (pick a part in your section) → REPAIR (turn the numbered bolts in order: drag around
 * a bolt to tighten it; a long press or Enter also works) → CONFIRM (the server checks the
 * order and applies the repair).
 */

/** Degrees of turning that tighten one bolt, and the press that also does (accessibility). */
const TURN_DEG = 300;
const HOLD_MS = 700;

/** Where each part sits on the silhouette (same drawing as the seat map). */
const PART_XY: Record<MechPartId, [number, number, number, number]> = {
  SHOULDER_L: [28, 52, 52, 52],
  SHOULDER_R: [160, 52, 52, 52],
  ARM_L: [32, 108, 34, 110],
  ARM_R: [174, 108, 34, 110],
  CORE: [86, 52, 68, 82],
  LEG_L: [88, 156, 30, 96],
  LEG_R: [122, 156, 30, 96],
};

const BOLT_XY = [
  [50, 20],
  [100, 20],
  [125, 62],
  [100, 104],
  [50, 104],
  [25, 62],
] as const;

function hpColor(hp: number): string {
  return hp < 35 ? COLORS.danger : hp < 70 ? COLORS.action : COLORS.repair;
}

export function Engineer({ seat }: { seat: EngineerSeatId }) {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(200);
  const s = st.snap?.state as PublicMatchState;
  const mt = store.matchTime(now);
  const mine = ENGINEER_COVERAGE[seat];
  const eng = s.engineers[seat];
  const job = eng.job;
  const [taps, setTaps] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' }>({
    text: '',
    tone: 'info',
  });
  const jobKey = job ? `${job.part}:${job.startedAt}` : '';

  useEffect(() => setTaps([]), [jobKey]);

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'part_repaired' && e.seatId === seat && !e.auto) {
          haptic(40);
          setMsg({
            text: L(
              `${PARTS[e.part].labelJa} 修理完了 ${e.hp}%`,
              `${PARTS[e.part].labelEn} repaired ${e.hp}%`,
            ),
            tone: 'ok',
          });
        }
        if (e.type === 'part_damaged' && mine.includes(e.part)) {
          setMsg({
            text: L(
              `${PARTS[e.part].labelJa} 損傷 ${e.hp}%`,
              `${PARTS[e.part].labelEn} hit ${e.hp}%`,
            ),
            tone: 'bad',
          });
        }
        if (e.type === 'team_combo')
          setMsg({
            text: L(`連携 ×${e.link} 雷神ゲージ +${e.gain}`, `LINK ×${e.link} gauge +${e.gain}`),
            tone: 'ok',
          });
      }),
    [seat, mine, L],
  );

  const start = async (part: MechPartId) => {
    if (pending) return;
    haptic(15);
    setPending(true);
    const r = await sendAction(seat, { actionType: 'REPAIR_START', payload: { part } });
    setPending(false);
    if (!r.accepted) setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
    else setMsg({ text: L('ボルトを番号順に締める', 'Tighten the bolts in order'), tone: 'info' });
  };

  const tap = async (slot: number) => {
    if (!job || pending || taps.includes(slot)) return;
    haptic(10);
    const next = [...taps, slot];
    setTaps(next);
    if (next.length < job.bolts.length) return;
    setPending(true);
    const r = await sendAction(seat, {
      actionType: 'REPAIR_FINISH',
      payload: { part: job.part, order: next },
    });
    setPending(false);
    if (!r.accepted) {
      setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
      setTaps([]);
    }
  };

  // Turning a bolt: accumulate the angle the finger sweeps around the bolt's centre.
  const svgRef = useRef<SVGSVGElement>(null);
  const turnRef = useRef<{ slot: number; last: number; total: number; timer: number } | null>(null);
  const [turn, setTurn] = useState<{ slot: number; deg: number } | null>(null);
  const angleAt = (slot: number, ev: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * 150;
    const y = ((ev.clientY - r.top) / r.height) * 124;
    const [cx, cy] = BOLT_XY[slot]!;
    return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  };
  const endTurn = () => {
    if (turnRef.current) window.clearTimeout(turnRef.current.timer);
    turnRef.current = null;
    setTurn(null);
  };
  const tightened = (slot: number) => {
    endTurn();
    haptic(25);
    void tap(slot);
  };
  const startTurn = (slot: number, ev: React.PointerEvent<SVGGElement>) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const timer = window.setTimeout(() => {
      // Held without turning: tighten anyway (one-handed or limited movement).
      if (turnRef.current?.slot === slot && Math.abs(turnRef.current.total) < 40) tightened(slot);
    }, HOLD_MS);
    turnRef.current = { slot, last: angleAt(slot, ev), total: 0, timer };
    setTurn({ slot, deg: 0 });
  };
  const moveTurn = (slot: number, ev: React.PointerEvent<SVGGElement>) => {
    const t = turnRef.current;
    if (!t || t.slot !== slot) return;
    const a = angleAt(slot, ev);
    let d = a - t.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    t.last = a;
    t.total += d;
    if (Math.abs(t.total) >= TURN_DEG) tightened(slot);
    else setTurn({ slot, deg: Math.abs(t.total) });
  };

  const worst = mine.reduce((a, b) => (s.parts[b] < s.parts[a] ? b : a));
  const cooling = mt < eng.cooldownUntil;
  const left = job ? Math.max(0, job.expiresAt - mt) : 0;
  const step = job ? 1 + (taps.length === job.bolts.length ? 1 : 0) : 0;

  return (
    <div className="console" style={{ ['--acc' as string]: COLORS.repair }}>
      <PilotHeader s={s} mt={mt} seat={seat} connected={st.connected} />
      <section
        className="viewport sw-frame"
        style={{ ['--sw-frame-accent' as string]: COLORS.repair }}
      >
        <div className="vp-k">
          <IconWrench size={16} />{' '}
          {job
            ? L(`${PARTS[job.part].labelJa} を修理中`, `REPAIRING ${PARTS[job.part].labelEn}`)
            : 'LIMB DAMAGE'}
          <span className="vp-right">
            {job ? (
              <span className="sw-num">{(left / 1000).toFixed(1)}s</span>
            ) : (
              L(
                `担当: ${mine.map((p) => PARTS[p].labelJa).join('・')}`,
                `Section: ${mine.map((p) => PARTS[p].labelEn).join(' ')}`,
              )
            )}
          </span>
        </div>
        {job ? (
          <svg
            ref={svgRef}
            viewBox="0 0 150 124"
            className="bolts"
            role="group"
            aria-label={L('ボルト', 'Bolts')}
          >
            <rect
              x={14}
              y={8}
              width={122}
              height={108}
              fill="rgba(10,26,39,0.9)"
              stroke="rgba(121,216,180,0.5)"
            />
            {BOLT_XY.map(([x, y], slot) => {
              const order = job.bolts.indexOf(slot);
              const done = taps.includes(slot);
              const active = order >= 0;
              return (
                <g
                  key={slot}
                  transform={`translate(${x} ${y})`}
                  className={active ? 'tappable' : undefined}
                  role={active ? 'button' : undefined}
                  tabIndex={active && !done ? 0 : undefined}
                  aria-label={active ? L(`ボルト ${order + 1}`, `Bolt ${order + 1}`) : undefined}
                  onPointerDown={active && !done ? (ev) => startTurn(slot, ev) : undefined}
                  onPointerMove={active && !done ? (ev) => moveTurn(slot, ev) : undefined}
                  onPointerUp={endTurn}
                  onPointerCancel={endTurn}
                  onKeyDown={
                    active && !done
                      ? (ev) => (ev.key === 'Enter' || ev.key === ' ') && tightened(slot)
                      : undefined
                  }
                >
                  <circle r={17} fill="transparent" />
                  {turn?.slot === slot ? (
                    <circle
                      r={16}
                      fill="none"
                      stroke={COLORS.repair}
                      strokeWidth={3}
                      strokeDasharray={`${(turn.deg / TURN_DEG) * 100.5} 200`}
                      transform="rotate(-90)"
                    />
                  ) : null}
                  <path
                    d="M-12 0 L-6 -10 L6 -10 L12 0 L6 10 L-6 10 Z"
                    fill={done ? COLORS.repair : active ? '#1a2a33' : '#0d151b'}
                    stroke={active ? COLORS.repair : '#263844'}
                    strokeWidth={2}
                  />
                  {active ? (
                    <text
                      textAnchor="middle"
                      dy={5}
                      fontSize={14}
                      fontWeight={700}
                      fill={done ? '#050b13' : COLORS.text}
                    >
                      {order + 1}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : (
          <svg
            viewBox="0 0 240 260"
            className="mechmap"
            role="group"
            aria-label={L('機体の損傷', 'Damage map')}
          >
            {MECH_PART_IDS.map((p) => {
              const [x, y, w, h] = PART_XY[p];
              const isMine = mine.includes(p);
              const hp = Math.round(s.parts[p]);
              return (
                <g
                  key={p}
                  className={isMine && hp < 100 ? 'tappable' : undefined}
                  onClick={isMine && hp < 100 && !cooling ? () => void start(p) : undefined}
                  role={isMine ? 'button' : undefined}
                  aria-label={isMine ? `${PARTS[p].labelJa} ${hp}%` : undefined}
                >
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={isMine ? `${hpColor(hp)}33` : 'rgba(38,56,68,0.35)'}
                    stroke={isMine ? hpColor(hp) : 'rgba(68,96,112,0.6)'}
                    strokeWidth={isMine ? 2 : 1}
                    strokeDasharray={isMine ? undefined : '3 3'}
                  />
                  <text
                    x={x + w / 2}
                    y={y + h / 2 + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={isMine ? COLORS.text : '#5f7684'}
                  >
                    {hp}%
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <div className="vp-foot">
          [ MECH WIREFRAME ]{' '}
          {job
            ? L(
                '番号順にボルトを回して締める（長押しでも可）',
                'Turn the bolts in number order (or hold)',
              )
            : L('赤い部位をタップ', 'Tap a red part')}
        </div>
      </section>
      <Flow steps={['SCAN', 'REPAIR', 'CONFIRM']} active={step} />
      <div className="parts" role="group" aria-label={L('担当部位', 'Your parts')}>
        {mine.map((p) => (
          <button
            key={p}
            className={`chip${s.parts[p] < 70 ? ' hot' : ''}${job?.part === p ? ' on' : ''}`}
            disabled={pending || cooling || s.parts[p] >= 100}
            onClick={() => void start(p)}
          >
            <span>{L(PARTS[p].labelJa, PARTS[p].labelEn)}</span>
            <small className="sw-num">{Math.round(s.parts[p])}%</small>
          </button>
        ))}
      </div>
      <div className="thumb">
        <button
          className="btn repair"
          disabled={pending || cooling || !!job || s.parts[worst] >= 100}
          onClick={() => void start(worst)}
        >
          <span className="lbl">
            {cooling
              ? L('冷却中', 'COOLING')
              : job
                ? L('ボルトを締める', 'TIGHTEN BOLTS')
                : L('修理実行', 'REPAIR')}
          </span>
          <small>
            {cooling
              ? `${((eng.cooldownUntil - mt) / 1000).toFixed(1)}s`
              : job
                ? `${taps.length} / ${job.bolts.length}`
                : s.parts[worst] >= 100
                  ? L('担当部位は正常', 'Section healthy')
                  : L(
                      `最優先: ${PARTS[worst].labelJa} ${Math.round(s.parts[worst])}%`,
                      `Worst: ${PARTS[worst].labelEn} ${Math.round(s.parts[worst])}%`,
                    )}
          </small>
        </button>
        <Gauge
          label={L('修理エネルギー', 'REPAIR ENERGY')}
          value={s.energy.repair}
          max={s.hints.laneMax}
          accent={COLORS.repair}
          right={`${s.energy.repair} / ${s.hints.laneMax}  (−${s.hints.repairCost})`}
        />
      </div>
      <SystemLine text={msg.text} tone={msg.tone} connected={st.connected} mt={mt} s={s} />
    </div>
  );
}
