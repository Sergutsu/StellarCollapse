# Gameplay Spec

> **Canonical source of truth for tunable numbers.** `src/constants.js` mirrors this file. When you tune a number, update both in the same PR.
>
> Covers the three modes, three complexities, three field sizes, scoring, specials, and mission catalog.

---

## Modes

### Stellar (match-4)

- Pieces drop, lock on landing.
- **Matches clear when 4+ same-colour cells are orthogonally adjacent** (including diagonals on Collapsed — see below).
- Gravity runs after every clear; chain matches trigger additional scoring.
- Player controls: left/right, soft drop, hard drop, rotate.

### Auto-Match

- Like Stellar, but the player doesn't control pieces. Cells are clicked on a pre-populated board; clicking a cell of colour X in a group of ≥4 same-colour explodes that group.
- Board refills from the top after every match.
- Score rewards chains: clicking a cell that triggers a gravity-fed chain gets a multiplier.

### Blocks (Tetris-like)

- Pieces drop and lock into lines.
- **Full rows clear on lock**, not on colour match.
- Same piece pool and controls as Stellar.
- Scoring per line, with a bonus multiplier for simultaneous 2/3/4-line clears (Tetris-style).

### Mode × Complexity × Size matrix

Every tier in `HIGHSCORE_TIERS` is a `(mode, complexity)` pair. Field size is a third axis:
 - Small / Medium / Large vary per complexity (each complexity has its own triplet).
 - Actual cell dimensions live in `FIELD_SIZES` in `constants.js`.

---

## Piece complexity

### Classic

- 7 standard Tetris-ish shapes (I, O, T, S, Z, L, J).
- No specials spawn.
- 4 normal colours (`red`, `blue`, `green`, `yellow`).

### Mutated

- Shapes from Classic plus 5–10 mutated variants (plus/X/U shapes etc.).
- Larger spawn pool → more varied stacking.
- Still no specials.

### Collapsed ("Totally Collapsed")

- All Mutated shapes plus occasional single-cell / 2-cell "collapsed" fragments.
- **Bomb** and **snake** specials spawn.
- Diagonal adjacency counts for match detection.
- Gravity freeze during match resolve (prevents cascade lockups).

---

## Specials (Collapsed only)

### Bomb tile

- Spawns at a small per-piece probability.
- When it lands, an **armed timer** starts. **5 s** in Collapsed mode. During that window, clearing the bomb (via match or click-match) detonates it and destroys the surrounding **5×5** area (center ± `BOMB_RADIUS`, currently 2).
- If the timer expires unused, the bomb **morphs to a random normal-colour tile**.
- Visual: bomb emoji + red pulse + arc countdown.

### Snake tile

- Spawns at a small per-piece probability, separate from bomb.
- Same 5 s armed timer behaviour. If triggered, the snake walks along adjacent cells and clears a trail of **SNAKE_LENGTH = 5** cells, starting from the trigger point.
- If timer expires, morphs to a random normal-colour tile.
- Visual: snake emoji + green pulse + arc countdown + animated walk when triggered.

### Arming-timer invariant

- The timer runs on cells that are **settled** (have fallen and locked). Gravity shifts preserve the remaining timer; the cell carries its countdown wherever it lands.
- `match-detected` in the view guards against double-firing star reactions when a match lands on a snake cell — the snake reaction wins.

---

## Scoring

All score values fire on the `score-changed` event from `GameState`. The view reads, never writes.

### Base points

| Event | Base points |
|---|---|
| Normal match (4+ cells) | `MATCH_POINTS = 10` per cleared cell |
| Auto-Match sweep | 10 per cleared cell (same `MATCH_POINTS`) |
| Bomb explosion | 25 per destroyed cell |
| Line clear in Blocks | `LINE_POINTS = [0, 40, 100, 300, 1200]` for 0/1/2/3/4-line clears (Tetris-style bonus on simultaneous lines) |

### Multipliers

Final points = `base × levelMultiplier × sizeMultiplier`.

- **Level multiplier** = current level (starts at 1, +1 every `LINES_PER_LEVEL = 8` lines / matches).
- **Size multiplier** — `getSizeMultiplier(sizeId)` in `constants.js`:
  - Small: ×1.50 (tighter board, earn more)
  - Medium: ×1.00
  - Large: ×0.75 (roomy board, earn less)

Both multipliers apply to every scoring path.

### Level ramp

- Level 1 drop interval: **1000 ms**
- Level step: **−100 ms per level**
- Floor: **200 ms** (hit at level 9)
- Level-up cadence: every **8** lines / matches (`LINES_PER_LEVEL`)

This ramp must be perceptible — a player who reaches level 5 should feel a ~60% interval drop. Don't flatten it without updating `DESIGN.md`.

### Scoring invariants (tested)

