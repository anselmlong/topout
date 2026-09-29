import { describe, expect, it } from 'vitest';
import { generateDay } from '../gen/day';
import type { Hold, SolveResult } from '../solver/types';
import { bestTest, canPlace, verdictOf, type TestRun } from './rules';
import { decodeRoute, encodeRoute, shareText } from './share';

const ok = (grade: number): SolveResult => ({ ok: true, grade, crux: 0, moves: [], start: {} as never });
const fail: SolveResult = { ok: false, reason: 'unreachable', message: '' };

describe('verdicts', () => {
  it('rounds to target for exact, ±1 for pass', () => {
    expect(verdictOf(ok(4.4), 4)).toBe('exact');
    expect(verdictOf(ok(4.6), 4)).toBe('pass');
    expect(verdictOf(ok(2.4), 4)).toBe('fail');
    expect(verdictOf(fail, 4)).toBe('fail');
  });

  it('prefers exact, then fewer holds', () => {
    const run = (result: SolveResult, holdCount: number): TestRun => ({
      holds: [],
      result,
      verdict: verdictOf(result, 4),
      holdCount,
    });
    const tests = [run(ok(5.2), 3), run(ok(4.1), 6), run(ok(3.9), 5)];
    expect(bestTest(tests, 4)!.holdCount).toBe(5);
  });
});

describe('placement', () => {
  const day = generateDay(5);
  const h = (u: number, v: number): Hold => ({ id: 'x', type: 'crimp', size: 'm', u, v, rot: 0 });
  it('rejects overlaps and out-of-bounds', () => {
    expect(canPlace(day.wall, [], h(200, 200))).toBe(true);
    expect(canPlace(day.wall, [{ ...h(205, 200), id: 'y' }], h(200, 200))).toBe(false);
    expect(canPlace(day.wall, [], h(2, 200))).toBe(false);
  });
});

describe('sharing', () => {
  it('round-trips a route through the URL encoding', () => {
    const holds: Hold[] = [
      { id: 'a', type: 'jug', size: 'l', u: 120, v: 240, rot: 0 },
      { id: 'b', type: 'foot', size: 'm', u: 90, v: 60, rot: -Math.PI / 4 },
    ];
    const decoded = decodeRoute('#' + encodeRoute(7, holds))!;
    expect(decoded.day).toBe(7);
    expect(decoded.holds.map(({ type, size, u, v }) => ({ type, size, u, v }))).toEqual(
      holds.map(({ type, size, u, v }) => ({ type, size, u, v })),
    );
    expect(decoded.holds[1].rot).toBeCloseTo(-Math.PI / 4, 1);
  });

  it('rejects garbage', () => {
    expect(decodeRoute('#r=3-9.9.x.1.1')).toBeNull();
  });

  it('builds a share card', () => {
    const day = { ...generateDay(12), par: 4 };
    const text = shareText(day, [{ holds: [], result: ok(4.1), verdict: 'exact', holdCount: 5 }]);
    expect(text).toMatch(/^Topout #12 · V\d/);
    expect(text).toContain('🟩');
    expect(text).toContain('5 holds (par 4)');
  });
});

describe('generator', () => {
  it('is deterministic', () => {
    expect(generateDay(42)).toEqual(generateDay(42));
  });
});
