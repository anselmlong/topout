// A faceless low-poly climber. The solver's beta drives where hands and feet go;
// the body in between is a Verlet ragdoll (see ragdoll.ts), pulled toward an
// IK-posed skeleton by soft "muscles", so it hangs, sways, swings and falls.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { withSpots } from '../game/spots';
import { bestPull, footTechnique, handTechnique, highStep, type FootTechnique, type HandTechnique } from '../solver/model';
import type { Day, Hold, Point, SolveResult, Stance, Wall } from '../solver/types';
import { OFF } from '../solver/types';
import { contactList, surfaceAt } from '../solver/volumes';
import { chalkHold, climberFocus, useClimb } from '../state/climb';
import { useGame, type Playback } from '../state/store';
import { puff } from './Chalk';
import { J, JOINTS, Ragdoll } from './ragdoll';
import { frameAt, nearestFrame, padBox, panelFrames, uvToWorld, worldV, type PanelFrame } from './wallGeometry';

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
  /** World direction the fingers point for each hand on a hold (wrapping the incut). */
  grips?: [THREE.Vector3 | null, THREE.Vector3 | null];
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
  _hipV: number,
  /** Which way (-1 left, +1 right on screen) each free leg flags; decided once per move. */
  flagAway?: [number, number],
  /** Heel/toe hook or drop knee per foot (see footTechnique), decided once per move. */
  legs: [FootTechnique, FootTechnique] = [null, null],
  /** Feet in flight carry no weight: the hips shift over the standing foot first. */
  lifting: [boolean, boolean] = [false, false],
  /** Sidepull / gaston / undercling per hand (see handTechnique), decided once per move. */
  arms: [HandTechnique, HandTechnique] = [null, null],
): Pose {
  // Facet nearest the hands (a dihedral has two faces at the same height).
  const normal = nearestFrame(frames, hands[0].clone().add(hands[1]).multiplyScalar(0.5)).normal;
  const handsMid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
  const planted = feet.filter((f, i) => f && !lifting[i]) as THREE.Vector3[];
  const on = planted.length ? planted : (feet.filter(Boolean) as THREE.Vector3[]);
  const feetMid = on.length
    ? on.reduce((s, f) => s.add(f), V()).multiplyScalar(1 / on.length)
    : handsMid.clone().add(V(0, -1.35, 0));
  const span = handsMid.clone().sub(feetMid);
  const handsToFeet = span.length();
  const bodyDir = handsToFeet > 1e-3 ? span.normalize() : V(0, 1, 0);
  // 0 on vertical and slab, 1 from ~37° overhanging.
  const steep = Math.max(0, Math.min(1, -normal.y / 0.6));
  // Hang long-armed when there's room; bend the arms (chest up to the hands) on high steps.
  // On steep ground climbers hang off straight arms (skeleton, not biceps), so the chest
  // drops further and sits out from the wall below the hands.
  const chestDrop = Math.max(0.12 + 0.2 * steep, Math.min(0.42 + 0.1 * steep, handsToFeet - 0.75 + 0.12 * steep));
  // Bunched up (feet close to hands): sit the hips back off the wall instead of squashing.
  const lean = Math.max(0, Math.min(1, (1.3 - handsToFeet) / 0.6));
  const chest = handsMid
    .clone()
    .addScaledVector(bodyDir, -chestDrop)
    .addScaledVector(normal, 0.14 + 0.12 * lean + 0.16 * steep);
  // Opposition shifts the body sideways: lean away from a sidepull (laying back off it),
  // and in toward a gaston (the hand pushes the hold apart from the body).
  const across = V().crossVectors(bodyDir, normal).normalize();
  for (const i of [0, 1] as const) {
    const shift = arms[i] === 'sidepull' ? -0.07 : arms[i] === 'gaston' ? 0.05 : 0;
    const toHand = Math.sign(hands[i].clone().sub(handsMid).dot(across)) || (i === 0 ? -1 : 1);
    if (shift && across.lengthSq() > 0.5) chest.addScaledVector(across, shift * toHand);
  }
  // ...while the hips stay in to the wall, keeping weight on the feet. A heel hook or drop
  // knee pulls them in further.
  const twisted = legs[0] || legs[1] ? 1 : 0;
  const hipsIn = (0.3 * steep + 0.18 * twisted) * (1 - lean);
  const torsoDir = bodyDir.clone().addScaledVector(normal, hipsIn - 0.7 * lean).normalize();
  const hip = chest.clone().addScaledVector(torsoDir, -TORSO);
  // Climber's right. We see their back, so this is +x on screen.
  const lateral = V().crossVectors(torsoDir, normal).normalize();
  if (lateral.lengthSq() < 0.5) lateral.set(1, 0, 0);
  // Drop knee: the hip on that side turns in to the wall (the other swings out).
  const turn = legs[0] === 'drop-knee' ? 1 : legs[1] === 'drop-knee' ? -1 : 0;
  const head = chest.clone().addScaledVector(torsoDir, 0.2).addScaledVector(normal, 0.05);
  const shoulders: [THREE.Vector3, THREE.Vector3] = [
    chest.clone().addScaledVector(lateral, -0.19),
    chest.clone().addScaledVector(lateral, 0.19),
  ];
  const pelvis: [THREE.Vector3, THREE.Vector3] = [
    hip.clone().addScaledVector(lateral, -0.1).addScaledVector(normal, -0.06 * turn),
    hip.clone().addScaledVector(lateral, 0.1).addScaledVector(normal, 0.06 * turn),
  ];
  const arm = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    // Which way the hand sits from the chest: a gaston's elbow points out that way.
    const out = Math.sign(hands[i].clone().sub(chest).dot(lateral)) || side;
    // Elbows down and out by default. An undercling tucks the elbow down by the ribs,
    // palm up; a gaston flares the elbow out and up, thumb down; a sidepull keeps the
    // elbow low and the arm long, leaning off the hold.
    const pole =
      arms[i] === 'undercling'
        ? torsoDir.clone().multiplyScalar(-1).addScaledVector(normal, 0.35).addScaledVector(lateral, side * 0.15)
        : arms[i] === 'gaston'
          ? lateral.clone().multiplyScalar(out).addScaledVector(torsoDir, 0.45).addScaledVector(normal, 0.35)
          : arms[i] === 'sidepull'
            ? torsoDir.clone().multiplyScalar(-0.9).addScaledVector(normal, 0.45).addScaledVector(lateral, side * 0.25)
            : torsoDir.clone().multiplyScalar(-0.6).addScaledVector(normal, 0.5).addScaledVector(lateral, side * 0.6);
    return ik(shoulders[i], hands[i], ARM, pole);
  };
  const leg = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    const other = feet[1 - i];
    let target = feet[i];
    if (!target && other) {
      // Flag: the free leg reaches out along the wall, away from the hands, as a counterweight.
      const away = flagAway?.[i] || Math.sign(other.clone().sub(handsMid).dot(lateral)) || side;
      target = other.clone().addScaledVector(lateral, away * 0.5).addScaledVector(torsoDir, 0.08).addScaledVector(normal, 0.04);
    }
    // No feet on at all (campus): tucked up, knee bent, clear of the mat.
    target ??= pelvis[i].clone().add(V(side * 0.16, -0.5, 0)).addScaledVector(normal, 0.22);
    // Knees out, frog-style, by default. A heel hook cocks the knee up and out to the side;
    // a toe hook reaches the leg out long, knee up, so the shin can pull the toe back; a
    // drop knee turns it in and down toward the other foot.
    const pole =
      legs[i] === 'heel'
        ? lateral.clone().multiplyScalar(side * 0.8).addScaledVector(torsoDir, 0.6).addScaledVector(normal, 0.4)
        : legs[i] === 'toe'
          ? torsoDir.clone().multiplyScalar(0.9).addScaledVector(normal, 0.3).addScaledVector(lateral, side * 0.2)
          : legs[i] === 'drop-knee'
          ? torsoDir.clone().multiplyScalar(-1).addScaledVector(lateral, -side * 0.4).addScaledVector(normal, 0.2)
          : normal.clone().addScaledVector(lateral, side * 0.7);
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
    // Facing the camera, so the climber's left is on screen right.
    shoulders: [V(x + 0.19, g + 1.36, z), V(x - 0.19, g + 1.36, z)],
    elbows: [V(x + 0.23, g + 1.07, z + 0.02), V(x - 0.23, g + 1.07, z + 0.02)],
    hands: [V(x + 0.22, g + 0.79, z + 0.06), V(x - 0.22, g + 0.79, z + 0.06)],
    pelvis: [V(x + 0.1, g + 0.86, z), V(x - 0.1, g + 0.86, z)],
    knees: [V(x + 0.12, g + 0.44, z + 0.03), V(x - 0.12, g + 0.44, z + 0.03)],
    feet: [V(x + 0.13, g + 0.02, z), V(x - 0.13, g + 0.02, z)],
  };
}

