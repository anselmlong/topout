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
  // Pockets were 0.66 and 0.1 (until 2026-10-15), which put Atomik's Golfus pocket line a grade
  // hard at every depth on a vertical wall while the Kilter pocket boards at 30-40° sat near
  // target: the fingers are held in on a vertical wall, but on an overhang the pull swings out
  // and levers the fingertips out of the hole as it does off a crimp's shelf (Hörst, "Training
  // for Climbing": pockets get much harder as the wall steepens and the pull turns outward).
  pocket: { grip: 0.75, tolerance: 0.4, steepLoss: 0.25, hand: true, foot: 0.7, footFacing: 0.6 },
  // Pinches squeeze: good pulled along their axis, poor across it. The thumb opposes the
  // fingers whichever way gravity pulls, so an overhang costs a pinch little (board
  // climbers live on them); a sloper is pure friction under the palm and rolls off as
  // soon as the pull swings out from the wall.
  pinch: { grip: 0.64, tolerance: 0.5, steepLoss: 0.05, hand: true, foot: 0.6, footFacing: 0.3 },
  sloper: { grip: 0.6, tolerance: 0.25, steepLoss: 0.7, hand: true, foot: 0.6, footFacing: 0.25 },
  // Crimps sat 0.7 grades hard across the Kilter-graded reference problems at every angle
  // until 2026-10-12 (0.55); 0.6 puts them a grade under a medium edge, as on the boards.
  crimp: { grip: 0.6, tolerance: 0.3, steepLoss: 0.16, hand: true, foot: 0.75, footFacing: 0.8 },
  foot: { grip: 0.15, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.7, footFacing: 0.5 },
  jib: { grip: 0.1, tolerance: 0.2, steepLoss: 0, hand: false, foot: 0.5, footFacing: 0.3 },
  // A volume's face; real grip/foot values come per face (see volumes.ts).
  volume: { grip: 0.5, tolerance: 0.35, steepLoss: 0.4, hand: true, foot: 0.5, footFacing: 0 },
};

// Small holds were 0.8 (until 2026-10-13), which put every small crimp and thin pinch reference
// problem half a grade to a grade hard (Kilter's small crimps at 0° and 40°, Atomik's 10-14 mm
// strips, low granite crimps and thin pinches), while the small sloper rows sat on target.
export const SIZE_GRIP: Record<HoldSize, number> = { s: 0.86, m: 1, l: 1.15, xl: 1.15 };

/** The hold types that come as macros (size 'xl'). */
export const MACRO_TYPES: HoldType[] = ['sloper', 'edge', 'pinch'];

/**
 * A macro's grip against a medium hold of its type (in place of SIZE_GRIP), from what a big
 * hold gives the hand. A dual-texture macro sloper takes the whole palm and the heel of the
 * hand on its rough side, far more friction than a fist-sized dome (and it rolls off less on
 * an overhang, MACRO_STEEP). A macro ledge is a shelf a full hand deep, nearly a jug.
 * A pinch block is a wide pinch: more to squeeze, but the thumb sits at the end of a long
 * span, so it's only a little better than a medium pinch.
 */
export const MACRO_GRIP: Partial<Record<HoldType, number>> = { sloper: 1.3, edge: 1.2, pinch: 1.06 };

/**
 * A macro's share of its type's steepLoss. A fist-sized dome is pure friction under the palm
 * and rolls off as soon as the pull swings out; a dual-texture macro sloper is big enough to
 * wrap, the fingers curling round its rough rim and the thumb or heel of the hand opposing
 * them, so on an overhang it's half a pinch. Fitted to the Tension Board 2's dual-texture
 * sloper benchmarks (scripts/calibrate.ts): "Heel Slopers" goes V3 at 25° to V4 at 40°, where
 * Kilter's smaller "Super Sloper Slam Fest" goes V4 at 20° to V6 at 40°.
 */
export const MACRO_STEEP: Partial<Record<HoldType, number>> = { sloper: 0.5 };

/**
 * The pitches (degrees) over which a macro sloper loses what makes it a macro: up to the first,
 * it has a dish the whole palm sits in and a rim to wrap (MACRO_GRIP, MACRO_STEEP); by the
 * second it's a blank dome, held only by the skin pressed on it like any large sloper, however
 * big it is. Atomik Climbing Holds' XXL limestone slopers show it: cast at nearly one size (about
 * 8" x 5-1/2"), the sloper jug is V0 on vertical and V2 at 25°, the blank one V3 and V6
 * (scripts/calibrate.ts, the macro pitch rows). Climbing.com, "How to Climb Slopers": as much skin
 * on the hold as you can, so a hold with nowhere to sit the hand is hard however much of it there is.
 */
export const MACRO_BLANK: [number, number] = [40, 50];

/** How much of its macro bonus a macro keeps (1 all, 0 none: a large hold), from its pitch. */
export function macroShare(hold: Hold): number {
  const deg = hold.size === 'xl' ? sloperPitch(hold) : null;
  if (deg === null || hold.grip !== undefined) return 1;
  const [from, to] = MACRO_BLANK;
  return Math.max(0, Math.min(1, (to - deg) / (to - from)));
}

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
  // Footholds: a chip or jib from a rounded, smeary nub to a sharp positive shelf the toe
  // of a shoe stands on (see FOOT_INCUT).
  foot: [0, 0.9],
  jib: [0.1, 0.8],
};

/**
 * How incut a hold is, 0 (flat) .. 1 (deep), from its seed and size. Each size steps the
 * four builds through the levels differently, so a small and a large edge from the same
 * seed don't share a lip. Volume faces have none (0).
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
 * Where a hold's incut sits in what its type comes in: 0 its flattest build .. 1 its deepest,
 * or null for a hold with no lip to read (a volume face). What the HUD reads out, so a hold
 * too small to read on a phone screen still says how positive it is.
 */
