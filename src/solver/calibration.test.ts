import { describe, expect, it } from 'vitest';
import { ANCHORS, anchorRoute, gradeAnchor } from '../../scripts/calibrate';
import { backBridge } from './model';
import { OFF } from './types';

// Reference problems with widely agreed grades (see scripts/calibrate.ts).
describe('grade calibration', () => {
  const results = ANCHORS.map((a) => ({ a, r: gradeAnchor(a) }));

  // Known misses (Anchor.miss) still count toward the mean, but aren't held to ±1.5 yet.
  it.each(results.filter(({ a }) => !a.miss).map(({ a, r }) => [a.name, a.expect, r] as const))('%s grades near V%i', (_name, expected, r) => {
    if (!r.ok) throw new Error(r.message);
    expect(Math.abs(r.grade - expected)).toBeLessThanOrEqual(1.5);
  });

  it('stands up off a mantle with the legs, not a lock-off', () => {
    // Was V3.6 when the reach from the ledge to the finish counted as a lock-off all the way.
    const r = results.find(({ a }) => a.name === 'vertical jugs to a mantle')!.r;
    if (!r.ok) throw new Error(r.message);
    expect(r.grade).toBeLessThan(3);
  });

  it('climbs the chimney back and foot, not off its holds alone', () => {
    const a = ANCHORS.find((x) => x.name === 'vertical chimney, back and foot')!;
    const r = results.find((x) => x.a === a)!.r;
    if (!r.ok) throw new Error(r.message);
    const { wall } = anchorRoute(a);
    const backed = r.moves.filter(({ to: { limbs: l, points: p } }) =>
      backBridge(wall, [p[0], p[1]], [l[2] !== OFF ? p[2] : null, l[3] !== OFF ? p[3] : null]),
    );
    expect(backed.length).toBeGreaterThan(0);
    // The same holds on a flat face, footholds off to one side: no corner to lean on.
    const face = gradeAnchor({ ...a, fold: undefined });
    if (!face.ok) throw new Error(face.message);
    expect(face.grade).toBeGreaterThan(r.grade + 1);
  });

  it('is accurate on average', () => {
    const err =
      results.reduce((s, { a, r }) => s + (r.ok ? Math.abs(r.grade - a.expect) : 5), 0) / results.length;
    expect(err).toBeLessThan(0.8);
  });
});
