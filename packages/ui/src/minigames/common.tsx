import { useEffect, useRef, useState } from 'react';

/**
 * Milliseconds since the minigame appeared, refreshed every animation frame.
 * The server scores the input against the same clock origin (task hand-out),
 * with latency slack, so the client only reports "when" and never "how well".
 */
export function useElapsed(
  running: boolean,
  offsetMs = 0,
): { elapsed: number; startRef: React.RefObject<number> } {
  // offsetMs: time already spent on this task (e.g. the page was reloaded mid-task).
  const startRef = useRef<number>(performance.now() - offsetMs);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      setElapsed(performance.now() - startRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return { elapsed, startRef };
}

export function now(startRef: React.RefObject<number>): number {
  return Math.max(0, Math.round(performance.now() - startRef.current));
}

/** Global key handler while a minigame is open (Space/Enter/arrows/digits). */
export function useKeys(handler: (e: KeyboardEvent) => void, active: boolean): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      ref.current(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active]);
}

export interface MinigameProps<P, I> {
  params: P;
  locale: 'ja' | 'en';
  /** Called once with the raw input; the parent sends it to the server. */
  onSubmit: (input: I) => void;
  disabled?: boolean;
  offsetMs?: number;
}

/** Pointer and click both fire on touch; this lets only the first one through. */
export function useOnce(): () => boolean {
  const done = useRef(false);
  return () => {
    if (done.current) return false;
    done.current = true;
    return true;
  };
}
