// Set dressing: neighbouring walls with other people's problems (real hold
// shapes, start tape and grade tags), a back wall,
// a bench, a chalk bucket and pendant lights. Decorative only: no raycasting,
// no shadows cast, instanced where it repeats.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng, type Rng } from '../gen/rng';
import type { HoldSize, HoldType, Wall } from '../solver/types';
import { holdGeometry } from './holdGeometry';
import { PALETTE, ROUTE_COLORS } from './palette';

const none = () => null;

type Kind = { type: HoldType; size: HoldSize; variant: number };

interface Route {
  color: string;
  grade: number;
  /** Panel-space position of the start hold, where the tape and tag go. */
  start: { u: number; v: number };
}

interface Section {
  x: number;
  yaw: number;
  angle: number;
  width: number;
  routes: Route[];
  holds: (Kind & { u: number; v: number; rot: number; color: string })[];
}

const PANEL_H = 4.2;

/** What a setter reaches for at each grade: big holds on easy routes, small ones on hard. */
function handHold(r: Rng, grade: number): Kind {
  const easy: HoldType[] = ['jug', 'jug', 'edge', 'pinch'];
  const hard: HoldType[] = ['crimp', 'crimp', 'sloper', 'pinch', 'edge', 'pocket'];
  const type = r.chance(Math.min(0.9, grade / 7)) ? r.pick(hard) : r.pick(easy);
  const size: HoldSize = grade < 3 ? r.pick(['m', 'l'] as const) : r.pick(['s', 'm', 'm', 'l'] as const);
  return { type, size, variant: r.int(0, 1) };
}

/**
 * Other routes on the neighbouring walls, each set in one colour like a real gym.
 * None share `avoid` (today's route colour), so they never read as the player's holds.
 */
function sections(wall: Wall, avoid: string): Section[] {
  const r = rng(wall.seed ^ 0x5eed);
  const edge = wall.width / 200;
  const colors = ROUTE_COLORS.map((c) => c.hex).filter((c) => c !== avoid);
  const make = (side: -1 | 1): Section => {
    const width = 3.4;
    const holds: Section['holds'] = [];
    const routes: Route[] = [];
    // Three lines spread across the panel, so routes don't tangle.
    const lanes = [0.6, 1.7, 2.8].map((u) => u + r.range(-0.2, 0.2));
    for (const lane of lanes) {
      const color = r.pick(colors.filter((c) => !routes.some((x) => x.color === c)));
      const grade = r.int(0, 7);
      let u = lane;
      const v0 = r.range(0.45, 0.7);
      routes.push({ color, grade, start: { u, v: v0 } });
      // Wider spacing on easy routes reads as big moves between jugs; hard routes are denser.
      const gap = grade < 3 ? [0.45, 0.65] : [0.32, 0.5];
      for (let v = v0; v < PANEL_H - 0.35; v += r.range(gap[0], gap[1])) {
        u = Math.max(0.2, Math.min(width - 0.2, u + r.range(-0.3, 0.3)));
        holds.push({ ...handHold(r, grade), u, v, rot: r.range(-0.6, 0.6), color });
        // A foot chip or two below and beside each hand, in the route's colour.
        if (v > v0 + 0.3 && r.chance(0.6)) {
          const fu = Math.max(0.15, Math.min(width - 0.15, u + r.range(-0.35, 0.35)));
          const type = r.chance(0.7) ? 'foot' : 'jib';
          holds.push({ type, size: 'm', variant: r.int(0, 1), u: fu, v: v - r.range(0.45, 0.7), rot: r.range(-3, 3), color });
        }
      }
    }
    return { x: side * (edge + 0.25), yaw: side * -0.62, angle: r.pick([0, 10, 20, 35]), width, routes, holds };
  };
  return [make(-1), make(1)];
}

