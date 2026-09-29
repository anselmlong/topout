// Generate, verify, and compute par for a run of daily puzzles.
//
//   npm run curate -- --from 1 --days 90
//
// For each day: search for routes that grade exactly on target, then greedily
// strip holds while the grade stays on target. Par = the fewest holds found.
// That is the best route the search found, not a proven minimum. Days where no
// on-target route turns up are rerolled (new variant) up to MAX_VARIANTS times.
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateDay } from '../src/gen/day';
import { hash, rng, type Rng } from '../src/gen/rng';
import { canPlace } from '../src/game/rules';
import { solve } from '../src/solver/solve';
import type { Day, Hold, HoldType, TraySlot } from '../src/solver/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const from = Number(args.get('from') ?? 1);
const count = Number(args.get('days') ?? 90);
const ATTEMPTS = Number(args.get('attempts') ?? 120);
const MAX_VARIANTS = 12;
const OUT = join(import.meta.dirname, '..', 'public', 'days');

type DayDraft = ReturnType<typeof generateDay>;

function gradeOf(day: DayDraft, holds: Hold[]): number | null {
  const r = solve(day.wall, day.start, day.finish, holds, { noSmear: day.twist === 'no-smear' });
  return r.ok ? r.grade : null;
}

const onTarget = (g: number | null, target: number) => g !== null && Math.round(g) === target;

function randomRoute(day: DayDraft, r: Rng): Hold[] {
  const pool = day.tray.flatMap((s: TraySlot) => Array.from({ length: s.count }, () => ({ type: s.type, size: s.size })));
  const isFoot = (t: HoldType) => t === 'foot' || t === 'jib';
  const hands = pool.filter((p) => !isFoot(p.type));
  const feet = pool.filter((p) => isFoot(p.type));
  const take = <T>(xs: T[]) => xs.splice(Math.floor(r.next() * xs.length), 1)[0];

  const su = day.start.reduce((s, h) => s + h.u, 0) / day.start.length;
  const sv = day.start.reduce((s, h) => s + h.v, 0) / day.start.length;
  const { u: fu, v: fv } = day.finish;
  const k = r.int(2, Math.min(hands.length, 11));
  const placed: Hold[] = [];
  const all = () => [...day.start, day.finish, ...placed];
  const tryPlace = (h: Hold) => {
    if (canPlace(day.wall, all(), h)) placed.push(h);
  };
  const lateral = r.range(15, 45);

  for (let i = 1; i <= k && hands.length; i++) {
    const t = i / (k + 1);
    const side = i % 2 ? -1 : 1;
    const spec = take(hands);
    tryPlace({
      id: `h${i}`,
      type: spec.type as HoldType,
      size: spec.size,
      u: su + (fu - su) * t + side * lateral + r.range(-12, 12),
      v: sv + (fv - sv) * t + r.range(-10, 10),
      rot: spec.type === 'pinch' ? side * r.range(0.6, 1.3) : r.range(-0.35, 0.35),
    });
  }
  const handPts = [...day.start, ...placed];
  const footCount = r.int(0, Math.min(feet.length, handPts.length + 2));
  for (let i = 0; i < footCount && feet.length; i++) {
    const anchor = r.pick(handPts);
    const spec = take(feet);
    tryPlace({
      id: `f${i}`,
      type: spec.type as HoldType,
      size: spec.size,
      u: anchor.u + r.range(-30, 30),
      v: anchor.v - r.range(85, 135),
      rot: 0,
    });
  }
  return placed;
}

/** Remove holds one at a time while the route stays on target. */
function strip(day: DayDraft, route: Hold[]): Hold[] {
  let cur = route;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const next = cur.filter((_, j) => j !== i);
      if (onTarget(gradeOf(day, next), day.targetGrade)) {
        cur = next;
        changed = true;
        break;
      }
    }
  }
  return cur;
}

function curate(n: number): Day | null {
  for (let variant = 0; variant < MAX_VARIANTS; variant++) {
    const day = generateDay(n, variant);
    const r = rng(hash(n, variant, 0xc0a7));
    let best: Hold[] | null = null;
    for (let a = 0; a < ATTEMPTS; a++) {
      const route = randomRoute(day, r);
      if (best && route.length >= best.length + 3) continue;
      if (!onTarget(gradeOf(day, route), day.targetGrade)) continue;
      const stripped = strip(day, route);
      if (!best || stripped.length < best.length) best = stripped;
    }
    if (best) {
      return { ...day, par: best.length, reference: best };
    }
  }
  return null;
}

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
let failed = 0;
for (let n = from; n < from + count; n++) {
  const t = Date.now();
  const day = curate(n);
  if (!day) {
    failed++;
    console.log(`#${n}  ✗ no on-target route found`);
    continue;
  }
  writeFileSync(join(OUT, `${n}.json`), JSON.stringify(day));
  const ang = day.wall.panels.map((p) => p.angle).join('/');
  console.log(
    `#${n} ${day.date}  V${day.targetGrade}  ${ang}°  ${day.twist ?? ''}  par ${day.par}  ${Date.now() - t}ms`,
  );
}
const nums = readdirSync(OUT)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => parseInt(f))
  .sort((a, b) => a - b);
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ days: nums }));
console.log(`\n${count - failed}/${count} days curated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
