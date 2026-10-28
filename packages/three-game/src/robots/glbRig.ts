import * as THREE from 'three';
import { JOINT_NAMES, type JointName, type JointRest, type RobotRig } from './build';

/** Rest pose of `joint` relative to `root`, including the frames applyClip needs. */
function captureRest(root: THREE.Object3D, joint: THREE.Object3D): JointRest {
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const frame = joint.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv);
  const parentFrame = joint.parent
    ? joint.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv)
    : new THREE.Quaternion();
  return {
    position: joint.position.clone(),
    rotation: joint.rotation.clone(),
    frame,
    parentFrameInv: parentFrame.invert(),
  };
}

const REST_KEY = 'swRestPose';

/**
 * Rig view over a loaded GLB (same joint names as the procedural rigs), so the
 * procedural clips can drive it when the file has no clip of its own. Works for any
 * bone orientation: Blender-authored bones point along the limbs, so their rest
 * frames are recorded and applyClip re-expresses each rotation in them.
 * Returns null when a required joint is missing.
 */
export function rigFromScene(scene: THREE.Object3D, kind: RobotRig['kind']): RobotRig | null {
  const joints = {} as RobotRig['joints'];
  for (const name of JOINT_NAMES) {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    joints[name] = o;
  }
  const backUnit = scene.getObjectByName('BackUnit') ?? new THREE.Object3D();
  // useGLTF caches the scene across mounts: keep the first (pristine) rest pose.
  type Stored = { joints: Record<JointName, JointRest>; back: JointRest };
  let stored = scene.userData[REST_KEY] as Stored | undefined;
  if (!stored) {
    scene.updateWorldMatrix(true, true);
    const rest = {} as Record<JointName, JointRest>;
    for (const name of JOINT_NAMES) rest[name] = captureRest(scene, joints[name]);
    stored = { joints: rest, back: captureRest(scene, backUnit) };
    scene.userData[REST_KEY] = stored;
  }
  const glow: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    // Skinned parts move far from their bind-pose bounds (Intro drops from 9 m up).
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    const mats = (o as THREE.Mesh).material;
    for (const m of (Array.isArray(mats) ? mats : [mats]) as THREE.MeshStandardMaterial[]) {
      if (m && 'emissive' in m && m.emissive.getHex() !== 0 && !glow.includes(m)) {
        m.userData.swBaseGlow ??= m.emissiveIntensity; // authored intensity, before any animation
        glow.push(m);
      }
    }
  });
  const box = new THREE.Box3().setFromObject(scene);
  return {
    kind,
    root: scene as THREE.Group,
    joints,
    rest: stored.joints,
    backUnit,
    backRest: stored.back,
    glowMaterials: glow,
    baseGlow: Math.max(1.5, ...glow.map((m) => m.userData.swBaseGlow as number)),
    height: box.isEmpty() ? 4 : box.max.y - box.min.y,
    dispose() {},
  };
}
