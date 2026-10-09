// A faceless low-poly climber. The solver's beta drives where hands and feet go;
// the body in between is a Verlet ragdoll (see ragdoll.ts), pulled toward an
// IK-posed skeleton by soft "muscles", so it hangs, sways, swings and falls.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { withSpots } from '../game/spots';
import { bestPull, flagFor, footTechnique, handTechnique, highStep, hipTurn, mantleable, mantleStep, stemBonus, type FootTechnique, type HandTechnique } from '../solver/model';
import type { Day, Hold, Point, Wall } from '../solver/types';
import { contactList, surfaceAt } from '../solver/volumes';
import { chalkHold, climberFocus, rubberHold, useClimb, usePlaySpeed } from '../state/climb';
import { useGame, type Playback } from '../state/store';
import { puff } from './Chalk';
import { ARM, LEG, TORSO, V, ik, type Pose } from './pose';
import { J, JOINTS, Ragdoll } from './ragdoll';
import { buildTimeline, CRUX_SLOWMO, SEND, SHAKE_SCRIPT, REST, windupSink, type Keyframe, type Timeline } from './timeline';
import { STANDING_AT, standHip, topoutPose, type Lip } from './topout';
import { frameAt, lipAt, nearestFrame, padBox, panelFrames, uvToWorld, worldV, type PanelFrame } from './wallGeometry';

const PAD_TOP = 0.3;
/** A hand on a hold less than this far (cm) above the feet is down by the hips: it presses. */
const PRESS_ABOVE_FEET = 60;

/** The solver's hand techniques, plus a press: palm down on a hold at waist height (a mantle). */
type ArmTechnique = HandTechnique | 'press';

/** Where each limb sits (cm across, LH RH LF RF) on a mantle shelf it shares with another. */
const SHELF_SPREAD = [-11, 11, -24, 24];
/**
 * How fast a free leg swings between an outside flag (-1/+1 on its own side) and a back flag
 * (the other side), in that unit per second: the whole swing takes ~0.5 s, so the leg sweeps
 * across behind the standing leg during the reach instead of jumping there in one frame.
 */
const FLAG_SWING = 4;

/**
 * The solver's foot techniques, plus a mantle: the foot up on the shelf the hands press out
 * ('mantle'), then stood on it while a hand reaches up off it ('shelf').
 */
type LegTechnique = FootTechnique | 'mantle' | 'shelf';

/** How much further out (m) a hand or shoe sits on a macro: on its dome or shelf, ~8-10 cm proud. */
const MACRO_OUT = 0.035;
const MACRO_WORD: Partial<Record<Hold['type'], string>> = { sloper: 'macro sloper', edge: 'ledge', pinch: 'pinch block' };

