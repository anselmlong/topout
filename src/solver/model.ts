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

export const SIZE_GRIP: Record<HoldSize, number> = { s: 0.8, m: 1, l: 1.15, xl: 1.15 };

/** The hold types that come as macros (size 'xl'). */
export const MACRO_TYPES: HoldType[] = ['sloper', 'edge', 'pinch'];

/**
 * A macro's grip against a medium hold of its type (in place of SIZE_GRIP), from what a big
 * hold gives the hand. A dual-texture macro sloper takes the whole palm and the heel of the
 * hand on its rough side, far more friction than a fist-sized dome (still a sloper on an
 * overhang: steepLoss is untouched). A macro ledge is a shelf a full hand deep, nearly a jug.
 * A pinch block is a wide pinch: more to squeeze, but the thumb sits at the end of a long
 * span, so it's only a little better than a medium pinch.
 */
export const MACRO_GRIP: Partial<Record<HoldType, number>> = { sloper: 1.3, edge: 1.2, pinch: 1.06 };

/** Size multiplier on a hold's grip: SIZE_GRIP, or its type's MACRO_GRIP for a macro. */
export function sizeGrip(type: HoldType, size: HoldSize): number {
  return size === 'xl' ? (MACRO_GRIP[type] ?? SIZE_GRIP.xl) : SIZE_GRIP[size];
}

/** L or bigger: room for a full hand (or both), a heel or a toe. */
export const isBig = (size: HoldSize) => size === 'l' || size === 'xl';

/**
 * Which mesh a hold is drawn with (and so which physical hold it is): its seed, else a
 * hash of its id. The scene picks the shape from this and the solver reads the incut
 * off the same number, so what a hold looks like is what it climbs like.
 */
