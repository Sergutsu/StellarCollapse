# Architecture

> The **how** of the code. For the **what** of the game, see `DESIGN.md`. For tunable numbers, see `GAMEPLAY.md`.

---

## Guiding principles

1. **Pure state, thin view.** `GameState` has no DOM, no timers, no `Math.random()` calls at rule boundaries — it takes a seeded RNG + a scheduler as params. The view subscribes to state events and never reaches into state internals.
2. **One renderer.** Pixi.js v8, full stop. No DOM board, no `<canvas>` fallback, no `?engine=*` flag, no legacy renderer "just in case". See `adr/0001-pixi-only-renderer.md`.
3. **No build step.** ESM import map in `index.html` pulls Pixi from jsdelivr. GitHub Pages serves the repo as-is. Vite / bundler / `dist/` would be an architecture change requiring an ADR.
4. **No feature flags left behind.** When a migration / port completes, the fallback path is deleted in the next cleanup PR. Dead code is a liability, not a safety net.
5. **Tests are pure.** `node --test` only. Zero runtime deps for testing. `GameState` and `missions.js` both have test suites. View *behaviour* is tested too — `tests/hub-scene-smoke.test.js` boots the real `HubScene` against a headless Pixi stand-in and drives the lifecycle (see "Testing"). What is still manual is *appearance*: no test asserts that anything looks right.
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
          │ hydrate / read                ▲ migrateSave (v1 → v2)
          │                               │
   ┌──────────────┐                     ┌──────────────┐
   │  missions    │                     │  audio       │
   │  (pure)      │                     │              │
   └──────────────┘                     └──────────────┘

   The P8 meta layer — six pure modules, read by scenes AND by MetaState.
   Clocks and entropy are arguments, never globals:

   ┌────────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐
   │ reputation │ │  daily  │ │ economy  │ │ star-map │ │ crew  │
   └─────┬──────┘ └────┬────┘ └────┬─────┘ └────┬─────┘ └───┬───┘
         │             │           │            │           │
         └─────────────┴─────┬─────┴────────────┴───────────┘
                             ▼
                     ┌───────────────┐        one immutable
                     │  settlement   │ ──────▶ settlement object
                     │  (pure)       │        per finished dispatch
                     └───────┬───────┘
                             │ applySettlement / settleActiveMission
                             ▼
                        MetaState ──▶ one `change` ──▶ one save

   research.js owns the effect bundle (`resolveEffects`) that settlement,
   economy, star-map and crew all read; idle-clock.js owns the job/offline
   maths; run-ledger.js owns the per-run summaries that feed settlement.

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

### `src/defense-state.js` — pure

Pure game logic for the defense (Space-Invaders / Breakout hybrid) mission mode. Same contract as `GameState`: construct with `{ rng, schedule }`, attach listeners via `.on()`, call `.start()`, drive with `.tick(deltaMs)`. Owns paddle, balls, invaders, boss, towers, bullets, power-ups, score, player health. Emits: `game-started`, `tick`, `ball-lost`, `invader-hit`, `invader-destroyed`, `boss-hit`, `boss-destroyed`, `powerup-collected`, `player-hit`, `tower-placed`, `laser-fired`, `game-over`. `snapshot()` returns a deep-copy snapshot for the renderer.

### `src/defense-constants.js` — pure

Shared tuning constants for the defense mode: grid size, arena dimensions, entity speeds, timing intervals, scoring values, collision radii, power-up types, invader pixel patterns. No DOM, no Pixi.

### `src/defense-input.js`

Input wiring for the defense mode. `bindDefenseInput({ state, canvas, getScale })` → teardown function. Translates keyboard (arrows/WASD, spacebar), mouse (pointermove for paddle, click for tower placement), and the held-spacebar laser loop into `DefenseState` verbs.

### `src/scenes/defense-scene.js`

Pixi scene for the defense mode. Reads from `DefenseState.snapshot()` on every tick and paints paddle, balls, invaders (pixel-art patterns), boss, towers, bullets, power-ups, health bars, score, buff strip, and bonus-progress bar. Implements the standard scene contract (`show(defenseState)`, `hide`, `layout`, `tick`, `destroy`, `visible`). Uses `pixi-ui-kit.js` panel helpers.

### `src/audio.js`

WebAudio tone generators. Wired to state events from `main.js`.

### `src/meta-state.js` — pure

