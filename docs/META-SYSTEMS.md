# Meta Systems

> The dispatcher layer: everything that happens **between** minigame runs.
> Reputation, the daily contract board, the market + refinery, the sector
> network, crew progression, hull wear, warp cells, idle/offline dispatch and
> the single settlement path that pays for all of it.
>
> Shipped in **P8 — meta loop completion**. This file is the authoritative
> reference for the numbers; [`GAMEPLAY.md`](GAMEPLAY.md) covers the run-side
> rules and [`UI-HUB.md`](UI-HUB.md) covers where each system appears on
> screen. Rationale for the "one reward path" rule is
> [ADR-0011](adr/0011-meta-economy-single-source.md).

---

## 1. Why this layer exists

Stellar Venture is a hybrid-casual **idle space dispatcher**: the minigames are
the *optional* skill expression, and the station is the game. Before P8 the
station was scaffolding — the top bar showed warp cells nothing spent, the
market traded two currencies at hardcoded rates, the star map's PLOT COURSE
button closed a panel, minerals had no income at all, and every reward path was
a separate `applyMissionReward()` call that paid credits and forgot reputation,
crew and hull.

P8 closes the loop in both directions:

```
        ┌────────────────── dispatch a contract ──────────────────┐
        │                                                         ▼
   HUB (mission board / planner)                       MINIGAME (optional)
        ▲                                            puzzle · defense · idle
        │                                                         │
        │                     settleMission()                     │
        └──────── credits · ore · REP · crew XP · hull wear ◄─────┘
                          │
      ┌───────────────────┼────────────────────────┐
      ▼                   ▼                        ▼
  RESEARCH            MARKET / REFINERY        STAR MAP
  (effects)           (ore ⇄ credits ⇄         (warp → sectors →
                       minerals)                permanent bonuses)
      │                   │                        │
      └──────────────► better dispatches ◄──────────┘
```

Every arrow above is a real, wired mutation. Every number below is produced by
a pure module with a unit test.

### Design rules

1. **One reward path.** Nothing grants credits, ore, rep, XP or warp except
   `settleMission()` → `MetaState.applySettlement()` /
   `settleActiveMission()`. Market trades, refining and sector jumps are the
   only other faucets/sinks and each has exactly one MetaState method.
2. **Pure modules own the math.** `reputation.js`, `daily.js`, `economy.js`,
   `star-map.js`, `crew.js`, `settlement.js` are framework-free and take
   `nowMs` / `dayKey` / `rng` as arguments. Scenes read them; they never
   re-derive a formula.
3. **One action, one `change` event, one save.** MetaState mutates through
   non-emitting `_raw*` helpers and announces once, so a claim cannot persist
   half-applied and cannot double-save.
4. **Idle is a discount, not a different game.** Autonomous contracts pay less
   rep, less XP and find warp cells less often than a hands-on run, but they
   use the same settlement code with `dispatchMode: 'idle'`.
5. **No new currency.** Warp cells are found, never bought. Minerals come from
   the refinery and sector grants. Credits come from contracts and sells.

---

## 2. Reputation (REP)

`src/reputation.js` · UI: top-bar REP chip, mission-card locks, results report.

Reputation is the dispatcher's rank. It is earned by **finishing** dispatches —
never bought — so it reads as skill rather than wealth.

### 2.1 Ladder

| Tier | Title | REP threshold |
|---:|---|---:|
| 1 | Apprentice Dispatcher | 0 |
| 2 | Journeyman Dispatcher | 400 |
| 3 | Senior Dispatcher | 1 200 |
| 4 | Fleet Dispatcher | 2 800 |
| 5 | Sector Commander | 5 600 |
| 6 | Master Dispatcher | 10 000 |

`MetaState.reputationTier` is **derived** from banked REP; it is never stored or
set by hand (`setReputationTier()` exists only for tests/migrations). The top
bar chip renders `REP <n> · <title>` plus progress to the next threshold, or
`MAX RANK` at tier 6.

### 2.2 Gain formula

```
rep = REP_GAIN.base                       20
    + REP_GAIN.perRisk   × risk           10 × 1..5
    + REP_GAIN.perTierIndex × tierIndex    4 × 1..9
rep ×= failMultiplier    0.35   (run lost / shift aborted by the board)
rep ×= idleMultiplier    0.60   (dispatchMode === 'idle')
rep ×= abortMultiplier   0.15   (RETURNed early — elapsed fraction applies first)
rep += combatWinBonus    15     (Combat minigame cleared by hand)
rep ×= effects.repMultiplier            (Research: Reputation Boost 1.10)
rep ×= sectorBonus.repMultiplier        (charted sector the contract flies to)
```

