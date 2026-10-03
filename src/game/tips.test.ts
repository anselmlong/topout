import { describe, expect, it } from 'vitest';
import { generateDay } from '../gen/day';
import { solve } from '../solver/solve';
import type { Hold, SolveResult } from '../solver/types';
import { verdictOf, type TestRun } from './rules';
import { gapLabel, gradeDrivers, gradeTone, moveGrade, setterTip } from './tips';
import { ANCHORS, ANCHOR_START as ROUTE_START, anchorRoute, gradeAnchor } from '../../scripts/calibrate';
import { moveDifficulty, moveParts } from '../solver/solve';


const run = (result: SolveResult, holds: Hold[] = []): TestRun => ({ holds, result, verdict: verdictOf(result, 4), holdCount: holds.length });

describe('setter tips', () => {
  it('labels the gap to the brief', () => {
    expect(gapLabel(0.3)).toBe('on grade');
    expect(gapLabel(1)).toBe('1.0 grade stiff');
    expect(gapLabel(-1.6)).toBe('1.6 grades soft');
  });

  it('says where an unfinished route stalls', () => {
    const day = generateDay(5);
    const result = solve(day.wall, day.start, day.finish, []);
    expect(result.ok).toBe(false);
    const tip = setterTip(day, run(result));
    expect(tip).toBeTruthy();
    if (!result.ok && result.reason === 'unreachable') expect(tip).toMatch(/Stuck at \d\.\d m/);
  });

  it('is quiet on grade and points the right way off it', () => {
    const day = { ...generateDay(5), targetGrade: 4 };
    const ok = (grade: number): SolveResult => ({ ok: true, grade, crux: 1, moves: [], start: {} as never });
    expect(setterTip(day, run(ok(4.2)))).toBeNull();
    expect(setterTip(day, run(ok(2)))).toMatch(/soft/);
    expect(setterTip(day, run(ok(6.5)))).toMatch(/stiff/);
  });
});

describe('grade drivers', () => {
  // Rebuild real calibration routes as days, so the breakdown runs on the solver's own beta.
  const day = (name: string) => {
    const a = ANCHORS.find((x) => x.name === name)!;
    const { wall, holds, finish } = anchorRoute(a);
    const result = gradeAnchor(a);
    const d = { ...generateDay(5), wall, start: ROUTE_START, finish, targetGrade: 0 };
    return { d, test: run(result, holds), result };
  };

  it('rebuilds every move of the beta exactly from its parts', () => {
    for (const a of ANCHORS) {
      const { wall, holds, finish } = anchorRoute(a);
      const r = gradeAnchor(a);
      if (!r.ok) continue;
      for (const m of r.moves) expect(moveDifficulty(moveParts(wall, ROUTE_START, finish, holds, m)!)).toBeCloseTo(m.difficulty, 9);
    }
  });

  it('names what makes the classic problems hard', () => {
    const top = (name: string) => gradeDrivers(day(name).d, day(name).test).map((x) => x.key);
    expect(top('40° jugs')[0]).toBe('steep');
    expect(top('40° slopers')[0]).toBe('hold');
    expect(top('vertical jug dyno')[0]).toBe('reach');
    expect(top('slab crimps, smears')).toContain('feet');
    expect(top('slab jugs')).toEqual([]);
  });

  it('turns the biggest driver into the tip on a stiff route', () => {
    const { d, test } = day('40° slopers');
    expect(setterTip(d, test)).toMatch(/hangs off the big sloper/);
  });
});

describe('move grades', () => {
  it('grades a lone move like a one-move route', () => {
    for (const anchor of ANCHORS) {
      const a = gradeAnchor(anchor);
      if (!a.ok) continue;
      const hardest = Math.max(...a.moves.map((m) => moveGrade(m.difficulty)));
      // The crux move alone, before any pump: never above the route's grade, at most the pump below it.
      expect(hardest).toBeLessThanOrEqual(a.grade + 1e-9);
      expect(hardest).toBeGreaterThan(a.grade - 0.61);
    }
  });

  it('tones moves against the brief, not against the route', () => {
    expect(gradeTone(0, 0)).toBe(0.5);
    expect(gradeTone(2, 5)).toBe(0);
    expect(gradeTone(8, 5)).toBe(1);
    expect(gradeTone(5.6, 5)).toBeGreaterThan(gradeTone(4.4, 5));
  });
});
