// How long a test climb takes to watch: solves every curated day's reference route,
// builds the playback timeline the climber follows and adds up the seconds it plays for
// at 1x (crux slow-mo included, top-out estimated from the finish height).
//   npx tsx scripts/pacing.ts [--speed 2]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { heightAt } from '../src/solver/model';
import { solve } from '../src/solver/solve';
import type { Day, Hold, Volume } from '../src/solver/types';
import { contactList } from '../src/solver/volumes';
import { buildTimeline, CRUX_SLOWMO, SEND } from '../src/scene/timeline';
import { EXAMPLES } from '../src/game/examples';

const speedArg = process.argv.indexOf('--speed');
const speed = speedArg > 0 ? Number(process.argv[speedArg + 1]) : 1;
const dir = join(import.meta.dirname, '..', 'public', 'days');
const files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));

const rows: { n: number | string; moves: number; climb: number; total: number; style: string }[] = [];
type Route = { day: Day; holds: Hold[]; volumes: Volume[]; name: number | string };
const routes: Route[] = EXAMPLES.map((e) => ({ day: e.day, holds: e.holds, volumes: [], name: e.id }));
for (const f of files) {
  const day = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Day & { reference?: Hold[]; referenceVolumes?: Volume[] };
  if (day.reference) routes.push({ day, holds: day.reference, volumes: day.referenceVolumes ?? [], name: day.number });
}
const examples: string[] = [];
for (const { day, holds: placed, volumes, name } of routes) {
  const r = solve(day.wall, day.start, day.finish, placed, { noSmear: day.twist === 'no-smear', volumes });
  if (!r.ok) continue;
  const holds = contactList(day.start, day.finish, placed, volumes, day.wall);
  const tl = buildTimeline(r, day, holds);
  const climb = tl.frames.reduce((s, k) => s + (k.limb >= 0 && k.strain >= 0.98 ? k.duration / CRUX_SLOWMO : k.duration), 0);
  // Top-out: hold and release, the drop from the finish (measured in the app: ~2 s from
  // a 3 m finish, the body pushing off, falling and settling onto its feet), then the
  // landing, turn and celebration.
  const drop = Math.max(0.2, heightAt(day.wall, day.finish.v) / 100 - 1.1);
  const out = SEND.release + 0.9 + Math.sqrt((2 * drop) / 9.8) + (tl.send ? SEND.end : SEND.shrugEnd);
  const row = { n: name, moves: r.moves.length, climb: climb / speed, total: (climb + out) / speed, style: (day.wall as { name?: string }).name ?? '' };
  if (typeof name === 'string') examples.push(`example ${name}: ${row.moves} moves, climb ${row.climb.toFixed(1)} s, to result ${row.total.toFixed(1)} s`);
  else rows.push(row);
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const totals = rows.map((r) => r.total);
const moves = rows.map((r) => r.moves);
console.log(`${rows.length} routes at ${speed}x`);
console.log(`moves    median ${q(moves, 0.5)}  p90 ${q(moves, 0.9)}  max ${Math.max(...moves)}`);
console.log(`climb s  median ${q(rows.map((r) => r.climb), 0.5).toFixed(1)}  p90 ${q(rows.map((r) => r.climb), 0.9).toFixed(1)}`);
console.log(`total s  median ${q(totals, 0.5).toFixed(1)}  p90 ${q(totals, 0.9).toFixed(1)}  max ${Math.max(...totals).toFixed(1)}`);
console.log(`per move median ${q(rows.map((r) => r.climb / r.moves), 0.5).toFixed(2)} s`);
for (const e of examples) console.log(e);
if (process.argv.includes('--rows')) for (const r of rows) console.log(r.n, r.style, r.moves, r.total.toFixed(1));
