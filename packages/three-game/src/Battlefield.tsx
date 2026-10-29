import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { CityState, RegionId } from '@sats-wars/shared';
import { REGION_IDS } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import {
  BOSS_POSITION,
  CORRUPT_RED,
  horizonCityPosition,
  ROBOT_HOME,
  SEA_LEVEL,
  TEAM_COLORS,
} from './layout';
import type { CityThreat } from './MapOverlay';

/**
 * The venue stage (D-073): Tokyo Bay at the blue hour. A steel defence deck
 * juts into the bay; NULL CORE hangs over the water; the eight cities glow
 * along the horizon and go dark when they fall. Everything is generated here
 * (no image files) except the optional CC0 HDRI used for reflections.
 * Presentation only: city lights follow server state passed in as props.
 */
export interface BattlefieldProps {
  cities: CityState[];
  threats: Partial<Record<RegionId, CityThreat>>;
  cityMaxHp: number;
  director: ArenaDirector;
  reducedMotion: boolean;
  shadows: boolean;
  /** Atmosphere extras (search beams, embers, light shafts). */
  detail: 'low' | 'medium' | 'high';
  /** Equirectangular .hdr for reflections; a procedural night bay otherwise. */
  envUrl?: string;
  envIntensity: number;
}

/** Fog and the lower sky share this colour so the bay fades into the horizon. */
export const BAY_FOG = '#1A2340';
export const BAY_FOG_DENSITY = 0.0021;

export function Battlefield(props: BattlefieldProps) {
  const lowDetail = props.detail === 'low';
  return (
    <group name="battlefield">
      <BayEnvironment url={props.envUrl} intensity={props.envIntensity} />
      <Sky />
      <Mountains />
      <Sea />
      <Deck />
      <BattleLighting shadows={props.shadows} />
      <Floodlights shafts={!lowDetail} />
      {!lowDetail && <SearchBeams director={props.director} reducedMotion={props.reducedMotion} />}
      <Cities
        cities={props.cities}
        threats={props.threats}
        cityMaxHp={props.cityMaxHp}
        director={props.director}
        reducedMotion={props.reducedMotion}
      />
      {props.detail === 'high' && <Embers reducedMotion={props.reducedMotion} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// light and air
// ---------------------------------------------------------------------------

/**
 * Reflections: the HDRI (rotated so its bright horizon sits behind NULL CORE)
 * or, until it loads or if it fails, a procedural bay at dusk.
 */
function BayEnvironment({ url, intensity }: { url?: string; intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = new THREE.Scene();
    const disposables: Array<{ dispose(): void }> = [];
    const band = (color: string, k: number, y: number, h: number) => {
      const geo = new THREE.CylinderGeometry(40, 40, h, 32, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(k),
        side: THREE.BackSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      env.add(m);
      disposables.push(geo, mat);
    };
    band('#0B1530', 1, 20, 40);
    band('#3A2E4C', 1.2, 2, 6);
    band('#C26A3A', 1.4, -0.2, 1.6);
    band('#0A1020', 1, -15, 28);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(CORRUPT_RED).multiplyScalar(2) }),
    );
    glow.position.set(0, 8, -39);
    env.add(glow);
    disposables.push(glow.geometry, glow.material as THREE.Material);
    const fallback = pmrem.fromScene(env, 0.04);
    scene.environment = fallback.texture;
    scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, Math.PI * 0.5, 0);
    let hdr: THREE.WebGLRenderTarget | null = null;
    let cancelled = false;
    if (url)
      new HDRLoader().load(
        url,
        (tex) => {
          if (cancelled) return tex.dispose();
          tex.mapping = THREE.EquirectangularReflectionMapping;
          hdr = pmrem.fromEquirectangular(tex);
          tex.dispose();
          scene.environment = hdr.texture;
        },
        undefined,
        () => {
          // keep the procedural bay
        },
      );
    return () => {
      cancelled = true;
      if (scene.environment === fallback.texture || scene.environment === hdr?.texture)
        scene.environment = null;
      fallback.dispose();
      hdr?.dispose();
      pmrem.dispose();
      for (const d of disposables) d.dispose();
    };
  }, [gl, scene, url, intensity]);
  return null;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

