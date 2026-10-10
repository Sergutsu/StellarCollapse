# Roadmap

> Three buckets only: **Now**, **Next**, **Later**. Anything in Now has a branch or PR open. Anything in Later is an idea, not a commitment.
>
> Updated at phase boundaries — not every PR. Last bump: P9 complete — hub readability pass (tab-owned left panel, a real planetary system on the STAR MAP, MARKET watchlist + price chart, idle-dispatch fix). See [`UI-HUB.md`](UI-HUB.md) §3a and [`META-SYSTEMS.md`](META-SYSTEMS.md) §4.6.

---

## Phase status

| Phase | Theme | Status |
|---|---|---|
| P0 | Match-4 / Tetris prototype with modes, tiers, field sizes, Pixi renderer, mission-select screen | **Shipped** |
| P1 | Resource ledger: ores tallied per run, credits awarded, results screen | **Shipped** |
| P2 | **Hub scaffolding** — viewport-filling 5-zone layout, tab nav, MISSION BOARD modal with narrative mission cards (mapped 1:1 to the 9 tier archetypes), Galactic News ticker; replaces today's transitional mission-select entirely | **Shipped** |
| P3 | Persistent meta-state (`MetaState`, `Persistence`) + rep-tier gates on narrative mission cards | **Shipped** (mutation hooks wired in P1) |
| P4 | Active-missions idle tick (`IdleClock`): persistent wall-time dispatches survive reload + offline; left column shows live ETAs + CLAIM/RETURN; assets free on completion/abort; rewards (credits + ores) granted via MetaState | **Shipped** (full persistent idle loop + pure clock + MetaState integration) |
| P5 | BUILD/UPGRADE tab: station diorama, per-building levels, build queue + available-upgrade list (moved from the earlier BASE COMMAND right-column concept per [ADR-0007](adr/0007-hub-wireframe-pivot.md)) | **Shipped** (P8: berths from the research effect bundle, blueprint specialties, mineral-sink repairs reporting to lifetime stats, yard status line) |
| P6 | RESEARCH + CREW + MARKET tabs: tech tree, hired operators, ore↔credits trader | **Shipped** (research: multi-slot + cancel/resume + ACTIVE BONUSES card; P8: crew XP/levels/berths/hiring costs, market rewritten around `economy.js` with daily drift + refinery) |
| P7 | STAR MAP tab: sector exploration, mission discovery tied to the map | **Shipped** (P8: SECTOR NETWORK rail with all 13 sectors, warp-costed PLOT COURSE through `meta.chartSector()`, discovery grants + permanent bonuses) |
| P8 | **Meta loop completion** — reputation ladder + gates, daily seeded board with paid rerolls, one settlement path for every dispatch (credits, ore, REP, crew XP, hull wear, warp), market + refinery, sector network, crew progression, offline WELCOME BACK flow, save v2 | **Shipped** ([`META-SYSTEMS.md`](META-SYSTEMS.md), [ADR-0011](adr/0011-meta-economy-single-source.md); 177 → 361 tests) |
| P9 | **Hub readability** — the left column becomes contextual per tab (`usesSidePanel` / `layoutSide`), STAR MAP renders a shaded planetary system at readable speed with its SYSTEM DATA board + SYSTEM INDEX on the left, the shipyard moves left, MARKET becomes watchlist (left) + TradingView-style price chart (center) driven by `economy.priceHistory()`, and idle dispatch is fixed | **Shipped** ([`UI-HUB.md`](UI-HUB.md) §3a/§5a/§5c/§5d; 361 → 390 tests, incl. a hub smoke suite that executes the scene graph) |

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

## Shipped (P8 — Meta loop completion)

Goal: make the station the game. Every tab had scaffolding; none of them had a
reason to exist. P8 gives the meta layer rules, one reward path, and readers for
every modifier the tech tree hands out.

- [x] **Six pure modules** — `reputation.js`, `daily.js`, `economy.js`,
      `star-map.js`, `crew.js`, `settlement.js`. Framework-free; `nowMs` /
      `dayKey` / `rng` are always arguments.
- [x] **One settlement path.** `settleMission()` prices manual runs, idle claims
      and early returns alike (credits + itemised breakdown, ores, REP, crew XP,
      hull wear, warp). `MetaState.applySettlement()` /
      `settleActiveMission()` apply it in a single `change` event, so one action
      is one save.
- [x] **Reputation.** Six ranks, banked REP with a derived tier, T8/T9 gates on
      cards, a top-bar REP chip, and promotion headlines in the news ticker.
- [x] **Daily board.** Per-UTC-day seed (stable across reloads, free refresh at
      the boundary), paid rerolls at 150 × (n+1) with a cap of 6 (+1 from
      Countermeasures), and a reroll that rebuilds the whole catalog so Combat
      variants move too.
