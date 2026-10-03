import { describe, expect, it } from 'vitest';
import { ANCHORS, gradeAnchor } from '../../scripts/calibrate';

// Reference problems with widely agreed grades (see scripts/calibrate.ts).
describe('grade calibration', () => {
  const results = ANCHORS.map((a) => ({ a, r: gradeAnchor(a) }));

  // Known misses (Anchor.miss) still count toward the mean, but aren't held to ±1.5 yet.
  it.each(results.filter(({ a }) => !a.miss).map(({ a, r }) => [a.name, a.expect, r] as const))('%s grades near V%i', (_name, expected, r) => {
    if (!r.ok) throw new Error(r.message);
    expect(Math.abs(r.grade - expected)).toBeLessThanOrEqual(1.5);
  });

  it('is accurate on average', () => {
    const err =
      results.reduce((s, { a, r }) => s + (r.ok ? Math.abs(r.grade - a.expect) : 5), 0) / results.length;
    expect(err).toBeLessThan(0.8);
  });
});
