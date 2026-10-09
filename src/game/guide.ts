// The grade guide: what each V-grade looks like in Topout. Every line is backed by
// reference problems from scripts/calibrate.ts (guide.test.ts checks they grade as it says),
// except V7–8 (see there).

export interface GuideRow {
  /** "V0", or a range "V1–2". */
  g: string;
  text: string;
  /** Names of the calibration anchors the text describes. */
  anchors: string[];
}

export const GRADE_GUIDE: GuideRow[] = [
  { g: 'V0', text: 'Jugs close together on a vertical wall or a slab, good feet all the way.', anchors: ['vertical jug ladder', 'slab jugs'] },
  { g: 'V1–2', text: 'Edges on a vertical wall, or jugs on a gentle (20°) overhang.', anchors: ['vertical edges', '20° jugs'] },
  { g: 'V3', text: 'Crimps on a vertical wall, small holds and smears on a slab, or edges on a 20° overhang.', anchors: ['vertical crimps', 'slab crimps, smears', '20° edges'] },
  {
    g: 'V4',
    text: 'Small crimps on a vertical wall, pinches and slopers on a gentle overhang, or a jump between jugs.',
    anchors: ['vertical small crimps', '20° pinches', '20° slopers', '30° pinches', 'vertical jug dyno'],
  },
  {
    g: 'V5–6',
    text: 'Gastons, or edges, crimps, pinches and slopers on a 40° board.',
    anchors: ['vertical gaston edges', '40° edges', '40° crimps', '40° slopers', '40° pinches'],
  },
  // No reference problem yet: board benchmarks this hard are on 45-60° walls, and the
  // reference sit start can't get going past 40° (calibrate.ts).
  { g: 'V7–8', text: 'Small holds far apart on a 45-60° board or cave, with poor feet.', anchors: [] },
];

/** A row's grade range, [lo, hi]. */
export function guideRange(row: GuideRow): [number, number] {
  const [lo, hi] = row.g.slice(1).split('–').map(Number);
  return [lo, hi ?? lo];
}
