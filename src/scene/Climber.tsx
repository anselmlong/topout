// A faceless low-poly climber. The solver's beta drives where hands and feet go;
// the body in between is a Verlet ragdoll (see ragdoll.ts), pulled toward an
// IK-posed skeleton by soft "muscles", so it hangs, sways, swings and falls.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { withSpots } from '../game/spots';
import { moveGrade } from '../game/tips';
import { bestPull, footTechnique, handGrip, handTechnique, highStep, hipTurn, stemBonus, type FootTechnique, type HandTechnique } from '../solver/model';
import type { Day, Hold, Point, SolveResult, Stance, Wall } from '../solver/types';
import { OFF } from '../solver/types';
import { contactList, surfaceAt } from '../solver/volumes';
import { chalkHold, climberFocus, rubberHold, useClimb, usePlaySpeed } from '../state/climb';
import { useGame, type Playback } from '../state/store';
import { puff } from './Chalk';
import { J, JOINTS, Ragdoll } from './ragdoll';
import { frameAt, nearestFrame, padBox, panelFrames, uvToWorld, worldV, type PanelFrame } from './wallGeometry';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const ARM = [0.3, 0.29];
const LEG = [0.43, 0.42];
const TORSO = 0.5;
const PAD_TOP = 0.3;
/** A hand on a hold less than this far (cm) above the feet is down by the hips: it presses. */
const PRESS_ABOVE_FEET = 60;

