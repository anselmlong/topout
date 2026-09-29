// Summarise the curated archive: par distribution and which hold types setter routes use.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'public', 'days');
const days = readdirSync(dir)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const pars = days.map((d) => d.par).sort((a, b) => a - b);
const types: Record<string, number> = {};
let hands = 0;
for (const d of days)
  for (const h of d.reference ?? []) {
    types[h.type] = (types[h.type] ?? 0) + 1;
    if (h.type !== 'foot' && h.type !== 'jib') hands++;
  }
console.log(`days ${days.length}  par median ${pars[pars.length >> 1]}  mean ${(pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(1)}  range ${pars[0]}–${pars[pars.length - 1]}`);
console.log('hold use:', Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '));
console.log(`jug share of hand holds: ${(((types.jug ?? 0) / Math.max(1, hands)) * 100).toFixed(0)}%`);
