// A faceless low-poly climber. The solver's beta drives where hands and feet go;
// the body in between is a Verlet ragdoll (see ragdoll.ts), pulled toward an
// IK-posed skeleton by soft "muscles", so it hangs, sways, swings and falls.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import type { Day, Hold, Point, SolveResult, Stance, Wall } from '../solver/types';
import { OFF } from '../solver/types';
import { chalkHold, climberFocus, useClimb } from '../state/climb';
import { useGame, type Playback } from '../state/store';
import { puff } from './Chalk';
import { PALETTE } from './palette';
import { J, JOINTS, Ragdoll } from './ragdoll';
import { frameAt, padBox, panelFrames, uvToWorld, worldV, type PanelFrame } from './wallGeometry';

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
  const span = handsMid.clone().sub(feetMid);
  const handsToFeet = span.length();
  const bodyDir = handsToFeet > 1e-3 ? span.normalize() : V(0, 1, 0);
  // Hang long-armed: chest sits most of an arm's length below the hands.
  const chest = handsMid.clone().addScaledVector(bodyDir, -0.42).addScaledVector(normal, 0.14);
  // Bunched up (feet close to hands): sit the hips back off the wall instead of squashing.
  const lean = Math.max(0, Math.min(1, (1.3 - handsToFeet) / 0.6));
  const torsoDir = bodyDir.clone().addScaledVector(normal, -0.9 * lean).normalize();
  const hip = chest.clone().addScaledVector(torsoDir, -TORSO);
  // Climber's right. We see their back, so this is +x on screen.
  const lateral = V().crossVectors(torsoDir, normal).normalize();
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
  to: Contacts;
  /** Hold index each limb lands on (for chalk), -1/-2 for smear/off. */
  holds: number[];
  limb: number;
  duration: number;
  dynamic?: boolean;
  /** Difficulty relative to the route's crux, 0..1. */
  strain: number;
  move: number;
}

interface Timeline {
  frames: Keyframe[];
  ending: 'top' | 'fall' | 'shrug';
  total: number;
  /** Extra time after the last frame for the ending to play out. */
  tail: number;
}

function buildTimeline(result: SolveResult, day: Day): Timeline {
  const frames: Keyframe[] = [];
  if (result.ok) {
    const crux = Math.max(result.crux, 0.3);
    frames.push({ to: contactsOf(result.start), holds: [...result.start.limbs], limb: -1, duration: 0.9, strain: 0, move: -1 });
    result.moves.forEach((m, i) => {
      const strain = Math.min(1, m.difficulty / crux);
      // Hard moves are slower and more deliberate; dynos are quick.
      const base = m.limb >= 2 ? 0.42 : 0.55 + strain * 0.35;
      frames.push({
        to: contactsOf(m.to),
        holds: [...m.to.limbs],
        limb: m.limb,
        duration: m.dynamic ? 0.5 : base,
        dynamic: m.dynamic,
        strain,
        move: i,
      });
    });
    const tail = 2.2;
    return { frames, ending: 'top', total: frames.reduce((s, f) => s + f.duration, 0) + tail, tail };
  }
  if (!result.highPoint) return { frames: [], ending: 'shrug', total: 1.6, tail: 1.6 };
  const hp = contactsOf(result.highPoint);
  frames.push({ to: hp, holds: [...result.highPoint.limbs], limb: -1, duration: 1.0, strain: 0.6, move: -1 });
  // Reach hopefully toward the finish... and peel off.
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
  frames.push({ to: lunge, holds: [], limb: 1, duration: 0.8, strain: 1, move: -1 });
  const tail = 2.8;
  return { frames, ending: 'fall', total: frames.reduce((s, f) => s + f.duration, 0) + tail, tail };
}

const STEP = 1 / 120;
const LIMB_NAME = ['Left hand', 'Right hand', 'Left foot', 'Right foot'];

function poseToArray(p: Pose): THREE.Vector3[] {
  const a: THREE.Vector3[] = new Array(JOINTS);
  a[J.head] = p.head;
  a[J.chest] = p.chest;
  a[J.pelvis] = p.hip;
  a[J.shoulderL] = p.shoulders[0];
  a[J.shoulderR] = p.shoulders[1];
  a[J.elbowL] = p.elbows[0];
  a[J.elbowR] = p.elbows[1];
  a[J.handL] = p.hands[0];
  a[J.handR] = p.hands[1];
  a[J.hipL] = p.pelvis[0];
  a[J.hipR] = p.pelvis[1];
  a[J.kneeL] = p.knees[0];
  a[J.kneeR] = p.knees[1];
  a[J.footL] = p.feet[0];
  a[J.footR] = p.feet[1];
  return a;
}

