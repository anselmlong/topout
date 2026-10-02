# Topout

A daily route-setting puzzle. Everyone gets the same wall, hold set, and brief
("Set a V4"). Place holds, send the climber up for a test, land the grade with
as few holds as you can. See [SPEC.md](SPEC.md) for the design.

```sh
npm install
npm run dev        # http://localhost:5173  (?day=N opens any day in dev; prod clamps to today)
npm test           # solver + rules tests
npm run build      # typecheck + production build to dist/
npm run curate -- --from 1 --days 120   # regenerate public/days/*.json
```

Pushing to `main` deploys to https://topout.anselmlong.com (Vercel Git integration).

## Controls

Left-drag on the wall or background orbits; Shift+drag or middle-drag pans; the
wheel zooms (or rotates the armed/selected hold). A click without dragging places
or selects, and a drag that starts on a placed hold moves it. Reset view (and every load or
resize) fits the whole wall into the screen space the HUD leaves free.
Q/E rotate, right-click (without dragging) removes. While a handhold is armed or
dragged, an arc on the wall shows the climber's reach from the nearest handhold
below (solid: static, dashed: dyno only; `src/game/reach.ts` mirrors the solver's
hand-to-hand limit). Ctrl/Cmd+Z undoes any
placement, move, rotation, removal or clear (Shift+Ctrl+Z or Ctrl+Y redoes); the
action bar has undo and redo buttons for touch. While the climber is on the wall, the
ticker's speed button cycles 1×/2×/4× (remembered) and Skip (or Esc) jumps
straight to the result. On touch: tap to place, two
fingers to orbit/zoom. A finger that lands just beside a hold (within ~18 px of its edge)
grabs it, so foot chips a few pixels wide on a phone are easy to pick up, and a dragged hold
keeps the spot it was grabbed by instead of jumping under the pointer.

The taped Start and Finish spots are labelled on the wall and start with the day's
jugs on them; click one to swap its hold. A short spotlight tour opens on every visit
(Start, Finish, tray, wall, Test) until the player ticks its "Don't show again" box; it's
replayable from the help's "Show me around" and skipped over a shared or example route, and the
help (behind the ? button) has a worked example, a gallery of hand-built example climbs
(`src/game/examples.ts`, `?example=<id>`, also listed in the grade guide), a link that
plays yesterday's setter route, and a grade guide (also behind the ? on the brief's
grade). Playback defaults to 2×.

After each test the result card breaks the crux down ("What made it V5.1"): the hold hung
off, the catch, the reach, the steepness, the feet, a barn door or high step, and the pump,
each as the grades it adds, and the tip goes after the biggest one.

**Practice** (top bar) builds any wall style, angle, grade and twist with a full
tray and unlimited tests. The wall is encoded in the URL
(`?practice=style.angle.grade.twist.seed`), so it survives reloads and can be shared.

## The climber

The solver decides everything that matters (the beta, the grade, pass/fail).
The climber on screen is a Verlet ragdoll (`src/scene/ragdoll.ts`): hands and
feet are driven along the solver's moves and pinned to holds, while the rest of
the body is simulated with gravity, soft "muscle" springs toward an IK pose, and
wall/pad collisions. Feet cut loose on campus moves and steep dynos, hard moves
tremble, the crux plays in slow motion, and failed routes let go and fall.
In a corner with a foot on each face, the climber bridges: the body squares up
to the crease and each knee points out over its own foot, pushing the faces apart.
When a hand ends up down by the hips (a rockover, a hand-foot match, a mantle onto a
lip) on ground no steeper than ~15°, it presses instead of pulling: elbow up and back,
palm flat with the fingers turned in, shoulder over the hand, hips in over the feet.
Before the crux, if one hand is on a good hold with a foot on, the climber hangs
off it straight-armed, shakes out the other arm and chalks up. The head follows
the eyes: it spots each hold before the move, watches a foot all the way onto its
hold, and reads the crux while shaking out.

## Layout

| Path | What |
| --- | --- |
| `src/solver/` | Grading. `model.ts` holds every tuning constant; `solve.ts` is the two-pass four-limb search; runs in a Web Worker via `client.ts`. |
| `src/gen/` | Seeded daily generator (wall, start/finish, tray, target grade, twist). |
| `src/game/` | Placement + scoring rules, share text, route links. Shared by UI and curation. |
| `scripts/curate.ts` | Proves each day solvable and computes par. Writes `public/days/N.json`. |
| `src/scene/` | React Three Fiber scene: wall, procedural holds, IK climber. |
| `src/ui/`, `src/state/` | HUD, modals, Zustand store, localStorage. |

## Playtest backlog

[PLAYTEST.md](PLAYTEST.md) lists follow-ups from user testing, one full run each.
Scheduled improvement runs take the first unchecked item there before rotating
through the usual areas, and tick it off in the same commit.

## Known limits

- **Grades are uncalibrated.** The constants in `src/solver/model.ts` were
  tuned against intuition (vertical jug ladder ≈ V0–1, crimps on 20° ≈ V5–6),
  not real data. Expect to tune them after climbers play it.
- **Par is the best route the curation search found**, not a proven minimum.
  Players can beat it, which is fine but should be spot-checked.
- Days past the curated archive (#120 = 2027-01-26) fall back to uncurated
  generated days with no par. Run `npm run curate` to extend.
- Day #1 is 2026-09-29 (`EPOCH` in `src/gen/day.ts`).
