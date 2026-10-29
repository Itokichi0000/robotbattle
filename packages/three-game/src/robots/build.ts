import * as THREE from 'three';

/**
 * Procedural stand-in robots, built from three.js primitives so the arena works
 * without any external assets. Both rigs share the same joint names as the
 * Blender skeleton spec (docs/ART_PIPELINE.md), so GLB models can replace them.
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

export interface RobotRig {
  kind: 'raijin' | 'fujin';
  root: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  rest: Record<JointName, { position: THREE.Vector3; rotation: THREE.Euler }>;
  /** Signature back unit (drum ring / wind bags); spun during specials. */
  backUnit: THREE.Object3D;
  /** Emissive materials whose intensity tracks energy / effects. */
  glowMaterials: THREE.MeshStandardMaterial[];
  baseGlow: number;
  height: number;
  /**
   * Damage stages (spec D1: cracks that show the inner light, plates that
   * open — never red paint). Hidden until the robot's hull drops.
   */
  damage: { 1: THREE.Object3D[]; 2: THREE.Object3D[] };
  dispose(): void;
}

/** 0 above 70% hull, 1 above 40%, 2 below. */
export function damageStageFor(health: number): 0 | 1 | 2 {
  return health < 40 ? 2 : health < 70 ? 1 : 0;
}

export function setDamageStage(rig: RobotRig, stage: 0 | 1 | 2): void {
  for (const o of rig.damage[1]) o.visible = stage >= 1;
  for (const o of rig.damage[2]) o.visible = stage >= 2;
}

/**
 * Crack lines on the chest (stage 1), then a lifted chest plate with light
 * leaking out and cracks on the upper arms (stage 2). Built from thin boxes in
 * the robot's own energy colour.
 */
function addDamage(
  b: Builder,
  joints: Record<JointName, THREE.Object3D>,
  o: { chestY: number; frontZ: number; halfWidth: number; color: string },
): RobotRig['damage'] {
  const light = b.glowMat(o.color, 2.6);
  // Not part of the energy glow: damage light does not pulse with attacks.
  b.glow.splice(b.glow.indexOf(light), 1);
  const plate = b.mat('#1A1D24', 0.6, 0.7);
  const crack = (parent: THREE.Object3D, x: number, y: number, z: number, angle: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.z = angle;
    parent.add(g);
    // a jagged line: three short segments
    b.mesh(g, new THREE.BoxGeometry(0.04, 0.22, 0.03), light, [0, 0.1, 0], [0, 0, 0.5]);
    b.mesh(g, new THREE.BoxGeometry(0.04, 0.2, 0.03), light, [0.05, -0.08, 0], [0, 0, -0.4]);
    b.mesh(g, new THREE.BoxGeometry(0.035, 0.14, 0.03), light, [0.02, -0.24, 0], [0, 0, 0.35]);
    g.visible = false;
    return g;
  };
  const w = o.halfWidth;
  const stage1 = [
    crack(joints.Chest, -w * 0.45, o.chestY + 0.15, o.frontZ, 0.3),
    crack(joints.Chest, w * 0.5, o.chestY - 0.1, o.frontZ, -0.5),
  ];
  const lifted = new THREE.Group();
  lifted.visible = false;
  joints.Chest.add(lifted);
  b.mesh(
    lifted,
    new THREE.BoxGeometry(w * 0.7, 0.28, 0.05),
    plate,
    [w * 0.25, o.chestY + 0.35, o.frontZ + 0.1],
    [-0.45, 0, 0.12],
  );
  b.mesh(lifted, new THREE.BoxGeometry(w * 0.66, 0.08, 0.02), light, [
    w * 0.25,
    o.chestY + 0.27,
    o.frontZ + 0.02,
  ]);
  const stage2 = [
    lifted,
    crack(joints.Chest, 0, o.chestY - 0.3, o.frontZ, 0.1),
    crack(joints.UpperArm_L, 0.05, -0.2, 0.28, 0.4),
    crack(joints.UpperArm_R, -0.05, -0.2, 0.28, -0.4),
  ];
  return { 1: stage1, 2: stage2 };
}

/**
 * Surface families (spec 3.3.1): painted armour, bare metal frame, rubber and
 * cables, emissive glass. Glow lives only on the core, weapons and thrusters.
 */