Persistent player profile (save **v2** since P8). Owns **credits**, **hub resources** (minerals, warp), **per-color ore counts** (6 ores, one per tile color), **fleet roster** (ship id / name / class / hull % / status), **crew roster** (id / name / role / level / **xp** / status), **banked reputation** (the tier is *derived*, never stored), **charted sectors**, **daily board state** (`{dayKey, rerollsToday}`), **research** (`completed[]`, `activeResearches[]`, `maxConcurrent`), **active missions** (absolute timestamps), **lifetime stats** and a **`lastTickAt` heartbeat**. Emits a `change` event with `{ kind, detail }` on every mutation so `Persistence` saves and `PixiView` re-syncs the top-bar chips without a full rebuild.

**One action, one event, one save.** All arithmetic happens in non-emitting `_raw*` helpers (`_rawAddCredits`, `_rawAddOre`, `_rawAddRep`, `_rawAddCrewXp`, `_rawSetShipStatus`, `_rawDiscoverSector`, `_rawApplySettlement`, …), and the public method announces once. Deltas may be negative (market sells, refunds); only the resulting *balance* clamps at zero. Composite actions get their own method rather than two calls from a scene: `settleActiveMission(jobId, settlement)` (reward + job retirement) and `chartSector(id)` (warp cost + discovery grant + rep).

Reads: `credits`, `reputation`, `reputationTier`, `getRepInfo()`, `getHubResource(id)`, `getOre(color)`, `oreCounts()`, `fleetSnapshot()`, `crewSnapshot()`, `getEffects()`, `getBoardState(nowMs)`, `crewSlots()`, `warpCapacity()`, `discoveredSectorIds()`, `getStats()`, `activeMissionsSnapshot()`, `snapshot()`. Writes: `applySettlement`, `settleActiveMission`, `applyTrade`, `applyRefine` / `refineAllOres`, `chartSector` / `discoverSector`, `spendWarp` / `addWarp`, `addReputation`, `addCrewXp`, `buyBoardReroll`, `noteHullRepair`, `touch`, plus the P1–P4 set (`setCredits`, `addCredits`, `addOre`, `applyMissionReward`, `setShipHull/Status`, `setCrewLevel/Status`, `addShip/removeShip`, `addCrew/removeCrew`, research lifecycle). Constructor takes an optional hydrated blob and shallow-merges it onto the starter profile so malformed saves fall back to defaults instead of breaking the game.

### `src/persistence.js`

Versioned localStorage wrapper for the `MetaState` snapshot. One key — `stellarVentureSaveV1` (exported as `STORAGE_KEY`; the key did **not** change with save v2). Every method (`load`, `save`, `clear`) is non-throwing: SSR / private-mode Safari / quota-exceeded / unparseable blobs all return a safe default so the game keeps booting. `migrateSave(blob)` lifts a v1 profile in place (banked REP, crew XP backfilled as `xpForLevel(level)`, empty sector/board/stats slices) and stamps `migratedFrom: 1`; unknown, future or malformed versions are refused and the caller falls back to the starter profile, with the next save overwriting the bad blob. Storage is dependency-injected (`new Persistence({ storage })`) so tests pass a `createMemoryStorage()` fake.

### `src/run-ledger.js` — pure

Per-run tally. `new RunLedger({ state, mission })` subscribes to `match-cleared`, `bomb-exploded`, and `lines-cleared` on a `GameState`, maps each cleared cell through the tile-colour → ore-id identity (`ORE_IDS` from `meta-state.js`), and accumulates counters for matches / bombs / lines / cells + the 6 ore buckets. `summary(state)` rolls up mission metadata + a `credits = baseCredits + floor(score/10)` payout. `rewardEnvelope(summary)` returns the exact shape `MetaState.applyMissionReward(...)` consumes. `detach()` unsubscribes safely.

Zero Pixi / DOM imports — the ledger is pure data, same contract as `GameState`. `src/main.js` owns the ledger's lifecycle: create on start, summarise on game-over, hand the summary to `PixiView.showResultsScreen`, and call `detach()` before awaiting the player's CONTINUE tap. See [`GAMEPLAY.md`](GAMEPLAY.md) for the credits formula + event-to-ore table.

**`DefenseLedger`** (P8) is the Combat counterpart: it subscribes to `DefenseState` events (`invader-destroyed`, `powerup-collected`, `boss-destroyed`, `ball-lost`, `game-over`) and maps them onto the same six-ore identity — squid → Pyrite, crab → Cryonite, octopus → Verdanite (3 ore per formation), +2 Helium-3 per power-up, and the boss pays 4 Volatiles + 3 Biomass. Its `summary()` carries `won`, `minigame: 'defense'` and `statLabels` so `ResultsScene` relabels its rows (WAVE / BALLS LOST / PIXELS / WRECKS / PICKUPS) instead of claiming a combat pilot cleared "lines". `rewardEnvelope()` is legacy: since P8 both ledgers feed `settleMission()`, which is the only path into the profile.

