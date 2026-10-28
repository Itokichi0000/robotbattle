import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Enemy, RegionId, RegionState, TeamId } from '@sats-wars/shared';
import { REGION_CENTROIDS, REGION_INFO, REGION_OUTLINES } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect } from './director';
import { ALIEN_COLOR, MAP_TRANSFORM, TEAM_COLORS } from './layout';

/** What the next alien turn will do to each region (computed by the caller from engine rules). */
export interface RegionDanger {
  damageNext: number;
  willFall: boolean;
}

export interface MapOverlayProps {
  regions: RegionState[];
  enemies: Enemy[];
  danger: Partial<Record<RegionId, RegionDanger>>;
  cityHpMax: number;
  director: ArenaDirector;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
}

const EXTRUDE_DEPTH = 0.22;
const HEALTHY = new THREE.Color('#2E7BD6');
const HURT = new THREE.Color('#F7931A');
const CRITICAL = new THREE.Color('#FF4D5E');
const CAPTURED = new THREE.Color(ALIEN_COLOR);

/** City health as colour: blue (fine) → amber → red (about to fall); violet = captured. */
function regionColor(r: RegionState, cityHpMax: number): THREE.Color {
  if (r.fallen) return CAPTURED.clone();
  const u = Math.max(0, Math.min(1, r.cityHp / cityHpMax));
  return u > 0.5 ? HURT.clone().lerp(HEALTHY, (u - 0.5) * 2) : CRITICAL.clone().lerp(HURT, u * 2);
}

interface RegionVisual {
  material: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
  geometries: THREE.BufferGeometry[];
}

/**
 * Floating hologram of Japan's 8 regions with the invading UFOs above them.
 * Everything shown mirrors server state; pulses and effects come from the director.
 */
