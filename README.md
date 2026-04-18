# Stellar Collapse

A cosmic block puzzle that mashes Tetris with color-match mechanics. Drop pieces, clear lines, and (if you're feeling brave) chain 4+ color runs into snakes and bombs for board-clearing combos.

### ▶ [**Play Now**](https://sergutsu.github.io/StellarCollapse/)

*(First-time setup: see [Enabling GitHub Pages](#enabling-github-pages) below — Pages needs to be turned on once in repo settings before the Play link goes live.)*

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white" alt="TailwindCSS">
  <img src="https://img.shields.io/badge/no%20build-pure%20ES%20modules-2ea44f?style=flat-square" alt="No build">
  <img src="https://img.shields.io/github/actions/workflow/status/Sergutsu/StellarCollapse/tests.yml?branch=main&label=tests&style=flat-square" alt="Tests">
</p>

---

## Highlights

- **3 gameplay modes** — Classic click-match, Auto-Match (4+ runs clear on lock), Tetris (line clears only).
- **3 piece-complexity tiers** — Classic (7 tetrominoes, monochrome), Mutated (15 shapes, multicolor), Totally Collapsed (adds bomb cells + chaos).
- **6-tier leaderboard** — each (mode × complexity) combo has its own top-5, with a green → red difficulty gradient.
- **Specials in the top tier only** — snakes (4-match) and bombs (5+ match) only fire in Totally Collapsed. Easier tiers stay clean.
- **No build step** — pure ES modules in the browser. Clone and run.
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
| **Mouse click**  | Trigger a color match (Classic mode only; disabled in Tetris, automated in Auto-Match) |

### Game modes

Pick one on the start screen:

- **Classic** — Runs of 4+ matching cells only clear when you *click* one of them. As-was.
- **Auto-Match** — Every 4+ run clears automatically the moment a piece locks. No clicking.
- **Tetris** — Click-to-match is disabled. Only full horizontal line clears score. Pure tetris.

### Piece complexity

Also on the start screen:

- **Classic** — 7 standard tetrominoes (I, J, L, O, S, T, Z). Each piece is a single color.
- **Mutated** — 15-shape pool, per-cell random color. More chaos, more combos.
- **Totally Collapsed** — Mutated pool + occasional **bomb cells** in freshly spawned pieces + **snake/bomb specials** on 4/5-matches. Hardest tier.

### Scoring

```
Line clears:   1×40   2×100   3×300   4×1200   (all × level)
Color match:   cells × 10 × level
Bomb blast:    cells × 25 × level
```

### Leaderboard tiers (easy → hard)

The start screen shows a tab strip with one tab per tier. Each tab keeps its own top-5.

| # | Mode         | Complexity          | Icon color |
| - | ------------ | ------------------- | ---------- |
| 1 | Classic      | Classic             | green      |
| 2 | Classic      | Mutated             | lime       |
| 3 | Auto-Match   | Classic             | yellow     |
| 4 | Auto-Match   | Totally Collapsed   | orange     |
| 5 | Tetris       | Mutated             | red        |
| 6 | Tetris       | Totally Collapsed   | deep red   |

---

## Local Development

No dependencies, no build. ES modules need to be loaded over HTTP (not `file://`), so run a tiny static server:

```bash
git clone https://github.com/Sergutsu/StellarCollapse.git
cd StellarCollapse
python3 -m http.server 8000
# then open http://localhost:8000
```

Or with Node: `npx serve .` or any other static server.

### Running tests

The game-state logic is covered by [`node --test`](https://nodejs.org/api/test.html) unit tests — no dependencies, nothing to install.

```bash
npm test
```

Covers movement, rotation, gravity, line clears, color matches, and the special-block mechanics (bomb, snake). More cases are added as modes/complexity features land (see PR history).

---

## Architecture

```
index.html           HTML + CSS only. Loads src/main.js as <script type="module">.
src/
├── constants.js     Grid size, colors, shape constants, modes/complexity/tier tables.
├── shapes.js        CLASSIC_SHAPES (7), MUTATED_SHAPES (15), COLLAPSED_SHAPES alias, getShapePool().
├── emitter.js       Tiny event emitter shared by state/view/audio.
├── game-state.js    Pure game logic. No DOM, no Web Audio, no setTimeout.
│                    Takes { rng, schedule, mode, complexity } at construction.
│                    Emits ~15 events (piece-moved, piece-locked, match-cleared, ...).
├── game-view.js     DOM renderer. Subscribes to state events, paints cached cells.
├── input.js         Keyboard + click wiring.
├── audio.js         Web Audio SFX. Subscribes to state events.
├── stars.js         Background starfield.
├── highscores.js    Per-tier localStorage persistence (with legacy migration).
└── main.js          Bootstrap: wires everything, handles screen transitions + toggles.

tests/
├── game-state.test.js   Core gameplay: movement, gravity, scoring, modes, complexity.
└── highscores.test.js   Per-tier save/top/migration.
```

**Design rule**: `GameState` never reaches into the DOM and never talks to `setTimeout`/`Date.now` directly. The host injects `rng` and `schedule`. That's what lets the whole thing run under `node --test` with a seeded RNG and synchronous scheduler.

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
- DOM/visuals go in `src/game-view.js` (or a new module). Don't import the DOM into `GameState`.
- Run `npm test` locally before opening a PR — CI will also enforce it.

---

## License

MIT. Have fun, don't sell it.
