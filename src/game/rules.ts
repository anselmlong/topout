// Placement and scoring rules shared by the game UI and the curation script.
import { angleAt, lipV, PAD, SHELF_ANGLE, vAtHeight, wallHeight } from '../solver/model';
import type { Hold, HoldSize, HoldType, SolveResult, Volume, Wall } from '../solver/types';
import { volumeRadius } from '../solver/volumes';
import type { Spots } from './spots';

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
  volume: 0,
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
  if (h.v < vAtHeight(wall, PAD) + 2 + r || h.v > wallHeight(wall) - EDGE - r) return false;
  // A rollover lip is a rounded edge: nothing bolts onto the roll itself.
  if (wall.lip && Math.abs(h.v - lipV(wall)) < r + 4) return false;
  // A ledge's shelf is for standing on, not bolting to.
  if (angleAt(wall, h.v) < SHELF_ANGLE || angleAt(wall, h.v - r) < SHELF_ANGLE || angleAt(wall, h.v + r) < SHELF_ANGLE) return false;
  for (const o of others) {
    if (o.id === h.id) continue;
    if (Math.hypot(o.u - h.u, o.v - h.v) < r + holdRadius(o) + MIN_GAP) return false;
  }
  return true;
}

/**
 * Volumes: inside the wall and above the pad, on a single panel (not across the
 * headwall kink), clear of other volumes and of the fixed start/finish holds.
 * Placed holds may sit on a volume; they're not in `fixed`.
 */
export function canPlaceVolume(wall: Wall, volumes: Volume[], fixed: Hold[], vol: Volume): boolean {
  const r = volumeRadius(vol);
  if (vol.u < EDGE + r * 0.75 || vol.u > wall.width - EDGE - r * 0.75) return false;
  if (vol.v - r * 0.75 < vAtHeight(wall, PAD) + 4 || vol.v + r * 0.75 > wallHeight(wall) - EDGE) return false;
  let top = 0;
  for (const p of wall.panels) {
    const bottom = top;
    top += p.length;
    const lo = vol.v - r * 0.75;
    const hi = vol.v + r * 0.75;
    if (lo < top && hi > bottom && (lo < bottom || hi > top)) return false;
  }
  // Not across a dihedral's crease.
  if (wall.fold && Math.abs(vol.u - wall.fold.u) < r * 0.75) return false;
  for (const o of volumes) {
    if (o.id === vol.id) continue;
    if (Math.hypot(o.u - vol.u, o.v - vol.v) < (r + volumeRadius(o)) * 0.8) return false;
  }
  for (const h of fixed) if (Math.hypot(h.u - vol.u, h.v - vol.v) < r * 0.8 + holdRadius(h)) return false;
  return true;
}

export const MAX_TESTS = 3;
/** A route passes if its grade rounds to within this many grades of the target. */
export const TOLERANCE = 1;

export type Verdict = 'exact' | 'pass' | 'fail';

export interface TestRun {
  holds: Hold[];
  /** Volumes on the wall when this was solved (older saves have none). */
  volumes?: Volume[];
  /** The start/finish holds it was solved on (older saves: the day's jugs). */
  spots?: Spots;
  result: SolveResult;
  verdict: Verdict;
  /** Holds plus volumes: each volume counts as one. */
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
