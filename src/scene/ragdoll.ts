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
}

const GRAVITY = -9.8;
const RADIUS = 0.07;
/** A free foot's pull toward its pose per step, the share of its swing lost per step, and its top speed (m/s), all relative to the hips. */
const FREE_FOOT_PULL = 0.06;
const FREE_FOOT_DAMP = 0.3;
const FREE_FOOT_SPEED = 2.5;

export class Ragdoll {
  pos: THREE.Vector3[] = [];
  prev: THREE.Vector3[] = [];
  sticks: Stick[] = [];
  ends: EndDrive[] = [];
  /** 0..1 how strongly the body holds its posture. 0 = limp. */
  tone = 1;
  /** Per-step velocity kept, overriding the tone's default (a controlled drop: little air drag, posture held). */
  drag: number | null = null;

  /** Seconds since the last ground contact that counted as an impact (for thud sounds). */
  impacts: number[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();

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
    }));
  }

  reset(init: THREE.Vector3[]) {
    this.pos = init.map((p) => p.clone());
    this.prev = init.map((p) => p.clone());
  }

  /** Current kinematic position of an end, or null if it's free. */
  private endTarget(e: EndDrive): THREE.Vector3 | null {
    if (e.mode === 'free') return null;
    if (e.mode === 'pinned') return e.to;
    const k = Math.min(1, e.t / e.duration);
    // Smootherstep: zero velocity and acceleration at both ends of a reach.
    const s = k * k * k * (k * (k * 6 - 15) + 10);
    return e.from.clone().lerp(e.to, s).addScaledVector(e.normal, Math.sin(Math.PI * s) * e.lift);
  }

  /** Move an end to a new target, starting from wherever it is now. */
  drive(end: number, to: THREE.Vector3 | null, normal: THREE.Vector3, duration: number, lift: number) {
    const e = this.ends[end];
    if (!to) {
      e.mode = 'free';
      return;
    }
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
  }

  /** Push the whole body (e.g. the launch of a dyno). Units: m/s. */
  impulse(v: THREE.Vector3, dt: number, only?: number[]) {
    const idx = only ?? this.pos.map((_, i) => i);
    for (const i of idx) this.prev[i].addScaledVector(v, -dt);
  }

  step(dt: number, posture: THREE.Vector3[] | null) {
    const { pos, prev } = this;
    // 1. Integrate. Damped well on the wall so limbs settle smoothly; barely when falling.
    const damp = this.drag ?? (this.tone > 0 ? 0.965 : 0.999);
    for (let i = 0; i < JOINTS; i++) {
      const p = pos[i];
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
      // Free feet are held tucked (the solver assumed so), not left to dangle onto the mat;
      // free hands (only ever let go on purpose, dropping off the top) are held too.
      const hanging = this.ends[0].mode !== 'free' || this.ends[1].mode !== 'free';
      const hips = this.tmp.subVectors(pos[J.pelvis], prev[J.pelvis]);
      this.ends.forEach((e, n) => {
        if (e.mode !== 'free') return;
        const j = ENDS[n];
        if (n < 2 || !hanging) {
          pos[j].lerp(posture[j], 0.14 * this.tone);
          return;
        }
        // A free foot under a climber still holding on is swung by the leg: it moves with the
        // hips plus a damped pull toward its pose, never faster than a leg swings. (Pulled
        // straight at the pose, it would jump half a metre in a frame when it came off a hold
        // and then ring at ~7 Hz; cut loose on a steep wall, the feet bounced a metre out.)
        const rel = this.tmp2.subVectors(pos[j], prev[j]).sub(hips).multiplyScalar(1 - FREE_FOOT_DAMP);
        rel.addScaledVector(this.tmp3.subVectors(posture[j], pos[j]), FREE_FOOT_PULL * this.tone);
        const max = FREE_FOOT_SPEED * dt;
        if (rel.lengthSq() > max * max) rel.setLength(max);
        pos[j].copy(prev[j]).add(hips).add(rel);
      });
    }
    // 3. Advance kinematic ends.
    for (const e of this.ends) {
      if (e.mode !== 'moving') continue;
      e.t += dt;
      if (e.t >= e.duration) e.mode = 'pinned';
    }
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

  private invMass(i: number) {
    const n = (ENDS as readonly number[]).indexOf(i);
    return n >= 0 && this.ends[n].mode !== 'free' ? 0 : 1;
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
