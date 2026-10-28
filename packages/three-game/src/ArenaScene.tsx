import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Enemy, RegionId, RegionState, TeamId } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { Effects } from './Effects';
import { type Quality, QUALITY_SETTINGS, CAMERA_PRESETS } from './layout';
import { MapOverlay, type RegionDanger } from './MapOverlay';
import { ModelRobotActor } from './GlbRobotActor';
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
  regions: RegionState[];
  enemies: Enemy[];
  /** What the next alien turn will do (from engine rules), for warning glows. */
  danger: Partial<Record<RegionId, RegionDanger>>;
  cityHpMax: number;
  /** 0..1 per robot: extra glow (e.g. combo gauge full). */
  glow: Record<TeamId, number>;
  quality: Quality;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
  onStats?: (s: FrameStats) => void;
  /** Called when the WebGL context is lost so the page can fall back to 2D. */
  onContextLost?: () => void;
  /** Optional GLB URLs per team (same joint/clip names); procedural robots otherwise. */
  robotModels?: Partial<Record<TeamId, string>>;
  onModelError?: (e: unknown) => void;
}

/**
 * Venue 3D scene: hologram map of Japan with the invading UFOs behind, RAIJIN
 * and FUJIN (allies) in front.
 * Pure presentation: everything shown comes from server state + director cues.
 */
export function ArenaScene(props: ArenaSceneProps) {
  const { director, regions, glow, quality, reducedMotion } = props;
  const q = QUALITY_SETTINGS[quality];
  const statsRef = useRef(props.onStats);
  statsRef.current = props.onStats;

  return (
    <Canvas
      shadows={q.shadows}
      dpr={q.dpr}
      gl={{
        antialias: q.antialias,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
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
      <CameraRig director={director} reducedMotion={reducedMotion} />
      <LightingRig shadows={q.shadows} />
      <ArenaStage stars={q.stars} />
      <MapOverlay
        regions={regions}
        enemies={props.enemies}
        danger={props.danger}
        cityHpMax={props.cityHpMax}
        director={director}
        reducedMotion={reducedMotion}
        locale={props.locale}
      />
      <ModelRobotActor
        teamId="RAIJIN"
        url={props.robotModels?.RAIJIN}
        director={director}
        energyRatio={glow.RAIJIN}
        onModelError={props.onModelError}
      />
      <ModelRobotActor
        teamId="FUJIN"
        url={props.robotModels?.FUJIN}
        director={director}
        energyRatio={glow.FUJIN}
        onModelError={props.onModelError}
      />
      <Effects director={director} maxParticles={q.particles} reducedMotion={reducedMotion} />
      <PerformanceProbe onStats={(s: FrameStats) => statsRef.current?.(s)} />
    </Canvas>
  );
}
