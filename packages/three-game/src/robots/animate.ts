import * as THREE from 'three';
import type { ClipName } from '../director';
import { CLIP_DURATION } from '../director';
import type { JointName, JointRest, RobotRig } from './build';
import { JOINT_NAMES } from './build';

const _euler = new THREE.Euler();
const _delta = new THREE.Quaternion();
const _offset = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * Pose a joint whose rest frame is not the identity (GLB bones point along the limbs).
 * The clips below are authored as rotations/offsets in the parent's rest axes, which are
 * world-aligned on the procedural rigs. Re-expressing them as
 *   local = parentFrame⁻¹ · delta · frame,   position = rest + parentFrame⁻¹ · offset
 * makes every joint end up with the same world motion as on the procedural rig.
 */
function setFramed(
  j: THREE.Object3D,
  rest: JointRest,
  rx: number,
  ry: number,
  rz: number,
  pos: [number, number, number] | undefined,
): void {
  _delta.setFromEuler(_euler.set(rx, ry, rz));
  j.quaternion.copy(rest.parentFrameInv!).multiply(_delta).multiply(rest.frame!);
  j.position.copy(rest.position);
  if (pos) j.position.add(_offset.set(...pos).applyQuaternion(rest.parentFrameInv!));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
/** 0→1→0 bump over [a, b]. */
const bump = (u: number, a: number, b: number) => {
  if (u <= a || u >= b) return 0;
  return Math.sin(((u - a) / (b - a)) * Math.PI);
};
/** Ramp 0→1 over [a, b]. */
const ramp = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));

interface Pose {
  rot: Partial<Record<JointName, [number, number, number]>>;
  pos: Partial<Record<JointName, [number, number, number]>>;
  backSpin: number;
  glow: number;
}

function emptyPose(): Pose {
  return { rot: {}, pos: {}, backSpin: 0, glow: 1 };
}

function addRot(p: Pose, j: JointName, x: number, y = 0, z = 0): void {
  const r = p.rot[j] ?? [0, 0, 0];
  p.rot[j] = [r[0] + x, r[1] + y, r[2] + z];
}
function addPos(p: Pose, j: JointName, x: number, y: number, z: number): void {
  const r = p.pos[j] ?? [0, 0, 0];
  p.pos[j] = [r[0] + x, r[1] + y, r[2] + z];
}

/** Fighting-stance idle; the base for most clips. */
function idle(p: Pose, rig: RobotRig, t: number, calm = 1): void {
  if (rig.kind === 'raijin') {
    const br = Math.sin(t * 1.6) * calm;
    addPos(p, 'Hips', 0, -0.06 + 0.03 * br, 0);
    addRot(p, 'Chest', 0.04 + 0.025 * br, 0, 0);
    addRot(p, 'Head', -0.04 - 0.02 * br, 0, 0);
    for (const [s, side] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      addRot(p, `UpperArm_${s}`, -0.15, 0, 0.16 * side + 0.02 * br * side);
      addRot(p, `Forearm_${s}`, -0.55, 0, 0);
      addRot(p, `Thigh_${s}`, -0.15, 0, 0.06 * side);
      addRot(p, `Shin_${s}`, 0.3, 0, 0);
      addRot(p, `Foot_${s}`, -0.15, 0, 0);
    }
    p.backSpin += t * 0.25;
  } else {
    const hov = Math.sin(t * 2.1) * calm;
    addPos(p, 'Root', 0, 0.35 + 0.1 * hov, 0);
    addRot(p, 'Chest', 0.12, 0.05 * Math.sin(t * 1.3), 0);
    for (const [s, side] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      addRot(p, `UpperArm_${s}`, -0.3, 0, 0.32 * side + 0.04 * hov * side);
      addRot(p, `Forearm_${s}`, -0.65, 0, 0);
      addRot(p, `Thigh_${s}`, -0.2 - 0.05 * hov, 0, 0.05 * side);
      addRot(p, `Shin_${s}`, 0.45 + 0.05 * hov, 0, 0);
      addRot(p, `Foot_${s}`, 0.25, 0, 0);
    }
    p.backSpin += Math.sin(t * 0.9) * 0.06;
  }
}

type ClipFn = (p: Pose, rig: RobotRig, t: number, u: number, total: number) => void;

