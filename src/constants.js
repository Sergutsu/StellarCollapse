// Shared gameplay constants.
// These are values that both the pure game-state module and the DOM view
// module agree on. Nothing in this file should import from the DOM.

// Fallback block size in CSS pixels if we don't have a row count to
// scale against (e.g. preview cells). Actual in-game blocks are sized by
// `BLOCK_SIZE_FOR(rows)` so every field size fills the same vertical
// slot regardless of how many rows it has.
export const BLOCK_SIZE = 30;
// Floor on the computed block size. Below this pieces become unreadable
// even on the tallest (28-row) board, so we accept the vertical gap
// instead of squeezing further.
export const MIN_BLOCK_SIZE = 22;
// Ceiling on the computed block size. Without a cap, a 14-row Small
// board would give 50+ px cells that look oversized next to the HUD
// panels. 48 keeps Small looking chunky-but-proportional.
export const MAX_BLOCK_SIZE = 48;
// Target board height in CSS pixels. Every field size aims for exactly
// this height (bounded by MIN/MAX block size) so the overall game
// screen reads as one consistent rectangle regardless of whether the
// player picked 14 rows or 28 rows.
export const MAX_BOARD_HEIGHT = 720;

// Scale block size so `rows * blockPx` lands as close to
// MAX_BOARD_HEIGHT as the min/max block size caps allow. Returns an
// integer in [MIN_BLOCK_SIZE, MAX_BLOCK_SIZE].
export function BLOCK_SIZE_FOR(rows) {
    const fit = Math.floor(MAX_BOARD_HEIGHT / rows);
    return Math.max(MIN_BLOCK_SIZE, Math.min(MAX_BLOCK_SIZE, fit));
}

// Colors that can appear on the board. The first four are the normal
// block colors generated when a piece spawns; 'bomb' and 'snake' are only
// produced by color-match removals (5+ and exactly 4 respectively).
export const NORMAL_COLORS = ['red', 'blue', 'green', 'yellow'];
export const COLORS = [...NORMAL_COLORS, 'bomb', 'snake'];

// Classic line-clear score table (index = lines cleared simultaneously),
// multiplied by the current level.
export const LINE_POINTS = [0, 40, 100, 300, 1200];

// Score for a single color-match click removal: MATCH_POINTS * matches * level.
export const MATCH_POINTS = 10;

// Bomb bonus: BOMB_POINTS * cells exploded * level.
export const BOMB_POINTS = 25;

// Starting and minimum drop intervals in milliseconds, plus how much faster
// each level gets. Keep these in one place so tuning doesn't drift.
// Starting gravity at level 1. Classic Tetris starts near ~1000ms, which
// feels snappier than the old 1500ms ceiling without being punishing.
export const DROP_INTERVAL_START_MS = 1000;
// Gravity floor -- once the player hits this level, drops won't get
// faster. Kept at 200ms so very late game is playable.
export const DROP_INTERVAL_MIN_MS = 200;
// Ms shaved off the drop interval for each level gained. 100ms is the
// smallest step that still reads as "faster" to a player holding the
// board with both hands; 75 (the old value) was sub-perceptual.
export const DROP_INTERVAL_STEP_MS = 100;

// Lines required to advance one level. 8 lines gives a perceptible
// rhythm of level-ups on every field size without making max level
// trivially reachable.
export const LINES_PER_LEVEL = 8;

// Size of the piece preview queue (1 "next" + 3 "coming up" previews).
export const PIECE_QUEUE_SIZE = 5;

// Bomb explosion radius (5x5 area = center +/- 2).
export const BOMB_RADIUS = 2;

// Snake trail: number of segments trailing the head.
export const SNAKE_LENGTH = 5;

// Total duration (ms) of a snake animation. The per-step interval is
// derived from this and the number of blocks on the board.
export const SNAKE_TOTAL_MS = 5000;
export const SNAKE_MIN_STEP_MS = 50;

