// Setter feedback after a test: how far off the brief the route landed and one
// concrete thing to change. Pure, so it can be unit-tested.
import { BODY, heightAt, toGrade, wallHeight } from '../solver/model';
import { moveDifficulty, moveParts, type MoveParts } from '../solver/solve';
import { OFF, SMEAR, type Day, type Hold, type HoldType, type Move } from '../solver/types';
import { contactList } from '../solver/volumes';
import type { TestRun } from './rules';
import { withSpots } from './spots';

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

/** One move's grade on its own: what the route would grade if it were its crux, no pump. */
export const moveGrade = (difficulty: number) => toGrade(difficulty, 0);

/**
 * Where a move's grade sits against the brief, 0..1, for colouring move tags and the
 * climb ticker: 0 = well under it (filler), 0.5 = on it, 1 = 1.5+ grades over it.
 */
export function gradeTone(grade: number, target: number): number {
  return Math.max(0, Math.min(1, 0.5 + (grade - target) / 3));
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
  const tape = withSpots(day, test.spots);
  const all = contactList(tape.start, tape.finish, test.holds, test.volumes, day.wall);
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

/** "the small crimp", "the lip", "the start jug". */
function holdName(h: Hold | undefined): string {
  if (!h) return 'a smear';
  if (h.id.startsWith('arete:')) return 'the arête';
  if (h.id.startsWith('lip:')) return 'the lip';
  if (h.role) return `the ${h.role} ${NAME[h.type] ?? 'hold'}`;
  if (h.type === 'volume') return 'the volume';
  const turned = Math.cos(h.rot) < -0.5 ? ' (upside down)' : Math.abs(Math.sin(h.rot)) > 0.7 ? ' (turned sideways)' : '';
  return `the ${h.size === 's' ? 'small ' : h.size === 'l' ? 'big ' : ''}${NAME[h.type] ?? 'hold'}${turned}`;
}

export type DriverKey = 'hold' | 'catch' | 'reach' | 'steep' | 'feet' | 'barn' | 'high' | 'pump';

export interface Driver {
  key: DriverKey;
  /** What it is, in climbing words: "Hanging off the small crimp". */
  label: string;
  /** Grades it adds: how much easier the crux would be with this part made neutral. */
  grades: number;
}

/** The crux: the hardest move of the beta. */
function cruxOf(moves: Move[]): Move | undefined {
  return moves.reduce<Move | undefined>((a, b) => (!a || b.difficulty > a.difficulty ? b : a), undefined);
}

/**
 * What made the route its grade: each part of the crux move swapped for a neutral one
 * (a jug to hang off and to catch, a short static reach, a vertical wall, good feet, no
 * barn door, no high step), and how many grades that takes off, plus the pump of hard
 * moves in a row. Biggest first; parts worth under 0.2 grades are left out.
 */
export function gradeDrivers(day: Day, test: TestRun): Driver[] {
  const r = test.result;
  if (!r.ok) return [];
  const crux = cruxOf(r.moves);
  if (!crux) return [];
  const tape = withSpots(day, test.spots);
  const all = contactList(tape.start, tape.finish, test.holds, test.volumes, day.wall);
  const m = moveParts(day.wall, tape.start, tape.finish, test.holds, crux, { volumes: test.volumes });
  if (!m) return [];
  const d = moveDifficulty(m);
  const gain = (alt: MoveParts) => toGrade(d, 0) - toGrade(Math.min(d, moveDifficulty(alt)), 0);
  const out: Driver[] = [];
  const add = (key: DriverKey, label: string, grades: number) => {
    if (grades >= 0.2) out.push({ key, label, grades });
  };
  const limbs = crux.from.limbs;
  const target = all[crux.to.limbs[crux.limb]];
  const angle = Math.round(m.angle);
  if (angle > 5) add('steep', `${angle}° steep at the hands`, gain({ ...m, angle: 0 }));
  const good: [number, number] = m.kind === 'hand' ? [0.9, 0.9] : [0.9, 0];
  const feetOn = [limbs[2], limbs[3]].filter((f) => f !== OFF);
  const feet =
    feetOn.length === 0
      ? 'Feet off: campusing'
      : feetOn.length === 1 && m.kind === 'hand'
        ? 'One foot on, the other flagging'
        : feetOn.every((f) => f === SMEAR)
          ? 'Smearing: no footholds'
          : 'Small footholds';
  add('feet', feet, gain({ ...m, feetQ: [Math.max(m.feetQ[0], good[0]), Math.max(m.feetQ[1], good[1])] }));
  if (m.kind === 'hand') {
    add('hold', `Hanging off ${holdName(all[limbs[1 - crux.limb]])}`, gain({ ...m, g: Math.max(m.g, 1) }));
    add('catch', `Catching ${holdName(target)}`, gain({ ...m, gt: Math.max(m.gt, 1) }));
    const reach = crux.dynamic
      ? 'A dyno: past full reach'
      : `A long reach: ${Math.round(Math.min(1, m.ext) * 100)}% of full stretch`;
    add('reach', reach, gain({ ...m, travel: Math.min(m.travel, 0.45), r: 0, commit: 0 }));
    add('barn', 'Barn door: nothing to brace the swing', gain({ ...m, barnK: 0 }));
  } else {
    add('hold', 'Hanging on while a foot moves', gain({ ...m, g: Math.max(m.g, 2) }));
    add('high', m.hookK ? 'Getting a heel or toe hook up' : 'A high step', gain({ ...m, hookK: 0, highK: 0 }));
  }
  // The pump: what the hard moves in a row add on top of the crux.
  add('pump', 'Pump: hard moves in a row, no rest', r.grade - toGrade(r.crux, 0));
  return out.sort((a, b) => b.grades - a.grades);
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
  // Too stiff: go after whatever made the crux hardest.
  const tape = withSpots(day, test.spots);
  const all = contactList(tape.start, tape.finish, test.holds, test.volumes, day.wall);
  const crux = cruxOf(r.moves);
  const h = crux ? all[crux.to.limbs[crux.limb]] : undefined;
  const what = h ? holdName(h) : 'the crux hold';
  const top = gradeDrivers(day, test)[0];
  switch (top?.key) {
    case 'hold':
      if (crux && crux.limb <= 1)
        return `Too stiff: the crux hangs off ${holdName(all[crux.from.limbs[1 - crux.limb]])}. Make that a bigger hold, or turn it to face the pull.`;
      break;
    case 'catch':
      return `Too stiff: ${what} is hard to catch at the crux. Use a bigger hold there, or turn it to face the pull.`;
    case 'reach':
      if (crux?.dynamic) return `Too stiff: the crux is a dyno to ${what}. Add an intermediate between, or move it closer.`;
      return `Too stiff: the crux is a long reach to ${what}. Move it closer, or add a hold in between.`;
    case 'steep':
    case 'feet':
      return `Too stiff: the arms take too much weight at the crux. Add a good foothold under the move to ${what}.`;
    case 'barn':
      return `Too stiff: the crux barn-doors off the wall. Add a foothold out on the side of ${what}.`;
    case 'high':
      return 'Too stiff: the crux is a big step up. Add a foothold in between.';
    case 'pump':
      return 'Too stiff: too many hard moves in a row. Add a jug to rest on before the crux.';
  }
  if (crux?.dynamic) return `Too stiff: the crux is a dyno to ${what}. Add an intermediate between, or move it closer.`;
  if (crux && crux.limb > 1) return `Too stiff: the crux is a foot move. Add a better foothold nearby.`;
  return `Too stiff: the crux is the move to ${what}. Use a bigger hold there, turn it to face the pull, or add a foot under it.`;
}
