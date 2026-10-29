import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CityState, CrewMember, Enemy, RegionId, TeamId, Telegraph } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { Effects } from './Effects';
import { CockpitBay } from './CockpitBay';
import { Enemies } from './Enemies';
import { type Quality, QUALITY_SETTINGS, CAMERA_PRESETS, RESERVE_POSITION } from './layout';
import { type CityThreat, MapOverlay } from './MapOverlay';
import { ModelRobotActor } from './GlbRobotActor';
import { ArenaModel } from './ArenaModel';
import { PostFx, StageEnvironment } from './PostFx';
import {
  ArenaStage,
  CameraRig,
  DirectorClock,
  type FrameStats,
  LightingRig,
  PerformanceProbe,
} from './SceneParts';

export interface ArenaSceneProps {
  director: ArenaDirector;
  cities: CityState[];
  enemies: Enemy[];
  telegraphs: Telegraph[];
  /** Incoming attacks per city (seconds left, lethal), for warning glows. */
  threats: Partial<Record<RegionId, CityThreat>>;
  cityMaxHp: number;
  /** 0..1 per robot: extra glow (robot energy). */
  glow: Record<TeamId, number>;
  /** Hull 0..100 per robot: damage stages (cracks, opened plates). */
  health?: Record<TeamId, number>;
  /** 0..1 shared reserve energy (final special). */
  reserve: number;
  quality: Quality;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
  onStats?: (s: FrameStats) => void;
  /** Called when the WebGL context is lost so the page can fall back to 2D. */
  onContextLost?: () => void;
  /** Optional GLB URLs per team (same joint/clip names); procedural robots otherwise. */
  robotModels?: Partial<Record<TeamId, string>>;
  /** Optional NULL CORE GLB; the procedural boss otherwise. */
  bossModel?: string;
  /** Optional arena GLB (stage, bases, skyline); the procedural stage otherwise. */
  arenaModel?: string;
  /** NULL CORE's core barrier holds (shown as a shell). */
  bossBarrier?: boolean;
  /** Pilots aboard (public, consent-moderated) for the cockpit bay. */
  crew?: CrewMember[];
  /** Keep the drawing buffer (replay recording). */
  preserveDrawingBuffer?: boolean;
  onModelError?: (e: unknown) => void;
}

/**
 * Venue 3D scene: RAIJIN and FUJIN side by side in front, the hologram of
 * Japan's 8 defence cities between them, NULL CORE and its escorts beyond.
 * Pure presentation: everything shown comes from server state + director cues.
 */
export function ArenaScene(props: ArenaSceneProps) {
  const { director, glow, quality, reducedMotion } = props;
  const live = useRef({ enemies: props.enemies, telegraphs: props.telegraphs });
  live.current = { enemies: props.enemies, telegraphs: props.telegraphs };
  const q = QUALITY_SETTINGS[quality];
  const statsRef = useRef(props.onStats);
  statsRef.current = props.onStats;

  return (
    <>
      <Canvas
        shadows={q.shadows}
        dpr={q.dpr}
        gl={{
          // With post-processing the HDR buffer does its own multisampling.
          antialias: q.antialias && !q.post,
          powerPreference: 'high-performance',
          // Replays keep the frame so the browser recorder can copy it.
          preserveDrawingBuffer: !!props.preserveDrawingBuffer,
        }}
        camera={{ fov: 42, near: 0.1, far: 200, position: CAMERA_PRESETS.intro.position }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            props.onContextLost?.();
          });
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <color attach="background" args={['#070D1A']} />
        <fog attach="fog" args={['#070D1A', 24, 60]} />
        <DirectorClock director={director} />
        <CameraRig director={director} reducedMotion={reducedMotion} targets={() => live.current} />
        <StageEnvironment intensity={q.envIntensity} />
        <LightingRig shadows={q.shadows} />
        {props.arenaModel ? (
          <>
            <ArenaStage stars={q.stars} floor={false} />
            <ArenaModel
              url={props.arenaModel}
              fallback={<ArenaStage stars={0} />}
              onError={props.onModelError}
            />
          </>
        ) : (
          <ArenaStage stars={q.stars} />
        )}
        <MapOverlay
          cities={props.cities}
          threats={props.threats}
          cityMaxHp={props.cityMaxHp}
          director={director}
          reducedMotion={reducedMotion}
          locale={props.locale}
        />
        <Enemies
          enemies={props.enemies}
          telegraphs={props.telegraphs}
          director={director}
          reducedMotion={reducedMotion}
          bossModel={props.bossModel}
          bossBarrier={props.bossBarrier}
        />
        <ReserveReactor level={props.reserve} />
        <CockpitBay
          crew={props.crew ?? []}
          director={director}
          reducedMotion={reducedMotion}
          locale={props.locale}
        />
        <ModelRobotActor
          teamId="RAIJIN"
          url={props.robotModels?.RAIJIN}
          director={director}
          energyRatio={glow.RAIJIN}
          health={props.health?.RAIJIN}
          onModelError={props.onModelError}
        />
        <ModelRobotActor
          teamId="FUJIN"
          url={props.robotModels?.FUJIN}
          director={director}
          energyRatio={glow.FUJIN}
          health={props.health?.FUJIN}
          onModelError={props.onModelError}
        />
        <Effects
          director={director}
          budget={q.fx}
          reducedMotion={reducedMotion}
          targets={() => live.current}
        />
        {q.post && <PostFx director={director} config={q.post} reducedMotion={reducedMotion} />}
        <PerformanceProbe onStats={(s: FrameStats) => statsRef.current?.(s)} />
      </Canvas>
      <Letterbox director={director} reducedMotion={reducedMotion} />
    </>
  );
}

/**
 * Cinema bars for the big cinematics (DOM, above the 3D view and below the
 * page's HUD, so every quality level gets them).
 */
function Letterbox({
  director,
  reducedMotion,
}: {
  director: ArenaDirector;
  reducedMotion: boolean;
}) {
  const [on, setOn] = useState(director.letterbox);
  useEffect(() => director.onLetterbox(setOn), [director]);
  const bar = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: on ? '8%' : '0%',
    background: '#000',
    transition: reducedMotion ? 'none' : 'height 0.45s ease',
  } as const;
  return (
    <div
      aria-hidden
      data-testid="arena-letterbox"
      data-on={on ? '1' : '0'}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <div style={{ ...bar, top: 0 }} />
      <div style={{ ...bar, bottom: 0 }} />
    </div>
  );
}

/** Shared reserve reactor between the robots: fills up for the final special. */
function ReserveReactor({ level }: { level: number }) {
  const h = 0.2 + Math.max(0, Math.min(1, level)) * 1.6;
  return (
    <group position={RESERVE_POSITION} name="reserve-reactor">
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 1.9, 24, 1, true]} />
        <meshStandardMaterial color="#0E2240" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.45, 0.45, h, 24]} />
        <meshStandardMaterial
          color="#FFE27A"
          emissive={new THREE.Color('#FFB020')}
          emissiveIntensity={0.6 + level}
        />
      </mesh>
    </group>
  );
}
