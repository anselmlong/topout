import { describe, expect, it } from 'vitest';
import { generateDay } from '../gen/day';
import { solve } from '../solver/solve';
import type { Hold, SolveResult } from '../solver/types';
import { verdictOf, type TestRun } from './rules';
import { gapLabel, setterTip } from './tips';

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
