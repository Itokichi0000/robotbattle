import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { inspect, parseGlb, REQUIRED_CLIPS, REQUIRED_JOINTS } from '../inspect_glb.mjs';

function makeGlb(json: object): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const buf = new Uint8Array(12 + 8 + jsonBytes.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, buf.length, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  buf.set(jsonBytes, 20);
  return buf;
}

describe('inspect_glb', () => {
  it('accepts a model with all joints and clips', () => {
    const json = {
      asset: { version: '2.0', generator: 'test' },
      nodes: (REQUIRED_JOINTS as string[]).map((name) => ({ name })),
      animations: (REQUIRED_CLIPS as string[]).map((name) => ({
        name,
        channels: [],
        samplers: [],
      })),
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 300 }, { count: 600 }],
    };
    const r = inspect(parseGlb(makeGlb(json)));
    expect(r).toMatchObject({ ok: true, triangles: 200, missingJoints: [], missingClips: [] });
  });
  it('reports missing joints and rejects non-GLB input', () => {
    const r = inspect(parseGlb(makeGlb({ asset: { version: '2.0' }, nodes: [{ name: 'Root' }] })));
    expect(r.ok).toBe(false);
    expect(r.missingJoints).toContain('Head');
    expect(() => parseGlb(new Uint8Array(20))).toThrow(/magic/);
  });
});
