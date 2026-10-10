import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { nextTraySeed } from '../game/rules';
import { defaultSpots, spotsOf } from '../game/spots';
import { bestPull, holdVariant, lipV, wallHeight } from '../solver/model';
import type { Day, Hold, Volume, Wall } from '../solver/types';
import { surfaceAt } from '../solver/volumes';
import { climberFocus, useClimb } from '../state/climb';
import { slotCount, useGame } from '../state/store';
import { Climber } from './Climber';
import { holdGeometry, holdMesh } from './holdGeometry';
import { PALETTE, routeColor } from './palette';
import { BetaOverlay } from './BetaOverlay';
import { ChalkDust } from './Chalk';
import { Gym } from './Gym';
import { ReachGuide } from './ReachGuide';
import { GhostVolume, VolumeMesh } from './Volumes';
import { backingGeometry, deckOutline, frameAt, holdQuaternion, padBox, panelFrames, panelGeometry, uvToWorld, worldToUv, type PanelFrame } from './wallGeometry';
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
      <Gym wall={day.wall} avoid={routeColor(day).hex} />
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

/** Every corner of every facet: a prow's nose and a cave's lip stick out toward the camera. */
function wallCorners(wall: Wall) {
  const frames = panelFrames(wall);
  return frames.flatMap((f) =>
    [
      [f.u0, f.v0],
      [f.u1, f.v0],
      [f.u0, f.v1],
      [f.u1, f.v1],
    ].map(([u, v]) => uvToWorld(wall, frames, u, v)),
  );
}

/** HUD pieces that sit over the wall when the camera is at rest (the ticker only during a climb). */
const HUD_COVER = ['.topbar', '.hud-left', '.tray', '.actionbar', '.viewing', '.ticker'];

/**
 * The part of the canvas the HUD leaves uncovered, in canvas pixels. Each HUD card cuts the
 * free rectangle from whichever side leaves room for the biggest wall: the brief over a phone's
 * wall cuts the top, a desktop tray cuts the right, the action bar cuts the bottom.
 */
function freeRect(canvas: HTMLElement, aspect: number) {
  const c = canvas.getBoundingClientRect();
  // How big a wall (`aspect` times as wide as it is tall) a free rectangle can show.
  const fit = (q: { l: number; t: number; r: number; b: number }) => Math.max(0, Math.min((q.r - q.l) / aspect, q.b - q.t));
  const r = { l: 0, t: 0, r: c.width, b: c.height };
  const whole = fit(r);
  for (const sel of HUD_COVER)
    for (const el of document.querySelectorAll(sel)) {
      const e = el.getBoundingClientRect();
      if (e.width === 0 || e.height === 0) continue;
      const x0 = e.left - c.left;
      const x1 = e.right - c.left;
      const y0 = e.top - c.top;
      const y1 = e.bottom - c.top;
      if (x1 <= r.l || x0 >= r.r || y1 <= r.t || y0 >= r.b) continue;
      // The ticker is a strip over the wall: it only ever cuts the top or bottom off.
      const strip = sel === '.ticker';
      const best = [
        { ...r, t: y1 },
        { ...r, b: y0 },
        ...(strip ? [] : [{ ...r, l: x1 }, { ...r, r: x0 }]),
      ].sort((p, q) => fit(q) - fit(p))[0];
      // A card that would leave only a sliver (a small desktop window) may overlap the wall instead.
      if (fit(best) >= whole * 0.5) Object.assign(r, best);
    }
  // Breathing room for the Finish label and holds standing proud of the wall.
  const pad = Math.min(16, c.width * 0.03);
  r.l += pad;
  r.r -= pad;
  r.t += pad + 8;
  r.b -= pad;
  return { ...r, w: c.width, h: c.height };
}

/**
 * Fit the whole wall into the free part of the screen: step back until its projected outline
 * fits the free rectangle, and slide the view so it sits in the middle of it. Leaves the camera
 * there and returns the orbit target and distance.
 */
