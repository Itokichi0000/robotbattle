import { useFrame } from '@react-three/fiber';
import { mothershipPoint, PLANET_POINTS, SQUAD_IDS, SQUADS, ZONE_IDS } from '@swed/shared';
import type { SquadId, ZoneId } from '@swed/shared';
import { COLORS } from '@swed/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { anim } from './anim';
import { registerAnchor } from './anchors';
import { fxBus } from './fxBus';

/**
 * Tactical hologram of the route (D-034): Mars → Moon → Earth, the six allied squads along
 * it, and the alien mothership's marker crawling toward Earth. Squad and planet markers are
 * HUD anchors; the HUD writes names and threat countdowns next to them.
 */

const SCALE = 2.6;

const PLANET_COLOR: Record<ZoneId, string> = {
  MARS: '#ff8a50',
  MOON: '#c7cfdc',
  EARTH: '#5aa8ff',
};
const PLANET_SIZE: Record<ZoneId, number> = { MARS: 1.5, MOON: 0.9, EARTH: 1.8 };

// Below and right of the mothership, so its body never hides the route.
export function RouteHolo({ position = [22, 21, -104] as [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const ship = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Mesh>(null);
  const squadRefs = useRef<Partial<Record<SquadId, THREE.Group>>>({});
  const planetRefs = useRef<Partial<Record<ZoneId, THREE.Group>>>({});
  const flash = useRef<Partial<Record<SquadId, number>>>({});

  const start = PLANET_POINTS.MARS.x * SCALE;
  const end = PLANET_POINTS.EARTH.x * SCALE;

  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = -13; x <= 13; x += 2)
      pts.push(x * SCALE, -5 * SCALE, -0.05, x * SCALE, 5 * SCALE, -0.05);
    for (let y = -5; y <= 5; y += 2)
      pts.push(-13 * SCALE, y * SCALE, -0.05, 13 * SCALE, y * SCALE, -0.05);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  /** Dashed course line, plus thin links from each squad to the course. */
  const course = useMemo(() => {
    const pts: number[] = [];
    for (let x = start; x < end; x += 1.2) pts.push(x, 0, 0.02, Math.min(end, x + 0.7), 0, 0.02);
    for (const id of SQUAD_IDS) {
      const p = SQUADS[id].at;
      pts.push(p.x * SCALE, p.y * SCALE * 0.75, 0.02, p.x * SCALE, 0, 0.02);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [start, end]);

  const squadMats = useMemo(() => {
    const out = {} as Record<SquadId, THREE.MeshBasicMaterial>;
    for (const id of SQUAD_IDS) {
      out[id] = new THREE.MeshBasicMaterial({
        color: COLORS.ally,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        depthWrite: false,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    for (const id of SQUAD_IDS) registerAnchor(`squad:${id}`, squadRefs.current[id] ?? null);
    for (const z of ZONE_IDS) registerAnchor(`planet:${z}`, planetRefs.current[z] ?? null);
    registerAnchor('holo:route', group.current);
    registerAnchor('holo:ship', ship.current);
    const off = fxBus.on((e) => {
      if (e.type === 'strike_hit' || e.type === 'strike_blocked') flash.current[e.squadId] = 1;
    });
    return () => {
      off();
      for (const id of SQUAD_IDS) registerAnchor(`squad:${id}`, null);
      for (const z of ZONE_IDS) registerAnchor(`planet:${z}`, null);
      registerAnchor('holo:route', null);
      registerAnchor('holo:ship', null);
    };
  }, []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    if (group.current) {
      group.current.lookAt(
        s.camera.position.x * 0.35,
        group.current.position.y * 0.6,
        s.camera.position.z,
      );
    }
    // The mothership marker and the red trail of the route it has already flown.
    const p = mothershipPoint(anim.route);
    if (ship.current) {
      ship.current.position.set(p.x * SCALE, 0, 0.15);
      ship.current.rotation.z = Math.sin(t * 2) * 0.08;
    }
    if (trail.current) {
      const len = Math.max(0.01, p.x * SCALE - start);
      trail.current.scale.x = len;
      trail.current.position.x = start + len / 2;
    }
    const snap = store.getState().snap?.state;
    for (const id of SQUAD_IDS) {
      const g = squadRefs.current[id];
      const sq = snap?.squads[id];
      const targeted = snap?.threats.some(
        (th) => th.target.type === 'SQUAD' && th.target.squadId === id,
      );
      const f = flash.current[id] ?? 0;
      const mat = squadMats[id];
      if (sq?.lost) {
        mat.color.set('#4a5560');
        mat.opacity = 0.6;
      } else if (targeted || f > 0) {
        mat.color.set(COLORS.danger);
        mat.opacity = 0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 1.6));
      } else {
        mat.color.set(COLORS.ally);
        mat.opacity = 0.85;
      }
      if (g) g.scale.setScalar(1 + f * 1.5 + (targeted ? 0.25 : 0));
      flash.current[id] = Math.max(0, f - dt * 1.2);
    }
    // The current area's planet glows brighter.
    for (const z of ZONE_IDS) {
      const g = planetRefs.current[z];
      if (g) g.scale.setScalar(anim.zone === z ? 1.15 + 0.05 * Math.sin(t * 3) : 1);
    }
  });

  return (
    <group ref={group} position={position}>
      <lineSegments geometry={grid}>
        <lineBasicMaterial
          color={COLORS.ally}
          transparent
          opacity={0.07}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={course}>
        <lineBasicMaterial
          color="#8fe9f5"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      {/* the route already flown, in red */}
      <mesh ref={trail} position={[start, 0, 0.05]}>
        <planeGeometry args={[1, 0.28]} />
        <meshBasicMaterial
          color={COLORS.danger}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {ZONE_IDS.map((z) => (
        <group
          key={z}
          position={[PLANET_POINTS[z].x * SCALE, PLANET_POINTS[z].y * SCALE, 0.1]}
          ref={(g) => {
            if (g) planetRefs.current[z] = g;
          }}
        >
          <mesh>
            <circleGeometry args={[PLANET_SIZE[z], 32]} />
            <meshBasicMaterial
              color={PLANET_COLOR[z]}
              transparent
              opacity={0.85}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh>
            <ringGeometry args={[PLANET_SIZE[z] + 0.25, PLANET_SIZE[z] + 0.4, 40]} />
            <meshBasicMaterial
              color={PLANET_COLOR[z]}
              transparent
              opacity={0.45}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {SQUAD_IDS.map((id) => (
        <group
          key={id}
          position={[SQUADS[id].at.x * SCALE, SQUADS[id].at.y * SCALE * 0.75, 0.1]}
          ref={(g) => {
            if (g) squadRefs.current[id] = g;
          }}
        >
          <mesh material={squadMats[id]} rotation={[0, 0, Math.PI / 4]}>
            <ringGeometry args={[0.5, 0.7, 4]} />
          </mesh>
          <mesh material={squadMats[id]}>
            <circleGeometry args={[0.22, 12]} />
          </mesh>
        </group>
      ))}
      {/* NULL CORE: a red arrowhead pointing at Earth */}
      <group ref={ship} position={[start, 0, 0.15]}>
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <circleGeometry args={[1.1, 3]} />
          <meshBasicMaterial color={COLORS.danger} toneMapped={false} />
        </mesh>
        <mesh>
          <ringGeometry args={[1.4, 1.6, 24]} />
          <meshBasicMaterial color={COLORS.danger} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
