import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Enemy, Telegraph } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { ALIEN_COLOR, BOSS_POSITION, BOSS_SCALE, CORRUPT_RED, enemyWorldPosition } from './layout';

export interface EnemiesProps {
  enemies: Enemy[];
  telegraphs: Telegraph[];
  director: ArenaDirector;
  reducedMotion: boolean;
}

/**
 * The Corruptors: an original machine design (ink-black armour, violet
 * plating, red corruption light). NULL CORE has three weak points — core, arms,
 * legs — that crack open as pilots hit them. Escorts glide to the city they
 * are about to attack. Pure presentation of server state.
 */
export function Enemies({ enemies, telegraphs, director, reducedMotion }: EnemiesProps) {
  const boss = enemies.find((e) => e.kind === 'BOSS');
  const escorts = enemies.filter((e) => e.kind !== 'BOSS');
  return (
    <group name="enemies">
      {boss && (
        <NullCore
          boss={boss}
          charging={telegraphs.some((t) => t.enemyId === boss.id)}
          director={director}
          reducedMotion={reducedMotion}
        />
      )}
      {escorts.map((e, i) => (
        <Escort
          key={e.id}
          enemy={e}
          index={i}
          telegraphs={telegraphs}
          director={director}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
}

const ARMOR = new THREE.MeshStandardMaterial({ color: '#12121A', metalness: 0.8, roughness: 0.35 });
const PLATE = new THREE.MeshStandardMaterial({
  color: '#3B1E5C',
  metalness: 0.6,
  roughness: 0.4,
  emissive: new THREE.Color(ALIEN_COLOR),
  emissiveIntensity: 0.15,
});

function NullCore({
  boss,
  charging,
  director,
  reducedMotion,
}: {
  boss: Enemy;
  charging: boolean;
  director: ArenaDirector;
  reducedMotion: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const hpRatio = boss.hp / boss.hpMax;
  // Weak points crack open with hits (visual stage 0..2).
  const stage = (hits: number) => Math.min(2, Math.floor(hits / 3));
  useFrame(() => {
    const t = director.time;
    if (root.current) {
      root.current.position.copy(BOSS_POSITION);
      root.current.position.y += reducedMotion ? 0 : Math.sin(t * 0.6) * 0.4;
      root.current.rotation.y = reducedMotion ? 0 : Math.sin(t * 0.25) * 0.15;
    }
    if (core.current) {
      // Charging an attack: slow ≤1 Hz throb; low HP: angrier red.
      const pulse = charging && !reducedMotion ? 0.5 + 0.5 * Math.sin(t * Math.PI * 2) : 0.5;
      core.current.emissiveIntensity = 1.2 + pulse * 1.5 + (1 - hpRatio) * 0.8;
    }
    const swing = reducedMotion ? 0 : Math.sin(t * 0.8) * 0.12;
    if (armL.current) armL.current.rotation.z = 0.5 + swing;
    if (armR.current) armR.current.rotation.z = -0.5 - swing;
  });
  return (
    <group ref={root} scale={BOSS_SCALE} name="null-core">
      {/* Shell: dark icosahedron with violet plates */}
      <mesh material={ARMOR}>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={i}
          material={PLATE}
          position={[
            Math.cos((i / 5) * Math.PI * 2) * 0.95,
            Math.sin((i / 5) * Math.PI * 2) * 0.95,
            0.25,
          ]}
          rotation={[0, 0, (i / 5) * Math.PI * 2]}
        >
          <boxGeometry args={[0.35, 0.12, 0.5]} />
        </mesh>
      ))}
      {/* CORE weak point */}
      <mesh position={[0, 0, 0.82 + stage(boss.partHits.CORE) * 0.05]}>
        <sphereGeometry args={[0.38 + stage(boss.partHits.CORE) * 0.06, 24, 16]} />
        <meshStandardMaterial
          ref={core}
          color="#200008"
          emissive={new THREE.Color(CORRUPT_RED)}
          emissiveIntensity={1.5}
        />
      </mesh>
      {/* ARM weak points */}
      {(['L', 'R'] as const).map((side) => (
        <group
          key={side}
          ref={side === 'L' ? armL : armR}
          position={[side === 'L' ? -1 : 1, 0.2, 0]}
        >
          <mesh
            material={ARMOR}
            position={[side === 'L' ? -0.6 : 0.6, -0.2, 0]}
            rotation={[0, 0, side === 'L' ? 0.4 : -0.4]}
          >
            <boxGeometry args={[1.2, 0.28, 0.28]} />
          </mesh>
          <mesh position={[side === 'L' ? -1.2 : 1.2, -0.45, 0]}>
            <octahedronGeometry args={[0.22 + stage(boss.partHits.ARM) * 0.05]} />
            <meshStandardMaterial
              color="#300010"
              emissive={new THREE.Color(boss.weaken > 0 ? '#FF9AAE' : CORRUPT_RED)}
              emissiveIntensity={1.2}
            />
          </mesh>
        </group>
      ))}
      {/* LEG weak points: three spines below */}
      {[-0.5, 0, 0.5].map((x, i) => (
        <group key={i} position={[x, -1, 0]}>
          <mesh material={ARMOR} rotation={[0, 0, x * 0.4]}>
            <coneGeometry args={[0.12, 1.2, 6]} />
          </mesh>
          <mesh position={[x * 0.3, -0.65, 0]}>
            <sphereGeometry args={[0.1 + stage(boss.partHits.LEG) * 0.03, 10, 8]} />
            <meshStandardMaterial
              color="#300010"
              emissive={new THREE.Color(CORRUPT_RED)}
              emissiveIntensity={1}
            />
          </mesh>
        </group>
      ))}
      <pointLight color={CORRUPT_RED} intensity={4} distance={30} position={[0, 0, 2]} />
    </group>
  );
}

function Escort({
  enemy,
  index,
  telegraphs,
  director,
  reducedMotion,
}: {
  enemy: Enemy;
  index: number;
  telegraphs: Telegraph[];
  director: ArenaDirector;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const placed = useRef(false);
  const size = enemy.kind === 'SIEGE' ? 0.75 : enemy.kind === 'SABOTEUR' ? 0.55 : 0.45;
  const glow = enemy.kind === 'SABOTEUR' ? '#5CC8FF' : CORRUPT_RED;
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    target.copy(enemyWorldPosition(enemy, telegraphs, index));
    if (!placed.current) {
      g.position.copy(target);
      placed.current = true;
    } else {
      // Glide (never teleport) toward the city it is aiming at.
      g.position.lerp(target, 1 - Math.exp(-dt * 1.8));
    }
    const t = director.time + enemy.id;
    if (!reducedMotion) g.position.y += Math.sin(t * 1.3) * 0.004;
    g.rotation.y = reducedMotion ? 0 : t * 0.8;
  });
  return (
    <group ref={ref} name={`escort-${enemy.id}`}>
      <mesh material={ARMOR}>
        <octahedronGeometry args={[size, 0]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size * 1.4, size * 0.12, 6, 24]} />
        <meshStandardMaterial
          color="#1A0F26"
          emissive={new THREE.Color(ALIEN_COLOR)}
          emissiveIntensity={0.6}
        />
      </mesh>
      <mesh position={[0, -size * 0.6, 0]}>
        <sphereGeometry args={[size * 0.28, 12, 8]} />
        <meshStandardMaterial
          color="#200008"
          emissive={new THREE.Color(glow)}
          emissiveIntensity={1.6}
        />
      </mesh>
    </group>
  );
}
