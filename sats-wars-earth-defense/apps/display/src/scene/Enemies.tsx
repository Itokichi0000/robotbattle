import { useFrame } from '@react-three/fiber';
import { useStore } from '@swed/client';
import { enemyPositionAt } from '@swed/game-engine';
import type { EnemyKind, PublicEnemy } from '@swed/shared';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { registerAnchor } from './anchors';
import { fxBus } from './fxBus';
import { cylinder, plate, prism, sphere, torus } from './geometry';
import { getMaterials } from './materials';

/**
 * NULL SWARM (spec §1.2, §3.2): black armour, red cores, alien silhouettes readable from the
 * back of the hall. Positions come from the same orbit function the engine uses, so a
 * telegraphed attack visibly comes from the sector the shields must cover.
 */

/** Last known world position of every enemy (explosions need it after the mesh is gone). */
export const lastEnemyPos = new Map<string, THREE.Vector3>();
/** Enemies confirmed destroyed: hidden at once even if a snapshot still lists them. */
const dead = new Set<string>();

const bladeShape: Array<[number, number]> = [
  [0, 0],
  [2.6, 0.5],
  [4.4, -0.2],
  [2.4, -0.25],
  [0.4, -0.55],
];

function Drone({ core }: { core: THREE.MeshStandardMaterial }) {
  const m = getMaterials();
  const wings = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (wings.current) wings.current.rotation.z = Math.sin(s.clock.elapsedTime * 7) * 0.12;
  });
  return (
    <group scale={1.1}>
      <mesh
        geometry={prism(
          [
            [0, 1.1],
            [0.7, 0],
            [0, -2.4],
            [-0.7, 0],
          ],
          1.0,
          0.08,
        )}
        rotation={[Math.PI / 2, 0, 0]}
        material={m.enemyShell}
      />
      <mesh geometry={sphere(0.38, 12, 10)} position={[0, -0.38, 0.45]} material={core} />
      <group ref={wings}>
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            geometry={prism(bladeShape, 0.12, 0.03)}
            position={[0.3 * s, 0.1, 0.1]}
            rotation={[Math.PI / 2, 0, s < 0 ? Math.PI : 0]}
            scale={[1, 1, 1]}
            material={m.enemyChitin}
          />
        ))}
      </group>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={cylinder(0.02, 0.12, 1.6, 6)}
          position={[0.35 * s, -0.25, 1.2]}
          rotation={[Math.PI / 2 - 0.2, 0, 0]}
          material={m.enemyVein}
        />
      ))}
    </group>
  );
}

function Striker({ core }: { core: THREE.MeshStandardMaterial }) {
  const m = getMaterials();
  const ring = useRef<THREE.Group>(null);
  useFrame((s, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.9;
  });
  return (
    <group scale={1.6}>
      <mesh
        geometry={prism(
          [
            [0, 1.6],
            [1.3, 0.4],
            [0.9, -1.8],
            [0, -2.6],
            [-0.9, -1.8],
            [-1.3, 0.4],
          ],
          1.6,
          0.12,
        )}
        rotation={[Math.PI / 2, 0, 0]}
        material={m.enemyShell}
      />
      <mesh geometry={sphere(0.6, 14, 10)} position={[0, -0.55, 0.7]} material={core} />
      <group ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={i}
            geometry={plate(0.35, 1.8, 0.18, { taper: 0.2 })}
            position={[
              Math.cos((i / 6) * Math.PI * 2) * 2.1,
              Math.sin((i / 6) * Math.PI * 2) * 2.1,
              0,
            ]}
            rotation={[0, 0, (i / 6) * Math.PI * 2 - Math.PI / 2]}
            material={m.enemyChitin}
          />
        ))}
      </group>
    </group>
  );
}

/** NULL CORE: a colossal armoured seed. Petals open when GUNNER R exposes its weak point. */
function NullCore({ core, enemy }: { core: THREE.MeshStandardMaterial; enemy: PublicEnemy }) {
  const m = getMaterials();
  const petals = useRef<THREE.Group>(null);
  const shards = useRef<THREE.Group>(null);
  const tentacles = useRef<THREE.Group[]>([]);
  const halo = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const petalGeo = useMemo(() => plate(5.2, 11, 1.1, { taper: 0.25, c: 0.5 }), []);
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const mt = store.matchTime(performance.now());
    const weak = enemy.weakUntil > mt;
    open.current += ((weak ? 1 : 0) - open.current) * Math.min(1, dt * 3);
    if (petals.current) {
      petals.current.rotation.y += dt * 0.06;
      petals.current.children.forEach((p) => {
        p.rotation.x = -0.35 - open.current * 0.5;
      });
    }
    if (shards.current) shards.current.rotation.y -= dt * 0.15;
    tentacles.current.forEach((tg, i) => {
      if (!tg) return;
      tg.children.forEach((seg, j) => {
        seg.rotation.x = Math.sin(t * 0.8 + i + j * 0.5) * 0.12;
        seg.rotation.z = Math.cos(t * 0.6 + i * 1.3 + j * 0.4) * 0.1;
      });
    });
    if (halo.current) {
      halo.current.scale.setScalar(1 + open.current * 0.4 + Math.sin(t * 3) * 0.03);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + open.current * 0.35;
    }
  });
  return (
    <group scale={1.5}>
      <mesh geometry={sphere(3.6, 32, 24)} material={core} />
      <mesh ref={halo} geometry={sphere(4.4, 32, 24)}>
        <meshBasicMaterial
          color="#ff3b5c"
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={petals}>
        {Array.from({ length: 8 }, (_, i) => (
          <group key={i} rotation={[0, (i / 8) * Math.PI * 2, 0]}>
            <group position={[0, 0, 0]} rotation={[-0.35, 0, 0]}>
              <mesh
                geometry={petalGeo}
                position={[0, 2.5, -5.2]}
                rotation={[0.9, 0, 0]}
                material={i % 2 ? m.enemyShell : m.enemyChitin}
              />
              <mesh
                geometry={cylinder(0.08, 0.08, 9, 5)}
                position={[0, 2.2, -5.0]}
                rotation={[0.9, 0, 0]}
                material={m.enemyVein}
              />
            </group>
          </group>
        ))}
      </group>
      <group ref={shards}>
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return (
            <mesh
              key={i}
              geometry={plate(0.8, 2.6, 0.5, { taper: 0.1 })}
              position={[Math.cos(a) * 11, Math.sin(i * 1.7) * 2, Math.sin(a) * 11]}
              rotation={[0.3, a, 0.6]}
              material={m.enemyShell}
            />
          );
        })}
      </group>
      <mesh geometry={torus(9.5, 0.12, 64)} rotation={[Math.PI / 2, 0, 0]} material={m.enemyVein} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <group key={i} position={[Math.cos(a) * 3, -2.5, Math.sin(a) * 3]}>
            <group
              ref={(g) => {
                if (g) tentacles.current[i] = g;
              }}
            >
              <TentacleChain depth={0} />
            </group>
          </group>
        );
      })}
    </group>
  );
}

