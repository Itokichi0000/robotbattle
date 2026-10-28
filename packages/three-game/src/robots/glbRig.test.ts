import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CLIP_DURATION, CLIP_NAMES } from '../director';
import { applyClip } from './animate';
import { buildFujin, buildRaijin, JOINT_NAMES, type RobotRig } from './build';
import { rigFromScene } from './glbRig';

const ALL = [...JOINT_NAMES, 'BackUnit'] as const;

/**
 * A skeleton with the same joint positions as `rig` but where every joint has an arbitrary
 * rest orientation (like Blender bones pointing along the limbs). Each joint carries a
 * marker child at a fixed offset (in procedural axes) so world motion can be compared.
 */
function rotatedTwin(rig: RobotRig, seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const scene = new THREE.Group();
  const srcOf = (name: string) =>
    name === 'BackUnit' ? rig.backUnit : rig.joints[name as (typeof JOINT_NAMES)[number]];
  const frames = new Map<string, THREE.Quaternion>();
  const nodes = new Map<string, THREE.Object3D>();
  const build = (src: THREE.Object3D, parent: THREE.Object3D, parentFrame: THREE.Quaternion) => {
    const name = src.name;
    const frame = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3))
      .normalize();
    const node = new THREE.Object3D();
    node.name = name;
    // Procedural parents are world-aligned at rest, so the offset maps through parentFrame⁻¹.
    node.position.copy(src.position).applyQuaternion(parentFrame.clone().invert());
    node.quaternion.copy(parentFrame.clone().invert().multiply(frame));
    parent.add(node);
    frames.set(name, frame);
    nodes.set(name, node);
    for (const c of src.children) if (ALL.includes(c.name as never)) build(c, node, frame);
  };
  build(rig.root, scene, new THREE.Quaternion());
  const markers = new Map<string, [THREE.Object3D, THREE.Object3D]>();
  for (const name of ALL) {
    const offset = new THREE.Vector3(0.3, -0.2, 0.25);
    const a = new THREE.Object3D();
    a.position.copy(offset);
    srcOf(name).add(a);
    const b = new THREE.Object3D();
    b.position.copy(offset).applyQuaternion(frames.get(name)!.clone().invert());
    nodes.get(name)!.add(b);
    markers.set(name, [a, b]);
  }
  return { scene, markers };
}

describe.each([
  ['raijin', buildRaijin],
  ['fujin', buildFujin],
] as const)('rigFromScene + applyClip on rotated bone frames (%s)', (kind, build) => {
  it('moves every joint exactly like the procedural rig', () => {
    const proc = build();
    const { scene, markers } = rotatedTwin(proc, kind === 'raijin' ? 7 : 11);
    const glb = rigFromScene(scene, kind);
    expect(glb).not.toBeNull();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let maxErr = 0;
    for (const clip of CLIP_NAMES) {
      for (const f of [0.1, 0.45, 0.8]) {
        const t = CLIP_DURATION[clip] * f;
        applyClip(proc, clip, t, 3 + t);
        applyClip(glb!, clip, t, 3 + t);
        proc.root.updateMatrixWorld(true);
        scene.updateMatrixWorld(true);
        for (const [pa, pb] of markers.values()) {
          pa.getWorldPosition(a);
          pb.getWorldPosition(b);
          maxErr = Math.max(maxErr, a.distanceTo(b));
        }
      }
    }
    expect(maxErr).toBeLessThan(1e-5);
    proc.dispose();
  });

  it('keeps the rest pose captured on first use when the scene is reused', () => {
    const proc = build();
    const { scene } = rotatedTwin(proc, 3);
    const first = rigFromScene(scene, kind)!;
    applyClip(first, 'Special', 1.2, 1.2);
    const second = rigFromScene(scene, kind)!;
    expect(second.rest.Hand_R.frame!.equals(first.rest.Hand_R.frame!)).toBe(true);
    expect(second.rest.Hips.position.equals(first.rest.Hips.position)).toBe(true);
    proc.dispose();
  });
});

describe('procedural rigs are unaffected', () => {
  it('still pose with plain Euler offsets (no frames)', () => {
    const rig = buildRaijin();
    expect(rig.rest.Chest.frame).toBeUndefined();
    applyClip(rig, 'Guard', 0.5, 0.5);
    expect(rig.joints.UpperArm_L.rotation.x).toBeCloseTo(-1.25 - 0.15, 1);
    rig.dispose();
  });
});

describe('glow on GLB materials', () => {
  it('keeps each material’s authored intensity ratio while animating', () => {
    const scene = new THREE.Group();
    const names = [...JOINT_NAMES, 'BackUnit'];
    for (const n of names) {
      const o = new THREE.Object3D();
      o.name = n;
      scene.add(o);
    }
    const body = new THREE.MeshStandardMaterial({ emissive: '#25C8D7', emissiveIntensity: 2.8 });
    const veil = new THREE.MeshStandardMaterial({ emissive: '#7FE9F2', emissiveIntensity: 0.9 });
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), body));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), veil));
    const rig = rigFromScene(scene, 'fujin')!;
    applyClip(rig, 'Special', 1.0, 1.0);
    expect(body.emissiveIntensity / veil.emissiveIntensity).toBeCloseTo(2.8 / 0.9, 5);
    expect(body.emissiveIntensity).toBeGreaterThan(2.8); // Special boosts glow
  });
});

describe('spinner bones (thunder drums / wind ring)', () => {
  it('spin about their own axis while the BackUnit mount stays at rest', () => {
    const scene = new THREE.Group();
    const nodes: Record<string, THREE.Object3D> = {};
    for (const n of [...JOINT_NAMES, 'BackUnit']) {
      const o = new THREE.Object3D();
      o.name = n;
      nodes[n] = o;
      scene.add(o);
    }
    const drum = new THREE.Object3D();
    drum.name = 'Drum_R';
    drum.position.set(-1, 4, -0.7);
    drum.quaternion.setFromEuler(new THREE.Euler(1.2, 0.3, -0.4)); // arbitrary bone frame
    nodes.BackUnit!.add(drum);
    const onAxis = new THREE.Object3D();
    onAxis.position.set(0, 0.5, 0); // along the bone's local +Y = spin axis
    const offAxis = new THREE.Object3D();
    offAxis.position.set(0.4, 0, 0);
    drum.add(onAxis, offAxis);

    const rig = rigFromScene(scene, 'raijin')!;
    expect(rig.spinners?.map((s) => [s.object.name, s.sign])).toEqual([['Drum_R', -1]]);
    scene.updateMatrixWorld(true);
    const a0 = onAxis.getWorldPosition(new THREE.Vector3());
    const b0 = offAxis.getWorldPosition(new THREE.Vector3());
    const mount0 = nodes.BackUnit!.quaternion.clone();

    applyClip(rig, 'Special', 1.0, 1.0); // fast spin
    scene.updateMatrixWorld(true);
    expect(onAxis.getWorldPosition(new THREE.Vector3()).distanceTo(a0)).toBeLessThan(1e-9);
    expect(offAxis.getWorldPosition(new THREE.Vector3()).distanceTo(b0)).toBeGreaterThan(0.05);
    expect(nodes.BackUnit!.quaternion.angleTo(mount0)).toBeLessThan(1e-9);
  });
});
