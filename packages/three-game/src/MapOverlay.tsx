import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityState, RegionId } from '@sats-wars/shared';
import { CITY_INFO, REGION_CENTROIDS, REGION_OUTLINES } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect } from './director';
import { ALIEN_COLOR, CORRUPT_RED, MAP_TRANSFORM, TEAM_COLORS } from './layout';

/** Incoming attack on a city (computed by the caller from server telegraphs). */
export interface CityThreat {
  /** Seconds until the first attack lands. */
  seconds: number;
  /** Damage after current shields would destroy the city. */
  lethal: boolean;
}

export interface MapOverlayProps {
  cities: CityState[];
  threats: Partial<Record<RegionId, CityThreat>>;
  cityMaxHp: number;
  director: ArenaDirector;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
}

const EXTRUDE_DEPTH = 0.22;
const HEALTHY = new THREE.Color('#2E7BD6');
const HURT = new THREE.Color('#F7931A');
const CRITICAL = new THREE.Color('#FF4D5E');
const DOWN = new THREE.Color('#2A2F3D');

/** City health as colour: blue (fine) → amber → red; dark grey = facility down. */
function regionColor(r: CityState, cityMaxHp: number): THREE.Color {
  if (r.destroyed) return DOWN.clone();
  const u = Math.max(0, Math.min(1, r.hp / cityMaxHp));
  return u > 0.5 ? HURT.clone().lerp(HEALTHY, (u - 0.5) * 2) : CRITICAL.clone().lerp(HURT, u * 2);
}

interface RegionVisual {
  material: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
  geometries: THREE.BufferGeometry[];
}

/**
 * Floating hologram of Japan's 8 defence regions (one city node each).
 * Everything shown mirrors server state; pulses come from the director.
 */
