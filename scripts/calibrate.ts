// Grade calibration: reference problems with widely agreed grades, graded by the solver.
//   npx tsx scripts/calibrate.ts
// Anchors (commonly accepted gym/board grades; each ±1):
//   vertical jug ladder ≈ V0, vertical edges ≈ V1-2, vertical crimps ≈ V3,
//   20° jugs ≈ V1-2, 20° edges ≈ V4, 40° board jugs ≈ V3-4 (MoonBoard floor is V4),
//   40° edges ≈ V6, 40° crimps ≈ V8, slab crimps + smears ≈ V2-3,
//   vertical gaston edges ≈ V4-5, vertical sidepull edges ≈ V3,
//   vertical undercling edges ≈ V4.
import { solve } from '../src/solver/solve';
import type { Hold, HoldSize, HoldType, Wall } from '../src/solver/types';

export interface Anchor {
  name: string;
  angle: number;
  type: HoldType;
  size: HoldSize;
  spacing: number;
  feet: boolean;
  expect: number;
  /** Optional wall fold (corner > 0, arête < 0). */
  fold?: number;
  /** Hand holds straight up the middle instead of zig-zagging. */
  column?: boolean;
  feetU?: number;
  /** Turn the hand holds' edges to face out, away from the line (gastons). */
  gaston?: boolean;
  /** Turn the hand holds' edges to face in, toward the line (sidepulls). */
  sidepull?: boolean;
  /** Turn the hand holds upside down, lip facing the floor (underclings). */
  undercling?: boolean;
  /** Wall length (cm) up to the finish's line; default TOP. A highball for sustained problems. */
  top?: number;
  /**
   * A known miss: the solver can't hit this one yet without overfitting. Says what it
   * grades now and why, so a later run can work on it. Still counts toward the mean.
   */
  miss?: string;
}

export const ANCHORS: Anchor[] = [
  { name: 'vertical jug ladder', angle: 0, type: 'jug', size: 'm', spacing: 45, feet: true, expect: 0 },
  { name: 'vertical edges', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 2 },
  { name: 'vertical crimps', angle: 0, type: 'crimp', size: 'm', spacing: 50, feet: true, expect: 3 },
  { name: 'slab crimps, smears', angle: -15, type: 'crimp', size: 'm', spacing: 50, feet: false, expect: 3 },
  { name: 'slab jugs', angle: -15, type: 'jug', size: 'm', spacing: 50, feet: true, expect: 0 },
  { name: '20° jugs', angle: 20, type: 'jug', size: 'm', spacing: 50, feet: true, expect: 1 },
  { name: '20° edges', angle: 20, type: 'edge', size: 'm', spacing: 55, feet: true, expect: 4 },
  { name: '40° jugs', angle: 40, type: 'jug', size: 'm', spacing: 55, feet: true, expect: 4 },
  { name: '40° edges', angle: 40, type: 'edge', size: 'm', spacing: 60, feet: true, expect: 6 },
  { name: '40° crimps', angle: 40, type: 'crimp', size: 'm', spacing: 60, feet: true, expect: 8 },
  { name: '40° slopers', angle: 40, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 8 },
  { name: '30° pinches', angle: 30, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 5 },
  // Wall shapes: corners climb easier than faces (stemming); arêtes are technical.
  { name: 'vertical corner crimps', angle: 0, type: 'crimp', size: 'm', spacing: 50, feet: false, expect: 2, fold: 90 },
  // Judgement call: no footholds at all, smearing a steep corner — hard for the grade of its holds.
  { name: '20° corner edges', angle: 20, type: 'edge', size: 'm', spacing: 55, feet: false, expect: 4, fold: 90 },
  { name: 'vertical arête crimps', angle: 0, type: 'crimp', size: 'm', spacing: 50, feet: true, expect: 4, fold: -70 },
  // A committing jump between jugs.
  // Edges turned outward, so every hand is a thumb-down gaston: strenuous on any wall.
  { name: 'vertical gaston edges', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 5, gaston: true },
  // The same edges turned to face in: sidepulls you lean off. About a grade over the
  // plain edges, well under the gastons.
  { name: 'vertical sidepull edges', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 3, sidepull: true },
  // The same edges upside down: underclings. Feet up, stand into each one and reach
  // off it; strenuous like a sidepull, but you can't lean off it, so a grade over.
  { name: 'vertical undercling edges', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 4, undercling: true },
  { name: 'vertical jug dyno', angle: 0, type: 'jug', size: 'l', spacing: 125, feet: true, expect: 4, column: true },
  // Board benchmarks. Kilter Board Original consensus grades per angle, as listed on
  // boardsesh.com (checked 2026-10-04). Kilter problems use their own holds, so these
  // anchor how grades move with the angle and the style, not hold-for-hold.
  // Small crimps on vertical: "crimp+" (8,971 ascents) is V4 at 0-15°; "Pinch N Crimp"
  // (4,841) is V3 at 0°. A size down from the vertical crimps above.
  { name: 'vertical small crimps', angle: 0, type: 'crimp', size: 's', spacing: 50, feet: true, expect: 4 },
  // The jump on a gentle overhang: "DYNOmite" is V3 at 20° (V2 at 15°), "Stooopid Dyno" V3
  // at 10-20°, "dyno power" V4 at 15-25°. Up to 20° a dyno climbs about as on vertical.
  { name: '20° jug dyno', angle: 20, type: 'jug', size: 'l', spacing: 125, feet: true, expect: 4, column: true },
  // The same jump on a 40° board: DYNOmite V6, Stooopid Dyno V6, dyno power V5 at 40°,
  // 1-3 grades over their 20° grades.
  {
    name: '40° jug dyno',
    angle: 40,
    type: 'jug',
    size: 'l',
    spacing: 125,
    feet: true,
    expect: 6,
    column: true,
    // Grades V7.5 (2026-10-04). The dyno itself scores like a V6 (2.90); the crux (3.83) is
    // the match after it, forced into a second, two-footed dyno: with the low hand still on
    // the start every foothold in between is within crouch range of it, and cutting a foot
    // fails the free-foot hip check in solve.ts valid() (hips 73 cm up, it wants 75). With
    // that check 5 cm looser this grades V6.2, but the check guards dabs everywhere, so
    // changing it needs its own look at low starts on steep walls, not a calibration nudge.
    miss: 'match after the dyno is a second dyno: V7.5',
  },
  // Sustained: a long jug haul on a 40° highball. Kilter's "bakken rondje easy endurance"
  // (a jug circuit) is V3 at 40°, the same grade as the short "Jug Skin" (30,401 ascents,
  // V3 at 40°): on jugs, length pumps you but barely moves the grade. Graded with the
  // 40° jugs above.
  { name: '40° jug haul, highball', angle: 40, type: 'jug', size: 'm', spacing: 55, feet: true, expect: 4, top: 600 },
];

