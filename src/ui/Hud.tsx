import { useRef, useState } from 'react';
import { STYLE_LABEL, TWIST_LABEL, wallStyleOf } from '../gen/day';
import { MAX_TESTS, SQUARE, holds as nHolds } from '../game/rules';
import { isSpotId } from '../game/spots';
import { HOLD_HINT, HOLD_NAME, NEUTRAL_HOLD, VOLUME_COLOR, routeColor } from '../scene/palette';
import type { HoldSize, HoldType } from '../solver/types';
import { isMuted, setMuted } from '../audio/sfx';
import { strainColor } from '../scene/BetaOverlay';
import { useClimb } from '../state/climb';
import { remaining, testLimit, useGame } from '../state/store';

const SIZE_LABEL: Record<HoldSize, string> = { s: 'S', m: 'M', l: 'L' };

export function HoldIcon({ type, size = 'm', color = NEUTRAL_HOLD }: { type: HoldType; size?: HoldSize; color?: string }) {
  const s = size === 's' ? 0.8 : size === 'l' ? 1.15 : 1;
  const paths: Record<HoldType, string> = {
    jug: 'M4 14c0-5 4-9 8-9s8 4 8 9c-2-2-5-3-8-3s-6 1-8 3z',
    crimp: 'M3 13h18l-2 3H5z',
    sloper: 'M3 17c1-7 5-11 9-11s8 4 9 11z',
    pinch: 'M10 4h4l1 16h-6z',
    pocket: 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0zm4.5-1.5a2.5 2 0 1 0 5 0a2.5 2 0 1 0-5 0z',
    edge: 'M3 11h18v3l-2 2H5l-2-2z',
    foot: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0z',
    jib: 'M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z',
    volume: 'M3 19 12 5l9 14z',
  };
  return (
    <svg className="hold-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`translate(12 12) scale(${s}) translate(-12 -12)`}>
        <path d={paths[type]} fill={color} fillRule="evenodd" stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      </g>
    </svg>
  );
}

function formatDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function TopBar() {
  const day = useGame((s) => s.day)!;
  const mode = useGame((s) => s.mode);
  const setModal = useGame((s) => s.setModal);
  const resetView = useGame((s) => s.resetView);
  const done = useGame((s) => s.done);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Topout</span>
        <span className="meta mono">
          {mode === 'practice' ? 'Practice' : `#${day.number} · ${formatDate(day.date)}`}
          {mode === 'archive' && ' · replay'}
        </span>
      </div>
      <nav className="topbar-actions">
        {mode !== 'daily' && (
          <a className="icon-btn" href={location.pathname} title="Back to today's puzzle">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14z" />
            </svg>
            <span className="label">Today</span>
          </a>
        )}
        <button className="icon-btn" onClick={() => setModal('practice')} title="Practice on any wall">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 21 10 5l4 8 3-4 4 12z" />
          </svg>
          <span className="label">Practice</span>
        </button>
        <MuteButton />
        <button className="icon-btn" onClick={resetView} title="Reset the camera to the front view">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
          </svg>
          <span className="label">Reset view</span>
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
  const mode = useGame((s) => s.mode);
  const style = wallStyleOf(day.wall);
  const angles = day.wall.panels.map((p) => `${p.angle > 0 ? '+' : ''}${p.angle}°`).join(' / ');
  return (
    <section className="card brief" aria-label="Today's brief">
      <div className="eyebrow">
        {mode === 'practice' ? 'Practice wall' : mode === 'archive' ? `Replaying #${day.number}` : 'Today’s brief'}
      </div>
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
          <dt>Holds</dt>
          <dd className="route-chip">
            <span className="swatch" style={{ background: routeColor(day).hex }} />
            {routeColor(day).name}
          </dd>
        </div>
        <div>
          <dt>Par</dt>
          <dd className="mono">{day.par > 0 ? nHolds(day.par) : '—'}</dd>
        </div>
      </dl>
      {day.twist && (
        <div className="twist">
          {mode === 'practice' ? 'Twist' : 'Weekend twist'} · {TWIST_LABEL[day.twist]}
        </div>
      )}
    </section>
  );
}