// Gameplay mode: how color matches are triggered.
//  - STELLAR   : player must click a 4+ run to clear (the original flow).
//  - AUTO_MATCH: every 4+ run is auto-cleared when a piece locks.
//  - BLOCKS    : click-to-match is disabled entirely; only full horizontal
//                line clears score. Pure block-stacking gameplay.
export const GAME_MODES = Object.freeze({
    STELLAR: 'stellar',
    AUTO_MATCH: 'auto-match',
    BLOCKS: 'blocks',
});

// Piece complexity: which shape pool the RNG draws from, and whether each
// cell of a piece gets its own random color.
//  - CLASSIC  : 7 standard tetrominoes, monochrome pieces.
//  - MUTATED  : full 15-shape pool, per-cell random color (current behavior).
//  - COLLAPSED: 15-shape pool, per-cell random color with special cells
//               (bombs) occasionally injected at spawn time.
export const PIECE_COMPLEXITY = Object.freeze({
    CLASSIC: 'classic',
    MUTATED: 'mutated',
    COLLAPSED: 'collapsed',
});

// Chance (0..1) that any given filled cell in a freshly spawned COLLAPSED
// piece is mutated into a bomb. Kept small so pieces still feel like
// pieces, not explosive clouds.
export const COLLAPSED_BOMB_CHANCE = 0.04;

// COLLAPSED only: newly-placed bomb / snake cells arm a countdown. If the
// player doesn't consume the special within this window it morphs into a
// random normal-color cell -- use-it-or-lose-it pressure that turns the
// hardest complexity into a clock. Tests can pass `specialArmMs: 0` to
// the GameState constructor to disable arming (avoids stale expirations
// under a synchronous scheduler).
export const SPECIAL_ARM_MS = 5000;

// All nine (mode, complexity) combinations get their own leaderboard so
// every legal start-screen selection ranks. Ordered easy -> hard; the
// UI renders a green -> red gradient straight off the array index.
//
// Difficulty order rationale:
//  - Stellar (manual click-match) is the gentlest mode: the player sets
//    their own pace on matches. Classic < Mutated < Collapsed.
//  - Auto-Match removes match agency (good and bad -- cleared runs on
//    lock but also surprise clears in the spawn zone), so it slots
//    above each Stellar counterpart of the same complexity.
//  - Blocks disables click-matching entirely; only line clears score
//    and only line clears level you up. Hardest mode end-to-end.
//  - Within each mode we use Classic < Mutated < Collapsed because
//    Collapsed freezes gravity on matches/bombs, which is the harshest
//    single modifier in the game.
export const HIGHSCORE_TIERS = Object.freeze([
    {
        id: 'stellar-classic',
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.CLASSIC,
        label: 'Stellar / Classic',
        short: 'S·C',
        color: '#34d399', // green-400
    },
    {
        id: 'stellar-mutated',
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.MUTATED,
        label: 'Stellar / Mutated',
        short: 'S·M',
        color: '#86efac', // green-300 (slightly cooler lime)
    },
    {
        id: 'auto-match-classic',
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.CLASSIC,
        label: 'Auto-Match / Classic',
        short: 'A·C',
        color: '#a3e635', // lime-400
    },
    {
        id: 'auto-match-mutated',
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.MUTATED,
        label: 'Auto-Match / Mutated',
        short: 'A·M',
        color: '#facc15', // yellow-400
    },
    {
        id: 'stellar-collapsed',
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
        label: 'Stellar / Collapsed',
        short: 'S·X',
        color: '#fbbf24', // amber-400
    },
    {
        id: 'auto-match-collapsed',
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
        label: 'Auto-Match / Collapsed',
        short: 'A·X',
        color: '#fb923c', // orange-400
    },
    {
        id: 'blocks-classic',
        mode: GAME_MODES.BLOCKS,
        complexity: PIECE_COMPLEXITY.CLASSIC,
        label: 'Blocks / Classic',
        short: 'B·C',
        color: '#f97316', // orange-500
    },
    {
        id: 'blocks-mutated',
        mode: GAME_MODES.BLOCKS,
        complexity: PIECE_COMPLEXITY.MUTATED,
        label: 'Blocks / Mutated',
        short: 'B·M',
        color: '#f87171', // red-400
    },
    {
        id: 'blocks-collapsed',
        mode: GAME_MODES.BLOCKS,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
        label: 'Blocks / Collapsed',
        short: 'B·X',
        color: '#dc2626', // red-600
    },
]);

