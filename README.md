# Stellar Venture

> Previously **Stellar Collapse**. Renamed with the pivot to a hybrid
> casual/idle space-dispatcher game; repo URL stays `Sergutsu/StellarCollapse`.
> See [ADR-0006](docs/adr/0006-rename-stellar-venture.md) for context.

You are the **Chief Dispatcher** of a fringe outpost. Missions come in, you pick which rock is worth the fuel, and the puzzle is the shift: match 4+ runs, stack falling blocks, chain snakes and bombs, bank the ore. Short runs stack into an idle meta-loop (hub, rep tier, upgrades) landing in phases after the core puzzle.

### ▶ [**Play Now**](https://sergutsu.github.io/StellarCollapse/)

*(First-time setup: see [Enabling GitHub Pages](#enabling-github-pages) below — Pages needs to be turned on once in repo settings before the Play link goes live.)*

### Docs

The repo is moving toward a hybrid casual / idle space-exploration game. Deep details live in `docs/`:

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's shipped, next, later.
- [`docs/DESIGN.md`](docs/DESIGN.md) — pillars, core + meta loops, UX.
- [`docs/GAMEPLAY.md`](docs/GAMEPLAY.md) — mechanics spec + canonical tunable numbers.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module graph, rendering rules, house rules.
- [`docs/adr/`](docs/adr/) — architecture decision records (Pixi-only, seeded mission RNG, tier↔mission 1:1).
- [`CHANGELOG.md`](CHANGELOG.md) — human-readable release notes.

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Pixi.js-E91E63?style=flat-square&logo=pixijs&logoColor=white" alt="Pixi.js">
  <img src="https://img.shields.io/badge/no%20build-pure%20ES%20modules-2ea44f?style=flat-square" alt="No build">
  <img src="https://img.shields.io/github/actions/workflow/status/Sergutsu/StellarCollapse/tests.yml?branch=main&label=tests&style=flat-square" alt="Tests">
</p>

---

## Highlights

- **3 gameplay modes** — Stellar click-match, Auto-Match (4+ runs clear on lock), Blocks (line clears only).
- **3 piece-complexity tiers** — Classic (7 standard shapes, monochrome), Mutated (15 shapes, multicolor), Totally Collapsed (adds bomb cells + chaos).
- **3 field sizes per complexity** — pick Small / Medium / Large on the start screen; the grid resizes and the block scale adapts so the board still fits the viewport.
- **6-tier leaderboard** — each (mode × complexity) combo has its own top-5, with a green → red difficulty gradient.
- **Specials in the top tier only** — snakes (4-match) and bombs (5+ match) only fire in Totally Collapsed. Easier tiers stay clean.
- **Gravity-freeze in Totally Collapsed** — color matches and bomb blasts don't drop survivors; cells hang suspended (visibly outlined) until a snake run recolors the board and unlocks gravity.
- **No build step** — pure ES modules in the browser. Clone and run.
- **Mobile-responsive** — hub and gameplay surfaces scale to fit narrow viewports; touch gestures (swipe to move/rotate/drop) make runs fully playable on phones.
- **Unit-tested core** — `GameState` is fully decoupled from DOM/audio; `npm test` runs a `node --test` suite with zero dependencies.

---

## Play

Open [the live version on GitHub Pages](https://sergutsu.github.io/StellarCollapse/) — no install, no build.

Or run it locally (see [Local Development](#local-development) below).

### Controls

| Key              | Action                             |
| ---------------- | ---------------------------------- |
| `←` / `→`        | Move piece left / right            |
| `↓`              | Soft drop                          |
| `↑`              | Rotate                             |
| `SPACE`          | Hard drop                          |
| **Mouse click**  | Trigger a color match (Stellar mode only; disabled in Blocks, automated in Auto-Match) |

### Game modes

Pick one on the start screen:

- **Stellar** — Runs of 4+ matching cells only clear when you *click* one of them. The classic Stellar Venture flow (formerly Stellar Collapse click-match).
- **Auto-Match** — Every 4+ run clears automatically the moment a piece locks. No clicking.
- **Blocks** — Click-to-match is disabled. Only full horizontal line clears score. Pure block-stacking.

### Piece complexity

Also on the start screen:

- **Classic** — 7 standard falling-block shapes (I, J, L, O, S, T, Z). Each piece is a single color.
- **Mutated** — 15-shape pool, per-cell random color. More chaos, more combos.
- **Totally Collapsed** — Mutated pool + occasional **bomb cells** in freshly spawned pieces + **snake/bomb specials** on 4/5-matches. Color matches and bombs clear cells but **don't trigger gravity** — survivors stay suspended until a snake runs across the board. Hardest tier.

### Field size

Each complexity exposes three board sizes on the start screen. Sizes were picked so pieces still spawn centered and the widest shape in the pool fits comfortably:

| Complexity        | Small  | Medium | Large  |
| ----------------- | ------ | ------ | ------ |
| Classic           | 7×14   | 9×18   | 12×22  |
| Mutated           | 8×16   | 11×22  | 13×26  |
| Totally Collapsed | 9×18   | 12×24  | 15×28  |

Taller grids automatically use a smaller block size so the whole board stays within the viewport.

### Scoring

```
Line clears:   1×40   2×100   3×300   4×1200   (all × level)
Color match:   cells × 10 × level
Bomb blast:    cells × 25 × level
```

### Mission tiers (easy → hard)

9 `(mode, complexity)` archetypes make up the mission catalogue. Green → red difficulty gradient across the 3×3 start-screen grid. Canonical list: `HIGHSCORE_TIERS` in [`src/constants.js`](src/constants.js); tuned tier ↔ narrative mapping: [`docs/UI-HUB.md` § Narrative mission catalog](docs/UI-HUB.md#narrative-mission-catalog).

> Leaderboard removed — the game is about banking per-run ores + credits, not
> a top-5 table. See [ADR-0005](docs/adr/0005-delete-highscore-system.md).

---

## Local Development

No dependencies, no build. ES modules need to be loaded over HTTP (not `file://`), so run a tiny static server:

```bash
# From the project root (works on Windows, macOS, Linux)
npm run serve
# then open http://localhost:3000
```

The `serve` script uses `npx -y serve .` (reliable on Windows/PowerShell without Python).

Alternative (if you prefer Python):
```bash
python -m http.server 8000   # or python3 on some systems
# then open http://localhost:8000
```

Or directly: `npx -y serve .`

### Running tests

The game-state logic is covered by [`node --test`](https://nodejs.org/api/test.html) unit tests — no dependencies, nothing to install.

```bash
npm test
```

Covers movement, rotation, gravity, line clears, color matches, the special-block mechanics (bomb, snake), the mission catalogue, and scene-manager registration/lifecycle. 108 tests as of the latest merge.

---

## Architecture

Short version — pure `GameState` + `missions.js` (Node-testable, no DOM, no timers), Pixi-only view with extracted scene classes (`HubScene`, `GameScene`, `ResultsScene`, three hub-tab scenes), event-emitter bus, static `index.html` shell. For the full module graph, scene-graph, persistence plan, and house rules see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Design rule:** `GameState` never reaches into the DOM and never talks to `setTimeout`/`Date.now` directly. The host injects `rng` and `schedule`. That's what lets the whole thing run under `node --test` with a seeded RNG and synchronous scheduler.

---

## Enabling GitHub Pages

The repo ships with a `.github/workflows/pages.yml` Actions workflow that deploys every push to `main` straight to Pages. **One-time setup** in the repo:

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **"GitHub Actions"**.
3. Push any commit to `main` (or re-run the workflow from the Actions tab).

Once deployed, the live game is at `https://<owner>.github.io/StellarCollapse/` — for this fork, [sergutsu.github.io/StellarCollapse](https://sergutsu.github.io/StellarCollapse/).

### Continuous Integration

`.github/workflows/tests.yml` runs `npm test` on every push and PR. No secrets, no npm install — just `node --test`.

---

## Contributing

Bug reports and PRs welcome via the [Issues](../../issues) tab. When adding features:

- Game logic goes in `src/game-state.js` and needs a matching test in `tests/game-state.test.js`.
- Hub / tab visuals go in `src/scenes/hub-scene.js` or `src/scenes/tabs/*.js`. In-game visuals live in `src/scenes/game-scene.js`. Shared Pixi chrome helpers live in `src/pixi-ui-kit.js`. Don't import the DOM into `GameState`.
- Run `npm test` locally before opening a PR — CI will also enforce it.
- Update the relevant doc (`DESIGN`, `GAMEPLAY`, `ARCHITECTURE`, `ROADMAP`, or an ADR) in the same PR as the code change.

---

## License

MIT. Have fun, don't sell it.