/** A gym route tag: white card, coloured stripe, grade. One small canvas each. */
function tagTexture(route: Route) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3f0e9';
  g.fillRect(0, 0, 96, 64);
  g.fillStyle = route.color;
  g.fillRect(0, 0, 96, 16);
  g.fillStyle = '#3a3a3c';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`V${route.grade}`, 48, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function RouteTag({ route, x }: { route: Route; x: number }) {
  const tex = useMemo(() => tagTexture(route), [route]);
  useEffect(() => () => tex.dispose(), [tex]);
  const y = route.start.v;
  return (
    <group position={[x, y, 0.004]}>
      {/* Start tape: two strips in a V under the start hold. */}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * 0.02, -0.11, 0]} rotation={[0, 0, k * -0.35]} raycast={none}>
          <planeGeometry args={[0.022, 0.075]} />
          <meshStandardMaterial color={PALETTE.tape} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, -0.27, 0]} raycast={none}>
        <planeGeometry args={[0.12, 0.08]} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** One instanced mesh per hold shape, tinted per instance by route colour. */
function HoldBatch({ kind, holds, side }: { kind: Kind; holds: Section['holds']; side: -1 | 1 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = holdGeometry(kind.type, kind.size, kind.variant);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const z = new THREE.Vector3(0, 0, 1);
    const one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    holds.forEach((h, i) => {
      // Local panel space: x along width, y up the panel, z out of it.
      m.compose(new THREE.Vector3(side < 0 ? -h.u : h.u, h.v, 0), q.setFromAxisAngle(z, h.rot), one);
      ref.current!.setMatrixAt(i, m);
      ref.current!.setColorAt(i, c.set(h.color));
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [holds, side]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, holds.length]} raycast={none}>
      <meshStandardMaterial vertexColors flatShading roughness={0.85} />
    </instancedMesh>
  );
}

/** The T-nut grid every gym panel has, one instanced mesh per wall. */
function TNuts({ width, side }: { width: number; side: -1 | 1 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: [number, number][] = [];
    for (let u = 0.1; u < width - 0.05; u += 0.2)
      for (let v = 0.15; v < PANEL_H - 0.05; v += 0.2) out.push([side < 0 ? -u : u, v + ((Math.round(u / 0.2) % 2) * 0.1)]);
    return out;
  }, [width, side]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, y], i) => ref.current!.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, -0.009), q, one)));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} raycast={none}>
      <cylinderGeometry args={[0.007, 0.007, 0.002, 6]} />
      <meshBasicMaterial color="#6f6658" />
    </instancedMesh>
  );
}

function SideWall({ s, side }: { s: Section; side: -1 | 1 }) {
  const a = (s.angle * Math.PI) / 180;
  const batches = useMemo(() => {
    const by = new Map<string, Section['holds']>();
    for (const h of s.holds) {
      const key = `${h.type}:${h.size}:${h.variant}`;
      by.set(key, [...(by.get(key) ?? []), h]);
    }
    return [...by.values()];
  }, [s]);
  return (
    <group position={[s.x, 0, 0]} rotation={[0, s.yaw, 0]}>
      <group rotation={[-a, 0, 0]}>
        <mesh position={[(side * s.width) / 2, PANEL_H / 2, -0.06]} receiveShadow raycast={none}>
          <boxGeometry args={[s.width, PANEL_H, 0.1]} />
          <meshStandardMaterial color="#c2b59d" roughness={0.95} flatShading />
        </mesh>
        {/* Plywood sheet seams. */}
        {[1.22, 2.44].map((y) => (
          <mesh key={y} position={[(side * s.width) / 2, y, -0.0095]} raycast={none}>
            <planeGeometry args={[s.width, 0.006]} />
            <meshBasicMaterial color="#a8987f" />
          </mesh>
        ))}
        <TNuts width={s.width} side={side} />
        {batches.map((hs) => (
          <HoldBatch key={`${hs[0].type}:${hs[0].size}:${hs[0].variant}`} kind={hs[0]} holds={hs} side={side} />
        ))}
        {s.routes.map((route) => (
          <RouteTag key={route.color} route={route} x={side < 0 ? -route.start.u : route.start.u} />
        ))}
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

export function Gym({ wall, avoid }: { wall: Wall; avoid: string }) {
  const secs = useMemo(() => sections(wall, avoid), [wall, avoid]);
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
