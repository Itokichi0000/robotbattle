import { useMemo, useState } from 'react';
import type { TaskInput, TaskParams } from '@sats-wars/shared';
import { SINK_LABELS } from '@sats-wars/shared';
import { type MinigameProps, useKeys } from './common';

type P = Extract<TaskParams, { role: 'ROUTER' }>;
type I = Extract<TaskInput, { role: 'ROUTER' }>;

const W = 320;
const H = 200;

/**
 * 🔌 Connect the energy source to a robot or the reserve through relays,
 * avoiding ✕ blocked nodes. Tap nodes in order; the route is sent when it
 * reaches a destination. Keyboard: digits pick nodes, Backspace undoes.
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
      // Reaching a destination (or stepping on a blocked node) ends the route.
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
    return { x: 20 + n.x * (W - 40), y: 16 + n.y * (H - 32) };
  };
  const onPath = (a: number, b: number) =>
    path.some(
      (p, i) => i > 0 && ((path[i - 1] === a && p === b) || (path[i - 1] === b && p === a)),
    );
  return (
    <div className="swc-game swc-router">
      <p className="swc-game-help">
        {L(
          `⚡から光る点をたどって行き先へ。✕は通れない（${params.maxHops}本以内）`,
          `Route ⚡ to a destination through relays. ✕ is blocked (max ${params.maxHops} links)`,
        )}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="swc-router-svg"
        role="group"
        aria-label={L('エネルギー経路', 'Energy routes')}
      >
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
              className={onPath(a, b) ? 'swc-edge is-on' : 'swc-edge'}
            />
          );
        })}
        {params.nodes.map((n) => {
          const p = pos(n.id);
          const label =
            n.kind === 'SOURCE'
              ? '⚡'
              : n.kind === 'BLOCKED'
                ? '✕'
                : n.kind === 'SINK'
                  ? n.sink === 'RAIJIN'
                    ? '雷'
                    : n.sink === 'FUJIN'
                      ? '風'
                      : '蓄'
                  : String(n.id);
          const name =
            n.kind === 'SINK' && n.sink
              ? L(SINK_LABELS[n.sink].ja, SINK_LABELS[n.sink].en)
              : n.kind === 'BLOCKED'
                ? L('妨害', 'Blocked')
                : n.kind === 'SOURCE'
                  ? L('電源', 'Source')
                  : L(`中継${n.id}`, `Relay ${n.id}`);
          const cls = [
            'swc-node',
            `is-${n.kind.toLowerCase()}`,
            path.includes(n.id) ? 'is-on' : '',
            canGo(n.id) ? 'is-next' : '',
          ].join(' ');
          return (
            <g
              key={n.id}
              className={cls}
              role="button"
              tabIndex={n.kind === 'SOURCE' ? -1 : 0}
              aria-label={`${name} (${n.id})`}
              onClick={() => tap(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  tap(n.id);
                }
              }}
              data-testid={`router-node-${n.id}`}
            >
              <circle cx={p.x} cy={p.y} r={n.kind === 'SINK' ? 19 : 16} />
              <text x={p.x} y={p.y + 5} textAnchor="middle">
                {label}
              </text>
              {n.kind === 'SINK' && (
                <text x={p.x} y={p.y + 32} textAnchor="middle" className="swc-node-cap">
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="swc-row">
        <button
          type="button"
          className="swc-btn"
          onClick={() => setPath([0])}
          disabled={sent || path.length === 1}
        >
          ↺ {L('やり直す', 'Reset')}
        </button>
      </div>
    </div>
  );
}
