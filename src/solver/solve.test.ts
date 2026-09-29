import { describe, expect, it } from 'vitest';
import { solve } from './solve';
import type { Hold, HoldType, Wall } from './types';

const wall = (angle: number): Wall => ({ width: 400, panels: [{ length: 420, angle }], seed: 1 });

const start: Hold[] = [
  { id: 's1', type: 'jug', size: 'l', u: 180, v: 150, rot: 0, role: 'start' },
  { id: 's2', type: 'jug', size: 'l', u: 220, v: 150, rot: 0, role: 'start' },
];
const finishAt = (v: number): Hold => ({ id: 'f', type: 'jug', size: 'l', u: 200, v, rot: 0, role: 'finish' });

/** Zig-zag hand ladder from the start to the finish, with foot chips underneath. */
function ladder(type: HoldType, spacing: number, top = 380, rot = 0): Hold[] {
  const holds: Hold[] = [];
  let i = 0;
  for (let v = 150 + spacing; v < top - spacing / 2; v += spacing, i++) {
    holds.push({ id: `h${i}`, type, size: 'm', u: i % 2 ? 225 : 175, v, rot });
  }
  // Feet start just above the crash pad (v = 30).
  for (let v = 42, j = 0; v < top - 110; v += 35, j++) {
    holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 215 : 185, v, rot: 0 });
  }
  return holds;
}

const grade = (w: Wall, holds: Hold[], top = 380) => {
  const r = solve(w, start, finishAt(top), holds);
  if (!r.ok) throw new Error(r.message);
  return r.grade;
};

describe('solver', () => {
  it('grades a vertical jug ladder as roughly V0–V1', () => {
    const g = grade(wall(0), ladder('jug', 40));
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThan(2);
  });

  it('is deterministic', () => {
    const a = solve(wall(20), start, finishAt(380), ladder('crimp', 45));
    const b = solve(wall(20), start, finishAt(380), ladder('crimp', 45));
    expect(a).toEqual(b);
  });

  it('wider spacing is harder', () => {
    expect(grade(wall(10), ladder('crimp', 95))).toBeGreaterThan(grade(wall(10), ladder('crimp', 40)));
  });

  it('steeper is harder', () => {
    expect(grade(wall(30), ladder('crimp', 45))).toBeGreaterThan(grade(wall(0), ladder('crimp', 45)));
  });

  it('crimps are harder than jugs', () => {
    expect(grade(wall(15), ladder('crimp', 45))).toBeGreaterThan(grade(wall(15), ladder('jug', 45)));
  });

  it('slopers suffer more on steep walls than on vertical', () => {
    const slope = grade(wall(35), ladder('sloper', 45)) - grade(wall(0), ladder('sloper', 45));
    const crimp = grade(wall(35), ladder('crimp', 45)) - grade(wall(0), ladder('crimp', 45));
    expect(slope).toBeGreaterThan(crimp);
  });

  it('holds rotated against the pull are harder or impossible', () => {
    const upright = grade(wall(10), ladder('crimp', 45));
    const flipped = solve(wall(10), start, finishAt(380), ladder('crimp', 45, 380, Math.PI));
    if (flipped.ok) expect(flipped.grade).toBeGreaterThan(upright);
  });

  it('reports an unreachable finish instead of crashing', () => {
    const r = solve(wall(0), start, finishAt(400), []);
    expect(r.ok).toBe(false);
  });

  it('smears on vertical walls but not on overhangs', () => {
    const handsOnly = ladder('jug', 40).filter((h) => h.type !== 'foot');
    expect(solve(wall(0), start, finishAt(380), handsOnly).ok).toBe(true);
    expect(solve(wall(0), start, finishAt(380), handsOnly, { noSmear: true }).ok).toBe(false);
  });

  it('does not cross hands on a plain ladder', () => {
    const r = solve(wall(10), start, finishAt(380), ladder('crimp', 45));
    if (!r.ok) throw new Error();
    for (const m of r.moves) expect(m.to.points[0].u).toBeLessThanOrEqual(m.to.points[1].u + 1);
  });

  it('beta ends matched on the finish', () => {
    const r = solve(wall(0), start, finishAt(380), ladder('jug', 40));
    if (!r.ok) throw new Error();
    const last = r.moves[r.moves.length - 1].to.limbs;
    expect(last[0]).toBe(last[1]);
  });
});
