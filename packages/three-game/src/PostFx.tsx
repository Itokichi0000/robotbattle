import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { ArenaDirector } from './director';
import { CORRUPT_RED, type QualityConfig } from './layout';

/**
 * Vignette, a brief centre-weighted glow on big moments (never a full white
 * frame) and a colour fringe that grows toward the edges. Runs in linear HDR
 * before tone mapping.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.55 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color('#FFE9C2') },
    uAberration: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uAberration;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * 0.014;
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, base.g, texture2D(tDiffuse, vUv - off).b);
      col += uFlashColor * uFlash * 0.22 * max(0.0, 1.0 - r2 * 2.2);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.5, r2);
      gl_FragColor = vec4(col, base.a);
    }
  `,
};

const ALLY_FLASH = new THREE.Color('#FFE9C2');
const ENEMY_FLASH = new THREE.Color(CORRUPT_RED);

/**
 * Renders the scene through an HDR buffer: bloom makes emissive parts and
 * effects glow, the grade pass adds the vignette and the director's screen
 * accents, OutputPass applies tone mapping and sRGB. Takes over R3F's render
 * (frame priority 1).
 */
export function PostFx({
  director,
  config,
  reducedMotion,
}: {
  director: ArenaDirector;
  config: NonNullable<QualityConfig['post']>;
  reducedMotion: boolean;
}) {
  const { gl, scene, camera, size, viewport } = useThree();
  const chain = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: config.samples,
    });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      config.bloom,
      config.radius,
      config.threshold,
    );
    composer.addPass(bloom);
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    composer.addPass(new OutputPass());
    return { composer, bloom, grade };
  }, [gl, scene, camera, config]);

  useEffect(() => {
    const { composer, bloom } = chain;
    composer.setPixelRatio(viewport.dpr);
    composer.setSize(size.width, size.height);
    // A smaller bloom buffer is much cheaper and looks nearly the same.
    const w = size.width * viewport.dpr * config.bloomScale;
    const h = size.height * viewport.dpr * config.bloomScale;
    bloom.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }, [chain, size.width, size.height, viewport.dpr, config.bloomScale]);
  useEffect(
    () => () => {
      chain.composer.renderTarget1.dispose();
      chain.composer.renderTarget2.dispose();
      chain.bloom.dispose();
    },
    [chain],
  );

  useFrame((_, dt) => {
    const u = chain.grade.uniforms;
    u.uFlash!.value = reducedMotion ? 0 : director.flash;
    (u.uFlashColor!.value as THREE.Color).copy(
      director.flashTone === 'enemy' ? ENEMY_FLASH : ALLY_FLASH,
    );
    u.uAberration!.value = config.aberration && !reducedMotion ? director.aberration : 0;
    // The bloom swells a little with each flash.
    chain.bloom.strength = config.bloom * (1 + director.flash * 0.6);
    chain.composer.render(dt);
  }, 1);
  return null;
}

/**
 * Image-based light for the stage, generated once from a small scene (no
 * image files): a cool softbox above, Raijin's amber on the left, Fujin's
 * teal on the right, a red glow from NULL CORE behind. Metal armour picks up
 * these colours in its reflections.
 */
export function StageEnvironment({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const env = new THREE.Scene();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const add = (
      geo: THREE.BufferGeometry,
      color: string,
      k: number,
      pos: number[],
      rot?: number[],
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(k),
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0]!, pos[1]!, pos[2]!);
      if (rot) m.rotation.set(rot[0]!, rot[1]!, rot[2]!);
      env.add(m);
      geos.push(geo);
      mats.push(mat);
    };
    add(new THREE.BoxGeometry(40, 20, 40), '#0A1324', 1, [0, 5, 0]);
    add(new THREE.PlaneGeometry(14, 6), '#C9DAFF', 2.2, [0, 14, 2], [Math.PI / 2, 0, 0]);
    add(new THREE.PlaneGeometry(3, 12), '#F7931A', 2.4, [-18, 6, 4], [0, Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(3, 12), '#25C8D7', 2.4, [18, 6, 4], [0, -Math.PI / 2, 0]);
    add(new THREE.PlaneGeometry(10, 4), '#FF3B5C', 1.6, [0, 12, -19.5]);
    add(new THREE.PlaneGeometry(30, 30), '#101A30', 1, [0, -4.9, 0], [-Math.PI / 2, 0, 0]);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(env, 0.04);
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
    return () => {
      if (scene.environment === rt.texture) scene.environment = null;
      rt.dispose();
      pmrem.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}
