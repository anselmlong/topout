# Topout — v1 Spec

A daily route-setting puzzle for climbers. Each day everyone gets the same wall,
the same hold set, and a brief ("Set a V4"). You place holds, watch a low-poly
climber test your route, and share your score.

## Core loop

1. Open the daily: wall, fixed start + finish holds, hold tray, brief.
2. Place/rotate holds between start and finish.
3. Run a **test climb** (max 3). The solver finds the easiest beta, reports a
   continuous grade (e.g. `V4.3`), and the climber animates it (or falls).
4. Score = best test. Share card.

## Scoring

- **Pass:** computed grade within ±1 of target. Exact (rounded) match = bonus.
- **Par:** fewest holds that hit the target grade, precomputed at curation.
- **Result:** pass/fail, holds used vs par, exact-grade bonus, tests used.

```
Topout #42 · V4 · Overhang
🟥🟨🟩  V4.1 · 9 holds (par 11)
```

## The daily brief

- Varies daily: wall shape (angle, volumes), hold set (count + types), target grade.
- Weekend-only twists: e.g. "no jugs", "must traverse left", "short climber".
- Start (1–2 holds) and finish (1 hold, must match) are fixed per day.

## Solver (the core — highest risk, build first)

- **Four-limb state search.** State = which hold (or smear) each of LH, RH, LF, RF is on.
- A move changes one limb. Every stance is validated against body geometry
  (arm span, height, plausible hip position).
- Move cost from: distance, hold type, hold orientation vs pull direction,
  wall angle, foot quality.
- A* finds the easiest sequence. Grade derives from the hardest move and the
  density of hard moves.
- **Feet:** separate small foot-chip pool; hand holds usable as feet; smearing
  only allowed on non-overhanging walls.
- **Climber body is fixed** (~175 cm, ape index ~1.0) so scores are comparable.
- Pure, deterministic TS module, run in a Web Worker. Server-reusable later for anti-cheat.

## Holds

- **Procedurally generated low-poly holds** — no scraped/brand meshes (licensing).
- Types: jug, crimp, sloper, pinch, pocket, foot chip.
- Each hold carries grip data: type, depth/quality, usable direction. Orientation matters.

## Walls

- Generated offline by the same generator, **curated by a human** (solvability
  check), shipped as a year of daily JSON. Day index from date.

## Interaction (2.5D)

- Mostly front-on camera with slight tilt; optional "look around" orbit.
- **Desktop:** drag from tray → snaps to surface; scroll or Q/E rotates;
  right-click / Delete removes; click to re-select and move.
- **Mobile:** tap hold → tap wall; drag to move; twist or rotate button.
- No overlaps, minimum spacing; ghost preview turns red on invalid placement.

## Climber

- Faceless low-poly figure. IK-interpolated between solver stances.
- Comedic fall on a failed move.

## Visual style

Muted, neutral palette; flat-shaded, polygonal (TABS-like). Professional, calm UI.

## Persistence

- `localStorage`: streak, stats, today's in-progress route.
- "Copy route link": route encoded in URL so friends can load and watch it.
- No accounts, no backend.

## Stack

Vite + TypeScript + React Three Fiber, React UI overlay, Zustand. Solver in a
Web Worker. Static deploy on Vercel.

## Build order

1. Solver + grade formula, unit-tested on hand-built routes.
2. Wall + hold generators.
3. Placement UI.
4. Climber animation.
5. Brief, test-climb flow, share card.
6. Curation tool (generate walls, compute par, verify solvable).

## Out of scope for v1

Accounts, leaderboards, peer rating, physics ragdoll, adjustable climber,
full-3D free placement, scanned/brand hold meshes.
