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
import { canPlace, canPlaceVolume, traySeed } from '../src/game/rules';
import { solve } from '../src/solver/solve';
import type { Day, Hold, HoldType, TraySlot, Volume } from '../src/solver/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const from = Number(args.get('from') ?? 1);
const count = Number(args.get('days') ?? 90);
const ATTEMPTS = Number(args.get('attempts') ?? 120);
const MAX_VARIANTS = 12;
const OUT = join(import.meta.dirname, '..', 'public', 'days');

type DayDraft = ReturnType<typeof generateDay>;

interface Route {
  holds: Hold[];
  volumes: Volume[];
}

/** Each volume counts as one hold toward par, same as in the game. */
const size = (r: Route) => r.holds.length + r.volumes.length;

function gradeOf(day: DayDraft, route: Route): number | null {
  const r = solve(day.wall, day.start, day.finish, route.holds, { noSmear: day.twist === 'no-smear', volumes: route.volumes });
  return r.ok ? r.grade : null;
}

const onTarget = (g: number | null, target: number) => g !== null && Math.round(g) === target;

function randomRoute(day: DayDraft, r: Rng): Route {
  const pool = day.tray
    .filter((s) => s.type !== 'volume')
    // Each tray hold is a particular build (traySeed), the same one a player gets.
    .flatMap((s: TraySlot) => Array.from({ length: s.count }, (_, k) => ({ type: s.type, size: s.size, seed: traySeed(day.number, s.type, s.size, k) })));
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

  // Volumes first (like a real setter), somewhere along the line, sometimes.
  const volumes: Volume[] = [];
  for (const slot of day.tray.filter((s) => s.type === 'volume'))
    for (let i = 0; i < slot.count; i++) {
      if (!r.chance(0.5)) continue;
      const t = r.range(0.15, 0.75);
      const vol: Volume = {
        id: `v${volumes.length}`,
        shape: slot.shape!,
        size: slot.size === 'l' ? 'l' : 's',
        u: su + (fu - su) * t + r.range(-40, 40),
        v: sv + (fv - sv) * t - r.range(40, 110),
        rot: r.pick([0, Math.PI / 4, Math.PI / 2]),
      };
      if (canPlaceVolume(day.wall, volumes, [...day.start, day.finish], vol)) volumes.push(vol);
    }

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
      seed: spec.seed,
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
      seed: spec.seed,
    });
  }
  return { holds: placed, volumes };
}

/** Remove holds and volumes one at a time while the route stays on target. */
function strip(day: DayDraft, route: Route): Route {
  let cur = route;
  let changed = true;
  while (changed) {
    changed = false;
    const options: Route[] = [
      ...cur.holds.map((_, i) => ({ holds: cur.holds.filter((_, j) => j !== i), volumes: cur.volumes })),
      ...cur.volumes.map((_, i) => ({ holds: cur.holds, volumes: cur.volumes.filter((_, j) => j !== i) })),
    ];
    for (const next of options) {
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
    let best: Route | null = null;
    for (let a = 0; a < ATTEMPTS; a++) {
      const route = randomRoute(day, r);
      if (best && size(route) >= size(best) + 3) continue;
      if (!onTarget(gradeOf(day, route), day.targetGrade)) continue;
      const stripped = strip(day, route);
      if (!best || size(stripped) < size(best)) best = stripped;
    }
    if (best) {
      return { ...day, par: size(best), reference: best.holds, referenceVolumes: best.volumes };
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
