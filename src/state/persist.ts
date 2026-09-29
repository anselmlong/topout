// localStorage wrappers. Storage can be missing or throw (private mode, blocked
// site data), so every access is guarded and the game works without it.
import type { TestRun } from '../game/rules';
import type { Hold } from '../solver/types';

export interface DaySave {
  placed: Hold[];
  tests: TestRun[];
  done: boolean;
}

export interface Stats {
  played: number;
  exact: number;
  passed: number;
  streak: number;
  maxStreak: number;
  lastDay: number;
  /** Holds-over-par of each passed day, for the distribution chart. */
  overPar: number[];
}

const EMPTY_STATS: Stats = { played: 0, exact: 0, passed: 0, streak: 0, maxStreak: 0, lastDay: 0, overPar: [] };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable; progress just won't survive a reload.
  }
}

export const loadDay = (key: string) => read<DaySave>(`topout:day:${key}`);
export const saveDay = (key: string, save: DaySave) => write(`topout:day:${key}`, save);
export const loadStats = () => ({ ...EMPTY_STATS, ...read<Stats>('topout:stats') });
export const saveStats = (s: Stats) => write('topout:stats', s);
export const seenHelp = () => read<boolean>('topout:help') === true;
export const markHelpSeen = () => write('topout:help', true);

/** Record a finished day. Passing keeps the streak; failing or skipping a day resets it. */
export function recordResult(day: number, verdict: 'exact' | 'pass' | 'fail', overPar: number | null): Stats {
  const s = loadStats();
  if (s.lastDay >= day) return s;
  s.played++;
  if (verdict === 'fail') s.streak = 0;
  else {
    s.passed++;
    if (verdict === 'exact') s.exact++;
    s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    if (overPar !== null) s.overPar.push(overPar);
  }
  s.lastDay = day;
  saveStats(s);
  return s;
}
