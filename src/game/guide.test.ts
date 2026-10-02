import { describe, expect, it } from 'vitest';
import { ANCHORS, gradeAnchor } from '../../scripts/calibrate';
import { GRADE_GUIDE, guideRange } from './guide';

// The grade guide is the scale players learn from: every example it gives should
// climb at the grade it claims.
describe('grade guide', () => {
  it('covers V0 to V8 without gaps', () => {
    let next = 0;
    for (const row of GRADE_GUIDE) {
      const [lo, hi] = guideRange(row);
      expect(lo).toBe(next);
      next = hi + 1;
    }
    expect(next).toBe(9);
  });

  it.each(GRADE_GUIDE.flatMap((row) => row.anchors.map((name) => [row.g, name] as const)))('%s: %s grades as the guide says', (_g, name) => {
    const row = GRADE_GUIDE.find((r) => r.anchors.includes(name))!;
    const a = ANCHORS.find((x) => x.name === name);
    expect(a, `no calibration anchor named "${name}"`).toBeDefined();
    const [lo, hi] = guideRange(row);
    // The anchor's agreed grade is in the row, and the solver grades it in the row's band
    // give or take 0.8 (the calibration's bound on mean error).
    expect(a!.expect).toBeGreaterThanOrEqual(lo);
    expect(a!.expect).toBeLessThanOrEqual(hi);
    const r = gradeAnchor(a!);
    if (!r.ok) throw new Error(r.message);
    expect(r.grade).toBeGreaterThanOrEqual(lo - 0.8);
    expect(r.grade).toBeLessThanOrEqual(hi + 0.8);
  });
});
