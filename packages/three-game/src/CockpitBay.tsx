import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CrewMember, Role } from '@sats-wars/shared';
import { DEFAULT_LOOK, ROLE_LABELS, ROLES } from '@sats-wars/shared';
import type { ArenaDirector } from './director';
import { COCKPIT_POSITION } from './layout';

/**
 * The virtual cockpit inside the machine (spec D4): every pilot is a seat
 * with a lightweight avatar (helmet + visor in their equipped colours when
 * they allowed it). Seats are grouped by role, new boarders light their lamp,
 * a mission success sends a pulse through the seat. A hundred pilots are four
 * instanced meshes, not a hundred characters. Only a few consented callsigns
 * are shown at a time and they rotate, so the bay never fills with name tags.
 */
export const ROLE_SEAT_COLORS: Record<Role, string> = {
  GUNNER: '#F7931A',
  GUARDIAN: '#25C8D7',
  ROUTER: '#E8D44D',
  ENGINEER: '#7BE0A0',
};

/** Seats per role group drawn (more pilots show as "+N"). */
export const SEATS_PER_ROLE = 25;
const COLS = 5;
const MAX_TAGS = 8;
const TAG_ROTATE_S = 4;

/** Seat slot → local position: four tiers of 5×5 in an arc facing the camera. */
export function seatPosition(roleIndex: number, slot: number): THREE.Vector3 {
  const angle = (roleIndex - 1.5) * 0.5;
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const radius = 6.5 + row * 0.95;
  const along = (col - (COLS - 1) / 2) * 0.66;
  const x = Math.sin(angle) * radius + Math.cos(angle) * along;
  const z = -Math.cos(angle) * radius + Math.sin(angle) * along;
  return new THREE.Vector3(x, row * 0.42, z + 5);
}

interface Placed {
  member: CrewMember;
  roleIndex: number;
  slot: number;
}

export function placeCrew(crew: CrewMember[]): {
  placed: Placed[];
  overflow: Record<Role, number>;
} {
  const placed: Placed[] = [];
  const overflow = { GUNNER: 0, GUARDIAN: 0, ROUTER: 0, ENGINEER: 0 } as Record<Role, number>;
  ROLES.forEach((role, roleIndex) => {
    const members = crew.filter((m) => m.role === role);
    members.forEach((member, i) => {
      if (i < SEATS_PER_ROLE) placed.push({ member, roleIndex, slot: i });
    });
    overflow[role] = Math.max(0, members.length - SEATS_PER_ROLE);
  });
  return { placed, overflow };
}

/** Tags shown now: consented names only, recent achievers first, rotating. */
export function rotatingTags(
  placed: Placed[],
  pulsedAt: Map<string, number>,
  time: number,
): Placed[] {
  const named = placed.filter((p) => p.member.named && !p.member.isBot);
  if (named.length <= MAX_TAGS) return named;
  const recent = named
    .filter((p) => time - (pulsedAt.get(p.member.pilotId) ?? -99) < 6)
    .slice(0, MAX_TAGS / 2);
  const rest = named.filter((p) => !recent.includes(p));
  const page = Math.floor(time / TAG_ROTATE_S);
  const start = (page * (MAX_TAGS - recent.length)) % rest.length;
  const window = [...rest, ...rest].slice(start, start + MAX_TAGS - recent.length);
  return [...recent, ...window];
}

const tmp = new THREE.Object3D();
const color = new THREE.Color();
const fxColor = new THREE.Color();
const white = new THREE.Color('#FFFFFF');