/** Build a full-body pose from 3D contact points (feet may be null = dangling). */
function poseFrom(
  frames: PanelFrame[],
  hands: [THREE.Vector3, THREE.Vector3],
  feet: [THREE.Vector3 | null, THREE.Vector3 | null],
  _hipV: number,
  /**
   * Which way (-1 left, +1 right on screen) each free leg flags; decided once per move and
   * eased in between (see FLAG_SWING), so a value in between is a leg partway across.
   */
  flagAway?: [number, number],
  /** Heel/toe hook or drop knee per foot (see footTechnique), decided once per move. */
  legs: [LegTechnique, LegTechnique] = [null, null],
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
  // Stood up on a mantle shelf, a hand reaching up off it: the body stands over the feet
  // (as on the deck after the topout, see topout.ts stand), as tall as the reach needs, bent
  // at the hips toward the wall while the other palm still presses the shelf.
  const stood = legs.includes('shelf') && on.length > 0;
  const above = Math.max(holding[0].y, holding[1].y) - feetMid.y;
  const chest = stood
    ? feetMid.clone().add(V(0, Math.max(0.6, Math.min(1.25, above - 0.55)), 0)).addScaledVector(normal, 0.2)
    : handsMid
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
  const torsoDir = stood
    ? V(0, 1, 0).addScaledVector(normal, -0.35).normalize()
    : bodyDir.clone().addScaledVector(normal, hipsIn - 0.7 * lean - 0.35 * load).normalize();
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
    const away = flagAway?.[i] ?? side;
    // 0 = an outside flag, 1 = a back flag, smoothstepped while the leg swings across.
    const across = Math.min(1, Math.max(0, (1 - away * side) / 2));
    const back = across * across * (3 - 2 * across);
    if (!target && other) {
      // Flag: the free leg presses on the wall as a counterweight (see flagFor). An outside
      // flag reaches long and nearly straight out on its own side; a back flag crosses
      // behind the standing leg to a spot on the wall beyond and below that foot.
      const outside = pelvis[i].clone().addScaledVector(lateral, side * 0.55).addScaledVector(torsoDir, -0.6);
      const behind = other.clone().addScaledVector(lateral, -side * 0.3).addScaledVector(torsoDir, -0.22);
      target = outside.lerp(behind, back);
      // Pressed against the wall, level with the standing foot.
      target.addScaledVector(normal, other.clone().sub(target).dot(normal) + 0.04);
    }
    const flag = !feet[i] && !!other;
    // No feet on at all (campus): tucked up, knee bent, clear of the mat.
    target ??= pelvis[i].clone().add(V(side * 0.16, -0.5, 0)).addScaledVector(normal, 0.22);
    // Knees out, frog-style, by default. A heel hook cocks the knee up and out to the side;
    // a toe hook reaches the leg out long, knee up, so the shin can pull the toe back; a
    // drop knee turns it in and down toward the other foot. In a hip turn the turned-in
    // leg backsteps: the knee swings across toward the other leg so the outside edge of
    // the shoe bites, while the other knee opens out.
    const backstep = twist * -side;
    const pole = flag
      ? // Out on its own side the knee points up the wall; crossing behind, it comes out from
        // the wall, past the standing leg.
        normal
          .clone()
          .addScaledVector(torsoDir, 0.5 * (1 - back) - 0.2 * back)
          .addScaledVector(lateral, -side * 0.4 * back)
      : legs[i] === 'mantle'
        ? // Rocking over onto the shelf (the topout's rockover): the knee comes up by the chest
          // and out from the wall, over the foot, so the hips can come up onto it.
          torsoDir.clone().multiplyScalar(0.8).addScaledVector(normal, 0.6).addScaledVector(lateral, side * 0.3)
        : legs[i] === 'heel'
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

type Celebrate = 'drop' | 'cheer' | 'clap' | 'shrug';

/**
 * A free-standing body for the drop off the top and what follows: built around the
 * pelvis at `hip`, facing `face` (horizontal), sunk into a squat by `squat` 0..1.
 */
function dropPose(hip: THREE.Vector3, face: THREE.Vector3, squat: number, arms: Celebrate, k = 0): Pose {
  const up = V(0, 1, 0);
  const right = face.clone().cross(up).normalize();
  const chest = hip.clone().addScaledVector(up, 0.5 - 0.06 * squat).addScaledVector(face, 0.12 * squat);
  const shrug = arms === 'shrug' ? 0.05 * k : 0;
  const shoulders = [-1, 1].map((sd) => chest.clone().addScaledVector(right, sd * 0.19).addScaledVector(up, shrug)) as [THREE.Vector3, THREE.Vector3];
  const head = chest.clone().addScaledVector(up, 0.21 - shrug * 0.6).addScaledVector(face, 0.03 * squat);
  const pelvis = [-1, 1].map((sd) => hip.clone().addScaledVector(right, sd * 0.1)) as [THREE.Vector3, THREE.Vector3];
  const legs = [-1, 1].map((sd, i) => {
    const foot = hip.clone().addScaledVector(up, -0.84 + 0.38 * squat).addScaledVector(right, sd * (0.14 + 0.05 * squat));
    return ik(pelvis[i], foot, LEG, face.clone().addScaledVector(right, sd * 0.3));
  });
  const armsOut = [-1, 1].map((sd, i) => {
    const sh = shoulders[i];
    let hand: THREE.Vector3;
    if (arms === 'drop') hand = sh.clone().addScaledVector(up, 0.5).addScaledVector(right, sd * 0.12);
    else if (arms === 'cheer') hand = sh.clone().addScaledVector(up, 0.52 * k - 0.5 * (1 - k)).addScaledVector(right, sd * (0.24 * k + 0.04)).addScaledVector(face, 0.05);
    else if (arms === 'clap') {
      // Hands meet overhead and part again: k 0 apart, 1 together.
      hand = chest.clone().addScaledVector(up, 0.72).addScaledVector(face, 0.1).addScaledVector(right, sd * (0.03 + 0.25 * (1 - k)));
    } else hand = sh.clone().addScaledVector(up, -0.5 + 0.22 * k).addScaledVector(right, sd * (0.08 + 0.22 * k)).addScaledVector(face, 0.22 * k);
    return ik(sh, hand, ARM, arms === 'shrug' ? up.clone().multiplyScalar(-1).addScaledVector(right, sd) : right.clone().multiplyScalar(sd).addScaledVector(face, -0.3));
  });
  return {
    hip: hip.clone(),
    chest,
    head,
    shoulders,
    elbows: [armsOut[0].joint, armsOut[1].joint],
    hands: [armsOut[0].end, armsOut[1].end],
    pelvis,
    knees: [legs[0].joint, legs[1].joint],
    feet: [legs[0].end, legs[1].end],
  };
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
  arrivals: { at: number; limb: number; hold: number; strain: number; move: number; grade: number | null }[];
  /** Hold index under each hand (-1 = not gripping), for turning the mittens. */
  grip: [number, number];
  /** Flag direction per foot, fixed for the move so the free leg doesn't flip sides. */
  flagAway: [number, number];
  /** Where each free leg actually is between its two flags, easing toward flagAway (see FLAG_SWING). */
  flagSwing: [number, number];
  /** Heel hook / drop knee per foot for the current move. */
  legs: [LegTechnique, LegTechnique];
  /** Sidepull / gaston / undercling / press per hand for the current move. */
  arms: [ArmTechnique, ArmTechnique];
  /** A shake-out in progress: which hand, when it began, and the hold it goes back to. */
  rest: { hand: 0 | 1; t0: number; hold: number; at: THREE.Vector3; dipped: boolean } | null;
  /** Hip sink of a dyno's wind-up this step (see windupSink). */
  sink: number;
  /** The moving limb's drive, held back until its wind-up is over (see Keyframe.prep). */
  launch: { at: number; n: number; to: THREE.Vector3; normal: THREE.Vector3; duration: number; lift: number } | null;
  /** The limb winding up to move, while it does (feet: the hips shift off it first). */
  winding: number;
  /** Hip turn for the current reach (see hipTurn): + left hip in, - right hip in. */
  twist: number;
  lastThud: number;
  /** The top-out after a send or near miss (see topOut). */
  out: { t0: number; released: boolean; landed: number; face: THREE.Vector3; turned: number; claps: number; floor: number; mantle: { from: Pose; lip: Lip } | null } | null;
}

export function Climber({ day }: { day: Day }) {
  const playback = useGame((s) => s.playback);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const run = useRef<(Run & { id: number }) | null>(null);
  const idle = useRef({ t: 0, dipped: false });
  const shrug = useRef(0);
  const rig = useRef<RigHandle>(null);

  const volumes = playback?.volumes ?? [];
  const macros = (playback?.holds ?? []).filter((h) => h.size === 'xl');
  /** A contact point in the world, standing out by any volume's surface there (and a macro's bulk). */
  const toWorld = (p: Point, out: number) => {
    const f = frameAt(frames, p.u, p.v);
    const macro = macros.some((h) => Math.abs(h.u - p.u) < 1 && Math.abs(h.v - p.v) < 1) ? MACRO_OUT : 0;
    const relief = (surfaceAt(volumes, p.u, p.v)?.height ?? 0) / 100 + macro;
    return uvToWorld(day.wall, frames, p.u, p.v).addScaledVector(f.normal, out + relief);
  };
  const normalAt = (p: Point) => frameAt(frames, p.u, p.v).normal;

  /** Posed skeleton for the ends' current positions (the "muscle" targets). */
  const postureFor = (
    sim: Ragdoll,
    flagAway?: [number, number],
    legs?: [LegTechnique, LegTechnique],
    arms?: [ArmTechnique, ArmTechnique],
    resting: 0 | 1 | null = null,
    sink = 0,
    twist = 0,
    /** A foot about to move (2/3): the weight comes off it before it lifts. */
    winding = -1,
  ): THREE.Vector3[] => {
    const e = sim.ends;
    const hands: [THREE.Vector3, THREE.Vector3] = [sim.pos[J.handL].clone(), sim.pos[J.handR].clone()];
    const feet: [THREE.Vector3 | null, THREE.Vector3 | null] = [
      e[2].mode === 'free' ? null : sim.pos[J.footL].clone(),
      e[3].mode === 'free' ? null : sim.pos[J.footR].clone(),
    ];
    const mid = hands[0].clone().add(hands[1]).multiplyScalar(0.5);
    const lifting: [boolean, boolean] = [e[2].mode === 'moving' || winding === 2, e[3].mode === 'moving' || winding === 3];
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
    climberFocus.top = false;
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
    useClimb.setState({ move: -1, landed: -1, total: pb.result.ok ? pb.result.moves.length : 0, grade: null, peak: 0, label: 'Chalking up…', status: 'climbing' });
    const gaze = timeline.frames.map((f) => {
      const c = f.limb < 0 ? null : f.limb < 2 ? f.to.hands[f.limb] : f.to.feet[f.limb - 2];
      return c ? toWorld(c, 0) : null;
    });
    return { sim, timeline, holds, gaze, t: 0, acc: 0, frame: -1, ended: false, finished: false, limp: false, arrivals: [], lastThud: 0, out: null, flagAway: [0, 0], flagSwing: [-1, 1], legs: [null, null], arms: [null, null], rest: null, sink: 0, twist: 0, launch: null, winding: -1, grip: [timeline.frames[0].holds[0] ?? -1, timeline.frames[0].holds[1] ?? -1] };
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
    r.launch = null;
    r.winding = f.prep ? f.limb : -1;
    // Decide which way a free leg flags: toward the reach (see flagFor). Between reaches a
    // flag stays where it is rather than swinging the leg over.
    const reaching = f.limb === 0 || f.limb === 1 ? f.limb : null;
    const flags = ([0, 1] as const).map((i) => flagFor(day.wall, f.to.hands, f.to.feet, i, reaching));
    r.flagAway = flags.map((fl, i) => (!fl ? 0 : reaching === null && r.flagAway[i] ? r.flagAway[i] : fl.side)) as [number, number];
    const backFlag = reaching !== null ? flags.find((fl) => fl?.kind === 'back') : undefined;
    if (f.holds.length) {
      r.grip = [f.holds[0], f.holds[1]];
      // A mantle: a foot up on the shelf the hands are on, beside them (as the solver sees it).
      const shelf = [0, 1].map((i) => !!r.holds[f.holds[i]] && mantleable(r.holds[f.holds[i]], day.wall)) as [boolean, boolean];
      r.legs = [0, 1].map((i) => {
        const foot = f.to.feet[i];
        const hold = r.holds[f.holds[2 + i]];
        if (!foot || !hold) return null;
        // Only while both hands are still down on the shelf: once one reaches up off it the
        // climber is standing up on that foot.
        const up = Math.max(f.to.hands[0].v, f.to.hands[1].v) - foot.v < 45;
        if (mantleable(hold, day.wall) && mantleStep(f.to.hands, shelf, foot)) return up ? 'mantle' : 'shelf';
        return footTechnique(day.wall, f.to.hands, foot);
      }) as [LegTechnique, LegTechnique];
      const mantling = r.legs.includes('mantle');
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
        // Mantling, both palms push down on the shelf, whatever the rest of the body is doing.
        if (mantling && shelf[i]) return 'press';
        const low = f.to.hands[i].v - feet.v < PRESS_ABOVE_FEET;
        if (!tech && low && on.length && hold.type !== 'pinch' && normalAt(f.to.hands[i]).y > -0.26) return 'press';
        return tech;
      }) as [ArmTechnique, ArmTechnique];
    }
    // A long static reach on vertical or steeper ground: turn that hip in to the wall.
    // Not off a hook or drop knee (the legs already set the hips), and not for a reach
    // into an undercling, gaston or press, which want the body square to the hold. A back
    // flag turns the reaching hip in too, the standing foot on its outside edge.
    r.twist =
      reaching !== null && f.holds.length && !f.dynamic && !r.legs[0] && !r.legs[1] && (!r.arms[reaching] || r.arms[reaching] === 'sidepull')
        ? (backFlag?.turn ?? hipTurn(day.wall, f.to.hands, f.to.feet, reaching)) * (reaching === 0 ? 1 : -1)
        : 0;
    // Limbs sharing a mantle shelf spread out along it, palms either side of the middle and
    // the feet outside them, instead of all piling onto the one point the solver gives it.
    const contacts: (Point | null)[] = [...f.to.hands, ...f.to.feet].map((c, n) => {
      const hold = r.holds[f.holds[n]];
      if (!c || !hold || f.holds.filter((h) => h === f.holds[n]).length < 2 || !mantleable(hold, day.wall)) return c;
      return { u: c.u + SHELF_SPREAD[n], v: c.v };
    });
    contacts.forEach((c, n) => {
      const target = c ? toWorld(c, n < 2 ? 0.07 : 0.06) : null;
      const normal = c ? normalAt(c) : new THREE.Vector3(0, 0, 1);
      // The moving limb waits out its wind-up on its hold, then travels; the rest of the
      // keyframe is the settle as the weight comes onto it.
      if (n === f.limb && target && f.prep) r.launch = { at: r.t + f.prep, n, to: target, normal, duration: f.travel ?? f.duration * 0.85, lift: f.dynamic ? 0.14 : 0.07 };
      else if (n === f.limb) sim.drive(n, target, normal, f.travel ?? f.duration * 0.85, f.dynamic ? 0.14 : 0.07);
      else sim.drive(n, target, normal, 0.3, 0.05);
    });
    sim.tone = 1 - 0.45 * f.strain;
    if (f.rest !== undefined) {
      const hand = f.rest;
      r.rest = { hand, t0: r.t, hold: f.holds[hand], at: toWorld(f.to.hands[hand], 0.07), dipped: false };
      r.grip[hand] = -1;
      r.arms[hand] = null;
      // The meter keeps the last move's grade: only the words change between moves.
      useClimb.setState({ label: 'Shaking out before the crux…' });
    }
    if (f.windup) useClimb.setState({ label: 'Pumping for the dyno…' });
    if (f.limb >= 0 && f.holds.length)
      r.arrivals.push({ at: r.t + (f.prep ?? 0) + (f.travel ?? f.duration * 0.85), limb: f.limb, hold: f.holds[f.limb], strain: f.strain, move: f.move, grade: f.grade ?? null });
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
      const what = h ? (h.id.startsWith('arete:') ? 'arête' : h.id.startsWith('lip:') ? 'lip' : h.size === 'xl' ? (MACRO_WORD[h.type] ?? h.type) : h.type) : hold === -1 ? 'smear' : 'off';
      const foot = m >= 2 ? f.to.feet[m - 2] : null;
      const across = m >= 2 ? f.to.feet[3 - m] : null;
      const tech = !h ? null : m >= 2 ? r.legs[m - 2] : r.arms[m];
      const flagged = r.flagAway.findIndex((a) => a !== 0);
      // As the move winds up the ticker says what's coming; its grade, the meter and its
      // tag on the wall wait for the landing (see arrivals), one beat at a time.
      useClimb.setState({
        move: f.move,
        label: `${LIMB_NAME[m]} → ${what}${f.dynamic ? ' (dyno!)' : ''}${
          tech === 'heel'
            ? ' (heel hook)'
            : tech === 'mantle' || tech === 'shelf'
              ? ' (mantle)'
            : tech === 'toe'
              ? ' (toe hook)'
              : tech === 'drop-knee'
                ? ' (drop knee)'
                : tech === 'press'
                  ? h?.id.startsWith('lip:') ? ' (mantle)' : ' (press)'
                  : tech
                  ? ` (${tech})`
                  : m < 2 && !f.dynamic && flagged >= 0
                  ? r.flagAway[flagged] === (flagged === 0 ? -1 : 1) ? ' (flag)' : ' (back flag)'
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
    if (r.ended && ending === 'top' && r.out) {
      const out = r.out;
      const k = r.t - out.t0;
      // Hold the finish, then look down at the landing; once down, face the room, or
      // glance back up at the route that didn't come out on the brief.
      if (k < SEND.hold) return toWorld(day.finish, 0);
      if (out.mantle) {
        // Eyes over the lip onto the deck, then out at the room (or back down at the finish).
        const { lip, back } = out.mantle.lip;
        const s = k - SEND.hold;
        if (s < STANDING_AT - 0.4) return lip.clone().addScaledVector(back, 0.6);
        const hip = standHip(out.mantle.lip);
        if (!r.timeline.send && s - STANDING_AT + SEND.cheer > SEND.cheer - 0.1) return toWorld(day.finish, 0);
        return hip.addScaledVector(back, -3).setY(hip.y + (r.timeline.send ? 1.2 : 0.7));
      }
      const hip = r.sim.pos[J.pelvis];
      if (out.landed < 0) return hip.clone().addScaledVector(out.face, -0.9).setY(pad.top);
      const t = r.t - out.landed;
      if (t < SEND.turn) return hip.clone().addScaledVector(out.face, -1).setY(pad.top);
      if (!r.timeline.send && t > SEND.cheer - 0.1) return toWorld(day.finish, 0);
      return hip.clone().addScaledVector(out.face, -3).setY(hip.y + (r.timeline.send && t > SEND.cheer ? 1.2 : 0.7));
    }
    if (r.ended) return ending === 'top' ? toWorld(day.finish, 0) : null;
    const i = Math.max(0, r.frame);
    const f = fs[i];
    const ahead = () => {
      for (let j = i + 1; j < fs.length; j++) if (r.gaze[j]) return r.gaze[j];
      return ending === 'top' || ending === 'fall' ? toWorld(day.finish, 0) : null;
    };
    if (f.limb < 0 || !r.gaze[i]) return ahead();
    // Eyes stay on the hold through the wind-up and most of the reach (a foot right onto
    // it), then move on while the limb settles.
    const until = (f.prep ?? 0) + (f.travel ?? f.duration * 0.85) * (f.dynamic || f.limb >= 2 ? 1 : 0.75);
    return inFrame < until ? r.gaze[i] : ahead();
  };

  const endRun = (r: Run) => {
    const { sim, timeline } = r;
    if (timeline.ending === 'top') {
      // Matched the finish. Hold it a beat, then mantle over the top, or (a finish well
      // below the top) look down and drop off (see topOut).
      const n = frameAt(frames, day.finish.u, day.finish.v).normal;
      const face = V(-n.x, 0, -n.z);
      if (face.lengthSq() < 0.01) face.set(0, 0, -1);
      r.out = { t0: r.t, released: false, landed: -1, face: face.normalize(), turned: 0, claps: 0, floor: 0, mantle: null };
      sim.tone = 1;
      puff(toWorld(day.finish, 0.05), n, timeline.send ? 24 : 10, 0.7);
      if (timeline.send) sfx.topout();
      useClimb.setState({ status: 'topped', label: timeline.send ? 'Topped out!' : 'Topped out… off the brief' });
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

  const pad = useMemo(() => padBox(day.wall), [day.wall]);
  /** Height of whatever is underfoot at (x, z): the pad, or the floor beside it. */
  const groundAt = (x: number, z: number) =>
    Math.abs(x) < pad.width / 2 && z > pad.minZ && z < pad.maxZ ? pad.top : 0;

  /**
   * After the match: hold the finish, look down at the pad, let go and drop, land in a
   * squat and stand, turn round to the room, then celebrate a send (arms up, two claps)
   * or, topped out off the brief, glance back up at the route and shrug. Returns the
   * posture to hold, or null to keep climbing posture (still on the finish).
   */
  const topOut = (r: Run): THREE.Vector3[] | null => {
    const out = r.out!;
    const { sim } = r;
    const k = r.t - out.t0;
    const ease = (a: number, b: number) => {
      const x = Math.max(0, Math.min(1, (k - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    if (r.timeline.over) {
      if (k < SEND.hold) return null;
      if (!out.mantle) {
        // Off the finish and over the lip: choreography from here, not physics.
        out.mantle = { from: arrayToPose(sim.pos.map((p) => p.clone())), lip: lipAt(day.wall, frames, day.finish.u) };
        r.grip = [-1, -1];
        climberFocus.top = true;
        useClimb.setState({ label: 'Mantling over the top' });
      }
      const s = k - SEND.hold;
      if (s < STANDING_AT) return poseToArray(topoutPose(out.mantle.lip, out.mantle.from, s));
      // Standing on top facing the room: celebrate as if just turned round after a drop.
      const t = s - STANDING_AT + SEND.cheer;
      const { arms, ak } = celebrate(r, t);
      return poseToArray(dropPose(standHip(out.mantle.lip), out.mantle.lip.back.clone().negate(), 0, arms, ak));
    }
    if (!out.released) {
      if (k < SEND.release) return null;
      out.released = true;
      sim.ends.forEach((e) => (e.mode = 'free'));
      r.grip = [-1, -1];
      sim.tone = 0.7;
      sim.drag = 0.998;
      // A little push off the wall so the body drops clear of it instead of scraping down.
      sim.impulse(out.face.clone().multiplyScalar(-0.7).add(V(0, 0.5, 0)), STEP);
      sfx.whoosh();
      useClimb.setState({ label: 'Dropping off…' });
    }
    const hip = sim.pos[J.pelvis];
    if (out.landed < 0) {
      const lowest = Math.min(...[J.footL, J.footR].map((j) => sim.pos[j].y - groundAt(sim.pos[j].x, sim.pos[j].z)));
      const falling = sim.pos[J.pelvis].y - sim.prev[J.pelvis].y < 0;
      if (lowest > 0.07 || !falling) return poseToArray(dropPose(hip, out.face, 0.25, 'drop'));
      // Touchdown: plant the feet under the hips and soak it up.
      out.landed = r.t;
      out.floor = groundAt(hip.x, hip.z);
      sim.drag = null;
      sim.tone = 1;
      const right = out.face.clone().cross(V(0, 1, 0)).normalize();
      [2, 3].forEach((n) => {
        const sd = n === 2 ? -1 : 1;
        const at = hip.clone().addScaledVector(right, sd * 0.15).setY(out.floor + 0.02);
        sim.drive(n, at, V(0, 1, 0), 0.08, 0);
      });
    }
    const t = r.t - out.landed;
    // Stand back up out of the landing squat, stepping a little away from the wall.
    const squat = t < 0.08 ? t / 0.08 : 1 - ease(out.landed - out.t0 + 0.08, out.landed - out.t0 + SEND.absorb);
    // Turn round to face the room, stepping the feet round.
    const turnK = ease(out.landed - out.t0 + SEND.turn, out.landed - out.t0 + SEND.turn + SEND.turnFor);
    const angle = Math.PI * turnK;
    const face = out.face.clone().applyAxisAngle(V(0, 1, 0), angle);
    const stand = V(hip.x, out.floor + 0.86 - 0.36 * squat, hip.z);
    if (t >= SEND.turn && out.turned === 0) {
      out.turned = 1;
      const end = out.face.clone().applyAxisAngle(V(0, 1, 0), Math.PI);
      const right = end.clone().cross(V(0, 1, 0)).normalize();
      // Each foot arcs its own way round (one forward, one back): a pivot, not a shuffle through.
      [2, 3].forEach((n) => {
        const sd = n === 2 ? -1 : 1;
        const at = stand.clone().addScaledVector(right, sd * 0.14).addScaledVector(end, 0.08).setY(out.floor + 0.02);
        sim.drive(n, at, out.face.clone().multiplyScalar(sd).add(V(0, 0.6, 0)).normalize(), SEND.turnFor, 0.07);
      });
    }
    const { arms, ak } = celebrate(r, t);
    return poseToArray(dropPose(stand, face, squat, arms, ak));
  };
  /**
   * Standing and facing the room, `t` seconds after landing (or the equivalent after a
   * mantle): a send gets arms up and two claps, a near miss a shrug back at the route.
   * Plays the sounds and ticker, and ends the climb when it's done.
   */
  const celebrate = (r: Run, t: number): { arms: Celebrate; ak: number } => {
    const out = r.out!;
    const { sim } = r;
    const easeT = (a: number, b: number) => {
      const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    const send = r.timeline.send;
    let arms: Celebrate = 'cheer';
    let ak = 0;
    const c0 = SEND.cheer;
    if (send) {
      if (t >= c0) {
        ak = Math.min(1, (t - c0) / 0.2);
        ak = ak * ak * (3 - 2 * ak);
      }
      if (t >= SEND.claps[0] - 0.15) {
        arms = 'clap';
        ak = Math.max(...SEND.claps.map((c) => Math.exp(-(((t - c) / 0.07) ** 2))));
      }
      // Then the arms come down and the climber stands there, pleased.
      if (t >= SEND.end - 0.25) {
        arms = 'cheer';
        ak = 1 - easeT(SEND.end - 0.25, SEND.end + 0.35);
      }
      if (out.claps < SEND.claps.length && t >= SEND.claps[out.claps]) {
        out.claps++;
        sfx.clap();
        const mid = sim.pos[J.handL].clone().add(sim.pos[J.handR]).multiplyScalar(0.5);
        puff(mid, V(0, 1, 0), 8, 0.6);
        if (out.claps === 1) useClimb.setState({ label: 'Sent it!' });
      }
    } else if (t >= c0) {
      arms = 'shrug';
      ak = Math.sin(Math.min(1, (t - c0) / 0.75) * Math.PI);
      if (out.claps === 0) {
        out.claps = 1;
        sfx.shrug();
        useClimb.setState({ label: 'Topped out, but off the brief' });
      }
    }
    if (!r.finished && t >= (send ? SEND.end : SEND.shrugEnd)) {
      r.finished = true;
      useClimb.setState({ status: 'idle' });
      useGame.getState().climbFinished();
    }
    return { arms, ak };
  };
  useFrame((_, dt) => {
    if (!rig.current) return;
    if (!playback) {
      run.current = null;
      climberFocus.active = false;
      climberFocus.hold = false;
      climberFocus.top = false;
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
    r.acc += Math.min(dt, 0.05) * (slow ? CRUX_SLOWMO : 1) * usePlaySpeed.getState().speed;
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
        if (a.move >= 0) useClimb.setState({ landed: a.move, grade: a.grade, peak: Math.max(useClimb.getState().peak, a.grade ?? 0) });
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
      if (r.launch && r.t >= r.launch.at) {
        const l = r.launch;
        r.launch = null;
        r.winding = -1;
        sim.drive(l.n, l.to, l.normal, l.duration, l.lift);
      }
      const outPose = r.out ? topOut(r) : null;
      const kf = idx >= 0 ? timeline.frames[idx] : null;
      // A hand's wind-up: the hips dip and drive back up as the hand leaves, so the reach
      // starts from the legs instead of the arm snapping off on its own.
      r.sink = kf?.windup
        ? windupSink(Math.min(1, t / kf.duration))
        : kf && kf.prep && kf.limb < 2 && t < kf.prep
          ? 0.3 * Math.sin((Math.PI * t) / kf.prep)
          : 0;
      if (r.out?.mantle && outPose) {
        // The mantle is posed outright: the body goes where the choreography says.
        outPose.forEach((p, i) => (sim.pos[i].copy(p), sim.prev[i].copy(p)));
        continue;
      }
      r.flagSwing = r.flagSwing.map((a, i) => {
        const want = r.flagAway[i] || (i === 0 ? -1 : 1);
        return a + Math.max(-FLAG_SWING * STEP, Math.min(FLAG_SWING * STEP, want - a));
      }) as [number, number];
      sim.step(STEP, r.limp ? null : (outPose ?? postureFor(sim, r.flagSwing, r.legs, r.arms, r.rest?.hand ?? null, r.sink, r.twist, r.winding)));
    }
    // Thuds when the body hits the pad.
    if (sim.impacts.length) {
      const v = Math.max(...sim.impacts);
      sim.impacts.length = 0;
      if (r.t - r.lastThud > 0.12 && v > 0.03) {
        r.lastThud = r.t;
        sfx.thud(v);
        // Shake the view for a real landing (a drop off the top or a fall), not for a cut-loose
        // foot brushing the pad mid-climb, which would jolt the camera under a move.
        if (r.ended) climberFocus.shake = Math.min(0.05, v * 1.5);
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
    // The camera holds still through a move (wind-up, travel, a dyno's pumps) and only
    // reframes in the settle after it.
    const kfNow = r.frame >= 0 ? timeline.frames[r.frame] : null;
    climberFocus.free = r.ended;
    climberFocus.hold =
      !r.ended && !!kfNow && (!!kfNow.windup || (kfNow.limb >= 0 && inFrame < (kfNow.prep ?? 0) + (kfNow.travel ?? kfNow.duration * 0.85)));
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
