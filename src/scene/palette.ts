import type { Day, HoldSize, HoldType } from '../solver/types';
import { SLOPER_MATCH_WIDTH, widthFingers } from '../solver/model';

/** Muted, neutral scene palette. UI colors mirror these in styles.css. */
export const PALETTE = {
  sky: '#d8d4cc',
  floor: '#bab5ab',
  ply: '#cdbfa6',
  plyDark: '#a8987f',
  bolt: '#6d655a',
  pad: '#5f646b',
  padTop: '#6d737a',
  tape: '#f1eee6',
  ghostOk: '#6f9a7a',
  ghostBad: '#bf5b4f',
  select: '#f4f1ea',
  climber: '#d9d1c4',
  climberDark: '#8a8174',
};

/**
 * Route colours. Like a commercial gym, every hold on a route (start, finish,
 * feet) is one colour; type is read from shape. All chosen to stand out
 * against the plywood — no creams or beiges.
 */
export const ROUTE_COLORS = [
  { name: 'red', hex: '#d4553f' },
  { name: 'blue', hex: '#3f7cc0' },
  { name: 'green', hex: '#3f9a6c' },
  { name: 'purple', hex: '#8f5cc0' },
  { name: 'pink', hex: '#dd6597' },
  { name: 'orange', hex: '#e0822f' },
  { name: 'teal', hex: '#2f969c' },
  { name: 'black', hex: '#2f3034' },
  { name: 'yellow', hex: '#e8b92f' },
];

/** The route colour for a day (practice walls: from their seed). Stable across reloads. */
export function routeColor(day: Pick<Day, 'number' | 'wall'>) {
  const key = day.number > 0 ? day.number * 7 : day.wall.seed;
  return ROUTE_COLORS[Math.abs(key) % ROUTE_COLORS.length];
}

/** Neutral swatch for type icons outside a route (help legend). */
export const NEUTRAL_HOLD = '#8a8e95';

export const HOLD_NAME: Record<HoldType, string> = {
  jug: 'Jug',
  crimp: 'Crimp',
  sloper: 'Sloper',
  pinch: 'Pinch',
  pocket: 'Pocket',
  edge: 'Edge',
  foot: 'Foot chip',
  jib: 'Jib',
  volume: 'Volume',
};

export const HOLD_HINT: Record<HoldType, string> = {
  jug: 'Deep and positive. Forgiving from most angles.',
  crimp: 'Thin edge. Needs a straight pull.',
  sloper: 'Rounded. Fine on slab, awful when steep.',
  pinch: 'Squeeze it. Pull along its length; weak across it.',
  pocket: 'Finger hole. Solid if pulled in line.',
  edge: 'Flat ledge. Honest, fairly forgiving.',
  foot: 'Feet only. Hands can’t use it.',
  jib: 'Tiny foot nub. Better than nothing.',
  volume: 'Changes the wall angle. Stand on its top, pull its sides.',
};

/** Macros (size 'xl') go by their own names. */
export const MACRO_NAME: Partial<Record<HoldType, string>> = { sloper: 'Macro', edge: 'Ledge', pinch: 'Block' };

export const MACRO_HINT: Partial<Record<HoldType, string>> = {
  sloper: 'Macro sloper: palm the rough side. Big and friendly until it gets steep.',
  edge: 'Macro ledge: a shelf a hand deep. Match it, stand on it.',
  pinch: 'Pinch block: wide squeeze. Good on steep ground, a stretch for the thumb.',
};

/**
 * How a hold's lip reads (model.ts incutRank, flattest .. deepest build of its type), and
 * what that does: the HUD names it, since on a phone a crimp is a few pixels across.
 */
const LIP_WORDS: Partial<Record<HoldType, string[]>> = {
  sloper: ['Round dome', 'Slight dish', 'Dished', 'Deep dish'],
  pinch: ['Smooth sides', 'Shaped sides', 'Sculpted sides', 'Deep-cut sides'],
  pocket: ['Open pocket', 'Shallow hood', 'Hooded', 'Deep hood'],
  foot: ['Rounded nub', 'Low shelf', 'Positive', 'Sharp shelf'],
  jib: ['Rounded nub', 'Low shelf', 'Positive', 'Sharp shelf'],
};
const LIP_DEFAULT = ['Flat lip', 'Shallow lip', 'Incut lip', 'Deep incut'];
/** Jug families in mesh order (model.ts JUG_INCUT). */
const JUG_FAMILY = ['Bucket', 'Ledge jug', 'Bucket', 'Horn', 'Pinch jug', 'Slopey jug'];

