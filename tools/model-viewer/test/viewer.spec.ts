import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const validator = createRequire(import.meta.url)('gltf-validator') as {
  validateBytes(
    data: Uint8Array,
    opts?: { maxIssues?: number },
  ): Promise<{
    issues: {
      numErrors: number;
      numWarnings: number;
      messages: { code: string; message: string; severity: number; pointer?: string }[];
    };
  }>;
};
const GLB_DIR = resolve(import.meta.dirname, '../../../apps/web/public/assets/robots');

/**
 * Loads the Blender-exported GLBs in three.js (the same loader + rigFromScene path the
 * arena uses) and checks structure, rendering and animation. Screenshots of every view are
 * written to test-results/model-viewer/shots/.
 */
const ROBOTS = ['raijin', 'fujin'] as const;
const VIEWS = ['front', 'side', 'back', '45'] as const;
const JOINTS = [
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
  'BackUnit',
];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [`${f}_L`, `${f}_R`]);
const EXTRA_BONES: Record<(typeof ROBOTS)[number], string[]> = {
  raijin: [...FINGERS, 'ShoulderArmor_L', 'ShoulderArmor_R', 'Drum_L', 'Drum_R'],
  fujin: [...FINGERS, 'ShoulderArmor_L', 'ShoulderArmor_R', 'WindRing', 'BackFin_L', 'BackFin_R'],
};
const SPINNER: Record<(typeof ROBOTS)[number], string> = { raijin: 'Drum_L', fujin: 'WindRing' };
const LOD_BUDGET = { 1: 20_000, 2: 7_000 } as const;
const SHOTS = resolve(import.meta.dirname, '../../../test-results/model-viewer/shots');

interface Stats {
  triangles: number;
  meshes: number;
  skinnedMeshes: number;
  bones: number;
  materials: number;
  textures: { name: string; width: number; height: number }[];
  jointsFound: number;
  boneNames: string[];
  clipsInFile: string[];
  height: number;
  bytes: number;
}
type Viewer = {
  ready: boolean;
  error: string | null;
  stats: Record<string, Stats>;
  drawCalls: number;
  clipNames: string[];
  setView(v: string): void;
  pose(clip: string, t: number): void;
  coverage(): number;
  jointWorld(kind: string, joint: string): [number, number, number] | null;
  boneQuaternion(kind: string, name: string): [number, number, number, number] | null;
  render(): void;
};
declare global {
  interface Window {
    __viewer: Viewer;
  }
}

async function open(page: Page, query: Record<string, string>): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const q = new URLSearchParams({ ui: '0', t: '0', clip: 'Idle', view: 'front', ...query });
  await page.goto(`/tools/model-viewer/dist/index.html?${q}`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 180_000 });
  expect(await page.evaluate(() => window.__viewer.error)).toBeNull();
  return errors;
}

