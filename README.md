# Block Out

**▶ Play it: https://block-out-ekg.pages.dev/**

Mirror: https://justinwlin.github.io/block-out/ (GitHub Pages caches for up to 10 minutes, so updates land slower there).

A sliding-brick puzzle. Drag a brick through the tray and out the gate of its color, if it fits. Clear every brick before the clock runs out. It's a PWA: phone and desktop, installs to the home screen, and plays offline.

Levels are generated. Level 500 is the same tray on every device, and there is always another one after it.

## How to play

- Drag a brick along a row or a column. It slides until it hits something, then snaps to the grid.
- A gate takes a brick of its own color when the brick's span matches the opening. Drag it in and it leaves.
- Ice, padlocks and crowned shutters wait on a count. The count drops as bricks leave. A shutter at zero opens a pocket of new bricks.
- Some trays are split, or bent into a U, or ink-and-paper only. Those are ordering puzzles.
- Coins from a clear buy a clock (the timer stops), a rocket (one brick) or a UFO (one color). Turn **Timer** off in Settings, or on the pause screen, to play with no countdown and no time-out. The clock booster hides while that's off. Retry is free. There are no ads and nothing to buy.

On a phone, turn Haptics on in Settings. Android vibrates; iPhone ticks when the switch under a tap allows it.

## Mechanics as you go

| From level | Mechanic |
|---|---|
| 1 | Gates, a clock, coins |
| 3 | Bars |
| 8 | Ice bricks |
| 9, then every tenth ending in 9 | Checker tray: ink and paper |
| 14, then every 7th | U-shaped tray |
| 16 | Ice on a gate |
| 18, then every 9th | Two pockets |
| 22 | Keys and padlocks |
| 30, then every 6th open tray | Shuttered room |
| every 5th | **Warmup**: fewer bricks, a looser clock |

Hard and Super Hard come from the solver, not from the level number alone.

## Levels

Every tray is built backwards from the gates, then a forward search has to solve it before it ships. The search reports minimum moves (when A* finishes), branching, dead ends and forced steps. The clock is fit to a player who follows a short solution, with less spare time on later levels. See [docs/BRIEF.md](docs/BRIEF.md).

```bash
npm test                 # witness replay, forward search, clock, difficulty curve for levels 1–500
npm run sim -- 200       # solver, greedy and random agents; writes sim-out/report.csv
```

## Development

```bash
npm install
npm run dev        # Vite on 0.0.0.0:5173
npm test
npm run sim -- 200
npm run build      # type-check, PWA, dist/
```

Pushing to `main` runs the tests and publishes to GitHub Pages (the `gh-pages` branch). The Pages setting has to be "Deploy from a branch" → `gh-pages` → `/ (root)`.

More detail: [docs/development.md](docs/development.md). Design notes: [docs/BRIEF.md](docs/BRIEF.md).
