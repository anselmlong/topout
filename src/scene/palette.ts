import type { Day, HoldType } from '../solver/types';

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

/** Volumes are fibreglass shells: one neutral colour whatever the route. */
export const VOLUME_COLOR = '#8d959e';