for (const robot of ROBOTS) {
  test(`${robot}.glb + LOD1/LOD2: Khronos glTF-Validator reports no errors or warnings`, async () => {
    for (const file of [`${robot}.glb`, `${robot}_lod1.glb`, `${robot}_lod2.glb`]) {
      const report = await validator.validateBytes(
        new Uint8Array(readFileSync(resolve(GLB_DIR, file))),
        {
          maxIssues: 100,
        },
      );
      const msgs = report.issues.messages
        .filter((m) => m.severity <= 1)
        .map((m) => `${file} ${m.code} ${m.pointer ?? ''}`);
      expect(report.issues.numErrors, msgs.join('\n')).toBe(0);
      expect(report.issues.numWarnings, msgs.join('\n')).toBe(0);
    }
  });

  test(`${robot}.glb: structure, textures and four rendered views`, async ({ page }) => {
    const errors = await open(page, { robot, source: 'glb' });
    const s = await page.evaluate((k) => window.__viewer.stats[k]!, robot);
    console.log(
      `${robot}: ${JSON.stringify({ ...s, textures: s.textures.map((t) => `${t.width}x${t.height}`) })}`,
    );

    expect(s.jointsFound).toBe(18); // every shared joint name resolves
    // 19 game joints + fingers, shoulder armour and drums / wind ring / back fins (DESIGN_RULES).
    expect(s.boneNames).toEqual(expect.arrayContaining([...JOINTS, ...EXTRA_BONES[robot]]));
    expect(s.skinnedMeshes).toBe(s.meshes); // every part is skinned to the rig
    expect(s.meshes).toBeGreaterThanOrEqual(25); // parts stay separate objects
    expect(s.triangles).toBeGreaterThan(10_000);
    expect(s.triangles).toBeLessThanOrEqual(50_000); // DESIGN_RULES: LOD0 ≤ 50k
    expect(s.materials).toBe(1); // one atlas material
    expect(s.textures.length).toBe(4); // baseColor, ORM (shared with occlusion), normal, emissive
    for (const t of s.textures) {
      expect(t.width).toBeLessThanOrEqual(2048);
      expect(Math.log2(t.width) % 1).toBe(0); // power of two → mipmaps
    }
    expect(s.height).toBeGreaterThan(4.5);
    expect(s.height).toBeLessThan(5.5);
    expect(s.bytes).toBeLessThan(8 * 1024 * 1024);

    mkdirSync(SHOTS, { recursive: true });
    for (const v of VIEWS) {
      await page.evaluate((name) => {
        window.__viewer.setView(name);
        window.__viewer.render();
      }, v);
      const cov = await page.evaluate(() => window.__viewer.coverage());
      expect(cov, `${robot} ${v}: robot visible`).toBeGreaterThan(0.08);
      await page.screenshot({ path: resolve(SHOTS, `${robot}_glb_${v}.png`) });
    }
    const calls = await page.evaluate(() => window.__viewer.drawCalls);
    expect(calls).toBeLessThan(120);
    expect(errors).toEqual([]);
  });

  test(`${robot}.glb: the game's procedural clips move the GLB skeleton exactly like the in-game rig`, async ({
    browser,
  }) => {
    const glb = await browser.newPage();
    const proc = await browser.newPage();
    const e1 = await open(glb, { robot, source: 'glb' });
    const e2 = await open(proc, { robot, source: 'procedural' });
    const clips = await glb.evaluate(() => window.__viewer.clipNames);
    let worst = 0;
    let worstAt = '';
    for (const clip of clips) {
      for (const t of [0.15, 0.6, 1.05]) {
        const pose = async (p: Page) =>
          p.evaluate(
            ([c, time, joints, kind]) => {
              window.__viewer.pose(c as string, time as number);
              return (joints as string[]).map((j) => window.__viewer.jointWorld(kind as string, j));
            },
            [clip, t, JOINTS, robot] as const,
          );
        const [a, b] = [await pose(glb), await pose(proc)];
        a.forEach((p, i) => {
          const q = b[i]!;
          expect(p, `${JOINTS[i]} exists`).not.toBeNull();
          const d = Math.hypot(p![0] - q[0], p![1] - q[1], p![2] - q[2]);
          if (d > worst) {
            worst = d;
            worstAt = `${clip}@${t}s ${JOINTS[i]}`;
          }
        });
      }
    }
    console.log(`${robot}: max joint deviation ${worst.toExponential(2)} m (${worstAt})`);
    expect(worst).toBeLessThan(1e-3);
    // The thunder drums / wind ring turn on their own bones during the special move.
    const q = async (clip: string, t: number) =>
      glb.evaluate(
        ([c, time, kind, bone]) => {
          window.__viewer.pose(c as string, time as number);
          return window.__viewer.boneQuaternion(kind as string, bone as string)!;
        },
        [clip, t, robot, SPINNER[robot]] as const,
      );
    const [a0, a1] = [await q('Idle', 0), await q('Special', 1.2)];
    const dot = Math.abs(a0.reduce((acc, v, i) => acc + v * a1[i]!, 0));
    expect(2 * Math.acos(Math.min(1, dot)), `${SPINNER[robot]} spins`).toBeGreaterThan(0.01);
    // A pose far from rest still renders (skinned parts are not frustum-culled away).
    await glb.evaluate(() => {
      window.__viewer.pose('Special', 1.6);
      window.__viewer.setView('45');
    });
    expect(await glb.evaluate(() => window.__viewer.coverage())).toBeGreaterThan(0.05);
    await glb.screenshot({ path: resolve(SHOTS, `${robot}_glb_special.png`) });
    expect([...e1, ...e2]).toEqual([]);
  });

  test(`${robot}_lod1.glb / _lod2.glb: same skeleton, within budget, renders`, async ({ page }) => {
    for (const level of [1, 2] as const) {
      const errors = await open(page, { robot, source: 'glb', lod: String(level), view: '45' });
      const s = await page.evaluate((k) => window.__viewer.stats[k]!, robot);
      console.log(`${robot} LOD${level}: ${s.triangles} tris, ${(s.bytes / 1024).toFixed(0)} KB`);
      expect(s.jointsFound).toBe(18);
      expect(s.triangles).toBeLessThanOrEqual(LOD_BUDGET[level]);
      expect(await page.evaluate(() => window.__viewer.coverage())).toBeGreaterThan(0.08);
      await page.screenshot({ path: resolve(SHOTS, `${robot}_lod${level}_45.png`) });
      expect(errors).toEqual([]);
    }
  });
}