const TOP = 400;
/** Every reference problem's start and finish. */
export const ANCHOR_START: Hold[] = [
  { id: 's1', type: 'jug', size: 'l', u: 180, v: 150, rot: 0, role: 'start' },
  { id: 's2', type: 'jug', size: 'l', u: 220, v: 150, rot: 0, role: 'start' },
];
export const ANCHOR_FINISH: Hold = { id: 'f', type: 'jug', size: 'l', u: 200, v: TOP - 20, rot: 0, role: 'finish' };

/** A reference problem's finish: ANCHOR_FINISH, moved up on a taller wall. */
export function anchorFinish(a: Anchor): Hold {
  const top = a.top ?? TOP;
  return top === TOP ? ANCHOR_FINISH : { ...ANCHOR_FINISH, v: top - 20 };
}

export function anchorRoute(a: Anchor) {
  const top = a.top ?? TOP;
  const wall: Wall = {
    width: 400,
    panels: [{ length: top + 20, angle: a.angle }],
    seed: 1,
    ...(a.fold ? { fold: { u: 200, angle: a.fold } } : {}),
  };
  const holds: Hold[] = [];
  let i = 0;
  for (let v = 150 + a.spacing; v < top - 20 - a.spacing / 2; v += a.spacing, i++) {
    // Pinches are set as vertical fins; everything else incut-up.
    const u = a.column ? 200 : i % 2 ? 228 : 172;
    const rot = a.gaston ? (u < 200 ? -Math.PI / 2 : Math.PI / 2) : a.sidepull ? (u < 200 ? Math.PI / 2 : -Math.PI / 2) : a.undercling ? Math.PI : 0;
    holds.push({ id: `h${i}`, type: a.type, size: a.size, u, v, rot });
  }
  if (a.feet)
    for (let v = 55, j = 0; v < top - 120; v += 38, j++)
      holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 214 : 186, v, rot: 0 });
  return { wall, holds, finish: anchorFinish(a) };
}

export function gradeAnchor(a: Anchor) {
  const { wall, holds, finish } = anchorRoute(a);
  return solve(wall, ANCHOR_START, finish, holds);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let err = 0;
  for (const a of ANCHORS) {
    const r = gradeAnchor(a);
    const g = r.ok ? r.grade : NaN;
    const d = g - a.expect;
    err += Number.isFinite(d) ? Math.abs(d) : 5;
    console.log(`${a.name.padEnd(22)} expect V${a.expect}  got ${r.ok ? `V${g.toFixed(1)}` : r.reason}  ${Number.isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) : ''}${a.miss ? '  (known miss)' : ''}`);
  }
  console.log(`mean abs error: ${(err / ANCHORS.length).toFixed(2)} grades`);
}
