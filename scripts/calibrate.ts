// Grade calibration: reference problems with widely agreed grades, graded by the solver.
//   npx tsx scripts/calibrate.ts
// Anchors (commonly accepted gym/board grades; each ±1):
//   vertical jug ladder ≈ V0, vertical edges ≈ V1-2, vertical crimps ≈ V3,
//   20° jugs ≈ V1-2, 20° edges ≈ V4, 40° board jugs ≈ V3-4 (MoonBoard floor is V4),
//   40° edges ≈ V6, 40° crimps ≈ V8, slab crimps + smears ≈ V2-3,
//   vertical gaston edges ≈ V4-5.
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
  { name: 'vertical jug dyno', angle: 0, type: 'jug', size: 'l', spacing: 125, feet: true, expect: 4, column: true },
];

const TOP = 400;
const start: Hold[] = [
  { id: 's1', type: 'jug', size: 'l', u: 180, v: 150, rot: 0, role: 'start' },
  { id: 's2', type: 'jug', size: 'l', u: 220, v: 150, rot: 0, role: 'start' },
];
const finish: Hold = { id: 'f', type: 'jug', size: 'l', u: 200, v: TOP - 20, rot: 0, role: 'finish' };

export function anchorRoute(a: Anchor) {
  const wall: Wall = {
    width: 400,
    panels: [{ length: TOP + 20, angle: a.angle }],
    seed: 1,
    ...(a.fold ? { fold: { u: 200, angle: a.fold } } : {}),
  };
  const holds: Hold[] = [];
  let i = 0;
  for (let v = 150 + a.spacing; v < TOP - 20 - a.spacing / 2; v += a.spacing, i++) {
    // Pinches are set as vertical fins; everything else incut-up.
    const u = a.column ? 200 : i % 2 ? 228 : 172;
    const rot = a.gaston ? (u < 200 ? -Math.PI / 2 : Math.PI / 2) : 0;
    holds.push({ id: `h${i}`, type: a.type, size: a.size, u, v, rot });
  }
  if (a.feet)
    for (let v = 55, j = 0; v < TOP - 120; v += 38, j++)
      holds.push({ id: `f${j}`, type: 'foot', size: 'm', u: j % 2 ? 214 : 186, v, rot: 0 });
  return { wall, holds };
}

export function gradeAnchor(a: Anchor) {
  const { wall, holds } = anchorRoute(a);
  return solve(wall, start, finish, holds);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let err = 0;
  for (const a of ANCHORS) {
    const r = gradeAnchor(a);
    const g = r.ok ? r.grade : NaN;
    const d = g - a.expect;
    err += Number.isFinite(d) ? Math.abs(d) : 5;
    console.log(`${a.name.padEnd(22)} expect V${a.expect}  got ${r.ok ? `V${g.toFixed(1)}` : r.reason}  ${Number.isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) : ''}`);
  }
  console.log(`mean abs error: ${(err / ANCHORS.length).toFixed(2)} grades`);
}
