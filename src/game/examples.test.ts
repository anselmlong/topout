import { describe, expect, it } from 'vitest';
import { solve } from '../solver/solve';
import { canPlace } from './rules';
import { EXAMPLES, findExample } from './examples';
import { spotsOf } from './spots';

describe('example gallery', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s grades within half a grade of its label', (_, e) => {
    const r = solve(e.day.wall, e.day.start, e.day.finish, e.holds);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.grade - e.grade)).toBeLessThanOrEqual(0.5);
  });

  it('places every hold legally', () => {
    for (const e of EXAMPLES) {
      const placed = spotsOf(e.day);
      for (const h of e.holds) {
        expect(canPlace(e.day.wall, placed, h)).toBe(true);
        placed.push(h);
      }
    }
  });

  it('has unique ids and finds them', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(findExample('jug-ladder')?.grade).toBe(0);
    expect(findExample('')).toBeNull();
  });
});