interface Palette {
  /** Painted armour. */
  paint: string;
  /** Second paint (trim, crests). */
  trim: string;
  /** Bare metal frame and joints. */
  frame: string;
  glow: string;
  core: string;
}

const RAIJIN_PALETTE: Palette = {
  paint: '#C8681A', // burnt amber armour
  trim: '#8C6A2E', // dark bronze
  frame: '#3A4048', // gunmetal
  glow: '#FFB547',
  core: '#FFD27A',
};

const FUJIN_PALETTE: Palette = {
  paint: '#1D3554', // deep navy armour
  trim: '#A9B8C8', // brushed silver paint
  frame: '#323A44',
  glow: '#25C8D7', // teal
  core: '#9BF3FA',
};

class Builder {
  geometries: THREE.BufferGeometry[] = [];
  materials: THREE.Material[] = [];
  glow: THREE.MeshStandardMaterial[] = [];

  mat(color: string, metalness = 0.6, roughness = 0.45): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });
    this.materials.push(m);
    return m;
  }

  /** Satin paint over metal: a little clear coat, faceted so plate edges read. */
  paint(color: string, roughness = 0.48): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.3,
      roughness,
      clearcoat: 0.35,
      clearcoatRoughness: 0.45,
      flatShading: true,
    });
    this.materials.push(m);
    return m;
  }

  /** Bare machined metal (frame, joints, pistons). */
  metal(color: string, roughness = 0.32): THREE.MeshStandardMaterial {
    return this.mat(color, 0.92, roughness);
  }

  /** Rubber boots and cable bundles: no shine at all. */
  rubber(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: '#121417', metalness: 0, roughness: 0.92 });
    this.materials.push(m);
    return m;
  }

  /**
   * Emissive material. `scale` sets this part's share of the robot's glow
   * (the animation drives one level for all of them): the core runs hotter
   * than a weapon slit.
   */
  glowMat(color: string, intensity = 1.6, opacity = 1, scale = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      metalness: 0,
      roughness: 0.15,
      transparent: opacity < 1,
      opacity,
    });
    m.userData.glowScale = scale;
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

  /** An armour plate (see plateGeometry) placed on a joint. */
  plate(
    parent: THREE.Object3D,
    size: [number, number, number],
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    opts: PlateOptions = {},
  ): THREE.Mesh {
    return this.mesh(parent, plateGeometry(...size, opts), material, position, rotation);
  }

  /** A faceted cylinder (frame members, pistons): 6–8 sides read as machined. */
  rod(
    parent: THREE.Object3D,
    r: [number, number],
    h: number,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    sides = 8,
  ): THREE.Mesh {
    return this.mesh(
      parent,
      new THREE.CylinderGeometry(r[0], r[1], h, sides),
      material,
      position,
      rotation,
    );
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

interface PlateOptions {
  /** 45° corner cut in the plate's outline (default: 18% of the short side). */
  cut?: number;
  /** >0 narrows the top edge, <0 widens it (fraction of the half width). */
  taper?: number;
  /** Edge chamfer on the faces (catches the rim light). */
  bevel?: number;
}

/**
 * Hard-surface armour plate: an outline with 45° cut corners (optionally
 * tapered), extruded `d` deep along z with chamfered edges, centred.
 */
export function plateGeometry(
  w: number,
  h: number,
  d: number,
  { cut, taper = 0, bevel }: PlateOptions = {},
): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const tw = hw * (1 - taper);
  const c = Math.min(cut ?? Math.min(w, h) * 0.18, hw * 0.9, tw * 0.9, hh * 0.9);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - c, -hh);
  shape.lineTo(hw, -hh + c);
  shape.lineTo(tw, hh - c);
  shape.lineTo(tw - c, hh);
  shape.lineTo(-tw + c, hh);
  shape.lineTo(-tw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();
  const bv = bevel ?? Math.min(0.035, d * 0.2, c * 0.5);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bv * 2),
    bevelEnabled: bv > 0,
    bevelThickness: bv,
    bevelSize: bv,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(d - bv * 2) / 2);
  return g;
}

function finish(
  b: Builder,
  kind: RobotRig['kind'],
  joints: Record<JointName, THREE.Object3D>,
  backUnit: THREE.Object3D,
  height: number,
  baseGlow: number,
  damage: RobotRig['damage'],
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
    damage,
    dispose() {
      for (const g of b.geometries) g.dispose();
      for (const m of b.materials) m.dispose();
    },
  };
}