/** The solver's hand techniques, plus a press: palm down on a hold at waist height (a mantle). */
type ArmTechnique = HandTechnique | 'press';

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
  /** Where the climber is looking (a hold), or undefined to face straight ahead. */
  look?: THREE.Vector3 | null;
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
  /** Sidepull / gaston / undercling / press per hand (see handTechnique), decided once per move. */
  arms: [ArmTechnique, ArmTechnique] = [null, null],
  /** A hand off the wall shaking out: the body hangs straight-armed under the other one. */
  resting: 0 | 1 | null = null,
  /** Winding up a dyno, 0..1: hips sink down and back off straight arms, knees bent. */
  sink = 0,
  /** Hip turn on a long reach (see hipTurn): + turns the left hip in, - the right. */
  twist = 0,
): Pose {
  const holding = resting === null ? hands : [hands[1 - resting], hands[1 - resting]];
  // Stemming: the feet bridged across an inside corner, one on each face, pressing them
  // apart. Each foot is in front of the other's face (on an arête they'd be behind it).
  const faces = feet.map((f) => (f ? nearestFrame(frames, f).normal : null));
  const stem =
    !!feet[0] &&
    !!feet[1] &&
    faces[0]!.dot(faces[1]!) < 0.98 &&
    faces[0]!.x * faces[1]!.x < -0.01 &&
    feet[1].clone().sub(feet[0]).dot(faces[0]!) > 0.03 &&
    feet[0].clone().sub(feet[1]).dot(faces[1]!) > 0.03;
  // Bridged across a corner the body squares up to it; there's no hip to turn in.
  if (stem) twist = 0;
  // Facet nearest the hands (a dihedral has two faces at the same height). A stemming
  // climber squares up to the corner instead, facing into the crease, back to the room.
  const handFace = nearestFrame(frames, holding[0].clone().add(holding[1]).multiplyScalar(0.5)).normal;
  const normal = stem ? handFace.clone().multiplyScalar(0.5).add(faces[0]!).add(faces[1]!).normalize() : handFace;
  const handsMid = holding[0].clone().add(holding[1]).multiplyScalar(0.5);
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
  // Pressing (a mantle): the shoulders come up over the hands that push down, arms
  // locking out, instead of hanging below them. Both hands pressing puts the chest well
  // above them; one hand pressing lifts the body to reach up with the other.
  const press = ((arms[0] === 'press' ? 1 : 0) + (arms[1] === 'press' ? 1 : 0)) / 2;
  // Bunched up (feet close to hands): sit the hips back off the wall instead of squashing.
  // Not while pressing: a mantle keeps the hips in, over the feet, to stand up on them.
  const lean = Math.max(0, Math.min(1, (1.3 - handsToFeet) / 0.6)) * (1 - press);
  // Loading a dyno: arms lock straight and the hips drop low and back, as far as the
  // legs have room to bend, so the legs can drive the body up from there.
  const load = sink * Math.max(0, Math.min(1, (handsToFeet - 0.85) / 0.45));
  const chest = handsMid
    .clone()
    .addScaledVector(bodyDir, -chestDrop + press * (chestDrop + 0.3) - 0.2 * load)
    .addScaledVector(normal, 0.14 + 0.12 * lean + 0.16 * steep + 0.06 * press + 0.06 * load);
  // Opposition shifts the body sideways: lean away from a sidepull (laying back off it),
  // and in toward a gaston (the hand pushes the hold apart from the body).
  const across = V().crossVectors(bodyDir, normal).normalize();
  for (const i of [0, 1] as const) {
    // A lone pressing hand gets the shoulder over it.
    const shift = arms[i] === 'sidepull' ? -0.07 : arms[i] === 'gaston' || (arms[i] === 'press' && press < 1) ? 0.05 : 0;
    const toHand = Math.sign(hands[i].clone().sub(handsMid).dot(across)) || (i === 0 ? -1 : 1);
    if (shift && across.lengthSq() > 0.5) chest.addScaledVector(across, shift * toHand);
  }
  // Hanging off one arm, that shoulder sits under its hand: the chest swings toward the free side.
  if (resting !== null && across.lengthSq() > 0.5) chest.addScaledVector(across, resting === 0 ? -0.17 : 0.17);
  // ...while the hips stay in to the wall, keeping weight on the feet. A heel hook or drop
  // knee pulls them in further.
  const twisted = legs[0] || legs[1] ? 1 : 0;
  const hipsIn = (0.3 * steep + 0.18 * twisted + 0.15 * Math.abs(twist)) * (1 - lean);
  const torsoDir = bodyDir.clone().addScaledVector(normal, hipsIn - 0.7 * lean - 0.35 * load).normalize();
  const hip = chest.clone().addScaledVector(torsoDir, -TORSO);
  // Climber's right. We see their back, so this is +x on screen.
  const lateral = V().crossVectors(torsoDir, normal).normalize();
  if (lateral.lengthSq() < 0.5) lateral.set(1, 0, 0);
  // Drop knee: the hip on that side turns in to the wall (the other swings out).
  const turn = legs[0] === 'drop-knee' ? 1 : legs[1] === 'drop-knee' ? -1 : 0;
  const head = chest.clone().addScaledVector(torsoDir, 0.2).addScaledVector(normal, 0.05);
  // A hip turn rotates the body side-on about the spine: the hips by up to ~50°, the
  // shoulders less (the chest still faces the holds). The turned-in side goes to the wall,
  // and the reaching shoulder rides up toward its hold while the other arm hangs straight.
  const hipYaw = 0.8 * twist;
  const shoulderYaw = 0.5 * twist;
  const sideOn = (at: THREE.Vector3, s: -1 | 1, half: number, yaw: number) =>
    at.clone().addScaledVector(lateral, s * half * Math.cos(yaw)).addScaledVector(normal, s * half * Math.sin(yaw));
  const shoulders: [THREE.Vector3, THREE.Vector3] = [
    sideOn(chest, -1, 0.19, shoulderYaw).addScaledVector(torsoDir, 0.05 * Math.max(0, twist)),
    sideOn(chest, 1, 0.19, shoulderYaw).addScaledVector(torsoDir, 0.05 * Math.max(0, -twist)),
  ];
  const pelvis: [THREE.Vector3, THREE.Vector3] = [
    sideOn(hip, -1, 0.1, hipYaw).addScaledVector(normal, -0.06 * turn),
    sideOn(hip, 1, 0.1, hipYaw).addScaledVector(normal, 0.06 * turn),
  ];
  const arm = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    // Which way the hand sits from the chest: a gaston's elbow points out that way.
    const out = Math.sign(hands[i].clone().sub(chest).dot(lateral)) || side;
    // Elbows down and out by default. An undercling tucks the elbow down by the ribs,
    // palm up; a gaston flares the elbow out and up, thumb down; a sidepull keeps the
    // elbow low and the arm long, leaning off the hold. A press points the elbow up and
    // back, over the hand, so the arm can straighten down onto it.
    const pole =
      resting === i
        ? normal.clone().multiplyScalar(0.6).addScaledVector(lateral, side * 0.5).addScaledVector(torsoDir, -0.3)
        : arms[i] === 'press'
        ? torsoDir.clone().multiplyScalar(0.7).addScaledVector(normal, 0.6).addScaledVector(lateral, side * 0.35)
        : arms[i] === 'undercling'
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
    // drop knee turns it in and down toward the other foot. In a hip turn the turned-in
    // leg backsteps: the knee swings across toward the other leg so the outside edge of
    // the shoe bites, while the other knee opens out.
    const backstep = twist * -side;
    const pole =
      legs[i] === 'heel'
        ? lateral.clone().multiplyScalar(side * 0.8).addScaledVector(torsoDir, 0.6).addScaledVector(normal, 0.4)
        : legs[i] === 'toe'
          ? torsoDir.clone().multiplyScalar(0.9).addScaledVector(normal, 0.3).addScaledVector(lateral, side * 0.2)
          : legs[i] === 'drop-knee'
          ? torsoDir.clone().multiplyScalar(-1).addScaledVector(lateral, -side * 0.4).addScaledVector(normal, 0.2)
          : backstep > 0.15
            ? lateral.clone().multiplyScalar(-side * 0.7).addScaledVector(normal, 0.45).addScaledVector(torsoDir, -0.25)
          : stem
            ? // Bridged: each knee points out along its own face, away from the crease,
              // and a little down, so the leg pushes into that face like a strut.
              lateral.clone().multiplyScalar(side * 0.85).addScaledVector(faces[i]!, 0.35).addScaledVector(torsoDir, -0.2)
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
  /** The move's own grade, for the ticker. */
  grade?: number;
  move: number;
  /** A shake-out: this hand lets go, shakes, chalks up and grabs the same hold again. */
  rest?: 0 | 1;
  /** Winding up the dyno that follows: pump the hips down twice, launch from the low point. */
  windup?: boolean;
}

