# ADR-0007: Hub wireframe pivot — FLEET & CREW + MISSION BOARD modal + narrative missions

- **Status:** Accepted
- **Date:** 2026-04
- **Refines:** [ADR-0004 — Hub scene graph](0004-hub-scene-graph.md) (not superseded; the scene-graph bet stands, this ADR refines the contents of the zones)

## Context

ADR-0004 committed to a viewport-filling hub scene with 5 persistent
zones + 6 tab-panels, and pointed at `UI-HUB.md` for the
element-by-element spec. That spec was drafted against an earlier
reference mock (`docs/images/hub-vision.png`) whose right column was
**BASE COMMAND** — always-visible build queue + available-upgrades
list — and whose center was a **station diorama** with clickable
buildings even before a mission was picked.

The designer produced a newer mock (`docs/images/hub-mission-board-mock.png`)
after PR #37 merged. Three non-cosmetic differences from the earlier
mock:

1. **Right column is FLEET & CREW STATUS**, not BASE COMMAND.
   - Shows ships (class, callsign, refit level, hull %, availability
     status) and hired crew (name, role, skill level, status).
   - The build queue and available-upgrade list are gone from the
     right column — they move inside the **BUILD/UPGRADE** tab (still
     reachable via the bottom nav, just not always-visible).
2. **Mission board is a modal overlay**, not the center tab's resting
   state. The MISSIONS tab's static background is a galactic-map
   thumbnail + Galactic News ticker; a 2×2 grid of **narrative
   mission cards** floats on top as a dismissible modal.
3. **Narrative mission cards replace the 3×3 tier archetype grid at
   the top level of presentation.** Cards have flavor names
   (`Operation: Black Hole Anomaly`, `Xeno-archeology Dig`, `Trade
   Route Defense`, `Relic Recovery`, …), a type tag (Mining /
   Exploration / Research / Salvage / Combat), a sector / location,
   a risk factor, a duration ETA, and an ore preview. The 9 tier
   archetypes from `HIGHSCORE_TIERS` stay as the gameplay
   infrastructure underneath — each narrative card maps 1:1 to one
   tier archetype (see also ADR-0003).

Plus a few smaller spec additions: a **Galactic News ticker** stripe
under the top bar, a `STELLAR VENTURE` brand (ADR-0006), and the
MISSION BOARD modal's REROLL + refresh affordances.

## Decision

Adopt the new mock as the canonical hub spec. Update `UI-HUB.md`
accordingly:

- Right column: **FLEET & CREW STATUS** (fleet ships + crew roster,
  always visible). Hull %, availability, assignment status all live
  here.
- Center MISSIONS tab: static galactic-map backdrop + **MISSION BOARD
  modal** as the default overlay on boot. ESC / backdrop-click
  dismisses.
- MISSION BOARD content: **narrative mission cards**, catalog of 9
  (one per tier archetype) with session-rolled subset visible
  (4–8 cards). See `UI-HUB.md` §7 for the catalog table.
- BUILD/UPGRADE tab owns the build queue + available-upgrade list
  that were previously persistent in the right column.
- Galactic News ticker is a persistent one-line strip under the top
  resource bar.
- The **default active tab at boot is MISSIONS** (with the mission
  board modal open), not STAR MAP. The mission board is the game's
  primary verb; it greets the player first.

Tier ↔ narrative mission mapping is **1:1 and canonical** — one
narrative mission per `HIGHSCORE_TIERS` entry, the tier order is the
difficulty source of truth, the narrative name is the flavor skin
(see `UI-HUB.md` §7 for the full table).

## Consequences

**Pros**
- Right column is always-useful state (ships + crew are the nouns the
  player cares about every session), not a context-specific
  actionables list (build queue only matters when you're about to
  build).
- Modal mission board lets the MISSIONS tab double as a "sector
  status" view after the modal is dismissed — you see the map, the
  ticker, and the active missions panel next to each other without the
  card grid in the way.
- Narrative cards decouple the **flavor** of a mission from the
  **gameplay archetype**, so we can add / swap narrative missions later
  without touching `GameState` or `HIGHSCORE_TIERS`.
- Matches what the designer actually drew; no drift between mock and
  spec.

**Cons**
- Phase plan shifts: the BUILD/UPGRADE work moves from "persistent
  right column" (P3 in the old plan) to "whole tab with diorama" (P5
  in the updated plan). That's more work per tab, but fewer zones
  ship at once so each PR stays scoped.
- Narrative catalog adds 3 fields per tier (`narrativeName`, `type`,
  `etaMinutes`) — `src/missions.js` needs to grow. Still pure, still
  testable, just wider.
- The 9-tier puzzle matrix is more hidden from the player than in the
  current transitional screen (which labels cards "S·C" / "A·M" /
  etc.). Flavor-first presentation means difficulty is communicated
  via Risk factor + ore preview + sector, not by tier letters.
  Acceptable trade for the new framing.

## Alternatives considered

1. **Keep BASE COMMAND on the right, leave MISSION BOARD inline.**
   Rejected — the designer's new mock is the canonical reference.
   Ignoring it would re-create the drift ADR-0006 was trying to avoid.
2. **Two persistent right-column sections (BASE COMMAND on top, FLEET
   & CREW below).** Rejected — too cluttered at viewport widths
   below ~1400px; the whole point of tabs is that context-specific
   panels live behind tabs, not always-visible.
3. **Narrative missions as free-form, not 1:1 with tiers.** Rejected —
   breaks ADR-0003's clean 1:1 mapping; opens the door to tuning
   mismatches (two narrative missions claiming different reward
   previews while backed by identical `gameConfig`s). Easier to add a
   second narrative skin per tier later (rotating) than to un-do a
   many-to-many now.
4. **Show the tier-archetype grid and the narrative grid together.**
   Rejected — defeats the purpose of the narrative skin; redundant
   info density.

## Implementation notes

- `src/missions.js` grows by three fields per tier. No change to the
  `gameConfig` shape; the puzzle scene keeps consuming the same
  `(mode, complexity, fieldSize)` triple.
- The MISSION BOARD modal and the FLEET & CREW STATUS column are both
  single-container Pixi subscenes — following the scene-graph pattern
  committed in ADR-0004.
- The Galactic News ticker is a pure-text scroller over a background
  rect; renders on its own ticker lane, does not re-layout the rest
  of the hub.
- Default-tab-is-MISSIONS is a one-line change in the scene bootstrap;
  noted here so we don't bikeshed it later.

## Revisit if

- A future mock moves the mission board back inline (non-modal).
- The narrative catalog grows beyond a 1:1 mapping (e.g. rotating
  catalog with 2+ narratives per tier on a daily cycle) — at that
  point we probably want a dedicated `NarrativeCatalog` module and
  this ADR gets superseded.
- The right column turns out to need more than FLEET & CREW (e.g.
  alerts, distress calls). That would be a new ADR, not a revision
  of this one.