function fitWall(cam: THREE.PerspectiveCamera, points: THREE.Vector3[], free: ReturnType<typeof freeRect>, centre: THREE.Vector3, low = false) {
  const nx0 = (free.l / free.w) * 2 - 1;
  const nx1 = (free.r / free.w) * 2 - 1;
  const ny0 = 1 - (free.b / free.h) * 2;
  const ny1 = 1 - (free.t / free.h) * 2;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const tanH = tanV * cam.aspect;
  const t = centre.clone();
  let d = 10;
  const p = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    // Under a roof, crouch and look up at it: front-on, its underside is a sliver.
    cam.position.set(t.x, low ? LOW_EYE : t.y + 0.25, t.z + d);
    cam.lookAt(t);
    cam.updateMatrixWorld();
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const q of points) {
      p.copy(q).project(cam);
      a0 = Math.min(a0, p.x);
      a1 = Math.max(a1, p.x);
      b0 = Math.min(b0, p.y);
      b1 = Math.max(b1, p.y);
    }
    const s = Math.max((a1 - a0) / (nx1 - nx0), (b1 - b0) / (ny1 - ny0));
    const ex = (a0 + a1 - nx0 - nx1) / 2;
    const ey = (b0 + b1 - ny0 - ny1) / 2;
    if (Math.abs(s - 1) < 1e-4 && Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    t.x += ex * tanH * d;
    t.y += ey * tanV * d;
    d = Math.max(2.5, d * s);
  }
  return { target: t, d };
}

/** Eye height (m) of the home view under a roof. */
const LOW_EYE = 0.5;
/** A panel this steep (degrees) is a roof you climb along the underside of. */
const ROOF = 60;

