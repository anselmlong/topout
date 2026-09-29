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
  sloper: { grip: 0.6, tolerance: 0.25, steepLoss: 0.5, hand: true, foot: 0.6 },
  crimp: { grip: 0.55, tolerance: 0.3, steepLoss: 0.1, hand: true, foot: 0.75 },
  foot: { grip: 0.15, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.7 },
  jib: { grip: 0.1, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.5 },
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
  const steep = Math.max(0, Math.sin(rad(angleAt(wall, hold.v))));
  const steepFactor = 1 - spec.steepLoss * steep;
  return spec.grip * SIZE_GRIP[hold.size] * orient * steepFactor;
}

/** Room for both hands on it? Finish (and a single start) are always matchable. */
export function handMatchable(hold: Hold): boolean {
  if (hold.role) return true;
  if (hold.type === 'jug') return true;
  if (hold.type === 'edge' || hold.type === 'sloper') return hold.size === 'l';
  return false;
}

/** Room for both feet on it? Only big holds; foot chips and jibs are one-toe affairs. */
export function footMatchable(hold: Hold): boolean {
  return (hold.type === 'jug' && hold.size !== 's') || (hold.type === 'edge' && hold.size === 'l');
}

export function footQuality(hold: Hold): number {
  return GRIP[hold.type].foot * (hold.size === 's' ? 0.85 : hold.size === 'l' ? 1.05 : 1);
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

/** Map crux difficulty + sustained-ness to a continuous V grade. */
export function toGrade(crux: number, hardMoves: number): number {
  const base = (crux - 0.41) * 5.5;
  const density = Math.min(1, Math.max(0, hardMoves - 1) * 0.1);
  return Math.max(0, Math.min(14, base + density));
}
