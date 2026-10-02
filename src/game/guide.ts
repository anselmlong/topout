// The grade guide: what each V-grade looks like in Topout. Every line is backed by
// reference problems from scripts/calibrate.ts (guide.test.ts checks they grade as it says).

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
  { g: 'V3', text: 'Crimps on a vertical wall, or small holds and smears on a slab.', anchors: ['vertical crimps', 'slab crimps, smears'] },
  {
    g: 'V4',
    text: 'Edges on a 20° overhang, jugs on a steep 40° wall, or a jump between jugs.',
    anchors: ['20° edges', '40° jugs', 'vertical jug dyno'],
  },
  { g: 'V5–6', text: 'Pinches and gastons, or edges on a 40° wall.', anchors: ['30° pinches', 'vertical gaston edges', '40° edges'] },
  { g: 'V7–8', text: 'Crimps and slopers on a 40° board, far apart, poor feet.', anchors: ['40° crimps', '40° slopers'] },
];

/** A row's grade range, [lo, hi]. */
export function guideRange(row: GuideRow): [number, number] {
  const [lo, hi] = row.g.slice(1).split('–').map(Number);
  return [lo, hi ?? lo];
}