### The P8 meta layer — six pure modules

`src/reputation.js`, `src/daily.js`, `src/economy.js`, `src/star-map.js`,
`src/crew.js`, `src/settlement.js`. Same contract as `GameState` and `missions`:
**zero Pixi / DOM imports, frozen exports, and every clock or entropy source is
an argument** (`nowMs`, `dayKey`, `rng`). No module in this layer holds mutable
state — they are functions over plain data, which is why the whole economy is
testable under `node --test` and why a scene cannot drift from the math it
displays. Full specification: [`META-SYSTEMS.md`](META-SYSTEMS.md).

| Module | Owns | Read by |
|---|---|---|
| `reputation.js` | REP ladder (6 ranks), per-dispatch gain, T8/T9 + threat-5 gates | hub (REP chip, card locks, planner), settlement, star-map, MetaState |
| `daily.js` | UTC day keys, per-day board seeds, reroll pricing + cap | hub (board modal), MetaState (`getBoardState`, `buyBoardReroll`), economy (headline countdown) |
| `economy.js` | 7-good market with daily drift + spread, quoted trades, refinery ratios, warp-find rules, derived price history for the chart | MARKET tab (list + chart), settlement, MetaState (`applyTrade`, `applyRefine`) |
| `star-map.js` | 13 sectors (warp cost, threat, bonus, grant), `plotCourse`, station bonuses | STAR MAP tab, settlement (sector bonus), MetaState (`chartSector`), research (`applyStationBonuses`) |
| `crew.js` | XP curve + levels, role/hull affinity, hire cost, roster slots | CREW tab, settlement, BUILD tab (specialties), MetaState (`crewSlots`) |
| `settlement.js` | `resolveDispatch()` (pricing) and `settleMission()` (the single reward path) | main.js (both minigames), hub (planner preview, idle claim/abort), MetaState |

`src/research.js` grew the **effect layer** alongside them: `BASE_EFFECTS`,
`EFFECTS_BY_NODE`, `resolveEffects(completedIds)` (multipliers multiply,
numerics add, booleans OR, ids dedupe, output frozen) and
`activeEffectSummaries()` — the strings the RESEARCH tab prints, so the tree can
never advertise a bonus nothing reads. `src/idle-clock.js` gained
`summarizeOffline()` / `formatAway()` for the offline report.

### `src/pixi-view.js`

The Pixi bootstrap + scene host. After the 4-stage scene-graph split (ADR-0009), PixiView is a thin shell (~250 lines, down from 3110 before the split, -92%) that owns:

- Pixi `Application`, stage hierarchy, and the `#gameContainer` mount
- Viewport-filling starfield + cinematic hub backdrop
- `SceneManager` + registered `HubScene` + `GameScene` + `DefenseScene` + `ResultsScene`
- Single `app.ticker` that drives `starfield.update(deltaMs)` and fans out `tick(deltaMs)` to every scene that exposes one
- Window `resize` listener that rebuilds the starfield + calls `SceneManager.layout(screen)`

Shared Pixi render helpers (panel chrome, label text, star icon, CTA button) live in [`src/pixi-ui-kit.js`](../src/pixi-ui-kit.js). Scenes import them directly; PixiView no longer hand-wires them through scene constructors.

Public API: `init`, `createBoard`, `createPreviews`, `setTopControlsHandlers`, `setSoundEnabled`, `setTip`, `showStartScreen`, `showGameScreen`, `showDefenseScreen`, `hideDefenseScreen`, `showResultsScreen`, `hideResultsScreen`, `onStartGame`, `_levelInfoFor` setter. Every entry point is a thin delegate onto the appropriate scene; there is no game logic, no hub logic, and no Pixi event handling left in `PixiView`.

### `src/pixi-ui-kit.js`

Shared Pixi render helpers. Zero GameState / MetaState / DOM imports — strictly render data. Today's exports:

- `drawTechPanel(w, h, { accent, cut })` → `Container` — sharp-cornered, cut-corner sci-fi frame panel. The canonical panel style for the hub.
- `redrawTechPanel(panel, w, h, { accent, cut })` — in-place resize of an existing tech-frame panel.
- `drawTechChip(w, h, { accent })` → `Container` — compact version of the tech panel (`cut: 8`) used for resource-strip chips and small labels.
- `redrawTechChip(chip, w, h, { accent })` — in-place resize of a tech chip.
- `drawHologramPanel(w, h, { accent })` → `Container` — delegates to `drawTechPanel` so all panels share the same visual language.
- `redrawHologramPanel(panel, w, h, accent)` — delegates to `redrawTechPanel`.
- `panelLabel(text, color, { size, weight })` → `Text` — small-caps Inter label with a soft drop-shadow glow matching its fill colour.
- `drawStarShape(r, color)` → `Graphics` — 5-point star icon used for the reactive title actor and galactic-map pins.
- `buildStartButton({ text, width, height, fill, hoverFill, textColor, onTap })` → `{ container, bg, label, setActive(bool), ... }` — CTA button with a colour-matched neon glow, frame stroke, and hover/active state transitions.