export function CockpitBay({
  crew,
  director,
  reducedMotion,
  locale,
}: {
  crew: CrewMember[];
  director: ArenaDirector;
  reducedMotion: boolean;
  locale: 'ja' | 'en';
}) {
  const { placed, overflow } = useMemo(() => placeCrew(crew), [crew]);
  const max = ROLES.length * SEATS_PER_ROLE;
  const seats = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const visors = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<THREE.InstancedMesh>(null);
  const [tags, setTags] = useState<Placed[]>([]);
  const [inView, setInView] = useState(false);
  const lastTagPage = useRef(-1);

  // Static transforms and avatar colours when the crew changes.
  useEffect(() => {
    const meshes = [seats.current, heads.current, visors.current, lamps.current];
    if (meshes.some((m) => !m)) return;
    placed.forEach((p, i) => {
      const pos = seatPosition(p.roleIndex, p.slot);
      const face = Math.atan2(-pos.x, 10 - pos.z);
      tmp.position.copy(pos);
      tmp.rotation.set(0, face, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      seats.current!.setMatrixAt(i, tmp.matrix);
      seats.current!.setColorAt(i, color.set(ROLE_SEAT_COLORS[p.member.role]).multiplyScalar(0.45));
      const look = p.member.look ?? DEFAULT_LOOK;
      tmp.position.set(pos.x, pos.y + 0.62, pos.z);
      tmp.updateMatrix();
      heads.current!.setMatrixAt(i, tmp.matrix);
      heads.current!.setColorAt(i, color.set(look.helmet));
      tmp.position.set(pos.x + Math.sin(face) * 0.2, pos.y + 0.64, pos.z + Math.cos(face) * 0.2);
      tmp.updateMatrix();
      visors.current!.setMatrixAt(i, tmp.matrix);
      visors.current!.setColorAt(i, color.set(look.visor));
      tmp.position.set(pos.x, pos.y + 0.05, pos.z + 0.38);
      tmp.updateMatrix();
      lamps.current!.setMatrixAt(i, tmp.matrix);
    });
    for (const m of meshes) {
      m!.count = placed.length;
      m!.instanceMatrix.needsUpdate = true;
      if (m!.instanceColor) m!.instanceColor.needsUpdate = true;
    }
  }, [placed]);

  // Lamps: dim role colour; bright white just after boarding; a pulse in the
  // pilot's seat-light colour after a success. Fades, never strobes.
  useFrame(() => {
    const t = director.time;
    const lamp = lamps.current;
    if (lamp) {
      placed.forEach((p, i) => {
        const id = p.member.pilotId;
        const sinceBoard = t - (director.boardedAt.get(id) ?? -99);
        const sincePulse = t - (director.pulsedAt.get(id) ?? -99);
        color.set(ROLE_SEAT_COLORS[p.member.role]).multiplyScalar(0.35);
        if (sincePulse < 1.4) {
          const k = reducedMotion ? 0.6 : 1 - sincePulse / 1.4;
          color
            .lerp(fxColor.set((p.member.look ?? DEFAULT_LOOK).fx), 0.4)
            .multiplyScalar(1 + 2 * k);
        }
        if (sinceBoard < 3) color.lerp(white, 1 - sinceBoard / 3);
        lamp.setColorAt(i, color);
      });
      if (lamp.instanceColor) lamp.instanceColor.needsUpdate = true;
    }
    // Labels only while the camera is inside (HTML overlays ignore the floor).
    const looking = director.camera.preset === 'cockpit';
    if (looking !== inView) setInView(looking);
    const page = Math.floor(t / TAG_ROTATE_S);
    if (page !== lastTagPage.current) {
      lastTagPage.current = page;
      setTags(rotatingTags(placed, director.pulsedAt, t));
    }
  });

  return (
    <group position={COCKPIT_POSITION} name="cockpit-bay">
      <pointLight position={[0, 6, 8]} intensity={40} distance={30} color="#BFD6FF" />
      {/* Bay shell: a half-ring wall with the two gods' emblems */}
      <mesh position={[0, 2, 0]} rotation={[0, Math.PI, 0]}>
        <cylinderGeometry args={[11, 11, 7, 48, 1, true, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial
          color="#0C1628"
          side={THREE.BackSide}
          metalness={0.4}
          roughness={0.7}
        />
      </mesh>
      <mesh position={[0, -0.05, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[11, 48]} />
        <meshStandardMaterial color="#0A1220" />
      </mesh>
      <mesh position={[-1.6, 4.6, -7]}>
        <torusGeometry args={[0.8, 0.09, 12, 40]} />
        <meshStandardMaterial color="#F7931A" emissive="#F7931A" emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[1.6, 4.6, -7]}>
        <torusGeometry args={[0.8, 0.09, 12, 40]} />
        <meshStandardMaterial color="#25C8D7" emissive="#25C8D7" emissiveIntensity={1.2} />
      </mesh>
      <instancedMesh ref={seats} args={[undefined, undefined, max]} frustumCulled={false}>
        <boxGeometry args={[0.6, 0.5, 0.6]} />
        <meshStandardMaterial metalness={0.3} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, max]} frustumCulled={false}>
        <sphereGeometry args={[0.24, 12, 10]} />
        <meshStandardMaterial metalness={0.2} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={visors} args={[undefined, undefined, max]} frustumCulled={false}>
        <boxGeometry args={[0.28, 0.1, 0.06]} />
        <meshStandardMaterial emissive="#FFFFFF" emissiveIntensity={0.25} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, max]} frustumCulled={false}>
        <boxGeometry args={[0.42, 0.08, 0.06]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {inView &&
        ROLES.map((role, i) => {
          const anchor = seatPosition(i, 2);
          return (
            <Html
              key={role}
              position={[anchor.x, anchor.y + 1.6, anchor.z]}
              center
              zIndexRange={[5, 0]}
            >
              <div className="sw-cockpit-group" style={{ borderColor: ROLE_SEAT_COLORS[role] }}>
                {ROLE_LABELS[role].icon}{' '}
                {locale === 'ja' ? ROLE_LABELS[role].ja : ROLE_LABELS[role].en}
                {overflow[role] > 0 && <span className="sw-cockpit-more"> +{overflow[role]}</span>}
              </div>
            </Html>
          );
        })}
      {inView &&
        tags.map((p) => {
          const pos = seatPosition(p.roleIndex, p.slot);
          return (
            <Html
              key={p.member.pilotId}
              position={[pos.x, pos.y + 1.1, pos.z]}
              center
              zIndexRange={[4, 0]}
            >
              <div className="sw-cockpit-tag">{p.member.callsign}</div>
            </Html>
          );
        })}
    </group>
  );
}
