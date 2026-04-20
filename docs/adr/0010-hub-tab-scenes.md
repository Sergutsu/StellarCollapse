# ADR-0010: Hub tab scenes

Date: 2025-04-20
Status: Accepted
Supersedes: n/a
Superseded by: n/a
Refines: [ADR-0009 Scene-graph extraction](0009-scene-graph-extraction.md)

## Context

ADR-0009 split `PixiView` into top-level scenes (`HubScene`, `GameScene`,
`ResultsScene`) hosted by a small `SceneManager`. That accomplished the
first-order goal -- no more 3.1k-line monolith -- but it left the hub's
**center panel** as a monolith-within-a-scene. The hub's bottom nav has
six mutually-exclusive tabs (`STAR MAP`, `MISSIONS`, `BUILD/UPGRADE`,
`RESEARCH`, `CREW`, `MARKET`), each of which is supposed to render a
visually distinct surface in the same center slot:

- STAR MAP: coordinate grid + sector pins + legend + floating detail panel
- MISSIONS: galactic-map backdrop + MISSION BOARD modal overlay
- BUILD/UPGRADE: orbital-station diorama + build queue + upgrade list
- RESEARCH: tech tree
- CREW: hired-dispatcher roster with per-mission skill modifiers
- MARKET: ore-vs-credits trader

At the start of PR 5, `HubScene._buildCenter` owned a single Pixi
container with a shared title `Text`, a dotted-grid `Graphics`, a shared
stub `Text`, and the MISSIONS-tab `OPEN MISSION BOARD` button. The five
locked tabs just overwrote `stub.text` with `"<LABEL> -- Unlocks at Rep
Tier N. Coming in a later phase."` and hid the button. That works for
stubs but does not scale: once one tab has real content, adding it
inline would push `HubScene` back toward 2k+ lines and would couple the
hub's shell layout (top bar, columns, nav) to every tab's internal
Pixi tree.

We also want to ship hub tab content incrementally, one PR per tab,
without re-reviewing the hub chrome each time.

## Decision

**Each hub tab with bespoke content becomes its own scene class, hosted
by `HubScene` inside the center panel.** Tab scenes follow the same
duck-typed contract as top-level scenes registered under
`SceneManager`:

```
tab.show(data?)           -- make the tab visible; lazy _build on first show
tab.hide()                -- hide the tab; close any floating sub-panels
tab.layout({ width, height })
                          -- reposition against the center-panel inner rect
tab.destroy()             -- tear down Pixi nodes
get tab.visible           -- read-only flag
```

Key structural differences from top-level scenes:

1. **Tab scenes are hosted by `HubScene`, not by `SceneManager`.** They
   live in an `_nodes.tabs` map local to `HubScene`. Reason: tab scenes
   depend on the hub's center-panel Pixi container (they mount their
   root under `centerPanel.panel` so they inherit the hologram surface
   and resize with it). Exposing them at the top-level registry would
   leak that coupling and invite misuse from outside the hub.
2. **Mutually exclusive.** Clicking a bottom-nav tab calls
   `hubScene._setActiveTab(id)` which hides every extracted tab scene
   and then shows only the one matching `id` (if any). Tabs still
   using the inline "locked stub" path fall through to the default
   branch that sets the shared `stub.text`.
3. **Layout fan-out.** `_layoutCenterPanel` calls
   `tab.layout({ width, height })` on every tab scene (visible or not)
   after the center panel's hologram frame has been redrawn. That way
   a hidden tab does not flash at the old size when the user re-shows
   it after a viewport resize.
4. **Ctor dependencies are minimal.** `new TabScene({ parent, ... })`
   where `parent` is the Pixi container to mount under. Shared UI
   helpers (`drawHologramPanel`, `buildStartButton`, `panelLabel`) come
   from `src/pixi-ui-kit.js` (ADR-0009, PR 4).

### First extraction: STAR MAP (PR 5)

`src/scenes/tabs/star-map-tab.js`. Owns the coordinate grid, 8 sector
pins, map legend, galactic overview thumbnail, and a floating `SYSTEM
DATA` panel with a `PLOT COURSE` button. Sector catalog is static; the
`PLOT COURSE` button is a stub (real warp-cell deduction + sector-to-
mission wiring ships in ROADMAP P7). STAR MAP is now **unlocked**
(`HUB_TABS[0].locked = false`) so the tab is reachable from the first
boot.

### Rollout plan

One tab per PR, in order of design-clarity (which has the most
complete mock today):

- PR 5: STAR MAP (this PR)
- PR 6+: MISSIONS as a scene (right now the MISSIONS tab is inline
  `_buildCenter` + `_buildMissionBoardModal`; extracting it will delete
  the last inline center-panel content from `HubScene`)
- PR 7+: BUILD/UPGRADE, RESEARCH, CREW, MARKET as mocks solidify

Each subsequent PR follows the same pattern: add a file under
`src/scenes/tabs/`, unlock the corresponding `HUB_TABS` entry, register
the instance in `HubScene._build`, add one `else if` branch in
`_setActiveTab`. No `SceneManager` changes needed.

### Escape hatch: promote to top-level if a tab outgrows the slot

If a tab is eventually promoted to a full-screen view (e.g. the STAR
MAP becoming an overworld that replaces the hub when active), the
same scene class registers under `SceneManager` instead of
`HubScene._nodes.tabs` and starts receiving top-level
`show/hide/layout` from the manager. The contract is identical so
the promotion is a registration-site change, not a rewrite.

## Consequences

**Positive**

- Each tab's Pixi tree has one file to review. Diffs stop stepping on
  hub-chrome code.
- Tabs can be implemented in parallel (separate PRs, no shared
  center-panel mutable state).
- Tab-local state (e.g. the currently-selected sector in STAR MAP)
  lives on the tab scene, not on `HubScene`. Clearing it on `hide()`
  is explicit and co-located.
- `HubScene` shrinks as tabs extract: the inline stub path becomes
  dead code once all six tabs are scenes.

**Negative**

- Two places register scenes: top-level (`main.js` -> `SceneManager`)
  and hub-local (`HubScene._nodes.tabs`). Mitigated by (1) both
  following the same duck-typed contract, (2) the escape-hatch path
  above, and (3) documenting the distinction explicitly here.
- `_layoutCenterPanel` fans out to all tab scenes on every resize.
  Cost is negligible at six tabs but would need revisiting if tab
  count grew into the dozens (it will not -- the hub has exactly six
  tabs by design).

**Neutral**

- Tab-scene files live under `src/scenes/tabs/`. Symmetric with
  `src/scenes/` for top-level scenes; easy to find.

## Alternatives considered

- **Register tab scenes under `SceneManager` directly**, keyed as
  `hub:star-map` etc. Rejected because `SceneManager.layout` would
  then fire on every tab every resize regardless of whether the hub
  is visible, and the tab scenes' `show()` would need to guard
  against "hub not visible" state leaking. Hub ownership keeps the
  lifecycle gated behind hub visibility.
- **Keep tabs inline inside `_buildCenter` with `if` branches.**
  Rejected -- that is what we had, and it does not scale past the
  stub case (projected 6 tabs x ~300-600 lines each = 2-4k lines
  back inside `HubScene`).
- **One "center-panel content" interface with per-tab renderers
  behind a single container.** Rejected as a premature abstraction.
  The scene contract we already have (show / hide / layout / destroy)
  handles this exact shape; there is no need for a separate interface.
