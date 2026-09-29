// Four-limb state search.
//
// A state is which hold each limb is on. A move changes one limb. The grade is
// driven by the hardest move, so we search in two passes:
//   1. bottleneck Dijkstra: the smallest possible crux over all routes to the top;
//   2. ordinary Dijkstra on summed difficulty, using only moves no harder than
//      that crux, to pick the smoothest beta among the easiest-crux ones.
// Everything is deterministic: same holds in, same beta out.
import {
  BODY,
  PAD,
  SMEAR_QUALITY,
  angleAt,
  footQuality,
  footMatchable,
  handGrip,
  handMatchable,
  handLoad,
  heightAt,
  vAtHeight,
  toGrade,
  GRIP,
} from './model';
import { Heap } from './heap';
import { contactList } from './volumes';
import {
  OFF,
  SMEAR,
  type Hold,
  type Move,
  type Point,
  type SolveOptions,
  type SolveResult,
  type Stance,
  type Wall,
} from './types';

const MAX_STATES = 250_000;
const MIN_GRIP = 0.05;

type Limbs = [number, number, number, number];

export function solve(
  wall: Wall,
  start: Hold[],
  finish: Hold,
  placed: Hold[],
  opts: SolveOptions = {},
): SolveResult {
  const ctx = new Context(wall, contactList(start, finish, placed, opts.volumes, wall), opts);
  const finishIdx = start.length;

  const starts = ctx.startStates(start.length === 1 ? [0, 0] : orderHands(start));
  if (starts.length === 0) {
    return {
      ok: false,
      reason: 'no-start',
      message: 'No valid starting position — there is nowhere to put your feet.',
    };
  }

  const isGoal = (l: Limbs) => l[0] === finishIdx && l[1] === finishIdx;

  // Pass 1: minimise the worst move.
  const bottleneck = ctx.search(starts, isGoal, (acc, d) => Math.max(acc, d), Infinity);
  if (!bottleneck.goal) {
    return {
      ok: false,
      reason: bottleneck.truncated ? 'too-complex' : 'unreachable',
      message: bottleneck.truncated
        ? 'Route too complex to evaluate — try fewer holds.'
        : 'The climber can’t reach the finish from here.',
      highPoint: ctx.stance(bottleneck.highest),
    };
  }
  const crux = bottleneck.cost;

  // Pass 2: smoothest route whose every move is within the crux.
  const smooth = ctx.search(starts, isGoal, (acc, d) => acc + d, crux + 1e-9);
  const path = smooth.goal ? smooth.path : bottleneck.path;

  const moves: Move[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const limb = a.findIndex((x, j) => x !== b[j]) as 0 | 1 | 2 | 3;
    const m = ctx.moveCost(a, limb, b[limb])!;
    moves.push({
      limb,
      from: ctx.stance(a),
      to: ctx.stance(b),
      difficulty: m.d,
      dynamic: m.dynamic,
    });
  }
  const hard = moves.filter((m) => m.difficulty >= crux * 0.85).length;
  return {
    ok: true,
    crux,
    grade: toGrade(crux, hard),
    moves,
    start: ctx.stance(path[0]),
  };
}

function orderHands(start: Hold[]): [number, number] {
  return start[0].u <= start[1].u ? [0, 1] : [1, 0];
}

const dist = (a: Point, b: Point) => Math.hypot(a.u - b.u, a.v - b.v);

class Context {
  handIdx: number[];
  footVals: number[];
  /** Wall v where the surface meets the top of the crash pad. */
  padV: number;
  constructor(
    readonly wall: Wall,
    readonly holds: Hold[],
    readonly opts: SolveOptions,
  ) {
    this.handIdx = holds.map((h, i) => (GRIP[h.type].hand ? i : -1)).filter((i) => i >= 0);
    this.footVals = [...holds.map((_, i) => i), SMEAR, OFF];
    this.padV = vAtHeight(wall, PAD);
  }

  key(l: Limbs): number {
    const m = this.holds.length + 2;
    return ((l[0] * m + l[1]) * m + (l[2] + 2)) * m + (l[3] + 2);
  }

  /** Contact points; smear/off feet are placed relative to the hands. */
  points(l: Limbs): [Point, Point, Point, Point] {
    const h = this.holds;
    const lh = h[l[0]];
    const rh = h[l[1]];
    const midU = (lh.u + rh.u) / 2;
    const lowV = Math.min(lh.v, rh.v);
    const foot = (val: number, side: -1 | 1): Point => {
      if (val >= 0) return { u: h[val].u, v: h[val].v };
      // Low on the wall, smear higher / tuck the legs rather than touch the mat.
      // If that bunches the body up too much, valid() calls it a dab (hip check).
      if (val === SMEAR) return { u: midU + side * 18, v: Math.max(lowV - 118, this.padV + 12) };
      return { u: midU + side * 12, v: Math.max(lowV - 150, this.padV + 8) };
    };
    return [
      { u: lh.u, v: lh.v },
      { u: rh.u, v: rh.v },
      foot(l[2], -1),
      foot(l[3], 1),
    ];
  }