/**
 * RAIJIN: heavy assault frame. Broad layered pauldrons, armoured gauntlets
 * for the thunder fists, a shoulder cannon (the gunner station's weapon) and
 * the taiko drum ring on its back. Planted on wide sabatons.
 */
export function buildRaijin(): RobotRig {
  const b = new Builder();
  const p = RAIJIN_PALETTE;
  const paint = b.paint(p.paint);
  const trim = b.paint(p.trim, 0.36);
  const frame = b.metal(p.frame);
  const steel = b.metal('#5A626B', 0.26);
  const rubber = b.rubber();
  const glow = b.glowMat(p.glow, 1.8, 1, 0.8);
  const core = b.glowMat(p.core, 2.4, 1, 1.25);

  const J = {} as Record<JointName, THREE.Object3D>;
  J.Root = b.joint('Root', null, [0, 0, 0]);
  const hipY = 0.85 + 0.85 + 0.25;
  J.Hips = b.joint('Hips', J.Root, [0, hipY, 0]);
  b.plate(J.Hips, [1.2, 0.42, 0.78], frame);
  b.plate(J.Hips, [1.38, 0.16, 0.9], paint, [0, 0.17, 0], [0, 0, 0], { cut: 0.05 });
  // Tassets: front, flanks, rear.
  b.plate(J.Hips, [0.46, 0.52, 0.1], paint, [0, -0.3, 0.44], [0.14, 0, 0], { taper: -0.15 });
  b.plate(J.Hips, [0.5, 0.12, 0.12], trim, [0, -0.04, 0.47], [0.14, 0, 0], { cut: 0.03 });
  for (const side of [-1, 1]) {
    b.plate(
      J.Hips,
      [0.52, 0.62, 0.1],
      paint,
      [side * 0.7, -0.26, 0.06],
      [0, side * 1.3, side * 0.16],
      {
        taper: -0.12,
      },
    );
  }
  b.plate(J.Hips, [0.96, 0.44, 0.1], paint, [0, -0.22, -0.42], [-0.16, 0, 0]);

  J.Spine = b.joint('Spine', J.Hips, [0, 0.3, 0]);
  b.rod(J.Spine, [0.4, 0.44], 0.5, frame, [0, 0.15, 0]);
  for (const y of [0.04, 0.24])
    b.plate(J.Spine, [0.66, 0.17, 0.14], paint, [0, y, 0.4], [0, 0, 0], { cut: 0.05 });
  for (const side of [-1, 1])
    b.rod(J.Spine, [0.05, 0.05], 0.55, rubber, [side * 0.36, 0.18, -0.24], [0.15, 0, 0], 6);

  J.Chest = b.joint('Chest', J.Spine, [0, 0.4, 0]);
  b.plate(J.Chest, [1.6, 1.0, 1.0], frame, [0, 0.5, -0.05]);
  // Breastplate wider at the top: the heavy V of a brawler.
  b.plate(J.Chest, [1.86, 0.98, 0.46], paint, [0, 0.55, 0.32], [0, 0, 0], {
    taper: -0.16,
    cut: 0.22,
  });
  b.plate(J.Chest, [1.32, 0.3, 0.92], trim, [0, 1.09, 0], [0, 0, 0], { cut: 0.08 });
  b.plate(J.Chest, [1.8, 0.92, 0.42], paint, [0, 0.62, -0.46], [0, 0, 0], { taper: -0.1 });
  // Intake louvres on both pectorals (bare metal).
  for (const side of [-1, 1])
    for (let i = 0; i < 3; i++)
      b.plate(
        J.Chest,
        [0.42, 0.045, 0.08],
        steel,
        [side * 0.56, 0.24 + i * 0.1, 0.57],
        [0.3, 0, 0],
        {
          cut: 0.01,
          bevel: 0.005,
        },
      );
  // Engraved lightning on the plate (bronze, not lit).
  for (const side of [-1, 1]) {
    b.plate(J.Chest, [0.05, 0.3, 0.04], trim, [side * 0.42, 0.78, 0.57], [0, 0, 0.55 * side], {
      cut: 0.01,
    });
    b.plate(J.Chest, [0.05, 0.26, 0.04], trim, [side * 0.48, 0.56, 0.57], [0, 0, -0.55 * side], {
      cut: 0.01,
    });
  }
  // The reactor core: a recessed lens in a machined collar.
  b.rod(J.Chest, [0.27, 0.27], 0.12, steel, [0, 0.62, 0.56], [Math.PI / 2, 0, 0], 12);
  b.mesh(
    J.Chest,
    new THREE.SphereGeometry(0.18, 20, 12),
    core,
    [0, 0.62, 0.6],
    [0, 0, 0],
    [1, 1, 0.55],
  );

  // Thunder drum ring (taiko): bronze ring, iron drums, lit drum heads only.
  const back = new THREE.Group();
  back.name = 'BackUnit';
  back.position.set(0, 0.75, -0.82);
  J.Chest.add(back);
  b.mesh(back, new THREE.TorusGeometry(1.3, 0.075, 6, 48), trim);
  b.mesh(back, new THREE.TorusGeometry(1.12, 0.02, 4, 48), glow);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const drum = new THREE.Group();
    drum.position.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
    drum.rotation.z = a;
    back.add(drum);
    b.rod(drum, [0.21, 0.21], 0.26, frame, [0, 0, 0], [Math.PI / 2, 0, 0], 10);
    b.rod(drum, [0.15, 0.15], 0.28, glow, [0, 0, 0], [Math.PI / 2, 0, 0], 10);
  }
  // Back thrusters.
  for (const side of [-1, 1]) {
    b.plate(J.Chest, [0.36, 0.5, 0.3], frame, [side * 0.46, 0.38, -0.72]);
    b.rod(J.Chest, [0.13, 0.16], 0.18, steel, [side * 0.46, 0.1, -0.74], [0, 0, 0], 10);
    b.mesh(
      J.Chest,
      new THREE.CircleGeometry(0.1, 12),
      glow,
      [side * 0.46, 0.0, -0.74],
      [Math.PI / 2, 0, 0],
    );
  }
  // Shoulder cannon over the right shoulder: the gunner's weapon.
  const gun = new THREE.Group();
  gun.name = 'Cannon';
  gun.position.set(-0.78, 1.22, -0.34);
  J.Chest.add(gun);
  b.plate(gun, [0.38, 0.34, 0.8], paint, [0, 0, -0.05], [0, 0, 0], { cut: 0.08 });
  b.plate(gun, [0.42, 0.08, 0.84], trim, [0, 0.2, -0.05], [0, 0, 0], { cut: 0.03 });
  b.rod(gun, [0.09, 0.11], 1.25, steel, [0, 0.02, 0.85], [Math.PI / 2, 0, 0], 10);
  b.rod(gun, [0.15, 0.15], 0.2, frame, [0, 0.02, 1.4], [Math.PI / 2, 0, 0], 8);
  b.mesh(gun, new THREE.TorusGeometry(0.1, 0.022, 6, 16), glow, [0, 0.02, 1.51]);
  b.rod(gun, [0.07, 0.07], 0.5, rubber, [0.14, -0.2, -0.2], [0.6, 0, 0], 6);

  J.Neck = b.joint('Neck', J.Chest, [0, 1.2, 0.05]);
  b.rod(J.Neck, [0.18, 0.24], 0.22, rubber, [0, 0.05, 0], [0, 0, 0], 10);
  J.Head = b.joint('Head', J.Neck, [0, 0.15, 0]);
  b.plate(J.Head, [0.58, 0.46, 0.6], paint, [0, 0.26, -0.02], [0, 0, 0], {
    cut: 0.14,
    taper: 0.12,
  });
  b.plate(J.Head, [0.46, 0.22, 0.14], frame, [0, 0.14, 0.27], [0, 0, 0], { cut: 0.06 });
  b.mesh(J.Head, new THREE.BoxGeometry(0.42, 0.055, 0.04), core, [0, 0.3, 0.29]);
  for (const side of [-1, 1]) {
    b.plate(J.Head, [0.13, 0.32, 0.42], paint, [side * 0.31, 0.17, 0.04], [0, 0, side * 0.08], {
      cut: 0.05,
    });
    // Kabuto-like crest blades, swept back.
    b.plate(J.Head, [0.07, 0.52, 0.05], trim, [side * 0.13, 0.66, 0.2], [-0.35, 0, -0.42 * side], {
      cut: 0.03,
      taper: 0.7,
    });
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const ua = b.joint(`UpperArm_${s}`, J.Chest, [side * 1.22, 0.85, 0]);
    J[`UpperArm_${s}`] = ua;
    b.mesh(ua, new THREE.SphereGeometry(0.3, 12, 8), frame);
    // Layered pauldron.
    b.plate(ua, [0.96, 0.74, 0.92], paint, [side * 0.12, 0.1, 0], [0, 0, side * -0.22], {
      cut: 0.24,
    });
    b.plate(ua, [0.82, 0.22, 0.98], paint, [side * 0.2, 0.5, 0], [0, 0, side * -0.36], {
      cut: 0.07,
    });
    b.plate(ua, [0.92, 0.08, 0.98], trim, [side * 0.22, -0.27, 0], [0, 0, side * -0.22], {
      cut: 0.03,
    });
    b.rod(ua, [0.23, 0.25], 0.72, frame, [0, -0.5, 0]);
    b.plate(ua, [0.5, 0.48, 0.54], paint, [side * 0.03, -0.52, 0], [0, 0, 0], { cut: 0.1 });
    const fa = b.joint(`Forearm_${s}`, ua, [0, -0.85, 0]);
    J[`Forearm_${s}`] = fa;
    b.rod(fa, [0.21, 0.21], 0.52, steel, [0, 0, 0], [0, 0, Math.PI / 2], 10);
    // Gauntlet, flaring toward the wrist.
    b.plate(fa, [0.72, 0.74, 0.74], paint, [0, -0.4, 0], [0, 0, 0], { taper: -0.14, cut: 0.14 });
    b.plate(fa, [0.78, 0.09, 0.8], trim, [0, -0.73, 0], [0, 0, 0], { cut: 0.03 });
    b.rod(fa, [0.05, 0.05], 0.56, steel, [side * 0.34, -0.36, -0.2], [0, 0, 0], 6);
    const hand = b.joint(`Hand_${s}`, fa, [0, -0.8, 0]);
    J[`Hand_${s}`] = hand;
    b.rod(hand, [0.19, 0.19], 0.14, steel, [0, -0.02, 0], [0, 0, 0], 10);
    b.plate(hand, [0.56, 0.5, 0.56], frame, [0, -0.28, 0], [0, 0, 0], { cut: 0.1 });
    b.plate(hand, [0.62, 0.22, 0.26], paint, [0, -0.34, 0.2], [0, 0, 0], { cut: 0.06 });
    b.mesh(hand, new THREE.BoxGeometry(0.5, 0.04, 0.03), glow, [0, -0.3, 0.34]);
    for (let i = 0; i < 4; i++)
      b.plate(hand, [0.12, 0.17, 0.2], steel, [-0.19 + i * 0.127, -0.54, 0.12], [0.4, 0, 0], {
        cut: 0.03,
        bevel: 0.01,
      });
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const th = b.joint(`Thigh_${s}`, J.Hips, [side * 0.42, -0.1, 0]);
    J[`Thigh_${s}`] = th;
    b.mesh(th, new THREE.SphereGeometry(0.25, 12, 8), frame);
    b.rod(th, [0.24, 0.22], 0.8, frame, [0, -0.42, 0]);
    b.plate(th, [0.56, 0.64, 0.52], paint, [side * 0.04, -0.4, 0.05], [0, 0, 0], {
      taper: -0.1,
      cut: 0.12,
    });
    const sh = b.joint(`Shin_${s}`, th, [0, -0.85, 0]);
    J[`Shin_${s}`] = sh;
    b.rod(sh, [0.2, 0.2], 0.48, steel, [0, 0, 0], [0, 0, Math.PI / 2], 10);
    b.rod(sh, [0.19, 0.17], 0.85, frame, [0, -0.42, -0.02]);
    b.rod(sh, [0.055, 0.055], 0.6, steel, [0, -0.45, -0.26], [0, 0, 0], 6);
    // Greave flaring to the ankle, knee cap over it.
    b.plate(sh, [0.62, 0.8, 0.52], paint, [0, -0.46, 0.08], [0, 0, 0], { taper: 0.14, cut: 0.14 });
    b.plate(sh, [0.46, 0.38, 0.22], paint, [0, -0.02, 0.3], [0.25, 0, 0], { cut: 0.1 });
    b.plate(sh, [0.5, 0.07, 0.56], trim, [0, -0.8, 0.08], [0, 0, 0], { cut: 0.02 });
    const ft = b.joint(`Foot_${s}`, sh, [0, -0.85, 0]);
    J[`Foot_${s}`] = ft;
    // Sabaton: the sole sits exactly on the stage (foot joint is 0.15 up).
    b.rod(ft, [0.17, 0.17], 0.46, steel, [0, 0.1, 0], [0, 0, Math.PI / 2], 10);
    b.plate(ft, [0.8, 1.15, 0.12], rubber, [0, -0.09, 0.12], [-Math.PI / 2, 0, 0], { cut: 0.16 });
    b.plate(ft, [0.66, 0.5, 0.3], paint, [0, 0.06, 0.28], [-0.55, 0, 0], { cut: 0.12 });
    b.plate(ft, [0.72, 0.18, 0.26], frame, [0, -0.0, 0.6], [0, 0, 0], { cut: 0.05 });
    b.plate(ft, [0.5, 0.22, 0.26], frame, [0, 0.0, -0.36], [0, 0, 0], { cut: 0.05 });
  }

  const damage = addDamage(b, J, { chestY: 0.5, frontZ: 0.6, halfWidth: 0.95, color: '#FFC46B' });
  return finish(b, 'raijin', J, back, 4.1, 1.8, damage);
}

