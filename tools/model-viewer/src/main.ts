/**
 * SATS WARS model viewer — three.js display test for the Blender-built robots.
 *
 * Loads raijin.glb / fujin.glb (or the in-game procedural robots for comparison) and
 * drives them with the game's own procedural clips (packages/three-game animate.ts),
 * through the same rigFromScene() the arena uses. Query parameters:
 *   robot=raijin|fujin|both   source=glb|procedural   view=front|side|back|45
 *   clip=<ClipName>  t=<seconds, freezes time>   light=studio|arena   wire=1  spin=1  ui=0
 *   dir=<GLB directory URL>   (default: the web app's public/assets/robots)
 * `window.__viewer` exposes stats and hooks for the Playwright test.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CLIP_DURATION,
  CLIP_NAMES,
  type ClipName,
} from '../../../packages/three-game/src/director';
import { applyClip } from '../../../packages/three-game/src/robots/animate';
import {
  buildFujin,
  buildRaijin,
  JOINT_NAMES,
  type RobotRig,
} from '../../../packages/three-game/src/robots/build';
import { rigFromScene } from '../../../packages/three-game/src/robots/glbRig';

type Kind = 'raijin' | 'fujin';
type ViewName = 'front' | 'side' | 'back' | '45';

/** Same angles as the Blender previews (tools/blender/robotkit/preview.py). */
const VIEWS: Record<ViewName, [number, number]> = {
  front: [0, 4],
  side: [90, 4],
  back: [180, 4],
  '45': [40, 14],
};
const TEAM_COLOR: Record<Kind, string> = { raijin: '#F7931A', fujin: '#25C8D7' };
const BG = '#070D1A';

interface RobotStats {
  source: 'glb' | 'procedural';
  bytes: number;
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
  width: number;
}

interface Loaded {
  kind: Kind;
  object: THREE.Object3D;
  rig: RobotRig;
  mixer: THREE.AnimationMixer | null;
  clips: Map<string, THREE.AnimationAction>;
  stats: RobotStats;
}

const params = new URLSearchParams(location.search);
const robotParam = params.get('robot') ?? 'both';
const kinds: Kind[] = robotParam === 'both' ? ['raijin', 'fujin'] : [robotParam as Kind];
const source = (params.get('source') ?? 'glb') as 'glb' | 'procedural';
const dir = params.get('dir') ?? '../../../apps/web/public/assets/robots/';
const lod = params.get('lod'); // 1 | 2 → <robot>_lod1.glb / _lod2.glb
let view = (params.get('view') ?? '45') as ViewName;
let clip = (params.get('clip') ?? 'Idle') as ClipName;
const frozenT = params.has('t') ? Number(params.get('t')) : null;
const light = params.get('light') ?? 'studio';
const showUi = params.get('ui') !== '0';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
// Same output settings as the arena (packages/three-game/src/ArenaScene.tsx).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lights: "arena" copies the venue LightingRig; "studio" adds a camera-relative key/fill/rim
// rig plus a neutral environment map so every view (including the back) is readable.
const lightRig = new THREE.Group();
scene.add(lightRig);
scene.add(new THREE.AmbientLight('#8FA6D8', 0.35));
scene.add(new THREE.HemisphereLight('#5B7BC0', '#0A0F1C', 0.6));
const sun = new THREE.DirectionalLight('#FFF2E0', 1.6);
sun.position.set(6, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 7, bottom: -1 });
lightRig.add(sun);
const teamLight = new THREE.PointLight(TEAM_COLOR[kinds[0]!], 30, 14);
teamLight.position.set(-2, 3.5, 3);
lightRig.add(teamLight);
const backLight = new THREE.PointLight('#3A7BD5', 25, 18);
backLight.position.set(0, 8, -6);
lightRig.add(backLight);
if (light === 'studio') {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  const fill = new THREE.DirectionalLight('#C8D8FF', 0.8);
  fill.position.set(-7, 4, 6);
  lightRig.add(fill);
  const rim = new THREE.DirectionalLight(TEAM_COLOR[kinds[0]!], 1.4);
  rim.position.set(-5, 6, -7);
  lightRig.add(rim);
}

