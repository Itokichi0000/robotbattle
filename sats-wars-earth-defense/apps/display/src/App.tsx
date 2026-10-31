import { useStore } from '@swed/client';
import type { QualityPreset } from '@swed/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { sfx } from './audio/sfx';
import { Hud } from './hud/Hud';
import { settings, store } from './net';
import { anim } from './scene/anim';
import { fxBus } from './scene/fxBus';
import { minQuality, World } from './scene/World';
import { Stage } from './Stage';

function usePrefersReducedMotion(): boolean {
  const [v, setV] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setV(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return v;
}

/** `?q=SAFE|BALANCED|CINEMATIC` caps quality on this screen only (weak PC, rehearsal capture). */
function urlQualityCap(): QualityPreset {
  const q = new URLSearchParams(window.location.search).get('q')?.toUpperCase();
  return q === 'SAFE' || q === 'BALANCED' ? q : 'CINEMATIC';
}
const URL_CAP = urlQualityCap();

export function App() {
  const cfg = useSyncExternalStore(settings.subscribe, settings.get, settings.get);
  const st = useStore(store);
  const prm = usePrefersReducedMotion();
  const [audioReady, setAudioReady] = useState(false);

  // Confirmed server events drive effects and sound.
  useEffect(
    () =>
      store.onEvent((m) => {
        fxBus.emit(m.payload);
        sfx.onEvent(m.payload);
      }),
    [],
  );

  // Browsers need one gesture before sound. Staff click once (or kiosk flags allow autoplay).
  useEffect(() => {
    const unlock = () => void sfx.unlock().then((ok) => ok && setAudioReady(true));
    const key = (e: KeyboardEvent) => {
      unlock();
      if (e.key === 'f' || e.key === 'F')
        void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', key);
    void sfx.unlock().then((ok) => ok && setAudioReady(true));
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => sfx.setVolume(cfg.muted ? 0 : cfg.volume), [cfg.muted, cfg.volume]);

  const phase = st.snap?.phase;
  const indoor = !phase || phase === 'LOBBY' || phase === 'COUNTDOWN';
  const ambience = indoor ? 'hangar' : phase === 'RESULTS' ? 'none' : 'battle';
  useEffect(() => {
    if (audioReady) sfx.ambience(ambience);
  }, [audioReady, ambience]);

  return (
    <Stage
      scene={
        <World
          quality={minQuality(cfg.quality, URL_CAP)}
          reduceFlash={cfg.reduceFlash}
          reducedMotion={prm || cfg.reduceFlash}
        />
      }
      hud={<Hud audioReady={audioReady} />}
    />
  );
}

// Exposed for automated captures and rehearsal debugging (read-only).
(window as unknown as { __sw: unknown }).__sw = { store, anim };
