# Architecture Decision Records

One file per architectural bet. 1–2 pages each. Append-only: when a decision is reversed, write a new ADR that references (and supersedes) the old one. **Never rewrite an accepted ADR** — the point of the log is that future readers can see the history, not just the final state.

## Format

Filename: `NNNN-short-slug.md` where `NNNN` is a zero-padded sequence number.

Body sections (required):

- **Status** — Proposed / Accepted / Superseded-by-NNNN / Rejected
- **Context** — what was true when this was decided, what problem forced the choice
- **Decision** — the choice, in plain prose
- **Consequences** — what we accept (pros) and what we give up (cons)
- **Alternatives considered** — at least one; why it lost

Optional sections: **Implementation notes**, **Revisit if**.

Skip an ADR for small / easily-reversible choices (naming, code style). Write one for decisions you'd hate to re-litigate in three months — library choices, data models, fundamental layering, economy shape.

## Log

- `0001-pixi-only-renderer.md` — Pixi.js v8 is the only renderer. No DOM fallback. **Accepted.**
- `0002-seeded-mission-rng.md` — Mission asteroid names rolled from a per-tier pool via a deterministic Mulberry32 seeded per boot. **Accepted.**
- `0003-tier-to-mission-1to1.md` — Each ranked tier maps to exactly one mission archetype, for a 9-mission board. **Accepted.**
- `0004-hub-scene-graph.md` — Main menu evolves from a fixed Pixi panel into a viewport-filling hub scene graph (top bar + 3 columns + 6-tab nav). **Accepted.**
