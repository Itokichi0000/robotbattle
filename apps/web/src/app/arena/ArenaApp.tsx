'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import {
  ArenaDirector,
  type Banner,
  type FrameStats,
  SfxEngine,
  type SfxName,
  cueFromEvent,
} from '@sats-wars/three-game';
import { boardView } from '@/lib/battle';
import { useConnectionState, useMatchConnection, useSnapshot } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ArenaHud } from './ArenaHud';
import { Arena2D } from './Arena2D';
import {
  type ArenaSettings,
  loadArenaSettings,
  loadRobotModels,
  saveArenaSettings,
  webglAvailable,
} from './settings';
import { PREVIEW_HELP, handlePreviewKey, newPreviewState } from './preview';
import { SettingsPanel } from './SettingsPanel';

const ArenaScene = dynamic(() => import('@sats-wars/three-game').then((m) => m.ArenaScene), {
  ssr: false,
  loading: () => null,
});

export function ArenaApp() {
  const { locale } = useI18n();
  const conn = useMatchConnection('arena');
  const snap = useSnapshot(conn);
  const connState = useConnectionState(conn);
  const director = useMemo(() => new ArenaDirector(), []);
  const sfx = useMemo(() => new SfxEngine(), []);
  const [settings, setSettings] = useState<ArenaSettings | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [robotModels, setRobotModels] = useState<Partial<Record<TeamId, string>> | null>(null);
  const [modelError, setModelError] = useState(false);
  const [preview, setPreview] = useState(false);
  const previewState = useRef(newPreviewState());
  const previewRef = useRef(false);
  previewRef.current = preview;

  useEffect(() => {
    setSettings(loadArenaSettings());
    setWebgl(webglAvailable());
    void loadRobotModels().then(setRobotModels);
    const q = new URLSearchParams(window.location.search);
    setPreview(q.get('preview') === '1');
    const speed = Number(q.get('speed'));
    if (speed > 0 && speed <= 1) director.timeScale = speed;
  }, [director]);
  useEffect(() => {
    if (!settings) return;
    saveArenaSettings(settings);
    director.settings = {
      reducedMotion: settings.reducedMotion,
      shakeScale: settings.shake,
      shortSpecials: settings.shortSpecials,
    };
    sfx.setVolume(settings.volume);
    sfx.setMuted(settings.muted);
    document.documentElement.classList.toggle('sw-reduced-motion', settings.reducedMotion);
  }, [settings, director, sfx]);

  useEffect(() => {
    const offBanner = director.onBanner((b) => setBanner(b));
    const offSound = director.onSound((name) => {
      const map: Record<string, SfxName> = {
        hit: 'hit',
        thunder: 'thunder',
        wind: 'wind',
        capture: 'capture',
        shield: 'shield',
        charge: 'charge',
        special: 'special',
        victory: 'victory',
        ko: 'ko',
        intro: 'intro',
      };
      const s = map[name];
      if (s) sfx.play(s);
    });
    return () => {
      offBanner();
      offSound();
    };
  }, [director, sfx]);

  // Event stream -> cues. Cheers only add a little aura (the HUD shows them).
  useEffect(() => {
    if (!conn) return;
    const offs = [
      conn.store.onEvent((e) => cueFromEvent(director, e)),
      conn.onCheer(() => director.play({ kind: 'cheer' })),
    ];
    return () => offs.forEach((o) => o());
  }, [conn, director]);

  // A different campaign (initial load / next campaign): start the director
  // from a calm stance; a finished campaign keeps its game-over banner up.
  const lastMatch = useRef<string | null>(null);
  const syncToSnapshot = useCallback(
    (s: PublicMatchSnapshot) => {
      if (lastMatch.current === s.matchId || previewRef.current) return;
      lastMatch.current = s.matchId;
      director.reset();
      if (s.status === 'FINISHED' && s.result) director.play({ kind: 'japanFallen', reachedWave: s.result.reachedWave });
    },
    [director],
  );
  useEffect(() => {
    if (snap) syncToSnapshot(snap);
  }, [snap, syncToSnapshot]);

  const use3d = !!settings && settings.renderer !== '2d' && webgl === true && !contextLost;
  useEffect(() => {
    if (!conn || !settings) return;
    const id = setInterval(() => {
      conn.reportArenaStatus({
        fps: use3d ? (stats?.fps ?? 0) : 60,
        frameMs: use3d ? (stats?.frameMs ?? 0) : 16,
        renderer: use3d ? 'webgl' : '2d',
        quality: settings.quality,
      });
    }, 5000);
    return () => clearInterval(id);
  }, [conn, settings, stats, use3d]);

  // Keyboard: F fullscreen, S settings, M mute.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'f' || e.key === 'F')
        void (document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen?.());
      if (e.key === 's' || e.key === 'S') setPanelOpen((v) => !v);
      if (e.key === 'm' || e.key === 'M') setSettings((s) => (s ? { ...s, muted: !s.muted } : s));
      if (preview) handlePreviewKey(e.key, director, previewState.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, director]);

  const enableAudio = async () => {
    setAudioOn(await sfx.unlock());
  };

  if (!snap || !settings) {
    return (
      <div className="flex h-dvh items-center justify-center bg-navy text-2xl font-bold">
        {connState === 'offline'
          ? 'ゲームサーバーに接続できません / Cannot reach the game server'
          : '読み込み中… / Loading…'}
      </div>
    );
  }

  const view = boardView(snap);
  // Both gods glow while the combo is ready (a cue for the crowd to fire it).
  const g = view.comboReady ? 1 : 0.15 + 0.5 * (snap.combo / snap.config.comboGaugeMax);
  const glow: Record<TeamId, number> = { RAIJIN: g, FUJIN: g };

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-navy"
      data-testid="arena-root"
      data-renderer={use3d ? 'webgl' : '2d'}
      data-models={settings.models === 'auto' && robotModels && !modelError ? 'glb' : 'procedural'}
    >
      {use3d ? (
        <ArenaScene
          director={director}
          regions={snap.regions}
          enemies={snap.enemies}
          danger={view.danger}
          cityHpMax={snap.config.cityHpMax}
          glow={glow}
          quality={settings.quality}
          reducedMotion={settings.reducedMotion}
          locale={locale}
          onStats={setStats}
          onContextLost={() => setContextLost(true)}
          robotModels={
            settings.models === 'auto' && !modelError ? (robotModels ?? undefined) : undefined
          }
          onModelError={() => setModelError(true)}
        />
      ) : (
        <Arena2D snap={snap} view={view} director={director} />
      )}
      <ArenaHud
        snap={snap}
        conn={conn!}
        view={view}
        connState={connState}
        banner={banner}
        stats={settings.showStats ? stats : null}
        renderer={use3d ? 'webgl' : '2d'}
        contextLost={contextLost}
        reducedMotion={settings.reducedMotion}
        preview={preview}
      />
      {!audioOn && !settings.muted && (
        <button
          onClick={enableAudio}
          className="absolute left-1/2 top-[29%] z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-base font-bold text-off ring-1 ring-white/30"
        >
          🔊 クリックで音声ON / Click to enable sound
        </button>
      )}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-off/60 hover:text-off"
        aria-label="settings"
      >
        ⚙ S
      </button>
      {preview && (
        <div
          className="absolute left-1/2 top-[19%] z-30 -translate-x-1/2 rounded bg-yellow-300/90 px-3 py-1 text-sm font-bold text-navy"
          data-testid="preview-banner"
        >
          {PREVIEW_HELP}（演出のみ・試合に影響なし）
        </div>
      )}
      {panelOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setPanelOpen(false)}
          webgl={!!webgl}
        />
      )}
    </div>
  );
}