All panel / button colour constants (`PANEL_BG_TOP`, `PANEL_BG_BOT`, `PANEL_BORDER_ALPHA`, `BUTTON_DEFAULT_FILL`, `BUTTON_DEFAULT_STROKE`, etc.) and accent variant palettes (`PANEL_ACCENT_VARIANTS`) are exported from this module for scenes that need the same tints on bespoke chrome (e.g. the mission-board modal backdrop in `HubScene`).

Consumers: `HubScene`, `GameScene`, `ResultsScene`, `StarMapTab`, `ResearchTab`, `BuildUpgradeTab`. Future tab-scenes and minigame scenes register under `SceneManager` and pull chrome from this module without ever touching `PixiView`.

### `src/scenes/scene-manager.js`

Tiny registry (~70 lines, zero Pixi imports). `register(name, scene)` / `show(name, ...args)` / `hide(name)` / `isVisible(name)` / `layout(screen)` / `destroy()`. Scenes are duck-typed — any object exposing `show` / `hide` / optional `layout` / optional `destroy` / read-only `visible` works. `layout(screen)` fans out to **every** registered scene (hidden or not) so a scene re-shown after a viewport resize doesn't flash at the old size. Unit-tested with plain-object fakes (see `tests/scene-manager.test.js`).

### `src/scenes/results-scene.js`

Mission-report overlay, extracted from `PixiView` in the first scene-graph PR (see ADR-0009). Owns its Pixi `Container`, attaches to a `uiRoot` passed at construction. Builds lazily on first `show`, reuses its text nodes across runs via a `_populate(summary)` helper so subsequent runs don't re-create the stat grid.

Constructor shape:

```js
new ResultsScene({
    app,                    // Pixi Application (read-only; for screen rect)
    uiRoot,                 // Pixi Container to attach into
    palette,                // CELL_PALETTE for ore icon tints
});
```

Shared panel + button chrome is imported directly from [`src/pixi-ui-kit.js`](../src/pixi-ui-kit.js) — scenes no longer depend on PixiView-injected helpers.

### `src/scenes/hub-scene.js`

Viewport-filling "Chief Dispatcher HQ" main menu, extracted from `PixiView` in the second scene-graph PR (see ADR-0009). Owns the top STELLAR VENTURE bar + 5 resource chips, GALACTIC NEWS ticker, ACTIVE MISSIONS left column, galactic-map center panel, FLEET & CREW right column, 6-tab bottom nav, and the MISSION BOARD modal overlay. Builds lazily on first `show`; the entire Pixi tree hangs off a single `_nodes` struct so reset / re-layout / destroy are one-liners.

Ticker-animated: `hub.tick(deltaMs)` is driven from the PixiView `app.ticker` and advances the news-ticker scroll. MetaState-aware: subscribes to `meta.on('change', ...)` on first build, so any `applyMissionReward(...)` call repaints the top-bar resource chips automatically without PixiView intervention.

Constructor shape:

```js
new HubScene({
    app,                    // Pixi Application (read-only; for screen rect)
    uiRoot,                 // Pixi Container to attach into
    meta,                   // MetaState (read-only; subscribed for `change`)
});
```

Shared chrome (`drawHologramPanel`, `redrawHologramPanel`, `buildStartButton`, `panelLabel`, `drawStarShape`) is imported directly from [`src/pixi-ui-kit.js`](../src/pixi-ui-kit.js).

Public API consumed by `PixiView`:

- `setStartGameCallback(fn)` — forwards from `PixiView.onStartGame(fn)`. Fires when a mission card's ACCEPT button is tapped.
- `getStartState()` — returns the currently-selected mission's `{ mode, complexity, fieldSizeId, selectedMissionId }`. Game-HUD tier colour + size-multiplier readouts read this.
- `getMissions()` — returns the deterministic per-boot mission catalog (same `buildMissions({ seed })` call the old start screen used).

All hub constants (`HUB_TABS`, `HUB_RESOURCES`, `HUB_NEWS_POOL`, `HUB_RISK_PRESETS`) moved with the scene. PixiView no longer imports `missions.js` — the scene owns the catalog.

