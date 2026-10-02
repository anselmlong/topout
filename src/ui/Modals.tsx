import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { MAX_TESTS, bestTest, holds as nHolds, type TestRun } from '../game/rules';
import { ALL_STYLES, ANGLE_RANGE, STYLE_LABEL, TWIST_LABEL, dateOf, dayNumber, type WallStyle } from '../gen/day';
import { parsePractice, practiceParam, randomSeed, type PracticeConfig } from '../game/practice';
import { encodeRoute, shareText } from '../game/share';
import { spotsOf, withSpots } from '../game/spots';
import { gapLabel, setterTip } from '../game/tips';
import { HOLD_HINT, HOLD_NAME } from '../scene/palette';
import type { Day, HoldType, Twist } from '../solver/types';
import { contactList } from '../solver/volumes';
import { loadDay, loadStats, markHelpSeen } from '../state/persist';
import { useGame } from '../state/store';
import { HoldIcon } from './Hud';

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

const TYPES: HoldType[] = ['jug', 'edge', 'crimp', 'sloper', 'pinch', 'pocket', 'foot', 'jib', 'volume'];

export function HelpModal() {
  const open = useGame((s) => s.modal === 'help');
  const setModal = useGame((s) => s.setModal);
  const close = () => {
    markHelpSeen();
    setModal(null);
  };
  // A past day's setter route, climbed: the quickest way to see what the game is.
  const yesterday = dayNumber(new Date()) - 1;
  return (
    <Modal open={open} onClose={close} title="How to play">
      <div className="eyebrow">How to play</div>
      <h2>You’re the route setter. Set today’s problem at the target grade, using as few holds as you can.</h2>
      <ol className="steps">
        <li>
          <b>Start</b> and <b>Finish</b> are taped on the wall and can’t move. They come with jugs; tap one if you want to swap
          its hold.
        </li>
        <li>
          <b>Fill the gap.</b> Pick a hold from the tray, then tap the wall to place it. Turn it so its lip faces where the
          climber pulls from (the little arrow).
        </li>
        <li>
          <b>Test climb.</b> Our climber finds the easiest way up and grades it. You get {MAX_TESTS} tests a day.
        </li>
        <li>
          Within one grade of the target passes 🟨, dead on is 🟩. Beat par (the setter’s hold count) for bragging rights.
        </li>
      </ol>
      <div className="example">
        <div className="eyebrow">Example</div>
        <p>
          <b>“Set a V2” on a vertical wall.</b> Medium edges about half a metre apart, zig-zagging up between Start and
          Finish, with foot chips stepping up underneath them. Graded V3? Swap a couple of edges for jugs or
          close the gaps. Graded V1? Spread them out or use crimps.
        </p>
        <div className="row">
          {yesterday >= 1 && (
            <a className="btn ghost" href={`?day=${yesterday}&example`} onClick={markHelpSeen}>
              Watch an example climb
            </a>
          )}
          <button className="btn ghost" onClick={() => setModal('grades')}>
            Grade guide
          </button>
          <button className="btn ghost" onClick={() => setModal('tour')}>
            Show me around
          </button>
        </div>
      </div>
      <details className="more">
        <summary>The holds</summary>
        <ul className="legend">
          {TYPES.map((t) => (
            <li key={t}>
              <HoldIcon type={t} />
              <div>
                <b>{HOLD_NAME[t]}</b>
                <span>{HOLD_HINT[t]}</span>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <details className="more">
        <summary>Controls and details</summary>
        <p className="fine">
          Drag to orbit, two fingers (or right-drag) to pan and zoom. While you place a handhold, an arc shows how far the
          climber reaches from the nearest handhold below: inside the solid line is a static move, out to the dashed line only
          a dyno. Undo and redo sit in the bar at the bottom.
        </p>
        <p className="fine">
          Every day brings a new wall: slabs, overhangs, headwalls, caves with a lip to pull, ledges to mantle onto, corners you
          can stem (some of them overhanging), and arêtes and overhanging prows whose edge is itself a hold. After a test,
          numbered tags show the climber’s beta, coloured by how hard each move was. On steep walls they’ll heel hook big holds
          out to the side, and toe hook a hold far out whose lip faces away from them. Hands follow the hold too: a lip facing
          sideways is a sidepull, one facing away from the body a gaston, and one facing down an undercling. The climber is 175
          cm, every day.
        </p>
      </details>
      <div className="sticky-cta">
        <button className="btn primary wide" onClick={close}>
          Start setting
        </button>
      </div>
    </Modal>
  );
}

/** What each V-grade looks like in Topout, from the solver's calibration problems. */
const GRADE_GUIDE: { g: string; text: string }[] = [
  { g: 'V0', text: 'Jugs close together on a vertical wall or a slab, good feet all the way.' },
  { g: 'V1–2', text: 'Edges on a vertical wall, or jugs on a gentle (20°) overhang.' },
  { g: 'V3', text: 'Crimps on a vertical wall, or small holds and smears on a slab.' },
  { g: 'V4', text: 'Edges on a 20° overhang, jugs on a steep 40° wall, or a jump between jugs.' },
  { g: 'V5–6', text: 'Pinches and gastons, or edges on a 40° wall.' },
  { g: 'V7–8', text: 'Crimps and slopers on a 40° board, far apart, poor feet.' },
];

export function GradesModal() {
  const open = useGame((s) => s.modal === 'grades');
  const setModal = useGame((s) => s.setModal);
  const target = useGame((s) => s.day?.targetGrade);
  return (
    <Modal open={open} onClose={() => setModal(null)} title="Grade guide">
      <div className="eyebrow">Grade guide</div>
      <h2>V-grades run from V0 (anyone can climb it) up through V8 and beyond.</h2>
      <ul className="grade-guide">
        {GRADE_GUIDE.map((r) => {
          const [lo, hi] = r.g.slice(1).split('–').map(Number);
          const here = target !== undefined && target >= lo && target <= (hi ?? lo);
          return (
            <li key={r.g} className={here ? 'here' : undefined}>
              <b className="mono">{r.g}</b>
              <span>
                {r.text}
                {here && <em> Today’s target.</em>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="levers">
        <div>
          <div className="eyebrow">Harder</div>
          <ul>
            <li>Smaller holds (crimps, S sizes)</li>
            <li>Holds further apart</li>
            <li>Steeper sections</li>
            <li>Fewer or worse footholds</li>
            <li>Holds turned off-axis</li>
          </ul>
        </div>
        <div>
          <div className="eyebrow">Easier</div>
          <ul>
            <li>Jugs and L sizes</li>
            <li>Holds closer together</li>
            <li>A foothold under each move</li>
            <li>A big rest hold before the crux</li>
            <li>Lips facing the pull</li>
          </ul>
        </div>
      </div>
      <p className="fine">
        The grade comes mostly from the hardest move (the crux), plus a little for long runs of hard moves without a rest. A
        test passes within one grade of the target.
      </p>
      <button className="btn primary wide" onClick={() => setModal(null)}>
        Got it
      </button>
    </Modal>
  );
}

const LIMB = ['Left hand', 'Right hand', 'Left foot', 'Right foot'];

function cruxLine(day: Day, test: TestRun) {
  if (!test.result.ok) return null;
  const moves = test.result.moves;
  const crux = moves.reduce((a, b) => (b.difficulty > a.difficulty ? b : a), moves[0]);
  if (!crux) return null;
  const tape = withSpots(day, test.spots);
  const holds = contactList(tape.start, tape.finish, test.holds, test.volumes, day.wall);
  const idx = crux.to.limbs[crux.limb];
  const h = idx >= 0 ? holds[idx] : undefined;
  const target = !h ? 'a smear' : h.id.startsWith('arete:') ? 'the arête' : h.id.startsWith('lip:') ? 'the lip' : h.type === 'volume' ? 'the volume' : HOLD_NAME[h.type].toLowerCase();
  return `${LIMB[crux.limb]} to ${target}${crux.dynamic ? ' (dyno)' : ''} · ${moves.length} moves`;
}

const VERDICT_TEXT = { exact: 'Dead on', pass: 'Within a grade', fail: 'Off target' } as const;

/**
 * Where each test landed on the V-scale, against the brief's bands: the exact
 * band (rounds to the target) and the pass band (rounds to within one). The
 * newest test slides in from the previous one, so you can see which way the
 * last change moved the grade.
 */
function GradeScale({ tests, target }: { tests: TestRun[]; target: number }) {
  const SPAN = 6;
  const lo = Math.max(0, target - SPAN / 2);
  const hi = lo + SPAN;
  const pct = (g: number) => ((Math.min(hi, Math.max(lo, g)) - lo) / SPAN) * 100;
  const sent = tests.map((t, i) => ({ t, n: i + 1 })).filter(({ t }) => t.result.ok);
  const last = tests[tests.length - 1];
  const prev = sent.filter(({ t }) => t !== last).pop();
  const ticks = Array.from({ length: SPAN + 1 }, (_, i) => lo + i);
  return (
    <div className="grade-scale" aria-hidden="true">
      <div className="track">
        <span className="band pass" style={{ left: `${pct(target - 1.5)}%`, width: `${pct(target + 1.5) - pct(target - 1.5)}%` }} />
        <span className="band exact" style={{ left: `${pct(target - 0.5)}%`, width: `${pct(target + 0.5) - pct(target - 0.5)}%` }} />
        {sent.map(({ t, n }) => {
          const g = (t.result as { grade: number }).grade;
          const current = t === last;
          const off = g < lo ? ' below' : g > hi ? ' above' : '';
          return (
            <span
              key={n}
              className={`mark ${t.verdict}${current ? ' current' : ''}${off}`}
              style={
                {
                  left: `${pct(g)}%`,
                  '--from': `${pct(prev ? (prev.t.result as { grade: number }).grade : target)}%`,
                } as CSSProperties
              }
            >
              <span className="mono">{n}</span>
            </span>
          );
        })}
      </div>
      <div className="ticks mono">
        {ticks.map((g) => (
          <span key={g} className={g === target ? 'target' : undefined} style={{ left: `${pct(g)}%` }}>
            V{g}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResultModal() {
  const s = useGame();
  const test = s.lastTest;
  const day = s.day;
  if (!day || !test) return null;
  const open = s.modal === 'result';
  const practice = s.mode === 'practice';
  const out = !practice && s.tests.length >= MAX_TESTS;
  const close = () => s.setModal(null);
  const r = test.result;
  const tip = setterTip(day, test);
  return (
    <Modal open={open} onClose={close} title="Test result">
      <div className="eyebrow">{practice ? `Practice test ${s.tests.length}` : `Test ${s.tests.length} of ${MAX_TESTS}`}</div>
      <div className={`verdict ${test.verdict}`}>
        <span className="big mono">{r.ok ? `V${r.grade.toFixed(1)}` : 'No send'}</span>
        <span className="tag">{r.ok ? VERDICT_TEXT[test.verdict] : 'Unclimbable'}</span>
      </div>
      <p className="lede">
        {r.ok
          ? `Target V${day.targetGrade}${test.verdict === 'exact' ? '' : `, ${gapLabel(r.grade - day.targetGrade)}`}. ${nHolds(test.holdCount)}${day.par > 0 ? `, par ${day.par}` : ''}.`
          : r.message}
      </p>
      {s.tests.some((t) => t.result.ok) && <GradeScale tests={practice ? s.tests.slice(-MAX_TESTS) : s.tests} target={day.targetGrade} />}
      {r.ok && <p className="fine">Crux: {cruxLine(day, test)}</p>}
      {tip && <p className="tip">{tip}</p>}
      <div className="row">
        {practice ? (
          <button className="btn primary wide" onClick={close}>
            Keep setting
          </button>
        ) : out ? (
          <button className="btn primary wide" onClick={() => s.finish()}>
            See summary
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={() => s.finish()}>
              Lock it in
            </button>
            <button className="btn primary" onClick={close}>
              Keep setting
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function useCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const ms = next.getTime() - now.getTime();
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  const sec = Math.floor((ms % 6e4) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function StatsModal() {
  const s = useGame();
  const open = s.modal === 'stats';
  const countdown = useCountdown();
  if (!open || !s.day) return null;
  const day = s.day;
  const stats = loadStats();
  const best = bestTest(s.tests, day.targetGrade);
  const text = s.tests.length ? shareText(day, s.tests) : '';

  const copy = async (value: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(value);
      s.showToast(msg);
    } catch {
      s.showToast('Couldn’t reach the clipboard');
    }
  };
  const link = best ? `${location.origin}${location.pathname}#${encodeRoute(day.number, best.holds, best.volumes, best.spots && spotsOf(withSpots(day, best.spots)))}` : '';

  const buckets = [-2, -1, 0, 1, 2, 3];
  const counts = buckets.map((b) =>
    stats.overPar.filter((x) => (b === -2 ? x <= -2 : b === 3 ? x >= 3 : x === b)).length,
  );
  const max = Math.max(1, ...counts);

  return (
    <Modal open={open} onClose={() => s.setModal(null)} title="Results">
      <div className="eyebrow">Topout #{day.number}</div>
      {text && <pre className="share mono">{text}</pre>}
      <div className="row">
        <button className="btn primary" onClick={() => copy(text, 'Result copied')}>
          Copy result
        </button>
        {best && (
          <button className="btn ghost" onClick={() => copy(link, 'Route link copied')}>
            Copy route link
          </button>
        )}
      </div>

      <div className="stats">
        <div>
          <b className="mono">{stats.played}</b>
          <span>Played</span>
        </div>
        <div>
          <b className="mono">{stats.played ? Math.round((stats.passed / stats.played) * 100) : 0}%</b>
          <span>Sent</span>
        </div>
        <div>
          <b className="mono">{stats.streak}</b>
          <span>Streak</span>
        </div>
        <div>
          <b className="mono">{stats.maxStreak}</b>
          <span>Best</span>
        </div>
      </div>

      <div className="eyebrow">Holds vs par</div>
      <ul className="dist">
        {buckets.map((b, i) => (
          <li key={b}>
            <span className="mono">{b === -2 ? '≤−2' : b === 3 ? '+3' : b > 0 ? `+${b}` : b === 0 ? 'par' : `−${-b}`}</span>
            <span className={`bar ${counts[i] ? '' : 'empty'}`} style={{ width: `${(counts[i] / max) * 100}%` }}>
              {counts[i] || ''}
            </span>
          </li>
        ))}
      </ul>

      {day.reference && (
        <button className="btn ghost wide" onClick={() => s.viewRoute(day.reference!, 'Setter’s route', day.referenceVolumes)}>
          Show the setter’s par route
        </button>
      )}
      <p className="fine center">
        Next problem in <span className="mono">{countdown}</span>
      </p>
    </Modal>
  );
}

const GRADES = Array.from({ length: 11 }, (_, i) => i);
const TWIST_OPTIONS: { value: Twist | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'no-jugs', label: TWIST_LABEL['no-jugs'] },
  { value: 'traverse', label: TWIST_LABEL.traverse },
  { value: 'no-smear', label: TWIST_LABEL['no-smear'] },
];

function defaultConfig(): PracticeConfig {
  return parsePractice(new URLSearchParams(location.search).get('practice')) ?? {
    style: 'overhang',
    angle: 20,
    grade: 4,
    twist: null,
    seed: 0,
  };
}

export function PracticeModal() {
  const open = useGame((s) => s.modal === 'practice');
  const setModal = useGame((s) => s.setModal);
  const [c, setC] = useState(defaultConfig);
  if (!open) return null;

  const [lo, hi] = ANGLE_RANGE[c.style];
  const pickStyle = (style: WallStyle) => {
    const [a, b] = ANGLE_RANGE[style];
    setC({ ...c, style, angle: Math.round((a + b) / 2) });
  };
  const build = () => {
    location.search = `?practice=${practiceParam({ ...c, seed: randomSeed() })}`;
  };

  const today = dayNumber(new Date());
  const past = Array.from({ length: Math.min(60, today - 1) }, (_, i) => today - 1 - i);

  return (
    <Modal open={open} onClose={() => setModal(null)} title="Practice">
      <div className="eyebrow">Practice</div>
      <h2>Build any wall and set on it. Unlimited tests, no stats.</h2>

      <div className="field">
        <span className="field-label">Wall</span>
        <div className="chips">
          {ALL_STYLES.map((st) => (
            <button key={st} className={`chip ${c.style === st ? 'on' : ''}`} onClick={() => pickStyle(st)}>
              {STYLE_LABEL[st]}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">
          {c.style === 'headwall' || c.style === 'kicker' ? 'Top panel angle' : 'Angle'}
          <span className="mono">
            {c.angle > 0 ? '+' : ''}
            {c.angle}°
          </span>
        </span>
        <input
          type="range"
          min={lo}
          max={hi}
          value={c.angle}
          onChange={(e) => setC({ ...c, angle: Number(e.target.value) })}
        />
      </label>

      <div className="field">
        <span className="field-label">Target grade</span>
        <div className="chips grades">
          {GRADES.map((g) => (
            <button key={g} className={`chip mono ${c.grade === g ? 'on' : ''}`} onClick={() => setC({ ...c, grade: g })}>
              V{g}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Twist</span>
        <div className="chips">
          {TWIST_OPTIONS.map((t) => (
            <button key={t.label} className={`chip ${c.twist === t.value ? 'on' : ''}`} onClick={() => setC({ ...c, twist: t.value })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn primary wide" onClick={build}>
        Build a new wall
      </button>
      <p className="fine center">Practice walls aren’t curated, so very hard grades on easy walls may be impossible.</p>

      {past.length > 0 && (
        <>
          <div className="eyebrow past-head">Past days</div>
          <ul className="past">
            {past.map((n) => {
              const save = loadDay(String(n));
              const status = save?.done ? 'Done' : save?.placed.length ? 'In progress' : '';
              return (
                <li key={n}>
                  <a href={`?day=${n}`}>
                    <span className="mono">#{n}</span>
                    <span>{new Date(dateOf(n) + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="dim">{status}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
