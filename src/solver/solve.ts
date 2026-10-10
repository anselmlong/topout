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
  TOE_HOOK_OUT,
  HEEL_STEEP,
  TOE_STEEP,
  bestPull,
  SMEAR_QUALITY,
  angleAt,
  footQuality,
  footTechnique,
  footMatchable,
  handGrip,
  handMatchable,
  handLoad,
  isBig,
  isPalm,
  palmFactor,
  palmOpposed,
  hasShelf,
  heightAt,
  highStep,
  MANTLE_LOAD,
  MANTLE_REACH,
  MANTLE_STAND,
  mantleable,
  mantleStep,
  pressQuality,
  stemBonus,
  vAtHeight,
  wallPoint,
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
/** Moves cached for reuse by the second search pass; past this many, new stances aren't cached. */
const MAX_CACHED_MOVES = 2_000_000;
const MIN_GRIP = 0.05;
/** A stance that hangs at under this share of the hard moves' hang is a rest (hardStreak). */
const REST = 0.6;

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
  return {
    ok: true,
    crux,
    grade: toGrade(crux, hardStreak(moves, crux, path.slice(0, -1).map((l) => ctx.hangCost(l)))),
    moves,
    start: ctx.stance(path[0]),
  };
}

/**
 * Pump: the longest run of hard moves (within 15% of the crux) without a rest.
 * `hang[i]` is the cost of hanging one-handed in the stance before move i
 * (Context.hangCost). A stance that hangs far easier than the ones the hard moves
 * leave from is a rest: the climber shakes out, chalks up, and the pump clears. So
 * three crux moves back to back climb harder than the same three split by a jug.
 * A hard foot move counts too: the arms hold on while the foot finds its hold.
 */
export function hardStreak(moves: Move[], crux: number, hang: number[]): number {
  const hard = (m: Move) => m.difficulty >= crux * 0.85;
  const strain = Math.max(0, ...moves.map((m, i) => (hard(m) && Number.isFinite(hang[i]) ? hang[i] : 0)));
  let run = 0;
  let longest = 0;
  moves.forEach((m, i) => {
    if (hang[i] < strain * REST) run = 0;
    if (hard(m)) run++;
    longest = Math.max(longest, run);
  });
  return longest;
}

/**
 * What one move's difficulty is made of, as scored by the solver: enough to rebuild it
 * (moveDifficulty) with any piece swapped for a neutral one, which is how the result
 * card says what drove the crux.
 * - angle, feetQ: wall angle at the hands and both feet's quality; with loadMul they set
 *   the share of body weight on the arms (handLoad).
 * - g: grip of the hand that stays on (both hands' grips summed, for a foot move).
 * Hand moves: gt the grip of the hold caught; ext the stretch (1 = full static reach, more
 * is a dyno), travel the distance (m) and r the reach term; barnK the barn-door swing;
 * commit the cost of jumping. Foot moves: hookK a heel or toe hook, highK a high step.
 */
export type MoveParts =
  | {
      kind: 'hand';
      angle: number;
      feetQ: [number, number];
      loadMul: number;
      g: number;
      gt: number;
      ext: number;
      travel: number;
      r: number;
      resmear: number;
      cross: number;
      barnK: number;
      commit: number;
      match: number;
    }
  | { kind: 'foot'; angle: number; feetQ: [number, number]; g: number; match: number; hookK: number; highK: number; minLoad: number };

/** A move's difficulty rebuilt from its parts: the same sum moveCost scores. */
export function moveDifficulty(m: MoveParts): number {
  if (m.kind === 'foot') {
    const load = Math.max(m.minLoad, handLoad(m.angle, m.feetQ));
    return (load / m.g) * (1 + m.highK) + m.match + m.hookK * load;
  }
  const load = handLoad(m.angle, m.feetQ) * m.loadMul;
  const steepness = 0.6 + Math.max(0, Math.sin((m.angle * Math.PI) / 180));
  return (
    (load / m.g) * (0.72 + 0.85 * m.travel + 0.7 * m.r + 0.3 * m.resmear + 0.5 * m.cross) +
    m.barnK * load * steepness +
    0.12 * (1 / m.gt - 1) * (1 + m.r) +
    m.commit +
    m.match
  );
}

