'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import { ArenaDirector, type Banner, type FrameStats } from '@sats-wars/three-game';
import { SfxEngine, type SfxName } from '@/lib/audio';
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
import { SettingsPanel } from './SettingsPanel';

const ArenaScene = dynamic(() => import('@sats-wars/three-game').then((m) => m.ArenaScene), {
  ssr: false,
  loading: () => null,
});

/** Map server events to director cues. The director never decides outcomes. */
function cueFromEvent(director: ArenaDirector, e: GameEvent): void {
  switch (e.type) {
    case 'ACTION_APPLIED': {
      const { code, regionId, teamId } = e.data;
      if (code === 'CHARGED') director.play({ kind: 'charge', teamId });
      else if (regionId && (code === 'CAPTURED' || code === 'CONTEST_BROKEN'))
        director.play({ kind: 'capture', regionId, teamId });
      else if (regionId && (code === 'CONTEST_STARTED' || code === 'SHIELD_BROKEN'))
        director.play({ kind: 'contest', regionId, teamId });
      else if (regionId && code === 'SHIELD_PLACED')
        director.play({ kind: 'shield', regionId, teamId });
      return;
    }
    case 'CLASH_RESOLVED':
      director.play({ kind: 'clash', clash: e.data.clash });
      return;
    case 'MATCH_STATUS_CHANGED':
      if (e.data.to === 'LIVE' && e.data.from === 'LOBBY') director.play({ kind: 'intro' });
      if (e.data.to === 'FINALIZING') director.play({ kind: 'final' });
      return;
    case 'MATCH_RESULT':
      if (e.data.result.reason !== 'CANCELLED')
        director.play({ kind: 'result', winner: e.data.result.winnerTeamId });
      return;
    default:
      return;
  }
}

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
  const [displayHp, setDisplayHp] = useState<Record<TeamId, number>>({ RAIJIN: 100, FUJIN: 100 });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [robotModels, setRobotModels] = useState<Partial<Record<TeamId, string>> | null>(null);
  const [modelError, setModelError] = useState(false);
  const gameMsRef = useRef(0);
  const introPlayedFor = useRef<string | null>(null);

  useEffect(() => {
    setSettings(loadArenaSettings());
    setWebgl(webglAvailable());
    void loadRobotModels().then(setRobotModels);
  }, []);
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
    const offHp = director.onHp((hp) => setDisplayHp({ ...hp }));
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
      offHp();
      offBanner();
      offSound();
    };
  }, [director, sfx]);

  // Event stream -> cues.
  useEffect(() => {
    if (!conn) return;
    return conn.store.onEvent((e) => cueFromEvent(director, e));
  }, [conn, director]);

  // Snapshot (initial load / resync / next match): align the director with authoritative state.
  const lastMatch = useRef<string | null>(null);
  const syncToSnapshot = useCallback(
    (s: PublicMatchSnapshot) => {
      const hp = { RAIJIN: s.teams.RAIJIN.hp, FUJIN: s.teams.FUJIN.hp };
      director.hpMax = s.config.hpMax;
      if (lastMatch.current !== s.matchId) {
        lastMatch.current = s.matchId;
        director.syncHp(hp, s.config.hpMax);
        if ((s.status === 'LOBBY' || s.status === 'LIVE') && introPlayedFor.current !== s.matchId) {
          introPlayedFor.current = s.matchId;
          director.play({ kind: 'intro' });
        }
        if ((s.status === 'FINALIZING' || s.status === 'FINISHED') && s.result)
          director.play({ kind: 'result', winner: s.result.winnerTeamId });
        if (s.status === 'CREATED') {
          director.robots.RAIJIN = { clip: 'Idle', start: director.time, advance: 0 };
          director.robots.FUJIN = { clip: 'Idle', start: director.time, advance: 0 };
          director.camera = { preset: 'overview', since: director.time };
          setBanner(null);
        }
      } else if (
        !director.busy &&
        (director.displayHp.RAIJIN !== hp.RAIJIN || director.displayHp.FUJIN !== hp.FUJIN)
      ) {
        director.syncHp(hp);
      }
    },
    [director],
  );
  useEffect(() => {
    if (snap) syncToSnapshot(snap);
  }, [snap, syncToSnapshot]);

  // Keep the game clock ref fresh for 3D labels; report status for operators.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (conn) gameMsRef.current = conn.now().gameMs;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [conn]);
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          teams={snap.teams}
          energyMax={snap.config.energyMax}
          gameMsRef={gameMsRef}
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
        <Arena2D snap={snap} displayHp={displayHp} director={director} gameMsRef={gameMsRef} />
      )}
      <ArenaHud
        snap={snap}
        conn={conn!}
        connState={connState}
        displayHp={displayHp}
        banner={banner}
        stats={settings.showStats ? stats : null}
        renderer={use3d ? 'webgl' : '2d'}
        contextLost={contextLost}
      />
      {!audioOn && !settings.muted && (
        <button
          onClick={enableAudio}
          className="absolute bottom-[9%] left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/70 px-5 py-2 text-lg font-bold text-off ring-1 ring-white/30"
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