export function incutRank(hold: Hold): number | null {
  const range: [number, number] | undefined =
    hold.type === 'jug' ? [Math.min(...JUG_INCUT), Math.max(...JUG_INCUT)] : INCUT_RANGE[hold.type];
  if (!range) return null;
  return Math.min(1, Math.max(0, (holdIncut(hold) - range[0]) / (range[1] - range[0])));
}

/**
 * How many fingers a pocket takes (1 a mono .. 4 a full-hand slot), from its seed and size,
 * independent of its hood (incutOf steps the same four builds in a different order). Small
 * pockets run from monos to three-finger holes, large ones from two-finger holes to slots.
 * The scene draws the hole that wide (holdGeometry pocketGeometry), so it reads at a glance.
 */
export const POCKET_FINGERS: Record<HoldSize, number[]> = { s: [1, 2, 2, 3], m: [2, 2, 3, 3], l: [2, 3, 4, 4], xl: [3, 3, 4, 4] };

export function fingersOf(size: HoldSize, variant: number): number {
  const list = POCKET_FINGERS[size];
  return list[(3 * variant + 1 + { s: 0, m: 1, l: 2, xl: 3 }[size]) % list.length];
}

export function pocketFingers(hold: Hold): number | null {
  return hold.type === 'pocket' ? (hold.fingers ?? fingersOf(hold.size, holdVariant(hold))) : null;
}

/**
 * A pocket's grip by finger count, against a four-finger slot. The fingers aren't equal: in
 * finger-force studies the middle finger carries about a third of the hand's pull, the ring
 * finger a quarter, the index a little more and the little finger the rest (Vigouroux et al.,
 * "Estimation of finger muscle tendon tensions and pulley forces during specific sport-climbing
 * grip techniques", J. Biomech. 2006), so a two-finger pocket (middle and ring) holds a bit
 * over half of what the whole hand does and a mono a third. Coaching material agrees that the
 * count, not the hood, is what makes a pocket hard: Eric Hörst, "Training for Climbing" (two-
 * finger pockets and monos are among the most stressful holds; three-finger pockets climb
 * close to an edge); Climbing.com, "How to Climb Pockets" (match the fingers to the hole:
 * a mono is a hard, risky hold). Gentler than the force shares, since a climber pulls a mono
 * with the strongest finger and the body stays on through the feet.
 * Normalised per size (fingerFactor), so the typical pocket of each size climbs as before.
 */
export const FINGER_GRIP = [0, 0.66, 0.86, 0.97, 1];

/** A pocket's grip multiplier for its finger count against the average of its size (1 otherwise). */
export function fingerFactor(hold: Hold): number {
  const f = pocketFingers(hold);
  if (f === null || hold.grip !== undefined) return 1;
  const list = POCKET_FINGERS[hold.size];
  const mean = list.reduce((a, n) => a + FINGER_GRIP[n], 0) / list.length;
  return FINGER_GRIP[Math.max(1, Math.min(4, Math.round(f)))] / mean;
}

/**
 * How wide a pinch is between the thumb and the fingers (cm, life size), from its seed and size,
 * on its own cycle (independent of the flanks' sculpting, incutOf). A pinch's span is what makes
 * it hard: a thin fin gives the thumb nothing to oppose, so the hand squeezes a blade with the
 * fingertips, while a broad one takes the thumb pad and the whole finger flank. Hao et al.,
 * "Mechanics and muscular activity characteristics of the pinch grip across varying hold widths"
 * (ISBS 2025, 22 climbers): pulling on a narrow pinch lost 31-46% of the force a jug allows, a
 * broad pinch only 6-19%. Coaching material says the same past a hand's width: too wide and
 * the thumb strains (grip-training guidance on pinch blocks).
 * Macros (pinch blocks) are all wider than a hand, 9-15 cm: the narrow ones take the thumb pad
 * against the fingers' first joints, while across the widest the thumb barely meets the far
 * flank and the hand opens toward the limit of its span (the same spanGrip curve, its wide end).
 */
export const PINCH_SPAN: Partial<Record<HoldSize, number[]>> = { s: [3, 4, 5, 6], m: [3.5, 5, 6.5, 8], l: [4.5, 6, 7.5, 9], xl: [9, 11, 13, 15] };

export function spanOf(size: HoldSize, variant: number): number | null {
  const list = PINCH_SPAN[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 2) % list.length] : null;
}

export function pinchSpan(hold: Hold): number | null {
  return hold.type === 'pinch' ? (hold.span ?? spanOf(hold.size, holdVariant(hold))) : null;
}

/**
 * A pinch's grip by span (cm), against a hand-width one: the narrow end loses most (the study's
 * narrow-to-broad ratio, about 0.7, made gentler as FINGER_GRIP is, since the feet still carry
 * the body), and past about 6 cm the thumb starts to strain, a little.
 */
export function spanGrip(cm: number): number {
  return cm <= 6 ? 1 - 0.07 * (6 - cm) : 1 - 0.015 * (cm - 6);
}

/** A pinch's grip multiplier for its span against the average of its size (1 otherwise). */
export function spanFactor(hold: Hold): number {
  const cm = pinchSpan(hold);
  const list = PINCH_SPAN[hold.size];
  if (cm === null || !list || hold.grip !== undefined) return 1;
  const mean = list.reduce((a, n) => a + spanGrip(n), 0) / list.length;
  return spanGrip(Math.max(2, Math.min(18, cm))) / mean;
}

/**
 * How deep a pinch's flanks are (mm, life size: how much of the fingers and the thumb pad the
 * sides take, from the rolled skirt at the wall to the crest), from its seed and size, on its
 * own cycle (one build off its span's, so a thin fin comes with deep flanks and the shallowest
 * build is never also the thinnest). A low-profile pinch, its sides barely proud of the wall,
 * gives the fingers only their first pads to squeeze with, like a shallow edge turned on its
 * side, where a deep one takes the fingers to the second joint and the whole thumb pad. The
 * fingers' side is an edge's shelf (depthGrip: Amca et al., J. Sports Sci. 2012), but the thumb
 * keeps gaining past it (flankGrip). Coaching material: Climbing.com, "How to Climb Pinches" (get as much
 * thumb and finger on the sides as the hold allows; thin, low pinches are squeezed with the
 * pads and are the hardest); Eric Hörst, "Training for Climbing" (pinch strength is about
 * thumb opposition, which a low pinch barely lets in). The lists centre on the flank each size
 * has always been drawn with. Pinch blocks (macros) are a hand's span thick by design: none.
 */