export function holdVariant(hold: Pick<Hold, 'id' | 'seed'>): number {
  if (hold.seed !== undefined) return hold.seed;
  let h = 0;
  for (const c of hold.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Mesh builds per hold type (src/scene/holdGeometry.ts VARIANTS); jugs cycle JUG_INCUT. */
export const HOLD_VARIANTS = 4;

/**
 * Jug families in mesh order (holdGeometry JUG_FAMILIES: bucket, ledge, bucket, horn,
 * pinch, slopey) and how far each one's lip wraps over: a bucket's rolled lip closes
 * right over the scoop, a slopey jug is a big rounded handful.
 */
export const JUG_INCUT = [0.95, 0.7, 0.95, 0.8, 0.6, 0.35];

/**
 * The range of incut (0 flat .. 1 the lip wraps right over) a type comes in. Edges and
 * crimps run from a flat or slightly rounded top to a deep hooked lip, the difference
 * between a hold you can hang and one you have to crimp hard; a pocket's hood can be
 * shallow or wrap right over the fingers; a sloper is at most dished; a pinch's flanks
 * are more or less sculpted for the fingertips.
 */
const INCUT_RANGE: Partial<Record<HoldType, [number, number]>> = {
  edge: [0.15, 0.95],
  crimp: [0.05, 0.9],
  pocket: [0.2, 0.9],
  sloper: [0, 0.3],
  pinch: [0.2, 0.8],
};

/**
 * How incut a hold is, 0 (flat) .. 1 (deep), from its seed and size. Each size steps the
 * four builds through the levels differently, so a small and a large edge from the same
 * seed don't share a lip. Foot chips, jibs and volume faces have none (0).
 */
export function incutOf(type: HoldType, size: HoldSize, variant: number): number {
  if (type === 'jug') return JUG_INCUT[variant % JUG_INCUT.length];
  const range = INCUT_RANGE[type];
  if (!range) return 0;
  const level = (variant + { s: 0, m: 1, l: 2, xl: 3 }[size]) % HOLD_VARIANTS;
  return range[0] + ((range[1] - range[0]) * level) / (HOLD_VARIANTS - 1);
}

export function holdIncut(hold: Hold): number {
  return hold.incut ?? incutOf(hold.type, hold.size, holdVariant(hold));
}

/**
 * What incut does to a hand hold, against the type's middling build (its GRIP entry):
 * per unit of incut, this much more grip, and this much of steepLoss taken off. A deep
 * incut edge holds the fingers when the pull swings out on an overhang; a flat one only
 * holds as long as the forearm stays under it, so it opens up there.
 */
export const INCUT_GRIP = 0.36;
export const INCUT_STEEP = 0.9;

/** A typical build's incut: the middle of what the type comes in (no effect on grip). */
export function typicalIncut(type: HoldType): number {
  if (type === 'jug') return JUG_INCUT.reduce((a, b) => a + b) / JUG_INCUT.length;
  const range = INCUT_RANGE[type];
  return range ? (range[0] + range[1]) / 2 : 0;
}

/** The grip and steepLoss multipliers a hold's incut gives it (1, 1 for a typical one). */
export function incutFactors(hold: Hold): { grip: number; steep: number } {
  if (hold.grip !== undefined || (!INCUT_RANGE[hold.type] && hold.type !== 'jug')) return { grip: 1, steep: 1 };
  const d = holdIncut(hold) - typicalIncut(hold.type);
  return { grip: 1 + INCUT_GRIP * d, steep: Math.max(0, 1 - INCUT_STEEP * d) };
}

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
  // A crease that kinks between panels: each face's across-direction stays level (x turned
  // about the vertical), so the faces meet at every break (see panelFrames).
  if (wall.panels.length > 1) return [foldU - wall.width / 2 + du * Math.cos(t), y, z - du * Math.sin(t)];
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

/**
 * How far (cm) a climber brings the body up over an undercling (see pullParts): feet
 * high, legs pushing, so the shoulder rises above the hand.
 */
export const UNDERCLING_RISE = 120;

/**
 * How much of a hold's grip a straight-on undercling keeps: even stood up into it, the
 * body hangs on tension between hand and feet, so it's never as restful as a pull.
 */
export const UNDERCLING = 0.8;

/** How much of a hold's grip a gaston (pulling the hold outward, away from the body) keeps. */
export const GASTON = 0.5;

/**
 * How a hand uses a hold pulled toward `pullTo`: the straight pull (0..1) and the gaston
 * alternative (0..GASTON). Shared by handGrip and handTechnique.
 */
function pullParts(hold: Hold, pullTo: { u: number; v: number }) {
  const best = bestPull(hold.rot);
  let du = pullTo.u - hold.u;
  let dv = pullTo.v - hold.v;
  // Sidepull: a hold whose lip faces sideways toward the body. Climbers don't hang
  // straight under it; they lean off it, straight-armed, hips swung out the other way
  // and the feet pushing back, so the pull comes in far more side-on than the stance's
  // centre alone says. Only toward the side the body is already on: leaning out past a
  // gaston would just turn it into a sidepull from the wrong side of the hold.
  if (Math.sign(du) === Math.sign(best.u)) du += best.u * SIDEPULL_LEAN;
  // Undercling: a hold whose lip faces down can't be hung from below. Climbers bring
  // their feet up and stand into it, so the body rises over the hand and the arm pulls
  // up while the legs push down. That only reaches so far: an undercling at the waist
  // holds, one overhead with the feet far below it still doesn't.
  if (best.v > 0) dv += best.v * UNDERCLING_RISE;
  const len = Math.hypot(du, dv) || 1;
  const c = (du * best.u + dv * best.v) / len;
  const t = hold.tol ?? GRIP[hold.type].tolerance;
  const pull = Math.max(0, Math.min(1, (c + t) / (1 + t))) * (1 - (1 - UNDERCLING) * Math.max(0, best.v));
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
  const incut = incutFactors(hold);
  const steepFactor = 1 - spec.steepLoss * incut.steep * steep;
  const base = hold.grip ?? spec.grip * sizeGrip(hold.type, hold.size) * incut.grip;
  return base * orient * steepFactor;
}

/**
 * Palming: an open hand pushed flat against a bare volume face that points toward the body,
 * fingers up, the heel of the hand doing the work. It's the hand version of a smear: no edge
 * to curl, only friction from pushing into the face, and the push shoves the body away, so it
 * holds only while something pushes back (the other hand pulling the other way, the feet
 * bridged across a corner) and while the weight is over the feet. On an overhang the body
 * hangs out from the wall and a palm just slides.
 * Coaching material: REI Expert Advice, "Climbing Techniques and Moves" (palming is the hand
 * version of smearing; push with an open palm; counter-pressure, palming both sides of a
 * corner, to stay in balance); Climbing.com, "How to Slab Climb" (palms keep the centre of
 * gravity over the feet, "nose over toes", and hold balance while the feet move).
 *
 * In the solver a volume's side face is already only usable this way: its contact is pulled
 * toward where the face points (see volumeContacts), so the hand on it is pushing.
 */
export function isPalm(hold: Hold, pullTo: { u: number; v: number }): boolean {
  if (hold.type !== 'volume' || !/:f\d+$/.test(hold.id)) return false;
  const best = bestPull(hold.rot);
  return Math.abs(best.u) >= 0.6 && (pullTo.u - hold.u) * best.u > 0;
}

/** Steepest wall (degrees) a palm still holds anything on: past it the body hangs off the push. */
export const PALM_STEEP = 35;

/** How much of a palm's grip holds with nothing pushing back but the feet (see palmGrip). */
export const PALM_ALONE = 0.8;

/**
 * What's left of a palm's grip (handGrip) once it's priced as a push: 1 on a slab or vertical
 * wall, slipping slowly on a gentle overhang and quickly toward 0 at PALM_STEEP, times PALM_ALONE unless it's opposed. `opposed`:
 * something else pushes the body back onto the palm (see palmOpposed, or a stem). A palm with
 * no foot on the wall holds nothing: there's no weight over the feet to balance.
 */
export function palmFactor(wall: Wall, hold: Hold, opposed: boolean, feetOn: number): number {
  if (!feetOn) return 0;
  const steep = Math.max(0, Math.sin(rad(angleAt(wall, hold.v)))) / Math.sin(rad(PALM_STEEP));
  return Math.max(0, 1 - steep * steep) * (opposed ? 1 : PALM_ALONE);
}

/**
 * Whether the other hand, on `other`, pushes the body back toward a palm on `palm` (the
 * opposition a palm needs): a hold out on the far side of the body pulled toward it (a
 * sidepull to lean off), a hold on the palm's side gastoned or palmed away. A hold straight
 * above the body, pulled straight down, doesn't push the body sideways either way.
 */
export function palmOpposed(palm: Hold, other: Hold, pullTo: { u: number; v: number }): boolean {
  const push = Math.sign(bestPull(palm.rot).u);
  const du = other.u - pullTo.u;
  if (Math.abs(du) < 15) return false;
  const pushes = isPalm(other, pullTo) || handTechnique(other, pullTo) === 'gaston';
  // The force the other hand puts on the body, across the wall.
  const force = pushes ? -Math.sign(du) : Math.sign(du);
  return force === -push;
}

export type HandTechnique = 'palm' | 'sidepull' | 'gaston' | 'undercling' | null;

/**
 * How a hand is holding a hold, from which way its lip faces relative to the body
 * (`pullTo`, the same centre handGrip pulls toward). Shared by the climber's arm pose
 * and move labels, and follows handGrip's own choice between pulling and gastoning.
 * - Sidepull: the lip faces sideways toward the body; lean off it, elbow low.
 * - Gaston: the lip faces away from the body; thumb down, elbow out, push it apart.
 * - Undercling: the lip faces down; palm up, elbow tucked, feet high.
 * - Palm: a bare volume face pointing toward the body; open hand flat on it, pushing (isPalm).
 * Pinches are squeezed and arête slaps are laybacks, so neither gets a name here.
 */
export function handTechnique(hold: Hold, pullTo: { u: number; v: number }): HandTechnique {
  if (!GRIP[hold.type].hand || hold.type === 'pinch' || hold.id.startsWith('arete:')) return null;
  if (isPalm(hold, pullTo)) return 'palm';
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
  if (hold.type === 'edge' || hold.type === 'sloper') return isBig(hold.size);
  return hold.size === 'xl';
}

/** Room for both feet on it? Only big holds; foot chips and jibs are one-toe affairs. */
export function footMatchable(hold: Hold): boolean {
  if (hold.id.startsWith('arete:')) return false;
  if (hold.type === 'volume') return true;
  return (hold.type === 'jug' && hold.size !== 's') || (hold.type === 'edge' && isBig(hold.size)) || hold.size === 'xl';
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
  return Math.min(1, spec.foot * { s: 0.85, m: 1, l: 1.05, xl: 1.12 }[hold.size] * facing + tilt);
}

/**
 * Mantle: getting established on a shelf with nothing above it to pull on. The hands stop
 * pulling and press down on it (palms flat, elbows up, the triceps pushing the body up past
 * it, "like getting out of a swimming pool"), a foot comes up onto it beside them, and the
 * climber rocks over onto that foot and stands up on the shelf.
 * Coaching material: Friction Labs, "How it works: the mantle" (press with the triceps, high
 * feet close to the hands); Climbing.com, "Climbing Techniques: How to Mantel" (straighten
 * the arms, a foot on the shelf level with the hands, rock over it); Earth Treks, "What is a
 * mantle in climbing" (the difficulty is proportional to the width of the hold: a wide
 * shelf is much easier to mantle than a crimp rail).
 *
 * Something to press on and then stand on: a shelf facing up, wide enough for both palms and
 * a shoe side by side, on ground no steeper than MANTLE_STEEP, where the body can come up over
 * the hands. That's a ledge's lip or the bare top of a volume. A bolt-on hold, even a big jug,
 * has room for a hand and a foot but not a mantle: climbers step up past it instead.
 */
export function mantleable(hold: Hold, wall: Wall): boolean {
  if (angleAt(wall, hold.v) > MANTLE_STEEP || Math.cos(hold.rot) < 0.8) return false;
  if (hold.id.startsWith('lip:')) return hasShelf(wall);
  if (hold.id.startsWith('arete:') || hold.type !== 'volume') return false;
  return footQuality(hold) >= 0.5;
}

/**
 * Whether a foot on a mantle shelf is up beside the hands pressing it out: about level with
 * a hand on a shelf (`shelf[i]`), just under it at most, beside it rather than out to the
 * side, and with both hands up at the shelf or above it (a mantle presses with both, never
 * with one hand on the shelf and the other still down by the knees). Shared by the solver
 * and the climber's pose.
 */
export function mantleStep(hands: [Point, Point], shelf: [boolean, boolean], foot: Point): boolean {
  if (Math.min(hands[0].v, hands[1].v) < foot.v - 30) return false;
  return [0, 1].some((i) => shelf[i] && foot.v <= hands[i].v + 10 && foot.v >= hands[i].v - 30 && Math.abs(foot.u - hands[i].u) <= 70);
}

/** Steepest wall (degrees) a climber can mantle on: past this the body hangs below the shelf. */
export const MANTLE_STEEP = 15;

/**
 * Share of body weight on the arms while pressing out a mantle. Climbing normally keeps
 * most of the weight on the feet; a mantle press is a dip, the arms lifting nearly all of
 * it until the foot on the shelf can take over.
 */
export const MANTLE_LOAD = 0.7;

/**
 * How far (cm) standing up on a mantle shelf carries a hand: from crouched on the shelf, the
 * foot level with the palms, to stood up on it, the hips rise about this much and the reaching
 * hand rises with them. That part of a reach off a mantle is the legs' work, not a lock-off.
 */
export const MANTLE_STAND = 60;

/**
 * How far up (cm) the other hand reaches from a palm still pressing on a mantle shelf: half
 * stood up on the shelf, the palm at the thigh. Standing straight, the palm has to come off.
 */
export const MANTLE_REACH = 150;

/**
 * How well a palm presses on a mantle shelf: what a shoe gets from it (how positive it is),
 * scaled by its width, not its incut (a flat palm doesn't curl over a lip). A small volume's
 * top is a narrow shelf for two palms and a foot.
 */
export function pressQuality(hold: Hold): number {
  return footQuality(hold) * (isBig(hold.size) || hold.id.startsWith('lip:') ? 1 : 0.8);
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
 * Hip turn (twist lock / backstep): reaching a long way up with one hand on vertical or
 * steeper ground, a climber turns that hip into the wall and stands on the outside edge
 * of that foot. The reaching shoulder rises toward the hold and the other arm stays
 * straight, so the body adds reach without a lock-off. Slabs stay square, weight over the
 * feet, and so do bunched stances (that's a rockover). Returns 0 (square) .. 1 (fully
 * side-on). Animation only: the solver doesn't price it.
 */
export function hipTurn(wall: Wall, hands: [Point, Point], feet: [Point | null, Point | null], hand: 0 | 1): number {
  if (!feet[0] || !feet[1]) return 0;
  const reach = hands[hand];
  const stay = hands[1 - hand];
  const up = reach.v - stay.v;
  if (up < 25) return 0;
  if (reach.v - (feet[0].v + feet[1].v) / 2 < 120) return 0;
  const steep = Math.max(0, Math.min(1, (angleAt(wall, stay.v) + 10) / 30));
  const long = Math.max(0, Math.min(1, (Math.hypot(reach.u - stay.u, up) - 40) / 40));
  return steep * long;
}

export type Flag = {
  /** Which way the free leg goes: -1 to the climber's left, +1 right. */
  side: -1 | 1;
  /** Outside: the leg reaches out on its own side. Back: it crosses behind the standing leg. */
  kind: 'outside' | 'back';
  /** Hip turn (as hipTurn, unsigned) that goes with it: a back flag turns the reaching hip in. */
  turn: number;
};

/**
 * Flag: with one foot off, the free leg presses on the wall as a counterweight. It goes
 * the way the weight has to move: toward the reaching hand's side of the standing foot.
 * On its own side that's an outside flag (left foot and left hand on, reaching right: the
 * right leg out right stops the barn door). The other way it crosses behind the standing
 * leg, a back flag (standing on the right foot reaching right: the left leg behind it),
 * and the hip on the reaching side turns in while the standing foot backsteps. Without a
 * reach the free leg hangs out on its own side. Animation only: the solver prices flags
 * without caring which way they go.
 */
export function flagFor(
  wall: Wall,
  hands: [Point, Point],
  feet: [Point | null, Point | null],
  free: 0 | 1,
  reaching: 0 | 1 | null,
): Flag | null {
  const planted = feet[1 - free];
  if (feet[free] || !planted) return null;
  const own = free === 0 ? -1 : 1;
  const dx = reaching === null ? 0 : hands[reaching].u - planted.u;
  const side = Math.abs(dx) < 10 ? own : dx < 0 ? -1 : 1;
  if (side === own) return { side, kind: 'outside', turn: 0 };
  // Slabs stay square over the feet; vertical and steeper ground turns the hip in.
  const steep = Math.max(0, Math.min(1, (angleAt(wall, hands[1 - reaching!].v) + 10) / 20));
  return { side, kind: 'back', turn: 0.5 * steep };
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
 * How the arms' share of body weight grows with an overhang (handLoad): STEEP_LOAD ·
 * (e^(STEEP_RAMP · sin angle) − 1) on top of vertical's 0.3. +0.03 at 20°, +0.13 at 40°,
 * +0.52 at 60°. Fitted to the board-benchmarked reference problems in scripts/calibrate.ts.
 */
export const STEEP_LOAD = 0.0045;
export const STEEP_RAMP = 5.5;

/**
 * Share of body weight hanging on the hands (≈0.3 on vertical with good feet,
 * → 1+ on steep walls with feet off).
 */
export function handLoad(angle: number, footQ: [number, number]): number {
  const a = Math.max(-35, Math.min(60, angle));
  // On a gentle overhang body tension still keeps most of the weight on the feet; it
  // shifts to the arms exponentially as the wall steepens: a 20° wall barely loads them
  // more than vertical, a 40° board noticeably, a 60° cave a lot. Board grades move the
  // same way: Kilter's "Heinous Crimps" is V3-V4 from 0° to 30°, then V6 at 40° and V7 at
  // 45° (boardsesh.com). Slabs shed load linearly as before.
  const s = Math.sin(rad(a));
  const base = 0.3 + (s > 0 ? STEEP_LOAD * Math.expm1(STEEP_RAMP * s) : 0.5 * s);
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
 * … 40° board crimps V6); mean error ~0.38 grades.
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
