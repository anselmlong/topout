// Grade calibration: reference problems with widely agreed grades, graded by the solver.
//   npx tsx scripts/calibrate.ts
// Anchors (commonly accepted gym/board grades; each ±1):
//   vertical jug ladder ≈ V0, vertical edges ≈ V1-2, vertical crimps ≈ V3,
//   20° jugs ≈ V1-2, slab crimps + smears ≈ V2-3,
//   vertical gaston edges ≈ V4-5, vertical sidepull edges ≈ V3,
//   vertical undercling edges ≈ V4.
// The 40° board anchors and the 30° pinches were intuition grades (40° jugs V4, edges V6,
// crimps V8, slopers V8; 30° pinches V5) until 2026-10-09; they now take Kilter Board
// Original consensus grades (boardsesh.com), cited on each, which run 1-2 grades lower.
import { typicalIncut } from '../src/solver/model';
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
  /** Every hand hold's incut (0 flat .. 1 deep); default the type's typical build. */
  incut?: number;
  /** Wall length (cm) up to the finish's line; default TOP. A highball for sustained problems. */
  top?: number;
  /**
   * A ledge (cm up the wall) to mantle: a shelf LEDGE_DEPTH deep, the wall carrying on above it
   * at the same angle. The hand holds and footholds stop under it, so the climber gets
   * established on it (lip contacts, see volumes.ts) and stands up to reach the finish.
   */
  ledge?: number;
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
  // Was V4 by intuition. Kilter's flat "Heinous Crimps" is V4 at 15-20° (below), and edges
  // are a step bigger than crimps (vertical edges V2, vertical crimps V3): V3.
  { name: '20° edges', angle: 20, type: 'edge', size: 'm', spacing: 55, feet: true, expect: 3 },
  // Kilter's "Jug Skin" (30,401 ascents) is V3 at 40° (was V4, the MoonBoard's floor).
  { name: '40° jugs', angle: 40, type: 'jug', size: 'm', spacing: 55, feet: true, expect: 3 },
  // "Loose around the edges" (46 ascents) is V5 at 40° (was V6 by intuition).
  { name: '40° edges', angle: 40, type: 'edge', size: 'm', spacing: 60, feet: true, expect: 5 },
  // Between "Friendly Crimps" (V5 at 40°) and "Heinous Crimps" (1,682 ascents, V6 at 40°),
  // with the well-climbed one setting the grade (was V8 by intuition).
  { name: '40° crimps', angle: 40, type: 'crimp', size: 'm', spacing: 60, feet: true, expect: 6 },
  // "Super Sloper Slam Fest" (2,219 ascents) V6, "Sloper Season" V5, "slopers traing" V7
  // at 40° (was V8 by intuition).
  { name: '40° slopers', angle: 40, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 6 },
  // "Pinché Pinch!", "quad pinch" and "Pinch N Crimp" (4,841 ascents) are all V4 at 30°
  // (was V5 by intuition).
  { name: '30° pinches', angle: 30, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 4 },
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
  // The same problem on a 40° board: crimp+ is V6 at 40° (V8 at 60°), two grades over
  // its grade near vertical.
  { name: '40° small crimps', angle: 40, type: 'crimp', size: 's', spacing: 60, feet: true, expect: 6 },
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
    // Was a known miss at V7.5 (2026-10-04): after the dyno the match was forced into a
    // second, two-footed dyno, because the low foot made every reach longer and cutting it
    // failed the free-foot hip check. Since 2026-10-09 the low foot trails (solve.ts
    // handMove) and the match is a plain reach: V6.3.
  },
  // Sustained: a long jug haul on a 40° highball. Kilter's "bakken rondje easy endurance"
  // (a jug circuit) is V3 at 40°, the same grade as the short "Jug Skin" (30,401 ascents,
  // V3 at 40°): on jugs, length pumps you but barely moves the grade. V3, like the 40°
  // jugs above (was V4 to match their old MoonBoard-floor grade).
  { name: '40° jug haul, highball', angle: 40, type: 'jug', size: 'm', spacing: 55, feet: true, expect: 3, top: 600 },
  // Pinches and slopers off vertical, from the same Kilter Board Original per-angle grades
  // on boardsesh.com (checked 2026-10-04). Before these, pinches were anchored only at 30°
  // and slopers only at 40°, both by intuition.
  // Pinches on a gentle overhang: "Pinché Pinch!" (568 ascents) is V4 at 20°, "quad pinch"
  // V4 at 20°, "Pinch N Crimp" (4,841) V3 at 20°.
  { name: '20° pinches', angle: 20, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 4 },
  // Big slopers on a gentle overhang: "Super Sloper Slam Fest" (2,219 ascents) is V4 at 20°,
  // "Sloper Season" V3 at 20°.
  { name: '20° slopers', angle: 20, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 4 },
  // The same slopers at 30°: Super Sloper Slam Fest V5, "slopers traing" V4, Sloper Season
  // V3 at 30°. The most-climbed one sets the grade.
  {
    name: '30° slopers',
    angle: 30,
    type: 'sloper',
    size: 'l',
    spacing: 55,
    feet: true,
    expect: 5,
    // A known miss at V6.0 until 2026-10-09: the model added ~1.6 grades per 10°, Kilter ~1.
    // The arms' load now grows exponentially with the angle (model.ts STEEP_RAMP): V5.0.
  },
  // Pinches on a 40° board: Pinché Pinch! V5, "Easy pinch" (408 ascents) V4, Pinch N Crimp
  // V6 at 40°. One to three grades over their 20° grades.
  {
    name: '40° pinches',
    angle: 40,
    type: 'pinch',
    size: 'm',
    spacing: 55,
    feet: true,
    expect: 5,
    // A known miss at V6.6 until 2026-10-09, climbing too steeply from 20° to 40°. Fixed with
    // the 30° slopers by the exponential load (model.ts STEEP_RAMP): V5.2.
  },
  // Incut decides how hard a crimp is (holdGeometry/model incut). Kilter Board Original
  // per-angle consensus grades on boardsesh.com (checked 2026-10-09), two problems by the
  // same setter (tomgeorgevits): "Heinous Crimps" (1,682 ascents) and "Friendly Crimps"
  // (97). The names say which crimps they use; Kilter publishes no incut per hold.
  // Flat crimps on a near-vertical board: Heinous Crimps is V4 at 15°, the angle it was set
  // at (V3 at 0° and 10°, V4 at 5° and 20-30°).
  { name: '15° flat crimps', angle: 15, type: 'crimp', size: 'm', spacing: 50, feet: true, expect: 4, incut: 0.05 },
  // Deep incut crimps on a 40° board: Friendly Crimps is V5 at 40° and V6 at 45°, a grade
  // under Heinous Crimps (V6 at 40°, V7 at 45°). (V7 when the 40° crimps were V8.)
  { name: '40° deep incut crimps', angle: 40, type: 'crimp', size: 'm', spacing: 60, feet: true, expect: 5, incut: 0.9 },
  // Positive edges, the kind an intro problem is set on: Kilter's "Intro to Crimps" is V1
  // at 15° (V3 at 40°, V4 at 45-50°). Deep incut edges, a size up from crimps.
  { name: '15° deep incut edges', angle: 15, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 1, incut: 0.95 },
  // Mantles (mantleable, solve.ts pressing): up to a ledge, press it out, stand up on it and
  // reach the finish. No board has ledges, so these come from short outdoor mantle problems
  // graded on theCrag (checked 2026-10-09). Their mantles are top-outs onto a boulder's flat
  // top, 3-4 m up; here the ledge is 28 cm deep at 3.2 m and the finish 1.1 m above it, so
  // only standing up on the ledge reaches it.
  // Poor slopers straight up to a mantle: Toohey Forest's "Mantle Boulder" (Brisbane) goes
  // straight up on poor slopers and finishes with a mantle, V3 from standing and V4 from the
  // sit start. Reference problems all start sitting (ANCHOR_START).
  { name: 'vertical small slopers to a mantle', angle: 0, type: 'sloper', size: 's', spacing: 50, feet: true, expect: 4, ledge: 320, top: 480 },
  // Low-angle face to a mantle: The You Yangs (granite, mostly short low-angled faces) has
  // "Mental Mantle" (3 m) and "Awkward Mantle", both V3. Smeared like the slab crimps above.
  { name: 'slab crimps, smears to a mantle', angle: -15, type: 'crimp', size: 'm', spacing: 50, feet: false, expect: 3, ledge: 320, top: 480 },
  // Good holds to a mantle: Toohey Forest's "Mantle Any Way" (V1) is a sloper mantle with
  // pockets on the way, "Sonic the Sendhog" (V1) an undercling and a jug sidepull to an
  // angled mantle.
  {
    name: 'vertical jugs to a mantle',
    angle: 0,
    type: 'jug',
    size: 'm',
    spacing: 45,
    feet: true,
    expect: 1,
    ledge: 320,
    top: 480,
    miss: 'V2.6 (V3.6 before standing up off a mantle stopped counting as a lock-off, model.ts MANTLE_STAND). Pulling onto the shelf and the foot up beside the hands at MANTLE_LOAD floor every mantle near V2.5, however good the holds under it. Those V1s are top-outs onto a flat boulder top with no reach after, so not tuned on this alone.',
  },
];

