import type { PublicMatchState } from '@swed/shared';
import type { SceneMode } from './CameraDirector';

/**
 * Continuous choreography values derived from the server phase clock, written once per
 * frame by the world and read by the mech/hangar in their own frame loops (no re-render).
 */
export const anim = {
  mode: 'hangar' as SceneMode,
  /** Launch/landing height. */
  liftY: 0,
  /** Thruster output 0..1. */
  thrust: 0.15,
  /** Seat lights/visor power 0..1 (attract loop idles darker). */
  powered: 1,
  /** Roof hatch 0..1. */
  hatch: 0,
  /** Rotating amber warning beacon 0..1. */
  alarm: 0,
  /** REACTOR BLACKOUT: 1 while the reactor is dark (lights eased toward it each frame). */
  blackoutTarget: 0,
  blackout: 0,
  /** Reactor OVERCHARGE after a GRID PULSE or crew re-route. */
  overcharge: false,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function updateAnim(s: PublicMatchState | undefined, mt: number): void {
  anim.blackoutTarget = s?.crisis ? 1 : 0;
  anim.overcharge = !!s && mt < s.overchargeUntil;
  anim.alarm = 0;
  anim.hatch = 0;
  anim.liftY = 0;
  anim.thrust = 0.15;
  anim.powered = 1;
  if (!s) {
    anim.mode = 'hangar';
    anim.powered = 0.5;
    return;
  }
  switch (s.phase) {
    case 'ATTRACT':
      anim.mode = 'hangar';
      anim.powered = 0.6;
      break;
    case 'LOBBY':
      anim.mode = 'hangar';
      break;
    case 'COUNTDOWN':
      anim.mode = 'hangar';
      anim.alarm = 1;
      anim.thrust = 0.3;
      break;
    case 'DEPLOYMENT': {
      const span = Math.max(1, (s.phaseEndsAt ?? mt) - s.phaseStartedAt);
      const k = clamp01((mt - s.phaseStartedAt) / span);
      if (k < 0.5) {
        anim.mode = 'launch';
        anim.alarm = 1;
        anim.hatch = clamp01((k - 0.03) / 0.2);
        anim.thrust = k < 0.18 ? 0.3 + k * 2 : 1;
        anim.liftY = k < 0.22 ? 0 : Math.pow((k - 0.22) / 0.28, 2) * 48;
      } else {
        anim.mode = 'landing';
        const d = clamp01((k - 0.5) / 0.32);
        anim.liftY = Math.pow(1 - d, 2) * 42;
        anim.thrust = d < 1 ? 1 : 0.25;
      }
      break;
    }
    case 'RESULTS':
      anim.mode = 'result';
      break;
    default:
      anim.mode = 'battle';
  }
}
