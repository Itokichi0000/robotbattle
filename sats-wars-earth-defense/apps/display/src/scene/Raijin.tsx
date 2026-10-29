import { useFrame } from '@react-three/fiber';
import { enemyPositionAt } from '@swed/game-engine';
import type { GunnerSeatId, SeatId } from '@swed/shared';
import { COLORS } from '@swed/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { anim } from './anim';
import { registerAnchor } from './anchors';
import { fxBus } from './fxBus';
import { box, cylinder, ngon, plate, sphere, torus } from './geometry';
import { getMaterials, stationMaterial, textTexture } from './materials';

/**
 * RAIJIN-01 — PROVISIONAL procedural model (Phase 1). Built as a real joint hierarchy
 * (spec §10.1: head, torso, core, shoulderL/R, upperArmL/R, forearmL/R, cannonL/R, pelvis,
 * thighL/R, shinL/R, footL/R, backpack, thrusters, shieldEmitters) so the Phase 5 hero GLB
 * can replace meshes without touching the animation logic.
 * Scale: 1 unit ≈ 4 m, about 12.5 units (≈50 m) tall. Faces −Z; its right is +X.
 */

export const STATION_OF: Record<SeatId, string> = {
  GUNNER_L: 'cannonL',
  GUNNER_R: 'cannonR',
  SHIELD_L: 'shoulderL',
  SHIELD_R: 'shoulderR',
  POWER_CORE: 'core',
  POWER_ROUTER: 'backpack',
  ENGINEER_LEGS: 'legs',
  ENGINEER_CORE: 'torso',
};

const SEAT_COLOR: Record<SeatId, string> = {
  GUNNER_L: COLORS.action,
  GUNNER_R: COLORS.action,
  SHIELD_L: COLORS.ally,
  SHIELD_R: COLORS.ally,
  POWER_CORE: COLORS.power,
  POWER_ROUTER: COLORS.power,
  ENGINEER_LEGS: COLORS.repair,
  ENGINEER_CORE: COLORS.repair,
};

const IDLE_ARM = new THREE.Vector3(0.12, -1, -0.18).normalize();
const DOWN = new THREE.Vector3(0, -1, 0);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();

function Leg({ side }: { side: 1 | -1 }) {
  const m = getMaterials();
  const sx = side;
  return (
    <group name={side < 0 ? 'thighL' : 'thighR'} position={[1.05 * sx, 6.7, 0]}>
      {/* hip joint */}
      <mesh
        geometry={cylinder(0.62, 0.62, 0.9, 18)}
        rotation={[0, 0, Math.PI / 2]}
        material={m.joint}
        castShadow
      />
      <mesh
        geometry={plate(1.25, 2.6, 1.35, { taper: 1.08 })}
        position={[0, -1.4, 0]}
        material={m.armorMid}
        castShadow
      />
      <mesh
        geometry={plate(0.5, 2.1, 1.45, { taper: 0.8 })}
        position={[0.55 * sx, -1.35, 0]}
        material={m.armorLight}
        castShadow
      />
      <group name={side < 0 ? 'shinL' : 'shinR'} position={[0, -2.85, 0]}>
        <mesh
          geometry={cylinder(0.5, 0.5, 1.15, 16)}
          rotation={[0, 0, Math.PI / 2]}
          material={m.joint}
          castShadow
        />
        <mesh
          geometry={plate(1.35, 3.0, 1.55, { taper: 1.12 })}
          position={[0, -1.55, 0.05]}
          material={m.armorLight}
          castShadow
        />
        {/* knee guard */}
        <mesh
          geometry={plate(1.1, 1.3, 0.55, { taper: 0.7 })}
          position={[0, -0.15, -0.72]}
          rotation={[0.25, 0, 0]}
          material={m.armorMid}
          castShadow
        />
        {/* calf thruster pod */}
        <mesh
          geometry={plate(0.9, 1.6, 0.7)}
          position={[0, -1.6, 0.95]}
          material={m.armorDark}
          castShadow
        />
        <mesh
          geometry={cylinder(0.24, 0.3, 0.3, 12)}
          position={[0, -2.5, 1.0]}
          material={m.thruster}
        />
        <group name={side < 0 ? 'footL' : 'footR'} position={[0, -3.2, 0]}>
          <mesh
            geometry={plate(1.55, 0.65, 2.75, { c: 0.15 })}
            position={[0, -0.33, -0.3]}
            material={m.armorDark}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={plate(1.3, 0.45, 0.9, { taper: 0.8 })}
            position={[0, -0.05, -1.45]}
            rotation={[-0.35, 0, 0]}
            material={m.armorMid}
            castShadow
          />
        </group>
      </group>
    </group>
  );
}

