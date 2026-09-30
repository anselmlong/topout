// The physical model behind grading. Every constant here is a tuning knob;
// none are calibrated against real climbing data yet.
import type { Hold, HoldSize, HoldType, Wall } from './types';

/** The crash pad covers the bottom of the wall: anything below this (cm) is on the mat. */
export const PAD = 30;

export const BODY = {
  height: 175,
  /** Arm span (ape index 1.0). Max hand-to-hand distance on static moves. */
  span: 175,
  /** Max hand-to-foot distance when fully stretched. */
  reach: 215,
  /** Min hand-to-foot distance (deep crouch). */
  crouch: 45,
  /** Max foot-to-foot distance. */
  stride: 150,
  /** Beyond static reach a move becomes a dyno, up to this multiple. */
  dynoLimit: 1.18,
  /** How far (cm) the left hand may sit right of the right hand (a cross-through). */
  maxHandCross: 30,
  maxFootCross: 20,
};

interface GripSpec {
  grip: number;
  /** Orientation tolerance: how well it holds when pulled off-axis. */
  tolerance: number;
  /** Extra grip lost per unit of overhang steepness (slopers hate steep walls). */
  steepLoss: number;
  hand: boolean;
  /** Quality as a foothold. */
  foot: number;
}

export const GRIP: Record<HoldType, GripSpec> = {
  jug: { grip: 0.95, tolerance: 0.7, steepLoss: 0, hand: true, foot: 0.95 },
  edge: { grip: 0.74, tolerance: 0.42, steepLoss: 0.12, hand: true, foot: 0.85 },
  pocket: { grip: 0.66, tolerance: 0.4, steepLoss: 0.1, hand: true, foot: 0.7 },
  // Pinches squeeze: good pulled along their axis, poor across it.
  pinch: { grip: 0.64, tolerance: 0.5, steepLoss: 0.12, hand: true, foot: 0.6 },
  sloper: { grip: 0.6, tolerance: 0.25, steepLoss: 0.62, hand: true, foot: 0.6 },
  crimp: { grip: 0.55, tolerance: 0.3, steepLoss: 0.1, hand: true, foot: 0.75 },
  foot: { grip: 0.15, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.7 },
  jib: { grip: 0.1, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.5 },
  // A volume's face; real grip/foot values come per face (see volumes.ts).
  volume: { grip: 0.5, tolerance: 0.35, steepLoss: 0.4, hand: true, foot: 0.5 },
};

export const SIZE_GRIP: Record<HoldSize, number> = { s: 0.8, m: 1, l: 1.15 };

export const SMEAR_QUALITY = { slab: 0.62, vertical: 0.38 };

/** Wall angle (degrees, + overhang) at height v. */
export function angleAt(wall: Wall, v: number): number {
  let top = 0;
  for (const p of wall.panels) {
    top += p.length;
    if (v < top) return p.angle;
  }
  return wall.panels[wall.panels.length - 1].angle;
}

/**
 * World position (cm) of wall point (u, v): x across the room, y up, z toward the room.
 * Mirrors the scene's facet geometry, including a dihedral fold.
 */
export function wallPoint(wall: Wall, u: number, v: number): [number, number, number] {
  let y = 0;
  let z = 0;
  let top = 0;
  let a = 0;
  for (let i = 0; i < wall.panels.length; i++) {
    const p = wall.panels[i];
    a = rad(p.angle);
    const last = i === wall.panels.length - 1;
    const d = Math.min(p.length, v - top);
    if (d < p.length || last) {
      y += Math.max(0, d) * Math.cos(a);
      z += Math.max(0, d) * Math.sin(a);
      break;
    }
    y += p.length * Math.cos(a);
    z += p.length * Math.sin(a);
    top += p.length;
  }
  const foldU = wall.fold?.u ?? wall.width / 2;
  const half = rad((wall.fold?.angle ?? 0) / 2);
  const du = u - foldU;
  const t = du < 0 ? half : -half;
  // The face's across-direction: x turned about the panel's up axis by t.
  return [
    foldU - wall.width / 2 + du * Math.cos(t),
    y + du * Math.sin(t) * Math.sin(a),
    z - du * Math.sin(t) * Math.cos(a),
  ];
}

/** Stemming across a dihedral: how much extra each foot gives (0 on a flat wall). */
export function stemBonus(wall: Wall, footU: [number, number]): number {
  if (!wall.fold) return 0;
  const f = wall.fold.u;
  const opposite = (footU[0] - f) * (footU[1] - f) < 0 && Math.abs(footU[0] - f) > 8 && Math.abs(footU[1] - f) > 8;
  // A 90° corner is ideal; a shallow one barely helps.
  return opposite ? 0.4 * Math.sin(rad(Math.min(90, wall.fold.angle))) : 0;
}