- [x] **Economy.** Seven-good market with daily drift and a 28% spread, quoted
      BUY/SELL lots, and the refinery (4:1 common, 2:1 rare) — the mineral faucet
      the research + shipyard sinks were missing.
- [x] **Sector network.** 13 sectors named 1:1 with `mission.sector`, warp-costed
      jumps, threat gates, discovery grants, and permanent per-sector /
      station-wide bonuses folded into the effect bundle.
- [x] **Crew.** XP curve to level 20, role + hull-class affinity (fixing the dead
      P4 fit modifier), berth cap, escalating hire cost, severance.
- [x] **Hull wear.** Risk-scaled damage on the hull that actually flew, softened
      by plating / shields / Driftyard 9, repaired at 3 minerals per point.
- [x] **Combat rewards.** `DefenseLedger` banks ore from formations, power-ups and
      the boss, and the report relabels its rows for a defense run.
- [x] **Offline.** `summarizeOffline()` + WELCOME BACK banner with CLAIM ALL,
      30 s heartbeat and `pagehide`/`visibilitychange` stamping.
- [x] **Save v2** with in-place migration; the storage key is unchanged.
- [x] **Tests** 177 → 361, plus a new static check that every named local import
      is really exported (view code never runs under `node --test`).

Out of scope for P8: timed build queues, sector-specific contract spawning,
multiple profiles / cloud saves, and a station-log surface for the lifetime stats
(they are recorded, not yet displayed).

## Shipped (P9 — Hub readability)

Goal: P8 gave every tab rules; P9 makes them legible. Four player-reported
problems, all in the hub: the STAR MAP looked like a starfield and moved too fast
to read, idle dispatch was silently broken, the shipyard was squeezed into the
center panel's leftovers, and the market was a dense table with no sense of price
movement.

- [x] **Idle dispatch fixed.** `hub-scene.js` called `buildIdleMissions()` without
      importing it, so every IDLE dispatch threw a `ReferenceError`. Guarded by a
      new static check: `tests/module-imports.test.js` now fails if any file calls
      a sibling module's export it did not import.
- [x] **Tab-owned left panel.** `_buildSidePanel()` + the
      `usesSidePanel` / `sidePanelTitle` / `layoutSide({width,height})` contract,
      asserted by `tests/side-panel-contract.test.js`. MISSIONS and RESEARCH keep
      their own left-column content; CREW keeps the bay empty.
- [x] **STAR MAP is a system.** `drawBodyGlyph()` renders shaded planets dressed
      by `PLANET_TYPE_STYLE` (halo, latitude bands clipped to the disc, continents,
      ice caps, ring systems, limb light) plus a night side rotated toward the star;
      moons are cratered discs; classification sub-labels, a selection reticle and a
      highlighted orbit ring mark the picked body. `ORBIT_TIME_SCALE = 0.25` slows
      the motion (planets 64 s – 3.4 min per orbit on screen, moons 17 – 36 s) and
      the reveal thresholds drop with it; `orbitPeriodLabel()` prints the period the
      player actually watches on the SYSTEM DATA board.
- [x] **SYSTEM DATA on the left**, with a `SYSTEM INDEX` of every body; the floating
      panel that chased the selected body around the map is deleted.
- [x] **Shipyard on the left** (BUILD/UPGRADE): blueprints, berth capacity and the
      yard status line, laid out to the panel width so blurbs wrap; the center keeps
      the fleet list + selected-hull card.
- [x] **MARKET split like a terminal.** Goods list → left panel (watchlist: tap a row
      to chart it); center → `priceHistory()` chart with grid, area + line series,
      price/hour axes, last-price tag, UTC-midnight drift markers and a pointer
      crosshair.
- [x] **`economy.priceHistory()`** — deterministic, derived (never saved), and pinned
      to the live quote at its right edge. 5 new tests in `tests/economy.test.js`.
- [x] **Docs** — [`UI-HUB.md`](UI-HUB.md) §3a + §5a/§5c/§5d rewritten,
      [`META-SYSTEMS.md`](META-SYSTEMS.md) §4.6, [`ARCHITECTURE.md`](ARCHITECTURE.md)
      tab-scene sections, [`GAMEPLAY.md`](GAMEPLAY.md) tunables.

Out of scope for P9: scrolling in the left bay (everything still fits by shrinking
rows), bodies as dispatch targets (PLOT COURSE still acts on sectors), candlestick
or multi-good overlay charts, and a station-log surface for the lifetime stats.

## Shipped (P10 — Understandability & navigation)

