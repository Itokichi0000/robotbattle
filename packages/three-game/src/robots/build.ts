import * as THREE from 'three';

/**
 * Procedural stand-in robots, built from three.js primitives so the arena works
 * without any external assets. Both rigs share the same joint names as the
 * Blender skeleton spec (docs/ART_BIBLE.md), so GLB models can replace them.
 */
export const JOINT_NAMES = [
  'Root',
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'UpperArm_L',
  'UpperArm_R',
  'Forearm_L',
  'Forearm_R',
  'Hand_L',
  'Hand_R',
  'Thigh_L',
  'Thigh_R',
  'Shin_L',
  'Shin_R',
  'Foot_L',
  'Foot_R',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

export interface JointRest {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /**
   * Rest orientation relative to the rig root. Absent (= identity) for the procedural
   * rigs; set for GLB skeletons whose bones point along the limbs (see robots/glbRig.ts).
   */
  frame?: THREE.Quaternion;
  /** Inverse of the parent joint's rest orientation relative to the rig root. */
  parentFrameInv?: THREE.Quaternion;
}

export interface RobotRig {
  kind: 'raijin' | 'fujin';
  root: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  rest: Record<JointName, JointRest>;
  /** Signature back unit (drum ring / wind bags); spun during specials. */
  backUnit: THREE.Object3D;
  /** Rest frame of the back unit (GLB skeletons only). */
  backRest?: JointRest;
  /** Emissive materials whose intensity tracks energy / effects. */
  glowMaterials: THREE.MeshStandardMaterial[];
  baseGlow: number;
  height: number;
  dispose(): void;
}

interface Palette {
  primary: string;
  secondary: string;
  dark: string;
  glow: string;
}

const RAIJIN_PALETTE: Palette = {
  primary: '#E8851A', // amber-orange armour
  secondary: '#C9A040', // gold
  dark: '#2A2522', // black iron
  glow: '#FFB547',
};

const FUJIN_PALETTE: Palette = {
  primary: '#1E3A5F', // navy
  secondary: '#B9C7D6', // silver
  dark: '#0F1C2E',
  glow: '#25C8D7', // teal
};

class Builder {
  geometries: THREE.BufferGeometry[] = [];
  materials: THREE.Material[] = [];
  glow: THREE.MeshStandardMaterial[] = [];

  mat(color: string, metalness = 0.6, roughness = 0.45): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    this.materials.push(m);
    return m;
  }

  glowMat(color: string, intensity = 1.6, opacity = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      metalness: 0.1,
      roughness: 0.4,
      transparent: opacity < 1,
      opacity,
    });
    this.materials.push(m);
    this.glow.push(m);
    return m;
  }

  mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
  ): THREE.Mesh {
    this.geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position);
    m.rotation.set(...rotation);
    m.scale.set(...scale);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  joint(
    name: JointName,
    parent: THREE.Object3D | null,
    position: [number, number, number],
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...position);
    parent?.add(g);
    return g;
  }
}

function finish(
  b: Builder,
  kind: RobotRig['kind'],
  joints: Record<JointName, THREE.Object3D>,
  backUnit: THREE.Object3D,
  height: number,
  baseGlow: number,
): RobotRig {
  const rest = {} as RobotRig['rest'];
  for (const name of JOINT_NAMES) {
    const j = joints[name];
    rest[name] = { position: j.position.clone(), rotation: j.rotation.clone() };
  }
  return {
    kind,
    root: joints.Root as THREE.Group,
    joints,
    rest,
    backUnit,
    glowMaterials: b.glow,
    baseGlow,
    height,
    dispose() {
      for (const g of b.geometries) g.dispose();
      for (const m of b.materials) m.dispose();
    },
  };
}

