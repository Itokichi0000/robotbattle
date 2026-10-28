import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TeamId } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect, FxTarget } from './director';
import { ALIEN_COLOR, CORRUPT_RED, ROBOT_HOME, TEAM_COLORS, type TargetContext, resolveFxTarget } from './layout';

export interface EffectsProps {
  director: ArenaDirector;
  maxParticles: number;
  reducedMotion: boolean;
  /** Current enemies/telegraphs, read at render time to place effects. */
  targets: () => TargetContext;
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
  from: FxTarget | null;
  to: FxTarget | null;
  start: number;
  duration: number;
  intensity: number;
  seed: number;
}

function robotPos(teamId: TeamId): THREE.Vector3 {
  const h = ROBOT_HOME[teamId];
  return new THREE.Vector3(h.x, 2.2, h.z);
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
 * Particle sparks, shockwave rings, lightning bolts, wind vortices, enemy
 * beams and auras. Purely cosmetic; driven by director effect events whose
 * targets (city, enemy, robot, reserve) are resolved to positions every frame.
 */
export function Effects({ director, maxParticles, reducedMotion, targets }: EffectsProps) {
  const where = (t: FxTarget | null) => resolveFxTarget(t, targets());
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
  const beams = useMemo(
    () =>
      Array.from({ length: 10 }, () => {
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: CORRUPT_RED, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
        );
        line.visible = false;
        line.frustumCulled = false;
        return line;
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const l of beams) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    },
    [beams],
  );
  const domeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const vortexRefs = useRef<Array<THREE.Mesh | null>>([]);
  const next = useRef(0);

  const spawn = (
    count: number,
    origin: THREE.Vector3,
    color: string,
    speed: number,
    life: number,
    opts: { gravity?: number; swirl?: number; spread?: number; up?: number; toward?: THREE.Vector3 } = {},
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
      if (opts.toward) pt.v.add(opts.toward.clone().sub(origin).multiplyScalar(0.9 + Math.random() * 0.3));
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
            from: e.from,
            to: e.to,
            start: director.time,
            duration,
            intensity: e.intensity,
            seed: e.id * 7919,
          });
        const to = where(e.to);
        const from = where(e.from);
        switch (e.kind) {
          case 'impact':
            if (to) {
              spawn(Math.round(14 * e.intensity), to, '#FFFFFF', 7, 0.45, { gravity: -8 });
              spawn(Math.round(18 * e.intensity), to, e.teamId ? TEAM_COLORS[e.teamId] : CORRUPT_RED, 6, 0.6, { gravity: -6 });
            }
            break;
          case 'sparks':
          case 'explosion':
            if (to) {
              const k = e.kind === 'explosion' ? 1.4 : 1;
              spawn(Math.round(90 * e.intensity * k), to, '#FFFFFF', 9, 0.9, { gravity: -9 });
              spawn(Math.round(60 * e.intensity * k), to, ALIEN_COLOR, 7, 1.0, { gravity: -7 });
              spawn(Math.round(40 * e.intensity * k), to, TEAM_COLORS.RAIJIN, 7, 1.0, { gravity: -7 });
              add(0.9);
            }
            break;
          case 'cityBlast':
            if (to) {
              spawn(Math.round(80 * e.intensity), to, CORRUPT_RED, 5, 1.2, { gravity: -2, up: 2 });
              spawn(Math.round(40 * e.intensity), to, '#555B6E', 2, 2.0, { gravity: 1, up: 2 });
              add(1.2);
            }
            break;
          case 'beam':
            add(0.7);
            if (to) spawn(Math.round(40 * e.intensity), to, CORRUPT_RED, 5, 0.8, { gravity: -3, up: 1.5 });
            break;
          case 'shield':
            add(0.9);
            if (to) spawn(Math.round(24 * e.intensity), to, TEAM_COLORS.FUJIN, 3, 0.9, { gravity: 0.5, swirl: 5 });
            break;
          case 'energy':
            if (from && to) spawn(Math.round(36 * e.intensity), from, e.teamId ? TEAM_COLORS[e.teamId] : '#FFE27A', 0.8, 1.1, { gravity: 0, toward: to, spread: 0.3 });
            break;
          case 'repair':
            if (to) spawn(Math.round(30 * e.intensity), to, '#7DFFB2', 2, 1.2, { gravity: 1.5, spread: 0.6, up: 2 });
            break;
          case 'shockwave':
          case 'syncPulse':
            add(0.9);
            break;
          case 'lightning':
            add(reducedMotion ? 0.25 : 0.45);
            if (to) spawn(40, to, TEAM_COLORS.RAIJIN, 6, 0.6);
            break;
          case 'wind':
            add(1.0);
            if (to) spawn(50, to, TEAM_COLORS.FUJIN, 3, 1.2, { gravity: 0.5, swirl: 6 });
            break;
          case 'chargeAura':
            add(1.2);
            if (e.teamId) spawn(30, robotPos(e.teamId).setY(0.3), TEAM_COLORS[e.teamId], 2.5, 1.3, { gravity: 2.5, spread: 0.4, up: 3 });
            break;
          case 'specialStorm':
            add(2.8 * Math.max(0.5, e.intensity));
            if (e.teamId === 'FUJIN') {
              spawn(160, robotPos('FUJIN').setY(0.5), TEAM_COLORS.FUJIN, 4, 2.4, { gravity: 3, swirl: 9, spread: 0.6 });
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
    const rings = transients.current.filter((x) => x.kind === 'shockwave' || x.kind === 'chargeAura' || x.kind === 'syncPulse' || x.kind === 'cityBlast');
    ringRefs.current.forEach((m, i) => {
      if (!m) return;
      const x = rings[i];
      m.visible = !!x;
      if (!x) return;
      const u = (t - x.start) / x.duration;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (x.kind === 'chargeAura' || x.kind === 'syncPulse') {
        const p = robotPos(x.teamId ?? (i % 2 ? 'FUJIN' : 'RAIJIN'));
        m.position.set(p.x, 0.1 + u * 3.5, p.z);
        const s = 1.6 - u * 0.6;
        m.scale.set(s, s, s);
        mat.color.set(x.kind === 'syncPulse' ? '#FFE27A' : TEAM_COLORS[x.teamId ?? 'RAIJIN']);
      } else {
        const p = where(x.to) ?? new THREE.Vector3(0, 0.08, 0.6);
        m.position.set(p.x, x.kind === 'cityBlast' ? p.y : 0.08, p.z);
        const s = 0.5 + u * (x.kind === 'cityBlast' ? 3 : 9) * x.intensity;
        m.scale.set(s, s, s);
        mat.color.set(x.kind === 'cityBlast' ? CORRUPT_RED : '#FFFFFF');
      }
      mat.opacity = (1 - u) * 0.8;
    });

    const beamFx = transients.current.filter((x) => x.kind === 'beam');
    beams.forEach((line, i) => {
      const x = beamFx[i];
      const a = x ? where(x.from) : null;
      const b2 = x ? where(x.to) : null;
      line.visible = !!(x && a && b2);
      if (!x || !a || !b2) return;
      const age = t - x.start;
      const rng = seeded(x.seed + (reducedMotion ? 0 : Math.floor(age * 6)) * 31);
      line.geometry.setFromPoints(boltPoints(a, b2, rng, 8, 0.15));
      (line.material as THREE.LineBasicMaterial).opacity = (1 - age / x.duration) * x.intensity;
    });

    const domes = transients.current.filter((x) => x.kind === 'shield');
    domeRefs.current.forEach((m, i) => {
      if (!m) return;
      const x = domes[i];
      const p = x ? where(x.to) : null;
      m.visible = !!(x && p);
      if (!x || !p) return;
      const u = (t - x.start) / x.duration;
      m.position.copy(p);
      const sc = 0.6 + u * 0.5;
      m.scale.set(sc, sc, sc);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.45;
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
          ? (where(x.to) ?? robotPos('FUJIN'))
          : robotPos('RAIJIN').add(new THREE.Vector3((rng() - 0.5) * 6, -2, (rng() - 0.5) * 4));
      const origin = x.kind === 'lightning' ? where(x.from) : null;
      const from = origin
        ? origin.clone().add(new THREE.Vector3(0, 2.5, 0))
        : target.clone().add(new THREE.Vector3((rng() - 0.5) * 3, 8 + rng() * 3, (rng() - 0.5) * 2));
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
      const p = x.kind === 'wind' ? (where(x.to) ?? robotPos('FUJIN')) : robotPos('FUJIN');
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
      {beams.map((l, i) => (
        <primitive key={`beam-${i}`} object={l} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`dome-${i}`} ref={(m) => void (domeRefs.current[i] = m)} visible={false}>
          <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial color={TEAM_COLORS.FUJIN} transparent opacity={0} wireframe depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
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
