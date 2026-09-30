// Volumes on the wall: flat-shaded fibreglass shells. They take pointer events
// like the wall (placing, dragging) and can be dragged / rotated / removed
// like holds.
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { volumeDims } from '../solver/volumes';
import type { Volume, Wall } from '../solver/types';
import { useGame, type Armed, type Ghost } from '../state/store';
import { PALETTE, VOLUME_COLOR } from './palette';
import { frameAt, holdQuaternion, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';
import { useWallPointer } from './wallPointer';

const cache = new Map<string, THREE.BufferGeometry>();

/** Local frame (metres): x across, y up the wall, z out. Faces only, no back. */
export function volumeGeometry(v: Pick<Volume, 'shape' | 'size'>): THREE.BufferGeometry {
  const key = `${v.shape}:${v.size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = volumeDims(v);
  const a = d.a / 100;
  const b = d.b / 100;
  const h = d.h / 100;
  const tris: number[][] = [];
  const tri = (p: number[], q: number[], r: number[]) => tris.push([...p, ...q, ...r]);
  if (v.shape === 'pyramid') {
    const apex = [0, 0, h];
    const c = [
      [-a, -a, 0],
      [a, -a, 0],
      [a, a, 0],
      [-a, a, 0],
    ];
    for (let i = 0; i < 4; i++) tri(c[i], c[(i + 1) % 4], apex);
  } else {
    const r0 = [-a, 0, h];
    const r1 = [a, 0, h];
    const top = [
      [-a, b, 0],
      [a, b, 0],
    ];
    const bot = [
      [-a, -b, 0],
      [a, -b, 0],
    ];
    // Up face, down face, two end caps.
    tri(top[1], top[0], r0);
    tri(top[1], r0, r1);
    tri(bot[0], bot[1], r1);
    tri(bot[0], r1, r0);
    tri(bot[0], r0, top[0]);
    tri(bot[1], top[1], r1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  cache.set(key, g);
  return g;
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
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: VOLUME_COLOR, flatShading: true, roughness: 0.7 }),
    [],
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
          if (e.button === 0 && s.hoverHoldId === vol.id) s.startDrag(vol.id);
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
