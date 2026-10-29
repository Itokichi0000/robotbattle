import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

let blob: THREE.CanvasTexture | null = null;
let floor: THREE.CanvasTexture | null = null;

/** Soft dark disc, drawn once (no image files). */
function blobTexture(): THREE.CanvasTexture | null {
  if (blob) return blob;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blob = new THREE.CanvasTexture(c);
  blob.colorSpace = THREE.SRGBColorSpace;
  return blob;
}

/**
 * The stage as a dark tactical table (spec 3.3.2): steel deck panels with
 * faint seams, range rings and bearing ticks. Low contrast on purpose so the
 * robots and the hologram carry the picture.
 */
export function tacticalFloorTexture(): THREE.CanvasTexture | null {
  if (floor) return floor;
  if (typeof document === 'undefined') return null;
  const n = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#0B131A';
  g.fillRect(0, 0, n, n);
  // Deck panels: slightly different tones, dark seams.
  const cell = n / 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = 15 + ((x * 7 + y * 13) % 5);
      g.fillStyle = `rgb(${v - 4},${v + 3},${v + 9})`;
      g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, n);
    g.moveTo(0, i * cell);
    g.lineTo(n, i * cell);
    g.stroke();
  }
  // Range rings and bearing ticks (tactical overlay).
  const cx = n / 2;
  g.strokeStyle = 'rgba(72,200,217,0.16)';
  g.lineWidth = 1.5;
  for (const r of [0.18, 0.3, 0.42]) {
    g.beginPath();
    g.arc(cx, cx, r * n, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = 'rgba(72,200,217,0.22)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 0.44 : 0.465;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0 * n, cx + Math.sin(a) * r0 * n);
    g.lineTo(cx + Math.cos(a) * 0.48 * n, cx + Math.sin(a) * 0.48 * n);
    g.stroke();
  }
  floor = new THREE.CanvasTexture(c);
  floor.colorSpace = THREE.SRGBColorSpace;
  floor.anisotropy = 4;
  return floor;
}

/**
 * Contact shadow under a robot: a soft blob on the stage that tightens as
 * the feet land and fades as the machine lifts (Fujin hovers). Works at every
 * quality level, shadow maps or not.
 */
export function ContactShadow({
  root,
  radius = 1.6,
  strength = 0.75,
}: {
  /** The rig root whose height above the stage drives the fade. */
  root: THREE.Object3D;
  radius?: number;
  strength?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: strength,
        color: '#000000',
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [strength],
  );
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const lift = Math.max(0, root.position.y);
    mat.opacity = strength * Math.max(0.2, 1 - lift / 3);
    m.scale.setScalar(radius * (1 + lift * 0.12));
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0.15]} material={mat}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