const TOP = 400;
/** How deep a reference ledge's shelf is (cm): two palms and a shoe side by side. */
const LEDGE_DEPTH = 28;
/** Every reference problem's start and finish. */
export const ANCHOR_START: Hold[] = [
  { id: 's1', type: 'jug', size: 'l', u: 180, v: 150, rot: 0, role: 'start', incut: typicalIncut('jug') },
  { id: 's2', type: 'jug', size: 'l', u: 220, v: 150, rot: 0, role: 'start', incut: typicalIncut('jug') },
];
export const ANCHOR_FINISH: Hold = { id: 'f', type: 'jug', size: 'l', u: 200, v: TOP - 20, rot: 0, role: 'finish', incut: typicalIncut('jug') };

/** A reference problem's finish: ANCHOR_FINISH, moved up on a taller wall. */
export function anchorFinish(a: Anchor): Hold {
  const top = a.top ?? TOP;
  return top === TOP ? ANCHOR_FINISH : { ...ANCHOR_FINISH, v: top - 20 };
}

export function anchorRoute(a: Anchor) {
  const top = a.top ?? TOP;
  const wall: Wall = {
    width: 400,
    panels: a.ledge
      ? [
          { length: a.ledge, angle: a.angle },
          { length: LEDGE_DEPTH, angle: -75 },
          { length: top + 20 - a.ledge - LEDGE_DEPTH, angle: a.angle },
        ]
      : [{ length: top + 20, angle: a.angle }],
    seed: 1,
    ...(a.fold ? { fold: { u: 200, angle: a.fold } } : {}),
    ...(a.ledge ? { lip: true } : {}),
  };
  const holds: Hold[] = [];
  let i = 0;
  const handTop = a.ledge ? a.ledge - 25 : top - 20 - a.spacing / 2;
  for (let v = 150 + a.spacing; v < handTop; v += a.spacing, i++) {
    // Pinches are set as vertical fins; everything else incut-up.
    const u = a.column ? 200 : i % 2 ? 228 : 172;
    const rot = a.gaston ? (u < 200 ? -Math.PI / 2 : Math.PI / 2) : a.sidepull ? (u < 200 ? Math.PI / 2 : -Math.PI / 2) : a.undercling ? Math.PI : 0;
    // A typical build of the type throughout (neither a flat nor a deep incut one), unless
    // the problem is about incut.
    holds.push({ id: `h${i}`, type: a.type, size: a.size, u, v, rot, incut: a.incut ?? typicalIncut(a.type) });
  }
  if (a.feet)
    for (let v = 55, j = 0; v < (a.ledge ? a.ledge - 20 : top - 120); v += 38, j++)
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
