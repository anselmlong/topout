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
resize) fits the whole wall into the screen space the HUD leaves free. When a test climb
starts, the camera eases over to fit the wall around the move ticker too (below it on a
phone, above it on desktop), and eases back when the climb ends. While a move plays (its
wind-up and the limb travelling, or a dyno's pumps) the camera holds still and only reframes in
the settle after it; the landing shake is kept for the drop off the top and for falls.
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
grade). Playback defaults to 1×: each move plays as a wind-up, the move and a settle
(`src/scene/timeline.ts`; `npx tsx scripts/pacing.ts` measures how long climbs take to watch).

While the climber is on the wall, the ticker grades each move on its own ("This move
V4.5") on a bar that runs from V0 to a few grades past the brief, with the brief's pass
band shaded, a tick at the brief and one at the hardest move so far. The numbered move tags
on the wall use the same colours: green for moves well under the brief, ochre on it, brick
over it, so a V0 jug ladder reads green instead of every route's crux glowing red. During a
climb the ticker changes in two beats per move: as the move winds up, the count and its words
("Left hand → edge (hip turn)"); when the limb lands, its grade, the meter and its tag on the
wall, so tags pop in one at a time as hands land. The setting hints fade out while the climber
is on the wall.
Moves onto the same hold (a match on the Finish, a re-grab) share one tag ("5R 6L"), and each
frame the tags are nudged apart on screen, nearest free spot first, so none covers another or
the Start/Finish labels at any zoom.

After each test the result card breaks the crux down ("What made it V5.1"): the hold hung
off, the catch, the reach, the steepness, the feet, a barn door or high step, and the pump,
each as the grades it adds, and the tip goes after the biggest one. A test with no starting stance
rings the spots under the start where foot chips would give one (`footSpots` in `src/game/tips.ts`)
and puts a foot chip in hand when the card closes.

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
On a long static reach up vertical or steeper ground, the climber turns that hip in to the
wall (a twist lock): hips side-on, the turned-in leg backstepping on the outside edge of
its shoe, the reaching shoulder riding up while the other arm hangs straight (`hipTurn` in
`src/solver/model.ts`; slabs, short moves, stems, hooks and bunched stances stay square).
With one foot off, the free leg flags toward the reach (`flagFor` in `src/solver/model.ts`):
reaching away from the standing foot on the free leg's own side it swings out long and
straight (an outside flag, killing the barn door); reaching across, it crosses behind the
standing leg (a back flag) while the reaching hip turns in and the standing foot backsteps.
Between reaches a flag stays put. The ticker labels these "(flag)" and "(back flag)".
Before a dyno the climber pumps: a shallow dip and a deep one, arms locked straight and
hips sinking down and back over bent knees, eyes on the target, then launches from the
low point. Before the crux, if one hand is on a good hold with a foot on, the climber hangs
off it straight-armed, shakes out the other arm and chalks up. On top, the climber matches the finish, holds it a beat,
looks down at the pad and drops off: lands in a squat, stands, turns round to the room and,
on a send, throws both arms up and claps twice (`topOut` in `src/scene/Climber.tsx`). A route
that tops out off the brief gets the same drop and a shrug back up at the route. The head follows
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
