import { describe, expect, it } from 'vitest';
import { solve } from './solve';
import { footTechnique } from './model';
import type { Hold, HoldType, Volume, Wall } from './types';

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
    expect(grade(wall(10), ladder('crimp', 80))).toBeGreaterThan(grade(wall(10), ladder('crimp', 40)));
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

  it('a volume gives the feet somewhere to stand on an overhang', () => {
    const steep = wall(35);
    const hands = ladder('edge', 45).filter((h) => h.type !== 'foot');
    const without = solve(steep, start, finishAt(380), hands);
    const pyramid: Volume = { id: 'vol', shape: 'pyramid', size: 'l', u: 200, v: 75, rot: 0 };
    const withVol = solve(steep, start, finishAt(380), hands, { volumes: [pyramid] });
    if (!withVol.ok) throw new Error(withVol.message);
    if (without.ok) expect(withVol.grade).toBeLessThan(without.grade);
    // Some position has a foot on one of the volume's faces (indices after start, finish, placed).
    const firstFace = start.length + 1 + hands.length;
    const stances = [withVol.start, ...withVol.moves.map((m) => m.to)];
    expect(stances.some((s) => s.limbs[2] >= firstFace || s.limbs[3] >= firstFace)).toBe(true);
  });

  it('holds on an up-facing volume face act less steep', () => {
    const steep = wall(30);
    const crimps = ladder('crimp', 45);
    const plain = solve(steep, start, finishAt(380), crimps);
    // A big wedge under the lower crimps tilts them back toward vertical.
    const wedge: Volume = { id: 'w', shape: 'wedge', size: 'l', u: 200, v: 215, rot: 0 };
    const tilted = solve(steep, start, finishAt(380), crimps, { volumes: [wedge] });
    if (!plain.ok || !tilted.ok) throw new Error('expected both to send');
    expect(tilted.grade).toBeLessThanOrEqual(plain.grade);
  });

  it('a dihedral lets you stem where a flat wall gives nothing to stand on', () => {
    const hands = ladder('edge', 45).filter((h) => h.type !== 'foot');
    const flat = solve(wall(15), start, finishAt(380), hands);
    const corner: Wall = { ...wall(15), fold: { u: 200, angle: 90 } };
    const stem = solve(corner, start, finishAt(380), hands);
    if (!stem.ok) throw new Error(stem.message);
    if (flat.ok) expect(stem.grade).toBeLessThan(flat.grade);
    // The feet smear on opposite faces somewhere in the beta.
    const smearing = [stem.start, ...stem.moves.map((m) => m.to)].some((s) => s.limbs[2] === -1 && s.limbs[3] === -1);
    expect(smearing).toBe(true);
  });

  it('an arête helps but is not climbable bare', () => {
    const arete: Wall = { ...wall(0), fold: { u: 200, angle: -70 } };
    // Bare: impossible.
    expect(solve(arete, start, finishAt(380), []).ok).toBe(false);
    // With a couple of real holds the edge is used, and it beats the same holds on a flat wall.
    const holds: Hold[] = [
      { id: 'a', type: 'crimp', size: 'm', u: 170, v: 230, rot: 0 },
      { id: 'b', type: 'crimp', size: 'm', u: 175, v: 310, rot: 0 },
    ];
    const edge = solve(arete, start, finishAt(380), holds);
    if (!edge.ok) throw new Error(edge.message);
    const firstEdge = start.length + 1 + holds.length;
    expect(edge.moves.some((m) => m.limb <= 1 && m.to.limbs[m.limb] >= firstEdge)).toBe(true);
    const flat = solve(wall(0), start, finishAt(380), holds);
    if (flat.ok) expect(edge.grade).toBeLessThan(flat.grade);
  });

  it('heel hooks a big hold out to the side on steep ground', () => {
    const steep = wall(35);
    const hands: Hold[] = [
      { id: 'a', type: 'edge', size: 'm', u: 185, v: 215 },
      { id: 'b', type: 'edge', size: 'm', u: 215, v: 275 },
      { id: 'c', type: 'edge', size: 'm', u: 190, v: 330 },
    ].map((h) => ({ ...h, type: 'edge' as const, size: 'm' as const, rot: 0 }));
    const feet: Hold[] = [
      { id: 'f1', type: 'foot', size: 'm', u: 180, v: 70, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 222, v: 95, rot: 0 },
      { id: 'f3', type: 'foot', size: 'm', u: 196, v: 130, rot: 0 },
    ];
    const hook: Hold = { id: 'hk', type: 'jug', size: 'l', u: 265, v: 225, rot: -Math.PI / 2 };
    const without = solve(steep, start, finishAt(380), [...hands, ...feet]);
    const withHeel = solve(steep, start, finishAt(380), [...hands, ...feet, hook]);
    if (!withHeel.ok) throw new Error(withHeel.message);
    const hookIdx = start.length + 1 + hands.length + feet.length;
    const heeled = [withHeel.start, ...withHeel.moves.map((m) => m.to)].some((s) => s.limbs[2] === hookIdx || s.limbs[3] === hookIdx);
    expect(heeled).toBe(true);
    if (without.ok) expect(withHeel.grade).toBeLessThan(without.grade);
  });

  it('toe hooks a sidepull far out to the side, but only when it faces away', () => {
    const steep = wall(35);
    const hands: Hold[] = [
      { id: 'a', u: 185, v: 215 },
      { id: 'b', u: 215, v: 275 },
      { id: 'c', u: 190, v: 330 },
    ].map((h) => ({ ...h, type: 'edge' as const, size: 'm' as const, rot: 0 }));
    const feet: Hold[] = [
      { id: 'f1', type: 'foot', size: 'm', u: 180, v: 70, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 222, v: 95, rot: 0 },
      { id: 'f3', type: 'foot', size: 'm', u: 196, v: 130, rot: 0 },
    ];
    const toeIdx = start.length + 1 + hands.length + feet.length;
    // Any stance with a foot toe-hooked on the test hold.
    const toed = (r: ReturnType<typeof solve>) =>
      r.ok &&
      [r.start, ...r.moves.map((m) => m.to)].some((s) =>
        ([2, 3] as const).some((f) => s.limbs[f] === toeIdx && footTechnique(steep, [s.points[0], s.points[1]], s.points[f]) === 'toe'),
      );
    // An edge 90 cm out, turned so its lip faces away from the climber: the toe hooks behind it.
    const away: Hold = { id: 'tk', type: 'edge', size: 'm', u: 290, v: 235, rot: -Math.PI / 2 };
    const without = solve(steep, start, finishAt(380), [...hands, ...feet]);
    const withToe = solve(steep, start, finishAt(380), [...hands, ...feet, away]);
    if (!withToe.ok) throw new Error(withToe.message);
    expect(toed(withToe)).toBe(true);
    if (without.ok) expect(withToe.grade).toBeLessThanOrEqual(without.grade);
    // Facing the climber there's nothing to hook behind.
    const facing = solve(steep, start, finishAt(380), [...hands, ...feet, { ...away, rot: Math.PI / 2 }]);
    expect(toed(facing)).toBe(false);
  });

  it('beta ends matched on the finish', () => {
    const r = solve(wall(0), start, finishAt(380), ladder('jug', 40));
    if (!r.ok) throw new Error();
    const last = r.moves[r.moves.length - 1].to.limbs;
    expect(last[0]).toBe(last[1]);
  });
});