function CameraRig({ wall }: { wall: Wall }) {
  const { camera, size, scene, gl } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const nonce = useGame((s) => s.viewNonce);
  // The wheel rotates the armed/selected hold; otherwise it zooms.
  const holdActive = useGame((s) => !!s.armed || !!s.selectedId);
  // Decided before the press: over a placed hold (or already dragging one), the mouse edits.
  const editingHold = useGame((s) => !!s.hoverHoldId || !!s.draggingId);
  if (import.meta.env.DEV) (window as unknown as { __cam: THREE.Camera }).__cam = camera;
  const [framing, setFraming] = useState(0);
  const low = wall.panels.some((p) => p.angle > ROOF);
  const target = useMemo(() => {
    const b = wallBounds(wall);
    return new THREE.Vector3(0, b.height / 2 + 0.05, b.depth / 2);
  }, [wall]);
  // Where the home framing looks: the wall's middle, slid to the middle of the screen the HUD leaves free.
  const home = useRef(target.clone());

  // Follow the climber up the wall during a playback, until the user takes the camera.
  const playRun = useGame((s) => s.playback?.run ?? 0);
  const userMoved = useRef(false);
  // A framing the camera is easing into (the climb ticker came or went), as orbit target and eye offset.
  const glide = useRef<{ target: THREE.Vector3; offset: THREE.Vector3 } | null>(null);
  // During a climb the ticker covers part of the screen too: reframe around it, then back.
  const climbing = useGame((s) => s.phase === 'climbing');
  const wasClimbing = useRef(climbing);
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
  // How free the camera is to move, eased so it never starts or stops with a jerk: 0 while
  // the climber is mid-move (see climberFocus.hold), 1 otherwise.
  const freedom = useRef(1);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.05);
    // One thing at a time: during a move only the climber moves; the camera catches up in the settle.
    const still = climberFocus.active && climberFocus.hold && !climberFocus.free;
    freedom.current += ((still ? 0 : 1) - freedom.current) * (1 - Math.pow(0.82, dt * 60));
    const free = freedom.current;
    // Landing shake: jolt the view, then let the next frame's jolt replace it.
    camera.position.sub(shakeOffset.current);
    shakeOffset.current.set(0, 0, 0);
    if (climberFocus.shake > 0.001) {
      const k = climberFocus.shake;
      shakeOffset.current.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
      camera.position.add(shakeOffset.current);
      climberFocus.shake *= 0.86;
    }
    if (userMoved.current) {
      glide.current = null;
      return;
    }
    // Ease into a new framing sideways and in depth; the follow below owns the height.
    const g = glide.current;
    if (g && free > 0.01) {
      const k = (1 - Math.pow(0.92, dt * 60)) * free;
      c.target.x += (g.target.x - c.target.x) * k;
      c.target.z += (g.target.z - c.target.z) * k;
      const off = camera.position.clone().sub(c.target);
      off.lerp(g.offset, k);
      camera.position.copy(c.target).add(off);
      camera.lookAt(c.target);
      if (Math.abs(g.target.x - c.target.x) + Math.abs(g.target.z - c.target.z) + off.distanceTo(g.offset) < 1e-3) glide.current = null;
    }
    const b = wallBounds(wall);
    const homeY = home.current.y;
    // Track the climber; once they're off the wall, drift back to the home framing.
    const want = climberFocus.active
      ? Math.max(homeY - 0.4, Math.min(Math.max(homeY, b.height + (climberFocus.top ? 0.4 : -0.9)), climberFocus.pos.y - 0.2))
      : homeY;
    if (Math.abs(want - c.target.y) < 1e-4) return;
    const dy = (want - c.target.y) * (1 - Math.pow(0.97, dt * 60)) * free;
    c.target.y += dy;
    camera.position.y += dy;
  });

  // Front-on framing of the whole wall, clear of the HUD. On load, new wall, "Reset view"
  // and when the screen changes shape (a phone turned on its side); never mid-orbit otherwise.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // Only the ticker coming or going eases the camera over; everything else snaps to the new framing.
    const ease = wasClimbing.current !== climbing;
    wasClimbing.current = climbing;
    const corners = wallCorners(wall);
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const q of corners) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
    }
    const aspect = Math.min(1.6, Math.max(0.6, (x1 - x0) / Math.max(0.1, wallBounds(wall).height)));
    const frame = () => {
      cam.aspect = size.width / size.height;
      cam.updateProjectionMatrix();
      const was = ease ? { pos: cam.position.clone(), quat: cam.quaternion.clone() } : null;
      const { target: t, d } = fitWall(cam, corners, freeRect(gl.domElement, aspect), target, low);
      home.current.copy(t);
      setFraming(d);
      // Wide walls on a portrait phone sit far back: start the haze behind the wall, not on it.
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = Math.max(16, d + 3);
        scene.fog.far = scene.fog.near + 18;
      }
      if (was) {
        // Leave the camera where it was; the frame loop eases it over (unless the user has it).
        if (!userMoved.current) glide.current = { target: t.clone(), offset: cam.position.clone().sub(t) };
        cam.position.copy(was.pos);
        cam.quaternion.copy(was.quat);
        cam.updateMatrixWorld();
        return;
      }
      controls.current?.target.copy(t);
      controls.current?.update();
    };
    frame();
    // The HUD settles a frame later (fonts, the tray wrapping): measure it again then.
    const raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [camera, scene, gl, wall, target, low, nonce, size.width, size.height, climbing]);

  return (
    <OrbitControls
      ref={controls}
      target={target}
      enableDamping
      dampingFactor={0.12}
      enableZoom={!holdActive}
      maxPolarAngle={Math.PI * (low ? 0.62 : 0.55)}
      // Stay in front of the wall: there's nothing to see behind it.
      minAzimuthAngle={-1.25}
      maxAzimuthAngle={1.25}
      minDistance={2.5}
      // Always room to zoom back out past the home framing.
      maxDistance={Math.max(18, framing * 1.3)}
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
      {/* Reaches well behind the furthest camera (portrait framing of a wide wall sits ~18 m back,
          zoomed out ~24 m): with its edge near the camera the plane drew over the pad. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 12]} receiveShadow>
        <planeGeometry args={[60, 50]} />
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
      <Deck wall={day.wall} frames={frames} />
      {day.wall.lip && <Lip wall={day.wall} frames={frames} />}
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
      <SpotLabels day={day} frames={frames} />
      {holds.map((h) => (
        <HoldMesh key={h.id} hold={h} wall={day.wall} frames={frames} fixed={!!viewing} tint={tint} />
      ))}
      <GhostHold wall={day.wall} frames={frames} />
      <FootHint wall={day.wall} frames={frames} />
      <ReachGuide day={day} frames={frames} />
    </group>
  );
}

function PanelMesh({ wall, frame }: { wall: Wall; frame: PanelFrame }) {
  const geometry = useMemo(() => panelGeometry(wall, frame, wall.seed), [wall, frame]);
  const handlers = useWallPointer((e: ThreeEvent<PointerEvent>) => worldToUv(wall, frame, e.point));
  const backing = useMemo(() => backingGeometry(frame, wall.fold ? 0.02 : 0.08), [wall, frame]);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow {...handlers}>
        <meshStandardMaterial vertexColors flatShading roughness={0.9} />
      </mesh>
      {/* Panel thickness + side rails so the wall reads as a solid object. */}
      <mesh geometry={backing} castShadow receiveShadow>
        <meshStandardMaterial color={PALETTE.plyDark} roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

/** A rollover's (or overlap's, or ledge's) rounded lip: a faceted plywood roll along the break it rolls over at. */
function Lip({ wall, frames }: { wall: Wall; frames: PanelFrame[] }) {
  const { position, quaternion } = useMemo(() => {
    const v = lipV(wall);
    const a = uvToWorld(wall, frames, 0, v);
    const b = uvToWorld(wall, frames, wall.width, v);
    // Tuck it into the corner between the overhang below and the slab above.
    const n = frameAt(frames, wall.width / 2, v - 1).normal.clone().add(frameAt(frames, wall.width / 2, v + 1).normal).normalize();
    const position = a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, -0.012);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return { position, quaternion };
  }, [wall, frames]);
  return (
    <mesh position={position} quaternion={quaternion} castShadow receiveShadow raycast={() => null}>
      <cylinderGeometry args={[0.04, 0.04, wall.width / 100, 8]} />
      <meshStandardMaterial color={PALETTE.ply} roughness={0.9} flatShading />
    </mesh>
  );
}