/** Nested segments so each joint's sway adds up like a whip. */
function TentacleChain({ depth }: { depth: number }) {
  const m = getMaterials();
  if (depth >= 9) return null;
  const r = 0.75 * (1 - depth / 11);
  return (
    <group position={[0, depth === 0 ? 0 : -2.2, 0]}>
      <mesh
        geometry={cylinder(r, r * 0.85, 2.3, 7)}
        position={[0, -1.1, 0]}
        material={depth % 3 === 2 ? m.enemyChitin : m.enemyShell}
      />
      {depth % 3 === 1 ? (
        <mesh
          geometry={torus(r * 1.15, 0.06, 10)}
          position={[0, -1.1, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={m.enemyVein}
        />
      ) : null}
      <TentacleChain depth={depth + 1} />
    </group>
  );
}

const ARRIVE_FROM = new THREE.Vector3();

const Enemy = memo(function Enemy({ enemy }: { enemy: PublicEnemy }) {
  const group = useRef<THREE.Group>(null);
  const core = useMemo(() => getMaterials().enemyCore.clone(), []);
  const hitFlash = useRef(0);
  useEffect(() => {
    registerAnchor(`enemy:${enemy.id}`, group.current);
    const off = fxBus.on((e) => {
      if (e.type === 'weapon_fired' && e.enemyId === enemy.id) hitFlash.current = 1;
      if (e.type === 'enemy_destroyed' && e.enemyId === enemy.id) {
        dead.add(enemy.id);
        if (group.current) group.current.visible = false;
      }
    });
    return () => {
      off();
      registerAnchor(`enemy:${enemy.id}`, null);
    };
  }, [enemy.id]);
  // The latest orbit/weak point come from the newest snapshot without remounting.
  const live = useRef(enemy);
  live.current = enemy;
  useFrame((s, dt) => {
    const g = group.current;
    if (!g) return;
    if (dead.has(enemy.id)) {
      g.visible = false;
      return;
    }
    const e = live.current;
    const mt = store.matchTime(performance.now());
    const p = enemyPositionAt(e.orbit, e.spawnedAt, mt);
    const arrive = Math.min(
      1,
      Math.max(0, (mt - e.spawnedAt) / Math.max(1, e.arrivesAt - e.spawnedAt)),
    );
    const k = 1 - Math.pow(1 - arrive, 3);
    // Arrive from high and far behind the spawn point.
    ARRIVE_FROM.set(p.x * 2.6, p.y + 70, p.z * 2.6);
    g.position.set(
      ARRIVE_FROM.x + (p.x - ARRIVE_FROM.x) * k,
      ARRIVE_FROM.y + (p.y - ARRIVE_FROM.y) * k,
      ARRIVE_FROM.z + (p.z - ARRIVE_FROM.z) * k,
    );
    g.lookAt(0, e.kind === 'NULL_CORE' ? p.y : 9, 0);
    let last = lastEnemyPos.get(e.id);
    if (!last) lastEnemyPos.set(e.id, (last = new THREE.Vector3()));
    last.copy(g.position);
    core.emissiveIntensity =
      4 +
      hitFlash.current * 18 +
      (e.weakUntil > mt ? 4 + Math.sin(s.clock.elapsedTime * 10) * 2 : 0);
    hitFlash.current = Math.max(0, hitFlash.current - dt * 5);
  });
  return (
    <group ref={group}>
      {enemy.kind === 'DRONE' ? <Drone core={core} /> : null}
      {enemy.kind === 'STRIKER' ? <Striker core={core} /> : null}
      {enemy.kind === 'NULL_CORE' ? <NullCore core={core} enemy={enemy} /> : null}
    </group>
  );
});

export function Enemies() {
  const snap = useStore(store).snap;
  const enemies = snap?.state.enemies ?? [];
  // Forget stale bookkeeping when the match changes.
  const matchId = snap?.matchId;
  useEffect(() => {
    dead.clear();
    lastEnemyPos.clear();
  }, [matchId]);
  return (
    <group name="null-swarm">
      {enemies.map((e) => (
        <Enemy key={e.id} enemy={e} />
      ))}
    </group>
  );
}

export function enemyScale(kind: EnemyKind): number {
  return kind === 'NULL_CORE' ? 18 : kind === 'STRIKER' ? 4 : 2.4;
}
