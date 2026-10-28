import { storage } from '@/lib/api';

export interface ArenaSettings {
  quality: 'low' | 'medium' | 'high';
  renderer: 'auto' | '3d' | '2d';
  reducedMotion: boolean;
  /** 0..1 */
  shake: number;
  shortSpecials: boolean;
  volume: number;
  muted: boolean;
  showStats: boolean;
}

const DEFAULTS: ArenaSettings = {
  quality: 'medium',
  renderer: 'auto',
  reducedMotion: false,
  shake: 0.7,
  shortSpecials: false,
  volume: 0.7,
  muted: false,
  showStats: false,
};

const KEY = 'sw.arena.settings';

/** Settings persist per venue PC; URL params (?quality=low&mode=2d&reduced=1) override. */
export function loadArenaSettings(): ArenaSettings {
  let s: ArenaSettings = { ...DEFAULTS };
  const saved = storage.get(KEY);
  try {
    if (saved) s = { ...s, ...(JSON.parse(saved) as Partial<ArenaSettings>) };
  } catch {
    // ignore corrupt settings
  }
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search);
    const quality = q.get('quality');
    if (quality === 'low' || quality === 'medium' || quality === 'high') s.quality = quality;
    const mode = q.get('mode');
    if (mode === '2d' || mode === '3d') s.renderer = mode;
    if (q.get('reduced') === '1') s.reducedMotion = true;
    if (q.get('stats') === '1') s.showStats = true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !saved) s.reducedMotion = true;
  }
  return s;
}

export function saveArenaSettings(s: ArenaSettings): void {
  storage.set(KEY, JSON.stringify(s));
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
