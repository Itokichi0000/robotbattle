'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRaidSnapshot, TeamId } from '@sats-wars/shared';
import {
  ArenaDirector,
  type Banner,
  type FrameStats,
  QualityGovernor,
  SfxEngine,
  type SfxName,
  cueFromEvent,
} from '@sats-wars/three-game';
import { raidView } from '@sats-wars/ui';
import { useConnectionState, useRaid, useRaidConnection, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ArenaHud } from './ArenaHud';
import { Arena2D } from './Arena2D';
import {
  type ArenaSettings,
  loadArenaSettings,
  type ModelUrls,
  loadModels,
  saveArenaSettings,
  webglAvailable,
} from './settings';
import { PREVIEW_HELP, handlePreviewKey, newPreviewState, playArenaCue } from './preview';
import { SettingsPanel } from './SettingsPanel';

const ArenaScene = dynamic(() => import('@sats-wars/three-game').then((m) => m.ArenaScene), {
  ssr: false,
  loading: () => null,
});

export function ArenaApp() {
  const { locale, explicit, setDefaultLocale } = useI18n();
  const conn = useRaidConnection('arena');
  const snap = useRaid(conn);
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
  const [models, setModels] = useState<ModelUrls | null>(null);
  const [modelError, setModelError] = useState(false);
  const [preview, setPreview] = useState(false);
  const previewState = useRef(newPreviewState());
  const previewRef = useRef(false);
  previewRef.current = preview;

  useEffect(() => {
    setSettings(loadArenaSettings());
    setWebgl(webglAvailable());
    const q = new URLSearchParams(window.location.search);
    setPreview(q.get('preview') === '1');
    const speed = Number(q.get('speed'));
    if (speed > 0 && speed <= 1) director.timeScale = speed;
  }, [director]);
  // Model source can change from the settings panel.
  const modelMode = settings?.models;
  useEffect(() => {
    if (!modelMode) return;
    let alive = true;
    void loadModels(modelMode).then((m) => alive && setModels(m));
    return () => {
      alive = false;
    };
  }, [modelMode]);
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
      sfx.play(name as SfxName);
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
      conn.onArenaCue((c) => playArenaCue(c, director)),
    ];
    return () => offs.forEach((o) => o());
  }, [conn, director]);

  // A different raid (initial load / next raid): start the director from a
  // calm stance; a finished raid keeps its result banner up.
  const lastRaid = useRef<string | null>(null);
  const syncToSnapshot = useCallback(
    (s: PublicRaidSnapshot) => {
      if (lastRaid.current === s.raidId || previewRef.current) return;
      lastRaid.current = s.raidId;
      director.reset();
      if (s.status === 'ENDED' && s.result) director.play({ kind: 'raidEnded', result: s.result });
    },
    [director],
  );
  useEffect(() => {
    if (snap) syncToSnapshot(snap);
  }, [snap, syncToSnapshot]);

  // Venue screen language set by the operators, unless this PC chose one.
  const arenaLocale = snap?.arenaLocale;
  useEffect(() => {
    if (arenaLocale && !explicit) setDefaultLocale(arenaLocale);
  }, [arenaLocale, explicit, setDefaultLocale]);

  // Display pushed from /admin: applied once per change (rev), then the venue
  // PC can still adjust locally (S panel) until the next push.
  const pushedRev = useRef<number | null>(null);
  const display = snap?.arenaDisplay;
  useEffect(() => {
    if (!display || pushedRev.current === display.rev) return;
    const first = pushedRev.current === null;
    pushedRev.current = display.rev;
    // rev 0 = operators never pushed anything: keep this PC's own settings.
    if (first && display.rev === 0) return;
    setSettings((s) =>
      s
        ? {
            ...s,
            renderer: display.renderer,
            ...(display.quality !== 'auto' ? { quality: display.quality } : {}),
            autoQuality: display.quality === 'auto',
            volume: display.volume,
          }
        : s,
    );
  }, [display]);

  // Automatic quality reduction (spec D6): step down on sustained low FPS,
  // 2D as the last resort; climbs back up to the operator's choice.
  const [autoLevel, setAutoLevel] = useState<'low' | 'medium' | 'high' | '2d' | null>(null);
  const governor = useRef<QualityGovernor | null>(null);
  const ceiling = settings?.quality;
  const autoOn = settings?.autoQuality ?? false;
  useEffect(() => {
    governor.current = autoOn && ceiling ? new QualityGovernor({ ceiling }) : null;
    setAutoLevel(null);
  }, [autoOn, ceiling]);
  useEffect(() => {
    if (!stats || !governor.current) return;
    const next = governor.current.sample(stats.fps, performance.now() / 1000);
    if (next) setAutoLevel(next);
  }, [stats]);

  const use3d =
    !!settings &&
    settings.renderer !== '2d' &&
    autoLevel !== '2d' &&
    webgl === true &&
    !contextLost;
  const quality = autoLevel && autoLevel !== '2d' ? autoLevel : (settings?.quality ?? 'medium');
  useEffect(() => {
    if (!conn || !settings) return;
    const id = setInterval(() => {
      conn.reportArenaStatus({
        fps: use3d ? (stats?.fps ?? 0) : 60,
        frameMs: use3d ? (stats?.frameMs ?? 0) : 16,
        renderer: use3d ? 'webgl' : '2d',
        quality,
        autoQuality: !!autoLevel,
      });
    }, 5000);
    return () => clearInterval(id);
  }, [conn, settings, stats, use3d, autoLevel, quality]);

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

  // The HUD clock and threat countdowns tick between server events.
  useTicker(250);

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

  const gameNow = conn!.gameNow();
  const view = raidView(snap, gameNow);
  const glow: Record<TeamId, number> = {
    RAIJIN: 0.15 + 0.85 * (snap.robots[0]!.energy / 100),
    FUJIN: 0.15 + 0.85 * (snap.robots[1]!.energy / 100),
  };
  const threats = Object.fromEntries(
    Object.entries(view.threats).map(([k, t]) => [k, { seconds: t!.seconds, lethal: t!.lethal }]),
  );

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-navy"
      data-testid="arena-root"
      data-renderer={use3d ? 'webgl' : '2d'}
      data-models={models?.RAIJIN && !modelError ? 'glb' : 'procedural'}
    >
      {use3d ? (
        <ArenaScene
          director={director}
          cities={snap.cities}
          enemies={snap.enemies}
          telegraphs={snap.telegraphs}
          threats={threats}
          cityMaxHp={snap.config.cityMaxHp}
          glow={glow}
          reserve={snap.reserveEnergy / 100}
          quality={quality}
          reducedMotion={settings.reducedMotion}
          locale={locale}
          onStats={setStats}
          onContextLost={() => setContextLost(true)}
          robotModels={
            !modelError && models
              ? {
                  ...(models.RAIJIN ? { RAIJIN: models.RAIJIN } : {}),
                  ...(models.FUJIN ? { FUJIN: models.FUJIN } : {}),
                }
              : undefined
          }
          bossModel={!modelError ? models?.BOSS : undefined}
          bossBarrier={view.bossBarrier}
          onModelError={() => setModelError(true)}
        />
      ) : (
        <Arena2D snap={snap} view={view} locale={locale} />
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
        preview={preview}
      />
      {!audioOn && !settings.muted && (
        <button
          onClick={enableAudio}
          className="absolute bottom-[13%] left-[1.2vw] z-30 rounded-full bg-black/70 px-4 py-2 text-base font-bold text-off ring-1 ring-white/30"
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