/** The parts of a solved move (one from a SolveResult on the same wall and holds). */
export function moveParts(wall: Wall, start: Hold[], finish: Hold, placed: Hold[], move: Move, opts: SolveOptions = {}): MoveParts | null {
  const ctx = new Context(wall, contactList(start, finish, placed, opts.volumes, wall), opts);
  const parts: MoveParts[] = [];
  ctx.moveCost(move.from.limbs, move.limb, move.to.limbs[move.limb], undefined, parts);
  return parts[0] ?? null;
}

/** Whether the climber has a legal starting stance (hands on the start, a foot on): the 'no-start' check alone. */
export function canStart(wall: Wall, start: Hold[], finish: Hold, placed: Hold[], opts: SolveOptions = {}): boolean {
  const ctx = new Context(wall, contactList(start, finish, placed, opts.volumes, wall), opts);
  return ctx.startStates(start.length === 1 ? [0, 0] : orderHands(start)).length > 0;
}

function orderHands(start: Hold[]): [number, number] {
  return start[0].u <= start[1].u ? [0, 1] : [1, 0];
}

const flatDist = (a: Point, b: Point) => Math.hypot(a.u - b.u, a.v - b.v);

class Context {
  handIdx: number[];
  footVals: number[];
  /** Whether each hold is a shelf to mantle onto (see mantleable). */
  mantle: boolean[];
  /** Wall v where the surface meets the top of the crash pad. */
  padV: number;
  /** Each hold's point, shared by every stance that uses it. */
  at: Point[];
  /**
   * Every legal move out of each stance the first pass expanded, in visit order, so the
   * second pass reuses them instead of re-scoring: a move's cost depends only on the
   * stance and the move. Entry i is limb `code[i] & 3` to hold `(code[i] >> 2) - 2`.
   */
  private moves = new Map<number, { code: Int32Array; d: Float64Array }>();
  private cachedMoves = 0;
  /**
   * Reach distance (cm). Across a dihedral or over a ledge, the real 3D distance: the corner
   * brings things closer, and the shelf's depth is mostly reached across, not up.
   */
  dist: (a: Point, b: Point) => number;