/** RAIJIN: heavy, broad, huge fists, thunder-drum ring on the back. */
export function buildRaijin(): RobotRig {
  const b = new Builder();
  const p = RAIJIN_PALETTE;
  const armor = b.mat(p.primary, 0.55, 0.38);
  const gold = b.mat(p.secondary, 0.85, 0.3);
  const iron = b.mat(p.dark, 0.7, 0.55);
  const glow = b.glowMat(p.glow, 1.8);
  const core = b.glowMat('#FFD27A', 2.4);

  const J = {} as Record<JointName, THREE.Object3D>;
  J.Root = b.joint('Root', null, [0, 0, 0]);
  const hipY = 0.85 + 0.85 + 0.25;
  J.Hips = b.joint('Hips', J.Root, [0, hipY, 0]);
  b.mesh(J.Hips, new THREE.BoxGeometry(1.35, 0.45, 0.85), iron);
  b.mesh(J.Hips, new THREE.BoxGeometry(1.42, 0.13, 0.9), gold, [0, 0.12, 0]);
  // Waist tassets (armoured skirt plates)
  for (const x of [-0.45, 0, 0.45]) {
    b.mesh(J.Hips, new THREE.BoxGeometry(0.38, 0.5, 0.08), armor, [x, -0.3, 0.44], [0.15, 0, 0]);
  }

  J.Spine = b.joint('Spine', J.Hips, [0, 0.3, 0]);
  b.mesh(J.Spine, new THREE.BoxGeometry(0.95, 0.45, 0.65), iron, [0, 0.15, 0]);

  J.Chest = b.joint('Chest', J.Spine, [0, 0.4, 0]);
  b.mesh(J.Chest, new THREE.BoxGeometry(1.95, 1.05, 1.15), armor, [0, 0.5, 0]);
  b.mesh(J.Chest, new THREE.BoxGeometry(2.2, 0.32, 1.22), gold, [0, 1.05, 0]);
  b.mesh(J.Chest, new THREE.BoxGeometry(1.1, 0.3, 0.12), iron, [0, 0.12, 0.56]);
  b.mesh(J.Chest, new THREE.SphereGeometry(0.24, 20, 14), core, [0, 0.55, 0.6]);
  b.mesh(J.Chest, new THREE.TorusGeometry(0.3, 0.05, 8, 24), gold, [0, 0.55, 0.6]);
  // Lightning zig-zags on both pectorals
  for (const side of [-1, 1]) {
    const zx = side * 0.62;
    b.mesh(
      J.Chest,
      new THREE.BoxGeometry(0.06, 0.32, 0.04),
      glow,
      [zx, 0.72, 0.59],
      [0, 0, 0.6 * side],
    );
    b.mesh(
      J.Chest,
      new THREE.BoxGeometry(0.06, 0.32, 0.04),
      glow,
      [zx + 0.08 * side, 0.46, 0.59],
      [0, 0, -0.6 * side],
    );
    b.mesh(
      J.Chest,
      new THREE.BoxGeometry(0.06, 0.26, 0.04),
      glow,
      [zx, 0.24, 0.59],
      [0, 0, 0.6 * side],
    );
    // Abstract wave-pattern panels (seigaiha-inspired, simplified)
    b.mesh(J.Chest, new THREE.TorusGeometry(0.16, 0.025, 6, 16, Math.PI), iron, [
      side * 0.35,
      0.86,
      0.585,
    ]);
  }

  // Thunder drum ring (taiko) — signature silhouette
  const back = new THREE.Group();
  back.name = 'BackUnit';
  back.position.set(0, 0.75, -0.8);
  J.Chest.add(back);
  b.mesh(back, new THREE.TorusGeometry(1.3, 0.08, 10, 48), gold);
  b.mesh(back, new THREE.TorusGeometry(1.12, 0.03, 6, 48), glow);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const drum = new THREE.Group();
    drum.position.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
    drum.rotation.z = a;
    back.add(drum);
    b.mesh(
      drum,
      new THREE.CylinderGeometry(0.22, 0.22, 0.26, 16),
      armor,
      [0, 0, 0],
      [0, 0, Math.PI / 2],
    );
    b.mesh(
      drum,
      new THREE.CylinderGeometry(0.17, 0.17, 0.28, 16),
      glow,
      [0, 0, 0],
      [0, 0, Math.PI / 2],
      [1, 1, 1],
    );
  }

  J.Neck = b.joint('Neck', J.Chest, [0, 1.2, 0.05]);
  b.mesh(J.Neck, new THREE.CylinderGeometry(0.2, 0.25, 0.2, 12), iron, [0, 0.05, 0]);
  J.Head = b.joint('Head', J.Neck, [0, 0.15, 0]);
  b.mesh(J.Head, new THREE.BoxGeometry(0.62, 0.5, 0.6), armor, [0, 0.25, 0]);
  b.mesh(J.Head, new THREE.BoxGeometry(0.66, 0.14, 0.64), gold, [0, 0.47, 0]);
  b.mesh(J.Head, new THREE.BoxGeometry(0.5, 0.11, 0.06), core, [0, 0.27, 0.3]);
  b.mesh(J.Head, new THREE.BoxGeometry(0.34, 0.14, 0.1), iron, [0, 0.08, 0.3]);
  for (const side of [-1, 1]) {
    b.mesh(
      J.Head,
      new THREE.ConeGeometry(0.075, 0.5, 8),
      gold,
      [side * 0.27, 0.68, 0.02],
      [0, 0, -0.45 * side],
    );
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const ua = b.joint(`UpperArm_${s}`, J.Chest, [side * 1.22, 0.85, 0]);
    J[`UpperArm_${s}`] = ua;
    b.mesh(
      ua,
      new THREE.SphereGeometry(0.58, 18, 12),
      armor,
      [side * 0.05, 0.05, 0],
      [0, 0, 0],
      [1.1, 0.85, 1],
    );
    b.mesh(
      ua,
      new THREE.TorusGeometry(0.5, 0.05, 6, 24),
      gold,
      [side * 0.05, -0.08, 0],
      [Math.PI / 2, 0, 0],
    );
    b.mesh(ua, new THREE.CylinderGeometry(0.27, 0.3, 0.8, 12), iron, [0, -0.45, 0]);
    const fa = b.joint(`Forearm_${s}`, ua, [0, -0.85, 0]);
    J[`Forearm_${s}`] = fa;
    b.mesh(fa, new THREE.CylinderGeometry(0.38, 0.33, 0.75, 14), armor, [0, -0.36, 0]);
    b.mesh(
      fa,
      new THREE.TorusGeometry(0.37, 0.05, 6, 20),
      gold,
      [0, -0.66, 0],
      [Math.PI / 2, 0, 0],
    );
    b.mesh(fa, new THREE.BoxGeometry(0.06, 0.5, 0.05), glow, [side * 0.37, -0.36, 0]);
    const hand = b.joint(`Hand_${s}`, fa, [0, -0.8, 0]);
    J[`Hand_${s}`] = hand;
    b.mesh(hand, new THREE.BoxGeometry(0.66, 0.62, 0.66), gold, [0, -0.25, 0]);
    b.mesh(hand, new THREE.BoxGeometry(0.68, 0.1, 0.12), glow, [0, -0.15, 0.3]);
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const th = b.joint(`Thigh_${s}`, J.Hips, [side * 0.42, -0.1, 0]);
    J[`Thigh_${s}`] = th;
    b.mesh(th, new THREE.CylinderGeometry(0.34, 0.3, 0.85, 12), iron, [0, -0.42, 0]);
    const sh = b.joint(`Shin_${s}`, th, [0, -0.85, 0]);
    J[`Shin_${s}`] = sh;
    b.mesh(sh, new THREE.SphereGeometry(0.27, 12, 10), armor, [0, 0, 0.12]);
    b.mesh(sh, new THREE.BoxGeometry(0.58, 0.85, 0.62), armor, [0, -0.42, 0]);
    b.mesh(sh, new THREE.BoxGeometry(0.06, 0.55, 0.04), glow, [0, -0.42, 0.32]);
    const ft = b.joint(`Foot_${s}`, sh, [0, -0.85, 0]);
    J[`Foot_${s}`] = ft;
    b.mesh(ft, new THREE.BoxGeometry(0.68, 0.26, 1.0), iron, [0, -0.12, 0.16]);
    b.mesh(ft, new THREE.BoxGeometry(0.7, 0.08, 0.3), gold, [0, -0.02, 0.55]);
  }

  return finish(b, 'raijin', J, back, 4.1, 1.8);
}

