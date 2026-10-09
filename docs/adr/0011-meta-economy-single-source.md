# ADR-0011: One settlement path — pure modules own the meta economy

- **Status:** Accepted
- **Date:** 2026-10-09
- **Supersedes:** —
- **Superseded by:** —
- **Related:** [ADR-0002](0002-seeded-mission-rng.md) (seeded rolls), [ADR-0003](0003-tier-to-mission-1to1.md) (tier ↔ mission), [ADR-0008](0008-meta-state-persistence.md) (profile + save versioning), [ADR-0010](0010-hub-tab-scenes.md) (tab scenes that read this layer)

---

## Context

By the end of P7 the hub *looked* like an idle dispatcher and behaved like a
mock-up. Concretely:

- **Three reward paths.** `applyMissionReward()` (manual runs),
  `claimActiveMission({credits, ores})` (idle claims) and
  `abortActiveMission({partialCredits})` (early returns) each granted currency
  independently, with the payout arithmetic re-derived at every call site.
  Combat runs paid credits and nothing else.
- **Formulas duplicated in view code.** `hub-scene.js` carried its own copies of
  the idle-duration table, the piece-complexity mapping and the ore-lane split,
  so the number shown in the planner preview and the number a claim paid were
  computed by different code that happened to agree.
- **Dead meta systems.** `setReputationTier()` had no callers and the board's
  `available/requires` flags were hardcoded open; research effects had exactly
  one consumer (fleet berths in the BUILD tab); warp cells had no source and no
  sink (`STAR_MAP_SECTORS` was an empty array and `_onPlotCourse()` closed a
  panel); **minerals had no income at all** while research cost 300–1 100 of
  them per node — a soft lock waiting to happen.
- **A latent fit bug.** The ship-fit modifier tested
  `className.toLowerCase().includes(missionType)`, which can never match a
  starter class name (`Scout`, `Frigate`, …). The ±12 % / −6 % modifier has been
  dead code since P4.

Constraints that were already law: no build step (ADR-0001), pure state / thin
view, `GameState` never touches DOM or clocks, every logic change ships with a
`node --test` case, and no feature flags in production.

## Decision

1. **Six new pure modules own every meta number.**
   `src/reputation.js`, `src/daily.js`, `src/economy.js`, `src/star-map.js`,
   `src/crew.js`, `src/settlement.js`. Framework-free, frozen exports, and the
   clock/entropy are **arguments** (`nowMs`, `dayKey`, `rng`) — never
   `Date.now()` or `Math.random()` inside.
2. **`settleMission()` is the only reward path.** Manual minigame runs, idle
   claims and early returns all produce one immutable settlement object
   (credits + breakdown, ores, rep, crew XP, hull wear, warp, log). Scenes may
   *read* it; they may not compute a payout.
3. **MetaState applies settlements atomically.** All mutation goes through
   non-emitting `_raw*` helpers; the public method announces **one** `change`
   event per player action, so one action is one save. Composite actions get
   their own method — `settleActiveMission()` (reward + job retirement) and
   `chartSector()` (warp cost + discovery grant) — rather than two calls from a
   scene. Deltas may be negative (sells, refunds); only the resulting *balance*
   clamps at zero.
4. **Derived, never stored, ranks.** `reputationTier` is computed from banked
   REP on read. Nothing can set a tier out from under the ladder, which is what
   made `setReputationTier()` uncallable in the first place.
5. **Quotes before mutations.** Anything a player can click is priced by a pure
   quote function first — `resolveDispatch()`, `tradeQuote()`, `refinePlan()`,
   `plotCourse()` — and the mutation applies *that* result. The UI can therefore
   never show a number the profile won't honour, and a refused action is a
   returned `reason`, not an exception or a silent no-op.
6. **Effects must have consumers.** Every key in `resolveEffects()` output is
   read by at least one system, and the RESEARCH tab prints
   `activeEffectSummaries()` — the same strings the math is built from — so the
   tree cannot advertise a bonus the game doesn't apply.
7. **Combat variants layer on top of the 1:1 catalog.** ADR-0003 stands: a
   Combat contract is a daily, tier-tagged *variant* that keeps
   `mission.id = mission-<tierId>` and relocates the sector. It is not a tenth
   mission.

## Consequences

**Positive**

- One place to balance the economy. Changing rep gain, hull wear or the market
  spread is a constant edit plus a test, not a scene hunt.
- The whole meta layer is unit-testable in `node --test` with no DOM, no Pixi and
  no timers: 177 → 361 tests, all deterministic (fixed `nowMs`, fixed seeds).
- Offline play needs no simulation. Jobs store absolute timestamps, so
  `summarizeOffline()` is a comparison — an absence of any length is correct.
- Save v2 migration is a pure function with its own tests; the storage key is
  unchanged, so ADR-0008's non-throwing I/O contract still holds.
- Refused actions explain themselves (`need 2 warp cells`,
  `requires REP tier 3 clearance`, `not enough credits`), which is the difference
  between a dead button and a goal.

**Negative / accepted costs**

- More modules to keep in sync: a new reward source means a new settlement
  field, a `_raw*` write, a stat key and a test — deliberately more ceremony than
  `meta.addCredits(n)`.
- Settlement objects are wide (~25 fields). We accept the verbosity over a
  second, narrower "reward envelope" type that would drift.
- `settleMission()` calls `Date.now()` as a *fallback* when the host doesn't pass
  `nowMs` (aborted-job progress). Every first-party caller passes it; the
  fallback exists so a scene can't crash on a missing argument.
- The pure layer knows about ore colours and mission types, so `missions.js`
  remains a shared vocabulary module. Renaming a colour or type is a
  cross-module edit.

## Alternatives considered

- **Keep the arithmetic in the scenes, add the missing sinks.** Rejected. That is
  exactly the state that produced three reward paths, a duplicated ETA table and
  a fit modifier nobody noticed was dead. View-side math is untestable here
  because no scene runs under `node --test`.
- **A single `Economy` class holding all state.** Rejected in favour of pure
  functions over plain data: MetaState already owns the profile and the emitter,
  and a second stateful object would need its own save/migration story. Functions
  keep `MetaState` the only mutable thing.
- **Let scenes call the small mutators (`addCredits`, `addOre`, …) in sequence.**
  Rejected: that's how a claim ends up half-applied when the tab closes
  mid-loop, and it makes "one action = one save" impossible to guarantee.
- **Store `reputationTier` in the save.** Rejected. Two sources of truth for one
  rank is how the tier came to be hardcoded open in the board.
- **Random market prices per session.** Rejected for a per-UTC-day hash: a daily
  market gives players a reason to come back and makes the drift reproducible in
  tests and in bug reports.

## Revisit if

- A second profile (cloud save, multiple stations) appears — the pure layer is
  ready for it, but `MetaState`'s single-emitter assumption is not.
- A reward source that can't be expressed as a settlement field arrives (e.g.
  timed events paying over multiple ticks). Extend the settlement shape rather
  than adding a parallel path.
- Save size or write frequency becomes a problem; then batch `change` → save with
  a debounce, which this ADR's "one action, one event" rule makes safe to do.