/** Waiting on the pad: breathing, glancing at the wall, dipping into the chalk bucket. */
function idlePose(wall: Wall, t: number): Pose {
  const p = standingPose(wall);
  const breathe = Math.sin(t * 1.9) * 0.008;
  for (const v of [p.chest, p.head, ...p.shoulders, ...p.elbows, ...p.hands]) v.y += breathe;
  p.head.x += Math.sin(t * 0.37) * 0.025;
  p.head.z -= (Math.sin(t * 0.37) * 0.5 + 0.5) * 0.03;
  // Chalk dip: ~1.4s out of every 7s, right hand goes to the bucket.
  const cycle = t % 7;
  if (cycle > 5.4) {
    const k = Math.sin(((cycle - 5.4) / 1.6) * Math.PI);
    const bucket = V(p.hip.x + 0.45, PAD_TOP + 0.62, 1.25);
    const hand = p.hands[0].clone().lerp(bucket, k);
    p.chest.x += 0.05 * k;
    p.head.x += 0.07 * k;
    p.head.y -= 0.05 * k;
    const pole = V(0.4, -0.3, 0.6);
    const arm = ik(p.shoulders[0], hand, ARM, pole);
    p.elbows[0] = arm.joint;
    p.hands[0] = arm.end;
  }
  return p;
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
      // A touch slower than real time reads smoother; hard moves take longer still.
      const base = m.limb >= 2 ? 0.5 : 0.65 + strain * 0.4;
      frames.push({
        to: contactsOf(m.to),
        holds: [...m.to.limbs],
        limb: m.limb,
        duration: m.dynamic ? 0.55 : base,
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
  /** Hold index under each hand (-1 = not gripping), for turning the mittens. */
  grip: [number, number];
  /** Flag direction per foot, fixed for the move so the free leg doesn't flip sides. */
  flagAway: [number, number];
  /** Heel hook / drop knee per foot for the current move. */
  legs: [FootTechnique, FootTechnique];
  /** Sidepull / gaston / undercling per hand for the current move. */
  arms: [HandTechnique, HandTechnique];
  lastThud: number;
}

export function Climber({ day }: { day: Day }) {
  const playback = useGame((s) => s.playback);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const run = useRef<(Run & { id: number }) | null>(null);
  const idle = useRef({ t: 0, dipped: false });
  const shrug = useRef(0);
  const rig = useRef<RigHandle>(null);

  const volumes = playback?.volumes ?? [];
  /** A contact point in the world, standing out by any volume's surface there. */
  const toWorld = (p: Point, out: number) => {
    const f = frameAt(frames, p.u, p.v);
    const relief = (surfaceAt(volumes, p.u, p.v)?.height ?? 0) / 100;
    return uvToWorld(day.wall, frames, p.u, p.v).addScaledVector(f.normal, out + relief);
  };
  const normalAt = (p: Point) => frameAt(frames, p.u, p.v).normal;

  /** Posed skeleton for the ends' current positions (the "muscle" targets). */
  const postureFor = (
    sim: Ragdoll,
    flagAway?: [number, number],
    legs?: [FootTechnique, FootTechnique],
    arms?: [HandTechnique, HandTechnique],
  ): THREE.Vector3[] => {
    const e = sim.ends;
    const hands: [THREE.Vector3, THREE.Vector3] = [sim.pos[J.handL].clone(), sim.pos[J.handR].clone()];
    const feet: [THREE.Vector3 | null, THREE.Vector3 | null] = [
      e[2].mode === 'free' ? null : sim.pos[J.footL].clone(),
      e[3].mode === 'free' ? null : sim.pos[J.footR].clone(),
    ];
    const mid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
    const lifting: [boolean, boolean] = [e[2].mode === 'moving', e[3].mode === 'moving'];
    return poseToArray(poseFrom(frames, hands, feet, Math.max(0, worldV(frames, mid) - 80), flagAway, legs, lifting, arms));
  };

  const start = (pb: Playback): Run | null => {
    const timeline = buildTimeline(pb.result, day);
    if (!timeline.frames.length) return null;
    const first = timeline.frames[0].to;
    const hands = first.hands.map((p) => toWorld(p, 0.07)) as [THREE.Vector3, THREE.Vector3];
    const feet = first.feet.map((p) => (p ? toWorld(p, 0.06) : null)) as [THREE.Vector3 | null, THREE.Vector3 | null];
    const init = poseToArray(poseFrom(frames, hands, feet, Math.max(0, (first.hands[0].v + first.hands[1].v) / 2 - 80)));
    const pad = padBox(day.wall);
    const vols = pb.volumes;
    const sim = new Ragdoll(
      init,
      frames,
      day.wall.width / 200,
      {
        padTop: pad.top,
        padMinX: -pad.width / 2,
        padMaxX: pad.width / 2,
        padMinZ: pad.minZ,
        padMaxZ: pad.maxZ,
      },
      (u, v) => (surfaceAt(vols, u, v)?.height ?? 0) / 100,
    );
    first.feet.forEach((p, i) => !p && (sim.ends[2 + i].mode = 'free'));
    useClimb.setState({ move: -1, total: pb.result.ok ? pb.result.moves.length : 0, strain: 0, label: 'Chalking up…', status: 'climbing' });
    // Same list the solver indexed into, so chalk and hand direction hit the right holds.
    const tape = withSpots(day, pb.spots);
    const holds = contactList(tape.start, tape.finish, pb.holds, pb.volumes, day.wall);
    return { sim, timeline, holds, t: 0, acc: 0, frame: -1, ended: false, finished: false, limp: false, arrivals: [], lastThud: 0, flagAway: [0, 0], legs: [null, null], arms: [null, null], grip: [timeline.frames[0].holds[0] ?? -1, timeline.frames[0].holds[1] ?? -1] };
  };

  /** Which way the fingers point on the hold a hand is gripping. */
  const gripDir = (r: Run, hand: 0 | 1): THREE.Vector3 | null => {
    const hold = r.holds[r.grip[hand]];
    if (!hold || r.grip[hand] < 0) return null;
    const face = frameAt(frames, hold.u, hold.v);
    const up = face.up;
    const pull = bestPull(hold.rot);
    // Fingers wrap over the incut, against the pull...
    let du = -pull.u;
    let dv = -pull.v;
    // ...except pinches, which are squeezed from the side: thumb one way, fingers the other.
    if (hold.type === 'pinch') {
      const side = hand === 0 ? 1 : -1;
      [du, dv] = [pull.v * side * -1, -pull.u * side * -1];
    }
    return face.right.clone().multiplyScalar(du).addScaledVector(up, dv).normalize();
  };

  const enterFrame = (r: Run, f: Keyframe) => {
    const { sim } = r;
    // Decide which way a free leg flags: away from the hands, on the supporting foot's side.
    const handsU = (f.to.hands[0].u + f.to.hands[1].u) / 2;
    r.flagAway = [0, 1].map((i) => {
      const on = f.to.feet[1 - i];
      if (f.to.feet[i] || !on) return 0;
      return Math.sign(on.u - handsU) || (i === 0 ? -1 : 1);
    }) as [number, number];
    if (f.holds.length) {
      r.grip = [f.holds[0], f.holds[1]];
      r.legs = [0, 1].map((i) => {
        const foot = f.to.feet[i];
        return foot && f.holds[2 + i] >= 0 ? footTechnique(day.wall, f.to.hands, foot) : null;
      }) as [FootTechnique, FootTechnique];
      // The body centre each hand pulls toward, as the solver sees it: between the
      // other hand and the feet.
      const on = f.to.feet.filter(Boolean) as Point[];
      r.arms = [0, 1].map((i) => {
        const hold = r.holds[f.holds[i]];
        if (!hold) return null;
        const other = f.to.hands[1 - i];
        const feet = on.length
          ? { u: on.reduce((s, p) => s + p.u, 0) / on.length, v: on.reduce((s, p) => s + p.v, 0) / on.length }
          : { u: other.u, v: other.v - 140 };
        return handTechnique(hold, { u: (other.u + feet.u) / 2, v: (other.v + feet.v) / 2 });
      }) as [HandTechnique, HandTechnique];
    }
    const contacts: (Point | null)[] = [...f.to.hands, ...f.to.feet];
    contacts.forEach((c, n) => {
      const target = c ? toWorld(c, n < 2 ? 0.07 : 0.06) : null;
      const normal = c ? normalAt(c) : new THREE.Vector3(0, 0, 1);
      if (n === f.limb) sim.drive(n, target, normal, f.duration * 0.85, f.dynamic ? 0.14 : 0.07);
      else sim.drive(n, target, normal, 0.3, 0.05);
    });
    sim.tone = 1 - 0.45 * f.strain;
    if (f.limb >= 0 && f.holds.length) r.arrivals.push({ at: r.t + f.duration * 0.85, limb: f.limb, hold: f.holds[f.limb], strain: f.strain });
    if (f.dynamic) {
      // Launch: throw the hips at the target, and let the feet cut loose on steep ground.
      const target = toWorld(f.to.hands[f.limb as 0 | 1], 0.07);
      const push = target.sub(sim.pos[J.pelvis]).normalize().multiplyScalar(2.2);
      sim.impulse(push, STEP, [J.pelvis, J.chest, J.head, J.shoulderL, J.shoulderR, J.hipL, J.hipR]);
      const steep = frameAt(frames, f.to.hands[0].u, f.to.hands[0].v).normal.y < -0.2;
      if (steep) [2, 3].forEach((n) => (sim.ends[n].mode = 'free'));
      sfx.whoosh();
    }
    if (f.move >= 0) {
      const m = f.limb;
      const hold = f.holds[m];
      const h = hold >= 0 ? r.holds[hold] : undefined;
      const what = h ? (h.id.startsWith('arete:') ? 'arête' : h.id.startsWith('lip:') ? 'lip' : h.type) : hold === -1 ? 'smear' : 'off';
      const foot = m >= 2 ? f.to.feet[m - 2] : null;
      const tech = !h ? null : m >= 2 ? r.legs[m - 2] : r.arms[m];
      useClimb.setState({
        move: f.move,
        strain: f.strain,
        label: `${LIMB_NAME[m]} → ${what}${f.dynamic ? ' (dyno!)' : ''}${
          tech === 'heel'
            ? ' (heel hook)'
            : tech === 'toe'
              ? ' (toe hook)'
              : tech === 'drop-knee'
                ? ' (drop knee)'
                : tech
                  ? ` (${tech})`
                  : h && foot && highStep(f.to.hands, foot) > 0.8
                  ? ' (high step)'
                  : ''
        }${f.strain >= 0.98 && m < 2 ? ' · crux' : ''}`,
      });
    }
  };

  const endRun = (r: Run) => {
    const { sim, timeline } = r;
    if (timeline.ending === 'top') {
      // Fist pump off the finish with the right hand, and a cloud of chalk.
      const n = frameAt(frames, day.finish.u, day.finish.v).normal;
      const up = sim.pos[J.shoulderR].clone().add(new THREE.Vector3(0.3, 0.5, 0)).addScaledVector(n, 0.3);
      sim.drive(1, up, n, 0.35, 0);
      r.grip[1] = -1;
      sim.tone = 1;
      puff(toWorld(day.finish, 0.05), n, 40, 1.1);
      sfx.topout();
      useClimb.setState({ status: 'topped', label: 'Topped out!' });
    } else {
      // Let go of everything. Physics does the rest.
      sim.ends.forEach((e) => (e.mode = 'free'));
      r.grip = [-1, -1];
      sim.tone = 0;
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
      const it = idle.current;
      it.t += Math.min(dt, 0.05);
      const cycle = it.t % 7;
      if (cycle > 6.1 && !it.dipped) {
        it.dipped = true;
        puff(V(-day.wall.width / 200 - 0.1, PAD_TOP + 0.52, 1.25), V(0, 1, 0), 8, 0.6);
      } else if (cycle < 6.1) it.dipped = false;
      rig.current.apply(idlePose(day.wall, it.t));
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
    const { sim, timeline } = r;
    // Crux cam: the hardest move plays in slow motion.
    const cur = r.frame >= 0 ? timeline.frames[r.frame] : null;
    const slow = cur && cur.limb >= 0 && cur.strain >= 0.98 && timeline.ending === 'top' && !r.ended;
    r.acc += Math.min(dt, 0.05) * (slow ? 0.45 : 1);
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
            puff(p, frameAt(frames, hold.u, hold.v).normal, 6 + Math.round(a.strain * 8), 0.35);
          }
        } else sfx.foot();
      }
      sim.step(STEP, r.limp ? null : postureFor(sim, r.flagAway, r.legs, r.arms));
    }
    // Thuds when the body hits the pad.
    if (sim.impacts.length) {
      const v = Math.max(...sim.impacts);
      sim.impacts.length = 0;
      if (r.t - r.lastThud > 0.12 && v > 0.03) {
        r.lastThud = r.t;
        sfx.thud(v);
        climberFocus.shake = Math.min(0.05, v * 1.5);
        puff(sim.pos[J.pelvis].clone().setY(0.32), new THREE.Vector3(0, 1, 0), 10, 1.2);
      }
    }
    climberFocus.pos.copy(sim.pos[J.chest]);
    climberFocus.active = true;
    if (import.meta.env.DEV) (window as unknown as { __sim: Ragdoll }).__sim = sim;
    const pose = arrayToPose(sim.pos);
    pose.grips = [gripDir(r, 0), gripDir(r, 1)];
    rig.current.apply(pose);
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
const none = () => null;

const LOOK = {
  skin: '#dcc3a8',
  shirt: '#7f9a8c',
  pants: '#4c4f55',
  shoe: '#9a5b45',
  beanie: '#c2a255',
  bag: '#6f7f99',
  eye: '#2b2a28',
  blush: '#d9a393',
};

const Rig = forwardRef<RigHandle>(function Rig(_, ref) {
  const upperArms = useRef<THREE.Mesh[]>([]);
  const forearms = useRef<THREE.Mesh[]>([]);
  const thighs = useRef<THREE.Mesh[]>([]);
  const shins = useRef<THREE.Mesh[]>([]);
  const joints = useRef<THREE.Mesh[]>([]);
  const mitts = useRef<THREE.Mesh[]>([]);
  const shoes = useRef<THREE.Mesh[]>([]);
  const torso = useRef<THREE.Mesh>(null);
  const hips = useRef<THREE.Mesh>(null);
  const neck = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Group>(null);
  const bag = useRef<THREE.Mesh>(null);
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), up: V(), right: V(), fwd: V(), a: V(), b: V(), c: V() }),
    [],
  );

  const setSeg = (m: THREE.Mesh | undefined, a: THREE.Vector3, b: THREE.Vector3) => {
    if (!m) return;
    const d = b.clone().sub(a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
    m.scale.set(1, Math.max(0.001, len), 1);
  };

  /** Orient `m` so local +y = `yAxis`, local +z ≈ `zHint`. */
  const orient = (m: THREE.Object3D, yAxis: THREE.Vector3, zHint: THREE.Vector3) => {
    const y = tmp.a.copy(yAxis).normalize();
    const x = tmp.b.crossVectors(y, zHint);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const z = tmp.c.crossVectors(x, y).normalize();
    m.quaternion.setFromRotationMatrix(tmp.m.makeBasis(x, y, z));
  };

  useImperativeHandle(ref, () => ({
    apply(p) {
      // Body frame: up along the spine, right across the shoulders, forward = facing.
      const up = tmp.up.copy(p.chest).sub(p.hip).normalize();
      const right = tmp.right.copy(p.shoulders[1]).sub(p.shoulders[0]).normalize();
      const fwd = tmp.fwd.crossVectors(up, right).normalize();
      setSeg(upperArms.current[0], p.shoulders[0], p.elbows[0]);
      setSeg(upperArms.current[1], p.shoulders[1], p.elbows[1]);
      setSeg(forearms.current[0], p.elbows[0], p.hands[0]);
      setSeg(forearms.current[1], p.elbows[1], p.hands[1]);
      setSeg(thighs.current[0], p.pelvis[0], p.knees[0]);
      setSeg(thighs.current[1], p.pelvis[1], p.knees[1]);
      setSeg(shins.current[0], p.knees[0], p.feet[0]);
      setSeg(shins.current[1], p.knees[1], p.feet[1]);
      [...p.elbows, ...p.knees, ...p.shoulders].forEach((j, i) => joints.current[i]?.position.copy(j));
      if (torso.current) setSeg(torso.current, p.hip, p.chest);
      if (hips.current) {
        hips.current.position.copy(p.hip);
        orient(hips.current, up, fwd);
      }
      const neckTop = p.head.clone().addScaledVector(up, -0.06);
      if (neck.current) setSeg(neck.current, p.chest, neckTop);
      if (head.current) {
        head.current.position.copy(p.head);
        orient(head.current, up, fwd);
      }
      if (bag.current) {
        bag.current.position.copy(p.hip).addScaledVector(fwd, -0.13).addScaledVector(up, -0.02);
        orient(bag.current, up, fwd);
      }
      // Mittens: fingers wrap the hold's incut when gripping, else follow the forearm.
      [0, 1].forEach((i) => {
        const m = mitts.current[i];
        if (!m) return;
        m.position.copy(p.hands[i]);
        const fingers = p.grips?.[i] ?? p.hands[i].clone().sub(p.elbows[i]);
        orient(m, fingers, fwd.clone().negate());
      });
      // Shoes: along the facing direction, sole square to the shin.
      [0, 1].forEach((i) => {
        const m = shoes.current[i];
        if (!m) return;
        const shin = p.feet[i].clone().sub(p.knees[i]).normalize();
        m.position.copy(p.feet[i]).addScaledVector(fwd, 0.04);
        orient(m, shin.negate(), fwd);
      });
    },
  }));

  const g = useMemo(
    () => ({
      upperArm: new THREE.CylinderGeometry(0.05, 0.045, 1, 7),
      forearm: new THREE.CylinderGeometry(0.042, 0.035, 1, 7),
      thigh: new THREE.CylinderGeometry(0.07, 0.058, 1, 7),
      shin: new THREE.CylinderGeometry(0.055, 0.045, 1, 7),
      torso: new THREE.CylinderGeometry(0.17, 0.14, 1, 8),
      hips: new THREE.BoxGeometry(0.28, 0.12, 0.17),
      neck: new THREE.CylinderGeometry(0.045, 0.05, 1, 6),
      joint: new THREE.IcosahedronGeometry(0.052, 1),
      mitt: new THREE.BoxGeometry(0.065, 0.09, 0.032).translate(0, 0.035, 0),
      shoe: new THREE.BoxGeometry(0.085, 0.06, 0.21).translate(0, 0.01, 0.03),
      head: new THREE.IcosahedronGeometry(0.115, 2),
      beanie: new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.1),
      cuff: new THREE.TorusGeometry(0.113, 0.022, 6, 14),
      pompom: new THREE.IcosahedronGeometry(0.032, 1),
      eye: new THREE.SphereGeometry(0.014, 8, 6),
      blush: new THREE.CircleGeometry(0.018, 10),
      smile: new THREE.TorusGeometry(0.026, 0.005, 4, 10, Math.PI),
      bag: new THREE.CylinderGeometry(0.055, 0.05, 0.1, 8),
    }),
    [],
  );
  const mat = useMemo(() => {
    const m = (color: string, rough = 0.85) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: rough });
    return {
      skin: m(LOOK.skin),
      shirt: m(LOOK.shirt),
      pants: m(LOOK.pants),
      shoe: m(LOOK.shoe),
      beanie: m(LOOK.beanie, 1),
      bag: m(LOOK.bag),
      eye: new THREE.MeshBasicMaterial({ color: LOOK.eye }),
      blush: new THREE.MeshBasicMaterial({ color: LOOK.blush, transparent: true, opacity: 0.7 }),
    };
  }, []);

  const part = (key: string, geo: THREE.BufferGeometry, material: THREE.Material, r?: (m: THREE.Mesh) => void) => (
    <mesh key={key} ref={(m) => void (m && r?.(m))} geometry={geo} material={material} castShadow raycast={none} />
  );

  return (
    <group>
      {[0, 1].map((i) => part(`ua${i}`, g.upperArm, mat.shirt, (m) => (upperArms.current[i] = m)))}
      {[0, 1].map((i) => part(`fa${i}`, g.forearm, mat.skin, (m) => (forearms.current[i] = m)))}
      {[0, 1].map((i) => part(`th${i}`, g.thigh, mat.pants, (m) => (thighs.current[i] = m)))}
      {[0, 1].map((i) => part(`sh${i}`, g.shin, mat.pants, (m) => (shins.current[i] = m)))}
      {/* elbows (skin), knees (pants), shoulders (shirt) */}
      {Array.from({ length: 6 }, (_, i) =>
        part(`j${i}`, g.joint, i < 2 ? mat.skin : i < 4 ? mat.pants : mat.shirt, (m) => (joints.current[i] = m)),
      )}
      {[0, 1].map((i) => part(`mi${i}`, g.mitt, mat.skin, (m) => (mitts.current[i] = m)))}
      {[0, 1].map((i) => part(`so${i}`, g.shoe, mat.shoe, (m) => (shoes.current[i] = m)))}
      {part('torso', g.torso, mat.shirt, (m) => ((torso as { current: THREE.Mesh | null }).current = m))}
      {part('hips', g.hips, mat.pants, (m) => ((hips as { current: THREE.Mesh | null }).current = m))}
      {part('neck', g.neck, mat.skin, (m) => ((neck as { current: THREE.Mesh | null }).current = m))}
      {part('bag', g.bag, mat.bag, (m) => ((bag as { current: THREE.Mesh | null }).current = m))}
      <group ref={head}>
        <mesh geometry={g.head} material={mat.skin} castShadow raycast={none} />
        {/* Beanie, turned-up cuff and pompom. */}
        <mesh geometry={g.beanie} material={mat.beanie} position={[0, 0.02, -0.005]} rotation={[-0.15, 0, 0]} raycast={none} />
        <mesh geometry={g.cuff} material={mat.beanie} position={[0, 0.03, -0.01]} rotation={[Math.PI / 2 - 0.15, 0, 0]} raycast={none} />
        <mesh geometry={g.pompom} material={mat.beanie} position={[0, 0.15, -0.03]} raycast={none} />
        {/* Face on local +z. */}
        {[-1, 1].map((sx) => (
          <mesh key={`e${sx}`} geometry={g.eye} material={mat.eye} position={[sx * 0.038, -0.005, 0.104]} scale={[1, 1.35, 0.6]} raycast={none} />
        ))}
        {[-1, 1].map((sx) => (
          <mesh key={`b${sx}`} geometry={g.blush} material={mat.blush} position={[sx * 0.062, -0.035, 0.095]} rotation={[0, sx * 0.55, 0]} raycast={none} />
        ))}
        <mesh geometry={g.smile} material={mat.eye} position={[0, -0.042, 0.106]} rotation={[0, 0, Math.PI]} raycast={none} />
      </group>
    </group>
  );
});
