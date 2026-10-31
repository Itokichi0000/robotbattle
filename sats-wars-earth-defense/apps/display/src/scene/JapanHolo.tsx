import { useFrame } from '@react-three/fiber';
import { CITY_IDS, CITY_POINTS, JAPAN_OUTLINES } from '@swed/shared';
import type { CityId } from '@swed/shared';
import { COLORS } from '@swed/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { registerAnchor } from './anchors';
import { fxBus } from './fxBus';

/**
 * Tactical hologram of Japan projected in the sky beside the battle (spec §3.2: Japan is a
 * hologram integrated into the scene, not a map that dominates the screen). City markers
 * are HUD anchors; the HUD writes names and threat countdowns next to them.
 */

const SCALE = 2.1;

export function JapanHolo({ position = [4, 34, -112] as [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const cityRefs = useRef<Partial<Record<CityId, THREE.Group>>>({});
  const flash = useRef<Partial<Record<CityId, number>>>({});

  const { fill, lines } = useMemo(() => {
    const shapes = JAPAN_OUTLINES.map(
      (poly) => new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x * SCALE, p.y * SCALE))),
    );
    const fill = new THREE.ShapeGeometry(shapes);
    const pts: number[] = [];
    for (const poly of JAPAN_OUTLINES) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        pts.push(a.x * SCALE, a.y * SCALE, 0.05, b.x * SCALE, b.y * SCALE, 0.05);
      }
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return { fill, lines };
  }, []);

  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = -12; x <= 12; x += 2)
      pts.push(x * SCALE, -13 * SCALE, -0.05, x * SCALE, 13 * SCALE, -0.05);
    for (let y = -13; y <= 13; y += 2)
      pts.push(-12 * SCALE, y * SCALE, -0.05, 12 * SCALE, y * SCALE, -0.05);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  const cityMats = useMemo(() => {
    const out = {} as Record<CityId, THREE.MeshBasicMaterial>;
    for (const id of CITY_IDS) {
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
    for (const id of CITY_IDS) registerAnchor(`city:${id}`, cityRefs.current[id] ?? null);
    registerAnchor('holo:japan', group.current);
    const off = fxBus.on((e) => {
      if (e.type === 'strike_hit' || e.type === 'strike_blocked') flash.current[e.cityId] = 1;
    });
    return () => {
      off();
      for (const id of CITY_IDS) registerAnchor(`city:${id}`, null);
      registerAnchor('holo:japan', null);
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
    if (scan.current) scan.current.position.y = ((t * 4) % 30) * SCALE - 14 * SCALE;
    const snap = store.getState().snap?.state;
    for (const id of CITY_IDS) {
      const g = cityRefs.current[id];
      const city = snap?.cities[id];
      const targeted = snap?.threats.some(
        (th) => th.target.type === 'CITY' && th.target.cityId === id,
      );
      const f = flash.current[id] ?? 0;
      const mat = cityMats[id];
      if (city?.lost) {
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
  });

  return (
    <group ref={group} position={position}>
      <lineSegments geometry={grid}>
        <lineBasicMaterial
          color={COLORS.ally}
          transparent
          opacity={0.08}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <mesh geometry={fill}>
        <meshBasicMaterial
          color={COLORS.ally}
          transparent
          opacity={0.13}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial
          color="#8fe9f5"
          transparent
          opacity={0.85}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <mesh ref={scan}>
        <planeGeometry args={[24 * SCALE, 0.12]} />
        <meshBasicMaterial
          color={COLORS.ally}
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {CITY_IDS.map((id) => (
        <group
          key={id}
          position={[CITY_POINTS[id].x * SCALE, CITY_POINTS[id].y * SCALE, 0.1]}
          ref={(g) => {
            if (g) cityRefs.current[id] = g;
          }}
        >
          <mesh material={cityMats[id]}>
            <ringGeometry args={[0.5, 0.68, 24]} />
          </mesh>
          <mesh material={cityMats[id]}>
            <circleGeometry args={[0.2, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
