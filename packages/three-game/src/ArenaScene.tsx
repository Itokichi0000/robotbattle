import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CityState, CrewMember, Enemy, RegionId, TeamId, Telegraph } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { StationHighlight, type TargetDesignation, TargetDesignator } from './Designator';
import { Effects } from './Effects';
import { CockpitBay } from './CockpitBay';
import { Enemies } from './Enemies';
import {
  applyStage,
  type Quality,
  QUALITY_SETTINGS,
  CAMERA_PRESETS,
  RESERVE_POSITION,
  type StageName,
} from './layout';
import { Battlefield, BAY_FOG, BAY_FOG_DENSITY } from './Battlefield';
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
  /** The gunner's current target (pilot screens): brackets around it in the world. */
  designation?: { current: TargetDesignation | null };
  /** Hangar: the station being chosen; its part of the machine is bracketed. */
  focusStation?: 'GUNNER' | 'GUARDIAN' | 'ROUTER' | 'ENGINEER' | null;
  /**
   * `table` (default): the war table with the hologram of Japan. `battlefield`:
   * the venue's Tokyo Bay defence line (D-073) — the map moves to the HUD.
   */
  stage?: StageName;
  /** Equirectangular .hdr for the battlefield's reflections (procedural if absent). */
  envMap?: string;
}

/**
 * Venue 3D scene: RAIJIN and FUJIN side by side in front, the hologram of
 * Japan's 8 defence cities between them (table) or the cities along the
 * horizon of the bay (battlefield), NULL CORE and its escorts beyond.
 * Pure presentation: everything shown comes from server state + director cues.
 */
export function ArenaScene(props: ArenaSceneProps) {
  const { director, glow, quality, reducedMotion } = props;
  const stage = props.stage ?? 'table';
  // Before any child reads the layout (positions, cameras) during this render.
  applyStage(stage);
  const battlefield = stage === 'battlefield';
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
        camera={{
          fov: 42,
          near: 0.1,
          // The bay reaches the far shore; the table stays tight for depth precision.
          far: battlefield ? 1400 : 200,
          position: CAMERA_PRESETS.intro.position,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = battlefield ? 1.0 : 1.1;
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            props.onContextLost?.();
          });
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {battlefield ? (
          <>
            <color attach="background" args={[BAY_FOG]} />
            <fogExp2 attach="fog" args={[BAY_FOG, BAY_FOG_DENSITY]} />
          </>
        ) : (
          <>
            <color attach="background" args={['#070D1A']} />
            <fog attach="fog" args={['#070D1A', 24, 60]} />
          </>
        )}
        <DirectorClock director={director} />
        <CameraRig director={director} reducedMotion={reducedMotion} targets={() => live.current} />
        {battlefield ? (
          <Battlefield
            cities={props.cities}
            threats={props.threats}
            cityMaxHp={props.cityMaxHp}
            director={director}
            reducedMotion={reducedMotion}
            shadows={q.shadows}
            detail={quality}
            envUrl={props.envMap}
            envIntensity={q.envIntensity * 1.6}
          />
        ) : (
          <>
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
          </>
        )}
        <Enemies
          enemies={props.enemies}
          telegraphs={props.telegraphs}
          director={director}
          reducedMotion={reducedMotion}
          bossModel={props.bossModel}
          bossBarrier={props.bossBarrier}
        />
        {battlefield ? (
          <ReservePylon level={props.reserve} />
        ) : (
          <ReserveReactor level={props.reserve} />
        )}
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
        {props.focusStation && (
          <StationHighlight role={props.focusStation} reducedMotion={reducedMotion} />
        )}
        {props.designation && (
          <TargetDesignator designation={props.designation} reducedMotion={reducedMotion} />
        )}
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

/**
 * Battlefield: the shared reserve as a power pylon on the deck in front of the
 * machines — three capacitor columns fill up and the core burns brighter as
 * the routers charge it for the final special.
 */
function ReservePylon({ level }: { level: number }) {
  const lv = Math.max(0, Math.min(1, level));
  return (
    <group position={RESERVE_POSITION} name="reserve-reactor">
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.75, 0.3, 6]} />
        <meshStandardMaterial color="#22272E" metalness={0.7} roughness={0.45} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
        return (
          <group
            key={i}
            position={[Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95]}
            rotation={[0, -a, 0]}
          >
            <mesh position={[0, 0.75, 0]} castShadow>
              <boxGeometry args={[0.3, 1.2, 0.3]} />
              <meshStandardMaterial color="#2C3138" metalness={0.75} roughness={0.4} />
            </mesh>
            <mesh position={[-0.16, 0.2 + lv * 0.5, 0]}>
              <boxGeometry args={[0.04, 0.02 + lv * 1.0, 0.18]} />
              <meshStandardMaterial color="#3A2A10" emissive="#FFB020" emissiveIntensity={1.6} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.9, 0]}>
        <icosahedronGeometry args={[0.4, 1]} />
        <meshStandardMaterial
          color="#3A2A10"
          emissive="#FFB020"
          emissiveIntensity={0.2 + lv * 0.9}
          metalness={0.2}
          roughness={0.3}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.72, 0.05, 8, 48]} />
        <meshStandardMaterial color="#B8862E" metalness={1} roughness={0.3} />
      </mesh>
    </group>
  );
}
