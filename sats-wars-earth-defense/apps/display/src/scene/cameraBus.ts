/** Shared camera shake budget. Effects add to it; the director spends it, decaying fast. */
export const shake = { amount: 0 };

export function cameraKick(amount: number): void {
  shake.amount = Math.min(1.5, shake.amount + amount);
}

/**
 * RAIJIN OVERDRIVE finisher window (performance.now ms). The HUD fades and the camera holds
 * the finisher shot until then, so the picture leads (spec §9.1).
 */
export const finisher = { until: 0 };
