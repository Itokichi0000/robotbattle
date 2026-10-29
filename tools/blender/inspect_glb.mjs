#!/usr/bin/env node
/**
 * GLB asset checker for SATS WARS robots (no dependencies).
 *   node tools/blender/inspect_glb.mjs apps/web/public/assets/robots/raijin.glb [--json]
 *   node tools/blender/inspect_glb.mjs apps/web/public/assets/enemies/null_core.glb --boss
 * Checks: glTF 2.0 header, required joint/node names, animation clip names,
 * triangle count vs budget, texture sizes are not checked (needs decoding).
 * Exit code 1 when a required item is missing or the budget is exceeded.
 */
import { readFileSync } from 'node:fs';

export const REQUIRED_JOINTS = [
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
];
export const REQUIRED_CLIPS = [
  'Idle',
  'Intro',
  'AttackLight',
  'AttackHeavy',
  'Guard',
  'HitReact',
  'Special',
  'Victory',
  'Defeat',
  'Walk',
  'Dash',
  'Hover',
  'ShieldDeploy',
  'Charge',
  'Boarding',
  'HitHeavy',
  // spec D1/D2 names (aliases of AttackLight / AttackHeavy / HitReact)
  'Punch',
  'HeavyAttack',
  'HitLight',
];
export const TRI_BUDGET = 100_000;

/** NULL CORE: weak points are separate parts so hits can light them up. */
export const BOSS_JOINTS = ['Root', 'Core', 'Ring', 'WP_CORE', 'WP_ARM', 'WP_LEG'];
export const BOSS_CLIPS = ['Idle', 'Telegraph', 'Attack', 'HitReact', 'Defeat'];

/** Arena: stage, both spawn pads, the map pedestal and the 8 defence bases. */
export const ARENA_NODES = [
  'stage',
  'spawn_RAIJIN',
  'spawn_FUJIN',
  'map_pedestal',
  ...['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu'].map(
    (r) => `base_${r}`,
  ),
];

export function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  return json;
}

export function inspect(json, kind = 'robot') {
  const requiredJoints =
    kind === 'boss' ? BOSS_JOINTS : kind === 'arena' ? ARENA_NODES : REQUIRED_JOINTS;
  const requiredClips = kind === 'boss' ? BOSS_CLIPS : kind === 'arena' ? [] : REQUIRED_CLIPS;
  const nodeNames = new Set((json.nodes ?? []).map((n) => n.name).filter(Boolean));
  const clips = (json.animations ?? []).map((a) => a.name ?? '');
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue;
      const count =
        prim.indices !== undefined
          ? json.accessors[prim.indices].count
          : json.accessors[prim.attributes.POSITION].count;
      triangles += Math.floor(count / 3);
    }
  }
  const missingJoints = requiredJoints.filter((j) => !nodeNames.has(j));
  const missingClips = requiredClips.filter((c) => !clips.includes(c));
  return {
    generator: json.asset?.generator ?? null,
    nodes: nodeNames.size,
    skins: (json.skins ?? []).length,
    clips,
    triangles,
    materials: (json.materials ?? []).length,
    missingJoints,
    missingClips,
    overBudget: triangles > TRI_BUDGET,
    ok: missingJoints.length === 0 && triangles <= TRI_BUDGET,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: inspect_glb.mjs <file.glb> [--boss|--arena] [--json]');
    process.exit(2);
  }
  const report = inspect(
    parseGlb(readFileSync(file)),
    process.argv.includes('--boss') ? 'boss' : process.argv.includes('--arena') ? 'arena' : 'robot',
  );
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `${file}\n  generator: ${report.generator}\n  nodes: ${report.nodes}, skins: ${report.skins}, materials: ${report.materials}`,
    );
    console.log(
      `  triangles: ${report.triangles} (budget ${TRI_BUDGET})${report.overBudget ? '  ✗ OVER BUDGET' : ''}`,
    );
    console.log(`  clips: ${report.clips.join(', ') || '(none)'}`);
    if (report.missingJoints.length)
      console.log(`  ✗ missing joints: ${report.missingJoints.join(', ')}`);
    if (report.missingClips.length)
      console.log(
        `  ! missing clips (procedural fallback will be used): ${report.missingClips.join(', ')}`,
      );
    console.log(report.ok ? '  ✓ OK' : '  ✗ FAILED');
  }
  process.exit(report.ok ? 0 : 1);
}
