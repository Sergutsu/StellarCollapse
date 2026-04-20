# Architecture

> The **how** of the code. For the **what** of the game, see `DESIGN.md`. For tunable numbers, see `GAMEPLAY.md`.

---

## Guiding principles

1. **Pure state, thin view.** `GameState` has no DOM, no timers, no `Math.random()` calls at rule boundaries — it takes a seeded RNG + a scheduler as params. The view subscribes to state events and never reaches into state internals.
2. **One renderer.** Pixi.js v8, full stop. No DOM board, no `<canvas>` fallback, no `?engine=*` flag, no legacy renderer "just in case". See `adr/0001-pixi-only-renderer.md`.
3. **No build step.** ESM import map in `index.html` pulls Pixi from jsdelivr. GitHub Pages serves the repo as-is. Vite / bundler / `dist/` would be an architecture change requiring an ADR.
4. **No feature flags left behind.** When a migration / port completes, the fallback path is deleted in the next cleanup PR. Dead code is a liability, not a safety net.
5. **Tests are pure.** `node --test` only. Zero runtime deps for testing. `GameState` and `missions.js` both have test suites. View is intentionally not unit-tested — it's the only place we accept visual/manual verification.
6. **localStorage is versioned.** Any new persisted state gets a versioned schema and an auto-migration path on load. No silent data loss, no manual "nuke your save" instructions.

---

## Module graph

```
   ┌──────────────┐       events        ┌──────────────┐
   │  GameState   │ ──────────────────▶ │  PixiView    │
   │  (pure)      │                     │              │
   └──────────────┘                     └──────┬───────┘
          │                                    │
          │                                    │ owns
          ▼                                    ▼
   ┌──────────────┐                     ┌──────────────┐
   │  constants   │                     │  pixi-       │
   │              │                     │  starfield   │
   └──────────────┘                     └──────────────┘

   ┌──────────────┐                     ┌──────────────┐
   │  missions    │                     │  audio       │
   │  (pure)      │                     │              │
   └──────────────┘                     └──────────────┘

   ┌──────────────────────────────────────────────────┐
   │              main.js (orchestrator)              │
   │  constructs state + view, wires events,          │
   │  owns the GameState ↔ screen-transition seam     │
   └──────────────────────────────────────────────────┘
```

### `src/constants.js`

Canonical values: palette, tier list, field sizes, complexity tuning, scoring multipliers. **Read from everywhere, written from nowhere at runtime.** Tunable — every change is paired with a `GAMEPLAY.md` update.

### `src/emitter.js`

20-line event emitter. `{ on, off, emit, removeAll }`. Used by GameState and view. No wildcard, no namespacing, no `once`. If we ever need them, write them.

### `src/game-state.js` — pure

Owns the board, the active piece, score, level, lines, specials, timers. Emits named events (grep `emit(` in `src/game-state.js` for the authoritative list):

- **Piece:** `piece-spawned`, `piece-moved`, `piece-rotated`, `piece-hard-dropped`, `piece-locked`
- **Board:** `floating-changed`, `gravity-applied`
- **Clears:** `match-detected`, `match-cleared`, `lines-cleared`
- **Specials:** `special-armed`, `special-expired`, `special-moved`, `special-cleared`, `special-cleared-all`, `bomb-detonating`, `bomb-exploded`, `snake-activated`
- **Score:** `score-changed`, `level-up`
- **Lifecycle:** `game-started`, `game-over`

**Constructor takes:** `{ cols, rows, fieldSizeId, rng, schedule, mode, complexity, specialArmMs }`. Tests inject deterministic `rng`, a synchronous `schedule` fake, and `specialArmMs: 0` to disable the bomb/snake arming timer. Never calls `Math.random()` or `setTimeout` directly.

### `src/shapes.js` — pure

Piece shape pool per complexity. Read-only.

### `src/missions.js` — pure

`buildMissions({ seed })`, `findMission(list, id)`, `ORES`, `ORE_BY_COLOR`, `baseCreditsFor(tierIndex)`. Seeded Mulberry32 for deterministic asteroid-name rolling. No side effects.

### `src/audio.js`

WebAudio tone generators. Wired to state events from `main.js`.

### `src/pixi-view.js`

The only DOM/Pixi/visual code. Subscribes to GameState. Owns:

- Pixi `Application`, stage hierarchy, and the `#gameContainer` mount
- Starfield + scanner
- Title bar with reactive "STELLAR VENTURE" star actor
- Mission-select scene (cards, dispatcher identity card)
- Game-run scene (board layers, active piece, effects, particles)
- HUD columns (score / level / tips / controls), piece previews, sound/exit top controls

Input — keyboard + pointer — flows through `src/input.js` and into GameState actions. View never runs game logic.

### `src/pixi-starfield.js`

Factory for the starfield container. Baked nebula `RenderTexture`, 160 blinking dot stars, 24 cross-sparkle stars. Exports a `{ container, update(dt) }`.

