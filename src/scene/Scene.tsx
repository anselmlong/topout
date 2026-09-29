import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { bestPull, wallHeight } from '../solver/model';
import type { Day, Hold, Wall } from '../solver/types';
import { climberFocus, useClimb } from '../state/climb';
import { useGame } from '../state/store';
import { Climber } from './Climber';
import { holdGeometry } from './holdGeometry';
import { HOLD_COLOR, PALETTE } from './palette';
import { BetaOverlay } from './BetaOverlay';
import { ChalkDust } from './Chalk';
import { Gym } from './Gym';
import { frameAt, holdQuaternion, padBox, panelFrames, panelGeometry, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';

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
      <fog attach="fog" args={[PALETTE.sky, 16, 34]} />
      <Lights />
      <WallView day={day} />
      <Climber day={day} />
      <ChalkDust />
      <BetaOverlay day={day} />
      <Floor wall={day.wall} />
      <Gym wall={day.wall} />
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
  const controls = useRef<OrbitControlsImpl>(null);
  const nonce = useGame((s) => s.viewNonce);
  // The wheel rotates the armed/selected hold; otherwise it zooms.
  const holdActive = useGame((s) => !!s.armed || !!s.selectedId);
  // Decided before the press: over a placed hold (or already dragging one), the mouse edits.
  const editingHold = useGame((s) => !!s.hoverHoldId || !!s.draggingId);
  if (import.meta.env.DEV) (window as unknown as { __cam: THREE.Camera }).__cam = camera;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const target = useMemo(() => {
    const b = wallBounds(wall);
    return new THREE.Vector3(0, b.height / 2 + 0.05, b.depth / 2);
  }, [wall]);

  // Follow the climber up the wall during a playback, until the user takes the camera.
  const playRun = useGame((s) => s.playback?.run ?? 0);
  const userMoved = useRef(false);
  const shakeOffset = useRef(new THREE.Vector3());
  useEffect(() => {
    userMoved.current = false;
  }, [playRun]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => (userMoved.current = true);
    c.addEventListener('start', onStart);
    return () => c.removeEventListener('start', onStart);
  }, []);
  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    // Landing shake: jolt the view, then let the next frame's jolt replace it.
    camera.position.sub(shakeOffset.current);
    shakeOffset.current.set(0, 0, 0);
    if (climberFocus.shake > 0.001) {
      const k = climberFocus.shake;
      shakeOffset.current.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
      camera.position.add(shakeOffset.current);
      climberFocus.shake *= 0.86;
    }
    if (userMoved.current) return;
    const b = wallBounds(wall);
    // Track the climber; once they're off the wall, drift back to the home framing.
    const want = climberFocus.active
      ? Math.max(target.y - 0.4, Math.min(b.height - 0.9, climberFocus.pos.y - 0.2))
      : target.y;
    if (Math.abs(want - c.target.y) < 1e-4) return;
    const dy = (want - c.target.y) * 0.03;
    c.target.y += dy;
    camera.position.y += dy;
  });

  // Front-on framing. Only on load / new wall / "Reset view", never mid-orbit.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const b = wallBounds(wall);
    const vfov = (cam.fov * Math.PI) / 180;
    const aspect = sizeRef.current.width / sizeRef.current.height;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitH = (b.height * 0.5 + 0.35 + b.depth * 0.15) / Math.tan(vfov / 2);
    const fitW = (wall.width / 200 + 0.3) / Math.tan(hfov / 2);
    const d = Math.max(fitH, fitW);
    cam.position.set(0.0, target.y + 0.25, target.z + d);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    controls.current?.target.copy(target);
    controls.current?.update();
  }, [camera, wall, target, nonce]);

  return (
    <OrbitControls
      ref={controls}
      target={target}
      enableDamping
      dampingFactor={0.12}
      enableZoom={!holdActive}
      maxPolarAngle={Math.PI * 0.55}
      // Stay in front of the wall: there's nothing to see behind it.
      minAzimuthAngle={-1.25}
      maxAzimuthAngle={1.25}
      minDistance={2.5}
      maxDistance={18}
      // Left button belongs to setting (unless Space is held); right orbits, middle pans.
      enabled={!editingHold}
      // Left-drag orbits (Shift+left pans); a click without dragging still places/selects.
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

function Floor({ wall }: { wall: Wall }) {
  const pad = padBox(wall);
  const padDepth = pad.length;
  const w = pad.width;
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
          if (!d && s.trayDrag && s.armed) return s.commit();
          if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
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
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const geometry = holdGeometry(hold.type, hold.size, variantOf(hold.id));
  const t = placeOnWall(wall, frames, hold.u, hold.v, hold.rot);
  // Used holds get chalky.
  const chalk = useClimb((s) => s.chalk[hold.id] ?? 0);
  const color = useMemo(
    () => new THREE.Color(HOLD_COLOR[hold.type]).lerp(new THREE.Color('#f4f2ec'), Math.min(0.5, chalk * 0.1)),
    [hold.type, chalk],
  );

  return (
    <group position={t.position} quaternion={t.quaternion}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          if (fixed) return;
          if (e.button === 2) {
            rightDown.current = { x: e.clientX, y: e.clientY };
            return;
          }
          if (e.button !== 0) return;
          // Don't stop propagation: the wall underneath keeps receiving moves while dragging.
          startDrag(hold.id);
        }}
        onPointerUp={(e) => {
          const d = rightDown.current;
          rightDown.current = null;
          if (fixed || e.button !== 2 || !d) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) remove(hold.id);
        }}
        onContextMenu={(e) => e.nativeEvent.preventDefault()}
        onPointerOver={(e) => {
          // Only claim the mouse before a press (an orbit sweeping across must keep going),
          // and only when the hold can actually be edited.
          const s = useGame.getState();
          const editable = !s.done && !s.viewing && s.phase === 'setting';
          if (!fixed && editable && e.buttons === 0) useGame.setState({ hoverHoldId: hold.id });
        }}
        onPointerOut={() => useGame.getState().hoverHoldId === hold.id && useGame.setState({ hoverHoldId: null })}
        raycast={fixed ? () => null : undefined}
      >
        <meshStandardMaterial color={color} flatShading roughness={0.85 + chalk * 0.02} transparent={dragging} opacity={dragging ? 0.75 : 1} />
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
