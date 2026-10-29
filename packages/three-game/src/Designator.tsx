import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Weakpoint } from '@sats-wars/shared';
import { BOSS_POSITION } from './layout';

/**
 * What the gunner's fire control is pointing at, written by the pilot HUD
 * (a mutable ref, so a reticle sweeping at 60 fps never re-renders React).
 * `select`: target chosen; `track`: sight live, not on target; `lock`: inside
 * the lock window; `fired`: waiting for the server; `hit`/`miss`: its verdict.
 */
export interface TargetDesignation {
  enemyId: number;
  weakpoint?: Weakpoint;
  state: 'select' | 'track' | 'lock' | 'fired' | 'hit' | 'miss';
}

/** NULL CORE's weak points in its local frame (see NullCore in Enemies.tsx). */
const WEAK_OFFSET: Record<Weakpoint, [number, number, number]> = {
  CORE: [0, 0, 0.82],
  ARM: [-2.0, -0.55, 0],
  LEG: [0, -1.65, 0],
};

const AMBER = new THREE.Color('#F5AE4F');
const CYAN = new THREE.Color('#48C8D9');
const RED = new THREE.Color('#F25F61');
const WHITE = new THREE.Color('#FFF4DC');

/**
 * Raijin's target designator in the world: four corner brackets around the
 * enemy the gunner is aiming at, always facing the camera. They close in on
 * LOCK (spec 3.4: 0.12–0.25 s), flash once on a confirmed hit, turn red on a
 * miss. It follows the actor itself, so a gliding escort stays boxed.
 * Presentation only: the verdict comes from the server via the HUD.
 */
