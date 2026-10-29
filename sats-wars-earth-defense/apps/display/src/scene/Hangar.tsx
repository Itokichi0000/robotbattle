import { useFrame } from '@react-three/fiber';
import { COLORS } from '@swed/ui-tokens';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { anim } from './anim';
import { box, cylinder } from './geometry';
import { getMaterials, textTexture } from './materials';

/**
 * Launch hangar (reference 02 as art direction, not copied): a tall dark hall, catwalks
 * and people for scale, warm work lamps against cold rim light, haze in the light shafts.
 * `hatch` 0..1 opens the roof for the launch.
 */

function Catwalk({ y, z, width }: { y: number; z: number; width: number }) {
  const m = getMaterials();
  return (
    <group position={[0, y, z]}>
      <mesh geometry={box(width, 0.18, 1.6)} material={m.armorDark} receiveShadow castShadow />
      <mesh geometry={box(width, 0.06, 0.06)} position={[0, 0.9, -0.78]} material={m.frame} />
      <mesh geometry={box(width, 0.06, 0.06)} position={[0, 0.5, -0.78]} material={m.frame} />
      {Array.from({ length: Math.floor(width / 2) }, (_, i) => (
        <mesh
          key={i}
          geometry={box(0.06, 0.9, 0.06)}
          position={[-width / 2 + 1 + i * 2, 0.45, -0.78]}
          material={m.frame}
        />
      ))}
      {/* amber deck lamps */}
      {Array.from({ length: Math.floor(width / 4) }, (_, i) => (
        <mesh
          key={`l${i}`}
          geometry={box(0.3, 0.08, 0.12)}
          position={[-width / 2 + 2 + i * 4, 0.12, -0.82]}
        >
          <meshBasicMaterial color="#ffb45a" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** A crew member: about 1.8 m (0.45 units) next to a 50 m machine. */
function Worker({ position, rot = 0 }: { position: [number, number, number]; rot?: number }) {
  const m = getMaterials();
  return (
    <group position={position} rotation={[0, rot, 0]}>
      <mesh geometry={box(0.16, 0.24, 0.1)} position={[0, 0.3, 0]} material={m.frame} />
      <mesh geometry={box(0.06, 0.2, 0.06)} position={[-0.05, 0.1, 0]} material={m.frame} />
      <mesh geometry={box(0.06, 0.2, 0.06)} position={[0.05, 0.1, 0]} material={m.frame} />
      <mesh
        geometry={cylinder(0.06, 0.06, 0.08, 8)}
        position={[0, 0.47, 0]}
        material={m.armorLight}
      />
    </group>
  );
}

function LightShaft({
  position,
  color,
  height,
  radius,
  opacity,
}: {
  position: [number, number, number];
  color: string;
  height: number;
  radius: number;
  opacity: number;
}) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
        vertexShader: /* glsl */ `
          varying float vY; varying vec3 vN; varying vec3 vV;
          void main() {
            vY = uv.y;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uOpacity;
          varying float vY; varying vec3 vN; varying vec3 vV;
          void main() {
            float edge = pow(abs(dot(vN, vV)), 1.5);
            float a = uOpacity * edge * smoothstep(0.0, 1.0, vY);
            gl_FragColor = vec4(uColor * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [color, opacity],
  );
  return (
    <mesh position={position} material={mat}>
      <cylinderGeometry args={[0.4, radius, height, 24, 1, true]} />
    </mesh>
  );
}

function Dust() {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = 600;
    const pos = new Float32Array(n * 3);
    let s = 5;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 40;
      pos[i * 3 + 1] = rnd() * 26;
      pos[i * 3 + 2] = (rnd() - 0.5) * 30;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.01;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#c9d6e0" size={0.05} transparent opacity={0.35} depthWrite={false} />
    </points>
  );
}

export function HangarLights({ shadows }: { shadows: boolean }) {
  const beacon = useRef<THREE.SpotLight>(null);
  // Spots aim at the chest, not the floor, so the machine is lit and the floor stays dark.
  const chest = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, 9, 0);
    return o;
  }, []);
  useFrame((s) => {
    if (beacon.current) {
      const a = s.clock.elapsedTime * 3.2;
      beacon.current.target.position.set(Math.cos(a) * 10, 0, Math.sin(a) * 10);
      beacon.current.target.updateMatrixWorld();
      beacon.current.intensity = anim.alarm * 5000;
    }
  });
  return (
    <>
      <hemisphereLight args={['#1d3040', '#050709', 0.22]} />
      {/* Warm key from high left-behind: sculpts the armour edges, leaves the front in shadow. */}
      <primitive object={chest} />
      <spotLight
        target={chest}
        position={[-15, 30, 9]}
        angle={0.5}
        penumbra={0.65}
        intensity={5200}
        distance={90}
        decay={2}
        color="#ffd2a0"
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
      />
      {/* Cold top-front light, low, just enough to read the chest and visor. */}
      <spotLight
        target={chest}
        position={[11, 30, -16]}
        angle={0.3}
        penumbra={0.8}
        intensity={1500}
        distance={80}
        decay={2}
        color="#a8d4ff"
      />
      {/* Strong cyan rim from behind. */}
      <directionalLight position={[2, 16, 30]} intensity={3.2} color="#6fd0ff" />
      <pointLight position={[-7, 5.5, -2]} intensity={70} distance={16} decay={2} color="#ffaa55" />
      <pointLight position={[7, 10.5, -1]} intensity={70} distance={16} decay={2} color="#ffaa55" />
      <spotLight
        ref={beacon}
        position={[0, 26, -12]}
        angle={0.5}
        penumbra={0.3}
        intensity={0}
        distance={70}
        decay={2}
        color={COLORS.action}
      />
    </>
  );
}

export function Hangar() {
  const m = getMaterials();
  const hatchL = useRef<THREE.Mesh>(null);
  const hatchR = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (hatchL.current) hatchL.current.position.x = -7.2 - anim.hatch * 13;
    if (hatchR.current) hatchR.current.position.x = 7.2 + anim.hatch * 13;
  });
  const banner = useMemo(
    () =>
      textTexture('雷神', {
        font: '700 300px "Hiragino Mincho ProN", "Yu Mincho", serif',
        color: '#d9dee2',
        width: 512,
        height: 512,
      }),
    [],
  );
  const bannerSub = useMemo(
    () =>
      textTexture('RAIJIN-01 / SATS DEFENSE NETWORK', {
        color: '#93aebc',
        width: 1024,
        height: 96,
      }),
    [],
  );
  const floorStripes = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 32;
    const g = cv.getContext('2d')!;
    for (let i = -2; i < 20; i++) {
      g.fillStyle = i % 2 ? '#d8a23c' : '#111';
      g.beginPath();
      g.moveTo(i * 16, 32);
      g.lineTo(i * 16 + 16, 32);
      g.lineTo(i * 16 + 32, 0);
      g.lineTo(i * 16 + 16, 0);
      g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.hangarFloor}>
        <planeGeometry args={[90, 90]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, s * 6.5]}>
          <planeGeometry args={[18, 0.6]} />
          <meshStandardMaterial map={floorStripes} roughness={0.6} />
        </mesh>
      ))}
      {/* walls: ribs and panels */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 24, 0, 0]}>
          <mesh
            geometry={box(1, 46, 70)}
            position={[side * 1.5, 23, 0]}
            material={m.armorDark}
            receiveShadow
          />
          {Array.from({ length: 9 }, (_, i) => (
            <mesh
              key={i}
              geometry={box(1.4, 46, 1.2)}
              position={[0, 23, -32 + i * 8]}
              material={m.frame}
            />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <mesh
              key={`h${i}`}
              geometry={box(0.3, 0.3, 70)}
              position={[-side * 0.6, 6 + i * 8, 0]}
              material={m.joint}
            />
          ))}
        </group>
      ))}
      <mesh geometry={box(50, 46, 1)} position={[0, 23, 22]} material={m.armorDark} />
      {/* ceiling trusses and the launch hatch */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={i}
          geometry={box(50, 1.2, 1.2)}
          position={[0, 40, -24 + i * 8]}
          material={m.frame}
        />
      ))}
      <mesh
        ref={hatchL}
        geometry={box(14, 0.8, 18)}
        position={[-7.2, 41.5, 0]}
        material={m.armorDark}
      />
      <mesh
        ref={hatchR}
        geometry={box(14, 0.8, 18)}
        position={[7.2, 41.5, 0]}
        material={m.armorDark}
      />
      {/* gantry towers and catwalks */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 8.2, 0, 0.5]}>
          {[-2.2, 2.2].map((z) => (
            <mesh
              key={z}
              geometry={box(0.5, 30, 0.5)}
              position={[0, 15, z]}
              material={m.frame}
              castShadow
            />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <mesh
              key={i}
              geometry={box(0.18, 3.2, 0.18)}
              position={[0, 1.5 + i * 3, 0]}
              rotation={[i % 2 ? 0.95 : -0.95, 0, 0]}
              material={m.frame}
            />
          ))}
        </group>
      ))}
      {/* Catwalks run alongside and behind the machine so its front stays clear. */}
      <group position={[-7.4, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Catwalk y={4.6} z={0} width={16} />
        <Catwalk y={9.8} z={0} width={16} />
      </group>
      <group position={[7.4, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Catwalk y={4.6} z={0} width={16} />
        <Catwalk y={9.8} z={0} width={16} />
      </group>
      <Catwalk y={7.2} z={4.2} width={14} />
      <Worker position={[-7.4, 4.69, -2.5]} rot={-0.9} />
      <Worker position={[-7.2, 4.69, -1.8]} rot={-1.4} />
      <Worker position={[7.3, 9.89, -1.2]} rot={1.6} />
      <Worker position={[4.1, 0, -9]} rot={3.1} />
      <Worker position={[4.7, 0, -9.4]} rot={2.7} />
      <Worker position={[-3.5, 0, -10.5]} rot={0.2} />
      {/* the banner, hanging on the right wall */}
      <group position={[18.5, 21, 6]} rotation={[0, -Math.PI / 2 + 0.35, 0]}>
        <mesh>
          <planeGeometry args={[7, 20]} />
          <meshStandardMaterial color="#1a222a" roughness={0.9} />
        </mesh>
        <mesh position={[0, 3, 0.02]}>
          <planeGeometry args={[6.2, 6.2]} />
          <meshStandardMaterial map={banner} transparent roughness={0.9} depthWrite={false} />
        </mesh>
        <mesh position={[0, -6, 0.02]} rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[14, 1.3]} />
          <meshStandardMaterial map={bannerSub} transparent roughness={0.9} depthWrite={false} />
        </mesh>
      </group>
      <LightShaft position={[-9, 15, -14]} color="#ffcf8a" height={30} radius={7} opacity={0.08} />
      <LightShaft position={[10, 14, -10]} color="#a9d8ff" height={28} radius={6} opacity={0.06} />
      <Dust />
    </group>
  );
}
