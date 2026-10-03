import { describe, expect, it } from 'vitest';
import { ALL_STYLES, generateDay, wallStyleOf } from '../gen/day';
import { wallHeight, wallPoint } from '../solver/model';
import type { Hold, SolveResult } from '../solver/types';
import { frameAt, panelFrames, uvToWorld, worldToUv } from '../scene/wallGeometry';
import { bestTest, canPlace, holdNear, verdictOf, type TestRun } from './rules';
import { decodeRoute, encodeRoute, shareText } from './share';
import { defaultSpots, spotsFilled, withSpots } from './spots';

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
  it('a touch beside a hold grabs the nearest edge within the slop', () => {
    const chip: Hold = { id: 'chip', type: 'foot', size: 's', u: 100, v: 100, rot: 0 };
    const jug: Hold = { id: 'jug', type: 'jug', size: 'l', u: 130, v: 100, rot: 0 };
    // 8 cm right of a 2.8 cm chip: 5.2 cm off its edge, and 10.75 cm off the jug's.
    expect(holdNear([chip, jug], 108, 100, 6)?.id).toBe('chip');
    expect(holdNear([chip, jug], 108, 100, 4)).toBeNull();
    // On the jug itself (inside its radius) always wins.
    expect(holdNear([chip, jug], 125, 100, 0)?.id).toBe('jug');
    expect(holdNear([], 0, 0, 50)).toBeNull();
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

  it('carries start/finish spot holds, and old links mean the default jugs', () => {
    const holds: Hold[] = [{ id: 'a', type: 'crimp', size: 's', u: 100, v: 200, rot: 0 }];
    const spots = [
      { type: 'crimp', size: 's', rot: 0.5 },
      { type: 'sloper', size: 'l', rot: 0 },
    ] as const;
    const decoded = decodeRoute('#' + encodeRoute(7, holds, [], [...spots]))!;
    expect(decoded.holds).toHaveLength(1);
    expect(decoded.volumes).toEqual([]);
    expect(decoded.spots!.map(({ type, size }) => ({ type, size }))).toEqual(spots.map(({ type, size }) => ({ type, size })));
    expect(decoded.spots![0].rot).toBeCloseTo(0.5, 1);
    expect(decodeRoute('#' + encodeRoute(7, holds))!.spots).toBeUndefined();
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

describe('start/finish spots', () => {
  const day = { ...generateDay(12), par: 0 };
  const finish = { finish: { type: 'crimp', size: 'm', rot: 0 } } as const;

  it('keeps positions fixed and swaps in the chosen hold', () => {
    const d = withSpots(day, { ...defaultSpots(day), ...finish });
    expect(d.finish).toMatchObject({ u: day.finish.u, v: day.finish.v, type: 'crimp', role: 'finish' });
    expect(d.start).toEqual(day.start);
    expect(withSpots(day, undefined)).toBe(day);
  });

  it('knows when every spot is filled', () => {
    expect(spotsFilled(day, {})).toBe(false);
    expect(spotsFilled(day, finish)).toBe(false);
    expect(spotsFilled(day, defaultSpots(day))).toBe(true);
  });
});

describe('generator', () => {
  it('is deterministic', () => {
    expect(generateDay(42)).toEqual(generateDay(42));
  });
});

describe('wall styles', () => {
  it('every generated wall reads back as the style it was built as', () => {
    for (const style of ALL_STYLES)
      for (let n = 1; n <= 30; n++) expect(wallStyleOf(generateDay(n, 0, { style }).wall)).toBe(style);
  });

  it('the solver and the scene agree on where every wall point is, and folded faces meet at each break', () => {
    for (const style of ALL_STYLES)
      for (let n = 1; n <= 6; n++) {
        const wall = generateDay(n, 0, { style }).wall;
        const frames = panelFrames(wall);
        const top = wallHeight(wall);
        for (let u = 0; u <= wall.width; u += 37)
          for (let v = 0; v <= top; v += 41) {
            const [x, y, z] = wallPoint(wall, u, v);
            const p = uvToWorld(wall, frames, u, v);
            expect(Math.hypot(x - p.x * 100, y - p.y * 100, z - p.z * 100)).toBeLessThan(1e-6);
            const back = worldToUv(wall, frameAt(frames, u, v), p);
            expect(Math.hypot(back.u - u, back.v - v)).toBeLessThan(1e-6);
          }
        let v = 0;
        for (const panel of wall.panels.slice(0, -1)) {
          v += panel.length;
          for (let u = 0; u <= wall.width; u += 20)
            expect(uvToWorld(wall, frames, u, v - 1e-4).distanceTo(uvToWorld(wall, frames, u, v + 1e-4))).toBeLessThan(1e-4);
        }
      }
  });
});
