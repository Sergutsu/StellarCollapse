# ADR-0009 — Scene-graph extraction for PixiView

**Status:** Accepted

## Context

`src/pixi-view.js` has grown to ~3.4k lines. It owns the hub shell (top bar + news ticker + MISSION BOARD modal + 3 columns + 6-tab nav), the in-game HUD (title bar + columns + previews + board + scanner + effect pools), the mission results overlay, the start-screen layout dance, and the Pixi bootstrap. One file, one god class.

The user raised this directly: "maybe it's time for another architectural shift to MVC with good DI framework?" My answer at the time was **no framework**:

- The model layer is already pure (`GameState`, `MetaState`, `missions`, `run-ledger`).
- The controller layer is already tiny (`main.js`, ~190 lines of wiring).
- What's actually painful is that `PixiView` is a giant file — not that dependencies are unwired.
- A DI framework would drag in a build step (decorators / TS) that this repo has explicitly rejected (ADR-0001, `no-build-step` in `ARCHITECTURE.md`).

The cheaper move is to split `PixiView` into **scenes** — one class per screen, each constructed with its explicit deps, swapped by a small manager. That IS dependency injection; it's just by hand and doesn't demand a framework.

**Expected scale.** The hub has 6 tabs that will each become a scene — `STAR MAP` / `MISSIONS` / `BUILD/UPGRADE` / `RESEARCH` / `CREW` / `MARKET`. Beyond the current match-4/Tetris minigame, 5+ additional minigames are on the roadmap (each a scene). Plus `HubScene` wrapper + `ResultsScene` + bootstrap. Realistic target: **12–14 scenes** by the time the hub is fully tabbed and the minigame library is seeded. The split has to scale from day one.

## Decision

Introduce a **scene graph** under `src/scenes/`:

- **`SceneManager`** — a ~70-line registry. Scenes register by name; the manager supports `show(name, ...args)` / `hide(name)` / `layout(screen)` / `destroy()`. Layout fan-out goes to *all* registered scenes (hidden or not) so a hidden scene re-shown after a resize doesn't flash at the old size.
- **Scene contract** — an object exposing `show(data?)` / `hide()` / optional `layout(screen?)` / optional `destroy()` / read-only `visible`. No base class — duck-typed so tests can pass plain objects.
- **Extraction order (staged across several PRs):**
  1. **PR 1 (this ADR).** Extract `ResultsScene` — the smallest, newest, most self-contained screen. Proves the pattern.
  2. **PR 2.** Extract `HubScene` shell — resource bar, ACTIVE MISSIONS column, FLEET & CREW column, bottom nav, news ticker. The **center panel** is a tab-swap slot that today renders the MISSION BOARD modal; PR 2 keeps it inline.
  3. **PR 3.** Extract `GameScene` — board + HUD columns + scanner + previews + effect pools. `PixiView` shrinks to a bootstrap wrapper.
  4. **PR 4+.** Extract each hub tab into its own scene registered under the hub's center slot: `MissionsTabScene`, `StarMapTabScene`, `BuildUpgradeTabScene`, `ResearchTabScene`, `CrewTabScene`, `MarketTabScene`. One PR per 1–2 tabs.
  5. **PR N.** Codify a `MinigameScene` contract (what a minigame must expose to the hub + `main.js`) and convert the current `GameScene` to satisfy it. Each new minigame ships as a new scene after that.

**PixiView keeps its public API** (`showStartScreen`, `showGameScreen`, `showResultsScreen`, `hideResultsScreen`, …) across every staged PR until the full hub + game + tabs are extracted. `main.js` is untouched by the refactor. Each PR ships a working game, not a half-demolished one.

**Scene groups (deferred).** Once ≥ 2 hub tab scenes land, `SceneManager` gets a thin `group` concept: "hub" is a group whose members are mutually exclusive in the center slot (one tab visible at a time), "overlay" is a group whose members can show over another group (results, modals). Deferring the actual code until a second tab scene exists — premature to design the group API off one example.

**Shared helpers** (`_drawHologramPanel`, `_buildStartButton`, panel text styles) stay on `PixiView` for now because the hub + in-game HUD still call them. They're passed to scenes via constructor so scenes don't import from `PixiView` (no circular imports). A later PR can move them to a standalone `pixi-ui-kit` module once all three scenes exist and `PixiView` itself is the last remaining caller.

## Consequences

**Accept:**
- Three PRs instead of one. Each review is manageable (~300–500 lines of net churn), and the game stays shippable between them.
- `PixiView` shrinks in place. After PR 3 it will be small enough to either delete (fold into `main.js`) or keep as a thin bootstrap wrapper — decided then, not now.
- Scenes are trivially unit-testable: the `SceneManager` has its own test suite using plain-object fakes (zero Pixi dep), and future scenes can follow the same pattern where it makes sense.
- Dependencies are explicit at construction time. A scene declares exactly what it needs (`app`, `uiRoot`, specific helpers) — no reaching into `PixiView` for arbitrary instance state.

**Give up:**
- Some duplication during the transition. Helpers shared across the monolith and extracted scenes stay on `PixiView` and are bridged with arrow-function wrappers. This is intentional; it disappears once all three scenes have moved out.
- No framework magic. Scene wiring is manual — each new scene requires a `.register(...)` call in `PixiView.init()`. Fine at our scale (≤ 3 scenes).

## Alternatives considered

1. **MVC + DI framework (Angular / Inversify / Awilix).** Rejected: adds a build step, is overkill for ≤ 5 services, and doesn't solve the "PixiView is a giant file" problem — it just wraps that file in decorators.
2. **Rewrite `PixiView` in one PR.** Rejected: 3.4k lines is unreviewable in a single diff. High risk of silent regression.
3. **Extract helpers first (ui-kit), scenes later.** Rejected: the helpers have fewer consumers than the scenes do; pulling them out in isolation doesn't shrink `PixiView` meaningfully. The scene extraction *forces* the ui-kit boundary to emerge organically — which is where it should land.
4. **Event-bus-based scene routing** (scenes subscribe to state events directly; no manager). Rejected for now: the current cross-scene visibility dance (hide hub + HUD while results is up) is simpler to express as imperative manager calls than as event choreography. Revisit if the manager ever grows past ~100 lines.

## Implementation notes

- `ResultsScene` owns its Pixi `Container` and attaches it to the shared `uiRoot` passed in at construction. It does **not** know about `sceneRoot` (in-game HUD) or `_topControls` or `_startScreen` — `PixiView.showResultsScreen` handles the cross-scene visibility dance and then forwards to `sceneMgr.show('results', …)`.
- Scene `layout(screen)` receives the Pixi `app.screen` rectangle so scenes don't reach back through `app.screen` themselves. A scene with no visible state (yet to build its nodes) no-ops.
- `SceneManager` is pure JS — no Pixi imports — so it can be unit-tested with fake scenes under `node --test`.

## Revisit if

- We grow past ~5 scenes with overlapping state.
- A sixth scene wants to render *over* another scene (picture-in-picture) — current manager assumes one primary, one optional overlay.
- Helper duplication between `PixiView` and the scenes starts causing drift. Then extract `pixi-ui-kit.js` in a follow-up PR.
