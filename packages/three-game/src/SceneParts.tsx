import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ArenaDirector } from './director';
import {
  CAMERA_PRESETS,
  CAMERA_SHOTS,
  ROBOT_HOME,
  TEAM_COLORS,
  type TargetContext,
  resolveFxTarget,
} from './layout';

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Advances the director clock once per rendered frame. */
export function DirectorClock({ director }: { director: ArenaDirector }) {
  useFrame((_, dt) => director.update(dt));
  return null;
}

/**
 * Camera presets driven by the director with smooth easing and optional shake.
 * A cinematic shot (director.camera.shot) cuts in and eases along its authored
 * move; when it ends the camera glides back to the preset.
 * Reduced-motion mode cuts between presets instead of flying, and never shakes.
 */
export function CameraRig({
  director,
  reducedMotion,
  targets,
}: {
  director: ArenaDirector;
  reducedMotion: boolean;
  /** For shots anchored to a target (a city on the map). */
  targets?: () => TargetContext;
}) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(...CAMERA_PRESETS.intro.target));
  const desiredPos = useMemo(() => new THREE.Vector3(), []);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const first = useRef(true);

  useFrame((_, dt) => {
    const shotName = reducedMotion ? null : director.camera.shot;
    if (shotName) {
      const shot = CAMERA_SHOTS[shotName];
      const u = easeInOut(
        Math.min(1, Math.max(0, (director.time - director.camera.since) / shot.duration)),
      );
      desiredPos.set(...shot.from.position).lerp(tmp.set(...shot.to.position), u);
      desiredTarget.set(...shot.from.target).lerp(tmp.set(...shot.to.target), u);
      const anchor = director.camera.anchor
        ? resolveFxTarget(director.camera.anchor, targets?.() ?? { enemies: [], telegraphs: [] })
        : null;
      if (anchor) {
        desiredPos.add(anchor);
        desiredTarget.add(anchor);
      }
      camera.position.copy(desiredPos);
      target.current.copy(desiredTarget);
      if (director.shake > 0) {
        const s = director.shake * 0.28;
        camera.position.x += (Math.random() - 0.5) * s;
        camera.position.y += (Math.random() - 0.5) * s;
      }
      camera.lookAt(target.current);
      return;
    }
    const preset = CAMERA_PRESETS[director.camera.preset];
    desiredPos.set(...preset.position);
    desiredTarget.set(...preset.target);
    if (director.camera.preset === 'overview' && !reducedMotion) {
      desiredPos.x += Math.sin(director.time * 0.12) * 1.2;
      desiredPos.y += Math.sin(director.time * 0.09) * 0.3;
    }
    if (first.current || reducedMotion) {
      camera.position.copy(desiredPos);
      target.current.copy(desiredTarget);
      first.current = false;
    } else {
      const speed = director.camera.preset === 'intro' ? 0.6 : 2.6;
      const k = 1 - Math.exp(-dt * speed);
      camera.position.lerp(desiredPos, k);
      target.current.lerp(desiredTarget, k);
    }
    if (director.shake > 0 && !reducedMotion) {
      const s = director.shake * 0.28;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }
    camera.lookAt(target.current);
  });
  return null;
}

export function LightingRig({ shadows }: { shadows: boolean }) {
  return (
    <>
      {/* The stage environment (PostFx.tsx) adds reflected light, so the fills stay low. */}
      <ambientLight intensity={0.22} color="#8FA6D8" />
      <hemisphereLight args={['#5B7BC0', '#0A0F1C', 0.45]} />
      <directionalLight
        position={[6, 14, 9]}
        intensity={1.6}
        color="#FFF2E0"
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <pointLight
        position={[ROBOT_HOME.RAIJIN.x - 2, 3.5, 3]}
        intensity={30}
        distance={14}
        color={TEAM_COLORS.RAIJIN}
      />
      <pointLight
        position={[ROBOT_HOME.FUJIN.x + 2, 3.5, 3]}
        intensity={30}
        distance={14}
        color={TEAM_COLORS.FUJIN}
      />
      <pointLight position={[0, 8, -6]} intensity={25} distance={18} color="#3A7BD5" />
    </>
  );
}

/** Futuristic arena floor with team-coloured halves and a starfield. */
/** `floor: false` keeps only the star field (an arena GLB brings its own stage). */
export function ArenaStage({ stars, floor = true }: { stars: number; floor?: boolean }) {
  const starGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(stars * 3);
    for (let i = 0; i < stars; i++) {
      const r = 40 + Math.random() * 30;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.45;
      arr[i * 3] = r * Math.cos(th) * Math.sin(ph + 0.3);
      arr[i * 3 + 1] = 6 + r * Math.cos(ph + 0.3) * 0.8;
      arr[i * 3 + 2] = -Math.abs(r * Math.sin(th) * Math.sin(ph + 0.3)) - 5;
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, [stars]);
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ringRef.current) ringRef.current.rotation.z += dt * 0.05;
  });

  const starField = stars > 0 && (
    <points geometry={starGeometry}>
      <pointsMaterial size={0.18} color="#C8D8FF" transparent opacity={0.8} sizeAttenuation />
    </points>
  );
  if (!floor) return <group name="arena-stars">{starField}</group>;

  return (
    <group name="arena-stage">
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[13, 96]} />
        <meshStandardMaterial color="#0C1426" metalness={0.75} roughness={0.35} />
      </mesh>
      {/* Team halves */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.01, 0]}>
        <circleGeometry args={[7.5, 64, 0, Math.PI]} />
        <meshBasicMaterial color={TEAM_COLORS.RAIJIN} transparent opacity={0.08} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[0, 0.01, 0]}>
        <circleGeometry args={[7.5, 64, 0, Math.PI]} />
        <meshBasicMaterial color={TEAM_COLORS.FUJIN} transparent opacity={0.08} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[7.4, 7.6, 96, 1, 0, Math.PI * 1.85]} />
        <meshBasicMaterial color="#3A7BD5" transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[12.6, 13, 96]} />
        <meshBasicMaterial color="#1F3B66" />
      </mesh>
      {/* Centre clash mark */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, 0.03, 0.6]}>
        <ringGeometry args={[0.9, 1.05, 4]} />
        <meshBasicMaterial color="#EFF5FF" transparent opacity={0.5} />
      </mesh>
      {/* Pylons around the ring (abstract gate posts) */}
      {Array.from({ length: 10 }, (_, i) => {
        const a = Math.PI * (0.05 + (i / 9) * 0.9);
        const x = Math.cos(a) * 12;
        const z = -Math.sin(a) * 9 - 1;
        const color = i < 5 ? TEAM_COLORS.RAIJIN : TEAM_COLORS.FUJIN;
        return (
          <group key={i} position={[-x, 0, z]}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <boxGeometry args={[0.45, 3.2, 0.45]} />
              <meshStandardMaterial color="#121C33" metalness={0.8} roughness={0.4} />
            </mesh>
            <mesh position={[0, 3.3, 0]}>
              <boxGeometry args={[0.9, 0.12, 0.5]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
            </mesh>
          </group>
        );
      })}
      {starField}
    </group>
  );
}

export interface FrameStats {
  fps: number;
  frameMs: number;
}

/** Samples FPS once per second for the HUD/operator view. */
export function PerformanceProbe({ onStats }: { onStats: (s: FrameStats) => void }) {
  const acc = useRef({ frames: 0, time: 0, worst: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    if (a.time >= 1) {
      onStats({
        fps: Math.round(a.frames / a.time),
        frameMs: Math.round((a.time / a.frames) * 1000 * 10) / 10,
      });
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