// Blue hour over the bay: navy zenith, a violet band, a burning horizon toward
// the cities, still stars (no twinkle) and a low moon.
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uMoon;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.012, 0.024, 0.07);
  vec3 mid = vec3(0.05, 0.07, 0.16);
  vec3 band = vec3(0.12, 0.09, 0.17);
  vec3 col = mix(mid, zenith, smoothstep(0.08, 0.6, h));
  col = mix(band, col, smoothstep(0.0, 0.16, h));
  // the cities burn along the horizon in front of the deck (-Z)
  float front = smoothstep(-0.2, 0.9, -d.z);
  col += vec3(0.55, 0.2, 0.08) * exp(-max(h, 0.0) * 30.0) * front * 0.4;
  col = mix(col, vec3(0.1, 0.12, 0.2), smoothstep(0.0, -0.05, h));
  // stars, fixed (no flicker), only well above the haze
  vec3 g = floor(d * 380.0);
  float s = step(0.9975, hash(g)) * smoothstep(0.15, 0.4, h);
  col += vec3(0.75, 0.8, 1.0) * s * (0.4 + 0.6 * hash(g + 3.1));
  // moon and halo
  float m = max(dot(d, normalize(uMoon)), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * 1.6;
  col += vec3(0.25, 0.32, 0.55) * pow(m, 180.0) * 0.6;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { uMoon: { value: new THREE.Vector3(-0.55, 0.32, -0.77) } },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} renderOrder={-10} frustumCulled={false} name="bay-sky">
      <sphereGeometry args={[400, 48, 24]} />
    </mesh>
  );
}

/** Ridges along the far shore, dark against the burning horizon. */
function Mountains() {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const idx: number[] = [];
    const n = 140;
    for (let i = 0; i <= n; i++) {
      const a = THREE.MathUtils.degToRad(-110 + (220 * i) / n);
      const r = 900;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const h =
        34 +
        26 * Math.sin(i * 0.21) +
        18 * Math.sin(i * 0.53 + 1.3) +
        10 * Math.sin(i * 1.7 + 0.4) +
        (i % 7 === 3 ? 16 : 0);
      pos.push(x, SEA_LEVEL - 1, z, x, SEA_LEVEL + Math.max(3, h), z);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} name="bay-ridges" renderOrder={-9}>
      <meshBasicMaterial color="#0A0F1E" fog={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Tileable wave normals from a sum of integer-frequency sines (no image file). */
function waveNormals(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const waves: Array<[number, number, number, number]> = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rnd() - 0.5) * 2 * (2 + i * 0.6));
    const ky = Math.round((rnd() - 0.5) * 2 * (2 + i * 0.6)) || 1;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / (1 + i * 0.35)]);
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, ph, amp] of waves) {
        const t = ((kx * x + ky * y) / size) * Math.PI * 2 + ph;
        const c = Math.cos(t) * amp;
        dx += c * kx;
        dy += c * ky;
      }
      const n = new THREE.Vector3(-dx * 0.03, -dy * 0.03, 1).normalize();
      const o = (y * size + x) * 4;
      data[o] = (n.x * 0.5 + 0.5) * 255;
      data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The bay: a glossy dark surface whose normals come from two copies of the
 * wave texture drifting in different directions, so the reflected lights
 * break up the way water does.
 */