#### Tab scenes (`src/scenes/tabs/*.js`)

Each hub bottom-nav tab with bespoke content is its own scene class, hosted by `HubScene` inside the center panel (see [ADR-0010](adr/0010-hub-tab-scenes.md)). Tab scenes follow the same duck-typed `show / hide / layout / destroy` contract as top-level scenes, but they register on `HubScene._nodes.tabs` (not the top-level `SceneManager`) because they depend on the hub's center-panel Pixi container.

- `_setActiveTab(tabId)` hides every extracted tab scene, then shows the one matching `tabId` (if any). After `scene.show()` lazy-builds the tab's Pixi nodes on first call, `_setActiveTab` immediately invokes `scene.layout({ width, height })` with the center panel's last-known inner dims (stashed on `center._w / center._h` by `_layoutCenterPanel`) so the newly-built content renders in the right positions on first show — not at the (0, 0) default that the hub-build-time fan-out would leave behind. A `tabId` with no scene class falls through to the default branch that sets the hub's own title + planner visibility.
- `_layoutCenterPanel(...)` fans out `tab.layout({ width, height })` to every tab scene (visible or not) after the hologram frame is redrawn, so a hidden tab does not flash at the old size on re-show.
- **The left column can belong to a tab (P9).** `_buildSidePanel()` creates a second 276 px frame — `drawTechPanel` surface, header label, empty `list` container — and injects it into the STAR MAP, BUILD/UPGRADE and MARKET constructors as `{ side: sidePanel }`. A tab opts in with `usesSidePanel = true` + `sidePanelTitle`, and implements `layoutSide({ width, height })`; `_setActiveTab` shows the bay only when the active tab opts in *and* neither the idle-mission list (MISSIONS) nor the research list (RESEARCH) owns it, stamps `sidePanel.ownerId`, and calls `_layoutSidePanel()`, which forwards the `_w / _h` recorded by `_layoutColumnPanel()`. `_layoutShell()` re-lays the bay out on every resize. The hub owns the frame, the tab owns the content — the same split as ADR-0010, one column over. `tests/side-panel-contract.test.js` asserts the contract over the sources and `tests/hub-scene-smoke.test.js` executes it (boot → activate every tab → assert exactly one visible owner of the bay).
- `destroy()` tears down tab scenes before the center panel's own destroy.

Shipped today: `star-map-tab.js` (STAR MAP), `research-tab.js` (RESEARCH), `build-upgrade-tab.js` (BUILD/UPGRADE), `crew-tab.js` (CREW) and `market-tab.js` (MARKET) — every tab with bespoke content is a scene class now, and no tab falls through to the inline stub. Three of them (STAR MAP, BUILD/UPGRADE, MARKET) also own the left bay while active.

### `src/scenes/tabs/star-map-tab.js`

Planetary-system chart for the STAR MAP bottom-nav tab. Mounts its root under the hub's center-panel hologram surface (`centerPanel.panel`). Owns: title strip (`STAR MAP · SYSTEM CHART`), a clipped map window with a deterministic backdrop speckle, the seeded system from `generateStarSystem(seed)` (central star, orbit rings, asteroid belts, shaded planets with type-specific surfaces, moons, stations, hazards, orbiting ships), a camera with wheel-zoom-toward-cursor / drag-pan / fit-all, zoom counter-scaling so glyphs stay a constant screen size, `MAP LEGEND`, camera controls, and — beside the map when the viewport is ≥ 780 px — the `SECTOR NETWORK` rail wired to `star-map.js` + `MetaState.chartSector()`.

Motion is ambience, not animation spam: `tick()` advances `ORBIT_TIME_SCALE = 0.25`, and moons/ships only appear past `MOON_ZOOM_REVEAL` / `SHIP_ZOOM_REVEAL` multiples of the fit zoom. Selecting a body writes into the hub's left bay (`SYSTEM DATA` board + `SYSTEM INDEX` list, §3a of [UI-HUB](UI-HUB.md)); the older floating panel that chased the body around the window is gone.

### `src/scenes/tabs/market-tab.js`

Commodity exchange for the MARKET bottom-nav tab, split like a trading terminal. The **left bay** (`MARKET`) holds the seven-good watchlist: lot selector, held stock, buy/sell prices and quoted BUY/SELL buttons per row; tapping a row charts that good. The **center panel** holds the chart — `economy.priceHistory()` rendered as grid + area/line series + price and hour axes, a last-price tag, amber markers at each UTC-midnight re-price and a pointer crosshair — above the refinery strip and the status line. All rules stay in `economy.js` / `MetaState`; the tab only quotes, draws and forwards orders.

