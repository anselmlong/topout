// Numbered hand moves on the wall, coloured by each move's own grade against the
// brief (green filler, ochre on grade, brick over it), so an easy route reads easy. While the
// climber is on the wall, each tag pops in as its hand lands on the hold, one at a time.
// Moves onto the same hold (a match, a re-grab) share one tag, and every frame the tags are
// spread apart on screen so none hides another or the Start/Finish labels.
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { gradeTone, moveGrade } from '../game/tips';
import type { Day } from '../solver/types';
import { surfaceAt } from '../solver/volumes';
import { useClimb } from '../state/climb';
import { useGame } from '../state/store';
import { frameAt, panelFrames, uvToWorld } from './wallGeometry';

export function strainColor(s: number) {
  // muted green → ochre → brick
  const stops = [
    [111, 154, 122],
    [196, 160, 72],
    [191, 91, 79],
  ];
  const t = Math.max(0, Math.min(1, s)) * 2;
  const i = Math.min(1, Math.floor(t));
  const k = t - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * k));
  return `rgb(${c.join(',')})`;
}

interface Entry {
  move: number;
  n: number;
  hand: 'L' | 'R';
  dyno: boolean;
  tone: number;
  crux: boolean;
}

interface Tag {
  key: number;
  pos: THREE.Vector3;
  entries: Entry[];
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Nudges to try for a tag, nearest first, in units of its own width and height. */
const NUDGES = (() => {
  const out: [number, number][] = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) out.push([i * 0.55, j * 1.05]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

const GAP = 2;

export function BetaOverlay({ day }: { day: Day }) {
  const beta = useGame((s) => s.beta);
  const phase = useGame((s) => s.phase);
  // The last move whose hand has landed: its tag shows (and is highlighted) from then on.
  const current = useClimb((s) => s.landed);
  const frames = useMemo(() => panelFrames(day.wall), [day.wall]);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const placed = useRef(new Map<number, [number, number]>());
  const { camera, gl, size } = useThree();

  const tags = useMemo(() => {
    if (!beta || !beta.result.ok) return [];
    const { moves, crux } = beta.result;
    const byHold = new Map<number, Tag>();
    let n = 0;
    moves.forEach((m, i) => {
      if (m.limb > 1) return;
      n++;
      const entry: Entry = {
        move: i,
        n,
        hand: m.limb === 0 ? 'L' : 'R',
        dyno: m.dynamic,
        tone: gradeTone(moveGrade(m.difficulty), day.targetGrade),
        crux: m.difficulty >= crux - 1e-9,
      };
      const hold = m.to.limbs[m.limb];
      const tag = byHold.get(hold);
      if (tag) return void tag.entries.push(entry);
      const p = m.to.points[m.limb];
      const f = frameAt(frames, p.u, p.v);
      const side = m.limb === 0 ? -1 : 1;
      const relief = (surfaceAt(beta.volumes, p.u, p.v)?.height ?? 0) / 100;
      const pos = uvToWorld(day.wall, frames, p.u + side * 9, p.v + 7).addScaledVector(f.normal, 0.08 + relief);
      byHold.set(hold, { key: i, pos, entries: [entry] });
    });
    return [...byHold.values()];
  }, [beta, frames, day.wall, day.targetGrade]);

  useEffect(() => placed.current.clear(), [tags]);

  const climbing = phase === 'climbing';
  const shown = tags
    .map((t) => ({ ...t, entries: t.entries.filter((e) => !climbing || e.move <= current) }))
    .filter((t) => t.entries.length);
  // The newest hand tag stays highlighted until the next hand lands (foot moves leave it be).
  const latest = climbing ? Math.max(-1, ...shown.flatMap((t) => t.entries.map((e) => e.move))) : -1;

  // Spread the tags apart in screen space. Earlier tags keep their spot and later ones find
  // a free one nearby, so tags don't jump around as the climb adds new ones.
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!shown.length) return;
    const canvas = gl.domElement.getBoundingClientRect();
    const taken: Rect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.spot-label:not(.hidden)')) {
      const r = el.getBoundingClientRect();
      taken.push({ x0: r.left - canvas.left, y0: r.top - canvas.top, x1: r.right - canvas.left, y1: r.bottom - canvas.top });
    }
    const moves: [HTMLDivElement, number, number][] = [];
    for (const t of shown) {
      const el = slots.current.get(t.key);
      if (!el) continue;
      v.copy(t.pos).project(camera);
      if (v.z > 1) continue;
      const cx = ((v.x + 1) / 2) * size.width;
      const cy = ((1 - v.y) / 2) * size.height;
      const now = climbing && t.entries.some((e) => e.move === latest) ? 1.25 : 1;
      const w = el.offsetWidth * now + GAP * 2;
      const h = el.offsetHeight * now + GAP * 2;
      // The crux label rides above the pill.
      const top = t.entries.some((e) => e.crux) ? 15 : 0;
      const rectAt = (dx: number, dy: number): Rect => ({
        x0: cx + dx - w / 2,
        x1: cx + dx + w / 2,
        y0: cy + dy - h / 2 - top,
        y1: cy + dy + h / 2,
      });
      let best: [number, number] = [0, 0];
      let bestCost = Infinity;
      for (const [i, j] of NUDGES) {
        const r = rectAt(i * w, j * h);
        const cost = taken.reduce((a, o) => a + overlap(r, o), 0);
        if (cost < bestCost - 1e-6) {
          best = [i * w, j * h];
          bestCost = cost;
          if (cost === 0) break;
        }
      }
      taken.push(rectAt(best[0], best[1]));
      const prev = placed.current.get(t.key);
      if (!prev || Math.abs(prev[0] - best[0]) > 0.5 || Math.abs(prev[1] - best[1]) > 0.5) {
        placed.current.set(t.key, best);
        moves.push([el, best[0], best[1]]);
      }
    }
    for (const [el, dx, dy] of moves) el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  });

  if (!shown.length) return null;
  return (
    <group>
      {shown.map((t) => {
        const crux = t.entries.some((e) => e.crux);
        const tone = Math.max(...t.entries.map((e) => e.tone));
        const now = climbing && t.entries.some((e) => e.move === latest);
        const off = placed.current.get(t.key);
        return (
          <Html key={t.key} position={t.pos} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className="beta-slot"
              ref={(el) => {
                if (el) slots.current.set(t.key, el);
                else slots.current.delete(t.key);
              }}
              style={off ? { transform: `translate(${off[0]}px, ${off[1]}px)` } : undefined}
            >
              <div className={`beta-tag ${crux ? 'crux' : ''} ${now ? 'now' : ''}`} style={{ background: strainColor(tone) }}>
                {t.entries.map((e) => (
                  <span key={e.move} className="move">
                    <span className="n">{e.n}</span>
                    <span className="h">{e.hand}</span>
                    {e.dyno && <span className="h">↯</span>}
                  </span>
                ))}
                {crux && <span className="crux-label">crux</span>}
              </div>
            </div>
          </Html>
        );
      })}
    </group>
  );
}
