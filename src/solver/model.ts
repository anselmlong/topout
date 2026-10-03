// The physical model behind grading. Every constant here is a tuning knob;
// none are calibrated against real climbing data yet.
import type { Hold, HoldSize, HoldType, Point, Wall } from './types';

/** The crash pad covers the bottom of the wall: anything below this (cm) is on the mat. */
export const PAD = 30;

export const BODY = {
  height: 175,
  /** Arm span (ape index 1.0). Max hand-to-hand distance on static moves. */
  span: 175,
  /**
   * Max vertical gap between the hands (cm): reaching up from a locked-off hand is
   * far shorter than the sideways span.
   */
  lockoff: 118,
  /** Max hand-to-foot distance when fully stretched. */
  reach: 205,
  /** Min hand-to-foot distance (deep crouch). */
  crouch: 45,
  /** Max foot-to-foot distance. */
  stride: 150,
  /** Beyond static reach a move becomes a dyno, up to this multiple. */
  dynoLimit: 1.1,
  /**
   * Just past static reach a move is a deadpoint: a controlled pop, barely harder than
   * the full lock-off. The cost of committing to a dyno ramps in over this much extra
   * stretch (≈7 cm straight up) instead of switching on at once.
   */
  deadpoint: 0.06,
  /** How far (cm) the left hand may sit right of the right hand (a cross-through). */
  maxHandCross: 30,
  maxFootCross: 20,
};

interface GripSpec {
  grip: number;
  /** Orientation tolerance: how well it holds when pulled off-axis. */
  tolerance: number;
  /**
   * Extra grip lost per unit of overhang steepness. On an overhang the pull swings
   * outward from the wall: slopers roll off, shallow crimps open up, while deep incut
   * edges and jugs still hold.
   */
  steepLoss: number;
  hand: boolean;
  /** Quality as a foothold. */
  foot: number;
  /**
   * How much of that foot quality depends on the hold facing up (see footQuality): a
   * flat edge turned on its side or upside down gives the shoe nothing to stand on,
   * while a round sloper or a pinch rib is much the same lump whichever way it's bolted.
   */
  footFacing: number;
}

