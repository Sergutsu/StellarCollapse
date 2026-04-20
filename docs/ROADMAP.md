# Roadmap

> Three buckets only: **Now**, **Next**, **Later**. Anything in Now has a branch or PR open. Anything in Later is an idea, not a commitment.
>
> Updated at phase boundaries — not every PR. Last bump: hub wireframe pivot (FLEET & CREW on the right, MISSION BOARD modal with narrative mission cards, rename to Stellar Venture). See [ADR-0006](adr/0006-rename-stellar-venture.md) + [ADR-0007](adr/0007-hub-wireframe-pivot.md).

---

## Phase status

| Phase | Theme | Status |
|---|---|---|
| P0 | Match-4 / Tetris prototype with modes, tiers, field sizes, Pixi renderer, mission-select screen | **Shipped** |
| P1 | Resource ledger: ores tallied per run, credits awarded, results screen | Now |
| P2 | **Hub scaffolding** — viewport-filling 5-zone layout, tab nav, MISSION BOARD modal with narrative mission cards (mapped 1:1 to the 9 tier archetypes), Galactic News ticker; replaces today's transitional mission-select entirely | Next |
| P3 | Persistent meta-state (`MetaState`, `Persistence`) + rep-tier gates on narrative mission cards | **Shipped (data layer)** — mutation hooks land with P1 |
| P4 | Active-missions idle tick (`IdleClock`, `MissionRegistry`): left column ticks ETAs, completion → results → hub with rewards; FLEET & CREW live updates (hull damage, crew injured) on return | Later |
| P5 | BUILD/UPGRADE tab: station diorama, per-building levels, build queue + available-upgrade list (moved from the earlier BASE COMMAND right-column concept per [ADR-0007](adr/0007-hub-wireframe-pivot.md)) | Later |
| P6 | RESEARCH + CREW + MARKET tabs: tech tree, hired operators, ore↔credits trader | Later |
| P7 | STAR MAP tab: sector exploration, mission discovery tied to the map | Later |

Each phase is a handful of small PRs, not one giant PR. The boundary between
phases is when the player-visible loop actually changes — "you can now open
the BUILD/UPGRADE tab and queue a refinery upgrade" is a phase boundary;
"tune bomb radius" is not.

See [`UI-HUB.md`](UI-HUB.md) for the full hub specification that P2 → P7 is
building toward.

---

## Now (P1 — Resource ledger)

Goal: a completed mission awards credits + ores and shows a results screen
before returning to the mission board. **Nothing persists across page reloads
yet** — that's P3.

- [ ] Per-run ore tally on the Pixi view. `ORE_BY_COLOR` translation on
  `match-cleared` / `line-cleared` / `bomb-exploded`, accumulated in a
  run-scoped counter.
- [ ] Results scene (Pixi). Asteroid name, mission stats, ore breakdown with
  icons + counts, credits earned, CONTINUE button returning to mission-select.
- [ ] Credits formula. Final credits = `mission.baseCredits + bonusFromOres +
  levelReachedBonus`. Concrete weights documented in `GAMEPLAY.md` when they
  land.
- [ ] Session-scope `MetaState` stub (pure module, no persistence yet). Holds
  credits + ore totals in memory so we can exercise the results scene without
  taking on localStorage risk.
- [ ] Unit tests for the tally (deterministic).

Out of scope for P1: saving anything, unlocks, upgrades, rep tiers, idle tick.

## Known issues (carry across phases)

Capture real defects the team has spotted that aren't scoped to any single
phase. Don't let these rot — each should be linked to the PR that fixes it
when it's addressed.

- ~~**Main menu not centered on wide viewports.**~~ Fixed by the P2 hub shell —
  the start screen is now a viewport-filling scene graph (top bar + columns +
  bottom nav repositioned in `_layoutHubShell()` on resize), not a fixed
  `HUD_W × HUD_H` panel. Historical reference:
  [`images/current-layout-bug-2026-04-20.png`](images/current-layout-bug-2026-04-20.png).