/** Real height above the floor (cm) of the wall point at v: overhangs lean out, so less than v. */
export function heightAt(wall: Wall, v: number): number {
  let h = 0;
  let top = 0;
  for (const p of wall.panels) {
    const seg = Math.max(0, Math.min(v, top + p.length) - top);
    h += seg * Math.cos(rad(p.angle));
    top += p.length;
    if (v <= top) break;
  }
  return h;
}

/** The wall v (cm) at which the wall surface is `height` above the floor. */
export function vAtHeight(wall: Wall, height: number): number {
  let lo = 0;
  let hi = wallHeight(wall);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(wall, mid) < height) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function wallHeight(wall: Wall): number {
  return wall.panels.reduce((h, p) => h + p.length, 0);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The direction (unit vector in u,v) a hold is best pulled toward. */
export function bestPull(rot: number): { u: number; v: number } {
  // rot = 0 → pull straight down (0, -1); rotate counter-clockwise.
  return { u: Math.sin(rot), v: -Math.cos(rot) };
}

/**
 * Effective hand grip in (0, ~1.15] when pulled from `hold` toward `pullTo`
 * (usually the body's centre). Returns 0 when the hold is unusable that way.
 */
export function handGrip(hold: Hold, pullTo: { u: number; v: number }, wall: Wall): number {
  const spec = GRIP[hold.type];
  if (!spec.hand) return 0;
  const du = pullTo.u - hold.u;
  const dv = pullTo.v - hold.v;
  const len = Math.hypot(du, dv) || 1;
  const best = bestPull(hold.rot);
  const c = (du * best.u + dv * best.v) / len;
  const t = spec.tolerance;
  const orient = Math.max(0, Math.min(1, (c + t) / (1 + t)));
  // Holds on a volume use that face's angle rather than the panel's.
  const steep = Math.max(0, Math.sin(rad(hold.angle ?? angleAt(wall, hold.v))));
  const steepFactor = 1 - spec.steepLoss * steep;
  const base = hold.grip ?? spec.grip * SIZE_GRIP[hold.size];
  return base * orient * steepFactor;
}

/** Room for both hands on it? Finish (and a single start) are always matchable. */
export function handMatchable(hold: Hold): boolean {
  if (hold.role || hold.type === 'volume') return true;
  if (hold.type === 'jug') return true;
  if (hold.type === 'edge' || hold.type === 'sloper') return hold.size === 'l';
  return false;
}

/** Room for both feet on it? Only big holds; foot chips and jibs are one-toe affairs. */
export function footMatchable(hold: Hold): boolean {
  if (hold.type === 'volume') return true;
  return (hold.type === 'jug' && hold.size !== 's') || (hold.type === 'edge' && hold.size === 'l');
}

export function footQuality(hold: Hold): number {
  if (hold.foot !== undefined) return hold.foot;
  // A foothold on an up-facing volume face is easier to stand on.
  const tilt = hold.angle !== undefined ? Math.max(0, -Math.sin(rad(hold.angle))) * 0.2 : 0;
  return Math.min(1, GRIP[hold.type].foot * (hold.size === 's' ? 0.85 : hold.size === 'l' ? 1.05 : 1) + tilt);
}

/**
 * Share of body weight hanging on the hands (≈0.3 on vertical with good feet,
 * → 1+ on steep walls with feet off).
 */
export function handLoad(angle: number, footQ: [number, number]): number {
  const a = Math.max(-35, Math.min(60, angle));
  const base = 0.3 + 0.5 * Math.sin(rad(a));
  const steepness = 0.5 + Math.max(0, Math.sin(rad(a)));
  const footDeficit = (2 - footQ[0] - footQ[1]) / 2;
  const load = base + footDeficit * 0.45 * steepness;
  // Feet off the wall: the arms take (nearly) everything.
  const off = (footQ[0] === 0 ? 1 : 0) + (footQ[1] === 0 ? 1 : 0);
  if (off === 2) return Math.max(load, 0.95);
  if (off === 1) return Math.max(0.12, load + 0.12);
  return Math.max(0.12, load);
}

/**
 * Map crux difficulty + sustained-ness to a continuous V grade.
 * Logarithmic, like real grades: each doubling of crux difficulty adds ~3 grades.
 * Fitted to the reference problems in scripts/calibrate.ts (vertical jug ladder V0
 * … 40° board crimps V8); mean error ~0.6 grades.
 */
export function toGrade(crux: number, hardMoves: number): number {
  const base = 2.0 + 4.07 * Math.log(Math.max(crux, 1e-3));
  const density = Math.min(0.6, Math.max(0, hardMoves - 1) * 0.06);
  return Math.max(0, Math.min(14, base + density));
}
