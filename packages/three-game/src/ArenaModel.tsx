import { useGLTF } from '@react-three/drei';
import { Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { Fallback } from './GlbRobotActor';

/**
 * The Blender arena (stage, spawn pads, map pedestal, 8 defence bases, lamp
 * rigs, skyline). Built in the same coordinates as the procedural stage, so the
 * robots, map and boss need no offsets. Cameras in the file are reference only:
 * the director keeps driving the live camera from layout.ts.
 */
function ArenaGlb({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.receiveShadow = true;
        // The floor and skyline never move; skip per-frame matrix updates.
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
      }
    });
    return s;
  }, [gltf.scene]);
  return <primitive object={scene} name="arena-glb" />;
}

export function ArenaModel({
  url,
  fallback,
  onError,
}: {
  url: string;
  fallback: ReactNode;
  onError?: (e: unknown) => void;
}) {
  return (
    <Fallback fallback={fallback} onError={onError}>
      <Suspense fallback={fallback}>
        <ArenaGlb url={url} />
      </Suspense>
    </Fallback>
  );
}