export function MapOverlay({ cities, threats, cityMaxHp, director, reducedMotion, locale }: MapOverlayProps) {
  const visuals = useMemo(() => {
    const out = {} as Record<RegionId, RegionVisual>;
    for (const [id, polys] of Object.entries(REGION_OUTLINES) as Array<[RegionId, (typeof REGION_OUTLINES)[RegionId]]>) {
      const geometries: THREE.BufferGeometry[] = [];
      for (const poly of polys) {
        const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
        geometries.push(new THREE.ExtrudeGeometry(shape, { depth: EXTRUDE_DEPTH, bevelEnabled: false }));
        const pts = poly.map((p) => new THREE.Vector3(p.x, p.y, EXTRUDE_DEPTH + 0.01));
        pts.push(pts[0]!.clone());
        geometries.push(new THREE.BufferGeometry().setFromPoints(pts));
      }
      out[id] = {
        material: new THREE.MeshStandardMaterial({
          color: HEALTHY,
          emissive: HEALTHY.clone(),
          emissiveIntensity: 0.35,
          transparent: true,
          opacity: 0.85,
          metalness: 0.2,
          roughness: 0.5,
        }),
        edge: new THREE.LineBasicMaterial({ color: '#9FB3D9', transparent: true, opacity: 0.9 }),
        geometries,
      };
    }
    return out;
  }, []);

  useEffect(
    () => () => {
      for (const v of Object.values(visuals)) {
        v.material.dispose();
        v.edge.dispose();
        for (const g of v.geometries) g.dispose();
      }
    },
    [visuals],
  );

  const byId = useMemo(() => new Map(cities.map((r) => [r.cityId, r])), [cities]);
  const pulses = useRef<Array<{ regionId: RegionId; start: number; kind: DirectorEffect['kind'] }>>([]);
  const pulseMeshes = useRef<Array<THREE.Mesh | null>>([]);

  useEffect(
    () =>
      director.onEffect((e) => {
        if ((e.kind === 'shield' || e.kind === 'beam' || e.kind === 'repair' || e.kind === 'cityBlast') && e.to?.kind === 'city') {
          pulses.current.push({ regionId: e.to.id, start: director.time, kind: e.kind });
          if (pulses.current.length > 12) pulses.current.shift();
        }
      }),
    [director],
  );

  useFrame(() => {
    const t = director.time;
    for (const r of cities) {
      const v = visuals[r.cityId];
      const c = regionColor(r, cityMaxHp);
      v.material.color.copy(c);
      v.material.emissive.copy(c);
      const d = threats[r.cityId];
      if (d && !r.destroyed) {
        // Under attack: slow 1 Hz glow (≤2 Hz rule; steady with reduced motion), red edge if lethal.
        v.material.emissiveIntensity = reducedMotion ? 0.9 : 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
        v.edge.color.set(d.lethal ? '#FF4D5E' : '#FFB04D');
      } else {
        v.material.emissiveIntensity = r.destroyed ? 0.15 : 0.35;
        v.edge.color.set(r.destroyed ? '#555B6E' : r.shield > 0 ? '#8BEAF2' : '#9FB3D9');
      }
    }
    pulses.current = pulses.current.filter((p) => t - p.start < 1.2);
    pulseMeshes.current.forEach((m, i) => {
      const p = pulses.current[i];
      if (!m) return;
      if (!p) {
        m.visible = false;
        return;
      }
      const c = REGION_CENTROIDS[p.regionId];
      const age = (t - p.start) / 1.2;
      m.visible = true;
      m.position.set(c.x, c.y, EXTRUDE_DEPTH + 0.05);
      const s = 0.3 + age * (p.kind === 'shield' ? 1.2 : 2.2);
      m.scale.set(s, s, s);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.set(p.kind === 'beam' || p.kind === 'cityBlast' ? CORRUPT_RED : p.kind === 'shield' ? TEAM_COLORS.FUJIN : p.kind === 'repair' ? '#7DFFB2' : ALIEN_COLOR);
      mat.opacity = (1 - age) * 0.85;
    });
  });

  return (
    <group position={MAP_TRANSFORM.position} rotation={MAP_TRANSFORM.rotation} scale={MAP_TRANSFORM.scale} name="map-overlay">
      {/* Hologram base plate */}
      <mesh position={[0, 0, -0.08]}>
        <circleGeometry args={[10.5, 64]} />
        <meshBasicMaterial color="#0E2240" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.06]}>
        <ringGeometry args={[10.2, 10.5, 96]} />
        <meshBasicMaterial color="#3A7BD5" transparent opacity={0.7} />
      </mesh>
      <gridHelper args={[20, 20, '#1F4A7A', '#14304F']} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.05]} />

      {(Object.keys(visuals) as RegionId[]).map((id) => {
        const v = visuals[id];
        const r = byId.get(id);
        return (
          <group key={id} name={`region-${id}`}>
            {v.geometries.map((g, i) =>
              g instanceof THREE.ExtrudeGeometry ? (
                <mesh key={i} geometry={g} material={v.material} />
              ) : (
                <lineLoop key={i} geometry={g} material={v.edge} />
              ),
            )}
            {r && <CityLabel city={r} threat={threats[id]} locale={locale} />}
          </group>
        );
      })}

      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`pulse-${i}`} ref={(m) => void (pulseMeshes.current[i] = m)} visible={false}>
          <ringGeometry args={[0.8, 1, 40]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Label offset per city in map units (x east, y north). Pills are a few units
 * wide at venue distance, so neighbours (名古屋/東京, 広島/大阪/高松) are pushed apart.
 */
const LABEL_OFFSET: Record<CityState['cityId'], [number, number]> = {
  hokkaido: [0, 1.1],
  tohoku: [2.4, 0],
  kanto: [2.7, -0.4],
  chubu: [-1.0, 1.1],
  kinki: [0.2, -1.4],
  chugoku: [-2.4, 0.8],
  shikoku: [1.8, -1.5],
  kyushu: [-2.4, -0.4],
};

function CityLabel({ city, threat, locale }: { city: CityState; threat: CityThreat | undefined; locale: 'ja' | 'en' }) {
  const c = REGION_CENTROIDS[city.cityId];
  const info = CITY_INFO[city.cityId];
  const state = city.destroyed ? 'down' : threat?.lethal ? 'danger' : threat ? 'threat' : 'ok';
  return (
    <group position={[c.x, c.y, EXTRUDE_DEPTH]}>
      <Html position={[LABEL_OFFSET[city.cityId][0], LABEL_OFFSET[city.cityId][1], 0.3]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`sw-map-label is-${state}`} data-state={state}>
          {threat && <span className="sw-map-label-warn">⚠{Math.ceil(threat.seconds)}s</span>}
          <span className="sw-map-label-name">{locale === 'ja' ? info.cityJa : info.cityEn}</span>
          <span className="sw-map-label-hp">{city.destroyed ? '✖' : city.hp}</span>
          {city.shield > 0 && <span className="sw-map-label-shield">🛡{city.shield}</span>}
        </div>
      </Html>
    </group>
  );
}
