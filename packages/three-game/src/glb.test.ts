import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { CLIP_NAMES } from './director';
import { JOINT_NAMES } from './robots/build';

const MODELS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/web/public/assets/models/blender',
);

function load(file: string): Promise<GLTF> {
  const buf = readFileSync(resolve(MODELS, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail));
}

/** World position of a node after the mixer evaluated a clip at `t` seconds. */
function poseAt(gltf: GLTF, clip: string, t: number, node: string): THREE.Vector3 {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(gltf.animations.find((a) => a.name === clip)!);
  action.play();
  mixer.setTime(t);
  gltf.scene.updateMatrixWorld(true);
  const p = gltf.scene.getObjectByName(node)!.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction();
  return p;
}

describe('Blender GLBs load and play in three.js', () => {
  for (const file of ['raijin.glb', 'fujin.glb']) {
    it(`${file}: shared skeleton, every clip, a punch moves the fist`, async () => {
      const gltf = await load(file);
      for (const j of JOINT_NAMES) expect(gltf.scene.getObjectByName(j), j).toBeTruthy();
      const clips = gltf.animations.map((a) => a.name);
      for (const c of CLIP_NAMES) expect(clips).toContain(c);
      // Standing upright facing +Z: head above hips, feet near the ground.
      gltf.scene.updateMatrixWorld(true);
      const head = gltf.scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
      const foot = gltf.scene.getObjectByName('Foot_L')!.getWorldPosition(new THREE.Vector3());
      expect(head.y).toBeGreaterThan(3.5);
      expect(foot.y).toBeLessThan(0.5);
      // AttackHeavy swings the right fist forward (+Z) compared with the rest pose.
      const rest = poseAt(gltf, 'Idle', 0, 'Hand_R');
      const punch = poseAt(gltf, 'AttackHeavy', 11 / 30, 'Hand_R');
      expect(punch.z - rest.z).toBeGreaterThan(0.5);
    });
  }

  it('null_core.glb: weak points are separate nodes and the ring spins flat', async () => {
    const gltf = await load('null_core.glb');
    for (const n of ['Core', 'Ring', 'weak_core', 'weak_arm', 'weak_leg'])
      expect(gltf.scene.getObjectByName(n), n).toBeTruthy();
    expect(gltf.animations.map((a) => a.name)).toEqual(
      expect.arrayContaining(['Idle', 'Telegraph', 'Attack', 'HitReact', 'Defeat']),
    );
    const a = poseAt(gltf, 'Idle', 0, 'shard_0');
    const b = poseAt(gltf, 'Idle', 1, 'shard_0');
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.05); // stays in its plane
    expect(a.distanceTo(b)).toBeGreaterThan(0.3); // but moves around the core
  });
});
