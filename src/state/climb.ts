// Live state of a playback, written by the climber simulation at move
// boundaries (never per frame) and read by the HUD, beta overlay and chalk.
import * as THREE from 'three';
import { create } from 'zustand';

export interface ClimbFeed {
  /** Index of the current move in result.moves, -1 before the first. */
  move: number;
  total: number;
  /** Difficulty of the current move relative to the crux, 0..1. */
  strain: number;
  label: string;
  status: 'idle' | 'climbing' | 'topped' | 'fell';
  /** Chalk build-up per hold id. Persists for the session. */
  chalk: Record<string, number>;
}

export const useClimb = create<ClimbFeed>(() => ({
  move: -1,
  total: 0,
  strain: 0,
  label: '',
  status: 'idle',
  chalk: {},
}));

export function chalkHold(id: string) {
  const c = useClimb.getState().chalk;
  useClimb.setState({ chalk: { ...c, [id]: Math.min(6, (c[id] ?? 0) + 1) } });
}

/** Where the climber's chest is, for the camera to follow. Mutated in place. */
export const climberFocus = { pos: new THREE.Vector3(), active: false, shake: 0 };
