/** Japanese is the default UI language; English is the toggle (spec §3.4). */
export type Lang = 'ja' | 'en';

export function pick(lang: Lang, ja: string, en: string): string {
  return lang === 'ja' ? ja : en;
}

/** "PILOT-7F3A"-style public names: never derived from a key, never a real name. */
export function makePublicPilotName(random4Hex: string): string {
  return `PILOT-${random4Hex.toUpperCase().slice(0, 4)}`;
}

/** mm:ss for countdowns. Negative values clamp to 00:00. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