function Sea() {
  const { mat, tex, time } = useMemo(() => {
    const tex = waveNormals();
    // ~5 m wave tiles across the 900 x 600 m bay
    tex.repeat.set(170, 115);
    const time = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({
      color: '#060C18',
      roughness: 0.12,
      metalness: 0.0,
      normalMap: tex,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 0.8,
      // seen from below too: the seat bay sits under the deck (cockpit camera)
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          vec2 seaUv = vNormalMapUv;
          vec3 n1 = texture2D(normalMap, seaUv * 1.0 + vec2(uTime * 0.006, uTime * 0.004)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, seaUv * 2.3 + vec2(-uTime * 0.005, uTime * 0.007)).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z));
          normal = normalize(tbn * mapN);
          `,
        );
    };
    return { mat, tex, time };
  }, []);
  useEffect(
    () => () => {
      mat.dispose();
      tex.dispose();
    },
    [mat, tex],
  );
  useFrame((_, dt) => {
    time.value += Math.min(dt, 0.1);
  });
  return (
    <mesh
      material={mat}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, SEA_LEVEL, -120]}
      receiveShadow
      name="bay-sea"
    >
      <planeGeometry args={[900, 600, 1, 1]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// the deck
// ---------------------------------------------------------------------------

const DECK = { width: 34, depth: 30, front: -12, thick: 1.6 };

/**
 * Deck paint: steel plates, a hazard edge on the sea side, the two launch pads
 * (amber 01, teal 02), a centre lane, stencils and scorch marks. The second
 * canvas is the roughness: wet patches stay glossy and catch the floodlights.
 */
function deckTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const S = 2048;
  const px = (m: number) => (m / DECK.width) * S;
  const wx = (x: number) => ((x + DECK.width / 2) / DECK.width) * S;
  const wz = (z: number) => ((z - DECK.front) / DECK.depth) * S;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2B3036';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // plates with slightly different tones and dark seams
  const plate = 3;
  for (let x = 0; x < DECK.width; x += plate)
    for (let z = 0; z < DECK.depth; z += plate) {
      const v = 38 + Math.floor(rnd() * 14);
      g.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
      g.fillRect(px(x) + 2, px(z) + 2, px(plate) - 4, px(plate) - 4);
    }
  // grime speckle
  for (let i = 0; i < 26000; i++) {
    const a = rnd() * 0.12;
    g.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(150,160,175,${a * 0.5})`;
    const r = 1 + rnd() * 3;
    g.fillRect(rnd() * S, rnd() * S, r, r);
  }
  // hazard stripes along the sea edge
  g.save();
  g.beginPath();
  g.rect(0, 0, S, px(0.9));
  g.clip();
  g.fillStyle = '#0B0B0B';
  g.fillRect(0, 0, S, px(0.9));
  g.fillStyle = '#C9A21A';
  for (let x = -S; x < S * 2; x += px(1.2)) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + px(0.6), 0);
    g.lineTo(x + px(0.6) - px(0.9), px(0.9));
    g.lineTo(x - px(0.9), px(0.9));
    g.fill();
  }
  g.restore();
  // centre lane
  g.strokeStyle = 'rgba(220,226,235,0.55)';
  g.lineWidth = px(0.18);
  g.setLineDash([px(2), px(1.2)]);
  g.beginPath();
  g.moveTo(wx(0), wz(-11));
  g.lineTo(wx(0), wz(17));
  g.stroke();
  g.setLineDash([]);
  // launch pads
  const pad = (x: number, z: number, color: string, label: string) => {
    g.strokeStyle = color;
    g.lineWidth = px(0.32);
    g.beginPath();
    g.arc(wx(x), wz(z), px(2.9), 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = px(0.1);
    g.beginPath();
    g.arc(wx(x), wz(z), px(2.3), 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      g.beginPath();
      g.moveTo(wx(x) + Math.cos(a) * px(2.9), wz(z) + Math.sin(a) * px(2.9));
      g.lineTo(wx(x) + Math.cos(a) * px(3.6), wz(z) + Math.sin(a) * px(3.6));
      g.stroke();
    }
    g.fillStyle = color;
    g.font = `bold ${Math.round(px(1.3))}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, wx(x), wz(z + 4.4));
  };
  pad(ROBOT_HOME.RAIJIN.x, ROBOT_HOME.RAIJIN.z, TEAM_COLORS.RAIJIN, '01');
  pad(ROBOT_HOME.FUJIN.x, ROBOT_HOME.FUJIN.z, TEAM_COLORS.FUJIN, '02');
  g.fillStyle = 'rgba(220,226,235,0.5)';
  g.font = `bold ${Math.round(px(0.75))}px sans-serif`;
  g.textAlign = 'center';
  g.fillText('EDF  TOKYO BAY  DEFENCE LINE', wx(0), wz(10.5));
  g.fillText('NO STANDING  ·  LAUNCH ZONE', wx(0), wz(-8.6));
  // scorch marks from earlier fights
  for (let i = 0; i < 9; i++) {
    const x = wx((rnd() - 0.5) * 28);
    const z = wz(-10 + rnd() * 9);
    const r = px(0.8 + rnd() * 2.2);
    const grad = g.createRadialGradient(x, z, 0, x, z, r);
    grad.addColorStop(0, 'rgba(5,5,6,0.75)');
    grad.addColorStop(1, 'rgba(5,5,6,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, z - r, r * 2, r * 2);
  }
  // roughness: mostly matte steel, glossy wet patches
  const rc = document.createElement('canvas');
  rc.width = rc.height = 512;
  const r = rc.getContext('2d')!;
  r.fillStyle = 'rgb(190,190,190)';
  r.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 512;
    const z = rnd() * 512;
    const rad = 10 + rnd() * 60;
    const grad = r.createRadialGradient(x, z, 0, x, z, rad);
    grad.addColorStop(0, 'rgba(30,30,30,0.9)');
    grad.addColorStop(1, 'rgba(30,30,30,0)');
    r.fillStyle = grad;
    r.fillRect(x - rad, z - rad, rad * 2, rad * 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(rc);
  return { map, rough };
}

function Deck() {
  const tex = useMemo(() => deckTextures(), []);
  useEffect(
    () => () => {
      tex.map.dispose();
      tex.rough.dispose();
    },
    [tex],
  );
  // Box face order +x,-x,+y,-y,+z,-z: the paint goes on top, plain steel elsewhere.
  const top = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: tex.map,
        roughnessMap: tex.rough,
        roughness: 1,
        metalness: 0.35,
        envMapIntensity: 0.9,
      }),
    [tex],
  );
  const side = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#20252C', roughness: 0.7, metalness: 0.5 }),
    [],
  );
  useEffect(
    () => () => {
      top.dispose();
      side.dispose();
    },
    [top, side],
  );
  const cz = DECK.front + DECK.depth / 2;
  const posts = useMemo(() => {
    const out: number[] = [];
    for (let x = -DECK.width / 2 + 1; x <= DECK.width / 2 - 1; x += 2) out.push(x);
    return out;
  }, []);
  return (
    <group name="bay-deck">
      <mesh
        position={[0, -DECK.thick / 2, cz]}
        material={[side, side, top, side, side, side]}
        receiveShadow
        name="stage"
      >
        <boxGeometry args={[DECK.width, DECK.thick, DECK.depth]} />
      </mesh>
      {/* the sea edge: kerb, rail posts and amber edge lamps */}
      <mesh position={[0, 0.15, DECK.front + 0.2]} castShadow receiveShadow>
        <boxGeometry args={[DECK.width, 0.3, 0.4]} />
        <meshStandardMaterial color="#3A3F46" roughness={0.6} metalness={0.6} />
      </mesh>
      {posts.map((x) => (
        <mesh key={x} position={[x, 0.75, DECK.front + 0.2]} castShadow>
          <boxGeometry args={[0.12, 1.2, 0.12]} />
          <meshStandardMaterial color="#C9A21A" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 1.32, DECK.front + 0.2]}>
        <boxGeometry args={[DECK.width, 0.08, 0.08]} />
        <meshStandardMaterial color="#C9A21A" roughness={0.5} metalness={0.4} />
      </mesh>
      {posts
        .filter((_, i) => i % 3 === 1)
        .map((x) => (
          <mesh key={`lamp${x}`} position={[x, 0.36, DECK.front + 0.42]}>
            <boxGeometry args={[0.3, 0.1, 0.06]} />
            <meshStandardMaterial
              color="#2A1A08"
              emissive="#FFB347"
              emissiveIntensity={2.4}
              toneMapped={false}
            />
          </mesh>
        ))}
      {/* piers under the sea edge */}
      {[-14, -8, -2.5, 2.5, 8, 14].map((x) => (
        <mesh key={`pier${x}`} position={[x, SEA_LEVEL / 2 - 1.2, DECK.front + 1.5]}>
          <cylinderGeometry args={[0.8, 0.9, Math.abs(SEA_LEVEL) + 3, 16]} />
          <meshStandardMaterial color="#1A1E24" roughness={0.8} metalness={0.3} />
        </mesh>
      ))}
      {/* containers stacked at the deck's sides frame the shot */}
      {(
        [
          [-15.2, 1.3, 7, '#5A2A22'],
          [-15.2, 1.3, 13.5, '#1F3550'],
          [-15.2, 3.9, 10, '#3A3F46'],
          [15.2, 1.3, 9, '#24456A'],
          [15.2, 3.9, 9, '#6A3A1E'],
          [15.2, 1.3, 15.5, '#3A3F46'],
        ] as const
      ).map(([x, y, z, color], i) => (
        <mesh key={`box${i}`} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[2.4, 2.6, 6]} />
          <meshStandardMaterial color={color} roughness={0.75} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// lights
// ---------------------------------------------------------------------------

/**
 * Moonlight from behind the camera side picks out the machines' backs; NULL
 * CORE's red glow and the burning horizon rim them from the front; a cool
 * hemisphere keeps the shadows readable.
 */
function BattleLighting({ shadows }: { shadows: boolean }) {
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const k = key.current;
    if (!k) return;
    k.target.position.set(0, 2, 1);
    k.target.updateMatrixWorld();
  }, []);
  return (
    <>
      <hemisphereLight args={['#4A5F8E', '#0A0C12', 0.32]} />
      <directionalLight
        ref={key}
        position={[-14, 20, 16]}
        intensity={1.9}
        color="#C8D6FF"
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* the horizon burning behind the boss: warm rim on everything facing the sea */}
      <directionalLight position={[6, 4, -40]} intensity={0.8} color="#FF8A4C" />
      <pointLight
        position={[BOSS_POSITION.x, BOSS_POSITION.y, BOSS_POSITION.z + 6]}
        intensity={70}
        distance={0}
        decay={2}
        color="#FF1030"
      />
    </>
  );
}

const SHAFT_VERT = /* glsl */ `
varying float vAlong;
varying vec3 vN;
varying vec3 vView;
void main() {
  vAlong = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlong;
varying vec3 vN;
varying vec3 vView;
void main() {
  // bright at the lamp, fading out along the beam and toward the cone's rim
  float rim = pow(abs(dot(normalize(vN), normalize(vView))), 1.5);
  float a = pow(vAlong, 1.6) * rim * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

function shaftMaterial(color: string, opacity: number) {
  return new THREE.ShaderMaterial({
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** An open cone from `from` toward `to` (uv.y = 1 at the lamp). */
function Shaft({
  from,
  to,
  radius,
  material,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
  material: THREE.Material;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const dir = to.clone().sub(from);
    const length = dir.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      dir.normalize(),
    );
    return { position: from.clone().lerp(to, 0.5), quaternion, length };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion} material={material} renderOrder={5}>
      <cylinderGeometry args={[0.15, radius, length, 24, 1, true]} />
    </mesh>
  );
}

/** Four floodlight towers; the two behind the machines really light them. */
function Floodlights({ shafts }: { shafts: boolean }) {
  const shaftMat = useMemo(() => shaftMaterial('#FFE2B0', 0.16), []);
  useEffect(() => () => shaftMat.dispose(), [shaftMat]);
  const towers = useMemo(
    () =>
      (
        [
          [-18.5, -10.5, false],
          [18.5, -10.5, false],
          [-12.5, 14, true],
          [12.5, 14, true],
        ] as const
      ).map(([x, z, lit]) => {
        const head = new THREE.Vector3(x, 13, z);
        // the lit towers each hold the machine on their side; the front ones rake the deck edge
        const aim = lit
          ? new THREE.Vector3(Math.sign(x) * 2.8, 2.6, 1.4)
          : new THREE.Vector3(x * 0.3, 0.5, -6);
        return { x, z, lit, head, aim };
      }),
    [],
  );
  return (
    <group name="bay-floodlights">
      {towers.map((t, i) => (
        <group key={i}>
          <mesh position={[t.x, 6.5, t.z]} castShadow>
            <cylinderGeometry args={[0.22, 0.32, 13, 10]} />
            <meshStandardMaterial color="#2A2F36" roughness={0.6} metalness={0.6} />
          </mesh>
          <mesh position={t.head} onUpdate={(m) => m.lookAt(t.aim)} castShadow>
            <boxGeometry args={[2.2, 1.0, 0.5]} />
            <meshStandardMaterial color="#1A1D22" emissive="#FFE8C0" emissiveIntensity={1.4} />
          </mesh>
          {t.lit && (
            <spotLight
              position={t.head}
              intensity={550}
              angle={0.42}
              penumbra={0.7}
              distance={0}
              decay={2}
              color="#FFE2B0"
              onUpdate={(l) => {
                l.target.position.copy(t.aim);
                l.target.updateMatrixWorld();
              }}
            />
          )}
          {shafts && !t.lit && <Shaft from={t.head} to={t.aim} radius={3.2} material={shaftMat} />}
        </group>
      ))}
    </group>
  );
}

/** Two searchlights behind the deck sweeping the sky toward the boss. */
function SearchBeams({
  director,
  reducedMotion,
}: {
  director: ArenaDirector;
  reducedMotion: boolean;
}) {
  const mat = useMemo(() => shaftMaterial('#BFD4FF', 0.07), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const refs = useRef<Array<THREE.Group | null>>([]);
  useFrame(() => {
    const t = reducedMotion ? 0 : director.time;
    refs.current.forEach((g, i) => {
      if (!g) return;
      // slow sweeps (~20 s), mirrored, always reaching out over the bay
      g.rotation.order = 'YXZ';
      g.rotation.y = Math.sin(t * 0.3 + i * 2.1) * 0.55 + (i === 0 ? 0.2 : -0.2);
      g.rotation.x = 0.42 + Math.sin(t * 0.21 + i) * 0.1;
    });
  });
  return (
    <group name="bay-searchlights">
      {[-9, 9].map((x, i) => (
        <group
          key={x}
          position={[x, 0.5, 17]}
          ref={(g) => {
            refs.current[i] = g;
          }}
        >
          {/* narrow end (uv.y = 1, brightest) at the lamp, widening out over the bay */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -70]} material={mat}>
            <cylinderGeometry args={[0.3, 4, 140, 20, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// the cities on the horizon
// ---------------------------------------------------------------------------

const PER_CITY = 54;

/**
 * All skylines in one instanced draw. Windows are drawn in the shader from
 * world position (stable sizes on any building), and each city's lights scale
 * with its hull: dimmer when damaged, out when it falls.
 */
function Cities({
  cities,
  threats,
  cityMaxHp,
  director,
  reducedMotion,
}: {
  cities: CityState[];
  threats: Partial<Record<RegionId, CityThreat>>;
  cityMaxHp: number;
  director: ArenaDirector;
  reducedMotion: boolean;
}) {
  const centers = useMemo(() => REGION_IDS.map((id) => horizonCityPosition(id)), []);
  const lights = useMemo(() => ({ value: REGION_IDS.map(() => 1) }), []);
  const { mesh, mat } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const cityIndex = new Float32Array(REGION_IDS.length * PER_CITY);
    const mat = new THREE.MeshStandardMaterial({
      color: '#0C1018',
      roughness: 0.7,
      metalness: 0.3,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCity = lights;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aCity;\nvarying float vCity;\nvarying vec3 vBWorld;\nvarying vec3 vBNormal;',
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vCity = aCity;
          vBWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vBNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uCity[${REGION_IDS.length}];
          varying float vCity;
          varying vec3 vBWorld;
          varying vec3 vBNormal;
          float bHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 bn = normalize(vBNormal);
            float wall = 1.0 - step(0.5, abs(bn.y));
            float along = dot(vBWorld.xz, normalize(vec2(-bn.z, bn.x) + 1e-4));
            vec2 g = vec2(along * 0.45, vBWorld.y * 0.34);
            vec2 cell = floor(g);
            vec2 f = fract(g);
            float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.72);
            float lit = step(0.42, bHash(cell + vCity * 31.0));
            vec3 warm = mix(vec3(1.0, 0.66, 0.36), vec3(0.7, 0.82, 1.0), step(0.82, bHash(cell * 1.7 + 2.0)));
            int ci = int(vCity + 0.5);
            float k = 0.0;
            for (int i = 0; i < ${REGION_IDS.length}; i++) if (i == ci) k = uCity[i];
            totalEmissiveRadiance += warm * win * lit * wall * k * 2.2;
          }`,
        );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, REGION_IDS.length * PER_CITY);
    const m = new THREE.Matrix4();
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    centers.forEach((c, ci) => {
      for (let b = 0; b < PER_CITY; b++) {
        const i = ci * PER_CITY + b;
        const r = Math.pow(rnd(), 0.7) * 40;
        const a = rnd() * Math.PI * 2;
        // taller towers in the middle of each city
        const h = 8 + Math.pow(1 - r / 40, 2) * 52 * (0.5 + rnd());
        const w = 5 + rnd() * 8;
        m.compose(
          new THREE.Vector3(c.x + Math.cos(a) * r * 1.4, SEA_LEVEL, c.z + Math.sin(a) * r * 0.6),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.6),
          new THREE.Vector3(w, h, w * (0.7 + rnd() * 0.6)),
        );
        mesh.setMatrixAt(i, m);
        cityIndex[i] = ci;
      }
    });
    geo.setAttribute('aCity', new THREE.InstancedBufferAttribute(cityIndex, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'bay-cities';
    return { mesh, mat };
  }, [centers, lights]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mat.dispose();
    },
    [mesh, mat],
  );
  const hazes = useRef<Array<THREE.Sprite | null>>([]);
  const beacons = useRef<Array<THREE.Mesh | null>>([]);
  const glowTex = useMemo(() => radialTexture(), []);
  useEffect(() => () => glowTex.dispose(), [glowTex]);
  const beaconMats = useMemo(() => REGION_IDS.map(() => shaftMaterial(CORRUPT_RED, 0.55)), []);
  useEffect(() => () => beaconMats.forEach((m) => m.dispose()), [beaconMats]);
  const byId = useMemo(() => new Map(cities.map((c) => [c.cityId, c])), [cities]);
  const want = useRef(REGION_IDS.map(() => 1));

  useFrame((_, dt) => {
    const t = director.time;
    REGION_IDS.forEach((id, i) => {
      const c = byId.get(id);
      const hp = c ? Math.max(0, c.hp) / Math.max(1, cityMaxHp) : 1;
      const fallen = !!c?.destroyed;
      want.current[i] = fallen ? 0.03 : 0.35 + 0.65 * hp;
      // lights fade over ~1 s rather than snapping (a city dying reads as a wave of darkness)
      lights.value[i]! += (want.current[i]! - lights.value[i]!) * Math.min(1, dt * 2.5);
      const haze = hazes.current[i];
      if (haze) {
        const m = haze.material as THREE.SpriteMaterial;
        if (fallen) {
          m.color.set('#FF4A1C');
          m.opacity = 0.55 + (reducedMotion ? 0 : Math.sin(t * 2.2 + i) * 0.08);
        } else {
          m.color.set('#FFB070');
          m.opacity = 0.18 + 0.32 * lights.value[i]!;
        }
      }
      const beacon = beacons.current[i];
      if (beacon) {
        const threat = threats[id];
        beacon.visible = !!threat && !fallen;
        // ≤ 1 Hz breathing so it never flashes
        const k = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(t * Math.PI * 1.6);
        (beacon.material as THREE.ShaderMaterial).uniforms.uOpacity!.value =
          (threat?.lethal ? 0.75 : 0.45) * k;
      }
    });
  });

  return (
    <group name="bay-city-group">
      <primitive object={mesh} />
      {centers.map((c, i) => (
        <group key={REGION_IDS[i]} position={c} name={`city-${REGION_IDS[i]}`}>
          <sprite
            ref={(s) => {
              hazes.current[i] = s;
            }}
            position={[0, 30, 0]}
            scale={[170, 80, 1]}
          >
            <spriteMaterial
              map={glowTex}
              color="#FFB070"
              transparent
              opacity={0.4}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              fog={false}
            />
          </sprite>
          <mesh
            ref={(m) => {
              beacons.current[i] = m;
            }}
            position={[0, 110, 0]}
            rotation={[Math.PI, 0, 0]}
            material={beaconMats[i]}
            visible={false}
          >
            <cylinderGeometry args={[2.5, 9, 220, 12, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ash and embers drifting across the deck (slow, never flashing). */
function Embers({ reducedMotion }: { reducedMotion: boolean }) {
  const count = 420;
  const { geo, speed } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 60;
      pos[i * 3 + 1] = rnd() * 22;
      pos[i * 3 + 2] = -30 + rnd() * 50;
      speed[i] = 0.3 + rnd() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo, speed };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (reducedMotion) return;
    const p = geo.attributes.position as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    const step = Math.min(dt, 0.1);
    for (let i = 0; i < count; i++) {
      a[i * 3]! += step * 0.9 * speed[i]!;
      a[i * 3 + 1]! += step * 0.35 * speed[i]!;
      if (a[i * 3]! > 30) a[i * 3] = -30;
      if (a[i * 3 + 1]! > 22) a[i * 3 + 1] = 0;
    }
    p.needsUpdate = true;
  });
  return (
    <points geometry={geo} name="bay-embers">
      <pointsMaterial
        color="#FFB070"
        size={0.09}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
