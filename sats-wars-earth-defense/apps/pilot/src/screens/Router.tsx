import { useStore, useTicker } from '@swed/client';
import { tileSides, tracePath } from '@swed/game-engine';
import { POWER_LANES } from '@swed/shared';
import type { PowerLane, PublicMatchState, RouterPuzzle } from '@swed/shared';
import { COLORS, IconBolt, IconWarning } from '@swed/ui-tokens';
import { useEffect, useMemo, useState } from 'react';
import { haptic, sendAction, store } from '../net';
import { Flow, PilotHeader, reasonText, SystemLine, useL } from '../ui';

/**
 * POWER B console (spec §5.5): when a circuit overloads, re-route it. Tap tiles to turn
 * the conduits so power runs from the left terminal to the right one. The phone only shows
 * how far the power reaches; the server judges the rotations you send.
 */

const LANE: Record<PowerLane, { ja: string; en: string; color: string }> = {
  weapon: { ja: '武器系', en: 'WEAPON', color: COLORS.action },
  shield: { ja: 'シールド系', en: 'SHIELD', color: COLORS.ally },
  mobility: { ja: '機動系', en: 'MOBILITY', color: COLORS.text },
  repair: { ja: '修理系', en: 'REPAIR', color: COLORS.repair },
};

const CELL = 92;
const SIDE_XY: Record<number, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

function Tile({ type, rot, lit }: { type: 'I' | 'L'; rot: number; lit: boolean }) {
  const [a, b] = tileSides(type, rot);
  const h = CELL / 2;
  const end = (side: number) => [h + SIDE_XY[side]![0] * h, h + SIDE_XY[side]![1] * h] as const;
  const [ax, ay] = end(a);
  const [bx, by] = end(b);
  const d = type === 'I' ? `M${ax} ${ay} L${bx} ${by}` : `M${ax} ${ay} L${h} ${h} L${bx} ${by}`;
  return (
    <>
      <rect
        x={3}
        y={3}
        width={CELL - 6}
        height={CELL - 6}
        fill="rgba(10,26,39,0.9)"
        stroke="rgba(68,96,112,0.8)"
      />
      <path
        d={d}
        stroke={lit ? COLORS.power : 'rgba(147,174,188,0.55)'}
        strokeWidth={lit ? 12 : 9}
        fill="none"
        strokeLinecap="square"
      />
      <circle cx={h} cy={h} r={7} fill={lit ? COLORS.power : '#263844'} />
    </>
  );
}

function Grid({
  puzzle,
  rotations,
  onTurn,
}: {
  puzzle: RouterPuzzle;
  rotations: number[];
  onTurn: (i: number) => void;
}) {
  const { L } = useL();
  const trace = useMemo(() => tracePath(puzzle, rotations), [puzzle, rotations]);
  const W = CELL * 3 + 40;
  return (
    <svg
      viewBox={`-20 0 ${W} ${CELL * 3}`}
      className="router-grid"
      role="group"
      aria-label={L('回路パネル', 'Circuit panel')}
    >
      {/* source and target terminals */}
      <rect
        x={-20}
        y={puzzle.entryRow * CELL + CELL / 2 - 10}
        width={20}
        height={20}
        fill={COLORS.power}
      />
      <rect
        x={CELL * 3}
        y={puzzle.exitRow * CELL + CELL / 2 - 10}
        width={20}
        height={20}
        fill={trace.connected ? COLORS.power : 'none'}
        stroke={COLORS.power}
        strokeWidth={3}
      />
      {puzzle.tiles.map((t, i) => (
        <g
          key={i}
          transform={`translate(${(i % 3) * CELL} ${Math.floor(i / 3) * CELL})`}
          className="tappable"
          role="button"
          aria-label={L(`タイル ${i + 1} を回す`, `Turn tile ${i + 1}`)}
          tabIndex={0}
          onClick={() => onTurn(i)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onTurn(i)}
        >
          <Tile type={t.type} rot={rotations[i] ?? t.rot} lit={trace.cells.includes(i)} />
        </g>
      ))}
    </svg>
  );
}