### `src/scenes/tabs/research-tab.js`

Technology-tree view for the RESEARCH bottom-nav tab. Mounts its root under the hub's center-panel hologram surface (`centerPanel.panel`). Owns: amber `RESEARCH · TECHNOLOGY TREE` title strip, four category columns (Propulsion / Resource Extraction / Defense / Economics), 12 pointy-top hex nodes (`HEX_R = 22`) with 2-char glyph + level pill + wrap-capped name, 9 prerequisite edges routed orthogonally between columns, a floating ~260×210 `RESEARCH NODE` detail card (cost row, effect blurb, state-aware CTA), and a ~220×76 bottom-left legend sub-panel mapping the four node states (`available` / `researching` / `completed` / `locked`) to color swatches. The `INITIATE RESEARCH` / `VIEW PROGRESS` CTA is a stub; real cost deduction, tick-based research clock, and upgrade-apply land under ROADMAP P8. `RESEARCH_NODES`, `RESEARCH_EDGES`, and `RESEARCH_CATEGORIES` are re-exported so future work (MetaState research slice, catalog editor) can iterate over them without duplicating the tree shape.

Constructor shape:

```js
new StarMapTab({
    parent,   // Pixi Container to mount under (hub's center panel)
});
```

Exports the sector catalog + legend entries for testing + documentation: `STAR_MAP_SECTORS`, `STAR_MAP_LEGEND`.

### `src/scenes/tabs/build-upgrade-tab.js`

Station-diorama view for the BUILD/UPGRADE bottom-nav tab. Mounts under the hub's center-panel hologram surface. Owns: an isometric station silhouette with 4 interactive callout pins (Docking Arms, Reactor Spine, Sensor Crown, Fabrication Yard) that highlight on click and display a tooltip-style note, a 3-slot build queue (one active `Building` item with ETA + 2 `Queued` slots), and 2 available-upgrade cards showing title, level, effect blurb, and mineral cost. All data is static/seed for now; real `BuildQueue` MetaState integration lands under ROADMAP P5.

Constructor shape:

```js
new BuildUpgradeTab({
    parent,   // Pixi Container to mount under (hub's center panel)
});
```

### `src/scenes/game-scene.js`

The in-game HUD + board, extracted from `PixiView` in the third scene-graph PR (see ADR-0009). Owns everything the player sees during a run:

- The 860×820 HUD frame — title bar with reactive star, LEVEL + COMING UP columns, SCORE + TIPS + CONTROLS columns, sound/exit top controls
- The board tree — `boardRoot` + 4 `layers` (`board` → `active` → `effects` → `overlay`). Cell pools (`boardCells[y][x]` + `activeCells[y][x]`) are rebuilt on every `createBoard()` so each field size gets a fresh grid
- All GameState subscriptions (`piece-spawned`, `piece-locked`, `match-cleared`, `lines-cleared`, `bomb-detonating`, `bomb-exploded`, `snake-activated`, `gravity-applied`, `floating-changed`, `score-changed`, `level-up`, `game-over`, plus the COLLAPSED `special-armed` / `-cleared` / `-expired` / `-moved` / `-cleared-all` family)
- Click-to-match input handling (attaches a canvas `click` listener; translates into cell coords and forwards to `state.clickCell(...)`)
- All animations driven off the shared `tick(deltaMs)`: scanner sweep, bomb/snake pulse, title-star reactions, effect tween pool, snake-walk trail
- Special-overlay countdown rings (the 5-second arming clock on bomb/snake cells in COLLAPSED mode)

Builds lazily on first `show()` — the HUD + board + layers are all created inside `_build()` so a sandbox boot that never enters a run pays no Pixi construction cost for game nodes.

Constructor shape:

```js
new GameScene({
    app,                    // Pixi Application (read-only; for canvas + screen)
    state,                  // GameState (subscribed for the full game event bus)
    sceneRoot,              // Pixi Container shared with the hub (HUD + board live here)
    uiRoot,                 // Pixi Container for floating chrome (top controls)
});
```

Shared chrome (`drawHologramPanel`, `drawStarShape`, `panelLabel`) is imported directly from [`src/pixi-ui-kit.js`](../src/pixi-ui-kit.js).

Public API forwarded from `PixiView` so `main.js` never sees the scene directly:

