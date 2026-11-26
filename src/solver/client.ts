import type { SolveRequest } from './worker';
import type { Day, Hold, SolveResult, Volume } from './types';

const SOLVE_TIMEOUT_MS = 15_000;

interface PendingSolve {
  resolve: (r: SolveResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, PendingSolve>();

function resetWorker(reason: string) {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  const err = new Error(reason);
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: SolveResult }>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(e.data.id);
      entry.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      resetWorker(e.message || 'Solver worker crashed');
    };
    worker.onmessageerror = () => {
      resetWorker('Solver worker returned an unreadable message');
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resetWorker('Solver timed out');
    }, SOLVE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage(req);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      resetWorker(err instanceof Error ? err.message : 'Could not start solver');
    }
  });
}

/** Start the worker ahead of the first test, so pressing Test doesn't wait on it loading. */
export function warmSolver() {
  getWorker();
}
