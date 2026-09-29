import { create } from 'zustand';
import { dayNumber, generateDay } from '../gen/day';
import { MAX_TESTS, bestTest, canPlace, verdictOf, type TestRun } from '../game/rules';
import { parsePractice, practiceDay, practiceParam } from '../game/practice';
import { decodeRoute } from '../game/share';
import { solveInWorker } from '../solver/client';
import type { Day, Hold, HoldSize, HoldType, SolveResult } from '../solver/types';
import { loadDay, recordResult, saveDay } from './persist';

export interface Ghost {
  u: number;
  v: number;
  valid: boolean;
}

export interface Playback {
  result: SolveResult;
  /** Bumped per playback so the climber restarts even for identical results. */
  run: number;
  /** The placed holds this result was solved on (stance indices point into start+finish+these). */
  holds: Hold[];
}

type Phase = 'setting' | 'solving' | 'climbing' | 'review';

/** daily = today's puzzle; archive = replaying a past day; practice = free-set wall. */
export type Mode = 'daily' | 'archive' | 'practice';

interface GameState {
  status: 'loading' | 'ready' | 'error';
  day: Day | null;
  mode: Mode;
  /** localStorage key for this wall's progress. */
  saveKey: string;
  placed: Hold[];
  tests: TestRun[];
  done: boolean;
  phase: Phase;
  /** Viewing someone else's shared route (read-only, doesn't use tests). */
  viewing: Hold[] | null;
  viewingLabel: string;

  armed: { type: HoldType; size: HoldSize } | null;
  selectedId: string | null;
  draggingId: string | null;
  /** A hold is being dragged straight out of the tray (mouse). */
  trayDrag: boolean;
  ghost: Ghost | null;
  ghostRot: number;
  /** Bumped to snap the camera back to the default front view. */
  viewNonce: number;
  /** Placed hold under the mouse: a left-drag here moves it instead of orbiting. */
  hoverHoldId: string | null;
  playback: Playback | null;
  /** Last solved route, shown as a beta overlay until the route is edited. */
  beta: { result: SolveResult; holds: Hold[] } | null;
  lastTest: TestRun | null;
  modal: 'help' | 'result' | 'stats' | 'practice' | null;
  toast: string | null;

  load: () => Promise<void>;
  arm: (slot: { type: HoldType; size: HoldSize } | null) => void;
  hover: (u: number, v: number) => void;
  leave: () => void;
  commit: () => void;
  select: (id: string | null) => void;
  startDrag: (id: string) => void;
  endDrag: () => void;
  rotate: (delta: number) => void;
  remove: (id?: string) => void;
  clear: () => void;
  testClimb: () => Promise<void>;
  watch: () => Promise<void>;
  climbFinished: () => void;
  finish: () => void;
  setModal: (m: GameState['modal']) => void;
  resetView: () => void;
  exitViewing: () => void;
  viewRoute: (holds: Hold[], label: string) => void;
  showToast: (t: string) => void;
}

let nextId = 1;
let playRun = 0;

/** Practice has no test limit. */
export const testLimit = (mode: Mode) => (mode === 'practice' ? Infinity : MAX_TESTS);

export const remaining = (day: Day, placed: Hold[], type: HoldType, size: HoldSize) =>
  (day.tray.find((s) => s.type === type && s.size === size)?.count ?? 0) -
  placed.filter((h) => h.type === type && h.size === size).length;

