import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { inspect, parseGlb, REQUIRED_JOINTS } from '../inspect_glb.mjs';

/**
 * Guards the committed Blender-built robots (tools/blender/build_robot.py) without needing
 * Blender or a browser. Rendering and animation are covered by `pnpm models:test`.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const PARTS = ['head', 'torso', 'arms', 'legs', 'joints', 'back'];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [`${f}_L`, `${f}_R`]);
// Extra bones required by docs/design/visual-bible-v01/DESIGN_RULES_FOR_BLENDER.md.
const EXTRA: Record<string, string[]> = {
  raijin: [...FINGERS, 'ShoulderArmor_L', 'ShoulderArmor_R', 'Drum_L', 'Drum_R'],
  fujin: [...FINGERS, 'ShoulderArmor_L', 'ShoulderArmor_R', 'WindRing', 'BackFin_L', 'BackFin_R'],
};
const load = (file: string) =>
  parseGlb(
    new Uint8Array(readFileSync(resolve(ROOT, `apps/web/public/assets/robots/${file}`))),
  ) as GltfJson;

interface GltfJson {
  extensionsRequired?: string[];
  nodes: { name?: string; mesh?: number; skin?: number; extras?: Record<string, unknown> }[];
  skins: { joints: number[] }[];
  materials: {
    name: string;
    alphaMode?: string;
    normalTexture?: unknown;
    emissiveTexture?: unknown;
  }[];
  images: { mimeType?: string }[];
  animations?: unknown[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
}

describe.each(['raijin', 'fujin'])('%s.glb (committed asset)', (robot) => {
  const json = load(`${robot}.glb`);
  const report = inspect(json);

  it('has every shared joint, one skin and stays inside the triangle budget', () => {
    expect(report.missingJoints).toEqual([]);
    expect(json.skins).toHaveLength(1);
    const jointNames = json.skins[0]!.joints.map((i) => json.nodes[i]!.name);
    expect(jointNames).toEqual(
      expect.arrayContaining([...REQUIRED_JOINTS, 'BackUnit', ...EXTRA[robot]!]),
    );
    expect(jointNames.length).toBeLessThanOrEqual(64);
    expect(report.triangles).toBeGreaterThan(10_000);
    expect(report.triangles).toBeLessThanOrEqual(50_000); // DESIGN_RULES LOD0
  });

  it('keeps head / torso / arms / legs / joints / back as separate skinned parts', () => {
    const parts = json.nodes.filter((n) => n.mesh !== undefined);
    expect(parts.length).toBeGreaterThanOrEqual(25);
    for (const p of parts) expect(p.skin).toBe(0);
    const groups = new Set(parts.map((p) => p.extras?.sw_part));
    for (const g of PARTS) expect(groups).toContain(g);
  });

  it('uses one atlas material with WebP textures', () => {
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0]!.normalTexture).toBeDefined();
    expect(json.materials[0]!.emissiveTexture).toBeDefined();
    expect(json.images.length).toBe(4);
    for (const img of json.images) expect(img.mimeType).toBe('image/webp');
    expect(json.extensionsRequired).toContain('EXT_texture_webp');
  });

  it('ships tangents for the normal map and no baked clips (procedural clips drive it)', () => {
    let normalMapped = 0;
    for (const m of json.meshes)
      for (const p of m.primitives) {
        expect(p.attributes.JOINTS_0).toBeDefined();
        if (json.materials[p.material!]!.normalTexture) {
          expect(p.attributes.TANGENT).toBeDefined();
          normalMapped++;
        }
      }
    expect(normalMapped).toBeGreaterThanOrEqual(25);
    expect(json.animations ?? []).toHaveLength(0);
  });

  it.each([
    [1, 20_000],
    [2, 7_000],
  ])('LOD%i keeps the skeleton and stays under %i triangles', (level, budget) => {
    const lod = load(`${robot}_lod${level}.glb`);
    const r = inspect(lod);
    expect(r.missingJoints).toEqual([]);
    expect(r.triangles).toBeLessThanOrEqual(budget);
    expect(r.triangles).toBeLessThan(report.triangles);
    // Far LODs drop the normal map (decimation leaves zero-area UV triangles; see export_lods).
    expect(lod.materials[0]!.normalTexture).toBeUndefined();
    expect(lod.images).toHaveLength(3);
  });
});
