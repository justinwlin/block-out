# Development

## Layout

| Path | What it is |
|---|---|
| `src/sim/rules.ts` | Slides, gates, ice, locks, shutters. No DOM. |
| `src/sim/levelgen.ts` | Seeded reverse construction, clock, labels. |
| `src/sim/solver.ts` | Forward search: free exits, then beam and A*. |
| `src/sim/bots.ts` | Random and greedy agents, dead-end samples. |
| `src/sim/feel.ts` | Event → shake, haptic, particles. |
| `src/game/` | Canvas, Web Audio, haptics, save. |
| `src/main.ts` | Screens, drag, loop. `window.__blockout` is the test hook. |
| `scripts/sim-report.ts` | Banded bot report. |
| `tests/` | Rules, feel, and levels 1–500. |

`src/sim` is deterministic. Same level number, same tray. Don't read the clock or `Math.random` in there (particles in `src/game` may).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Rules, feel, witness replay, forward search, clock margin, and the difficulty trend for levels 1–500. |
| `npm run sim -- 200` | Solver, greedy and random agents. Prints a table and writes `sim-out/report.json` and `sim-out/report.csv`. |
| `npm run dev` | Dev server on 0.0.0.0:5173. |
| `npm run build` | `tsc --noEmit` and the Vite PWA build. |
| `npm run icons` | Renders `public/icons/` from `icon.svg`. Needs Playwright. |
| `npm run og` | Renders `public/og.png` (1200×630). Needs Playwright. |
| `npm run shots -- <url>` | Gameplay screenshots into `e2e-out/`. Start a server first. |

## Generator

`GEN_VERSION` in `src/sim/levelgen.ts` is part of the seed. Bump it when trays should change; saves keep coins and unlocked levels and drop a mid-level snapshot.

A level that the search cannot crack is replaced by a three-brick tray and flagged `fallback`. `npm test` fails if that happens often.

## Deploy

`.github/workflows/deploy.yml` tests, builds, and pushes `dist/` to `gh-pages` on every push to `main`.

GitHub Pages: Settings → Pages → Deploy from a branch → `gh-pages` → `/ (root)`. The site is https://justinwlin.github.io/block-out/.
