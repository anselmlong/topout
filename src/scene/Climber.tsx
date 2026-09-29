// A faceless low-poly climber. Poses come from the solver's stances; limbs are
// solved with two-bone IK and the body is interpolated between stances.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Day, Point, SolveResult, Stance, Wall } from '../solver/types';
import { OFF } from '../solver/types';
import { useGame } from '../state/store';
import { PALETTE } from './palette';
import { frameAt, panelFrames, uvToWorld, type PanelFrame } from './wallGeometry';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const ARM = [0.3, 0.29];
const LEG = [0.43, 0.42];
const TORSO = 0.5;
const PAD_TOP = 0.3;

interface Pose {
  hip: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  shoulders: [THREE.Vector3, THREE.Vector3];
  elbows: [THREE.Vector3, THREE.Vector3];
  hands: [THREE.Vector3, THREE.Vector3];
  pelvis: [THREE.Vector3, THREE.Vector3];
  knees: [THREE.Vector3, THREE.Vector3];
  feet: [THREE.Vector3, THREE.Vector3];
}

function ik(root: THREE.Vector3, target: THREE.Vector3, [a, b]: number[], pole: THREE.Vector3) {
  const dir = target.clone().sub(root);
  const d = Math.min(dir.length(), a + b - 1e-4);
  dir.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  perp.normalize();
  const joint = root.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * Math.sqrt(1 - cosA * cosA));
  const end = root.clone().addScaledVector(dir, d);
  return { joint, end };
}

/** Build a full-body pose from 3D contact points (feet may be null = dangling). */
function poseFrom(
  frames: PanelFrame[],
  hands: [THREE.Vector3, THREE.Vector3],
  feet: [THREE.Vector3 | null, THREE.Vector3 | null],
  hipV: number,
): Pose {
  const normal = frameAt(frames, hipV).normal;
  const handsMid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
  const on = feet.filter(Boolean) as THREE.Vector3[];
  const feetMid = on.length
    ? on.reduce((s, f) => s.add(f), V()).multiplyScalar(1 / on.length)
    : handsMid.clone().add(V(0, -1.35, 0));
  const hip = feetMid.clone().lerp(handsMid, 0.4).addScaledVector(normal, 0.24);
  const up = handsMid.clone().sub(hip);
  const torsoDir = up.lengthSq() > 1e-6 ? up.normalize() : V(0, 1, 0);
  const chest = hip.clone().addScaledVector(torsoDir, TORSO);
  const lateral = V().crossVectors(torsoDir, normal).normalize().multiplyScalar(-1);
  if (lateral.lengthSq() < 0.5) lateral.set(1, 0, 0);
  const head = chest.clone().addScaledVector(torsoDir, 0.2).addScaledVector(normal, 0.05);
  const shoulders: [THREE.Vector3, THREE.Vector3] = [
    chest.clone().addScaledVector(lateral, -0.19),
    chest.clone().addScaledVector(lateral, 0.19),
  ];
  const pelvis: [THREE.Vector3, THREE.Vector3] = [
    hip.clone().addScaledVector(lateral, -0.1),
    hip.clone().addScaledVector(lateral, 0.1),
  ];
  const arm = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    const pole = torsoDir.clone().multiplyScalar(-0.6).addScaledVector(normal, 0.5).addScaledVector(lateral, side * 0.6);
    return ik(shoulders[i], hands[i], ARM, pole);
  };
  const leg = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    const target = feet[i] ?? pelvis[i].clone().add(V(side * 0.12, -0.75, 0.12));
    const pole = normal.clone().addScaledVector(lateral, side * 0.7);
    return ik(pelvis[i], target, LEG, pole);
  };
  const [aL, aR, lL, lR] = [arm(0), arm(1), leg(0), leg(1)];
  return {
    hip,
    chest,
    head,
    shoulders,
    elbows: [aL.joint, aR.joint],
    hands: [aL.end, aR.end],
    pelvis,
    knees: [lL.joint, lR.joint],
    feet: [lL.end, lR.end],
  };
}

function standingPose(wall: Wall): Pose {
  const x = -wall.width / 200 - 0.55;
  const z = 1.0;
  const g = PAD_TOP;
  const hip = V(x, g + 0.86, z);
  const chest = V(x, g + 1.36, z);
  return {
    hip,
    chest,
    head: V(x, g + 1.57, z),
    shoulders: [V(x - 0.19, g + 1.36, z), V(x + 0.19, g + 1.36, z)],
    elbows: [V(x - 0.23, g + 1.07, z + 0.02), V(x + 0.23, g + 1.07, z + 0.02)],
    hands: [V(x - 0.22, g + 0.79, z + 0.06), V(x + 0.22, g + 0.79, z + 0.06)],
    pelvis: [V(x - 0.1, g + 0.86, z), V(x + 0.1, g + 0.86, z)],
    knees: [V(x - 0.12, g + 0.44, z + 0.03), V(x + 0.12, g + 0.44, z + 0.03)],
    feet: [V(x - 0.13, g + 0.02, z), V(x + 0.13, g + 0.02, z)],
  };
}

