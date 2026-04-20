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
                                              │
                                              │ registers
                                              ▼
                                        ┌──────────────┐
                                        │ SceneManager │
                                        │  ┌────────┐  │
                                        │  │  Hub   │  │
                                        │  │ Scene  │  │
                                        │  └────────┘  │
                                        │  ┌────────┐  │
                                        │  │Results │  │
                                        │  │ Scene  │  │
                                        │  └────────┘  │
                                        │  (Game +     │
                                        │  6 hub-tab   │
                                        │  scenes +    │
                                        │  6+ minigame │
                                        │  scenes: PRs │
                                        │  3 onward)   │
                                        └──────────────┘

   ┌──────────────┐    change    ┌──────────────┐
   │  MetaState   │ ───────────▶ │ Persistence  │
   │  (pure)      │              │ (localStorage)│
   └──────▲───────┘              └──────────────┘
          │ hydrate / read
          │
   ┌──────────────┐                     ┌──────────────┐
   │  missions    │                     │  audio       │
   │  (pure)      │                     │              │
   └──────────────┘                     └──────────────┘

   ┌──────────────────────────────────────────────────┐
   │              main.js (orchestrator)              │
   │  constructs state + meta + view, wires events,   │
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

`buildMissions({ seed })`, `findMission(list, id)`, `pickMissionBoard(missions, { count, seed })`, `baseCreditsFor(tierIndex)`, `ORES`, `ORE_BY_COLOR`, `MISSION_TYPES`. Seeded Mulberry32 for deterministic asteroid-name rolling and for the risk-stratified MISSION BOARD subset roll. Every mission also carries narrative metadata (`narrativeName`, `type`, `sector`, `risk` 1–5, `etaLabel`) that the hub MISSION BOARD cards render on top of the underlying tier archetype. No side effects.

### `src/audio.js`

WebAudio tone generators. Wired to state events from `main.js`.

### `src/meta-state.js` — pure

Persistent player profile. Owns **credits**, **hub resources** (O₂, fuel, minerals, warp), **per-color ore counts** (6 ores, one per tile color), **fleet roster** (ship id / name / class / hull % / status), **crew roster** (id / name / role / level / status), **reputation tier**, and **completed mission ids**. Emits a `change` event with `{ kind, detail }` on every mutation so `Persistence` saves and `PixiView` re-syncs the top-bar chips without a full rebuild.

Exposes reads (`credits`, `getHubResource(id)`, `getOre(color)`, `fleetSnapshot()`, `crewSnapshot()`, `snapshot()`) and writes (`setCredits`, `addCredits`, `addOre`, `applyMissionReward`, `setShipHull`, `setShipStatus`, `setCrewLevel`, `setCrewStatus`, `setReputationTier`). Constructor takes an optional hydrated blob and shallow-merges it onto the starter profile so malformed saves fall back to defaults instead of breaking the game.

### `src/persistence.js`

Versioned localStorage wrapper for the `MetaState` snapshot. One key — `stellarVentureSaveV1` (exported as `STORAGE_KEY`). Every method (`load`, `save`, `clear`) is non-throwing: SSR / private-mode Safari / quota-exceeded / unparseable blobs all return a safe default so the game keeps booting. Refuses to hydrate a blob with a mismatched `version` — the caller falls back to the starter profile and the next save overwrites the bad blob. Storage is dependency-injected (`new Persistence({ storage })`) so tests pass a `createMemoryStorage()` fake.

### `src/run-ledger.js` — pure

Per-run tally. `new RunLedger({ state, mission })` subscribes to `match-cleared`, `bomb-exploded`, and `lines-cleared` on a `GameState`, maps each cleared cell through the tile-colour → ore-id identity (`ORE_IDS` from `meta-state.js`), and accumulates counters for matches / bombs / lines / cells + the 6 ore buckets. `summary(state)` rolls up mission metadata + a `credits = baseCredits + floor(score/10)` payout. `rewardEnvelope(summary)` returns the exact shape `MetaState.applyMissionReward(...)` consumes. `detach()` unsubscribes safely.

