import { create } from 'zustand';
import { dayNumber, generateDay, withVolumes } from '../gen/day';
import { MAX_TESTS, bestTest, canPlace, canPlaceVolume, verdictOf, type TestRun } from '../game/rules';
import { findExample } from '../game/examples';
import { parsePractice, practiceDay, practiceParam } from '../game/practice';
import { decodeRoute } from '../game/share';
import { defaultSpots, isSpotId, spotsFilled, spotsOf, withSpots, type SpotHold, type Spots } from '../game/spots';
import { solveInWorker } from '../solver/client';
import type { Day, Hold, HoldSize, HoldType, SolveResult, Volume, VolumeShape } from '../solver/types';
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
  /** The placed holds and volumes this was solved on (stance indices point into contactList). */
  holds: Hold[];
  volumes: Volume[];
  /** Start/finish holds it was solved on; undefined = the day's jugs. */
  spots?: Spots;
}

type Phase = 'setting' | 'solving' | 'climbing' | 'review';

/** daily = today's puzzle; archive = replaying a past day; practice = free-set wall. */
export type Mode = 'daily' | 'archive' | 'practice';

/** What's in hand from the tray. `type: 'volume'` carries a shape. */
export interface Armed {
  type: HoldType;
  size: HoldSize;
  shape?: VolumeShape;
}

interface GameState {
  status: 'loading' | 'ready' | 'error';
  day: Day | null;
  mode: Mode;
  /** localStorage key for this wall's progress. */
  saveKey: string;
  placed: Hold[];
  volumes: Volume[];
  /** What's on the taped start/finish spots. Their positions are fixed by the day. */
  spots: Spots;
  tests: TestRun[];
  done: boolean;
  phase: Phase;
  /** Viewing someone else's shared route (read-only, doesn't use tests). */
  viewing: Hold[] | null;
  viewingVolumes: Volume[];
  /** The shared route's spot holds; undefined = the day's jugs. */
  viewingSpots: Spots | undefined;
  viewingLabel: string;

  armed: Armed | null;
  selectedId: string | null;
  draggingId: string | null;
  /** A hold is being dragged straight out of the tray (mouse). */
  trayDrag: boolean;
  ghost: Ghost | null;
  ghostRot: number;
  /** Bumped to snap the camera back to the default front view. */
  viewNonce: number;
  /** Placed hold or volume under the mouse: a left-drag here moves it instead of orbiting. */
  hoverHoldId: string | null;
  playback: Playback | null;
  /** Last solved route, shown as a beta overlay until the route is edited. */
  beta: { result: SolveResult; holds: Hold[]; volumes: Volume[]; spots?: Spots } | null;
  lastTest: TestRun | null;
  modal: 'help' | 'tour' | 'grades' | 'result' | 'stats' | 'practice' | null;
  toast: string | null;
  /** Earlier route states for undo, oldest first; `redoStack` holds undone ones. */
  undoStack: RouteSnapshot[];
  redoStack: RouteSnapshot[];

  load: () => Promise<void>;
  arm: (slot: Armed | null) => void;
  hover: (u: number, v: number) => void;
  leave: () => void;
  commit: () => void;
  select: (id: string | null) => void;
  startDrag: (id: string) => void;
  endDrag: () => void;
  rotate: (delta: number) => void;
  /** Put a hold on a start/finish spot, or change the one there. */
  setSpot: (id: string, hold: Partial<SpotHold>) => void;
  remove: (id?: string) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  testClimb: () => Promise<void>;
  watch: () => Promise<void>;
  climbFinished: () => void;
  /** Cut a playback short and go straight to its result. */
  skipClimb: () => void;
  finish: () => void;
  setModal: (m: GameState['modal']) => void;
  resetView: () => void;
  exitViewing: () => void;
  viewRoute: (holds: Hold[], label: string, volumes?: Volume[], spots?: Spots) => void;
  showToast: (t: string) => void;
}

/** The part of the route that undo restores. */
interface RouteSnapshot {
  placed: Hold[];
  volumes: Volume[];
  spots: Spots;
}