Separately, charting a sector pays `repForSectorDiscovery()` =
`REP_GAIN.sectorDiscovery` (**25**) × `effects.repMultiplier`.

### 2.3 Gates

| Gate | Requirement | Effect |
|---|---|---|
| Tier T8 contracts | REP tier **3** | Card shows a `LOCKED · REP 3` overlay, `not-allowed` cursor, and tapping explains the clearance instead of launching |
| Tier T9 contracts | REP tier **4** | Same |
| Threat-5 sectors | REP tier **3** | `plotCourse()` refuses with `requires REP tier 3 clearance` |

`isMissionUnlocked(mission, repTier)` is the single predicate; the hub uses it
in the card builder, the card tap handler and the planner DISPATCH button.

---

## 3. Daily contract board

`src/daily.js` · UI: MISSION BOARD modal (subtitle, REROLL button).

### 3.1 Seeds

* `dayKey(nowMs)` → `YYYY-MM-DD` in **UTC**; `dayIndex` is days since epoch.
* `dailyBoardSeed(nowMs)` is the seed for reroll 0 of that day.
* `boardSeedFor({ dayIndex, rerollsToday })` derives every subsequent roll, so
  a reroll is deterministic and reproducible from the save
  ([ADR-0002](adr/0002-seeded-mission-rng.md)).
* The seed drives `buildMissions({ seed, repTier })`, which decides the Combat
  variants attached to the nine tiers (sector, risk lane, ore split). A reroll
  therefore rebuilds the **whole catalog**, not just the four face-up cards.

### 3.2 Refresh + reroll pricing

| Action | Cost | Notes |
|---|---|---|
| Daily refresh at the UTC boundary | **free** | `normalizeBoardState()` resets `rerollsToday` when the stored `dayKey` is stale — no timer needed |
| Reroll *n* (0-indexed) | `REROLL_BASE_COST × (n + 1)` = 150, 300, 450 … | Charged by `MetaState.buyBoardReroll()` |
| Past the daily cap | `Infinity` | Button reads `REROLL LIMIT REACHED`, dims, and refuses |

The cap is `rerollCap({ extraRerolls }) = MAX_REROLLS_PER_DAY (6) +
effects.riskRerolls` — Research **Countermeasures** buys a seventh roll at the
next rung of the ladder (1 050 CR), never a discount. `MetaState.getBoardState()`
is the only reader, so the modal, the price and the persisted counter can't
disagree.

The modal subtitle always shows `free refresh in HH:MM:SS · N rerolls used
today`, repainted at 1 Hz while the modal is open. When the player cannot afford
the next roll the button dims to 42 % and its cursor becomes `not-allowed`.

---

## 4. Economy: market, refinery, warp

`src/economy.js` · UI: MARKET tab.

### 4.1 Goods

| Good | Ore colour | Base price | Rarity |
|---|---|---:|---|
| Pyrite | red | 6 | common |
| Cryonite | blue | 7 | common |
| Verdanite | green | 8 | common |
| Helium-3 | yellow | 9 | common |
| Volatiles | bomb | 26 | rare |
| Biomass | snake | 30 | rare |
| Minerals | — | 5 | common |

### 4.2 Daily drift + spread

```
drift(good, dayKey) ∈ [−MARKET_DRIFT, +MARKET_DRIFT]      MARKET_DRIFT  = 0.22
mid  = base × (1 + drift)
buy  = round(mid × (1 − effects.marketBuyDiscount))       ≥ 1
sell = round(mid × (1 − MARKET_SPREAD) × (1 + effects.marketSellBonus + stationBonus))
                                                          MARKET_SPREAD = 0.28
```

Drift is a hash of `(good.id, dayKey)` — identical for every player on a given
UTC day, and stable across reloads. The market headline names the day's biggest
gainer and loser and counts down to the reset.

Relevant modifiers: Research **Trade Compact** (`marketSellBonus +0.06`,
`marketBuyDiscount +0.03`) and a charted **Nova Bazaar** (station-wide
`marketSellBonus +0.04`).

### 4.3 Orders

