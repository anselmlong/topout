import { describe, expect, it } from 'vitest';
import { moveDifficulty, moveParts, solve } from './solve';
import { thumbCatch, thumbFactors, thumbOf, radiusFactor, radiusOf, edgeRadius, jugDepth, jugDepthOf, jugWidth, jugWidthOf, shuffleCost, PALM_ALONE, SMEAR_QUALITY, footDepth, footDepthOf, incutOf, backBridge, depthGrip, depthOf, edgeDepth, edgeWidth, widthOf, footQuality, flagFor, fingersOf, flankGrip, footTechnique, handGrip, handMatchable, handTechnique, hipTurn, JUG_BUCKET, JUG_INCUT, legPush, lipV, macroShare, palmFactor, palmOpposed, pinchDepth, pinchDepthOf, pinchLength, pinchLengthGrip, pinchLengthOf, pinchSpan, widthGrip, pitchOf, sloperPitch, sloperWidth, sloperWidthOf, pocketFingers, spanOf, toGrade, typicalIncut } from './model';
import { contactList, isUnderside, lipContacts, volumeContacts } from './volumes';
import { OFF, SMEAR, type Hold, type HoldType, type Move, type Point, type Volume, type Wall } from './types';

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
    holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 215 : 185, v, rot: 0, incut: typicalIncut('foot') });
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

  it('a pocket that takes more fingers grades easier: a mono is the hardest', () => {
    const withFingers = (holds: Hold[], fingers: number) => holds.map((h) => (h.type === 'pocket' ? { ...h, fingers, incut: 0.55 } : h));
    for (const angle of [0, 25]) {
      const g = [1, 2, 3, 4].map((f) => grade(wall(angle), withFingers(ladder('pocket', 45), f)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.3);
      expect(g[1]).toBeGreaterThan(g[2]);
      expect(g[2]).toBeGreaterThanOrEqual(g[3]);
    }
    // Every size's own seeds cover a spread of finger counts, and only pockets have one.
    for (const size of ['s', 'm', 'l'] as const) expect(new Set([0, 1, 2, 3].map((v) => fingersOf(size, v))).size).toBeGreaterThan(1);
    expect(pocketFingers({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a deep pocket grades easier than a shallow one with the same fingers and hood', () => {
    const withDepth = (holds: Hold[], depth: number) => holds.map((h) => (h.type === 'pocket' ? { ...h, depth, fingers: 3, incut: 0.55 } : h));
    for (const angle of [0, 30]) {
      const g = [11, 18, 30].map((mm) => grade(wall(angle), withDepth(ladder('pocket', 45), mm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.2);
      expect(g[1]).toBeGreaterThan(g[2]);
    }
    // Every size's own seeds cover a spread of depths, and a mono is never the shallowest build.
    for (const size of ['s', 'm', 'l'] as const) {
      const depths = [0, 1, 2, 3].map((v) => depthOf('pocket', size, v)!);
      expect(new Set(depths).size).toBe(4);
      const shallowest = depths.indexOf(Math.min(...depths));
      expect(fingersOf(size, shallowest)).toBeGreaterThan(1);
    }
    expect(edgeDepth({ id: 'p', type: 'pocket', size: 'm', u: 0, v: 0, rot: 0, depth: 25 })).toBe(25);
  });

  it('a broad pinch grades easier than a thin fin of the same size and sculpting', () => {
    const withSpan = (holds: Hold[], span: number) => holds.map((h) => (h.type === 'pinch' ? { ...h, span, incut: 0.5, rot: Math.PI / 2 } : h));
    for (const angle of [0, 30]) {
      const g = [3.5, 5, 6.5].map((cm) => grade(wall(angle), withSpan(ladder('pinch', 45), cm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.2);
      expect(g[1]).toBeGreaterThan(g[2]);
    }
    // Every size's own seeds cover a spread of spans, pinch blocks all wider than a hand; other types have none.
    for (const size of ['s', 'm', 'l', 'xl'] as const) expect(new Set([0, 1, 2, 3].map((v) => spanOf(size, v))).size).toBe(4);
    expect(Math.min(...[0, 1, 2, 3].map((v) => spanOf('xl', v)!))).toBeGreaterThanOrEqual(9);
    expect(pinchSpan({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a deep-sided pinch grades easier than a low one of the same span and sculpting', () => {
    const withDepth = (holds: Hold[], depth: number) => holds.map((h) => (h.type === 'pinch' ? { ...h, depth, span: 5.5, incut: 0.5, rot: Math.PI / 2 } : h));
    for (const angle of [0, 30]) {
      const g = [18, 30, 46].map((mm) => grade(wall(angle), withDepth(ladder('pinch', 45), mm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.1);
      expect(g[1]).toBeGreaterThan(g[2]);
    }
    // Every size's own seeds cover four depths, and the lowest build is never also the thinnest;
    // pinch blocks and other types have none.
    for (const size of ['s', 'm', 'l'] as const) {
      const depths = [0, 1, 2, 3].map((v) => pinchDepthOf(size, v)!);
      expect(new Set(depths).size).toBe(4);
      const lowest = depths.indexOf(Math.min(...depths));
      const spans = [0, 1, 2, 3].map((v) => spanOf(size, v)!);
      expect(spans[lowest]).toBeGreaterThan(Math.min(...spans));
    }
    // The thumb keeps gaining past where an edge's finger pads stop: 3 cm to 6 cm still helps a pinch.
    expect(flankGrip(60) / flankGrip(30)).toBeGreaterThan(1.08);
    expect(depthGrip(60) / depthGrip(30)).toBeLessThan(1.03);
    expect(pinchDepth({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0, depth: 20 })).toBeNull();
  });

  it('a long pinch grades easier than a two-finger one of the same span and depth, by less than a crimp that short', () => {
    const withLength = (holds: Hold[], width: number) => holds.map((h) => (h.type === 'pinch' ? { ...h, width, span: 5.5, depth: 30, incut: 0.5, rot: Math.PI / 2 } : h));
    for (const angle of [0, 30]) {
      const g = [4.5, 6.5, 9].map((cm) => grade(wall(angle), withLength(ladder('pinch', 45), cm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.1);
      expect(g[1]).toBeGreaterThan(g[2]);
      expect(grade(wall(angle), withLength(ladder('pinch', 45), 14))).toBeCloseTo(g[2], 5);
    }
    // The thumb is all there whatever the length: a short pinch loses half what a short crimp does.
    expect(1 - pinchLengthGrip(4.5)).toBeCloseTo((1 - widthGrip(4.5)) / 2, 5);
    // Every size comes in four lengths, the shortest build never also the thinnest or the lowest;
    // pinch blocks and other types have none.
    for (const size of ['s', 'm', 'l'] as const) {
      const lengths = [0, 1, 2, 3].map((v) => pinchLengthOf(size, v)!);
      expect(new Set(lengths).size).toBe(4);
      const shortest = lengths.indexOf(Math.min(...lengths));
      expect(spanOf(size, shortest)).toBeGreaterThan(Math.min(...[0, 1, 2, 3].map((v) => spanOf(size, v)!)));
      expect(pinchDepthOf(size, shortest)).toBeGreaterThan(Math.min(...[0, 1, 2, 3].map((v) => pinchDepthOf(size, v)!)));
    }
    expect(Math.min(...[0, 1, 2, 3].map((v) => pinchLengthOf('s', v)!))).toBeLessThan(5);
    expect(pinchLength({ id: 'x', type: 'pinch', size: 'xl', u: 0, v: 0, rot: 0 })).toBeNull();
    expect(pinchLength({ id: 'c', type: 'crimp', size: 's', u: 0, v: 0, rot: 0, width: 5 })).toBeNull();
  });

  it('a narrow pinch block grades easier than a wide one', () => {
    const blocks = (span: number) => ladder('pinch', 55).map((h) => (h.type === 'pinch' ? { ...h, size: 'xl' as const, span, incut: 0.5, rot: Math.PI / 2 } : h));
    for (const angle of [0, 30]) {
      const g = [9, 12, 15].map((cm) => grade(wall(angle), blocks(cm)));
      expect(g[0]).toBeLessThan(g[1]);
      expect(g[1]).toBeLessThan(g[2]);
    }
  });

  it('a pinch block standing far off the wall grades easier than a low one of the same span', () => {
    const blocks = (depth: number) => ladder('pinch', 55).map((h) => (h.type === 'pinch' ? { ...h, size: 'xl' as const, span: 12, depth, incut: 0.5, rot: Math.PI / 2 } : h));
    for (const angle of [0, 30]) {
      const g = [30, 50, 85].map((mm) => grade(wall(angle), blocks(mm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.1);
      expect(g[1]).toBeGreaterThan(g[2]);
    }
    // Every block's seeds cover four depths, and the lowest build is never also the widest.
    const depths = [0, 1, 2, 3].map((v) => pinchDepthOf('xl', v)!);
    expect(new Set(depths).size).toBe(4);
    const spans = [0, 1, 2, 3].map((v) => spanOf('xl', v)!);
    expect(spans[depths.indexOf(Math.min(...depths))]).toBeLessThan(Math.max(...spans));
  });

  it('a deeper crimp grades easier than a shallow one of the same size and lip', () => {
    const withDepth = (holds: Hold[], depth: number) => holds.map((h) => (h.type === 'crimp' ? { ...h, depth, incut: 0.5 } : h));
    for (const angle of [0, 30]) {
      const g = [10, 15, 22].map((mm) => grade(wall(angle), withDepth(ladder('crimp', 45), mm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.2);
      expect(g[1]).toBeGreaterThan(g[2]);
    }
    // Depth matters less once the pads are on: 3 cm to 4 cm barely changes an edge.
    expect(depthGrip(40) / depthGrip(30)).toBeLessThan(1.03);
    expect(depthGrip(20) / depthGrip(10)).toBeGreaterThan(1.15);
    // Every size's own seeds cover a spread of depths (macro ledges too); other types have none.
    for (const type of ['crimp', 'edge'] as const)
      for (const size of ['s', 'm', 'l'] as const) expect(new Set([0, 1, 2, 3].map((v) => depthOf(type, size, v))).size).toBe(4);
    expect(new Set([0, 1, 2, 3].map((v) => depthOf('edge', 'xl', v))).size).toBe(4);
    expect(depthOf('crimp', 'xl', 0)).toBeNull();
    expect(edgeDepth({ id: 'p', type: 'pinch', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a crimp the whole hand fits on grades easier than a two-finger one of the same depth and lip', () => {
    const withWidth = (holds: Hold[], width: number) => holds.map((h) => (h.type === 'crimp' ? { ...h, width, depth: 14, incut: 0.5 } : h));
    for (const angle of [0, 30]) {
      const g = [4.5, 6.5, 9].map((cm) => grade(wall(angle), withWidth(ladder('crimp', 45), cm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.2);
      expect(g[1]).toBeGreaterThan(g[2]);
      // Past four fingers' width, a longer lip changes nothing.
      expect(grade(wall(angle), withWidth(ladder('crimp', 45), 14))).toBeCloseTo(g[2], 5);
    }
    // Small crimps and edges come short and long; every size has a spread; macros and other types have none.
    for (const type of ['crimp', 'edge'] as const)
      for (const size of ['s', 'm', 'l'] as const) expect(new Set([0, 1, 2, 3].map((v) => widthOf(type, size, v))).size).toBe(4);
    expect(Math.min(...[0, 1, 2, 3].map((v) => widthOf('crimp', 's', v)!))).toBeLessThan(5);
    expect(edgeWidth({ id: 'x', type: 'edge', size: 'xl', u: 0, v: 0, rot: 0 })).toBeNull();
    expect(edgeWidth({ id: 'p', type: 'pinch', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a sharp-lipped crimp grades easier than a rounded one of the same depth, length and incut', () => {
    const withRadius = (holds: Hold[], radius: number) => holds.map((h) => (h.type === 'crimp' ? { ...h, radius, depth: 13, width: 10, incut: 0.5 } : h));
    for (const angle of [0, 30]) {
      const g = [2, 5, 9].map((mm) => grade(wall(angle), withRadius(ladder('crimp', 45), mm)));
      expect(g[2]).toBeGreaterThan(g[1]);
      expect(g[1]).toBeGreaterThan(g[0]);
      // Under a grade: it's a corner, not a different hold.
      expect(g[2] - g[0]).toBeLessThan(1);
    }
    // A radius barely matters on a deep edge, where the pads have shelf to spare.
    const crimp: Hold = { id: 'c', type: 'crimp', size: 'm', u: 0, v: 0, rot: 0, depth: 12 };
    const edge: Hold = { id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0, depth: 40 };
    const loss = (h: Hold) => radiusFactor({ ...h, radius: 12 }) / radiusFactor({ ...h, radius: 2 });
    expect(loss(crimp)).toBeLessThan(loss(edge));
    expect(loss(edge)).toBeGreaterThan(0.97);
    // Every size's seeds cover four radii, and the roundest build is never also the flattest lip.
    for (const type of ['crimp', 'edge'] as const)
      for (const size of ['s', 'm', 'l'] as const) {
        const radii = [0, 1, 2, 3].map((v) => radiusOf(type, size, v)!);
        expect(new Set(radii).size).toBe(4);
        const incuts = [0, 1, 2, 3].map((v) => incutOf(type, size, v));
        expect(radii.indexOf(Math.max(...radii))).not.toBe(incuts.indexOf(Math.min(...incuts)));
      }
    expect(edgeRadius({ id: 'p', type: 'pinch', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a crimp with a thumb catch grades easier than a plain one of the same build, more so on an overhang', () => {
    const withThumb = (holds: Hold[], thumb: boolean) => holds.map((h) => (h.type === 'crimp' ? { ...h, thumb, depth: 13, width: 10, radius: 4, incut: 0.5 } : h));
    const gain = [0, 40].map((angle) => {
      const plain = grade(wall(angle), withThumb(ladder('crimp', 45), false));
      const caught = grade(wall(angle), withThumb(ladder('crimp', 45), true));
      expect(caught).toBeLessThan(plain);
      // Under a grade: the thumb helps, it doesn't make the crimp a jug.
      expect(plain - caught).toBeLessThan(1);
      return plain - caught;
    });
    // The thumb squeezes, so it keeps the fingers on as the pull swings out.
    expect(gain[1]).toBeGreaterThan(gain[0]);
    // One build in four of each size has one, never the deepest lip; only crimps.
    for (const size of ['s', 'm', 'l'] as const) {
      const builds = [0, 1, 2, 3].filter((v) => thumbOf('crimp', size, v));
      expect(builds.length).toBe(1);
      const incuts = [0, 1, 2, 3].map((v) => incutOf('crimp', size, v));
      expect(builds[0]).not.toBe(incuts.indexOf(Math.max(...incuts)));
    }
    expect(thumbCatch({ id: 'e', type: 'edge', size: 's', u: 0, v: 0, rot: 0 })).toBeNull();
    expect(thumbFactors({ id: 'e', type: 'edge', size: 's', u: 0, v: 0, rot: 0 })).toEqual({ grip: 1, steep: 1 });
  });

  it('a sharp-rimmed pocket grades easier than a rolled one of the same depth, fingers and hood', () => {
    const withRim = (holds: Hold[], radius: number) => holds.map((h) => (h.type === 'pocket' ? { ...h, radius, depth: 14, fingers: 3, incut: 0.55 } : h));
    for (const angle of [0, 30]) {
      const g = [2, 5, 9].map((mm) => grade(wall(angle), withRim(ladder('pocket', 45), mm)));
      expect(g[2]).toBeGreaterThan(g[1]);
      expect(g[1]).toBeGreaterThan(g[0]);
      // Under a grade: it's the rim, not a different hold.
      expect(g[2] - g[0]).toBeLessThan(1);
    }
    // A rim matters more round a shallow hole than a deep one the fingers sink into.
    const pocket = (depth: number): Hold => ({ id: 'p', type: 'pocket', size: 'm', u: 0, v: 0, rot: 0, depth });
    const loss = (h: Hold) => radiusFactor({ ...h, radius: 8 }) / radiusFactor({ ...h, radius: 2 });
    expect(loss(pocket(12))).toBeLessThan(loss(pocket(28)));
    expect(loss(pocket(12))).toBeLessThan(1);
    // Every size's seeds cover four rims, and the roundest rim is never also the shallowest hole.
    for (const size of ['s', 'm', 'l', 'xl'] as const) {
      const radii = [0, 1, 2, 3].map((v) => radiusOf('pocket', size, v)!);
      expect(new Set(radii).size).toBe(4);
      const depths = [0, 1, 2, 3].map((v) => depthOf('pocket', size, v)!);
      expect(radii.indexOf(Math.max(...radii))).not.toBe(depths.indexOf(Math.min(...depths)));
    }
  });

  it('a rail ledge grades harder than a deep shelf of the same lip, by under a grade', () => {
    const ledges = (depth: number) => ladder('edge', 55).map((h) => (h.type === 'edge' ? { ...h, size: 'xl' as const, depth, incut: 0.55 } : h));
    for (const angle of [0, 30]) {
      const g = [24, 34, 60].map((mm) => grade(wall(angle), ledges(mm)));
      expect(g[0]).toBeGreaterThan(g[1]);
      expect(g[1]).toBeGreaterThan(g[2]);
      // Past the pads, depth is a small effect: a rail to a shelf is well under a grade.
      expect(g[0] - g[2]).toBeLessThan(1);
    }
  });

  it('a flat-topped sloper grades easier than a steep one of the same size and dish, more so when steep', () => {
    const withPitch = (holds: Hold[], pitch: number) => holds.map((h) => (h.type === 'sloper' ? { ...h, pitch, incut: 0.15 } : h));
    const gap: number[] = [];
    for (const angle of [0, 30]) {
      const g = [27, 39, 51].map((deg) => grade(wall(angle), withPitch(ladder('sloper', 45), deg)));
      expect(g[0]).toBeLessThan(g[1]);
      expect(g[1]).toBeLessThan(g[2]);
      gap.push(g[2] - g[0]);
    }
    expect(gap[0]).toBeGreaterThan(0.2);
    // The pull swinging out on an overhang costs a steep sloper more than a flat-topped one.
    const body = { u: 200, v: 150 };
    const at = (deg: number, angle: number) => handGrip({ id: 's', type: 'sloper', size: 'm', u: 200, v: 200, rot: 0, pitch: deg }, body, wall(angle));
    expect(at(51, 35) / at(51, 0)).toBeLessThan(at(27, 35) / at(27, 0));
    // Every size's own seeds cover a spread of pitches, macros the widest; other types have none.
    for (const size of ['s', 'm', 'l', 'xl'] as const) expect(new Set([0, 1, 2, 3].map((v) => pitchOf(size, v))).size).toBe(4);
    expect(Math.max(...[0, 1, 2, 3].map((v) => pitchOf('xl', v)!)) - Math.min(...[0, 1, 2, 3].map((v) => pitchOf('xl', v)!))).toBeGreaterThanOrEqual(30);
    expect(sloperPitch({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a wide sloper grades easier than a narrow one of the same size, pitch and dish', () => {
    const withWidth = (holds: Hold[], width: number) => holds.map((h) => (h.type === 'sloper' ? { ...h, width, pitch: 39, incut: 0.15 } : h));
    for (const angle of [0, 30]) {
      const g = [8, 13, 19].map((cm) => grade(wall(angle), withWidth(ladder('sloper', 45), cm)));
      expect(g[0]).toBeGreaterThan(g[1] + 0.1);
      expect(g[1]).toBeGreaterThan(g[2]);
      // Skin, not the lip, plus room to match past SLOPER_MATCH_WIDTH: under a grade and a half
      // from three fingers to a splayed hand.
      expect(g[0] - g[2]).toBeLessThan(1.5);
    }
    // Every size's seeds cover four widths, and the narrowest build is never also the steepest.
    for (const size of ['s', 'm', 'l'] as const) {
      const widths = [0, 1, 2, 3].map((v) => sloperWidthOf(size, v)!);
      expect(new Set(widths).size).toBe(4);
      const narrow = widths.indexOf(Math.min(...widths));
      expect(pitchOf(size, narrow)).not.toBe(Math.max(...[0, 1, 2, 3].map((v) => pitchOf(size, v)!)));
    }
    // Macros and other types have none.
    expect(sloperWidth({ id: 'x', type: 'sloper', size: 'xl', u: 0, v: 0, rot: 0 })).toBeNull();
    expect(sloperWidth({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
  });

  it('a medium sloper takes both hands only when it is wide enough', () => {
    const sloper = (size: 's' | 'm' | 'l', width: number) => ({ id: 'x', type: 'sloper' as const, size, u: 0, v: 0, rot: 0, width });
    expect(handMatchable(sloper('m', 10))).toBe(false);
    expect(handMatchable(sloper('m', 13))).toBe(true);
    // Large slopers always take two; a small one never does, however wide.
    expect(handMatchable(sloper('l', 14))).toBe(true);
    expect(handMatchable(sloper('s', 13))).toBe(false);
  });

  it('a one-hand jug takes a hand swap only as a costly shuffle, so the climber matches it less', () => {
    // Horns and pinch jugs are one-hand holds until large; buckets, ledges and slopey jugs take two
    // from medium, and a small one only in its wide build.
    for (const size of ['s', 'm', 'l'] as const) {
      for (let f = 0; f < JUG_INCUT.length; f++) expect(jugWidthOf(size, f)).toBeLessThan(jugWidthOf(size, f + JUG_INCUT.length));
    }
    const jug = (size: 's' | 'm' | 'l', seed: number) => ({ id: 'x', type: 'jug' as const, size, u: 0, v: 0, rot: 0, seed });
    expect(shuffleCost(jug('m', 3))).toBeGreaterThan(0); // narrow horn
    expect(shuffleCost(jug('m', 0))).toBe(0); // narrow bucket
    expect(shuffleCost(jug('s', 0))).toBeGreaterThan(0);
    expect(shuffleCost(jug('s', 6))).toBe(0);
    expect(shuffleCost({ ...jug('s', 3), width: 12 })).toBe(0);
    expect(shuffleCost({ ...jug('s', 3), role: 'finish' as const })).toBe(0);
    expect(jugWidth({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
    // The same jug line, every hold one-hand or two-hand: it matches the wide ones and swaps
    // hands on the narrow ones less, and the narrow line grades a little harder.
    const line = (width: number) => ladder('jug', 55).map((h) => (h.type === 'jug' ? { ...h, width } : h));
    const climb = (width: number) => {
      const r = solve(wall(0), start, finishAt(380), line(width));
      if (!r.ok) throw new Error(r.message);
      // Both hands on one hold below the finish.
      return { grade: r.grade, matches: r.moves.filter((m) => m.limb <= 1 && m.to.limbs[0] === m.to.limbs[1] && m.to.points[0].v < 370).length };
    };
    const [narrow, wide] = [7, 16].map(climb);
    expect(wide.matches).toBeGreaterThan(narrow.matches);
    expect(narrow.grade).toBeGreaterThan(wide.grade);
    expect(narrow.grade - wide.grade).toBeLessThan(1);
  });

  it('a shallow jug opens up on an overhang; a deep one hangs at any angle', () => {
    // Each size comes shallow to deep, and a family's two builds sit apart in it.
    for (const size of ['s', 'm', 'l'] as const) {
      const all = Array.from({ length: 2 * JUG_INCUT.length }, (_, k) => jugDepthOf(size, k)!);
      expect(new Set(all).size).toBe(4);
      for (let f = 0; f < JUG_INCUT.length; f++) expect(jugDepthOf(size, f)).not.toBe(jugDepthOf(size, f + JUG_INCUT.length));
    }
    expect(jugDepth({ id: 'e', type: 'edge', size: 'm', u: 0, v: 0, rot: 0 })).toBeNull();
    // Buckets, so the lip doesn't open up either (JUG_OPEN): only the depth counts.
    const jug = (size: 's' | 'm', depth?: number) => ({ id: 'x', type: 'jug' as const, size, u: 200, v: 300, rot: 0, incut: JUG_BUCKET, depth });
    const below = { u: 200, v: 200 };
    const ratio = (size: 's' | 'm', depth?: number) => handGrip(jug(size, depth), below, wall(40)) / handGrip(jug(size, depth), below, wall(0));
    expect(ratio('m', 60)).toBeCloseTo(1);
    expect(ratio('s', 40)).toBeLessThan(0.9);
    // A small jug as deep as a medium one hangs like it; a medium one as shallow as a mini doesn't.
    expect(ratio('s', 60)).toBeCloseTo(1);
    expect(ratio('m', 38)).toBeCloseTo(ratio('s', 38));
    // The same jug line, every hold shallow or deep: the same on a vertical wall, harder steep.
    const line = (depth: number) => ladder('jug', 55).map((h) => (h.type === 'jug' ? { ...h, size: 'm' as const, width: 16, depth } : h));
    expect(grade(wall(0), line(40))).toBeCloseTo(grade(wall(0), line(64)), 1);
    expect(grade(wall(30), line(40)) - grade(wall(30), line(64))).toBeGreaterThan(0.3);
  });

  it("a jug whose lip stays open opens up on an overhang; a bucket's closed lip doesn't", () => {
    const jug = (incut: number) => ({ id: 'x', type: 'jug' as const, size: 'l' as const, u: 200, v: 300, rot: 0, incut, depth: 70 });
    const below = { u: 200, v: 200 };
    const ratio = (incut: number) => handGrip(jug(incut), below, wall(40)) / handGrip(jug(incut), below, wall(0));
    expect(ratio(JUG_BUCKET)).toBeCloseTo(1);
    expect(ratio(0.7)).toBeLessThan(0.95);
    // Atomik's least-incut large basic jugs against its double incuts: the same on a vertical
    // wall, a grade or more apart at 40° (V3 against V1 at 45°).
    const line = (incut: number) => ladder('jug', 55).map((h) => (h.type === 'jug' && !h.role ? { ...h, size: 'l' as const, incut, depth: 70 } : h));
    expect(grade(wall(0), line(0.6))).toBeCloseTo(grade(wall(0), line(1)), 1);
    expect(grade(wall(40), line(0.6)) - grade(wall(40), line(1))).toBeGreaterThan(0.8);
  });

  it('a flat-topped macro sloper grades easier than a steep one, more so when steep', () => {
    const macros = (pitch: number) => ladder('sloper', 55).map((h) => (h.type === 'sloper' ? { ...h, size: 'xl' as const, pitch, incut: 0.15 } : h));
    const gap = [0, 30].map((angle) => {
      const g = [20, 35, 50].map((deg) => grade(wall(angle), macros(deg)));
      expect(g[0]).toBeLessThan(g[1]);
      expect(g[1]).toBeLessThan(g[2]);
      return g[2] - g[0];
    });
    expect(gap[0]).toBeGreaterThan(0.2);
    expect(gap[1]).toBeGreaterThan(gap[0]);
  });

  it('a blank macro dome holds like a large sloper; a dished one keeps its macro bonus', () => {
    const body = { u: 200, v: 150 };
    const at = (size: 'l' | 'xl', pitch: number, angle: number) => handGrip({ id: 's', type: 'sloper', size, u: 200, v: 200, rot: 0, pitch, incut: 0.15 }, body, wall(angle));
    for (const angle of [0, 25]) {
      // At the steep end, the macro's size buys nothing over a large sloper of the same pitch.
      expect(at('xl', 50, angle) / at('l', 50, angle)).toBeCloseTo(1, 1);
      // Up to 40 degrees, it keeps all of it.
      expect(at('xl', 40, angle)).toBeGreaterThan(at('l', 40, angle) * 1.1);
    }
    // So the macro pitch spread is wider than a large sloper's: blank to dished, it's 1.8 grades or more.
    const macros = (pitch: number) => ladder('sloper', 55).map((h) => (h.type === 'sloper' ? { ...h, size: 'xl' as const, pitch, incut: 0.15 } : h));
    expect(grade(wall(25), macros(50)) - grade(wall(25), macros(20))).toBeGreaterThan(1.8);
    // Pinch blocks and ledges have no pitch and keep their bonus.
    expect(macroShare({ id: 'p', type: 'pinch', size: 'xl', u: 0, v: 0, rot: 0 })).toBe(1);
  });

  it("a slopey jug rolls off steep ground; a bucket's lip holds at any angle", () => {
    const jug: Hold = { id: 'j', type: 'jug', size: 'm', u: 200, v: 200, rot: 0 };
    const body = { u: 200, v: 150 };
    const grip = (incut: number, angle: number) => handGrip({ ...jug, incut }, body, wall(angle));
    const bucket = Math.max(...JUG_INCUT);
    const slopey = Math.min(...JUG_INCUT);
    expect(grip(bucket, 40)).toBeCloseTo(grip(bucket, 0), 6);
    expect(grip(slopey, 40)).toBeLessThan(grip(slopey, 0) * 0.93);
    // A jug ladder of slopey jugs on a 40° wall grades harder than the same ladder of buckets.
    const withIncut = (holds: Hold[], incut: number) => holds.map((h) => (h.type === 'jug' ? { ...h, incut } : h));
    expect(grade(wall(40), withIncut(ladder('jug', 50), slopey))).toBeGreaterThan(grade(wall(40), withIncut(ladder('jug', 50), bucket)) + 0.3);
  });

  it('positive foot chips grade easier than rounded ones of the same size', () => {
    const feet = (holds: Hold[], incut: number) => holds.map((h) => (h.type === 'foot' ? { ...h, incut } : h));
    // Slabs live on the feet: there the chips' incut is worth a grade or a big part of one.
    for (const [type, angle] of [['edge', -15], ['edge', -10], ['crimp', -15]] as const) {
      const rounded = grade(wall(angle), feet(ladder(type, 45), 0));
      const positive = grade(wall(angle), feet(ladder(type, 45), 0.9));
      expect(positive).toBeLessThan(rounded - 0.2);
    }
    // A rounded chip is still better than nothing to stand on: it's a worse foothold, not a smear.
    const chip: Hold = { id: 'c', type: 'foot', size: 'm', u: 200, v: 100, rot: 0 };
    expect(footQuality({ ...chip, incut: 0.9 })).toBeGreaterThan(footQuality({ ...chip, incut: 0 }));
    expect(footQuality({ ...chip, incut: 0 })).toBeGreaterThan(SMEAR_QUALITY.vertical);
  });

  it('big foot chips grade easier than tiny ones of the same incut', () => {
    // The hand crimps pinned to their thumb-catch build: on the plain one (seed 0) the slab crimp
    // line's crux is a hand move every chip size shares, so tiny and mid tie to 0.0001.
    const feet = (holds: Hold[], depth: number) => holds.map((h) => (h.type === 'foot' ? { ...h, depth, incut: 0.45 } : h.type === 'crimp' ? { ...h, thumb: true } : h));
    // On a slab the feet carry the climb, so the chips' size shows in the grade.
    for (const [type, angle] of [['edge', -15], ['crimp', -10]] as const) {
      const tiny = grade(wall(angle), feet(ladder(type, 45), 11));
      const mid = grade(wall(angle), feet(ladder(type, 45), 19));
      const big = grade(wall(angle), feet(ladder(type, 45), 29));
      expect(tiny).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThanOrEqual(big);
      expect(tiny).toBeGreaterThan(big + 0.1);
    }
    const chip: Hold = { id: 'c', type: 'foot', size: 'm', u: 200, v: 100, rot: 0, incut: 0.45 };
    expect(footQuality({ ...chip, depth: 29 })).toBeGreaterThan(footQuality({ ...chip, depth: 11 }));
    expect(footQuality({ ...chip, depth: 11 })).toBeGreaterThan(SMEAR_QUALITY.vertical);
    // Every build of a size is a different depth, and the smallest chip is never also the roundest.
    for (const size of ['s', 'm', 'l'] as const) {
      const depths = [0, 1, 2, 3].map((v) => footDepthOf(size, v)!);
      expect(new Set(depths).size).toBe(4);
      const smallest = depths.indexOf(Math.min(...depths));
      const roundest = [0, 1, 2, 3].map((v) => incutOf('foot', size, v)).indexOf(Math.min(...[0, 1, 2, 3].map((v) => incutOf('foot', size, v))));
      expect(smallest).not.toBe(roundest);
    }
    // Only foot chips: an edge stood on keeps its quality.
    expect(footDepth({ ...chip, type: 'edge' })).toBeNull();
  });

  it('tall jibs grade easier than low ones of the same incut', () => {
    // The hand holds' lips are pinned (a typical corner), so only the jibs differ.
    const jibs = (holds: Hold[], depth: number) => holds.map((h) => (h.type === 'foot' ? { ...h, type: 'jib' as const, depth, incut: 0.45 } : { ...h, radius: 6 }));
    // On a slab the climber smears past a jib anyway; near vertical it stands on them.
    for (const [type, angle] of [['edge', -5], ['crimp', 10]] as const) {
      const low = grade(wall(angle), jibs(ladder(type, 45), 8));
      const mid = grade(wall(angle), jibs(ladder(type, 45), 14));
      const tall = grade(wall(angle), jibs(ladder(type, 45), 23));
      expect(low).toBeGreaterThanOrEqual(mid);
      expect(mid).toBeGreaterThanOrEqual(tall);
      // On the slab the hardest move is a step, and a step costs the same whatever it lands on.
      expect(low).toBeGreaterThan(tall + 0.1);
    }
    const jib: Hold = { id: 'j', type: 'jib', size: 'm', u: 200, v: 100, rot: 0, incut: 0.45 };
    expect(footQuality({ ...jib, depth: 23 })).toBeGreaterThan(footQuality({ ...jib, depth: 8 }));
    // A jib is still a worse foot than a chip of the same depth.
    expect(footQuality({ ...jib, depth: 16 })).toBeLessThan(footQuality({ ...jib, type: 'foot', depth: 16 }));
    for (const size of ['s', 'm', 'l'] as const) {
      const depths = [0, 1, 2, 3].map((v) => footDepthOf(size, v, 'jib')!);
      expect(new Set(depths).size).toBe(4);
      const incuts = [0, 1, 2, 3].map((v) => incutOf('jib', size, v));
      expect(depths.indexOf(Math.min(...depths))).not.toBe(incuts.indexOf(Math.min(...incuts)));
    }
    expect(footDepth(jib)).not.toBeNull();
  });

  it('a macro sloper or ledge grades easier than a medium one, and a sloper macro still rolls off steep', () => {
    const macro = (holds: Hold[]) => holds.map((h) => (h.type === 'foot' ? h : { ...h, size: 'xl' as const }));
    for (const type of ['sloper', 'edge'] as const) {
      expect(grade(wall(10), macro(ladder(type, 50)))).toBeLessThan(grade(wall(10), ladder(type, 50)) - 0.3);
    }
    const sloper: Hold = { id: 'm', type: 'sloper', size: 'xl', u: 200, v: 200, rot: 0, seed: 0 };
    const ledge: Hold = { ...sloper, type: 'edge' };
    const body = { u: 200, v: 150 };
    expect(handGrip(sloper, body, wall(40)) / handGrip(sloper, body, wall(0))).toBeLessThan(
      handGrip(ledge, body, wall(40)) / handGrip(ledge, body, wall(0)),
    );
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
    // The crux eases; the grade can carry a little more pump, as the feet step up through
    // an intermediate foothold under the wedge instead of hanging one off and pulling it up.
    expect(tilted.crux).toBeLessThan(plain.crux);
    expect(tilted.grade).toBeLessThan(plain.grade + 0.1);
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

  it('back-and-foot: in a tight vertical corner the back leans on one face, feet on the other', () => {
    const corner = (angle: number, fold: number): Wall => ({ ...wall(angle), fold: { u: 200, angle: fold } });
    const hands: [Point, Point] = [{ u: 185, v: 250 }, { u: 215, v: 290 }];
    // Feet on the right face, far enough out to strut across: the back goes on the left face.
    expect(backBridge(corner(0, 90), hands, [{ u: 250, v: 120 }, { u: 262, v: 150 }])?.side).toBe(-1);
    // Not with a foot on each face (that's a stem), feet tucked into the crease, a wide
    // open corner, the hands away from the corner, or an overhanging corner.
    expect(backBridge(corner(0, 90), hands, [{ u: 150, v: 120 }, { u: 262, v: 150 }])).toBeNull();
    expect(backBridge(corner(0, 90), hands, [{ u: 215, v: 120 }, { u: 225, v: 150 }])).toBeNull();
    expect(backBridge(corner(0, 60), hands, [{ u: 250, v: 120 }, { u: 262, v: 150 }])).toBeNull();
    expect(backBridge(corner(0, 90), [{ u: 290, v: 250 }, { u: 320, v: 290 }], [{ u: 250, v: 120 }, { u: 262, v: 150 }])).toBeNull();
    expect(backBridge(corner(30, 90), hands, [{ u: 250, v: 120 }, { u: 262, v: 150 }])).toBeNull();
    // A foot stood in the crease neither struts nor stops the other foot strutting.
    const one = backBridge(corner(0, 90), hands, [{ u: 262, v: 150 }]);
    expect(backBridge(corner(0, 90), hands, [{ u: 204, v: 120 }, { u: 262, v: 150 }])).toEqual(one);
    expect(one?.side).toBe(-1);

    // Crimps up the crease, footholds only on the right face: the climber leans back into
    // the corner on the way up, and it climbs easier than the same holds in a wide corner.
    const holds: Hold[] = [];
    for (let v = 195, i = 0; v < 360; v += 45, i++) holds.push({ id: `h${i}`, type: 'crimp', size: 'm', u: i % 2 ? 215 : 185, v, rot: 0, seed: 0 });
    // Medium chips: the back-and-foot takes a few foot moves to set up, so it has to be worth more than SLACK.
    for (let v = 42, j = 0; v < 270; v += 35, j++) holds.push({ id: `f${j}`, type: 'foot', size: 's', u: j % 2 ? 262 : 250, v, rot: 0, incut: typicalIncut('foot') });
    const bridged = (w: Wall) => {
      const r = solve(w, start, finishAt(380), holds);
      if (!r.ok) throw new Error(r.message);
      const n = [r.start, ...r.moves.map((m) => m.to)].filter((st) =>
        backBridge(w, [st.points[0], st.points[1]], st.points.slice(2).map((p, i) => (st.limbs[2 + i] === OFF ? null : p))),
      ).length;
      return { grade: r.grade, n };
    };
    const tight = bridged(corner(0, 90));
    expect(tight.n).toBeGreaterThan(0);
    expect(tight.grade).toBeLessThan(bridged(corner(0, 60)).grade);
    // Overhanging, the back can't hold the body in: no back-and-foot.
    expect(bridged(corner(30, 90)).n).toBe(0);
  });

  it('in a corner, stands on the start jug in the crease rather than both feet on the other one', () => {
    // Day 14's 11° corner, as curated: one start jug out on the left face, the other in the
    // crease. A foot in the crease used to stop the left foot leaning the back across, so the
    // climber stood both feet on the left jug for the reach and shuffled a foot over after.
    const corner: Wall = { width: 380, panels: [{ length: 456, angle: 11 }], seed: 4119164483, fold: { u: 158, angle: 90 } };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 108, v: 148, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 159, v: 152, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'edge', size: 'l', u: 189.1, v: 216.0, rot: -0.048, seed: 8 },
      { id: 'h3', type: 'pinch', size: 'l', u: 107.4, v: 259.7, rot: -1.011, seed: 4 },
      { id: 'h4', type: 'pocket', size: 's', u: 178.2, v: 310.7, rot: -0.301, seed: 1 },
      { id: 'h5', type: 'pinch', size: 'l', u: 120.9, v: 345.2, rot: -0.96, seed: 5 },
    ];
    const r = solve(corner, jugs, { id: 'finish', type: 'jug', size: 'l', u: 162, v: 415, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    // No hand move made with both feet on one start jug.
    expect(r.moves.some((m) => m.limb <= 1 && m.from.limbs[2] === m.from.limbs[3] && m.from.limbs[2] >= 0)).toBe(false);
    expect(Math.round(r.grade)).toBe(2);
  });

  it('steps up through the feet it stands on, not down to a low jug and back', () => {
    // Day 48's 25° wall, as curated. With the feet matched on the big edge h3, the climber
    // walked a foot down onto the pinch block and the other 58 cm down to the start jug, so
    // the standing foot was a jug for the step up, then back up. Stood that far below the
    // hands, the leg is stretched straight and the arms carry the body.
    const wall: Wall = { width: 360, panels: [{ length: 40, angle: 0 }, { length: 403, angle: 25 }], seed: 837651325 };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 257, v: 160, rot: 0, role: 'start' }];
    const holds: Hold[] = [
      { id: 'h2', type: 'pinch', size: 'xl', u: 259.6, v: 199.4, rot: 1.248, seed: 8 },
      { id: 'h3', type: 'edge', size: 'l', u: 189.2, v: 218.2, rot: 0.268, seed: 10 },
      { id: 'h5', type: 'pocket', size: 'l', u: 186.0, v: 272.8, rot: -0.045, seed: 3 },
      { id: 'h6', type: 'edge', size: 'l', u: 239.1, v: 278.7, rot: -0.117, seed: 11 },
      { id: 'h8', type: 'crimp', size: 'l', u: 216.6, v: 334.8, rot: 0.325, seed: 5 },
      { id: 'h10', type: 'crimp', size: 'l', u: 196.6, v: 362.3, rot: -0.199, seed: 2 },
      { id: 'f1', type: 'foot', size: 'm', u: 205.7, v: 96.3, rot: 0, seed: 2 },
      { id: 'f2', type: 'foot', size: 'm', u: 173.2, v: 122.0, rot: 0, seed: 1 },
    ];
    const r = solve(wall, jug, { id: 'finish', type: 'jug', size: 'l', u: 141, v: 408, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    const down = r.moves.filter((m) => m.limb >= 2 && m.from.limbs[m.limb] >= 0 && m.to.limbs[m.limb] >= 0 && m.to.points[m.limb].v < m.from.points[m.limb].v - 15);
    expect(down).toHaveLength(0);
    expect(Math.round(r.grade)).toBeLessThanOrEqual(3);
  });

  it('steps a foot straight up rather than shuffling both feet to make the step a little easier', () => {
    // Day 56's 105° corner, as curated. Stood on the crimp h3 with the other foot on the jug h2,
    // the climber walked the h3 foot 89 cm down to the start jug, moved the other foot onto h3
    // and on to h4, then walked the first foot back up to h3: four foot moves to make the step
    // up to h4 6% easier than stepping straight there off h2. Its pockets keep their size's typical
    // rim (they were all one rim when the day was curated; a seed's sharp rim tips it back).
    const wall: Wall = { width: 400, panels: [{ length: 451, angle: 8 }], seed: 1593924108, fold: { u: 177, angle: 105 } };
    const start: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 153, v: 135, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 206, v: 151, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'jug', size: 's', u: 219.7, v: 194.4, rot: -0.302 },
      { id: 'h3', type: 'crimp', size: 'm', u: 156.8, v: 224.0, rot: 0.125 },
      { id: 'h4', type: 'pocket', size: 'm', u: 229.7, v: 254.3, rot: -0.218, radius: 5 },
      { id: 'h6', type: 'pocket', size: 's', u: 238.9, v: 309.1, rot: -0.108, radius: 3.75 },
      { id: 'h7', type: 'sloper', size: 'm', u: 178.7, v: 347.3, rot: 0.045 },
      { id: 'h8', type: 'sloper', size: 'm', u: 249.9, v: 363.8, rot: 0.195 },
    ];
    const r = solve(wall, start, { id: 'finish', type: 'jug', size: 'l', u: 220, v: 421, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    const down = r.moves.filter((m) => m.limb >= 2 && m.from.limbs[m.limb] >= 0 && m.to.limbs[m.limb] >= 0 && m.to.points[m.limb].v < m.from.points[m.limb].v - 15);
    expect(down).toHaveLength(0);
    expect(r.moves.length).toBeLessThanOrEqual(12);
    expect(Math.round(r.grade)).toBe(1);
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

  it('in a corner, steps up onto the holds below instead of smearing past them all the way', () => {
    // Day 97's reference route, as curated: a 6° overhanging 90° corner, holds on both faces.
    const corner: Wall = { width: 360, panels: [{ length: 499, angle: 6 }], seed: 1, fold: { u: 145, angle: 90 } };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 108, v: 143, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 149, v: 149, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'crimp', size: 'm', u: 152, v: 217, rot: 0.26 },
      { id: 'h3', type: 'edge', size: 'm', u: 117, v: 233, rot: -0.25 },
      { id: 'h4', type: 'edge', size: 'l', u: 161, v: 278, rot: -0.17 },
      { id: 'h5', type: 'pinch', size: 'l', u: 120, v: 309, rot: -0.68 },
      { id: 'h6', type: 'pinch', size: 's', u: 165, v: 344, rot: 0.62 },
      { id: 'h8', type: 'sloper', size: 'l', u: 163, v: 396, rot: -0.01 },
    ];
    const r = solve(corner, jugs, { id: 'finish', type: 'jug', size: 'l', u: 158, v: 459, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to stem two smears up behind the hands for all ten hand moves, never placing a
    // foot. Re-placing a smear now costs the beta about what a step does, so the feet go
    // up the edges and pinches the hands left.
    const steps = r.moves.filter((m) => m.limb >= 2 && m.to.limbs[m.limb] >= 0);
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });

  it('sets a foot up before a hard reach instead of muscling it with a foot off', () => {
    // Day 23's vertical wall, as curated: start jugs, a big sloper, a small sloper and a big
    // crimp up and left, two foot chips.
    const face: Wall = { width: 400, panels: [{ length: 456, angle: 1 }], seed: 1 };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 211, v: 160, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 259, v: 166, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'sloper', size: 'l', u: 220.79, v: 243.14, rot: -0.051 },
      { id: 'h3', type: 'sloper', size: 's', u: 143.33, v: 301.96, rot: 0.025 },
      { id: 'h4', type: 'crimp', size: 'l', u: 179.58, v: 334.47, rot: 0.111 },
      { id: 'f0', type: 'foot', size: 'm', u: 165.99, v: 244.81, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 183.06, v: 99.09, rot: 0 },
    ];
    const r = solve(face, jugs, { id: 'finish', type: 'jug', size: 'l', u: 116, v: 422, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to make two of its hard reaches with the right foot hanging: matching the big
    // sloper, and the finish, after cutting the foot loose. Now the foot goes on first (the
    // start jug, then the big sloper), so no hard reach is made with a foot off.
    const hard = r.moves.filter((m) => m.limb <= 1 && m.difficulty >= r.crux * 0.85);
    expect(hard.length).toBeGreaterThan(0);
    for (const m of hard) expect(m.from.limbs.slice(2)).not.toContain(OFF);
  });

  it('keeps a smearing foot on a slab for a reach instead of taking it off first', () => {
    // Day 1's -8 deg slab, as curated: start jugs, a big jug above them and holds up and left.
    const slab: Wall = { width: 400, panels: [{ length: 464, angle: -8 }], seed: 1 };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 230, v: 152, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 281, v: 151, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h1', type: 'pocket', size: 'm', u: 215.49, v: 177.06, rot: 0.185 },
      { id: 'h4', type: 'jug', size: 'l', u: 229.67, v: 236.08, rot: -0.241 },
      { id: 'h5', type: 'edge', size: 'l', u: 154.1, v: 268.21, rot: -0.178 },
      { id: 'h6', type: 'crimp', size: 'l', u: 210.28, v: 290.04, rot: -0.082 },
      { id: 'h8', type: 'jug', size: 's', u: 179.3, v: 342.42, rot: -0.018 },
      { id: 'h10', type: 'sloper', size: 'm', u: 159.04, v: 383.05, rot: 0.318 },
      { id: 'f0', type: 'jib', size: 'm', u: 141, v: 221.93, rot: 0 },
    ];
    const r = solve(slab, jugs, { id: 'finish', type: 'jug', size: 'l', u: 101, v: 429, rot: 0, role: 'finish' }, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to take the right foot off its smear ("Right foot -> off"), match the big jug
    // with the leg hanging, then put the foot back on: the smear, placed under the low hand
    // going up, was priced as stretched out far below the reach. Now the smear trails for
    // the reach like a flag and stays on the slab.
    expect(r.moves.some((m) => m.limb >= 2 && m.from.limbs[m.limb] === SMEAR && m.to.limbs[m.limb] === OFF)).toBe(false);
    expect(Math.round(r.grade)).toBe(0);
  });

  it("stands on a volume's top face or a foot chip, not its underside", () => {
    // A player's route on day 44's slab corner: a small pyramid volume low down by the start
    // jug, a foot chip under the jug and crimps up and right. The volume's lower faces point
    // at the floor: only a toe pressed up against them, never what a climber stands on.
    const corner: Wall = { width: 380, panels: [{ length: 500, angle: -8 }], seed: 1, fold: { u: 174, angle: 105 } };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 198, v: 140, rot: 0, role: 'start' }];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 295, v: 469, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h1', type: 'pocket', size: 's', u: 190.45, v: 191.82, rot: -0.017, seed: 3 },
      { id: 'h2', type: 'crimp', size: 'm', u: 240.55, v: 258.29, rot: -0.137, seed: 10 },
      { id: 'h3', type: 'crimp', size: 'm', u: 239.79, v: 312.11, rot: -0.043, seed: 9 },
      { id: 'h4', type: 'sloper', size: 'l', u: 290.88, v: 359.13, rot: -0.117, seed: 8 },
      { id: 'h5', type: 'edge', size: 'm', u: 265.06, v: 416.66, rot: 0.205, seed: 2 },
      { id: 'f0', type: 'jib', size: 'm', u: 265.7, v: 204.75, rot: 0, seed: 4 },
      { id: 'f1', type: 'foot', size: 'm', u: 189.51, v: 105.27, rot: 0, seed: 8 },
      { id: 'f2', type: 'foot', size: 'm', u: 301.38, v: 236.48, rot: 0, seed: 4 },
      { id: 'f4', type: 'jib', size: 'm', u: 286.37, v: 250.33, rot: 0, seed: 5 },
      { id: 'f5', type: 'jib', size: 'm', u: 237.8, v: 206.48, rot: 0, seed: 2 },
    ];
    const volumes: Volume[] = [{ id: 'v0', shape: 'pyramid', size: 's', u: 247.71, v: 102.19, rot: Math.PI / 2 }];
    const r = solve(corner, jug, finish, holds, { volumes });
    if (!r.ok) throw new Error(r.message);
    // It used to start with a foot on the volume's underside and make the first two hand
    // moves from it, with the top face and the foot chip both in reach.
    const contacts = contactList(jug, finish, holds, volumes, corner);
    const pressed = r.moves.filter((m) => m.limb <= 1 && [2, 3].some((f) => m.from.limbs[f] >= 0 && isUnderside(contacts[m.from.limbs[f]])));
    expect(pressed).toHaveLength(0);
  });

  it('keeps its feet apart on separate holds instead of standing both on one jug', () => {
    // A player's route on day 8's slab: a ladder of jugs and edges up the right, slopers and
    // edges up the left, a jib and foot chips low down.
    const slab: Wall = { width: 400, panels: [{ length: 473, angle: -11 }], seed: 1099590421 };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 173, v: 158, rot: 0, role: 'start' }];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 155, v: 439, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h1', type: 'jug', size: 's', u: 156, v: 188.8, rot: 0.03, seed: 3 },
      { id: 'h2', type: 'jug', size: 'l', u: 194.3, v: 201.5, rot: 0.05, seed: 6 },
      { id: 'h3', type: 'sloper', size: 'l', u: 135.7, v: 222, rot: -0.33, seed: 8 },
      { id: 'h4', type: 'jug', size: 'l', u: 196.6, v: 245.1, rot: 0.03, seed: 7 },
      { id: 'h5', type: 'crimp', size: 's', u: 130.3, v: 273.3, rot: 0.2, seed: 3 },
      { id: 'h6', type: 'edge', size: 'l', u: 199.5, v: 289.9, rot: -0.06, seed: 2 },
      { id: 'h7', type: 'edge', size: 'm', u: 125, v: 313.3, rot: 0.05, seed: 1 },
      { id: 'h8', type: 'sloper', size: 'l', u: 193.4, v: 337.7, rot: 0.34, seed: 10 },
      { id: 'h9', type: 'edge', size: 's', u: 139.9, v: 375.1, rot: -0.16, seed: 11 },
      { id: 'h10', type: 'crimp', size: 'l', u: 178, v: 400.2, rot: -0.33, seed: 11 },
      { id: 'f0', type: 'jib', size: 'm', u: 153.3, v: 55, rot: 0, seed: 6 },
      { id: 'f2', type: 'foot', size: 'm', u: 195, v: 115.8, rot: 0, seed: 9 },
      { id: 'f3', type: 'jib', size: 'm', u: 215.7, v: 229.1, rot: 0, seed: 5 },
    ];
    const r = solve(slab, jug, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to make 7 of its hand moves standing both feet on one jug (the start jug, then
    // each jug up the right) with the small jug and the jib beside them free. Now it splits
    // its feet, and matches them only where a reach is too hard off any other foothold.
    const matched = r.moves.filter((m) => m.limb <= 1 && m.from.limbs[2] >= 0 && m.from.limbs[2] === m.from.limbs[3]);
    expect(matched.length).toBeLessThanOrEqual(4);
  });

  it('stands on a free jug instead of smearing the wall beside it', () => {
    // Day 70's reference route (V0, a 105° corner leaning out 5°): pocket, edge and small jug
    // up the right face, foot chips under the start jugs.
    const corner: Wall = { width: 360, panels: [{ length: 439, angle: 5 }], seed: 1154681019, fold: { u: 156, angle: 105 } };
    const start: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 130, v: 145, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 175, v: 154, rot: 0, role: 'start' },
    ];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 240, v: 408, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h3', type: 'pocket', size: 'l', u: 132.4, v: 221, rot: 0.18 },
      { id: 'h5', type: 'edge', size: 'l', u: 161.7, v: 279.5, rot: 0.21 },
      { id: 'h7', type: 'jug', size: 's', u: 184.8, v: 333.3, rot: -0.11 },
      { id: 'f2', type: 'foot', size: 'm', u: 186.9, v: 101.3, rot: 0 },
      { id: 'f7', type: 'foot', size: 'm', u: 143.8, v: 93.1, rot: 0 },
    ];
    const r = solve(corner, start, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // With the hands matched on the edge, it used to smear its right foot 10 cm from the right
    // start jug, then reach to the small jug off the smear. Now it steps onto the jug.
    const smearBesideJug = r.moves.filter(
      (m) => m.limb <= 1 && m.to.limbs.slice(2).some((f, i) => f === SMEAR && start.some((j, k) => !m.to.limbs.includes(k) && Math.hypot(j.u - m.to.points[2 + i].u, j.v - m.to.points[2 + i].v) < 25)),
    );
    expect(smearBesideJug).toHaveLength(0);
    expect(r.moves.some((m) => m.limb >= 2 && m.to.limbs[m.limb] === 1)).toBe(true);
    expect(Math.round(r.grade)).toBe(1);
  });

  it('on an arête, stands on a foot chip or jug rather than edging the bare arête beside one', () => {
    // Day 55's reference route (V2), a 15° wall with a 70° arête at u 165: start jugs left of
    // it, a foot chip 23 cm from the arête's second contact. The climber stepped its left foot
    // 96 cm down off the big sloper onto the bare arête and edged it for the last six moves,
    // with the foot chip and the start jug free beside it: a trailing foot's hold cost nothing.
    const wall: Wall = { width: 380, panels: [{ length: 465, angle: 15 }], seed: 3219528770, fold: { u: 165, angle: -70 } };
    const start: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'l', u: 66, v: 158, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'l', u: 106, v: 158, rot: 0, role: 'start' },
    ];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 321, v: 259, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h3', type: 'sloper', size: 'l', u: 130.87, v: 196.03, rot: -0.254 },
      { id: 'h5', type: 'crimp', size: 'm', u: 186.05, v: 211.36, rot: -0.322 },
      { id: 'h7', type: 'jug', size: 'm', u: 213.6, v: 232.37, rot: 0.175 },
      { id: 'h9', type: 'edge', size: 's', u: 264.2, v: 241.86, rot: 0.153 },
      { id: 'f4', type: 'jib', size: 'm', u: 272.07, v: 148.22, rot: 0 },
      { id: 'f5', type: 'foot', size: 'm', u: 178.06, v: 119.46, rot: 0 },
    ];
    const r = solve(wall, start, finish, holds);
    if (!r.ok) throw new Error(r.message);
    const all = contactList(start, finish, holds, undefined, wall);
    // No foot steps onto the bare arête (the start stance may stand on it).
    expect(r.moves.some((m) => m.limb >= 2 && m.to.limbs[m.limb] >= 0 && all[m.to.limbs[m.limb]].id.startsWith('arete:'))).toBe(false);
    expect(Math.round(r.grade)).toBe(2);
  });

  it('keeps both feet on a slab instead of letting a smear dangle', () => {
    // Day 50's reference route (V1, an 11° slab): a jug start, edges and crimps up and left.
    const slab: Wall = { width: 360, panels: [{ length: 484, angle: -11 }], seed: 2113044559 };
    const start: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 270, v: 128, rot: 0, role: 'start' }];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 131, v: 445, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h1', type: 'edge', size: 'm', u: 237.5, v: 146.3, rot: -0.02 },
      { id: 'h2', type: 'edge', size: 'm', u: 277.2, v: 187.2, rot: 0.02 },
      { id: 'h4', type: 'jug', size: 'm', u: 236.8, v: 234.3, rot: -0.31 },
      { id: 'h5', type: 'crimp', size: 'm', u: 191.2, v: 261.8, rot: -0.27 },
      { id: 'h6', type: 'crimp', size: 'l', u: 216.5, v: 293.9, rot: -0.32 },
      { id: 'h7', type: 'sloper', size: 'l', u: 167.2, v: 315.4, rot: -0.18 },
      { id: 'h9', type: 'edge', size: 's', u: 149.4, v: 364.9, rot: -0.11 },
      { id: 'h10', type: 'edge', size: 'm', u: 180, v: 382.5, rot: 0.18 },
    ];
    const r = solve(slab, start, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to take its right foot off the smear and make two reaches with the leg hanging
    // off the slab, since a smear following the hands up costs the beta and a dangling foot
    // didn't. Now it steps that foot onto a hold low down (the start jug or the edge beside it).
    const dangling = r.moves.filter((m) => m.limb <= 1 && !m.dynamic && m.from.limbs.slice(2).includes(OFF));
    expect(dangling).toHaveLength(0);
    expect(r.moves.some((m) => m.limb >= 2 && (m.to.limbs[m.limb] === 0 || m.to.limbs[m.limb] === 2))).toBe(true);
    // V1.48 as curated; V1.54 since the beta goes a little past the crux to save a move (SLACK).
    expect(Math.round(r.grade)).toBe(1);
  });

  it('steps a foot straight up instead of taking it off the wall first', () => {
    // Day 102's reference route (V6, a 34° wall): an edge, a pinch and a crimp off two jugs.
    const steep: Wall = { width: 360, panels: [{ length: 469, angle: 34 }], seed: 86136283 };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 205, v: 160, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 255, v: 163, rot: 0, role: 'start' },
    ];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 285, v: 424, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h2', type: 'edge', size: 'l', u: 293.3, v: 257.6, rot: -0.19 },
      { id: 'h3', type: 'pinch', size: 'l', u: 221.2, v: 297.9, rot: -1 },
      { id: 'h4', type: 'crimp', size: 'm', u: 308.8, v: 337.7, rot: -0.18 },
      { id: 'f1', type: 'jib', size: 'm', u: 195.2, v: 98, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 179.4, v: 59.6, rot: 0 },
    ];
    const r = solve(steep, jugs, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to take its left foot off the start jug and put it straight back on the edge,
    // since a foot coming back from off the wall was lifted from the higher standing foot
    // while a direct step was lifted from its own lower hold. Now it steps straight up.
    const dance = r.moves.filter((m, i) => m.limb >= 2 && m.to.limbs[m.limb] === OFF && r.moves[i + 1]?.limb === m.limb && r.moves[i + 1].to.limbs[m.limb] >= 0);
    expect(dance).toHaveLength(0);
    expect(r.moves.some((m) => m.limb === 2 && m.from.limbs[2] === 0 && m.to.limbs[2] === 3)).toBe(true);
  });

  it('reaches straight to a jug in reach instead of slapping the bare arête on the way', () => {
    // Day 22's reference route (V1, a 10° wall beside an arête): a jug ladder up the edge.
    const arete: Wall = { width: 360, panels: [{ length: 483, angle: 10 }], seed: 630802827, fold: { u: 169, angle: -85 } };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 145, v: 145, rot: 0, role: 'start' }];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 136, v: 449, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h2', type: 'jug', size: 'l', u: 187.25, v: 211.2, rot: -0.257, seed: 0 },
      { id: 'h4', type: 'jug', size: 'm', u: 176.49, v: 288.45, rot: 0.048, seed: 11 },
      { id: 'h6', type: 'jug', size: 's', u: 188.33, v: 356.02, rot: -0.084, seed: 9 },
    ];
    const r = solve(arete, jug, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // Its left hand used to go from the first jug to the arête and on to the second jug: 0.85
    // and 0.83, against 0.86 straight there, since the search took any intermediate that eased
    // the crux at all. Now it reaches straight up, two moves shorter, and still grades about V1.
    // Up to the small jug: from it, the metre's reach to the finish is worth a tap on the arête
    // since a small jug opens up on an overhang (model.ts JUG_DEPTH, JUG_SHALLOW): its crux 0.81 against
    // 0.86 straight there before, past what SLAP sets aside.
    const ids = contactList(jug, finish, holds, undefined, arete).map((h) => h.id);
    const below = r.moves.slice(0, r.moves.findIndex((m) => m.limb <= 1 && ids[m.to.limbs[m.limb]] === 'h6'));
    const slaps = below.filter((m) => m.limb <= 1 && ids[m.to.limbs[m.limb]].startsWith('arete:'));
    expect(slaps).toHaveLength(0);
    expect(r.moves.some((m) => m.limb === 0 && ids[m.from.limbs[0]] === 'h2' && ids[m.to.limbs[0]] === 'h4')).toBe(true);
    // V1.5 then; V1.6 since its medium jug (seed 11) is the shallowest medium build (model.ts
    // JUG_DEPTH), harder to match on even at 10°; V1.85 since its start, its medium jug and its
    // finish are open-lipped jugs (a ledge and two slopey jugs, model.ts JUG_OPEN), a little
    // harder to hang off even at 10°. Still about V1-2.
    expect(r.grade).toBeGreaterThan(1);
    expect(r.grade).toBeLessThan(2);
  });

  it("keeps a hand on a hold bolted to a volume rather than palming the face it's on", () => {
    // A player's route on day 78's vertical corner: a small pyramid volume halfway up, a crimp
    // bolted onto its right face, pinches and edges round it.
    const corner: Wall = { width: 400, panels: [{ length: 437, angle: -2 }], seed: 1961286659, fold: { u: 230, angle: 60 } };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 244, v: 142, rot: 0, role: 'start' }];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 218, v: 398, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h1', type: 'pinch', size: 'm', u: 222.21, v: 177.24, rot: -0.689, seed: 6 },
      { id: 'h2', type: 'edge', size: 'l', u: 259.04, v: 225.89, rot: 0.007, seed: 5 },
      { id: 'h3', type: 'crimp', size: 'm', u: 209.37, v: 273.28, rot: -0.104, seed: 3 },
      { id: 'h4', type: 'edge', size: 's', u: 251.61, v: 321.68, rot: 0.302, seed: 5 },
      { id: 'h5', type: 'pinch', size: 'm', u: 218.37, v: 357.64, rot: -0.73, seed: 5 },
      { id: 'f0', type: 'jib', size: 'm', u: 219.66, v: 238.33, rot: 0, seed: 2 },
      { id: 'f1', type: 'foot', size: 'm', u: 248.79, v: 49.82, rot: 0, seed: 10 },
      { id: 'f2', type: 'foot', size: 'm', u: 240.23, v: 77.07, rot: 0, seed: 9 },
    ];
    const volumes: Volume[] = [{ id: 'v0', shape: 'pyramid', size: 's', u: 198.97, v: 263.77, rot: Math.PI / 4 }];
    // The face under the crimp is still there for a foot, not for a hand.
    const contacts = contactList(jug, finish, holds, volumes, corner);
    const face = contacts.find((h) => h.id === 'v0:f2')!;
    expect(handGrip(face, { u: face.u, v: face.v - 100 }, corner)).toBe(0);
    expect(footQuality(face)).toBeGreaterThan(0);
    const r = solve(corner, jug, finish, holds, { volumes });
    if (!r.ok) throw new Error(r.message);
    // It used to let go of the crimp to palm the fibreglass 2 cm from it, which shifted the
    // smear just enough to make the next reach easier.
    const palmed = r.moves.filter((m) => m.limb <= 1 && contacts[m.to.limbs[m.limb]].id === 'v0:f2');
    expect(palmed).toHaveLength(0);
  });

  it('puts a foot under the reach to the finish, not out to the side', () => {
    // A player's route on day 7's slab: jugs up the middle, the finish up and right of the
    // last jug, a foot chip out right and a pocket under the finish.
    const slab: Wall = { width: 360, panels: [{ length: 439, angle: -13 }], seed: 2674862226 };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 94, v: 120, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 150, v: 122, rot: 0, role: 'start' },
    ];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 227, v: 396, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h1', type: 'pinch', size: 's', u: 81.63, v: 156.74, rot: -0.998, seed: 6 },
      { id: 'h2', type: 'pocket', size: 'l', u: 196.59, v: 183.19, rot: 0.297, seed: 9 },
      { id: 'h3', type: 'jug', size: 'l', u: 123.02, v: 214.28, rot: 0.109, seed: 10 },
      { id: 'h4', type: 'pocket', size: 'm', u: 208.97, v: 257.67, rot: 0.131, seed: 10 },
      { id: 'h5', type: 'sloper', size: 's', u: 148.16, v: 295.85, rot: -0.059, seed: 6 },
      { id: 'h6', type: 'jug', size: 'l', u: 246.58, v: 327.12, rot: 0.253, seed: 9 },
      { id: 'h7', type: 'jug', size: 'm', u: 170.52, v: 367.06, rot: 0.105, seed: 10 },
      { id: 'f0', type: 'foot', size: 'm', u: 81.03, v: 64.38, rot: 0, seed: 6 },
      { id: 'f1', type: 'jib', size: 'm', u: 186.88, v: 169.27, rot: 0, seed: 4 },
      { id: 'f2', type: 'foot', size: 'm', u: 267.91, v: 238.02, rot: 0, seed: 8 },
      { id: 'f3', type: 'foot', size: 'm', u: 167.52, v: 73.91, rot: 0, seed: 9 },
      { id: 'f4', type: 'jib', size: 'm', u: 200.19, v: 155.3, rot: 0, seed: 2 },
      { id: 'f6', type: 'foot', size: 'm', u: 141.41, v: 93.15, rot: 0, seed: 7 },
    ];
    const r = solve(slab, jugs, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // It used to step the right foot out to the chip 40 cm right of the finish (the nearest
    // step up) and reach the left hand to the finish from there. Now the left foot goes onto
    // the pocket under it, diagonal to the right hand on the jug, and pushes up.
    const toFinish = r.moves.find((m) => m.limb <= 1 && m.to.limbs[m.limb] === 2)!;
    const target = toFinish.to.points[toFinish.limb];
    const push = Math.max(...[2, 3].filter((f) => toFinish.from.limbs[f] >= 0).map((f) => legPush(toFinish.from.points[f], target)));
    expect(push).toBeGreaterThan(0.5);
  });

  it('keeps a low foot on for a reach instead of cutting it to flag', () => {
    // Day 28's near-vertical wall, as curated: start jugs, a wedge volume under them, a
    // jug, a sloper and a jug up the right, then the finish back left.
    const face: Wall = { width: 380, panels: [{ length: 433, angle: 4 }], seed: 1 };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 221, v: 146, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 274, v: 152, rot: 0, role: 'start' },
    ];
    const holds: Hold[] = [
      { id: 'h2', type: 'jug', size: 'm', u: 280, v: 202, rot: -0.35 },
      { id: 'h4', type: 'sloper', size: 'm', u: 272, v: 251, rot: -0.22 },
      { id: 'h6', type: 'jug', size: 'm', u: 264, v: 308, rot: 0.27 },
    ];
    const volumes: Volume[] = [{ id: 'v0', shape: 'wedge', size: 's', u: 270, v: 93, rot: Math.PI / 4 }];
    const r = solve(face, jugs, { id: 'finish', type: 'jug', size: 'l', u: 236, v: 390, rot: 0, role: 'finish' }, holds, { volumes });
    if (!r.ok) throw new Error(r.message);
    // A second foot lower down used to make the reach count as longer, so the climber took
    // it off and flagged. Now it trails at worst: the reach to the finish goes from two
    // footholds, and no foot is cut loose on the way up.
    const toFinish = r.moves.find((m) => m.limb <= 1 && m.to.limbs[m.limb] === 2)!;
    expect(toFinish.from.limbs[2]).toBeGreaterThanOrEqual(0);
    expect(toFinish.from.limbs[3]).toBeGreaterThanOrEqual(0);
    expect(r.moves.some((m) => m.limb > 1 && m.to.limbs[m.limb] === OFF)).toBe(false);
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

  it('prices a move at the face under the lower hand, not at a ledge or lip the hands straddle', () => {
    // Day 29's reference route (V2, a vertical wall with a ledge band between v 198 and 229).
    const ledge: Wall = { width: 380, panels: [{ length: 198, angle: 7 }, { length: 31, angle: -75 }, { length: 188, angle: 5 }], seed: 3819285912, lip: true };
    const jugs: Hold[] = [
      { id: 'start-0', type: 'jug', size: 'm', u: 230, v: 157, rot: 0, role: 'start' },
      { id: 'start-1', type: 'jug', size: 'm', u: 270, v: 150, rot: 0, role: 'start' },
    ];
    const finish: Hold = { id: 'finish', type: 'jug', size: 'l', u: 160, v: 374, rot: 0, role: 'finish' };
    const holds: Hold[] = [
      { id: 'h3', type: 'sloper', size: 'l', u: 157.08, v: 259.85, rot: -0.25, seed: 5 },
      { id: 'h5', type: 'edge', size: 'l', u: 118.65, v: 329.92, rot: 0.136, seed: 0 },
      { id: 'f1', type: 'jib', size: 'm', u: 242.62, v: 61.37, rot: 0, seed: 8 },
    ];
    const r = solve(ledge, jugs, finish, holds);
    if (!r.ok) throw new Error(r.message);
    // Its hands' mean height used to set the angle: a jump from the start jug (v 150) to the
    // sloper above the ledge (v 260) has its mean on the shelf, so it was priced as a -75°
    // slab, next to free. Now each move hangs from the face under the lower hand.
    const onShelf = (v: number) => v >= 198 && v < 229;
    for (const m of r.moves) {
      const parts = moveParts(ledge, jugs, finish, holds, m)!;
      if (!onShelf(Math.min(m.to.points[0].v, m.to.points[1].v))) expect(parts.angle).toBeGreaterThan(0);
    }
    // The same on an overlap: a hand on a sloper just over the roof's lip leaves the body
    // hanging under the roof from the other hand (day 17, -11/52/-6).
    const overlap: Wall = { width: 360, panels: [{ length: 199, angle: -11 }, { length: 40, angle: 52 }, { length: 247, angle: -6 }], seed: 1, lip: true };
    const jug: Hold[] = [{ id: 'start-0', type: 'jug', size: 'l', u: 195, v: 153, rot: 0, role: 'start' }];
    const top: Hold = { id: 'finish', type: 'jug', size: 'l', u: 196, v: 444, rot: 0, role: 'finish' };
    const sloper: Hold[] = [{ id: 'h1', type: 'sloper', size: 's', u: 145, v: 252, rot: 0, seed: 0 }];
    const ids = contactList(jug, top, sloper, undefined, overlap).map((h) => h.id);
    const lip3 = ids.indexOf('lip:3');
    // Left hand on the sloper, the right hand comes off the start jug onto the lip.
    const move: Move = { limb: 1, from: { limbs: [2, 0, SMEAR, SMEAR], points: [] as never }, to: { limbs: [2, lip3, SMEAR, SMEAR], points: [] as never }, difficulty: 0, dynamic: false };
    expect(moveParts(overlap, jug, top, sloper, move)?.angle).toBe(52);
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

  it('palms a bare volume face that points at the body, on slabs and vertical but not steep ground', () => {
    const pyramid: Volume = { id: 'v', shape: 'pyramid', size: 'l', u: 140, v: 250, rot: 0 };
    // Its right face points at a body to its right: a hand there pushes, it doesn't pull.
    const right = volumeContacts([pyramid], wall(0)).find((h) => h.id === 'v:f2')!;
    expect(handTechnique(right, { u: 200, v: 200 })).toBe('palm');
    const top = volumeContacts([pyramid], wall(0)).find((h) => h.id === 'v:f0')!;
    expect(handTechnique(top, { u: 140, v: 180 })).not.toBe('palm');
    // A push needs weight over the feet: full on vertical, gone on a 35° overhang, and only
    // PALM_ALONE of it without the other hand pushing the body back onto it.
    expect(palmFactor(wall(0), right, true, 2)).toBe(1);
    expect(palmFactor(wall(0), right, false, 2)).toBe(PALM_ALONE);
    expect(palmFactor(wall(20), right, true, 2)).toBeLessThan(0.75);
    expect(palmFactor(wall(35), right, true, 2)).toBe(0);
    expect(palmFactor(wall(0), right, true, 0)).toBe(0);
    // The palm shoves the body right: a hold out left pulled toward it pushes back, one out right doesn't.
    const jug = (u: number): Hold => ({ id: 'j', type: 'jug', size: 'l', u, v: 260, rot: 0 });
    expect(palmOpposed(right, jug(110), { u: 200, v: 200 })).toBe(true);
    expect(palmOpposed(right, jug(260), { u: 200, v: 200 })).toBe(false);

    // On vertical the climber palms the face on the way to the finish; on a 30° overhang it
    // hangs off the volume's underside instead.
    const holds: Hold[] = [
      { id: 'c', type: 'crimp', size: 's', u: 245, v: 250, rot: 0, seed: 0 },
      { id: 'f0', type: 'foot', size: 'm', u: 185, v: 60, rot: 0 },
      { id: 'f1', type: 'foot', size: 'm', u: 215, v: 95, rot: 0 },
      { id: 'f2', type: 'foot', size: 'm', u: 195, v: 130, rot: 0 },
      { id: 'f3', type: 'foot', size: 'm', u: 225, v: 160, rot: 0 },
    ];
    const palms = (w: Wall) => {
      const r = solve(w, start, finishAt(360), holds, { volumes: [pyramid] });
      if (!r.ok) throw new Error(r.message);
      const face = start.length + 1 + holds.length + 2;
      return r.moves.some((m) => m.limb <= 1 && m.to.limbs[m.limb] === face);
    };
    expect(palms(wall(0))).toBe(true);
    expect(palms(wall(30))).toBe(false);
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
    const jug: Hold = { ...crimp, id: 'j', type: 'jug', incut: Math.max(...JUG_INCUT) };
    const straddling = { u: 200, v: 180 };
    expect(handGrip(crimp, straddling, arete)).toBeLessThan(handGrip(crimp, straddling, wall(0)));
    // Buckets don't open up, and once round onto the hold's face the body squares up.
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

  it('a foot let off the wall steps up from the standing foot, not for free', () => {
    const hands: Hold[] = [
      { id: 's1', type: 'jug', size: 'l', u: 180, v: 230, rot: 0, role: 'start' },
      { id: 's2', type: 'jug', size: 'l', u: 220, v: 230, rot: 0, role: 'start' },
    ];
    // The left foot steps up 60 cm onto `high`, from a chip level with the standing right
    // foot or from hanging off the wall: the same high step either way.
    const feet: Hold[] = [
      { id: 'low', type: 'foot', size: 'm', u: 180, v: 90, rot: 0, seed: 1 },
      { id: 'high', type: 'foot', size: 'm', u: 185, v: 150, rot: 0, seed: 1 },
      { id: 'stand', type: 'foot', size: 'm', u: 220, v: 90, rot: 0, seed: 1 },
    ];
    // Indices: start 0-1, finish 2, then low 3, high 4, stand 5.
    const step = (from: number) => {
      const move: Move = { limb: 2, from: { limbs: [0, 1, from, 5], points: [] as never }, to: { limbs: [0, 1, 4, 5], points: [] as never }, difficulty: 0, dynamic: false };
      return moveDifficulty(moveParts(wall(0), hands, finishAt(380), feet, move)!);
    };
    expect(step(OFF)).toBeCloseTo(step(3), 9);
  });

  it('only heel hooks a hold big enough to hook: a medium edge by the hands is stood on', () => {
    // Hands on a rail, one a rung higher; the right foot comes up level with the low hand,
    // out to the side, on a 30° wall: a heel on a big edge, a high step on a medium one.
    const hands: Hold[] = [
      { id: 's1', type: 'jug', size: 'l', u: 160, v: 200, rot: 0, role: 'start' },
      { id: 's2', type: 'jug', size: 'l', u: 240, v: 250, rot: 0, role: 'start' },
    ];
    // Indices: start 0-1, finish 2, then stand 3, rail 4.
    const parts = (size: 'm' | 'l') => {
      const holds: Hold[] = [
        { id: 'stand', type: 'foot', size: 'm', u: 195, v: 110, rot: 0, seed: 1 },
        { id: 'rail', type: 'edge', size, u: 240, v: 200, rot: 0, incut: typicalIncut('edge') },
      ];
      const move: Move = { limb: 3, from: { limbs: [0, 1, 3, OFF], points: [] as never }, to: { limbs: [0, 1, 3, 4], points: [] as never }, difficulty: 0, dynamic: false };
      const p = moveParts(wall(30), hands, finishAt(380), holds, move);
      if (p?.kind !== 'foot') throw new Error('no foot move');
      return p;
    };
    expect(parts('l').hookK).toBeGreaterThan(0);
    expect(parts('l').highK).toBe(0);
    expect(parts('m').hookK).toBe(0);
    expect(parts('m').highK).toBeGreaterThan(0);
  });

  it('hooks only on steep ground: on a slab or a vertical face a foot by the hands is a high step', () => {
    const hands: [Point, Point] = [
      { u: 180, v: 260 },
      { u: 220, v: 260 },
    ];
    const heelSpot = { u: 245, v: 240 };
    const toeSpot = { u: 290, v: 240 };
    for (const a of [-10, 0, 8]) {
      expect(footTechnique(wall(a), hands, heelSpot)).toBe(null);
      expect(footTechnique(wall(a), hands, toeSpot)).toBe(null);
    }
    expect(footTechnique(wall(15), hands, heelSpot)).toBe('heel');
    expect(footTechnique(wall(15), hands, toeSpot)).toBe(null);
    expect(footTechnique(wall(30), hands, toeSpot)).toBe('toe');
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
    // A long 40° crimp line, then the same line with one crimp swapped for a big jug.
    const steep: Wall = { width: 400, panels: [{ length: 560, angle: 40 }], seed: 1 };
    const line = (rest: boolean) => {
      const holds: Hold[] = [];
      for (let v = 195, i = 0; v < 498; v += 45, i++) {
        const jug = rest && i === 3;
        holds.push({ id: `h${i}`, type: jug ? 'jug' : 'crimp', size: jug ? 'l' : 'm', u: i % 2 ? 225 : 175, v, rot: 0, seed: 0 });
      }
      for (let v = 42, j = 0; v < 410; v += 35, j++) holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 215 : 185, v, rot: 0 });
      const r = solve(steep, start, finishAt(520), holds);
      if (!r.ok) throw new Error(r.message);
      return r;
    };
    const pumped = line(false);
    const rested = line(true);
    // Beyond what the jug does to the crux itself, the shake-out takes grade off. (The rested
    // line's lower crux makes more of its crimp moves count as hard, so the margin is small.)
    const fromCrux = toGrade(pumped.crux, 1) - toGrade(rested.crux, 1);
    expect(pumped.grade - rested.grade).toBeGreaterThan(fromCrux + 0.05);
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
    // Upside down is no better than on its side; with poor feet either way the climber stands on other holds.
    // Upside down is no better than on its side (they used to differ by 0.01 grades); with poor feet
    // either way the climber stands on other holds.
    expect(feet(Math.PI)).toBeGreaterThanOrEqual(feet(Math.PI / 2));
  });

  it('beta ends matched on the finish', () => {
    const r = solve(wall(0), start, finishAt(380), ladder('jug', 40));
    if (!r.ok) throw new Error();
    const last = r.moves[r.moves.length - 1].to.limbs;
    expect(last[0]).toBe(last[1]);
  });
});