  constructor(
    readonly wall: Wall,
    readonly holds: Hold[],
    readonly opts: SolveOptions,
  ) {
    // Hold points are shared objects (points()), so their 3D positions are worked out once.
    const at = new WeakMap<Point, number[]>();
    const xyz = (a: Point) => {
      let p = at.get(a);
      if (!p) at.set(a, (p = wallPoint(wall, a.u, a.v)));
      return p;
    };
    this.dist = wall.fold || hasShelf(wall)
      ? (a, b) => {
          const p = xyz(a);
          const q = xyz(b);
          return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        }
      : flatDist;
    this.at = holds.map((h) => ({ u: h.u, v: h.v }));
    this.mantle = holds.map((h) => mantleable(h, wall));
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
      if (val >= 0) return this.at[val];
      // Low on the wall, smear higher / tuck the legs rather than touch the mat.
      // If that bunches the body up too much, valid() calls it a dab (hip check).
      if (val === SMEAR) {
        // In a corner, feet go either side of the crease to stem.
        const fold = this.wall.fold;
        const u = fold && Math.abs(midU - fold.u) < 70 ? fold.u + side * 25 : midU + side * 18;
        return { u, v: Math.max(lowV - 118, this.padV + 12) };
      }
      return { u: midU + side * 12, v: Math.max(lowV - 150, this.padV + 8) };
    };
    return [
      this.at[l[0]],
      this.at[l[1]],
      foot(l[2], -1),
      foot(l[3], 1),
    ];
  }

  stance(l: Limbs): Stance {
    return { limbs: [...l] as Limbs, points: this.points(l).map((p) => ({ ...p })) as Stance['points'] };
  }

  /**
   * How stretched the hands are, as a fraction of the reachable limit (1 = full static reach).
   * Sideways the limit is the arm span; straight up it's the much shorter lock-off reach.
   */
  handSpan(a: Point, b: Point, lockoff = BODY.lockoff): number {
    const du = Math.abs(b.u - a.u);
    const dv = Math.abs(b.v - a.v);
    const ellipse = Math.hypot(du / BODY.span, dv / lockoff);
    // A dihedral brings points closer in 3D than on the unfolded wall.
    const flat = Math.hypot(du, dv);
    return flat > 1e-6 ? ellipse * (this.dist(a, b) / flat) : 0;
  }

  /**
   * Foot `f` is up on a mantle shelf beside a hand pressing on one (see mantleable): about
   * level with that hand, just under it at most, and beside it rather than out to the side.
   */
  mantleFoot(l: Limbs, f: 2 | 3, p: Point[]): boolean {
    if (l[f] < 0 || !this.mantle[l[f]]) return false;
    return mantleStep([p[0], p[1]], [this.mantle[l[0]], this.mantle[l[1]]], p[f]);
  }

  /**
   * Hand `i` is pressing out a mantle: its shelf has a foot up beside it. The climber stands
   * up on that foot, the palm on the shelf at the thigh for balance, so the other hand reaches
   * MANTLE_REACH up from it, not just a lock-off.
   */
  pressing(l: Limbs, p: Point[], i: number): boolean {
    if (!this.mantle[l[i]]) return false;
    return ([2, 3] as const).some((f) => l[f] >= 0 && this.mantle[l[f]] && p[f].v <= p[i].v + 10 && p[f].v >= p[i].v - 30 && Math.abs(p[f].u - p[i].u) <= 70);
  }

  /** Hand-to-hand stretch (handSpan), with MANTLE_REACH for the lock-off when hand `a` is pressing a mantle. */
  spanOf(l: Limbs, p: Point[], a: number, b: Point): number {
    return this.handSpan(p[a], b, this.pressing(l, p, a) ? MANTLE_REACH : BODY.lockoff);
  }

  /** Both feet's quality, plus the stemming bonus when they push on opposite faces of a corner. */
  feetQ(l: Limbs, p: Point[], stay?: number): [number, number] {
    const q: [number, number] = [this.footQ(l[2], p[2], this.hookOf(l, 2, p)), this.footQ(l[3], p[3], this.hookOf(l, 3, p))];
    // Flag: one foot on, the other off the holds but pressed against the wall as a
    // counterweight. Not dead weight: it gives a little support (less when steep).
    const on = [l[2], l[3]].filter((x) => x !== OFF).length;
    if (on === 1 && stay === undefined) {
      const steep = angleAt(this.wall, Math.min(p[0].v, p[1].v));
      const flag = steep <= 30 ? 0.22 * (1 - Math.max(0, steep) / 45) : 0;
      if (l[2] === OFF) q[0] = flag;
      if (l[3] === OFF) q[1] = flag;
    }
    // Drop knee: on steep ground a foothold out to the side at about hip height lets
    // the knee turn in and the hip press to the wall, taking weight off the arms.
    for (const f of [2, 3] as const)
      if (l[f] >= 0 && footTechnique(this.wall, [p[0], p[1]], p[f]) === 'drop-knee') q[f - 2] = Math.min(1, q[f - 2] + 0.12);
    if (stay !== undefined) q[stay === 2 ? 1 : 0] = 0;
    // The stem closes that share of each foot's shortfall, so a foothold in a corner still
    // beats a smear: pressing out on a hold, the foot can stand down on it as well.
    if (l[2] !== OFF && l[3] !== OFF && stay === undefined) {
      const bonus = stemBonus(this.wall, [p[2].u, p[3].u]);
      if (bonus) return [q[0] + bonus * (1 - q[0]), q[1] + bonus * (1 - q[1])];
    }
    return q;
  }

  /**
   * Hooks: a foot up near the hands only stays on as a heel or toe hook.
   * - Heel: on steep ground a heel on a big hold near hand height pulls the hips in.
   *   Needs something to hook (jug, big edge or sloper, a volume), and to be out to the side.
   * - Toe: further out (leg nearly straight), on steeper ground, the top of the foot pulls
   *   back toward the body against the hold's far side. Works on smaller holds than a heel,
   *   but only if that side faces away from the climber (a sidepull turned outward).
   */
  hookOk(val: number, fp: Point, p: Point[]): boolean {
    const h = this.holds[val];
    if (h.id.startsWith('arete:')) return false;
    const hiV = Math.max(p[0].v, p[1].v);
    if (fp.v > hiV + 10) return false;
    const midU = (p[0].u + p[1].u) / 2;
    const out = Math.abs(fp.u - midU);
    const angle = angleAt(this.wall, fp.v);
    if (out < TOE_HOOK_OUT) {
      const hookable = h.type === 'jug' || h.type === 'volume' || ((h.type === 'edge' || h.type === 'sloper') && isBig(h.size));
      return angle >= HEEL_STEEP && hookable && out >= 25;
    }
    const toeable =
      h.type === 'jug' ||
      h.type === 'volume' ||
      ((h.type === 'edge' || h.type === 'pinch') && h.size !== 's') ||
      (h.type === 'sloper' && isBig(h.size));
    if (angle < TOE_STEEP || !toeable) return false;
    // The toe pulls the hold sideways, toward the body.
    const best = bestPull(h.rot);
    const c = Math.sign(midU - fp.u) * best.u;
    const t = h.tol ?? GRIP[h.type].tolerance;
    return (c + t) / (1 + t) >= 0.35;
  }

  /** The hook (if any) a foot on a hold is in: heel or toe. */
  hookOf(l: Limbs, f: 2 | 3, p: Point[]): 'heel' | 'toe' | null {
    if (l[f] < 0) return null;
    const t = footTechnique(this.wall, [p[0], p[1]], p[f]);
    if (t !== 'heel' && t !== 'toe') return null;
    // A foot stood on a mantle shelf isn't hooking it (unless it could: steep enough to heel).
    if (this.mantleFoot(l, f, p) && !this.hookOk(l[f], p[f], p)) return null;
    return t;
  }

  footQ(val: number, p: Point, hook: 'heel' | 'toe' | null = null): number {
    // A toe hook holds less than a heel (the shin pulls, not the hamstring).
    if (val >= 0 && hook) return hook === 'heel' ? 0.75 : 0.6;
    if (val >= 0) return footQuality(this.holds[val]);
    if (val === SMEAR) return angleAt(this.wall, p.v) < -2 ? SMEAR_QUALITY.slab : SMEAR_QUALITY.vertical;
    return 0;
  }

  /**
   * A hand's grip on `hold` pulled toward `c` (handGrip), priced as a push when it's a palm on
   * a bare volume face (isPalm): only with weight over the feet, not on an overhang, and at full
   * strength only when something pushes back. `other` is the other hand's hold while it's on
   * (null mid-move); `stem` the feet bridged across a corner, which oppose a palm too.
   */
  gripOf(hold: Hold, c: Point, other: Hold | null, feetOn: number, stem: boolean): number {
    const g = handGrip(hold, c, this.wall);
    if (!g || !isPalm(hold, c)) return g;
    return g * palmFactor(this.wall, hold, stem || (!!other && palmOpposed(hold, other, c)), feetOn);
  }

  /**
   * How hard it is to hang off the better hand in this stance, feet on, so the other
   * hand can let go and shake out: the load on one arm over that hold's grip, on the
   * same scale as a move's hanging term. Infinity with both feet off.
   */
  hangCost(l: Limbs): number {
    const p = this.points(l);
    const on = [2, 3].filter((f) => l[f] !== OFF);
    if (!on.length) return Infinity;
    const feet = { u: on.reduce((s, f) => s + p[f].u, 0) / on.length, v: on.reduce((s, f) => s + p[f].v, 0) / on.length };
    const load = handLoad(angleAt(this.wall, (p[0].v + p[1].v) / 2), this.feetQ(l, p));
    const g = Math.max(this.gripOf(this.holds[l[0]], feet, null, on.length, false), this.gripOf(this.holds[l[1]], feet, null, on.length, false));
    return g < MIN_GRIP ? Infinity : (0.72 * load) / g;
  }

  /** Stance validity. `slack` > 1 allows the stretched landing of a dyno. */
  valid(l: Limbs, slack = BODY.dynoLimit, p = this.points(l)): boolean {
    if (Math.min(this.spanOf(l, p, 0, p[1]), this.spanOf(l, p, 1, p[0])) > slack) return false;
    // The arête helps (a layback, a slap) but you can't climb it bare: one hand stays on a real hold.
    if (this.holds[l[0]].id.startsWith('arete:') && this.holds[l[1]].id.startsWith('arete:')) return false;
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
        // Smears need a slab or vertical face — or a corner to stem across (up to ~20° steep).
        const stemming = this.wall.fold && stemBonus(this.wall, [p[2].u, p[3].u]) > 0;
        if (angleAt(this.wall, p[f].v) > (stemming ? 20 : 0)) return false;
        continue;
      }
      const fp = p[f];
      // Nothing to stand on (e.g. the underside of a volume).
      if (footQuality(this.holds[val]) < 0.05) return false;
      // A foothold under the crash pad is the mat: that's a dab.
      if (fp.v < this.padV) return false;
      // A foot up near the hands is only possible as a heel or toe hook (on steep ground, out
      // to the side), or stood on a shelf the hands are pressing out (a mantle).
      const mantle = this.mantleFoot(l, f, p);
      const heel = fp.v > loV + 15 || fp.v > hiV - 50;
      if (heel && !mantle && !this.hookOk(val, fp, p)) return false;
      for (const hp of [p[0], p[1]]) {
        const d = this.dist(fp, hp);
        if (d > BODY.reach * slack || d < (mantle ? 0 : heel ? 35 : BODY.crouch)) return false;
      }
    }
    if (l[2] >= 0 && l[3] >= 0 && this.dist(p[2], p[3]) > BODY.stride) return false;
    // One heel and one toe at a time (a heel-toe pair is fine, two of the same is not).
    const hooks = [this.hookOf(l, 2, p), this.hookOf(l, 3, p)];
    if (hooks[0] && hooks[0] === hooks[1]) return false;
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

  /**
   * Cost of moving `limb` to `to` from stance `l`, or null if impossible. Pass `parts` to
   * get the pieces the cost is built from (moveDifficulty rebuilds it from them).
   */
  moveCost(l: Limbs, limb: number, to: number, p = this.points(l), parts?: MoveParts[]): { d: number; dynamic: boolean } | null {
    const next = [...l] as Limbs;
    next[limb] = to;
    const np = this.points(next);
    if (!this.valid(next, BODY.dynoLimit, np)) return null;
    const handsAngle = angleAt(this.wall, (np[0].v + np[1].v) / 2);

    if (limb <= 1) {
      // No walking a hand up the arête: each slap on the edge must go back to a real hold.
      if (this.holds[l[limb]].id.startsWith('arete:') && this.holds[to].id.startsWith('arete:')) return null;
      // Feet under the reach: with a foot on each of two footholds, the climber can push off
      // both, or stand up on the one nearer the hold being reached for and let the other
      // trail, toe on its hold, doing what a flag does and no more. A lower second foot then
      // never makes a reach longer or harder than flagging it would, so the climber keeps it
      // on, and what makes a reach easy is a foot under it, not the foot nearest the hands.
      const both = this.handMove(l, l, limb, to, p, np, handsAngle);
      let best = both;
      if (l[2] >= 0 && l[3] >= 0) {
        const far = this.dist(p[2], np[limb]) > this.dist(p[3], np[limb]) ? 2 : 3;
        const trailed = this.handMove(l, l.map((x, j) => (j === far ? OFF : x)) as Limbs, limb, to, p, np, handsAngle);
        if (trailed && (!both || trailed.d < both.d)) best = trailed;
      }
      if (best) parts?.push(best.parts);
      return best && { d: best.d, dynamic: best.dynamic };
    }

    // Foot move: both hands hold the load the moving foot gave up.
    const stay = limb === 2 ? 3 : 2;
    // Mantle: the foot comes up onto the shelf the hands are pressing out. The arms press
    // most of the body up (MANTLE_LOAD) on palms, which care how wide the shelf is, not
    // how incut (see mantleable).
    const mantle = to >= 0 && this.mantleFoot(next, limb as 2 | 3, np) && !this.hookOf(next, limb as 2 | 3, np);
    const minLoad = mantle ? MANTLE_LOAD : 0;
    const load = Math.max(minLoad, handLoad(handsAngle, [this.footQ(l[stay], p[stay]), 0]));
    const c = { u: (p[0].u + p[1].u + p[stay].u) / 3, v: (p[0].v + p[1].v + p[stay].v * 2) / 4 };
    const handG = (i: 0 | 1) => {
      const pull = this.gripOf(this.holds[l[i]], c, this.holds[l[1 - i]], l[stay] !== OFF ? 1 : 0, false);
      return mantle && this.pressing(next, np, i) ? Math.max(pull, pressQuality(this.holds[l[i]])) : pull;
    };
    const g = handG(0) + handG(1);
    if (g < MIN_GRIP) return null;
    // Feet share a hold only when there's nothing better nearby.
    const match = to >= 0 && to === l[stay] ? 0.12 : 0;
    // Getting a heel up takes effort; a toe hook (leg straight out) a little less.
    const hook = this.hookOf(next, limb as 2 | 3, np);
    const heel = hook !== null;
    const heelUp = hook === 'heel' ? 0.3 * load : hook === 'toe' ? 0.2 * load : 0;
    // High steps: a big lift, or a foot tucked up near the hips, takes hip mobility and
    // a rockover, while the arms hold on. Climbers take an intermediate foot instead.
    // In a corner the other foot stems against the opposite face and makes it easy.
    let high = 0;
    if (to >= 0 && !heel) {
      const lift = l[limb] >= 0 ? Math.max(0, np[limb].v - p[limb].v) : 0;
      const stem = l[stay] !== OFF ? stemBonus(this.wall, [np[2].u, np[3].u]) : 0;
      high =
        (load / g) * (1 - stem) * ((0.25 * Math.max(0, lift - 35)) / 60 + 1.0 * highStep([np[0], np[1]], np[limb]));
    }
    parts?.push({
      kind: 'foot',
      angle: handsAngle,
      feetQ: [this.footQ(l[stay], p[stay]), 0],
      g,
      match,
      minLoad,
      hookK: hook === 'heel' ? 0.3 : hook === 'toe' ? 0.2 : 0,
      highK: load > 0 ? (high * g) / load : 0,
    });
    return { d: load / g + match + heelUp + high, dynamic: false };
  }

  /**
   * A hand move's cost (see moveCost), with the feet as `lw` has them: stance `l`, or `l` with
   * a trailing foot taken off.
   */
  private handMove(
    l: Limbs,
    lw: Limbs,
    limb: number,
    to: number,
    p: Point[],
    np: Point[],
    handsAngle: number,
  ): { d: number; dynamic: boolean; parts: MoveParts } | null {
    const other = 1 - limb;
    const onFeet = [2, 3].filter((f) => lw[f] !== OFF);
    // Centre of the three-point stance the climber hangs from mid-move.
    const feetMid = onFeet.length
      ? {
          u: onFeet.reduce((s, f) => s + p[f].u, 0) / onFeet.length,
          v: onFeet.reduce((s, f) => s + p[f].v, 0) / onFeet.length,
        }
      : { u: p[other].u, v: p[other].v - 140 };
    const c = { u: (p[other].u + feetMid.u) / 2, v: (p[other].v + feetMid.v) / 2 };
    // Stemming a corner pushes weight onto the legs: the arms carry less than on any face.
    const stem = lw[2] !== OFF && lw[3] !== OFF ? stemBonus(this.wall, [p[2].u, p[3].u]) : 0;
    // Stood up on a mantle shelf, the palm still pressing on it steadies the body. A palm
    // left on alone while the other hand moves has only the feet (a stem) to push back.
    const g = Math.max(
      this.gripOf(this.holds[l[other]], c, null, onFeet.length, stem > 0),
      this.pressing(l, p, other) ? pressQuality(this.holds[l[other]]) : 0,
    );
    if (g < MIN_GRIP) return null;
    // Hanging stretched out (feet far below) loads the arms more. Kept moderate: a
    // long body with straight arms is how climbers rest, so the hold and the angle
    // should drive the grade, not the stance alone.
    let stretch = 0;
    for (const f of onFeet) stretch = Math.max(stretch, this.dist(p[f], p[other]) / BODY.reach);
    const feetQ = this.feetQ(lw, p);
    const load =
      handLoad(handsAngle, feetQ) *
      (1 + 1.5 * Math.max(0, stretch - 0.8)) *
      (1 - 0.75 * stem);

    const target = np[limb];
    let ext = this.spanOf(l, p, other, target);
    for (const f of onFeet) ext = Math.max(ext, this.dist(p[f], target) / BODY.reach);
    if (ext > BODY.dynoLimit) return null;
    const dynamic = ext > 1;
    const r = ext <= 0.55 ? 0 : dynamic ? 1 + ((ext - 1) / (BODY.dynoLimit - 1)) * 1.5 : (ext - 0.55) / 0.45;

    const nc = { u: (np[0].u + np[1].u + feetMid.u) / 3, v: (np[0].v + np[1].v + feetMid.v * 2) / 4 };
    // Caught as a palm, the hand that stays on can push the body back onto it.
    const gt = this.gripOf(this.holds[to], nc, this.holds[l[other]], onFeet.length, stem > 0);
    if (gt < MIN_GRIP) return null;
    const hold = load / g;
    const catchHard = 0.12 * (1 / gt - 1) * (1 + r);
    // Longer moves mean longer lock-offs, even well inside full reach. Off a mantle (the other
    // palm pressing out a shelf with a foot up on it) the legs stand the body up the first
    // MANTLE_STAND of it: only the reach past that is a lock-off.
    const stand = this.pressing(l, p, other) ? MANTLE_STAND : 0;
    const travel = Math.max(0, this.dist(p[limb], target) - stand) / 100;
    // Smears are modelled relative to the hands, so they "follow" a hand move;
    // charge for re-smearing that far.
    let resmear = 0;
    for (const f of [2, 3]) if (l[f] === SMEAR) resmear += this.dist(p[f], np[f]) / 100;
    // Crossing through is awkward: allowed, but it costs.
    const cross = Math.max(0, np[0].u - np[1].u) / BODY.maxHandCross;
    // Barn door: if the remaining hand and the feet line up vertically (the hinge),
    // reaching out to the side swings you off. A free leg flagged the other way
    // counterbalances most of it.
    const supports = [p[other].u, ...onFeet.map((f) => p[f].u)];
    const lo = Math.min(...supports);
    const hi = Math.max(...supports);
    const narrow = Math.max(0, 1 - (hi - lo) / 35);
    const out = Math.max(0, target.u < lo ? lo - target.u : target.u - hi) - 15;
    const flagging = onFeet.length === 1;
    const steepness = 0.6 + Math.max(0, Math.sin((handsAngle * Math.PI) / 180));
    const barnK = narrow * Math.max(0, out / 100) * 1.1 * (flagging ? 0.35 : 1);
    const barn = barnK * load * steepness;
    // Commitment: a deadpoint just past reach is nearly static; a real jump is not.
    const commit = dynamic ? 0.4 * Math.min(1, (ext - 1) / BODY.deadpoint) : 0;
    // Matching is a shuffle: fine on the finish, a small cost anywhere else.
    const match = to === l[other] && this.holds[to].role !== 'finish' ? 0.08 : 0;
    const d = hold * (0.72 + 0.85 * travel + 0.7 * r + 0.3 * resmear + 0.5 * cross) + barn + catchHard + commit + match;
    return {
      d,
      dynamic,
      parts: {
        kind: 'hand',
        angle: handsAngle,
        feetQ,
        loadMul: (1 + 1.5 * Math.max(0, stretch - 0.8)) * (1 - 0.75 * stem),
        g,
        gt,
        ext,
        travel,
        r,
        resmear,
        cross,
        barnK,
        commit,
        match,
      },
    };
  }

  neighbours(l: Limbs, visit: (n: Limbs, d: number) => void) {
    const k = this.key(l);
    const hit = this.moves.get(k);
    if (hit) {
      for (let i = 0; i < hit.code.length; i++) {
        const n = [...l] as Limbs;
        n[hit.code[i] & 3] = (hit.code[i] >> 2) - 2;
        visit(n, hit.d[i]);
      }
      return;
    }
    const code: number[] = [];
    const ds: number[] = [];
    this.scoreMoves(l, (n, d, limb) => {
      code.push(((n[limb] + 2) << 2) | limb);
      ds.push(d);
      visit(n, d);
    });
    if (this.cachedMoves < MAX_CACHED_MOVES) {
      this.cachedMoves += code.length;
      this.moves.set(k, { code: Int32Array.from(code), d: Float64Array.from(ds) });
    }
  }

  private scoreMoves(l: Limbs, visit: (n: Limbs, d: number, limb: number) => void) {
    const h = this.holds;
    const p = this.points(l);
    for (let limb = 0; limb < 4; limb++) {
      const vals = limb <= 1 ? this.handIdx : this.footVals;
      for (const to of vals) {
        if (to === l[limb]) continue;
        // Cheap reach pre-checks before the full move evaluation.
        if (limb <= 1) {
          const o = h[l[1 - limb]];
          const t = h[to];
          const lockoff = this.mantle[l[1 - limb]] ? MANTLE_REACH : BODY.lockoff;
          if (Math.hypot((t.u - o.u) / BODY.span, (t.v - o.v) / lockoff) > BODY.dynoLimit * 1.05) continue;
        } else if (to >= 0) {
          const t = h[to];
          const hi = Math.max(h[l[0]].v, h[l[1]].v);
          if (t.v > hi + 10) continue;
          if (Math.hypot(t.u - h[l[0]].u, t.v - h[l[0]].v) > BODY.reach * BODY.dynoLimit * 1.05) continue;
        }
        const m = this.moveCost(l, limb, to, p);
        if (!m) continue;
        const n = [...l] as Limbs;
        n[limb] = to;
        visit(n, m.d, limb);
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
