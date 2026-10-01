// Setter feedback after a test: how far off the brief the route landed and one
// concrete thing to change. Pure, so it can be unit-tested.
import { BODY, heightAt, wallHeight } from '../solver/model';
import type { Day, Hold, HoldType } from '../solver/types';
import { contactList } from '../solver/volumes';
import type { TestRun } from './rules';

const NAME: Partial<Record<HoldType, string>> = {
  jug: 'jug',
  edge: 'edge',
  crimp: 'crimp',
  sloper: 'sloper',
  pinch: 'pinch',
  pocket: 'pocket',
  volume: 'volume',
};

/** Signed distance to the brief: positive = harder than asked ("stiff"). */
export function gradeGap(test: TestRun, target: number): number | null {
  return test.result.ok ? test.result.grade - target : null;
}

export function gapLabel(gap: number): string {
  const a = Math.abs(gap);
  if (a < 0.5) return 'on grade';
  const n = a.toFixed(1);
  return `${n} ${n === '1.0' ? 'grade' : 'grades'} ${gap > 0 ? 'stiff' : 'soft'}`;
}

const metres = (cm: number) => `${(cm / 100).toFixed(1)} m`;

/** The placed holds the climber's hands actually used, in climbing order. */
function handHolds(day: Day, test: TestRun): Hold[] {
  if (!test.result.ok) return [];
  const all = contactList(day.start, day.finish, test.holds, test.volumes, day.wall);
  const placed = new Set(test.holds.map((h) => h.id));
  const seen = new Set<string>();
  const out: Hold[] = [];
  for (const m of test.result.moves) {
    if (m.limb > 1) continue;
    const h = all[m.to.limbs[m.limb]];
    if (h && placed.has(h.id) && !seen.has(h.id)) {
      seen.add(h.id);
      out.push(h);
    }
  }
  return out;
}

/** One sentence of advice, or null when the route is on grade. */
export function setterTip(day: Day, test: TestRun): string | null {
  const r = test.result;
  if (!r.ok) {
    if (r.reason === 'no-start') return 'Nothing for the feet at the start: add a foot chip or two low down, below the start holds.';
    const top = heightAt(day.wall, wallHeight(day.wall));
    const hp = r.highPoint;
    if (!hp) return 'Add holds between the start and the finish; the climber can move about an arm’s length per hand.';
    const high = heightAt(day.wall, Math.max(hp.points[0].v, hp.points[1].v));
    return `Stuck at ${metres(high)} of ${metres(top)}. Put a hold within about ${metres(
      BODY.lockoff * 0.8,
    )} above the highest hand, and a foot below it.`;
  }
  const gap = r.grade - day.targetGrade;
  if (Math.abs(gap) < 0.5) return null;
  const used = handHolds(day, test);
  if (gap < 0) {
    const jugs = used.filter((h) => h.type === 'jug' || (h.type === 'edge' && h.size === 'l'));
    if (jugs.length >= 2)
      return `Too soft: ${jugs.length} big holds in the beta. Swap one for a crimp or sloper, or turn it so it pulls sideways.`;
    if (used.length >= 5)
      return 'Too soft: the holds are close together. Spread them out or take one away so each move is bigger.';
    return 'Too soft: make the crux harder. Use a worse hold there, rotate it off-axis, or take away a foothold near it.';
  }
  // Too stiff: point at the crux hold.
  const all = contactList(day.start, day.finish, test.holds, test.volumes, day.wall);
  const crux = r.moves.reduce((a, b) => (b.difficulty > a.difficulty ? b : a), r.moves[0]);
  const h = crux ? all[crux.to.limbs[crux.limb]] : undefined;
  const what = h ? (h.id.startsWith('arete:') ? 'the arête' : `the ${NAME[h.type] ?? 'hold'}`) : 'the crux hold';
  if (crux?.dynamic) return `Too stiff: the crux is a dyno to ${what}. Add an intermediate between, or move it closer.`;
  if (crux && crux.limb > 1) return `Too stiff: the crux is a foot move. Add a better foothold nearby.`;
  return `Too stiff: the crux is the move to ${what}. Use a bigger hold there, turn it to face the pull, or add a foot under it.`;
}
