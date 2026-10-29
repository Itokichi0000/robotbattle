import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

/** Semantic tones: info (low-saturation cyan), act (amber, operable), danger (red), ok, idle. */
export type Tone = 'info' | 'act' | 'danger' | 'ok' | 'idle' | 'raijin' | 'fujin';

/**
 * A HUD frame: hairline border with corner brackets, an optional caption on
 * the top edge. No rounded corners, no drop shadow; `tone` colours the
 * brackets only.
 */
export function Frame({
  label,
  tone = 'idle',
  className,
  children,
  testId,
  as: Tag = 'section',
  ariaLabel,
}: {
  label?: ReactNode;
  tone?: Tone;
  className?: string;
  children: ReactNode;
  testId?: string;
  as?: 'section' | 'div' | 'aside' | 'header' | 'nav';
  ariaLabel?: string;
}) {
  return (
    <Tag
      className={`hud-frame hud-tone-${tone}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {label && <div className="hud-frame-label">{label}</div>}
      {children}
    </Tag>
  );
}

/**
 * Segmented bar gauge with tick marks. `marker` draws a threshold line
 * (e.g. the minimum city count, the special's reserve requirement).
 */
export function Gauge({
  value,
  max = 100,
  tone = 'info',
  segments = 20,
  label,
  testId,
  marker,
  showValue = true,
  unit,
  size = 'md',
}: {
  value: number;
  max?: number;
  tone?: Tone;
  segments?: number;
  label?: string;
  testId?: string;
  marker?: number;
  showValue?: boolean;
  unit?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={`hud-gauge hud-gauge-${size} hud-tone-${tone}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      data-testid={testId}
      style={{ ['--seg' as string]: `${100 / segments}%` }}
    >
      <span className="hud-gauge-track">
        <span className="hud-gauge-fill" style={{ width: `${pct}%` }} />
        {marker !== undefined && (
          <span
            className="hud-gauge-marker"
            style={{ left: `${Math.max(0, Math.min(100, (marker / max) * 100))}%` }}
          />
        )}
      </span>
      {showValue && (
        <span className="hud-gauge-num hud-num">
          {Math.round(value)}
          {unit && <small>{unit}</small>}
        </span>
      )}
    </div>
  );
}

/** Label over a big tabular number (clock, counts). */
export function Readout({
  label,
  value,
  unit,
  tone = 'idle',
  testId,
  ariaLabel,
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  testId?: string;
  ariaLabel?: string;
  icon?: IconName;
}) {
  return (
    <div className={`hud-readout hud-tone-${tone}`} data-testid={testId} aria-label={ariaLabel}>
      <span className="hud-label">
        {icon && <Icon name={icon} size={12} />}
        {label}
      </span>
      <span className="hud-readout-value hud-num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/** Square status lamp with a text state next to it (never colour alone). */
export function Lamp({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`hud-lamp hud-tone-${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Keyboard hint, e.g. <Key k="Space" />. */
export function Key({ k }: { k: string }) {
  return <kbd className="hud-key">{k}</kbd>;
}

/** Small uppercase tag (REC, LETHAL, BARRIER…). */
export function Tag({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`hud-tag hud-tone-${tone}`}>{children}</span>;
}

/**
 * Set a short-lived state when `trigger` changes (lock-on, hit, fire,
 * repair…). Returns true for `ms` after each change; the CSS animation
 * keyed to it is disabled under reduced motion.
 */
export function useFlash(trigger: unknown, ms = 700): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (trigger === null || trigger === undefined || trigger === false) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [trigger, ms]);
  return on;
}

/** prefers-reduced-motion (the venue/demo settings can force it with `forced`). */
export function useReducedMotion(forced = false): boolean {
  const [reduced, setReduced] = useState(forced);
  useEffect(() => {
    if (forced) return setReduced(true);
    const mq =
      typeof window !== 'undefined'
        ? window.matchMedia?.('(prefers-reduced-motion: reduce)')
        : null;
    if (!mq) return;
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [forced]);
  return reduced;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Two-digit countdown "08". */
export function fmtSecs(s: number): string {
  return String(Math.max(0, Math.ceil(s))).padStart(2, '0');
}
