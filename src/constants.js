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
