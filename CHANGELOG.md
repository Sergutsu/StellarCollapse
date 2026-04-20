# Changelog

Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are merge-to-main dates. Entries describe player-visible changes first, infra changes last.

This log starts at the PR #32 release. Earlier history is in the git log.

---

## [Unreleased]

_Nothing yet._

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