/** The flat top of the wall the climber mantles onto and stands on to celebrate. */
function Deck({ wall, frames }: { wall: Wall; frames: PanelFrame[] }) {
  const { geometry, y } = useMemo(() => {
    const { y, pts } = deckOutline(wall, frames);
    // Shape space (x, -z), turned flat below; extruded upward by the board's thickness.
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
    return { geometry: new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }), y };
  }, [wall, frames]);
  return (
    <mesh geometry={geometry} position={[0, y - 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow raycast={() => null}>
      <meshStandardMaterial color={PALETTE.plyDark} roughness={0.95} flatShading />
    </mesh>
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
  const { geometry, bolt, boltTilt = 0, screw } = holdMesh(hold.type, hold.size, holdVariant(hold));
  const volumes = useGame((s) => (s.viewing ? s.viewingVolumes : s.volumes));
  const t = placeOnWall(wall, frames, hold.u, hold.v, hold.rot, volumes);
  const onVolume = !!surfaceAt(volumes, hold.u, hold.v);
  // Used holds get chalky.
  const chalk = useClimb((s) => s.chalk[hold.id] ?? 0);
  // A faint dusting all over, and real build-up on the faces hands and shoes use.
  const color = useMemo(
    () => new THREE.Color(tint).lerp(new THREE.Color('#f4f2ec'), Math.min(0.12, chalk * 0.03)),
    [tint, chalk],
  );
  const chalkUniform = useMemo(() => ({ value: 0 }), []);
  chalkUniform.value = chalk > 0 ? Math.min(0.85, 0.3 + chalk * 0.12) : 0;
  // Shoe rubber: footholds come pre-scuffed from the gym's regulars, and every
  // foot the climber puts on a hold leaves a little more.
  const rubber = useClimb((s) => s.rubber[hold.id] ?? 0);
  const worn = hold.type === 'foot' || hold.type === 'jib' ? 0.55 : 0;
  const rubberUniform = useMemo(() => ({ value: 0 }), []);
  rubberUniform.value = Math.min(1, worn + rubber * 0.12);
  const addChalk = useMemo(() => chalkShader(chalkUniform, rubberUniform), [chalkUniform, rubberUniform]);

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
        <group position={bolt} rotation={[Math.PI / 2 - boltTilt, 0, 0]}>
          <mesh raycast={() => null}>
            <cylinderGeometry args={[0.0115, 0.009, 0.002, 10]} />
            <meshStandardMaterial color="#2c2b2a" roughness={0.95} flatShading />
          </mesh>
          {onVolume && (
            // Bolted into a volume's T-nut: a bright washer under the head, as setters fit them
            // so the bolt doesn't bite into the hold.
            <mesh position={[0, 0.0005, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.0108, 0.0108, 0.0008, 14]} />
              <meshStandardMaterial color="#a9acb0" metalness={0.75} roughness={0.3} flatShading />
            </mesh>
          )}
          <mesh position={[0, onVolume ? 0.0018 : 0.0012, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.0068, 0.0072, 0.0016, 12]} />
            <meshStandardMaterial color="#6a6c70" metalness={0.65} roughness={0.38} flatShading />
          </mesh>
          <mesh position={[0, onVolume ? 0.0027 : 0.0021, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.0032, 0.0032, 0.0004, 6]} />
            <meshBasicMaterial color="#161616" />
          </mesh>
        </group>
      )}
      {screw && (
        // A wood screw sunk in the chip's countersink: a domed head with a cross slot.
        <group position={screw.at} rotation={[Math.PI / 2, 0, 0]} scale={screw.size}>
          <mesh raycast={() => null}>
            <cylinderGeometry args={[0.0026, 0.0034, 0.0014, 10]} />
            <meshStandardMaterial color="#8a8c90" metalness={0.6} roughness={0.4} flatShading />
          </mesh>
          <mesh position={[0, 0.00072, 0]} raycast={() => null}>
            <boxGeometry args={[0.0036, 0.0002, 0.0007]} />
            <meshBasicMaterial color="#1c1c1c" />
          </mesh>
          <mesh position={[0, 0.00072, 0]} raycast={() => null}>
            <boxGeometry args={[0.0007, 0.0002, 0.0036]} />
            <meshBasicMaterial color="#1c1c1c" />
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
 * scaled by how much the hold has been used. Shoe rubber goes on first, on the
 * same faces: dark scuffs, streaked down the hold the way a toe drags as it
 * weights, patchy rather than painted on. The grit is a few-millimetre speckle
 * in the hold's own frame, so it sticks to the hold, and it fades out once its
 * grains get smaller than a pixel instead of shimmering at a distance.
 */
function chalkShader(amount: { value: number }, rubber: { value: number }) {
  return (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => {
    shader.uniforms.uChalk = amount;
    shader.uniforms.uRubber = rubber;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float grip;\nattribute float tex;\nvarying float vGrip;\nvarying float vTex;\nvarying vec3 vHoldPos;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrip = grip;\nvTex = tex;\nvHoldPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uChalk;
uniform float uRubber;
varying float vGrip;
varying float vTex;
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
  // A macro's smooth faces (vTex 0) are cast glossy: no grit, a faint mottle, a touch lighter.
  diffuseColor.rgb *= 1.0 + (0.24 * grain + 0.16 * mottle) * (0.25 + 0.75 * vTex) + 0.06 * (1.0 - vTex);
}
if (uRubber > 0.0) {
  // Scuffs ~1 cm across, stretched up and down the hold, with a faint wider smudge between them.
  float scuff = smoothstep(0.42, 0.68, gritNoise(vHoldPos * vec3(110.0, 38.0, 70.0)));
  float smudge = 0.35 * gritNoise(vHoldPos * 30.0 + 7.0);
  float r = clamp(vGrip * uRubber * (scuff + smudge) * 2.2, 0.0, 0.7);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.105, 0.1), r);
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.89), clamp(vGrip * uChalk, 0.0, 0.85));`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.42, roughnessFactor, vTex);');
  };
}

/** Outline ring plus an arrow showing the direction the hold wants to be pulled. */
function Selection({ hold }: { hold: Hold }) {
  const geometry = holdGeometry(hold.type, hold.size, holdVariant(hold));
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
  // The ghost is the very hold the tray hands over next, so its shape (and incut) shows before it goes on.
  const seed = useGame((s) =>
    s.armed && s.day ? nextTraySeed(s.day.number, s.placed, s.armed.type, s.armed.size, slotCount(s.day, s.armed)) : 0,
  );
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
      <mesh geometry={holdGeometry(armed!.type, armed!.size, seed)} raycast={() => null}>
        <meshStandardMaterial color={color} transparent opacity={0.6} flatShading depthWrite={false} />
      </mesh>
      <PullArrow dir={bestPull(0)} color={color} />
    </group>
  );
}

/**
 * After a test with nowhere to stand: a pulsing ring on the wall where a foot chip would
 * give the climber a start. Each ring goes once a hold covers it.
 */
function FootHint({ wall, frames }: { wall: Wall; frames: PanelFrame[] }) {
  const hint = useGame((s) => s.footHint);
  const placed = useGame((s) => s.placed);
  const show = useGame((s) => s.phase === 'setting' && !s.viewing && !s.done);
  const open = hint.filter((p) => !placed.some((h) => Math.hypot(h.u - p.u, h.v - p.v) < 12));
  if (!show || !open.length) return null;
  return (
    <>
      {open.map((p) => (
        <FootRing key={`${p.u},${p.v}`} wall={wall} frames={frames} u={p.u} v={p.v} />
      ))}
    </>
  );
}

function FootRing({ wall, frames, u, v }: { wall: Wall; frames: PanelFrame[]; u: number; v: number }) {
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }) => ring.current?.scale.setScalar(1 + 0.15 * Math.sin(clock.elapsedTime * 4)));
  const f = frameAt(frames, u, v);
  return (
    <group position={uvToWorld(wall, frames, u, v).addScaledVector(f.normal, 0.007)} quaternion={holdQuaternion(f, 0)}>
      <group ref={ring}>
        <mesh raycast={() => null}>
          <circleGeometry args={[0.05, 32]} />
          <meshBasicMaterial color={PALETTE.ghostOk} transparent opacity={0.55} depthWrite={false} />
        </mesh>
        <mesh raycast={() => null}>
          <ringGeometry args={[0.05, 0.068, 32]} />
          <meshBasicMaterial color="#2a2926" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      </group>
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

/**
 * "Start" and "Finish" flags on the tape while setting: the spots never move, so say
 * so on the wall itself rather than only in the help.
 */
function SpotLabels({ day, frames }: { day: Day; frames: PanelFrame[] }) {
  // Mounted with the canvas, drei's Html re-targets once the canvas's events connect and
  // comes back empty. Pin it to the canvas's own container from the start instead.
  const gl = useThree((s) => s.gl);
  const portal = useMemo(() => ({ current: (gl.domElement.parentElement?.parentElement ?? document.body) as HTMLElement }), [gl]);
  const startU = day.start.reduce((a, h) => a + h.u, 0) / day.start.length;
  const startV = Math.min(...day.start.map((h) => h.v));
  return (
    <>
      <SpotLabel day={day} frames={frames} u={startU} v={startV - 22} text="Start" portal={portal} />
      <SpotLabel day={day} frames={frames} u={day.finish.u} v={day.finish.v + 24} text="Finish" portal={portal} />
    </>
  );
}

function SpotLabel({
  day,
  frames,
  u,
  v,
  text,
  portal,
}: {
  day: Day;
  frames: PanelFrame[];
  u: number;
  v: number;
  text: string;
  portal: { current: HTMLElement };
}) {
  // Faded out rather than unmounted while climbing, so it doesn't flicker in and out.
  const show = useGame((s) => s.phase === 'setting' && !s.viewing);
  const position = useMemo(() => {
    const f = frameAt(frames, u, v);
    return uvToWorld(day.wall, frames, u, v).addScaledVector(f.normal, 0.02);
  }, [day.wall, frames, u, v]);
  return (
    <Html position={position} center portal={portal} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`spot-label ${show ? '' : 'hidden'}`} data-tour={text.toLowerCase()}>
        {text}
      </div>
    </Html>
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
