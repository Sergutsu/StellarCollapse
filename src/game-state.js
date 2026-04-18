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
import { getShapePool, rotateMatrix } from './shapes.js';
import {
    COLS as DEFAULT_COLS,
    ROWS as DEFAULT_ROWS,
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
        cols = DEFAULT_COLS,
        rows = DEFAULT_ROWS,
        rng = Math.random,
        schedule = immediateSchedule,
        mode = GAME_MODES.CLASSIC,
        complexity = PIECE_COMPLEXITY.MUTATED,
    } = {}) {
        super();
        this.cols = cols;
        this.rows = rows;
        this.rng = rng;
        // `schedule(fn, ms)` must call fn() at some point in the future
        // (or synchronously, in the immediate/test case). It doesn't need
        // to return a cancellation handle.
        this.schedule = schedule;
        this.mode = mode;
        this.complexity = complexity;

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
    }

    // Let the UI reconfigure mode/complexity between runs without
    // constructing a new state object. Safe to call only while gameOver.
    configure({ mode, complexity } = {}) {
        if (mode) this.mode = mode;
        if (complexity) this.complexity = complexity;
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
            x: Math.floor(this.cols / 2) - Math.floor(shape[0].length / 2),
            y: 0,
            shape,
            colorMatrix,
            type,
        };
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

    _collides(piece, dx = 0, dy = 0, shape = piece.shape) {
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) {
                if (!shape[y][x]) continue;
                const bx = piece.x + x + dx;
                const by = piece.y + y + dy;
                if (bx < 0 || bx >= this.cols || by >= this.rows) return true;
                if (by >= 0 && this.board[by] && this.board[by][bx]) return true;
            }
        }
        return false;
    }

    // Attempt to shift the active piece by (dx, dy). Returns a result
    // object describing what happened. If a downward move collides, the
    // piece is locked in place. Callers (view, input) react to events.
    move(dx, dy = 0) {
        if (!this.currentPiece || this.gameOver) return { moved: false, locked: false };
        const piece = this.currentPiece;
        const before = { x: piece.x, y: piece.y };
        piece.x += dx;
        piece.y += dy;
        if (this._collides(piece)) {
            piece.x = before.x;
            piece.y = before.y;
            if (dy > 0) {
                this._lockPiece();
                return { moved: false, locked: true };
            }
            return { moved: false, locked: false };
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

        const newShape = rotateMatrix(originalShape);
        const newColors = rotateMatrix(originalColors);

        piece.shape = newShape;
        piece.colorMatrix = newColors;

        if (!this._collides(piece)) {
            this.emit('piece-rotated', { piece });
            return { rotated: true };
        }

        // Wall-kick: try small horizontal offsets before giving up.
        for (let offset = 1; offset <= 2; offset++) {
            piece.x = originalX - offset;
            if (!this._collides(piece)) {
                this.emit('piece-rotated', { piece });
                return { rotated: true };
            }
            piece.x = originalX + offset;
            if (!this._collides(piece)) {
                this.emit('piece-rotated', { piece });
                return { rotated: true };
            }
            piece.x = originalX;
        }

        piece.shape = originalShape;
        piece.colorMatrix = originalColors;
        piece.x = originalX;
        return { rotated: false };
    }

    hardDrop() {
        if (!this.currentPiece || this.gameOver) return { cellsDropped: 0 };
        const piece = this.currentPiece;
        let cellsDropped = 0;
        while (!this._collides(piece, 0, 1)) {
            piece.y++;
            cellsDropped++;
        }
        this.emit('piece-hard-dropped', { piece, cellsDropped });
        this._lockPiece();
        return { cellsDropped };
    }

    // Advance the internal drop timer; callers pass elapsed ms each tick.
    // When the timer crosses the current drop interval, the piece drops
    // one cell (locking if it can't).
    tick(deltaMs) {
        if (this.gameOver || !this.currentPiece) return;
        this.dropCounter += deltaMs;
        if (this.dropCounter > this.dropInterval) {
            this.move(0, 1);
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
                if (by < 0) {
                    // Piece locked above the top row -> game over.
                    this._endGame('piece-above-top');
                    return;
                }
                const color = colors[y][x];
                this.board[by][bx] = color;
                lockedCells.push({ x: bx, y: by, color });
            }
        }
        this.emit('piece-locked', { cells: lockedCells });

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
    // cells and trigger the same clear path a manual click would. Each run
    // schedules its own animation/gravity via `schedule`, so chains play
    // out visually similarly to rapid manual matching.
    _autoMatchSweep() {
        const visited = new Set();
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const key = y * this.cols + x;
                if (visited.has(key)) continue;
                const color = this.board[y][x];
                if (!color || color === 'bomb' || color === 'snake') continue;
                const horizontal = this._findMatches(x, y, color, 1, 0);
                const vertical = this._findMatches(x, y, color, 0, 1);
                let run = null;
                if (horizontal.length >= 4) run = horizontal;
                else if (vertical.length >= 4) run = vertical;
                if (!run) continue;
                for (let i = 0; i < run.length; i++) {
                    visited.add(run[i].y * this.cols + run[i].x);
                }
                // Trigger through the normal click path so all side effects
                // (scoring, special-block spawn, events, gravity) match.
                this.clickCell(run[0].x, run[0].y);
            }
        }
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
        for (let y = this.rows - 1; y >= 0; y--) {
            let complete = true;
            for (let x = 0; x < this.cols; x++) {
                if (!this.board[y][x]) {
                    complete = false;
                    break;
                }
            }
            if (!complete) continue;

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
            const points = LINE_POINTS[Math.min(linesCleared, LINE_POINTS.length - 1)] * this.level;
            this.score += points;
            this.lines += linesCleared;
            const newLevel = Math.floor(this.lines / LINES_PER_LEVEL) + 1;
            const leveledUp = newLevel > this.level;
            this.level = newLevel;
            this.dropInterval = Math.max(
                DROP_INTERVAL_MIN_MS,
                DROP_INTERVAL_START_MS - (this.level - 1) * DROP_INTERVAL_STEP_MS,
            );
            this.emit('lines-cleared', { count: linesCleared, points });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            if (leveledUp) this.emit('level-up', { level: this.level });
        }
        return linesCleared;
    }

    // Compact each column to the bottom in a single O(ROWS) pass, then
    // re-check for newly completed lines after the collapse.
    _applyGravity() {
        let movedAny = false;
        for (let x = 0; x < this.cols; x++) {
            let writeY = this.rows - 1;
            for (let readY = this.rows - 1; readY >= 0; readY--) {
                const v = this.board[readY][x];
                if (v) {
                    if (writeY !== readY) {
                        this.board[writeY][x] = v;
                        this.board[readY][x] = null;
                        movedAny = true;
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

        // Tetris mode: click-to-match is disabled entirely. Line clears are
        // the only scoring path. Special cells (bomb/snake) can't form
        // organically in this mode, but if they somehow exist we still
        // ignore them for consistency.
        if (this.mode === GAME_MODES.TETRIS) return { handled: false, kind: 'disabled' };

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
                this.board[m.y][m.x] = null;
            }
            if (special) {
                this.board[special.y][special.x] = special.type;
            }
            const points = matches.length * MATCH_POINTS * this.level;
            this.score += points;
            this.emit('match-cleared', { cells: matches, color, special, points });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            this.schedule(() => {
                if (this.gameOver) return;
                this._applyGravity();
            }, POST_CLEAR_GRAVITY_MS);
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
                this.board[c.y][c.x] = null;
            }
            const points = affected.length * BOMB_POINTS * this.level;
            this.score += points;
            this.emit('bomb-exploded', {
                center: { x: centerX, y: centerY },
                cells: affected,
                points,
            });
            this.emit('score-changed', { score: this.score, level: this.level, lines: this.lines });
            this.schedule(() => {
                if (this.gameOver) return;
                this._applyGravity();
            }, POST_BOMB_GRAVITY_MS);
        }, BOMB_EXPLODE_MS);
    }

    _activateSnake(startX, startY) {
        // Clear the snake piece immediately so it doesn't get recolored.
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

        this.schedule(() => {
            if (this.gameOver) return;
            this._applyGravity();
        }, POST_SNAKE_GRAVITY_MS);
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
        this.emit('game-over', { reason, score: this.score, level: this.level, lines: this.lines });
    }
}