export const PINCH_DEPTH: Partial<Record<HoldSize, number[]>> = { s: [16, 22, 29, 36], m: [20, 28, 37, 46], l: [24, 34, 45, 56] };

export function pinchDepthOf(size: HoldSize, variant: number): number | null {
  const list = PINCH_DEPTH[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 1) % list.length] : null;
}

/** How deep a pinch's flanks are (mm); null for other types and for pinch blocks. */
export function pinchDepth(hold: Hold): number | null {
  return hold.type === 'pinch' && PINCH_DEPTH[hold.size] ? (hold.depth ?? pinchDepthOf(hold.size, holdVariant(hold))) : null;
}

/** The mean flank depth pinches of this size come in (mm), what the mesh is drawn at; null for none. */
export function meanPinchDepth(size: HoldSize): number | null {
  const list = PINCH_DEPTH[size];
  return list ? list.reduce((a, n) => a + n, 0) / list.length : null;
}

/**
 * A pinch's grip by flank depth (mm), against a deep one. depthGrip's curve is the finger pads
 * on an edge, flat once the shelf takes the first pad (about 3 cm); a pinch's flanks are squeezed
 * by the thumb too, and the thumb keeps gaining contact until its whole length is on (about 6
 * cm, distal and proximal phalanx), so this curve has twice depthGrip's reach and a little more
 * depth: a 2 cm flank about four fifths of a 6 cm one. Fitted to Atomik's pinch grade guides
 * (scripts/calibrate.ts: deep variety pinches, 67 mm off the wall, V2 at 25°).
 */
export function flankGrip(mm: number): number {
  return 1 - 0.5 * Math.exp(-(mm - 5) / 20);
}

/** A pinch's grip multiplier for its flank depth against its size's typical build (1 otherwise), as depthFactor. */
export function pinchDepthFactor(hold: Hold): number {
  const mm = pinchDepth(hold);
  const list = PINCH_DEPTH[hold.size];
  if (mm === null || !list || hold.grip !== undefined) return 1;
  // A line of mixed pinches grades off its lowest, and flankGrip punishes a low one harder than
  // depthGrip, so the typical build sits halfway from the average down to the lowest: a mixed set
  // of a size climbs as it always has (the board-graded rows were fitted to it).
  const grips = list.map(flankGrip);
  const mean = (grips.reduce((a, n) => a + n, 0) / grips.length + Math.min(...grips)) / 2;
  return flankGrip(Math.max(8, Math.min(70, mm))) / mean;
}

/**
 * How deep a crimp's or an edge's shelf is (mm, life size: how much of the finger pads it
 * takes), from its seed and size, on its own cycle (two builds off the lip's, like a pinch's
 * span, so the shallowest build is never also the flattest). Depth is what grades an edge
 * before anything else: on a 1 cm edge only the fingertips bite and the joints crank to hold
 * them, where a 2 cm one takes the first pads and a 3-4 cm one the whole first phalanx. Amca,
 * Vigouroux, Aritan and Berton, "Effect of hold depth and grip technique on maximal finger
 * forces in rock climbing" (J. Sports Sci. 2012): maximal finger force climbs steeply from a
 * 1 cm to a 2 cm edge and levels off by 3-4 cm. Hangboards are built on the same curve
 * (hangboards step their edges from about 6 mm to 25 mm for the same reason).
 * The lists centre on the depth each build has always been drawn at. Macro ledges run from a
 * long rail about two pads deep (24 mm, an open-hand rail like a campus rung, where the hand
 * drapes and the fingers still pull) to a shelf the whole hand sits on (60 mm); past 3-4 cm the
 * study's curve is flat, so most of a ledge's spread is in its shallow half.
 */
export const EDGE_DEPTH: Partial<Record<HoldType, Partial<Record<HoldSize, number[]>>>> = {
  crimp: { s: [9, 12, 15, 18], m: [11, 15, 19, 23], l: [14, 19, 24, 29] },
  edge: { s: [16, 21, 27, 32], m: [20, 27, 34, 40], l: [25, 33, 41, 50], xl: [24, 34, 46, 60] },
  // A pocket's depth is how far the fingers go in: a shallow dish takes only the first pads,
  // like a shallow crimp turned into the wall, where a deep one swallows them to the first
  // joint or past it and the hood closes over the knuckles. It's the same finger-pad contact
  // as an edge's shelf, so the same curve (depthGrip). Coaching material: Eric Hörst, "Training
  // for Climbing" (a shallow pocket is held like a crimp, on the pads, and is far harder than
  // one the fingers sink into); Climbing.com, "How to Climb Pockets" (get as much of each
  // finger in as the pocket takes). Its cycle sits two builds off the finger count's
  // (fingersOf), so a mono is never also the shallowest build.
  pocket: { s: [10, 14, 18, 22], m: [12, 17, 22, 28], l: [14, 20, 27, 34], xl: [16, 23, 30, 38] },
};

export function depthOf(type: HoldType, size: HoldSize, variant: number): number | null {
  const list = EDGE_DEPTH[type]?.[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 2) % list.length] : null;
}

/** A crimp's or edge's shelf depth, or how deep a pocket goes (mm); null for other types. */
export function edgeDepth(hold: Hold): number | null {
  return hold.type === 'crimp' || hold.type === 'edge' || hold.type === 'pocket' ? (hold.depth ?? depthOf(hold.type, hold.size, holdVariant(hold))) : null;
}