- ~~**MISSION LOG panel overlaps the dispatcher card + title bar.**~~ Fixed by
  deleting the MISSION LOG panel entirely (the highscore system is gone;
  gameplay is about mission-run resources, not a leaderboard). Dispatcher card
  now sits directly beneath the mission grid in a single centered panel.

## Now (P2 — Hub scaffolding, shipping)

Goal: replace today's fixed-panel start screen with the **hub scene graph** from
[`UI-HUB.md`](UI-HUB.md). No new gameplay yet — the hub just wraps what exists.

Delivered in this PR:

- Viewport-filling hub scene. Top bar + 3 columns + bottom nav are containers,
  not absolute-positioned children of a fixed panel. Resize fills the screen.
- **Top bar** with brand mark, static resource strip (placeholder numbers from
  the session `MetaState` stub), settings gear.
- **Left column** — `ACTIVE MISSIONS` header + empty-state card (`No active
  missions. Deploy from the MISSIONS tab.`). Real ticking lands in P4.
- **Right column** — `FLEET & CREW STATUS` header + a static readout of the
  starter fleet (3 ships, class/callsign/hull/availability) and starter crew
  (3 members, name/role/level/status). Live ticking lands in P4.
- **Galactic News ticker** — one-line scrolling strip below the top bar.
  Static pool of flavor strings in P2; runtime events wire in from P4.
- **Bottom nav** — 6 pill buttons. MISSIONS is the default active tab with
  the MISSION BOARD modal open at boot. Other tabs render a `Unlocks at Rep
  Tier N` stub panel.
- **MISSIONS tab + MISSION BOARD modal** — tab background is a static
  galactic-map thumbnail; modal floats a 2×2 grid of narrative mission cards
  (session-rolled subset of the 9-entry catalog in [`UI-HUB.md` §7](UI-HUB.md#narrative-mission-catalog)).
  Each card maps 1:1 to a `HIGHSCORE_TIERS` archetype; clicking ACCEPT
  launches the puzzle run with the tier's `gameConfig`. Dispatcher identity
  is folded into the top bar brand area.
- Side effect: the remaining centering known-issue disappears (hub is
  viewport-filling by construction).

Out of scope for P2: idle ticking, persistence, upgrades, research, crew,
market, star map, station 3D.

## Later (P3+)

Unsorted, not committed to — see phase table for rough ordering:

- **Persistent meta (`stellar-save:v1`).** Versioned localStorage adapter.
  Replaces `HighScores`. Rep tier survives reloads. Gates some T8/T9 missions.
- **Active-missions idle tick.** `IdleClock`, `MissionRegistry`. Missions
  deployed from MISSIONS tab run on a timer; completion pushes a toast + the
  left card flips to `Haul Ready` and opens the results screen on click.
- **Upgrade tree.** BUILD/UPGRADE tab. Spend ores + credits on building levels.
  Permanent effect on the hub's passive rates; per-run perks stay in research.
- **Research tree.** Per-run perks (bigger bomb, longer snake, bonus ore %).
- **Crew.** Hired dispatchers / operators with per-archetype skills.
- **Market.** Ore ↔ credits trader with daily drift.
- **Star map.** Sector exploration; mission discovery tied to the map.
- **Daily reroll.** `buildMissions({ seed })` already supports this; swap the
  session seed for `dayOfYear`. Optional reroll button costs credits.
- **Mobile / touch pass.** Right now the Pixi scene is mouse-first. Field
  sizes already scale; input bindings + tab nav don't.

---

## How this file moves

- When a Now item is done, strike it from Now in the PR that lands it and add
  a line to `CHANGELOG.md`.
- When all Now items land, the PR that ships the last one also promotes the
  next batch from Next → Now and sketches a new Next.
- Later is append-only (ideas park). Items graduate from Later → Next when
  we're ready to commit.
- Known issues get a `→ Fix lands with PR #NNN` annotation when closed, then
  stay until the next phase rollover (where they can be pruned).
