// Live state of a playback, written by the climber simulation at move
// boundaries (never per frame) and read by the HUD, beta overlay and chalk.
import * as THREE from 'three';
import { create } from 'zustand';

export interface ClimbFeed {
  /** Index of the current move in result.moves, -1 before the first. */
  move: number;
  total: number;
  /** Grade of the current move on its own (tips.ts moveGrade), null between moves. */
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
    // A daily puzzle shouldn't make you wait: double speed unless you've picked otherwise.
    return (SPEEDS as readonly number[]).includes(v) ? (v as Speed) : 2;
  } catch {
    return 2;
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

/** Where the climber's chest is, for the camera to follow. Mutated in place. */
export const climberFocus = { pos: new THREE.Vector3(), active: false, shake: 0 };