export function Controls() {
  const armed = useGame((s) => s.armed);
  const selected = useGame((s) => s.selectedId);
  const onSpot = useGame((s) => !!s.selectedId && isSpotId(s.day!, s.selectedId));
  const text = armed
      ? `Click the wall to place · Q / E or scroll to rotate · Esc to cancel`
      : onSpot
        ? 'Choose the hold for this spot · Q / E to rotate · it stays on the tape'
        : selected
          ? 'Drag to move · Q / E to rotate · Delete to remove · Ctrl+Z undoes'
          : 'Click a taped spot to choose its start or finish hold · pick holds from the tray · Q / E rotates the hold under the mouse';
  return <p className="controls">{text}</p>;
}

export function Tray() {
  const wasActive = useRef(false);
  const day = useGame((s) => s.day)!;
  const placed = useGame((s) => s.placed);
  const volumes = useGame((s) => s.volumes);
  const armed = useGame((s) => s.armed);
  const arm = useGame((s) => s.arm);
  const locked = useGame((s) => s.done || !!s.viewing || s.phase !== 'setting');
  const viewing = useGame((s) => !!s.viewing);
  // Someone else's route is on the wall: the tray has nothing to offer.
  if (viewing) return null;
  return (
    <section className={`card tray ${locked ? 'locked' : ''}`} aria-label="Hold tray">
      <div className="eyebrow">
        Hold set <span className="mono dim">{placed.length + volumes.length} placed</span>
      </div>
      <ul>
        {day.tray.map((slot) => {
          const pick = { type: slot.type, size: slot.size, shape: slot.shape };
          const left = remaining(day, placed, volumes, pick);
          const active = armed?.type === slot.type && armed.size === slot.size && armed.shape === slot.shape;
          const isVolume = slot.type === 'volume';
          return (
            <li key={`${slot.type}${slot.shape ?? ''}${slot.size}`} className={isVolume ? 'volume-slot' : undefined}>
              <button
                className={`slot ${active ? 'active' : ''}`}
                disabled={locked || left <= 0}
                onPointerDown={(e) => {
                  // Press-and-drag onto the wall places directly; a plain click toggles.
                  wasActive.current = active;
                  if (e.pointerType !== 'mouse') return;
                  if (!active) arm(pick);
                  useGame.setState({ trayDrag: true });
                }}
                onClick={() => {
                  if (wasActive.current) arm(null);
                  else if (!active) arm(pick);
                }}
                title={HOLD_HINT[slot.type]}
              >
                <HoldIcon type={slot.type} size={slot.size} color={isVolume ? VOLUME_COLOR : routeColor(day).hex} />
                <span className="slot-name">
                  {isVolume ? (slot.shape === 'wedge' ? 'Wedge' : 'Pyramid') : HOLD_NAME[slot.type]}
                  {slot.type !== 'foot' && slot.type !== 'jib' && <span className="size">{SIZE_LABEL[slot.size]}</span>}
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

/** Anything but a volume can go on a start or finish spot. */
const SPOT_TYPES: HoldType[] = ['jug', 'edge', 'crimp', 'sloper', 'pinch', 'pocket', 'foot', 'jib'];
const SIZES: HoldSize[] = ['s', 'm', 'l'];

/** Picks the hold on a taped start/finish spot. The spot itself never moves. */
function SpotPicker({ id }: { id: string }) {
  const day = useGame((s) => s.day)!;
  const hold = useGame((s) => s.spots[id]);
  const setSpot = useGame((s) => s.setSpot);
  const rotate = useGame((s) => s.rotate);
  const remove = useGame((s) => s.remove);
  const color = routeColor(day).hex;
  const oneSize = !hold || hold.type === 'foot' || hold.type === 'jib';
  return (
    <div className="selection-bar spot-picker" role="toolbar" aria-label={id === 'finish' ? 'Finish hold' : 'Start hold'}>
      <div className="spot-head">
        <span className="eyebrow">{id === 'finish' ? 'Finish hold' : 'Start hold'}</span>
        {!hold && <span className="dim">Pick one</span>}
      </div>
      <div className="spot-types">
        {SPOT_TYPES.map((t) => (
          <button
            key={t}
            className={hold?.type === t ? 'on' : undefined}
            onClick={() => setSpot(id, { type: t, size: t === 'foot' || t === 'jib' ? 'm' : (hold?.size ?? 'm') })}
            title={`${HOLD_NAME[t]}: ${HOLD_HINT[t]}`}
            aria-label={HOLD_NAME[t]}
            aria-pressed={hold?.type === t}
          >
            <HoldIcon type={t} color={color} />
          </button>
        ))}
      </div>
      {hold && (
        <div className="spot-row">
          {!oneSize &&
            SIZES.map((z) => (
              <button
                key={z}
                className={`mono ${hold.size === z ? 'on' : ''}`}
                onClick={() => setSpot(id, { size: z })}
                aria-pressed={hold.size === z}
              >
                {SIZE_LABEL[z]}
              </button>
            ))}
          <button onClick={() => rotate(Math.PI / 12)} aria-label="Rotate left">
            ↺
          </button>
          <button onClick={() => rotate(-Math.PI / 12)} aria-label="Rotate right">
            ↻
          </button>
          <button onClick={() => remove(id)} className="danger">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

export function SelectionBar() {
  const selected = useGame((s) => s.selectedId);
  const armed = useGame((s) => s.armed);
  const rotate = useGame((s) => s.rotate);
  const remove = useGame((s) => s.remove);
  const onSpot = useGame((s) => !!s.selectedId && isSpotId(s.day!, s.selectedId));
  if (selected && onSpot) return <SpotPicker id={selected} />;
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
  const practice = s.mode === 'practice';
  const left = testLimit(s.mode) - s.tests.length;
  // Practice has unlimited tests: show the latest three.
  const shown = practice ? s.tests.slice(-MAX_TESTS) : s.tests;
  const busy = s.phase === 'solving' || s.phase === 'climbing';
  return (
    <footer className="actionbar">
      <div className="pips" aria-label={practice ? 'Recent tests' : `${left} test climbs left`}>
        {Array.from({ length: MAX_TESTS }, (_, i) => {
          const t = shown[i];
          return (
            <span key={i} className={`pip ${t ? t.verdict : ''}`} title={t ? (t.result.ok ? `V${t.result.grade.toFixed(1)}` : 'No send') : 'Unused'}>
              {t ? SQUARE[t.verdict] : ''}
            </span>
          );
        })}
      </div>
      <div className="holdcount mono">
        {s.placed.length + s.volumes.length}{' '}
        <span className="dim">
          {s.placed.length + s.volumes.length === 1 ? 'hold' : 'holds'}
          {day.par > 0 ? ` · par ${day.par}` : ''}
        </span>
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
          {s.undoStack.length > 0 && (
            <button
              className="btn ghost icon"
              onClick={() => s.undo()}
              disabled={busy}
              title="Undo (Ctrl+Z · Shift+Ctrl+Z redoes)"
              aria-label="Undo"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12.5 8c-2.6 0-5 1-6.9 2.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 20.1 16l2.4-.8A10.5 10.5 0 0 0 12.5 8z" />
              </svg>
            </button>
          )}
          {s.placed.length > 0 && (
            <button className="btn ghost" onClick={() => s.clear()} disabled={busy}>
              Clear
            </button>
          )}
          {s.tests.length > 0 && !practice && (
            <button className="btn ghost" onClick={() => s.finish()} disabled={busy}>
              Lock in
            </button>
          )}
          <button className="btn primary" onClick={() => s.testClimb()} disabled={busy || left <= 0}>
            {s.phase === 'solving' ? 'Reading the route…' : s.phase === 'climbing' ? 'Climbing…' : practice ? 'Test climb' : `Test climb (${left} left)`}
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

function MuteButton() {
  const [muted, set] = useState(isMuted);
  return (
    <button
      className="icon-btn"
      onClick={() => {
        setMuted(!muted);
        set(!muted);
      }}
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {muted ? (
          <path d="M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" />
        ) : (
          <path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
        )}
      </svg>
    </button>
  );
}

/** Live move-by-move readout while the climber is on the wall. */
export function ClimbTicker() {
  const phase = useGame((s) => s.phase);
  const feed = useClimb();
  if (phase !== 'climbing') return null;
  return (
    <div className={`card ticker ${feed.status}`} role="status" aria-live="polite">
      <div className="row1">
        <span>{feed.move >= 0 ? `Move ${feed.move + 1} / ${feed.total}` : 'Starting'}</span>
        <span>Strain</span>
      </div>
      <div className="label">{feed.label}</div>
      <div className="strain">
        <span style={{ width: `${Math.round(feed.strain * 100)}%`, background: strainColor(feed.strain) }} />
      </div>
    </div>
  );
}