### `src/main.js` — orchestrator

- Constructs `GameState`, `PixiView`, `Audio`.
- Calls `view.init()` (async), `view.createBoard()`, `view.createPreviews()`.
- Wires `view.onStartGame()` → `state.configure(...)` → `state.start()`.
- Wires `state.on('game-over')` → `view.showStartScreen()` (P1 will route through a results scene first).

This is the one file allowed to glue state and view together. Keep it thin.

---

## Event flow (one full run)

```
user clicks mission card
    │
    ▼
PixiView._onMissionCardTapped(mission)
    │  calls _onStartGameRequested({ mode, complexity, fieldSizeId, missionId })
    ▼
main.js onStartGame handler
    │  state.configure({mode, complexity, fieldSizeId})
    │  view.createBoard()
    │  state.start()
    ▼
GameState emits 'game-started' + 'piece-spawned' + 'piece-moved'
    │
    ▼
PixiView repaints only changed cells + active piece layer

... gameplay loop ...
    │  each piece-lock emits piece-locked then either
    │    lines-cleared (Blocks), match-cleared (auto-match sweep),
    │    or nothing; Stellar match-cleared fires on player click.
    │  view handlers are O(cells changed), never O(board)

    ▼
GameState emits 'game-over' { score }
    │
    ▼
main.js:
    │  view.showStartScreen()   // P1 will route through a results scene first
```

---

## Rendering rules

- **Cells are reusable `Graphics` instances**, stored in a `cells[y][x]` grid. On `board-changed`, diff against the prior snapshot and recolour only changed cells. Never destroy + recreate on every change.
- **The active piece layer is the only layer that updates on `piece-moved`**. Board + effects don't repaint on move.
- **Effects use a pooled particle system.** Match explosions, bomb shrapnel, snake trail circles are all recycled `Graphics` objects. No churn, no GC spikes.
- **Low-fx mode** kicks in past `LOW_FX_CELL_THRESHOLD` cells: skip per-cell pulse tickers, skip the floating-cell dashed stroke tween. Everything still renders correctly; just fewer per-frame updates.
- **Don't call `Graphics.clear()` + `redraw()` per frame on static tiles.** Only active piece and active effects get per-frame updates.

### Why Pixi won

See `adr/0001-pixi-only-renderer.md`. Short version: DOM-per-cell + CSS animations hit a wall around 200 animated cells; our biggest board is 420 cells and we want glows and particles. Pixi handles all field sizes at 60 fps with no `.low-fx` hacks.

---

## Persistence

No persisted state **currently**. The legacy `stellarCollapseScoresV2` leaderboard was deleted with the `HighScores` module (see `adr/0005-delete-highscore-system.md`); any payload still sitting in returning players' browsers is orphaned and read by nothing.

P3 adds:

- `stellar-save:v1` — credits, ore inventory, completed missions, rep tier, settings. Versioned, self-migrating, loaded into a pure `MetaState` at boot. All persisted state lives in `src/persistence.js` (P3). Leaderboards, if they ever return, are a derived read-out of `MetaState` — not a standalone module.

---

## Testing strategy

- **Unit tests** (`node --test`, `tests/*.test.js`) cover pure modules: `GameState`, `missions`. 60 tests currently.
- **View is not unit-tested.** Visual bugs are caught by manual / scripted browser runs. Smoke tests via `enter_test_mode` on meaningful feature PRs; headless automation is a future option but not a requirement.
- **Every rule change has a test.** Bomb radius, snake length, score multipliers, level ramp, special arming-timer — all covered.
- **Determinism.** GameState takes a seeded RNG in tests. Any test that is flaky is a bug in the test, not in the code.

Run locally:

```
npm test
```

## Deployment

- `.github/workflows/tests.yml` — `node --test tests/` on every PR. Required green.
- `.github/workflows/pages.yml` — GitHub Pages deploy from `main` to `https://sergutsu.github.io/StellarCollapse/`. No build step; Pages copies the repo. Pixi is pulled via ESM import map from jsdelivr.

No Vite, no Rollup, no Parcel. Adding one requires an ADR.

---

## House rules (non-negotiables)

- **No feature flags in production.** A flag that outlived its migration is a bug.
- **No DOM in state.** GameState never calls `document`, `window`, or `setTimeout`.
- **No per-cell CSS animations on large boards.** `.low-fx` opts out; Pixi avoids the problem entirely.
- **No `?engine=*` URL flags.** The root URL is the game.
- **No `sudo` in git.** No force-push to `main`. No amending commits.
- **No unknown library.** Before `import`ing something, check that neighbouring modules already use it. Adding a runtime dep requires a matching `ARCHITECTURE.md` update.
- **No generated files edited by hand.** Use the generator / package manager. If there isn't one, write one.
- **No hard-coding around a failing test.** Either fix the test or fix the code. "Skip it for now" is never the answer.