/** The mean depth an edge of this type and size comes in (mm), what its mesh is drawn at; null for none. */
export function meanDepth(type: HoldType, size: HoldSize): number | null {
  const list = EDGE_DEPTH[type]?.[size];
  return list ? list.reduce((a, n) => a + n, 0) / list.length : null;
}

/**
 * An edge's grip by depth (mm), against a deep one: the study's curve, steep under 2 cm and
 * flat past 3, made gentler (a 1 cm edge about four fifths of a 3 cm one) as FINGER_GRIP
 * is, since the feet still carry the body.
 */
export function depthGrip(mm: number): number {
  return 1 - 0.4 * Math.exp(-(mm - 5) / 9);
}

/**
 * An edge's, crimp's or pocket's grip multiplier for its depth against its size's typical build (1
 * otherwise). A line of mixed crimps grades off its shallowest, so the typical build sits a
 * quarter of the way from the average down to the shallowest: a mixed set of a size climbs
 * as that size always has (the board-graded reference problems were fitted to it).
 */
export function depthFactor(hold: Hold): number {
  const mm = edgeDepth(hold);
  const list = EDGE_DEPTH[hold.type]?.[hold.size];
  if (mm === null || !list || hold.grip !== undefined) return 1;
  const grips = list.map(depthGrip);
  const mean = (3 * grips.reduce((a, n) => a + n, 0) / grips.length + Math.min(...grips)) / 4;
  return depthGrip(Math.max(5, Math.min(60, mm))) / mean;
}

/**
 * How long a crimp's or edge's lip runs along the wall (cm, life size), from its seed and size,
 * on its own cycle (independent of its depth and its incut). A small crimp is often too short
 * for the whole hand: on a two-finger crimp the index and middle (or middle and ring) pull
 * alone, on a three-finger one the little finger drops off, while past about 8.5 cm all four
 * fingers line up along it. The fingers aren't equal (Vigouroux et al., J. Biomech. 2006, as
 * FINGER_GRIP: the middle and ring fingers carry over half the hand's pull, the little finger
 * the least), so losing the little finger costs little and losing two costs a lot. Coaching
 * material says the same: Eric Hörst, "Training for Climbing" (the three-finger drag, little
 * finger off, as the grip for short edges; two-finger holds are among the most stressful);
 * Climbing.com, "How to Climb Crimps" (fit as many fingers as the edge allows, stacking the
 * little finger or thumb where it can't). Medium and large edges are long enough for the hand
 * whatever the build, so only small crimps and edges, and the shortest medium crimps, read short.
 */
export const EDGE_WIDTH: Partial<Record<HoldType, Partial<Record<HoldSize, number[]>>>> = {
  crimp: { s: [4.5, 6.5, 8.5, 10.5], m: [6, 8, 10, 12], l: [8, 10.5, 13, 15.5] },
  edge: { s: [6, 8, 10, 12], m: [8, 10.5, 13, 15.5], l: [10, 13, 16, 19] },
};
/** How much lip one finger takes (cm): four fingers side by side need about 8.5 cm. */
export const FINGER_WIDTH = 2.1;

export function widthOf(type: HoldType, size: HoldSize, variant: number): number | null {
  const list = EDGE_WIDTH[type]?.[size];
  return list ? list[(3 * variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 1) % list.length] : null;
}

export function edgeWidth(hold: Hold): number | null {
  return (hold.type === 'crimp' || hold.type === 'edge') && hold.size !== 'xl' ? (hold.width ?? widthOf(hold.type, hold.size, holdVariant(hold))) : null;
}

/** How many fingers fit along a lip this long (2 .. 4, fractional between). */
export function widthFingers(cm: number): number {
  return Math.max(2, Math.min(4, cm / FINGER_WIDTH));
}

/** An edge's grip by its length (cm): FINGER_GRIP for the fingers that fit, interpolated. */
export function widthGrip(cm: number): number {
  const f = widthFingers(cm);
  const lo = Math.floor(f);
  return FINGER_GRIP[lo] + (FINGER_GRIP[Math.min(4, lo + 1)] - FINGER_GRIP[lo]) * (f - lo);
}

/**
 * An edge's or crimp's grip multiplier for its length against its size's typical build (1
 * otherwise), normalised as depthFactor is (a line of mixed crimps grades off its shortest),
 * so a mixed set of a size climbs as it always has.
 */
export function widthFactor(hold: Hold): number {
  const cm = edgeWidth(hold);
  const list = EDGE_WIDTH[hold.type]?.[hold.size];
  if (cm === null || !list || hold.grip !== undefined) return 1;
  const grips = list.map(widthGrip);
  const mean = (3 * grips.reduce((a, n) => a + n, 0) / grips.length + Math.min(...grips)) / 4;
  return widthGrip(cm) / mean;
}

/**
 * How far a sloper's palm surface slopes away from level (degrees, on a vertical wall), from its
 * seed and size, on its own cycle (one build off its dish, so the steepest build is never also
 * the roundest). Pitch is what grades a sloper: it's held by friction alone, and friction
 * only holds while the surface's slope stays under the angle the skin's friction allows
 * (Coulomb: slipping starts once tan(pitch) passes the friction coefficient), while the share
 * of the pull pressing the palm into it falls with cos(pitch). A flat-topped sloper is
 * nearly a rounded shelf; a steep one is a blank bump the palm only smears. Coaching material
 * says the same: Climbing.com, "How to Climb Slopers" (get as much skin on the hold as you
 * can and get the body under it, so the pull presses into the surface rather than along it);
 * Eric Hörst, "Training for Climbing" (slopers depend on friction and the angle of pull, so
 * they get much harder as the wall steepens and the pull swings out).
 * Macros span the widest range, 20-50: a dual-texture macro sloper is cast either as a big
 * flat-topped dish the whole hand sits on or as a round blank dome, and from across the gym
 * that's the first thing to read on one.
 */
