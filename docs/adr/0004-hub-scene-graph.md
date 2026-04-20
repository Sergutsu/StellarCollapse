# ADR-0004 — Main menu evolves into a hub scene graph

**Status:** Accepted

## Context

The current main menu is an ~860×820 fixed Pixi panel containing a 3×3
mission-card grid and a MISSION LOG side panel, centered in the viewport via
`sceneRoot.x = (window.innerWidth - HUD_W) / 2`. Two problems surfaced:

1. On wide viewports the panel reads as a small cluster in the top-left rather
   than filling the screen — the centering math is correct, but a fixed panel
   on a 2560-wide monitor just *is* small. Fix requires abandoning the fixed
   panel assumption, not tuning its width.
2. The design has evolved (see `UI-HUB.md`): the main menu is the **hub** of
   an idle/casual layer — top resource bar, persistent left (active missions)
   and right (base command) columns, a tab-swapped center, and a 6-tab
   bottom nav. The current `_buildStartScreen()` is a single method that
   paints everything; it won't scale to 5 zones × 6 tab-panels.

Extending `_buildStartScreen()` to do all of that was considered and rejected
(see Alternatives).

## Decision

Replace the fixed panel with a **hub scene graph**: a `Container` per zone,
owned by a `HubScene` object that manages lifecycle (create, show, hide,
destroy, resize). Tab panels each get their own `Container`, mounted/unmounted
by the `tab` → `panel` switcher. Nothing in the hub relies on a `HUD_W`/`HUD_H`
fixed size — containers size themselves off `app.screen.width` / `.height` at
resize time.

Concretely:

```
HubScene
├── topBar            (full width, fixed height)
│   ├── brandMark
│   ├── resourceStrip
│   └── settingsGear
├── leftColumn        (fixed width, flex height)
│   └── activeMissionsPanel
├── centerRegion      (flex width, flex height)
│   └── activeTabPanel ← swapped from { starMap, missions, buildUpgrade, research, crew, market }
├── rightColumn       (fixed width, flex height)
│   └── baseCommandPanel
└── bottomNav         (full width, fixed height)
    └── tabButton[6]
```

Each `*Panel` / `*Strip` owns its own state subscription + repaint. The
hub's only job is layout: "here's the rectangle you get, fill it." Panels
don't reach into each other.

This structure matches the existing `PixiView` split between `sceneRoot` and
the game-screen layers — it's the same idea, applied to the main menu.

## Consequences

**Accept:**

- `src/pixi-view.js` grows a new scene (`HubScene`) or splits into a
  `src/scenes/HubScene.js` file; the line count of `pixi-view.js` alone gets
  worse before it gets better. The split-file option is preferred once the
  hub has 3+ panels.
- Every layout change becomes a resize-handler change — no more
  "paint once at boot". This is already how the game screen works.
- Panels need a consistent "refresh yourself" protocol (we'll use the existing
  event-driven pattern: panel subscribes to `MetaState` / `MissionRegistry`
  events and repaints only when its data changes).

**Give up:**

- The simplicity of one `_buildStartScreen()` method. In exchange we get a
  layout that scales to wide viewports and six tabs without a rewrite.
- A small amount of initial performance (we're creating ~10 `Container`s
  instead of packing everything under 1). Negligible on modern hardware.

## Alternatives considered

**1. Grow `_buildStartScreen()` in place.** Add more `Container`s but keep
everything in one method, still rooted in a `HUD_W × HUD_H` panel. Rejected:
the fixed panel is the root cause of the centering defect, and keeping all
the panels in one method would guarantee the method breaks 1500 lines within
a phase. That's the exact shape of code that forced `PixiView` to split the
HUD out in the first place.

**2. Rebuild the menu in DOM with Tailwind / React.** Gives us flexbox + CSS
grid for free. Rejected: violates ADR-0001 (Pixi-only renderer). Mixing a
DOM main menu with a Pixi game screen would mean two render stacks and
two event buses. The whole reason we burned the DOM renderer was to stop
paying that tax.

**3. Switch to a full game framework (Phaser, PixiJS-React, etc.).** Scene
management, UI components, layout helpers all included. Rejected: the project
is a no-build deploy via GitHub Pages + an import map. Adding a framework
pulls in a build step or a much bigger CDN bundle. Our scene management
needs are small enough (5 scenes total: start / hub / missionRun / results /
gameOver) that rolling them in ~100 lines of plain JS is cheaper than a
framework.

## Implementation notes

- First PR lands the hub scaffolding with empty panels + the existing 3×3
  board hosted inside the MISSIONS tab. No gameplay change. No new state
  modules yet. This is P2 in `ROADMAP.md`.
- Subsequent PRs replace placeholder panels with real ones, each behind a
  new pure state module (`MetaState`, `MissionRegistry`, `BuildQueue`,
  `IdleClock`).
- The scene graph is intentionally flat — no deep nesting. Panels are peers,
  not parent/child.

## Revisit if

- We ever need >10 tabs in the center region (unlikely; would indicate the hub
  has grown past its scope and needs to split into two screens).
- Frame budget on the hub drops below 60 fps on a mid-range laptop — would
  suggest too much per-tick work in panels, or a bad resize-handler pattern.
  Neither is a scene-graph issue per se, but would trigger a rethink of
  per-panel repaint discipline.