/** FUJIN: slim, streamlined, wind-bag arc and blade wings, booster feet. */
export function buildFujin(): RobotRig {
  const b = new Builder();
  const p = FUJIN_PALETTE;
  const navy = b.mat(p.primary, 0.6, 0.35);
  const silver = b.mat(p.secondary, 0.9, 0.22);
  const dark = b.mat(p.dark, 0.7, 0.5);
  const glow = b.glowMat(p.glow, 1.9);
  const veil = b.glowMat('#7FE9F2', 0.9, 0.55);

  const J = {} as Record<JointName, THREE.Object3D>;
  J.Root = b.joint('Root', null, [0, 0, 0]);
  const hipY = 1.0 + 1.0 + 0.2;
  J.Hips = b.joint('Hips', J.Root, [0, hipY, 0]);
  b.mesh(J.Hips, new THREE.CylinderGeometry(0.42, 0.34, 0.38, 8), navy);
  b.mesh(J.Hips, new THREE.BoxGeometry(0.2, 0.55, 0.06), silver, [0, -0.2, 0.33], [0.1, 0, 0]);

  J.Spine = b.joint('Spine', J.Hips, [0, 0.25, 0]);
  b.mesh(J.Spine, new THREE.CylinderGeometry(0.3, 0.36, 0.45, 8), silver, [0, 0.2, 0]);

  J.Chest = b.joint('Chest', J.Spine, [0, 0.42, 0]);
  b.mesh(
    J.Chest,
    new THREE.CylinderGeometry(0.78, 0.42, 1.05, 8),
    navy,
    [0, 0.5, 0],
    [0, Math.PI / 8, 0],
    [1, 1, 0.7],
  );
  b.mesh(J.Chest, new THREE.BoxGeometry(0.9, 0.5, 0.08), silver, [0, 0.72, 0.38], [-0.2, 0, 0]);
  for (const side of [-1, 1]) {
    b.mesh(
      J.Chest,
      new THREE.BoxGeometry(0.05, 0.62, 0.04),
      glow,
      [side * 0.2, 0.45, 0.41],
      [0, 0, 0.42 * side],
    );
  }
  b.mesh(J.Chest, new THREE.OctahedronGeometry(0.17), glow, [0, 0.28, 0.4]);

  // Wind-bag arc (fūtai) + blade wings — signature silhouette
  const back = new THREE.Group();
  back.name = 'BackUnit';
  back.position.set(0, 0.9, -0.55);
  J.Chest.add(back);
  b.mesh(
    back,
    new THREE.TorusGeometry(1.35, 0.14, 10, 56, Math.PI * 1.35),
    veil,
    [0, 0.15, 0],
    [0, 0, -Math.PI * 0.175],
  );
  b.mesh(
    back,
    new THREE.TorusGeometry(1.35, 0.04, 6, 56, Math.PI * 1.35),
    glow,
    [0, 0.15, 0.05],
    [0, 0, -Math.PI * 0.175],
  );
  for (const side of [-1, 1]) {
    b.mesh(
      back,
      new THREE.BoxGeometry(0.08, 1.7, 0.38),
      silver,
      [side * 0.45, -0.35, -0.1],
      [0.3, 0, side * 0.7],
    );
    b.mesh(
      back,
      new THREE.BoxGeometry(0.03, 1.6, 0.06),
      glow,
      [side * 0.5, -0.33, 0.05],
      [0.3, 0, side * 0.7],
    );
  }

  J.Neck = b.joint('Neck', J.Chest, [0, 1.1, 0.02]);
  b.mesh(J.Neck, new THREE.CylinderGeometry(0.12, 0.16, 0.22, 8), dark, [0, 0.05, 0]);
  J.Head = b.joint('Head', J.Neck, [0, 0.16, 0]);
  b.mesh(
    J.Head,
    new THREE.IcosahedronGeometry(0.3, 1),
    silver,
    [0, 0.22, 0],
    [0, 0, 0],
    [0.85, 1, 1.1],
  );
  b.mesh(J.Head, new THREE.BoxGeometry(0.42, 0.08, 0.1), glow, [0, 0.24, 0.27]);
  b.mesh(J.Head, new THREE.BoxGeometry(0.04, 0.32, 0.6), navy, [0, 0.5, -0.05], [-0.5, 0, 0]);

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const ua = b.joint(`UpperArm_${s}`, J.Chest, [side * 0.9, 0.85, 0]);
    J[`UpperArm_${s}`] = ua;
    b.mesh(
      ua,
      new THREE.ConeGeometry(0.3, 0.7, 4),
      silver,
      [side * 0.22, 0.08, 0],
      [0, 0, (-side * Math.PI) / 2],
    );
    b.mesh(ua, new THREE.CylinderGeometry(0.14, 0.12, 0.85, 8), navy, [0, -0.45, 0]);
    const fa = b.joint(`Forearm_${s}`, ua, [0, -0.9, 0]);
    J[`Forearm_${s}`] = fa;
    b.mesh(fa, new THREE.CylinderGeometry(0.16, 0.11, 0.8, 8), silver, [0, -0.38, 0]);
    // Wind blade fin
    b.mesh(fa, new THREE.BoxGeometry(0.04, 0.75, 0.32), navy, [side * 0.16, -0.36, -0.04]);
    b.mesh(fa, new THREE.BoxGeometry(0.03, 0.7, 0.04), glow, [side * 0.19, -0.36, 0.13]);
    const hand = b.joint(`Hand_${s}`, fa, [0, -0.82, 0]);
    J[`Hand_${s}`] = hand;
    b.mesh(hand, new THREE.BoxGeometry(0.24, 0.3, 0.24), dark, [0, -0.12, 0]);
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const th = b.joint(`Thigh_${s}`, J.Hips, [side * 0.28, -0.08, 0]);
    J[`Thigh_${s}`] = th;
    b.mesh(th, new THREE.CylinderGeometry(0.21, 0.15, 1.0, 8), navy, [0, -0.5, 0]);
    const sh = b.joint(`Shin_${s}`, th, [0, -1.0, 0]);
    J[`Shin_${s}`] = sh;
    b.mesh(sh, new THREE.CylinderGeometry(0.17, 0.12, 1.0, 8), silver, [0, -0.5, 0]);
    b.mesh(sh, new THREE.BoxGeometry(0.04, 0.7, 0.04), glow, [0, -0.5, 0.16]);
    const ft = b.joint(`Foot_${s}`, sh, [0, -1.0, 0]);
    J[`Foot_${s}`] = ft;
    b.mesh(
      ft,
      new THREE.ConeGeometry(0.16, 0.7, 4),
      dark,
      [0, -0.12, 0.2],
      [Math.PI / 2, Math.PI / 4, 0],
    );
    b.mesh(
      ft,
      new THREE.CylinderGeometry(0.1, 0.14, 0.2, 10),
      silver,
      [0, -0.08, -0.18],
      [Math.PI / 2, 0, 0],
    );
    b.mesh(ft, new THREE.CircleGeometry(0.09, 12), glow, [0, -0.08, -0.29], [0, Math.PI, 0]);
  }

  return finish(b, 'fujin', J, back, 4.3, 1.9);
}
