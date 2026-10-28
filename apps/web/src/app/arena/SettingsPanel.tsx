'use client';
import type { ArenaSettings } from './settings';

/** Operator-facing display settings for the venue PC (toggle with the S key). */
export function SettingsPanel({
  settings,
  onChange,
  onClose,
  webgl,
}: {
  settings: ArenaSettings;
  onChange: (s: ArenaSettings) => void;
  onClose: () => void;
  webgl: boolean;
}) {
  const set = <K extends keyof ArenaSettings>(k: K, v: ArenaSettings[K]) =>
    onChange({ ...settings, [k]: v });
  return (
    <div
      className="absolute bottom-12 left-1/2 z-40 w-[min(560px,92vw)] -translate-x-1/2 rounded-2xl bg-navy-2/95 p-4 text-sm ring-1 ring-white/20"
      role="dialog"
      aria-label="Arena settings"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black">表示設定 / Display settings</h2>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 hover:bg-white/10"
          aria-label="close"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          描画 / Renderer
          <select
            className="rounded bg-black/40 p-2"
            value={settings.renderer}
            onChange={(e) => set('renderer', e.target.value as ArenaSettings['renderer'])}
          >
            <option value="auto">auto {webgl ? '(WebGL OK)' : '(no WebGL → 2D)'}</option>
            <option value="3d">3D</option>
            <option value="2d">2D</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          負荷 / Quality
          <select
            className="rounded bg-black/40 p-2"
            value={settings.quality}
            onChange={(e) => set('quality', e.target.value as ArenaSettings['quality'])}
          >
            <option value="low">低 / low</option>
            <option value="medium">中 / medium</option>
            <option value="high">高 / high</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          ロボット / Robot models
          <select
            className="rounded bg-black/40 p-2"
            value={settings.models}
            onChange={(e) => set('models', e.target.value as ArenaSettings['models'])}
          >
            <option value="auto">GLB（あれば）/ GLB if available</option>
            <option value="blender">Blender 試作モデル / Blender blockouts</option>
            <option value="procedural">コード生成 / procedural</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          画面揺れ / Shake {Math.round(settings.shake * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.shake}
            onChange={(e) => set('shake', Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1">
          音量 / Volume {Math.round(settings.volume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => set('volume', Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => set('reducedMotion', e.target.checked)}
          />
          点滅・動き抑制 / Reduced motion
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.shortSpecials}
            onChange={(e) => set('shortSpecials', e.target.checked)}
          />
          必殺技演出を短縮 / Short specials
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.muted}
            onChange={(e) => set('muted', e.target.checked)}
          />
          ミュート / Mute (M)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showStats}
            onChange={(e) => set('showStats', e.target.checked)}
          />
          FPS表示 / Show FPS
        </label>
      </div>
      <p className="mt-3 text-xs text-off/60">
        F: フルスクリーン / fullscreen ・ S: この設定 / settings ・ M: ミュート / mute
      </p>
    </div>
  );
}