function arrayToPose(a: THREE.Vector3[]): Pose {
  return {
    head: a[J.head],
    chest: a[J.chest],
    hip: a[J.pelvis],
    shoulders: [a[J.shoulderL], a[J.shoulderR]],
    elbows: [a[J.elbowL], a[J.elbowR]],
    hands: [a[J.handL], a[J.handR]],
    pelvis: [a[J.hipL], a[J.hipR]],
    knees: [a[J.kneeL], a[J.kneeR]],
    feet: [a[J.footL], a[J.footR]],
  };
}

interface Run {
  sim: Ragdoll;
  timeline: Timeline;
  holds: Hold[];
  t: number;
  acc: number;
  frame: number;
  ended: boolean;
  finished: boolean;
  limp: boolean;
  /** Pending arrival events (grab sound + chalk) keyed by sim time. */
  arrivals: { at: number; limb: number; hold: number; strain: number }[];
  lastThud: number;
}

export function Climber({ day }: { day: Day }) {
  const playback = useGame((s) => s.playback);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const run = useRef<(Run & { id: number }) | null>(null);
  const shrug = useRef(0);
  const rig = useRef<RigHandle>(null);

  const toWorld = (p: Point, out: number) => {
    const f = frameAt(frames, p.v);
    return uvToWorld(day.wall, frames, p.u, p.v).addScaledVector(f.normal, out);
  };
  const normalAt = (p: Point) => frameAt(frames, p.v).normal;

  /** Posed skeleton for the ends' current positions (the "muscle" targets). */
  const postureFor = (sim: Ragdoll): THREE.Vector3[] => {
    const e = sim.ends;
    const hands: [THREE.Vector3, THREE.Vector3] = [sim.pos[J.handL].clone(), sim.pos[J.handR].clone()];
    const feet: [THREE.Vector3 | null, THREE.Vector3 | null] = [
      e[2].mode === 'free' ? null : sim.pos[J.footL].clone(),
      e[3].mode === 'free' ? null : sim.pos[J.footR].clone(),
    ];
    const mid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
    return poseToArray(poseFrom(frames, hands, feet, Math.max(0, worldV(frames, mid) - 80)));
  };

  const start = (pb: Playback): Run | null => {
    const timeline = buildTimeline(pb.result, day);
    if (!timeline.frames.length) return null;
    const first = timeline.frames[0].to;
    const hands = first.hands.map((p) => toWorld(p, 0.07)) as [THREE.Vector3, THREE.Vector3];
    const feet = first.feet.map((p) => (p ? toWorld(p, 0.06) : null)) as [THREE.Vector3 | null, THREE.Vector3 | null];
    const init = poseToArray(poseFrom(frames, hands, feet, Math.max(0, (first.hands[0].v + first.hands[1].v) / 2 - 80)));
    const pad = padBox(day.wall);
    const sim = new Ragdoll(init, frames, day.wall.width / 200, {
      padTop: pad.top,
      padMinX: -pad.width / 2,
      padMaxX: pad.width / 2,
      padMinZ: pad.minZ,
      padMaxZ: pad.maxZ,
    });
    first.feet.forEach((p, i) => !p && (sim.ends[2 + i].mode = 'free'));
    useClimb.setState({ move: -1, total: pb.result.ok ? pb.result.moves.length : 0, strain: 0, label: 'Chalking up…', status: 'climbing' });
    return { sim, timeline, holds: [...day.start, day.finish, ...pb.holds], t: 0, acc: 0, frame: -1, ended: false, finished: false, limp: false, arrivals: [], lastThud: 0 };
  };

  const enterFrame = (r: Run, f: Keyframe) => {
    const { sim } = r;
    const contacts: (Point | null)[] = [...f.to.hands, ...f.to.feet];
    contacts.forEach((c, n) => {
      const target = c ? toWorld(c, n < 2 ? 0.07 : 0.06) : null;
      const normal = c ? normalAt(c) : new THREE.Vector3(0, 0, 1);
      if (n === f.limb) sim.drive(n, target, normal, f.duration * 0.85, f.dynamic ? 0.14 : 0.07);
      else sim.drive(n, target, normal, 0.3, 0.05);
    });
    sim.tone = 1 - 0.45 * f.strain;
    sim.tremble = Math.max(0, f.strain - 0.55) * 2.2;
    if (f.limb >= 0 && f.holds.length) r.arrivals.push({ at: r.t + f.duration * 0.85, limb: f.limb, hold: f.holds[f.limb], strain: f.strain });
    if (f.dynamic) {
      // Launch: throw the hips at the target, and let the feet cut loose on steep ground.
      const target = toWorld(f.to.hands[f.limb as 0 | 1], 0.07);
      const push = target.sub(sim.pos[J.pelvis]).normalize().multiplyScalar(2.2);
      sim.impulse(push, STEP, [J.pelvis, J.chest, J.head, J.shoulderL, J.shoulderR, J.hipL, J.hipR]);
      const steep = frameAt(frames, f.to.hands[0].v).normal.y < -0.2;
      if (steep) [2, 3].forEach((n) => (sim.ends[n].mode = 'free'));
      sfx.whoosh();
    }
    if (f.move >= 0) {
      const m = f.limb;
      const hold = f.holds[m];
      const what = hold >= 0 ? r.holds[hold]?.type : hold === -1 ? 'smear' : 'off';
      useClimb.setState({
        move: f.move,
        strain: f.strain,
        label: `${LIMB_NAME[m]} → ${what}${f.dynamic ? ' (dyno!)' : ''}`,
      });
    }
  };

  const endRun = (r: Run) => {
    const { sim, timeline } = r;
    if (timeline.ending === 'top') {
      // Fist pump off the finish with the right hand, and a cloud of chalk.
      const chest = sim.pos[J.chest];
      const n = frameAt(frames, day.finish.v).normal;
      const up = chest.clone().add(new THREE.Vector3(0.28, 0.75, 0)).addScaledVector(n, 0.35);
      sim.drive(1, up, n, 0.35, 0);
      sim.tone = 1;
      sim.tremble = 0;
      puff(toWorld(day.finish, 0.05), n, 40, 1.1);
      sfx.topout();
      useClimb.setState({ status: 'topped', label: 'Topped out!' });
    } else {
      // Let go of everything. Physics does the rest.
      sim.ends.forEach((e) => (e.mode = 'free'));
      sim.tone = 0;
      sim.tremble = 0;
      r.limp = true;
      sim.impulse(new THREE.Vector3(0, 0.4, 1.4), STEP);
      sfx.fail();
      useClimb.setState({ status: 'fell', label: 'Off!' });
    }
  };

  useFrame((_, dt) => {
    if (!rig.current) return;
    if (!playback) {
      run.current = null;
      climberFocus.active = false;
      rig.current.apply(standingPose(day.wall));
      return;
    }
    let r = run.current;
    if (!r || r.id !== playback.run) {
      const fresh = start(playback);
      r = fresh ? { ...fresh, id: playback.run } : null;
      run.current = r ?? { id: playback.run } as Run & { id: number };
      shrug.current = 0;
    }
    if (!r || !r.sim) {
      // No valid start: stand on the pad a moment, then hand control back.
      rig.current.apply(standingPose(day.wall));
      shrug.current += dt;
      if (shrug.current > 1.6 && shrug.current - dt <= 1.6) useGame.getState().climbFinished();
      return;
    }
    r.acc += Math.min(dt, 0.05);
    const { sim, timeline } = r;
    while (r.acc >= STEP) {
      r.acc -= STEP;
      r.t += STEP;
      // Which keyframe are we in?
      let t = r.t;
      let idx = -1;
      for (let i = 0; i < timeline.frames.length; i++) {
        if (t <= timeline.frames[i].duration) {
          idx = i;
          break;
        }
        t -= timeline.frames[i].duration;
      }
      if (idx >= 0 && idx !== r.frame) {
        r.frame = idx;
        enterFrame(r, timeline.frames[idx]);
      } else if (idx < 0 && !r.ended) {
        r.ended = true;
        endRun(r);
      }
      for (let i = r.arrivals.length - 1; i >= 0; i--) {
        const a = r.arrivals[i];
        if (r.t < a.at) continue;
        r.arrivals.splice(i, 1);
        const hold = r.holds[a.hold];
        const p = sim.pos[[J.handL, J.handR, J.footL, J.footR][a.limb]];
        if (a.limb < 2) {
          sfx.grab(a.strain);
          if (hold) {
            chalkHold(hold.id);
            puff(p, frameAt(frames, hold.v).normal, 6 + Math.round(a.strain * 8), 0.35);
          }
        } else sfx.foot();
      }
      sim.step(STEP, r.limp ? null : postureFor(sim));
    }
    // Thuds when the body hits the pad.
    if (sim.impacts.length) {
      const v = Math.max(...sim.impacts);
      sim.impacts.length = 0;
      if (r.t - r.lastThud > 0.12 && v > 0.03) {
        r.lastThud = r.t;
        sfx.thud(v);
        puff(sim.pos[J.pelvis].clone().setY(0.32), new THREE.Vector3(0, 1, 0), 10, 1.2);
      }
    }
    climberFocus.pos.copy(sim.pos[J.chest]);
    climberFocus.active = true;
    rig.current.apply(arrayToPose(sim.pos));
    if (!r.finished && r.t >= timeline.total) {
      r.finished = true;
      useClimb.setState({ status: 'idle' });
      useGame.getState().climbFinished();
    }
  });

  return <Rig ref={rig} />;
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
