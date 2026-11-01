import type { ActionKind } from '@swed/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useL } from '../ui';

/**
 * The team's mini-game field (D-035). What flies here is drawn on the phone only; each hit
 * sends one free action, and the server decides what it is worth (cooldown, team, THUNDER
 * MODE). Targets are real buttons, so they work with a keyboard and screen readers too.
 *   ATTACK  alien drones cross the field          → tap to shoot
 *   DEFEND  missiles fall toward the squad below   → tap to knock them away
 *   REPAIR  sparks flare on RAIJIN's frame         → tap to fix
 */

type ItemKind = 'drone' | 'missile' | 'spark';

interface Item {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  ttl: number;
  dead: number;
}

const KIND_OF: Record<ActionKind, ItemKind> = {
  ATTACK: 'drone',
  DEFEND: 'missile',
  REPAIR: 'spark',
};

/** Points on RAIJIN's frame (field fractions) where sparks flare. */
const SPARK_POINTS: Array<[number, number]> = [
  [0.5, 0.2],
  [0.36, 0.34],
  [0.64, 0.34],
  [0.27, 0.5],
  [0.73, 0.5],
  [0.5, 0.45],
  [0.42, 0.66],
  [0.58, 0.66],
  [0.41, 0.84],
  [0.59, 0.84],
];

export function Arena({
  mode,
  live,
  fever,
  readyAt,
  baseLabel,
  onHit,
}: {
  mode: ActionKind;
  live: boolean;
  fever: boolean;
  /** performance.now() time the next hit counts (the free cooldown). */
  readyAt: number;
  /** DEFEND: the squad the missiles are falling on. */
  baseLabel: string;
  onHit: (kind: ActionKind) => void;
}) {
  const { L } = useL();
  const field = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 360, h: 360 });
  const items = useRef<Item[]>([]);
  const els = useRef(new Map<number, HTMLButtonElement>());
  const nextId = useRef(1);
  const lastSpawn = useRef(0);
  const [, setVersion] = useState(0);
  const [nope, setNope] = useState(0);
  const rerender = useCallback(() => setVersion((v) => v + 1), []);
  const kind = KIND_OF[mode];
  const want = fever ? 6 : mode === 'REPAIR' ? 3 : 4;

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    size.current = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, []);

  // A new job empties the field: drones do not turn into missiles mid-flight.
  useEffect(() => {
    items.current = [];
    rerender();
  }, [mode, rerender]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const spawn = (now: number) => {
      const { w, h } = size.current;
      const id = nextId.current++;
      if (kind === 'drone') {
        const fromLeft = Math.random() < 0.5;
        const speed = (70 + Math.random() * 70) * (fever ? 1.25 : 1);
        items.current.push({
          id,
          kind,
          x: fromLeft ? -30 : w + 30,
          y: h * (0.08 + Math.random() * 0.62),
          vx: fromLeft ? speed : -speed,
          vy: (Math.random() - 0.5) * 30,
          born: now,
          ttl: 9_000,
          dead: 0,
        });
      } else if (kind === 'missile') {
        const x = w * (0.12 + Math.random() * 0.76);
        const tx = w / 2 + (Math.random() - 0.5) * w * 0.2;
        const secs = 2.4 + Math.random() * 1.2;
        items.current.push({
          id,
          kind,
          x,
          y: -30,
          vx: (tx - x) / secs,
          vy: (h * 0.82 + 30) / secs,
          born: now,
          ttl: secs * 1_000,
          dead: 0,
        });
      } else {
        const used = new Set(items.current.map((i) => `${i.x}|${i.y}`));
        const free = SPARK_POINTS.filter(([fx, fy]) => !used.has(`${fx * w}|${fy * h}`));
        const [fx, fy] = free[Math.floor(Math.random() * free.length)] ?? SPARK_POINTS[0]!;
        items.current.push({
          id,
          kind,
          x: fx * w,
          y: fy * h,
          vx: 0,
          vy: 0,
          born: now,
          ttl: 2_600 + Math.random() * 1_200,
          dead: 0,
        });
      }
    };
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h } = size.current;
      let changed = false;
      const alive = items.current.filter((i) => !i.dead).length;
      if (live && alive < want && now - lastSpawn.current > (fever ? 220 : 420)) {
        lastSpawn.current = now;
        spawn(now);
        changed = true;
      }
      for (const it of items.current) {
        if (it.dead) continue;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        if (it.kind === 'drone') it.y += Math.sin((now - it.born) / 260) * 0.6;
        const gone =
          now - it.born > it.ttl ||
          (it.kind === 'drone' && (it.x < -60 || it.x > w + 60)) ||
          it.y > h + 40;
        if (gone) {
          it.dead = now;
          changed = true;
        }
        const el = els.current.get(it.id);
        if (el) el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
      }
      const before = items.current.length;
      items.current = items.current.filter((i) => !i.dead || now - i.dead < 380);
      if (items.current.length !== before) changed = true;
      if (changed) rerender();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [kind, live, fever, want, rerender]);

  const hit = (it: Item) => {
    if (it.dead || !live) return;
    if (performance.now() < readyAt) {
      setNope((n) => n + 1);
      return;
    }
    it.dead = performance.now();
    rerender();
    onHit(mode);
  };

  const label =
    kind === 'drone'
      ? L('敵機を撃つ', 'Shoot the drone')
      : kind === 'missile'
        ? L('ミサイルを弾く', 'Knock the missile away')
        : L('火花を直す', 'Fix the spark');

  return (
    <div
      ref={field}
      className={`arena ${kind}${fever ? ' fever' : ''}${live ? '' : ' idle'}`}
      aria-label={L('作戦フィールド', 'Battle field')}
    >
      {kind === 'spark' ? <RaijinFrame /> : null}
      {kind === 'missile' ? (
        <div className="arena-base">
          <svg viewBox="0 0 64 24" width="96" height="36" aria-hidden>
            <path d="M4 22 L14 8 H50 L60 22 Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M24 8 V2 H40 V8" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>{baseLabel}</span>
        </div>
      ) : null}
      {items.current.map((it) => (
        <button
          key={it.id}
          ref={(el) => {
            if (el) {
              els.current.set(it.id, el);
              el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
            } else els.current.delete(it.id);
          }}
          className={`tgt ${it.kind}${it.dead ? ' boom' : ''}`}
          aria-label={label}
          tabIndex={it.dead ? -1 : 0}
          onPointerDown={(e) => {
            e.preventDefault();
            hit(it);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              hit(it);
            }
          }}
        >
          <TargetIcon kind={it.kind} />
        </button>
      ))}
      {nope > 0 ? (
        <span key={nope} className="arena-reload">
          {L('リロード中', 'Reloading')}
        </span>
      ) : null}
    </div>
  );
}

