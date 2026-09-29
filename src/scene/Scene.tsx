import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { bestPull, wallHeight } from '../solver/model';
import type { Day, Hold, Wall } from '../solver/types';
import { useGame } from '../state/store';
import { Climber } from './Climber';
import { holdGeometry } from './holdGeometry';
import { HOLD_COLOR, PALETTE } from './palette';
import { frameAt, holdQuaternion, panelFrames, panelGeometry, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';

export function Scene() {
  const day = useGame((s) => s.day);
  if (!day) return null;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.1, far: 60 }}
      gl={{ antialias: true }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={[PALETTE.sky]} />
      <fog attach="fog" args={[PALETTE.sky, 14, 30]} />
      <Lights />
      <WallView day={day} />
      <Climber day={day} />
      <Floor wall={day.wall} />
      <CameraRig wall={day.wall} />
    </Canvas>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#f4f1ea', '#8c857a', 1.25]} />
      <directionalLight
        position={[-3, 7, 6]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={6}
        shadow-camera-bottom={-1}
        shadow-bias={-0.0004}
        shadow-radius={4}
      />
      <directionalLight position={[4, 3, 5]} intensity={0.35} />
    </>
  );
}

function wallBounds(wall: Wall) {
  const frames = panelFrames(wall);
  const top = uvToWorld(wall, frames, wall.width / 2, wallHeight(wall));
  return { height: top.y, depth: top.z };
}

function CameraRig({ wall }: { wall: Wall }) {
  const { camera, size } = useThree();
  const lookAround = useGame((s) => s.lookAround);
  const target = useMemo(() => {
    const b = wallBounds(wall);
    return new THREE.Vector3(0, b.height / 2 + 0.05, b.depth / 2);
  }, [wall]);

  useEffect(() => {
    if (lookAround) return;
    const cam = camera as THREE.PerspectiveCamera;
    const b = wallBounds(wall);
    const vfov = (cam.fov * Math.PI) / 180;
    const aspect = size.width / size.height;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitH = (b.height * 0.5 + 0.35) / Math.tan(vfov / 2);
    const fitW = (wall.width / 200 + 0.3) / Math.tan(hfov / 2);
    const d = Math.max(fitH, fitW);
    cam.position.set(0.0, target.y + 0.25, target.z + d);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }, [camera, size, wall, target, lookAround]);

  return lookAround ? <OrbitControls target={target} enableDamping maxPolarAngle={Math.PI * 0.55} minDistance={3} maxDistance={16} /> : null;
}

