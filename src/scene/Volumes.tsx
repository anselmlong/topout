// Volumes on the wall: flat-shaded fibreglass shells, glossy and drilled with
// T-nut holes, bolted to the wall. They take pointer events
// like the wall (placing, dragging) and can be dragged / rotated / removed
// like holds.
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { volumeDims } from '../solver/volumes';
import type { Volume, Wall } from '../solver/types';
import { useGame, type Armed, type Ghost } from '../state/store';
import { PALETTE, VOLUME_COLOR } from './palette';
import { frameAt, holdQuaternion, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';
import { useWallPointer } from './wallPointer';

const cache = new Map<string, THREE.BufferGeometry>();

interface VolumeFace {
  /** Corners (metres, volume frame), wound counter-clockwise seen from outside. */
  pts: THREE.Vector3[];
  /** Outward unit normal. */
  n: THREE.Vector3;
  /** Gets one of the bolts that hold the shell to the wall. */
  mount: boolean;
}

/** The shell's faces in the volume's local frame (metres): x across, y up the wall, z out. No back. */
function volumeFaces(v: Pick<Volume, 'shape' | 'size'>): VolumeFace[] {
  const d = volumeDims(v);
  const a = d.a / 100;
  const b = d.b / 100;
  const h = d.h / 100;
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const face = (pts: THREE.Vector3[], mount = false): VolumeFace => {
    const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
    return { pts, n, mount };
  };
  if (v.shape === 'pyramid') {
    const apex = P(0, 0, h);
    const c = [P(-a, -a, 0), P(a, -a, 0), P(a, a, 0), P(-a, a, 0)];
    // Bolted through the bottom and top faces, like a real pyramid's two mounting holes.
    return c.map((p, i) => face([p, c[(i + 1) % 4], apex], i % 2 === 0));
  }
  const r0 = P(-a, 0, h);
  const r1 = P(a, 0, h);
  const top = [P(-a, b, 0), P(a, b, 0)];
  const bot = [P(-a, -b, 0), P(a, -b, 0)];
  return [
    face([top[1], top[0], r0, r1], true),
    face([bot[0], bot[1], r1, r0], true),
    face([bot[0], r0, top[0]]),
    face([bot[1], top[1], r1]),
  ];
}

/** Local frame (metres): x across, y up the wall, z out. Faces only, no back. */
export function volumeGeometry(v: Pick<Volume, 'shape' | 'size'>): THREE.BufferGeometry {
  const key = `${v.shape}:${v.size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tris: number[] = [];
  for (const f of volumeFaces(v))
    for (let i = 1; i + 1 < f.pts.length; i++) tris.push(...f.pts[0].toArray(), ...f.pts[i].toArray(), ...f.pts[i + 1].toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  cache.set(key, g);
  return g;
}

interface Fixing {
  at: THREE.Vector3;
  q: THREE.Quaternion;
}

const hardwareCache = new Map<string, { tnuts: Fixing[]; mounts: Fixing[] }>();

/**
 * What's bolted through a volume's shell: a big socket-head bolt and fender washer on its
 * mounting faces (what holds it to the wall), and a grid of T-nut holes across every face,
 * about 12 cm apart in staggered rows and clear of the edges, for holds to bolt into. Real fibreglass volumes
 * come drilled like this; it's most of what tells a volume from a giant hold.
 */
function volumeHardware(v: Pick<Volume, 'shape' | 'size'>) {
  const key = `${v.shape}:${v.size}`;
  const hit = hardwareCache.get(key);
  if (hit) return hit;
  const tnuts: Fixing[] = [];
  const mounts: Fixing[] = [];
  const Z = new THREE.Vector3(0, 0, 1);
  for (const f of volumeFaces(v)) {
    const q = new THREE.Quaternion().setFromUnitVectors(Z, f.n);
    const c = f.pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(f.pts.length);
    // How far a point on the face is inside each edge (the face is convex).
    const inside = (p: THREE.Vector3) =>
      Math.min(
        ...f.pts.map((a, i) => {
          const b = f.pts[(i + 1) % f.pts.length];
          const inward = f.n.clone().cross(b.clone().sub(a)).normalize();
          return p.clone().sub(a).dot(inward);
        }),
      );
    // The mounting bolt goes a little toward the wall from the middle, where the shell is stiffest.
    const mountAt = f.mount ? c.clone().lerp(f.pts[0].clone().add(f.pts[1]).multiplyScalar(0.5), 0.2) : null;
    if (mountAt) mounts.push({ at: mountAt.clone().addScaledVector(f.n, 0.0005), q });
    const e1 = f.pts[1].clone().sub(f.pts[0]).normalize();
    const e2 = f.n.clone().cross(e1);
    const step = 0.12;
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++) {
        // Staggered rows, like a drilled shell rather than a pegboard.
        const p = c.clone().addScaledVector(e1, (i + (j % 2) / 2) * step).addScaledVector(e2, j * step * 0.87 + step / 2);
        if (inside(p) < 0.035) continue;
        if (mountAt && p.distanceTo(mountAt) < 0.06) continue;
        tnuts.push({ at: p.addScaledVector(f.n, 0.0006), q });
      }
  }
  const out = { tnuts, mounts };
  hardwareCache.set(key, out);
  return out;
}

let gelcoatEnv: THREE.Texture | null = null;

/**
 * A soft room for the gelcoat to reflect: without something to mirror, a glossy face under
 * two lights shades the same as a matt one. Built once, used by the volumes only, so the
 * plywood and the holds stay matt.
 */
function gelcoatReflections(gl: THREE.WebGLRenderer) {
  if (!gelcoatEnv) {
    const pmrem = new THREE.PMREMGenerator(gl);
    gelcoatEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return gelcoatEnv;
}

const tnutGeometry = new THREE.CircleGeometry(0.0065, 8);
const tnutMaterial = new THREE.MeshBasicMaterial({ color: '#3a3936' });

/** T-nut holes and mounting bolts on a volume; drawn in the volume's own frame. */
function VolumeHardware({ vol }: { vol: Pick<Volume, 'shape' | 'size'> }) {
  const { tnuts, mounts } = volumeHardware(vol);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    tnuts.forEach((t, i) => ref.current!.setMatrixAt(i, m.compose(t.at, t.q, one)));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [tnuts]);
  return (
    <group>
      <instancedMesh ref={ref} args={[tnutGeometry, tnutMaterial, tnuts.length]} raycast={() => null} />
      {mounts.map((m, i) => (
        // Cylinders stand on y; turn them to stand on the face.
        <group key={i} position={m.at} quaternion={m.q}>
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh position={[0, 0.001, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.017, 0.017, 0.002, 16]} />
              <meshStandardMaterial color="#8d9094" metalness={0.7} roughness={0.35} flatShading />
            </mesh>
            <mesh position={[0, 0.0048, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.0078, 0.0082, 0.0056, 14]} />
              <meshStandardMaterial color="#3d3e41" metalness={0.6} roughness={0.4} flatShading />
            </mesh>
            <mesh position={[0, 0.0077, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.0042, 0.0042, 0.0004, 6]} />
              <meshBasicMaterial color="#121212" />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

function volumeTransform(wall: Wall, frames: PanelFrame[], vol: Pick<Volume, 'u' | 'v' | 'rot'>) {
  const f = frameAt(frames, vol.u, vol.v);
  return {
    frame: f,
    position: uvToWorld(wall, frames, vol.u, vol.v).addScaledVector(f.normal, 0.002),
    quaternion: holdQuaternion(f, vol.rot),
  };
}

export function VolumeMesh({ vol, wall, frames, fixed }: { vol: Volume; wall: Wall; frames: PanelFrame[]; fixed?: boolean }) {
  const t = volumeTransform(wall, frames, vol);
  const selected = useGame((s) => s.selectedId === vol.id);
  const dragging = useGame((s) => s.draggingId === vol.id);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  // Hits on the volume are projected back onto the wall plane.
  const pointer = useWallPointer((e: ThreeEvent<PointerEvent>) => worldToUv(wall, t.frame, e.point));
  const geometry = volumeGeometry(vol);
  // Smooth gelcoat over fibreglass: a glossy coat that catches the lights, unlike the matt
  // plywood behind it and the gritty holds bolted on it.
  const gl = useThree((s) => s.gl);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: VOLUME_COLOR,
        flatShading: true,
        roughness: 0.42,
        clearcoat: 0.45,
        clearcoatRoughness: 0.18,
        envMap: gelcoatReflections(gl),
        envMapIntensity: 0.12,
      }),
    [gl],
  );

  return (
    <group position={t.position} quaternion={t.quaternion}>
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        {...pointer}
        // Stop here: the wall panel behind would otherwise handle the same event again
        // (double placement, instant deselect, and (u, v) from behind the volume).
        onPointerMove={(e) => {
          e.stopPropagation();
          pointer.onPointerMove(e);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          pointer.onPointerDown(e);
          const s = useGame.getState();
          if (fixed || s.armed) return;
          if (e.button === 2) {
            rightDown.current = { x: e.clientX, y: e.clientY };
            return;
          }
          if (e.button !== 0 || s.draggingId) return;
          // A mouse must hover first (so a press that missed the volume still orbits). A finger
          // never hovers before it presses, and one finger doesn't orbit, so touch drags straight away.
          if (s.hoverHoldId === vol.id || e.pointerType !== 'mouse') s.startDrag(vol.id);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const d = rightDown.current;
          rightDown.current = null;
          if (!fixed && e.button === 2 && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) {
            useGame.getState().remove(vol.id);
            return;
          }
          pointer.onPointerUp(e);
        }}
        onPointerOver={(e) => {
          // Volumes claim the mouse only when nothing is armed (so holds can be placed on them).
          const s = useGame.getState();
          const editable = !s.done && !s.viewing && s.phase === 'setting' && !s.armed;
          if (!fixed && editable && e.buttons === 0) useGame.setState({ hoverHoldId: vol.id });
        }}
        onPointerOut={() => {
          pointer.onPointerOut();
          if (useGame.getState().hoverHoldId === vol.id) useGame.setState({ hoverHoldId: null });
        }}
        onContextMenu={(e) => e.nativeEvent.preventDefault()}
      />
      <VolumeHardware vol={vol} />
      {(selected || dragging) && (
        <mesh geometry={geometry} scale={1.04} raycast={() => null}>
          <meshBasicMaterial color={PALETTE.select} wireframe />
        </mesh>
      )}
    </group>
  );
}

export function GhostVolume({
  wall,
  frames,
  armed,
  ghost,
  rot,
}: {
  wall: Wall;
  frames: PanelFrame[];
  armed: Armed;
  ghost: Ghost;
  rot: number;
}) {
  const t = volumeTransform(wall, frames, { u: ghost.u, v: ghost.v, rot });
  const shape = { shape: armed.shape ?? 'pyramid', size: armed.size === 'l' ? 'l' : 's' } as const;
  return (
    <mesh position={t.position} quaternion={t.quaternion} geometry={volumeGeometry(shape)} raycast={() => null}>
      <meshStandardMaterial
        color={ghost.valid ? PALETTE.ghostOk : PALETTE.ghostBad}
        transparent
        opacity={0.5}
        flatShading
        depthWrite={false}
      />
    </mesh>
  );
}
