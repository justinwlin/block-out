# Block Out — design brief

Justin's Block Out: a sliding-brick puzzle. Drag a piece through open space. If it reaches a gate of its own color and its span matches the gate, it leaves. Clear the board before the timer hits zero. Levels are infinite, seeded, and checked by a solver.

This is an original game in that genre (Grand Games' *Block Out!* and the wider color-block-jam family). Rules below were checked against the App Store text, the [Player Guidebook](https://playerguidebook.com/block-out-color-sort-puzzle/how-to-play) summary, and the public obstacle lists for Color Block Jam. No assets, namesakes, or store copy are reused.

## Core loop

1. Read the board: piece colors, gate widths, anything frozen, locked, or shuttered.
2. Drag pieces aside until one has a straight run at a matching gate.
3. That piece exits. Counters tick down. Shutters and ice may open.
4. Repeat until the tray is empty, or the clock runs out.
5. Bank coins, then play the next level. Retry is free.

## Rules

- The tray is a grid. Walls and closed shutters are solid. Pieces are polyominoes (1×1, bars, square, L, T, S, plus) and translate; they never rotate or hop.
- A drag is one straight slide, any distance, stopping on contact. Releasing snaps to the grid.
- A piece exits in that same drag when its bounding span **equals** the gate's span, it is lined up with the gate, the gate color matches, and the gate is open. The whole piece leaves; it never sits half-out.
- Pieces of one color may share a gate. Order is the puzzle.
- Every piece on the level, including pieces still behind a shutter, must exit.

## Mechanics

| Mechanic | In v1 | Behavior |
|---|---|---|
| Color gates and straight slides | Yes | Core rule above. |
| Polyominoes | Yes | Introduced from monominoes up to T, S, and plus. |
| Timer, retry, level select, save | Yes | Clock pauses in menus. Progress, coins, stars, and a mid-level snapshot sit in `localStorage`. Settings has a Timer switch (also on the pause screen). Off: no countdown, no time-out, the clock and the freeze booster are hidden, and the level can still be cleared. The choice is saved. |
| Multi-compartment trays | Yes | U-notch and a split tray. Each pocket has its own gates. |
| Checkerboard | Yes | Ink and paper only, one gate each. The work is ordering. |
| Ice bricks | Yes | Frozen until enough other pieces have left. The number is the remaining count. |
| Ice gates | Yes | Same countdown, on the gate. |
| Keys and padlocks | Yes | A key is printed on a brick. It counts when that brick exits. A padlock cannot move until enough keys are out. |
| Shuttered rooms | Yes | A crowned plaque counts down as pieces leave. At zero the shutter opens and the bricks inside join the puzzle, with their own gate. |
| Coins | Yes | Won by clearing. Spent only on boosters. |
| Clock booster | Yes | Stops the timer for 15 seconds. 300 coins. |
| Rocket | Yes | Destroys one chosen brick and counts as a clear. 600 coins. |
| UFO | Yes | Destroys every brick of one color. 1,200 coins. |
| Elevators, generators, bombs, ropes, layered skins, one-way arrows, moving locks, grinders | No | Real *Block Out!* / Color Block Jam toys. Left out so generation stays solvable and the solver stays fast. |
| Lives, ads, rewarded video, coin packs | No | Not this game. |

Boosters are convenience, never a toll. A level the solver can clear is a level a player can clear without spending.

## Controls

- Phone: touch a brick, drag along a row or a column. The axis locks after a few pixels. The piece stops when it hits something, and it leaves if the drag carries it into its gate.
- Desktop: the same gesture with the mouse. Esc pauses. Buttons are the same size as on a phone.
- Timer is on by default. Turn it off in Settings, or from the pause screen, to play with no clock. That hides the time and the freeze booster. Rocket and UFO stay. The switch is remembered.
- A frozen, locked, or hidden brick rejects the grab with a soft bump and a tint. The screen does not shake.

## Game feel

- The drag is continuous, clamped to free cells, then snapped. A short settle plays on release.
- An exit eases out of the gate: a little squash, a few motes, a soft blip, a haptic tick. No screen shake.
- Ice cracking, a lock opening, and a shutter lifting each get their own sound. A clear is a calm chime, stars, and a coin count, not a burst of particles.
- Haptics use `navigator.vibrate` where it exists, and the hidden-switch tick on iPhone (same idea as the sibling games).
- Sound is synthesized in Web Audio. No music bed, so the timer stays easy to hear.
- Reduce motion skips squash and the few motes.
- Win and fail are full screens: stars, coins, retry, next. Retry does not ask for anything.

## Progression

- Level 1 is three bricks and one or two colors. The hint is on the tray.
- New toys arrive on a schedule: ice bricks (8), U trays (14), ice gates (16), split trays (18), locks (22), shutters (30). Checker trays show up on levels ending in 9, from 9.
- Every 5th level is a **Warmup**: fewer bricks, a looser clock.
- Other levels are **Normal**, **Hard**, or **Super Hard** from the solver's score, not from the level number alone.
- Beating a level unlocks the next. Earlier levels stay open. Stars: three if you still have 40% of the clock and bought nothing, two for a clean clear, one if a booster was used.
- Coins start at 900 so the clock booster is tryable without a grind.

## Difficulty and how levels are built

Generation is deterministic: level \(n\) comes from `hash32("block-out:" + GEN_VERSION + ":" + n)` and mulberry32. Same phone, same level, same tray.

The search problem is the same family as Rush Hour and Klotski. Sliding-block motion planning is PSPACE-complete in general (Hearn & Demaine, 2005; Flake & Baum, 2002, for the Rush Hour special case), so we do **not** search the open world and hope.

**Reverse construction.** Murase, Matsubara, and Hiraga (1996) built Sokoban levels by playing backward from a solved warehouse. The same idea, in the form Rush Hour generators use:

1. Start from an empty tray and a gate.
2. Un-exit a piece onto that gate, then slide it backward into a parking spot (a straight pull, then sometimes a tuck).
3. Repeat. Pieces placed earlier are the ones that leave later, so each un-exit is checked against the bricks that will still be sitting there.
4. Ice, locks, ice gates, and shutters are written down only where that recorded solution already waits long enough. A frozen brick is never asked to move before it thaws.

The recorded line is a witness. Replaying it is the first proof.

**Forward solver.** A real search then ignores the witness and solves from the start:

- State is the coordinate of every brick still on the tray, packed into a bigint (the usual Rush Hour hash: one configuration, one key).
- An operator is one drag of any distance, the macro-move Rush Hour solvers use, not a cell-by-cell crawl. The search keeps every maximal slide and any shorter slide that lines a brick up with a gate.
- **Monotonic exits.** Leaving frees cells and only opens ice, locks, and shutters. It never helps to delay an exit that is already clear. The solver takes those exits immediately (lowest id, no branching) and only searches the setup slides. That reduction is valid for this ruleset, not for sliding blocks in general.
- A beam search (width 36, a few setups deep) finds a solution fast. **A\*** then tries to shorten it (Hart, Nilsson, Raphael; same admissible family as Korf's IDA\*). Heuristic: bricks not yet out. It never overestimates, and the first goal it can prove is a minimum. If the time budget runs out first, the beam solution stands. It is still a forward search, and its length is an upper bound on the minimum, which is what the clock is fit to.
- A candidate the search cannot crack is thrown out. If every attempt fails, a trivial solved tray ships. Tests count how often that happens.

**What the solver reports**

| Metric | Meaning |
|---|---|
| Minimum moves | Length of the A\* solution (drags + exits). |
| Branching factor | Mean number of legal drags along that solution. |
| Dead-end ratio | Share of random playouts that reach a tray with no legal drag before the clear. |
| Forced orderings | Steps on the solution where only one drag is legal, or only one brick is allowed to leave. |

The clock and the Hard / Super Hard label are tuned from these, not from piece count alone. A reasonable player is modelled as someone who plays a shortest solution: about a second per drag, plus thinking on forced steps and on trappier trays. The clock is set so that model finishes inside it, with less slack on later levels. Warmups get extra slack. Timers land between 45 and 180 seconds.

Levers that move with the level number: tray size and shape, piece count, shape vocabulary, color count, obstacle mix, how often a tuck is required, and how tight the clock sits on the player model. Warmups pull the piece count back down.

## Simulation

Same split as the sibling games: `src/sim` is pure and headless, `src/game` is pixels and sound.

- `npm test` rebuilds levels 1–500, replays each witness, runs the solver, and checks solvability, determinism, the clock margin, and that a difficulty score trends up.
- `npm run sim -- [levels]` plays the solver model, a greedy agent, and a random agent. It writes `sim-out/report.json` and `sim-out/report.csv` plus a banded summary: solve rate, moves, modelled time against the clock, and the four metrics.

## Art direction

A walnut table and a cream plastic tray. Bricks are chunky, beveled, and studded, in coral, blue, lime, gold, violet, and teal. Each color also has a small symbol so the tray still reads without hue. Gates are colored mouths with a chevron. Ice is frost and a numeral. Locks are brass. Shutters are slats with a crowned plaque. Checker levels are ink and paper only. Nothing is traced from the commercial game.

## What we deliberately do differently

- No ads, no lives, no rewarded video, no store, no paywall. Coins come from playing.
- Levels are generated and proved, not hand-authored and sold back as packs.
- Retry and level select are always free. Boosters never gate a clear.
- The clock is fit to a player model that already has a solution, so "Super Hard" means a tighter puzzle, not a timer that requires a purchase.
- Installable, offline, and sized for a phone. The play URL is the whole distribution.

## Sources

- Hearn, R. A., & Demaine, E. D. (2005). PSPACE-completeness of sliding-block puzzles. *Theoretical Computer Science*, 343(1–2).
- Flake, G. W., & Baum, E. B. (2002). *Rush Hour is PSPACE-complete*. The Rush Hour encoding: configurations hashed by piece coordinates, a slide of any distance as one operator.
- Korf, R. E. (1985). Depth-first iterative-deepening: an optimal admissible tree search. *Artificial Intelligence*, 27(1). We use A\* with the same admissible style of heuristic.
- Murase, Y., Matsubara, H., & Hiraga, Y. (1996). Automatic making of Sokoban problems. *PRICAI '96*. Reverse play from the solved state.
- Grand Games, *Block Out!* store listing and the Player Guidebook how-to (doors, space, elevators, generators). Color Block Jam help center (ice, iced doors, chains and keys). Those lists are the menu we picked from.