const CLIPS: Record<ClipName, ClipFn> = {
  Idle: (p, rig, _t, _u, total) => idle(p, rig, total),

  Intro: (p, rig, t, u, total) => {
    idle(p, rig, total);
    const fall = 1 - easeOut(ramp(u, 0, 0.4));
    addPos(p, 'Root', 0, 9 * fall * fall, 0);
    const squash = bump(u, 0.38, 0.75);
    addPos(p, 'Hips', 0, -0.45 * squash, 0);
    addRot(p, 'Thigh_L', -0.6 * squash);
    addRot(p, 'Thigh_R', -0.6 * squash);
    addRot(p, 'Shin_L', 1.0 * squash);
    addRot(p, 'Shin_R', 1.0 * squash);
    const pose = bump(u, 0.6, 1.0);
    if (rig.kind === 'raijin') {
      addRot(p, 'UpperArm_R', -2.4 * pose, 0, -0.2 * pose);
      addRot(p, 'Forearm_R', 0.4 * pose);
      p.backSpin += t * 4 * pose;
    } else {
      addRot(p, 'UpperArm_L', 0, 0, 1.2 * pose);
      addRot(p, 'UpperArm_R', 0, 0, -1.2 * pose);
      addPos(p, 'Root', 0, 0.6 * pose, 0);
    }
    p.glow = 1 + 1.5 * pose;
  },

  AttackHeavy: (p, rig, _t, u, total) => {
    idle(p, rig, total, 0.3);
    const wind = easeInOut(ramp(u, 0, 0.4)) * (1 - ramp(u, 0.42, 0.52));
    const strike = easeOut(ramp(u, 0.42, 0.55)) * (1 - ramp(u, 0.75, 1));
    addRot(p, 'Chest', -0.1 * wind + 0.2 * strike, -0.5 * wind + 0.45 * strike, 0);
    addRot(p, 'UpperArm_R', 0.9 * wind - 1.55 * strike, 0, -0.1 * wind);
    addRot(p, 'Forearm_R', -0.9 * wind + 0.5 * strike);
    addRot(p, 'UpperArm_L', -0.6 * wind + 0.3 * strike, 0, 0.2 * wind);
    addPos(p, 'Hips', 0, -0.12 * wind, 0);
    addRot(p, 'Thigh_L', -0.4 * strike);
    addRot(p, 'Shin_L', 0.4 * strike);
    addRot(p, 'Thigh_R', 0.35 * strike);
    p.backSpin += 6 * wind;
    p.glow = 1 + 1.2 * wind + 1.8 * strike;
  },

  AttackLight: (p, rig, _t, u, total) => {
    idle(p, rig, total, 0.3);
    addRot(p, 'Chest', 0.3 * ramp(u, 0, 0.15) * (1 - ramp(u, 0.85, 1)));
    const jabs = [0.18, 0.4, 0.62] as const;
    jabs.forEach((c, i) => {
      const k = bump(u, c - 0.1, c + 0.12);
      const s = i % 2 === 0 ? 'R' : 'L';
      addRot(p, `UpperArm_${s}`, -1.45 * k, 0, 0);
      addRot(p, `Forearm_${s}`, 0.55 * k);
      addRot(p, 'Chest', 0, (s === 'R' ? 0.35 : -0.35) * k, 0);
    });
    const kick = bump(u, 0.7, 0.95);
    addRot(p, 'Thigh_R', -1.3 * kick);
    addRot(p, 'Shin_R', -0.3 * kick);
    p.glow = 1 + 1.5 * bump(u, 0.1, 0.9);
  },

  Guard: (p, rig, _t, u, total) => {
    idle(p, rig, total, 0.5);
    const g = easeOut(ramp(u, 0, 0.3));
    for (const [s, side] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      addRot(p, `UpperArm_${s}`, -1.25 * g, 0, -0.25 * side * g);
      addRot(p, `Forearm_${s}`, -1.1 * g, 0, 0);
    }
    addPos(p, 'Hips', 0, -0.1 * g, 0);
    p.glow = 1.3;
  },

  HitReact: (p, rig, _t, u, total) => {
    idle(p, rig, total, 0.3);
    const k = 1 - easeOut(u);
    const jolt = bump(u, 0, 0.35);
    addRot(p, 'Chest', -0.45 * k, 0.15 * jolt, 0.1 * jolt);
    addRot(p, 'Head', -0.35 * k);
    addPos(p, 'Root', 0, 0, -0.55 * jolt);
    addRot(p, 'UpperArm_L', 0.3 * k, 0, 0.4 * k);
    addRot(p, 'UpperArm_R', 0.3 * k, 0, -0.4 * k);
    p.glow = 1 + 2.5 * jolt;
  },

  Special: (p, rig, t, u, total) => {
    idle(p, rig, total, 0.2);
    if (rig.kind === 'raijin') {
      const raise = easeInOut(ramp(u, 0, 0.35)) * (1 - ramp(u, 0.6, 0.7));
      const slam = easeOut(ramp(u, 0.6, 0.7)) * (1 - ramp(u, 0.85, 1));
      addRot(p, 'UpperArm_L', -2.8 * raise - 1.1 * slam, 0, 0.3 * raise);
      addRot(p, 'UpperArm_R', -2.8 * raise - 1.1 * slam, 0, -0.3 * raise);
      addRot(p, 'Forearm_L', 0.3 * raise);
      addRot(p, 'Forearm_R', 0.3 * raise);
      addRot(p, 'Chest', -0.2 * raise + 0.5 * slam);
      addPos(p, 'Hips', 0, -0.1 * raise - 0.5 * slam, 0);
      addRot(p, 'Thigh_L', -0.7 * slam);
      addRot(p, 'Thigh_R', -0.7 * slam);
      addRot(p, 'Shin_L', 1.1 * slam);
      addRot(p, 'Shin_R', 1.1 * slam);
      p.backSpin += t * 14 * (raise + slam * 0.5);
      p.glow = 1 + 3 * raise + 4 * slam;
    } else {
      const spin = easeInOut(ramp(u, 0, 0.55));
      const dive = easeOut(ramp(u, 0.6, 0.75)) * (1 - ramp(u, 0.88, 1));
      addRot(p, 'Root', 0, spin * Math.PI * 4, 0);
      addPos(p, 'Root', 0, 1.6 * Math.sin(Math.min(1, u / 0.7) * Math.PI), 0);
      addRot(p, 'UpperArm_L', 0, 0, 1.45 * (1 - dive) * ramp(u, 0, 0.2));
      addRot(p, 'UpperArm_R', 0, 0, -1.45 * (1 - dive) * ramp(u, 0, 0.2));
      addRot(p, 'UpperArm_L', -1.5 * dive);
      addRot(p, 'UpperArm_R', -1.5 * dive);
      addRot(p, 'Chest', 0.5 * dive);
      p.backSpin += Math.sin(t * 20) * 0.3 * spin;
      p.glow = 1 + 3 * spin + 3 * dive;
    }
  },

  Victory: (p, rig, t, u, total) => {
    idle(p, rig, total, 0.6);
    const up = easeOut(ramp(u, 0, 0.3));
    const pump = Math.abs(Math.sin(t * 3.2)) * up;
    addRot(p, 'UpperArm_R', -2.85 * up + 0.2 * pump, 0, -0.15 * up);
    addRot(p, 'Forearm_R', 0.6 * up - 0.3 * pump);
    addRot(p, 'UpperArm_L', 0.2 * up, 0, 0.3 * up);
    addPos(p, 'Hips', 0, 0.06 * pump, 0);
    if (rig.kind === 'fujin') addPos(p, 'Root', 0, 0.4 * up, 0);
    p.backSpin += t * 2;
    p.glow = 1.8 + 0.6 * pump;
  },

  Defeat: (p, rig, _t, u) => {
    const k = easeInOut(ramp(u, 0, 0.8));
    idle(p, rig, 0, 1 - k);
    addPos(p, 'Hips', 0, -0.95 * k, 0);
    if (rig.kind === 'fujin') addPos(p, 'Root', 0, -0.35 * k, 0);
    for (const s of ['L', 'R'] as const) {
      addRot(p, `Thigh_${s}`, -1.15 * k);
      addRot(p, `Shin_${s}`, 1.9 * k);
      addRot(p, `Foot_${s}`, -0.7 * k);
      addRot(p, `UpperArm_${s}`, 0.15 * k);
      addRot(p, `Forearm_${s}`, -0.2 * k);
    }
    addRot(p, 'Chest', 0.55 * k);
    addRot(p, 'Head', 0.45 * k);
    p.glow = 1 - 0.75 * k;
  },
};