interface Timeline {
  frames: Keyframe[];
  ending: 'top' | 'fall' | 'shrug';
  total: number;
  /** Extra time after the last frame for the ending to play out. */
  tail: number;
}

/** How long a shake-out before the crux takes (s). */
const REST = 1.6;
/** The shake-out's choreography (shakeOut) is written over this many seconds, then fitted into REST. */
const SHAKE_SCRIPT = 2.1;
/** How long the pumps before a dyno take (s). */
const WINDUP = 0.5;

/**
 * Hip sink through a dyno's wind-up (k 0..1): a shallow pump to find the rhythm, then
 * a deep one, bottoming out at the end so the launch fires from the lowest point.
 */
function windupSink(k: number): number {
  if (k < 0.4) return 0.45 * Math.sin((Math.PI * k) / 0.4);
  return 0.5 - 0.5 * Math.cos((Math.PI * (k - 0.4)) / 0.6);
}

/**
 * Before the crux, a climber who can hang off a good hold shakes out the hand that is
 * about to move and chalks up: the other hand on a jug-like grip, a foot on to take
 * some weight. Returns the hand to rest, or null if there's no rest to be had there.
 */
function restBefore(stance: Stance, hand: 0 | 1, holds: Hold[], wall: Wall): 0 | 1 | null {
  const stay = holds[stance.limbs[1 - hand]];
  if (!stay || holds[stance.limbs[hand]] === undefined) return null;
  if (stance.limbs[2] === OFF && stance.limbs[3] === OFF) return null;
  const feet = [2, 3].filter((f) => stance.limbs[f] !== OFF).map((f) => stance.points[f]);
  const below = { u: feet.reduce((s, p) => s + p.u, 0) / feet.length, v: feet.reduce((s, p) => s + p.v, 0) / feet.length };
  return handGrip(stay, below, wall) >= 0.7 ? hand : null;
}

