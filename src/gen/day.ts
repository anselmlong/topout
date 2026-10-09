// Seeded daily brief: wall shape, fixed start/finish, hold tray, target grade.
// Curation (scripts/curate.ts) runs this, proves each day solvable, and computes par.
import { vAtHeight } from '../solver/model';
import type { Day, Hold, HoldSize, HoldType, Panel, TraySlot, Twist, Wall } from '../solver/types';
import { hash, rng, type Rng } from './rng';

/** Day #1. */
export const EPOCH = '2026-09-29';

export function dayNumber(date: Date): number {
  const e = Date.UTC(2026, 8, 29);
  const d = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((d - e) / 86_400_000) + 1;
}

export function dateOf(n: number): string {
  const d = new Date(Date.UTC(2026, 8, 29) + (n - 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export type WallStyle = 'slab' | 'vertical' | 'overhang' | 'steep' | 'headwall' | 'kicker' | 'corner' | 'arete' | 'bulge' | 'cave' | 'prow' | 'dihedral' | 'scoop' | 'rollover' | 'belly' | 'overlap' | 'ledge' | 'roof' | 'highball' | 'leaningcorner' | 'leaningarete' | 'nose';

export const STYLE_LABEL: Record<WallStyle, string> = {
  slab: 'Slab',
  vertical: 'Vertical',
  overhang: 'Overhang',
  steep: 'Steep',
  headwall: 'Headwall',
  kicker: 'Kicker',
  corner: 'Corner',
  arete: 'Arête',
  bulge: 'Bulge',
  cave: 'Cave',
  prow: 'Prow',
  dihedral: 'Steep corner',
  scoop: 'Scoop',
  rollover: 'Rollover',
  belly: 'Belly',
  overlap: 'Overlap',
  ledge: 'Ledge',
  roof: 'Roof',
  highball: 'Highball',
  leaningcorner: 'Leaning corner',
  leaningarete: 'Leaning arête',
  nose: 'Nose',
};

function makeWall(r: Rng, style: WallStyle, seed: number): Wall {
  const width = r.pick([360, 380, 400]);
  // Real gym bouldering walls run ~4.3–5 m; steep ones a bit shorter along the surface.
  const tall = r.int(430, 500);
  let panels: Panel[];
  switch (style) {
    case 'slab':
      panels = [{ length: tall, angle: -r.int(8, 18) }];
      break;
    case 'vertical':
      panels = [{ length: tall, angle: r.int(0, 5) }];
      break;
    case 'overhang':
      panels = [{ length: tall, angle: r.int(15, 25) }];
      break;
    case 'steep':
      panels = [{ length: tall - 30, angle: r.int(30, 40) }];
      break;
    case 'headwall':
      // Vertical base breaking into a steep top section.
      panels = [
        { length: r.int(190, 240), angle: 0 },
        { length: tall - 200, angle: r.int(25, 35) },
      ];
      break;
    case 'kicker':
      // Short vertical kicker under a sustained overhang (board-style).
      panels = [
        { length: 40, angle: 0 },
        { length: tall - 40, angle: r.int(20, 30) },
      ];
      break;
    case 'corner': {
      // A dihedral: two faces meeting at a vertical crease, from slabby to a little steep.
      // 60° is a wide-open book; 105° is a tight corner you can really stem.
      panels = [{ length: tall, angle: r.int(-10, 20) }];
      const fold = { u: Math.round(width * r.range(0.4, 0.6)), angle: r.pick([60, 75, 90, 105]) };
      return { width, panels, seed, fold };
    }
    case 'dihedral': {
      // An overhanging corner: two steep faces folding in toward you. Bridging feet across
      // the crease keeps weight off the arms, so it climbs easier than its angle suggests.
      panels = [{ length: tall - 30, angle: r.int(22, 32) }];
      const fold = { u: Math.round(width * r.range(0.42, 0.58)), angle: r.pick([75, 90, 105]) };
      return { width, panels, seed, fold };
    }
    case 'bulge': {
      // A steep bulge low down that rolls over into a vertical top: pull through, then stand up.
      const low = r.int(140, 190);
      panels = [
        { length: low, angle: r.int(25, 40) },
        { length: tall - low, angle: r.int(-5, 5) },
      ];
      break;
    }
    case 'cave': {
      // A gym cave: vertical base, a near-roof section, then a lip to pull over onto a short headwall.
      const base = r.int(150, 185);
      const roof = r.int(110, 140);
      panels = [
        { length: base, angle: r.int(0, 5) },
        { length: roof, angle: r.int(45, 55) },
        { length: tall - base - roof, angle: r.int(5, 15) },
      ];
      break;
    }
    case 'scoop': {
      // A curved wave wall, faceted like the plywood ones: a slabby toe that bends through
      // vertical and a gentle overhang into a steep top. Balance low, power high.
      const toe = r.int(90, 115);
      const mid = r.int(95, 120);
      const lean = r.int(95, 120);
      panels = [
        { length: toe, angle: -r.int(4, 12) },
        { length: mid, angle: r.int(2, 8) },
        { length: lean, angle: r.int(15, 22) },
        { length: Math.max(90, tall - toe - mid - lean), angle: r.int(28, 38) },
      ];
      break;
    }
    case 'rollover': {
      // A top-out wall: a sustained overhang that rolls over a rounded lip onto a slab.
      // Pull on the lip, throw a heel over it and mantle up to the finish on the slab.
      const top = r.int(95, 125);
      panels = [
        { length: tall - top, angle: r.int(18, 30) },
        { length: top, angle: -r.int(10, 22) },
      ];
      return { width, panels, seed, lip: true };
    }
    case 'belly': {
      // A mid-height belly: a slabby start on smears, a steep bulge to pull through,
      // then the wall rolls back past vertical and you stand up onto your feet again.
      const toe = r.int(125, 150);
      const belly = r.int(90, 120);
      panels = [
        { length: toe, angle: -r.int(4, 10) },
        { length: belly, angle: r.int(25, 35) },
        { length: tall - toe - belly, angle: -r.int(2, 10) },
      ];
      break;
    }
    case 'overlap': {
      // A slab with a roof band across it: a short, steep step (an overlap) you reach
      // over, grab by its rounded lip and mantle past, back onto smears on the slab above.
      // Balance below, one burly pull through the roof, then balance again.
      const toe = r.int(170, 225);
      const roof = r.int(38, 55);
      panels = [
        { length: toe, angle: -r.int(8, 16) },
        { length: roof, angle: r.int(45, 60) },
        { length: tall - toe - roof, angle: -r.int(6, 14) },
      ];
      return { width, panels, seed, lip: true };
    }
    case 'ledge': {
      // A mantle shelf: a near-vertical wall with a flat ledge across it, a short headwall above.
      // Grab the ledge's edge, get a heel or foot up onto it, press it out and stand up on
      // the shelf; then the headwall starts from your feet, a step back from the wall below.
      const base = r.int(195, 235);
      const shelf = r.int(24, 32);
      panels = [
        { length: base, angle: r.int(0, 8) },
        { length: shelf, angle: -r.int(70, 78) },
        { length: tall - base - shelf - 20, angle: r.int(0, 12) },
      ];
      return { width, panels, seed, lip: true };
    }
    case 'roof': {
      // A gym roof: a short vertical base, then the wall goes nearly flat overhead and you
      // climb out along its underside, feet on and toes hooked, to a rounded lip at its
      // front edge. Grab the lip, get a heel over it and pull onto the headwall above.
      const base = r.int(120, 150);
      const roof = r.int(100, 130);
      panels = [
        { length: base, angle: r.int(0, 5) },
        { length: roof, angle: r.int(65, 80) },
        { length: tall - base - roof, angle: r.int(0, 10) },
      ];
      return { width, panels, seed, lip: true };
    }
    case 'highball': {
      // The gym's tall wall: 5.6-6.2 m of near-vertical to gently overhanging plywood over a
      // deep pad. Half as many moves again as a normal problem, so the pump and the rests count.
      panels = [{ length: r.int(560, 620), angle: r.int(-2, 12) }];
      break;
    }
    case 'leaningcorner': {
      // A corner that kicks out: a vertical dihedral to stem up, breaking into an overhanging
      // one above. The crease leans out at the break while each face keeps its level lines,
      // so the stems still work up high, but the arms take over as the corner tips past you.
      const low = r.int(170, 230);
      panels = [
        { length: low, angle: r.int(-3, 5) },
        { length: tall - 20 - low, angle: r.int(18, 30) },
      ];
      const fold = { u: Math.round(width * r.range(0.42, 0.58)), angle: r.pick([75, 90, 105]) };
      return { width, panels, seed, fold };
    }
    case 'leaningarete': {
      // An arête that leans out higher up: balance up a vertical edge, then the nose tips over
      // the mat and becomes a steep prow to slap, squeeze and heel-hook to the top.
      const low = r.int(170, 230);
      panels = [
        { length: low, angle: r.int(-4, 4) },
        { length: tall - 20 - low, angle: r.int(16, 28) },
      ];
      const fold = { u: Math.round(width * r.range(0.42, 0.58)), angle: -r.pick([55, 70, 85]) };
      return { width, panels, seed, fold };
    }
    case 'nose': {
      // A sit start under an overhanging nose: a steep prow low down that stands up into a
      // vertical arête. Squeeze and heel-hook the nose to get established, then the feet come
      // back under you and it turns into balance: laybacks and smears up the edge to the top.
      const low = r.int(140, 190);
      panels = [
        { length: low, angle: r.int(25, 38) },
        { length: tall - 10 - low, angle: r.int(-6, 4) },
      ];
      const fold = { u: Math.round(width * r.range(0.42, 0.58)), angle: -r.pick([55, 70, 85]) };
      return { width, panels, seed, fold };
    }
    case 'arete': {
      // An outside corner: faces turned away, the edge itself a hold. Sharper is juggier.
      panels = [{ length: tall, angle: r.int(-5, 15) }];
      const fold = { u: Math.round(width * r.range(0.4, 0.6)), angle: -r.pick([40, 55, 70, 85]) };
      return { width, panels, seed, fold };
    }
    case 'prow': {
      // An overhanging arête: two steep faces leaning out over the mat, meeting at a
      // blunt nose you squeeze, slap up and heel-hook. Steep ones are a bit shorter.
      panels = [{ length: tall - 40, angle: r.int(20, 32) }];
      const fold = { u: Math.round(width * r.range(0.42, 0.58)), angle: -r.pick([50, 65, 80]) };
      return { width, panels, seed, fold };
    }
  }
  return { width, panels, seed };
}

/** A single-panel wall longer than this (cm) is a highball; every other wall tops out by 5 m. */
const HIGHBALL = 530;

export function wallStyleOf(wall: Wall): WallStyle {
  if (wall.fold) {
    if (wall.panels.length > 1) {
      if (wall.fold.angle < 0 && wall.panels[0].angle > wall.panels[1].angle + 15) return 'nose';
      return wall.fold.angle > 0 ? 'leaningcorner' : 'leaningarete';
    }
    const a = wall.panels[0].angle;
    if (wall.fold.angle > 0) return a > 20 ? 'dihedral' : 'corner';
    return a >= 18 ? 'prow' : 'arete';
  }
  if (wall.lip) return wall.panels.length !== 3 ? 'rollover' : wall.panels[1].angle < -45 ? 'ledge' : wall.panels[0].angle >= 0 ? 'roof' : 'overlap';
  const p = wall.panels;
  if (p.length === 4) return 'scoop';
  if (p.length === 3) return p[0].angle < 0 ? 'belly' : 'cave';
  if (p.length === 2) {
    if (p[0].angle > p[1].angle + 15) return 'bulge';
    return p[0].length > 100 ? 'headwall' : 'kicker';
  }
  if (p[0].length > HIGHBALL) return 'highball';
  const a = p[0].angle;
  if (a < 0) return 'slab';
  if (a < 10) return 'vertical';
  if (a < 28) return 'overhang';
  return 'steep';
}

/** Target grade by weekday (Mon easiest → Fri hardest), nudged by wall style. */
const WEEKDAY_GRADE = [3, 1, 2, 3, 4, 5, 4]; // Sun..Sat

const STYLE_BY_WEEKDAY: WallStyle[][] = [
  ['overhang', 'headwall', 'kicker', 'corner', 'arete', 'leaningcorner'], // Sun
  ['vertical', 'slab', 'overhang', 'corner'], // Mon
  ['vertical', 'overhang', 'slab', 'corner', 'arete', 'overlap', 'ledge', 'highball'], // Tue
  ['overhang', 'kicker', 'vertical', 'corner', 'bulge', 'scoop', 'rollover', 'belly', 'ledge', 'highball'], // Wed
  ['overhang', 'headwall', 'steep', 'corner', 'arete', 'prow', 'scoop', 'belly', 'overlap', 'roof', 'highball', 'leaningcorner', 'leaningarete', 'nose'], // Thu
  ['steep', 'kicker', 'headwall', 'bulge', 'cave', 'prow', 'dihedral', 'leaningarete'], // Fri
  ['overhang', 'steep', 'headwall', 'corner', 'bulge', 'cave', 'prow', 'dihedral', 'scoop', 'rollover', 'belly', 'overlap', 'ledge', 'roof', 'nose'], // Sat
];

/** One or two volumes for a day's tray; they change the wall under the route. */
function volumeSlots(r: Rng): TraySlot[] {
  const volumes: TraySlot[] = [];
  const n = r.pick([1, 1, 2]);
  for (let i = 0; i < n; i++) {
    const shape = r.pick(['pyramid', 'wedge'] as const);
    const size = r.pick(['s', 'l'] as const);
    const slot = volumes.find((v) => v.shape === shape && v.size === size);
    if (slot) slot.count++;
    else volumes.push({ type: 'volume', shape, size, count: 1 });
  }
  return volumes;
}

/**
 * Days curated before volumes existed have none in their tray. Give them a
 * deterministic set (same for everyone on that day) until they're regenerated.
 */
export function withVolumes(day: Day): Day {
  if (day.tray.some((s) => s.type === 'volume')) return day;
  return { ...day, tray: [...volumeSlots(rng(hash(day.number, 0x7011))), ...day.tray] };
}

/**
 * Some days hand out a spray-wall tray, like the board in the corner of a gym: many small
 * holds of every type and a few macros. From V2 up (a V0 wants a ladder of big holds) and
 * never on a traverse. `lean` decides it, and whether a plain day gets one macro, from its
 * own stream so a plain day without one draws the tray it always did.
 */
function trayLean(lean: Rng, grade: number, twist?: Twist): { spray: boolean; macros: number } {
  const spray = grade >= 2 && twist !== 'traverse' && lean.chance(0.25);
  const macros = spray ? lean.int(2, 3) : lean.chance(0.35) ? 1 : 0;
  return { spray, macros };
}

function makeTray(r: Rng, style: WallStyle, grade: number, twist: Twist | undefined, lean: Rng, spray: boolean, macros: number): TraySlot[] {
  // Easier days and steeper walls get kinder holds.
  const steep = style === 'steep' || style === 'kicker' || style === 'headwall' || style === 'bulge' || style === 'cave' || style === 'prow' || style === 'dihedral' || style === 'scoop' || style === 'rollover' || style === 'belly' || style === 'roof' || style === 'leaningcorner' || style === 'leaningarete' || style === 'nose';
  // Jugs are a treat, not the default: a few on easy or steep days, a couple otherwise.
  const weights: Record<Exclude<HoldType, 'foot' | 'jib' | 'volume'>, number> = {
    jug: Math.max(0.4, 2 - grade * 0.4) + (steep ? 0.4 : 0),
    edge: 2 + (steep ? 0.6 : 0),
    crimp: 1 + grade * 0.5 + (style === 'vertical' || style === 'slab' ? 1 : 0),
    sloper: style === 'slab' || style === 'overlap' ? 2.5 : steep ? 0.6 : 1.2,
    pinch: 1.2 + grade * 0.3,
    pocket: 1.2,
  };
  if (twist === 'no-jugs') weights.jug = 0;
  // A spray wall is a bit of everything: the mix evens out toward one of each type.
  if (spray) {
    const types = Object.keys(weights) as (keyof typeof weights)[];
    const mean = types.reduce((s, t) => s + weights[t], 0) / types.length;
    for (const t of types) if (weights[t] > 0) weights[t] = (weights[t] + mean) / 2;
  }

  // A highball is half as long again: the extra moves need more holds; a spray wall has plenty.
  const handCount = r.int(12, 15) + (style === 'highball' ? 5 : 0) + (spray ? 5 : 0);
  const counts = new Map<string, TraySlot>();
  const types = Object.keys(weights) as (keyof typeof weights)[];
  const total = types.reduce((s, t) => s + weights[t], 0);
  for (let i = 0; i < handCount; i++) {
    let x = r.next() * total;
    let type = types[0];
    for (const t of types) {
      x -= weights[t];
      if (x <= 0) {
        type = t;
        break;
      }
    }
    // Big holds read well on a phone and are what new setters reach for: L as often as M.
    // A spray wall's holds run small: mostly S and M.
    const size: HoldSize = spray ? r.pick(['s', 's', 'm', 'm', 'l']) : r.pick(['s', 'm', 'l', 'l']);
    const key = `${type}:${size}`;
    const slot = counts.get(key) ?? { type, size, count: 0 };
    slot.count++;
    counts.set(key, slot);
  }
  // A V0-V2 brief wants a ladder of big holds, and a phone wants holds big enough to see:
  // top the easy days up with L jugs (L edges with no jugs) so the draw can't leave them short.
  const isBig = (s: TraySlot) => s.type === 'jug' || (s.type === 'edge' && s.size === 'l');
  const big = [...counts.values()].filter(isBig).reduce((n, s) => n + s.count, 0);
  const bigType = twist === 'no-jugs' ? 'edge' : 'jug';
  for (let i = big; i < ([5, 4, 3][grade] ?? 0); i++) {
    const key = `${bigType}:l`;
    const slot = counts.get(key) ?? { type: bigType, size: 'l', count: 0 };
    slot.count++;
    counts.set(key, slot);
  }
  // Macros: a sloper is no gift on a steep wall, so steep days lean to ledges and blocks.
  for (let i = 0; i < macros; i++) {
    const type = lean.pick(steep ? (['edge', 'pinch', 'pinch', 'sloper'] as const) : (['sloper', 'sloper', 'edge', 'pinch'] as const));
    const key = `${type}:xl`;
    const slot = counts.get(key) ?? { type, size: 'xl', count: 0 };
    slot.count++;
    counts.set(key, slot);
  }
  const feet = (twist === 'no-smear' ? r.int(8, 10) : r.int(5, 7)) + (style === 'highball' ? 3 : 0) + (spray ? 2 : 0);
  const jibs = r.int(3, 5);
  const order: HoldType[] = ['jug', 'edge', 'pocket', 'pinch', 'sloper', 'crimp'];
  const sizes: HoldSize[] = ['xl', 'l', 'm', 's'];
  const slots = [...counts.values()].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type) || sizes.indexOf(a.size) - sizes.indexOf(b.size),
  );
  return [...volumeSlots(r), ...slots, { type: 'foot', size: 'm', count: feet }, { type: 'jib', size: 'm', count: jibs }];
}

/** Angle range per style for practice (multi-panel walls, leaning corners and arêtes, and noses: the top panel; caves, bellies, overlaps and roofs: the steep middle; rollovers: the overhang; ledges: the headwall). */
export const ANGLE_RANGE: Record<WallStyle, [number, number]> = {
  slab: [-25, -5],
  vertical: [0, 8],
  overhang: [10, 28],
  steep: [28, 50],
  headwall: [20, 45],
  kicker: [15, 40],
  corner: [-10, 20],
  arete: [-5, 15],
  bulge: [-5, 8],
  cave: [40, 60],
  prow: [18, 40],
  dihedral: [21, 40],
  scoop: [25, 45],
  rollover: [15, 35],
  belly: [20, 40],
  overlap: [40, 60],
  ledge: [-5, 20],
  roof: [60, 85],
  highball: [-8, 20],
  leaningcorner: [12, 35],
  leaningarete: [12, 35],
  nose: [-8, 6],
};

export const ALL_STYLES = Object.keys(ANGLE_RANGE) as WallStyle[];

/** Practice mode picks the wall itself; empty overrides reproduce the daily puzzle. */
export interface DayOverrides {
  style?: WallStyle;
  angle?: number;
  grade?: number;
  /** null = explicitly no twist. */
  twist?: Twist | null;
  tray?: 'practice';
}

function practiceTray(twist?: Twist): TraySlot[] {
  const slots: TraySlot[] = [
    { type: 'volume', shape: 'pyramid', size: 'l', count: 1 },
    { type: 'volume', shape: 'pyramid', size: 's', count: 1 },
    { type: 'volume', shape: 'wedge', size: 'l', count: 1 },
    { type: 'jug', size: 'm', count: 2 },
    { type: 'edge', size: 'l', count: 2 },
    { type: 'edge', size: 'm', count: 3 },
    { type: 'pocket', size: 'm', count: 2 },
    { type: 'pinch', size: 'm', count: 2 },
    { type: 'pinch', size: 's', count: 1 },
    { type: 'sloper', size: 'm', count: 2 },
    { type: 'crimp', size: 'l', count: 2 },
    { type: 'crimp', size: 'm', count: 3 },
    { type: 'crimp', size: 's', count: 2 },
    { type: 'sloper', size: 'xl', count: 1 },
    { type: 'edge', size: 'xl', count: 1 },
    { type: 'pinch', size: 'xl', count: 1 },
    { type: 'foot', size: 'm', count: 10 },
    { type: 'jib', size: 'm', count: 6 },
  ];
  return twist === 'no-jugs' ? slots.filter((s) => s.type !== 'jug') : slots;
}

/** Generate an uncurated day. `variant` lets curation reroll unsolvable days. */
export function generateDay(n: number, variant = 0, o: DayOverrides = {}): Omit<Day, 'par'> & { par: number } {
  const date = dateOf(n);
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const r = rng(hash(n, variant, 0x70b0));
  const weekend = weekday === 0 || weekday === 6;
  const twistDraw: Twist | undefined = weekend ? r.pick(['no-jugs', 'traverse', 'no-smear'] as const) : undefined;
  const twist = o.twist !== undefined ? (o.twist ?? undefined) : twistDraw;

  const style = o.style ?? r.pick(STYLE_BY_WEEKDAY[weekday]);
  const wall = makeWall(r, style, hash(n, variant));
  if (o.angle !== undefined) wall.panels[style === 'cave' || style === 'belly' || style === 'overlap' || style === 'roof' ? 1 : style === 'rollover' ? 0 : wall.panels.length - 1].angle = o.angle;
  const height = wall.panels.reduce((h, p) => h + p.length, 0);
  let targetGrade = WEEKDAY_GRADE[weekday] + (style === 'slab' ? -1 : style === 'steep' || style === 'cave' || style === 'roof' ? 1 : 0);
  targetGrade = Math.max(0, Math.min(8, targetGrade + r.pick([-1, 0, 0, 1])));
  // Nobody sets a V1 through a 50° cave, or up a steep prow; climbing out a roof is V4 at the least.
  if (style === 'cave' || style === 'prow') targetGrade = Math.max(3, targetGrade);
  if (style === 'roof') targetGrade = Math.max(4, targetGrade);
  if (style === 'rollover' || style === 'belly' || style === 'overlap' || style === 'ledge' || style === 'leaningcorner') targetGrade = Math.max(2, targetGrade);
  if (style === 'leaningarete' || style === 'nose') targetGrade = Math.max(3, targetGrade);
  if (o.grade !== undefined) targetGrade = o.grade;

  const lean = rng(hash(n, variant, 0x5b7a));
  const tl = trayLean(lean, targetGrade, twist);

  const margin = 50;
  let start: Hold[];
  let finish: Hold;
  // Start by real height above the floor: on an overhang, v along the wall sits lower.
  let startV = Math.round(vAtHeight(wall, r.int(125, 160)));
  // A roof problem starts at the back, under the roof, and climbs out along it.
  if (style === 'roof') startV = wall.panels[0].length - r.int(8, 22);
  if (twist === 'traverse') {
    const leftToRight = r.chance(0.5);
    const su = leftToRight ? r.int(margin, margin + 40) : wall.width - r.int(margin, margin + 40);
    const fu = leftToRight ? wall.width - r.int(margin, margin + 30) : r.int(margin, margin + 30);
    start = [
      { id: 'start-0', type: 'jug', size: 'l', u: su - 20, v: startV, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'l', u: su + 20, v: startV, rot: 0, role: 'start' },
    ];
    finish = { id: 'finish', type: 'jug', size: 'l', u: fu, v: r.int(230, 270), rot: 0, role: 'finish' };
  } else {
    // Corners start near the crease, so stemming is on the table from the first move.
    const su = wall.fold ? wall.fold.u + r.int(-35, 35) : r.int(margin + 40, wall.width - margin - 40);
    const twoHands = r.chance(0.6);
    start = twoHands
      ? [
          { id: 'start-0', type: 'jug', size: 'm', u: su - r.int(18, 30), v: startV + r.int(-8, 8), rot: 0, role: 'start' },
          { id: 'start-1', type: 'jug', size: 'm', u: su + r.int(18, 30), v: startV + r.int(-8, 8), rot: 0, role: 'start' },
        ]
      : [{ id: 'start-0', type: 'jug', size: 'l', u: su, v: startV, rot: 0, role: 'start' }];
    finish = {
      id: 'finish',
      type: 'jug',
      size: 'l',
      u: r.int(margin + 20, wall.width - margin - 20),
      v: height - r.int(30, 45),
      rot: 0,
      role: 'finish',
    };
  }

  return {
    number: n,
    date,
    wall,
    start,
    finish,
    tray: o.tray === 'practice' ? practiceTray(twist) : makeTray(r, style, targetGrade, twist, lean, tl.spray, tl.macros),
    targetGrade,
    twist,
    ...(tl.spray && o.tray !== 'practice' ? { spray: true } : {}),
    par: 0,
  };
}

export const TWIST_LABEL: Record<Twist, string> = {
  'no-jugs': 'No jugs',
  traverse: 'Traverse',
  'no-smear': 'No smearing',
};
