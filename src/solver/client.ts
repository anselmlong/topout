import type { SolveRequest } from './worker';
import type { Day, Hold, SolveResult, Volume } from './types';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: SolveResult) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: SolveResult }>) => {
      pending.get(e.data.id)?.(e.data.result);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

export function solveInWorker(day: Day, placed: Hold[], volumes: Volume[] = []): Promise<SolveResult> {
  const id = ++seq;
  const req: SolveRequest = {
    id,
    wall: day.wall,
    start: day.start,
    finish: day.finish,
    placed,
    opts: { noSmear: day.twist === 'no-smear', volumes },
  };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage(req);
  });
}
