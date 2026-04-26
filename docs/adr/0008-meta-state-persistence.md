# ADR-0008: MetaState + Persistence (versioned single-key localStorage)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Supersedes:** —
- **Superseded by:** —
- **Related:** [ADR-0005](0005-delete-highscore-system.md) (prior storage module deleted), [ADR-0007](0007-hub-wireframe-pivot.md) (hub reads this profile)

---

## Context

The hub shell (P2) renders resources, fleet hulls, and crew levels, but every value is a hard-coded placeholder. To move on to P1 (per-run ore tally + results screen) — and eventually P4 (idle mission tick) — we need a single source of truth for the player profile that survives page reloads.

Constraints from prior ADRs:

- **No build step** (ADR-0001). Persistence has to work with plain ESM + `localStorage`. No IndexedDB wrapper, no SQLite-wasm, no service worker.
- **Pure state, thin view** (architecture principle). The view must not own the profile; MetaState must not own the DOM.
- **No feature flags left behind.** Persistence is on by default wherever the platform supports it. No `?nosave` escape hatch.

The deleted HighScores module (ADR-0005) stored scores under `stellarCollapseScoresV2` — that key has been cleaned up; we are not migrating it.

## Decision

1. **Two new modules.**
   - `src/meta-state.js` — pure emitter-backed player profile. Owns credits, per-colour ores, hub resources, fleet, crew, reputation tier, completed mission ids. Exposes reads + mutation methods. Emits `change` with `{ kind, detail }` on every successful mutation.
   - `src/persistence.js` — versioned `localStorage` wrapper. Single exported key `stellarVentureSaveV1`. Dependency-injected storage for tests.
2. **One storage key, versioned.** `stellarVentureSaveV1`. Load refuses blobs whose `version` field doesn't match `META_SAVE_VERSION`. On mismatch / parse error / missing key, load returns `null` and the caller constructs a fresh MetaState from the starter profile.
3. **Starter profile = P2 placeholders.** First boot is indistinguishable from the pre-persistence hub (credits = 4800, minerals = 1200, warp = 3, 5 starter ships, 5 starter crew). When P1 lands, mutations will start producing deltas.
4. **Shallow merge on hydrate.** The MetaState constructor shallow-merges the saved blob onto the starter profile so unknown fields are ignored and missing fields fall back to defaults. Fleet and crew merge by `id`, preserving cosmetic fields (class, role, name) on the starter side while saved runtime fields (hull, level, status) win. This makes the save format forward-compatible — P4+ can add building queues / research trees without a schema bump.
5. **Auto-save on change.** `main.js` wires `meta.on('change', () => persistence.save(meta.snapshot()))`. No debouncing yet; P4's idle ticker will need one, and that's where we'll add it.
6. **Non-throwing persistence.** SSR, private-mode Safari, quota-exceeded, unparseable JSON — every failure mode returns a safe default (`null` for load, `false` for save/clear). The game boots on every platform; the only casualty is that on hostile platforms the profile is session-scoped.

## Consequences

- **Positive.** Hub reads live values. P1 can immediately start calling `meta.applyMissionReward(...)` and the top-bar chips update automatically. Save format is versioned so migration stories are clean when we need them.
- **Negative.** Every mutation writes the whole snapshot (~1 KB today, growing with fleet size). Not a concern for P3 but will need a debounce before P4's per-second idle tick.
- **Schema evolution.** When a change is genuinely breaking (renaming a key, changing a type), we bump `META_SAVE_VERSION` to 2 and add a migration in `meta-state.js` that reads V1 and emits V2. We do **not** keep two load paths in `persistence.js`.

## Alternatives considered

- **Inline state on GameState.** Would violate "pure state, thin view" — GameState is supposed to be run-scoped and deterministic; it doesn't own cross-run data.
- **Put the save in `localStorage` under multiple keys.** Rejected. A single versioned blob is atomic; multiple keys invite half-written saves when a user closes the tab mid-write.
- **IndexedDB.** Overkill for < 10 KB of data. Would force an async boot path for zero benefit until we have media blobs or leaderboards again.
- **Skip versioning for now.** Rejected. The one invariant the HighScores deletion taught us is that unversioned save data is a liability the moment the shape changes.
