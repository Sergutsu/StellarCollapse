# Gameplay Spec

> **Canonical source of truth for tunable numbers.** `src/constants.js` mirrors this file. When you tune a number, update both in the same PR.
>
> Covers the three modes, three complexities, three field sizes, scoring, specials, and mission catalog.

---

## Modes

### Stellar (match-4)

- Pieces drop, lock on landing.
- **Matches clear when 4+ same-colour cells are orthogonally adjacent** (including diagonals on Collapsed — see below).
- Gravity runs after every clear; chain matches trigger additional scoring.
- Player controls: left/right, soft drop, hard drop, rotate.

### Auto-Match

- Same controls as Stellar — pieces drop, lock, and the player moves/rotates them. Click-to-match still works (same as Stellar); matches are **also** auto-cleared on every piece lock, so the player can choose to drive clears either manually or by stacking.
- On every piece lock, `_autoMatchSweep()` runs one synchronous pass over the board, unions every 4+ same-colour run (horizontal + vertical) into a unique-cell set, and clears them all at once. A cross pattern of 7 cells scores 7 × `MATCH_POINTS`, not 4+4.
- In Collapsed complexity, the longest run among the ones cleared in that sweep still seeds a specials tile — ≥5 cells → bomb at the run's middle, exactly 4 cells → snake at a random position in the run.
- After the sweep, gravity settles, and the next piece spawns. Chain reactions from subsequent locks score each sweep independently.

### Miner (formerly "Blocks" — the Tetris-like is gone)

- **Pieces are mineral formations falling inward from all four edges** (top / bottom / left / right, rolled per piece). Each piece carries its fall axis; soft drop, hard drop, and gravity ticks advance it along that axis. Left/right/up arrows and rotation stay screen-relative.
- Collision is direction-aware: pieces spawn **flush inside their entry edge** (always visible), and a blocked entry lane is a clean game over.
- **Core collapse replaces line clears.** When a fully-filled square of side ≥ `MINER_COLLAPSE_SIZE` (6) covers the board's center cell, the largest such square collapses: every mineral in it is mined out, scored (`cells × MINER_CELL_POINTS × level × sizeMultiplier`), and counted once toward level progression. Overlapping qualifying squares chain on the same lock until none remain.
- **No gravity after collapse** — minerals stay suspended where they locked; plan around the holes.
- Square fields per complexity/size (13×13 up to 23×23) so the center core is equidistant from every entry edge. Cell sizes derive from the board-slot width instead of the portrait height target.
- Click-to-match is disabled in this mode. Game over when a spawn is blocked or a piece locks outside the field ("core breached").
- Visuals: faceted crystal cell styling, a pulsing 6×6 core reticle at the center, entry-edge direction chevrons, `CORE` HUD counter, and mineral formation names per shape.

### Defense (Combat missions)

A Space-Invaders / Breakout hybrid. Game state lives in `src/defense-state.js`; constants in `src/defense-constants.js`.

- **Arena:** 800 × 600 logical pixels, grid-snapped to G = 10.
- **Paddle:** bottom of arena, mouse/keyboard controlled. Normal width 100 px; WIDE power-up doubles it for 12 s.
- **Ball:** 10 × 10, bounces off walls/paddle/entities. Paddle deflection angle depends on hit position. Losing the last ball costs 25 HP and respawns one.
- **Invaders:** 4 rows × 8 columns; three pixel-art types (Squid, Crab, Octopus). Each pixel has 1 HP. Move sideways every 1100 ms, drop 3 cells when hitting an edge. Random invaders shoot downward bullets (0.6% chance/tick).
- **Boss:** 2-pixel magenta entity with 3 HP per pixel (6 total). Bounces sideways, shoots every 1800 ms. Drops 5 random power-ups on death.
- **Towers:** placed by clicking above the paddle (max 8). Auto-shoot the nearest enemy every 900 ms.
- **Power-ups:** MULTI (extra ball, max 5), WIDE (doubles paddle, 12 s), LASER (spacebar shoots spread + targeted bullets, 10 s), LIFE (+25 HP, capped at 100), TOWER (+1 placeable turret). Drop every 10 pixel kills.
- **Scoring:** 10 pts per pixel hit by bullet, 5 pts per pixel hit by ball. Credits = floor(score / 10).
- **Win:** boss + all invaders destroyed. **Lose:** player HP reaches 0 or invaders reach the bottom row.

