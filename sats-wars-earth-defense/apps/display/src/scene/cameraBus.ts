/** Shared camera shake budget. Effects add to it; the director spends it, decaying fast. */
export const shake = { amount: 0 };

export function cameraKick(amount: number): void {
  shake.amount = Math.min(1.5, shake.amount + amount);
}