  stance(l: Limbs): Stance {
    return { limbs: [...l] as Limbs, points: this.points(l) };
  }

  footQ(val: number, p: Point): number {
    if (val >= 0) return footQuality(this.holds[val]);
    if (val === SMEAR) return angleAt(this.wall, p.v) < -2 ? SMEAR_QUALITY.slab : SMEAR_QUALITY.vertical;
    return 0;
  }

  /** Stance validity. `slack` > 1 allows the stretched landing of a dyno. */
  valid(l: Limbs, slack = BODY.dynoLimit): boolean {
    const p = this.points(l);
    if (dist(p[0], p[1]) > BODY.span * slack) return false;
    // Matching needs a hold with room for two.
    if (l[0] === l[1] && !handMatchable(this.holds[l[0]])) return false;
    if (l[2] >= 0 && l[2] === l[3] && !footMatchable(this.holds[l[2]])) return false;
    if (p[0].u - p[1].u > BODY.maxHandCross) return false;
    if (l[2] >= 0 && l[3] >= 0 && p[2].u - p[3].u > BODY.maxFootCross) return false;
    const hiV = Math.max(p[0].v, p[1].v);
    const loV = Math.min(p[0].v, p[1].v);
    for (const f of [2, 3] as const) {
      const val = l[f];
      // Dab: a dangling foot or a smear that reaches the mat isn't climbing.
      if (val === OFF) continue;
      if (val === SMEAR) {
        if (this.opts.noSmear) return false;
        if (angleAt(this.wall, p[f].v) > 0) return false;
        continue;
      }
      const fp = p[f];
      // Nothing to stand on (e.g. the underside of a volume).
      if (footQuality(this.holds[val]) < 0.05) return false;
      // A foothold under the crash pad is the mat: that's a dab.
      if (fp.v < this.padV) return false;
      if (fp.v > loV + 15 || fp.v > hiV - 50) return false;
      for (const hp of [p[0], p[1]]) {
        const d = dist(fp, hp);
        if (d > BODY.reach * slack || d < BODY.crouch) return false;
      }
    }
    if (l[2] >= 0 && l[3] >= 0 && dist(p[2], p[3]) > BODY.stride) return false;
    // Dab: hips sitting on the mat. Mirrors the pose the climber is drawn in.
    const on = [2, 3].filter((f) => l[f] !== OFF);
    const handsV = (p[0].v + p[1].v) / 2;
    const feetV = on.length ? on.reduce((s, f) => s + p[f].v, 0) / on.length : handsV - 150;
    const chestDrop = Math.max(12, Math.min(42, handsV - feetV - 75));
    // Real hip height: on an overhang the hips hang out from the wall, and so lower.
    const hipV = handsV - chestDrop - 50;
    const sag = 30 * Math.max(0, Math.sin((angleAt(this.wall, hipV) * Math.PI) / 180));
    const hipH = heightAt(this.wall, hipV) - sag;
    if (hipH < PAD + 15) return false;
    // A foot hanging free needs the hips high enough to keep it off the mat.
    if ((l[2] === OFF || l[3] === OFF) && hipH - 45 < PAD) return false;
    // A smear or tucked foot needs room between it and the hands.
    for (const f of [2, 3]) if (l[f] < 0 && handsV - p[f].v < 75) return false;
    // Campusing (both feet off) only makes sense on real overhangs.
    if (l[2] === OFF && l[3] === OFF && angleAt(this.wall, loV) < 10) return false;
    return true;
  }

  startStates(hands: [number, number]): Limbs[] {
    const out: Limbs[] = [];
    for (const lf of this.footVals)
      for (const rf of this.footVals) {
        const l: Limbs = [hands[0], hands[1], lf, rf];
        // Start with at least one foot on — no sit-start campus.
        if (lf === OFF && rf === OFF) continue;
        if (this.valid(l, 1)) out.push(l);
      }
    // Start with feet apart when possible; a shared foothold is the fallback.
    const apart = out.filter((l) => l[2] < 0 || l[2] !== l[3]);
    return apart.length ? apart : out;
  }

