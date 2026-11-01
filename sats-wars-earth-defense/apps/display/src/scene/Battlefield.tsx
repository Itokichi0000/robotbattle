import { useFrame } from '@react-three/fiber';
import type { ZoneId } from '@swed/shared';
import { COLORS } from '@swed/ui-tokens';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { anim } from './anim';
import { box, ngon } from './geometry';
import { getMaterials } from './materials';

/**
 * Deep space (D-034): RAIJIN on a floating defence platform, chasing the alien mothership
 * from Mars past the Moon to Earth. The planet of the current area hangs in the sky and is
 * replaced as the route goes on, so the hall can see where the fight is without reading.
 * Asteroids drift past for depth and a sense of travel.
 */

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFrag = /* glsl */ `
  uniform float uThreat;
  uniform float uTime;
  uniform vec3 uTint;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.004, 0.007, 0.016);
    // A faint galactic band across the sky, tilted, with dust lanes.
    vec3 bandN = normalize(vec3(0.25, 1.0, 0.35));
    float band = exp(-pow(dot(d, bandN) * 3.2, 2.0));
    float dust = fbm(d * 6.0);
    col += vec3(0.05, 0.055, 0.08) * band * smoothstep(0.35, 0.75, dust);
    // Nebula clouds: cold teal and violet, tinted toward the current area's planet.
    float n1 = fbm(d * 2.2 + vec3(3.1, 0.0, 1.7));
    float n2 = fbm(d * 3.7 + vec3(-2.0, 4.0, 0.5));
    col += vec3(0.03, 0.07, 0.09) * smoothstep(0.5, 0.85, n1);
    col += vec3(0.07, 0.025, 0.09) * smoothstep(0.55, 0.9, n2);
    col += uTint * 0.05 * smoothstep(0.45, 0.9, n1 * n2 * 1.8);
    // NULL CORE's red bloom ahead.
    vec3 bossDir = normalize(vec3(0.08, 0.38, -1.0));
    col += vec3(0.22, 0.012, 0.04) * pow(max(dot(d, bossDir), 0.0), 36.0) * uThreat;
    // Stars everywhere (no horizon in space), denser in the band.
    vec3 q = floor(d * 520.0);
    float h = hash(q);
    float s = step(0.9972 - band * 0.002, h);
    col += vec3(0.78, 0.86, 1.0) * s * (0.55 + 0.45 * sin(uTime * 1.7 + h * 50.0));
    vec3 q2 = floor(d * 160.0);
    col += vec3(1.0, 0.95, 0.85) * step(0.9993, hash(q2)) * 1.2;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ZONE_TINT: Record<ZoneId, THREE.Color> = {
  MARS: new THREE.Color('#ff7a3d'),
  MOON: new THREE.Color('#a9b4c8'),
  EARTH: new THREE.Color('#4f9dff'),
};

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: {
          uThreat: { value: 0 },
          uTime: { value: 0 },
          uTint: { value: ZONE_TINT.MARS.clone() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useFrame((s, dt) => {
    const boss = !!store.getState().snap?.state.boss;
    mat.uniforms.uTime!.value = s.clock.elapsedTime;
    const u = mat.uniforms.uThreat!;
    u.value += ((boss ? 1 : 0) - u.value) * Math.min(1, dt * 0.5);
    (mat.uniforms.uTint!.value as THREE.Color).lerp(ZONE_TINT[anim.zone], Math.min(1, dt));
  });
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[900, 48, 24]} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ planet */

const planetVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vWN;
  varying vec3 vView;
  void main() {
    vN = normalize(position);
    vWN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const planetFrag = /* glsl */ `
  uniform float uKind;   // 0 Mars, 1 Moon, 2 Earth
  uniform float uFade;
  uniform float uTime;
  uniform vec3 uSun;
  varying vec3 vN;
  varying vec3 vWN;
  varying vec3 vView;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
  void main() {
    vec3 n = normalize(vN);
    float lit = max(dot(normalize(vWN), normalize(uSun)), 0.0);
    float fres = pow(1.0 - max(dot(normalize(vWN), normalize(vView)), 0.0), 3.0);
    vec3 col;
    vec3 atmo = vec3(0.0);
    if (uKind < 0.5) {
      // Mars: rust plains, dark basalt, white polar caps.
      float f = fbm(n * 3.0);
      float dark = smoothstep(0.52, 0.66, fbm(n * 1.6 + 7.0));
      col = mix(vec3(0.55, 0.22, 0.10), vec3(0.85, 0.42, 0.20), f);
      col = mix(col, vec3(0.30, 0.12, 0.07), dark * 0.8);
      col = mix(col, vec3(0.92, 0.9, 0.88), smoothstep(0.86, 0.92, abs(n.y) + f * 0.05));
      atmo = vec3(0.9, 0.45, 0.25) * 0.35;
    } else if (uKind < 1.5) {
      // Moon: grey highlands, dark maria, crater speckle.
      float f = fbm(n * 4.0);
      float maria = smoothstep(0.5, 0.62, fbm(n * 1.3 + 3.0));
      float crater = smoothstep(0.7, 0.78, noise(n * 22.0)) - smoothstep(0.78, 0.86, noise(n * 22.0));
      col = mix(vec3(0.42, 0.42, 0.44), vec3(0.72, 0.72, 0.74), f);
      col = mix(col, vec3(0.22, 0.22, 0.25), maria * 0.75);
      col += crater * 0.12;
      atmo = vec3(0.0);
    } else {
      // Earth: deep oceans, green and brown land, drifting cloud.
      float land = fbm(n * 2.4 + 11.0);
      float isLand = smoothstep(0.52, 0.56, land);
      vec3 ocean = mix(vec3(0.02, 0.10, 0.28), vec3(0.05, 0.26, 0.55), fbm(n * 6.0));
      vec3 ground = mix(vec3(0.16, 0.36, 0.12), vec3(0.50, 0.40, 0.22), smoothstep(0.58, 0.7, land));
      col = mix(ocean, ground, isLand);
      col = mix(col, vec3(0.95), smoothstep(0.88, 0.94, abs(n.y)));
      float cloud = smoothstep(0.55, 0.75, fbm(n * 3.5 + vec3(uTime * 0.01, 0.0, 0.0)));
      col = mix(col, vec3(1.0), cloud * 0.8);
      atmo = vec3(0.35, 0.65, 1.0);
    }
    vec3 c = col * (0.03 + 1.25 * lit);
    // Night side city-like speckle only on Earth, so it reads as home.
    if (uKind > 1.5) c += vec3(1.0, 0.75, 0.4) * step(0.985, hash(floor(n * 180.0))) * (1.0 - lit) * 0.6;
    c += atmo * fres * (0.25 + lit);
    gl_FragColor = vec4(c, uFade);
  }
