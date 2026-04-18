// Shared gameplay constants.
// These are values that both the pure game-state module and the DOM view
// module agree on. Nothing in this file should import from the DOM.

// Default block size in CSS pixels. Larger grids downscale this so the
// board always fits the layout (see BLOCK_SIZE_FOR below).
export const BLOCK_SIZE = 30;
export const MIN_BLOCK_SIZE = 22;
// Target maximum board height in CSS pixels; block size is clamped so
// rows * block_size never exceeds this.
export const MAX_BOARD_HEIGHT = 720;

// Scale block size down for taller grids so the board doesn't overflow the
// layout. Returns an integer >= MIN_BLOCK_SIZE.
export function BLOCK_SIZE_FOR(rows) {
    const fit = Math.floor(MAX_BOARD_HEIGHT / rows);
    return Math.max(MIN_BLOCK_SIZE, Math.min(BLOCK_SIZE, fit));
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
export const DROP_INTERVAL_START_MS = 1500;
export const DROP_INTERVAL_MIN_MS = 200;
export const DROP_INTERVAL_STEP_MS = 75;

// Lines required to advance one level.
export const LINES_PER_LEVEL = 10;

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

// Six curated difficulty tiers for the high-score board. Each tier is a
// unique (mode, complexity) combination. Ordered easy -> hard so the UI
// can render a green -> red gradient straight off the array index.
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
        color: '#a3e635', // lime-400
    },
    {
        id: 'auto-match-classic',
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.CLASSIC,
        label: 'Auto-Match / Classic',
        short: 'A·C',
        color: '#facc15', // yellow-400
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

// Default field size id (applied per complexity). Medium is the balanced
// starting point.
export const DEFAULT_FIELD_SIZE_ID = 'medium';

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
