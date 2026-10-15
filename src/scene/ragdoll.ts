// A small Verlet ragdoll for the climber.
//
// Presentation only: the solver decides what happens (which holds, pass/fail).
// Hands and feet are kinematic when on the wall — pinned to holds, or carried
// along an arc to the next one — and everything else is simulated: gravity,
// fixed-length bones, soft "muscle" springs toward a posed skeleton, collisions
// with the wall panels and the pad. So bodies hang, sway, swing, and fall.
import * as THREE from 'three';
import { frameLocal, type PanelFrame } from './wallGeometry';

export const J = {
  head: 0,
  chest: 1,
  pelvis: 2,
  shoulderL: 3,
  shoulderR: 4,
  elbowL: 5,
  elbowR: 6,
  handL: 7,
  handR: 8,
  hipL: 9,
  hipR: 10,
  kneeL: 11,
  kneeR: 12,
  footL: 13,
  footR: 14,
} as const;
export const JOINTS = 15;

/** End effectors in solver limb order: left hand, right hand, left foot, right foot. */
export const ENDS = [J.handL, J.handR, J.footL, J.footR] as const;

type Stick = [number, number, number, boolean]; // a, b, rest length, rigid (else: min length only)

export interface Ground {
  padTop: number;
  padMinX: number;
  padMaxX: number;
  padMinZ: number;
  padMaxZ: number;
}

export interface EndDrive {
  mode: 'pinned' | 'moving' | 'free';
  from: THREE.Vector3;
  to: THREE.Vector3;
  normal: THREE.Vector3;
  t: number;
  duration: number;
  lift: number;
  /** A foot's swing out round its hip (bowRoundHip), at its fullest `bowAt` of the way along. */
  bow: THREE.Vector3;
  bowAt: number;
  /** A foot easing off a hold it was stretched to (see letGo): free once it gets there. */
  release: boolean;
}

const GRAVITY = -9.8;
const RADIUS = 0.07;
/** A free foot's pull toward its pose per step, the share of its swing lost per step, and its top speed (m/s), all relative to the hips. */
const FREE_FOOT_PULL = 0.06;
const FREE_FOOT_DAMP = 0.3;
const FREE_FOOT_SPEED = 2.5;
/**
 * The same for a free hand off the wall (dropping off, landing, celebrating), relative to the
 * chest, with an arm's quicker top speed. Pulled straight at its pose instead, a hand jumped
 * 14 cm a step whenever the pose changed (letting go, touchdown) and built up Verlet speed:
 * on day 20's landing the arms flung from overhead to the sides at 33 m/s in two frames.
 */
const FREE_HAND_PULL = 0.06;
const FREE_HAND_DAMP = 0.3;
const FREE_HAND_SPEED = 5;
/**
 * Top speed (m/s) the body's own drive (gravity, momentum, muscles) gives the torso, knees and
 * elbows while a hand holds on. A low foot pinned under a high step holds the hips down while
 * the pose wants them stood up; when that foot lets go, the muscles would fire the hips up
 * 0.75 m in a twelfth of a second and bounce. Climbers stand up into a move over half a
 * second or so. A dyno's launch (see impulse) isn't held back, nor is a fall or a drop.
 */
const BODY_SPEED = 1.5;
/**
 * How quickly (m/s²) the body may pick up speed toward BODY_SPEED under its own drive. The
 * muscles pull the torso a share of the way to its pose each step, so when the pose moves on
 * (a new move winding up, a hand landing, a foot settling) the hips went from standing still
 * to the full 1.5 m/s in one physics step, 180 m/s² (18 g), and coasted there: on day 77's
 * slab the hips jolted like that 15 times in 16 moves. A climber's centre of
 * mass eases into a weight shift; even a brisk one gets going over a quarter of a second, about
 * 0.6 g (braking is quicker, BODY_TURN).
 */
