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
  /** Where the footholds run (cm across the wall); default up the middle (u 200). */
  feetU?: number;
  /** Turn the hand holds' edges to face out, away from the line (gastons). */
  gaston?: boolean;
  /** Turn the hand holds' edges to face in, toward the line (sidepulls). */
  sidepull?: boolean;
  /** Turn the hand holds upside down, lip facing the floor (underclings). */
  undercling?: boolean;
  /** Every hand hold's incut (0 flat .. 1 deep); default the type's typical build. */
  incut?: number;
  /** Every hand hold's finger count if it's a pocket (1 a mono .. 4 a slot); default from its seed. */
  fingers?: number;
  /** Every hand hold's span (cm between thumb and fingers) if it's a pinch; default from its seed. */
  span?: number;
  /** Every hand hold's shelf depth (mm) if it's a crimp, an edge or a jug (how far it stands off the wall); default from its seed. */
  depth?: number;
  /** Every hand hold's lip length (cm along the wall) if it's a crimp or an edge; default from its seed. */
  width?: number;
  /** Every hand hold's lip radius (mm, how rounded its front corner is) if it's a crimp or an edge; default from its seed. */
  radius?: number;
  /** Every hand hold's pitch (degrees its top slopes off level) if it's a sloper; default from its seed. */
  pitch?: number;
  /** Every foot chip's shelf depth (mm, how far it stands out from the wall); default the typical chip. */
  footDepth?: number;
  /** The footholds are jibs (little screw-on stones) instead of foot chips. */
  jibs?: boolean;
  /** Every foothold's incut (0 a rounded nub .. 1 a sharp positive shelf); default the type's typical build. */
  footIncut?: number;
  /** Wall length (cm) up to the finish's line; default TOP. A highball for sustained problems. */
  top?: number;
  /**
   * A ledge (cm up the wall) to mantle: a shelf LEDGE_DEPTH deep, the wall carrying on above it
   * at the same angle. The hand holds and footholds stop under it, so the climber gets
   * established on it (lip contacts, see volumes.ts) and stands up to reach the finish.
   */
  ledge?: number;
  /**
   * Hand holds set as rails: in pairs side by side, `rails` cm either side of the middle, every
   * `spacing` up. The footholds stop at the start (a board's kicker), so above it the feet go on
   * the rails: stood on, heel hooked or toe hooked.
   */
  rails?: number;
  /** The wall changes angle partway up: from `at` cm up the wall, it carries on at `angle`. */
  upper?: { at: number; angle: number };
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
  // Corners climbed without footholds on both faces: back-and-foot (model.ts backBridge) and
  // stemming on smears (stemBonus). No board has corners, so these come from outdoor problems
  // (grades found via search on 2026-10-10). A chimney has next to nothing for the hands, so
  // the hands get the poorest holds the model has, small slopers, up the crease (column).
  // A tight corner, footholds on one face only, nothing on the other: the back goes on it.
  // Glen Canyon's "The Chimney" (theCrag, V1, three stars) is a 6 m squeeze chimney; Elevenmile
  // Canyon's "Hugs Chimney" (Mountain Project, V1-2) chimneys up into a crack.
  { name: 'vertical chimney, back and foot', angle: 0, type: 'sloper', size: 's', spacing: 50, feet: true, expect: 1, fold: 90, column: true, feetU: 255 },
  // The same corner leaning out, then rolling over into a slab: Bradley Mountain's "Corner
  // Problem" (Mountain Project, V2, Connecticut) starts with both hands in a chimney on the
  // overhang, works up it to a corner and exits onto the slab face.
  {
    name: '10° chimney to a slab',
    angle: 10,
    type: 'sloper',
    size: 's',
    spacing: 50,
    feet: true,
    expect: 2,
    fold: 90,
    column: true,
    feetU: 255,
    upper: { at: 250, angle: -20 },
  },
  // A shallow open book on friction: Joshua Tree's "Stem Gem" (John Bachar; Mountain Project
  // and the Wolverine "Joshua Tree Bouldering" guide, V4) stems up a concave face of
  // featureless granite on smears and poor slopers.
  { name: 'vertical shallow corner, slopers, smears', angle: 0, type: 'sloper', size: 's', spacing: 50, feet: false, expect: 4, fold: 40 },
  // Macros (size xl: MACRO_GRIP, MACRO_STEEP). Tension Board 2 Spray and Mirror consensus
  // grades per angle on boardsesh.com (found via search on 2026-10-11; the site can't be
  // fetched from this run). The TB2 is set with big dual-texture holds (wood, and Mimic's
  // polyurethane), the board closest to these macros. Its grades run soft at the bottom (its
  // jug warm-ups, "lane 4" with 1,962 ascents and "Jug Start", are V0 at 40°, where Kilter's
  // Jug Skin is V3), so these are read against each other more than against the Kilter rows.
  // Macro slopers on a gentle overhang: "Heel Slopers" (SamYau, 112 ascents) is V3 at 25° and
  // 30°, V2 at 15°.
  { name: '25° macro slopers', angle: 25, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 3 },
  // The same at 40°: Heel Slopers V4 (V4 at 45° too), "Sloper's First Day of School" V4, and on
  // the Mirror layout "Introduction to Slurping the Slopers" V4; "Jennifer Slopez" V3. Only a
  // grade over 25°, where Kilter's smaller slopers climb two.
  { name: '40° macro slopers', angle: 40, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 4 },
  // Pinch blocks at 40°: TB2 Mirror "Pinchachu" (90 ascents) V4, "In a pinch?" (44) V3. The
  // same grade as the TB2's slopers there: on the board, a big sloper is no worse than a pinch.
  { name: '40° macro pinches', angle: 40, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 4 },
  // Heel and toe hooks (solve.ts hookOk, model.ts footTechnique): board problems named for them,
  // set on rails (rails), the footholds stopping at the kicker, so the feet go on the hand holds:
  // stood on, heeled, toed or drop-kneed. Consensus grades per angle on boardsesh.com (found via
  // search on 2026-10-11; the site can't be fetched from this run).
  // Kilter Homewall "heel toe" (mbae, 212 sends at 40°) is V3 at 20°, 25° and 30°. Homewall holds
  // run smaller than the Original's (more crimps, pinches and flakes): medium edges.
  { name: '25° edge rails, heel hooks', angle: 25, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 3, rails: 40 },
  // The same problem is V4 at 40°, as are Kilter Homewall "Off the Hook" (271 sends) and Kilter
  // Original "$4 hookr" at 40°.
  { name: '40° edge rails, heel hooks', angle: 40, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 4, rails: 40 },
  // Tension Board 2 Mirror "Heel-Toe''" (wood and plastic set) is V2 at 25° and 30°, V1 at 20°.
  // The TB2's holds are bigger and its grades run soft (see the macros above): big edges.
  { name: '25° big edge rails, heel hooks', angle: 25, type: 'edge', size: 'l', spacing: 50, feet: true, expect: 2, rails: 40 },
  // Crimps between vertical and the 40° board: Kilter Board Original consensus grades per angle on
  // boardsesh.com (found via search on 2026-10-12; the site can't be fetched from this run).
  // Medium crimps, the Original's typical build ("Heinous Crimps", above, is the flat one).
  // "crimpy chimpy" (341 sends at 25°, the angle it was set at) is V5 at 25°.
  { name: '25° crimps', angle: 25, type: 'crimp', size: 'm', spacing: 55, feet: true, expect: 5 },
  // The same problem is V4 at 30°, as is "Crimping basics" (160 sends; V3 at 20°, V4 at 40°).
  { name: '30° crimps', angle: 30, type: 'crimp', size: 'm', spacing: 55, feet: true, expect: 4 },
  // Buckets hold at any angle (model.ts JUG_STEEP: only jugs flatter than typical roll off steep
  // ground). Kilter Board Original consensus grades per angle on boardsesh.com (found via search
  // on 2026-10-12; the site can't be fetched from this run). "juggling jugs" (timboslice9000,
  // 5,213 sends at 40°), a warm-up on the board's big jugs: large deep buckets. Its angle curve
  // is nearly flat, the shape the bucket claim predicts.
  // V0 at 20° and at 30°.
  { name: '20° large buckets', angle: 20, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 0, incut: 0.95 },
  { name: '30° large buckets', angle: 30, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 0, incut: 0.95 },
  // V1 at 35° and 40° (V3 only at 60-70°); "jug jug jug" (3,748 sends) is V0 at 40°. Two grades
  // under "Jug Skin" (the 40° jugs above, typical Kilter jugs, which the retailers say get
  // slopier as the board steepens).
  { name: '40° large buckets', angle: 40, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 1, incut: 0.95 },
  // Pockets by finger count (model.ts fingersOf, FINGER_GRIP): until now no reference problem
  // used pockets at all. Kilter consensus grades per angle on boardsesh.com (found via search on
  // 2026-10-12; the site can't be fetched from this run).
  // Two-finger pockets: Kilter Board Original "Pocket simulator" (Govert, 21 ascents at 30°) is
  // climbed with only the middle and ring fingers on each hand, so every hold is a two-finger
  // pocket on the Original's medium-sized holds. V5 at 30° and at 40°. (It is also listed V2 at
  // 20°, three grades under 30°, which no other board problem here does in 10°; left out.)
  { name: '30° two-finger pockets', angle: 30, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 5, fingers: 2 },
  { name: '40° two-finger pockets', angle: 40, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 5, fingers: 2 },
  // Open pockets: Kilter Homewall "Pockets" (steven97) is V3 at 30°, V4 at 40° and V5 at 45°, a
  // grade and more under the two-finger problem above, so it climbs on bigger pockets the whole
  // hand nearly fits: large three-finger pockets.
  { name: '30° large pockets', angle: 30, type: 'pocket', size: 'l', spacing: 55, feet: true, expect: 3, fingers: 3 },
  { name: '40° large pockets', angle: 40, type: 'pocket', size: 'l', spacing: 55, feet: true, expect: 4, fingers: 3 },
  // Pockets by depth (model.ts EDGE_DEPTH pocket, depthGrip): until now no reference problem set
  // how deep a pocket goes. Atomik Climbing Holds' Golfus pocket line steps it, sets #5 to #1
  // (grade guides found via search on 2026-10-15; the site can't be fetched from this run).
  // Atomik measures in finger pads: set #1's "two to three finger pads" is 1-3/4" to 2", and its
  // flip side's "full finger pad" 3/4" to 1", so a pad is about 19 mm.
  // Set #5: shallow two-finger pockets, three-quarters of a pad deep (14 mm), neutral incut, the
  // smallest 3-1/2" x 3-3/4": V3 on vertical, V5 on a 20° wall ("110 yields V5"). (Its V7 at 30°
  // and V9 at 45° are left out: the Kilter two-finger board problem above is V5 at 30° and 40°.)
  { name: 'vertical shallow two-finger pockets', angle: 0, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 3, fingers: 2, depth: 14, incut: 0.35 },
  { name: '20° shallow two-finger pockets', angle: 20, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 5, fingers: 2, depth: 14, incut: 0.35 },
  // Set #4: three-finger pockets one pad deep (19 mm), 4-1/2" x 4-3/4": "easy V2" on vertical.
  { name: 'vertical one-pad pockets', angle: 0, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 2, fingers: 3, depth: 19 },
  // Set #2: "comfortable one and a half finger-pad deep pockets" (28 mm): V1 on vertical.
  { name: 'vertical pad-and-a-half pockets', angle: 0, type: 'pocket', size: 'm', spacing: 55, feet: true, expect: 1, fingers: 3, depth: 28 },
  // Set #1: "roomy two and three-finger pockets", 1-3/4" to 2" deep (45 mm), incut about 45°: V0
  // on vertical.
  {
    name: 'vertical roomy pockets', angle: 0, type: 'pocket', size: 'l', spacing: 55, feet: true, expect: 0, fingers: 3, depth: 45, incut: 0.85,
    miss: 'grades V1.4: past 3-4 cm depthGrip is flat (an edge study), and a pocket is as direction-fussy as an edge (tolerance 0.4), where a pocket the fingers sink into to the second joint is held like a jug from any side',
  },
  // Pinches by span (model.ts pinchSpan, spanGrip): until now no reference problem set a pinch's
  // width, so the thin fins and wide pinches every pinch now comes as were graded off their seeds.
  // No board benchmark gives a pinch's width, so these take Atomik Climbing Holds' per-angle grade
  // guides, which give each set's width (found via search on 2026-10-13; the site can't be fetched
  // from this run). Their vertical grades run a grade or two soft against the vertical rows here
  // (their small crimps are "V2 on vertical", where vertical small crimps are V4 above), so only
  // their overhanging grades are used.
  // Thin: "5 Small Simple Pinches", 2" wide (5 cm) and 1-1/4" off the wall, V4 on a 25° wall
  // (V3/4 on another listing of the same set; V7 at 45°).
  { name: '25° thin pinches', angle: 25, type: 'pinch', size: 's', spacing: 55, feet: true, expect: 4, span: 5 },
  // Wide: "5 Pack Squished Pinches" Set #1 (2-1/2" to 3" wide) is V2 on a 25° wall and Set #3
  // (2-1/2" to 3-3/4") V4: the same width, so V3 between them, at 7 cm.
  { name: '25° wide pinches', angle: 25, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 3, span: 7 },
  // "5 Large Basic Pinches Set #3", the wider set of the basic pinches (no width given; set past a
  // hand's width, 7.5 cm): V2 on vertical, V4 on a 20° wall, V7 at 45°.
  { name: '20° large wide pinches', angle: 20, type: 'pinch', size: 'l', spacing: 55, feet: true, expect: 4, span: 7.5 },
  // Crimps by shelf depth (model.ts EDGE_DEPTH, depthGrip): until now no reference problem set a
  // crimp's depth, so the fingertip strips and full-pad crimps every crimp now comes as were graded
  // off their seeds. Atomik Climbing Holds' grade guides give each set's size off the wall (found
  // via search on 2026-10-13; the site can't be fetched from this run). As with the pinches above,
  // only their overhanging grades are used.
  // Fingertip strips: "10 Small Simple Crimps Set #1", sold by depth as 10 mm to 14 mm, V4+ on a
  // 20° wall (V2 on vertical, V7+ at 45°).
  { name: '20° shallow small crimps', angle: 20, type: 'crimp', size: 's', spacing: 50, feet: true, expect: 4, depth: 12, width: 9., radius: 1.5 },
  // "5 Small Granite Crimps Set #3", the low-profile set, 1/2" to 3/4" off the wall (13-19 mm):
  // V4 on a 25° wall (V2+ on vertical, V6/10 at 45°).
  { name: '25° low small crimps', angle: 25, type: 'crimp', size: 's', spacing: 55, feet: true, expect: 4, depth: 16 },
  // Full-pad crimps: "5 Medium Steep Wall Oval Crimps Set #2", 7/8" to 1" off the wall (22-25 mm),
  // incut for steep walls: V2+ on a 20° wall (V1+ on vertical). Two grades under the 10-14 mm
  // strips at the same angle.
  { name: '20° deep incut crimps', angle: 20, type: 'crimp', size: 'm', spacing: 50, feet: true, expect: 2, depth: 23, incut: 0.8, width: 11.7 },
  // Crimps by lip length (model.ts EDGE_WIDTH, widthGrip; a47af35): until now no row set how long a
  // crimp's lip runs, so every crimp row graded off its seed's length, which can come out a two- or
  // three-finger build. Atomik Climbing Holds' grade guides give each set's width (found via search
  // on 2026-10-15; the site can't be fetched from this run), so the Atomik crimp rows above now pin
  // it too: "10 Small Simple Crimps Set #1" 3" to 4-1/2" (9.5 cm), "5 Medium Steep Wall Oval Crimps
  // Set #2" 4-5/8" at the largest (11.7 cm). No graded set is sold short enough for two fingers (the
  // Yaniro Slot Crimps are, but carry no grade), so these pin the three-and-a-half to four finger end.
  // "10 Straight Crimps", 3" wide (7.6 cm, the little finger half on) and 1/2" off the wall, "a bit
  // in-cut", "positive" with a distinct edge: V3 on a 20° wall (V1 on vertical).
  { name: '20° straight crimps', angle: 20, type: 'crimp', size: 's', spacing: 50, feet: true, expect: 3, depth: 13, width: 7.6, incut: 0.6, radius: 1.5 },
  // "10 Dripstone Flat Crimps #2", 3-3/8" wide (8.6 cm) with about 3/4" of flat to slightly incut
  // edge: V4 on a 20° wall in the page's grade list (its text says V3), with Atomik's other 3/4"
  // small crimps (Simple Set #1, Granite Set #3, V4 at 20° and 25°).
  { name: '20° flat dripstone crimps', angle: 20, type: 'crimp', size: 's', spacing: 50, feet: true, expect: 4, depth: 19, width: 8.6, incut: 0.2 },
  // "5 Small Granite Crimps Set #2", 3" to 3-5/8" wide (8.4 cm) and 1/2" to 7/8" off the wall,
  // neutral to 45° incut: V4/5 on a 25° wall (V2+ on vertical, V6/9 at 45°). V4, the lower grade,
  // as with the split ledges.
  { name: '25° small granite crimps', angle: 25, type: 'crimp', size: 's', spacing: 55, feet: true, expect: 4, depth: 17, width: 8.4 },
  // Slopers by pitch (model.ts SLOPER_PITCH, pitchGrip, pitchSteep): until now no reference problem
  // set a sloper's pitch, so the flat-topped and steep builds every sloper now comes as were graded
  // off their seeds. Atomik Climbing Holds' grade guides (found via search on 2026-10-13; the site
  // can't be fetched from this run). Large slopers at the ends of the large range: 24 degrees
  // (flat-topped) and 48 (steep).
  // Flat-topped: "5 Large Steep Wall Slopers", shaped for steep walls so their tops stay level on
  // an overhang, are V1 on vertical (as are "5 Large Basic Steep Wall Slopers Set #1"; V2 at 20°).
  { name: 'vertical flat-topped slopers', angle: 0, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 1, pitch: 24 },
  // The same build at 25°: "5 Large Steep Wall Slopers" are V2/3 on a 25° wall, and the "XL
  // Adjustable Sloper", whose top can be set anywhere from 0 to 25 degrees of incut, is V1-4 on a
  // 25° wall set its easiest way. V3.
  { name: '25° flat-topped slopers', angle: 25, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 3, pitch: 24 },
  // The adjustable sloper set its hardest way, its top at 0 degrees of incut, so it slopes off as
  // steeply as it can: V3-V7+ on a 25° wall. V5, two grades over its easiest setting.
  { name: '25° steep slopers', angle: 25, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 5, pitch: 48 },
  // Macro slopers by pitch (model.ts SLOPER_PITCH xl, 20-50 degrees): until now the macro rows (the
  // Tension Board 2 ones above) graded off their seeds, so the flat-topped dishes and steep domes
  // every macro now comes as (7389299) were unpinned. Atomik Climbing Holds' grade guides (found via
  // search on 2026-10-14; the site can't be fetched from this run). Their XXL limestone line is cast
  // at nearly one size (about 8" x 5-1/2", 2-3/4" to 3-1/2" off the wall) and runs from a sloper jug
  // to a blank dome, so it's the shape, not the size, that grades it: these take the ends of the
  // macro range, 20 degrees (flat-topped) and 50 (steep).
  // Flat-topped: "XXL Golfus Sloper (Steep Wall Model #1)", 14" x 10" and 5" off the wall, shaped to
  // stay level on steep walls, is V1 on vertical (V6 at 45°, where the reference start can't be
  // held on macro slopers here, so left out).
  { name: 'vertical flat-topped macro slopers', angle: 0, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 1, pitch: 20 },
  // "XXL Limestone Sloper #1", the line's easiest, a sloper jug: V2 on a 25° wall (V0 on vertical,
  // V4 at 45°).
  { name: '25° flat-topped macro slopers', angle: 25, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 2, pitch: 20 },
  // Steep: "XXL Limestone Sloper #6", the line's second-hardest: V3 on vertical, V6 on a 25° wall
  // (V7-8 at 45°).
  { name: 'vertical steep macro slopers', angle: 0, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 3, pitch: 50 },
  { name: '25° steep macro slopers', angle: 25, type: 'sloper', size: 'xl', spacing: 55, feet: true, expect: 6, pitch: 50 },
  // Pinch blocks by span (model.ts PINCH_SPAN xl, 9-15 cm): until now the one macro pinch row (40°,
  // TB2 above) graded off its seeds, so the narrow and wide blocks every pinch block now comes as
  // (f278172) were unpinned, and no row set a pinch block on a gentle overhang.
  // TB2 Mirror "Pinchachu" (90 ascents at 40°) on boardsesh.com (found via search on 2026-10-14; the
  // site can't be fetched from this run) is V2 at 20°, V3 at 25° (V4 at 40°, the row above).
  { name: '20° macro pinches', angle: 20, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 2 },
  // Wide: Atomik Climbing Holds' "XXL Granite Pinch", 5-1/2" wide at the bottom (14 cm) and 4" off
  // the wall, is V2/3 on a 25° wall (V4+ at 45°, where the reference start can't be held on
  // macros here). V3 with Pinchachu at 25°: the TB2's blocks run about as wide. The block's 4" off
  // the wall (102 mm) is its depth (model.ts PINCH_DEPTH xl, since pinch blocks come low or deep).
  { name: '25° wide pinch blocks', angle: 25, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 3, span: 14, depth: 102 },
  // Narrow: Atomik's "5 XL Wide Font Pinches Set #3 (Positive)", 3-1/2" to 4" wide (9.5 cm) with
  // "a hint of an incut", is V2 on vertical (V7 at 45°). Atomik gives no overhang grade for a
  // block this narrow, so this takes its vertical one, which may run soft (see the pinches above).
  { name: 'vertical narrow pinch blocks', angle: 0, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 2, span: 9.5 },
  // Pinch blocks by depth (model.ts PINCH_DEPTH xl, 30-84 mm, clamped at 110; b65533c): until now
  // only the 25° Granite Pinch row above set how far a block stands off the wall, so the low and
  // deep blocks were graded off their seeds on vertical and gentle overhangs. Atomik Climbing Holds'
  // grade guides, which give each block's size off the wall (found via search on 2026-10-18; the
  // site can't be fetched from this run).
  // The same "XXL Granite Pinch" (14 cm, 4" off) on vertical: V1.
  { name: 'vertical deep granite pinch blocks', angle: 0, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 1, span: 14, depth: 102 },
  // "XXL Font Pinch", 24-1/2" long x 3-1/2" wide (8.9 cm) and 3-3/8" off the wall (86 mm): a V2
  // pinch on vertical, V3 on a 20° wall (V6 at 45°). Both grade soft (V1.2, V1.9) where the wider
  // Granite Pinch grades hard on vertical; see the commit (2026-10-18).
  { name: 'vertical font pinch blocks', angle: 0, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 2, span: 8.9, depth: 86 },
  { name: '20° font pinch blocks', angle: 20, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 3, span: 8.9, depth: 86 },
  // "XXXL Slopey Wide Golfus Pinch", 4" wide on average (10.2 cm) and 6" off the wall (past the
  // 110 mm clamp), its flanks sloping away: V3 on vertical (V9 at 45°). The flattest pinch incut.
  { name: 'vertical slopey golfus pinch blocks', angle: 0, type: 'pinch', size: 'xl', spacing: 55, feet: true, expect: 3, span: 10.2, depth: 110, incut: 0 },
  // Macro ledges (model.ts EDGE_DEPTH edge xl, 24-60 mm; MACRO_GRIP edge): until now no row set a
  // macro ledge, so the rail ledges and deep shelves every ledge now comes as (f0ce530) were
  // unpinned. Atomik Climbing Holds' grade guides (found via search on 2026-10-14; the site can't
  // be fetched from this run). Their ledges are cast "neutral to barely slopey", so the rows take
  // the flat end of an edge's incut; Atomik gives no ledge depth, only how far the holds stand off.
  // "3 XXL Split Ledges (Series 2.0)", 12" x 8" to 17" x 8" and 3-1/4" to 4" off the wall, are V1
  // on vertical (V8+ at 45°, where the reference start can't be held on macros here): a shelf on a
  // hold that stands 4" off takes the deepest ledge.
  { name: 'vertical neutral macro ledges', angle: 0, type: 'edge', size: 'xl', spacing: 55, feet: true, expect: 1, depth: 60, incut: 0.15 },
  // "XXL Split Ledge #3 (Series 2.0)", the same build with ledges 2° incut and 7° and 3° slopey, is
  // V2/3 on vertical, against the V1 of #2 (9° slopey, 3° and 7° incut). Slopier than any edge the
  // game makes (incut 0, under the edge range's 0.15): V2, the lower grade, since only one of its
  // three ledges slopes off more than #2's worst.
  { name: 'vertical slopey macro ledges', angle: 0, type: 'edge', size: 'xl', spacing: 55, feet: true, expect: 2, depth: 60, incut: 0 },
  // "XXXL Granite Rail #2 (Neutral Incut)": on a 25° wall "no easier than a V3 feeling hold"; Rail #1
  // (neutral incut with crimps, 31-1/2" x 6-1/2" and 3-1/2" off the wall) is V3/4 at its easiest
  // there. A rail standing 3-1/2" off: a mid-depth ledge. Grades V2.3, soft; see the commit (the
  // 45° grades suggest macro ledges harden faster on an overhang than the model has them).
  { name: '25° neutral macro rails', angle: 25, type: 'edge', size: 'xl', spacing: 55, feet: true, expect: 3, depth: 46, incut: 0.15 },
  // Foot chips by depth (model.ts FOOT_DEPTH, footDepthFactor): until now every row stood on the
  // typical chip, so the tiny and big chips foot chips now come as (b073b98) were unpinned. Atomik
  // Climbing Holds grades footholds by the problems they're set for (found via search on 2026-10-15;
  // the site can't be fetched from this run), so each row pairs the feet with hand holds of the
  // same grade on the same wall, and pins how far the chips stand off the wall as their depth.
  // "5 Protons Steep Wall Feet", 2-1/2" x 2-3/4" and 1-1/2" off the wall (38 mm), are "V2 as
  // footholds on vertical": a fat foot block under the vertical edges.
  { name: 'vertical edges, big foot blocks', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 2, footDepth: 38 },
  // "10 Super Small Scaled Tech Feet", 3/4" off the wall (19 mm), sharp-edged: "V4 footholds on
  // vertical", under the vertical small crimps (Kilter crimp+, V4 at 0-15°, above).
  { name: 'vertical small crimps, tech feet', angle: 0, type: 'crimp', size: 's', spacing: 50, feet: true, expect: 4, footDepth: 19 },
  // "20 Super Small Low Angle Feet", granite, 3/4" to 1" off the wall (22 mm): on a vertical wall
  // they "challenge a beginner". V0, under the vertical jug ladder.
  { name: 'vertical jugs, small foot chips', angle: 0, type: 'jug', size: 'm', spacing: 45, feet: true, expect: 0, footDepth: 22 },
  // Jibs by height (model.ts JIB_DEPTH): until now every row stood on foot chips, so the low and
  // tall jibs jibs now come as (ebb08ad) were unpinned. Atomik Climbing Holds' grade guides (found
  // via search on 2026-10-16; the site can't be fetched from this run), paired as the chip rows
  // above with hand holds of the same grade on the same wall. Both sets are small faceted stones
  // with no backplate, a jib rather than a chip, and both are "positive" to toe onto (incut 0.7).
  // "5 Small Hedron Steep Wall Feet", 1" off the wall (25 mm, a tall jib), "reasonably positive on
  // most angles": "V2/3 as a foothold on vertical walls", under the vertical edges and crimps.
  { name: 'vertical edges, hedron jibs', angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 2, jibs: true, footDepth: 25, footIncut: 0.7 },
  { name: 'vertical crimps, hedron jibs', angle: 0, type: 'crimp', size: 'm', spacing: 50, feet: true, expect: 3, jibs: true, footDepth: 25, footIncut: 0.7 },
  // "30 Super Small Steep Wall Feet (Facets)", 1-1/2" square and 1" to 1-1/2" off the wall (32 mm),
  // "a positive surface to toe onto": "the V1 range on vertical walls" (90 Pack Steep Wall), under
  // the vertical neutral macro ledges (V1). Its "V3 to V5" on 45° is left out: the wall stops at
  // 40°, and the Kilter 40° jugs it would pair with already grade soft on foot chips.
  { name: 'vertical macro ledges, facet jibs', angle: 0, type: 'edge', size: 'xl', spacing: 55, feet: true, expect: 1, depth: 60, incut: 0.15, jibs: true, footDepth: 32, footIncut: 0.7 },
  // Pinches by flank depth and incut (model.ts PINCH_DEPTH, pinchDepthFactor; INCUT_RANGE pinch):
  // until now no row set a pinch's depth or incut, so the low and deep pinches pinches now come
  // as (d80776d) were graded off their seeds. Atomik Climbing Holds' grade guides, which give how
  // far each set stands off the wall (found via search on 2026-10-16; the site can't be fetched
  // from this run). As for the span rows, their overhanging grades, plus one vertical set.
  // "5 Pack Variety Pinches Set #1", 2" to 3-1/4" off the wall (67 mm between: deep flanks, the
  // whole thumb on), 1-1/2" to 3-1/8" wide (6.3 cm): V2 on a 25° wall.
  { name: '25° deep variety pinches', angle: 25, type: 'pinch', size: 'l', spacing: 55, feet: true, expect: 2, span: 6.3, depth: 67 },
  // "5 Pack Loaf Pinches", 1-5/8" to 1-3/4" off the wall (43 mm): Set #1, "the most positive"
  // (incut 0.8), 2-1/4" to 3-1/2" wide (7.3 cm), V2 on a 25° wall; Set #3, "the least positive"
  // (incut 0.2), 2-5/8" to 3-7/8" wide (8.3 cm), V4 there.
  { name: '25° positive loaf pinches', angle: 25, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 2, span: 7.3, depth: 43, incut: 0.8 },
  { name: '25° flat loaf pinches', angle: 25, type: 'pinch', size: 'm', spacing: 55, feet: true, expect: 4, span: 8.3, depth: 43, incut: 0.2 },
  // "5 Small Divot Pinches", 3" wide (7.6 cm) and 1-1/4" off the wall (32 mm): V3 on vertical.
  { name: 'vertical divot pinches', angle: 0, type: 'pinch', size: 's', spacing: 55, feet: true, expect: 3, span: 7.6, depth: 32 },
  // Slopers by width (model.ts SLOPER_WIDTH, skinGrip; e29e147): until now no row set how wide a
  // sloper is, so the narrow and wide builds every sloper now comes as were graded off their seeds,
  // and no row set a medium sloper at all. Atomik Climbing Holds' grade guides, which give each
  // set's width (found via search on 2026-10-16; the site can't be fetched from this run). Each
  // takes a set from the middle of its line, at its cited width: the lines' ends (Medium Basic
  // #1 V1 and #3 V3 on vertical, both 4" wide; Large Basic Steep Wall #2 V0) differ by a shape
  // the model only sees as pitch.
  // "5 Medium Basic Slopers Set #2 (Series 2.0)", 4-5/8" wide (11.7 cm) and 2-1/4" off the wall:
  // V2 on vertical.
  { name: 'vertical medium basic slopers', angle: 0, type: 'sloper', size: 'm', spacing: 50, feet: true, expect: 2, width: 11.7 },
  // "5 Medium Limestone Slopers Set #1", 4-1/2" wide (11.4 cm) and 2" off the wall: V2 on
  // vertical, V5 on a 25° wall.
  { name: 'vertical medium limestone slopers', angle: 0, type: 'sloper', size: 'm', spacing: 50, feet: true, expect: 2, width: 11.4 },
  { name: '25° medium limestone slopers', angle: 25, type: 'sloper', size: 'm', spacing: 50, feet: true, expect: 5, width: 11.4 },
  // "5 Large Basic Steep Wall Slopers Set #5 (Series 2.0)", 5-1/4" to 5-1/2" wide (13.7 cm),
  // shaped to stay level on steep walls (the flat end of a large sloper's pitch): V2+ on vertical,
  // V4 on a 25° wall.
  { name: 'vertical large steep wall slopers', angle: 0, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 2, width: 13.7, pitch: 24 },
  { name: '25° large steep wall slopers', angle: 25, type: 'sloper', size: 'l', spacing: 55, feet: true, expect: 4, width: 13.7, pitch: 24 },
  // Jugs by size, width and depth off the wall (model.ts JUG_WIDTH, shuffleCost, JUG_DEPTH): until now
  // no row set how wide a jug is, so the one-hand and two-hand builds every jug now comes as were
  // graded off their seeds, and no row used a small jug at all. Atomik Climbing Holds' grade
  // guides, which give each set's average size (found via search on 2026-10-17; the site can't
  // be fetched from this run). Jugs gain little with the angle until they get small.
  // "5 Mini Limestone Jugs Set #2", 3-1/4" wide (8.3 cm, one hand) and 1-1/2" off the wall:
  // V1+ on vertical, V3 on a 25° wall.
  { name: 'vertical mini limestone jugs', angle: 0, type: 'jug', size: 's', spacing: 45, feet: true, expect: 1, width: 8.3, depth: 38 },
  { name: '25° mini limestone jugs', angle: 25, type: 'jug', size: 's', spacing: 50, feet: true, expect: 3, width: 8.3, depth: 38 },
  // "Round Mini Jugs", 3" wide (7.6 cm) and 1-1/2" off: V1 on vertical, V4+ on a 45° wall. The
  // walls stop at 40°: V4.
  { name: '40° round mini jugs', angle: 40, type: 'jug', size: 's', spacing: 55, feet: true, expect: 4, width: 7.6, depth: 38 },
  // "5 Medium Basic Jugs Set #1 (Series 2.0)", 4" wide (10.2 cm, a one-hand jug, just) and
  // 2-1/4" off: V0 on vertical, V1 on a 25° wall.
  { name: '25° medium basic jugs', angle: 25, type: 'jug', size: 'm', spacing: 50, feet: true, expect: 1, width: 10.2, depth: 57 },
  // "5 Large Basic Jugs Set #3 (Series 2.0)", 4-3/4" wide (12.1 cm, two hands) and 2-3/4" off:
  // V0 on vertical and on a 25° wall, V1 at 45°.
  { name: '25° large basic jugs', angle: 25, type: 'jug', size: 'l', spacing: 50, feet: true, expect: 0, width: 12.1, depth: 70 },
  // Jugs by incut (model.ts JUG_OPEN): until now every Atomik jug row was a typical
  // jug, and a typical jug's lip (a ledge's or a horn's) hung like a bucket's at any angle. The
  // same Large Basic Jugs (Series 2.0) grade guides (found via search on 2026-10-17; the site can't
  // be fetched from this run) set the line's four builds apart by incut, at about one size.
  // "Set #1", the least incut ("incuts in the 45-degree range", "less and less positive, more
  // like ledges" on a 45° wall), 2-3/4" off the wall: V0 on vertical, V1 on a 25° wall, V3 at 45°.
  // The walls stop at 40°: V3, as for the round mini jugs above.
  { name: '25° least-incut large jugs', angle: 25, type: 'jug', size: 'l', spacing: 50, feet: true, expect: 1, incut: 0.6, depth: 70 },
  { name: '40° least-incut large jugs', angle: 40, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 3, incut: 0.6, depth: 70 },
  // "Set #2", incuts 45-60°, 5-1/4" wide (13.3 cm) and 2-1/4" off: V1 on a 25° wall.
  { name: '25° wide basic jugs', angle: 25, type: 'jug', size: 'l', spacing: 50, feet: true, expect: 1, incut: 0.7, depth: 57, width: 13.3 },
  // "Set #3", near a double incut, "a jug on all angles", and "Set #4 Double Incut": V1 at 45°,
  // two grades under Set #1 there.
  { name: '40° near-double-incut jugs', angle: 40, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 1, incut: 0.95, depth: 70, width: 12.1 },
  { name: '40° double-incut jugs', angle: 40, type: 'jug', size: 'l', spacing: 55, feet: true, expect: 1, incut: 1, depth: 70 },
  // Crimps and edges by lip radius (model.ts EDGE_RADIUS, radiusFactor; bcc38a5): until now no row
  // set how rounded an edge's front corner is, so the sharp and rounded builds every crimp and edge
  // now comes as were graded off their seeds. Atomik Climbing Holds' grade guides (found via search
  // on 2026-10-18; the site can't be fetched from this run). The sharp end: a Mountain Project
  // review of Atomik's crimps says "the radius is quite sharp" on most of them and calls the Small
  // Simple Crimps "sharp, but they don't rip your pads", so the Simple and Straight Crimp rows above
  // now pin the sharpest small-crimp radius (1.5 mm). The rounded end:
  // "System Crimps #16", about 1" deep (25 mm) with "a sizeable rounded edge", "a lot more rounded
  // than a straight edge" and "a less crimpy version of our 3/4" Crimp Tile": V4 on a 20° wall
  // ("an advanced feeling hold on low angled walls"). The roundest small edge build (9.5 mm).
 angle: 20, type: 'edge', size: 's', spacing: 50, feet: true, expect: 4, depth: 25, radius: 9.5 },
  // "10 Small Simple Rounders #2", 3" wide (7.6 cm), about 1-3/8" off the wall (35 mm) with very
  // little incut and a rounded lip: V3/V4 on vertical (its text says V4/5.11). V3, the lower grade,
  // as with the split ledges. The roundest medium edge build (12 mm).
 angle: 0, type: 'edge', size: 'm', spacing: 50, feet: true, expect: 3, depth: 35, width: 7.6, incut: 0.1, radius: 12 },
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
      : a.upper
        ? [
            { length: a.upper.at, angle: a.angle },
            { length: top + 20 - a.upper.at, angle: a.upper.angle },
          ]
        : [{ length: top + 20, angle: a.angle }],
    seed: 1,
    ...(a.fold ? { fold: { u: 200, angle: a.fold } } : {}),
    ...(a.ledge ? { lip: true } : {}),
  };
  const holds: Hold[] = [];
  let i = 0;
  const handTop = a.ledge ? a.ledge - 25 : top - 20 - a.spacing / 2;
  for (let v = 150 + a.spacing; v < handTop && a.rails; v += a.spacing)
    for (const u of [200 - a.rails, 200 + a.rails])
      holds.push({ id: `h${i++}`, type: a.type, size: a.size, u, v, rot: 0, incut: a.incut ?? typicalIncut(a.type), ...(a.fingers ? { fingers: a.fingers } : {}), ...(a.span ? { span: a.span } : {}), ...(a.depth ? { depth: a.depth } : {}), ...(a.width ? { width: a.width } : {}), ...(a.pitch ? { pitch: a.pitch } : {}), ...(a.radius ? { radius: a.radius } : {}) });
  for (let v = 150 + a.spacing; v < handTop && !a.rails; v += a.spacing, i++) {
    // Pinches are set as vertical fins; everything else incut-up.
    const u = a.column ? 200 : i % 2 ? 228 : 172;
    const rot = a.gaston ? (u < 200 ? -Math.PI / 2 : Math.PI / 2) : a.sidepull ? (u < 200 ? Math.PI / 2 : -Math.PI / 2) : a.undercling ? Math.PI : 0;
    // A typical build of the type throughout (neither a flat nor a deep incut one), unless
    // the problem is about incut.
    holds.push({ id: `h${i}`, type: a.type, size: a.size, u, v, rot, incut: a.incut ?? typicalIncut(a.type), ...(a.fingers ? { fingers: a.fingers } : {}), ...(a.span ? { span: a.span } : {}), ...(a.depth ? { depth: a.depth } : {}), ...(a.width ? { width: a.width } : {}), ...(a.pitch ? { pitch: a.pitch } : {}), ...(a.radius ? { radius: a.radius } : {}) });
  }
  if (a.feet)
    for (let v = 55, j = 0; v < (a.rails ? 140 : a.ledge ? a.ledge - 20 : top - 120); v += 38, j++)
      holds.push({ id: `f${j}`, type: a.jibs ? 'jib' : 'foot', size: 'm', u: (a.feetU ?? 200) + (j % 2 ? 14 : -14), v, rot: 0, incut: a.footIncut ?? typicalIncut(a.jibs ? 'jib' : 'foot'), ...(a.footDepth ? { depth: a.footDepth } : {}) });
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