// Floor disc with a team-coloured rim, like the Blender preview stage.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(kinds.length > 1 ? 8 : 4.5, 64),
  new THREE.MeshStandardMaterial({ color: '#0B1426', metalness: 0.1, roughness: 0.85 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const loader = new GLTFLoader();
const robots: Loaded[] = [];

function emptyStats(src: 'glb' | 'procedural'): RobotStats {
  return {
    source: src,
    bytes: 0,
    triangles: 0,
    meshes: 0,
    skinnedMeshes: 0,
    bones: 0,
    materials: 0,
    textures: [],
    jointsFound: 0,
    boneNames: [],
    clipsInFile: [],
    height: 0,
    width: 0,
  };
}

function measure(object: THREE.Object3D, stats: RobotStats): void {
  const mats = new Set<THREE.Material>();
  const tex = new Map<string, { name: string; width: number; height: number }>();
  const bones = new Set<THREE.Object3D>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    stats.meshes++;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const g = mesh.geometry;
    stats.triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      stats.skinnedMeshes++;
      for (const b of sk.skeleton.bones) bones.add(b);
    }
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      mats.add(m);
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture | null;
        if (t && (t as THREE.Texture).isTexture && t.image) {
          const img = t.image as { width: number; height: number };
          tex.set(t.uuid, { name: t.name || '(unnamed)', width: img.width, height: img.height });
        }
      }
    }
  });
  stats.materials = mats.size;
  stats.textures = [...tex.values()];
  stats.bones = bones.size;
  stats.boneNames = [...bones].map((b) => b.name).sort();
  stats.jointsFound = JOINT_NAMES.filter((n) => object.getObjectByName(n)).length;
  const box = new THREE.Box3().setFromObject(object);
  stats.height = +(box.max.y - box.min.y).toFixed(3);
  stats.width = +(box.max.x - box.min.x).toFixed(3);
}

async function loadRobot(kind: Kind): Promise<Loaded> {
  if (source === 'procedural') {
    const rig = kind === 'raijin' ? buildRaijin() : buildFujin();
    const stats = emptyStats('procedural');
    measure(rig.root, stats);
    return { kind, object: rig.root, rig, mixer: null, clips: new Map(), stats };
  }
  const file = `${kind}${lod ? `_lod${lod}` : ''}.glb`;
  const url = new URL(file, new URL(dir, location.href)).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const gltf = await loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
  const rig = rigFromScene(gltf.scene, kind);
  if (!rig) throw new Error(`${file}: required joints missing`);
  const stats = emptyStats('glb');
  stats.bytes = buf.byteLength;
  stats.clipsInFile = gltf.animations.map((a) => a.name);
  measure(gltf.scene, stats);
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
  const clips = new Map<string, THREE.AnimationAction>();
  for (const a of gltf.animations) clips.set(a.name, mixer!.clipAction(a));
  return { kind, object: gltf.scene, rig, mixer, clips, stats };
}

/** Pose every robot: a clip baked into the GLB wins, else the procedural clip (as in the arena). */
function pose(name: ClipName, t: number, total = t): void {
  for (const r of robots) {
    const action = r.clips.get(name);
    if (action && r.mixer) {
      for (const a of r.clips.values()) a.stop();
      action.play();
      action.time = Math.min(t, action.getClip().duration);
      r.mixer.update(0);
    } else {
      applyClip(r.rig, name, t, total);
    }
  }
}

const target = new THREE.Vector3();
let fitDistance = 12;

function frame(): void {
  const box = new THREE.Box3();
  for (const r of robots) box.expandByObject(r.object);
  const size = box.getSize(new THREE.Vector3());
  box.getCenter(target);
  target.x = 0;
  target.z = 0;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const w = Math.max(size.x, size.z);
  fitDistance =
    1.12 * Math.max(size.y / 2 / Math.tan(vfov / 2), w / 2 / Math.tan(hfov / 2)) + w / 2;
  controls.target.copy(target);
}

function setView(name: ViewName): void {
  view = name;
  const [az, el] = VIEWS[name];
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  camera.position.set(
    target.x + Math.sin(a) * Math.cos(e) * fitDistance,
    target.y + Math.sin(e) * fitDistance,
    target.z + Math.cos(a) * Math.cos(e) * fitDistance,
  );
  camera.lookAt(target);
  controls.update();
  if (light === 'studio') lightRig.rotation.y = a;
}

/** Fraction of the canvas that differs from the background colour (robot actually drawn?). */
function coverage(): number {
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = Math.round((160 * src.height) / src.width);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const bg = new THREE.Color(BG);
  const [br, bgc, bb] = [bg.r * 255, bg.g * 255, bg.b * 255];
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i]! - br) + Math.abs(d[i + 1]! - bgc) + Math.abs(d[i + 2]! - bb) > 30) n++;
  }
  return n / (d.length / 4);
}

function jointWorld(kind: Kind, joint: string): [number, number, number] | null {
  const r = robots.find((x) => x.kind === kind);
  const o = r?.object.getObjectByName(joint);
  if (!r || !o) return null;
  r.object.updateMatrixWorld(true);
  // Relative to the robot's own placement so GLB and procedural pages compare directly.
  const p = o.getWorldPosition(new THREE.Vector3()).sub(r.object.parent!.position);
  return [p.x, p.y, p.z];
}

function boneQuaternion(kind: Kind, name: string): [number, number, number, number] | null {
  const o = robots.find((x) => x.kind === kind)?.object.getObjectByName(name);
  return o ? [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] : null;
}