`TRADE_LOTS = [10, 50]`. `tradeQuote()` clamps an order to what is affordable
(buys) or in stock (sells) and prices it off today's table; `MetaState
.applyTrade({ goodId, side, amount, credits })` applies exactly the quote. A
refused order reports why (`not enough credits`, `nothing to sell`) and touches
nothing. `balanceKeyFor(goodId)` maps a good to its profile bucket
(`'ore:<colour>'` or `'minerals'`).

### 4.4 Refinery — the mineral faucet

Minerals are the BUILD/UPGRADE and RESEARCH sink currency and, before P8, had
**no income**. The refinery is the faucet:

| Ore | Ratio | Constant |
|---|---:|---|
| common (red, blue, green, yellow, minerals) | **4 ore → 1 mineral** | `REFINE_RATIO_COMMON` |
| rare (bomb, snake) | **2 ore → 1 mineral** | `REFINE_RATIO_RARE` |

`refinePlan(counts, effects)` returns the whole-hold plan (`{ minerals,
consumed, rows }`); `MetaState.applyRefine(plan)` burns the ore and banks the
minerals; `refineAllOres()` does both. Research **Ore Refinery** adds
`mineralYieldMultiplier 1.15`. The MARKET tab previews the yield live and
disables `REFINE ALL ORE` when the hold is empty.

### 4.6 Price history — the MARKET chart series

The MARKET tab's center panel is a TradingView-style price chart, and a chart
needs a series. The market is a pure function of the UTC day key, so there is
nothing to remember between sessions: the series is **derived, never stored**.

```
priceHistory({ goodId, nowMs, effects, points = PRICE_HISTORY_POINTS, stepMs = 1h })

t_i        = nowMs − (points − 1 − i) × stepMs           i = 0 … points−1
bucket_i   = floor(t_i / 3_600_000)
drift_i    = driftFor(goodId, dayKey(t_i))                ← §4.2, unchanged
wobble_i   = i === points−1 ? 0 : intradayWobbleFor(goodId, bucket_i)
mid_i      = base × (1 + drift_i + wobble_i)
buy_i      = max(1, round(mid_i × (1 − effects.marketBuyDiscount)))
sell_i     = max(1, round(mid_i × (1 − MARKET_SPREAD) × (1 + effects.marketSellBonus)))

intradayWobbleFor(good, bucket) ∈ [−PRICE_INTRADAY_WOBBLE, +PRICE_INTRADAY_WOBBLE]
                                 PRICE_INTRADAY_WOBBLE = 0.06