`;

const KIND: Record<ZoneId, number> = { MARS: 0, MOON: 1, EARTH: 2 };

/**
 * The planet of the current area, swapped with a short fade when the mothership moves on.
 * Within an area it grows slowly: the fight is getting closer to it.
 */
function Planet() {
  const ref = useRef<THREE.Mesh>(null);
  const shown = useRef<ZoneId>('MARS');
  const fade = useRef(1);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planetVert,
        fragmentShader: planetFrag,
        uniforms: {
          uKind: { value: 0 },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uSun: { value: new THREE.Vector3(-0.8, 0.35, 0.5) },
        },
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  useFrame((s, dt) => {
    mat.uniforms.uTime!.value = s.clock.elapsedTime;
    // Fade out, swap, fade in (about a second each way).
    if (shown.current !== anim.zone) {
      fade.current = Math.max(0, fade.current - dt * 1.2);
      if (fade.current === 0) {
        shown.current = anim.zone;
        mat.uniforms.uKind!.value = KIND[shown.current];
      }
    } else fade.current = Math.min(1, fade.current + dt * 0.9);
    mat.uniforms.uFade!.value = fade.current;
    const within = Math.min(1, Math.max(0, anim.route * 3 - KIND[shown.current]));
    const base = shown.current === 'MOON' ? 105 : shown.current === 'EARTH' ? 150 : 125;
    const grow = shown.current === 'EARTH' ? 0.8 + within * 0.45 : 0.85 + within * 0.25;
    if (ref.current) {
      ref.current.scale.setScalar(base * grow * (0.94 + 0.06 * fade.current));
      ref.current.rotation.y = s.clock.elapsedTime * 0.008;
    }
  });
  return (
    <mesh ref={ref} material={mat} position={[230, 95, -620]} renderOrder={-9}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}

/* --------------------------------------------------------------- asteroids */

/** Rocks drifting past the platform: depth, and the feeling of flying toward Earth. */
function Asteroids() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 90;
  const data = useMemo(() => {
    let s = 7;
    const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
    return Array.from({ length: count }, () => {
      const bearing = -170 + rnd() * 340;
      const dist = 140 + rnd() * 380;
      const r = (bearing * Math.PI) / 180;
      return {
        x: Math.sin(r) * dist,
        y: -70 + rnd() * 110,
        z: -Math.cos(r) * dist,
        s: 1.5 + Math.pow(rnd(), 2.5) * 16,
        rx: rnd() * 6,
        ry: rnd() * 6,
        spin: 0.05 + rnd() * 0.3,
      };
    });
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position!;
    let s = 3;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < p.count; i++) {
      const k = 0.7 + rnd() * 0.5;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3d3833',
        roughness: 0.95,
        metalness: 0.05,
        flatShading: true,
      }),
    [],
  );
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  useFrame((st) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = st.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const a = data[i]!;
      // Drift toward the camera and wrap: the platform is flying forward.
      const z = ((a.z + t * 6 + 600) % 700) - 600;
      v.set(a.x, a.y, z);
      e.set(a.rx + t * a.spin, a.ry + t * a.spin * 0.7, 0);
      q.setFromEuler(e);
      sc.setScalar(a.s);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />;
}

/* ---------------------------------------------------------------- platform */

function Platform() {
  const m = getMaterials();
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((s) => {
    if (glow.current) glow.current.opacity = 0.55 + 0.25 * Math.sin(s.clock.elapsedTime * 3);
  });
  return (
    <group>
      <mesh
        geometry={ngon(6, 17, 1.4)}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -0.7, 0]}
        material={m.ground}
        receiveShadow
        castShadow
      />
      <mesh
        geometry={ngon(6, 18.2, 0.6)}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -1.15, 0]}
        material={m.armorDark}
        receiveShadow
      />
      {/* Underside hull and hover thrusters: the platform flies, it does not stand. */}
      <mesh
        geometry={ngon(6, 12, 4)}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, -3.6, 0]}
        material={m.armorDark}
      />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        return (
          <group key={i}>
            <mesh
              rotation={[Math.PI / 2, 0, 0]}
              position={[Math.cos(a) * 9, -5.7, Math.sin(a) * 9]}
            >
              <circleGeometry args={[1.6, 16]} />
              <meshBasicMaterial
                ref={i === 0 ? glow : undefined}
                color="#7fe8ff"
                transparent
                opacity={0.7}
                toneMapped={false}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh
              geometry={box(2.6, 0.12, 0.12)}
              position={[Math.cos(a) * 15.4, 0.05, Math.sin(a) * 15.4]}
              rotation={[0, -a + Math.PI / 2, 0]}
            >
              <meshBasicMaterial color={COLORS.ally} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      {/* landing ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[7.6, 8.0, 6, 1]} />
        <meshBasicMaterial color={COLORS.action} transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ lights */

export function BattlefieldLights({ shadows }: { shadows: boolean }) {
  const boss = useRef<THREE.PointLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  const alarm = useRef<THREE.PointLight>(null);
  const surge = useRef<THREE.PointLight>(null);
  const bounce = useRef<THREE.PointLight>(null);
  useFrame((s, dt) => {
    const has = !!store.getState().snap?.state.boss;
    if (boss.current)
      boss.current.intensity = has ? 9000 + Math.sin(s.clock.elapsedTime * 2) * 1500 : 0;
    // Armour critical: the mech's own lights dim and a red emergency beacon turns (≤1 Hz).
    anim.blackout += (anim.blackoutTarget - anim.blackout) * Math.min(1, dt * 2.5);
    const b = anim.blackout;
    if (hemi.current) hemi.current.intensity = 0.5 * (1 - 0.65 * b);
    if (key.current) key.current.intensity = 1.9 * (1 - 0.55 * b);
    if (rim.current) rim.current.intensity = 2.4 * (1 - 0.75 * b);
    if (alarm.current) {
      const t = s.clock.elapsedTime;
      alarm.current.position.set(Math.sin(t * 2.4) * 9, 16, Math.cos(t * 2.4) * 9);
      alarm.current.intensity = b * 1800;
    }
    if (surge.current)
      surge.current.intensity = anim.gaugeFull ? 900 + Math.sin(s.clock.elapsedTime * 4) * 250 : 0;
    // The current area's planet lights the platform a little in its own colour.
    if (bounce.current) bounce.current.color.lerp(ZONE_TINT[anim.zone], Math.min(1, dt));
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#2a4258', '#05070a', 0.5]} />
      <pointLight ref={alarm} intensity={0} distance={60} decay={2} color={COLORS.danger} />
      <pointLight
        ref={surge}
        position={[0, 10, -4]}
        intensity={0}
        distance={40}
        decay={2}
        color="#9ff3ff"
      />
      {/* Hard white sun from above-left-behind: carves the armour (no air to soften it). */}
      <directionalLight
        ref={key}
        position={[-40, 70, 30]}
        intensity={1.9}
        color="#f2f4ff"
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-5}
        shadow-camera-near={10}
        shadow-camera-far={160}
        shadow-bias={-0.0004}
      />
      {/* Strong cyan rim from the front-right so the silhouette reads against the stars. */}
      <directionalLight ref={rim} position={[30, 20, -40]} intensity={2.4} color="#7fdcff" />
      <pointLight
        ref={bounce}
        position={[60, 30, -120]}
        intensity={5000}
        distance={260}
        decay={2}
        color={ZONE_TINT.MARS}
      />
      <pointLight
        ref={boss}
        position={[18, 70, -150]}
        intensity={0}
        distance={320}
        decay={2}
        color={COLORS.danger}
      />
    </>
  );
}

export function Battlefield() {
  return (
    <group>
      <Sky />
      <Planet />
      <Asteroids />
      <Platform />
    </group>
  );
}