/**
 * Apply a procedural clip to the rig. `t` = seconds since clip start,
 * `total` = global time (for continuous idle motion).
 */
export function applyClip(
  rig: RobotRig,
  clip: ClipName,
  t: number,
  total: number,
  energyGlow = 0,
): void {
  const pose = emptyPose();
  const dur = CLIP_DURATION[clip];
  const u = clamp01(t / dur);
  (CLIPS[clip] ?? CLIPS.Idle)(pose, rig, t, u, total);
  for (const name of JOINT_NAMES) {
    const j = rig.joints[name];
    const rest = rig.rest[name];
    const r = pose.rot[name];
    const q = pose.pos[name];
    if (rest.frame && rest.parentFrameInv) {
      setFramed(j, rest, r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0, q);
      continue;
    }
    j.rotation.set(
      rest.rotation.x + (r?.[0] ?? 0),
      rest.rotation.y + (r?.[1] ?? 0),
      rest.rotation.z + (r?.[2] ?? 0),
    );
    j.position.set(
      rest.position.x + (q?.[0] ?? 0),
      rest.position.y + (q?.[1] ?? 0),
      rest.position.z + (q?.[2] ?? 0),
    );
  }
  if (rig.spinners?.length) {
    // Drums / ring turn on their own axes; the BackUnit mount stays at rest.
    if (rig.backRest) setFramed(rig.backUnit, rig.backRest, 0, 0, 0, undefined);
    for (const sp of rig.spinners)
      sp.object.quaternion
        .copy(sp.rest)
        .multiply(_delta.setFromAxisAngle(_yAxis, pose.backSpin * sp.sign));
  } else if (rig.backRest?.frame && rig.backRest.parentFrameInv)
    setFramed(rig.backUnit, rig.backRest, 0, 0, pose.backSpin, undefined);
  else rig.backUnit.rotation.z = pose.backSpin;
  const k = pose.glow * (1 + energyGlow);
  // GLB materials keep their authored ratios (e.g. FUJIN's dim veil vs. its bright body).
  for (const m of rig.glowMaterials)
    m.emissiveIntensity = ((m.userData.swBaseGlow as number | undefined) ?? rig.baseGlow) * k;
}