```

Two properties matter:

- **Deterministic.** Same good, same `nowMs` → same series, on every machine and
  every reload. It is a hash of `stellar-market-tick:<bucket>:<goodId>`, so it
  costs no save-file space and cannot desync from the wallet.
- **Honest at the right edge.** The last point's wobble is zero by construction,
  which makes it exactly `marketPrices()` for today — the same mid the BUY/SELL
  buttons quote. A chart that disagreed with the order ticket would be worse
  than no chart. (`tests/economy.test.js` asserts `last.buy === table.buy`.)

Returns `{ ok, goodId, label, color, rarity, base, points[], first, last, high,
low, changePct, dayChangePct }`. `changePct` is the move across the visible
window; `dayChangePct` is the move against yesterday's close
(`base × (1 + driftFor(good, dayKey(nowMs − 24h)))`). Bad input is clamped, not
thrown: `points` → 2…168, unknown good → `{ ok: false, points: [] }`.

Because a 24-hour window can straddle a UTC midnight, the series legitimately
contains two `dayKey`s and two drift values — the chart draws an amber marker at
each crossing so the player can tell the daily re-price apart from the intraday
wobble.

### 4.5 Warp cells

Warp is the STAR MAP fuel and is **found, never bought**:

| Mission type | Minimum risk (manual) | Minimum risk (idle) |
|---|---:|---:|
| Exploration | 2 | 4 |
| Salvage | 3 | 4 |
| Combat | 1 | 4 |

`warpRewardFor()` returns 0 or 1 per finished dispatch (a lost run finds
nothing). Capacity is `BASE_WARP_CAPACITY` (**5**) + `effects.warpCapacity`
(Compact Fuel Cell +2, Warp Coils +2 …); a starter profile holds 3. Sector
grants can return a warp cell, so deep jumps partly refuel themselves.

---

## 5. Sector network (STAR MAP)

`src/star-map.js` · UI: STAR MAP tab → SECTOR NETWORK rail.

Thirteen sectors, named 1:1 with `mission.sector` in `src/missions.js`. Charting
one costs warp and pays twice: a **one-off grant** and a **permanent bonus** —
either to every dispatch flown *in that sector* (`bonus`) or station-wide
(`stationBonus`).

| Sector | Warp | Threat | Permanent bonus | Discovery grant |
|---|---:|---:|---|---|
| Omega-4 Belt | 1 | 1 | ore +6 % | 180 CR · 60 MIN · 12 red |
| Gliese Fringe | 1 | 1 | credits +6 % | 220 CR · 50 MIN · 12 blue |
| Gliese-876 System | 2 | 2 | ETA −6 % | 300 CR · 90 MIN · 1 warp |
| Kuiper Fringe | 2 | 2 | rep +10 % | 260 CR · 80 MIN · 14 green |
| Nova Bazaar | 2 | 1 | *station:* market sells +4 % | 400 CR · 120 MIN |
| Driftyard 9 | 2 | 2 | *station:* hull wear −10 % | 320 CR · 160 MIN |
| Event Horizon Shadow | 3 | 3 | credits +10 % | 520 CR · 150 MIN · 1 warp · 16 yellow |
| Ironspan Flats | 3 | 3 | ore +10 % | 480 CR · 220 MIN · 18 red |
| Voidwreck Field | 3 | 4 | ore +12 % · rep +5 % | 600 CR · 180 MIN · 6 bomb · 6 snake |
| Outer Rim Lanes | 4 | 4 | credits +12 % | 760 CR · 200 MIN · 1 warp · 20 blue |
| Seismic Rift | 4 | 5 | credits +16 % · ore +6 % | 900 CR · 260 MIN · 22 green · 18 yellow |
| Terminus Deep | 5 | 5 | ore +18 % · rep +10 % | 1 100 CR · 320 MIN · 1 warp · 10 bomb · 8 snake |
| Terminus Core | 5 | 5 | credits +20 % · rep +8 % | 1 250 CR · 360 MIN · 1 warp · 12 bomb · 10 snake |

* `warpCostFor(sector, effects)` applies `effects.warpCostDelta` (Warp Coils
  −1) and never costs less than 0.
* `plotCourse()` refuses — without spending — when the sector is unknown,
  already charted, unaffordable, or threat 5 below REP tier 3.
* `MetaState.chartSector(id)` runs cost + grant + rep in **one** `change` event
  and returns the plan (including `reason` on refusal), which the rail prints.
* `sectorBonusForMission(mission, discoveredIds)` is a name lookup used by
  `resolveDispatch()`; `applyStationBonuses()` folds station bonuses into a
  research effect bundle without mutating it.
* `discoveryProgress()` feeds the `N / 13 CHARTED` read-out.

The rail renders cost-after-tech, charted state, the bonus line and the grant
for the selected sector; unaffordable sectors are dimmed. It collapses on
viewports narrower than 780 px so the system chart keeps its room.

---

## 6. Crew progression

`src/crew.js` · UI: CREW tab (roster XP bars, detail card, recruit panel).

### 6.1 Levels + XP

```
xpForLevel(n) = CREW_XP_BASE × (n² + 2n)      CREW_XP_BASE = 60
  L2 = 180 · L3 = 480 · L4 = 900 · L5 = 1 440      MAX_CREW_LEVEL = 20
crewProgress(member) → { level, xp, xpIntoLevel, xpForNext, progress, maxed }
skillFactor(level)   = 1 + (level − 1) × 0.04     ← contract payout multiplier
```

`crewProgress()` takes `max(storedLevel, levelForXp(xp))`, so a legacy save
without an `xp` field is **never demoted** (migration backfills
`xp = xpForLevel(level)`).

### 6.2 XP gain

```
xp = CREW_XP_GAIN.base                       18
   + perRisk        × risk                   12 × 1..5
   + perTierIndex   × tierIndex               3 × 1..9
