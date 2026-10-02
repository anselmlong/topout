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
- [ ] **2. First-run walkthrough** ("start and end being fixed should be clearer",
  "the ? info should pop up for first timers"). Replace the wall of text with a
  short interactive coach-mark tour on first visit: point at the Start and Finish
  spots ("fixed, tap to swap the hold"), the tray, the wall ("tap to place"), and the
  Test button. Skippable, shown once, re-openable from the ? help. Keep the full
  help modal for reference.
- [ ] **3. Example gallery** ("some examples would be good for first players"). The
  help's example plays yesterday's setter route, which spoils it and doesn't exist
  on day 1. Add 3–4 hand-built example routes on practice walls (e.g. V0 jug ladder
  on vertical, V3 crimps on vertical, V5 on a 30° overhang) that anyone can watch
  from the help and the grade guide, each with a one-line note on why it gets its
  grade. Add a test that each example solves within half a grade of its label.
- [ ] **4. See the whole wall and every hold at once** ("being able to see all the
  holds at once would be better"). Make the default camera fit the entire wall (top
  to pad, both edges, corners and prows) on every aspect ratio, with the HUD's
  actual size taken into account, so no placed hold or spot hides behind the brief,
  tray or action bar. Add a fit-to-wall view if Reset view doesn't already do this.
  On desktop, tighten the tray so it never needs to scroll.
- [ ] **5. Faster loop** ("faster gameplay if it's a daily game"). Measure time from
  page load to first test result and from pressing Test to the result card, on a
  throttled phone profile. Cut what's slow: solver time on big routes, the climb's
  pre-roll and tail, the result card's appearance, the number of taps to retry. Keep
  the climb readable; don't drop the shake-out or crux slow-mo, shorten them.
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
