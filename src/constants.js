// Shared gameplay constants.
// These are values that both the pure game-state module and the DOM view
// module agree on. Nothing in this file should import from the DOM.

export const COLS = 10;
export const ROWS = 20;
export const BLOCK_SIZE = 30;

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
//  - TETRIS    : click-to-match is disabled entirely; only line clears score.
export const GAME_MODES = Object.freeze({
    STELLAR: 'stellar',
    AUTO_MATCH: 'auto-match',
    TETRIS: 'tetris',
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
        id: 'tetris-mutated',
        mode: GAME_MODES.TETRIS,
        complexity: PIECE_COMPLEXITY.MUTATED,
        label: 'Tetris / Mutated',
        short: 'T·M',
        color: '#f87171', // red-400
    },
    {
        id: 'tetris-collapsed',
        mode: GAME_MODES.TETRIS,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
        label: 'Tetris / Collapsed',
        short: 'T·X',
        color: '#dc2626', // red-600
    },
]);

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