### Mode × Complexity × Size matrix

Every tier in `HIGHSCORE_TIERS` is a `(mode, complexity)` pair. Field size is a third axis:
 - Small / Medium / Large vary per complexity (each complexity has its own triplet).
 - Actual cell dimensions live in `FIELD_SIZES` in `constants.js`.

---

## Piece complexity

### Classic

- 7 standard Tetris-ish shapes (I, O, T, S, Z, L, J).
- No specials spawn.
- 4 normal colours (`red`, `blue`, `green`, `yellow`).

### Mutated

- Shapes from Classic plus 5–10 mutated variants (plus/X/U shapes etc.).
- Larger spawn pool → more varied stacking.
- Still no specials.

### Collapsed ("Totally Collapsed")

- All Mutated shapes plus occasional single-cell / 2-cell "collapsed" fragments.
- **Bomb** and **snake** specials spawn.
- Diagonal adjacency counts for match detection.
- Gravity freeze during match resolve (prevents cascade lockups).

---

## Specials (Collapsed only)

### Bomb tile

- Spawns at a small per-piece probability.
- When it lands, an **armed timer** starts. **5 s** in Collapsed mode. During that window, clearing the bomb (via match or click-match) detonates it and destroys the surrounding **5×5** area (center ± `BOMB_RADIUS`, currently 2).
- If the timer expires unused, the bomb **morphs to a random normal-colour tile**.
- Visual: bomb emoji + red pulse + arc countdown.

### Snake tile

- Spawns at a small per-piece probability, separate from bomb.
- Same 5 s armed timer behaviour. If triggered, the snake walks along adjacent cells and clears a trail of **SNAKE_LENGTH = 5** cells, starting from the trigger point.
- If timer expires, morphs to a random normal-colour tile.
- Visual: snake emoji + green pulse + arc countdown + animated walk when triggered.

### Arming-timer invariant

- The timer runs on cells that are **settled** (have fallen and locked). Gravity shifts preserve the remaining timer; the cell carries its countdown wherever it lands.
- `match-detected` in the view guards against double-firing star reactions when a match lands on a snake cell — the snake reaction wins.

---

## Scoring

All score values fire on the `score-changed` event from `GameState`. The view reads, never writes.

### Base points

| Event | Base points |
|---|---|
| Normal match (4+ cells) | `MATCH_POINTS = 10` per cleared cell |
| Auto-Match sweep | 10 per cleared cell (same `MATCH_POINTS`) |
| Bomb explosion | 25 per destroyed cell |
| Core collapse in Miner | `cells × MINER_CELL_POINTS (20) × level × sizeMultiplier` per collapsed square |

### Multipliers

Final points = `base × levelMultiplier × sizeMultiplier`.

- **Level multiplier** = current level (starts at 1, +1 every `LINES_PER_LEVEL = 8` lines / matches).
- **Size multiplier** — `getSizeMultiplier(sizeId)` in `constants.js`:
  - Small: ×1.50 (tighter board, earn more)
  - Medium: ×1.00
  - Large: ×0.75 (roomy board, earn less)

Both multipliers apply to every scoring path.

### Level ramp

- Level 1 drop interval: **1000 ms**
- Level step: **−100 ms per level**
- Floor: **200 ms** (hit at level 9)
- Level-up cadence: every **8** lines / matches (`LINES_PER_LEVEL`)

This ramp must be perceptible — a player who reaches level 5 should feel a ~60% interval drop. Don't flatten it without updating `DESIGN.md`.

