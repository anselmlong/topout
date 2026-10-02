import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MAX_TESTS } from '../game/rules';
import { markHelpSeen } from '../state/persist';
import { useGame } from '../state/store';

/**
 * First-visit coach marks: a spotlight walks over the real Start/Finish tape, the tray, the
 * wall and the Test button, one short line each. Every element it points at carries a
 * `data-tour` attribute; a step whose target isn't on screen (a route link hides the tray)
 * is skipped.
 */
interface Step {
  /** `data-tour` target, or 'gap' for the stretch of wall between Start and Finish. */
  at: string;
  title: string;
  body: (o: { touch: boolean; grade: number; practice: boolean }) => ReactNode;
}

const STEPS: Step[] = [
  {
    at: 'brief',
    title: 'You’re the route setter',
    body: ({ grade }) => (
      <>
        Today’s brief: set a problem that climbs at <b>V{grade}</b> on this wall, with as few holds as you can. Par is the
        setter’s hold count.
      </>
    ),
  },
  {
    at: 'start',
    title: 'Start is fixed',
    body: ({ touch }) => <>The climber starts on the taped holds. The tape can’t move; {touch ? 'tap' : 'click'} it to swap the jugs for another hold.</>,
  },
  {
    at: 'finish',
    title: 'So is Finish',
    body: () => <>The climber tops out by matching both hands here. Swap its hold the same way if you like.</>,
  },
  {
    at: 'tray',
    title: 'Pick a hold',
    body: () => <>Today’s hold set. Jugs and L sizes are easy, crimps and S sizes are hard. Each slot shows how many are left.</>,
  },
  {
    at: 'gap',
    title: 'Fill the gap',
    body: ({ touch }) => (
      <>
        {touch ? 'Tap' : 'Click'} the wall to place it between Start and Finish. Turn it ({touch ? '↺ ↻' : 'Q / E'}) so its
        lip faces where the climber pulls from.
      </>
    ),
  },
  {
    at: 'test',
    title: 'Test climb',
    body: ({ practice }) => (
      <>
        The climber finds the easiest way up and grades it.{' '}
        {practice ? 'Practice tests are unlimited.' : `You get ${MAX_TESTS} tests a day; within one grade of the brief passes.`}
      </>
    ),
  },
  {
    at: 'help',
    title: 'That’s it',
    body: () => <>The full rules, the grade guide and this tour live behind the ? button.</>,
  },
];

type Box = { x: number; y: number; w: number; h: number };

function visibleRect(sel: string): Box | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
  if (!el || el.classList.contains('hidden')) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Where a step points, padded. Spot labels sit just off their hold, so they get a wider halo. */
function targetBox(at: string): Box | null {
  if (at === 'gap') {
    const a = visibleRect('start');
    const b = visibleRect('finish');
    if (!a || !b) return null;
    const x = Math.min(a.x, b.x) - 40;
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) + 40 - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  const r = visibleRect(at);
  if (!r) return null;
  const pad = at === 'start' || at === 'finish' ? 26 : 6;
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/** Next step from i in direction d whose target is on screen; -1 if none. */
function findStep(on: boolean[], i: number, d: 1 | -1): number {
  for (let j = i; j >= 0 && j < STEPS.length; j += d) if (on[j]) return j;
  return -1;
}

const onScreen = () => STEPS.map((t) => !!targetBox(t.at));

export function Tour() {
  const open = useGame((s) => s.modal === 'tour');
  const setModal = useGame((s) => s.setModal);
  const grade = useGame((s) => s.day?.targetGrade ?? 0);
  const practice = useGame((s) => s.mode === 'practice');
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  // Which steps have a target right now: the spot labels mount a moment after the tour opens.
  const [on, setOn] = useState<boolean[]>(() => STEPS.map(() => false));
  const [bubble, setBubble] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    if (open) setStep(Math.max(0, findStep(onScreen(), 0, 1)));
  }, [open]);

  // The spot labels follow the camera, so track the target every frame while open.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const b = targetBox(STEPS[step].at);
      setBox((old) =>
        old && b && Math.abs(old.x - b.x) + Math.abs(old.y - b.y) + Math.abs(old.w - b.w) + Math.abs(old.h - b.h) < 0.5
          ? old
          : b,
      );
      const now = onScreen();
      setOn((old) => (old.every((x, i) => x === now[i]) ? old : now));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (el) setBubble({ w: el.offsetWidth, h: el.offsetHeight });
  }, [open, step, box === null]);

  if (!open) return null;
  const close = () => {
    markHelpSeen();
    setModal(null);
  };
  const next = findStep(on, step + 1, 1);
  const prev = findStep(on, step - 1, -1);
  const s = STEPS[step];
  const total = on.filter(Boolean).length;

  // Bubble beside a tall target (the desktop tray), otherwise above or below whichever has room.
  const M = 12;
  let style: CSSProperties;
  if (!box) style = { left: (innerWidth - bubble.w) / 2, top: (innerHeight - bubble.h) / 2 };
  else {
    const clampX = (x: number) => Math.min(Math.max(x, M), innerWidth - bubble.w - M);
    const clampY = (y: number) => Math.min(Math.max(y, M), innerHeight - bubble.h - M);
    const below = innerHeight - (box.y + box.h);
    const above = box.y;
    if (box.h > innerHeight * 0.4 && Math.max(box.x, innerWidth - box.x - box.w) > bubble.w + 2 * M) {
      const left = box.x > innerWidth - box.x - box.w ? box.x - bubble.w - M : box.x + box.w + M;
      style = { left, top: clampY(box.y + box.h / 2 - bubble.h / 2) };
    } else if (below >= bubble.h + M || below >= above) {
      style = { left: clampX(box.x + box.w / 2 - bubble.w / 2), top: clampY(box.y + box.h + M) };
    } else {
      style = { left: clampX(box.x + box.w / 2 - bubble.w / 2), top: clampY(box.y - bubble.h - M) };
    }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Quick tour">
      {box ? (
        <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-bubble" ref={bubbleRef} style={style} aria-live="polite">
        {total > 1 && (
          <div className="eyebrow mono">
            {on.filter((x, i) => x && i <= step).length} / {total}
          </div>
        )}
        <h3>{s.title}</h3>
        <p>{s.body({ touch, grade, practice })}</p>
        <div className="tour-actions">
          <button className="btn ghost" onClick={close}>
            {next < 0 ? 'Close' : 'Skip'}
          </button>
          {prev >= 0 && (
            <button className="btn ghost" onClick={() => setStep(prev)}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={() => (next < 0 ? close() : setStep(next))} autoFocus>
            {next < 0 ? 'Start setting' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
