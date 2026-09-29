// Placement and scoring rules shared by the game UI and the curation script.
import { PAD, wallHeight } from '../solver/model';
import type { Hold, HoldSize, HoldType, SolveResult, Wall } from '../solver/types';

const BASE_RADIUS: Record<HoldType, number> = {
  // Roughly the drawn half-width (see holdGeometry SIZE); keep the two in step.
  jug: 9,
  crimp: 7,
  sloper: 11,
  pinch: 8,
  pocket: 7,
  edge: 9,
  foot: 3.5,
  jib: 2.5,
};
const SIZE_SCALE: Record<HoldSize, number> = { s: 0.8, m: 1, l: 1.25 };

export const holdRadius = (h: Pick<Hold, 'type' | 'size'>) => BASE_RADIUS[h.type] * SIZE_SCALE[h.size];

/** Minimum clear gap between two holds, in cm. */
export const MIN_GAP = 4;
const EDGE = 8;

export function canPlace(wall: Wall, others: Hold[], h: Hold): boolean {
  const r = holdRadius(h);
  if (h.u < EDGE + r || h.u > wall.width - EDGE - r) return false;
  // Nothing below the crash pad.
  if (h.v < PAD + 2 + r || h.v > wallHeight(wall) - EDGE - r) return false;
  for (const o of others) {
    if (o.id === h.id) continue;
    if (Math.hypot(o.u - h.u, o.v - h.v) < r + holdRadius(o) + MIN_GAP) return false;
  }
  return true;
}

export const MAX_TESTS = 3;
/** A route passes if its grade rounds to within this many grades of the target. */
export const TOLERANCE = 1;

export type Verdict = 'exact' | 'pass' | 'fail';

export interface TestRun {
  holds: Hold[];
  result: SolveResult;
  verdict: Verdict;
  holdCount: number;
}

export function verdictOf(result: SolveResult, target: number): Verdict {
  if (!result.ok) return 'fail';
  const g = Math.round(result.grade);
  if (g === target) return 'exact';
  if (Math.abs(g - target) <= TOLERANCE) return 'pass';
  return 'fail';
}

const RANK: Record<Verdict, number> = { exact: 0, pass: 1, fail: 2 };

/** Best of the tests: exact > pass > fail, then fewer holds, then closer grade. */
export function bestTest(tests: TestRun[], target: number): TestRun | undefined {
  return [...tests].sort((a, b) => {
    const r = RANK[a.verdict] - RANK[b.verdict];
    if (r) return r;
    const h = a.holdCount - b.holdCount;
    if (a.verdict !== 'fail' && h) return h;
    const ga = a.result.ok ? Math.abs(a.result.grade - target) : Infinity;
    const gb = b.result.ok ? Math.abs(b.result.grade - target) : Infinity;
    return ga - gb;
  })[0];
}

export const holds = (n: number) => `${n} ${n === 1 ? 'hold' : 'holds'}`;

export const SQUARE: Record<Verdict, string> = { exact: '🟩', pass: '🟨', fail: '🟥' };
