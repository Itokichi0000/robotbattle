import type { MatchEvent } from '@swed/shared';

/** Confirmed server events fanned out to 3D effects, camera and audio. */
type Fn = (e: MatchEvent, receivedAt: number) => void;
const listeners = new Set<Fn>();

export const fxBus = {
  emit(e: MatchEvent): void {
    const now = performance.now();
    for (const l of listeners) l(e, now);
  },
  on(fn: Fn): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
