# ADR-0005 — Delete the HighScores leaderboard system

## Status

Accepted.

## Context

Stellar Collapse shipped with a per-tier leaderboard from day one (`src/highscores.js`, `stellarCollapseScoresV2` in localStorage, 9 tiers × top-5 entries, rendered as the "MISSION LOG" panel on the right side of the start screen). It was designed for the pre-expansion version of the game, where the only feedback loop was "beat your own score".

The game has since been reframed (see `DESIGN.md`): the puzzle board is now **one mission type inside a hybrid casual/idle space-exploration game**. Mission runs will eventually bank credits + ores into a persistent `MetaState`, drive rep tiers, feed upgrade trees. The core feedback loop is **resource accumulation**, not score comparison.

Keeping the leaderboard around produced two concrete problems:

1. **UX regression on the start screen.** The right-hand MISSION LOG panel (tier tabs + top-5 rows) visually competed with the 3×3 mission card grid for attention, overlapped the dispatcher identity card + title bar on the fixed `HUD_W × HUD_H` panel, and wasted screen real estate that will belong to the hub's ACTIVE MISSIONS / BASE COMMAND columns (`UI-HUB.md`).
2. **Architectural drift.** `HighScores` and the eventual `MetaState` would have lived in parallel — both writing to localStorage, both keyed by tier, both updated on `game-over`. Two storage modules for what is morally one "player ledger" is a future bug farm.

## Decision

Delete the HighScores system entirely. Specifically:

- `src/highscores.js` and `tests/highscores.test.js` are **removed from the tree** (not deprecated, not moved behind a flag, not left for a later cleanup).
- The MISSION LOG panel (rankings label, tier tab row, tier label, leaderboard list container, empty-state text) is **removed from `_buildStartScreen`**. The supporting `_refreshLeaderboard` method is gone.
- `view.setHighScores()` and `view.setSelectedTier()` are **removed from the public `PixiView` API**. `this._highScores` field deleted from the constructor.
- `src/main.js` no longer imports `HighScores` or `findTier`. The `state.on('game-over', ...)` handler is reduced to `view.showStartScreen()` — no save, no name, no tier lookup.
- The right-hand panel is collapsed into the existing left panel. The dispatcher identity card moves to sit directly beneath the 3×3 mission grid.
- `HIGHSCORE_TIERS` **stays** in `src/constants.js` — despite the name, it is the source of truth for the 9 mission archetypes consumed by `src/missions.js` + `tests/game-state.test.js`. Renaming it to `MISSION_TIERS` is a separate mechanical cleanup, not part of this ADR.
- Existing `stellarCollapseScoresV2` data in player localStorage is **not migrated**. It becomes orphaned until the browser profile clears it. No player-visible regression: there is no UI that reads it anymore.

## Consequences

**Accepted (pros):**

- One fewer persistence module to version, migrate, and test. When `MetaState` arrives in P3 it has the field to itself.
- Start screen becomes a single centered panel. The MISSION LOG overlap defect from `docs/images/current-layout-bug-2026-04-20.png` is resolved by deletion, not by layout fiddling.
- Codebase shrinks by ~240 lines (116-line module + 120-line test + ~170 lines of Pixi leaderboard rendering) with no functional loss.
- Unit-test count drops from 68 to 60 — all 8 lost tests covered behaviour of the deleted module.
- Game framing lines up with `DESIGN.md` pillar #3 ("every tile you clear is a resource") — there is no side channel that rewards score over resource tally.

**Given up (cons):**

- Personal-best recall is gone. A player who beat their T5 record on Tuesday has no UI trace of that on Wednesday. If we want it back, it has to come via `MetaState` (P3+).
- No cross-session "progress" signal on the start screen between now and P1's results scene landing. The mission-select is fully stateless.
- Any future "compete with friends" direction needs to be built fresh, not retrofitted. That's arguably a pro in a casual/idle game — competitive leaderboards are a different product.

## Alternatives considered

- **Hide the MISSION LOG panel but keep the module.** Rejected. Dead code on disk rots (per `CONTRIBUTING.md` non-negotiables). The DOM-renderer-behind-a-flag experience earlier in this project showed that "keep for safety" escape hatches silently compound. If the leaderboard is the right abstraction we can rebuild it on top of `MetaState` in one afternoon.
- **Move the MISSION LOG to a top-bar chip modal now, before the hub lands.** Rejected. It pre-commits the hub's top-bar budget to a system we have decided against. The open question in `UI-HUB.md` ("where does MISSION LOG live?") now has a concrete answer — nowhere — which frees up the top bar for the resource strip.
- **Keep `HighScores` writing to localStorage silently (no UI) so we don't lose data.** Rejected. Silent writers are the worst kind of zombie code — they imply the data is used when it isn't.
- **Rename `HIGHSCORE_TIERS` to `MISSION_TIERS` in this same PR.** Deferred. It touches 8+ files including tests and docs; worth doing as a focused rename PR, not bundled into a behavioural change.

## Implementation notes

- The layout regression from the fixed `HUD_W/HUD_H` panel is only **partially** fixed by this change. Single-panel centering improves the clustering, but the panel is still fixed-size and won't fill ultrawide viewports. That fully resolves with P2 hub scaffolding (tracked in `ROADMAP.md` Known Issues).
- If a follow-up PR renames `HIGHSCORE_TIERS → MISSION_TIERS`, it should also move `findTier` out of `constants.js` into `missions.js` (consumer is already `missions.js`), and drop the `findTier` tests from `tests/game-state.test.js` (they're really constants-shape tests, not game-state tests).

## Revisit if

- We reintroduce competitive framing (daily challenge, friends leaderboard, seasonal ranks). At that point, write a new ADR that supersedes this one and builds leaderboards on top of `MetaState`.