- Clearing the same 4-cell block twice with the same level + size scores identically.
- A single line clear at level 3 on a large board scores `40 × 3 × 0.75 = 90`.
- Bomb points use the bomb base, not the per-cell-colour base.
- Auto-match scoring uses each cell's own colour, not the clicked cell's colour. (See PR #5.)

---

## Ore mapping

Every cell cleared counts as an ore pickup:

| Palette | Ore | Rarity |
|---|---|---|
| red | Pyrite | common |
| blue | Cryonite | common |
| green | Verdanite | common |
| yellow | Helium | common |
| bomb | Volatiles | rare |
| snake | Biomass | rare |

Lookup: `ORE_BY_COLOR[color]` in `src/missions.js`.

Per-run tally is **not yet implemented** as of PR #32 — that lands in P1 (see `ROADMAP.md`). The mapping is exposed so the mission cards can preview expected ores.

---

## Mission catalog

See `src/missions.js`. `buildMissions({ seed })` returns **one mission per ranked tier**, in tier order.

Mission object shape:

```
{
  id:            'mission-<tierId>',
  tierId:        'stellar-classic' | 'auto-match-mutated' | ...,
  tierIndex:     1..9,
  tierColor:     '#rrggbb',
  name:          'Kuiper Slate K-7'                     // asteroid name, rolled from per-tier pool
  label:         'Stellar · Classic'                    // tier label from HIGHSCORE_TIERS
  difficulty:    'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'EXTREME' | 'CRITICAL'
  brief:         'short flavor text'
  baseCredits:   100 × tierIndex                        // 100, 200, ..., 900
  expectedOres:  ['pyrite','cryonite','verdanite','helium', <+ 'volatiles','biomass' if Collapsed>]
  gameConfig:    { mode, complexity, fieldSizeId }      // what GameState.configure() consumes
  available:     true                                   // P2: rep/mission gates
  requires:      null                                   // P2: unlock prerequisites
}
```

### Seeded rolling

- `buildMissions({ seed: N })` is deterministic. Same seed → same mission list (asteroid names stable).
- Different seeds → names diverge on at least one tier almost always.
- Used so the mission list is stable within a session but varies across page loads. Daily reroll (P3) will feed `dayOfYear` as the seed.

### Per-tier flavor pools

Each `tierId` has 3 asteroid names and one brief in the catalog. Extend `ASTEROID_NAMES` and `TIER_BRIEF_BY_ID` in `src/missions.js` — no other code touches the pool.

---

## Field sizes

Per-complexity triplets in `FIELD_SIZES`:

| Complexity | Small | Medium | Large |
|---|---|---|---|
| Classic | 7×14 | 9×18 | 12×22 |
| Mutated | 8×16 | 11×22 | 13×26 |
| Collapsed | 9×18 | 12×24 | 15×28 |

None use 10×20 (deliberate — that was the old default and we want the sizes to feel distinct).

### Visual sizing

- Target board slot: 400×720 px at base scale.
- `BLOCK_SIZE_FOR(cols, rows)` picks a per-cell pixel size that fills the slot vertically.
- **Low-fx threshold:** `LOW_FX_CELL_THRESHOLD` (currently 240 cells). Past this count, expensive per-cell animations (floating dashed outline, bomb/snake idle pulse, hover filter) are skipped. Pixi perf holds at 60 fps on 15×28 because per-frame cost is constant, not per-cell.

---

## Leaderboard ("MISSION LOG")

- Top 5 scores per tier, sorted desc.
- Keyed by `tierId`.
- Player name is always `"Chief Dispatcher"` in the current build (fixed identity).
- Stored in localStorage via `src/highscores.js`. Versioned and self-migrating (old `classic-*` → `stellar-*`, old `tetris-*` → `blocks-*`, legacy single-list → easiest tier).
- Corrupt payload falls back to empty tiers without throwing.

---

## Tunable numbers summary (index)

When you need to tune any of these, update the constant **and** this file in the same PR:

| Name | File | Current |
|---|---|---|
| `MATCH_POINTS` | constants.js | 10 per cleared cell |
| `LINE_POINTS` | constants.js | `[0, 40, 100, 300, 1200]` |
| Bomb points per destroyed cell | constants.js | 25 |
| `BOMB_RADIUS` | constants.js | 2 (⇒ 5×5 blast) |
| `SNAKE_LENGTH` | constants.js | 5 |
| `LINES_PER_LEVEL` | constants.js | 8 |
| Drop interval start / step / floor | constants.js | 1000 / 100 / 200 ms |
| Special-arming timer | constants.js | 5 s |
| Size multipliers | constants.js `FIELD_SIZE_MULTIPLIERS` | 1.5 / 1.0 / 0.75 |
| Low-fx cell threshold | constants.js `LOW_FX_CELL_THRESHOLD` | 240 |
| `FIELD_SIZES` | constants.js | see table above |
| `HIGHSCORE_TIERS` | constants.js | 9 tiers |
| Mission base credits | missions.js `baseCreditsFor` | 100 × tierIndex |
| Per-tier asteroid name pool | missions.js `ASTEROID_NAMES` | 3 per tier |