Zero Pixi / DOM imports — the ledger is pure data, same contract as `GameState`. `src/main.js` owns the ledger's lifecycle: create on start, summarise on game-over, hand the summary to `PixiView.showResultsScreen`, and call `detach()` before awaiting the player's CONTINUE tap. See [`GAMEPLAY.md`](GAMEPLAY.md) for the credits formula + event-to-ore table.

### `src/pixi-view.js`

The only DOM/Pixi/visual code. Subscribes to GameState. Owns:

- Pixi `Application`, stage hierarchy, and the `#gameContainer` mount
- Starfield + scanner
- Title bar with reactive "STELLAR VENTURE" star actor
- `SceneManager` + registered `HubScene` + `ResultsScene` (see below). Public API (`showStartScreen`, `showGameScreen`, `showResultsScreen(summary, {onContinue})`, `hideResultsScreen`, `onStartGame`) delegates to the manager and handles the cross-scene visibility dance (hide/show the in-game HUD + top controls around whichever overlay is up).
- Game-run scene (board layers, active piece, effects, particles) — still inline; extracts to `GameScene` in PR 3
- HUD columns (score / level / tips / controls), piece previews, sound/exit top controls
- Shared Pixi helpers (`_drawHologramPanel`, `_redrawHologramPanel`, `_buildStartButton`, `_panelLabel`, `_drawStarShape`) — injected into scenes by reference; move to a standalone `pixi-ui-kit.js` module once 2+ scenes need them directly

Input — keyboard + pointer — flows through `src/input.js` and into GameState actions. View never runs game logic.

### `src/scenes/scene-manager.js`

Tiny registry (~70 lines, zero Pixi imports). `register(name, scene)` / `show(name, ...args)` / `hide(name)` / `isVisible(name)` / `layout(screen)` / `destroy()`. Scenes are duck-typed — any object exposing `show` / `hide` / optional `layout` / optional `destroy` / read-only `visible` works. `layout(screen)` fans out to **every** registered scene (hidden or not) so a scene re-shown after a viewport resize doesn't flash at the old size. Unit-tested with plain-object fakes (see `tests/scene-manager.test.js`).

### `src/scenes/results-scene.js`

Mission-report overlay, extracted from `PixiView` in the first scene-graph PR (see ADR-0009). Owns its Pixi `Container`, attaches to a `uiRoot` passed at construction. Builds lazily on first `show`, reuses its text nodes across runs via a `_populate(summary)` helper so subsequent runs don't re-create the stat grid.

Constructor shape:

```js
new ResultsScene({
    app,                    // Pixi Application (read-only; for screen rect)
    uiRoot,                 // Pixi Container to attach into
    drawHologramPanel,      // shared panel-chrome helper (still on PixiView)
    buildStartButton,       // shared button helper (still on PixiView)
    palette,                // CELL_PALETTE for ore icon tints
});
```

Shared helpers are passed in by reference so scenes don't import from `PixiView` (no circular imports). Once GameScene lands in PR 3, the helpers move to a standalone `pixi-ui-kit.js` module.

### `src/scenes/hub-scene.js`

Viewport-filling "Chief Dispatcher HQ" main menu, extracted from `PixiView` in the second scene-graph PR (see ADR-0009). Owns the top STELLAR VENTURE bar + 5 resource chips, GALACTIC NEWS ticker, ACTIVE MISSIONS left column, galactic-map center panel, FLEET & CREW right column, 6-tab bottom nav, and the MISSION BOARD modal overlay. Builds lazily on first `show`; the entire Pixi tree hangs off a single `_nodes` struct so reset / re-layout / destroy are one-liners.

