// Shared tuning constants for the defense (Space-Invaders / Breakout
// hybrid) mission mode. Pure data — no DOM, no Pixi.
//
// Grid: every entity snaps to a G×G cell so movement is deterministic
// and pixel-art aligned. Velocities are expressed in grid cells per
// step; intervals control how often each step fires.

export const GRID = 10;

// Arena (logical pixels — the scene scales this into the viewport).
export const ARENA_W = 800;
export const ARENA_H = 600;

// ── Paddle ────────────────────────────────────────────────────────────
export const PADDLE_WIDTH = 100;
export const PADDLE_HEIGHT = GRID;
export const PADDLE_WIDE_MULTIPLIER = 2;
export const PADDLE_STEP_MS = 16;

// ── Ball ──────────────────────────────────────────────────────────────
export const BALL_SIZE = GRID;
export const BALL_STEP_MS = 80;
export const BALL_LOST_DAMAGE = 25;

// ── Invaders ──────────────────────────────────────────────────────────
export const INVADER_ROWS = 4;
export const INVADER_COLS = 8;
export const INVADER_CELL = GRID;
export const INVADER_MOVE_MS = 1100;
export const INVADER_DROP_CELLS = 3;
export const INVADER_SHOOT_MS = 200;
export const INVADER_SHOOT_CHANCE = 0.072;

// Pixel-art patterns per invader type (3 rows × 4 cols).
// 1 = filled pixel, 0 = empty.
export const INVADER_PATTERNS = Object.freeze([
    // Squid
    Object.freeze([
        Object.freeze([0, 0, 0, 0]),
        Object.freeze([1, 0, 0, 1]),
        Object.freeze([0, 1, 1, 0]),
    ]),
    // Crab
    Object.freeze([
        Object.freeze([1, 0, 0, 1]),
        Object.freeze([0, 1, 1, 0]),
        Object.freeze([1, 0, 0, 1]),
    ]),
    // Octopus
    Object.freeze([
        Object.freeze([1, 1, 1, 1]),
        Object.freeze([0, 1, 1, 0]),
        Object.freeze([1, 0, 0, 1]),
    ]),
]);

export const INVADER_PATTERN_ROWS = 3;
export const INVADER_PATTERN_COLS = 4;

// ── Boss ──────────────────────────────────────────────────────────────
export const BOSS_PIXEL_HP = 3;
export const BOSS_STEP_MS = 600;
export const BOSS_STEP_CELLS = 2;
export const BOSS_SHOOT_MS = 1800;

export const BOSS_PIXEL_OFFSETS = Object.freeze([
    Object.freeze({ x: 10, y: 10 }),
    Object.freeze({ x: 20, y: 10 }),
]);

// ── Towers ────────────────────────────────────────────────────────────
export const MAX_TOWERS = 8;
export const TOWER_SHOOT_MS = 900;
export const TOWER_BULLET_SPEED = -2;

// ── Bullets ───────────────────────────────────────────────────────────
export const BULLET_STEP_MS = 40;
export const INVADER_BULLET_SPEED = 1;
export const BOSS_BULLET_SPEED = 1;
export const ENEMY_BULLET_DAMAGE = 10;

// ── Laser power-up ───────────────────────────────────────────────────
export const LASER_COOLDOWN_MS = 120;
export const LASER_DURATION_MS = 10_000;
export const LASER_BULLET_SPEED = -2;

// ── Wide paddle power-up ─────────────────────────────────────────────
export const WIDE_DURATION_MS = 12_000;

// ── Power-ups / bonus drops ──────────────────────────────────────────
export const POWER_UP_TYPES = Object.freeze(['MULTI', 'WIDE', 'LASER', 'LIFE', 'TOWER']);
export const BONUS_DROP_INTERVAL = 10;
export const BONUS_STEP_MS = 120;
export const MAX_BALLS = 5;
export const LIFE_RESTORE = 25;

// ── Scoring ──────────────────────────────────────────────────────────
export const SCORE_PIXEL_BULLET = 10;
export const SCORE_PIXEL_BALL = 5;
export const BOSS_BONUS_DROP_COUNT = 5;

// ── Collision ────────────────────────────────────────────────────────
export const HIT_RADIUS = 9;
export const BALL_BROAD_PAD = 7;
export const BULLET_BROAD_PAD = 8;

// ── Player ───────────────────────────────────────────────────────────
export const PLAYER_MAX_HEALTH = 100;
