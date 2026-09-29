/// <reference lib="webworker" />
import { solve } from './solve';
import type { Hold, SolveOptions, Wall } from './types';

export interface SolveRequest {
  id: number;
  wall: Wall;
  start: Hold[];
  finish: Hold;
  placed: Hold[];
  opts: SolveOptions;
}

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, wall, start, finish, placed, opts } = e.data;
  const result = solve(wall, start, finish, placed, opts);
  self.postMessage({ id, result });
};
