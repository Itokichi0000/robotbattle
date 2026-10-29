import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TeamId } from '@sats-wars/shared';
import type { ArenaDirector, DirectorEffect, FxTarget } from './director';
import { DebrisLayer, Ribbon, SpriteLayer } from './fx/layers';
import { DebrisPool, ParticlePool, type SpawnOptions } from './fx/pool';
import {
  ALIEN_COLOR,
  CORRUPT_RED,
  type QualityConfig,
  ROBOT_HOME,
  TEAM_COLORS,
  type TargetContext,
  resolveFxTarget,
} from './layout';

export interface EffectsProps {
  director: ArenaDirector;
  /** Pool sizes for this quality level. */
  budget: QualityConfig['fx'];
  reducedMotion: boolean;
  /** Current enemies/telegraphs, read at render time to place effects. */
  targets: () => TargetContext;
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

// Colours are linear (THREE.Color converts from sRGB hex), as the shaders expect.
const WHITE = new THREE.Color('#FFFFFF');
const HOT = new THREE.Color('#FFD9A0');
const FIRE = new THREE.Color('#FF8A3D');
const EMBER = new THREE.Color('#FFB547');
const SMOKE = new THREE.Color('#1B1A24');
const DUST = new THREE.Color('#2C3446');
const HEAL = new THREE.Color('#7DFFB2');
const GOLD = new THREE.Color('#FFE27A');
const RED = new THREE.Color(CORRUPT_RED);
const VIOLET = new THREE.Color(ALIEN_COLOR);
const TEAM = {
  RAIJIN: new THREE.Color(TEAM_COLORS.RAIJIN),
  FUJIN: new THREE.Color(TEAM_COLORS.FUJIN),
};

interface ImpactLight {
  light: THREE.PointLight | null;
  peak: number;
}

/**
 * Sparks, fire, smoke, debris, impact lights, lightning and beam ribbons,
 * shockwave rings, shield domes and wind vortices. Purely cosmetic; driven by
 * director effect events whose targets (city, enemy, robot, reserve) are
 * resolved to positions every frame. The clock follows the director's scale,
 * so a hit-stop freezes the sparks mid-air too.
 */
export function Effects({ director, budget, reducedMotion, targets }: EffectsProps) {
  const where = (t: FxTarget | null) => resolveFxTarget(t, targets());
  const glow = useMemo(() => new ParticlePool(budget.glow), [budget.glow]);
  const smoke = useMemo(() => new ParticlePool(budget.smoke), [budget.smoke]);
  const debris = useMemo(() => new DebrisPool(budget.debris), [budget.debris]);
  const lights = useRef<ImpactLight[]>([]);
  lights.current = Array.from(
    { length: budget.lights },
    (_, i) => lights.current[i] ?? { light: null, peak: 0 },
  );

  const transients = useRef<Transient[]>([]);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const domeRefs = useRef<Array<THREE.Mesh | null>>([]);
  const vortexRefs = useRef<Array<THREE.Mesh | null>>([]);
  // Lightning: a wide core and two thinner branches per bolt (3 bolts at once).
  const bolts = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) =>
        i % 3 === 0
          ? new Ribbon(17, TEAM_COLORS.RAIJIN, '#FFF4D6', 2.4)
          : new Ribbon(17, TEAM_COLORS.RAIJIN, '#FFE2B0', 1.6),
      ),
    [],
  );
  const beams = useMemo(
    () => Array.from({ length: 10 }, () => new Ribbon(9, CORRUPT_RED, '#FFC2CE', 2)),
    [],
  );
  useEffect(
    () => () => {
      for (const r of [...bolts, ...beams]) r.dispose();
    },
    [bolts, beams],
  );

  // Fewer, calmer particles with reduced motion.
  const amount = reducedMotion ? 0.35 : 1;
  const spark = (o: SpawnOptions, pool: ParticlePool = glow) =>
    pool.spawn({ ...o, count: Math.ceil(o.count * amount) });
  const light = (at: THREE.Vector3, color: THREE.Color, peak: number) => {
    const slot = lights.current.reduce<ImpactLight | null>(
      (best, l) => (!best || (l.light?.intensity ?? 0) < (best.light?.intensity ?? 0) ? l : best),
      null,
    );
    if (!slot?.light) return;
    slot.light.position.copy(at);
    slot.light.color.copy(color);
    slot.light.intensity = peak * (reducedMotion ? 0.5 : 1);
  };
  /** A hot core that blooms for a moment at the point of impact (local, not full-screen). */
  const flare = (at: THREE.Vector3, color: THREE.Color, size: number, life = 0.16) =>
    glow.spawn({ count: 1, origin: at, color, intensity: 2.6, speed: 0, life, size, gravity: 0 });

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
        const k = e.intensity;
        const team = e.teamId ? TEAM[e.teamId] : RED;
        switch (e.kind) {
          case 'impact':
            if (!to) break;
            flare(to, WHITE, 0.9 * k);
            spark({
              count: 12 * k,
              origin: to,
              color: WHITE,
              intensity: 3,
              speed: 10,
              life: 0.35,
              size: 0.07,
              gravity: -9,
              drag: 1.5,
              stretch: 0.045,
            });
            spark({
              count: 16 * k,
              origin: to,
              color: team,
              intensity: 2.2,
              speed: 6,
              life: 0.6,
              size: 0.1,
              gravity: -7,
              stretch: 0.03,
            });
            spark(
              {
                count: 2,
                origin: to,
                color: SMOKE,
                speed: 0.8,
                life: 1.3,
                size: 0.9,
                gravity: 0.6,
                drag: 1.2,
              },
              smoke,
            );
            light(to, team, 14 * k);
            break;
          case 'sparks':
          case 'explosion': {
            if (!to) break;
            const big = e.kind === 'explosion' ? k : k * 0.6;
            flare(to, HOT, 2.6 * big, 0.22);
            // Fireball: fat orange blobs that expand and slow down fast.
            spark({
              count: 22 * big,
              origin: to,
              color: FIRE,
              intensity: 2.4,
              speed: 4,
              life: 0.7,
              size: 0.55,
              gravity: 1.5,
              drag: 3,
              jitter: 0.3,
            });
            spark({
              count: 46 * big,
              origin: to,
              color: WHITE,
              intensity: 2.8,
              speed: 13,
              life: 0.8,
              size: 0.06,
              gravity: -9,
              stretch: 0.05,
            });
            spark({
              count: 26 * big,
              origin: to,
              color: VIOLET,
              intensity: 2,
              speed: 8,
              life: 0.9,
              size: 0.09,
              gravity: -6,
              stretch: 0.035,
            });
            // Embers drift up long after the blast.
            spark({
              count: 18 * big,
              origin: to,
              color: EMBER,
              intensity: 1.8,
              speed: 2.2,
              life: 2.4,
              size: 0.05,
              gravity: 1.1,
              drag: 0.6,
              jitter: 0.4,
            });
            spark(
              {
                count: 9 * big,
                origin: to,
                color: SMOKE,
                speed: 1.6,
                life: 2.6,
                size: 1.5,
                gravity: 0.8,
                drag: 1.5,
                jitter: 0.4,
              },
              smoke,
            );
            debris.spawn({
              count: Math.round(10 * big * amount),
              origin: to,
              speed: 7,
              life: 2.4,
              size: 0.22,
            });
            light(to, HOT, 55 * big);
            add(0.9);
            break;
          }
          case 'cityBlast':
            if (!to) break;
            // The hologram city shatters into red shards.
            flare(to, RED, 1.6 * k, 0.2);
            spark({
              count: 50 * k,
              origin: to,
              color: RED,
              intensity: 2.6,
              speed: 5.5,
              life: 1.1,
              size: 0.08,
              gravity: -3,
              up: 2,
              stretch: 0.05,
            });
            spark(
              {
                count: 6 * k,
                origin: to,
                color: SMOKE,
                speed: 1.2,
                life: 2.4,
                size: 1.2,
                gravity: 0.9,
                up: 2,
              },
              smoke,
            );
            light(to, RED, 30 * k);
            add(1.2);
            break;
          case 'beam':
            add(0.7);
            if (to) {
              spark({
                count: 26 * k,
                origin: to,
                color: RED,
                intensity: 2.2,
                speed: 5,
                life: 0.7,
                size: 0.08,
                gravity: -3,
                up: 1.5,
                stretch: 0.04,
              });
              light(to, RED, 10 * k);
            }
            break;
          case 'shield':
            add(0.9);
            if (to) {
              flare(to, TEAM.FUJIN, 1.2, 0.25);
              spark({
                count: 24 * k,
                origin: to,
                color: TEAM.FUJIN,
                intensity: 1.8,
                speed: 3,
                life: 0.9,
                size: 0.08,
                gravity: 0.5,
                swirl: 5,
              });
            }
            break;
          case 'energy':
            if (from && to)
              spark({
                count: 36 * k,
                origin: from,
                color: e.teamId ? team : GOLD,
                intensity: 2,
                speed: 0.6,
                life: 1.0,
                size: 0.09,
                gravity: 0,
                drag: 0,
                toward: to,
                spread: 0.3,
                stretch: 0.03,
              });
            break;
          case 'repair':
            if (to) {
              spark({
                count: 24 * k,
                origin: to,
                color: HEAL,
                intensity: 1.6,
                speed: 2,
                life: 1.2,
                size: 0.08,
                gravity: 1.5,
                spread: 0.6,
                up: 2,
              });
              spark({
                count: 8 * k,
                origin: to,
                color: WHITE,
                intensity: 2,
                speed: 1.2,
                life: 0.6,
                size: 0.05,
                gravity: 0.5,
                jitter: 0.5,
              });
            }
            break;
          case 'shockwave':
          case 'syncPulse':
            add(0.9);
            // A ground shockwave kicks up dust around the feet.
            if (e.kind === 'shockwave' && e.to?.kind === 'robot')
              spark(
                {
                  count: 14 * k,
                  origin: robotPos(e.to.id).setY(0.2),
                  color: DUST,
                  speed: 3.5,
                  life: 1.4,
                  size: 1,
                  gravity: 0.2,
                  drag: 2,
                  spread: 1,
                  up: 0.15,
                },
                smoke,
              );
            break;
          case 'lightning':
            add(reducedMotion ? 0.25 : 0.45);
            if (to) {
              flare(to, WHITE, 1.1, 0.14);
              spark({
                count: 30,
                origin: to,
                color: TEAM.RAIJIN,
                intensity: 2.6,
                speed: 7,
                life: 0.6,
                size: 0.07,
                stretch: 0.04,
              });
              light(to, TEAM.RAIJIN, 26 * k);
            }
            break;
          case 'wind':
            add(1.0);
            if (to)
              spark({
                count: 50,
                origin: to,
                color: TEAM.FUJIN,
                intensity: 1.5,
                speed: 3,
                life: 1.2,
                size: 0.07,
                gravity: 0.5,
                swirl: 6,
                stretch: 0.05,
              });
            break;
          case 'chargeAura':
            add(1.2);
            if (e.teamId)
              spark({
                count: 30,
                origin: robotPos(e.teamId).setY(0.3),
                color: team,
                intensity: 1.6 * Math.max(0.5, k),
                speed: 2.5,
                life: 1.3,
                size: 0.07,
                gravity: 2.5,
                spread: 0.4,
                up: 3,
                stretch: 0.03,
              });
            break;
          case 'specialStorm':
            add(2.8 * Math.max(0.5, k));
            if (e.teamId === 'FUJIN') {
              spark({
                count: 160,
                origin: robotPos('FUJIN').setY(0.5),
                color: TEAM.FUJIN,
                intensity: 2,
                speed: 4,
                life: 2.4,
                size: 0.08,
                gravity: 3,
                swirl: 9,
                spread: 0.6,
                stretch: 0.05,
              });
              light(robotPos('FUJIN'), TEAM.FUJIN, 40 * k);
            } else if (e.teamId === 'RAIJIN') {
              spark({
                count: 160,
                origin: robotPos('RAIJIN').setY(3.5),
                color: TEAM.RAIJIN,
                intensity: 2.4,
                speed: 7,
                life: 1.8,
                size: 0.07,
                gravity: -5,
                stretch: 0.05,
              });
              light(robotPos('RAIJIN'), TEAM.RAIJIN, 40 * k);
            }
            break;
          default:
            break;
        }
      }),
    // spark/light/flare close over refs and pools only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [director, glow, smoke, debris, reducedMotion],
  );

  useFrame((state, dtRaw) => {
    // Follows hit-stop and slow motion; real time for the light falloff.
    const real = Math.min(dtRaw, 0.05);
    const dt = real * director.scale;
    glow.step(dt);
    smoke.step(dt);
    debris.step(dt);
    for (const l of lights.current)
      if (l.light && l.light.intensity > 0)
        l.light.intensity = l.light.intensity < 0.05 ? 0 : l.light.intensity * Math.exp(-real * 9);

    const eye = state.camera.position;
    const t = director.time;
    transients.current = transients.current.filter((x) => t - x.start < x.duration);
    const rings = transients.current.filter(
      (x) =>
        x.kind === 'shockwave' ||
        x.kind === 'chargeAura' ||
        x.kind === 'syncPulse' ||
        x.kind === 'cityBlast',
    );
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
        mat.color
          .copy(x.kind === 'syncPulse' ? GOLD : TEAM[x.teamId ?? 'RAIJIN'])
          .multiplyScalar(1.8);
      } else {
        const p = where(x.to) ?? new THREE.Vector3(0, 0.08, 0.6);
        m.position.set(p.x, x.kind === 'cityBlast' || x.to?.kind === 'enemy' ? p.y : 0.08, p.z);
        const s = 0.5 + u * (x.kind === 'cityBlast' ? 3 : 9) * x.intensity;
        m.scale.set(s, s, s);
        mat.color.copy(x.kind === 'cityBlast' ? RED : WHITE).multiplyScalar(1.8);
      }
      mat.opacity = (1 - u) * 0.8;
    });

    const beamFx = transients.current.filter((x) => x.kind === 'beam');
    beams.forEach((ribbon, i) => {
      const x = beamFx[i];
      const a = x ? where(x.from) : null;
      const b2 = x ? where(x.to) : null;
      if (!x || !a || !b2) return ribbon.hide();
      const age = t - x.start;
      const rng = seeded(x.seed + (reducedMotion ? 0 : Math.floor(age * 6)) * 31);
      ribbon.set(
        boltPoints(a, b2, rng, 8, 0.15),
        eye,
        0.16 * x.intensity,
        (1 - age / x.duration) * x.intensity,
      );
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
    bolts.forEach((ribbon, i) => {
      const x = boltFx[Math.floor(i / 3)];
      if (!x) return ribbon.hide();
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
        : target
            .clone()
            .add(new THREE.Vector3((rng() - 0.5) * 3, 8 + rng() * 3, (rng() - 0.5) * 2));
      const core = i % 3 === 0;
      ribbon.set(
        boltPoints(from, target, rng, 16, core ? 0.7 : 0.9),
        eye,
        (core ? 0.26 : 0.1) * Math.max(0.6, x.intensity),
        (1 - age / x.duration) * (core ? 1 : 0.6),
      );
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

  const fujinGlow = useMemo(() => TEAM.FUJIN.clone().multiplyScalar(1.6), []);
  return (
    <group name="effects">
      <SpriteLayer pool={smoke} mode="smoke" />
      <SpriteLayer pool={glow} mode="glow" />
      <DebrisLayer pool={debris} />
      {lights.current.map((l, i) => (
        <pointLight
          key={`impact-light-${i}`}
          ref={(o) => void (l.light = o)}
          intensity={0}
          distance={16}
          decay={2}
        />
      ))}
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
      {bolts.map((r, i) => (
        <primitive key={`bolt-${i}`} object={r.mesh} />
      ))}
      {beams.map((r, i) => (
        <primitive key={`beam-${i}`} object={r.mesh} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`dome-${i}`} ref={(m) => void (domeRefs.current[i] = m)} visible={false}>
          <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial
            color={fujinGlow}
            transparent
            opacity={0}
            wireframe
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`vortex-${i}`} ref={(m) => void (vortexRefs.current[i] = m)} visible={false}>
          <torusGeometry args={[1, 0.05, 6, 48, Math.PI * 1.5]} />
          <meshBasicMaterial
            color={fujinGlow}
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