### Scoring invariants (tested)

- Clearing the same 4-cell block twice with the same level + size scores identically.
- A single core collapse (36 cells) at level 1 on a medium board scores `36 × 20 × 1 × 1.0 = 720`.
- Bomb points use the bomb base, not the per-cell-colour base.
- Auto-match scoring uses each cell's own colour, not the clicked cell's colour. (See PR #5.)

---

## Ore mapping

Every cell cleared counts as an ore pickup:

| Palette | Ore | Rarity |
|---|---|---|
| red | Pyrite | common |
| blue | Cryonite | common |
| green | Verdanite | common |
| yellow | Helium | common |
| bomb | Volatiles | rare |
| snake | Biomass | rare |

Lookup: `ORE_BY_COLOR[color]` in `src/missions.js`.

Per-run tally lives in `src/run-ledger.js` (`RunLedger`). The ore ids in
`MetaState.ORE_IDS` mirror the six tile colours one-for-one (`red`, `blue`,
`green`, `yellow`, `bomb`, `snake`) so no remap is needed — every cleared
cell is credited to its colour's ore bucket.

---

## Per-run tally & rewards (P1)

A `RunLedger` subscribes to three `GameState` events for the lifetime of a
run and rolls them up into a single summary the results scene renders.

| Event | Contribution |
|---|---|
| `match-cleared` | `matchesCleared++`; each cell in `payload.cells` credits `cell.color` (falls back to `payload.color` for the click-match shape). |
| `bomb-exploded` | `bombsExploded++`; each cell in `payload.cells` credits `cell.color`. |
| `lines-cleared` | `linesCleared += payload.count`; each colour in `payload.colors` credits +1 ore. (Emitted by both `_checkLines` and the Miner core collapse, so Miner ore tallies through the same path.) |

A cell can only be credited once per clear event — `_creditOre` silently
ignores unknown colours (any id not in `ORE_IDS`) to keep future mode
experiments safe.

### Credits formula

Final credits awarded on CONTINUE are the sum of:

```
credits = mission.baseCredits + floor(score / 10)
```

- `mission.baseCredits` is the preview number on the card (100 × tierIndex).
- `floor(score / 10)` rewards longer runs without exploding the preview.
- Negative inputs are clamped to zero in `computeCredits`.

One source of truth lives in `src/run-ledger.js#computeCredits` — both
`RunLedger.summary()` and the unit tests call it, so tuning stays one line.

### Summary shape

`RunLedger.summary(state)` returns:

```
{
  missionId, missionName, narrativeName, sector, tierIndex, tierColor,
  baseCredits, scoreBonus, credits,
  ores: { red, blue, green, yellow, bomb, snake },  // per-id counts
  cellsCleared, matchesCleared, bombsExploded, linesCleared,
  finalScore, finalLevel, finalLines,
}
```

The results scene reads this directly. `rewardEnvelope(summary)` strips it
down to the three fields `MetaState.applyMissionReward` consumes
(`credits`, `ores`, `missionId`).

### Results scene wiring

Main-loop flow on `game-over`:

1. `main.js` reads `ledger.summary(state)` and `ledger.rewardEnvelope(summary)`.
2. `ledger.detach()` unsubscribes from `GameState` immediately so a cancelled
   run cannot keep tallying into a stale ledger.
3. `view.showResultsScreen(summary, { onContinue })` renders the overlay.
4. On CONTINUE, `meta.applyMissionReward(envelope)` fires a single save +
   one `mission-reward` event; the hub top-bar chips re-read MetaState and
   redraw via the existing change listener (see
   [ADR-0008](adr/0008-meta-state-persistence.md)).
5. `view.hideResultsScreen()` + `view.showStartScreen()` returns to the hub.

---

## Mission catalog

See `src/missions.js`. `buildMissions({ seed })` returns **one mission per ranked tier**, in tier order.

Mission object shape:

```
{
  id:            'mission-<tierId>',
  tierId:        'stellar-classic' | 'auto-match-mutated' | ...,
  tierIndex:     1..9,
  tierColor:     '#rrggbb',
  name:          'Kuiper Slate K-7'                     // asteroid name, rolled from per-tier pool
  label:         'Stellar · Classic'                    // tier label from HIGHSCORE_TIERS
  difficulty:    'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'EXTREME' | 'CRITICAL'
  brief:         'short flavor text'
  baseCredits:   100 × tierIndex                        // 100, 200, ..., 900
  expectedOres:  ['pyrite','cryonite','verdanite','helium', <+ 'volatiles','biomass' if Collapsed>]
  gameConfig:    { mode, complexity, fieldSizeId }      // what GameState.configure() consumes
  available:     true                                   // P2: rep/mission gates
  requires:      null                                   // P2: unlock prerequisites
}
```

### Seeded rolling

- `buildMissions({ seed: N })` is deterministic. Same seed → same mission list (asteroid names stable).
- Different seeds → names diverge on at least one tier almost always.
- Used so the mission list is stable within a session but varies across page loads. Daily reroll (P3) will feed `dayOfYear` as the seed.

### Per-tier flavor pools

Each `tierId` has 3 asteroid names and one brief in the catalog. Extend `ASTEROID_NAMES` and `TIER_BRIEF_BY_ID` in `src/missions.js` — no other code touches the pool.

---

## Field sizes

Per-complexity triplets in `FIELD_SIZES`:

| Complexity | Small | Medium | Large |
|---|---|---|---|
| Classic | 7×14 | 9×18 | 12×22 |
| Mutated | 8×16 | 11×22 | 13×26 |
| Collapsed | 9×18 | 12×24 | 15×28 |

None use 10×20 (deliberate — that was the old default and we want the sizes to feel distinct).

Miner mode uses its own square triplets in `MINER_FIELD_SIZES`:

| Complexity | Small | Medium | Large |
|---|---|---|---|
| Classic | 13×13 | 15×15 | 19×19 |
| Mutated | 14×14 | 17×17 | 21×21 |
| Collapsed | 15×15 | 19×19 | 23×23 |

### Visual sizing

- Target board slot: 400×720 px at base scale.
- `BLOCK_SIZE_FOR(cols, rows)` picks a per-cell pixel size that fills the slot vertically. Miner fields instead size cells from the **width** budget so the square board fits the slot horizontally (floor 16 px).
- **Low-fx threshold:** `LOW_FX_CELL_THRESHOLD` (currently 240 cells). Past this count, expensive per-cell animations (floating dashed outline, bomb/snake idle pulse, hover filter) are skipped. Pixi perf holds at 60 fps on 15×28 because per-frame cost is constant, not per-cell.

---

## Leaderboard

**Removed.** The persistent leaderboard module was deleted — see
`adr/0005-delete-highscore-system.md`. The game's feedback loop is now
per-run resource tallies (landing in P1), not a top-5 table. Personal
bests, if they come back, will be a derived read-out of `MetaState` (P3),
not a standalone storage module.

---

## Meta systems (P8)

Everything that happens **between** runs — reputation, the daily board, the
market + refinery, the sector network, crew progression, hull wear, warp cells
and idle/offline dispatch — is specified in
[`META-SYSTEMS.md`](META-SYSTEMS.md), with the rationale in
[ADR-0011](adr/0011-meta-economy-single-source.md). The short version, for
anyone tuning a run-side number:

- **One reward path.** A finished run produces a `summary` (`RunLedger` or
  `DefenseLedger`); `settleMission()` turns summary + mission + ship + crew +
  effects into one settlement; MetaState applies it in a single `change` event.
  Nothing else grants credits, ore, REP, XP or warp.
- **Run-side numbers that feed it:** `mission.baseCredits` (100 × tierIndex),
  `mission.risk` (T1–T2 = 1 … T8–T9 = 5), `gameConfig.complexity` (→
  environment level 1/2/3), and the run `score` (`credits += floor(score / 10)`).
  Changing any of those moves the meta economy, so re-check the settlement tests.
- **Combat runs bank ore.** Destroyed formations pay 3 ore each by invader type
  (squid → Pyrite, crab → Cryonite, octopus → Verdanite), power-ups pay 2
  Helium-3, and the boss pays 4 Volatiles + 3 Biomass.
- **The market has a chart, not a table.** MARKET's center panel plots
  `economy.priceHistory()` — 24 hourly points of the selected good, derived from
  the same drift hash as the live quote and pinned to it at the right edge, so
  the line can never disagree with the BUY/SELL buttons. Nothing about the series
  is saved; it is recomputed from `nowMs`. The goods list itself moved to the hub's
  left panel and doubles as the watchlist (tap a row to chart it).
- **The STAR MAP is a system, not a starfield.** Planets render as shaded spheres
  dressed by type (Ocean / Terrestrial / Desert / Gas Giant / Ice Giant), with a
  night side facing the star, orbit rings, moons, belts, stations and hazards —
  and they move at a quarter of the old speed so the chart can be read while it
  animates. The selected body's survey data lives in the left panel next to a
  `SYSTEM INDEX` of everything in the system.
- **Idle contracts** pay the credit figure quoted at dispatch time
  (`resolveDispatch()`), `risk × 2` ore stacks, 60 % of the rep, half the crew
  XP and 60 % of the hull wear. RETURNing early pays the elapsed fraction at
  15 % rep with no ore or XP.

---

## Persistence (MetaState profile)

Shipped in P3; **save v2 in P8**. The hub's resource strip, fleet roster, and crew roster
are now backed by a persistent player profile saved to
`localStorage` under `stellarVentureSaveV1`. See
`adr/0008-meta-state-persistence.md`.

### Profile shape

| Field | Type | Starter | Notes |
|---|---|---|---|
| `version` | int | `2` | Schema version. `META_SAVE_VERSIONS_SUPPORTED = [1, 2]`; a v1 blob is lifted in place by `migrateSave()` and stamped `migratedFrom: 1`. Unknown / future / malformed versions fall back to the starter profile. |
| `credits` | int | `4800` | Soft currency. Awarded by mission rewards (P1+). |
| `hubResources.minerals` | int | `1200` | Aggregate ore count. Used for building ships and trading. |
| `hubResources.warp` | int | `3` | Warp-cell charges. |
| `ores.{red, blue, green, yellow, bomb, snake}` | int | `0` each | Per-tile-colour ore counts, matching the actual gameplay palette (four normal colours + the two hazard tiles). Granular; used for crafting / upgrades (P5+). |
| `fleet[]` | `{id, name, className, hull (0–100), status}` | 3 starter ships | Ids are stable; only `hull` and `status` persist — cosmetic fields fall back to the starter roster. |
| `crew[]` | `{id, name, role, level, xp, status}` | 3 starter crew | Same merge rule as fleet: ids are stable, only `level`/`xp`/`status` persist. Migration backfills `xp = xpForLevel(level)` so a legacy member is never demoted. |
| `reputation` | int | `0` | **P8.** Banked REP. `reputationTier` is *derived* from it and is never stored. |
| `discoveredSectors` | `string[]` | `[]` | **P8.** Charted sector ids; drive the permanent sector / station bonuses. |
| `board` | `{dayKey, rerollsToday}` | today / 0 | **P8.** Daily board state. A stale `dayKey` resets the counter (free refresh at the UTC boundary). |
| `activeMissions[]` | dispatch jobs | `[]` | Absolute `startedAt` / `endsAt`, so an offline stretch needs no simulation. |
| `research` | `{completed[], activeResearches[], maxConcurrent}` | `{[], [], 2}` | Completed ids feed `resolveEffects()`. |
| `stats` | lifetime counters | all `0` | **P8.** `missionsCompleted, missionsFailed, combatWins, idleClaims, idleAborts, creditsEarned, oresMined, mineralsRefined, repEarned, sectorsCharted, warpSpent, warpFound, hullRepairs, crewLevelsGained, bestScore`. |
| `lastTickAt` | int (ms) | boot | Heartbeat for the offline report; stamped on boot, every 30 s and on `pagehide` / hidden. |
| `completedMissionIds` | `string[]` | `[]` | Deduped on settlement / `applyMissionReward`. |

### Storage contract

- Single key: `stellarVentureSaveV1`.
- Saves fire on every `MetaState` `change` event, and every player action
  emits **exactly one** — composite actions (`settleActiveMission`,
  `chartSector`) mutate through non-emitting `_raw*` helpers so a claim can
  never persist half-applied or double-save.
- Missing / unparseable / wrong-version blobs all fall back to the
  starter profile. No "nuke your save" instructions — the next save
  overwrites the bad blob.
- No localStorage (SSR / private-mode Safari / sandboxed iframe):
  game still boots, saves no-op.

### Mutation API (used by P1+)

| Method | Emits `kind` | Effect |
|---|---|---|
| `setCredits(n)` / `addCredits(n)` | `credits` | Clamps ≥ 0, floors to int. |
| `setHubResource(id, n)` | `hub-resource` | Same clamping. `id='credits'` delegates to `setCredits`. |
| `addOre(color, n)` | `ore` | Unknown colours are ignored. |
| `applyMissionReward({credits, ores, missionId})` | `mission-reward` | One event for a full reward envelope. `completedMissionIds` dedupes by id. |
| `setShipHull(id, n)` / `setShipStatus(id, s)` | `ship-hull` / `ship-status` | Hull clamps to 0–100. |
| `setCrewLevel(id, n)` / `setCrewStatus(id, s)` | `crew-level` / `crew-status` | Level clamps ≥ 1. |
| `setReputationTier(n)` | `rep` | Clamps ≥ 1. Test/migration hook only — the tier is derived from banked REP. |
| `applySettlement(s)` | `settlement` | **P8.** Banks one settlement: credits, ores, REP, crew XP + levels, hull wear, warp, `completedMissionIds`, lifetime stats. |
| `settleActiveMission(jobId, s)` | `settlement` | **P8.** Settlement **and** job retirement (ship + crew released) in one event. |
| `applyTrade({goodId, side, amount, credits})` | `trade` | **P8.** Applies a `tradeQuote()`; refuses (returns `false`) on overspend / oversell. |
| `applyRefine(plan)` / `refineAllOres(effects)` | `refine` | **P8.** Burns ore, banks minerals. |
| `chartSector(id)` | `sector-discovered` | **P8.** `plotCourse()` + warp cost + grant + REP, atomically. Returns the plan (with `reason` on refusal). |
| `spendWarp(n)` / `addWarp(n)` | `hub-resource` | **P8.** Warp is found, never bought; `addWarp` clamps to `warpCapacity()`. |
| `addReputation(n)` / `addCrewXp(id, n)` | `rep` / `crew-xp` | **P8.** Return the result (`{rep, tier, promoted}` / `{level, xp, levelsGained}`). |
| `buyBoardReroll(nowMs)` | `board-reroll` | **P8.** Charges the escalating price, persists the day's counter. |
| `noteHullRepair(points)` | `ship-hull` | **P8.** Lifetime stat for the shipyard sink. |
| `touch(nowMs)` | — | **P8.** Heartbeat for the offline report; does not emit. |
| Reads: `getEffects()`, `getRepInfo()`, `getBoardState()`, `crewSlots()`, `warpCapacity()`, `discoveredSectorIds()`, `oreCounts()`, `getStats()`, `activeMissionsSnapshot()` | — | **P8.** The scenes' only view onto the meta layer. |

---

## Tunable numbers summary (index)

When you need to tune any of these, update the constant **and** this file in the same PR:

| Name | File | Current |
|---|---|---|
| `MATCH_POINTS` | constants.js | 10 per cleared cell |
| `LINE_POINTS` | constants.js | `[0, 40, 100, 300, 1200]` |
| Bomb points per destroyed cell | constants.js | 25 |
| `BOMB_RADIUS` | constants.js | 2 (⇒ 5×5 blast) |
| `SNAKE_LENGTH` | constants.js | 5 |
| `LINES_PER_LEVEL` | constants.js | 8 |
| Drop interval start / step / floor | constants.js | 1000 / 100 / 200 ms |
| Special-arming timer | constants.js | 5 s |
| Size multipliers | constants.js `FIELD_SIZE_MULTIPLIERS` | 1.5 / 1.0 / 0.75 |
| Low-fx cell threshold | constants.js `LOW_FX_CELL_THRESHOLD` | 240 |
| `FIELD_SIZES` | constants.js | see table above |
| `HIGHSCORE_TIERS` | constants.js | 9 tiers |
| Mission base credits | missions.js `baseCreditsFor` | 100 × tierIndex |
| Per-tier asteroid name pool | missions.js `ASTEROID_NAMES` | 3 per tier |
| `REP_TIERS` / `REP_GAIN` | reputation.js | 6 ranks (0/400/1200/2800/5600/10000) · base 20 + 10/risk + 4/tier |
| `REROLL_BASE_COST` / `MAX_REROLLS_PER_DAY` | daily.js | 150 × (n+1) · 6 (+`effects.riskRerolls`) |
| `MARKET_SPREAD` / `MARKET_DRIFT` / `TRADE_LOTS` | economy.js | 0.28 · 0.22 · [10, 50] |
| `REFINE_RATIO_COMMON` / `REFINE_RATIO_RARE` | economy.js | 4:1 · 2:1 |
| `PRICE_HISTORY_POINTS` / `PRICE_INTRADAY_WOBBLE` | economy.js | 24 hourly points · ±0.06 (right edge pinned to the live quote) |
| `WARP_FIND_RULES` | economy.js | Exploration ≥2 · Salvage ≥3 · Combat ≥1 (idle ≥4) |
| Sector warp costs / threats / grants | star-map.js `SECTORS` | 13 sectors, warp 1–5 |
| `xpForLevel` / `MAX_CREW_LEVEL` / `BASE_CREW_SLOTS` | crew.js | `60(n²+2n)` · 20 · 6 |
| `CREW_XP_GAIN` | crew.js | base 18 + 12/risk + 3/tier · role match ×1.25 |
| `HIRE_BASE_COST` / `HIRE_COST_GROWTH` / `DISMISS_RETURN` | crew.js | 800 · 1.35 past 5 heads · 0.3 |
| `SHIP_MATCH_FACTOR` / `SHIP_MISMATCH_FACTOR` | crew.js | 1.12 / 0.94 |
| `HULL_WEAR` | settlement.js | 2/risk · +6 on a loss · ×0.6 idle · 4 absorbed per shield charge |
| `DEFENSE_ORE_PER_INVADER` / `DEFENSE_HELIUM_PER_POWERUP` / `DEFENSE_BOSS_HAUL` | run-ledger.js | 3 · 2 · `{bomb 4, snake 3}` |
| `BASE_WARP_CAPACITY` | meta-state.js | 5 (starter holds 3) |
| Repair / disassemble | tabs/build-upgrade-tab.js | 3 minerals per hull point · 40% of build cost |
| `ORBIT_TIME_SCALE` | tabs/star-map-tab.js | 0.25 — celestial motion at quarter speed |
| `MOON_ZOOM_REVEAL` / `SHIP_ZOOM_REVEAL` | tabs/star-map-tab.js | 1.0 / 0.85 × fit-zoom |
