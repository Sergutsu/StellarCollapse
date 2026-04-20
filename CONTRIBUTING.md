# Contributing

Small team, loose process. These are the guard rails that stop us from re-introducing bugs we've already fixed. Pitched at humans *and* coding assistants.

---

## Setup

No build step. Just:

```
git clone https://github.com/Sergutsu/StellarCollapse.git
cd StellarCollapse
npm install      # only installs test runner + lint; runtime deps come from CDN
npm test         # runs the full suite (currently 68 tests)
```

To run locally in a browser:

```
npx http-server .          # or any static server
# then open http://localhost:8080
```

Pixi.js is pulled from jsdelivr via the ESM import map in `index.html`. You do not need to `npm install pixi.js`.

---

## Running the tests

```
npm test              # all tests
node --test tests/missions.test.js     # one file
```

The suite is pure `node --test`. No Jest, no Mocha, no Vitest. If you add a new pure module, add a test file next to it in `tests/`.

---

## Pull request workflow

1. **Branch off `main`.** Name: `devin/<timestamp>-<short-slug>` (or similar). Never push to `main` directly; `main` is protected.
2. **One PR per logical change.** Don't stack unrelated fixes. A PR body should fit in your head.
3. **Update the docs in the same PR.**
   - Changed the scoring formula? Update `docs/GAMEPLAY.md`.
   - Changed module layout? Update `docs/ARCHITECTURE.md`.
   - Changed the main-menu / hub layout? Update `docs/UI-HUB.md`.
   - Shipped a roadmap item? Strike it from `docs/ROADMAP.md` and add a line to `CHANGELOG.md`.
   - Made an architectural bet? Add a `docs/adr/NNNN-*.md` ADR.
4. **Open the PR with the template.** `fetch_template` / the PR body template is there for a reason — fill it out.
5. **Wait for CI.** Don't ask for review until tests are green.
6. **Don't force-push after review has started**, unless you `--force-with-lease` onto your own feature branch to rebase cleanly.

---

## PR checklist (self-review before opening)

Before you mark the PR ready:

- [ ] `npm test` passes locally
- [ ] Relevant doc updated (`DESIGN`, `GAMEPLAY`, `ARCHITECTURE`, `ROADMAP`, or an ADR)
- [ ] No new feature flags / `?engine=*` / debug toggles left on
- [ ] No `console.log` / debug print in committed code
- [ ] No new runtime dep without an ADR
- [ ] `GameState` / `HighScores` / `missions.js` are still pure (no `document`, no `setTimeout`, no network)
- [ ] If you added persisted state, it's versioned and has a migration path
- [ ] If you changed a number, it's in `GAMEPLAY.md`'s tunable table
- [ ] `CHANGELOG.md` has a line under "Unreleased" if this change is player-visible

## House rules (non-negotiables)

These have all bitten us at least once. Repeat offenders get reverted.

- **No feature flags in production.** The `?engine=pixi` saga ended badly; don't repeat it.
- **No dead code paths.** If a migration is done, delete the fallback. Not next month, now.
- **No DOM in `GameState`.** State is pure. Inject the scheduler + RNG.
- **No per-cell CSS animations on large boards.** Pixi avoids the problem; if you ever have to go back to DOM rendering, `.low-fx` guards are mandatory.
- **No `10×20` field size.** It reads as "default Tetris" and the game is not default Tetris.
- **No `?engine=*` URL flags** under any spelling. The root URL is the game.
- **No force-push to `main`.** No amending committed commits. No skipping hooks.
- **No secrets in the repo.** No `.env`, no API keys, not even for local dev — we don't have any yet and we want to keep it that way.
- **No generated files edited by hand.** Use the tool that generated them.
- **No working around a failing test.** Fix it or fix the code.
- **Update docs in the same PR as the code.** Docs that drift are worse than no docs.

## Branch naming

- `devin/<ts>-<slug>` for agent-written branches (what I use).
- `codex/<slug>` for assistants using Codex-style branches (already seen in the branch list; we tolerate them, just don't mix styles within one PR).
- For human contributions: `<author>/<slug>` is fine. Don't use `main`, `master`, `dev`, or `release`.

## Commit messages

One-line summary + optional body. No strict conventional-commits, but be specific:

- ✓ "Pixi mission-select: 3×3 cards driven by tier catalog"
- ✗ "fix stuff"
- ✗ "wip"

Don't reference PR numbers in the summary (GitHub adds them).

## Code style

- ES modules, `'use strict'` implied.
- 4-space indent for JS. 2-space for Markdown lists.
- Single-quoted strings.
- `const` by default, `let` when needed, `var` never.
- Early returns over deeply nested ifs.
- Comments describe *why*, not *what* the code does. If a comment only makes sense to someone reading the diff, it doesn't belong in the file. Put that context in the PR description.
- No `any` / lazy `getattr`-style access.
- Name is shorter if it's short-lived; longer if it's a public API.

---

## Working with AI assistants (Devin, Codex, etc.)

- Assistants *must* update the relevant doc in the same PR as the code change. A PR that says "I made the change" without touching docs is incomplete.
- Assistants *must not* silently introduce new runtime deps. Ask first.
- Assistants *must not* leave fallback / legacy paths in place "for safety" — delete them when the migration lands.
- Assistants are free to open ADRs for decisions they think are worth locking in; the human reviewer decides Accepted / Rejected.

If an assistant keeps hitting the same guard rail, the guard rail moves into a `SKILL.md` or into this file.

---

## Reporting bugs

Open a GitHub issue with:

- Mode / complexity / field-size of the mission
- Browser + OS
- Steps to reproduce
- What you expected vs. what happened
- Console log (if any) and a screenshot / short clip if possible

Don't include secrets (we don't have any, and you don't either).