export function Router() {
  const { L } = useL();
  const st = useStore(store);
  const now = useTicker(250);
  const s = st.snap?.state as PublicMatchState;
  const mt = store.matchTime(now);
  const cut = POWER_LANES.filter((l) => s.circuits[l].broken);
  const [lane, setLane] = useState<PowerLane | null>(null);
  const active = lane && s.circuits[lane].broken ? lane : (cut[0] ?? null);
  const puzzle = active ? s.circuits[active].puzzle : null;
  const puzzleKey = puzzle
    ? `${active}:${puzzle.entryRow}:${puzzle.exitRow}:${puzzle.tiles.map((t) => t.type + t.rot).join('')}`
    : '';
  const [rotations, setRotations] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'info' }>({
    text: '',
    tone: 'info',
  });

  // A new puzzle starts from the tiles as the overload left them.
  useEffect(() => {
    setRotations(puzzle ? puzzle.tiles.map((t) => t.rot) : []);
    // puzzleKey identifies the puzzle; the object itself is new on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleKey]);

  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'circuit_overload') {
          haptic(60);
          setMsg({
            text: L(
              `過負荷！${LANE[e.lane].ja}の回路を再接続`,
              `Overload! Re-route ${LANE[e.lane].en}`,
            ),
            tone: 'bad',
          });
        }
        if (e.type === 'circuit_restored' && e.auto)
          setMsg({
            text: L(`AUTO SUPPORT が${LANE[e.lane].ja}を復旧`, `AUTO SUPPORT restored ${e.lane}`),
            tone: 'info',
          });
        if (e.type === 'team_combo')
          setMsg({ text: `LINK ESTABLISHED +${e.gain} SYNC`, tone: 'ok' });
      }),
    [L],
  );

  const turn = (i: number) => {
    haptic(8);
    setRotations((r) => r.map((v, k) => (k === i ? (v + 1) % 4 : v)));
  };

  const connected = puzzle ? tracePath(puzzle, rotations).connected : false;

  const send = async () => {
    if (!active || pending) return;
    haptic(20);
    setPending(true);
    const r = await sendAction('POWER_ROUTER', {
      actionType: 'ROUTE_SUBMIT',
      payload: { lane: active, rotations },
    });
    setPending(false);
    if (r.accepted) {
      haptic(40);
      setMsg({ text: L(`${LANE[active].ja} 復旧！`, `${LANE[active].en} restored!`), tone: 'ok' });
      setLane(null);
    } else setMsg({ text: reasonText(r.reasonCode, L), tone: 'bad' });
  };

  return (
    <div className="console" style={{ ['--acc' as string]: COLORS.power }}>
      <PilotHeader s={s} mt={mt} seat="POWER_ROUTER" connected={st.connected} />
      <div className="circuits" role="tablist" aria-label={L('回路', 'Circuits')}>
        {POWER_LANES.map((l) => {
          const c = s.circuits[l];
          return (
            <button
              key={l}
              role="tab"
              aria-selected={active === l}
              className={`circuit${c.broken ? ' cut' : ''}${active === l ? ' on' : ''}`}
              style={{ ['--lane' as string]: LANE[l].color }}
              disabled={!c.broken}
              onClick={() => setLane(l)}
            >
              {c.broken ? <IconWarning size={14} /> : <IconBolt size={14} />}
              <span>{L(LANE[l].ja, LANE[l].en)}</span>
              <small>{c.broken ? `${Math.floor((mt - c.brokenAt) / 1000)}s` : 'OK'}</small>
            </button>
          );
        })}
      </div>
      <section
        className="viewport sw-frame"
        style={{ ['--sw-frame-accent' as string]: COLORS.power }}
      >
        <div className="vp-k">
          <IconBolt size={16} />{' '}
          {active
            ? L(`${LANE[active].ja} 回路を再接続`, `RE-ROUTE ${LANE[active].en}`)
            : 'GRID STABLE'}
          <span className={`vp-right${connected ? '' : active ? ' hot' : ''}`}>
            {active
              ? connected
                ? L('接続OK', 'CONNECTED')
                : L('未接続', 'OPEN')
              : L('全回路正常', 'All circuits OK')}
          </span>
        </div>
        {puzzle && rotations.length === 9 ? (
          <Grid puzzle={puzzle} rotations={rotations} onTurn={turn} />
        ) : (
          <div className="router-idle">
            <IconBolt size={48} />
            <p>
              {L(
                '過負荷が起きたら、ここで回路をつなぎ直します',
                'When a circuit overloads, re-route it here',
              )}
            </p>
          </div>
        )}
        <div className="vp-foot">
          [ ROUTING ] {L('タイルをタップして回す', 'Tap a tile to turn it')}
        </div>
      </section>
      <Flow steps={['READ', 'TURN', 'CONNECT']} active={!active ? 0 : connected ? 2 : 1} />
      <div className="thumb">
        <button className="btn power" disabled={!active || pending} onClick={() => void send()}>
          <span className="lbl">
            {pending ? L('送信中…', 'Sending…') : L('接続する', 'CONNECT')}
          </span>
          <small>
            {active
              ? connected
                ? 'SEND ROUTE'
                : L('まだ途中までしか届いていません', 'Power does not reach the exit yet')
              : L('待機', 'STANDBY')}
          </small>
        </button>
      </div>
      <SystemLine text={msg.text} tone={msg.tone} connected={st.connected} mt={mt} s={s} />
    </div>
  );
}
