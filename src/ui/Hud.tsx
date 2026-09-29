import { useRef } from 'react';
import { STYLE_LABEL, TWIST_LABEL, wallStyleOf } from '../gen/day';
import { MAX_TESTS, SQUARE, holds as nHolds } from '../game/rules';
import { HOLD_COLOR, HOLD_HINT, HOLD_NAME } from '../scene/palette';
import type { HoldSize, HoldType } from '../solver/types';
import { remaining, useGame } from '../state/store';

const SIZE_LABEL: Record<HoldSize, string> = { s: 'S', m: 'M', l: 'L' };

export function HoldIcon({ type, size = 'm' }: { type: HoldType; size?: HoldSize }) {
  const s = size === 's' ? 0.8 : size === 'l' ? 1.15 : 1;
  const paths: Record<HoldType, string> = {
    jug: 'M4 14c0-5 4-9 8-9s8 4 8 9c-2-2-5-3-8-3s-6 1-8 3z',
    crimp: 'M3 13h18l-2 3H5z',
    sloper: 'M3 17c1-7 5-11 9-11s8 4 9 11z',
    pinch: 'M10 4h4l1 16h-6z',
    pocket: 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0zm4.5-1.5a2.5 2 0 1 0 5 0a2.5 2 0 1 0-5 0z',
    foot: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z',
  };
  return (
    <svg className="hold-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`translate(12 12) scale(${s}) translate(-12 -12)`}>
        <path d={paths[type]} fill={HOLD_COLOR[type]} fillRule="evenodd" stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      </g>
    </svg>
  );
}

function formatDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function TopBar() {
  const day = useGame((s) => s.day)!;
  const setModal = useGame((s) => s.setModal);
  const lookAround = useGame((s) => s.lookAround);
  const setLookAround = useGame((s) => s.setLookAround);
  const done = useGame((s) => s.done);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Topout</span>
        <span className="meta mono">
          #{day.number} · {formatDate(day.date)}
        </span>
      </div>
      <nav className="topbar-actions">
        <button
          className={`icon-btn ${lookAround ? 'on' : ''}`}
          onClick={() => setLookAround(!lookAround)}
          aria-pressed={lookAround}
          title="Look around (orbit the wall)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
          </svg>
          <span className="label">{lookAround ? 'Done' : 'Look'}</span>
        </button>
        <button className="icon-btn" onClick={() => setModal('help')} title="How to play">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 16h-2v-2h2zm2.1-7.8-.9.9c-.7.7-1.2 1.3-1.2 2.9h-2v-.5c0-1.1.5-2.1 1.2-2.8l1.2-1.3a2 2 0 1 0-3.4-1.4H8a4 4 0 1 1 7.1 2.2z" />
          </svg>
          <span className="label">Help</span>
        </button>
        {done && (
          <button className="icon-btn" onClick={() => setModal('stats')} title="Results">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h3V10H4zm6.5 0h3V4h-3zM17 20h3v-7h-3z" />
            </svg>
            <span className="label">Results</span>
          </button>
        )}
      </nav>
    </header>
  );
}

export function Brief() {
  const day = useGame((s) => s.day)!;
  const style = wallStyleOf(day.wall);
  const angles = day.wall.panels.map((p) => `${p.angle > 0 ? '+' : ''}${p.angle}°`).join(' / ');
  return (
    <section className="card brief" aria-label="Today's brief">
      <div className="eyebrow">Today’s brief</div>
      <h1>
        Set a <span className="grade">V{day.targetGrade}</span>
      </h1>
      <dl className="facts">
        <div>
          <dt>Wall</dt>
          <dd>
            {STYLE_LABEL[style]} <span className="mono dim">{angles}</span>
          </dd>
        </div>
        <div>
          <dt>Par</dt>
          <dd className="mono">{day.par > 0 ? nHolds(day.par) : '—'}</dd>
        </div>
      </dl>
      {day.twist && <div className="twist">Weekend twist · {TWIST_LABEL[day.twist]}</div>}
    </section>
  );
}

export function Controls() {
  const armed = useGame((s) => s.armed);
  const selected = useGame((s) => s.selectedId);
  const lookAround = useGame((s) => s.lookAround);
  const text = lookAround
    ? 'Drag to orbit · scroll to zoom'
    : armed
      ? `Click the wall to place · Q / E or scroll to rotate · Esc to cancel`
      : selected
        ? 'Drag to move · Q / E to rotate · Delete to remove'
        : 'Pick a hold from the tray · drag placed holds · right-click removes';
  return <p className="controls">{text}</p>;
}

