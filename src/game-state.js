// Pure game logic. No DOM, no audio, no timers hard-coded.
//
// GameState is intentionally decoupled from the browser so it can be
// exercised under `node --test`. Anything that would otherwise read from
// the DOM or a global clock (RNG, deferred side effects) is taken as a
// constructor dependency.
//
// Lifecycle: consumers construct a GameState, attach listeners via
// `state.on('event', handler)`, then call `start()` and drive the game
// with `move`, `rotate`, `hardDrop`, `clickCell`, and `tick`.

import { Emitter } from './emitter.js';
import { getShapePool, rotateMatrix, getMineralName } from './shapes.js';
import {
    NORMAL_COLORS,
    LINE_POINTS,
    MATCH_POINTS,
    BOMB_POINTS,
    DROP_INTERVAL_START_MS,
    DROP_INTERVAL_MIN_MS,
    DROP_INTERVAL_STEP_MS,
    LINES_PER_LEVEL,
    PIECE_QUEUE_SIZE,
    BOMB_RADIUS,
    SNAKE_LENGTH,
    SNAKE_TOTAL_MS,
    SNAKE_MIN_STEP_MS,
    GAME_MODES,
    PIECE_COMPLEXITY,
    COLLAPSED_BOMB_CHANCE,
    SPECIAL_ARM_MS,
    MINER_COLLAPSE_SIZE,
    MINER_CELL_POINTS,
    MINER_SPAWN_JITTER,
    resolveFieldSizeForMode,
    DEFAULT_FIELD_SIZE_ID,
    getSizeMultiplier,
} from './constants.js';

// Animation timing for match removal / gravity. These are part of the
// state machine (not the renderer) because gravity must not run until the
// match-clear animation finishes. Tests pass an immediate scheduler and
// the delays collapse to zero.
const MATCH_CLEAR_MS = 300;
const POST_CLEAR_GRAVITY_MS = 100;
const POST_GRAVITY_CHECK_LINES_MS = 150;
const BOMB_EXPLODE_MS = 500;
const POST_BOMB_GRAVITY_MS = 100;
const POST_SNAKE_GRAVITY_MS = 500;

// Immediate scheduler: runs the callback synchronously. Useful for tests
// and as a default so calling code never crashes when no scheduler was
// provided.
function immediateSchedule(fn) {
    fn();
    return 0;
}

export class GameState extends Emitter {
    constructor({
        cols,
        rows,
        fieldSizeId = DEFAULT_FIELD_SIZE_ID,
        rng = Math.random,
        schedule = immediateSchedule,
        mode = GAME_MODES.STELLAR,
        complexity = PIECE_COMPLEXITY.MUTATED,
        specialArmMs = SPECIAL_ARM_MS,
    } = {}) {
        super();
        // Explicit cols/rows win (handy for unit tests that exercise
        // gravity on a hand-rolled small grid); otherwise the size comes
        // from the (complexity, fieldSizeId) lookup table.
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
            this.cols = cols;
            this.rows = rows;
            this.fieldSizeId = fieldSizeId;
        } else {
            const resolved = resolveFieldSizeForMode(mode, complexity, fieldSizeId);
            this.cols = resolved.cols;
            this.rows = resolved.rows;
            this.fieldSizeId = resolved.id;
        }
        // Per-size score multiplier. Pulled out of the size id so both
        // the HUD and the scoring paths can read the same number without
        // doing the lookup themselves. Kept in sync with fieldSizeId by
        // `configure()`.
        this.sizeMultiplier = getSizeMultiplier(this.fieldSizeId);
        this.rng = rng;
        // `schedule(fn, ms)` must call fn() at some point in the future
        // (or synchronously, in the immediate/test case). It doesn't need
        // to return a cancellation handle.
        this.schedule = schedule;
        this.mode = mode;
        this.complexity = complexity;
        this.specialArmMs = specialArmMs;

        this.board = this._emptyBoard();
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.dropCounter = 0;
        this.dropInterval = DROP_INTERVAL_START_MS;
        this.gameOver = true;
        this.currentPiece = null;
        this.nextPiece = null;
        this.pieceQueue = [];

