/**
 * Export the procedural stand-in robots (with all 9 clips baked as keyframes)
 * to GLB, so the GLB loading path and the asset checker can be exercised
 * without Blender. Output is a placeholder, not final art.
 *   pnpm --filter @sats-wars/three-game export-glb [outDir]
 * Default output: apps/web/public/assets/robots/generated/ (gitignored) + manifest.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { CLIP_DURATION, CLIP_NAMES } from '../src/director';
import { applyClip } from '../src/robots/animate';
import { JOINT_NAMES, buildFujin, buildRaijin, type RobotRig } from '../src/robots/build';

// Minimal FileReader polyfill for GLTFExporter under Node.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((b) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

const FPS = 15;

function bakeClip(rig: RobotRig, clip: (typeof CLIP_NAMES)[number]): THREE.AnimationClip {
  const duration = CLIP_DURATION[clip];
  const frames = Math.max(2, Math.round(duration * FPS) + 1);
  const times: number[] = [];
  const rot: Record<string, number[]> = {};
  const pos: Record<string, number[]> = {};
  const back: number[] = [];
  const q = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * duration;
    times.push(t);
    applyClip(rig, clip, t, t);
    for (const name of JOINT_NAMES) {
      const j = rig.joints[name];
      q.setFromEuler(j.rotation);
      (rot[name] ??= []).push(q.x, q.y, q.z, q.w);
      (pos[name] ??= []).push(j.position.x, j.position.y, j.position.z);
    }
    q.setFromEuler(rig.backUnit.rotation);
    back.push(q.x, q.y, q.z, q.w);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const name of JOINT_NAMES) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, rot[name]!));
    tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, pos[name]!));
  }
  tracks.push(new THREE.QuaternionKeyframeTrack('BackUnit.quaternion', times, back));
  return new THREE.AnimationClip(clip, duration, tracks);
}

async function exportRig(rig: RobotRig, file: string) {
  const clips = CLIP_NAMES.map((c) => bakeClip(rig, c));
  applyClip(rig, 'Idle', 0, 0);
  const scene = new THREE.Scene();
  scene.add(rig.root);
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(scene, {
    binary: true,
    animations: clips,
    onlyVisible: true,
  })) as ArrayBuffer;
  writeFileSync(file, Buffer.from(glb));
  console.log(`wrote ${file} (${(glb.byteLength / 1024).toFixed(0)} KB, ${clips.length} clips)`);
}

const out = resolve(process.argv[2] ?? '../../apps/web/public/assets/robots/generated');
mkdirSync(out, { recursive: true });
await exportRig(buildRaijin(), resolve(out, 'raijin.glb'));
await exportRig(buildFujin(), resolve(out, 'fujin.glb'));
// The arena loads models only when a manifest exists next to them.
writeFileSync(
  resolve(out, 'manifest.json'),
  `${JSON.stringify({ RAIJIN: 'raijin.glb', FUJIN: 'fujin.glb', source: 'procedural-export' }, null, 2)}\n`,
);
