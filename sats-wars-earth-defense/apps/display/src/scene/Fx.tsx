import { useFrame } from '@react-three/fiber';
import { enemyPositionAt } from '@swed/game-engine';
import type { Direction, MechPartId, ShieldSeatId } from '@swed/shared';
import { COLORS } from '@swed/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FX_TIME_SCALE } from '../capture';
import { store } from '../net';
import { anchorWorldPosition } from './anchors';
import { anim } from './anim';
import { cameraKick, finisher } from './cameraBus';
import { lastEnemyPos } from './Enemies';
import { fxBus } from './fxBus';

/**
 * Effects are replays of confirmed server events (spec §11.6, §12.3). Nothing here decides a
 * hit; it only draws what the server already applied. Pools keep allocation out of frames.
 */

export const DIR_VEC: Record<Direction, THREE.Vector3> = {
  FRONT: new THREE.Vector3(0, 0, -1),
  RIGHT: new THREE.Vector3(1, 0, 0),
  REAR: new THREE.Vector3(0, 0, 1),
  LEFT: new THREE.Vector3(-1, 0, 0),
};
const DIR_YAW: Record<Direction, number> = {
  FRONT: 0,
  RIGHT: -Math.PI / 2,
  REAR: Math.PI,
  LEFT: Math.PI / 2,
};

const PART_POS: Record<MechPartId, THREE.Vector3> = {
  ARM_L: new THREE.Vector3(-2.9, 6.5, -0.5),
  ARM_R: new THREE.Vector3(2.9, 6.5, -0.5),
  SHOULDER_L: new THREE.Vector3(-3.2, 10.6, 0),
  SHOULDER_R: new THREE.Vector3(3.2, 10.6, 0),
  CORE: new THREE.Vector3(0, 9.4, -1.4),
  LEG_L: new THREE.Vector3(-1.05, 3.5, -0.6),
  LEG_R: new THREE.Vector3(1.05, 3.5, -0.6),
};

const MECH_CENTER = new THREE.Vector3(0, 7.5, 0);
const SHIELD_R = 10.5;
const UP = new THREE.Vector3(0, 1, 0);

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  width: number;
}

/** An energy packet travelling along a short arc (power routing, sats pulse, overdrive). */
interface Orb {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  delay: number;
  arc: number;
  color: string;
  size: number;
  /** Sparks burst on arrival. */
  burst: number;
}

const BACKPACK_FALLBACK = new THREE.Vector3(0, 9.6, 1.6);

interface Blast {
  ball: THREE.Mesh;
  ring: THREE.Mesh;
  life: number;
  max: number;
  size: number;
}

/* ------------------------------------------------------------- sparks */

const SPARK_MAX = 900;

