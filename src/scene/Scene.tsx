import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { defaultSpots, spotsOf } from '../game/spots';
import { bestPull, wallHeight } from '../solver/model';
import type { Day, Hold, Volume, Wall } from '../solver/types';
import { surfaceAt } from '../solver/volumes';
import { climberFocus, useClimb } from '../state/climb';
import { useGame } from '../state/store';
import { Climber } from './Climber';
import { holdGeometry, holdMesh } from './holdGeometry';
import { PALETTE, routeColor } from './palette';
import { BetaOverlay } from './BetaOverlay';
import { ChalkDust } from './Chalk';
import { Gym } from './Gym';
import { ReachGuide } from './ReachGuide';
import { GhostVolume, VolumeMesh } from './Volumes';
import { frameAt, holdQuaternion, padBox, panelFrames, panelGeometry, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';
import { useWallPointer } from './wallPointer';

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
    // Portrait screens are width-bound: keep the side margin small there.
    const fitW = (wall.width / 200 + (aspect < 1 ? 0.12 : 0.3)) / Math.tan(hfov / 2);
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
      // Over a hold, the left button edits it instead.
      enabled={!editingHold}
      // Left-drag orbits (Shift+left pans); right- or middle-drag pans (two-finger click-drag on a
      // trackpad). A click without dragging still places/selects.
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
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
  const volumes = useGame((s) => (s.viewing ? s.viewingVolumes : s.volumes));
  const mySpots = useGame((s) => s.spots);
  const viewingSpots = useGame((s) => s.viewingSpots);
  const holds = viewing ?? placed;
  const spots = viewing ? (viewingSpots ?? defaultSpots(day)) : mySpots;
  const tint = routeColor(day).hex;
  return (
    <group>
      {frames.map((f) => (
        <PanelMesh key={f.index} wall={day.wall} frame={f} />
      ))}
      <Bolts wall={day.wall} frames={frames} />
      {volumes.map((v) => (
        <VolumeMesh key={v.id} vol={v} wall={day.wall} frames={frames} fixed={!!viewing} />
      ))}
      {spotsOf(day).map((h) =>
        spots[h.id] ? (
          <HoldMesh key={h.id} hold={{ ...h, ...spots[h.id] }} wall={day.wall} frames={frames} fixed={!!viewing} spot tint={tint} />
        ) : (
          !viewing && <EmptySpot key={h.id} hold={h} wall={day.wall} frames={frames} />
        ),
      )}
      {day.start.map((h) => (
        <Tape key={`t-${h.id}`} hold={h} wall={day.wall} frames={frames} kind="start" />
      ))}
      <Tape hold={day.finish} wall={day.wall} frames={frames} kind="finish" />
      {holds.map((h) => (
        <HoldMesh key={h.id} hold={h} wall={day.wall} frames={frames} fixed={!!viewing} tint={tint} />
      ))}
      <GhostHold wall={day.wall} frames={frames} />
      <ReachGuide day={day} frames={frames} />
    </group>
  );
}

function PanelMesh({ wall, frame }: { wall: Wall; frame: PanelFrame }) {
  const geometry = useMemo(() => panelGeometry(wall, frame, wall.seed), [wall, frame]);
  const handlers = useWallPointer((e: ThreeEvent<PointerEvent>) => worldToUv(wall, frame, e.point));
  const length = (frame.v1 - frame.v0) / 100;
  const width = (frame.u1 - frame.u0) / 100;
  const mid = frame.origin
    .clone()
    .addScaledVector(frame.up, length / 2)
    .addScaledVector(frame.right, width / 2)
    .addScaledVector(frame.normal, -0.056);
  const q = holdQuaternion(frame, 0);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow {...handlers}>
        <meshStandardMaterial vertexColors flatShading roughness={0.9} />
      </mesh>
      {/* Panel thickness + side rails so the wall reads as a solid object. */}
      <mesh position={mid} quaternion={q} castShadow receiveShadow>
        <boxGeometry args={[width + (wall.fold ? 0.02 : 0.08), length, 0.1]} />
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
        const f = frameAt(frames, u, v);
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

/** Where a hold sits: on the wall, or up on a volume's face and tilted to match it. */
function placeOnWall(wall: Wall, frames: PanelFrame[], u: number, v: number, rot: number, volumes?: Volume[]) {
  const f = frameAt(frames, u, v);
  const position = uvToWorld(wall, frames, u, v).addScaledVector(f.normal, 0.004);
  const s = surfaceAt(volumes, u, v);
  if (!s) return { position, quaternion: holdQuaternion(f, rot) };
  position.addScaledVector(f.normal, s.height / 100);
  const base = holdQuaternion(f, 0);
  const tilt = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(s.normal.u, s.normal.v, s.normal.z),
  );
  const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rot);
  return { position, quaternion: base.multiply(tilt).multiply(spin) };
}

function variantOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function HoldMesh({
  hold,
  wall,
  frames,
  fixed,
  spot,
  tint,
}: {
  hold: Hold;
  wall: Wall;
  frames: PanelFrame[];
  fixed?: boolean;
  /** On a taped start/finish spot: click selects it, but it can't be dragged off. */
  spot?: boolean;
  tint: string;
}) {
  const selected = useGame((s) => s.selectedId === hold.id);
  const dragging = useGame((s) => s.draggingId === hold.id);
  const startDrag = useGame((s) => s.startDrag);
  const remove = useGame((s) => s.remove);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const { geometry, bolt } = holdMesh(hold.type, hold.size, variantOf(hold.id));
  const volumes = useGame((s) => (s.viewing ? s.viewingVolumes : s.volumes));
  const t = placeOnWall(wall, frames, hold.u, hold.v, hold.rot, volumes);
  // Used holds get chalky.
  const chalk = useClimb((s) => s.chalk[hold.id] ?? 0);
  // A faint dusting all over, and real build-up on the faces hands and shoes use.
  const color = useMemo(
    () => new THREE.Color(tint).lerp(new THREE.Color('#f4f2ec'), Math.min(0.12, chalk * 0.03)),
    [tint, chalk],
  );
  const chalkUniform = useMemo(() => ({ value: 0 }), []);
  chalkUniform.value = chalk > 0 ? Math.min(0.85, 0.3 + chalk * 0.12) : 0;
  const addChalk = useMemo(() => chalkShader(chalkUniform), [chalkUniform]);

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
          if (spot) {
            // Keep the wall from treating this as a click on empty wall (which deselects).
            e.stopPropagation();
            return useGame.getState().select(hold.id);
          }
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
        <meshStandardMaterial
          vertexColors
          color={color}
          flatShading
          roughness={0.85 + chalk * 0.02}
          onBeforeCompile={addChalk}
          transparent={dragging}
          opacity={dragging ? 0.75 : 1}
        />
      </mesh>
      {bolt && (
        // A countersunk bolt hole: a shadowed recess with a hex-socket bolt head in it.
        <group position={bolt} rotation={[Math.PI / 2, 0, 0]}>
          <mesh raycast={() => null}>
            <cylinderGeometry args={[0.0115, 0.009, 0.002, 10]} />
            <meshStandardMaterial color="#2c2b2a" roughness={0.95} flatShading />
          </mesh>
          <mesh position={[0, 0.0012, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.0068, 0.0072, 0.0016, 12]} />
            <meshStandardMaterial color="#6a6c70" metalness={0.65} roughness={0.38} flatShading />
          </mesh>
          <mesh position={[0, 0.0021, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.0032, 0.0032, 0.0004, 6]} />
            <meshBasicMaterial color="#161616" />
          </mesh>
        </group>
      )}
      {selected && <Selection hold={hold} />}
    </group>
  );
}

/**
 * Hold surface: a fine sandy grit, like the textured polyurethane real holds are
 * cast in, then chalk white mixed in where the geometry's `grip` attribute says
 * hands and feet go (the incut of an edge, a pinch's flanks, a sloper's dome),
 * scaled by how much the hold has been used. The grit is a few-millimetre speckle
 * in the hold's own frame, so it sticks to the hold, and it fades out once its
 * grains get smaller than a pixel instead of shimmering at a distance.
 */
function chalkShader(amount: { value: number }) {
  return (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => {
    shader.uniforms.uChalk = amount;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float grip;\nvarying float vGrip;\nvarying vec3 vHoldPos;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrip = grip;\nvHoldPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uChalk;
varying float vGrip;
varying vec3 vHoldPos;
float gritHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float gritNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gritHash(i), gritHash(i + vec3(1, 0, 0)), f.x), mix(gritHash(i + vec3(0, 1, 0)), gritHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(gritHash(i + vec3(0, 0, 1)), gritHash(i + vec3(1, 0, 1)), f.x), mix(gritHash(i + vec3(0, 1, 1)), gritHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // Grains about 2.5 mm across (coarser than real grit so it reads at game zoom), and a soft mottle a couple of centimetres wide.
  vec3 gp = vHoldPos * 420.0;
  float perPixel = length(fwidth(gp));
  float grain = (gritHash(floor(gp)) - 0.5) * (1.0 - smoothstep(0.35, 1.1, perPixel));
  float mottle = gritNoise(vHoldPos * 55.0) - 0.5;
  diffuseColor.rgb *= 1.0 + 0.24 * grain + 0.16 * mottle;
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.89), clamp(vGrip * uChalk, 0.0, 0.85));`,
      );
  };
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
  const volumes = useGame((s) => s.volumes);
  if (!ghost || (!armed && !dragging)) return null;
  if (armed?.type === 'volume') return <GhostVolume wall={wall} frames={frames} armed={armed} ghost={ghost} rot={rot} />;
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
  const t = placeOnWall(wall, frames, ghost.u, ghost.v, rot, volumes);
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

/** An unfilled start/finish spot: a ring to click, then pick its hold. */
function EmptySpot({ hold, wall, frames }: { hold: Hold; wall: Wall; frames: PanelFrame[] }) {
  const selected = useGame((s) => s.selectedId === hold.id);
  const f = frameAt(frames, hold.u, hold.v);
  const position = uvToWorld(wall, frames, hold.u, hold.v).addScaledVector(f.normal, 0.007);
  const editable = () => {
    const s = useGame.getState();
    return !s.done && !s.viewing && s.phase === 'setting';
  };
  return (
    <group position={position} quaternion={holdQuaternion(f, 0)}>
      <mesh
        onPointerDown={(e) => {
          if (e.button !== 0 || !editable()) return;
          e.stopPropagation();
          useGame.getState().select(hold.id);
        }}
        onPointerOver={(e) => editable() && e.buttons === 0 && useGame.setState({ hoverHoldId: hold.id })}
        onPointerOut={() => useGame.getState().hoverHoldId === hold.id && useGame.setState({ hoverHoldId: null })}
      >
        <circleGeometry args={[0.08, 24]} />
        <meshBasicMaterial color={PALETTE.tape} transparent opacity={selected ? 0.3 : 0.12} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null}>
        <ringGeometry args={[0.072, selected ? 0.086 : 0.08, 32]} />
        <meshBasicMaterial color={selected ? PALETTE.ghostOk : PALETTE.tape} transparent opacity={selected ? 1 : 0.7} />
      </mesh>
    </group>
  );
}

function Tape({ hold, wall, frames, kind }: { hold: Hold; wall: Wall; frames: PanelFrame[]; kind: 'start' | 'finish' }) {
  const f = frameAt(frames, hold.u, hold.v);
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
