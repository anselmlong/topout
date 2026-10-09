// The topout: matched on a finish near the top, the climber reaches both hands over
// the lip and plays a scripted mantle onto the deck, stands up and turns to face the
// room, where the send celebration (or the near-miss shrug) plays (see Climber.tsx).
// Poses are built in world metres from the lip above the finish.
import * as THREE from 'three';
import { ARM, LEG, V, ik, type Pose } from './pose';

const UP = V(0, 1, 0);

export interface Lip {
  /** Top edge of the wall above the finish. */
  lip: THREE.Vector3;
  /** Horizontal, from the lip back over the deck. */
  back: THREE.Vector3;
  /** Up the top panel's surface, and out of it. */
  up: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Stage lengths (s). Read at 1x like the rest of the climb; playback speed scales them. */
const REACH = 0.7;
const PRESS = 0.9;
const ROCK = 0.85;
const STAND = 0.75;
const TURN = 0.6;
/** Seconds into the script when the climber stands on top facing the room. */
export const STANDING_AT = REACH + PRESS + ROCK + STAND + TURN;
/** Seconds into the script when the hands leave the lip and the mantle proper starts. */
export const MANTLE_AT = REACH;

/** A skeleton from its key points: limbs solved with IK so their lengths stay right. */
function build(
  face: THREE.Vector3,
  hip: THREE.Vector3,
  chest: THREE.Vector3,
  hands: [THREE.Vector3, THREE.Vector3],
  feet: [THREE.Vector3, THREE.Vector3],
  kneePole: [THREE.Vector3, THREE.Vector3],
): Pose {
  const right = face.clone().cross(UP).normalize();
  const spine = chest.clone().sub(hip).normalize();
  const shoulders: [THREE.Vector3, THREE.Vector3] = [chest.clone().addScaledVector(right, -0.19), chest.clone().addScaledVector(right, 0.19)];
  const pelvis: [THREE.Vector3, THREE.Vector3] = [hip.clone().addScaledVector(right, -0.1), hip.clone().addScaledVector(right, 0.1)];
  const arm = (i: 0 | 1) => {
    const side = i === 0 ? -1 : 1;
    // Elbows out to the side and a little back.
    return ik(shoulders[i], hands[i], ARM, right.clone().multiplyScalar(side).addScaledVector(face, -0.4).addScaledVector(UP, -0.2));
  };
  const leg = (i: 0 | 1) => ik(pelvis[i], feet[i], LEG, kneePole[i]);
  const [aL, aR, lL, lR] = [arm(0), arm(1), leg(0), leg(1)];
  return {
    hip,
    chest,
    head: chest.clone().addScaledVector(spine, 0.21).addScaledVector(face, 0.03),
    shoulders,
    elbows: [aL.joint, aR.joint],
    hands: [aL.end, aR.end],
    pelvis,
    knees: [lL.joint, lR.joint],
    feet: [lL.end, lR.end],
  };
}

/** Where each hand goes over the lip: on top of the deck, either side of the finish. */
function lipGrip({ lip, back }: Lip, side: number) {
  const right = back.clone().cross(UP).normalize();
  return lip.clone().addScaledVector(back, 0.06).addScaledVector(UP, 0.035).addScaledVector(right, side * 0.22);
}

/** Still hanging where they matched the finish, one or both hands slapped over the lip. */
function reach(l: Lip, from: Pose, k: number): Pose {
  const out = mapPose(from, (v) => v.clone());
  [0, 1].forEach((i) => {
    // Left hand first, the right following.
    const t = ease((k - i * 0.35) / 0.65);
    if (t <= 0) return;
    const hand = from.hands[i].clone().lerp(lipGrip(l, i === 0 ? -1 : 1), t);
    // Arc out from the wall on the way, so the hand clears the lip.
    hand.addScaledVector(l.normal, 0.08 * Math.sin(Math.PI * t));
    const pole = from.elbows[i].clone().sub(from.shoulders[i]);
    const arm = ik(from.shoulders[i], hand, ARM, pole);
    out.elbows[i] = arm.joint;
    out.hands[i] = arm.end;
  });
  return out;
}

/** Arms locked out on the deck, chest over the lip, legs down the wall. */
function press({ lip, back, up, normal }: Lip): Pose {
  const right = back.clone().cross(UP).normalize();
  const on = lip.clone().addScaledVector(back, 0.14).addScaledVector(UP, 0.035);
  const hands: [THREE.Vector3, THREE.Vector3] = [on.clone().addScaledVector(right, -0.2), on.clone().addScaledVector(right, 0.2)];
  const chest = on.clone().addScaledVector(UP, 0.5).addScaledVector(back, -0.03);
  const hipAim = lip.clone().addScaledVector(normal, 0.2).addScaledVector(UP, -0.05);
  const hip = chest.clone().add(hipAim.sub(chest).normalize().multiplyScalar(0.5));
  const wallFoot = (side: number) => lip.clone().addScaledVector(up, -0.8).addScaledVector(right, side * 0.16).addScaledVector(normal, 0.06);
  return build(back, hip, chest, hands, [wallFoot(-1), wallFoot(1)], [normal.clone(), normal.clone()]);
}

/** Right foot up on the deck, hips over it, leaning onto the hands. */
function rockover({ lip, back, up, normal }: Lip): Pose {
  const right = back.clone().cross(UP).normalize();
  const on = lip.clone().addScaledVector(back, 0.32).addScaledVector(UP, 0.035);
  const hands: [THREE.Vector3, THREE.Vector3] = [on.clone().addScaledVector(right, -0.24), on.clone().addScaledVector(right, 0.24)];
  const hip = lip.clone().addScaledVector(UP, 0.32).addScaledVector(back, 0.06).addScaledVector(right, 0.03);
  const chest = hip.clone().add(UP.clone().multiplyScalar(0.45).addScaledVector(back, 0.55).normalize().multiplyScalar(0.5));
  const feet: [THREE.Vector3, THREE.Vector3] = [
    lip.clone().addScaledVector(up, -0.5).addScaledVector(right, -0.14).addScaledVector(normal, 0.06),
    lip.clone().addScaledVector(back, 0.14).addScaledVector(right, 0.1).addScaledVector(UP, 0.06),
  ];
  return build(back, hip, chest, hands, feet, [normal.clone(), back.clone().add(UP)]);
}

/** Where the climber stands on the deck. */
const standSpot = ({ lip, back }: Lip) => lip.clone().addScaledVector(back, 0.42).addScaledVector(UP, 0.05);

/** The hip of the climber standing on the deck (what the celebration poses are built round). */
export const standHip = (l: Lip) => standSpot(l).addScaledVector(UP, 0.84);

/** Standing on the deck facing `face`, arms at the sides. */
function stand(l: Lip, face: THREE.Vector3): Pose {
  const right = face.clone().cross(UP).normalize();
  const at = standSpot(l);
  const feet: [THREE.Vector3, THREE.Vector3] = [at.clone().addScaledVector(right, -0.13), at.clone().addScaledVector(right, 0.13)];
  const hip = at.clone().addScaledVector(UP, 0.84);
  const chest = hip.clone().addScaledVector(UP, 0.5);
  const hand = (side: number) =>
    chest.clone().addScaledVector(right, side * 0.24).addScaledVector(UP, -0.56).addScaledVector(face, 0.05);
  return build(face, hip, chest, [hand(-1), hand(1)], feet, [face.clone(), face.clone()]);
}

const JOINTS: (keyof Omit<Pose, 'grips' | 'palms'>)[] = ['hip', 'chest', 'head', 'shoulders', 'elbows', 'hands', 'pelvis', 'knees', 'feet'];

function mapPose(p: Pose, f: (v: THREE.Vector3, key: string, i: number) => THREE.Vector3): Pose {
  const out = {} as Pose;
  for (const k of JOINTS) {
    const v = p[k];
    (out as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? v.map((x, i) => f(x, k, i)) : f(v as THREE.Vector3, k, 0);
  }
  return out;
}

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return mapPose(a, (v, key, i) => {
    const t = (b as unknown as Record<string, THREE.Vector3 | THREE.Vector3[]>)[key];
    return v.clone().lerp(Array.isArray(t) ? t[i] : t, k);
  });
}

/** Turn a pose about the vertical axis through `c`. */
function turnPose(p: Pose, c: THREE.Vector3, angle: number): Pose {
  return mapPose(p, (v) => v.clone().sub(c).applyAxisAngle(UP, angle).add(c));
}

const ease = (k: number) => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};

/**
 * The climber `t` seconds into the topout, from the pose they hung in matched on the
 * finish, up to standing on the deck facing the room (STANDING_AT).
 */
export function topoutPose(l: Lip, from: Pose, t: number): Pose {
  if (t < REACH) return reach(l, from, t / REACH);
  t -= REACH;
  const hung = reach(l, from, 1);
  if (t < PRESS) return lerpPose(hung, press(l), ease(t / PRESS));
  t -= PRESS;
  if (t < ROCK) return lerpPose(press(l), rockover(l), ease(t / ROCK));
  t -= ROCK;
  if (t < STAND) return lerpPose(rockover(l), stand(l, l.back), ease(t / STAND));
  t -= STAND;
  // Pivot on the spot to face the room.
  return turnPose(stand(l, l.back), standSpot(l), Math.PI * ease(t / TURN));
}