type Contacts = { hands: [Point, Point]; feet: [Point | null, Point | null] };

const contactsOf = (s: Stance): Contacts => ({
  hands: [s.points[0], s.points[1]],
  feet: [s.limbs[2] === OFF ? null : s.points[2], s.limbs[3] === OFF ? null : s.points[3]],
});

interface Keyframe {
  from: Contacts;
  to: Contacts;
  limb: number;
  duration: number;
  dynamic?: boolean;
}

interface Timeline {
  frames: Keyframe[];
  ending: 'top' | 'fall' | 'shrug';
  total: number;
}

function buildTimeline(result: SolveResult, day: Day): Timeline {
  const frames: Keyframe[] = [];
  if (result.ok) {
    const s0 = contactsOf(result.start);
    frames.push({ from: s0, to: s0, limb: -1, duration: 0.7 });
    for (const m of result.moves) {
      frames.push({ from: contactsOf(m.from), to: contactsOf(m.to), limb: m.limb, duration: m.dynamic ? 0.45 : m.limb >= 2 ? 0.4 : 0.6, dynamic: m.dynamic });
    }
    const last = frames[frames.length - 1].to;
    frames.push({ from: last, to: last, limb: -1, duration: 1.1 });
    return { frames, ending: 'top', total: frames.reduce((s, f) => s + f.duration, 0) };
  }
  if (!result.highPoint) return { frames: [], ending: 'shrug', total: 1.6 };
  const hp = contactsOf(result.highPoint);
  frames.push({ from: hp, to: hp, limb: -1, duration: 0.8 });
  // Reach hopefully toward the finish before peeling off.
  const lunge: Contacts = {
    hands: [
      hp.hands[0],
      {
        u: hp.hands[1].u + (day.finish.u - hp.hands[1].u) * 0.25,
        v: hp.hands[1].v + Math.min(45, (day.finish.v - hp.hands[1].v) * 0.4),
      },
    ],
    feet: hp.feet,
  };
  frames.push({ from: hp, to: lunge, limb: 1, duration: 0.7 });
  return { frames, ending: 'fall', total: frames.reduce((s, f) => s + f.duration, 0) + 1.6 };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function Climber({ day }: { day: Day }) {
  const playback = useGame((s) => s.playback);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const timeline = useMemo(() => (playback ? buildTimeline(playback.result, day) : null), [playback, day]);
  const clock = useRef({ t: 0, run: -1, finished: false });
  const rig = useRef<RigHandle>(null);

  const toWorld = (p: Point, out: number) => {
    const f = frameAt(frames, p.v);
    return uvToWorld(day.wall, frames, p.u, p.v).addScaledVector(f.normal, out);
  };

  const poseAt = (c: Contacts, limb: number, lift: number): Pose => {
    const hands = c.hands.map((p, i) => {
      const w = toWorld(p, 0.07);
      if (i === limb && lift) w.addScaledVector(frameAt(frames, p.v).normal, lift);
      return w;
    }) as [THREE.Vector3, THREE.Vector3];
    const feet = c.feet.map((p, i) => {
      if (!p) return null;
      const w = toWorld(p, 0.06);
      if (i + 2 === limb && lift) w.addScaledVector(frameAt(frames, p.v).normal, lift);
      return w;
    }) as [THREE.Vector3 | null, THREE.Vector3 | null];
    const hipV = (c.hands[0].v + c.hands[1].v) / 2 - 80;
    return poseFrom(frames, hands, feet, Math.max(0, hipV));
  };

  const lerpContacts = (a: Contacts, b: Contacts, t: number): Contacts => {
    const l = (p: Point, q: Point) => ({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
    return {
      hands: [l(a.hands[0], b.hands[0]), l(a.hands[1], b.hands[1])],
      feet: [
        a.feet[0] && b.feet[0] ? l(a.feet[0], b.feet[0]) : t < 0.5 ? a.feet[0] : b.feet[0],
        a.feet[1] && b.feet[1] ? l(a.feet[1], b.feet[1]) : t < 0.5 ? a.feet[1] : b.feet[1],
      ],
    };
  };

  useFrame((_, dt) => {
    if (!rig.current) return;
    const c = clock.current;
    if (!playback || !timeline) {
      rig.current.apply(standingPose(day.wall));
      return;
    }
    if (c.run !== playback.run) {
      c.run = playback.run;
      c.t = 0;
      c.finished = false;
    }
    c.t += Math.min(dt, 0.05);
    let t = c.t;
    let pose: Pose | null = null;
    for (const f of timeline.frames) {
      if (t <= f.duration) {
        const k = ease(t / f.duration);
        const lift = f.limb >= 0 ? Math.sin(Math.PI * k) * (f.dynamic ? 0.18 : 0.08) : 0;
        pose = poseAt(lerpContacts(f.from, f.to, k), f.limb, lift);
        break;
      }
      t -= f.duration;
    }
    if (!pose) {
      if (timeline.ending === 'top') {
        const last = timeline.frames[timeline.frames.length - 1];
        pose = poseAt(last.to, -1, 0);
      } else if (timeline.ending === 'fall') {
        const last = timeline.frames[timeline.frames.length - 1];
        pose = fall(poseAt(last.to, -1, 0), t);
      } else {
        pose = standingPose(day.wall);
        const shrug = Math.sin(Math.min(t, 1) * Math.PI) * 0.06;
        pose.shoulders.forEach((s) => (s.y += shrug));
        pose.hands.forEach((h) => (h.x += h.x > pose!.hip.x ? 0.1 * shrug * 10 : -0.1 * shrug * 10));
      }
    }
    rig.current.apply(pose);
    if (!c.finished && c.t >= timeline.total) {
      c.finished = true;
      useGame.getState().climbFinished();
    }
  });

  return <Rig ref={rig} />;
}

/** Peel off the wall: rotate backward around the hips and drop onto the pad. */
function fall(p: Pose, t: number): Pose {
  const g = 9.8;
  const drop = 0.5 * g * t * t;
  const back = Math.min(1, t * 1.6);
  const angle = back * (Math.PI / 2.2);
  const pivot = p.hip.clone();
  const all = [p.hip, p.chest, p.head, ...p.shoulders, ...p.elbows, ...p.hands, ...p.pelvis, ...p.knees, ...p.feet];
  const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), angle);
  const floorHip = PAD_TOP + 0.14;
  const dy = Math.min(drop, pivot.y - floorHip);
  for (const v of all) {
    v.sub(pivot).applyQuaternion(q).add(pivot);
    v.y -= dy;
    v.z += back * 0.5;
    v.y = Math.max(PAD_TOP + 0.05, v.y);
  }
  return p;
}

// ---------------------------------------------------------------- rig meshes

interface RigHandle {
  apply: (p: Pose) => void;
}


const Y = V(0, 1, 0);

const Rig = forwardRef<RigHandle>(function Rig(_, ref) {
  const segs = useRef<THREE.Mesh[]>([]);
  const joints = useRef<THREE.Mesh[]>([]);
  const torso = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);

  const setSeg = (m: THREE.Mesh | undefined, a: THREE.Vector3, b: THREE.Vector3) => {
    if (!m) return;
    const d = b.clone().sub(a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
    m.scale.set(1, Math.max(0.001, len), 1);
  };

  useImperativeHandle(ref, () => ({
    apply(p) {
      const pairs: [THREE.Vector3, THREE.Vector3][] = [
        [p.shoulders[0], p.elbows[0]],
        [p.elbows[0], p.hands[0]],
        [p.shoulders[1], p.elbows[1]],
        [p.elbows[1], p.hands[1]],
        [p.pelvis[0], p.knees[0]],
        [p.knees[0], p.feet[0]],
        [p.pelvis[1], p.knees[1]],
        [p.knees[1], p.feet[1]],
      ];
      pairs.forEach(([a, b], i) => setSeg(segs.current[i], a, b));
      const js = [...p.elbows, ...p.hands, ...p.knees, ...p.feet, ...p.shoulders];
      js.forEach((j, i) => joints.current[i]?.position.copy(j));
      if (torso.current) setSeg(torso.current, p.hip, p.chest);
      head.current?.position.copy(p.head);
      if (head.current) head.current.quaternion.copy(torso.current!.quaternion);
    },
  }));

  const segGeo = useMemo(() => new THREE.CylinderGeometry(0.045, 0.04, 1, 6), []);
  const legGeo = useMemo(() => new THREE.CylinderGeometry(0.06, 0.05, 1, 6), []);
  const torsoGeo = useMemo(() => new THREE.CylinderGeometry(0.17, 0.13, 1, 7), []);
  const jointGeo = useMemo(() => new THREE.IcosahedronGeometry(0.05, 0), []);
  const headGeo = useMemo(() => new THREE.IcosahedronGeometry(0.115, 1), []);
  const skin = <meshStandardMaterial color={PALETTE.climber} flatShading roughness={0.8} />;
  const dark = <meshStandardMaterial color={PALETTE.climberDark} flatShading roughness={0.9} />;

  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} ref={(m) => void (segs.current[i] = m!)} geometry={i < 4 ? segGeo : legGeo} castShadow raycast={() => null}>
          {i < 4 ? skin : dark}
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} ref={(m) => void (joints.current[i] = m!)} geometry={jointGeo} castShadow raycast={() => null}>
          {skin}
        </mesh>
      ))}
      <mesh ref={torso} geometry={torsoGeo} castShadow raycast={() => null}>
        {skin}
      </mesh>
      <mesh ref={head} geometry={headGeo} castShadow raycast={() => null}>
        {skin}
      </mesh>
    </group>
  );
});
