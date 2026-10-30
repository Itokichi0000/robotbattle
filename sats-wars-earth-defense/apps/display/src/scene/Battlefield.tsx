import { useFrame } from '@react-three/fiber';
import { COLORS } from '@swed/ui-tokens';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../net';
import { anim } from './anim';
import { box, cylinder, ngon } from './geometry';
import { getMaterials } from './materials';

/**
 * Tokyo Bay at night: RAIJIN on a sea platform, the city line behind the swarm, and a
 * cold sky that turns red where NULL CORE hangs. Depth comes from fog and city glow.
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
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    float h = clamp(vDir.y, -0.2, 1.0);
    vec3 zenith = vec3(0.006, 0.014, 0.03);
    vec3 horizon = vec3(0.035, 0.07, 0.11);
    vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
    // City glow on the horizon, warm and low.
    col += vec3(0.16, 0.07, 0.03) * exp(-max(h, 0.0) * 22.0) * smoothstep(-0.6, 0.6, -vDir.z);
    // NULL CORE's red bloom in the sky ahead.
    vec3 bossDir = normalize(vec3(0.08, 0.38, -1.0));
    float b = max(dot(vDir, bossDir), 0.0);
    col += vec3(0.20, 0.01, 0.035) * pow(b, 40.0) * uThreat;
    // Stars, thinning toward the horizon.
    vec3 q = floor(vDir * 420.0);
    float s = step(0.9965, hash(q)) * smoothstep(0.08, 0.5, h);
    col += vec3(0.75, 0.85, 1.0) * s * (0.5 + 0.5 * sin(uTime * 2.0 + hash(q) * 40.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: { uThreat: { value: 0 }, uTime: { value: 0 } },
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
  });
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[900, 32, 16]} />
    </mesh>
  );
}

function waterNormals(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.sin((x / size) * Math.PI * 8 + Math.sin((y / size) * Math.PI * 6) * 1.5);
      const b = Math.cos((y / size) * Math.PI * 10 + Math.sin((x / size) * Math.PI * 4));
      const i = (y * size + x) * 4;
      img.data[i] = 128 + a * 40;
      img.data[i + 1] = 128 + b * 40;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function Sea() {
  const tex = useMemo(waterNormals, []);
  useFrame((_, dt) => {
    tex.offset.x += dt * 0.004;
    tex.offset.y += dt * 0.002;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
      <planeGeometry args={[2400, 2400]} />
      <meshStandardMaterial
        color="#04101a"
        roughness={0.18}
        metalness={0.7}
        normalMap={tex}
        normalScale={new THREE.Vector2(0.35, 0.35)}
      />
    </mesh>
  );
}

function Platform() {
  const m = getMaterials();
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
      {/* landing ring and edge lights */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[7.6, 8.0, 6, 1]} />
        <meshBasicMaterial color={COLORS.action} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <group key={i}>
            <mesh
              geometry={cylinder(1.2, 1.6, 14, 8)}
              position={[Math.cos(a) * 13, -8, Math.sin(a) * 13]}
              material={m.armorDark}
            />
            <mesh
              geometry={box(2.6, 0.12, 0.12)}
              position={[Math.cos(a + Math.PI / 6) * 15.4, 0.05, Math.sin(a + Math.PI / 6) * 15.4]}
              rotation={[0, -a - Math.PI / 6 + Math.PI / 2, 0]}
            >
              <meshBasicMaterial color={COLORS.ally} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function windowsTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  let s = 3;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 4; y < 256; y += 8) {
    for (let x = 4; x < 128; x += 7) {
      if (rnd() < 0.42) {
        const warm = rnd() < 0.8;
        g.fillStyle = warm
          ? `rgba(255,${170 + Math.floor(rnd() * 60)},110,1)`
          : 'rgba(150,210,255,1)';
        g.fillRect(x, y, 4, 4);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The city behind the battle: what RAIJIN is protecting. */
function Skyline() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 340;
  const mat = useMemo(() => {
    const tex = windowsTexture();
    return new THREE.MeshStandardMaterial({
      color: '#0a0f14',
      roughness: 0.8,
      metalness: 0.3,
      emissive: '#ffffff',
      emissiveMap: tex,
      emissiveIntensity: 0.9,
    });
  }, []);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const ready = useRef(false);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh || ready.current) return;
    ready.current = true;
    const m4 = new THREE.Matrix4();
    let s = 99;
    const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < count; i++) {
      const bearing = -150 + rnd() * 300;
      const dist = 230 + rnd() * 260;
      const r = (bearing * Math.PI) / 180;
      const h = 6 + Math.pow(rnd(), 2.2) * 70;
      const w = 5 + rnd() * 10;
      m4.compose(
        new THREE.Vector3(Math.sin(r) * dist, -1.2, -Math.cos(r) * dist),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0)),
        new THREE.Vector3(w, h, w * (0.6 + rnd() * 0.8)),
      );
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />;
}

export function BattlefieldLights({ shadows }: { shadows: boolean }) {
  const boss = useRef<THREE.PointLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  const alarm = useRef<THREE.PointLight>(null);
  const surge = useRef<THREE.PointLight>(null);
  useFrame((s, dt) => {
    const has = !!store.getState().snap?.state.boss;
    if (boss.current)
      boss.current.intensity = has ? 9000 + Math.sin(s.clock.elapsedTime * 2) * 1500 : 0;
    // REACTOR BLACKOUT: the mech's own lights die and a red emergency beacon turns (≤1 Hz).
    anim.blackout += (anim.blackoutTarget - anim.blackout) * Math.min(1, dt * 2.5);
    const b = anim.blackout;
    if (hemi.current) hemi.current.intensity = 0.55 * (1 - 0.65 * b);
    if (key.current) key.current.intensity = 1.6 * (1 - 0.55 * b);
    if (rim.current) rim.current.intensity = 2.4 * (1 - 0.75 * b);
    if (alarm.current) {
      const t = s.clock.elapsedTime;
      alarm.current.position.set(Math.sin(t * 2.4) * 9, 16, Math.cos(t * 2.4) * 9);
      alarm.current.intensity = b * 1800;
    }
    // OVERCHARGE: a cool surge light breathing on the chest reactor.
    if (surge.current)
      surge.current.intensity = anim.overcharge ? 900 + Math.sin(s.clock.elapsedTime * 4) * 250 : 0;
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#2a4258', '#06090c', 0.55]} />
      <pointLight ref={alarm} intensity={0} distance={60} decay={2} color={COLORS.danger} />
      <pointLight
        ref={surge}
        position={[0, 10, -4]}
        intensity={0}
        distance={40}
        decay={2}
        color="#9ff3ff"
      />
      {/* Cold moon key from above-left-behind: carves the armour. */}
      <directionalLight
        ref={key}
        position={[-40, 70, 30]}
        intensity={1.6}
        color="#bcd2ff"
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
      {/* Strong cyan rim from the front-right so the silhouette reads against the sky. */}
      <directionalLight ref={rim} position={[30, 20, -40]} intensity={2.4} color="#7fdcff" />
      {/* Warm city bounce from below the horizon. */}
      <pointLight
        position={[0, 4, -120]}
        intensity={6000}
        distance={260}
        decay={2}
        color="#ff9b50"
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
      <Sea />
      <Platform />
      <Skyline />
    </group>
  );
}