function Arm({
  side,
  pivot,
  elbow,
  recoil,
  muzzle,
  station,
  glow,
}: {
  side: 1 | -1;
  pivot: React.RefObject<THREE.Group | null>;
  elbow: React.RefObject<THREE.Group | null>;
  recoil: React.RefObject<THREE.Group | null>;
  muzzle: React.RefObject<THREE.Object3D | null>;
  station: THREE.MeshStandardMaterial;
  glow: React.RefObject<THREE.Mesh | null>;
}) {
  const m = getMaterials();
  const left = side < 0;
  return (
    <group ref={pivot} name={left ? 'upperArmL' : 'upperArmR'} position={[0.05 * side, -0.35, 0]}>
      <mesh geometry={sphere(0.62, 16, 12)} material={m.joint} castShadow />
      <mesh
        geometry={plate(0.95, 2.0, 0.95)}
        position={[0, -1.15, 0]}
        material={m.armorMid}
        castShadow
      />
      <group ref={elbow} name={left ? 'forearmL' : 'forearmR'} position={[0, -2.25, 0]}>
        <mesh
          geometry={cylinder(0.45, 0.45, 1.05, 14)}
          rotation={[0, 0, Math.PI / 2]}
          material={m.joint}
          castShadow
        />
        <mesh
          geometry={plate(1.3, 2.35, 1.35, { taper: 1.1 })}
          position={[0, -1.25, 0]}
          material={m.armorLight}
          castShadow
        />
        <mesh
          geometry={plate(0.4, 1.9, 1.5, { taper: 0.75 })}
          position={[0.68 * side, -1.2, 0]}
          material={m.armorMid}
          castShadow
        />
        <group ref={recoil} name={left ? 'cannonL' : 'cannonR'} position={[0, -2.35, 0]}>
          {left ? (
            <>
              {/* Heavy cannon: thick barrel, muzzle brake, amber safety band. */}
              <mesh
                geometry={cylinder(0.42, 0.48, 1.0, 16)}
                position={[0, -0.4, 0]}
                material={m.armorDark}
                castShadow
              />
              <mesh
                geometry={cylinder(0.3, 0.3, 3.0, 16)}
                position={[0, -2.2, 0]}
                material={m.barrel}
                castShadow
              />
              <mesh
                geometry={cylinder(0.4, 0.4, 0.5, 8)}
                position={[0, -3.75, 0]}
                material={m.armorDark}
                castShadow
              />
              <mesh
                geometry={cylinder(0.32, 0.32, 0.18, 16)}
                position={[0, -0.98, 0]}
                material={m.amberPaint}
              />
              <mesh
                geometry={torus(0.36, 0.06, 24)}
                position={[0, -3.45, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                material={station}
              />
              <object3D ref={muzzle} position={[0, -4.1, 0]} />
            </>
          ) : (
            <>
              {/* Railgun: twin rails with the charge channel between them. */}
              <mesh
                geometry={plate(1.0, 0.9, 0.9)}
                position={[0, -0.4, 0]}
                material={m.armorDark}
                castShadow
              />
              <mesh
                geometry={box(0.18, 3.4, 0.42)}
                position={[-0.26, -2.5, 0]}
                material={m.barrel}
                castShadow
              />
              <mesh
                geometry={box(0.18, 3.4, 0.42)}
                position={[0.26, -2.5, 0]}
                material={m.barrel}
                castShadow
              />
              <mesh geometry={box(0.1, 3.1, 0.12)} position={[0, -2.45, 0]} material={station} />
              <mesh
                geometry={box(0.7, 0.12, 0.5)}
                position={[0, -1.2, 0]}
                material={m.amberPaint}
              />
              <object3D ref={muzzle} position={[0, -4.3, 0]} />
            </>
          )}
          <mesh
            ref={glow}
            geometry={sphere(0.55, 16, 12)}
            position={[0, left ? -4.1 : -4.3, 0]}
            visible={false}
          >
            <meshBasicMaterial
              color={COLORS.action}
              transparent
              opacity={0.9}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function Raijin() {
  const m = getMaterials();
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const recoilL = useRef<THREE.Group>(null);
  const recoilR = useRef<THREE.Group>(null);
  const muzzleL = useRef<THREE.Object3D>(null);
  const muzzleR = useRef<THREE.Object3D>(null);
  const glowL = useRef<THREE.Mesh>(null);
  const glowR = useRef<THREE.Mesh>(null);
  const thrusterMat = useMemo(() => m.thruster.clone(), [m]);
  const coreMat = useMemo(() => m.coreGlow.clone(), [m]);
  const visorMat = useMemo(() => m.visor.clone(), [m]);

  const stations = useMemo(() => {
    const out = {} as Record<SeatId, THREE.MeshStandardMaterial>;
    for (const seat of Object.keys(SEAT_COLOR) as SeatId[])
      out[seat] = stationMaterial(SEAT_COLOR[seat]);
    return out;
  }, []);
  const pulse = useRef<Partial<Record<SeatId, number>>>({});
  const kick = useRef<Record<GunnerSeatId, number>>({ GUNNER_L: 0, GUNNER_R: 0 });

  const kanji = useMemo(
    () =>
      textTexture('雷神', {
        font: '700 92px "Hiragino Mincho ProN", "Yu Mincho", serif',
        color: '#1b2329',
        width: 256,
        height: 128,
      }),
    [],
  );
  const hullNo = useMemo(
    () => textTexture('RAIJIN-01', { color: '#1b2329', width: 512, height: 96 }),
    [],
  );

  // Anchors so the HUD can tie seat plates and labels to the real parts.
  const anchorRefs = useRef<Record<string, THREE.Object3D | null>>({});
  useEffect(() => {
    const stationIds = Object.keys(anchorRefs.current);
    for (const [id, obj] of Object.entries(anchorRefs.current))
      registerAnchor(`station:${id}`, obj);
    registerAnchor('muzzle:GUNNER_L', muzzleL.current);
    registerAnchor('muzzle:GUNNER_R', muzzleR.current);
    registerAnchor('mech:head', head.current);
    registerAnchor('mech:root', root.current);
    return () => {
      for (const id of stationIds) registerAnchor(`station:${id}`, null);
      registerAnchor('muzzle:GUNNER_L', null);
      registerAnchor('muzzle:GUNNER_R', null);
      registerAnchor('mech:head', null);
      registerAnchor('mech:root', null);
    };
  }, []);

  useEffect(
    () =>
      fxBus.on((e) => {
        if (e.type === 'seat_assigned') pulse.current[e.seatId] = 1;
        if (e.type === 'weapon_fired' && (e.seatId === 'GUNNER_L' || e.seatId === 'GUNNER_R'))
          kick.current[e.seatId] = 1;
      }),
    [],
  );

  const anchor = (id: string) => (o: THREE.Object3D | null) => {
    anchorRefs.current[id] = o;
  };

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const { liftY, thrust, powered } = anim;
    const snap = store.getState().snap?.state;
    const mt = store.matchTime(performance.now());
    if (root.current) root.current.position.y = liftY + Math.sin(t * 0.9) * 0.03;
    if (torso.current) torso.current.rotation.x = Math.sin(t * 0.8) * 0.012;

    // Arms: aim at the locked target, otherwise hang ready.
    for (const [seat, pivot, glow, elbow] of [
      ['GUNNER_L', armL, glowL, elbowL],
      ['GUNNER_R', armR, glowR, elbowR],
    ] as const) {
      const g = pivot.current;
      if (!g || !g.parent) continue;
      let want = IDLE_ARM.clone();
      if (seat === 'GUNNER_L') want.x *= -1;
      const gs = snap?.gunners[seat];
      const target = gs?.targetId ? snap?.enemies.find((e) => e.id === gs.targetId) : undefined;
      if (target && snap) {
        const p = enemyPositionAt(target.orbit, target.spawnedAt, mt);
        tmpV.set(p.x, p.y, p.z);
        g.parent.updateWorldMatrix(true, false);
        tmpM.copy(g.parent.matrixWorld).invert();
        const local = tmpV.applyMatrix4(tmpM).sub(g.position).normalize();
        want = local;
      }
      tmpQ.setFromUnitVectors(DOWN, want);
      g.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * (target ? 6 : 2)));
      // Ready stance: forearm raised so the gun points ahead; straight when aiming.
      if (elbow.current) {
        const bend = target ? 0 : 0.75;
        elbow.current.rotation.x += (bend - elbow.current.rotation.x) * (1 - Math.exp(-dt * 4));
      }
      // Charge glow grows from lock to ready, then breathes until the shot.
      const gl = glow.current;
      if (gl) {
        if (gs?.targetId && target) {
          const span = Math.max(1, gs.readyAt - gs.lockedAt);
          const k = Math.min(1, Math.max(0, (mt - gs.lockedAt) / span));
          const ready = mt >= gs.readyAt;
          gl.visible = true;
          const s = ready ? 0.9 + Math.sin(t * 12) * 0.1 : 0.2 + k * 0.6;
          gl.scale.setScalar(s);
          (gl.material as THREE.MeshBasicMaterial).opacity = ready ? 0.85 : 0.35 + k * 0.4;
        } else gl.visible = false;
      }
    }
    // Recoil along the barrel axis, then settle.
    for (const [seat, r] of [
      ['GUNNER_L', recoilL],
      ['GUNNER_R', recoilR],
    ] as const) {
      const k = kick.current[seat];
      if (r.current) r.current.position.y = -2.35 + k * 0.7;
      kick.current[seat] = Math.max(0, k - dt * 4);
    }
    // Head tracks the boss, else the most urgent attacker.
    if (head.current && snap) {
      const focus = snap.boss ? snap.enemies.find((e) => e.id === snap.boss!.id) : snap.enemies[0];
      let yaw = Math.sin(t * 0.3) * 0.15;
      if (focus) {
        const p = enemyPositionAt(focus.orbit, focus.spawnedAt, mt);
        yaw = Math.atan2(-p.x, -p.z);
      }
      head.current.rotation.y +=
        (THREE.MathUtils.clamp(yaw, -0.8, 0.8) - head.current.rotation.y) * Math.min(1, dt * 2);
    }
    // Seat stations: human pilot = bright, AUTO SUPPORT = dim steady, idle = dark.
    for (const seat of Object.keys(stations) as SeatId[]) {
      const ps = snap?.seats[seat];
      const p = pulse.current[seat] ?? 0;
      const base = ps?.occupied ? 2.6 : ps?.auto ? 0.3 : 0.06;
      stations[seat].emissiveIntensity = (base + p * 6) * powered;
      pulse.current[seat] = Math.max(0, p - dt * 1.2);
    }
    thrusterMat.emissiveIntensity = 0.4 + thrust * 6 + Math.sin(t * 40) * thrust * 0.6;
    coreMat.emissiveIntensity =
      (1.2 + (snap ? (snap.teamSync / 100) * 4 : 0) + Math.sin(t * 2) * 0.25) * powered;
    visorMat.emissiveIntensity = 3.2 * powered;
  });

  return (
    <group ref={root} name="RAIJIN-01">
      <group name="pelvis" position={[0, 6.95, 0]}>
        <mesh geometry={plate(2.7, 1.2, 1.75, { taper: 1.15 })} material={m.armorDark} castShadow />
        {/* skirt armour */}
        <mesh
          geometry={plate(1.0, 1.35, 0.35, { taper: 1.3 })}
          position={[-0.6, -0.6, -0.95]}
          rotation={[0.18, 0, 0]}
          material={m.armorLight}
          castShadow
        />
        <mesh
          geometry={plate(1.0, 1.35, 0.35, { taper: 1.3 })}
          position={[0.6, -0.6, -0.95]}
          rotation={[0.18, 0, 0]}
          material={m.armorLight}
          castShadow
        />
        <mesh
          geometry={plate(0.35, 1.5, 1.6, { taper: 1.2 })}
          position={[-1.55, -0.55, 0]}
          rotation={[0, 0, -0.15]}
          material={m.armorMid}
          castShadow
        />
        <mesh
          geometry={plate(0.35, 1.5, 1.6, { taper: 1.2 })}
          position={[1.55, -0.55, 0]}
          rotation={[0, 0, 0.15]}
          material={m.armorMid}
          castShadow
        />
      </group>
      <Leg side={-1} />
      <Leg side={1} />
      <group ref={anchor('legs')} position={[0, 3.6, -0.8]} />
      <mesh
        geometry={box(0.25, 0.25, 0.1)}
        position={[-1.05, 3.85, -0.98]}
        material={stations.ENGINEER_LEGS}
      />
      <mesh
        geometry={box(0.25, 0.25, 0.1)}
        position={[1.05, 3.85, -0.98]}
        material={stations.ENGINEER_LEGS}
      />
      <mesh
        geometry={cylinder(0.85, 0.95, 0.9, 18)}
        position={[0, 7.85, 0]}
        material={m.frame}
        castShadow
      />

      <group ref={torso} name="torso" position={[0, 8.2, 0]}>
        <mesh
          geometry={plate(2.3, 1.1, 1.85)}
          position={[0, 0.25, 0]}
          material={m.armorDark}
          castShadow
        />
        <mesh
          geometry={plate(3.3, 2.8, 2.45, { taper: 1.25 })}
          position={[0, 1.55, 0]}
          material={m.armorMid}
          castShadow
        />
        {/* chest plates */}
        <mesh
          geometry={plate(1.55, 1.7, 0.5, { taper: 1.15 })}
          position={[-0.95, 1.75, -1.25]}
          rotation={[0.08, 0.12, 0]}
          material={m.armorLight}
          castShadow
        />
        <mesh
          geometry={plate(1.55, 1.7, 0.5, { taper: 1.15 })}
          position={[0.95, 1.75, -1.25]}
          rotation={[0.08, -0.12, 0]}
          material={m.armorLight}
          castShadow
        />
        <mesh
          geometry={plate(0.5, 2.0, 0.6, { taper: 0.6 })}
          position={[0, 2.35, -1.2]}
          rotation={[0.1, 0, 0]}
          material={m.armorDark}
          castShadow
        />
        <mesh
          geometry={plate(2.0, 0.42, 1.95)}
          position={[0, -0.25, -0.05]}
          material={m.armorMid}
          castShadow
        />
        {/* reactor core (POWER A station) */}
        <group name="core" position={[0, 1.15, -1.32]} ref={anchor('core')}>
          <mesh geometry={ngon(6, 0.62, 0.35, Math.PI / 6)} material={m.armorDark} />
          <mesh
            geometry={ngon(6, 0.42, 0.4, Math.PI / 6)}
            position={[0, 0, -0.06]}
            material={coreMat}
          />
          <mesh
            geometry={torus(0.72, 0.05, 6)}
            position={[0, 0, -0.08]}
            material={stations.POWER_CORE}
          />
        </group>
        {/* ENGINEER B station lamps on the flanks */}
        <group ref={anchor('torso')} position={[0, 1.4, -0.4]} />
        <mesh
          geometry={box(0.1, 0.5, 0.5)}
          position={[-1.7, 1.3, -0.4]}
          material={stations.ENGINEER_CORE}
        />
        <mesh
          geometry={box(0.1, 0.5, 0.5)}
          position={[1.7, 1.3, -0.4]}
          material={stations.ENGINEER_CORE}
        />
        <mesh
          geometry={plate(1.7, 0.45, 1.5)}
          position={[0, 2.95, 0]}
          material={m.armorDark}
          castShadow
        />

        <group ref={head} name="head" position={[0, 3.15, -0.1]}>
          <mesh
            geometry={plate(1.15, 1.0, 1.3, { taper: 0.8 })}
            position={[0, 0.5, 0]}
            material={m.armorLight}
            castShadow
          />
          <mesh
            geometry={plate(1.3, 0.5, 1.0, { taper: 1.1 })}
            position={[0, 0.15, 0.1]}
            material={m.armorDark}
            castShadow
          />
          <mesh geometry={box(0.86, 0.14, 0.05)} position={[0, 0.55, -0.67]} material={visorMat} />
          <mesh
            geometry={plate(0.18, 0.75, 0.9, { taper: 0.4 })}
            position={[0, 1.0, 0.05]}
            rotation={[-0.35, 0, 0]}
            material={m.armorMid}
            castShadow
          />
          <mesh
            geometry={box(0.06, 0.9, 0.06)}
            position={[-0.38, 1.05, 0.45]}
            rotation={[-0.5, 0, 0.12]}
            material={m.frame}
          />
          <mesh
            geometry={box(0.06, 0.9, 0.06)}
            position={[0.38, 1.05, 0.45]}
            rotation={[-0.5, 0, -0.12]}
            material={m.frame}
          />
        </group>

        {/* backpack + thrusters (POWER B station) */}
        <group name="backpack" position={[0, 1.45, 1.5]} ref={anchor('backpack')}>
          <mesh
            geometry={plate(2.6, 2.6, 1.25, { taper: 0.9 })}
            material={m.armorDark}
            castShadow
          />
          <mesh
            geometry={box(0.12, 1.1, 0.1)}
            position={[-0.95, 0.3, 0.66]}
            material={stations.POWER_ROUTER}
          />
          <mesh
            geometry={box(0.12, 1.1, 0.1)}
            position={[0.95, 0.3, 0.66]}
            material={stations.POWER_ROUTER}
          />
          <group name="thrusters">
            {[-0.65, 0.65].map((x) => (
              <group key={x} position={[x, -0.9, 0.55]} rotation={[0.55, 0, 0]}>
                <mesh geometry={cylinder(0.42, 0.55, 1.1, 16, true)} material={m.barrel} />
                <mesh
                  geometry={cylinder(0.36, 0.36, 0.05, 16)}
                  position={[0, -0.5, 0]}
                  material={thrusterMat}
                />
              </group>
            ))}
          </group>
        </group>

        {/* shoulders with shield emitters (DEFENSE stations) + arms (GUNNER stations) */}
        {([-1, 1] as const).map((side) => (
          <group
            key={side}
            name={side < 0 ? 'shoulderL' : 'shoulderR'}
            position={[2.45 * side, 2.3, 0]}
          >
            <mesh
              geometry={plate(2.3, 2.0, 2.7, { taper: 0.78 })}
              position={[0.3 * side, 0.45, 0]}
              rotation={[0, 0, -0.14 * side]}
              material={m.armorLight}
              castShadow
            />
            <mesh
              geometry={plate(2.5, 0.55, 2.9)}
              position={[0.42 * side, 1.4, 0]}
              rotation={[0, 0, -0.2 * side]}
              material={m.armorMid}
              castShadow
            />
            <mesh
              geometry={plate(0.5, 1.6, 2.3, { taper: 0.7 })}
              position={[1.35 * side, -0.35, 0]}
              rotation={[0, 0, 0.1 * side]}
              material={m.armorDark}
              castShadow
            />
            <group
              name="shieldEmitter"
              position={[1.62 * side, 0.4, 0]}
              rotation={[0, 0, Math.PI / 2]}
              ref={anchor(side < 0 ? 'shoulderL' : 'shoulderR')}
            >
              <mesh geometry={cylinder(0.62, 0.7, 0.2, 6)} material={m.armorDark} />
              <mesh
                geometry={torus(0.5, 0.06, 6)}
                rotation={[Math.PI / 2, 0, 0]}
                position={[0, -0.12 * side, 0]}
                material={side < 0 ? stations.SHIELD_L : stations.SHIELD_R}
              />
            </group>
            {side < 0 ? (
              <mesh position={[-0.35, 0.25, -1.17]} rotation={[0, 0, 0]}>
                <planeGeometry args={[1.2, 0.6]} />
                <meshStandardMaterial
                  map={kanji}
                  transparent
                  roughness={0.6}
                  metalness={0.2}
                  depthWrite={false}
                />
              </mesh>
            ) : (
              <mesh position={[0.35, 0.25, -1.17]}>
                <planeGeometry args={[1.5, 0.28]} />
                <meshStandardMaterial
                  map={hullNo}
                  transparent
                  roughness={0.6}
                  metalness={0.2}
                  depthWrite={false}
                />
              </mesh>
            )}
            <Arm
              side={side}
              pivot={side < 0 ? armL : armR}
              elbow={side < 0 ? elbowL : elbowR}
              recoil={side < 0 ? recoilL : recoilR}
              muzzle={side < 0 ? muzzleL : muzzleR}
              station={side < 0 ? stations.GUNNER_L : stations.GUNNER_R}
              glow={side < 0 ? glowL : glowR}
            />
            <group ref={anchor(side < 0 ? 'cannonL' : 'cannonR')} position={[0, -3.5, -0.6]} />
          </group>
        ))}
      </group>
    </group>
  );
}