const BODY_ACCEL = 6;
/**
 * How sharply (m/s²) the body's own drive may brake or turn it. Stopping dead was free too: on
 * day 77 the hips going 1.5 m/s up a slab reversed in one step when a foot landed and the pose
 * moved on. About 2 g: the muscles' own easing onto a pose stays well inside it, so the body
 * still stops on its pose instead of overshooting.
 */
const BODY_TURN = 20;
const BODY = [J.head, J.chest, J.pelvis, J.shoulderL, J.shoulderR, J.hipL, J.hipR, J.elbowL, J.elbowR, J.kneeL, J.kneeR];
/** The joints in the middle of the limbs, which swing on their own once the torso moves. */
const LIMB_JOINTS = [J.elbowL, J.elbowR, J.kneeL, J.kneeR];
/** How long (s) after an impulse the body moves unchecked. */
const BURST = 0.35;
/**
 * How fast (rad/s) a standing leg's knee swings round the hip-foot line to bend the way the
 * pose bends it. The knee's muscle pulls toward where the pose put the knee, but with the hips
 * elsewhere that point can sit on the far side of the hip-foot line, and the rigid bones hold
 * a knee bent the wrong way there: on a sit start the knee sat on the pad with the shin
 * rising from it to the foothold, bent backwards, for seconds. A leg turns the knee out by
 * rotating at the hip, so the knee swings round, it never folds through the straight leg.
 */
const KNEE_SWING = 3.5;
/** Closest (m), along the wall, a foot's path comes to its hip on the way past it (bowRoundHip). */
const FOOT_CLEAR = 0.34;
/** Latest along a move (0..1) the bow peaks (and earliest, 1 less it), so it eases on and off. */
const BOW_LATEST = 0.7;
const UP = new THREE.Vector3(0, 1, 0);
/** Knees bent less than this far off the leg's line (m) have no bend to turn. */
const KNEE_BENT = 0.03;
/**
 * How fast (m/s) a stretched leg takes up its slack when its foot comes off. Stood at full
 * span (day 79: left hand on a pocket 2.1 m above the left foot), the bones stretch 5 cm at
 * the hip and shoulder between the pinned hand and foot; cut loose, the constraints shut that
 * in one physics step and threw the foot and knee up 11 cm (12.5 m/s) and the hip 7 cm.
 */
const SLACK_SPEED = 1;
/** Longest (s) a foot spends taking up slack before it swings free anyway. */
const SLACK_TIME = 0.5;
/**
 * Room (m) a hip keeps from its own foot, and how fast (m/s) the body moves out of the way of a
 * foot coming inside it. The bones only stop a foot 22 cm from its hip (a leg folded shut), and
 * a high step to a hold level with the hip got there at 4-6 m/s: the stick shoved that one hip
 * out from the wall in two or three steps (day 71: 11 cm, 6.4 m/s), twisting the pelvis 16°
 * a step. A climber's hips move out and over before the foot comes up under them.
 */
const HIP_ROOM = 0.3;
const ROOM_SPEED = 1.5;
/**
 * Room (m) a hand or foot keeps off the wall's face, a volume's included, on its way between
 * holds, and the most (m) its arc is lifted out to keep it. The path is a straight line plus a
 * small lift, and between two holds on either side of a volume that line runs through it: on
 * day 83's slab a foot stepping up to a pocket on the wedge's flank went 5.6 cm inside the
 * volume, the shoe and shin vanishing into it for a sixth of a second (the hand above, 4 cm).
 * Hands sit 7 cm and feet 6 cm off their holds, so 4 cm stays inside what a hold already gets.
 */
const PATH_CLEAR = 0.04;
const PATH_LIFT = 0.3;
/** Hip to foot (m) with the leg straight: the thigh and shin. */
const LEG_SPAN = 0.85;
const LEGS = [
  [J.hipL, J.kneeL, J.footL, 2],
  [J.hipR, J.kneeR, J.footR, 3],
] as const;

/** 0 at both ends of a move, 1 at `at` of the way along, easing in and out of it (smoothstep). */
function bowShape(s: number, at: number): number {
  const x = s < at ? s / at : (1 - s) / (1 - at);
  return x * x * (3 - 2 * x);
}