export const SLOPER_PITCH: Partial<Record<HoldSize, number[]>> = { s: [30, 38, 46, 54], m: [27, 35, 43, 51], l: [24, 32, 40, 48], xl: [20, 30, 40, 50] };

export function pitchOf(size: HoldSize, variant: number): number | null {
  const list = SLOPER_PITCH[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 1) % list.length] : null;
}

export function sloperPitch(hold: Hold): number | null {
  return hold.type === 'sloper' ? (hold.pitch ?? pitchOf(hold.size, holdVariant(hold))) : null;
}

/** The mean pitch a sloper of this size comes in (degrees), what its mesh is drawn at; null for none. */
export function meanPitch(size: HoldSize): number | null {
  const list = SLOPER_PITCH[size];
  return list ? list.reduce((a, n) => a + n, 0) / list.length : null;
}

/**
 * A sloper's grip by pitch (degrees), against a level one: cos(pitch), the share of the pull
 * pressing into the surface, made gentler (a 50 degree sloper about four fifths of a
 * 25 degree one rather than seven tenths) as FINGER_GRIP is, since the feet still carry the body.
 */
export function pitchGrip(deg: number): number {
  return 0.3 + 0.7 * Math.cos(rad(deg));
}

/**
 * What a sloper's pitch does on an overhang, against its size's typical build: the pull
 * swinging out adds to the slope the palm already has, and the friction it loses grows with
 * tan(pitch) (d ln cos / d angle), so a flat-topped sloper keeps working a little steeper and
 * a blank one rolls off sooner. Square-rooted, gentler, as pitchGrip is.
 */
export function pitchSteep(hold: Hold): number {
  const deg = sloperPitch(hold);
  const mean = meanPitch(hold.size);
  if (deg === null || mean === null || hold.grip !== undefined) return 1;
  return Math.sqrt(Math.tan(rad(Math.max(10, Math.min(70, deg)))) / Math.tan(rad(mean)));
}

/** A sloper's grip multiplier for its pitch against the average of its size (1 otherwise). */
export function pitchFactor(hold: Hold): number {
  const deg = sloperPitch(hold);
  const list = SLOPER_PITCH[hold.size];
  if (deg === null || !list || hold.grip !== undefined) return 1;
  const mean = list.reduce((a, n) => a + pitchGrip(n), 0) / list.length;
  return pitchGrip(Math.max(10, Math.min(70, deg))) / mean;
}

/**
 * How wide a sloper is across the wall (cm, life size: how much of the hand's skin it takes),
 * from its seed and size, on its own cycle (one build behind its dish, two behind its pitch, so
 * the narrowest build is never also the steepest). A sloper is held by skin alone, so how much
 * skin is on it matters: on a narrow dome only three fingers fit and the little finger hangs
 * off (as on a short crimp, FINGER_GRIP); on a wide one the fingers splay and the palm and the
 * heel of the hand spread the same pull over far more skin, and skin grips better the lower the
 * pressure on it (its friction coefficient falls as the load per area rises: Derler and Gerhardt,
 * "Tribology of Skin", Tribology Letters 2012). Past a splayed hand's width (about 20 cm) the
 * extra hold touches nothing. Coaching material: Climbing.com, "How to Climb Slopers" (as much
 * skin on the hold as you can, fingers spread, the palm on it); Eric Hörst, "Training for
 * Climbing" (open-hand grip on slopers: maximise the contact area). The lists centre on the
 * width each size has always been drawn at; macros are a hand's span and more by design.
 */
export const SLOPER_WIDTH: Partial<Record<HoldSize, number[]>> = { s: [7, 9, 11, 13], m: [10, 13, 16, 19], l: [14, 18, 22, 26] };

export function sloperWidthOf(size: HoldSize, variant: number): number | null {
  const list = SLOPER_WIDTH[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 3) % list.length] : null;
}

/** A sloper's width across the wall (cm); null for other types and macros. */
export function sloperWidth(hold: Hold): number | null {
  return hold.type === 'sloper' && SLOPER_WIDTH[hold.size] ? (hold.width ?? sloperWidthOf(hold.size, holdVariant(hold))) : null;
}

/** The mean width a sloper of this size comes in (cm), what its mesh is drawn at; null for none. */
export function meanSloperWidth(size: HoldSize): number | null {
  const list = SLOPER_WIDTH[size];
  return list ? list.reduce((a, n) => a + n, 0) / list.length : null;
}

/**
 * A sloper's grip by width (cm), against a splayed hand's worth: steep while fingers come off,
 * levelling as the palm spreads (a 7 cm dome about four fifths of a 20 cm one), gentle as
 * FINGER_GRIP is, since the feet still carry the body.
 */
export function skinGrip(cm: number): number {
  return 1 - 0.35 * Math.exp(-(cm - 4) / 5);
}

/** A sloper's grip multiplier for its width against the average of its size (1 otherwise), as pitchFactor. */
export function sloperWidthFactor(hold: Hold): number {
  const cm = sloperWidth(hold);
  const list = SLOPER_WIDTH[hold.size];
  if (cm === null || !list || hold.grip !== undefined) return 1;
  const mean = list.reduce((a, n) => a + skinGrip(n), 0) / list.length;
  return skinGrip(Math.max(4, Math.min(40, cm))) / mean;
}

/**
 * What incut does to a hand hold, against the type's middling build (its GRIP entry):
 * per unit of incut, this much more grip, and this much of steepLoss taken off. A deep
 * incut edge holds the fingers when the pull swings out on an overhang; a flat one only
 * holds as long as the forearm stays under it, so it opens up there.
 */
export const INCUT_GRIP = 0.36;
export const INCUT_STEEP = 0.9;

/**
 * A jug's steepLoss per unit of incut its lip falls short of a typical jug's. A bucket or a horn
 * closes over the fingers, so the hand hangs off it at any angle (GRIP.jug steepLoss 0); a
 * pinch jug or a slopey jug is a big rounded handful with nothing to hook, held by friction and
 * the open hand like a big sloper, and it rolls out of the hand as the pull swings out on an
 * overhang (the same physics as INCUT_STEEP: only a lip that wraps over resists a pull out
 * from the wall). At 40° a slopey jug holds about like a typical edge; a bucket is still a bucket.
 */
