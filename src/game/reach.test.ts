import { describe, expect, it } from 'vitest';
import { BODY } from '../solver/model';
import type { Hold } from '../solver/types';
import { reachGuide, reachArc, stretch } from './reach';

const hold = (id: string, type: Hold['type'], u: number, v: number, role?: Hold['role']): Hold => ({ id, type, size: 'm', u, v, rot: 0, role });

describe('reach guide', () => {
  const holds = [hold('s', 'jug', 200, 120, 'start'), hold('a', 'crimp', 260, 180), hold('f', 'foot', 230, 230), hold('top', 'jug', 220, 400, 'finish')];

  it('measures from the closest handhold below, ignoring footholds and the finish', () => {
    const g = reachGuide(holds, 240, 260)!;
    expect(g.anchor.id).toBe('a');
    expect(g.zone).toBe('static');
  });

  it('matches the solver limits: lock-off upward, span sideways', () => {
    const a = { u: 0, v: 0 };
    expect(stretch(a, 0, BODY.lockoff)).toBeCloseTo(1);
    expect(stretch(a, BODY.span, 0)).toBeCloseTo(1);
    expect(reachGuide([hold('s', 'jug', 0, 0)], 0, BODY.lockoff * 1.05)!.zone).toBe('dyno');
    expect(reachGuide([hold('s', 'jug', 0, 0)], 0, BODY.lockoff * 1.3)!.zone).toBe('out');
  });

  it('skips the hold being moved and has nothing to say below every handhold', () => {
    expect(reachGuide(holds, 240, 260, 'a')!.anchor.id).toBe('s');
    expect(reachGuide(holds, 240, 50)).toBeNull();
  });

  it('traces the upper arc of the ellipse', () => {
    const pts = reachArc({ u: 100, v: 100 }, 1, 4);
    expect(pts).toHaveLength(5);
    expect(Math.max(...pts.map((p) => p.v))).toBeCloseTo(100 + BODY.lockoff);
    expect(Math.min(...pts.map((p) => p.v))).toBeGreaterThan(100 - 0.3 * BODY.lockoff);
    for (const p of pts) expect(stretch({ u: 100, v: 100 }, p.u, p.v)).toBeCloseTo(1);
  });
});
