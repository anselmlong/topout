// Reach guide for setting: while a handhold is being placed, show how far the
// climber can reach from the closest handhold below. Mirrors the solver's
// hand-to-hand limit (an ellipse: arm span sideways, lock-off reach upward).
import { BODY, GRIP } from '../solver/model';
import type { Hold } from '../solver/types';

export type ReachZone = 'static' | 'dyno' | 'out';

export interface ReachGuide {
  anchor: Hold;
  /** Stretch as a fraction of static reach: ≤ 1 static, ≤ BODY.dynoLimit a dyno. */
  stretch: number;
  zone: ReachZone;
}

/** The hand-to-hand stretch from `a` to the point (u, v), in units of static reach. */
export function stretch(a: { u: number; v: number }, u: number, v: number): number {
  return Math.hypot((u - a.u) / BODY.span, (v - a.v) / BODY.lockoff);
}

export function zoneOf(s: number): ReachZone {
  return s <= 1 ? 'static' : s <= BODY.dynoLimit ? 'dyno' : 'out';
}

/**
 * The handhold the climber would most likely reach from to grab (u, v): the one at or
 * below it needing the least stretch. Null when there is no handhold below (a hold
 * placed under everything is reached on the way up, not from it).
 */
export function reachGuide(holds: Hold[], u: number, v: number, exclude?: string): ReachGuide | null {
  let best: ReachGuide | null = null;
  for (const h of holds) {
    if (h.id === exclude || !GRIP[h.type].hand || h.role === 'finish' || h.v > v) continue;
    const s = stretch(h, u, v);
    if (!best || s < best.stretch) best = { anchor: h, stretch: s, zone: zoneOf(s) };
  }
  return best;
}

/**
 * Points (u, v) along the upper arc of `a`'s reach ellipse at `scale` × static reach,
 * from just below level on the right round to just below level on the left.
 */
export function reachArc(a: { u: number; v: number }, scale = 1, n = 48): { u: number; v: number }[] {
  const from = -0.25;
  const to = Math.PI + 0.25;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + (i / n) * (to - from);
    return { u: a.u + Math.cos(t) * BODY.span * scale, v: a.v + Math.sin(t) * BODY.lockoff * scale };
  });
}
