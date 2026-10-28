import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TeamId } from '@sats-wars/shared';
import { type ClipName, LOOPING_CLIPS } from './director';
import { ADVANCE_FRACTION, ROBOT_HOME } from './layout';
import { RobotActor, type RobotActorProps } from './RobotActor';
import { applyClip } from './robots/animate';
import { JOINT_NAMES, type RobotRig } from './robots/build';

/** Rig view over a loaded GLB, so procedural clips can drive it when a clip is missing. */
function rigFromScene(scene: THREE.Object3D, kind: RobotRig['kind']): RobotRig | null {
  const joints = {} as RobotRig['joints'];
  for (const name of JOINT_NAMES) {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    joints[name] = o;
  }
  const rest = {} as RobotRig['rest'];
  for (const name of JOINT_NAMES)
    rest[name] = {
      position: joints[name].position.clone(),
      rotation: joints[name].rotation.clone(),
    };
  const glow: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'emissive' in m && m.emissive.getHex() !== 0 && !glow.includes(m)) glow.push(m);
  });
  return {
    kind,
    root: scene as THREE.Group,
    joints,
    rest,
    backUnit: scene.getObjectByName('BackUnit') ?? new THREE.Object3D(),
    glowMaterials: glow,
    baseGlow: glow[0]?.emissiveIntensity ?? 1.5,
    height: 4,
    dispose() {},
  };
}

function GlbRobot({ url, teamId, director, energyRatio }: RobotActorProps & { url: string }) {
  const gltf = useGLTF(url);
  const kind = teamId === 'RAIJIN' ? 'raijin' : 'fujin';
  const rig = useMemo(() => rigFromScene(gltf.scene, kind), [gltf.scene, kind]);
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf.scene]);
  const actions = useMemo(() => {
    const map = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) map.set(clip.name, mixer.clipAction(clip));
    return map;
  }, [gltf.animations, mixer]);
  useEffect(() => () => void mixer.stopAllAction(), [mixer]);
  const current = useRef<string | null>(null);
  const outer = useRef<THREE.Group>(null);
  const advance = useRef(0);
  const home = ROBOT_HOME[teamId];

  useFrame((_, dt) => {
    const cue = director.robots[teamId];
    const t = director.time - cue.start;
    const action = actions.get(cue.clip);
    if (action) {
      if (current.current !== cue.clip) {
        for (const a of actions.values()) a.stop();
        action.reset().play();
        action.setLoop(
          LOOPING_CLIPS.has(cue.clip as ClipName) ? THREE.LoopRepeat : THREE.LoopOnce,
          Infinity,
        );
        action.clampWhenFinished = true;
        current.current = cue.clip;
      }
      // Drive time from the director so all screens stay in step.
      const dur = action.getClip().duration;
      action.time = LOOPING_CLIPS.has(cue.clip) ? t % dur : Math.min(t, dur);
      mixer.update(0);
      for (const m of rig?.glowMaterials ?? [])
        m.emissiveIntensity = (rig?.baseGlow ?? 1.5) * (1 + energyRatio * 0.8);
    } else if (rig) {
      for (const a of actions.values()) a.stop();
      current.current = null;
      applyClip(rig, cue.clip, t, director.time, energyRatio * 0.8);
    }
    advance.current += (cue.advance - advance.current) * Math.min(1, dt * 7);
    if (outer.current) outer.current.position.x = home.x * (1 - ADVANCE_FRACTION * advance.current);
  });

  return (
    <group
      ref={outer}
      position={[home.x, 0, home.z]}
      rotation={[0, home.ry, 0]}
      name={`robot-glb-${teamId}`}
    >
      <primitive object={gltf.scene} />
    </group>
  );
}

class Fallback extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: (e: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(e: unknown) {
    this.props.onError?.(e);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Robot that uses a GLB (same joint/clip names as the procedural rig) when a URL
 * is given, and falls back to the procedural robot while loading or on failure.
 */
export function ModelRobotActor(
  props: RobotActorProps & { url?: string | null; onModelError?: (e: unknown) => void },
) {
  const procedural = (
    <RobotActor teamId={props.teamId} director={props.director} energyRatio={props.energyRatio} />
  );
  if (!props.url) return procedural;
  return (
    <Fallback fallback={procedural} onError={props.onModelError}>
      <Suspense fallback={procedural}>
        <GlbRobot {...props} url={props.url} />
      </Suspense>
    </Fallback>
  );
}

export type { TeamId };
