# Changelog

Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are merge-to-main dates. Entries describe player-visible changes first, infra changes last.

This log starts at the PR #32 release. Earlier history is in the git log.

---

## [Unreleased]

### Added

- **Hub tab scenes (PR 6) — RESEARCH as the second extracted tab scene.** New module `src/scenes/tabs/research-tab.js` (~470 lines) renders the technology tree inside the hub's center panel when the **RESEARCH** bottom-nav tab is active: `RESEARCH · TECHNOLOGY TREE` amber title strip; four category columns (Propulsion, Resource Extraction, Defense, Economics); 12 pointy-top hex nodes (`HEX_R = 22`) with 2-char glyph + level pill + wrap-capped name; 9 prerequisite edges routed orthogonally between columns; 4 node states (`available` cyan / `researching` amber + progress bar + ETA / `completed` emerald / `locked` slate); floating ~260×210 `RESEARCH NODE` detail card with cost row (`<minerals> minerals · <credits> credits · <time>`), effect blurb, and a state-aware CTA (`INITIATE RESEARCH` / `PREREQUISITES LOCKED` / `VIEW PROGRESS` / hidden); a ~220×76 bottom-left legend sub-panel mapping each state to a color swatch. Clicking a hex selects it — selection highlight is a thin amber outer ring at `HEX_R + 4`. The CTA is a stub (same pattern as STAR MAP's `PLOT COURSE`); real cost deduction, tick-based research clock, and upgrade-apply land under ROADMAP P8. **RESEARCH is now unlocked** — `HUB_TABS[3].locked = false`. `HubScene._setActiveTab` routes both STAR MAP and RESEARCH through the same extracted-tab branch, symmetric with the MISSIONS-modal path. `docs/UI-HUB.md` §5b spec + `assets/mock-research-tab.png` reference mock land in the same PR.
- **Hub tab scenes (PR 5) — STAR MAP as the first extracted tab scene.** New module `src/scenes/tabs/star-map-tab.js` (~350 lines) renders the galactic-cartography view inside the hub's center panel when the **STAR MAP** bottom-nav tab is active: title strip (`STAR MAP · ORION CARTOGRAPHY`), coordinate grid with longitude/latitude tick labels, 8 sector pins (Sol, Trappist-1, Proxima Centauri, Barnard's Star, Omega-4 Belt, ARES Waystation, Cygnus X-1, PSR B1257+12) colored by kind (star / belt / station / hazard), bottom-left `MAP LEGEND` sub-panel, top-right `GALACTIC OVERVIEW` thumbnail with a mini spiral + current-position crosshair, and a floating `SYSTEM DATA` panel that pops next to the selected pin with a `PLOT COURSE` button (stub for now; real warp-cell deduction + mission dispatch lands in P7) and a dismiss button. Clicking pins, plotting course, and switching tabs all behave correctly without flashing at old sizes. **STAR MAP is now unlocked** — `HUB_TABS[0].locked = false`. Shipping as a scene class proves the tab-scene pattern documented in new ADR-0010; the other 4 locked tabs (BUILD/UPGRADE, RESEARCH, CREW, MARKET) still render the shared "Unlocks at Rep Tier N" inline stub and will move to `src/scenes/tabs/*.js` in subsequent PRs. `HubScene` owns the tab-scene lifecycle directly (not the top-level `SceneManager`) because tab scenes are hub-local — `_setActiveTab` shows/hides tab scenes alongside the existing MISSIONS-modal routing, `_layoutCenterPanel` fans out to each tab's `layout({ width, height })` on resize, and `destroy` tears them down before the center panel. Same duck-typed `show/hide/layout/destroy` contract as top-level scenes so an eventual promotion to full-screen (e.g. STAR MAP becomes an overworld) is a registration-site swap, not a rewrite. Zero behavioural change on any other tab. 106/106 tests still pass.

### Fixed

