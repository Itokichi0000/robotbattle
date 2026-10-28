import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RegionId, RegionPaint, TeamId } from '@sats-wars/shared';
import { REGION_CENTROIDS, REGION_INFO, REGION_OUTLINES, TEAM_META } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect } from './director';
import { MAP_TRANSFORM, TEAM_COLORS } from './layout';

export interface MapOverlayProps {
  regions: RegionPaint[];
  /** Region being fought over right now (highlighted), if any. */
  focusRegionId: RegionId | null;
  director: ArenaDirector;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
}

const EXTRUDE_DEPTH = 0.22;

function ownerColor(owner: TeamId | null): string {
  return owner ? TEAM_COLORS[owner] : TEAM_COLORS.NEUTRAL;
}

interface RegionVisual {
  material: THREE.MeshStandardMaterial;
  edge: THREE.LineBasicMaterial;
  geometries: THREE.BufferGeometry[];
}

/** Floating hologram of Japan's 8 regions. Colours/markers mirror server state only. */
export function MapOverlay({ regions, focusRegionId, director, reducedMotion, locale }: MapOverlayProps) {
  const visuals = useMemo(() => {
    const out = {} as Record<RegionId, RegionVisual>;
    for (const [id, polys] of Object.entries(REGION_OUTLINES) as Array<
      [RegionId, (typeof REGION_OUTLINES)[RegionId]]
    >) {
      const geometries: THREE.BufferGeometry[] = [];
      for (const poly of polys) {
        const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
        geometries.push(
          new THREE.ExtrudeGeometry(shape, { depth: EXTRUDE_DEPTH, bevelEnabled: false }),
        );
        const pts = poly.map((p) => new THREE.Vector3(p.x, p.y, EXTRUDE_DEPTH + 0.01));
        pts.push(pts[0]!.clone());
        geometries.push(new THREE.BufferGeometry().setFromPoints(pts));
      }
      out[id] = {
        material: new THREE.MeshStandardMaterial({
          color: TEAM_COLORS.NEUTRAL,
          emissive: new THREE.Color(TEAM_COLORS.NEUTRAL),
          emissiveIntensity: 0.25,
          transparent: true,
          opacity: 0.82,
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
  const pulses = useRef<
    Array<{
      regionId: RegionId;
      teamId: TeamId | null;
      start: number;
      kind: DirectorEffect['kind'];
    }>
  >([]);
  const pulseMeshes = useRef<Array<THREE.Mesh | null>>([]);

  useEffect(
    () =>
      director.onEffect((e) => {
        if ((e.kind === 'regionPulse' || e.kind === 'shield') && e.regionId) {
          pulses.current.push({
            regionId: e.regionId,
            teamId: e.teamId,
            start: director.time,
            kind: e.kind,
          });
          if (pulses.current.length > 8) pulses.current.shift();
        }
      }),
    [director],
  );

  useFrame(() => {
    const t = director.time;
    for (const r of regions) {
      const v = visuals[r.regionId];
      const base = new THREE.Color(ownerColor(r.ownerTeamId));
      v.material.color.copy(base);
      v.material.emissive.copy(base);
      if (r.regionId === focusRegionId) {
        // The prize of the current round: gentle 1 Hz glow (steady with reduced motion).
        const glow = reducedMotion ? 0.8 : 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
        v.material.color.copy(base.clone().lerp(new THREE.Color('#FFFFFF'), 0.25));
        v.material.emissive.copy(base.clone().lerp(new THREE.Color('#FFFFFF'), 0.35));
        v.material.emissiveIntensity = glow;
        v.edge.color.set('#FFE27A');
      } else {
        v.material.emissiveIntensity = r.ownerTeamId ? 0.55 : 0.2;
        v.edge.color.set(r.ownerTeamId ? '#FFFFFF' : '#9FB3D9');
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
      mat.color.set(p.teamId ? TEAM_COLORS[p.teamId] : '#FFFFFF');
      mat.opacity = (1 - age) * 0.85;
    });
  });

  return (
    <group
      position={MAP_TRANSFORM.position}
      rotation={MAP_TRANSFORM.rotation}
      scale={MAP_TRANSFORM.scale}
      name="map-overlay"
    >
      {/* Hologram base plate */}
      <mesh position={[0, 0, -0.08]}>
        <circleGeometry args={[10.5, 64]} />
        <meshBasicMaterial color="#0E2240" transparent opacity={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.06]}>
        <ringGeometry args={[10.2, 10.5, 96]} />
        <meshBasicMaterial color="#3A7BD5" transparent opacity={0.7} />
      </mesh>
      <gridHelper
        args={[20, 20, '#1F4A7A', '#14304F']}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.05]}
      />

      {(Object.keys(visuals) as RegionId[]).map((id) => {
        const v = visuals[id];
        const r = byId.get(id);
        const meshes: React.ReactNode[] = [];
        v.geometries.forEach((g, i) => {
          if (g instanceof THREE.ExtrudeGeometry) {
            meshes.push(<mesh key={i} geometry={g} material={v.material} />);
          } else {
            meshes.push(<lineLoop key={i} geometry={g} material={v.edge} />);
          }
        });
        return (
          <group key={id} name={`region-${id}`}>
            {meshes}
            {r && <RegionMarker region={r} focus={id === focusRegionId} locale={locale} />}
          </group>
        );
      })}

      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={`pulse-${i}`} ref={(m) => void (pulseMeshes.current[i] = m)} visible={false}>
          <ringGeometry args={[0.8, 1, 40]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function RegionMarker({ region, focus, locale }: { region: RegionPaint; focus: boolean; locale: 'ja' | 'en' }) {
  const c = REGION_CENTROIDS[region.regionId];
  const info = REGION_INFO[region.regionId];
  const markerRef = useRef<THREE.Mesh>(null);
  const color = ownerColor(region.ownerTeamId);

  useFrame((_, dt) => {
    if (markerRef.current) markerRef.current.rotation.z += dt * (focus ? 2 : 0.8);
  });

  const owner = region.ownerTeamId ? TEAM_META[region.ownerTeamId] : null;
  return (
    <group position={[c.x, c.y, EXTRUDE_DEPTH]}>
      {(owner || focus) && (
        <mesh ref={markerRef} position={[0, 0, 0.45]}>
          {focus ? <coneGeometry args={[0.32, 0.7, 4]} /> : <octahedronGeometry args={[0.28]} />}
          <meshStandardMaterial
            color={focus ? '#FFE27A' : color}
            emissive={focus ? '#FFE27A' : color}
            emissiveIntensity={0.9}
          />
        </mesh>
      )}
      <Html position={[0, -0.55, 0.3]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`sw-map-label ${focus ? 'is-focus' : ''}`} data-owner={region.ownerTeamId ?? 'NEUTRAL'}>
          {focus && <span className="sw-map-label-focus">⚔</span>}
          <span className="sw-map-label-name">{locale === 'ja' ? info.shortJa : info.labelEn}</span>
          {owner && <span className="sw-map-label-owner">{owner.symbol}</span>}
        </div>
      </Html>
    </group>
  );
}
