import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RegionId, TeamId } from '@sats-wars/shared';
import { otherTeam } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect } from './director';
import { ADVANCE_FRACTION, ALIEN_COLOR, ROBOT_HOME, TEAM_COLORS, regionWorldPosition } from './layout';

export interface EffectsProps {
  director: ArenaDirector;
  maxParticles: number;
  reducedMotion: boolean;
}

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  gravity: number;
  swirl: number;
  center: THREE.Vector3;
}

interface Transient {
  kind: DirectorEffect['kind'];
  teamId: TeamId | null;
  regionId: RegionId | null;
  start: number;
  duration: number;
  intensity: number;
  seed: number;
}

const CLASH_POINT = new THREE.Vector3(0, 2.6, 0.6);

function robotPos(teamId: TeamId, advanced = 0): THREE.Vector3 {
  const h = ROBOT_HOME[teamId];
  return new THREE.Vector3(h.x * (1 - ADVANCE_FRACTION * advanced), 2.2, h.z);
}

/** Jagged polyline from `a` to `b` (lightning). */
function boltPoints(
  a: THREE.Vector3,
  b: THREE.Vector3,
  rng: () => number,
  segments = 14,
  jitter = 0.5,
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = a.clone().lerp(b, u);
    if (i > 0 && i < segments) {
      p.x += (rng() - 0.5) * jitter * 2;
      p.y += (rng() - 0.5) * jitter;
      p.z += (rng() - 0.5) * jitter * 2;
    }
    pts.push(p);
  }
  return pts;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Particle sparks, shockwave rings, lightning bolts, wind vortices and auras.
 * Purely cosmetic; driven by director effect events.
 */
