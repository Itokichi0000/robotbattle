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
  const json = parseGlb(
    new Uint8Array(readFileSync(resolve(ROOT, `apps/web/public/assets/robots/${robot}.glb`))),
  ) as GltfJson;
  const report = inspect(json);

  it('has every shared joint, one skin and stays inside the triangle budget', () => {
    expect(report.missingJoints).toEqual([]);
    expect(json.skins).toHaveLength(1);
    const jointNames = json.skins[0]!.joints.map((i) => json.nodes[i]!.name);
    expect(jointNames).toEqual(expect.arrayContaining([...REQUIRED_JOINTS, 'BackUnit']));
    expect(report.triangles).toBeGreaterThan(10_000);
    expect(report.triangles).toBeLessThanOrEqual(60_000);
  });

  it('keeps head / torso / arms / legs / joints / back as separate skinned parts', () => {
    const parts = json.nodes.filter((n) => n.mesh !== undefined);
    expect(parts.length).toBeGreaterThanOrEqual(25);
    for (const p of parts) expect(p.skin).toBe(0);
    const groups = new Set(parts.map((p) => p.extras?.sw_part));
    for (const g of PARTS) expect(groups).toContain(g);
  });

  it('uses one atlas material with WebP textures (+ FUJIN translucent veil)', () => {
    const opaque = json.materials.filter((m) => m.alphaMode !== 'BLEND');
    expect(opaque).toHaveLength(1);
    expect(opaque[0]!.normalTexture).toBeDefined();
    expect(opaque[0]!.emissiveTexture).toBeDefined();
    expect(json.materials.length).toBe(robot === 'fujin' ? 2 : 1);
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
});