- `createBoard()` — rebuild cell pools for a new run's grid
- `createPreviews()` — no-op kept for API parity; previews are wired inside `_buildHud`
- `setTip(text)` / `setSoundEnabled(on)` — update HUD copy; buffered if called before the HUD builds so main.js's init-time priming works
- `setTopControlsHandlers({ onExit, onToggleSound })` — wires the sound/exit buttons
- `setLevelInfoFor(fn)` — level-name formatter; proxied from `view._levelInfoFor = fn`

PixiView no longer holds any game state fields (no `boardCells`, `_tweens`, `_particlePool`, `_specialOverlays`, `_clockMs`, or `layers`) — those all live inside `GameScene` now. The `CELL_PALETTE` render data is shared across scenes via [`src/scenes/cell-palette.js`](../src/scenes/cell-palette.js).

### `src/input.js`

Keyboard + touch wiring. Translates raw DOM events into `GameState` verbs. Arrow keys, space (hard drop), and swipe gestures (mobile) are all bound here. Touch-gesture support (added in PR #55): swipe left/right to move, swipe up to rotate, swipe down to soft/hard drop (`SWIPE_PX = 24`, fast-swipe threshold `FAST_SWIPE_MS = 140`). `touch-action` is disabled on the canvas to prevent browser scroll/zoom gestures from stealing game input. Since P10 it also takes an `isPaused()` predicate (from `main.js`) so a paused shift cannot be nudged by stray keys or swipes; `defense-input.js` takes the same predicate.

### The P10 shell — help, dialogs, hotkeys, next-step hints

| Module | Owns | Read by |
|---|---|---|
| `src/help-content.js` (pure) | The five-page HOW TO PLAY manual as frozen data (`HELP_PAGES`), unit-tested for shape + coverage | `help-overlay.js` |
| `src/results-hints.js` (pure) | `nextStepHints(summary)` — which station bay consumes the haul the player just earned | `results-scene.js` (NEXT lines) |
| `src/hotkeys.js` | Global key routing (`H`/`?`, `ESC`, `1`–`6`, `M`, `P`) with a `getContext()` seam; movement keys stay in `input.js` | `main.js` |
| `src/scenes/help-overlay.js` | Paged manual overlay (prev/next/dots/CLOSE, first-run `START SHIFT` CTA); lazy-built on `uiRoot` | `PixiView` (`showHelp`), hub `? HELP`, pause menu |
| `src/scenes/modal-dialog.js` | Generic title/body/buttons dialog (`cancel()` = ESC → the `role: 'cancel'` button); pause menu + reset confirmation | `PixiView` (`showDialog`), `main.js` |

Both overlays are registered with the `SceneManager` (`help`, `dialog`) so
resize fan-out reaches them; both are lazy-built like `ResultsScene` so they
layer above run HUD chrome. `MetaState.ui.helpSeen` is an additive save field
(`markHelpSeen()` / `hasSeenHelp()`).

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
- Wires `state.on('game-over')` → `ledger.summary(state)` → `view.showResultsScreen(summary, { onContinue })`. CONTINUE applies the settlement (`meta.applySettlement(...)`) + returns to the hub (which re-opens the MISSION BOARD). If the run started without a mission (sandbox boot) the results overlay is skipped. A `user-exit` reason settles `won: false` (P10).
- Owns the P10 pause/help/dialog wiring: the `paused` flag that gates both run loops and both input binders, the pause menu, the first-boot manual, the hotkey actions, and the reset confirmation.

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
GameState emits 'game-over' { score }      (DefenseState: { won, score })
    │
    ▼
main.js:
    │  summary    = ledger.summary(state)      // RunLedger or DefenseLedger
    │  ledger.detach()
    │  job        = view.getManualDispatch(mission.id)   // ship + crew the hub sent
    │  settlement = settleMission({ mission, job, summary, ship, crew,
    │                               effects: meta.getEffects(),
    │                               discoveredSectors: meta.discoveredSectorIds(),
    │                               dispatchMode: 'manual', won })
    │  view.showResultsScreen(buildReport(summary, settlement), { onContinue })
    │
    ▼
player clicks CONTINUE
    │
    ▼
main.js:
    │  meta.applySettlement(settlement)    // ONE 'change' + ONE save: credits,
    │                                      // ores, REP, crew XP, hull wear, warp,
    │                                      // completedMissionIds, lifetime stats
    │  view.completeManualMission(id)      // frees the ship + crew (no rewards)
    │  view.hideResultsScreen(); view.showStartScreen()
```

Idle contracts take the same path from inside the hub: `_claimIdleMission()` /
`_abortIdleMission()` build a settlement with `dispatchMode: 'idle'` and call
`meta.settleActiveMission(jobId, settlement)`, which banks the reward **and**
retires the job in one event. Sector jumps (`meta.chartSector`) and market
orders (`meta.applyTrade`) are the only other writes that move currency.

```
boot:  summarizeOffline({ jobs, lastSeenMs: meta.lastTickAt, nowMs })  ── BEFORE ──▶ meta.touch()
         │
         ▼
       view.setOfflineSummary(report)  ──▶ hub WELCOME BACK banner ──▶ CLAIM ALL
                                                                      (one settlement per job)
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

Persistent state ships via P3's `MetaState` + `Persistence` modules, at **save v2** since P8. Single localStorage key `stellarVentureSaveV1` stores the player profile: credits, hub resources (minerals, warp), per-colour ore counts, fleet roster, crew roster (with XP), banked reputation, charted sectors, daily board state, research, active missions, lifetime stats and the `lastTickAt` heartbeat. `migrateSave()` lifts v1 blobs in place; the key never changed, so returning players keep their profile. The legacy `stellarCollapseScoresV2` leaderboard was deleted (see `adr/0005-delete-highscore-system.md`); any orphaned payload in returning players' browsers is read by nothing. See [`GAMEPLAY.md`](GAMEPLAY.md#persistence-metastate-profile) for the full profile schema and mutation API, and [`META-SYSTEMS.md §10`](META-SYSTEMS.md) for the v2 field list.

**Offline correctness needs no simulation.** Jobs store absolute `startedAt` /
`endsAt`, so a gap of any length is resolved by comparison against the
heartbeat — `main.js` stamps `meta.touch()` on boot, every 30 s, and on
`pagehide` / `visibilitychange → hidden` (the last two also force an explicit
`persistence.save()`).

---

## Testing strategy

- **Unit tests** (`node --test`, `tests/*.test.js`) cover the pure modules: `GameState`, `DefenseState`, `missions`, `MetaState`, `Persistence`, `RunLedger` / `DefenseLedger`, `IdleClock`, `SceneManager`, and the whole P8 layer (`reputation`, `daily`, `economy`, `star-map`, `crew`, `settlement`, `research` effects). **390 tests currently.**
- **Hub smoke suite** (`tests/hub-scene-smoke.test.js`) executes the real `HubScene` and its tab scenes. Scene modules import the bare specifier `pixi.js`, which only the browser's importmap resolves, so the suite registers a Node resolve hook (`tests/helpers/pixi-resolve-hook.mjs`) that maps it onto a headless stand-in (`tests/helpers/pixi-mock.js`): a Container tree, chainable `Graphics`, `Text` with approximated measured metrics, and a mini event emitter so `pointertap` / `pointermove` handlers can be driven. It then boots the hub, activates all six tabs, resizes 1920×1080 → 820×560, taps every row and button, dispatches an idle contract and tears down — asserting no throws, no non-finite coordinates anywhere in the graph, exactly one visible owner of the shared left bay, and profile mutations that match what the UI quoted. If the host Node predates `module.register()` (Node < 20.6) the suite skips itself rather than failing CI. **It asserts behaviour and geometry, never appearance** — "it ran and the numbers are finite and honest", not "it looks right".
  This suite exists because three real defects shipped in the blind spot it covers: `hub-scene.js` calling `buildIdleMissions()` without importing it (every IDLE dispatch threw), `_fleetSlotLimit()` reading `effects.fleetSlots` — an extras counter starting at 0 — as the berth capacity (a fresh station had one berth and refused every BUILD order), and STAR MAP clearing the shared bay's `list` (destroying the SHIPYARD and MARKET containers parked there, so the yard's BUILD buttons came back with no handler).
- **Static checks** back it up where execution cannot reach: `tests/source-syntax.test.js` runs `node --check` over every `src/` file; `tests/module-imports.test.js` asserts every relative import resolves, every named local import is really exported, **and that no file calls a sibling module's export it did not import**; `tests/side-panel-contract.test.js` asserts the left-bay contract (`usesSidePanel` / `sidePanelTitle` / `layoutSide`, own-container mounting, hide-on-`hide()`) over the sources.
- **Every rule change has a test.** Bomb radius, snake length, score multipliers, level ramp, special arming-timer, rep gain, reroll pricing, market drift, refine ratios, warp-find rules, XP curve, hull wear, settlement totals — all covered.
- **Determinism.** GameState takes a seeded RNG; the P8 modules take `nowMs` / `dayKey` / `rng` arguments, so a test can pin a UTC day or an abort fraction exactly. Any test that is flaky is a bug in the test, not in the code.
- **Atomicity is asserted, not assumed.** Settlement, claim/abort and sector-jump tests count `change` events (`assert.equal(changes, 1)`) so "one action, one save" cannot regress silently.

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
