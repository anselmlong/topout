// Set dressing: neighbouring walls with other people's problems, a back wall,
// a bench, a chalk bucket and pendant lights. Decorative only: no raycasting,
// no shadows cast, instanced where it repeats.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng } from '../gen/rng';
import type { Wall } from '../solver/types';
import { PALETTE, ROUTE_COLORS } from './palette';

const none = () => null;

interface Section {
  x: number;
  yaw: number;
  angle: number;
  width: number;
  holds: { u: number; v: number; color: string; s: number }[];
}

/** Other routes on the neighbouring walls, each set in one colour like a real gym. */
function sections(wall: Wall): Section[] {
  const r = rng(wall.seed ^ 0x5eed);
  const edge = wall.width / 200;
  const colors = ROUTE_COLORS.map((c) => c.hex);
  const make = (side: -1 | 1): Section => {
    const width = 3.4;
    const holds: Section['holds'] = [];
    for (let route = 0; route < 3; route++) {
      const color = r.pick(colors);
      let u = r.range(0.4, width - 0.4);
      for (let v = r.range(0.3, 0.6); v < 3.9; v += r.range(0.35, 0.6)) {
        u = Math.max(0.2, Math.min(width - 0.2, u + r.range(-0.35, 0.35)));
        holds.push({ u, v, color, s: r.range(0.035, 0.07) });
      }
    }
    return { x: side * (edge + 0.25), yaw: side * -0.62, angle: r.pick([0, 10, 20, 35]), width, holds };
  };
  return [make(-1), make(1)];
}

function SideWall({ s, side }: { s: Section; side: -1 | 1 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const a = (s.angle * Math.PI) / 180;
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    s.holds.forEach((h, i) => {
      // Local panel space: x along width, y up the panel, z out of it.
      const x = side < 0 ? -h.u : h.u;
      m.compose(new THREE.Vector3(x, h.v, 0.01), new THREE.Quaternion(), new THREE.Vector3(h.s * 1.3, h.s, h.s * 0.7));
      ref.current!.setMatrixAt(i, m);
      ref.current!.setColorAt(i, c.set(h.color));
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [s, side]);
  return (
    <group position={[s.x, 0, 0]} rotation={[0, s.yaw, 0]}>
      <group rotation={[-a, 0, 0]}>
        <mesh position={[(side * s.width) / 2, 2.1, -0.06]} receiveShadow raycast={none}>
          <boxGeometry args={[s.width, 4.2, 0.1]} />
          <meshStandardMaterial color="#c2b59d" roughness={0.95} flatShading />
        </mesh>
        <instancedMesh ref={ref} args={[undefined, undefined, s.holds.length]} raycast={none}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial flatShading roughness={0.85} />
        </instancedMesh>
      </group>
      {/* Pad in front of it. */}
      <mesh position={[(side * s.width) / 2, 0.15, 1.1]} receiveShadow raycast={none}>
        <boxGeometry args={[s.width, 0.3, 2.3]} />
        <meshStandardMaterial color={PALETTE.pad} roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

function Lamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 6.2, z]}>
      <mesh position={[0, 0.9, 0]} raycast={none}>
        <cylinderGeometry args={[0.006, 0.006, 1.8, 4]} />
        <meshBasicMaterial color="#5a564f" />
      </mesh>
      <mesh raycast={none}>
        <coneGeometry args={[0.28, 0.24, 8, 1, true]} />
        <meshStandardMaterial color="#3b3d41" side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, -0.08, 0]} raycast={none}>
        <sphereGeometry args={[0.08, 8, 6]} />
        <meshBasicMaterial color="#fff6e0" />
      </mesh>
    </group>
  );
}

export function Gym({ wall }: { wall: Wall }) {
  const secs = useMemo(() => sections(wall), [wall]);
  const standX = -wall.width / 200 - 0.55;
  return (
    <group>
      {/* Back wall of the room. */}
      <mesh position={[0, 4, -1.8]} raycast={none}>
        <planeGeometry args={[40, 12]} />
        <meshStandardMaterial color="#cfc9bf" roughness={1} />
      </mesh>
      <SideWall s={secs[0]} side={-1} />
      <SideWall s={secs[1]} side={1} />
      {[-2.2, 0, 2.2].map((x) => (
        <Lamp key={x} x={x} z={1.6} />
      ))}
      {/* Chalk bucket by the waiting climber. */}
      <group position={[standX + 0.45, 0.3, 1.25]}>
        <mesh castShadow raycast={none} position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.1, 0.085, 0.2, 8]} />
          <meshStandardMaterial color="#6b5f52" flatShading />
        </mesh>
        <mesh raycast={none} position={[0, 0.195, 0]}>
          <cylinderGeometry args={[0.092, 0.092, 0.01, 8]} />
          <meshStandardMaterial color="#f2efe8" />
        </mesh>
      </group>
      {/* Bench. */}
      <group position={[-3.4, 0, 3.4]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 0.42, 0]} raycast={none}>
          <boxGeometry args={[1.8, 0.06, 0.4]} />
          <meshStandardMaterial color="#9d8a70" flatShading />
        </mesh>
        {[-0.75, 0.75].map((x) => (
          <mesh key={x} position={[x, 0.2, 0]} raycast={none}>
            <boxGeometry args={[0.06, 0.4, 0.36]} />
            <meshStandardMaterial color="#3d3f43" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
