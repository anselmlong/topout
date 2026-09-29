import { STYLE_LABEL, TWIST_LABEL, wallStyleOf } from '../gen/day';
import type { Day, Hold, HoldSize, HoldType } from '../solver/types';
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
const TYPES: HoldType[] = ['jug', 'crimp', 'sloper', 'pinch', 'pocket', 'foot'];
const SIZES: HoldSize[] = ['s', 'm', 'l'];

export function encodeRoute(day: number, holds: Hold[]): string {
  const body = holds
    .map((h) =>
      [TYPES.indexOf(h.type), SIZES.indexOf(h.size), Math.round(h.u), Math.round(h.v), Math.round((h.rot * 180) / Math.PI)].join(
        '.',
      ),
    )
    .join('_');
  return `r=${day}-${body}`;
}

export function decodeRoute(hash: string): { day: number; holds: Hold[] } | null {
  const m = /r=(\d+)-([\d._-]*)/.exec(hash);
  if (!m) return null;
  const holds: Hold[] = [];
  for (const [i, part] of m[2].split('_').filter(Boolean).entries()) {
    const [t, s, u, v, rot] = part.split('.').map(Number);
    if (!TYPES[t] || !SIZES[s] || [u, v, rot].some((x) => !Number.isFinite(x))) return null;
    holds.push({ id: `shared-${i}`, type: TYPES[t], size: SIZES[s], u, v, rot: (rot * Math.PI) / 180 });
  }
  return { day: Number(m[1]), holds };
}