const api = {
  ready: false,
  error: null as string | null,
  stats: {} as Record<string, RobotStats>,
  drawCalls: 0,
  clipNames: CLIP_NAMES,
  setView,
  pose,
  coverage,
  jointWorld,
  boneQuaternion,
  render: () => {
    renderer.render(scene, camera);
    api.drawCalls = renderer.info.render.calls;
  },
};
(window as unknown as { __viewer: typeof api }).__viewer = api;

function buildUi(): void {
  const panel = document.createElement('div');
  panel.id = 'ui';
  const opt = (values: readonly string[], cur: string) =>
    values.map((v) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
  panel.innerHTML = `
    <h1>SATS WARS <span>model viewer</span></h1>
    <label>Robot <select id="robot">${opt(['both', 'raijin', 'fujin'], robotParam)}</select></label>
    <label>Source <select id="source">${opt(['glb', 'procedural'], source)}</select></label>
    <label>Light <select id="light">${opt(['studio', 'arena'], light)}</select></label>
    <label>View <select id="view">${opt(Object.keys(VIEWS), view)}</select></label>
    <label>Clip <select id="clip">${opt(CLIP_NAMES, clip)}</select></label>
    <label><input type="checkbox" id="wire"> Wireframe</label>
    <pre id="stats">loading…</pre>`;
  document.body.appendChild(panel);
  const reload = (k: string, v: string) => {
    params.set(k, v);
    location.search = params.toString();
  };
  for (const k of ['robot', 'source', 'light'] as const)
    panel.querySelector<HTMLSelectElement>(`#${k}`)!.onchange = (e) =>
      reload(k, (e.target as HTMLSelectElement).value);
  panel.querySelector<HTMLSelectElement>('#view')!.onchange = (e) =>
    setView((e.target as HTMLSelectElement).value as ViewName);
  panel.querySelector<HTMLSelectElement>('#clip')!.onchange = (e) => {
    clip = (e.target as HTMLSelectElement).value as ClipName;
    clipStart = clock.getElapsedTime();
    if (frozenT !== null) {
      pose(clip, frozenT);
      api.render();
    }
  };
  panel.querySelector<HTMLInputElement>('#wire')!.onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    for (const r of robots)
      r.object.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const x of (Array.isArray(m) ? m : m ? [m] : []) as THREE.MeshStandardMaterial[])
          x.wireframe = on;
      });
    api.render();
  };
}

function showStats(): void {
  const el = document.getElementById('stats');
  if (!el) return;
  el.textContent = robots
    .map((r) => {
      const s = r.stats;
      const tex = s.textures.map((t) => `${t.width}²`).join(' ') || 'none';
      return `${r.kind.toUpperCase()} (${s.source}${s.bytes ? `, ${(s.bytes / 1024).toFixed(0)} KB` : ''})
  tris ${s.triangles.toLocaleString()}  meshes ${s.meshes}  bones ${s.bones}
  materials ${s.materials}  textures ${tex}
  joints ${s.jointsFound}/${JOINT_NAMES.length}  clips in file ${s.clipsInFile.length}`;
    })
    .join('\n\n')
    .concat(`\n\ndraw calls ${api.drawCalls}`);
}

const clock = new THREE.Clock();
let clipStart = 0;

async function main(): Promise<void> {
  if (showUi) buildUi();
  const loaded = await Promise.all(kinds.map(loadRobot));
  loaded.forEach((r, i) => {
    const holder = new THREE.Group();
    holder.position.x = kinds.length > 1 ? (i === 0 ? -2.9 : 2.9) : 0;
    holder.add(r.object);
    scene.add(holder);
    robots.push(r);
    api.stats[r.kind] = r.stats;
  });
  pose('Idle', 0);
  frame();
  setView(view);
  if (frozenT !== null) pose(clip, frozenT, frozenT);
  api.render();
  showStats();
  api.ready = true;
  document.body.dataset.ready = '1';
  // Frozen time (t=…) renders on demand only: tests and captures call api.render() explicitly,
  // which keeps software-rendered (SwiftShader) runs fast.
  if (frozenT !== null) {
    controls.addEventListener('change', api.render);
    return;
  }
  renderer.setAnimationLoop(() => {
    const now = clock.getElapsedTime();
    const t = now - clipStart;
    if (clip !== 'Idle' && clip !== 'Victory' && t > CLIP_DURATION[clip] + 0.8) clipStart = now;
    pose(clip, t, now);
    if (params.get('spin') === '1') {
      for (const r of robots) r.object.rotation.y = now * 0.4;
    }
    controls.update();
    api.render();
    if (showUi && Math.round(now * 2) % 2 === 0) showStats();
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

main().catch((e: unknown) => {
  api.error = e instanceof Error ? e.message : String(e);
  document.body.dataset.ready = 'error';
  console.error(e);
});