export function TargetDesignator({
  designation,
  reducedMotion,
}: {
  designation: { current: TargetDesignation | null };
  reducedMotion: boolean;
}) {
  const { camera, scene } = useThree();
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: AMBER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  // Eight thin bars (four L corners) and a small centre diamond, unit size.
  const bars = useMemo(() => {
    const out: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const arm = 0.42;
    const w = 0.05;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        out.push({ p: [sx * (1 - arm / 2), sy, 0], s: [arm, w, 1] });
        out.push({ p: [sx, sy * (1 - arm / 2), 0], s: [w, arm, 1] });
      }
    return out;
  }, []);
  const scale = useRef(1.5);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const changedAt = useRef({ state: '', at: 0 });

  useFrame((state, dt) => {
    const g = group.current;
    const d = designation.current;
    if (!g) return;
    if (!d) {
      g.visible = false;
      scale.current = 1.5;
      return;
    }
    const escort = scene.getObjectByName(`escort-${d.enemyId}`);
    const boss = escort ? null : scene.getObjectByName('null-core');
    const bossGlb = escort || boss ? null : scene.getObjectByName('null-core-glb');
    let size: number;
    if (escort) {
      escort.getWorldPosition(pos);
      size = 1.15;
    } else if (bossGlb) {
      // An artist's model has its own weak point layout: box the whole machine.
      bossGlb.getWorldPosition(pos);
      size = 2.8;
    } else if (boss) {
      const off = WEAK_OFFSET[d.weakpoint ?? 'CORE'];
      pos.set(...off);
      boss.localToWorld(pos);
      size = d.weakpoint && d.weakpoint !== 'CORE' ? 1.9 : 2.6;
    } else {
      pos.copy(BOSS_POSITION);
      size = 2.6;
    }
    g.visible = true;
    g.position.copy(pos);
    g.quaternion.copy(camera.quaternion);
    if (changedAt.current.state !== d.state)
      changedAt.current = { state: d.state, at: state.clock.elapsedTime };
    const since = state.clock.elapsedTime - changedAt.current.at;
    const closed = d.state === 'lock' || d.state === 'fired' || d.state === 'hit';
    const want = closed ? 0.78 : d.state === 'select' ? 1.3 : 1.05;
    scale.current = reducedMotion
      ? want
      : scale.current + (want - scale.current) * (1 - Math.exp(-dt * 16));
    g.scale.setScalar(size * scale.current);
    // Colour: information (cyan) until the sight is live, amber while aiming,
    // a single white flash on a confirmed hit, red on a miss.
    if (d.state === 'select') mat.color.copy(CYAN);
    else if (d.state === 'miss') mat.color.copy(RED);
    else if (d.state === 'hit' && since < 0.18 && !reducedMotion) mat.color.copy(WHITE);
    else mat.color.copy(AMBER);
    mat.opacity = d.state === 'track' ? 0.6 : d.state === 'select' ? 0.7 : 1;
  });

  return (
    <group ref={group} visible={false} renderOrder={1000} name="target-designator">
      {bars.map((b, i) => (
        <mesh key={i} position={b.p} scale={b.s} material={mat} renderOrder={1000}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
      <mesh
        rotation={[0, 0, Math.PI / 4]}
        scale={[0.09, 0.09, 1]}
        material={mat}
        renderOrder={1000}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

type StationRole = 'GUNNER' | 'GUARDIAN' | 'ROUTER' | 'ENGINEER';

/** The parts a station works on: [robot, node name, local offset, bracket size]. */
const STATION_PARTS: Record<
  StationRole,
  Array<['RAIJIN' | 'FUJIN', string, [number, number, number], number]>
> = {
  GUNNER: [['RAIJIN', 'Cannon', [0, 0.05, 0.55], 0.8]],
  GUARDIAN: [
    ['FUJIN', 'Forearm_L', [0.18, -0.36, 0], 0.55],
    ['FUJIN', 'Forearm_R', [-0.18, -0.36, 0], 0.55],
  ],
  ROUTER: [
    ['RAIJIN', 'Chest', [0, 0.62, 0.6], 0.5],
    ['FUJIN', 'Chest', [0, 0.36, 0.42], 0.45],
  ],
  ENGINEER: [
    ['RAIJIN', 'Shin_L', [0, 0, 0.1], 0.5],
    ['FUJIN', 'Shin_R', [0, 0, 0.1], 0.42],
  ],
};

/**
 * Hangar (spec 2.4): the part of the machine the chosen station works on
 * gets a soft bracket — Raijin's cannon for the gunner, Fujin's shield
 * emitters for the guardian, both cores for the router, the knee joints for
 * the engineer. Slow 1 Hz breathing, nothing when no station is chosen.
 */
export function StationHighlight({
  role,
  reducedMotion,
}: {
  role: StationRole | null;
  reducedMotion: boolean;
}) {
  const { camera, scene } = useThree();
  const parts = role ? STATION_PARTS[role] : [];
  const refs = useRef<Array<THREE.Group | null>>([]);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: AMBER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  const bars = useMemo(() => {
    const out: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const arm = 0.36;
    const w = 0.06;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        out.push({ p: [sx * (1 - arm / 2), sy, 0], s: [arm, w, 1] });
        out.push({ p: [sx, sy * (1 - arm / 2), 0], s: [w, arm, 1] });
      }
    return out;
  }, []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    mat.opacity = reducedMotion
      ? 0.85
      : 0.6 + 0.3 * Math.sin(state.clock.elapsedTime * Math.PI * 2);
    parts.forEach(([team, node, off, size], i) => {
      const g = refs.current[i];
      if (!g) return;
      const robot =
        scene.getObjectByName(`robot-${team}`) ?? scene.getObjectByName(`robot-glb-${team}`);
      const part = robot?.getObjectByName(node);
      if (!part) {
        g.visible = false;
        return;
      }
      v.set(...off);
      part.localToWorld(v);
      g.visible = true;
      g.position.copy(v);
      g.quaternion.copy(camera.quaternion);
      g.scale.setScalar(size);
    });
  });
  return (
    <group name="station-highlight">
      {parts.map((_, i) => (
        <group
          key={`${role}-${i}`}
          ref={(g) => {
            refs.current[i] = g;
          }}
          visible={false}
          renderOrder={1000}
        >
          {bars.map((b, j) => (
            <mesh key={j} position={b.p} scale={b.s} material={mat} renderOrder={1000}>
              <planeGeometry args={[1, 1]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