Goal: the game explains itself, cannot be mis-clicked into a corner, and every
path into a shift obeys the same rules. Four player-facing defects, all in the
shell rather than the mechanics (see [ADR-0012](adr/0012-onboarding-pause-and-unified-dispatch.md)):

- [x] **The MISSION BOARD is reachable — and is the boot surface.**
      `_openMissionBoard()` had zero call sites since P2: the pillar-2 deploy
      modal built itself and stayed hidden forever. It now opens at boot, after
      every settled shift, from the planner's MISSION BOARD button, and on the
      `M` hotkey; a hand-dismissal (`CLOSE` / dim / ESC) is respected across tab
      flips. The core loop (BOARD → SHIFT → REPORT → BOARD) is closed.
- [x] **HOW TO PLAY manual.** Five paged sections (loop / dispatching /
      minigames / station / controls) in pure `src/help-content.js`, rendered by
      `src/scenes/help-overlay.js`. First boot opens it over the board with a
      `START SHIFT` CTA (`ui.helpSeen` save field); after that it lives on the
      new top-bar `? HELP` button (the dead settings gear is cut), the `H`/`?`
      hotkey, and the pause menu's HOW TO SHIFT.
- [x] **Pause with a priced abort.** ESC / `⏸ PAUSE (ESC)` / combat `PAUSE`
      freeze both run loops and offer RESUME / HOW TO SHIFT / ABORT SHIFT.
      Aborting settles `won: false` (0.35× rep, +6 hull wear) instead of full
      win-rate pay; `RESET PROFILE` now asks before wiping. Bomb/snake arming
      timers keep wall-clock time through a pause (documented).
- [x] **One dispatch path.** Board quick-ACCEPT auto-locks the first free ship +
      crew onto the same manual job shape as planner DISPATCH — fit bonuses,
      crew XP and hull wear apply to every shift. Flying solo (no free assets)
      still works at base rate and says so in the ticker.
- [x] **Navigation polish.** Global hotkeys (`1`–`6`, `M`, `P`, `ESC`, `H`),
      narrative names in the planner's contract list, `SHIPYARD` tab label,
      next-step hints on the mission report (`src/results-hints.js`), and
      one-line resource explainers on the top-bar chips.
- [x] **Tests** 390 → 417: `results-hints`, `help-content`, `hotkeys`,
      `ui.helpSeen`, `DefenseState.endGameEarly`, plus smoke coverage for the
      board lifecycle, quick-ACCEPT job locking, the help overlay, the dialog,
      the results report — and a `main.js` boot smoke that runs the real
      orchestrator against the headless Pixi.

Out of scope for P10: cycle-accurate pause for special arming timers, video or
guided tutorial rails (the manual is the single source of truth), and a
station-log surface for the lifetime stats.

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
- ~~**The MISSION BOARD modal was unreachable.**~~ `_openMissionBoard()` had no
  callers, so the documented boot surface and ACCEPT cards never rendered.
  Fixed in P10: the board opens at boot / after shifts / from the planner and
  `M`, with dismissal respected. See
  [ADR-0012](adr/0012-onboarding-pause-and-unified-dispatch.md).

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

- ~~**Persistent meta (`stellar-save:v1`).**~~ Shipped in P3, bumped to save v2 in
  P8 (banked REP, crew XP, charted sectors, board state, lifetime stats) with an
  in-place `migrateSave()`; T8/T9 gates are live.
- ~~**Active-missions idle tick.**~~ Shipped in P4; P8 added the offline half
  (`summarizeOffline()` + WELCOME BACK banner with CLAIM ALL) and moved claims
  onto the settlement path.
- ~~**BUILD/UPGRADE MetaState integration.**~~ Shipped: costs deduct minerals,
  berths come from `crew.fleetSlotLimit()` (10 base + `effects.fleetSlots` extras),
  repairs cost 3 minerals/point and report
  to `noteHullRepair()`. Remaining idea: timed build queue (today a hull is
  instant).
- ~~**Research MetaState integration.**~~ Shipped, and P8 gave the effect bundle
  real consumers plus an ACTIVE BONUSES card so the tree states what it does.
- ~~**STAR MAP warp dispatch.**~~ Shipped: PLOT COURSE spends warp through
  `meta.chartSector()` and banks the discovery grant. Remaining idea: spawn a
  sector-specific contract from a charted sector instead of only buffing one.
- ~~**Crew.**~~ Shipped: XP, levels, role + hull affinity, berth cap, escalating
  hire cost, severance.
- ~~**Market.**~~ Shipped: seven goods, per-UTC-day drift, quoted lots, refinery.
- ~~**Daily reroll.**~~ Shipped: `daily.js` seeds the board per UTC day and the
  reroll button charges an escalating credit price with a daily cap.
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