function TargetIcon({ kind }: { kind: ItemKind }) {
  if (kind === 'drone') {
    return (
      <svg viewBox="-24 -16 48 32" width="56" height="38" aria-hidden>
        <path d="M-22 -2 L-6 -12 L0 -4 L6 -12 L22 -2 L8 4 L0 12 L-8 4 Z" className="hull" />
        <circle r="5" className="core" />
      </svg>
    );
  }
  if (kind === 'missile') {
    return (
      <svg viewBox="-10 -26 20 52" width="26" height="62" aria-hidden>
        <path d="M0 22 L-6 8 V-14 L0 -24 L6 -14 V8 Z" className="hull" />
        <path d="M-6 8 L-10 16 L-6 14 M6 8 L10 16 L6 14" className="fin" />
        <circle cy="-12" r="3" className="core" />
      </svg>
    );
  }
  return (
    <svg viewBox="-20 -20 40 40" width="50" height="50" aria-hidden>
      <path
        d="M0 -18 L4 -5 L17 -8 L7 2 L14 14 L0 7 L-14 14 L-7 2 L-17 -8 L-4 -5 Z"
        className="hull"
      />
      <circle r="4" className="core" />
    </svg>
  );
}

/** RAIJIN's outline for the engineers' field (sparks flare on it). */
function RaijinFrame() {
  return (
    <svg
      className="arena-frame"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path
        d="M44 12 H56 V22 H44 Z M34 25 H66 L70 48 H58 L56 60 H44 L42 48 H30 Z M22 28 H32 L30 56 H20 Z M68 28 H78 L80 56 H70 Z M40 62 H49 L48 92 H38 Z M51 62 H60 L62 92 H52 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
