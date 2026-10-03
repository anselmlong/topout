// The climb's script: one keyframe per solver move (plus shake-outs and dyno pumps),
// each with its duration in sim seconds. Pure data, so playback length can be measured
// outside the renderer (scripts/pacing.ts).
import { verdictOf } from '../game/rules';
import { moveGrade } from '../game/tips';
import { handGrip } from '../solver/model';
import type { Day, Hold, Point, SolveResult, Stance, Wall } from '../solver/types';
import { OFF } from '../solver/types';

export type Contacts = { hands: [Point, Point]; feet: [Point | null, Point | null] };

export const contactsOf = (s: Stance): Contacts => ({
  hands: [s.points[0], s.points[1]],
  feet: [s.limbs[2] === OFF ? null : s.points[2], s.limbs[3] === OFF ? null : s.points[3]],
});

export interface Keyframe {
  to: Contacts;
  /** Hold index each limb lands on (for chalk), -1/-2 for smear/off. */
  holds: number[];
  limb: number;
  duration: number;
  dynamic?: boolean;
  /** Difficulty relative to the route's crux, 0..1. */
  strain: number;
  /** The move's own grade, for the ticker. */
  grade?: number;
  move: number;
  /** A shake-out: this hand lets go, shakes, chalks up and grabs the same hold again. */
  rest?: 0 | 1;
  /** Winding up the dyno that follows: pump the hips down twice, launch from the low point. */
  windup?: boolean;
  /**
   * A move plays in three beats: `prep` s of wind-up (eyes on the hold, weight shifting off
   * the limb, a hand's lock-off), `travel` s of the limb on its way, then the rest of
   * `duration` settling as the weight comes onto the new hold.
   */
  prep?: number;
  travel?: number;
}

export interface Timeline {
  frames: Keyframe[];
  ending: 'top' | 'fall' | 'shrug';
  /** Topped out on the brief (a send) rather than off it (a near miss). */
  send?: boolean;
  total: number;
  /** Extra time after the last frame for the ending to play out. */
  tail: number;
}

/** Playback rate during the crux move: it plays in slow motion. */
export const CRUX_SLOWMO = 0.55;

/** How long a shake-out before the crux takes (s). */
export const REST = 2.1;
/** The shake-out's choreography (shakeOut) is written over this many seconds, then fitted into REST. */
export const SHAKE_SCRIPT = 2.1;
/** How long the pumps before a dyno take (s). */
export const WINDUP = 0.8;
/** Seconds of moves (at 1x, crux slow-mo included) a route can take before easy moves quicken. */
export const CLIMB_BUDGET = 18;
/** The quickest easy moves get on a long route, as a share of their full pace. */
export const MIN_TEMPO = 0.68;
/** Standing on the start before the first move (s). */
export const PREROLL = 0.8;

/**
 * The beats of one move at 1x (seconds): a wind-up, the limb travelling, and a settle.
 * Hands take longer the further they go and the harder the move; feet are quicker and
 * placed with care; a dyno's wind-up is its own keyframe (the pumps), so it launches at
 * once, flies fast and gets a long settle for the catch and swing.
 */
export function beats(limb: number, dynamic: boolean, strain: number, reach: number): { prep: number; travel: number; settle: number } {
  if (dynamic) return { prep: 0, travel: 0.45, settle: 0.5 };
  if (limb >= 2) return { prep: 0.18, travel: 0.32 + Math.min(0.2, reach * 0.25), settle: 0.2 };
  return {
    prep: 0.24 + 0.16 * strain,
    travel: 0.38 + Math.min(0.3, reach * 0.4) + 0.2 * strain,
    settle: 0.24 + 0.12 * strain,
  };
}

/**
 * Hip sink through a dyno's wind-up (k 0..1): a shallow pump to find the rhythm, then
 * a deep one, bottoming out at the end so the launch fires from the lowest point.
 */
export function windupSink(k: number): number {
  if (k < 0.4) return 0.45 * Math.sin((Math.PI * k) / 0.4);
  return 0.5 - 0.5 * Math.cos((Math.PI * (k - 0.4)) / 0.6);
}

/**
 * The top-out, in seconds after the match on the finish: hold it, look down at the pad,
 * let go. After landing: absorb in a squat and stand, turn round to face the room, then
 * celebrate (arms up and two claps) or, topped out off the brief, shrug at the route.
 */
export const SEND = { hold: 0.35, release: 0.75, absorb: 0.5, turn: 0.3, turnFor: 0.45, cheer: 0.55, claps: [0.95, 1.2], end: 1.75, shrugEnd: 1.5 };

/**
 * Before the crux, a climber who can hang off a good hold shakes out the hand that is
 * about to move and chalks up: the other hand on a jug-like grip, a foot on to take
 * some weight. Returns the hand to rest, or null if there's no rest to be had there.
 */
