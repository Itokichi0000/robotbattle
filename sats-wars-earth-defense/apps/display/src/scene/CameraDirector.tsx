import { useFrame, useThree } from '@react-three/fiber';
import { enemyPositionAt } from '@swed/game-engine';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FX_TIME_SCALE } from '../capture';
import { store } from '../net';
import { anim } from './anim';
import { shake } from './cameraBus';
import { fxBus } from './fxBus';

/**
 * Camera language (spec §12.2). Moves are damped dollies, never whip-pans; cuts happen on
 * phase changes only. Shot changes are rate-limited so the hall does not get seasick.
 *   hangarHero      low front 3/4 looking up at RAIJIN (scale)
 *   launch          follows the lift through the roof
 *   heroWide        behind-right over RAIJIN's shoulder: mech left, swarm and Japan right
 *   shoulderCombat  short push toward the firing arm
 *   bossReveal      pulls wide and tilts up when NULL CORE arrives
 *   finisher        RAIJIN OVERDRIVE: low behind the mech, chest core to boss in one line
 *   result          slow orbit
 */

export type SceneMode = 'hangar' | 'launch' | 'landing' | 'battle' | 'result';

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

// Mech fills the left third from behind its right shoulder; swarm and hologram open up right.
const HERO_WIDE: Shot = {
  pos: new THREE.Vector3(12, 7.5, 19),
  look: new THREE.Vector3(-2, 15, -70),
  fov: 44,
};

export function CameraDirector({
  mode,
  reducedMotion,
}: {
  mode: SceneMode;
  reducedMotion: boolean;
}) {
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const look = useRef(new THREE.Vector3(0, 8, 0));
  const override = useRef<{ shot: Shot; until: number } | null>(null);
  const lastOverride = useRef(0);
  const lastMode = useRef<SceneMode | null>(null);
  const tmp = useMemo(
    () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), boss: new THREE.Vector3() }),
    [],
  );

  useEffect(
    () =>
      fxBus.on((e) => {
        const now = performance.now();
        if (reducedMotion) return;
        const free = now - lastOverride.current > 5_000;
        if (e.type === 'weapon_fired' && !e.auto && free) {
          const left = e.seatId === 'GUNNER_L';
          override.current = {
            shot: {
              pos: new THREE.Vector3(left ? -6.5 : 6.5, 12.8, 9.5),
              look: new THREE.Vector3(left ? -12 : 12, 14, -60),
              fov: 40,
            },
            until: now + 1_800,
          };
          lastOverride.current = now;
        }
        if (e.type === 'overdrive_fired') {
          const snap = store.getState().snap?.state;
          const boss = snap?.boss ? snap.enemies.find((x) => x.id === snap.boss!.id) : undefined;
          const p = boss
            ? enemyPositionAt(boss.orbit, boss.spawnedAt, store.matchTime(now))
            : { x: 0, y: 40, z: -110 };
          override.current = {
            shot: {
              pos: new THREE.Vector3(-7, 4.5, 15),
              look: new THREE.Vector3(p.x * 0.7, 9 + p.y * 0.55, p.z * 0.7),
              fov: 52,
            },
            until: now + 4_800 / FX_TIME_SCALE,
          };
          lastOverride.current = now;
          return;
        }
        if (e.type === 'enemy_spawned' && e.kind === 'NULL_CORE') {
          override.current = {
            shot: {
              pos: new THREE.Vector3(4, 4, 24),
              look: new THREE.Vector3(10, 40, -110),
              fov: 50,
            },
            until: now + 4_500,
          };
          lastOverride.current = now;
        }
      }),
    [reducedMotion],
  );

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const now = performance.now();
    let target: Shot;
    const snap = store.getState().snap?.state;
    const liftY = anim.liftY;
    if (mode === 'hangar') {
      const a = Math.sin(t * 0.06) * 0.2;
      target = {
        pos: new THREE.Vector3(Math.sin(a - 0.3) * 23, 2.2, -Math.cos(a - 0.3) * 23),
        look: new THREE.Vector3(0, 7.4, 0),
        fov: 46,
      };
    } else if (mode === 'launch') {
      target = {
        pos: new THREE.Vector3(-9, 4 + liftY * 0.4, -16),
        look: new THREE.Vector3(0, 9 + liftY, 0),
        fov: 50,
      };
    } else if (mode === 'landing') {
      target = {
        pos: new THREE.Vector3(12, 6, 20),
        look: new THREE.Vector3(0, 8 + liftY * 0.6, 0),
        fov: 46,
      };
    } else if (mode === 'result') {
      // Slow drift on RAIJIN's front, framed between the stats (left) and crew list (right).
      const a = Math.sin(t * 0.05) * 0.15;
      target = {
        pos: new THREE.Vector3(Math.sin(a + 0.06) * 30, 5, -Math.cos(a + 0.06) * 30),
        look: new THREE.Vector3(-1.5, 8.5, 0),
        fov: 40,
      };
    } else {
      target = HERO_WIDE;
      // Lean toward the boss when it is up, so mech and boss share the frame.
      const boss = snap?.boss ? snap.enemies.find((e) => e.id === snap.boss!.id) : undefined;
      if (boss) {
        const p = enemyPositionAt(boss.orbit, boss.spawnedAt, store.matchTime(now));
        tmp.boss.set(p.x, p.y, p.z);
        target = {
          pos: new THREE.Vector3(13, 7, 22),
          look: tmp.look.copy(tmp.boss).multiplyScalar(0.55),
          fov: 48,
        };
      }
      if (override.current && now < override.current.until) target = override.current.shot;
      else override.current = null;
      // Gentle handheld drift keeps the wide shot alive.
      if (!reducedMotion) {
        target = {
          ...target,
          pos: target.pos
            .clone()
            .add(new THREE.Vector3(Math.sin(t * 0.21) * 0.6, Math.sin(t * 0.17) * 0.3, 0)),
        };
      }
    }

    const cut =
      lastMode.current !== mode && (mode === 'battle' || mode === 'hangar' || mode === 'landing');
    lastMode.current = mode;
    const k = cut ? 1 : 1 - Math.exp(-dt * (override.current ? 2.2 : 1.4));
    camera.position.lerp(target.pos, k);
    look.current.lerp(target.look, k);
    cam.fov += (target.fov - cam.fov) * k;
    cam.updateProjectionMatrix();
    camera.lookAt(look.current);
    if (shake.amount > 0.001 && !reducedMotion) {
      const a = shake.amount * 0.12;
      camera.position.add(tmp.pos.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0));
    }
    shake.amount *= Math.exp(-dt * 6);
  });
  return null;
}
