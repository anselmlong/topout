# Playtest backlog

Feedback from the first round of user testing (2026-10-02). A first pass shipped in
b1be7a3 (Start/Finish labels and pre-filled jugs, grade guide, shorter help with an
example, redo button, 2× playback, more L holds, wrapping phone tray, phone picker
layout). Each item below is a deeper follow-up worth **one full scheduled run on its
own**. A run takes the first unchecked item, does it properly, ticks it here in the
same commit, and leaves the rest for later runs. The redo button is done and has no
item.

Every run: read README.md and SPEC.md, run `git log --oneline -20`, check the item
against what's already shipped, and verify in the real app with Playwright (phone:
`devices['iPhone 13']` and an iPhone SE-sized viewport; desktop: 1400×860; Chromium
in `/opt/pw-browsers`, launch with `--use-gl=swiftshader`). `npx tsc --noEmit`,
`npm test` and `npm run build` must pass and calibration mean abs error must stay
under 0.8 before pushing to main. If the solver or generator changes, re-curate only
the next 5 days from tomorrow (`npx tsx scripts/curate.ts --from N --days 5`, 0
failures) so today's in-progress saves aren't disturbed.

- [x] **1. Phone QA pass** ("quite buggy on phone"). Drive every flow by touch on a
  small and a large phone, portrait and landscape: place, drag-move, rotate, remove,
  spot picker, undo/redo, orbit vs tap, two-finger pan/zoom, test climb, result,
  results/share, practice modal, past days, example climb. Look for taps that do the
  wrong thing (a tap starting an orbit, a drag placing a hold), things under the
  notch/home bar (safe-area insets), text overflow, modals taller than the screen,
  double-tap zoom, and console errors. Fix what you find; list anything left in the
  commit message.
  *Done:* landscape phones get their own layout (brief and tray in side columns, ticker
  under the brief, notch-safe insets, wall framed below the top bar); a tap that selects a
  Start/Finish spot or hold no longer clicks the picker that opens under the finger; the
  action bar fits after a test on 320-400 px phones; no double-tap zoom on buttons;
  touch-worded hints on tablets. *Left:* on a 320 px phone the brief wraps to three rows
  and can cover the Finish label (item 4); two-finger orbit/pan/zoom wasn't automatable
  in Playwright and still needs a real-device check.
- [x] **2. First-run walkthrough** ("start and end being fixed should be clearer",
  "the ? info should pop up for first timers"). Replace the wall of text with a
  short interactive coach-mark tour on first visit: point at the Start and Finish
  spots ("fixed, tap to swap the hold"), the tray, the wall ("tap to place"), and the
  Test button. Skippable, shown once, re-openable from the ? help. Keep the full
  help modal for reference.
  *Done:* first visit opens a spotlight tour (`src/ui/Tour.tsx`) instead of the help:
  brief, Start, Finish, tray, the gap between Start and Finish, Test, and the ? button.
  It tracks the real on-screen elements (`data-tour` attributes) every frame, skips
  any that aren't shown (a route link has no tray), places its bubble beside or
  above/below the target to fit phones and landscape, and is skippable (Skip or Esc).
  Closing it marks the help as seen; the help has a "Show me around" button to replay it.
- [x] **3. Example gallery** ("some examples would be good for first players"). The
  help's example plays yesterday's setter route, which spoils it and doesn't exist
  on day 1. Add 3–4 hand-built example routes on practice walls (e.g. V0 jug ladder
  on vertical, V3 crimps on vertical, V5 on a 30° overhang) that anyone can watch
  from the help and the grade guide, each with a one-line note on why it gets its
  grade. Add a test that each example solves within half a grade of its label.
  *Done:* `src/game/examples.ts` builds four walls and routes by hand (V0 jug ladder and
  V3 crimps on vertical, V3 crimps on a slab with no feet, V5 edges on a 30° overhang),
  independent of the daily archive. `?example=<id>` opens one as a practice wall and plays
  it straight away; the help and the grade guide list them with a note on each grade.
  Yesterday's setter route stays in the help as a secondary link. `examples.test.ts`
  checks each lands within half a grade (all within 0.15) and every hold places legally.
- [x] **4. See the whole wall and every hold at once** ("being able to see all the
  holds at once would be better"). Make the default camera fit the entire wall (top
  to pad, both edges, corners and prows) on every aspect ratio, with the HUD's
  actual size taken into account, so no placed hold or spot hides behind the brief,
  tray or action bar. Add a fit-to-wall view if Reset view doesn't already do this.
  On desktop, tighten the tray so it never needs to scroll.
  *Done:* the home framing (load, Reset view, and any resize or phone rotation) measures
  the top bar, brief, tray, action bar and replay banner, works out the screen space they
  leave free, and fits every corner of every wall facet into it (prow noses and cave lips
  included), sliding the view so the wall sits in the middle of that space. On a 320 px
  phone the Finish no longer hides under the brief nor the wall's base under the tray.
  Reset view is the fit-to-wall view. Desktop trays use tighter rows below 900 px of
  height and two columns below 660 px, so a full practice tray fits without scrolling
  from 1440×900 down to 800×600. *Left:* in a window as small as 800×600 the tray can't
  be cleared without shrinking the wall to a sliver, so it overlaps the wall's upper
  right there; the climb ticker still covers the top of the wall during a playback.
- [x] **5. Faster loop** ("faster gameplay if it's a daily game"). Measure time from
  page load to first test result and from pressing Test to the result card, on a
  throttled phone profile. Cut what's slow: solver time on big routes, the climb's
  pre-roll and tail, the result card's appearance, the number of taps to retry. Keep
  the climb readable; don't drop the shake-out or crux slow-mo, shorten them.
  *Done:* the solver's second pass reuses every move the first pass scored (same moves,
  same costs, same order, so grades and curated days are unchanged) and hold points and
  their 3D positions are shared instead of rebuilt per move: on 18-hold player-sized
  routes over the 120 curated walls, solve time fell from median 202 ms / p90 619 ms /
  max 3.6 s to 112 / 303 / 1.5 s on desktop (roughly ×4 on a throttled phone). The
  worker starts as soon as the day loads, so the first Test doesn't wait for it. Playback
  is ~17% shorter (median Test-to-result card on the curated routes at 2×: 8.6 s → 7.1 s):
  a shorter pre-roll (0.9 → 0.6 s) and top-out tail (2.2 → 1.6 s), brisker easy moves
  and foot moves while the crux keeps its length, a 1.6 s shake-out (was 2.1, same
  choreography), and a crux slow-mo of 0.55× (was 0.45×). Retrying is one tap (Keep
  setting) plus the edit. *Left:* a throttled-phone Playwright timing wasn't meaningful
  here (software WebGL dominates); worth a real-device check.
- [ ] **6. Bigger, more readable holds** ("more bigger holds"). The tray mix now
  favours L. Check how holds read on a phone at the default camera: L holds should
  look clearly big, S clearly small, and every hold should be easy to tap and drag
  (raise the touch hit area, not the mesh). Check daily trays over the next few weeks
  of generated days have enough jugs and L holds for low grades.
- [ ] **7. Grades you can learn from** ("maybe a grade guide"). The guide now lists
  what each grade looks like. Make results teach the scale: on the result card, say
  what drove the grade (the crux move's hold, reach, steepness, feet, pump) and what
  one change would move it toward the target. Add a test that the guide's examples
  grade as the guide says (reuse scripts/calibrate.ts anchors).