export function restBefore(stance: Stance, hand: 0 | 1, holds: Hold[], wall: Wall): 0 | 1 | null {
  const stay = holds[stance.limbs[1 - hand]];
  if (!stay || holds[stance.limbs[hand]] === undefined) return null;
  if (stance.limbs[2] === OFF && stance.limbs[3] === OFF) return null;
  const feet = [2, 3].filter((f) => stance.limbs[f] !== OFF).map((f) => stance.points[f]);
  const below = { u: feet.reduce((s, p) => s + p.u, 0) / feet.length, v: feet.reduce((s, p) => s + p.v, 0) / feet.length };
  return handGrip(stay, below, wall) >= 0.7 ? hand : null;
}

export function buildTimeline(result: SolveResult, day: Day, holds: Hold[]): Timeline {
  const frames: Keyframe[] = [];
  if (result.ok) {
    const crux = Math.max(result.crux, 0.3);
    frames.push({ to: contactsOf(result.start), holds: [...result.start.limbs], limb: -1, duration: PREROLL, strain: 0, move: -1 });
    let rested = false;
    result.moves.forEach((m, i) => {
      const strain = Math.min(1, m.difficulty / crux);
      if (!rested && strain >= 0.98 && m.limb < 2) {
        rested = true;
        const before = i === 0 ? result.start : result.moves[i - 1].to;
        const hand = restBefore(before, m.limb as 0 | 1, holds, day.wall);
        if (hand !== null)
          frames.push({ to: contactsOf(before), holds: [...before.limbs], limb: -1, duration: REST, strain: 0, move: -1, rest: hand });
      }
      // Wind up, move, settle: hard moves are slower and more deliberate, long reaches take
      // longer to travel, dynos fly fast and swing on the catch.
      const a = m.from.points[m.limb];
      const b = m.to.points[m.limb];
      const reach = a && b ? Math.hypot(b.u - a.u, b.v - a.v) / 100 : 0.5;
      const beat = beats(m.limb, m.dynamic, strain, reach);
      // Before a dyno the climber pumps: same holds, eyes on the target, hips sinking.
      if (m.dynamic && m.limb < 2) {
        const before = i === 0 ? result.start : result.moves[i - 1].to;
        frames.push({ to: contactsOf(before), holds: [...before.limbs], limb: -1, duration: WINDUP, strain: 0, move: -1, windup: true });
      }
      frames.push({
        to: contactsOf(m.to),
        holds: [...m.to.limbs],
        limb: m.limb,
        duration: beat.prep + beat.travel + beat.settle,
        prep: beat.prep,
        travel: beat.travel,
        dynamic: m.dynamic,
        strain,
        grade: moveGrade(m.difficulty),
        move: i,
      });
    });
    // A long route mustn't drag: past CLIMB_BUDGET seconds of moves, the easy ones (not the
    // crux, a dyno or the shake-out) quicken together, never below MIN_TEMPO of their pace.
    const moves = frames.filter((f) => f.limb >= 0);
    const easy = moves.filter((f) => f.strain < 0.98 && !f.dynamic);
    const fixed = frames.reduce((s, f) => s + (easy.includes(f) ? 0 : f.limb >= 0 && f.strain >= 0.98 ? f.duration / CRUX_SLOWMO : f.duration), 0);
    const flex = easy.reduce((s, f) => s + f.duration, 0);
    const tempo = flex > 0 ? Math.max(MIN_TEMPO, Math.min(1, (CLIMB_BUDGET - fixed) / flex)) : 1;
    if (tempo < 1)
      for (const f of easy) {
        f.duration *= tempo;
        f.prep! *= tempo;
        f.travel! *= tempo;
      }
    // The top-out (see topOut) sets the real end once the climber lands; this is a backstop.
    const tail = SEND.release + 3.5;
    const send = verdictOf(result, day.targetGrade) !== 'fail';
    return { frames, ending: 'top', send, total: frames.reduce((s, f) => s + f.duration, 0) + tail, tail };
  }
  if (!result.highPoint) return { frames: [], ending: 'shrug', total: 1.6, tail: 1.6 };
  const hp = contactsOf(result.highPoint);
  frames.push({ to: hp, holds: [...result.highPoint.limbs], limb: -1, duration: 0.8, strain: 0.6, move: -1 });
  // Reach hopefully toward the finish... and peel off.
  const lunge: Contacts = {
    hands: [
      hp.hands[0],
      {
        u: hp.hands[1].u + (day.finish.u - hp.hands[1].u) * 0.25,
        v: hp.hands[1].v + Math.min(45, (day.finish.v - hp.hands[1].v) * 0.4),
      },
    ],
    feet: hp.feet,
  };
  frames.push({ to: lunge, holds: [], limb: 1, duration: 0.8, strain: 1, move: -1 });
  const tail = 2.3;
  return { frames, ending: 'fall', total: frames.reduce((s, f) => s + f.duration, 0) + tail, tail };
}
