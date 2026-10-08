import { describe, expect, it } from 'vitest';
import { solve } from './solve';
import { flagFor, footTechnique, handGrip, handTechnique, hipTurn, lipV, toGrade, typicalIncut } from './model';
import { lipContacts } from './volumes';
import type { Hold, HoldType, Point, Volume, Wall } from './types';

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
    // One seed throughout: the same hold (and incut) repeated up the line.
    holds.push({ id: `h${i}`, type, size: 'm', u: i % 2 ? 225 : 175, v, rot, seed: 0 });
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

  it('a deep incut grades easier than a flat one of the same type and size', () => {
    const withIncut = (holds: Hold[], incut: number) => holds.map((h) => (h.type === 'crimp' ? { ...h, incut } : h));
    for (const angle of [0, 30]) {
      const flat = grade(wall(angle), withIncut(ladder('crimp', 45), 0.1));
      const deep = grade(wall(angle), withIncut(ladder('crimp', 45), 0.85));
      expect(deep).toBeLessThan(flat - 0.3);
    }
    // And incut matters more where the pull swings out: steep ground opens a flat crimp up.
    const crimp: Hold = { id: 'c', type: 'crimp', size: 'm', u: 200, v: 200, rot: 0 };
    const body = { u: 200, v: 150 };
    const ratio = (angle: number) =>
      handGrip({ ...crimp, incut: 0.85 }, body, wall(angle)) / handGrip({ ...crimp, incut: 0.1 }, body, wall(angle));
    expect(ratio(40)).toBeGreaterThan(ratio(0));
  });

  it('reads the incut off the hold seed, so a share link (new ids, same seed) climbs the same', () => {
    const a = ladder('edge', 50).map((h, i) => ({ ...h, seed: i * 7 }));
    const b = a.map((h, i) => ({ ...h, id: `shared-${i}` }));
    expect(grade(wall(20), b)).toBeCloseTo(grade(wall(20), a), 6);
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

  it('gastons: an edge facing away from the body is hard but climbable', () => {
    // Left holds face left, right holds face right: each one has to be pulled outward.
    const out = ladder('edge', 45).map((h) => (h.type === 'edge' ? { ...h, rot: h.u < 200 ? -Math.PI / 2 : Math.PI / 2 } : h));
    const g = grade(wall(0), out);
    expect(g).toBeGreaterThan(grade(wall(0), ladder('edge', 45)));
    expect(g).toBeLessThan(8);
  });

  it('sidepulls: leaning off an edge that faces in is harder than pulling down, easier than a gaston', () => {
    const turn = (dir: 1 | -1) =>
      ladder('edge', 45).map((h) => (h.type === 'edge' ? { ...h, rot: (h.u < 200 ? dir : -dir) * (Math.PI / 2) } : h));
    const side = grade(wall(0), turn(1));
    expect(side).toBeGreaterThan(grade(wall(0), ladder('edge', 45)));
    expect(side).toBeLessThan(grade(wall(0), turn(-1)) - 1);
    // Leaning off a sidepull tilts the pull side-on, toward the hold's lip.
    const sp: Hold = { id: 'e', type: 'edge', size: 'm', u: 175, v: 250, rot: Math.PI / 2 };
    const g = handGrip(sp, { u: 195, v: 170 }, wall(0));
    expect(g).toBeGreaterThan(0.5 * handGrip({ ...sp, rot: 0 }, { u: 195, v: 170 }, wall(0)));
  });

  it('stands into an undercling at the waist, but not one overhead', () => {
    const uc: Hold = { id: 'u', type: 'edge', size: 'm', u: 200, v: 250, rot: Math.PI };
    // Feet high, body just below the hold: the climber stands up into it.
    const waist = handGrip(uc, { u: 210, v: 200 }, wall(0));
    expect(waist).toBeGreaterThan(0.3);
    // Still more strenuous than the same edge pulled the right way up.
    expect(waist).toBeLessThan(handGrip({ ...uc, rot: 0 }, { u: 210, v: 200 }, wall(0)));
    // Feet far below: the body can't get over it.
    expect(handGrip(uc, { u: 210, v: 100 }, wall(0))).toBeLessThan(0.05);
  });

  it('names how a hand holds a hold: sidepull, gaston, undercling', () => {
    const edge = (rot: number): Hold => ({ id: 'e', type: 'edge', size: 'm', u: 150, v: 200, rot });
    const body = { u: 200, v: 150 };
    expect(handTechnique(edge(0), body)).toBe(null);
    // Best pulled rightward, toward a body on its right: a sidepull.
    expect(handTechnique(edge(Math.PI / 2), { u: 260, v: 200 })).toBe('sidepull');
    // Best pulled leftward, away from a body on its right: a gaston.
    expect(handTechnique(edge(-Math.PI / 2), { u: 260, v: 200 })).toBe('gaston');
    // Lip facing down with the body level or above: an undercling.
    expect(handTechnique(edge(Math.PI), { u: 150, v: 240 })).toBe('undercling');
    // Pinches are squeezed, not sidepulled.
    expect(handTechnique({ ...edge(Math.PI / 2), type: 'pinch' }, { u: 260, v: 200 })).toBe(null);
  });

  it('turns the hip in on long reaches up steep ground, stays square on slabs and short moves', () => {
    const feet: [Point, Point] = [{ u: 180, v: 60 }, { u: 230, v: 80 }];
    const long: [Point, Point] = [{ u: 230, v: 260 }, { u: 190, v: 180 }];
    // Left hand reaching 80 cm up a 25° overhang: fully side-on.
    expect(hipTurn(wall(25), long, feet, 0)).toBeCloseTo(1, 5);
    // Vertical: a partial turn. Slab: square.
    const vert = hipTurn(wall(0), long, feet, 0);
    expect(vert).toBeGreaterThan(0.2);
    expect(vert).toBeLessThan(1);
    expect(hipTurn(wall(-15), long, feet, 0)).toBe(0);
    // The hand that stays low doesn't turn; neither does a short move, a foot off, or a bunched stance.
    expect(hipTurn(wall(25), long, feet, 1)).toBe(0);
    expect(hipTurn(wall(25), [{ u: 200, v: 210 }, { u: 190, v: 180 }], feet, 0)).toBe(0);
    expect(hipTurn(wall(25), long, [feet[0], null], 0)).toBe(0);
    expect(hipTurn(wall(25), long, [{ u: 180, v: 160 }, { u: 230, v: 170 }], 0)).toBe(0);
  });

  it('flags the free leg toward the reach: outside on its own side, back across the standing leg', () => {
    const hands: [Point, Point] = [{ u: 160, v: 220 }, { u: 280, v: 230 }];
    // Standing on the right foot, reaching right with the right hand: the left leg back flags.
    const right: [Point | null, Point | null] = [null, { u: 220, v: 90 }];
    expect(flagFor(wall(0), hands, right, 0, 1)).toMatchObject({ side: 1, kind: 'back' });
    expect(flagFor(wall(0), hands, right, 0, 1)!.turn).toBeGreaterThan(0.2);
    // ...but on a slab the hips stay square.
    expect(flagFor(wall(-15), hands, right, 0, 1)!.turn).toBe(0);
    // Left foot and left hand on, reaching right: the right leg flags out right.
    const left: [Point | null, Point | null] = [{ u: 180, v: 90 }, null];
    expect(flagFor(wall(0), hands, left, 1, 1)).toEqual({ side: 1, kind: 'outside', turn: 0 });
    // Reaching left off the left foot: the right leg crosses behind to the left.
    expect(flagFor(wall(0), [{ u: 100, v: 230 }, hands[1]], left, 1, 0)).toMatchObject({ side: -1, kind: 'back' });
    // No reach: the free leg hangs out on its own side. Both feet on, or none: no flag.
    expect(flagFor(wall(0), hands, right, 0, null)).toMatchObject({ side: -1, kind: 'outside' });
    expect(flagFor(wall(0), hands, [left[0], right[1]], 0, 1)).toBe(null);
    expect(flagFor(wall(0), hands, [null, null], 0, 1)).toBe(null);
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

  it('stands on a foot chip bolted to a volume rather than the bare face', () => {
    const hands = ladder('edge', 45).filter((h) => h.type !== 'foot');
    const pyramid: Volume = { id: 'vol', shape: 'pyramid', size: 'l', u: 200, v: 75, rot: 0 };
    // Two chips on the up-facing face, either side of the centre line.
    const chips: Hold[] = [
      { id: 'c1', type: 'foot', size: 'm', u: 188, v: 91, rot: 0 },
      { id: 'c2', type: 'foot', size: 'm', u: 212, v: 91, rot: 0 },
    ];
    const placed = [...hands, ...chips];
    const r = solve(wall(0), start, finishAt(380), placed, { volumes: [pyramid] });
    if (!r.ok) throw new Error(r.message);
    const firstFace = start.length + 1 + placed.length;
    const feet = [r.start, ...r.moves.map((m) => m.to)].flatMap((s) => [s.limbs[2], s.limbs[3]]);
    const chipIdx = [firstFace - 2, firstFace - 1];
    expect(feet.some((f) => chipIdx.includes(f))).toBe(true);
    expect(feet.some((f) => f >= firstFace)).toBe(false);
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

  it('in a corner, steps up onto the jugs rather than stemming smears past them', () => {
    // Day 30's slab corner, as curated: start jugs either side of the crease, a jug and a
    // big edge above them, then crimps out left to the finish.
    const corner: Wall = { width: 380, panels: [{ length: 478, angle: -4 }], seed: 1, fold: { u: 160, angle: 90 } };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 131, v: 141, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 173, v: 140, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'jug', size: 'm', u: 164, v: 235, rot: -0.1 },
      { id: 'h3', type: 'crimp', size: 's', u: 108, v: 295, rot: 0.26 },
      { id: 'h4', type: 'edge', size: 'l', u: 163, v: 335, rot: -0.03 },
      { id: 'h5', type: 'edge', size: 'm', u: 88, v: 388, rot: 0.24 },
    ];
    const r = solve(corner, jugs, { id: 'finish', type: 'jug', size: 'l', u: 114, v: 447, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    // The reach to the big edge goes from both feet on the start jugs, not from two smears.
    const toEdge = r.moves.find((m) => m.limb <= 1 && m.to.limbs[m.limb] === 5)!;
    expect(toEdge.from.limbs.slice(2).sort()).toEqual([0, 1]);
  });

  it('a rollover lip is a hold that gets you over onto the slab', () => {
    const roll: Wall = { width: 400, panels: [{ length: 320, angle: 25 }, { length: 110, angle: -15 }], seed: 1, lip: true };
    const holds: Hold[] = [
      { id: 'a', type: 'edge', size: 'm', u: 170, v: 205, rot: 0 },
      { id: 'b', type: 'edge', size: 'm', u: 230, v: 260, rot: 0 },
      { id: 'f0', type: 'foot', size: 'm', u: 190, v: 70, rot: 0 },
      { id: 'f1', type: 'foot', size: 'm', u: 215, v: 85, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 215, v: 110, rot: 0 },
      { id: 'f3', type: 'foot', size: 'm', u: 185, v: 160, rot: 0 },
      { id: 'f4', type: 'foot', size: 'm', u: 200, v: 215, rot: 0 },
    ];
    // Without the lip the finish up on the slab is out of reach; with it, the beta grabs the lip.
    expect(solve({ ...roll, lip: undefined }, start, finishAt(395), holds).ok).toBe(false);
    const r = solve(roll, start, finishAt(395), holds);
    if (!r.ok) throw new Error(r.message);
    const firstLip = start.length + 1 + holds.length;
    expect(r.moves.some((m) => m.limb <= 1 && m.to.limbs[m.limb] >= firstLip)).toBe(true);
  });

  it('a roof climbs out along its underside and hooks the lip onto the headwall', () => {
    const roof: Wall = { width: 400, panels: [{ length: 140, angle: 2 }, { length: 115, angle: 75 }, { length: 200, angle: 5 }], seed: 1, lip: true };
    // The lip is the roof's front edge, not the corner at its back.
    expect(lipV(roof)).toBe(255);
    const holds: Hold[] = [
      { id: 'a', type: 'jug', size: 'm', u: 175, v: 180, rot: 0 },
      { id: 'b', type: 'jug', size: 'm', u: 225, v: 220, rot: 0 },
      { id: 'c', type: 'edge', size: 'l', u: 190, v: 310, rot: 0 },
      { id: 'f0', type: 'foot', size: 'm', u: 190, v: 45, rot: 0 },
      { id: 'f1', type: 'foot', size: 'm', u: 215, v: 80, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 200, v: 150, rot: 0 },
    ];
    const r = solve(roof, start, finishAt(400), holds);
    if (!r.ok) throw new Error(r.message);
    const firstLip = start.length + 1 + holds.length;
    expect([r.start, ...r.moves.map((m) => m.to)].some((s) => s.limbs.some((x) => x >= firstLip))).toBe(true);
  });

  it('a ledge lip is the hold at its front edge, not at the back of the shelf', () => {
    const ledge: Wall = { width: 400, panels: [{ length: 200, angle: 5 }, { length: 28, angle: -75 }, { length: 200, angle: 8 }], seed: 1, lip: true };
    expect(lipV(ledge)).toBe(200);
    const lips = lipContacts(ledge);
    expect(lips.length).toBeGreaterThan(0);
    expect(lips.every((h) => h.v === 197)).toBe(true);
    // An overlap still rolls over at the top of its roof band.
    const overlap: Wall = { width: 400, panels: [{ length: 200, angle: -12 }, { length: 45, angle: 50 }, { length: 200, angle: -10 }], seed: 1, lip: true };
    expect(lipV(overlap)).toBe(245);
  });

  it('mantles onto a volume top: presses it out, a foot comes up beside the hands, stands up and reaches', () => {
    const holds: Hold[] = [
      { id: 'e', type: 'edge', size: 'm', u: 230, v: 200, rot: 0, seed: 1 },
      { id: 'f0', type: 'foot', size: 'm', u: 185, v: 60, rot: 0 },
      { id: 'f1', type: 'foot', size: 'm', u: 215, v: 95, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 185, v: 130, rot: 0 },
      { id: 'f3', type: 'foot', size: 'm', u: 220, v: 165, rot: 0 },
      { id: 'f4', type: 'foot', size: 'm', u: 175, v: 195, rot: 0 },
    ];
    const volumes: Volume[] = [{ id: 'v', shape: 'wedge', size: 'l', u: 200, v: 260, rot: 0 }];
    // Nothing between the volume and the finish 135 cm above it: only a mantle gets there.
    const mantles = (w: Wall) => {
      const r = solve(w, start, finishAt(395), holds, { volumes });
      if (!r.ok) return null;
      const top = start.length + 1 + holds.length;
      return r.moves.some((m) => m.limb >= 2 && m.to.limbs[m.limb] === top && m.to.limbs[0] === top && m.to.limbs[1] === top);
    };
    expect(mantles(wall(0))).toBe(true);
    // A big jug in the same spot has room for a hand and a foot, not a mantle.
    const jug: Hold = { id: 'j', type: 'jug', size: 'l', u: 200, v: 255, rot: 0 };
    expect(solve(wall(0), start, finishAt(395), [...holds, jug]).ok).toBe(false);
    // On a 25° overhang the body hangs below the volume and can't get up over it.
    expect(mantles(wall(25))).not.toBe(true);
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

  it('face holds on an arête are worse while the body straddles the edge', () => {
    const arete: Wall = { ...wall(0), fold: { u: 200, angle: -70 } };
    const crimp: Hold = { id: 'c', type: 'crimp', size: 'm', u: 230, v: 250, rot: 0 };
    const jug: Hold = { ...crimp, id: 'j', type: 'jug' };
    const straddling = { u: 200, v: 180 };
    expect(handGrip(crimp, straddling, arete)).toBeLessThan(handGrip(crimp, straddling, wall(0)));
    // Jugs don't open up, and once round onto the hold's face the body squares up.
    expect(handGrip(jug, straddling, arete)).toBeCloseTo(handGrip(jug, straddling, wall(0)));
    expect(handGrip(crimp, { u: 270, v: 180 }, arete)).toBeCloseTo(handGrip(crimp, { u: 270, v: 180 }, wall(0)));
  });

  it('heel hooks a big hold out to the side on steep ground', () => {
    const steep = wall(35);
    const hands: Hold[] = [
      { id: 'a', type: 'edge', size: 'm', u: 185, v: 215 },
      { id: 'b', type: 'edge', size: 'm', u: 215, v: 275 },
      { id: 'c', type: 'edge', size: 'm', u: 190, v: 330 },
    ].map((h) => ({ ...h, type: 'edge' as const, size: 'm' as const, rot: 0, incut: typicalIncut('edge') }));
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
    ].map((h) => ({ ...h, type: 'edge' as const, size: 'm' as const, rot: 0, incut: typicalIncut('edge') }));
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
    const away: Hold = { id: 'tk', type: 'edge', size: 'm', u: 290, v: 235, rot: -Math.PI / 2, incut: typicalIncut('edge') };
    const without = solve(steep, start, finishAt(380), [...hands, ...feet]);
    const withToe = solve(steep, start, finishAt(380), [...hands, ...feet, away]);
    if (!withToe.ok) throw new Error(withToe.message);
    expect(toed(withToe)).toBe(true);
    if (without.ok) expect(withToe.grade).toBeLessThanOrEqual(without.grade);
    // Facing the climber there's nothing to hook behind.
    const facing = solve(steep, start, finishAt(380), [...hands, ...feet, { ...away, rot: Math.PI / 2 }]);
    expect(toed(facing)).toBe(false);
  });

  it('a hold just past static reach is a deadpoint, not a grade cliff', () => {
    // One jug above a single start jug: step it up 2 cm at a time across the static limit.
    const one = (dv: number) => {
      const holds: Hold[] = [{ id: 'a', type: 'jug', size: 'm', u: 200, v: 180 + dv, rot: 0 }];
      for (let v = 40, j = 0; v < 200; v += 30, j++) holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 214 : 186, v, rot: 0 });
      const s: Hold[] = [{ id: 's', type: 'jug', size: 'l', u: 200, v: 180, rot: 0, role: 'start' }];
      const r = solve({ width: 400, panels: [{ length: 520, angle: 0 }], seed: 1 }, s, { ...finishAt(240 + dv), u: 200 }, holds);
      if (!r.ok) throw new Error(r.message);
      return r;
    };
    let prev = one(110);
    let sawDyno = false;
    for (let dv = 112; dv <= 120; dv += 2) {
      const r = one(dv);
      sawDyno ||= r.moves.some((m) => m.dynamic);
      expect(r.grade - prev.grade).toBeLessThan(0.4);
      prev = r;
    }
    expect(sawDyno).toBe(true);
  });

  it('a rest jug mid-route clears the pump', () => {
    // A long 40° edge line, then the same line with one edge swapped for a big jug.
    const steep: Wall = { width: 400, panels: [{ length: 560, angle: 40 }], seed: 1 };
    const line = (rest: boolean) => {
      const holds: Hold[] = [];
      for (let v = 195, i = 0; v < 498; v += 45, i++) {
        const jug = rest && i === 3;
        holds.push({ id: `h${i}`, type: jug ? 'jug' : 'edge', size: jug ? 'l' : 'm', u: i % 2 ? 225 : 175, v, rot: 0, seed: 0 });
      }
      for (let v = 42, j = 0; v < 410; v += 35, j++) holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 215 : 185, v, rot: 0 });
      const r = solve(steep, start, finishAt(520), holds);
      if (!r.ok) throw new Error(r.message);
      return r;
    };
    const pumped = line(false);
    const rested = line(true);
    // Beyond what the jug does to the crux itself, the shake-out takes grade off.
    const fromCrux = toGrade(pumped.crux, 1) - toGrade(rested.crux, 1);
    expect(pumped.grade - rested.grade).toBeGreaterThan(fromCrux + 0.2);
  });

  it('footholds bolted upside down are poor feet', () => {
    // A vertical edge line where the only footholds are edges: upright, then flipped.
    const feet = (rot: number) => {
      const holds = ladder('edge', 45).filter((h) => h.type !== 'foot');
      for (let v = 42, j = 0; v < 270; v += 35, j++) holds.push({ id: `e${j}`, type: 'edge', size: 'm', u: j % 2 ? 215 : 185, v, rot, seed: 0 });
      return grade(wall(0), holds);
    };
    const upright = feet(0);
    expect(feet(Math.PI / 2)).toBeGreaterThan(upright + 0.2);
    expect(feet(Math.PI)).toBeGreaterThan(feet(Math.PI / 2));
  });

  it('beta ends matched on the finish', () => {
    const r = solve(wall(0), start, finishAt(380), ladder('jug', 40));
    if (!r.ok) throw new Error();
    const last = r.moves[r.moves.length - 1].to.limbs;
    expect(last[0]).toBe(last[1]);
  });
});