function Floor({ wall }: { wall: Wall }) {
  const { depth } = wallBounds(wall);
  const padDepth = Math.max(2, depth + 1.4);
  const w = wall.width / 100 + 0.6;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 3]} receiveShadow>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color={PALETTE.floor} roughness={1} />
      </mesh>
      <mesh position={[0, 0.15, padDepth / 2 - 0.05]} receiveShadow castShadow>
        <boxGeometry args={[w, 0.3, padDepth]} />
        <meshStandardMaterial color={PALETTE.pad} roughness={0.95} flatShading />
      </mesh>
      {/* Seams between pad sections. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * w) / 6, 0.301, padDepth / 2 - 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.012, padDepth]} />
          <meshBasicMaterial color="#4d5157" />
        </mesh>
      ))}
    </group>
  );
}

function WallView({ day }: { day: Day }) {
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const placed = useGame((s) => s.placed);
  const viewing = useGame((s) => s.viewing);
  const holds = viewing ?? placed;
  return (
    <group>
      {frames.map((f) => (
        <PanelMesh key={f.index} wall={day.wall} frame={f} />
      ))}
      <Bolts wall={day.wall} frames={frames} />
      {[...day.start, day.finish].map((h) => (
        <HoldMesh key={h.id} hold={h} wall={day.wall} frames={frames} fixed />
      ))}
      {day.start.map((h) => (
        <Tape key={`t-${h.id}`} hold={h} wall={day.wall} frames={frames} kind="start" />
      ))}
      <Tape hold={day.finish} wall={day.wall} frames={frames} kind="finish" />
      {holds.map((h) => (
        <HoldMesh key={h.id} hold={h} wall={day.wall} frames={frames} fixed={!!viewing} />
      ))}
      <GhostHold wall={day.wall} frames={frames} />
    </group>
  );
}

function PanelMesh({ wall, frame }: { wall: Wall; frame: PanelFrame }) {
  const geometry = useMemo(() => panelGeometry(wall, frame, wall.seed), [wall, frame]);
  const hover = useGame((s) => s.hover);
  const leave = useGame((s) => s.leave);
  const down = useRef<{ x: number; y: number } | null>(null);

  const toUv = (e: ThreeEvent<PointerEvent>) => worldToUv(wall, frame, e.point);
  const length = (frame.v1 - frame.v0) / 100;
  const mid = frame.origin.clone().addScaledVector(frame.up, length / 2).addScaledVector(frame.normal, -0.056);
  const q = holdQuaternion(frame, 0);

  return (
    <group>
      <mesh
        geometry={geometry}
        receiveShadow
        onPointerMove={(e) => {
          const { u, v } = toUv(e);
          hover(u, v);
        }}
        onPointerOut={() => leave()}
        onPointerDown={(e) => {
          down.current = { x: e.clientX, y: e.clientY };
          const { u, v } = toUv(e);
          hover(u, v);
        }}
        onPointerUp={(e) => {
          const s = useGame.getState();
          if (s.draggingId) return s.endDrag();
          const d = down.current;
          down.current = null;
          if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
          if (s.armed) s.commit();
          else s.select(null);
        }}
      >
        <meshStandardMaterial vertexColors flatShading roughness={0.9} />
      </mesh>
      {/* Panel thickness + side rails so the wall reads as a solid object. */}
      <mesh position={mid} quaternion={q} castShadow receiveShadow>
        <boxGeometry args={[wall.width / 100 + 0.08, length, 0.1]} />
        <meshStandardMaterial color={PALETTE.plyDark} roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

function Bolts({ wall, frames }: { wall: Wall; frames: PanelFrame[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
    const h = wallHeight(wall);
    for (let v = 10, row = 0; v < h - 5; v += 20, row++)
      for (let u = row % 2 ? 20 : 10; u < wall.width - 5; u += 20) {
        const f = frameAt(frames, v);
        out.push({ p: uvToWorld(wall, frames, u, v).addScaledVector(f.normal, 0.0075), q: holdQuaternion(f, 0) });
      }
    return out;
  }, [wall, frames]);

  useEffect(() => {
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => ref.current!.setMatrixAt(i, m.compose(s.p, s.q, new THREE.Vector3(1, 1, 1))));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [spots]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} raycast={() => null}>
      <circleGeometry args={[0.007, 6]} />
      <meshBasicMaterial color={PALETTE.bolt} />
    </instancedMesh>
  );
}

function placeOnWall(wall: Wall, frames: PanelFrame[], u: number, v: number, rot: number) {
  const f = frameAt(frames, v);
  return { position: uvToWorld(wall, frames, u, v).addScaledVector(f.normal, 0.004), quaternion: holdQuaternion(f, rot) };
}

function variantOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function HoldMesh({ hold, wall, frames, fixed }: { hold: Hold; wall: Wall; frames: PanelFrame[]; fixed?: boolean }) {
  const selected = useGame((s) => s.selectedId === hold.id);
  const dragging = useGame((s) => s.draggingId === hold.id);
  const startDrag = useGame((s) => s.startDrag);
  const remove = useGame((s) => s.remove);
  const geometry = holdGeometry(hold.type, hold.size, variantOf(hold.id));
  const t = placeOnWall(wall, frames, hold.u, hold.v, hold.rot);

  return (
    <group position={t.position} quaternion={t.quaternion}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          if (fixed || e.button !== 0) return;
          // Don't stop propagation: the wall underneath keeps receiving moves while dragging.
          startDrag(hold.id);
        }}
        onContextMenu={(e) => {
          if (fixed) return;
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          remove(hold.id);
        }}
        raycast={fixed ? () => null : undefined}
      >
        <meshStandardMaterial color={HOLD_COLOR[hold.type]} flatShading roughness={0.85} transparent={dragging} opacity={dragging ? 0.75 : 1} />
      </mesh>
      {selected && <Selection hold={hold} />}
    </group>
  );
}