function buildTimeline(result: SolveResult, day: Day, holds: Hold[]): Timeline {
  const frames: Keyframe[] = [];
  if (result.ok) {
    const crux = Math.max(result.crux, 0.3);
    frames.push({ to: contactsOf(result.start), holds: [...result.start.limbs], limb: -1, duration: 0.6, strain: 0, move: -1 });
    let rested = false;
    result.moves.forEach((m, i) => {
      const strain = Math.min(1, m.difficulty / crux);
      if (!rested && strain >= 0.98 && m.limb < 2) {
        rested = true;
        const before = i === 0 ? result.start : result.moves[i - 1].to;
        const hand = restBefore(before, m.limb as 0 | 1, holds, day.wall);
        if (hand !== null)
          frames.push({ to: contactsOf(before), holds: [...before.limbs], limb: -1, duration: REST, strain: 0, move: -1, rest: hand });
      }
      // Hard moves are slower and more deliberate; dynos are quick. Easy moves stay
      // brisk so a daily test doesn't drag; the crux keeps its full weight.
      const base = m.limb >= 2 ? 0.42 : 0.55 + strain * 0.45;
      // Before a dyno the climber pumps: same holds, eyes on the target, hips sinking.
      if (m.dynamic && m.limb < 2) {
        const before = i === 0 ? result.start : result.moves[i - 1].to;
        frames.push({ to: contactsOf(before), holds: [...before.limbs], limb: -1, duration: WINDUP, strain: 0, move: -1, windup: true });
      }
      frames.push({
        to: contactsOf(m.to),
        holds: [...m.to.limbs],
        limb: m.limb,
        duration: m.dynamic ? 0.55 : base,
        dynamic: m.dynamic,
        strain,
        grade: moveGrade(m.difficulty),
        move: i,
      });
    });
    const tail = 1.6;
    return { frames, ending: 'top', total: frames.reduce((s, f) => s + f.duration, 0) + tail, tail };
  }
  if (!result.highPoint) return { frames: [], ending: 'shrug', total: 1.6, tail: 1.6 };
  const hp = contactsOf(result.highPoint);
  frames.push({ to: hp, holds: [...result.highPoint.limbs], limb: -1, duration: 0.8, strain: 0.6, move: -1 });
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
  const tail = 2.3;
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
  /** Gaze target per keyframe: the hold its moving limb lands on (see gazeFor). */
  gaze: (THREE.Vector3 | null)[];
  /** Pending arrival events (grab sound + chalk) keyed by sim time. */
  arrivals: { at: number; limb: number; hold: number; strain: number }[];
  /** Hold index under each hand (-1 = not gripping), for turning the mittens. */
  grip: [number, number];
  /** Flag direction per foot, fixed for the move so the free leg doesn't flip sides. */
  flagAway: [number, number];
  /** Heel hook / drop knee per foot for the current move. */
  legs: [FootTechnique, FootTechnique];
  /** Sidepull / gaston / undercling / press per hand for the current move. */
  arms: [ArmTechnique, ArmTechnique];
  /** A shake-out in progress: which hand, when it began, and the hold it goes back to. */
  rest: { hand: 0 | 1; t0: number; hold: number; at: THREE.Vector3; dipped: boolean } | null;
  /** Hip sink of a dyno's wind-up this step (see windupSink). */
  sink: number;
  /** Hip turn for the current reach (see hipTurn): + left hip in, - right hip in. */
  twist: number;
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
    arms?: [ArmTechnique, ArmTechnique],
    resting: 0 | 1 | null = null,
    sink = 0,
    twist = 0,
  ): THREE.Vector3[] => {
    const e = sim.ends;
    const hands: [THREE.Vector3, THREE.Vector3] = [sim.pos[J.handL].clone(), sim.pos[J.handR].clone()];
    const feet: [THREE.Vector3 | null, THREE.Vector3 | null] = [
      e[2].mode === 'free' ? null : sim.pos[J.footL].clone(),
      e[3].mode === 'free' ? null : sim.pos[J.footR].clone(),
    ];
    const mid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
    const lifting: [boolean, boolean] = [e[2].mode === 'moving', e[3].mode === 'moving'];
    return poseToArray(poseFrom(frames, hands, feet, Math.max(0, worldV(frames, mid) - 80), flagAway, legs, lifting, arms, resting, sink, twist));
  };

  const start = (pb: Playback): Run | null => {
    // Same list the solver indexed into, so chalk and hand direction hit the right holds.
    const tape = withSpots(day, pb.spots);
    const holds = contactList(tape.start, tape.finish, pb.holds, pb.volumes, day.wall);
    const timeline = buildTimeline(pb.result, day, holds);
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
    useClimb.setState({ move: -1, total: pb.result.ok ? pb.result.moves.length : 0, grade: null, peak: 0, label: 'Chalking up…', status: 'climbing' });
    const gaze = timeline.frames.map((f) => {
      const c = f.limb < 0 ? null : f.limb < 2 ? f.to.hands[f.limb] : f.to.feet[f.limb - 2];
      return c ? toWorld(c, 0) : null;
    });
    return { sim, timeline, holds, gaze, t: 0, acc: 0, frame: -1, ended: false, finished: false, limp: false, arrivals: [], lastThud: 0, flagAway: [0, 0], legs: [null, null], arms: [null, null], rest: null, sink: 0, twist: 0, grip: [timeline.frames[0].holds[0] ?? -1, timeline.frames[0].holds[1] ?? -1] };
  };

  /** Which way the fingers point on the hold a hand is gripping. */
  const gripDir = (r: Run, hand: 0 | 1): THREE.Vector3 | null => {
    const hold = r.holds[r.grip[hand]];
    if (!hold || r.grip[hand] < 0) return null;
    const face = frameAt(frames, hold.u, hold.v);
    const up = face.up;
    // Pressing: palm flat on top of the hold, fingers turned in toward the other hand
    // and back into the wall, so the heel of the hand is under the shoulder.
    if (r.arms[hand] === 'press') {
      const other = r.sim.pos[hand === 0 ? J.handR : J.handL];
      const inward = Math.sign(other.clone().sub(r.sim.pos[hand === 0 ? J.handL : J.handR]).dot(face.right)) || (hand === 0 ? 1 : -1);
      return face.right.clone().multiplyScalar(0.8 * inward).addScaledVector(face.normal, -0.6).normalize();
    }
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
    r.rest = null;
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
        const tech = handTechnique(hold, { u: (other.u + feet.u) / 2, v: (other.v + feet.v) / 2 });
        // A hold pulled down that's now down by the hips (a rockover, a hand-foot match, a
        // mantle) can't be hung from: the climber turns the hand over and presses down on
        // it. Only up to ~15° overhanging; steeper, the body hangs below it instead.
        const low = f.to.hands[i].v - feet.v < PRESS_ABOVE_FEET;
        if (!tech && low && on.length && hold.type !== 'pinch' && normalAt(f.to.hands[i]).y > -0.26) return 'press';
        return tech;
      }) as [ArmTechnique, ArmTechnique];
    }
    // A long static reach on vertical or steeper ground: turn that hip in to the wall.
    // Not off a hook or drop knee (the legs already set the hips), and not for a reach
    // into an undercling, gaston or press, which want the body square to the hold.
    const reaching = f.limb === 0 || f.limb === 1 ? f.limb : null;
    r.twist =
      reaching !== null && f.holds.length && !f.dynamic && !r.legs[0] && !r.legs[1] && (!r.arms[reaching] || r.arms[reaching] === 'sidepull')
        ? hipTurn(day.wall, f.to.hands, f.to.feet, reaching) * (reaching === 0 ? 1 : -1)
        : 0;
    const contacts: (Point | null)[] = [...f.to.hands, ...f.to.feet];
    contacts.forEach((c, n) => {
      const target = c ? toWorld(c, n < 2 ? 0.07 : 0.06) : null;
      const normal = c ? normalAt(c) : new THREE.Vector3(0, 0, 1);
      if (n === f.limb) sim.drive(n, target, normal, f.duration * 0.85, f.dynamic ? 0.14 : 0.07);
      else sim.drive(n, target, normal, 0.3, 0.05);
    });
    sim.tone = 1 - 0.45 * f.strain;
    if (f.rest !== undefined) {
      const hand = f.rest;
      r.rest = { hand, t0: r.t, hold: f.holds[hand], at: toWorld(f.to.hands[hand], 0.07), dipped: false };
      r.grip[hand] = -1;
      r.arms[hand] = null;
      useClimb.setState({ grade: null, label: 'Shaking out before the crux…' });
    }
    if (f.windup) useClimb.setState({ grade: null, label: 'Pumping for the dyno…' });
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
      const across = m >= 2 ? f.to.feet[3 - m] : null;
      const tech = !h ? null : m >= 2 ? r.legs[m - 2] : r.arms[m];
      useClimb.setState({
        move: f.move,
        grade: f.grade ?? null,
        peak: Math.max(useClimb.getState().peak, f.grade ?? 0),
        label: `${LIMB_NAME[m]} → ${what}${f.dynamic ? ' (dyno!)' : ''}${
          tech === 'heel'
            ? ' (heel hook)'
            : tech === 'toe'
              ? ' (toe hook)'
              : tech === 'drop-knee'
                ? ' (drop knee)'
                : tech === 'press'
                  ? h?.id.startsWith('lip:') ? ' (mantle)' : ' (press)'
                  : tech
                  ? ` (${tech})`
                  : m < 2 && Math.abs(r.twist) > 0.3
                  ? ' (hip turn)'
                  : foot && across && stemBonus(day.wall, [foot.u, across.u]) > 0
                  ? ' (stem)'
                  : h && foot && highStep(f.to.hands, foot) > 0.8
                  ? ' (high step)'
                  : ''
        }${f.strain >= 0.98 && m < 2 ? ' · crux' : ''}`,
      });
    }
  };

  /**
   * Drive a resting hand along its shake-out: down beside the hip, arm hanging, shaking
   * the pump out; into the chalk bag behind the hips; then back up to the same hold.
   */
  const shakeOut = (r: Run) => {
    const rest = r.rest!;
    const { sim } = r;
    const k = ((r.t - rest.t0) * SHAKE_SCRIPT) / REST;
    const side = rest.hand === 0 ? -1 : 1;
    const hip = sim.pos[J.pelvis];
    const up = sim.pos[J.chest].clone().sub(hip).normalize();
    const right = sim.pos[J.shoulderR].clone().sub(sim.pos[J.shoulderL]).normalize();
    // Away from the wall (the body faces it).
    const away = V().crossVectors(right, up).normalize();
    const shake = hip.clone().addScaledVector(up, 0.1).addScaledVector(right, side * 0.24).addScaledVector(away, 0.16);
    const bag = hip.clone().addScaledVector(up, 0.02).addScaledVector(right, side * 0.05).addScaledVector(away, 0.2);
    const ease = (a: number, b: number) => {
      const x = Math.max(0, Math.min(1, (k - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    let to: THREE.Vector3;
    if (k < 0.4) to = rest.at.clone().lerp(shake, ease(0, 0.4));
    else if (k < 1.15) {
      // A loose flick of the wrist, dying away.
      const w = Math.sin((k - 0.4) * Math.PI * 2 * 5.5) * (1 - (k - 0.4) / 0.9);
      to = shake.addScaledVector(right, side * 0.04 * w).addScaledVector(up, 0.02 * w);
    } else if (k < 1.45) to = shake.lerp(bag, ease(1.15, 1.45));
    else if (k < 1.7) {
      to = bag.addScaledVector(up, 0.025 * Math.sin((k - 1.45) * Math.PI * 2 * 4));
      if (!rest.dipped) {
        rest.dipped = true;
        puff(bag, up, 5, 0.3);
        useClimb.setState({ label: 'Chalking up…' });
      }
    } else {
      // Back up to the hold, the hand arcing out from the wall rather than dragging up it.
      const x = ease(1.7, SHAKE_SCRIPT * 0.95);
      to = bag.lerp(rest.at, x).addScaledVector(away, Math.sin(Math.PI * x) * 0.08);
      if (x >= 1 && r.grip[rest.hand] < 0) {
        r.grip[rest.hand] = rest.hold;
        sfx.grab(0.2);
        const hold = r.holds[rest.hold];
        if (hold) chalkHold(hold.id);
      }
    }
    const end = sim.ends[rest.hand];
    end.mode = 'pinned';
    end.to.copy(to);
  };

  /**
   * Where the eyes are. Climbers spot a hold before they move to it and watch the limb
   * onto it: a hand until it's nearly there, a foot right until it's placed (precise
   * footwork is done by eye). Then the eyes move on to the next hold while the limb
   * settles. During a shake-out they read the crux; standing on the start they look at
   * the first move; on the last move they look at the finish.
   */
  const gazeFor = (r: Run, inFrame: number): THREE.Vector3 | null => {
    const { frames: fs, ending } = r.timeline;
    if (r.limp) return null;
    if (r.ended) return ending === 'top' ? toWorld(day.finish, 0) : null;
    const i = Math.max(0, r.frame);
    const f = fs[i];
    const ahead = () => {
      for (let j = i + 1; j < fs.length; j++) if (r.gaze[j]) return r.gaze[j];
      return ending === 'top' || ending === 'fall' ? toWorld(day.finish, 0) : null;
    };
    if (f.limb < 0 || !r.gaze[i]) return ahead();
    const watch = f.dynamic ? 0.95 : f.limb >= 2 ? 0.85 : 0.65;
    return inFrame / f.duration < watch ? r.gaze[i] : ahead();
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
    r.acc += Math.min(dt, 0.05) * (slow ? 0.55 : 1) * usePlaySpeed.getState().speed;
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
        } else {
          sfx.foot();
          if (hold) rubberHold(hold.id);
        }
      }
      if (r.rest) shakeOut(r);
      const wind = idx >= 0 && timeline.frames[idx].windup;
      r.sink = wind ? windupSink(Math.min(1, t / timeline.frames[idx].duration)) : 0;
      sim.step(STEP, r.limp ? null : postureFor(sim, r.flagAway, r.legs, r.arms, r.rest?.hand ?? null, r.sink, r.twist));
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
    let inFrame = r.t;
    for (let i = 0; i < r.frame; i++) inFrame -= timeline.frames[i].duration;
    pose.look = gazeFor(r, inFrame);
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
const STRAIGHT = new THREE.Quaternion();
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
  /** The head's gaze turn, eased toward its target so the eyes don't snap between holds. */
  const gaze = useMemo(() => ({ q: new THREE.Quaternion(), want: new THREE.Quaternion(), dir: V(), last: 0 }), []);

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
        // Turn the head toward what the climber is looking at, within the neck's range
        // (~70°), and lean it a little that way so the glance reads from behind too.
        const want = gaze.want.identity();
        const d = gaze.dir.set(0, 0, 0);
        if (p.look) {
          d.copy(p.look).sub(p.head);
          if (d.lengthSq() > 1e-6) {
            d.normalize();
            const angle = Math.acos(Math.max(-1, Math.min(1, d.dot(fwd))));
            want.setFromUnitVectors(fwd, d);
            if (angle > 1.2) want.slerp(STRAIGHT, 1 - 1.2 / angle);
          }
        }
        const now = performance.now() / 1000;
        const dt = Math.min(0.1, Math.max(0, now - gaze.last));
        gaze.last = now;
        gaze.q.slerp(want, 1 - Math.exp(-dt * 7));
        orient(head.current, up, fwd);
        head.current.quaternion.premultiply(gaze.q);
        // Lean: the turned face direction, minus its component into the wall.
        const face = gaze.dir.copy(fwd).applyQuaternion(gaze.q);
        face.addScaledVector(fwd, -face.dot(fwd));
        head.current.position.copy(p.head).addScaledVector(face, 0.05);
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