export function lipWord(type: HoldType, rank: number, variant: number): string {
  if (type === 'jug') return JUG_FAMILY[variant % JUG_FAMILY.length];
  const words = LIP_WORDS[type] ?? LIP_DEFAULT;
  return words[Math.round(rank * (words.length - 1))];
}

/** A pocket's size in fingers (model.ts pocketFingers). */
const FINGER_WORDS = ['', 'Mono', 'Two-finger', 'Three-finger', 'Four-finger slot'];
export function fingerWord(fingers: number): string {
  return FINGER_WORDS[Math.max(1, Math.min(4, Math.round(fingers)))];
}
/** What a small pocket's finger count does (three or more fingers climb on their hood). */
export function fingerEffect(fingers: number): string | null {
  return fingers <= 1 ? 'one finger: much harder' : fingers === 2 ? 'two fingers: harder' : null;
}

/** A pinch's span in words (model.ts pinchSpan), or null for one about a hand's width (or a middling pinch block). */
export function spanWord(cm: number, size: HoldSize = 'm'): string | null {
  if (size === 'xl') return cm <= 10 ? 'Narrow block' : cm >= 14 ? 'Wide block' : null;
  return cm < 4.5 ? 'Thin pinch' : cm > 7.5 ? 'Wide pinch' : null;
}
/** What a pinch's span does: a thin fin gives the thumb little to squeeze, a wide block stretches it. */
export function spanEffect(cm: number): string | null {
  return cm < 4.5 ? 'thin: harder to squeeze' : cm < 5.5 ? 'narrow: a bit harder' : cm >= 14 ? 'wide: a stretch for the thumb' : null;
}

/** A pinch's flank depth in words (model.ts pinchDepth), or null for a middling one. */
export function pinchDepthWord(mm: number): string | null {
  return mm < 22 ? 'Low' : mm >= 40 ? 'Deep' : null;
}
/** What a pinch's flank depth does: on a low one the fingers squeeze with their first pads. */
export function pinchDepthEffect(mm: number): string | null {
  return mm < 22 ? 'low sides: first pads only, harder' : mm >= 40 ? 'deep sides: the whole thumb on' : null;
}

/** A crimp's or edge's shelf depth, or a pocket's depth, in words (model.ts edgeDepth), or null for a middling one. */
export function depthWord(type: HoldType, mm: number, size: HoldSize = 'm'): string | null {
  if (type === 'pocket') return mm < 15 ? 'Shallow' : mm >= 26 ? 'Deep' : null;
  if (size === 'xl') return mm < 30 ? 'Rail ledge' : mm >= 55 ? 'Deep ledge' : null;
  if (type === 'crimp') return mm < 12 ? 'Shallow crimp' : mm >= 22 ? 'Full-pad crimp' : null;
  return mm < 22 ? 'Shallow edge' : mm >= 40 ? 'Deep edge' : null;
}
/** What a shelf's depth does: under a finger pad only the tips bite. */
export function depthEffect(type: HoldType, mm: number, size: HoldSize = 'm'): string | null {
  if (type === 'pocket') return mm < 12 ? 'shallow: first pads only, much harder' : mm < 15 ? 'shallow: first pads only, harder' : mm >= 26 ? 'deep: the fingers sink in' : null;
  if (size === 'xl') return mm < 30 ? 'a rail: fingers only, a bit harder' : mm >= 55 ? 'whole hand on: holds well' : null;
  if (mm < 12) return 'fingertips only: much harder';
  if (mm < 16) return 'shallow: harder';
  return type === 'edge' && mm < 22 ? 'shallow: a bit harder' : null;
}

