import * as THREE from 'three';

/**
 * Hard-surface building blocks: chamfered prisms extruded from 2D outlines. Chamfers catch
 * the rim light, which is what makes a block read as machined armour instead of a toy cube.
 * Geometries are cached by key: one RAIJIN shares a few dozen buffers.
 */

const cache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

/** Extrudes a closed XY outline along Z (depth d, centred) with a flat chamfer. */
export function prism(
  points: Array<[number, number]>,
  d: number,
  chamfer = 0.06,
): THREE.BufferGeometry {
  const key = `p:${points.map((p) => p.join(',')).join(';')}:${d}:${chamfer}`;
  return cached(key, () => {
    const c = Math.min(chamfer, d * 0.3);
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, d - 2 * c),
      bevelEnabled: c > 0,
      bevelThickness: c,
      bevelSize: c * 0.8,
      bevelSegments: 1,
      steps: 1,
    });
    g.center();
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Box with chamfered corners in the XY outline, chamfered faces in Z, and an optional taper
 * (top width = w * taper) for wedge-like armour.
 */
export function plate(w: number, h: number, d: number, opts: { c?: number; taper?: number } = {}) {
  const c = opts.c ?? Math.min(w, h) * 0.14;
  const tw = (w * (opts.taper ?? 1)) / 2;
  const bw = w / 2;
  const hh = h / 2;
  const pts: Array<[number, number]> = [
    [-bw + c, -hh],
    [bw - c, -hh],
    [bw, -hh + c],
    [tw, hh - c],
    [tw - c, hh],
    [-tw + c, hh],
    [-tw, hh - c],
    [-bw, -hh + c],
  ];
  return prism(pts, d, Math.min(0.08, d * 0.18));
}

/** Regular n-gon prism, e.g. hexagonal reactor housings. */
export function ngon(n: number, r: number, d: number, rotation = 0) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return prism(pts, d, Math.min(0.05, d * 0.2));
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 16, open = false) {
  return cached(
    `c:${rTop}:${rBottom}:${h}:${seg}:${open}`,
    () => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open),
  );
}

export function box(w: number, h: number, d: number) {
  return cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function sphere(r: number, w = 16, h = 12) {
  return cached(`s:${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
}

export function torus(r: number, tube: number, seg = 32) {
  return cached(`t:${r}:${tube}:${seg}`, () => new THREE.TorusGeometry(r, tube, 6, seg));
}