- **PR #52 follow-up — STAR MAP (and any future tab scene) now lays out correctly on first click.** When the user clicked an extracted tab for the first time, `_setActiveTab` called `scene.show()` (which lazy-builds the scene's Pixi nodes), but the `_layoutCenterPanel` fan-out that normally positions tab content only ran at hub-build time — before the nodes existed and before `scene.layout()` could do anything. Result: the coordinate grid rendered empty, all 8 sector pins stacked at (0, 0), and the legend + thumbnail cards overlapped at the panel origin until a window resize kicked off a fresh layout pass. Fix: `HubScene._layoutCenterPanel` now stashes the panel's inner `width / height` on the center object, and `_setActiveTab` calls `scene.layout({ width, height })` immediately after `scene.show()` whenever those dims are known. Covers STAR MAP today and RESEARCH in this same PR.
- **PR #52 follow-up — `StarMapTab` no longer leaks Text objects on every resize.** `_layout()` rebuilt the ~12-13 longitude/latitude tick labels on every invocation by calling `n.axisLabels.removeChildren()` before re-adding new `Text` children — but `removeChildren` only detaches, it does not destroy, so the orphaned `Text` objects (and their GPU textures + style data) accumulated across resize events. Replaced the detach loop with an explicit `removeChild + destroy({ children: true })` drain loop. No visible change; long sessions just stop slowly leaking.

### Changed

