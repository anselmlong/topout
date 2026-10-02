// Hand-built example routes anyone can watch from the help and the grade guide.
// Each one is a whole wall and route, independent of the daily archive, so it
// exists on day 1 and spoils nothing:  ?example=<id>
import { dateOf, dayNumber, generateDay } from '../gen/day';
import type { Day, Hold, HoldSize, HoldType } from '../solver/types';
import { canPlace } from './rules';
import { spotsOf } from './spots';

export interface Example {
  id: string;
  /** The grade it's set at (and tested to land within half a grade of). */
  grade: number;
  title: string;
  /** One line on why it gets its grade. */
  note: string;
  day: Day;
  holds: Hold[];
}

const WIDTH = 360;
const LENGTH = 440;
const START_V = 150;
const FINISH_V = LENGTH - 40;

/** A plain single-panel wall with two start jugs and a finish jug up the middle. */
function wallDay(angle: number, grade: number): Day {
  // The practice tray, so the setter can try their own version on the same wall.
  const tray = generateDay(1, 0, { style: 'vertical', grade, twist: null, tray: 'practice' }).tray;
  return {
    number: 0,
    date: dateOf(dayNumber(new Date())),
    wall: { width: WIDTH, panels: [{ length: LENGTH, angle }], seed: 4242 },
    start: [
      { id: 'start-0', type: 'jug', size: 'l', u: WIDTH / 2 - 20, v: START_V, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'l', u: WIDTH / 2 + 20, v: START_V, rot: 0, role: 'start' },
    ],
    finish: { id: 'finish', type: 'jug', size: 'l', u: WIDTH / 2, v: FINISH_V, rot: 0, role: 'finish' },
    tray,
    targetGrade: grade,
    par: 0,
  };
}

interface Ladder {
  type: HoldType;
  size: HoldSize;
  /** Vertical gap between hand holds (cm). */
  spacing: number;
  /** Half the zig-zag width (cm). */
  swing: number;
  /** Foot chips stepping up underneath, or none (smear). */
  feet: boolean;
}

/** Hand holds zig-zagging from Start to Finish, with foot chips stepping up under them. */
function ladder(l: Ladder, day: Day): Hold[] {
  const holds: Hold[] = [];
  const mid = WIDTH / 2;
  let i = 0;
  for (let v = START_V + l.spacing; v < FINISH_V - l.spacing / 2; v += l.spacing, i++) {
    const side = i % 2 ? 1 : -1;
    holds.push({ id: `p${i + 1}`, type: l.type, size: l.size, u: mid + side * l.swing, v, rot: 0 });
  }
  if (l.feet)
    for (let v = 55, j = 0; v < FINISH_V - 120; v += 38, j++) {
      const foot: Hold = { id: `p${100 + j}`, type: 'foot', size: 'm', u: mid + (j % 2 ? 16 : -16), v, rot: 0 };
      // A chip that would crowd a handhold is left out, as a setter would.
      if (canPlace(day.wall, [...spotsOf(day), ...holds], foot)) holds.push(foot);
    }
  return holds;
}

const route = (day: Day, l: Ladder) => ({ day, holds: ladder(l, day) });

export const EXAMPLES: Example[] = [
  {
    id: 'jug-ladder',
    grade: 0,
    title: 'Jug ladder',
    note: 'Big jugs an easy reach apart on a vertical wall, a foothold under every move.',
    ...route(wallDay(0, 0), { type: 'jug', size: 'm', spacing: 45, swing: 28, feet: true }),
  },
  {
    id: 'vertical-crimps',
    grade: 3,
    title: 'Vertical crimps',
    note: 'Same wall, crimps half a metre apart: every move is a hard pull on fingertips.',
    ...route(wallDay(0, 3), { type: 'crimp', size: 'l', spacing: 50, swing: 28, feet: true }),
  },
  {
    id: 'slab-smears',
    grade: 3,
    title: 'Slab, no feet',
    note: 'A slab is easy on the arms, but with crimps and no footholds you balance on smears.',
    ...route(wallDay(-15, 3), { type: 'crimp', size: 'm', spacing: 50, swing: 28, feet: false }),
  },
  {
    id: 'overhang-edges',
    grade: 5,
    title: '30° overhang edges',
    note: 'Medium edges on a 30° overhang: the wall leans on your arms and the feet want to cut.',
    ...route(wallDay(30, 5), { type: 'edge', size: 'm', spacing: 55, swing: 28, feet: true }),
  },
];

export const findExample = (id: string | null) => EXAMPLES.find((e) => e.id === id) ?? null;
