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
  /** Background music (procedural score); off when the venue plays its own. */
  music: boolean;
  showStats: boolean;
  /**
   * auto = artist GLBs when a manifest exists (none yet), else the code-built models;
   * blender = the headless Blender blockouts (tools/blender/generate_assets.py);
   * procedural = always the code-built models.
   */
  models: 'auto' | 'blender' | 'procedural';
  /** Lower the 3D quality (and finally switch to 2D) when the FPS stays low. */
  autoQuality: boolean;
}

const DEFAULTS: ArenaSettings = {
  quality: 'medium',
  renderer: 'auto',
  reducedMotion: false,
  shake: 0.7,
  shortSpecials: false,
  volume: 0.7,
  muted: false,
  music: true,
  showStats: false,
  models: 'auto',
  autoQuality: true,
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
    if (quality === 'low' || quality === 'medium' || quality === 'high') {
      s.quality = quality;
      s.autoQuality = false;
    }
    if (quality === 'auto') s.autoQuality = true;
    const mode = q.get('mode');
    if (mode === '2d' || mode === '3d') s.renderer = mode;
    if (q.get('reduced') === '1') s.reducedMotion = true;
    if (q.get('stats') === '1') s.showStats = true;
    const models = q.get('models');
    if (models === 'auto' || models === 'blender' || models === 'procedural') s.models = models;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !saved)
      s.reducedMotion = true;
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

export type ModelUrls = Partial<Record<'RAIJIN' | 'FUJIN' | 'BOSS' | 'ARENA', string>>;

/**
 * Model URLs for the chosen source. `auto` looks for committed artist art and
 * then the exported procedural rigs; `blender` uses the Blender blockouts.
 */
export async function loadModels(mode: ArenaSettings['models']): Promise<ModelUrls | null> {
  const dirs =
    mode === 'blender'
      ? ['/assets/models/blender']
      : mode === 'auto'
        ? ['/assets/robots', '/assets/robots/generated']
        : [];
  for (const dir of dirs) {
    try {
      const r = await fetch(`${dir}/manifest.json`, { cache: 'no-store' });
      if (!r.ok) continue;
      const m = (await r.json()) as Record<string, string | undefined>;
      const out: ModelUrls = {};
      for (const k of ['RAIJIN', 'FUJIN', 'BOSS', 'ARENA'] as const)
        if (m[k]) out[k] = `${dir}/${m[k]}`;
      return out;
    } catch {
      // try next
    }
  }
  return null;
}
