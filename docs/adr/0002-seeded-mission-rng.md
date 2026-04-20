# ADR 0002 — Seeded Mulberry32 RNG for mission rolls

## Status

Accepted — 2025-04 (PR #32).

## Context

The mission-select screen (PR #32) shows 9 cards, one per ranked tier. Each card has an **asteroid name** drawn from a small per-tier flavor pool (currently 3 names per tier). We want:

- The mission list to look stable within a play session — a player who closes and re-opens the mission board between runs shouldn't see asteroid names shuffle out from under them.
- The list to vary across sessions so the cosmetics don't feel canned on repeat play.
- Tests to pin down exact expected names given a known seed, so the catalogue stays unit-testable.
- Later (P3), a **daily mission reroll** where the seed is `dayOfYear` so every player on the same day sees the same catalogue — useful for sharing and for competitive leaderboards.

A bare `Math.random()` fails 1 and 3.

## Decision

- `buildMissions({ seed })` in `src/missions.js` uses **Mulberry32** seeded by the `seed` argument. If `seed` is omitted, it falls back to `Math.random` (non-deterministic).
- In the view (`src/pixi-view.js`), we pick one seed per boot: `Math.floor(Math.random() * 0xffffffff)`. That seed is stored on the view, so the mission list is identical if `buildMissions` is re-invoked in the same session.
- In tests, we pass explicit seeds and assert specific names.
- The RNG is inlined in `missions.js`. 10 lines. Zero deps.

## Consequences

**Accept:**
- Mulberry32 is not cryptographically secure. We don't need it to be — this is flavor text.
- Two different seeds can by chance produce the same mission list (low probability, not zero). Not a correctness issue.

**Gain:**
- Deterministic tests: given `seed=1234`, the list is byte-identical forever. PR #32's test `seeded buildMissions is deterministic` enforces it.
- Future daily reroll is one line: swap the seed source.
- Future per-profile or per-rep-tier variation is one line each.

## Alternatives considered

- **`Math.random()` only.** Fails determinism; tests would have to mock Math.random globally, which is fragile.
- **Seedable `Alea` / `mersenne-twister` via npm.** Brings a dep for ~10 lines of math. Not worth it; we already ship zero runtime deps (Pixi via CDN).
- **Hash-based deterministic pick (`hashTierIdToIndex % poolSize`).** Works but gives the same name for the same tier forever, which defeats the "varies across sessions" goal.
- **Store the rolled list in localStorage.** Couples mission cosmetics to persistence. Cleaner to re-roll at boot.

## Implementation notes

- The Mulberry32 function is local to `missions.js` as `rng(seed)`. It's intentionally not exported — other modules should not reach for it. If we need a general-purpose seeded RNG elsewhere, we promote it to a new module and write an ADR for the promotion.
- `buildMissions()` (no args) → non-deterministic fallback. Callers that depend on determinism must pass `{ seed }` explicitly. Tests assert this.

## Revisit if

- We need cryptographically-secure seeds (we won't — it's flavor text).
- Mulberry32 shows visible bias in real usage (it doesn't, at this scale).
