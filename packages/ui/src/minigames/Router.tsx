import { useMemo, useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { SINK_LABELS } from '@sats-wars/shared';
import { Icon } from '../hud/icons';
import { Key } from '../hud/primitives';
import { type MinigameProps, useKeys } from './common';

type P = Extract<TaskParams, { role: 'ROUTER' }>;
type I = Extract<TaskInput, { role: 'ROUTER' }>;

const W = 340;
const H = 210;
const SINK_MARK = { RAIJIN: '雷', FUJIN: '風', RESERVE: '蓄' } as const;

/**
 * The power distribution board: energise a trace from the source pad to a
 * terminal (Raijin, Fujin or the reserve) through relay pads, avoiding the
 * burnt ones. Tap pads in order (tap the last again to undo); the route is
 * sent when it reaches a terminal. Keys: pad numbers, Backspace.
 */
export function RouterGame({ params, locale, onSubmit, disabled }: MinigameProps<P, I>) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [path, setPath] = useState<number[]>([0]);
  const [sent, setSent] = useState(false);
  const linked = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const [a, b] of params.edges) {
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [params.edges]);
  const last = path[path.length - 1]!;
  const canGo = (id: number) =>
    !sent && !disabled && !path.includes(id) && (linked.get(last)?.has(id) ?? false);
  const tap = (id: number) => {
    if (sent || disabled) return;
    if (id === last && path.length > 1) {
      setPath(path.slice(0, -1));
      return;
    }
    if (!canGo(id)) return;
    const next = [...path, id];
    setPath(next);
    const node = params.nodes.find((n) => n.id === id);
    if (node?.kind === 'SINK' || node?.kind === 'BLOCKED') {
      // Reaching a terminal (or stepping on a burnt pad) ends the route.
      setSent(true);
      onSubmit({ role: 'ROUTER', path: next });
    }
  };
  useKeys((e) => {
    if (e.key === 'Backspace' && path.length > 1) setPath(path.slice(0, -1));
    const n = Number(e.key);
    if (Number.isInteger(n) && params.nodes.some((x) => x.id === n)) tap(n);
  }, !sent);
  const pos = (id: number) => {
    const n = params.nodes.find((x) => x.id === id)!;
    return { x: 24 + n.x * (W - 48), y: 18 + n.y * (H - 40) };
  };
  const onPath = (a: number, b: number) =>
    path.some(
      (p, i) => i > 0 && ((path[i - 1] === a && p === b) || (path[i - 1] === b && p === a)),
    );
  const hops = path.length - 1;
  return (
    <div className={`hud-game hud-router${sent ? ' is-sent' : ''}`}>
      <p className="hud-game-help">
        {L(
          `電源から端子へ回路をつなげ（焼損パッドは通れない・${params.maxHops}本以内）`,
          `Energise a trace from the source to a terminal (avoid burnt pads, max ${params.maxHops} links)`,
        )}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="hud-board"
        role="group"
        aria-label={L('配電盤', 'Power distribution board')}
        data-testid="router-board"
      >
        <rect x="1" y="1" width={W - 2} height={H - 2} className="hud-board-edge" />
        {params.edges.map(([a, b]) => {
          const pa = pos(a);
          const pb = pos(b);
          return (
            <line
              key={`${a}-${b}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              className={onPath(a, b) ? 'hud-trace is-on' : 'hud-trace'}
            />
          );
        })}
        {params.nodes.map((n) => {
          const p = pos(n.id);
          const name =
            n.kind === 'SINK' && n.sink
              ? L(SINK_LABELS[n.sink].ja, SINK_LABELS[n.sink].en)
              : n.kind === 'BLOCKED'
                ? L('焼損', 'Burnt')
                : n.kind === 'SOURCE'
                  ? L('電源', 'Source')
                  : L(`中継${n.id}`, `Relay ${n.id}`);
          const next = canGo(n.id);
          const on = path.includes(n.id);
          const r = n.kind === 'SINK' ? 17 : 13;
          return (
            <g
              key={n.id}
              className={`hud-pad is-${n.kind.toLowerCase()}${on ? ' is-on' : ''}${next ? ' is-next' : ''}`}
              role="button"
              tabIndex={n.kind === 'SOURCE' ? -1 : 0}
              aria-label={`${name} (${n.id})`}
              aria-disabled={!next && !(n.id === last && path.length > 1)}
              onClick={() => tap(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  tap(n.id);
                }
              }}
              data-testid={`router-node-${n.id}`}
              data-kind={n.kind.toLowerCase()}
              data-next={next ? '1' : '0'}
            >
              {n.kind === 'SINK' ? (
                <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} />
              ) : (
                <path
                  d={`M${p.x - r},${p.y - r / 2} L${p.x - r / 2},${p.y - r} L${p.x + r / 2},${p.y - r} L${p.x + r},${p.y - r / 2} L${p.x + r},${p.y + r / 2} L${p.x + r / 2},${p.y + r} L${p.x - r / 2},${p.y + r} L${p.x - r},${p.y + r / 2} Z`}
                />
              )}
              {n.kind === 'BLOCKED' ? (
                <path
                  d={`M${p.x - 6},${p.y - 6} L${p.x + 6},${p.y + 6} M${p.x + 6},${p.y - 6} L${p.x - 6},${p.y + 6}`}
                  className="hud-pad-x"
                />
              ) : (
                <text x={p.x} y={p.y + 5} textAnchor="middle">
                  {n.kind === 'SOURCE'
                    ? 'PWR'
                    : n.kind === 'SINK' && n.sink
                      ? SINK_MARK[n.sink]
                      : String(n.id)}
                </text>
              )}
              {n.kind === 'SINK' && (
                <text x={p.x} y={p.y + r + 13} textAnchor="middle" className="hud-pad-cap">
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="hud-router-foot">
        <span className="hud-readout-inline">
          <span className="hud-label">{L('接続', 'LINKS')}</span>
          <b className={`hud-num${hops > params.maxHops ? ' is-over' : ''}`}>
            {hops}/{params.maxHops}
          </b>
        </span>
        <button
          type="button"
          className="hud-btn"
          onClick={() => setPath([0])}
          disabled={sent || path.length === 1}
        >
          <Icon name="back" size={16} />
          {L('やり直す', 'Reset')}
          <Key k="⌫" />
        </button>
      </div>
    </div>
  );
}
