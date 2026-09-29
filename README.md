# Topout

A daily route-setting puzzle. Everyone gets the same wall, hold set, and brief
("Set a V4"). Place holds, send the climber up for a test, land the grade with
as few holds as you can. See [SPEC.md](SPEC.md) for the design.

```sh
npm install
npm run dev        # http://localhost:5173  (?day=N to jump to a day)
npm test           # solver + rules tests
npm run build      # typecheck + production build to dist/
npm run curate -- --from 1 --days 120   # regenerate public/days/*.json
```

## Layout

| Path | What |
| --- | --- |
| `src/solver/` | Grading. `model.ts` holds every tuning constant; `solve.ts` is the two-pass four-limb search; runs in a Web Worker via `client.ts`. |
| `src/gen/` | Seeded daily generator (wall, start/finish, tray, target grade, twist). |
| `src/game/` | Placement + scoring rules, share text, route links. Shared by UI and curation. |
| `scripts/curate.ts` | Proves each day solvable and computes par. Writes `public/days/N.json`. |
| `src/scene/` | React Three Fiber scene: wall, procedural holds, IK climber. |
| `src/ui/`, `src/state/` | HUD, modals, Zustand store, localStorage. |

## Known limits

- **Grades are uncalibrated.** The constants in `src/solver/model.ts` were
  tuned against intuition (vertical jug ladder ≈ V0–1, crimps on 20° ≈ V5–6),
  not real data. Expect to tune them after climbers play it.
- **Par is the best route the curation search found**, not a proven minimum.
  Players can beat it, which is fine but should be spot-checked.
- Days past the curated archive (#120 = 2027-01-26) fall back to uncurated
  generated days with no par. Run `npm run curate` to extend.
- Day #1 is 2026-09-29 (`EPOCH` in `src/gen/day.ts`).