Ticker-animated: `hub.tick(deltaMs)` is driven from the PixiView `app.ticker` and advances the news-ticker scroll. MetaState-aware: subscribes to `meta.on('change', ...)` on first build, so any `applyMissionReward(...)` call repaints the top-bar resource chips automatically without PixiView intervention.

Constructor shape:

```js
new HubScene({
    app,                    // Pixi Application (read-only; for screen rect)
    uiRoot,                 // Pixi Container to attach into
    meta,                   // MetaState (read-only; subscribed for `change`)
    drawHologramPanel,      // shared panel-chrome helper
    redrawHologramPanel,    // shared panel-resize helper
    buildStartButton,       // shared button helper
    panelLabel,             // shared text-label helper
    drawStarShape,          // shared star-icon helper
});
```

Public API consumed by `PixiView`:

- `setStartGameCallback(fn)` — forwards from `PixiView.onStartGame(fn)`. Fires when a mission card's ACCEPT button is tapped.
- `getStartState()` — returns the currently-selected mission's `{ mode, complexity, fieldSizeId, selectedMissionId }`. Game-HUD tier colour + size-multiplier readouts read this.
- `getMissions()` — returns the deterministic per-boot mission catalog (same `buildMissions({ seed })` call the old start screen used).

All hub constants (`HUB_TABS`, `HUB_RESOURCES`, `HUB_NEWS_POOL`, `HUB_RISK_PRESETS`) moved with the scene. PixiView no longer imports `missions.js` — the scene owns the catalog.

### `src/pixi-starfield.js`

Factory for the starfield container. Composition (bottom → top):

1. **Optional cinematic backdrop sprite** (`assets/hub-backdrop.jpg`). Cover-fits the viewport, 0.82 alpha with a cool tint, drifts a few pixels on the starfield clock for subtle parallax. If no backdrop texture is passed, this layer is skipped and the rest of the field falls back to procedural-only.
2. **Baked nebula `RenderTexture`.** 4 multi-lobed cloud systems tinted from the teal / cyan / ember palette (`NEBULA_TINTS`) to reinforce the backdrop; alpha is 0.6 when a backdrop is present, 0.92 when not.
3. **Density-based star layer** sized to the viewport — ~`0.00045` stars/pixel, clamped to `260–1100`. Each star samples a power-law luminance roll; the top band (`lum > 0.85`, ~4.7% of stars) renders with a subtle 4-ray sparkle texture, the rest with a soft pinprick texture. Star twinkle is slow (`0.0003–0.0014` rad/ms) and softly amplitude-modulated so stars glimmer rather than throb.

Exports `createPixiStarfield(app, { width, height, backdropTexture }) → { container, update(dt), destroy() }`.

### `src/main.js` — orchestrator

- Constructs `GameState`, `PixiView`, `Audio`, `MetaState`, `Persistence`.
- Calls `view.init()` (async), `view.createBoard()`, `view.createPreviews()`.
- Wires `view.onStartGame({ mission, ... })` → builds a `RunLedger` for the run → `state.configure(...)` → `state.start()`. Tears down any stale ledger from a quit-early run before the new one attaches.
- Wires `state.on('game-over')` → `ledger.summary(state)` → `view.showResultsScreen(summary, { onContinue })`. CONTINUE applies the reward envelope (`meta.applyMissionReward(...)`) + returns to the hub. If the run started without a mission (sandbox boot) the results overlay is skipped.

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
    │  summary  = ledger.summary(state)        // + credits = baseCredits + floor(score/10)
    │  envelope = ledger.rewardEnvelope(summary)
    │  ledger.detach()
    │  view.showResultsScreen(summary, { onContinue })
    │
    ▼
player clicks CONTINUE
    │
    ▼
main.js:
    │  meta.applyMissionReward(envelope)   // fires 'change' + 'mission-reward'; Persistence saves
    │  view.hideResultsScreen()
    │  view.showStartScreen()              // hub top-bar chips auto-repaint from MetaState
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
