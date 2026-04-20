# Roadmap

> Three buckets only: **Now**, **Next**, **Later**. Anything in Now has a branch or PR open. Anything in Later is an idea, not a commitment.
>
> Updated at phase boundaries — not every PR. Last bump: after PR #32.

---

## Phase status

| Phase | Theme | Status |
|---|---|---|
| P0 | Match-4 / Tetris prototype with modes, tiers, field sizes, Pixi renderer, mission-select screen | **Shipped** |
| P1 | Resource ledger: ores tallied per run, credits awarded, results screen | Now |
| P2 | Persistent meta-state + upgrade tree + rep-tier gates | Next |
| P3 | Idle generation (offline/online tick), daily mission reroll | Later |
| P4 | Fleet / crew / station-building layer | Later |

Each phase is a handful of PRs, not a single PR. The boundary between phases is when the player-visible loop actually changes — "you now permanently keep ores across runs" is a phase boundary; "tune bomb radius" is not.

---

## Now (P1 — Resource ledger)

Goal: a completed mission awards credits + ores and shows a results screen before returning to the mission board. **Nothing persists across page reloads yet** — that's P2.

- [ ] Per-run ore tally on the Pixi view. `ORE_BY_COLOR` translation on `match-cleared` / `line-cleared` / `bomb-exploded`, accumulated in a run-scoped counter.
- [ ] Results scene (Pixi). Asteroid name, mission stats, ore breakdown with icons + counts, credits earned, CONTINUE button returning to mission-select.
- [ ] Credits formula. Final credits = `mission.baseCredits + bonusFromOres + levelReachedBonus`. Concrete weights documented in `GAMEPLAY.md` when we land it.
- [ ] Session-scope `MetaState` stub (pure module, no persistence yet). Holds credits + ore totals in memory so we can exercise the results scene without taking on localStorage risk.
- [ ] Unit tests for the tally (deterministic).

Out of scope for P1: saving anything, unlocks, upgrades, rep tiers, idle tick.

## Next (P2 — Persistent meta)

Goal: the dispatcher has a ledger that survives reloads, and some missions are gated until you've earned them.

- `src/persistence.js` — versioned localStorage adapter (`stellar-save:v1`), pure wrapper; absorbs `HighScores`.
- `src/meta-state.js` — pure module. Owns credits, ore inventory, completed mission history, unlocks, rep tier. Seeded from persistence at boot, emits `meta-changed` events.
- Unlock model: missions have `requires: { minRep, completedMission, orePurchase }` fields; mission-select screen disables locked cards with a lock reason.
- Rep tier advances on cumulative credit thresholds. Cosmetic for now (badge on dispatcher card); gates kick in for some T8/T9 missions.
- Migration story: existing high-score data stays intact. No reset.
- Add a `Reset profile` action behind a confirm dialog (for the player's own sanity, not for us).

## Later (P3+)

Unsorted, not committed to:

- **Idle generation.** When the tab is closed or the player isn't in a run, passive ore trickle based on owned extractors. Cap at e.g. 12 hours offline. Needs a tick scheduler and an "away since" timestamp.
- **Upgrade tree.** Spend ores + credits on extractor tier, hold radius, bomb radius, snake length, starting level, etc. Only applies to mission runs, not to idle rate (keep the two economies visible).
- **Daily mission reroll.** `buildMissions({ seed })` already supports this; swap the session seed for `dayOfYear`. Optional reroll button costs credits.
- **Fleet / crew layer.** Named dispatcher, hired operators, station upgrades, reputation factions. Pure flavor until the core loop is tight.
- **Mobile / touch pass.** Right now the Pixi scene is mouse-first. Field sizes already scale; input bindings don't.

---

## How this file moves

- When a Now item is done, strike it from Now in the PR that lands it and add a line to `CHANGELOG.md`.
- When all Now items land, the PR that ships the last one also promotes the next batch from Next → Now and sketches a new Next.
- Later is append-only (ideas park). Items graduate from Later → Next when we're ready to commit.