// Per-size score multiplier. Smaller boards are tighter (less horizontal
// room, faster top-out) so they pay more per cleared cell; larger boards
// have more lateral room to plan clears so they pay less. Applied on top
// of `level` in every scoring path (line clears, click-matches, bombs,
// auto-match) so picking Small is a risk/reward trade-off instead of
// purely easier or purely harder.
export const FIELD_SIZE_MULTIPLIERS = Object.freeze({
    small: 1.5,
    medium: 1.0,
    large: 0.75,
});

// Three field sizes per piece complexity. None use the 10x20 grid.
// Sizes were picked so pieces spawn centered, the widest shape in the pool
// fits comfortably, and the board stays tall enough for meaningful stacking.
// Each entry: { id, cols, rows, label }.
export const FIELD_SIZES = Object.freeze({
    [PIECE_COMPLEXITY.CLASSIC]: Object.freeze([
        { id: 'small',  cols: 7,  rows: 14, label: 'Small  7x14' },
        { id: 'medium', cols: 9,  rows: 18, label: 'Medium 9x18' },
        { id: 'large',  cols: 12, rows: 22, label: 'Large  12x22' },
    ]),
    [PIECE_COMPLEXITY.MUTATED]: Object.freeze([
        { id: 'small',  cols: 8,  rows: 16, label: 'Small  8x16' },
        { id: 'medium', cols: 11, rows: 22, label: 'Medium 11x22' },
        { id: 'large',  cols: 13, rows: 26, label: 'Large  13x26' },
    ]),
    [PIECE_COMPLEXITY.COLLAPSED]: Object.freeze([
        { id: 'small',  cols: 9,  rows: 18, label: 'Small  9x18' },
        { id: 'medium', cols: 12, rows: 24, label: 'Medium 12x24' },
        { id: 'large',  cols: 15, rows: 28, label: 'Large  15x28' },
    ]),
});

// Cell-count threshold at which the per-cell glow / pulse animations
// tank framerate. Above this, the grid gets a `.low-fx` class and the
// CSS drops the animated filters and box-shadows -- piece rendering and
// colors stay intact, only the expensive animated FX are disabled.
//
// Boards that cross this threshold today:
//   Classic  / Large      12x22 = 264
//   Mutated  / Large      13x26 = 338
//   Collapsed / Medium    12x24 = 288
//   Collapsed / Large     15x28 = 420
export const LOW_FX_CELL_THRESHOLD = 240;

// Default field size id (applied per complexity). Medium is the balanced
// starting point.
export const DEFAULT_FIELD_SIZE_ID = 'medium';

// Score multiplier for a given field-size id. Unknown ids fall back to
// the medium multiplier so a bad id never zeros out a run.
export function getSizeMultiplier(sizeId) {
    const m = FIELD_SIZE_MULTIPLIERS[sizeId];
    return typeof m === 'number' ? m : FIELD_SIZE_MULTIPLIERS[DEFAULT_FIELD_SIZE_ID];
}

// Resolve a { cols, rows } for a complexity + size-id pair. Falls back to
// the medium entry if anything is out of range.
export function resolveFieldSize(complexity, sizeId) {
    const list = FIELD_SIZES[complexity] || FIELD_SIZES[PIECE_COMPLEXITY.CLASSIC];
    const pick = list.find((s) => s.id === sizeId) || list.find((s) => s.id === DEFAULT_FIELD_SIZE_ID) || list[0];
    return { cols: pick.cols, rows: pick.rows, id: pick.id, label: pick.label };
}

// Look up a tier id from a (mode, complexity) pair. Returns null if the
// combination isn't a ranked tier (the user can still play it, it just
// doesn't save to a leaderboard).
export function findTier(mode, complexity) {
    for (let i = 0; i < HIGHSCORE_TIERS.length; i++) {
        const t = HIGHSCORE_TIERS[i];
        if (t.mode === mode && t.complexity === complexity) return t;
    }
    return null;
}
