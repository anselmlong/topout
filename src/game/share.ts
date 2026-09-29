import { STYLE_LABEL, TWIST_LABEL, wallStyleOf } from '../gen/day';
import type { Day, Hold, HoldSize, HoldType, Volume, VolumeShape } from '../solver/types';
import { SQUARE, bestTest, holds as nHolds, type TestRun } from './rules';

export function shareText(day: Day, tests: TestRun[]): string {
  const best = bestTest(tests, day.targetGrade);
  const head = `Topout #${day.number} · V${day.targetGrade} · ${STYLE_LABEL[wallStyleOf(day.wall)]}${
    day.twist ? ` · ${TWIST_LABEL[day.twist]}` : ''
  }`;
  const squares = tests.map((t) => SQUARE[t.verdict]).join('');
  const line =
    best && best.result.ok
      ? `V${best.result.grade.toFixed(1)} · ${nHolds(best.holdCount)} (par ${day.par})`
      : `No send · par ${day.par}`;
  return `${head}\n${squares}  ${line}`;
}

// Compact route encoding for share links: day|type size u v rotDeg;...
// Append only: indices are baked into shared links.
const TYPES: HoldType[] = ['jug', 'crimp', 'sloper', 'pinch', 'pocket', 'foot', 'edge', 'jib'];
const SIZES: HoldSize[] = ['s', 'm', 'l'];

// Volumes follow after a '~': shape.size.u.v.rotDeg (append-only too).
const SHAPES: VolumeShape[] = ['pyramid', 'wedge'];
const VSIZES: Volume['size'][] = ['s', 'l'];
const deg = (r: number) => Math.round((r * 180) / Math.PI);

export function encodeRoute(day: number, holds: Hold[], volumes: Volume[] = []): string {
  const body = holds
    .map((h) => [TYPES.indexOf(h.type), SIZES.indexOf(h.size), Math.round(h.u), Math.round(h.v), deg(h.rot)].join('.'))
    .join('_');
  const vols = volumes
    .map((v) => [SHAPES.indexOf(v.shape), VSIZES.indexOf(v.size), Math.round(v.u), Math.round(v.v), deg(v.rot)].join('.'))
    .join('_');
  return `r=${day}-${body}${vols ? `~${vols}` : ''}`;
}

export function decodeRoute(hash: string): { day: number; holds: Hold[]; volumes: Volume[] } | null {
  const m = /r=(\d+)-([\d._-]*)(?:~([\d._-]*))?/.exec(hash);
  if (!m) return null;
  const holds: Hold[] = [];
  for (const [i, part] of m[2].split('_').filter(Boolean).entries()) {
    const [t, s, u, v, rot] = part.split('.').map(Number);
    if (!TYPES[t] || !SIZES[s] || [u, v, rot].some((x) => !Number.isFinite(x))) return null;
    holds.push({ id: `shared-${i}`, type: TYPES[t], size: SIZES[s], u, v, rot: (rot * Math.PI) / 180 });
  }
  const volumes: Volume[] = [];
  for (const [i, part] of (m[3] ?? '').split('_').filter(Boolean).entries()) {
    const [sh, s, u, v, rot] = part.split('.').map(Number);
    if (!SHAPES[sh] || !VSIZES[s] || [u, v, rot].some((x) => !Number.isFinite(x))) return null;
    volumes.push({ id: `v-shared-${i}`, shape: SHAPES[sh], size: VSIZES[s], u, v, rot: (rot * Math.PI) / 180 });
  }
  return { day: Number(m[1]), holds, volumes };
}