xp ×= roleMatchMultiplier 1.25   (crew role is trained for this mission type)
xp ×= failMultiplier      0.45   (lost run still teaches something)
xp ×= idleMultiplier      0.50   (autonomous contracts)
xp  = 0                      (RETURNed early)
```

### 6.3 Affinity tables

`ROLE_AFFINITY` (XP bonus) — Captain: Combat/Exploration · Tactician: Combat ·
Pilot: Exploration/Combat · Engineer: Mining · Navigator: Exploration ·
Scientist: Research · Quartermaster: Salvage/Mining · Medic: Salvage/Combat.

`SHIP_CLASS_AFFINITY` (payout fit) — Scout → Exploration · Defense → Combat ·
Frigate → Combat · Corvette → Combat/Exploration · Resource → Mining ·
Terraform → Research · Trade → Salvage.

A matching hull pays `SHIP_MATCH_FACTOR` **1.12**; a mismatched one
`SHIP_MISMATCH_FACTOR` **0.94**. This **fixes a dead-code bug**: the P4 hub
tested `className.toLowerCase().includes(missionType)`, which can never match a
starter class name, so the fit modifier never fired. Unknown classes still fall
back to the substring rule. A dispatch with **no** assigned ship or crew
(quick-ACCEPT straight off a board card) is neutral at 1.0 — the fit penalty
only bites when the player actually chose the wrong hull.

### 6.4 Roster economics

```
crewSlots()  = BASE_CREW_SLOTS (6) + effects.crewSlots      (Habitat Extension +1)
hireCost(n)  = round(HIRE_BASE_COST × HIRE_COST_GROWTH ^ max(0, n − 5))
               HIRE_BASE_COST = 800 · HIRE_COST_GROWTH = 1.35
severance    = floor(hireCost(rosterSize) × DISMISS_RETURN)  DISMISS_RETURN = 0.3
```

Hiring past the cap is refused with a line pointing at Habitat Extension;
recruits arrive with `xp = xpForLevel(level)` so their advertised level is real.
Churning the roster is always a net loss (0.3 of an escalating price).

---

## 7. Settlement — the single reward path

`src/settlement.js` · UI: MISSION REPORT overlay.

### 7.1 `resolveDispatch({ mission, ship, crew, effects, discoveredSectors })`

Prices a dispatch **before** it flies. Returns
`{ rewardCredits, rewardOres {common, rare}, etaSec, shipTypeMatch,
sectorCharted, creditsBreakdown[], threatLevel, environmentLevel }`. The hub's
planner preview and the idle job record both come from this, so the number the
player sees while choosing is the number the contract pays.

```
rewardCredits = max(60, round(
                    mission.baseCredits
                  × skillFactor(crew.level)          // 1.0 when no crew assigned
                  × shipFactor(ship.className, type) // 1.0 when no ship assigned
                  × sectorBonus.creditMultiplier
                  × effects.creditMultiplier))