export const GRIP: Record<HoldType, GripSpec> = {
  jug: { grip: 0.95, tolerance: 0.7, steepLoss: 0, hand: true, foot: 0.95, footFacing: 0.55 },
  edge: { grip: 0.74, tolerance: 0.42, steepLoss: 0.06, hand: true, foot: 0.85, footFacing: 0.8 },
  pocket: { grip: 0.66, tolerance: 0.4, steepLoss: 0.1, hand: true, foot: 0.7, footFacing: 0.6 },
  // Pinches squeeze: good pulled along their axis, poor across it. The thumb opposes the
  // fingers whichever way gravity pulls, so an overhang costs a pinch little (board
  // climbers live on them); a sloper is pure friction under the palm and rolls off as
  // soon as the pull swings out from the wall.
  pinch: { grip: 0.64, tolerance: 0.5, steepLoss: 0.05, hand: true, foot: 0.6, footFacing: 0.3 },
  sloper: { grip: 0.6, tolerance: 0.25, steepLoss: 0.7, hand: true, foot: 0.6, footFacing: 0.25 },
  crimp: { grip: 0.55, tolerance: 0.3, steepLoss: 0.16, hand: true, foot: 0.75, footFacing: 0.8 },
  foot: { grip: 0.15, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.7, footFacing: 0.5 },
  jib: { grip: 0.1, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.5, footFacing: 0.3 },
  // A volume's face; real grip/foot values come per face (see volumes.ts).
  volume: { grip: 0.5, tolerance: 0.35, steepLoss: 0.4, hand: true, foot: 0.5, footFacing: 0 },
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
  // Only an inside corner gives you two faces to push apart.
  if (!wall.fold || wall.fold.angle <= 0) return 0;
  const f = wall.fold.u;
  const opposite = (footU[0] - f) * (footU[1] - f) < 0 && Math.abs(footU[0] - f) > 8 && Math.abs(footU[1] - f) > 8;
  // A 90° corner is ideal; a shallow one barely helps.
  return opposite ? 0.62 * Math.sin(rad(Math.min(90, wall.fold.angle))) : 0;
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

/**
 * Index of the panel just above a lip (Wall.lip): the break where the wall rolls over
 * hardest, steep below to slabby above. On a rollover or overlap that's the top panel;
 * on a ledge it's the shelf.
 */
export function lipPanel(wall: Wall): number {
  const p = wall.panels;
  let best = p.length - 1;
  for (let i = 1; i < p.length; i++) if (p[i - 1].angle - p[i].angle > p[best - 1].angle - p[best].angle) best = i;
  return best;
}

/** Wall v (cm) of a rollover, overlap or ledge lip (Wall.lip): the break it rolls over at. */
export function lipV(wall: Wall): number {
  return wall.panels.slice(0, lipPanel(wall)).reduce((h, p) => h + p.length, 0);
}

/** A near-flat shelf (a ledge's top) is for standing on, not bolting holds to. */
export const SHELF_ANGLE = -45;

/** Whether any panel is a near-flat shelf, where the unfolded wall overstates real reach. */
export function hasShelf(wall: Wall): boolean {
  return wall.panels.some((p) => p.angle < SHELF_ANGLE);
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The direction (unit vector in u,v) a hold is best pulled toward. */
export function bestPull(rot: number): { u: number; v: number } {
  // rot = 0 → pull straight down (0, -1); rotate counter-clockwise.
  return { u: Math.sin(rot), v: -Math.cos(rot) };
}

/** How far (cm) a climber leans the body out sideways off a sidepull (see pullParts). */
export const SIDEPULL_LEAN = 45;

/** How much of a hold's grip a gaston (pulling the hold outward, away from the body) keeps. */
export const GASTON = 0.5;

/**
 * How a hand uses a hold pulled toward `pullTo`: the straight pull (0..1) and the gaston
 * alternative (0..GASTON). Shared by handGrip and handTechnique.
 */
function pullParts(hold: Hold, pullTo: { u: number; v: number }) {
  const best = bestPull(hold.rot);
  let du = pullTo.u - hold.u;
  const dv = pullTo.v - hold.v;
  // Sidepull: a hold whose lip faces sideways toward the body. Climbers don't hang
  // straight under it; they lean off it, straight-armed, hips swung out the other way
  // and the feet pushing back, so the pull comes in far more side-on than the stance's
  // centre alone says. Only toward the side the body is already on: leaning out past a
  // gaston would just turn it into a sidepull from the wrong side of the hold.
  if (Math.sign(du) === Math.sign(best.u)) du += best.u * SIDEPULL_LEAN;
  const len = Math.hypot(du, dv) || 1;
  const c = (du * best.u + dv * best.v) / len;
  const t = hold.tol ?? GRIP[hold.type].tolerance;
  const pull = Math.max(0, Math.min(1, (c + t) / (1 + t)));
  // Gaston: a hold whose edge faces away from the body, out to the side, isn't dead.
  // Thumb down, elbow out, the hand pulls it outward and the body stays on in
  // opposition (the other hand and the feet push back). Strenuous, so it only reaches
  // about half of the hold's grip, and only when the edge faces mostly sideways.
  const away = Math.abs(du) > 8 ? -Math.sign(du) * best.u : 0;
  const gaston = GASTON * Math.max(0, Math.min(1, (away - 0.3) / 0.7));
  return { pull, gaston, best };
}

/**
 * Extra steepness of a face hold on an arête. Each face is turned away from the room by
 * half the fold, and while the body hangs in front of the edge (straddling it, as on any
 * arête line) it can't square up to either face: the pull comes off the hold at an
 * outward angle, as on an overhang. Edges and crimps open up, slopers roll; jugs don't
 * care. With the body well round onto the hold's own face, it squares up and this fades.
 */
export function areteYaw(hold: Hold, pullTo: { u: number; v: number }, wall: Wall): number {
  const fold = wall.fold;
  if (!fold || fold.angle >= 0 || hold.angle !== undefined || hold.id.startsWith('arete:')) return 0;
  const side = Math.sign(hold.u - fold.u);
  if (!side) return 0;
  // How far the body has come round onto the hold's face (cm past the edge).
  const round = side * (pullTo.u - fold.u);
  const straddle = Math.max(0, Math.min(1, 1 - round / 60));
  return Math.sin(rad(Math.min(100, -fold.angle) / 2)) * straddle;
}

/**
 * Effective hand grip in (0, ~1.15] when pulled from `hold` toward `pullTo`
 * (usually the body's centre). Returns 0 when the hold is unusable that way.
 */
export function handGrip(hold: Hold, pullTo: { u: number; v: number }, wall: Wall): number {
  const spec = GRIP[hold.type];
  if (!spec.hand) return 0;
  const { pull, gaston } = pullParts(hold, pullTo);
  const orient = Math.max(pull, gaston);
  // Holds on a volume use that face's angle rather than the panel's.
  const steep = Math.max(0, Math.sin(rad(hold.angle ?? angleAt(wall, hold.v)))) + areteYaw(hold, pullTo, wall);
  const steepFactor = 1 - spec.steepLoss * steep;
  const base = hold.grip ?? spec.grip * SIZE_GRIP[hold.size];
  return base * orient * steepFactor;
}

export type HandTechnique = 'sidepull' | 'gaston' | 'undercling' | null;

/**
 * How a hand is holding a hold, from which way its lip faces relative to the body
 * (`pullTo`, the same centre handGrip pulls toward). Shared by the climber's arm pose
 * and move labels, and follows handGrip's own choice between pulling and gastoning.
 * - Sidepull: the lip faces sideways toward the body; lean off it, elbow low.
 * - Gaston: the lip faces away from the body; thumb down, elbow out, push it apart.
 * - Undercling: the lip faces down; palm up, elbow tucked, feet high.
 * Pinches are squeezed and arête slaps are laybacks, so neither gets a name here.
 */
export function handTechnique(hold: Hold, pullTo: { u: number; v: number }): HandTechnique {
  if (!GRIP[hold.type].hand || hold.type === 'pinch' || hold.id.startsWith('arete:')) return null;
  const { pull, gaston, best } = pullParts(hold, pullTo);
  if (gaston > pull) return 'gaston';
  if (best.v > 0.5) return 'undercling';
  if (Math.abs(best.u) > 0.6) return 'sidepull';
  return null;
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
  if (hold.id.startsWith('arete:')) return false;
  if (hold.type === 'volume') return true;
  return (hold.type === 'jug' && hold.size !== 's') || (hold.type === 'edge' && hold.size === 'l');
}

export function footQuality(hold: Hold): number {
  if (hold.foot !== undefined) return hold.foot;
  const spec = GRIP[hold.type];
  // A foothold on an up-facing volume face is easier to stand on.
  const tilt = hold.angle !== undefined ? Math.max(0, -Math.sin(rad(hold.angle))) * 0.2 : 0;
  // Which way the standing surface faces: 1 with the lip up (rot 0, pulled straight down),
  // 0.5 turned on its side, 0 upside down. A shoe edges on the top of a hold; on its side
  // only the corner of the sole bites, and upside down it's a smear on the hold's back.
  const up = (1 + Math.cos(hold.rot)) / 2;
  const facing = 1 - spec.footFacing * (1 - up);
  return Math.min(1, spec.foot * (hold.size === 's' ? 0.85 : hold.size === 'l' ? 1.05 : 1) * facing + tilt);
}

export type FootTechnique = 'heel' | 'toe' | 'drop-knee' | null;

/** How far out to the side (cm from between the hands) a hooked foot stops being a heel and becomes a toe hook. */
export const TOE_HOOK_OUT = 70;

/**
 * What a foot on a hold is doing, from where it sits relative to the hands. Shared by
 * the solver (heel hooks and drop knees change the load) and the climber's pose.
 * - Heel hook: a foot up near the hands, knee bent (validity rules live in the solver).
 * - Toe hook: a foot up near the hands but far out to the side, leg nearly straight,
 *   the top of the foot pulling back against the far side of the hold.
 * - Drop knee: on steep ground, a foot out to the side at about hip height; the knee
 *   turns in and down so the hip presses to the wall.
 */
export function footTechnique(wall: Wall, hands: [Point, Point], foot: Point): FootTechnique {
  const low = Math.min(hands[0].v, hands[1].v);
  const dv = low - foot.v;
  const midU = (hands[0].u + hands[1].u) / 2;
  if (dv < 35) return Math.abs(foot.u - midU) >= TOE_HOOK_OUT ? 'toe' : 'heel';
  if (angleAt(wall, low) > 10 && dv > 35 && dv < 110 && Math.abs(foot.u - midU) > 20) return 'drop-knee';
  return null;
}

/**
 * High step: how tucked a foot is under the hands, 0 (normal stance) .. 1 (foot up at the
 * hips, nearly a heel hook). Getting a foot that high takes hip mobility, and standing up
 * on it is a rockover: the hips have to come over the foot before it holds any weight.
 */
export function highStep(hands: [Point, Point], foot: Point): number {
  const dv = Math.min(hands[0].v, hands[1].v) - foot.v;
  return Math.max(0, Math.min(1, (95 - dv) / 50));
}

/**
 * Share of body weight hanging on the hands (≈0.3 on vertical with good feet,
 * → 1+ on steep walls with feet off).
 */
export function handLoad(angle: number, footQ: [number, number]): number {
  const a = Math.max(-35, Math.min(60, angle));
  // On a gentle overhang body tension still keeps most of the weight on the feet; it
  // shifts to the arms faster as the wall steepens (grows with sin², not linearly).
  // Slabs shed load linearly as before.
  const s = Math.sin(rad(a));
  const base = 0.3 + (s > 0 ? 0.9 * s * s : 0.5 * s);
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
 * … 40° board crimps V8); mean error ~0.36 grades.
 */
export function toGrade(crux: number, hardStreak: number): number {
  const base = 2.0 + 4.07 * Math.log(Math.max(crux, 1e-3));
  // Sustained hard moves add up (pump), but only once the moves are hard in absolute
  // terms: seven near-crux moves on a V0 jug ladder don't pump anyone out. `hardStreak`
  // is the longest run of hard moves without a rest (solve.ts hardStreak).
  const pump = Math.max(0, Math.min(1, (crux - 0.6) / 0.8));
  const density = Math.min(0.6, Math.max(0, hardStreak - 1) * 0.06) * pump;
  return Math.max(0, Math.min(14, base + density));
}