/** Outline ring plus an arrow showing the direction the hold wants to be pulled. */
function Selection({ hold }: { hold: Hold }) {
  const geometry = holdGeometry(hold.type, hold.size, variantOf(hold.id));
  const pull = bestPull(0);
  return (
    <group>
      <mesh geometry={geometry} scale={1.18} raycast={() => null}>
        <meshBasicMaterial color={PALETTE.select} side={THREE.BackSide} />
      </mesh>
      <PullArrow dir={pull} />
    </group>
  );
}

function PullArrow({ dir, color = PALETTE.select }: { dir: { u: number; v: number }; color?: string }) {
  // Local frame: arrow in the wall plane, starting just past the hold's edge.
  const angle = Math.atan2(dir.v, dir.u) - Math.PI / 2;
  return (
    <group rotation={[0, 0, angle]} raycast={() => null}>
      <mesh position={[0, 0.1, 0.005]}>
        <planeGeometry args={[0.008, 0.06]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.135, 0.005]}>
        <circleGeometry args={[0.018, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function GhostHold({ wall, frames }: { wall: Wall; frames: PanelFrame[] }) {
  const armed = useGame((s) => s.armed);
  const ghost = useGame((s) => s.ghost);
  const rot = useGame((s) => s.ghostRot);
  const dragging = useGame((s) => s.draggingId);
  if (!ghost || (!armed && !dragging)) return null;
  if (dragging) {
    if (ghost.valid) return null;
    // Show where the invalid drop would be.
    const t = placeOnWall(wall, frames, ghost.u, ghost.v, 0);
    return (
      <mesh position={t.position} quaternion={t.quaternion} raycast={() => null}>
        <ringGeometry args={[0.05, 0.065, 16]} />
        <meshBasicMaterial color={PALETTE.ghostBad} transparent opacity={0.8} />
      </mesh>
    );
  }
  const t = placeOnWall(wall, frames, ghost.u, ghost.v, rot);
  const color = ghost.valid ? PALETTE.ghostOk : PALETTE.ghostBad;
  return (
    <group position={t.position} quaternion={t.quaternion}>
      <mesh geometry={holdGeometry(armed!.type, armed!.size, 0)} raycast={() => null}>
        <meshStandardMaterial color={color} transparent opacity={0.6} flatShading depthWrite={false} />
      </mesh>
      <PullArrow dir={bestPull(0)} color={color} />
    </group>
  );
}

function Tape({ hold, wall, frames, kind }: { hold: Hold; wall: Wall; frames: PanelFrame[]; kind: 'start' | 'finish' }) {
  const f = frameAt(frames, hold.v);
  const q = holdQuaternion(f, 0);
  const strips =
    kind === 'start'
      ? [
          { x: -0.02, y: -0.1, r: 0.35 },
          { x: 0.02, y: -0.1, r: -0.35 },
        ]
      : [
          { x: -0.06, y: 0.1, r: -0.6 },
          { x: 0, y: 0.12, r: 0 },
          { x: 0.06, y: 0.1, r: 0.6 },
        ];
  const base = uvToWorld(wall, frames, hold.u, hold.v).addScaledVector(f.normal, 0.0065);
  return (
    <group position={base} quaternion={q}>
      {strips.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, 0]} rotation={[0, 0, s.r]} raycast={() => null}>
          <planeGeometry args={[0.022, 0.075]} />
          <meshStandardMaterial color={PALETTE.tape} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
