# Changelog

What changed in Topout, newest first. Dates are Singapore time (UTC+8).
Each entry is one line in plain words, grouped under the day and the area it touched:
**Climber**, **Grades**, **Holds**, **Walls**, **Game**.

## 2026-10-03

**Climber**
- Pumps before a dyno: hips sink twice off straight arms and it launches from the low point.
- Turns the hip in on long reaches, with twist locks and backsteps.
- Flags toward the reach, with outside flags and back flags.

**Grades**
- Pinches hold on overhangs; slopers roll off them.
- Sidepulls climb easier than gastons, since climbers lean off them.
- Underclings are climbable, since climbers stand into them.

**Holds**
- Touches beside a hold grab it, drags keep their grip, and easy trays get big holds.
- Jugs are real buckets with a rolled lip, a closed scoop and the bolt inside.
- Edges and crimps are lofted rails with a wedge belly and rounded ends.
- Jibs are knapped stones with broad facets and a positive top edge.

**Walls**
- Roof: climb out a near-flat roof from the back, hook the lip and pull onto a headwall.
- Highball: a 5.6-6.2 m wall with longer, more sustained problems.
- Leaning corners and arêtes that kick from vertical into overhang.
- Nose: a steep arête sit start that stands up into a vertical arête.

**Game**
- The camera fits the whole wall into the space the HUD leaves free, and frames the wall
  around the move ticker during a test climb.
- Faster loop: the solver reuses scored moves, the worker stays warm, playback is tighter.
- The tour opens on every visit until the player ticks "Don't show again".
- Result card: "What made it V5.1" breaks down the crux, and tips go after the biggest driver.
- The climb ticker grades each move against the brief instead of the route's crux.
- Move tags: matches share one tag, and tags spread apart so none hides another.

## 2026-10-02

**Climber**
- Shakes out and chalks up before the crux.
- Looks where it's going: spots holds and watches its feet.
- Stems in corners: squares up to the crease with knees out over each foot.
- Presses on holds down by the hips: rockovers, hand-foot matches and mantles.

**Grades**
- Arête face holds pull off-axis while the body straddles the edge.
- A move just past static reach is a deadpoint, not a grade cliff.
- A rest hold mid-route clears the pump.
- Footholds bolted sideways or upside down are poor feet.

**Holds**
- Crimps, edges and jugs have hand-sculpted, wavy lips.
- Slopers are cast domes with a low crest and a flared skirt.
- Pinches are sculpted rib pinches with a spine, finger ribs and a thumb dimple.
- Shoe rubber scuffs on footholds.

**Walls**
- Belly: a slabby start, a steep bulge mid-height, then stand up onto a slab.
- Overlap: a slab with a short roof band to pull over and mantle past.
- Ledge: a mantle shelf across a near-vertical wall with a short headwall above.

**Game**
- Neighbouring gym walls carry real routes with tape and grade tags.
- Playback controls: 1×/2×/4× speed and Skip on the climb ticker.
- Result card: a grade scale shows where each test landed against the brief.
- Playtest fixes: clearer start and finish, a grade guide, examples, bigger holds and a
  better phone layout.
- Phones: the floor no longer draws over the crash pad on wide walls; landscape layout,
  no ghost taps on the spot picker, and the action bar fits.
- First-run tour: a spotlight walks new players over Start, Finish, tray and Test.
- Example gallery: four hand-built climbs to watch, linked from the help and grade guide.

## 2026-10-01

**Climber**
- Real movement: barn-door, flagging and drop knees.
- Less jitter: the strain shake is gone and the flag side stays fixed for each move.
- Moves like a climber: straight arms, hips in, real drop knees and heel hooks.
- High steps cost effort, and the climber shifts weight before moving a foot.
- Arms move like a climber's on sidepulls, gastons and underclings.

**Grades**
- Realistic reach: lock-offs limit upward reach and dynos are smaller (dynos to the finish
  are still allowed).
- Calibration covers wall shapes; stemming takes load off the arms.
- Pump only counts when the moves are actually hard.
- Overhang load grows with sin² of the wall angle.
- Incut edges hold on overhangs, shallow crimps open up, and the stretch penalty is gentler.
- Toe hooks: a foot far out to the side hooks behind a hold that faces away.
- Gastons are strenuous, not impossible.
- Faster solves through reach pre-checks.

**Holds**
- Chalk builds up where hands grip, and extruded holds are no longer inside out.
- Pinches are rounded fins and slopers are low domes.
- Sandy grit texture and countersunk hex bolts.
- Pockets have a real finger hole with a rim, walls and a hooded lip.
- Foot chips have a real shelf and screw; jibs look like chipped stone.

**Walls**
- Arêtes, which can't be climbed bare, with contacts every 40 cm.
- Heel hooks and bulge walls.
- Cave: a vertical base, a near-roof section and a lip onto a headwall.
- Prow: an overhanging arête.
- Steep corner: an overhanging dihedral.
- Scoop: a faceted wave that steepens from slab to overhang.
- Rollover: an overhang that tops out over a rounded lip onto a slab.

**Game**
- Phone polish: pinned help button, two-column hold legend, tighter portrait framing; help
  mentions wall types and beta tags.
- Undo and redo for route setting.
- Test results say how far off you are and what to change.
- Reach guide: see how far the climber can reach while placing a handhold.
- Start and finish holds are the setter's pick; only their tape spots are fixed.
- Right-drag pans the camera, and the hint says how.
- The brief card gives wall angles their own line; tidier mobile layout.
- README notes that main auto-deploys to topout.anselmlong.com.

## 2026-09-30

**Grades**
- Accurate grades from a log curve fitted to reference problems; taller walls; days
  regenerated.
- Matching needs room: hands and feet only share big holds, with a small shuffle cost.
- Realer solver: edges and jibs, pinch direction, no dabbing, costlier reach.

**Holds**
- One colour per route, like a commercial gym; jugs rebuilt with a visible scoop.
- Volumes: pyramids and wedges that change the wall angle, in every daily tray.

**Walls**
- Dihedral corner walls, now in the daily rotation.

**Game**
- The climber has a face and an outfit.
- Volume clicks no longer fall through to the wall, and starts are placed by real height.
- Orbit keeps going when a drag sweeps over a hold; holds only claim the mouse when editable.

## 2026-09-29: first version

- Solver: a four-limb bottleneck search with a grade model.
- Daily generator, placement rules and curation script; 120 curated days.
- 3D scene, climber, HUD, modals, saves and sharing.
- Drag holds from the tray, stats only for today, practice mode and an archive.
- Free camera: left-drag orbits, and dragging a placed hold still moves it.
- Physics climber with a beta overlay, climb ticker, chalk, sound and gym scenery.
- Idle climber, crux slow-mo, landing shake, high-step posture and a mobile layout.
