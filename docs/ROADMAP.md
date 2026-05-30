# Roadmap

> Three buckets only: **Now**, **Next**, **Later**. Anything in Now has a branch or PR open. Anything in Later is an idea, not a commitment.
>
> Updated at phase boundaries — not every PR. Last bump: P4 complete — persistent idle dispatch loop (real `IdleClock` + MetaState-backed active missions, reload + offline survival, CLAIM/RETURN flow).

---

## Phase status

| Phase | Theme | Status |
|---|---|---|
| P0 | Match-4 / Tetris prototype with modes, tiers, field sizes, Pixi renderer, mission-select screen | **Shipped** |
| P1 | Resource ledger: ores tallied per run, credits awarded, results screen | **Shipped** |
| P2 | **Hub scaffolding** — viewport-filling 5-zone layout, tab nav, MISSION BOARD modal with narrative mission cards (mapped 1:1 to the 9 tier archetypes), Galactic News ticker; replaces today's transitional mission-select entirely | **Shipped** |
| P3 | Persistent meta-state (`MetaState`, `Persistence`) + rep-tier gates on narrative mission cards | **Shipped** (mutation hooks wired in P1) |
| P4 | Active-missions idle tick (`IdleClock`): persistent wall-time dispatches survive reload + offline; left column shows live ETAs + CLAIM/RETURN; assets free on completion/abort; rewards (credits + ores) granted via MetaState | **Shipped** (full persistent idle loop + pure clock + MetaState integration) |
| P5 | BUILD/UPGRADE tab: station diorama, per-building levels, build queue + available-upgrade list (moved from the earlier BASE COMMAND right-column concept per [ADR-0007](adr/0007-hub-wireframe-pivot.md)) | **Scaffolding shipped** (tab scene + static diorama + stub build queue; real `BuildQueue` MetaState integration later) |
| P6 | RESEARCH + CREW + MARKET tabs: tech tree, hired operators, ore↔credits trader | **RESEARCH improved** — multi-slot (2 default), cancel/resume with progress save, left-column active projects view, upgradable via BUILD tab. Real ticking + persistence working.
| P7 | STAR MAP tab: sector exploration, mission discovery tied to the map | **Scaffolding shipped** (tab scene + sector pins + SYSTEM DATA panel; real warp-cell dispatch later) |

Each phase is a handful of small PRs, not one giant PR. The boundary between
phases is when the player-visible loop actually changes — "you can now open
the BUILD/UPGRADE tab and queue a refinery upgrade" is a phase boundary;
"tune bomb radius" is not.

See [`UI-HUB.md`](UI-HUB.md) for the full hub specification that P2 → P7 is
building toward.

---

## Shipped (P1 — Resource ledger)

A completed mission now awards credits + ores and shows a results screen
before returning to the hub. Because P3 shipped first, the reward envelope is
persisted through `MetaState` + `Persistence` automatically — the top-bar
resource chips update the moment the player hits CONTINUE and survive a
reload.

- [x] Per-run ore tally. `RunLedger` subscribes to `match-cleared`,
  `bomb-exploded`, and `lines-cleared` and maps each cleared cell through the
  tile-colour → ore-id identity (`ORE_IDS` mirrors tile colours; see
  [ADR-0008](adr/0008-meta-state-persistence.md)). One cell = +1 ore.
- [x] Results scene (Pixi hologram overlay). Asteroid name + sector + tier,
  run stats (score / level / lines / cells / matches / bombs), 6-ore
  breakdown with icons + counts, credits earned with base + score-bonus
  breakdown, CONTINUE button returning to the hub.
- [x] Credits formula. `credits = mission.baseCredits + floor(score / 10)`,
  clamped at zero. Tuned to be simple + predictable — ore rarity already
  scales through the tier → ore-roster mapping.
  ([`GAMEPLAY.md §5 / §7`](GAMEPLAY.md))
- [x] Reward envelope wiring. CONTINUE calls
  `MetaState.applyMissionReward({credits, ores, missionId})`, which dedupes
  completed missions, clamps + floors the deltas, and auto-saves through
  `Persistence`.
- [x] Unit tests for the tally + credits formula (11 new tests, 97/97
  passing).

Out of scope for P1 (kept deferred): idle tick on ACTIVE MISSIONS (P4),
rep-tier gates on cards (uses the `MetaState` plumbing landing now but the UI
ships in P2's follow-up), and the station diorama tabs (P5+).

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

Out of scope for P2: idle ticking (partially landed in P4 scaffolding),
upgrades (BUILD/UPGRADE tab scaffolding shipped), research (RESEARCH tab
scaffolding shipped), crew, market, station 3D.

## Later (P3+)

Unsorted, not committed to — see phase table for rough ordering:

- **Persistent meta (`stellar-save:v1`).** Versioned localStorage adapter.
  Replaces `HighScores`. Rep tier survives reloads. Gates some T8/T9 missions.
- **Active-missions idle tick.** Real `IdleClock` + `MissionRegistry` ticking.
  The idle dispatch UI is shipped (mission planner with IDLE/MANUAL toggle,
  ship + crew assignment, idle fleet panel with progress/ABORT/COMPLETE). What
  remains: background timer that advances idle missions, completion-to-results
  flow, and MetaState reward integration.
- **BUILD/UPGRADE MetaState integration.** The tab scene is shipped (station
  diorama, callout pins, stub build queue + upgrade cards). Remaining: real
  `BuildQueue` in MetaState, cost deduction, build-timer ticking, level-up
  effects.
- **Research MetaState integration.** The tab scene is shipped (tech tree,
  hex nodes, detail card, INITIATE RESEARCH CTA). Remaining: `MetaState
  .research` slice, cost deduction, tick-based research clock, upgrade-apply.
- **STAR MAP warp dispatch.** The tab scene is shipped (sector pins, SYSTEM
  DATA panel, PLOT COURSE stub). Remaining: warp-cell deduction, mission
  spawn from sector selection.
- **Crew.** Hired dispatchers / operators with per-archetype skills.
- **Market.** Ore ↔ credits trader with daily drift.
- **Daily reroll.** `buildMissions({ seed })` already supports this; swap the
  session seed for `dayOfYear`. Optional reroll button costs credits.
- ~~**Mobile / touch pass.** Right now the Pixi scene is mouse-first. Field
  sizes already scale; input bindings + tab nav don't.~~

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