export function Tray() {
  const wasActive = useRef(false);
  const day = useGame((s) => s.day)!;
  const placed = useGame((s) => s.placed);
  const armed = useGame((s) => s.armed);
  const arm = useGame((s) => s.arm);
  const locked = useGame((s) => s.done || !!s.viewing || s.phase !== 'setting' || s.lookAround);
  return (
    <section className={`card tray ${locked ? 'locked' : ''}`} aria-label="Hold tray">
      <div className="eyebrow">
        Hold set <span className="mono dim">{placed.length} placed</span>
      </div>
      <ul>
        {day.tray.map((slot) => {
          const left = remaining(day, placed, slot.type, slot.size);
          const active = armed?.type === slot.type && armed.size === slot.size;
          return (
            <li key={`${slot.type}${slot.size}`}>
              <button
                className={`slot ${active ? 'active' : ''}`}
                disabled={locked || left <= 0}
                onPointerDown={(e) => {
                  // Press-and-drag onto the wall places directly; a plain click toggles.
                  wasActive.current = active;
                  if (e.pointerType !== 'mouse') return;
                  if (!active) arm({ type: slot.type, size: slot.size });
                  useGame.setState({ trayDrag: true });
                }}
                onClick={() => {
                  if (wasActive.current) arm(null);
                  else if (!active) arm({ type: slot.type, size: slot.size });
                }}
                title={HOLD_HINT[slot.type]}
              >
                <HoldIcon type={slot.type} size={slot.size} />
                <span className="slot-name">
                  {HOLD_NAME[slot.type]}
                  {slot.type !== 'foot' && <span className="size">{SIZE_LABEL[slot.size]}</span>}
                </span>
                <span className="count mono">
                  {left}
                  <span className="dim">/{slot.count}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {armed && <p className="hint">{HOLD_HINT[armed.type]}</p>}
    </section>
  );
}

export function SelectionBar() {
  const selected = useGame((s) => s.selectedId);
  const armed = useGame((s) => s.armed);
  const rotate = useGame((s) => s.rotate);
  const remove = useGame((s) => s.remove);
  if (!selected && !armed) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Hold controls">
      <button onClick={() => rotate(Math.PI / 12)} aria-label="Rotate left">
        ↺
      </button>
      <button onClick={() => rotate(-Math.PI / 12)} aria-label="Rotate right">
        ↻
      </button>
      {selected && (
        <button onClick={() => remove()} aria-label="Remove hold" className="danger">
          Remove
        </button>
      )}
    </div>
  );
}

export function ActionBar() {
  const s = useGame();
  const day = s.day!;
  if (s.viewing) return null;
  const left = MAX_TESTS - s.tests.length;
  const busy = s.phase === 'solving' || s.phase === 'climbing';
  return (
    <footer className="actionbar">
      <div className="pips" aria-label={`${left} test climbs left`}>
        {Array.from({ length: MAX_TESTS }, (_, i) => {
          const t = s.tests[i];
          return (
            <span key={i} className={`pip ${t ? t.verdict : ''}`} title={t ? (t.result.ok ? `V${t.result.grade.toFixed(1)}` : 'No send') : 'Unused'}>
              {t ? SQUARE[t.verdict] : ''}
            </span>
          );
        })}
      </div>
      <div className="holdcount mono">
        {s.placed.length} <span className="dim">{s.placed.length === 1 ? 'hold' : 'holds'}{day.par > 0 ? ` · par ${day.par}` : ''}</span>
      </div>
      {s.done ? (
        <>
          <button className="btn ghost" onClick={() => s.watch()} disabled={busy}>
            Watch my best
          </button>
          <button className="btn primary" onClick={() => s.setModal('stats')}>
            Results
          </button>
        </>
      ) : (
        <>
          {s.placed.length > 0 && (
            <button className="btn ghost" onClick={() => s.clear()} disabled={busy}>
              Clear
            </button>
          )}
          {s.tests.length > 0 && (
            <button className="btn ghost" onClick={() => s.finish()} disabled={busy}>
              Lock in
            </button>
          )}
          <button className="btn primary" onClick={() => s.testClimb()} disabled={busy || left <= 0 || s.lookAround}>
            {s.phase === 'solving' ? 'Reading the route…' : s.phase === 'climbing' ? 'Climbing…' : `Test climb (${left} left)`}
          </button>
        </>
      )}
    </footer>
  );
}

export function ViewingBanner() {
  const viewing = useGame((s) => s.viewing);
  const label = useGame((s) => s.viewingLabel);
  const watch = useGame((s) => s.watch);
  const exit = useGame((s) => s.exitViewing);
  const busy = useGame((s) => s.phase !== 'setting');
  if (!viewing) return null;
  return (
    <div className="viewing">
      <span>
        {label} · {nHolds(viewing.length)}
      </span>
      <button className="btn primary" onClick={() => watch()} disabled={busy}>
        Watch it climbed
      </button>
      <button className="btn ghost" onClick={exit}>
        Back to mine
      </button>
    </div>
  );
}