const UNDO_LIMIT = 100;
/** Rotation steps on the same hold within this window undo as one. */
const ROTATE_MERGE_MS = 800;

let nextId = 1;
let lastRotate = { id: '', at: 0 };
/** Route state when the current drag began; pushed to history only if the hold moved. */
let dragStart: RouteSnapshot | null = null;
let playRun = 0;

const isVolumeId = (id: string) => id.startsWith('v');

/** Practice has no test limit. */
export const testLimit = (mode: Mode) => (mode === 'practice' ? Infinity : MAX_TESTS);

/** How many of a tray slot are still unplaced. */
export const remaining = (day: Day, placed: Hold[], volumes: Volume[], slot: Armed) => {
  const total =
    day.tray.find((s) => s.type === slot.type && s.size === slot.size && s.shape === slot.shape)?.count ?? 0;
  const used =
    slot.type === 'volume'
      ? volumes.filter((v) => v.shape === slot.shape && v.size === slot.size).length
      : placed.filter((h) => h.type === slot.type && h.size === slot.size).length;
  return total - used;
};

export const useGame = create<GameState>((set, get) => {
  const persist = () => {
    const { day, placed, volumes, spots, tests, done, viewing } = get();
    // Drop the move lists (~15KB/test): only the grade is needed after a reload.
    const slim = tests.map((t) => (t.result.ok ? { ...t, result: { ...t.result, moves: [] } } : t));
    if (day && !viewing) saveDay(get().saveKey, { placed, volumes, spots, tests: slim, done });
  };
  /** Start/finish holds as set; an empty spot still keeps its default jug's room clear. */
  const fixed = () => {
    const { day, spots } = get();
    return spotsOf(day!).map((h) => (spots[h.id] ? { ...h, ...spots[h.id] } : h));
  };
  const editable = () => {
    const s = get();
    return s.day && !s.done && !s.viewing && s.phase === 'setting';
  };
  /** Any edit to the route invalidates the last beta. */
  const edited = (patch: Partial<GameState>) => set({ ...patch, beta: null });
  const snapshot = (): RouteSnapshot => ({ placed: get().placed, volumes: get().volumes, spots: get().spots });
  /** Record the route as it was before an edit. A fresh edit forgets anything undone. */
  const remember = (snap: RouteSnapshot = snapshot()) => {
    lastRotate = { id: '', at: 0 };
    set({ undoStack: [...get().undoStack, snap].slice(-UNDO_LIMIT), redoStack: [] });
  };
  /** Swap the route for a stored one, pushing the current route onto the other stack. */
  const restore = (from: 'undoStack' | 'redoStack', to: 'undoStack' | 'redoStack') => {
    const s = get();
    if (!editable() || s.draggingId) return;
    const snap = s[from].at(-1);
    if (!snap) return;
    lastRotate = { id: '', at: 0 };
    set({ [from]: s[from].slice(0, -1), [to]: [...s[to], snapshot()] } as Partial<GameState>);
    edited({ ...snap, selectedId: null, hoverHoldId: null, ghost: null });
    persist();
  };

  return {
    status: 'loading',
    day: null,
    mode: 'daily',
    saveKey: '',
    placed: [],
    volumes: [],
    spots: {},
    tests: [],
    done: false,
    phase: 'setting',
    viewing: null,
    viewingVolumes: [],
    viewingSpots: undefined,
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
    undoStack: [],
    redoStack: [],

    async load() {
      const shared = decodeRoute(location.hash);
      const params = new URLSearchParams(location.search);
      const practice = parsePractice(params.get('practice'));
      const example = findExample(params.get('example'));
      const today = dayNumber(new Date());
      let day: Day;
      let mode: Mode;
      let saveKey: string;
      if (practice) {
        day = practiceDay(practice);
        mode = 'practice';
        saveKey = `p:${practiceParam(practice)}`;
      } else if (example) {
        // A gallery example is a practice wall of its own: watch it, then set your own.
        day = example.day;
        mode = 'practice';
        saveKey = `x:${example.id}`;
      } else {
        // Future days stay hidden in production; the dev server can open any day.
        const asked = Math.max(1, shared?.day ?? (Number(params.get('day')) || today));
        const n = import.meta.env.DEV ? asked : Math.min(today, asked);
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}days/${n}.json`);
          if (!res.ok) throw new Error(String(res.status));
          day = withVolumes(await res.json());
        } catch {
          // Past the curated archive: fall back to an uncurated generated day.
          day = generateDay(n);
        }
        mode = n === today ? 'daily' : 'archive';
        saveKey = String(day.number);
      }
      const save = loadDay(saveKey);
      const ids = [...(save?.placed ?? []), ...(save?.volumes ?? [])].map((h) => Number(h.id.replace(/\D/g, '')) || 0);
      nextId = 1 + Math.max(0, ...ids);
      const sharedHere = shared && shared.day === day.number;
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
        volumes: save?.volumes ?? [],
        // A fresh wall starts with the day's own jugs on its spots, so it can be tested
        // straight away; the setter can swap any of them.
        spots: save?.spots ?? defaultSpots(day),
        tests: save?.tests ?? [],
        done: save?.done ?? false,
        viewing: sharedHere ? shared.holds : null,
        viewingVolumes: sharedHere ? shared.volumes : [],
        viewingSpots:
          sharedHere && shared.spots
            ? Object.fromEntries(spotsOf(day).flatMap((h, i) => (shared.spots![i] ? [[h.id, shared.spots![i]]] : [])))
            : undefined,
        viewingLabel: 'Shared route',
        undoStack: [],
        redoStack: [],
      });
      if (example && !shared) {
        get().viewRoute(example.holds, `Example: ${example.title} (V${example.grade})`);
        get().watch();
      }
      // Older "watch an example" links: play a past day's setter route straight away.
      if (params.has('example') && mode === 'archive' && day.reference && !sharedHere) {
        get().viewRoute(day.reference, `Example: a V${day.targetGrade} by the setter`, day.referenceVolumes);
        get().watch();
      }
    },

    arm(slot) {
      if (!editable() && slot) return;
      set({ armed: slot, selectedId: null, ghost: null, ghostRot: 0 });
    },

    hover(u, v) {
      const s = get();
      if (!editable()) return;
      const wall = s.day!.wall;
      if (s.draggingId) {
        if (isVolumeId(s.draggingId)) {
          const vol = s.volumes.find((p) => p.id === s.draggingId);
          if (!vol) return;
          const moved = { ...vol, u, v };
          const valid = canPlaceVolume(wall, s.volumes, fixed(), moved);
          set({ ghost: { u, v, valid } });
          if (valid) edited({ volumes: s.volumes.map((p) => (p.id === vol.id ? moved : p)) });
          return;
        }
        const h = s.placed.find((p) => p.id === s.draggingId);
        if (!h) return;
        const moved = { ...h, u, v };
        const valid = canPlace(wall, [...fixed(), ...s.placed], moved);
        set({ ghost: { u, v, valid } });
        if (valid) edited({ placed: s.placed.map((p) => (p.id === h.id ? moved : p)) });
        return;
      }
      if (!s.armed) return;
      if (s.armed.type === 'volume') {
        const vol: Volume = { id: '_ghost', shape: s.armed.shape!, size: s.armed.size === 'l' ? 'l' : 's', u, v, rot: s.ghostRot };
        set({ ghost: { u, v, valid: canPlaceVolume(wall, s.volumes, fixed(), vol) } });
        return;
      }
      const candidate: Hold = { id: '_ghost', type: s.armed.type, size: s.armed.size, u, v, rot: s.ghostRot };
      set({ ghost: { u, v, valid: canPlace(wall, [...fixed(), ...s.placed], candidate) } });
    },

    leave() {
      if (!get().draggingId) set({ ghost: null });
    },

    commit() {
      const s = get();
      if (!editable() || !s.armed || !s.ghost?.valid) return;
      if (remaining(s.day!, s.placed, s.volumes, s.armed) <= 0) return;
      const { u, v } = s.ghost;
      let placed = s.placed;
      let volumes = s.volumes;
      if (s.armed.type === 'volume') {
        const size = s.armed.size === 'l' ? 'l' : 's';
        volumes = [...volumes, { id: `v${nextId++}`, shape: s.armed.shape!, size, u, v, rot: s.ghostRot }];
      } else {
        placed = [...placed, { id: `p${nextId++}`, type: s.armed.type, size: s.armed.size, u, v, rot: s.ghostRot }];
      }
      const left = remaining(s.day!, placed, volumes, s.armed);
      remember();
      edited({ placed, volumes, armed: left > 0 ? s.armed : null, ghost: left > 0 ? s.ghost : null });
      persist();
    },

    select(id) {
      if (!editable()) return;
      set({ selectedId: id, armed: id ? null : get().armed });
    },

    startDrag(id) {
      if (!editable() || isSpotId(get().day!, id)) return;
      dragStart = snapshot();
      set({ draggingId: id, selectedId: id, armed: null });
    },

    endDrag() {
      if (!get().draggingId) return;
      const before = dragStart;
      dragStart = null;
      // A click that selects without moving isn't an edit.
      if (before && (before.placed !== get().placed || before.volumes !== get().volumes)) remember(before);
      set({ draggingId: null, ghost: null });
      persist();
    },

    rotate(delta) {
      const s = get();
      if (!editable()) return;
      // Held item first, then the selected one, then whatever the mouse is over.
      const target = s.armed ? null : (s.selectedId ?? s.hoverHoldId);
      if (target) {
        // Q-Q-Q or a wheel flick on one hold is a single undo step.
        const now = performance.now();
        if (lastRotate.id !== target || now - lastRotate.at > ROTATE_MERGE_MS) remember();
        lastRotate = { id: target, at: now };
      }
      if (target && isSpotId(s.day!, target)) {
        // Turning a hold in place never changes the room it takes.
        const h = s.spots[target];
        if (h) edited({ spots: { ...s.spots, [target]: { ...h, rot: h.rot + delta } } });
        persist();
      } else if (target && isVolumeId(target)) {
        edited({ volumes: s.volumes.map((v) => (v.id === target ? { ...v, rot: v.rot + delta } : v)) });
        persist();
      } else if (target) {
        edited({ placed: s.placed.map((h) => (h.id === target ? { ...h, rot: h.rot + delta } : h)) });
        persist();
      } else if (s.armed) {
        set({ ghostRot: s.ghostRot + delta });
      }
    },

    setSpot(id, hold) {
      const s = get();
      if (!editable() || !isSpotId(s.day!, id)) return;
      const spot = spotsOf(s.day!).find((h) => h.id === id)!;
      // A new spot hold takes the default's type, size and rotation unless told otherwise.
      const next = { ...spot, ...s.spots[id], ...hold };
      const others = fixed().filter((h) => h.id !== id);
      const roomy =
        canPlace(s.day!.wall, [...others, ...s.placed], next) &&
        s.volumes.every((v) => canPlaceVolume(s.day!.wall, [], [next], v));
      if (!roomy) return get().showToast('No room for that hold here.');
      remember();
      edited({ spots: { ...s.spots, [id]: { type: next.type, size: next.size, rot: next.rot } } });
      persist();
    },

    remove(id) {
      const s = get();
      if (!editable()) return;
      const target = id ?? s.selectedId;
      if (!target) return;
      const spot = isSpotId(s.day!, target);
      if (spot && !s.spots[target]) return;
      remember();
      if (spot) {
        const { [target]: _, ...spots } = s.spots;
        edited({ spots });
        persist();
        return;
      }
      // The removed mesh never fires pointer-out, so clear its hover too.
      edited({
        placed: s.placed.filter((h) => h.id !== target),
        volumes: s.volumes.filter((v) => v.id !== target),
        selectedId: null,
        hoverHoldId: null,
      });
      persist();
    },

    clear() {
      if (!editable() || (!get().placed.length && !get().volumes.length)) return;
      remember();
      edited({ placed: [], volumes: [], selectedId: null, hoverHoldId: null });
      persist();
    },

    undo() {
      restore('undoStack', 'redoStack');
    },

    redo() {
      restore('redoStack', 'undoStack');
    },

    async testClimb() {
      const s = get();
      if (!editable() || s.tests.length >= testLimit(s.mode)) return;
      if (!spotsFilled(s.day!, s.spots)) {
        // Point at the first empty spot rather than spending a test.
        const empty = spotsOf(s.day!).find((h) => !s.spots[h.id])!;
        set({ selectedId: empty.id, armed: null, ghost: null });
        get().showToast('Put a hold on every taped start and finish spot first.');
        return;
      }
      set({ phase: 'solving', armed: null, selectedId: null, ghost: null, hoverHoldId: null });
      const holds = s.placed.map((h) => ({ ...h }));
      const volumes = s.volumes.map((v) => ({ ...v }));
      const spots = { ...s.spots };
      const result = await solveInWorker(withSpots(s.day!, spots), holds, volumes);
      if (!result.ok && result.reason === 'too-complex') {
        // Our limitation, not the player's: don't spend a test on it.
        set({ phase: 'setting' });
        get().showToast('Too many holds for the climber to read. Try trimming a few.');
        return;
      }
      const test: TestRun = {
        holds,
        volumes,
        spots,
        result,
        verdict: verdictOf(result, s.day!.targetGrade),
        // Each volume counts as one hold.
        holdCount: holds.length + volumes.length,
      };
      set({
        tests: [...get().tests, test],
        lastTest: test,
        phase: 'climbing',
        playback: { result, run: ++playRun, holds, volumes, spots },
        beta: { result, holds, volumes, spots },
      });
      persist();
    },

    async watch() {
      const s = get();
      if (!s.day || s.phase !== 'setting') return;
      const best = bestTest(s.tests, s.day.targetGrade);
      const holds = s.viewing ?? best?.holds ?? s.placed;
      const volumes = s.viewing ? s.viewingVolumes : (best?.volumes ?? s.volumes);
      // Tests from before spots were settable ran on the day's jugs (spots undefined).
      const spots = s.viewing ? s.viewingSpots : best ? best.spots : s.spots;
      if (spots && !spotsFilled(s.day, spots)) return get().showToast('Put a hold on every taped spot first.');
      set({ phase: 'solving' });
      const result = await solveInWorker(withSpots(s.day, spots), holds, volumes);
      set({
        phase: 'climbing',
        lastTest: null,
        playback: { result, run: ++playRun, holds, volumes, spots },
        beta: { result, holds, volumes, spots },
      });
    },

    climbFinished() {
      const s = get();
      if (s.phase !== 'climbing') return;
      set({ phase: s.lastTest ? 'review' : 'setting', modal: s.lastTest ? 'result' : null });
    },

    skipClimb() {
      if (get().phase !== 'climbing') return;
      get().climbFinished();
      // The climber steps back onto the pad; the beta overlay still shows the route.
      set({ playback: null });
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

    viewRoute(holds, label, volumes = [], spots) {
      set({
        viewing: holds,
        viewingVolumes: volumes,
        viewingSpots: spots,
        viewingLabel: label,
        modal: null,
        playback: null,
        beta: null,
        phase: 'setting',
      });
    },

    exitViewing() {
      history.replaceState(null, '', location.pathname + location.search);
      set({ viewing: null, viewingVolumes: [], viewingSpots: undefined, playback: null, beta: null });
    },

    showToast(t) {
      set({ toast: t });
      setTimeout(() => get().toast === t && set({ toast: null }), 2200);
    },
  };
});

// Dev-only handle for headless tests.
if (import.meta.env.DEV) (globalThis as unknown as { __game: typeof useGame }).__game = useGame;
