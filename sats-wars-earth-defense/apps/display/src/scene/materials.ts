import * as THREE from 'three';
import { COLORS } from '@swed/ui-tokens';

/**
 * Shared PBR materials. Metal parts differ in roughness so the key light shapes them; only
 * small parts emit, so a shot or a shield is the brightest thing on screen (spec §3.2).
 */

function panelTexture(seed: number): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // Panel seams: few and thin, so plates read as machined metal rather than bricks.
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const w = 60 + Math.floor(rnd() * 220);
    const h = 40 + Math.floor(rnd() * 180);
    g.strokeRect(x, y, w, h);
  }
  // Rivets and access hatches.
  g.fillStyle = '#666';
  for (let i = 0; i < 90; i++) g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 2);
  g.fillStyle = '#8c8c8c';
  for (let i = 0; i < 8; i++) g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 26, 8);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.6, 0.6);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function grimeTexture(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  let s = 7;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < size * size; i++) {
    const v = 150 + Math.floor(rnd() * 70);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.7, 0.7);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

let mats: ReturnType<typeof build> | null = null;

function build() {
  const panels = panelTexture(11);
  const grime = grimeTexture();
  const armor = (color: string, rough: number, metal: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      bumpMap: panels,
      bumpScale: 0.4,
      roughnessMap: grime,
    });
  const glow = (color: string, intensity: number) =>
    new THREE.MeshStandardMaterial({
      color: '#0b1218',
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.4,
      metalness: 0.2,
      toneMapped: false,
    });
  return {
    armorLight: armor('#7c878f', 0.46, 0.62),
    armorMid: armor('#46525c', 0.52, 0.7),
    armorDark: armor('#1d262e', 0.6, 0.72),
    frame: new THREE.MeshStandardMaterial({ color: '#12181e', roughness: 0.62, metalness: 0.85 }),
    joint: new THREE.MeshStandardMaterial({ color: '#1d252c', roughness: 0.35, metalness: 0.95 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#2b3238', roughness: 0.3, metalness: 0.95 }),
    amberPaint: new THREE.MeshStandardMaterial({
      color: COLORS.action,
      roughness: 0.55,
      metalness: 0.3,
    }),
    visor: glow(COLORS.ally, 3.2),
    coreGlow: glow(COLORS.ally, 4.5),
    thruster: glow('#9fe6ff', 2.0),
    enemyShell: new THREE.MeshStandardMaterial({
      color: '#0d0e12',
      roughness: 0.28,
      metalness: 0.8,
    }),
    enemyChitin: new THREE.MeshStandardMaterial({
      color: '#1c1418',
      roughness: 0.5,
      metalness: 0.6,
    }),
    enemyCore: glow(COLORS.danger, 5),
    enemyVein: glow('#ff2a48', 2.2),
    ground: new THREE.MeshStandardMaterial({
      color: '#10171d',
      roughness: 0.5,
      metalness: 0.6,
      bumpMap: panels,
      bumpScale: 0.3,
    }),
    hangarFloor: new THREE.MeshStandardMaterial({
      color: '#0b1014',
      roughness: 0.5,
      metalness: 0.45,
      bumpMap: panels,
      bumpScale: 0.2,
    }),
  };
}

export function getMaterials() {
  if (!mats) mats = build();
  return mats;
}

/** A per-instance emissive material for lights whose intensity is animated individually. */
export function stationMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#0b1218',
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.4,
    metalness: 0.2,
    toneMapped: false,
  });
}

/** Text painted onto a transparent texture (hull markings, hologram labels). */
export function textTexture(
  text: string,
  opts: {
    font?: string;
    color?: string;
    width?: number;
    height?: number;
    align?: CanvasTextAlign;
  } = {},
): THREE.CanvasTexture {
  const w = opts.width ?? 512;
  const h = opts.height ?? 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.font = opts.font ?? `700 ${Math.floor(h * 0.6)}px "Chakra Petch", "Hiragino Sans", sans-serif`;
  g.fillStyle = opts.color ?? '#e5eef3';
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  g.fillText(text, opts.align === 'left' ? 4 : w / 2, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