- **Scene-graph refactor (PR 4 of several) — shared ui-kit promotion.** The 5 shared Pixi render helpers (`_drawHologramPanel`, `_redrawHologramPanel`, `_buildStartButton`, `_panelLabel`, `_drawStarShape`) moved out of `PixiView` into a new standalone module `src/pixi-ui-kit.js` (~210 lines). Each scene now imports the helpers it needs directly; `PixiView` no longer hand-wires them through scene constructors (`ResultsScene`, `HubScene`, and `GameScene` constructor signatures shrank accordingly). Panel + button colour constants (`PANEL_BG_TOP`, `PANEL_BG_BOT`, `PANEL_BORDER_ALPHA`, `BUTTON_DEFAULT_FILL`, etc.) are exported from the kit so scenes that draw bespoke chrome (like the hub's mission-board modal backdrop) share one canonical palette. `PixiView` dropped another ~135 lines and is now a ~250-line scene host (down from 3110 at the start of the split, **-92%**). Unblocks future tab-scenes and minigame scenes: they register under `SceneManager` and pull chrome from the ui-kit without ever touching `PixiView`. Zero behavioural change. 106/106 tests still pass.
- **Scene-graph refactor (PR 3 of several).** `GameScene` extracted out of `PixiView` into `src/scenes/game-scene.js` (~1700 lines). Owns the entire in-game experience: 860×820 HUD frame (title bar with reactive star, LEVEL + COMING UP + SCORE + TIPS + CONTROLS columns, sound/exit top controls), board + 4 layers (`board` / `active` / `effects` / `overlay`), all GameState subscriptions (`piece-spawned`, `piece-locked`, `match-cleared`, `lines-cleared`, `bomb-detonating`, `bomb-exploded`, `snake-activated`, `gravity-applied`, `floating-changed`, `score-changed`, `level-up`, `game-over`, `special-armed|-cleared|-expired|-moved|-cleared-all`), click-to-match canvas input, every animation driven off the shared `tick(deltaMs)` (scanner sweep, bomb/snake pulse, title-star reactions, effect tween pool, snake-walk trail), and the COLLAPSED arming-countdown ring overlays. Builds lazily on first `show()`. `PixiView.createBoard()` / `createPreviews()` / `setTip()` / `setSoundEnabled()` / `setTopControlsHandlers()` / `showGameScreen()` and the `view._levelInfoFor = fn` legacy setter all keep the same public signature and now delegate to the scene. `CELL_PALETTE` promoted into `src/scenes/cell-palette.js` so HubScene + GameScene + ResultsScene share one definition. PixiView is now a ~390-line scene host (down from 3110 at the start of the split); it holds zero game state and zero game logic. Zero behavioural change. 106/106 tests still pass.
- **Scene-graph refactor (PR 2 of several).** `HubScene` extracted out of `PixiView` into `src/scenes/hub-scene.js` (~1200 lines). Owns the viewport-filling main menu: STELLAR VENTURE top bar + resource chips, GALACTIC NEWS ticker, ACTIVE MISSIONS left column, galactic-map center panel, FLEET & CREW right column, 6-tab bottom nav, MISSION BOARD modal. Builds lazily on first `show()`, owns its own MetaState `change` subscription so reward grants repaint top-bar chips automatically, and drives the news-ticker animation from its own `tick(deltaMs)`. `PixiView.showStartScreen()` / `showGameScreen()` / `onStartGame()` keep the same public signature and now delegate to the scene manager. Hub constants (`HUB_TABS`, `HUB_RESOURCES`, `HUB_NEWS_POOL`, `HUB_RISK_PRESETS`) and helpers (mission-card builders, layout passes, callsign roll, mode/complexity pretty-printers, `_syncResourceChips`) all moved with it; PixiView dropped ~840 lines of hub code + 76 lines of hub constants and now imports no hub-specific modules. Zero behavioural change. 106/106 tests still pass.
- **Scene-graph refactor (PR 1 of several).** `PixiView` starts splitting into scenes under `src/scenes/`. New `SceneManager` (~70 lines, zero Pixi imports, own unit test suite) registers named scenes with a `show` / `hide` / `layout` / `destroy` contract. First extraction: `ResultsScene` — the mission-report overlay — moves out of the monolith with zero behavioural change. `PixiView.showResultsScreen(summary, {onContinue})` and `PixiView.hideResultsScreen()` keep the same public signature and now delegate to the manager. New ADR-0009 documents the staged path through HubScene, GameScene, and the six hub-tab scenes + 6+ minigame scenes that will register under the same manager. 106/106 tests pass (97 existing + 9 new scene-manager tests).

### Added

- **P1 shipped — per-run ore tally, credits formula, and Pixi results screen.** A completed mission now rolls up ores cleared (`match-cleared` / `bomb-exploded` / `lines-cleared` → tile colour → ore id) and awards `baseCredits + floor(score/10)` credits. A new hologram overlay shows asteroid name + sector, run stats (score / level / lines / cells / matches / bombs), a 6-ore haul breakdown, and the credits payout with base/bonus split; CONTINUE applies the reward through `MetaState.applyMissionReward(...)` (which persists through `stellarVentureSaveV1`) and returns to the hub. Top-bar chips auto-repaint from the new profile. New `src/run-ledger.js` pure module + 11 unit tests (97/97 passing).

### Fixed

- **MetaState `ORE_IDS` now mirrors the actual tile palette.** Previous list shipped in P3 (`red`, `orange`, `yellow`, `green`, `blue`, `purple`) did not match the six real tile colours (`red`, `blue`, `green`, `yellow`, `bomb`, `snake`), so `addOre('bomb', …)` and `addOre('snake', …)` silently no-op'd and no run could ever bank Volatiles or Biomass. The starter profile now initialises all six correct slots at zero, and the mission-reward envelope iterates the fixed list. (Flagged by Devin Review on PR #45 before any reward wiring used it.)
- **`MetaState.applyMissionReward` now floors fractional credits + ore deltas.** `setCredits` / `addOre` already floored their inputs; the bulk `applyMissionReward` path did not, so a fractional reward would leave the in-memory profile unrounded until the next reload through `_merge`. The contract documented in `GAMEPLAY.md §Mutation API` is now honoured on every path. (Flagged by Devin Review on PR #45.)

### Changed

- **Procedural starfield stars reworked to blend with the hub-backdrop image.** The old big diffraction-cross + ringed glyph has been replaced with two new textures: a soft pinprick (majority of stars) and a rare subtle 4-ray sparkle (~5% of stars). Scale range tightened from `0.08–1.42` to `0.22–0.90` so no star reads as a "drawn" dot; alpha biased dimmer so most stars sit just above the noise floor like the pinpricks in the backdrop. Twinkle cadence slowed (speed `0.0003–0.0014` vs. `0.0006–0.0036`), pulse amplitude softened so stars glimmer instead of visibly throbbing. Tint palette replaced with neutral-white / faint-blue / faint-amber (no more pink/pastel) to match the image's star colors.

### Added

- **Persistent player profile (P3 data layer).** New `src/meta-state.js` owns credits, 6 per-colour ore counts, hub resources (O₂ / fuel / minerals / warp), fleet + crew rosters, reputation tier, and completed mission ids. Emitter-backed — every mutation fires a `change` event. New `src/persistence.js` wraps `localStorage` behind a versioned `stellarVentureSaveV1` key; every method (load / save / clear) is non-throwing (SSR / private-mode Safari / quota errors / unparseable blobs / incompatible schema versions all fall back to the starter profile). Hub top bar + FLEET & CREW column now read from MetaState instead of hard-coded placeholders, so P1 rewards will surface in the UI as soon as they land. New ADR-0008. Starter values mirror the old placeholders so first boot is visually identical.
- **Cinematic hub backdrop.** New `assets/hub-backdrop.jpg` image renders as the base layer of the Pixi starfield, cover-fit to the viewport with a subtle parallax drift. Sits **behind** the procedural nebula + twinkling cross stars so the "living space" feel is preserved. Procedural nebula palette retinted toward the backdrop's teal / cyan / ember tones (replacing the old purples/magentas) so the baked image and the live layers reinforce each other instead of fighting. If the asset fails to load, the starfield falls back to procedural-only silently.
- **Hub shell on the main menu.** The old 3×3 mission grid + dispatcher card start screen is replaced with a viewport-filling hub: top bar (brand + dispatcher badge + O₂/Fuel/Minerals/Credits/Warp resource chips + settings gear), Galactic News ticker, left ACTIVE MISSIONS column (empty-state card until idle-loop ships), tab-swapped center panel with a MISSION BOARD modal (2×2 narrative mission cards — risk, ETA, sector, ore preview, credit reward; click ACCEPT to deploy), right FLEET & CREW STATUS column (3 starter ships with hull bars + 3 starter crew members), 6-tab bottom nav (MISSIONS active; STAR MAP / BUILD/UPGRADE / RESEARCH / CREW / MARKET locked with rep-tier hints). Layout tracks the viewport on resize, so the prior wide-viewport clustering defect is gone.
- **Narrative mission metadata** on every mission (`src/missions.js`). Each of the 9 tier archetypes now carries `narrativeName`, `type` (Mining / Exploration / Research / Salvage / Combat), `sector`, `risk` (1–5), and `etaLabel`. `gameConfig` still maps 1:1 to a tier so ADR-0003 holds; the hub MISSION BOARD cards render the narrative flavor on top of the existing tier machinery.
- **`pickMissionBoard(missions, { count, seed })`** helper — deterministic 2×2 subset roll stratified across risk buckets so every hub board shows a difficulty gradient.
- **Hub vision doc** (`docs/UI-HUB.md`). Captures the target main-menu layout — viewport-filling top resource bar, Galactic News ticker, left ACTIVE MISSIONS column, tab-swapped center with a MISSION BOARD modal of narrative mission cards, right FLEET & CREW STATUS column (ships + crew), 6-tab bottom nav — that P2 → P7 builds toward. `docs/images/hub-mission-board-mock.png` is the new ground-truth reference; the earlier `hub-vision.png` is superseded but retained for history.
- **Narrative mission catalog** in `UI-HUB.md` §7. 9 narrative missions mapped 1:1 to the 9 `HIGHSCORE_TIERS` archetypes, each with a flavor name, type tag (Mining / Exploration / Research / Salvage / Combat), sector, risk factor, duration ETA, and ore preview. Gameplay-level `gameConfig` stays the 9-tier matrix; narrative is a flavor skin.
- **ADR-0004** — "Main menu evolves from fixed Pixi panel into a viewport-filling hub scene graph." Context, decision, alternatives (grow in place, DOM/React, full framework) all recorded.
- **ADR-0005** — "Delete the HighScores leaderboard system." The game is about banking per-run resources, not a bragging-rights score. Storage module + UI panel + game-over save hook all removed.
- **ADR-0006** — "Rename the game from Stellar Collapse to Stellar Venture." Repo URL + Pages URL unchanged; in-game title bar, `<title>`, README, docs, and `package.json.name` follow the new brand.
- **ADR-0007** — "Hub wireframe pivot." Right column is FLEET & CREW STATUS (was BASE COMMAND); BASE COMMAND's build queue + upgrade list move into the BUILD/UPGRADE tab. MISSIONS tab opens a MISSION BOARD modal with narrative cards by default. Galactic News ticker added. Refines ADR-0004, does not supersede.
- **ROADMAP Known Issues section** tracking remaining main-menu defects (centering on wide viewports). The MISSION LOG overlap defect is now resolved by deletion.

### Changed — branding

- **Rebranded Stellar Collapse → Stellar Venture.** In-game Pixi title bar (start screen + game-over screen), `<title>` in `index.html`, `README.md`, `docs/*.md` headings, `package.json` `name` / `description` all updated. Repo URL (`Sergutsu/StellarCollapse`) and GitHub Pages URL unchanged — they stay encoded as "StellarCollapse" to preserve existing bookmarks and CI config. Historical CHANGELOG entries (0.1.0 and earlier) and accepted ADRs remain verbatim (append-only log).

### Removed

- **MISSION LOG panel deleted from the start screen.** Tier tabs, top-5 score list per tier, and the supporting `_refreshLeaderboard` machinery are gone.
- **`src/highscores.js` + `tests/highscores.test.js` deleted.** No persistent leaderboard ships; per-run resource tallies replace the role of a high score (landing in P1's results scene).
- **`HighScores` wiring in `src/main.js` removed.** The `game-over` handler no longer reads or writes `stellarCollapseScoresV2`; it just returns the player to the mission-select.
- **`view.setHighScores()` and `view.setSelectedTier()` public methods removed.** No callers remain.

### Changed

- **Start screen is now a single centered panel.** The right-hand MISSION LOG / dispatcher column collapsed into the left panel: dispatcher identity card sits directly beneath the 3×3 mission grid. Side effect: clustering in the top-left of wide viewports is partially mitigated; full viewport-filling fix still lands with P2 hub scaffolding.
- **ROADMAP phases re-sloted** toward the hub: P2 is now hub scaffolding (was persistent meta); persistent meta slides to P3; active-missions idle tick is P4; BUILD/UPGRADE tab is P5; RESEARCH/CREW/MARKET is P6; STAR MAP is P7.
- **DESIGN.md "Screens" section** now distinguishes "main menu — long-term target (hub)" from "main menu — today (transitional)" and points both at `UI-HUB.md`. The transitional description updated for the single-panel layout.
- **CONTRIBUTING.md docs-checklist** references `UI-HUB.md` as the source of truth for main-menu / hub layout changes.
- **Start screen is Pixi-only** (PR #34). Deleted the dead DOM scaffolding that briefly flashed at page load: the `<input id="playerName">` (identity is fixed to "Chief Dispatcher" since PR #32), the entire `#gameScreen` DOM subtree (LEVEL / NEXT / COMING UP / SCORE / LINES / MULTIPLIER / MISSION TIP / CONTROLS panels, title bar with star, sound/exit buttons, board layer divs), plus the Tailwind + Font Awesome CDN tags that were no longer referenced. `index.html` is now a 50-line bare mount for the Pixi canvas. Fulfills the cleanup promised in the 0.1.0 notes below.

---

## [0.1.0] — 2025-04-18 (P0 complete)

First "playable prototype" milestone. The game is Pixi-rendered on one URL (`https://sergutsu.github.io/StellarCollapse/`), has 9 tiers, 9 field sizes, a mission-select start screen, and a persistent leaderboard. No idle, no persistent credits, no upgrade tree yet.

### Added

- **Mission-select start screen** (PR #32). 3×3 grid of mission cards, one per ranked tier. Click a card to deploy — no mode/complexity/size toggles, no BEGIN button. "CHIEF DISPATCHER" identity card with per-session callsign replaces the player-name input.
- **6-ore catalogue** (PR #32). Red→Pyrite, blue→Cryonite, green→Verdanite, yellow→Helium, bomb→Volatiles, snake→Biomass. Mission cards preview expected ores; Collapsed missions preview the two rare ores.
- **Seeded mission roll** (PR #32). Asteroid names are stable within a session and vary across page loads, via a deterministic Mulberry32 RNG seeded per boot.
- **Pixi starfield + procedural nebulae** (PR #19–#23). Blinking dot stars + cross-sparkle stars + baked-once nebula `RenderTexture`. Parallax drift.
- **Scanner sweep** (PR #20, #21). Transparent board over space; diagonal scanner band reveals the grid as it passes.
- **Pixi HUD port** (PR #17, #18). Score / level / tips / controls / previews / title bar all render on the Pixi stage.
- **Pixi board port** (PR #15, #16). Gradient cells, emoji icons, particle bursts, pulse tickers, snake trail pool.
- **9 ranked tiers** (PR #12). All mode × complexity combos get a leaderboard.
- **Level-speed ramp** (PR #12). Level-1 drop 1000 ms, step −100 ms, floor 200 ms. Level-up every 8 lines.
- **Field-size multipliers** (PR #13). Small ×1.5, medium ×1, large ×0.75. Visible on mission cards indirectly via the scoring formula.
- **Low-FX mode** (PR #13). Past 240 cells, expensive per-cell animations are skipped. Pixi renders all sizes at 60 fps.
- **Special arming timer** (PR #11). In Collapsed, bomb/snake cells have a 5 s arming clock; if unused, they morph into a random normal-colour tile.
- **In-game HUD rework** (PR #8, #9). Level panel left, score/lines right, title bar with reactive star, per-level tips, controls panel, smaller board glow.
- **Field-size selector + 3 sizes per complexity** (PR #7). No `10×20`.
- **Gameplay modes + complexities + 6-tier leaderboard** (PR #3).
- **GitHub Pages deploy + CI tests workflow** (PR #4).

### Changed

- **"Tetris" → "Blocks"** everywhere (PR #7). Legacy `tetris-*` tier scores auto-migrate to `blocks-*`.
- **"Classic" → "Stellar"** for the match-4 mode (PR #6). Legacy `classic-*` tier scores auto-migrate to `stellar-*`.
- **Auto-match explosion colour** now uses per-cell colour, not the clicked cell's colour (PR #5).
- **Gravity freezes** on match / bomb in Collapsed mode (PR #6) to prevent cascade lockups.

### Fixed

- **Board-view desync** during the snake walk animation (PR #10).
- **Scanner glow-band strip gaps** (PR #21).
- **Snake / match star reaction double-fire** on a 4-run that lands a snake cell (PR #18).
- **Star-actor `y` reset** so a `'fall'` (game-over) animation doesn't leave the star below baseline for the next reaction (PR #18).
- **Initial uncrop flash** in the main menu (codex branch folded into main).

### Removed

- **`?engine=*` URL flag** (PR #22). Pixi is the only renderer. Root URL is the game.
- **DOM board renderer, DOM starfield, `body.engine-pixi` CSS gymnastics** (PR #22).
- **Player-name input** (PR #32). Fixed identity "Chief Dispatcher" replaces it; the DOM `<input>` stays in the HTML permanently hidden for now and will be removed in a later cleanup.
- **"10×20" field size** — never shipped. Deliberately avoided so no field feels like "default Tetris".

### Infra / tests

- 68 unit tests (`node --test`), covering GameState, HighScores, and the missions catalogue.
- Pages workflow publishes `main` to `https://sergutsu.github.io/StellarCollapse/` with no build step (Pixi via CDN ESM import map).

---

[Unreleased]: https://github.com/Sergutsu/StellarCollapse/compare/v0.1.0...HEAD
[0.1.0]:      https://github.com/Sergutsu/StellarCollapse/releases/tag/v0.1.0