/** A foot chip's depth, or how far a jib stands proud, in words (model.ts footDepth), or null for a middling one. */
export function chipWord(mm: number, type: HoldType = 'foot'): string | null {
  if (type === 'jib') return mm < 10 ? 'Low jib' : mm >= 20 ? 'Tall jib' : null;
  return mm < 13 ? 'Tiny chip' : mm >= 26 ? 'Big chip' : null;
}
/** What a foot chip's or jib's depth does: on a tiny one only the edge of the shoe bites. */
export function chipEffect(mm: number, type: HoldType = 'foot'): string | null {
  if (type === 'jib') return mm < 10 ? 'low: only the shoe edge bites, harder' : mm >= 20 ? 'tall: the toe sits on it' : null;
  return mm < 13 ? 'tiny: only the shoe edge bites, harder' : mm >= 26 ? 'big: the shoe sits on it' : null;
}

/** A crimp's or edge's length in fingers (model.ts edgeWidth), or null for one the whole hand fits on. */
export function widthWord(cm: number): string | null {
  const f = widthFingers(cm);
  return f < 2.6 ? 'Two-finger' : f < 3.6 ? 'Three-finger' : null;
}
/** What a short lip does: two fingers pull alone; a three-finger edge only drops the little finger. */
export function widthEffect(cm: number): string | null {
  return widthFingers(cm) < 2.6 ? 'two fingers wide: harder' : null;
}

/** A sloper's pitch in words (model.ts sloperPitch), or null for a middling one. */
export function pitchWord(deg: number, size: HoldSize = 'm'): string | null {
  const name = size === 'xl' ? 'macro' : 'sloper';
  return deg <= 30 ? `Flat-topped ${name}` : deg >= 48 ? `Steep ${name}` : null;
}
/** What a sloper's pitch does: the steeper its top, the less the palm presses into it. */
export function pitchEffect(deg: number): string | null {
  return deg >= 48 ? 'steep top: much harder' : deg >= 42 ? 'sloping top: harder' : deg <= 30 ? 'flat top: holds better' : null;
}

/** A sloper's width in words (model.ts sloperWidth), or null for a middling one. */
export function sloperWidthWord(cm: number): string | null {
  return cm < 10 ? 'Narrow' : cm >= 19 ? 'Wide' : null;
}
/** What a sloper's width does: on a narrow one three fingers fit; a wide one takes the palm. */
export function sloperWidthEffect(cm: number): string | null {
  return cm < 10 ? 'narrow: three fingers on, harder' : cm >= 19 ? 'wide: the whole palm spreads on it' : null;
}

/** A jug's width in words (model.ts jugWidth): whether both hands fit on it. */
export function jugWidthWord(cm: number): string {
  return cm < SLOPER_MATCH_WIDTH ? 'One-hand' : 'Two-hand';
}
/** What a narrow jug's width does: no room beside the first hand, so a swap is a finger shuffle. */
export function jugWidthEffect(cm: number): string | null {
  return cm < SLOPER_MATCH_WIDTH ? 'one hand: swapping hands is a shuffle' : null;
}

/** A jug's depth off the wall in words (model.ts jugDepth), or null for a middling one. */
export function jugDepthWord(mm: number): string | null {
  return mm < 45 ? 'Shallow' : mm >= 64 ? 'Deep' : null;
}
/** What a shallow jug's depth does: the fingers go in to the knuckle, not the palm. */
export function jugDepthEffect(mm: number): string | null {
  return mm < 45 ? 'shallow: fingers in to the knuckle, opens up steep' : null;
}

/** What a hold's lip does to it, in a few words: for a foothold, standing; else the hand. */
export function lipEffect(type: HoldType, rank: number): string {
  if (type === 'jug') return rank < 0.2 ? 'a rounded handful, rolls off steep' : rank < 0.4 ? 'a big rounded handful' : 'closes over the fingers';
  const feet = type === 'foot' || type === 'jib';
  if (rank > 0.6) return feet ? 'easy to stand on' : 'holds well, even steep';
  if (rank < 0.4) return feet ? 'half a smear' : 'harder, opens up steep';
  return feet ? 'a fair edge' : 'typical';
}

/** Volumes are fibreglass shells: one neutral colour whatever the route. */
export const VOLUME_COLOR = '#8d959e';
