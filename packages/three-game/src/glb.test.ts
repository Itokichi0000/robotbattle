import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  CLIP_DURATION,
  CLIP_HIT_TIME,
  CLIP_NAMES,
  type ClipName,
  LOOPING_CLIPS,
  REQUIRED_CLIPS,
  SPEC_CLIP_ALIASES,
} from './director';
import { JOINT_NAMES } from './robots/build';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/assets');
const MODELS = resolve(PUBLIC, 'models/blender');
/** Where an artist's delivered robots go (docs/art/ART_BRIEF.md); checked when present. */
const ARTIST = resolve(PUBLIC, 'robots');

function load(file: string, dir = MODELS): Promise<GLTF> {
  const buf = readFileSync(resolve(dir, file));
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

/**
 * The robot contract (docs/art/ART_BRIEF.md): shared skeleton, every clip with
 * the director's timing, damage nodes, upright at about 4 m facing +Z, and the
 * heavy punch landing on its hit marker.
 */
function robotContract(dir: string, file: string) {
  return async () => {
    const gltf = await load(file, dir);
    for (const j of JOINT_NAMES) expect(gltf.scene.getObjectByName(j), j).toBeTruthy();
    const clips = gltf.animations.map((a) => a.name);
    for (const c of CLIP_NAMES) expect(clips).toContain(c);
    for (const c of Object.keys(SPEC_CLIP_ALIASES)) expect(clips).toContain(c);
    const team = file === 'raijin.glb' ? 'RAIJIN' : 'FUJIN';
    for (const c of REQUIRED_CLIPS[team]) expect(clips, c).toContain(c);
    // The director returns a robot to Idle after CLIP_DURATION: a longer clip gets cut.
    for (const a of gltf.animations) {
      const name = a.name as ClipName;
      if (!(name in CLIP_DURATION) || LOOPING_CLIPS.has(name)) continue;
      expect(a.duration, `${name} length`).toBeLessThanOrEqual(CLIP_DURATION[name] + 0.1);
    }
    // Damage stages ship as hidden-by-default nodes the game toggles by hull.
    const damage = { 1: 0, 2: 0 };
    gltf.scene.traverse((o) => {
      if (o.name.startsWith('damage1_')) damage[1]++;
      if (o.name.startsWith('damage2_')) damage[2]++;
    });
    expect(damage[1]).toBeGreaterThanOrEqual(4);
    expect(damage[2]).toBeGreaterThanOrEqual(4);
    // Standing upright facing +Z: head above hips, feet near the ground.
    gltf.scene.updateMatrixWorld(true);
    const head = gltf.scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
    const foot = gltf.scene.getObjectByName('Foot_L')!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeGreaterThan(3.5);
    expect(foot.y).toBeLessThan(0.5);
    // AttackHeavy has the right fist forward (+Z) on its hit marker, where the
    // bolt, the sound and the hit-stop land.
    const rest = poseAt(gltf, 'Idle', 0, 'Hand_R');
    const punch = poseAt(gltf, 'AttackHeavy', CLIP_HIT_TIME.AttackHeavy!, 'Hand_R');
    expect(punch.z - rest.z).toBeGreaterThan(0.5);
  };
}

describe('Blender GLBs load and play in three.js', () => {
  for (const file of ['raijin.glb', 'fujin.glb'])
    it(
      `${file}: shared skeleton, every clip on time, a punch on the hit marker`,
      robotContract(MODELS, file),
    );

  for (const file of ['raijin.glb', 'fujin.glb'])
    it.skipIf(!existsSync(resolve(ARTIST, file)))(
      `artist ${file} (assets/robots): same contract`,
      robotContract(ARTIST, file),
    );

  it('Walk moves the legs and Boarding lowers then raises the body', async () => {
    const gltf = await load('raijin.glb');
    const a = poseAt(gltf, 'Walk', 0.3, 'Foot_L');
    const b = poseAt(gltf, 'Walk', 0.9, 'Foot_L');
    expect(a.distanceTo(b)).toBeGreaterThan(0.2);
    const stand = poseAt(gltf, 'Boarding', 0, 'Head');
    const kneel = poseAt(gltf, 'Boarding', 1.0, 'Head');
    expect(stand.y - kneel.y).toBeGreaterThan(0.2);
  });

  it('arena.glb: stage, spawn pads, eight bases and the camera presets', async () => {
    const gltf = await load('arena.glb');
    for (const n of ['stage', 'spawn_RAIJIN', 'spawn_FUJIN', 'map_pedestal'])
      expect(gltf.scene.getObjectByName(n), n).toBeTruthy();
    const bases = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu'];
    for (const b of bases) expect(gltf.scene.getObjectByName(`base_${b}`), b).toBeTruthy();
    const cams = gltf.cameras.map((c) => c.name);
    for (const preset of ['intro', 'overview', 'boss', 'special', 'final'])
      expect(
        cams.some((c) => c.includes(preset)),
        preset,
      ).toBe(true);
  });

  it('effects.glb: shield dome, lightning, wind, warning ring, NULL beam', async () => {
    const gltf = await load('effects.glb');
    for (const n of [
      'fx_shield_dome',
      'fx_lightning_0',
      'fx_wind_ribbon',
      'fx_warning_ring',
      'fx_null_beam',
    ])
      expect(gltf.scene.getObjectByName(n), n).toBeTruthy();
  });

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
