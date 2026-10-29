import * as THREE from 'three';

/**
 * World → screen anchors. 3D components register an Object3D; a projector inside the
 * canvas writes stage-space pixels each frame; HUD markers read them in their own rAF loop
 * (no React re-render per frame). Labels therefore stick to the thing they describe.
 */

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
  /** Distance from camera, for label scaling. */
  depth: number;
}

const objects = new Map<string, THREE.Object3D>();
export const screen = new Map<string, ScreenPoint>();

export function registerAnchor(id: string, obj: THREE.Object3D | null): void {
  if (obj) objects.set(id, obj);
  else {
    objects.delete(id);
    screen.delete(id);
  }
}

const v = new THREE.Vector3();

export function projectAnchors(camera: THREE.Camera, width: number, height: number): void {
  for (const [id, obj] of objects) {
    obj.getWorldPosition(v);
    const depth = v.distanceTo(camera.position);
    v.project(camera);
    const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
    screen.set(id, { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, visible, depth });
  }
}

export function anchorWorldPosition(id: string, out: THREE.Vector3): boolean {
  const o = objects.get(id);
  if (!o) return false;
  o.getWorldPosition(out);
  return true;
}