export const JUG_STEEP = 0.4;

/** A typical build's incut: the middle of what the type comes in (no effect on grip). */
export function typicalIncut(type: HoldType): number {
  if (type === 'jug') return JUG_INCUT.reduce((a, b) => a + b) / JUG_INCUT.length;
  const range = INCUT_RANGE[type];
  return range ? (range[0] + range[1]) / 2 : 0;
}

/** The grip and steepLoss multipliers a hold's incut gives it (1, 1 for a typical one). */
export function incutFactors(hold: Hold): { grip: number; steep: number } {
  if (hold.grip !== undefined || !GRIP[hold.type].hand || (!INCUT_RANGE[hold.type] && hold.type !== 'jug')) return { grip: 1, steep: 1 };
  const d = holdIncut(hold) - typicalIncut(hold.type);
  return { grip: 1 + INCUT_GRIP * d, steep: Math.max(0, 1 - INCUT_STEEP * d) };
}

/**
 * What incut does to a foothold, per unit against the type's typical build: a shoe edges on
 * a positive shelf with the weight straight down through the toe, but on a rounded, flat-topped
 * chip it's half a smear, the rubber rolling off as soon as the heel drops or the hips swing
 * out. Only holds with an edge to stand on: foot chips, jibs, edges and crimps (a jug is
 * positive whatever its family, a sloper or pinch is a lump either way).
 * Coaching material: VDiff Climbing, "Climbing Technique: Footwork" (edging on a defined
 * edge vs smearing poorly defined, sloping features; climbers stand on a positive foothold in
 * preference to a smear); UKClimbing, "Technique - Use of the Toe" (on a good edge you can
 * pull in with the toe as well as push down, keeping weight on the feet on steep ground).
 */
export const FOOT_INCUT = 0.4;
const FOOT_INCUT_TYPES: HoldType[] = ['foot', 'jib', 'edge', 'crimp'];

/**
 * How far a foot chip's shelf stands out from the wall (mm, life size: how much of the shoe's
 * toe it takes), from its seed and size, on its own cycle (two builds off its incut's, so the
 * smallest chip is never also the roundest). A big chip takes the front of the shoe and the
 * weight goes straight down through it; on a tiny one only the very edge of the rand bites, so
 * the heel has to stay low and still, the toe placed exactly, and any twist or hip swing pops it
 * off. Coaching material: Earth Treks, "What is edging in climbing" (tiny footholds give the
 * shoe minimal surface, so a low, still heel and a precise edge hold it); Atomik Climbing Holds,
 * "How proper footwork transforms your climbing skills" (progress from large footholds to
 * smaller and smaller ones; routes on small screw-on chips are the test of precise feet).
 * The medium list centres on the 20 mm the chip has always been drawn at.
 */
export const FOOT_DEPTH: Partial<Record<HoldSize, number[]>> = { s: [9, 13, 18, 23], m: [11, 16, 22, 29], l: [14, 20, 27, 34] };

/**
 * How far a jib stands proud of the wall (mm, to its sharp top edge), from its seed and size, on
 * the same cycle as a foot chip's depth (two builds off its incut's). A jib is a little stone, so
 * it runs smaller than a chip: from a flat pebble barely proud of the plywood, which only the
 * very edge of the rand catches and which the toe has to be pressed onto and kept still, to a
 * knobbly stone the toe of the shoe sits on. Coaching material: Earth Treks, "What is edging in
 * climbing" (the smaller the foothold, the less shoe on it and the more precise and still the
 * foot has to be); Atomik Climbing Holds, "How proper footwork transforms your climbing skills"
 * (progress from large footholds to smaller and smaller ones). The medium list centres on the
 * 15 mm the jib has always been drawn at.
 */
export const JIB_DEPTH: Partial<Record<HoldSize, number[]>> = { s: [6, 9, 13, 17], m: [8, 12, 17, 23], l: [10, 15, 21, 28] };

const footDepths = (type: HoldType) => (type === 'jib' ? JIB_DEPTH : type === 'foot' ? FOOT_DEPTH : {});

export function footDepthOf(size: HoldSize, variant: number, type: HoldType = 'foot'): number | null {
  const list = footDepths(type)[size];
  return list ? list[(variant + { s: 0, m: 1, l: 2, xl: 3 }[size] + 2) % list.length] : null;
}

/** A foot chip's shelf depth, or how far a jib stands proud (mm); null for other types. */
export function footDepth(hold: Hold): number | null {
  return hold.type === 'foot' || hold.type === 'jib' ? (hold.depth ?? footDepthOf(hold.size, holdVariant(hold), hold.type)) : null;
}

/** The mean depth foot chips (or jibs) of this size come in (mm), what the mesh is drawn at. */
export function meanFootDepth(size: HoldSize, type: HoldType = 'foot'): number | null {
  const list = footDepths(type)[size];
  return list ? list.reduce((a, n) => a + n, 0) / list.length : null;
}

/** A shoe's hold on a shelf by its depth (mm), against a deep one: steep under 15 mm, flat past 30. */
export function footDepthGrip(mm: number): number {
  return 1 - 0.45 * Math.exp(-(mm - 4) / 8);
}

/**
 * A foot chip's or jib's quality multiplier for its depth against its size's typical build (1 for other
 * holds). The climber picks the best foot in reach, so the typical build is the average one: a
 * mixed set of chips stands as chips always have.
 */
