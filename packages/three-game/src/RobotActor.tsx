import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import type { TeamId } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { ADVANCE_FRACTION, ROBOT_HOME } from './layout';
import { applyClip } from './robots/animate';
import { buildFujin, buildRaijin } from './robots/build';

export interface RobotActorProps {
  teamId: TeamId;
  director: ArenaDirector;
  /** 0..1 energy ratio, drives emissive glow. */
  energyRatio: number;
}

/**
 * One robot. Pose is driven every frame by the director's current cue for this
 * team; the actor never changes game state. Uses the procedural rig today; a
 * GLB with the same joint/clip names can replace it (see docs/ART_PIPELINE.md).
 */
export function RobotActor({ teamId, director, energyRatio }: RobotActorProps) {
  const rig = useMemo(() => (teamId === 'RAIJIN' ? buildRaijin() : buildFujin()), [teamId]);
  useEffect(() => () => rig.dispose(), [rig]);
  const outer = useRef<THREE.Group>(null);
  const advance = useRef(0);
  const energy = useRef(energyRatio);
  energy.current = energyRatio;
  const home = ROBOT_HOME[teamId];

  useFrame((_, dt) => {
    const cue = director.robots[teamId];
    applyClip(rig, cue.clip, director.time - cue.start, director.time, energy.current * 0.8);
    advance.current += (cue.advance - advance.current) * Math.min(1, dt * 7);
    if (outer.current) outer.current.position.x = home.x * (1 - ADVANCE_FRACTION * advance.current);
  });

  return (
    <group
      ref={outer}
      position={[home.x, 0, home.z]}
      rotation={[0, home.ry, 0]}
      name={`robot-${teamId}`}
    >
      <primitive object={rig.root} />
    </group>
  );
}
