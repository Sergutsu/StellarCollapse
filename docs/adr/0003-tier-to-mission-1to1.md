# ADR 0003 — Tier → mission is a 1:1 mapping

## Status

Accepted — 2025-04 (PR #32).

## Context

At the start of the idle/casual expansion we had two choices for the mission-select screen:

- **A) 1:1 mapping.** Each ranked tier (currently 9) becomes exactly one mission archetype. The mission board shows 9 cards, one per tier. Mission cosmetic (asteroid name, brief) rolls per session; mechanics (mode, complexity, field size) are fixed by the tier.
- **B) N:N mapping.** Missions and tiers are independent. A tier has multiple missions; a mission can change field size / mode without changing tier. The mission board shows some subset of a larger pool, filtered by availability / rep.

A) is simpler and fits a 9-slot UI. B) scales to "hundreds of missions" and supports a live-content cadence, but is overkill for a solo/small-team casual game and creates a two-axis balance problem (tier difficulty AND mission difficulty).

## Decision

- **Each ranked tier maps to exactly one mission archetype.** 9 tiers → 9 missions on the mission board.
- Mission cosmetic is rolled per session via a seeded RNG (ADR 0002); mission mechanics are fixed by the tier.
- The `mission` object has a `gameConfig` field (`{ mode, complexity, fieldSizeId }`) derived from the tier — no mission ever contradicts its tier.
- Field-size-per-tier is a simple lookup table (`TIER_SIZE_BY_ID` in `missions.js`): gentler tiers get small, hardest tiers get large. This keeps the "tier index → difficulty" axis consistent without exploding into `3 tiers × 3 sizes × 3 modes × 3 complexities = 81` combinations.
- **Future variation — such as daily rerolls, rep-gated missions, special events — layers on top, not under.** A "daily" or "event" mission is a tier-tagged mission that overrides the default card for its tier, not a parallel mission list.

## Consequences

**Accept:**
- The mission board is always 9 cards. No scrolling, no filtering UI.
- If we want a "discover a new mission" moment, we have to layer it as a new card state on an existing tier slot — we can't add a 10th card.
- Tuning difficulty means tuning the tier definition, which affects both the tier and the mission. This is mostly a feature (one source of truth) but means we can't cheaply split "hard Stellar-Classic for experts" vs. "easy Stellar-Classic for newcomers".

**Gain:**
- Balance is 1-dimensional (tier index). No tier × mission difficulty matrix to maintain.
- The mission board is readable at a glance — a 3×3 grid of cards is a UI that doesn't change shape.
- Mission objects are trivially enumerable, which makes leaderboards, progression, and reward shaping straightforward.
- The existing 9-tier leaderboard ("MISSION LOG") maps directly onto missions without a translation step.

## Alternatives considered

- **N:N missions-and-tiers with filter UI.** Over-complicates the UI and balance for a casual game. Would need rep-level filters, type filters, reward filters. All work before it pays off.
- **Curated mission list of fixed length (say 20), with tier as a tag.** Hybrid. Fine as an intermediate step but the tag→ranking collision would still need solving later. Skipped.
- **Procedural mission generation (random mode × random complexity × random size).** Produces nonsense missions. The matrix already has un-tiered combinations we specifically ranked in PR #12 to avoid this.

## Implementation notes

- `buildMissions()` returns `HIGHSCORE_TIERS.map(...)`. The 1:1 mapping is literal.
- `findMission(list, id)` supports looking a mission up by id — used by the view on card tap and will be used by P1 results + P2 meta-state.
- When the tier list grows (say from 9 to 12), the mission board grows with it. The grid layout is `3 × ceil(N/3)`.

## Revisit if

- We grow past ~15 missions without splitting into pages — 3×5 is still readable, 3×7 is not.
- We want the same tier slot to offer two different balanced missions on the same day (would need a layering mechanism — still compatible with 1:1 at the tier-slot level, not at the mission level).
- Procedural variants become worth the balance effort (probably only after P4).