function useSparks() {
  return useMemo(() => {
    const pos = new Float32Array(SPARK_MAX * 3);
    const col = new Float32Array(SPARK_MAX * 3);
    const vel = new Float32Array(SPARK_MAX * 3);
    const life = new Float32Array(SPARK_MAX);
    const size = new Float32Array(SPARK_MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color; varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (420.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    let cursor = 0;
    const c = new THREE.Color();
    return {
      geo,
      mat,
      spawn(at: THREE.Vector3, n: number, color: string, speed: number, sz = 0.6) {
        c.set(color);
        for (let i = 0; i < n; i++) {
          const k = cursor;
          cursor = (cursor + 1) % SPARK_MAX;
          pos[k * 3] = at.x;
          pos[k * 3 + 1] = at.y;
          pos[k * 3 + 2] = at.z;
          const u = Math.random() * 2 - 1;
          const th = Math.random() * Math.PI * 2;
          const r = Math.sqrt(1 - u * u);
          const sp = speed * (0.35 + Math.random() * 0.65);
          vel[k * 3] = r * Math.cos(th) * sp;
          vel[k * 3 + 1] = u * sp + speed * 0.2;
          vel[k * 3 + 2] = r * Math.sin(th) * sp;
          col[k * 3] = c.r * 2.5;
          col[k * 3 + 1] = c.g * 2.5;
          col[k * 3 + 2] = c.b * 2.5;
          life[k] = 0.5 + Math.random() * 0.7;
          size[k] = sz * (0.5 + Math.random());
        }
      },
      step(dt: number) {
        for (let k = 0; k < SPARK_MAX; k++) {
          if (life[k]! <= 0) {
            size[k] = 0;
            continue;
          }
          life[k]! -= dt;
          vel[k * 3 + 1]! -= 9 * dt;
          pos[k * 3]! += vel[k * 3]! * dt;
          pos[k * 3 + 1]! += vel[k * 3 + 1]! * dt;
          pos[k * 3 + 2]! += vel[k * 3 + 2]! * dt;
          if (life[k]! < 0.3) size[k]! *= 0.9;
        }
        geo.attributes.position!.needsUpdate = true;
        geo.attributes.size!.needsUpdate = true;
        geo.attributes.color!.needsUpdate = true;
      },
    };
  }, []);
}

/* -------------------------------------------------------------- shields */

const shieldFrag = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha; uniform float uRipple; uniform float uTime;
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  float hexEdge(vec2 p) {
    p *= vec2(18.0, 10.0);
    vec2 r = vec2(1.0, 1.732);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(g);
    float d = max(dot(q, normalize(vec2(1.0, 1.732))), q.x);
    return smoothstep(0.42, 0.5, d);
  }
  void main() {
    float fres = pow(1.0 - abs(dot(vN, vV)), 2.2);
    float hex = hexEdge(vUv);
    float ring = smoothstep(0.08, 0.0, abs(fract(vUv.y * 2.0 - uTime * 0.6) - 0.5) - 0.42);
    float a = uAlpha * (0.18 + fres * 0.8 + hex * 0.35 + ring * 0.15) + uRipple * (0.5 + hex * 0.8);
    gl_FragColor = vec4(uColor * (1.2 + uRipple * 2.0) * a, a);
  }`;
const shieldVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

function makeShield() {
  const geo = new THREE.SphereGeometry(SHIELD_R, 40, 20, (3 * Math.PI) / 2 - 0.95, 1.9, 0.45, 1.6);
  const mat = new THREE.ShaderMaterial({
    vertexShader: shieldVert,
    fragmentShader: shieldFrag,
    uniforms: {
      uColor: { value: new THREE.Color(COLORS.ally) },
      uAlpha: { value: 0 },
      uRipple: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(MECH_CENTER).setY(4.5);
  mesh.visible = false;
  return { mesh, mat, ripple: 0, autoUntil: 0, dir: 'FRONT' as Direction };
}

/* ------------------------------------------------------------------ Fx */

export function Fx({ reduceFlash }: { reduceFlash: boolean }) {
  const group = useRef<THREE.Group>(null);
  const sparks = useSparks();
  const threatSource = useRef(new Map<string, string>());
  const flashL = useRef<THREE.PointLight>(null);
  const flashR = useRef<THREE.PointLight>(null);
  const blastLight = useRef<THREE.PointLight>(null);
  const flashLevel = useRef({ L: 0, R: 0, blast: 0 });

  const pools = useMemo(() => {
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    beamGeo.translate(0, 0.5, 0);
    // Lightning strikes use ~14 segments at once, so the pool is generous.
    const beams: Beam[] = Array.from({ length: 40 }, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      return { mesh, mat, life: 0, max: 1, width: 0.2 };
    });
    const ballGeo = new THREE.SphereGeometry(1, 20, 14);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 48);
    const blasts: Blast[] = Array.from({ length: 12 }, () => {
      const ball = new THREE.Mesh(
        ballGeo,
        new THREE.MeshBasicMaterial({
          color: '#ffb36b',
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: '#ffd9a8',
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      ball.visible = ring.visible = false;
      return { ball, ring, life: 0, max: 1, size: 1 };
    });
    const telegraphs = Array.from({ length: 10 }, () => {
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS.danger,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      const orb = new THREE.Mesh(
        ballGeo,
        new THREE.MeshBasicMaterial({
          color: COLORS.danger,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      orb.visible = false;
      return { mesh, mat, orb };
    });
    const shields: Record<ShieldSeatId, ReturnType<typeof makeShield>> = {
      SHIELD_L: makeShield(),
      SHIELD_R: makeShield(),
    };
    const combo = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 8, 64),
      new THREE.MeshBasicMaterial({
        color: COLORS.ally,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    combo.visible = false;
    combo.userData.life = 0;
    const orbGeo = new THREE.SphereGeometry(1, 14, 10);
    const orbs: Orb[] = Array.from({ length: 28 }, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(orbGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      return {
        mesh,
        mat,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        t: 0,
        dur: 0,
        delay: 0,
        arc: 0,
        color: COLORS.power,
        size: 0.3,
        burst: 0,
      };
    });
    return { beams, blasts, telegraphs, shields, combo, orbs };
  }, []);

  useEffect(() => {
    const g = group.current!;
    for (const b of pools.beams) g.add(b.mesh);
    for (const b of pools.blasts) g.add(b.ball, b.ring);
    for (const t of pools.telegraphs) g.add(t.mesh, t.orb);
    g.add(pools.shields.SHIELD_L.mesh, pools.shields.SHIELD_R.mesh, pools.combo);
    for (const o of pools.orbs) g.add(o.mesh);
  }, [pools]);

  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const tmpC = useMemo(() => new THREE.Vector3(), []);
  /** Effect clock (scaled like every other effect) and actions queued on it. */
  const fxClock = useRef(0);
  const queue = useRef<Array<{ at: number; run: () => void }>>([]);

  useEffect(() => {
    const beam = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      color: string,
      width: number,
      life: number,
    ) => {
      const slot = pools.beams.find((x) => x.life <= 0) ?? pools.beams[0]!;
      const dir = tmpB.copy(b).sub(a);
      const len = dir.length();
      slot.mesh.position.copy(a);
      slot.mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
      slot.mesh.scale.set(width, len, width);
      slot.mat.color.set(color);
      slot.life = slot.max = life;
      slot.width = width;
      slot.mesh.visible = true;
    };
    const blast = (at: THREE.Vector3, size: number, color = '#ffb36b') => {
      const slot = pools.blasts.find((x) => x.life <= 0) ?? pools.blasts[0]!;
      slot.ball.position.copy(at);
      slot.ring.position.copy(at);
      (slot.ball.material as THREE.MeshBasicMaterial).color.set(color);
      slot.size = size;
      slot.life = slot.max = 0.9 + size * 0.04;
      slot.ball.visible = slot.ring.visible = true;
      if (blastLight.current) blastLight.current.position.copy(at);
      flashLevel.current.blast = Math.min(1, size / 6);
    };
    const enemyPos = (id: string, out: THREE.Vector3) => {
      if (anchorWorldPosition(`enemy:${id}`, out)) return true;
      const last = lastEnemyPos.get(id);
      if (last) {
        out.copy(last);
        return true;
      }
      return false;
    };
    const station = (id: string, out: THREE.Vector3) => {
      if (anchorWorldPosition(`station:${id}`, out)) return out;
      return out.copy(id === 'backpack' ? BACKPACK_FALLBACK : PART_POS.CORE);
    };
    /** A jagged strike: short beams between jittered points, a bright core and a wide halo. */
    const lightning = (from: THREE.Vector3, to: THREE.Vector3, life: number) => {
      const n = 7;
      let prev = from.clone();
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const next = from.clone().lerp(to, k);
        if (i < n) {
          const j = 2.2 * Math.sin(Math.PI * k);
          next.add(tmpC.set((Math.random() - 0.5) * j * 2, 0, (Math.random() - 0.5) * j * 2));
        }
        beam(prev, next, '#ffffff', 0.22, life);
        beam(prev, next, COLORS.ally, 0.9, life * 0.8);
        prev = next;
      }
    };
    const later = (sec: number, run: () => void) =>
      queue.current.push({ at: fxClock.current + sec, run });
    const shieldPoint = (dir: Direction, out: THREE.Vector3) =>
      out
        .copy(DIR_VEC[dir])
        .multiplyScalar(SHIELD_R * 0.92)
        .add(MECH_CENTER);

    const bossPos = (out: THREE.Vector3) => {
      const id = store.getState().snap?.state.boss?.id;
      return !!id && enemyPos(id, out);
    };
    const muzzle = (left: boolean, out: THREE.Vector3) =>
      anchorWorldPosition(`muzzle:${left ? 'GUNNER_L' : 'GUNNER_R'}`, out);
    /** Lightning from the sky onto a point: the "21 sats" signature, whatever the action. */
    const skyStrike = (at: THREE.Vector3, power: number) => {
      lightning(at.clone().add(tmpC.set(6, 70, -30)), at.clone(), 0.9 * power);
      later(0.08, () => lightning(at.clone().add(tmpC.set(-10, 64, -24)), at.clone(), 0.7 * power));
      sparks.spawn(at, 120, COLORS.ally, 16, 0.9);
      blast(at.clone(), 3 * power, '#bff6ff');
      anim.surgeUntil = performance.now() + 2_500 / FX_TIME_SCALE;
      cameraKick(0.8);
    };

    return fxBus.on((e) => {
      switch (e.type) {
        case 'threat_warning':
          threatSource.current.set(e.threatId, e.sourceId);
          break;
        case 'action': {
          if (e.kind === 'ATTACK') {
            if (!bossPos(tmpB)) break;
            const b = tmpB.clone();
            if (e.paid) {
              // Lightning attack: both arms fire a white-hot beam and the sky strikes the boss.
              for (const left of [true, false]) {
                if (!muzzle(left, tmpA)) continue;
                const a = tmpA.clone();
                beam(a, b, '#ffffff', 0.5, 0.9);
                beam(a, b, COLORS.action, 1.6, 0.8);
                flashLevel.current[left ? 'L' : 'R'] = 1;
              }
              skyStrike(b, 1.2);
              later(0.1, () => blast(b.clone(), 9, '#ffd08a'));
              break;
            }
            // Free taps arrive batched: one or two beams, sparks sized by the crowd.
            const shots = Math.min(2, e.count);
            for (let i = 0; i < shots; i++) {
              const left = Math.random() < 0.5;
              if (!muzzle(left, tmpA)) continue;
              const a = tmpA.clone();
              beam(a, b, left ? '#ffcf7a' : '#bff6ff', 0.28, 0.25);
              beam(a, b, left ? COLORS.action : COLORS.ally, 0.6, 0.16);
              flashLevel.current[left ? 'L' : 'R'] = 0.7;
            }
            sparks.spawn(b, Math.min(80, 12 + e.count * 6), COLORS.action, 14, 0.7);
            break;
          }
          if (e.kind === 'DEFEND') {
            for (const seat of ['SHIELD_L', 'SHIELD_R'] as const) {
              const sh = pools.shields[seat];
              sh.ripple = Math.max(sh.ripple, e.paid ? 1 : 0.35);
            }
            if (e.paid) skyStrike(station('core', tmpA).clone(), 1);
            break;
          }
          // REPAIR: welding sparks over the frame; Lightning floods it with light.
          for (const part of ['CORE', 'LEG_L', 'LEG_R', 'ARM_L', 'ARM_R'] as const) {
            if (!e.paid && Math.random() > 0.4) continue;
            sparks.spawn(PART_POS[part], e.paid ? 50 : 14, COLORS.repair, 6, 0.6);
          }
          if (e.paid) {
            skyStrike(station('core', tmpA).clone(), 1);
            blast(PART_POS.CORE.clone(), 2.4, COLORS.repair);
          }
          break;
        }
        case 'strike_blocked': {
          const src = threatSource.current.get(e.threatId);
          for (const seat of ['SHIELD_L', 'SHIELD_R'] as const) {
            const sh = pools.shields[seat];
            sh.ripple = 1;
            sh.dir = e.dir;
          }
          shieldPoint(e.dir, tmpB);
          const b = tmpB.clone();
          if (src && enemyPos(src, tmpA)) beam(tmpA.clone(), b, COLORS.danger, 0.9, 0.5);
          sparks.spawn(b, 90, COLORS.ally, 16, 0.8);
          cameraKick(0.4);
          break;
        }
        case 'strike_hit': {
          const src = threatSource.current.get(e.threatId);
          tmpB.copy(DIR_VEC[e.dir]).multiplyScalar(260).setY(2);
          const b = tmpB.clone();
          if (src && enemyPos(src, tmpA)) beam(tmpA.clone(), b, '#ff4060', 1.1, 0.6);
          blast(b, 18, '#ff6a3a');
          cameraKick(0.6);
          break;
        }
        case 'mech_hit': {
          const src = threatSource.current.get(e.threatId);
          const b = PART_POS.CORE.clone();
          if (src && enemyPos(src, tmpA)) beam(tmpA.clone(), b, '#ff4060', 0.7, 0.4);
          sparks.spawn(b, 50, '#ffb36b', 12, 0.6);
          blast(b, 1.8, '#ff7a3a');
          cameraKick(0.7);
          break;
        }
        case 'boss_destroyed': {
          finisher.until = performance.now() + 4_800 / FX_TIME_SCALE;
          if (!enemyPos(e.enemyId, tmpB)) break;
          const to = tmpB.clone();
          const from = station('core', tmpA).clone();
          beam(from, to, '#ffffff', 1.1, 1.5);
          beam(from, to, COLORS.action, 2.8, 1.3);
          beam(from, to, COLORS.ally, 4.6, 0.7);
          later(0.15, () => {
            blast(to.clone(), 22, '#ffd08a');
            sparks.spawn(to, 300, COLORS.action, 40, 1.3);
            cameraKick(1.2);
          });
          break;
        }
      }
    });
  }, [pools, sparks, tmpA, tmpB, tmpC]);

  useFrame((s, frameDt) => {
    const dt = frameDt * FX_TIME_SCALE;
    const now = performance.now();
    const mt = store.matchTime(now);
    const snap = store.getState().snap?.state;
    const flashScale = reduceFlash ? 0.35 : 1;

    fxClock.current += dt;
    if (queue.current.length) {
      const due = queue.current.filter((q) => q.at <= fxClock.current);
      queue.current = queue.current.filter((q) => q.at > fxClock.current);
      for (const q of due) q.run();
    }
    for (const o of pools.orbs) {
      if (o.dur <= 0) continue;
      if (o.delay > 0) {
        o.delay -= dt;
        continue;
      }
      o.t += dt;
      const k = Math.min(1, o.t / o.dur);
      const e = k * k * (3 - 2 * k);
      o.mesh.position.lerpVectors(o.from, o.to, e);
      o.mesh.position.y += Math.sin(Math.PI * e) * o.arc;
      o.mesh.scale.setScalar(o.size * (0.7 + 0.6 * Math.sin(Math.PI * k)));
      o.mat.opacity = 0.9 * flashScale + 0.1;
      o.mesh.visible = true;
      if (Math.random() < 0.6) sparks.spawn(o.mesh.position, 1, o.color, 1.2, o.size * 1.4);
      if (k >= 1) {
        o.dur = 0;
        o.mesh.visible = false;
        if (o.burst) sparks.spawn(o.to, o.burst, o.color, 5, 0.5);
      }
    }
    for (const b of pools.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / b.max);
      b.mat.opacity = k * flashScale + 0.05;
      const w = b.width * (0.6 + 0.4 * k);
      b.mesh.scale.x = b.mesh.scale.z = w;
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const x of pools.blasts) {
      if (x.life <= 0) continue;
      x.life -= dt;
      const p = 1 - Math.max(0, x.life / x.max);
      const sz = x.size * (0.35 + Math.pow(p, 0.45) * 1.1);
      x.ball.scale.setScalar(sz);
      (x.ball.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9 * flashScale;
      x.ring.scale.setScalar(x.size * (0.4 + p * 2.6));
      x.ring.lookAt(s.camera.position);
      (x.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.6 * flashScale;
      if (x.life <= 0) x.ball.visible = x.ring.visible = false;
    }
    // Telegraphs: one per pending threat, from the attacker to the sector it will strike.
    const threats = snap?.threats ?? [];
    pools.telegraphs.forEach((tg, i) => {
      const th = threats[i];
      const src = th && snap?.enemies.find((e) => e.id === th.sourceId);
      if (!th || !src) {
        tg.mesh.visible = tg.orb.visible = false;
        return;
      }
      const p = enemyPositionAt(src.orbit, src.spawnedAt, mt);
      tmpA.set(p.x, p.y, p.z);
      tmpB.copy(DIR_VEC[th.dir]).multiplyScalar(SHIELD_R).add(MECH_CENTER);
      const dir = tmpB.clone().sub(tmpA);
      tg.mesh.position.copy(tmpA);
      tg.mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      const k = Math.min(1, Math.max(0, (mt - th.warnAt) / Math.max(1, th.impactAt - th.warnAt)));
      tg.mesh.scale.set(0.05 + k * 0.12, dir.length(), 0.05 + k * 0.12);
      // Slow pulse (≤ 2 Hz) so the warning reads without strobing.
      const pulse = 0.5 + 0.5 * Math.sin((mt / 1000) * Math.PI * 2 * (0.8 + k * 1.2));
      tg.mat.opacity = (0.15 + k * 0.55) * (0.6 + 0.4 * pulse);
      tg.mesh.visible = true;
      tg.orb.position.copy(tmpA);
      tg.orb.scale.setScalar((th.kind === 'CORE_LANCE' ? 4 : 0.9) * (0.4 + k));
      (tg.orb.material as THREE.MeshBasicMaterial).opacity = 0.3 + k * 0.5;
      tg.orb.visible = true;
    });
    // The shared shield: brighter as the crowd charges it, facing the announced strike.
    const strike = snap?.threats.find((th) => th.target.type === 'CITY');
    const shieldK = snap ? Math.min(1, snap.shield / Math.max(1, snap.shieldMax)) : 0;
    for (const seat of ['SHIELD_L', 'SHIELD_R'] as const) {
      const sh = pools.shields[seat];
      if (strike) sh.dir = strike.dir;
      else sh.dir = seat === 'SHIELD_L' ? 'FRONT' : 'RIGHT';
      const target = snap?.phase === 'BATTLE' && shieldK > 0.02 ? 0.12 + shieldK * 0.5 : 0;
      sh.mat.uniforms.uAlpha!.value +=
        (target - sh.mat.uniforms.uAlpha!.value) * Math.min(1, dt * 10);
      sh.mat.uniforms.uRipple!.value = sh.ripple * flashScale;
      sh.mat.uniforms.uTime!.value = s.clock.elapsedTime;
      sh.ripple = Math.max(0, sh.ripple - dt * 1.6);
      sh.mesh.rotation.y = DIR_YAW[sh.dir];
      sh.mesh.visible = sh.mat.uniforms.uAlpha!.value > 0.01 || sh.ripple > 0.01;
    }
    const combo = pools.combo;
    if (combo.visible) {
      const l = (combo.userData.life as number) - dt * 0.9;
      combo.userData.life = l;
      combo.position.set(0, 9.4, -1.4);
      combo.lookAt(s.camera.position);
      combo.scale.setScalar((1.5 + (1 - l) * 5) * (combo.userData.full ? 1.8 : 1));
      (combo.material as THREE.MeshBasicMaterial).opacity = Math.max(0, l) * flashScale;
      if (l <= 0) combo.visible = false;
    }
    sparks.step(dt);
    const fl = flashLevel.current;
    if (flashL.current && anchorWorldPosition('muzzle:GUNNER_L', tmpA)) {
      flashL.current.position.copy(tmpA);
      flashL.current.intensity = fl.L * 900 * flashScale;
    }
    if (flashR.current && anchorWorldPosition('muzzle:GUNNER_R', tmpA)) {
      flashR.current.position.copy(tmpA);
      flashR.current.intensity = fl.R * 600 * flashScale;
    }
    if (blastLight.current) blastLight.current.intensity = fl.blast * 20000 * flashScale;
    fl.L = Math.max(0, fl.L - dt * 6);
    fl.R = Math.max(0, fl.R - dt * 6);
    fl.blast = Math.max(0, fl.blast - dt * 2.5);
  });

  return (
    <group ref={group}>
      <points geometry={sparks.geo} material={sparks.mat} frustumCulled={false} />
      <pointLight ref={flashL} color={COLORS.action} distance={40} decay={2} intensity={0} />
      <pointLight ref={flashR} color={COLORS.ally} distance={40} decay={2} intensity={0} />
      <pointLight ref={blastLight} color="#ff8a4a" distance={200} decay={2} intensity={0} />
    </group>
  );
}