etaSec        = max(45, round(
                    max(60, IDLE_DURATION_SEC_BY_RISK[risk]
                          + (tierIndex − 1) × 15          // tier bonus
                          + (environmentLevel − 1) × 25   // complexity bonus
                          + (shipTypeMatch ? −12 : +16))  // fit penalty
                  × effects.etaMultiplier
                  × sectorBonus.etaMultiplier)

environmentLevel = 3 collapsed · 2 mutated · 1 classic   (from gameConfig.complexity)
threatLevel      = mission.risk
```

`creditsBreakdown[]` itemises that chain (`Contract base`, `<crew> Lv<n>`,
`<ship> fit` / `Ship off-spec`, `<sector> charted`) and is what the MISSION
REPORT prints under CREDITS EARNED — only rows whose factor actually moved
appear.

### 7.2 Hull wear

```
HULL_WEAR: perRisk 2 · failurePenalty 6 · idleMultiplier 0.6 · shieldAbsorb 4

damage  = risk × perRisk + (won ? 0 : failurePenalty)
damage ×= idleMultiplier                 // dispatchMode === 'idle'
damage ×= effects.hullDamageMultiplier   // Hull Plating 0.88, Countermeasures 0.94,
                                         // and a charted Driftyard 9 (0.90) folded in
                                         // by applyStationBonuses()
absorbed = shieldCharges > 0 ? min(damage, shieldAbsorb) : 0
damage  -= absorbed
→ { damage: round(damage), absorbed: round(absorbed) }   // both ≥ 0
```

Shields eat a flat 4 points per charge **after** the multipliers, so plating and
shields stack rather than competing.

Wear only lands on a ship that was actually assigned
(`MetaState.applySettlement` checks `shipId`). Hull is the BUILD/UPGRADE tab's
repair sink: **3 minerals per point** (`REPAIR_COST_PER_POINT`), reported to
lifetime stats via `noteHullRepair()`.

### 7.3 `settleMission(...)`

One call, one immutable result, every dispatch mode:

| Field | Meaning |
|---|---|
| `credits`, `creditsBreakdown[]` | Payout + the itemised line the report prints |
| `ores {colour: n}` | Ore that actually lands (scaled by `effects.oreYieldMultiplier`, `rareOreBonus`, sector bonus) |
| `rep`, `crewXp`, `crewLevel`, `crewLevelsGained` | Progression |
| `hullDamage`, `hullAbsorbed` | Wear and what the shields ate |
| `warp` | 0 or 1 cell found |
| `sectorCharted`, `title`, `sector`, `risk`, `type`, `variant` | Report metadata |
| `finalScore`, `statLabels`, `minigame` | Passed through from the run summary so the report can relabel its rows |
| `log[]`, `ok`, `dispatchMode`, `won`, `aborted` | Audit trail |

Manual runs take their credits from the run summary (`base + floor(score/10)`
via `RunLedger` / `DefenseLedger`) and then apply the same crew/ship/tech/sector
multipliers. Idle runs pay the **baked** `job.rewardCredits` (quoted at dispatch
time) and derive ore from `risk × 2` stacks; an abort pays the elapsed fraction
of that contract (`progressOf(job, nowMs)`) with rep at `abortMultiplier` and no
ore or XP.

### 7.4 Combat (Defense) hauls

`DefenseLedger` maps the defense minigame onto the same six-ore identity:

| Event | Ore |
|---|---|
| Squid formation destroyed | +3 **Pyrite** (red) |
| Crab formation destroyed | +3 **Cryonite** (blue) |
| Octopus formation destroyed | +3 **Verdanite** (green) |
| Power-up collected | +2 **Helium-3** (yellow) |
| Boss destroyed | +4 **Volatiles** (bomb), +3 **Biomass** (snake) |

`DEFENSE_ORE_PER_INVADER = 3`, `DEFENSE_HELIUM_PER_POWERUP = 2`,
`DEFENSE_BOSS_HAUL = { bomb: 4, snake: 3 }`. Credits still use
`baseCredits + floor(score / 10)`, and a cleared Combat run adds
`REP_GAIN.combatWinBonus`. `summary()` also carries `won`, `minigame:
'defense'` and `statLabels` (SCORE / WAVE / BALLS LOST / PIXELS / WRECKS /
PICKUPS) so the MISSION REPORT does not claim a combat pilot cleared "lines".

---

## 8. Idle + offline dispatch

`src/idle-clock.js` · UI: left-column ACTIVE MISSIONS, WELCOME BACK banner.

Jobs store **absolute** timestamps (`startedAt`, `endsAt`), so nothing has to be
simulated: `computeJobState(job, nowMs)` is enough after any gap.

`summarizeOffline({ jobs, lastSeenMs, nowMs })` →
`{ away, awaySec, awayLabel, completed[], pending[], ready, credits, oreUnits }`.

* `completed` — jobs that finished **during** the absence.
* `ready` — everything claimable now, including jobs that finished *before* the
  player left (they are ready but not "new").
* `awayLabel` comes from `formatAway(ms)`: `0s` / `59s` / `1m` / `1h 30m` /
  `1d 1h`.

`main.js` computes this **before** the first `meta.touch()` and hands it to the
hub, which renders a WELCOME BACK banner as row 0 of the idle list: away time,
contracts finished, credits + ore lanes waiting, and a **CLAIM ALL** button that
settles every ready job through the same path as a single claim.

Liveness: `meta.touch()` on boot, every 30 s, and on `pagehide` /
`visibilitychange → hidden` (the latter also forces an explicit
`persistence.save()`), so the next absence is measured from the last real
heartbeat rather than the last mutation.

---

## 9. Research effects

`src/research.js` (`BASE_EFFECTS`, `EFFECTS_BY_NODE`, `resolveEffects`,
`activeEffectSummaries`) · UI: RESEARCH tab → ACTIVE BONUSES card.

Twelve nodes. `resolveEffects(completedIds)` merges them: **multipliers
multiply** (floored at 0.05), **numerics add**, **booleans OR**, ids dedupe,
output frozen. Duplicate completions can no longer square a multiplier.

| Key | Consumers |
|---|---|
| `etaMultiplier` | `resolveDispatch`, idle ETAs |
| `creditMultiplier` | contract payouts |
| `oreYieldMultiplier`, `rareOreBonus`, `rareOreReveal` | settlement ore lanes, board previews |
| `mineralYieldMultiplier` | refinery |
| `repMultiplier` | rep gain, discovery grants |
| `fleetSlots`, `crewSlots`, `researchSlots` | BUILD/UPGRADE berths, CREW cap, concurrent research. All three are **extras over a base** (`fleetSlotLimit()` = 10 + `fleetSlots`, `crewSlotLimit()` = 6 + `crewSlots`), never the capacity itself |
| `warpCapacity`, `warpCostDelta` | warp rack, sector jump price |
| `hullDamageMultiplier`, `shieldCharges` | hull wear |
| `riskRerolls` | daily mission-board reroll cap (`rerollCap`) |
| `marketSellBonus`, `marketBuyDiscount` | market spread |

Node highlights: Fuel Cell `{warpCapacity 2, fleetSlots 2}` · Warp Coils
`{warpCostDelta −1, fleetSlots 2}` · Ion Thrusters `{etaMultiplier 0.92}` ·
Deep Scanner `{rareOreReveal, oreYield 1.05}` · Refinery `{mineralYield 1.15}` ·
Mining Laser `{oreYield 1.12, rareOreBonus 1}` · Hull Plating `{hullDamage
0.88}` · Shield Array `{shieldCharges 1, fleetSlots 1}` · Countermeasures
`{riskRerolls 1, hullDamage 0.94}` · Reputation Boost `{repMultiplier 1.10}` ·
Trade Compact `{marketSellBonus 0.06, marketBuyDiscount 0.03}` · Habitat
Extension `{crewSlots 1, fleetSlots 1, researchSlots 1}`.

Every key in that table has at least one consumer — an effect nobody reads is a
lie on the ACTIVE BONUSES card.

The RESEARCH tab's ACTIVE BONUSES card prints `activeEffectSummaries(completed)`
— the same strings the math is built from, so the panel can never advertise a
bonus the game does not apply.

---

## 10. Persistence (save v2)

`src/persistence.js` · `src/meta-state.js`. Key unchanged:
`stellarVentureSaveV1`.

`META_SAVE_VERSION = 2`, `META_SAVE_VERSIONS_SUPPORTED = [1, 2]`.
`migrateSave()` lifts a v1 blob in place and stamps `migratedFrom: 1`; unknown,
future or malformed versions are rejected and fall back to `starterProfile()`.

New v2 fields:

```
reputation            banked REP (tier is derived)
crew[].xp             backfilled as xpForLevel(level) for legacy members
discoveredSectors[]   charted sector ids
board { dayKey, rerollsToday }
stats { missionsCompleted, missionsFailed, combatWins, idleClaims, idleAborts,
        creditsEarned, oresMined, mineralsRefined, repEarned, sectorsCharted,
        warpSpent, warpFound, hullRepairs, crewLevelsGained, bestScore }
```

Balances clamp at 0; **deltas may be negative** (market sells, refunds) — only
the resulting balance clamps. Saving a migrated profile writes v2.

---

## 11. Invariants (tested)

* Risk buckets: T1–T2 = 1, T3–T4 = 2, T5 = 3, T6–T7 = 4, T8–T9 = 5.
* `credits = baseCredits + floor(score / 10)` for every minigame.
* Ore colours `{red, blue, green, yellow, bomb, snake}` ↔ ids
  `{pyrite, cryonite, verdanite, helium, volatiles, biomass}`.
* 1:1 tier ↔ mission ([ADR-0003](adr/0003-tier-to-mission-1to1.md)); Combat is
  a daily, tier-tagged **variant** layered on top and keeps
  `mission.id = mission-<tierId>`.
* Reroll 0 of a day === `dailyBoardSeed` for that day.
* Every MetaState action emits exactly one `change` (asserted in
  `tests/meta-state.test.js` for settlement, claim/abort and sector jumps).
* No DOM, no `setTimeout`, no un-injected `Date.now()` in the pure modules;
  `nowMs` / `dayKey` / `rng` are always arguments.
* Every `src/` file passes `node --check`, every relative import resolves, and
  every **named** local import really is exported
  (`tests/module-imports.test.js`) — view code never runs under `node --test`,
  so that check is the only net for a typo in a scene.

---

## 12. Tunables index

| Constant | Value | File |
|---|---|---|
| `REP_GAIN` | base 20 · perRisk 10 · perTierIndex 4 · fail .35 · idle .6 · abort .15 · combatWin 15 · sectorDiscovery 25 | `reputation.js` |
| `REROLL_BASE_COST` / `MAX_REROLLS_PER_DAY` | 150 / 6 (+ `effects.riskRerolls`) | `daily.js` |
| `MARKET_SPREAD` / `MARKET_DRIFT` | 0.28 / 0.22 | `economy.js` |
| `TRADE_LOTS` | [10, 50] | `economy.js` |
| `REFINE_RATIO_COMMON` / `REFINE_RATIO_RARE` | 4 / 2 | `economy.js` |
| `PRICE_HISTORY_POINTS` / `PRICE_INTRADAY_WOBBLE` | 24 hourly points / 0.06 | `economy.js` |
| `ORBIT_TIME_SCALE` | 0.25 (celestial motion runs at quarter speed) | `tabs/star-map-tab.js` |
| `MOON_ZOOM_REVEAL` / `SHIP_ZOOM_REVEAL` | 1.0 / 0.85 × fit-zoom | `tabs/star-map-tab.js` |
| `ROW_H_MIN` / `ROW_H_MAX` (market watchlist) | 22 / 30 | `tabs/market-tab.js` |
| `BASE_CREW_SLOTS` / `MAX_CREW_LEVEL` | 6 / 20 | `crew.js` |
| `CREW_XP_BASE` · `xpForLevel` | 60 · `60(n²+2n)` | `crew.js` |
| `CREW_XP_GAIN` | base 18 · perRisk 12 · perTierIndex 3 · fail .45 · idle .5 · roleMatch 1.25 | `crew.js` |
| `HIRE_BASE_COST` / `HIRE_COST_GROWTH` / `DISMISS_RETURN` | 800 / 1.35 / 0.3 | `crew.js` |
| `SHIP_MATCH_FACTOR` / `SHIP_MISMATCH_FACTOR` | 1.12 / 0.94 | `crew.js` |
| `HULL_WEAR` | perRisk 2 · failurePenalty 6 · idleMultiplier .6 · shieldAbsorb 4 | `settlement.js` |
| `DEFENSE_ORE_PER_INVADER` / `DEFENSE_HELIUM_PER_POWERUP` / `DEFENSE_BOSS_HAUL` | 3 / 2 / `{bomb 4, snake 3}` | `run-ledger.js` |
| `BASE_WARP_CAPACITY` | 5 (starter holds 3) | `meta-state.js` |
| `REPAIR_COST_PER_POINT` / `DISASSEMBLE_RETURN` | 3 minerals / 0.4 | `tabs/build-upgrade-tab.js` |
| `BASE_FLEET_SLOTS` | 10 berths; `fleetSlotLimit()` adds `effects.fleetSlots` **extras** | `crew.js` |

---

## 13. Where each system shows up

| System | Hub surface |
|---|---|
| Reputation | Top-bar REP chip · card lock overlays · MISSION REPORT `REPUTATION` line · Galactic News promotion headline |
| Daily board | MISSION BOARD subtitle (countdown + rerolls) · REROLL BOARD button price |
| Market + refinery | MARKET tab — left panel (watchlist, lot selector, BUY/SELL) · center (price chart, refinery, headline) |
| Sectors | STAR MAP → SECTOR NETWORK rail · left-panel `SYSTEM DATA` board + `PLOT COURSE` · planner `sector bonus` preview line · MISSION REPORT `SECTOR CHARTED` |
| Crew | CREW tab XP bars + berth counter · planner crew list · MISSION REPORT crew line |
| Hull | Fleet rows + detail card hull bar · REPAIR button · MISSION REPORT `HULL WEAR` |
| Warp | Top-bar warp chip · sector rail costs · MISSION REPORT `WARP CELL` |
| Idle/offline | Left-column ACTIVE MISSIONS (ETA, CLAIM, RETURN) · WELCOME BACK banner + CLAIM ALL |
| Research effects | RESEARCH tab tree + ACTIVE BONUSES card · BUILD/UPGRADE berth counter |
| Lifetime stats | `MetaState.getStats()` — surfaced in the save and available to any future station-log panel |