export function footDepthFactor(hold: Hold): number {
  const mm = footDepth(hold);
  const list = footDepths(hold.type)[hold.size];
  if (mm === null || !list || hold.foot !== undefined) return 1;
  const mean = list.map(footDepthGrip).reduce((a, n) => a + n, 0) / list.length;
  return footDepthGrip(Math.max(4, Math.min(40, mm))) / mean;
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

/**
 * Back-and-foot (stem-and-back) in a tight inside corner: the feet push on one face while the
 * back or shoulder leans on the other, the body wedged across the corner pushing out, not
 * down, as in a chimney (Climbing, "How to Climb Chimneys"; theCrag glossary, "chimney":
 * "back against one wall and feet against the other"). Only a corner of ~105° or tighter
 * gives the back a face to reach, only with every foot that's on on the same face, far
 * enough from the other face for the legs to strut across (bent to nearly straight), and
 * the hands near the crease so the body is in the corner. Like a smear it relies on
 * friction, so not where the corner overhangs more than ~20°. The back is a poorer
 * contact than a second foot: it gives less than a stem (stemBonus), and less again off one
 * foot. Returns the side
 * the back is on (-1 left of the crease, +1 right) and what it gives, or null.
 */
export function backBridge(wall: Wall, hands: [Point, Point], feet: (Point | null)[]): { side: -1 | 1; bonus: number } | null {
  if (!wall.fold || wall.fold.angle < 75) return null;
  const f = wall.fold.u;
  // A foot stood in the crease is on neither face: it neither struts nor stops the other
  // foot strutting (it stood on a hold there, the climber stood on a jug beside the start).
  const on = feet.filter((p): p is Point => !!p && Math.abs(p.u - f) >= 8);
  if (!on.length) return null;
  const side = Math.sign(on[0].u - f);
  if (on.some((p) => Math.sign(p.u - f) !== side)) return null;
  // Straight-line distance from each foot across to the other face's plane.
  const open = Math.sin(rad(180 - wall.fold.angle));
  if (on.some((p) => Math.abs(p.u - f) * open < 35 || Math.abs(p.u - f) * open > 95)) return null;
  if (Math.abs((hands[0].u + hands[1].u) / 2 - f) > 40) return null;
  const hipV = (hands[0].v + hands[1].v) / 4 + on.reduce((s, p) => s + p.v, 0) / on.length / 2;
  if (angleAt(wall, hipV) > 20 || on.some((p) => angleAt(wall, p.v) > 20)) return null;
  // One foot alone is a weaker strut than two.
  return { side: -side as -1 | 1, bonus: (on.length > 1 ? 0.4 : 0.25) * Math.sin(rad(Math.min(90, wall.fold.angle))) };
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
 * outward angle, as on an overhang. Edges and crimps open up, slopers and slopey jugs
 * roll; buckets don't care. With the body well round onto the hold's own face, it squares
 * up and this fades.
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
  const share = macroShare(hold);
  const macro = hold.size === 'xl' ? 1 - (1 - (MACRO_STEEP[hold.type] ?? 1)) * share : 1;
  const loss =
    hold.type === 'jug' && hold.grip === undefined
      ? JUG_STEEP * Math.max(0, typicalIncut('jug') - holdIncut(hold))
      : spec.steepLoss * macro * incut.steep * pitchSteep(hold);
  const steepFactor = 1 - loss * steep;
  const base = hold.grip ?? spec.grip * (SIZE_GRIP.xl + (sizeGrip(hold.type, hold.size) - SIZE_GRIP.xl) * share) * incut.grip * fingerFactor(hold) * spanFactor(hold) * pinchDepthFactor(hold) * depthFactor(hold) * widthFactor(hold) * pitchFactor(hold) * sloperWidthFactor(hold);
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

/**
 * How wide a medium sloper must be (cm) for both hands: two hands' fingers side by side, each
 * squeezed to about 5.5 cm (four fingers' widths). Narrower, the second hand only gets a couple of
 * fingers on and has to wait for the first to move off. Large slopers always take two; a small
 * one is a short nub, too low top to bottom for a second hand's fingers even where it's wide.
 */
export const SLOPER_MATCH_WIDTH = 11;

/**
 * How wide a jug is across the wall (cm, life size), from its family, size and build: a bucket,
 * ledge or slopey jug is a wide crescent, a horn or a pinch jug a narrow handful. Each family
 * comes in a narrow and a wide build (the second cycle of its mesh), 0.85 and 1.15 of the
 * width its mesh has always been drawn at (holdGeometry JUG_FAMILIES). A jug takes the whole
 * hand however narrow (a horn or a pinch jug is wrapped, the thumb round its side), so width
 * doesn't change its grip; it decides how easily a second hand fits beside the first. Past the
 * same SLOPER_MATCH_WIDTH (two hands' fingers side by side, squeezed to about 5.5 cm each) both
 * hands sit on it. A narrower one is a one-hand jug: the climber can still swap hands on it,
 * but only as a shuffle, the first hand peeling its fingers off one at a time while the second
 * takes their place, holding on a couple of fingers each in between (JUG_SHUFFLE). This is the
 * standard coaching advice on matching a small hold (free the fingers one at a time to make
 * room, or plan the sequence so the hands don't have to swap there; e.g. Eric Hörst, "Training
 * for Climbing", on hand sequences), and hold makers sell small jugs as one-hand holds.
 */
export const JUG_WIDTH = [16, 16, 16, 10, 11, 16.5];
const JUG_WIDTH_SIZE: Record<HoldSize, number> = { s: 0.8, m: 1, l: 1.25, xl: 1.25 };

export function jugWidthOf(size: HoldSize, variant: number): number {
  const wide = Math.floor(variant / JUG_WIDTH.length) % 2 ? 1.15 : 0.85;
  return Math.round(JUG_WIDTH[variant % JUG_WIDTH.length] * JUG_WIDTH_SIZE[size] * wide * 10) / 10;
}

/** A jug's width across the wall (cm); null for other types. */
export function jugWidth(hold: Hold): number | null {
  return hold.type === 'jug' ? (hold.width ?? jugWidthOf(hold.size, holdVariant(hold))) : null;
}

/**
 * What a hand swap on a one-hand jug costs (move difficulty, on top of a plain match, times the
 * load the hands hold: little on a slab, where the feet carry the body), per unit its width
 * falls short of SLOPER_MATCH_WIDTH: a couple of fingers each in the middle of the shuffle.
 */
export const JUG_SHUFFLE = 0.6;

/** A hand swap's extra cost on `hold`: 0 unless it's a one-hand jug (see JUG_WIDTH). */
export function shuffleCost(hold: Hold): number {
  const cm = jugWidth(hold);
  if (cm === null || hold.role) return 0;
  return (JUG_SHUFFLE * Math.max(0, SLOPER_MATCH_WIDTH - cm)) / SLOPER_MATCH_WIDTH;
}

/** Room for both hands on it? Finish (and a single start) are always matchable. */
export function handMatchable(hold: Hold): boolean {
  if (hold.role || hold.type === 'volume') return true;
  if (hold.type === 'jug') return true;
  if (hold.type === 'sloper' && hold.size === 'm') return (sloperWidth(hold) ?? 0) >= SLOPER_MATCH_WIDTH;
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
  const incut = FOOT_INCUT_TYPES.includes(hold.type) ? 1 + FOOT_INCUT * (holdIncut(hold) - typicalIncut(hold.type)) : 1;
  return Math.min(1, spec.foot * { s: 0.85, m: 1, l: 1.05, xl: 1.12 }[hold.size] * facing * incut * footDepthFactor(hold) + tilt);
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
 * How well a foot on a hold sits under a reach to `target`, to push the body up toward it
 * (0..1): fully when it's straight under it (within ~15 cm sideways) and bent, 60-140 cm below;
 * not at all from 60 cm out to the side, from a foot so low the leg is already straight at full
 * stretch, or from one up by the hold. Reaching across the body, that foot is the one on the
 * far side from the hand that stays on: the diagonal that keeps the body from swinging open.
 */
export function legPush(foot: Point, target: Point): number {
  const under = Math.min(1, Math.max(0, (60 - Math.abs(foot.u - target.u)) / 45));
  const below = target.v - foot.v;
  if (below < 60) return 0;
  return under * Math.min(1, Math.max(0, (200 - below) / 60));
}

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
 * How steep (degrees, at the foot) the wall must be to hook a heel or a toe. A hook pulls the
 * hips in to the wall, which only helps where they hang out from it; on a slab or a vertical
 * face the weight is already over the feet, so a foot up by the hands is stood on: a high
 * step, rocked over onto. Coaching material teaches hooks as steep-ground technique (keeping
 * the hips in and the feet on when the wall overhangs) and slab footwork as standing on the
 * feet: rockovers and high steps.
 */
export const HEEL_STEEP = 12;
export const TOE_STEEP = 20;

/**
 * What a foot on a hold is doing, from where it sits relative to the hands. Shared by
 * the solver (heel hooks and drop knees change the load) and the climber's pose.
 * - Heel hook: a foot up near the hands, knee bent, on ground at least HEEL_STEEP steep
 *   (the other validity rules live in the solver).
 * - Toe hook: a foot up near the hands but far out to the side, leg nearly straight,
 *   the top of the foot pulling back against the far side of the hold (TOE_STEEP and up).
 * Lower than that, a foot up near the hands is a high step (null).
 * - Drop knee: on steep ground, a foot out to the side at about hip height; the knee
 *   turns in and down so the hip presses to the wall.
 */
export function footTechnique(wall: Wall, hands: [Point, Point], foot: Point): FootTechnique {
  const low = Math.min(hands[0].v, hands[1].v);
  const dv = low - foot.v;
  const midU = (hands[0].u + hands[1].u) / 2;
  if (dv < 35) {
    // Too slabby to hook: a high step (null), priced and posed as one.
    const toe = Math.abs(foot.u - midU) >= TOE_HOOK_OUT;
    return angleAt(wall, foot.v) < (toe ? TOE_STEEP : HEEL_STEEP) ? null : toe ? 'toe' : 'heel';
  }
  if (angleAt(wall, low) > 10 && dv > 35 && dv < 110 && Math.abs(foot.u - midU) > 20) return 'drop-knee';
  return null;
}

/**
 * Whether a foot up near the hands on `hold` can hook it (footTechnique's heel or toe), as the
 * solver and the climber's pose both judge it:
 * - Heel: on steep ground a heel on a big hold near hand height pulls the hips in.
 *   Needs something to hook (jug, big edge or sloper, a volume), and to be out to the side.
 * - Toe: further out (leg nearly straight), on steeper ground, the top of the foot pulls
 *   back toward the body against the hold's far side. Works on smaller holds than a heel,
 *   but only if that side faces away from the climber (a sidepull turned outward).
 * Anything else up there is stood on: a high step.
 */
export function canHook(wall: Wall, h: Hold, hands: [Point, Point], fp: Point): boolean {
  if (h.id.startsWith('arete:')) return false;
  const hiV = Math.max(hands[0].v, hands[1].v);
  if (fp.v > hiV + 10) return false;
  const midU = (hands[0].u + hands[1].u) / 2;
  const out = Math.abs(fp.u - midU);
  const angle = angleAt(wall, fp.v);
  if (out < TOE_HOOK_OUT) {
    const hookable = h.type === 'jug' || h.type === 'volume' || ((h.type === 'edge' || h.type === 'sloper') && isBig(h.size));
    return angle >= HEEL_STEEP && hookable && out >= 25;
  }
  const toeable =
    h.type === 'jug' ||
    h.type === 'volume' ||
    ((h.type === 'edge' || h.type === 'pinch') && h.size !== 's') ||
    (h.type === 'sloper' && isBig(h.size));
  if (angle < TOE_STEEP || !toeable) return false;
  // The toe pulls the hold sideways, toward the body.
  const best = bestPull(h.rot);
  const c = Math.sign(midU - fp.u) * best.u;
  const t = h.tol ?? GRIP[h.type].tolerance;
  return (c + t) / (1 + t) >= 0.35;
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
