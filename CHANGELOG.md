# Changelog

Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are merge-to-main dates. Entries describe player-visible changes first, infra changes last.

This log starts at the PR #32 release. Earlier history is in the git log.

---

## [Unreleased]

### Added

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
