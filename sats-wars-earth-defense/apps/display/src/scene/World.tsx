import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import type { QualityPreset } from '@swed/shared';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { socket, store } from '../net';
import { anim, updateAnim } from './anim';
import { projectAnchors } from './anchors';
import { Battlefield, BattlefieldLights } from './Battlefield';
import { CameraDirector, type SceneMode } from './CameraDirector';
import { Enemies } from './Enemies';
import { Fx } from './Fx';
import { Hangar, HangarLights } from './Hangar';
import { JapanHolo } from './JapanHolo';
import { Raijin } from './Raijin';

/**
 * The big-screen 3D world. The phase (from the server) picks the set; continuous
 * choreography comes from the match clock, so every display shows the same moment.
 */

const QUALITY_ORDER: QualityPreset[] = ['SAFE', 'BALANCED', 'CINEMATIC'];

export function minQuality(a: QualityPreset, b: QualityPreset): QualityPreset {
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(a), QUALITY_ORDER.indexOf(b))]!;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.32;
    return () => {
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Fog({ mode }: { mode: SceneMode }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog =
      mode === 'hangar' || mode === 'launch'
        ? new THREE.FogExp2('#0b131a', 0.016)
        : new THREE.FogExp2('#071420', 0.0028);
    scene.background = new THREE.Color('#03070c');
  }, [mode, scene]);
  return null;
}

/** Writes stage-space positions of HUD anchors each frame. */
function Projector() {
  useFrame(({ camera }) => projectAnchors(camera, 1920, 1080), 1);
  return null;
}

/** Measures FPS; steps quality down if the PC cannot hold it; reports to the operator. */
function PerfGovernor({
  quality,
  onCap,
  lost,
}: {
  quality: QualityPreset;
  onCap: (q: QualityPreset) => void;
  lost: boolean;
}) {
  const frames = useRef(0);
  const windowStart = useRef(performance.now());
  const lowWindows = useRef(0);
  const { size } = useThree();
  useFrame(() => {
    frames.current += 1;
    const now = performance.now();
    const span = now - windowStart.current;
    if (span < 3_000) return;
    const fps = (frames.current * 1000) / span;
    frames.current = 0;
    windowStart.current = now;
    lowWindows.current = fps < 28 ? lowWindows.current + 1 : 0;
    if (lowWindows.current >= 3 && quality !== 'SAFE') {
      lowWindows.current = 0;
      onCap(QUALITY_ORDER[QUALITY_ORDER.indexOf(quality) - 1]!);
    }
    socket.emit('display:stats', {
      fps: Math.round(fps * 10) / 10,
      quality,
      webglLost: lost,
      width: Math.round(size.width),
      height: Math.round(size.height),
    });
  });
  return null;
}

function Director({ onMode }: { onMode: (m: SceneMode) => void }) {
  const last = useRef<SceneMode | null>(null);
  useFrame(() => {
    const now = performance.now();
    updateAnim(store.getState().snap?.state, store.matchTime(now));
    if (anim.mode !== last.current) {
      last.current = anim.mode;
      onMode(anim.mode);
    }
  }, -1);
  return null;
}

function PostFx({ quality, reduceFlash }: { quality: QualityPreset; reduceFlash: boolean }) {
  if (quality === 'SAFE') {
    return (
      <EffectComposer multisampling={0}>
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={quality === 'CINEMATIC' ? 4 : 0}>
      <Bloom
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.2}
        intensity={reduceFlash ? 0.45 : 0.85}
        radius={0.7}
      />
      <Vignette offset={0.28} darkness={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

export function World({
  quality,
  reduceFlash,
  reducedMotion,
}: {
  quality: QualityPreset;
  reduceFlash: boolean;
  reducedMotion: boolean;
}) {
  const [mode, setMode] = useState<SceneMode>('hangar');
  const [cap, setCap] = useState<QualityPreset>('CINEMATIC');
  const [lost, setLost] = useState(false);
  const q = minQuality(quality, cap);
  const shadows = q !== 'SAFE';
  const indoor = mode === 'hangar' || mode === 'launch';
  return (
    <>
      <Canvas
        flat
        shadows={shadows}
        dpr={q === 'CINEMATIC' ? [1, 2] : q === 'BALANCED' ? [1, 1.25] : 1}
        gl={{ antialias: q !== 'CINEMATIC', powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 46, near: 0.3, far: 2500, position: [0, 4, -20] }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setLost(true);
            setCap('SAFE');
          });
          gl.domElement.addEventListener('webglcontextrestored', () => setLost(false));
        }}
      >
        <Director onMode={setMode} />
        <Environment />
        <Fog mode={mode} />
        {indoor ? (
          <>
            <HangarLights shadows={shadows} />
            <Hangar />
          </>
        ) : (
          <>
            <BattlefieldLights shadows={shadows} />
            <Battlefield />
            <JapanHolo />
            <Enemies />
          </>
        )}
        <Raijin />
        <Fx reduceFlash={reduceFlash} />
        <CameraDirector mode={mode} reducedMotion={reducedMotion} />
        <Projector />
        <PerfGovernor quality={q} onCap={setCap} lost={lost} />
        <PostFx quality={q} reduceFlash={reduceFlash} />
      </Canvas>
      {lost ? <div className="gl-lost">映像を復旧中 / RESTORING VIDEO</div> : null}
    </>
  );
}