export function MapOverlay({ regions, enemies, danger, cityHpMax, director, reducedMotion, locale }: MapOverlayProps) {
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

  const byId = useMemo(() => new Map(regions.map((r) => [r.regionId, r])), [regions]);
  const pulses = useRef<Array<{ regionId: RegionId; teamId: TeamId | null; start: number; kind: DirectorEffect['kind'] }>>([]);
  const pulseMeshes = useRef<Array<THREE.Mesh | null>>([]);

  useEffect(
    () =>
      director.onEffect((e) => {
        if ((e.kind === 'regionPulse' || e.kind === 'shield' || e.kind === 'alienAttack') && e.regionId) {
          pulses.current.push({ regionId: e.regionId, teamId: e.teamId, start: director.time, kind: e.kind });
          if (pulses.current.length > 12) pulses.current.shift();
        }
      }),
    [director],
  );

  useFrame(() => {
    const t = director.time;
    for (const r of regions) {
      const v = visuals[r.regionId];
      const c = regionColor(r, cityHpMax);
      v.material.color.copy(c);
      v.material.emissive.copy(c);
      const d = danger[r.regionId];
      if (d?.willFall && !r.fallen) {
        // About to fall at the next alien turn: slow 1 Hz glow (steady with reduced motion).
        v.material.emissiveIntensity = reducedMotion ? 0.9 : 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
        v.edge.color.set('#FF4D5E');
      } else {
        v.material.emissiveIntensity = r.fallen ? 0.6 : 0.35;
        v.edge.color.set(r.fallen ? ALIEN_COLOR : r.shield > 0 ? '#8BEAF2' : '#9FB3D9');
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
      mat.color.set(p.kind === 'alienAttack' ? '#FF4D5E' : p.kind === 'shield' ? '#8BEAF2' : p.teamId ? TEAM_COLORS[p.teamId] : ALIEN_COLOR);
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
            {r && (
              <RegionLabel
                region={r}
                aliens={enemies.filter((e) => e.regionId === id).length}
                danger={danger[id]}
                locale={locale}
              />
            )}
          </group>
        );
      })}

      <Ufos enemies={enemies} director={director} reducedMotion={reducedMotion} />

      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={`pulse-${i}`} ref={(m) => void (pulseMeshes.current[i] = m)} visible={false}>
          <ringGeometry args={[0.8, 1, 40]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Saucers hovering over their region; motherships are big. */
function Ufos({ enemies, director, reducedMotion }: { enemies: Enemy[]; director: ArenaDirector; reducedMotion: boolean }) {
  const parts = useMemo(
    () => ({
      disc: new THREE.SphereGeometry(0.42, 18, 8),
      dome: new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      body: new THREE.MeshStandardMaterial({ color: '#C9C2E8', metalness: 0.7, roughness: 0.3, emissive: ALIEN_COLOR, emissiveIntensity: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: ALIEN_COLOR, emissive: ALIEN_COLOR, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }),
      walker: new THREE.MeshStandardMaterial({ color: '#FF4FD8', emissive: '#FF4FD8', emissiveIntensity: 0.8 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts]);
  const refs = useRef(new Map<number, THREE.Group>());

  // Lay out several aliens in one region on a small spiral around its centroid.
  const placed = useMemo(() => {
    const perRegion = new Map<RegionId, number>();
    return enemies.map((e) => {
      const k = perRegion.get(e.regionId) ?? 0;
      perRegion.set(e.regionId, k + 1);
      const c = REGION_CENTROIDS[e.regionId];
      const ang = k * 2.2;
      const rad = k === 0 ? 0 : 0.45 + 0.18 * k;
      return { e, x: c.x + Math.cos(ang) * rad, y: c.y + Math.sin(ang) * rad };
    });
  }, [enemies]);

  useFrame(() => {
    const t = director.time;
    for (const p of placed) {
      const g = refs.current.get(p.e.id);
      if (!g) continue;
      const bob = reducedMotion ? 0 : Math.sin(t * 2 + p.e.id) * 0.08;
      g.position.set(p.x, p.y, EXTRUDE_DEPTH + 0.9 + bob);
      g.rotation.z = reducedMotion ? 0 : t * 1.5 + p.e.id;
    }
  });

  return (
    <group name="ufos">
      {placed.map(({ e, x, y }) => {
        const scale = e.kind === 'MOTHERSHIP' ? 2.1 : e.kind === 'WALKER' ? 1.25 : 0.9;
        return (
          <group
            key={e.id}
            ref={(g) => {
              if (g) refs.current.set(e.id, g);
              else refs.current.delete(e.id);
            }}
            position={[x, y, EXTRUDE_DEPTH + 0.9]}
            scale={scale}
          >
            <mesh geometry={parts.disc} material={e.kind === 'WALKER' ? parts.walker : parts.body} scale={[1, 1, 0.3]} />
            <mesh geometry={parts.dome} material={parts.glass} position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]} />
          </group>
        );
      })}
    </group>
  );
}

function RegionLabel({
  region,
  aliens,
  danger,
  locale,
}: {
  region: RegionState;
  aliens: number;
  danger: RegionDanger | undefined;
  locale: 'ja' | 'en';
}) {
  const c = REGION_CENTROIDS[region.regionId];
  const info = REGION_INFO[region.regionId];
  const state = region.fallen ? 'captured' : danger?.willFall ? 'danger' : 'ok';
  return (
    <group position={[c.x, c.y, EXTRUDE_DEPTH]}>
      <Html position={[0, -0.6, 0.3]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`sw-map-label is-${state}`} data-state={state}>
          {state === 'danger' && <span className="sw-map-label-warn">⚠</span>}
          <span className="sw-map-label-name">{locale === 'ja' ? info.shortJa : info.labelEn}</span>
          {region.fallen ? (
            <span className="sw-map-label-hp">👾</span>
          ) : (
            <span className="sw-map-label-hp">🏙{region.cityHp}</span>
          )}
          {region.shield > 0 && <span>🛡</span>}
          {aliens > 0 && <span className="sw-map-label-aliens">🛸{aliens}</span>}
        </div>
      </Html>
    </group>
  );
}