export function Effects({ director, maxParticles, reducedMotion }: EffectsProps) {
  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: maxParticles }, () => ({
        alive: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        color: new THREE.Color(),
        gravity: 0,
        swirl: 0,
        center: new THREE.Vector3(),
      })),
    [maxParticles],
  );
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    return g;
  }, [maxParticles]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const transients = useRef<Transient[]>([]);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const bolts = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => {
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({
            color: i % 3 === 0 ? '#FFF4D6' : TEAM_COLORS.RAIJIN,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
          }),
        );
        line.visible = false;
        line.frustumCulled = false;
        return line;
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const l of bolts) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    },
    [bolts],
  );
  const vortexRefs = useRef<Array<THREE.Mesh | null>>([]);
  const next = useRef(0);

  const spawn = (
    count: number,
    origin: THREE.Vector3,
    color: string,
    speed: number,
    life: number,
    opts: { gravity?: number; swirl?: number; spread?: number; up?: number } = {},
  ) => {
    const c = new THREE.Color(color);
    const n = reducedMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const pt = particles[next.current]!;
      next.current = (next.current + 1) % particles.length;
      pt.alive = true;
      pt.p.copy(origin);
      const spread = opts.spread ?? 1;
      pt.v
        .set(
          (Math.random() - 0.5) * 2 * spread,
          Math.random() * (opts.up ?? 1),
          (Math.random() - 0.5) * 2 * spread,
        )
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      pt.life = 0;
      pt.maxLife = life * (0.6 + Math.random() * 0.6);
      pt.color.copy(c).offsetHSL(0, 0, (Math.random() - 0.3) * 0.25);
      pt.gravity = opts.gravity ?? -6;
      pt.swirl = opts.swirl ?? 0;
      pt.center.copy(origin);
    }
  };

  useEffect(
    () =>
      director.onEffect((e) => {
        const add = (duration: number) =>
          transients.current.push({
            kind: e.kind,
            teamId: e.teamId,
            regionId: e.regionId,
            start: director.time,
            duration,
            intensity: e.intensity,
            seed: e.id * 7919,
          });
        switch (e.kind) {
          case 'impact':
            // One hit landing (on an alien over the map, or on the other robot).
            if (e.teamId) {
              const at = e.regionId ? regionWorldPosition(e.regionId, 0.8) : robotPos(otherTeam(e.teamId), 0.45).setY(2.4);
              spawn(Math.round(14 * e.intensity), at, '#FFFFFF', 7, 0.45, { gravity: -8 });
              spawn(Math.round(18 * e.intensity), at, TEAM_COLORS[e.teamId], 6, 0.6, { gravity: -6 });
            }
            break;
          case 'sparks': {
            // Explosion: an alien destroyed (at its region) or a clash point.
            const at = e.regionId ? regionWorldPosition(e.regionId, 0.8) : CLASH_POINT;
            spawn(Math.round(90 * e.intensity), at, '#FFFFFF', 9, 0.9, { gravity: -9 });
            spawn(Math.round(60 * e.intensity), at, TEAM_COLORS.RAIJIN, 7, 1.0, { gravity: -7 });
            spawn(Math.round(60 * e.intensity), at, TEAM_COLORS.FUJIN, 7, 1.0, { gravity: -7 });
            break;
          }
          case 'alienAttack':
            // Alien beams hitting a city.
            if (e.regionId) {
              const at = regionWorldPosition(e.regionId, 0.3);
              spawn(Math.round(70 * e.intensity), at, '#FF5D6C', 6, 0.9, { gravity: -4, up: 1.5 });
              spawn(Math.round(40 * e.intensity), at, ALIEN_COLOR, 4, 1.1, { gravity: 1, up: 2 });
            }
            break;
          case 'landing':
            if (e.regionId) {
              spawn(Math.round(40 * e.intensity), regionWorldPosition(e.regionId, 1.4), ALIEN_COLOR, 3, 1.2, {
                gravity: -3,
                spread: 0.5,
              });
            }
            break;
          case 'shockwave':
            add(0.9);
            break;
          case 'lightning':
            add(reducedMotion ? 0.25 : 0.45);
            if (e.teamId) {
              const at = e.regionId ? regionWorldPosition(e.regionId, 0.8) : robotPos(otherTeam(e.teamId), 0.6);
              spawn(40, at, TEAM_COLORS.RAIJIN, 6, 0.6);
            }
            break;
          case 'wind':
            add(1.0);
            if (e.teamId) {
              const at = e.regionId ? regionWorldPosition(e.regionId, 0.8) : robotPos(otherTeam(e.teamId), 0.6);
              spawn(50, at, TEAM_COLORS.FUJIN, 3, 1.2, {
                gravity: 0.5,
                swirl: 6,
              });
            }
            break;
          case 'chargeAura':
            add(1.2);
            if (e.teamId)
              spawn(30, robotPos(e.teamId).setY(0.3), TEAM_COLORS[e.teamId], 2.5, 1.3, {
                gravity: 2.5,
                spread: 0.4,
                up: 3,
              });
            break;
          case 'specialStorm':
            add(2.8 * Math.max(0.5, e.intensity));
            if (e.teamId === 'FUJIN') {
              spawn(160, robotPos('FUJIN').setY(0.5), TEAM_COLORS.FUJIN, 4, 2.4, {
                gravity: 3,
                swirl: 9,
                spread: 0.6,
              });
            } else if (e.teamId === 'RAIJIN') {
              spawn(160, robotPos('RAIJIN').setY(3.5), TEAM_COLORS.RAIJIN, 7, 1.8, { gravity: -5 });
            }
            break;
          default:
            break;
        }
      }),
    // spawn closes over refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [director, particles, reducedMotion],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i]!;
      if (pt.alive) {
        pt.life += dt;
        if (pt.life >= pt.maxLife) pt.alive = false;
      }
      if (!pt.alive) {
        pos.setXYZ(i, 0, -100, 0);
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      if (pt.swirl) {
        const dx = pt.p.x - pt.center.x;
        const dz = pt.p.z - pt.center.z;
        pt.v.x += -dz * pt.swirl * dt;
        pt.v.z += dx * pt.swirl * dt;
      }
      pt.v.y += pt.gravity * dt;
      pt.v.multiplyScalar(1 - dt * 0.8);
      pt.p.addScaledVector(pt.v, dt);
      const fade = 1 - pt.life / pt.maxLife;
      pos.setXYZ(i, pt.p.x, pt.p.y, pt.p.z);
      col.setXYZ(i, pt.color.r * fade, pt.color.g * fade, pt.color.b * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    const t = director.time;
    transients.current = transients.current.filter((x) => t - x.start < x.duration);
    const rings = transients.current.filter(
      (x) => x.kind === 'shockwave' || x.kind === 'chargeAura',
    );
    ringRefs.current.forEach((m, i) => {
      if (!m) return;
      const x = rings[i];
      m.visible = !!x;
      if (!x) return;
      const u = (t - x.start) / x.duration;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (x.kind === 'shockwave') {
        m.position.set(CLASH_POINT.x, 0.08, CLASH_POINT.z);
        const s = 0.5 + u * 9 * x.intensity;
        m.scale.set(s, s, s);
        mat.color.set('#FFFFFF');
      } else {
        const p = robotPos(x.teamId ?? 'RAIJIN');
        m.position.set(p.x, 0.1 + u * 3.5, p.z);
        const s = 1.6 - u * 0.6;
        m.scale.set(s, s, s);
        mat.color.set(TEAM_COLORS[x.teamId ?? 'RAIJIN']);
      }
      mat.opacity = (1 - u) * 0.8;
    });

    const boltFx = transients.current.filter(
      (x) => x.kind === 'lightning' || (x.kind === 'specialStorm' && x.teamId === 'RAIJIN'),
    );
    bolts.forEach((line, i) => {
      const x = boltFx[Math.floor(i / 3)];
      line.visible = !!x;
      if (!x) return;
      const age = t - x.start;
      // Re-jag at most ~8 times/s; reduced motion keeps a single static bolt.
      const frame = reducedMotion ? 0 : Math.floor(age * 8);
      const rng = seeded(x.seed + i * 131 + frame * 977);
      const target =
        x.kind === 'lightning'
          ? x.regionId
            ? regionWorldPosition(x.regionId, 0.6)
            : robotPos('FUJIN', 0.6)
          : robotPos('RAIJIN').add(new THREE.Vector3((rng() - 0.5) * 6, -2, (rng() - 0.5) * 4));
      const from = target
        .clone()
        .add(new THREE.Vector3((rng() - 0.5) * 3, 8 + rng() * 3, (rng() - 0.5) * 2));
      const pts = boltPoints(from, target, rng, 16, 0.7);
      line.geometry.setFromPoints(pts);
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = (1 - age / x.duration) * (i % 3 === 0 ? 1 : 0.6);
    });

    const vortices = transients.current.filter(
      (x) => x.kind === 'wind' || (x.kind === 'specialStorm' && x.teamId === 'FUJIN'),
    );
    vortexRefs.current.forEach((m, i) => {
      if (!m) return;
      const x = vortices[Math.floor(i / 3)];
      m.visible = !!x;
      if (!x) return;
      const u = (t - x.start) / x.duration;
      const layer = i % 3;
      const p =
        x.kind === 'wind' ? (x.regionId ? regionWorldPosition(x.regionId, 0.2) : robotPos('RAIJIN', 0.6)) : robotPos('FUJIN');
      m.position.set(p.x, 0.6 + layer * 1.1 + u * 0.8, p.z);
      m.rotation.set(Math.PI / 2, 0, t * (6 + layer * 2));
      const s = (0.9 + layer * 0.35) * (0.6 + u * 0.8) * (x.kind === 'specialStorm' ? 1.5 : 1);
      m.scale.set(s, s, s);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, u) * Math.PI) * 0.6;
    });
  });

  return (
    <group name="effects">
      <points geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          size={0.14}
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={`ring-${i}`}
          ref={(m) => void (ringRefs.current[i] = m)}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <ringGeometry args={[0.85, 1, 64]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {bolts.map((l, i) => (
        <primitive key={`bolt-${i}`} object={l} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`vortex-${i}`} ref={(m) => void (vortexRefs.current[i] = m)} visible={false}>
          <torusGeometry args={[1, 0.05, 6, 48, Math.PI * 1.5]} />
          <meshBasicMaterial
            color={TEAM_COLORS.FUJIN}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