export const useGame = create<GameState>((set, get) => {
  const persist = () => {
    const { day, placed, tests, done, viewing } = get();
    // Drop the move lists (~15KB/test): only the grade is needed after a reload.
    const slim = tests.map((t) => (t.result.ok ? { ...t, result: { ...t.result, moves: [] } } : t));
    if (day && !viewing) saveDay(get().saveKey, { placed, tests: slim, done });
  };
  const fixed = () => {
    const d = get().day!;
    return [...d.start, d.finish];
  };
  const editable = () => {
    const s = get();
    return s.day && !s.done && !s.viewing && s.phase === 'setting';
  };

  return {
    status: 'loading',
    day: null,
    mode: 'daily',
    saveKey: '',
    placed: [],
    tests: [],
    done: false,
    phase: 'setting',
    viewing: null,
    viewingLabel: '',
    armed: null,
    selectedId: null,
    draggingId: null,
    trayDrag: false,
    ghost: null,
    ghostRot: 0,
    viewNonce: 0,
    hoverHoldId: null,
    playback: null,
    beta: null,
    lastTest: null,
    modal: null,
    toast: null,

    async load() {
      const shared = decodeRoute(location.hash);
      const params = new URLSearchParams(location.search);
      const practice = parsePractice(params.get('practice'));
      const today = dayNumber(new Date());
      let day: Day;
      let mode: Mode;
      let saveKey: string;
      if (practice) {
        day = practiceDay(practice);
        mode = 'practice';
        saveKey = `p:${practiceParam(practice)}`;
      } else {
        // Future days stay hidden in production; the dev server can open any day.
        const asked = Math.max(1, shared?.day ?? (Number(params.get('day')) || today));
        const n = import.meta.env.DEV ? asked : Math.min(today, asked);
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}days/${n}.json`);
          if (!res.ok) throw new Error(String(res.status));
          day = await res.json();
        } catch {
          // Past the curated archive: fall back to an uncurated generated day.
          day = generateDay(n);
        }
        mode = n === today ? 'daily' : 'archive';
        saveKey = String(day.number);
      }
      const save = loadDay(saveKey);
      nextId = 1 + Math.max(0, ...(save?.placed ?? []).map((h) => Number(h.id.replace(/\D/g, '')) || 0));
      set({
        status: 'ready',
        day,
        mode,
        saveKey,
        playback: null,
        beta: null,
        lastTest: null,
        phase: 'setting',
        placed: save?.placed ?? [],
        tests: save?.tests ?? [],
        done: save?.done ?? false,
        viewing: shared && shared.day === day.number ? shared.holds : null,
        viewingLabel: 'Shared route',
      });
    },

    arm(slot) {
      if (!editable() && slot) return;
      set({ armed: slot, selectedId: null, ghost: null, ghostRot: 0 });
    },

    hover(u, v) {
      const s = get();
      if (!editable()) return;
      if (s.draggingId) {
        const h = s.placed.find((p) => p.id === s.draggingId);
        if (!h) return;
        const moved = { ...h, u, v };
        const valid = canPlace(s.day!.wall, [...fixed(), ...s.placed], moved);
        set({ ghost: { u, v, valid } });
        if (valid) set({ placed: s.placed.map((p) => (p.id === h.id ? moved : p)), beta: null });
        return;
      }
      if (!s.armed) return;
      const candidate: Hold = { id: '_ghost', ...s.armed, u, v, rot: s.ghostRot };
      set({ ghost: { u, v, valid: canPlace(s.day!.wall, [...fixed(), ...s.placed], candidate) } });
    },

    leave() {
      if (!get().draggingId) set({ ghost: null });
    },

    commit() {
      const s = get();
      if (!editable() || !s.armed || !s.ghost?.valid) return;
      if (remaining(s.day!, s.placed, s.armed.type, s.armed.size) <= 0) return;
      const hold: Hold = { id: `p${nextId++}`, ...s.armed, u: s.ghost.u, v: s.ghost.v, rot: s.ghostRot };
      const placed = [...s.placed, hold];
      const left = remaining(s.day!, placed, s.armed.type, s.armed.size);
      set({ placed, armed: left > 0 ? s.armed : null, ghost: left > 0 ? s.ghost : null, beta: null });
      persist();
    },

    select(id) {
      if (!editable()) return;
      set({ selectedId: id, armed: id ? null : get().armed });
    },

    startDrag(id) {
      if (!editable()) return;
      set({ draggingId: id, selectedId: id, armed: null });
    },

    endDrag() {
      if (!get().draggingId) return;
      set({ draggingId: null, ghost: null });
      persist();
    },

    rotate(delta) {
      const s = get();
      if (!editable()) return;
      if (s.selectedId) {
        set({ placed: s.placed.map((h) => (h.id === s.selectedId ? { ...h, rot: h.rot + delta } : h)), beta: null });
        persist();
      } else if (s.armed) {
        set({ ghostRot: s.ghostRot + delta });
      }
    },

    remove(id) {
      const s = get();
      if (!editable()) return;
      const target = id ?? s.selectedId;
      if (!target) return;
      // The removed mesh never fires pointer-out, so clear its hover too.
      set({ placed: s.placed.filter((h) => h.id !== target), selectedId: null, hoverHoldId: null, beta: null });
      persist();
    },

    clear() {
      if (!editable()) return;
      set({ placed: [], selectedId: null, hoverHoldId: null, beta: null });
      persist();
    },

    async testClimb() {
      const s = get();
      if (!editable() || s.tests.length >= testLimit(s.mode)) return;
      set({ phase: 'solving', armed: null, selectedId: null, ghost: null });
      const holds = s.placed.map((h) => ({ ...h }));
      const result = await solveInWorker(s.day!, holds);
      if (!result.ok && result.reason === 'too-complex') {
        // Our limitation, not the player's: don't spend a test on it.
        set({ phase: 'setting' });
        get().showToast('Too many holds for the climber to read. Try trimming a few.');
        return;
      }
      const test: TestRun = {
        holds,
        result,
        verdict: verdictOf(result, s.day!.targetGrade),
        holdCount: holds.length,
      };
      set({
        tests: [...get().tests, test],
        lastTest: test,
        phase: 'climbing',
        playback: { result, run: ++playRun, holds },
        beta: { result, holds },
      });
      persist();
    },

    async watch() {
      const s = get();
      if (!s.day || s.phase !== 'setting') return;
      const holds = s.viewing ?? bestTest(s.tests, s.day.targetGrade)?.holds ?? s.placed;
      set({ phase: 'solving' });
      const result = await solveInWorker(s.day, holds);
      set({ phase: 'climbing', lastTest: null, playback: { result, run: ++playRun, holds }, beta: { result, holds } });
    },

    climbFinished() {
      const s = get();
      if (s.phase !== 'climbing') return;
      set({ phase: s.lastTest ? 'review' : 'setting', modal: s.lastTest ? 'result' : null });
    },

    finish() {
      const s = get();
      if (!s.day || s.done || !s.tests.length || s.mode === 'practice') return;
      const best = bestTest(s.tests, s.day.targetGrade)!;
      // Only today's puzzle counts toward stats and streaks; ?day= replays don't.
      if (s.day.number === dayNumber(new Date()))
        recordResult(s.day.number, best.verdict, best.verdict === 'fail' ? null : best.holdCount - s.day.par);
      set({ done: true, phase: 'setting', modal: 'stats', playback: null });
      persist();
    },

    setModal(modal) {
      const s = get();
      // Closing the result card returns to setting.
      set({ modal, phase: s.phase === 'review' && modal === null ? 'setting' : s.phase });
      if (modal === null && s.phase === 'review') set({ playback: null });
    },

    resetView() {
      set({ viewNonce: get().viewNonce + 1 });
    },

    viewRoute(holds, label) {
      set({ viewing: holds, viewingLabel: label, modal: null, playback: null, beta: null, phase: 'setting' });
    },

    exitViewing() {
      history.replaceState(null, '', location.pathname + location.search);
      set({ viewing: null, playback: null, beta: null });
    },

    showToast(t) {
      set({ toast: t });
      setTimeout(() => get().toast === t && set({ toast: null }), 2200);
    },
  };
});