  /** Cost of moving `limb` to `to` from stance `l`, or null if impossible. */
  moveCost(l: Limbs, limb: number, to: number): { d: number; dynamic: boolean } | null {
    const next = [...l] as Limbs;
    next[limb] = to;
    if (!this.valid(next)) return null;
    const p = this.points(l);
    const np = this.points(next);
    const handsAngle = angleAt(this.wall, (np[0].v + np[1].v) / 2);

    if (limb <= 1) {
      const other = 1 - limb;
      const onFeet = [2, 3].filter((f) => l[f] !== OFF);
      // Centre of the three-point stance the climber hangs from mid-move.
      const feetMid = onFeet.length
        ? {
            u: onFeet.reduce((s, f) => s + p[f].u, 0) / onFeet.length,
            v: onFeet.reduce((s, f) => s + p[f].v, 0) / onFeet.length,
          }
        : { u: p[other].u, v: p[other].v - 140 };
      const c = { u: (p[other].u + feetMid.u) / 2, v: (p[other].v + feetMid.v) / 2 };
      const g = handGrip(this.holds[l[other]], c, this.wall);
      if (g < MIN_GRIP) return null;
      // Hanging stretched out (feet far below) loads the arms much more.
      let stretch = 0;
      for (const f of onFeet) stretch = Math.max(stretch, dist(p[f], p[other]) / BODY.reach);
      const load =
        handLoad(handsAngle, [this.footQ(l[2], p[2]), this.footQ(l[3], p[3])]) *
        (1 + 2.5 * Math.max(0, stretch - 0.8));

      const target = np[limb];
      let ext = dist(p[other], target) / BODY.span;
      for (const f of onFeet) ext = Math.max(ext, dist(p[f], target) / BODY.reach);
      if (ext > BODY.dynoLimit) return null;
      const dynamic = ext > 1;
      const r = ext <= 0.55 ? 0 : dynamic ? 1 + ((ext - 1) / (BODY.dynoLimit - 1)) * 1.5 : (ext - 0.55) / 0.45;

      const nc = { u: (np[0].u + np[1].u + feetMid.u) / 3, v: (np[0].v + np[1].v + feetMid.v * 2) / 4 };
      const gt = handGrip(this.holds[to], nc, this.wall);
      if (gt < MIN_GRIP) return null;
      const hold = load / g;
      const catchHard = 0.12 * (1 / gt - 1) * (1 + r);
      // Longer moves mean longer lock-offs, even well inside full reach.
      const travel = dist(p[limb], target) / 100;
      // Smears are modelled relative to the hands, so they "follow" a hand move;
      // charge for re-smearing that far.
      let resmear = 0;
      for (const f of [2, 3]) if (l[f] === SMEAR) resmear += dist(p[f], np[f]) / 100;
      // Crossing through is awkward: allowed, but it costs.
      const cross = Math.max(0, np[0].u - np[1].u) / BODY.maxHandCross;
      const d =
        hold * (0.72 + 0.85 * travel + 0.7 * r + 0.3 * resmear + 0.5 * cross) +
        catchHard +
        (dynamic ? 0.4 : 0) +
        // Matching is a shuffle: fine on the finish, a small cost anywhere else.
        (to === l[other] && this.holds[to].role !== 'finish' ? 0.08 : 0);
      return { d, dynamic };
    }

    // Foot move: both hands hold the load the moving foot gave up.
    const stay = limb === 2 ? 3 : 2;
    const load = handLoad(handsAngle, [this.footQ(l[stay], p[stay]), 0]);
    const c = { u: (p[0].u + p[1].u + p[stay].u) / 3, v: (p[0].v + p[1].v + p[stay].v * 2) / 4 };
    const g = handGrip(this.holds[l[0]], c, this.wall) + handGrip(this.holds[l[1]], c, this.wall);
    if (g < MIN_GRIP) return null;
    // Feet share a hold only when there's nothing better nearby.
    const match = to >= 0 && to === l[stay] ? 0.12 : 0;
    return { d: load / g + match, dynamic: false };
  }

  neighbours(l: Limbs, visit: (n: Limbs, d: number) => void) {
    for (let limb = 0; limb < 4; limb++) {
      const vals = limb <= 1 ? this.handIdx : this.footVals;
      for (const to of vals) {
        if (to === l[limb]) continue;
        const m = this.moveCost(l, limb, to);
        if (!m) continue;
        const n = [...l] as Limbs;
        n[limb] = to;
        visit(n, m.d);
      }
    }
  }

  search(
    starts: Limbs[],
    isGoal: (l: Limbs) => boolean,
    combine: (acc: number, d: number) => number,
    maxEdge: number,
  ) {
    const best = new Map<number, number>();
    const prev = new Map<number, Limbs | null>();
    const states = new Map<number, Limbs>();
    const heap = new Heap<Limbs>();
    for (const s of starts) {
      const k = this.key(s);
      best.set(k, 0);
      prev.set(k, null);
      states.set(k, s);
      heap.push(0, k, s);
    }
    let highest = starts[0];
    let truncated = false;
    while (heap.size) {
      const { pri, key, value: l } = heap.pop()!;
      if (pri > best.get(key)!) continue;
      if (Math.min(this.holds[l[0]].v, this.holds[l[1]].v) > Math.min(this.holds[highest[0]].v, this.holds[highest[1]].v))
        highest = l;
      if (isGoal(l)) {
        const path: Limbs[] = [];
        for (let cur: Limbs | null = l; cur; cur = prev.get(this.key(cur))!) path.push(cur);
        return { goal: l, cost: pri, path: path.reverse(), highest, truncated };
      }
      if (states.size > MAX_STATES) {
        truncated = true;
        break;
      }
      this.neighbours(l, (n, d) => {
        if (d > maxEdge) return;
        const nk = this.key(n);
        const c = combine(pri, d);
        const old = best.get(nk);
        if (old !== undefined && old <= c) return;
        best.set(nk, c);
        prev.set(nk, l);
        states.set(nk, n);
        heap.push(c, nk, n);
      });
    }
    return { goal: null, cost: Infinity, path: [] as Limbs[], highest, truncated };
  }
}
