// Live state of a playback, written by the climber simulation at move
// boundaries (never per frame) and read by the HUD, beta overlay and chalk.
import * as THREE from 'three';
import { create } from 'zustand';

export interface ClimbFeed {
  /** Index of the current move in result.moves, -1 before the first. Set as the move winds up. */
  move: number;
  /** Index of the last move whose limb has landed on its hold, -1 before the first. */
  landed: number;
  total: number;
  /**
   * Grade of the last landed move on its own (tips.ts moveGrade), null before the first.
   * Updated when the move lands, not when it starts, so the meter moves once per move.
   */
  grade: number | null;
  /** Hardest move grade so far this climb. */
  peak: number;
  label: string;
  status: 'idle' | 'climbing' | 'topped' | 'fell';
  /** Chalk build-up per hold id. Persists for the session. */
  chalk: Record<string, number>;
  /** Shoe rubber smeared on per hold id, from feet landing on it. Persists for the session. */
  rubber: Record<string, number>;
}

export const useClimb = create<ClimbFeed>(() => ({
  move: -1,
  landed: -1,
  total: 0,
  grade: null,
  peak: 0,
  label: '',
  status: 'idle',
  chalk: {},
  rubber: {},
}));

export function chalkHold(id: string) {
  const c = useClimb.getState().chalk;
  useClimb.setState({ chalk: { ...c, [id]: Math.min(6, (c[id] ?? 0) + 1) } });
}

export function rubberHold(id: string) {
  const c = useClimb.getState().rubber;
  useClimb.setState({ rubber: { ...c, [id]: Math.min(6, (c[id] ?? 0) + 1) } });
}

/** Playback speeds the ticker cycles through. */
export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

function readSpeed(): Speed {
  try {
    const v = Number(localStorage.getItem('topout:speed'));
    // Real time unless you've picked otherwise: watching the climb is the fun part, and
    // moves are timed to read at 1x (see beats in scene/timeline.ts). 2x/4x and Skip stay.
    return (SPEEDS as readonly number[]).includes(v) ? (v as Speed) : 1;
  } catch {
    return 1;
  }
}

/** How fast playbacks run. A viewer preference, remembered across days. */
export const usePlaySpeed = create<{ speed: Speed }>(() => ({ speed: readSpeed() }));

export function cycleSpeed() {
  const cur = usePlaySpeed.getState().speed;
  const speed = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length];
  usePlaySpeed.setState({ speed });
  try {
    localStorage.setItem('topout:speed', String(speed));
  } catch {
    // Not persisted; fine.
  }
}

/**
 * Where the climber's chest is, for the camera to follow. Mutated in place. `hold` is set
 * while a move plays (its wind-up and the limb travelling, or a dyno's pumps): the camera
 * keeps still then and reframes in the settle after it, so it never moves under a move.
 * `free` once the climb is over (topping out, falling), when it follows continuously.
 */
export const climberFocus = { pos: new THREE.Vector3(), active: false, shake: 0, hold: false, free: false };