/**
 * FUJIN: light interceptor. Slim armour, swept fins, forearm shield emitters
 * (the guardian station's barrier), the wind-veil arc and blade wings, heel
 * thrusters (it hovers).
 */
export function buildFujin(): RobotRig {
  const b = new Builder();
  const p = FUJIN_PALETTE;
  const navy = b.paint(p.paint, 0.42);
  const silver = b.paint(p.trim, 0.3);
  const frame = b.metal(p.frame);
  const steel = b.metal('#6A737D', 0.24);
  const rubber = b.rubber();
  const glow = b.glowMat(p.glow, 1.9, 1, 0.85);
  const core = b.glowMat(p.core, 2.4, 1, 1.2);
  const veil = b.glowMat('#7FE9F2', 0.9, 0.35, 0.35);

  const J = {} as Record<JointName, THREE.Object3D>;
  J.Root = b.joint('Root', null, [0, 0, 0]);
  const hipY = 1.0 + 1.0 + 0.2;
  J.Hips = b.joint('Hips', J.Root, [0, hipY, 0]);
  b.rod(J.Hips, [0.4, 0.32], 0.36, frame);
  b.plate(J.Hips, [0.26, 0.52, 0.07], silver, [0, -0.22, 0.33], [0.16, 0, 0], {
    taper: -0.2,
    cut: 0.08,
  });
  for (const side of [-1, 1])
    b.plate(J.Hips, [0.08, 0.62, 0.42], navy, [side * 0.42, -0.22, 0], [0, 0, side * 0.2], {
      cut: 0.14,
    });
  b.plate(J.Hips, [0.56, 0.36, 0.07], navy, [0, -0.18, -0.32], [-0.2, 0, 0], { taper: 0.2 });

  J.Spine = b.joint('Spine', J.Hips, [0, 0.25, 0]);
  b.rod(J.Spine, [0.28, 0.34], 0.45, frame, [0, 0.2, 0]);
  for (const side of [-1, 1])
    b.rod(J.Spine, [0.04, 0.04], 0.5, rubber, [side * 0.24, 0.2, -0.2], [0.1, 0, 0], 6);
  b.plate(J.Spine, [0.42, 0.26, 0.1], navy, [0, 0.2, 0.3], [0, 0, 0], { cut: 0.06 });

  J.Chest = b.joint('Chest', J.Spine, [0, 0.42, 0]);
  b.mesh(
    J.Chest,
    new THREE.CylinderGeometry(0.62, 0.38, 1.0, 8),
    frame,
    [0, 0.5, 0],
    [0, Math.PI / 8, 0],
    [1, 1, 0.7],
  );
  // Streamlined breastplate, wide shoulders narrowing to the waist.
  b.plate(J.Chest, [1.34, 0.86, 0.36], navy, [0, 0.6, 0.2], [0, 0, 0], { taper: -0.32, cut: 0.24 });
  b.plate(J.Chest, [0.96, 0.2, 0.7], silver, [0, 1.03, 0], [0, 0, 0], { cut: 0.06 });
  for (const side of [-1, 1])
    b.plate(J.Chest, [0.07, 0.56, 0.05], silver, [side * 0.2, 0.55, 0.39], [0, 0, 0.4 * side], {
      cut: 0.02,
    });
  b.plate(J.Chest, [1.1, 0.8, 0.3], navy, [0, 0.62, -0.28], [0, 0, 0], { taper: -0.2 });
  // Core crystal.
  b.rod(J.Chest, [0.16, 0.16], 0.08, steel, [0, 0.36, 0.37], [Math.PI / 2, 0, 0], 8);
  b.mesh(J.Chest, new THREE.OctahedronGeometry(0.13), core, [0, 0.36, 0.42]);

  // Wind-veil arc (fūtai): a silver hoop carrying a faint membrane, plus blade wings.
  const back = new THREE.Group();
  back.name = 'BackUnit';
  back.position.set(0, 0.9, -0.55);
  J.Chest.add(back);
  b.mesh(
    back,
    new THREE.TorusGeometry(1.35, 0.055, 6, 56, Math.PI * 1.35),
    steel,
    [0, 0.15, 0],
    [0, 0, -Math.PI * 0.175],
  );
  b.mesh(
    back,
    new THREE.TorusGeometry(1.35, 0.15, 8, 56, Math.PI * 1.35),
    veil,
    [0, 0.15, -0.02],
    [0, 0, -Math.PI * 0.175],
  );
  b.mesh(
    back,
    new THREE.TorusGeometry(1.35, 0.018, 4, 56, Math.PI * 1.35),
    glow,
    [0, 0.15, 0.06],
    [0, 0, -Math.PI * 0.175],
  );
  for (const side of [-1, 1]) {
    b.plate(back, [0.34, 1.7, 0.06], silver, [side * 0.45, -0.35, -0.1], [0.3, 0, side * 0.7], {
      cut: 0.16,
      taper: 0.5,
    });
    b.mesh(
      back,
      new THREE.BoxGeometry(0.025, 1.4, 0.03),
      glow,
      [side * 0.42, -0.3, -0.05],
      [0.3, 0, side * 0.7],
    );
    b.rod(back, [0.09, 0.12], 0.22, steel, [side * 0.26, -0.55, 0.12], [0, 0, 0], 10);
    b.mesh(
      back,
      new THREE.CircleGeometry(0.08, 12),
      glow,
      [side * 0.26, -0.67, 0.12],
      [Math.PI / 2, 0, 0],
    );
  }

  J.Neck = b.joint('Neck', J.Chest, [0, 1.1, 0.02]);
  b.rod(J.Neck, [0.11, 0.15], 0.22, rubber, [0, 0.05, 0], [0, 0, 0], 8);
  J.Head = b.joint('Head', J.Neck, [0, 0.16, 0]);
  b.plate(J.Head, [0.38, 0.4, 0.5], silver, [0, 0.22, -0.02], [0, 0, 0], {
    cut: 0.12,
    taper: 0.22,
  });
  b.plate(J.Head, [0.3, 0.16, 0.1], navy, [0, 0.12, 0.23], [0, 0, 0], { cut: 0.05 });
  for (const side of [-1, 1])
    b.mesh(
      J.Head,
      new THREE.BoxGeometry(0.17, 0.035, 0.03),
      core,
      [side * 0.075, 0.26, 0.25],
      [0, 0, side * 0.32],
    );
  b.plate(J.Head, [0.05, 0.44, 0.52], navy, [0, 0.5, -0.08], [-0.45, 0, 0], {
    cut: 0.16,
    taper: 0.5,
  });

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const ua = b.joint(`UpperArm_${s}`, J.Chest, [side * 0.9, 0.85, 0]);
    J[`UpperArm_${s}`] = ua;
    b.mesh(ua, new THREE.SphereGeometry(0.17, 10, 8), frame);
    b.plate(ua, [0.58, 0.32, 0.62], silver, [side * 0.18, 0.12, 0], [0, 0, side * -0.34], {
      cut: 0.14,
      taper: 0.25,
    });
    b.plate(ua, [0.52, 0.09, 0.52], navy, [side * 0.24, 0.33, 0], [0, 0, side * -0.55], {
      cut: 0.04,
    });
    b.rod(ua, [0.12, 0.11], 0.8, frame, [0, -0.45, 0]);
    b.plate(ua, [0.28, 0.5, 0.3], navy, [0, -0.48, 0], [0, 0, 0], { cut: 0.07 });
    const fa = b.joint(`Forearm_${s}`, ua, [0, -0.9, 0]);
    J[`Forearm_${s}`] = fa;
    b.rod(fa, [0.12, 0.12], 0.3, steel, [0, 0, 0], [0, 0, Math.PI / 2], 8);
    b.plate(fa, [0.3, 0.7, 0.32], silver, [0, -0.38, 0], [0, 0, 0], { taper: -0.15, cut: 0.08 });
    // Shield emitter fin: the barrier projects from its lit edge.
    b.plate(fa, [0.06, 0.8, 0.42], navy, [side * 0.18, -0.36, -0.02], [0, 0, 0], { cut: 0.16 });
    b.mesh(fa, new THREE.BoxGeometry(0.03, 0.6, 0.035), glow, [side * 0.215, -0.36, 0.17]);
    const hand = b.joint(`Hand_${s}`, fa, [0, -0.82, 0]);
    J[`Hand_${s}`] = hand;
    b.plate(hand, [0.22, 0.28, 0.22], frame, [0, -0.12, 0], [0, 0, 0], { cut: 0.05 });
    b.plate(hand, [0.2, 0.12, 0.16], steel, [0, -0.3, 0.04], [0.3, 0, 0], { cut: 0.03 });
  }

  for (const side of [-1, 1] as const) {
    const s = side === 1 ? 'L' : 'R';
    const th = b.joint(`Thigh_${s}`, J.Hips, [side * 0.28, -0.08, 0]);
    J[`Thigh_${s}`] = th;
    b.mesh(th, new THREE.SphereGeometry(0.16, 10, 8), frame);
    b.rod(th, [0.15, 0.13], 1.0, frame, [0, -0.5, 0]);
    b.plate(th, [0.34, 0.62, 0.36], navy, [side * 0.03, -0.45, 0.03], [0, 0, 0], {
      taper: -0.18,
      cut: 0.08,
    });
    const sh = b.joint(`Shin_${s}`, th, [0, -1.0, 0]);
    J[`Shin_${s}`] = sh;
    b.rod(sh, [0.13, 0.13], 0.3, steel, [0, 0, 0], [0, 0, Math.PI / 2], 8);
    b.rod(sh, [0.12, 0.1], 1.0, frame, [0, -0.5, 0], [0, 0, 0], 6);
    b.plate(sh, [0.32, 0.86, 0.36], navy, [0, -0.52, 0.05], [0, 0, 0], { taper: -0.2, cut: 0.1 });
    b.plate(sh, [0.08, 0.44, 0.36], silver, [0, 0.04, 0.17], [0.5, 0, 0], { cut: 0.12 });
    const ft = b.joint(`Foot_${s}`, sh, [0, -1.0, 0]);
    J[`Foot_${s}`] = ft;
    b.mesh(ft, new THREE.SphereGeometry(0.11, 10, 8), steel);
    b.plate(ft, [0.3, 0.78, 0.14], navy, [0, -0.08, 0.2], [-Math.PI / 2, 0, 0], { cut: 0.13 });
    b.plate(ft, [0.18, 0.2, 0.12], silver, [0, -0.04, 0.55], [-Math.PI / 2, 0, 0], { cut: 0.07 });
    b.rod(ft, [0.1, 0.14], 0.22, steel, [0, -0.04, -0.2], [Math.PI / 2, 0, 0], 10);
    b.mesh(ft, new THREE.CircleGeometry(0.09, 12), glow, [0, -0.04, -0.315], [0, Math.PI, 0]);
  }

  const damage = addDamage(b, J, { chestY: 0.5, frontZ: 0.43, halfWidth: 0.6, color: '#8BEAF2' });
  return finish(b, 'fujin', J, back, 4.3, 1.9, damage);
}