export class Ragdoll {
  pos: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  sticks: Stick[] = [];
  ends: EndDrive[] = [];
  /** 0..1 how strongly the body holds its posture. 0 = limp. */
  tone = 1;
  /** Per-step velocity kept, overriding the tone's default (a controlled drop: little air drag, posture held). */
  drag: number | null = null;
  /** Seconds left of an impulse's launch, while the body speed limit is off. */
  private burst = 0;

  /** Seconds since the last ground contact that counted as an impact (for thud sounds). */
  impacts: number[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private hipsV = new THREE.Vector3();
  private chestV = new THREE.Vector3();
  /** Each joint's velocity (m per step) over the last step, before this step's damping and muscles. */
  private velIn = Array.from({ length: JOINTS }, () => new THREE.Vector3());
  /** How fast (m/s) the body is moving out of each foot's way (makeRoom), picking up from rest. */
  private roomSpeed = [0, 0];

  constructor(
    init: THREE.Vector3[],
    private frames: PanelFrame[],
    _wallHalfWidth: number,
    private ground: Ground,
    /** Extra wall thickness (m) at wall-plane (u, v) cm — the volumes. */
    private relief: (u: number, v: number) => number = () => 0,
  ) {
    this.reset(init);
    const d = (a: number, b: number) => init[a].distanceTo(init[b]);
    const rigid = (a: number, b: number) => this.sticks.push([a, b, d(a, b), true]);
    const min = (a: number, b: number, len: number) => this.sticks.push([a, b, len, false]);
    // Torso: a braced box so it doesn't fold.
    rigid(J.chest, J.pelvis);
    rigid(J.head, J.chest);
    rigid(J.shoulderL, J.chest);
    rigid(J.shoulderR, J.chest);
    rigid(J.shoulderL, J.shoulderR);
    rigid(J.hipL, J.pelvis);
    rigid(J.hipR, J.pelvis);
    rigid(J.hipL, J.hipR);
    rigid(J.shoulderL, J.hipL);
    rigid(J.shoulderR, J.hipR);
    rigid(J.shoulderL, J.hipR);
    rigid(J.shoulderR, J.hipL);
    rigid(J.head, J.shoulderL);
    rigid(J.head, J.shoulderR);
    // Limbs.
    this.sticks.push([J.shoulderL, J.elbowL, 0.3, true], [J.elbowL, J.handL, 0.29, true]);
    this.sticks.push([J.shoulderR, J.elbowR, 0.3, true], [J.elbowR, J.handR, 0.29, true]);
    this.sticks.push([J.hipL, J.kneeL, 0.43, true], [J.kneeL, J.footL, 0.42, true]);
    this.sticks.push([J.hipR, J.kneeR, 0.43, true], [J.kneeR, J.footR, 0.42, true]);
    // Joints can't fold completely shut.
    min(J.shoulderL, J.handL, 0.16);
    min(J.shoulderR, J.handR, 0.16);
    min(J.hipL, J.footL, 0.22);
    min(J.hipR, J.footR, 0.22);
    min(J.kneeL, J.kneeR, 0.08);
    this.ends = ENDS.map((j) => ({
      mode: 'pinned',
      from: init[j].clone(),
      to: init[j].clone(),
      normal: new THREE.Vector3(0, 0, 1),
      t: 0,
      duration: 1,
      lift: 0,
      bow: new THREE.Vector3(),
      bowAt: 0.5,
      release: false,
    }));
  }

  reset(init: THREE.Vector3[]) {
    this.pos = init.map((p) => p.clone());
    this.prev = init.map((p) => p.clone());
  }

  /** Current kinematic position of an end, or null if it's free. */
  private endTarget(e: EndDrive): THREE.Vector3 | null {
    if (e.mode === 'free') return null;
    if (e.mode === 'pinned' || e.release) return e.to;
    const k = Math.min(1, e.t / e.duration);
    // Smootherstep: zero velocity and acceleration at both ends of a reach.
    const s = k * k * k * (k * (k * 6 - 15) + 10);
    return e.from
      .clone()
      .lerp(e.to, s)
      .addScaledVector(e.normal, Math.sin(Math.PI * s) * e.lift)
      .addScaledVector(e.bow, bowShape(s, e.bowAt));
  }

  /** Move an end to a new target, starting from wherever it is now. */
  drive(end: number, to: THREE.Vector3 | null, normal: THREE.Vector3, duration: number, lift: number) {
    const e = this.ends[end];
    if (!to) {
      if (end >= 2 && e.mode !== 'free') this.letGo(e, end === 2 ? J.hipL : J.hipR, ENDS[end]);
      else e.mode = 'free';
      return;
    }
    e.release = false;
    const here = this.pos[ENDS[end]];
    if (here.distanceTo(to) < 0.01 && e.mode !== 'free') {
      e.mode = 'pinned';
      e.to.copy(to);
      return;
    }
    e.mode = 'moving';
    e.from.copy(here);
    e.to.copy(to);
    e.normal.copy(normal);
    e.t = 0;
    e.duration = Math.max(0.05, duration);
    e.lift = lift;
    e.bow.set(0, 0, 0);
    if (end >= 2) this.bowRoundHip(e, end === 2 ? J.hipL : J.hipR, end === 2 ? -1 : 1);
    this.clearPath(e);
  }

  /**
   * Lift a move's arc out just far enough that the hand or foot passes over the wall and any
   * volume in its way (PATH_CLEAR) instead of through them, pushing it out along the face it
   * would cut (round an arête that isn't the target hold's own face). Set once per move, so the
   * path stays one smooth arc; the lift peaks mid-move, where it costs nothing at either hold.
   */
  private clearPath(e: EndDrive) {
    const arcV = this.tmp.copy(e.normal).multiplyScalar(e.lift);
    const p = this.tmp3;
    let added = 0;
    for (let pass = 0; pass < 4 && added < PATH_LIFT; pass++) {
      let worst = 0;
      let push: THREE.Vector3 | null = null;
      for (let i = 1; i < 20; i++) {
        const s = i / 20;
        const arc = Math.sin(Math.PI * s);
        p.copy(e.from).lerp(e.to, s).addScaledVector(arcV, arc).addScaledVector(e.bow, bowShape(s, e.bowAt));
        const gap = this.surfaceGap(p);
        if (!gap || gap.gap >= PATH_CLEAR) continue;
        // Metres of lift along that face's normal it takes to clear it here.
        const need = (PATH_CLEAR - gap.gap) / arc;
        if (need > worst) [worst, push] = [need, gap.normal];
      }
      if (!push) break;
      const k = Math.min(PATH_LIFT - added, worst + 0.005);
      arcV.addScaledVector(push, k);
      added += k;
    }
    if (added === 0) return;
    e.lift = arcV.length();
    e.normal.copy(arcV).divideScalar(e.lift);
  }

  /** How far (m) a point stands off the wall's surface (volumes included), and that facet's normal; null if it's over none. */
  private surfaceGap(p: THREE.Vector3): { gap: number; normal: THREE.Vector3 } | null {
    let best: { gap: number; normal: THREE.Vector3 } | null = null;
    for (const f of this.frames) {
      const local = frameLocal(f, p);
      if (local.v < 0 || local.v > f.v1 - f.v0 || local.u < 0 || local.u > f.u1 - f.u0 || local.out < -0.4) continue;
      const gap = local.out - this.relief(f.u0 + local.u, f.v0 + local.v);
      if (!best || gap < best.gap) best = { gap, normal: f.normal };
    }
    return best;
  }

  /**
   * A foot stepping up past its own hip (a high step to a hold level with the hips) swings out
   * round it along the wall, as a leg does, instead of sliding straight past it. Carried along
   * the straight line it went within 22 cm of the hip on day 43's 1.1 m step across the
   * corner: the leg folded flat, and as the hip-foot line spun past the hip the knee whipped
   * round it, 25 cm in three physics steps (11 m/s). The bow is set once per move (a smooth
   * path), sideways along the wall, at most FOOT_CLEAR less the closest approach.
   */
  private bowRoundHip(e: EndDrive, hip: number, side: -1 | 1) {
    const h = this.pos[hip];
    const seg = this.tmp.subVectors(e.to, e.from);
    const len2 = seg.lengthSq();
    const k = len2 > 1e-6 ? Math.min(1, Math.max(0, this.tmp2.subVectors(h, e.from).dot(seg) / len2)) : 0;
    const off = this.tmp2.copy(e.from).addScaledVector(seg, k).sub(h);
    const gap = off.length();
    if (gap >= FOOT_CLEAR || k <= 0 || k >= 1) return;
    // Sideways along the wall, on the side the path already passes (its own side if straight
    // through): the knee goes out and the foot comes up beside the hip, not out into the room.
    const across = this.tmp3.crossVectors(e.normal, UP);
    if (across.lengthSq() < 1e-4) return;
    across.normalize();
    const sideways = off.dot(across);
    const dir = Math.abs(sideways) > 0.04 ? Math.sign(sideways) : side * Math.sign(across.x || 1);
    e.bow.copy(across).multiplyScalar(dir * (FOOT_CLEAR - gap));
    e.bowAt = Math.min(BOW_LATEST, Math.max(1 - BOW_LATEST, k));
  }

  /**
   * A foot coming off a hold it could only just reach (the leg stretched past its length)
   * first draws in along the leg, at most SLACK_SPEED, until the leg is straight, then swings
   * free (see takeSlack).
   */
  private letGo(e: EndDrive, hip: number, foot: number) {
    if (this.pos[foot].distanceTo(this.pos[hip]) <= LEG_SPAN + 0.01) {
      e.mode = 'free';
      return;
    }
    e.mode = 'moving';
    e.release = true;
    e.to.copy(this.pos[foot]);
    e.t = 0;
    e.duration = SLACK_TIME;
  }

  /**
   * One step of a stretched leg taking up its slack. The hip rises as the foot comes in (the
   * arm above was stretched too), so the slack is measured afresh each step until it's gone.
   */
  private takeSlack(e: EndDrive, hip: number, dt: number) {
    const leg = this.tmp.subVectors(e.to, this.pos[hip]);
    const slack = leg.length() - LEG_SPAN;
    if (slack <= 0.005 || e.t >= e.duration) {
      e.mode = 'free';
      e.release = false;
      return;
    }
    e.to.addScaledVector(leg.normalize(), -Math.min(slack, SLACK_SPEED * dt));
  }

  /** Push the whole body (e.g. the launch of a dyno). Units: m/s. */
  impulse(v: THREE.Vector3, dt: number, only?: number[]) {
    const idx = only ?? this.pos.map((_, i) => i);
    for (const i of idx) this.prev[i].addScaledVector(v, -dt);
    this.burst = BURST;
  }

  /**
   * Feet cut loose off a dyno: they come off the wall and the body swings under the hands.
   * The swing is the body's own, not part of the launch, so its speed limit is back on.
   */
  cutFeet() {
    this.ends[2].mode = 'free';
    this.ends[3].mode = 'free';
    this.burst = 0;
  }

  step(dt: number, posture: THREE.Vector3[] | null) {
    const { pos, prev } = this;
    // 1. Integrate. Damped well on the wall so limbs settle smoothly; barely when falling.
    const damp = this.drag ?? (this.tone > 0 ? 0.965 : 0.999);
    for (let i = 0; i < JOINTS; i++) {
      const p = pos[i];
      this.velIn[i].subVectors(p, prev[i]);
      const vx = (p.x - prev[i].x) * damp;
      const vy = (p.y - prev[i].y) * damp;
      const vz = (p.z - prev[i].z) * damp;
      prev[i].copy(p);
      p.x += vx;
      p.y += vy + GRAVITY * dt * dt;
      p.z += vz;
    }
    // 2. Muscles: pull toward the posed skeleton. Torso strongly, elbows/knees gently.
    if (posture && this.tone > 0) {
      for (let i = 0; i < JOINTS; i++) {
        if ((ENDS as readonly number[]).includes(i)) continue;
        // A leg with no foothold is held actively (a flag or a tuck), so its knee follows the pose firmly.
        const freeKnee = (i === J.kneeL && this.ends[2].mode === 'free') || (i === J.kneeR && this.ends[3].mode === 'free');
        const soft = i === J.elbowL || i === J.elbowR || i === J.kneeL || i === J.kneeR;
        const k = (freeKnee ? 0.16 : soft ? 0.05 : 0.11) * this.tone;
        pos[i].lerp(posture[i], k);
      }
      // A weight shift is something the body does, not a cut: cap how fast it carries itself.
      const hanging = this.ends[0].mode !== 'free' || this.ends[1].mode !== 'free';
      if (hanging && this.drag === null && this.burst <= 0) {
        for (const i of BODY) {
          const vin = this.velIn[i];
          const v = this.tmp.subVectors(pos[i], prev[i]);
          // Turning or braking is quicker than speeding up, but not instant either.
          const turn = this.tmp2.subVectors(v, vin);
          const most = BODY_TURN * dt * dt;
          if (turn.lengthSq() > most * most) v.copy(vin).addScaledVector(turn, most / turn.length());
          const max = Math.min(BODY_SPEED * dt, vin.length() + BODY_ACCEL * dt * dt);
          if (v.lengthSq() > max * max) v.multiplyScalar(max / v.length());
          pos[i].copy(prev[i]).add(v);
        }
      } else if (hanging && this.drag === null) {
        // A launch throws the torso, and the knees and elbows ride along with the hips, but
        // they don't get a swing of their own out of it: on day 16's dyno a high-stepped knee
        // whipped 60 cm out to the side at 14 m/s while its foot stayed on.
        const hips = this.tmp2.subVectors(pos[J.pelvis], prev[J.pelvis]);
        const max = BODY_SPEED * dt;
        for (const i of LIMB_JOINTS) {
          const v = this.tmp.subVectors(pos[i], prev[i]).sub(hips);
          if (v.lengthSq() > max * max) pos[i].copy(prev[i]).add(hips).addScaledVector(v, max / v.length());
        }
      }
      for (const [hip, knee, foot, end] of LEGS) {
        if (this.ends[end].mode !== 'free') this.turnKnee(hip, knee, foot, posture, KNEE_SWING * dt);
      }
      // Free feet are held tucked (the solver assumed so), not left to dangle onto the mat;
      // free hands (only ever let go on purpose, dropping off the top) are held too.
      const hips = this.hipsV.subVectors(pos[J.pelvis], prev[J.pelvis]);
      const chest = this.chestV.subVectors(pos[J.chest], prev[J.chest]);
      this.ends.forEach((e, n) => {
        if (e.mode !== 'free') return;
        const j = ENDS[n];
        // A free foot (under a climber still holding on, or in the air off the top) is swung
        // by the leg: it moves with the hips plus a damped pull toward its pose, never faster
        // than a leg swings. (Pulled straight at the pose, it would jump half a metre in a
        // frame when it came off a hold and then ring at ~7 Hz; cut loose on a steep wall, the
        // feet bounced a metre out.) A free hand is swung by the arm the same way, off the chest.
        const hand = n < 2;
        const body = hand ? chest : hips;
        const rel = this.tmp2.subVectors(pos[j], prev[j]).sub(body).multiplyScalar(1 - (hand ? FREE_HAND_DAMP : FREE_FOOT_DAMP));
        rel.addScaledVector(this.tmp3.subVectors(posture[j], pos[j]), (hand ? FREE_HAND_PULL : FREE_FOOT_PULL) * this.tone);
        const max = (hand ? FREE_HAND_SPEED : FREE_FOOT_SPEED) * dt;
        if (rel.lengthSq() > max * max) rel.setLength(max);
        pos[j].copy(prev[j]).add(body).add(rel);
      });
    }
    this.burst = Math.max(0, this.burst - dt);
    // 3. Advance kinematic ends.
    this.ends.forEach((e, n) => {
      if (e.mode !== 'moving') return;
      e.t += dt;
      if (e.release) this.takeSlack(e, n === 2 ? J.hipL : J.hipR, dt);
      else if (e.t >= e.duration) e.mode = 'pinned';
    });
    if (posture && this.tone > 0) this.makeRoom(dt);
    // 4. Constraints.
    for (let iter = 0; iter < 10; iter++) {
      for (const [a, b, len, rigid] of this.sticks) {
        const pa = pos[a];
        const pb = pos[b];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (!rigid && d >= len) continue;
        const diff = (d - len) / d;
        const wa = this.invMass(a);
        const wb = this.invMass(b);
        const w = wa + wb;
        if (w === 0) continue;
        pa.x += dx * diff * (wa / w);
        pa.y += dy * diff * (wa / w);
        pa.z += dz * diff * (wa / w);
        pb.x -= dx * diff * (wb / w);
        pb.y -= dy * diff * (wb / w);
        pb.z -= dz * diff * (wb / w);
      }
      this.ends.forEach((e, n) => {
        const t = this.endTarget(e);
        if (t) pos[ENDS[n]].copy(t);
      });
      this.collide();
    }
    // 5. NaN guard: snap back to the posed skeleton.
    if (pos.some((p) => !Number.isFinite(p.x + p.y + p.z)) && posture) this.reset(posture);
  }

  /**
   * The body eases away from a foot on the wall that's come inside HIP_ROOM of its hip, all of it
   * together (pos and prev, so it carries no swing out of it), at most ROOM_SPEED: the hips move
   * out and over a high step instead of one hip being kicked out by the leg's bones.
   */
  private makeRoom(dt: number) {
    const { pos, prev } = this;
    for (const [hip, , foot, end] of LEGS) {
      const e = this.ends[end];
      const was = this.roomSpeed[end - 2];
      this.roomSpeed[end - 2] = 0;
      if (e.mode === 'free' || e.release) continue;
      // Measured to the nearest point on the rest of the foot's way, not just where it is, so
      // the hips start moving as the foot leaves: a high step's foot comes up at 4-6 m/s, far
      // quicker than they can, and on day 71 one swept past just over the hip to a hold beyond.
      const now = this.endTarget(e);
      if (!now) continue;
      const way = this.tmp2.subVectors(e.to, now);
      const len2 = way.lengthSq();
      const k = len2 > 1e-6 ? Math.min(1, Math.max(0, this.tmp3.subVectors(pos[hip], now).dot(way) / len2)) : 0;
      const away = this.tmp.subVectors(pos[hip], now).addScaledVector(way, -k);
      const d = away.length();
      if (d >= HIP_ROOM || d < 1e-4) continue;
      // Picking up speed from rest like any weight shift (BODY_ACCEL): at the full ROOM_SPEED
      // from the first step, the hips and chest lurched out at 1.5 m/s as a high step began.
      const speed = Math.min(ROOM_SPEED, was + BODY_ACCEL * dt);
      const shift = Math.min(HIP_ROOM - d, speed * dt);
      this.roomSpeed[end - 2] = shift / dt;
      away.multiplyScalar(shift / d);
      for (let i = 0; i < JOINTS; i++) {
        if (i === foot || this.invMass(i) === 0) continue;
        pos[i].add(away);
        prev[i].add(away);
      }
    }
  }

  /** Swing a knee round its hip-foot line, at most `max` radians, toward the side the pose bends it. */
  private turnKnee(hip: number, knee: number, foot: number, posture: THREE.Vector3[], max: number) {
    const { pos } = this;
    const axis = this.tmp.subVectors(pos[foot], pos[hip]);
    const span = axis.length();
    if (span < 1e-3) return;
    axis.divideScalar(span);
    // Where the knee sticks out from the leg's line, now and in the pose (measured on this line).
    const out = this.tmp2.subVectors(pos[knee], pos[hip]);
    const along = out.dot(axis);
    out.addScaledVector(axis, -along);
    const want = this.tmp3.subVectors(posture[knee], posture[hip]);
    const poseAxis = posture[foot].clone().sub(posture[hip]).normalize();
    want.addScaledVector(poseAxis, -want.dot(poseAxis));
    want.addScaledVector(axis, -want.dot(axis));
    const r = out.length();
    if (r < KNEE_BENT || want.length() < KNEE_BENT) return;
    const angle = out.angleTo(want);
    if (angle < 1e-3) return;
    // Rotate round the line, keeping the knee's distance from it (so the bones keep their length).
    const side = out.clone().cross(want).dot(axis) < 0 ? -1 : 1;
    out.applyAxisAngle(axis, side * Math.min(angle, max));
    pos[knee].copy(pos[hip]).addScaledVector(axis, along).add(out);
  }

  private invMass(i: number) {
    const n = (ENDS as readonly number[]).indexOf(i);
    return n >= 0 && this.ends[n].mode !== 'free' ? 0 : 1;
  }

  /** Whether a point is within a facet's own edges and in front of its face. */
  private over(f: PanelFrame, p: THREE.Vector3) {
    const local = frameLocal(f, p);
    return local.out >= 0 && local.v >= 0 && local.v <= f.v1 - f.v0 && local.u >= 0 && local.u <= f.u1 - f.u0;
  }

  private collide() {
    const g = this.ground;
    for (let i = 0; i < JOINTS; i++) {
      if (this.invMass(i) === 0) continue;
      const p = this.pos[i];
      const r = i === J.head ? 0.11 : i === J.chest || i === J.pelvis ? 0.12 : RADIUS * 0.6;
      // Each wall facet (panels, and both faces of a dihedral) is a slab to push out of.
      for (const f of this.frames) {
        const local = frameLocal(f, p);
        const along = local.v / 100;
        const across = local.u / 100;
        if (along < -0.05 || along > (f.v1 - f.v0) / 100 + 0.05) continue;
        if (across < -0.05 || across > (f.u1 - f.u0) / 100 + 0.05) continue;
        // The 5 cm past a facet's edge closes the seams between facets, but at a convex edge
        // (a roof's lip, an arête) it reaches out over the next facet, where the space behind
        // this facet's plane is open air: on day 17's dyno an elbow under the roof, in front
        // of it, was shoved 8 cm out along the headwall's normal in one step, and the shoulder
        // with it. Past the edge, a point in front of a facet it's squarely over is in the air.
        const past = along < 0 || along > (f.v1 - f.v0) / 100 || across < 0 || across > (f.u1 - f.u0) / 100;
        if (past && this.frames.some((g) => g !== f && this.over(g, p))) continue;
        {
          const depth = local.out;
          // Volumes stand proud of the wall: collide with their surface instead.
          const u = f.u0 + across * 100;
          const surface = this.relief(u, f.v0 + along * 100);
          if (depth < r + surface && depth > -0.4) {
            p.addScaledVector(f.normal, r + surface - depth);
            // Friction against the wall.
            this.prev[i].lerp(p, 0.3);
          }
        }
      }
      // Pad, else floor.
      const onPad = p.x > g.padMinX && p.x < g.padMaxX && p.z > g.padMinZ && p.z < g.padMaxZ;
      const floor = (onPad ? g.padTop : 0) + r;
      if (p.y < floor) {
        const vy = p.y - this.prev[i].y;
        if (vy < -0.02) this.impacts.push(-vy);
        p.y = floor;
        // Soft pad: little bounce, lots of friction.
        this.prev[i].y = p.y + vy * 0.25;
        this.prev[i].x = p.x - (p.x - this.prev[i].x) * 0.6;
        this.prev[i].z = p.z - (p.z - this.prev[i].z) * 0.6;
      }
    }
  }
}
