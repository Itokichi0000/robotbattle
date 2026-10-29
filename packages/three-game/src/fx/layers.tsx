import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { type DebrisPool, type ParticlePool, type Vec3Like, buildRibbon } from './pool';

const SPRITE_VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iParams;
uniform float uGrow;
uniform float uMode;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float maxLife = iParams.y;
  if (maxLife <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float u = clamp(iParams.x / maxLife, 0.0, 1.0);
  float size = iParams.z * max(0.05, 1.0 + uGrow * u);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 dir = (modelViewMatrix * vec4(iVel, 0.0)).xy;
  float speed = length(dir);
  vec2 axis = speed > 1e-4 ? dir / speed : vec2(0.0, 1.0);
  vec2 side = vec2(-axis.y, axis.x);
  // Fast sparks stretch into streaks: the stretch param is seconds of motion blur.
  float len = size + iParams.w * speed;
  mv.xy += side * position.x * size + axis * position.y * len;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  // Glow fades fast (hot then gone); smoke swells in, then thins out.
  float fade = uMode < 0.5 ? (1.0 - u) * (1.0 - u) : sin(u * 3.14159) * (1.0 - u * 0.5);
  vColor = vec4(iColor.rgb * iColor.a, fade);
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
uniform float uMode;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  if (uMode < 0.5) {
    float halo = (1.0 - d) * (1.0 - d);
    float core = smoothstep(0.45, 0.0, d);
    gl_FragColor = vec4(vColor.rgb * (halo + core * 1.5), vColor.a);
  } else {
    gl_FragColor = vec4(vColor.rgb, smoothstep(1.0, 0.0, d) * vColor.a * 0.55);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * GPU sprites for a ParticlePool: one instanced quad per particle, the pool's
 * arrays uploaded as instance attributes every frame. `glow` adds light
 * (sparks, embers, flashes); `smoke` blends normally and swells as it ages.
 */
export function SpriteLayer({ pool, mode }: { pool: ParticlePool; mode: 'glow' | 'smoke' }) {
  const mesh = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.getIndex());
    g.setAttribute('position', quad.getAttribute('position'));
    const attr = (array: Float32Array, size: number) =>
      new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', attr(pool.pos, 3));
    g.setAttribute('iVel', attr(pool.vel, 3));
    g.setAttribute('iColor', attr(pool.color, 4));
    g.setAttribute('iParams', attr(pool.params, 4));
    g.instanceCount = pool.capacity;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uGrow: { value: mode === 'glow' ? -0.5 : 1.6 },
        uMode: { value: mode === 'glow' ? 0 : 1 },
      },
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: mode === 'glow' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = mode === 'glow' ? 11 : 10;
    mesh.name = `fx-${mode}`;
    return mesh;
  }, [pool, mode]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );
  useFrame(() => {
    for (const name of ['iPos', 'iVel', 'iColor', 'iParams'])
      (mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  });
  if (pool.capacity === 0) return null;
  return <primitive object={mesh} />;
}

/** Tumbling armour chips (lit, dark metal) for a DebrisPool. */
export function DebrisLayer({ pool }: { pool: DebrisPool }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.45, 0.7),
      new THREE.MeshStandardMaterial({ color: '#2A2E38', metalness: 0.85, roughness: 0.38 }),
      Math.max(1, pool.capacity),
    );
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.name = 'fx-debris';
    return m;
  }, [pool]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      s: new THREE.Vector3(),
      zero: new THREE.Matrix4().makeScale(0, 0, 0),
    }),
    [],
  );
  useFrame(() => {
    for (let i = 0; i < pool.capacity; i++) {
      const i3 = i * 3;
      const maxLife = pool.params[i3 + 1]!;
      if (maxLife <= 0) {
        mesh.setMatrixAt(i, tmp.zero);
        continue;
      }
      const left = 1 - pool.params[i3]! / maxLife;
      const size = pool.params[i3 + 2]! * Math.min(1, left * 4);
      tmp.p.set(pool.pos[i3]!, pool.pos[i3 + 1]!, pool.pos[i3 + 2]!);
      tmp.q.setFromEuler(tmp.e.set(pool.rot[i3]!, pool.rot[i3 + 1]!, pool.rot[i3 + 2]!));
      tmp.s.set(size, size, size);
      mesh.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (pool.capacity === 0) return null;
  return <primitive object={mesh} />;
}

const RIBBON_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float x = abs(vUv.y - 0.5) * 2.0;
  float edge = (1.0 - x) * (1.0 - x);
  float core = smoothstep(0.4, 0.0, x);
  gl_FragColor = vec4((uColor * edge + uCore * core) * uOpacity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * A glowing strip along a polyline that always faces the camera (lightning,
 * enemy beams). Lines are one pixel wide in WebGL, too thin for a big screen.
 */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    readonly maxPoints: number,
    color: string,
    core: string,
    intensity: number,
  ) {
    this.positions = new Float32Array(maxPoints * 6);
    const uv = new Float32Array(maxPoints * 4);
    const index: number[] = [];
    for (let i = 0; i < maxPoints; i++) {
      uv.set([i / (maxPoints - 1), 0, i / (maxPoints - 1), 1], i * 4);
      if (i < maxPoints - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
        uCore: { value: new THREE.Color(core).multiplyScalar(intensity * 1.3) },
        uOpacity: { value: 0 },
      },
      vertexShader: RIBBON_VERTEX,
      fragmentShader: RIBBON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 12;
  }

  /** Lay the strip along `points` (at most maxPoints) facing `eye`. */
  set(points: readonly Vec3Like[], eye: Vec3Like, width: number, opacity: number): void {
    const pts = points.length > this.maxPoints ? points.slice(0, this.maxPoints) : points;
    const used = buildRibbon(pts, eye, width, this.positions);
    // Collapse unused vertices onto the last point.
    const last = Math.max(0, used - 6);
    for (let i = used; i < this.positions.length; i += 3) {
      this.positions[i] = this.positions[last]!;
      this.positions[i + 1] = this.positions[last + 1]!;
      this.positions[i + 2] = this.positions[last + 2]!;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.material.uniforms.uOpacity!.value = opacity;
    this.mesh.visible = opacity > 0.01 && used > 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