        // COLLAPSED arming clock: each bomb / snake cell placed on the
        // board gets a timer that fires after `specialArmMs`. Keyed by
        // "x,y" so lookups on click / gravity / line-clear are O(1).
        // Each entry: { x, y, type, expired }. `expired` is a guard the
        // timer callback checks -- if the cell was consumed or removed
        // before the timer fires, the callback no-ops.
        this.specialTimers = new Map();
    }

    // Let the UI reconfigure mode/complexity/field-size between runs
    // without constructing a new state object. Safe to call only while
    // gameOver.
    configure({ mode, complexity, fieldSizeId } = {}) {
        if (mode) this.mode = mode;
        if (complexity) this.complexity = complexity;
        if (fieldSizeId) this.fieldSizeId = fieldSizeId;
        // Resolve grid size off whatever mode + complexity + size we now
        // have (Miner mode uses its own square table).
        const resolved = resolveFieldSizeForMode(this.mode, this.complexity, this.fieldSizeId);
        this.cols = resolved.cols;
        this.rows = resolved.rows;
        this.fieldSizeId = resolved.id;
        this.sizeMultiplier = getSizeMultiplier(this.fieldSizeId);
        this.board = this._emptyBoard();
        this._disarmAllSpecialTimers();
    }

    _emptyBoard() {
        const board = new Array(this.rows);
        for (let y = 0; y < this.rows; y++) {
            board[y] = new Array(this.cols).fill(null);
        }
        return board;
    }

    // Fresh game: clear board, reset score/level, refill piece queue, emit
    // the initial spawn so the view can draw the first piece.
    start() {
        this.board = this._emptyBoard();
        this._disarmAllSpecialTimers();
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.dropCounter = 0;
        this.dropInterval = DROP_INTERVAL_START_MS;
        this.gameOver = false;
        this.pieceQueue = [];
        for (let i = 0; i < PIECE_QUEUE_SIZE; i++) {
            this.pieceQueue.push(this._createPiece());
        }
        this.currentPiece = this._shiftPiece();
        this.nextPiece = this.pieceQueue[0] || null;
        this.emit('game-started', this._snapshot());
        this.emit('piece-spawned', { piece: this.currentPiece, queue: this.pieceQueue.slice() });
        this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
    }

    _snapshot() {
        return {
            cols: this.cols,
            rows: this.rows,
            score: this.score,
            level: this.level,
            lines: this.lines,
        };
    }

    // -------------------------------------------------------------------
    // Piece creation and queue management
    // -------------------------------------------------------------------

    _createPiece() {
        const pool = getShapePool(this.complexity);
        const type = Math.floor(this.rng() * pool.length);
        const shape = pool[type].map((row) => row.slice());
        const colorMatrix = [];
        // Classic complexity -> one color for the whole piece (keeps it
        // obviously tetromino-ish). Mutated/Collapsed -> per-cell color.
        const monochrome = this.complexity === PIECE_COMPLEXITY.CLASSIC;
        const pieceColor = monochrome
            ? NORMAL_COLORS[Math.floor(this.rng() * NORMAL_COLORS.length)]
            : null;
        const mayBomb = this.complexity === PIECE_COMPLEXITY.COLLAPSED;
        for (let y = 0; y < shape.length; y++) {
            colorMatrix[y] = [];
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) {
                    colorMatrix[y][x] = null;
                    continue;
                }
                if (mayBomb && this.rng() < COLLAPSED_BOMB_CHANCE) {
                    colorMatrix[y][x] = 'bomb';
                } else if (monochrome) {
                    colorMatrix[y][x] = pieceColor;
                } else {
                    colorMatrix[y][x] = NORMAL_COLORS[Math.floor(this.rng() * NORMAL_COLORS.length)];
                }
            }
        }
        return {
            ...this._spawnPosition(type, shape),
            shape,
            colorMatrix,
            type,
            mineral: getMineralName(type),
        };
    }

    // Miner mode: pieces are mineral formations falling inward from one of
    // the four edges. The entry side is rolled from the injected RNG and
    // the piece spawns flush INSIDE that edge (always visible, never
    // straddling the boundary -- a blocked lane is a clean spawn-collision
    // game over instead of a mid-entry lock outside the field).
    _spawnPosition(type, shape) {
        const w = shape[0].length;
        const h = shape.length;
        if (!this._isMiner()) {
            return {
                x: Math.floor(this.cols / 2) - Math.floor(w / 2),
                y: 0,
                dir: { dx: 0, dy: 1 },
                entered: true,
            };
        }
        const dirs = [
            { dx: 0, dy: 1 },   // falls down   -> enters from the top edge
            { dx: 0, dy: -1 },  // falls up     -> enters from the bottom edge
            { dx: 1, dy: 0 },   // falls right  -> enters from the left edge
            { dx: -1, dy: 0 },  // falls left   -> enters from the right edge
        ];
        const dir = dirs[Math.floor(this.rng() * dirs.length)];
        // Center the piece on the entry edge, then apply a small lateral
        // jitter so entry lanes aren't always dead-center.
        const jitter = Math.floor(this.rng() * (MINER_SPAWN_JITTER * 2 + 1)) - MINER_SPAWN_JITTER;
        let x;
        let y;
        if (dir.dy !== 0) {
            x = Math.max(0, Math.min(this.cols - w, Math.floor((this.cols - w) / 2) + jitter));
            y = dir.dy > 0 ? 0 : this.rows - h;
        } else {
            x = dir.dx > 0 ? 0 : this.cols - w;
            y = Math.max(0, Math.min(this.rows - h, Math.floor((this.rows - h) / 2) + jitter));
        }
        return { x, y, dir, entered: true };
    }

    _isMiner() {
        return this.mode === GAME_MODES.BLOCKS;
    }

    _shiftPiece() {
        const next = this.pieceQueue.shift();
        this.pieceQueue.push(this._createPiece());
        return next;
    }

    // Cells the active piece currently occupies on the board. Used by the
    // view to paint the active layer and by collision logic.
    getActiveCells() {
        const piece = this.currentPiece;
        if (!piece) return [];
        const cells = [];
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (!piece.shape[y][x]) continue;
                cells.push({
                    x: piece.x + x,
                    y: piece.y + y,
                    color: piece.colorMatrix[y][x],
                });
            }
        }
        return cells;
    }

    // -------------------------------------------------------------------
    // Movement and collision
    // -------------------------------------------------------------------

    // Which board edge a piece entered from (the only out-of-bounds area
    // it may legally occupy while still partially outside). Legacy modes
    // always enter from the top.
    _entrySide(piece) {
        const d = piece?.dir || { dx: 0, dy: 1 };
        if (d.dy > 0) return 'top';
        if (d.dy < 0) return 'bottom';
        if (d.dx > 0) return 'left';
        return 'right';
    }

    _collides(piece, dx = 0, dy = 0, shape = piece.shape) {
        const entry = this._isMiner() ? this._entrySide(piece) : 'top';
        // The entry-edge allowance expires once the piece has fully entered
        // the field -- otherwise it could drift back out through its own
        // entrance and lock outside the board.
        const mayUseEntry = this._isMiner() && !piece?.entered;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const bx = piece.x + x + dx;
                const by = piece.y + y + dy;
                const outside =
                    bx < 0 ? 'left'
                    : bx >= this.cols ? 'right'
                    : by < 0 ? 'top'
                    : by >= this.rows ? 'bottom'
                    : null;
                if (outside) {
                    // Out-of-bounds cells are legal only on the entry edge
                    // while the piece is still sliding in; every other wall
                    // (and the entry edge after full entry) is solid.
                    if (mayUseEntry && outside === entry) continue;
                    return true;
                }
                if (this.board[by][bx]) return true;
            }
        }
        return false;
    }

    // True when every filled cell of the piece sits inside the board.
    _fullyInside(piece) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (!piece.shape[y][x]) continue;
                const bx = piece.x + x;
                const by = piece.y + y;
                if (bx < 0 || bx >= this.cols || by < 0 || by >= this.rows) return false;
            }
        }
        return true;
    }

    // Attempt to shift the active piece by (dx, dy). Returns a result
    // object describing what happened. If a move along the fall axis
    // collides, the piece is locked in place. Callers (view, input)
    // react to events.
    move(dx, dy = 0) {
        if (!this.currentPiece || this.gameOver) return { moved: false, locked: false };
        const piece = this.currentPiece;
        const before = { x: piece.x, y: piece.y };
        piece.x += dx;
        piece.y += dy;
        if (this._collides(piece)) {
            piece.x = before.x;
            piece.y = before.y;
            // A blocked move along the fall axis locks the piece. In Miner
            // mode the fall axis follows the piece's entry direction.
            const fallStep = this._isMiner()
                ? (piece.dir || { dx: 0, dy: 1 })
                : { dx: 0, dy: 1 };
            if (dx === fallStep.dx && dy === fallStep.dy && (dx !== 0 || dy !== 0)) {
                this._lockPiece();
                return { moved: false, locked: true };
            }
            return { moved: false, locked: false };
        }
        // Miner pieces lose their entry-edge allowance the moment they are
        // fully inside the field.
        if (this._isMiner() && !piece.entered && this._fullyInside(piece)) {
            piece.entered = true;
        }
        this.emit('piece-moved', { piece, direction: { dx, dy } });
        return { moved: true, locked: false };
    }

    rotate() {
        if (!this.currentPiece || this.gameOver) return { rotated: false };
        const piece = this.currentPiece;
        const originalShape = piece.shape;
        const originalColors = piece.colorMatrix;
        const originalX = piece.x;
        const originalY = piece.y;

        const newShape = rotateMatrix(originalShape);
        const newColors = rotateMatrix(originalColors);

        piece.shape = newShape;
        piece.colorMatrix = newColors;

        if (!this._collides(piece)) {
            if (this._isMiner() && !piece.entered && this._fullyInside(piece)) {
                piece.entered = true;
            }
            this.emit('piece-rotated', { piece });
            return { rotated: true };
        }

        // Wall-kick: try small offsets along the lateral axis before
        // giving up. Legacy modes fall downward so the lateral axis is
        // horizontal; Miner pieces fall along their entry axis, so the
        // useful kick direction is whatever axis they slide along.
        const lateral = this._isMiner() && piece.dir && piece.dir.dx !== 0 ? 'y' : 'x';
        for (let offset = 1; offset <= 2; offset++) {
            piece[lateral] = (lateral === 'x' ? originalX : originalY) - offset;
            if (!this._collides(piece)) {
                this.emit('piece-rotated', { piece });
                return { rotated: true };
            }
            piece[lateral] = (lateral === 'x' ? originalX : originalY) + offset;
            if (!this._collides(piece)) {
                this.emit('piece-rotated', { piece });
                return { rotated: true };
            }
            piece[lateral] = lateral === 'x' ? originalX : originalY;
        }

        piece.shape = originalShape;
        piece.colorMatrix = originalColors;
        piece.x = originalX;
        piece.y = originalY;
        return { rotated: false };
    }

    // Advance one cell along the current fall axis without waiting for
    // the gravity timer. Locks the piece if the way is blocked.
    softDrop() {
        const step = this._fallStep();
        return this.move(step.dx, step.dy);
    }

    _fallStep() {
        if (this._isMiner() && this.currentPiece?.dir) {
            return this.currentPiece.dir;
        }
        return { dx: 0, dy: 1 };
    }

    hardDrop() {
        if (!this.currentPiece || this.gameOver) return { cellsDropped: 0 };
        const piece = this.currentPiece;
        const step = this._fallStep();
        let cellsDropped = 0;
        while (!this._collides(piece, step.dx, step.dy)) {
            piece.x += step.dx;
            piece.y += step.dy;
            cellsDropped++;
        }
        this.emit('piece-hard-dropped', { piece, cellsDropped });
        this._lockPiece();
        return { cellsDropped };
    }

    // Advance the internal drop timer; callers pass elapsed ms each tick.
    // When the timer crosses the current drop interval, the piece drops
    // one cell along its fall axis (locking if it can't).
    tick(deltaMs) {
        if (this.gameOver || !this.currentPiece) return;
        this.dropCounter += deltaMs;
        if (this.dropCounter > this.dropInterval) {
            const step = this._fallStep();
            this.move(step.dx, step.dy);
            this.dropCounter = 0;
        }
    }

    // -------------------------------------------------------------------
    // Locking, line clears, gravity
    // -------------------------------------------------------------------

    _lockPiece() {
        const piece = this.currentPiece;
        if (!piece) return;
        const lockedCells = [];
        const shape = piece.shape;
        const colors = piece.colorMatrix;
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const bx = piece.x + x;
                const by = piece.y + y;
                // Miner mode: locking any cell outside the field means an
                // entry edge is breached -> game over. Legacy modes only
                // treat "above the top row" as fatal.
                if (bx < 0 || bx >= this.cols || by < 0 || by >= this.rows) {
                    this._endGame(this._isMiner() ? 'core-breached' : 'piece-above-top');
                    return;
                }
                const color = colors[y][x];
                this.board[by][bx] = color;
                lockedCells.push({ x: bx, y: by, color });
                // Piece-injected bomb cells (COLLAPSED only) arm the
                // moment they become part of the board.
                if (color === 'bomb' || color === 'snake') {
                    this._armSpecial(bx, by, color);
                }
            }
        }
        this.emit('piece-locked', { cells: lockedCells });

        if (this._isMiner()) {
            // Core collapse replaces line clears. No gravity afterwards --
            // minerals stay suspended where they locked.
            this._checkCollapse();
            if (this.gameOver) return;
            this._spawnNextPiece();
            return;
        }

        if (this._isBoardFull()) {
            this._endGame('board-full');
            return;
        }
        if (this._areTopRowsBlocked(2)) {
            this._endGame('top-blocked');
            return;
        }

        const cleared = this._checkLines();
        if (cleared > 0) this._applyGravity();
        if (this.gameOver) return;
        if (this.mode === GAME_MODES.AUTO_MATCH) this._autoMatchSweep();
        this._spawnNextPiece();
    }

    // Auto-Match mode: after a piece locks, find every 4+ run of same-color
    // cells and clear them all in one synchronous pass. Clearing has to be
    // synchronous (rather than going through `clickCell`'s scheduled path)
    // because `_lockPiece` immediately spawns the next piece afterwards --
    // if the matched cells still linger, the spawn-collision check can
    // falsely trigger game-over on cells that should have been cleared.
    //
    // Doing it in one pass also sidesteps overlap bugs: a horizontal 4-run
    // and a vertical 4-run sharing a center cell get deduped into a single
    // set of unique cells, scored once, cleared once.
    _autoMatchSweep() {
        // 1. Collect every 4+ run on the board. Each run is independent at
        //    detection time -- cells are allowed to appear in multiple runs
        //    (e.g. the center of a cross) but we dedupe before clearing.
        const runs = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const color = this.board[y][x];
                if (!color || color === 'bomb' || color === 'snake') continue;
                // Only start a horizontal run from its leftmost cell, and a
                // vertical run from its topmost cell, so each run is
                // enumerated exactly once.
                if (x === 0 || this.board[y][x - 1] !== color) {
                    const horizontal = this._findMatches(x, y, color, 1, 0);
                    if (horizontal.length >= 4) runs.push({ cells: horizontal, color });
                }
                if (y === 0 || this.board[y - 1][x] !== color) {
                    const vertical = this._findMatches(x, y, color, 0, 1);
                    if (vertical.length >= 4) runs.push({ cells: vertical, color });
                }
            }
        }
        if (runs.length === 0) return;

        // 2. Union unique cells across all runs. Score is based on unique
        //    cells so a cross-pattern with 7 cells scores 7*MATCH_POINTS,
        //    not 4+4 = 8.
        const unique = new Map(); // key -> { x, y, color }
        for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            for (let j = 0; j < run.cells.length; j++) {
                const c = run.cells[j];
                unique.set(c.y * this.cols + c.x, { x: c.x, y: c.y, color: run.color });
            }
        }
        const cleared = Array.from(unique.values());

        // 3. In COLLAPSED complexity, the longest single run still seeds a
        //    snake (4-run) or bomb (5+ run) -- matches manual click behavior.
        let special = null;
        if (this.complexity === PIECE_COMPLEXITY.COLLAPSED) {
            let longest = runs[0];
            for (let i = 1; i < runs.length; i++) {
                if (runs[i].cells.length > longest.cells.length) longest = runs[i];
            }
            if (longest.cells.length >= 5) {
                const pos = longest.cells[Math.floor(longest.cells.length / 2)];
                special = { x: pos.x, y: pos.y, type: 'bomb' };
            } else if (longest.cells.length === 4) {
                const pos = longest.cells[Math.floor(this.rng() * longest.cells.length)];
                special = { x: pos.x, y: pos.y, type: 'snake' };
            }
        }

        // 4. Announce, clear synchronously, score once, then gravity.
        this.emit('match-detected', { cells: cleared, color: null, special });
        for (let i = 0; i < cleared.length; i++) {
            const c = cleared[i];
            // Disarm any timer sitting on a cell we're about to null out.
            // Matches rarely cover specials (the scanner skips bomb/snake
            // cells), but the defensive disarm keeps the map consistent.
            this._disarmSpecialAt(c.x, c.y);
            this.board[c.y][c.x] = null;
        }
        if (special) {
            this.board[special.y][special.x] = special.type;
            this._armSpecial(special.x, special.y, special.type);
        }
        const points = Math.round(cleared.length * MATCH_POINTS * this.level * this.sizeMultiplier);
        this.score += points;
        this.emit('match-cleared', { cells: cleared, color: null, special, points });
        this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
        // COLLAPSED gravity-gate: matches never trigger gravity -- the
        // survivors stay suspended until a snake runs across the board.
        if (this._gravityAllowedAfterMatch()) this._applyGravity();
        else this._emitFloatingChanged();
    }

    // Gravity gate: in COLLAPSED complexity, color-match and bomb clears
    // leave cells floating in place. Only snake runs (and line clears, which
    // are structurally row-based) can restore gravity. All other complexity
    // levels always drop.
    _gravityAllowedAfterMatch() {
        return this.complexity !== PIECE_COMPLEXITY.COLLAPSED;
    }

    // Tell the view the suspended-cells set may have changed so it can
    // repaint the floating overlay. Safe no-op when nothing is floating.
    _emitFloatingChanged() {
        this.emit('floating-changed', {});
    }

    // -------------------------------------------------------------------
    // Special-cell arming clock (COLLAPSED hardcore mode).
    //
    // When a bomb or snake cell appears on the board (from a match, an
    // auto-match sweep, or a piece that locks with an injected bomb cell),
    // we start a countdown. If the player doesn't consume it within
    // `specialArmMs`, it morphs into a random normal-color cell. The view
    // subscribes to `special-armed` / `special-expired` / `special-cleared`
    // to render the countdown overlay and the fade-to-normal transition.
    //
    // Storage: `this.specialTimers` is a Map keyed by "x,y" whose values
    // are `{ x, y, type, armedAt, expired }`. `expired` is flipped by
    // consumers (click, bomb blast, snake activation, line clear, game
    // over) so the deferred callback can no-op when it fires late.
    // -------------------------------------------------------------------

    _specialKey(x, y) {
        return `${x},${y}`;
    }

    _armSpecial(x, y, type) {
        // Disabled in non-COLLAPSED complexity: the mechanic only exists
        // in the hardest tier, so we never even track timers elsewhere.
        if (this.complexity !== PIECE_COMPLEXITY.COLLAPSED) return;
        if (this.specialArmMs <= 0) return;
        // Defensive: if a timer already lives at (x, y), disarm it first
        // so we don't leak callbacks.
        this._disarmSpecialAt(x, y);
        const entry = {
            x,
            y,
            type,
            armedAt: Date.now(),
            durationMs: this.specialArmMs,
            expired: false,
        };
        this.specialTimers.set(this._specialKey(x, y), entry);
        this.emit('special-armed', {
            x, y, type,
            durationMs: this.specialArmMs,
        });
        this.schedule(() => {
            // By the time this callback fires the cell may have been
            // consumed, cleared by a line, or displaced by gravity to a
            // different (x, y). Only fire the morph if the entry is still
            // the live one at its last known position.
            if (entry.expired) return;
            if (this.gameOver) return;
            const current = this.specialTimers.get(this._specialKey(entry.x, entry.y));
            if (current !== entry) return;
            if (this.board[entry.y][entry.x] !== entry.type) {
                // Board moved on without us noticing; just drop the entry.
                this.specialTimers.delete(this._specialKey(entry.x, entry.y));
                return;
            }
            this._expireSpecial(entry);
        }, this.specialArmMs);
    }

    _expireSpecial(entry) {
        entry.expired = true;
        const newColor = NORMAL_COLORS[Math.floor(this.rng() * NORMAL_COLORS.length)];
        this.board[entry.y][entry.x] = newColor;
        this.specialTimers.delete(this._specialKey(entry.x, entry.y));
        this.emit('special-expired', {
            x: entry.x,
            y: entry.y,
            type: entry.type,
            newColor,
        });
    }

    // Called when a special is consumed or forcibly cleared (click, bomb
    // blast, snake activation, line clear). Silences the pending morph
    // and lets the view clear its overlay.
    _disarmSpecialAt(x, y) {
        const key = this._specialKey(x, y);
        const entry = this.specialTimers.get(key);
        if (!entry) return;
        entry.expired = true;
        this.specialTimers.delete(key);
        this.emit('special-cleared', { x, y, type: entry.type });
    }

    _disarmAllSpecialTimers() {
        if (!this.specialTimers || this.specialTimers.size === 0) return;
        for (const entry of this.specialTimers.values()) entry.expired = true;
        this.specialTimers.clear();
        this.emit('special-cleared-all', {});
    }

    // Apply the effect of clearing row `clearedY` on the timer map:
    //  - timers at (_, clearedY) are disarmed (cells destroyed).
    //  - timers at (_, y') for y' < clearedY move to (_, y'+1).
    // Done before the board rows shift so lookups still hit the old keys.
    _shiftSpecialTimersOnLineClear(clearedY) {
        if (this.specialTimers.size === 0) return;
        // Disarm everything on the cleared row first. Collect keys to
        // avoid mutating the map during iteration.
        const toDisarm = [];
        const toShift = [];
        for (const [key, entry] of this.specialTimers) {
            if (entry.y === clearedY) toDisarm.push(entry);
            else if (entry.y < clearedY) toShift.push(entry);
        }
        for (const e of toDisarm) this._disarmSpecialAt(e.x, e.y);
        // Shift top-down so we never write into a key that still holds
        // an unshifted entry.
        toShift.sort((a, b) => b.y - a.y);
        for (const e of toShift) this._moveSpecialTimer(e.x, e.y, e.x, e.y + 1);
    }

    // Move a timer to follow its cell after gravity / line-shift. Same
    // column in practice (x doesn't change), but the helper takes
    // independent (fx, fy, tx, ty) to keep the callsites honest.
    _moveSpecialTimer(fx, fy, tx, ty) {
        const fromKey = this._specialKey(fx, fy);
        const entry = this.specialTimers.get(fromKey);
        if (!entry) return;
        this.specialTimers.delete(fromKey);
        entry.x = tx;
        entry.y = ty;
        this.specialTimers.set(this._specialKey(tx, ty), entry);
        this.emit('special-moved', {
            fromX: fx, fromY: fy,
            toX: tx, toY: ty,
            type: entry.type,
        });
    }

    _spawnNextPiece() {
        this.currentPiece = this._shiftPiece();
        this.nextPiece = this.pieceQueue[0] || null;
        if (this.currentPiece && this._collides(this.currentPiece)) {
            this._endGame('spawn-collision');
            return;
        }
        this.emit('piece-spawned', { piece: this.currentPiece, queue: this.pieceQueue.slice() });
    }

    _isBoardFull() {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (!this.board[y][x]) return false;
            }
        }
        return true;
    }

    _areTopRowsBlocked(howMany) {
        for (let y = 0; y < howMany; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (!this.board[y][x]) return false;
            }
        }
        return true;
    }

    _checkLines() {
        let linesCleared = 0;
        // Snapshot the colors on each cleared row *before* we shift
        // cells out from under it, so the `lines-cleared` payload can
        // report exactly which tiles were removed. RunLedger uses this
        // to tally ore for Blocks mode (where line clears are the only
        // scoring path); modes that rely on color-match clears never
        // reach this code with anything in the row anyway.
        const clearedColors = [];
        for (let y = this.rows - 1; y >= 0; y--) {
            let complete = true;
            for (let x = 0; x < this.cols; x++) {
                if (!this.board[y][x]) {
                    complete = false;
                    break;
                }
            }
            if (!complete) continue;

            for (let x = 0; x < this.cols; x++) {
                clearedColors.push(this.board[y][x]);
            }
            // Specials sitting on this complete row are destroyed; their
            // timers must go too. Specials above shift down by one along
            // with the cells they belong to, so their timer keys follow.
            this._shiftSpecialTimersOnLineClear(y);
            // Shift everything above `y` down by one row.
            for (let yy = y; yy > 0; yy--) {
                for (let x = 0; x < this.cols; x++) {
                    this.board[yy][x] = this.board[yy - 1][x];
                }
            }
            for (let x = 0; x < this.cols; x++) {
                this.board[0][x] = null;
            }
            linesCleared++;
            y++; // recheck this row index since contents shifted down
        }

        if (linesCleared > 0) {
            const basePoints = LINE_POINTS[Math.min(linesCleared, LINE_POINTS.length - 1)] * this.level;
            const points = Math.round(basePoints * this.sizeMultiplier);
            this.score += points;
            this.lines += linesCleared;
            const newLevel = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
            const leveledUp = newLevel > this.level;
            this.level = newLevel;
            this.dropInterval = Math.max(
                DROP_INTERVAL_MIN_MS,
                DROP_INTERVAL_START_MS - (this.level - 1) * DROP_INTERVAL_STEP_MS,
            );
            this.emit('lines-cleared', { count: linesCleared, points, colors: clearedColors });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            if (leveledUp) this.emit('level-up', { level: this.level });
        }
        return linesCleared;
    }

    // -------------------------------------------------------------------
    // Miner mode: center-core collapse
    //
    // The collapse condition replaces line clears. A collapse triggers
    // when the board contains a fully-filled square of side >=
    // MINER_COLLAPSE_SIZE whose area covers the board's center cell. The
    // largest such square collapses: every mineral in it is mined out,
    // scored, and counted as one "line" for level progression. Overlapping
    // qualifying squares chain within the same lock until none remain.
    // -------------------------------------------------------------------

    _checkCollapse() {
        let totalCells = 0;
        // Chained collapses are bounded by board area / MINER_COLLAPSE_SIZE^2;
        // the guard just makes termination obvious.
        let guard = 0;
        while (guard++ < 64) {
            const square = this._largestCenterSquare();
            if (!square) break;

            const cells = [];
            const colors = [];
            for (let y = square.y; y < square.y + square.size; y++) {
                for (let x = square.x; x < square.x + square.size; x++) {
                    colors.push(this.board[y][x]);
                    cells.push({ x, y, color: this.board[y][x] });
                    this._disarmSpecialAt(x, y);
                    this.board[y][x] = null;
                }
            }

            const points = Math.round(
                cells.length * MINER_CELL_POINTS * this.level * this.sizeMultiplier,
            );
            this.score += points;
            this.lines += 1;
            const newLevel = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
            const leveledUp = newLevel > this.level;
            this.level = newLevel;
            this.dropInterval = Math.max(
                DROP_INTERVAL_MIN_MS,
                DROP_INTERVAL_START_MS - (this.level - 1) * DROP_INTERVAL_STEP_MS,
            );

            totalCells += cells.length;
            // `collapse-cleared` carries the full geometry for view FX; the
            // legacy `lines-cleared` event keeps RunLedger ore tallies, the
            // audio hooks and HUD refreshes working without special cases.
            this.emit('collapse-cleared', {
                cells,
                colors,
                points,
                size: square.size,
                square,
            });
            this.emit('lines-cleared', { count: 1, points, colors });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            if (leveledUp) this.emit('level-up', { level: this.level });
        }
        return totalCells;
    }

    // Largest fully-occupied axis-aligned square that contains the board's
    // center cell. Scanned from the biggest possible size downwards so the
    // first hit is the largest; returns null when nothing >=
    // MINER_COLLAPSE_SIZE qualifies.
    _largestCenterSquare() {
        const cx = Math.floor(this.cols / 2);
        const cy = Math.floor(this.rows / 2);
        const maxSize = Math.min(this.cols, this.rows);
        for (let size = maxSize; size >= MINER_COLLAPSE_SIZE; size--) {
            // Top-left candidates whose s x s window still covers (cx, cy).
            const minX = Math.max(0, cx - size + 1);
            const maxX = Math.min(cx, this.cols - size);
            const minY = Math.max(0, cy - size + 1);
            const maxY = Math.min(cy, this.rows - size);
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    if (this._isSolidSquare(x, y, size)) {
                        return { x, y, size };
                    }
                }
            }
        }
        return null;
    }

    _isSolidSquare(x0, y0, size) {
        for (let y = y0; y < y0 + size; y++) {
            for (let x = x0; x < x0 + size; x++) {
                if (!this.board[y][x]) return false;
            }
        }
        return true;
    }

    // Compact each column to the bottom in a single O(ROWS) pass, then
    // re-check for newly completed lines after the collapse.
    _applyGravity() {
        let movedAny = false;
        // Gravity can shift a timer's cell downward; collect (from, to)
        // pairs so the timer map follows the cell, then commit them after
        // the column pass (committing mid-loop would race with our own
        // readY/writeY bookkeeping).
        const timerMoves = [];
        for (let x = 0; x < this.cols; x++) {
            let writeY = this.rows - 1;
            for (let readY = this.rows - 1; readY >= 0; readY--) {
                const v = this.board[readY][x];
                if (v) {
                    if (writeY !== readY) {
                        this.board[writeY][x] = v;
                        this.board[readY][x] = null;
                        movedAny = true;
                        if (v === 'bomb' || v === 'snake') {
                            timerMoves.push({ fx: x, fy: readY, tx: x, ty: writeY });
                        }
                    }
                    writeY--;
                }
            }
            for (let y = writeY; y >= 0; y--) {
                if (this.board[y][x]) {
                    this.board[y][x] = null;
                    movedAny = true;
                }
            }
        }
        for (let i = 0; i < timerMoves.length; i++) {
            const m = timerMoves[i];
            this._moveSpecialTimer(m.fx, m.fy, m.tx, m.ty);
        }
        this.emit('gravity-applied', { moved: movedAny });
        this.schedule(() => {
            if (this.gameOver) return;
            const extra = this._checkLines();
            if (extra > 0) this._applyGravity();
        }, POST_GRAVITY_CHECK_LINES_MS);
    }

    // -------------------------------------------------------------------
    // Click-to-match, bomb, snake
    // -------------------------------------------------------------------

    clickCell(x, y) {
        if (this.gameOver) return { handled: false };
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return { handled: false };
        const color = this.board[y][x];
        if (!color) return { handled: false };

        // Blocks mode: click-to-match is disabled entirely. Line clears are
        // the only scoring path. Special cells (bomb/snake) can't form
        // organically in this mode, but if they somehow exist we still
        // ignore them for consistency.
        if (this.mode === GAME_MODES.BLOCKS) return { handled: false, kind: 'disabled' };

        if (color === 'bomb') {
            this._explodeBomb(x, y);
            return { handled: true, kind: 'bomb' };
        }
        if (color === 'snake') {
            this._activateSnake(x, y);
            return { handled: true, kind: 'snake' };
        }

        const horizontal = this._findMatches(x, y, color, 1, 0);
        const vertical = this._findMatches(x, y, color, 0, 1);
        let matches = [];
        if (horizontal.length >= 4) matches = horizontal;
        else if (vertical.length >= 4) matches = vertical;
        if (matches.length < 4) return { handled: false };

        // Specials (snake on 4-match, bomb on 5+ match) are a COLLAPSED-
        // complexity mechanic. In classic/mutated complexities the match
        // just clears cleanly and rewards the base points -- no chaos.
        let special = null;
        if (this.complexity === PIECE_COMPLEXITY.COLLAPSED) {
            if (matches.length >= 5) {
                const pos = matches[Math.floor(matches.length / 2)];
                special = { x: pos.x, y: pos.y, type: 'bomb' };
            } else if (matches.length === 4) {
                const pos = matches[Math.floor(this.rng() * matches.length)];
                special = { x: pos.x, y: pos.y, type: 'snake' };
            }
        }

        this.emit('match-detected', { cells: matches, color, special });

        this.schedule(() => {
            if (this.gameOver) return;
            for (let i = 0; i < matches.length; i++) {
                const m = matches[i];
                this._disarmSpecialAt(m.x, m.y);
                this.board[m.y][m.x] = null;
            }
            if (special) {
                this.board[special.y][special.x] = special.type;
                this._armSpecial(special.x, special.y, special.type);
            }
            const points = Math.round(matches.length * MATCH_POINTS * this.level * this.sizeMultiplier);
            this.score += points;
            this.emit('match-cleared', { cells: matches, color, special, points });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            if (this._gravityAllowedAfterMatch()) {
                this.schedule(() => {
                    if (this.gameOver) return;
                    this._applyGravity();
                }, POST_CLEAR_GRAVITY_MS);
            } else {
                this._emitFloatingChanged();
            }
        }, MATCH_CLEAR_MS);

        return { handled: true, kind: 'match', matchLength: matches.length };
    }

    _findMatches(startX, startY, color, dx, dy) {
        const matches = [{ x: startX, y: startY }];
        let x = startX + dx;
        let y = startY + dy;
        while (x >= 0 && x < this.cols && y >= 0 && y < this.rows && this.board[y][x] === color) {
            matches.push({ x, y });
            x += dx;
            y += dy;
        }
        x = startX - dx;
        y = startY - dy;
        while (x >= 0 && x < this.cols && y >= 0 && y < this.rows && this.board[y][x] === color) {
            matches.push({ x, y });
            x -= dx;
            y -= dy;
        }
        return matches;
    }

    _explodeBomb(centerX, centerY) {
        // The bomb itself is about to detonate -- disarm its timer so the
        // morph-to-normal callback can't fire mid-blast.
        this._disarmSpecialAt(centerX, centerY);
        const affected = [];
        for (let dy = -BOMB_RADIUS; dy <= BOMB_RADIUS; dy++) {
            for (let dx = -BOMB_RADIUS; dx <= BOMB_RADIUS; dx++) {
                const ex = centerX + dx;
                const ey = centerY + dy;
                if (ex < 0 || ex >= this.cols || ey < 0 || ey >= this.rows) continue;
                if (this.board[ey][ex]) {
                    affected.push({ x: ex, y: ey, color: this.board[ey][ex] });
                }
            }
        }
        this.emit('bomb-detonating', { center: { x: centerX, y: centerY }, cells: affected });

        this.schedule(() => {
            if (this.gameOver) return;
            for (let i = 0; i < affected.length; i++) {
                const c = affected[i];
                // A chain-bomb blast can catch other armed specials in
                // its radius -- disarm them before the cells go null.
                this._disarmSpecialAt(c.x, c.y);
                this.board[c.y][c.x] = null;
            }
            const points = Math.round(affected.length * BOMB_POINTS * this.level * this.sizeMultiplier);
            this.score += points;
            this.emit('bomb-exploded', {
                center: { x: centerX, y: centerY },
                cells: affected,
                points,
            });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            if (this._gravityAllowedAfterMatch()) {
                this.schedule(() => {
                    if (this.gameOver) return;
                    this._applyGravity();
                }, POST_BOMB_GRAVITY_MS);
            } else {
                this._emitFloatingChanged();
            }
        }, BOMB_EXPLODE_MS);
    }

    _activateSnake(startX, startY) {
        // Consume the snake cell: disarm its timer and null the board.
        this._disarmSpecialAt(startX, startY);
        this.board[startY][startX] = null;

        const allBlocks = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const v = this.board[y][x];
                if (v && v !== 'snake' && v !== 'bomb') allBlocks.push({ x, y });
            }
        }
        // Fisher-Yates shuffle with injected RNG so tests are deterministic.
        for (let i = allBlocks.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [allBlocks[i], allBlocks[j]] = [allBlocks[j], allBlocks[i]];
        }

        // Pre-compute the recolor plan so the view gets the full trajectory
        // in one shot.
        const recolors = allBlocks.map((b) => ({
            x: b.x,
            y: b.y,
            color: NORMAL_COLORS[Math.floor(this.rng() * NORMAL_COLORS.length)],
        }));

        const entryEdges = [
            { x: -1, y: Math.floor(this.rng() * this.rows) },
            { x: this.cols, y: Math.floor(this.rng() * this.rows) },
            { x: Math.floor(this.rng() * this.cols), y: -1 },
            { x: Math.floor(this.rng() * this.cols), y: this.rows },
        ];
        const entry = entryEdges[Math.floor(this.rng() * entryEdges.length)];
        const stepInterval = Math.max(
            SNAKE_MIN_STEP_MS,
            SNAKE_TOTAL_MS / (allBlocks.length + SNAKE_LENGTH * 2),
        );

        // Snapshot board before recolors so the view can verify paint order.
        this.emit('snake-activated', {
            start: { x: startX, y: startY },
            entry,
            recolors,
            stepInterval,
            segments: SNAKE_LENGTH,
        });

        // Commit recolors to the board now; the view animates them visually
        // using the step schedule that was emitted. This keeps state pure
        // and avoids a race between view-driven timers and state reads.
        for (let i = 0; i < recolors.length; i++) {
            const r = recolors[i];
            this.board[r.y][r.x] = r.color;
        }

        // Gravity must wait for the view's snake walk to finish. The walk
        // paints one board cell per step, and if gravity runs mid-walk it
        // shifts those cells underneath the animation -- the view then
        // keeps writing colors to pre-gravity (x, y) positions, leaving
        // stale board cells that don't match state. The symptom is a
        // next-piece visibly dropping through cells that look filled
        // (but aren't) and snapping to a corrected board only on lock.
        //
        // Total walk = stepInterval * (recolors + trail segments). Add a
        // small buffer so the final segments finish rendering before the
        // board rearranges.
        const walkMs = stepInterval * (recolors.length + SNAKE_LENGTH);
        this.schedule(() => {
            if (this.gameOver) return;
            this._applyGravity();
        }, walkMs + POST_SNAKE_GRAVITY_MS);
    }

    // -------------------------------------------------------------------
    // Game over
    // -------------------------------------------------------------------

    endGameEarly() {
        this._endGame('user-exit');
    }

    _endGame(reason) {
        if (this.gameOver) return;
        this.gameOver = true;
        this.currentPiece = null;
        this._disarmAllSpecialTimers();
        this.emit('game-over', { reason, score: this.score, level: this.level, lines: this.lines });
    }
}
