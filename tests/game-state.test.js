// Unit tests for GameState.
// Run with `node --test tests/` from the repo root. No DOM, no browser.
//
// The tests use:
//   - A seeded RNG (`mulberry32`) so piece spawns and snake recolors are
//     deterministic.
//   - A synchronous scheduler so all deferred callbacks (match-clear, bomb
//     explode, gravity recheck) run inline — we can assert on end-state
//     without waiting for real timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GameState } from '../src/game-state.js';
import { COLS, ROWS, LINE_POINTS, GAME_MODES, PIECE_COMPLEXITY } from '../src/constants.js';
import { CLASSIC_SHAPES, MUTATED_SHAPES } from '../src/shapes.js';

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rand() {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeState(seed = 1, opts = {}) {
    return new GameState({
        rng: mulberry32(seed),
        schedule: (fn) => fn(),
        ...opts,
    });
}

function fillBoard(state, layout) {
    // layout: array of strings (bottom to top), each char a color code or '.'
    // Codes: r=red b=blue g=green y=yellow B=bomb S=snake .=empty
    const codeMap = { r: 'red', b: 'blue', g: 'green', y: 'yellow', B: 'bomb', S: 'snake' };
    // Clear first.
    for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) state.board[y][x] = null;
    }
    for (let i = 0; i < layout.length; i++) {
        const row = layout[layout.length - 1 - i];
        const y = state.rows - 1 - i;
        for (let x = 0; x < row.length && x < state.cols; x++) {
            const c = row[x];
            if (c !== '.') state.board[y][x] = codeMap[c];
        }
    }
}

test('start() populates a fresh 20x10 board and spawns a piece', () => {
    const state = makeState(42);
    state.start();
    assert.equal(state.board.length, ROWS);
    assert.equal(state.board[0].length, COLS);
    assert.equal(state.gameOver, false);
    assert.ok(state.currentPiece, 'currentPiece should exist');
    assert.equal(state.pieceQueue.length, 5, 'queue should hold the 5 upcoming pieces');
    assert.equal(state.score, 0);
    assert.equal(state.level, 1);
    assert.equal(state.lines, 0);
});

test('move(-1,0) shifts the piece left when unobstructed', () => {
    const state = makeState(1);
    state.start();
    const x0 = state.currentPiece.x;
    const result = state.move(-1, 0);
    assert.equal(result.moved, true);
    assert.equal(state.currentPiece.x, x0 - 1);
});

test('move off the left wall is rejected', () => {
    const state = makeState(1);
    state.start();
    // Push hard to the left.
    for (let i = 0; i < 20; i++) state.move(-1, 0);
    const x0 = state.currentPiece.x;
    const result = state.move(-1, 0);
    assert.equal(result.moved, false);
    assert.equal(state.currentPiece.x, x0);
});

test('rotate changes orientation for non-symmetric pieces', () => {
    const state = makeState(5);
    state.start();
    const before = state.currentPiece.shape.map((r) => r.slice());
    state.rotate();
    // Either rotation succeeded (different shape) or was rejected (same
    // shape). For at least one of the first few pieces we should hit a
    // successful rotation, so try a few seeds.
    let saw = !sameMatrix(before, state.currentPiece.shape);
    for (let seed = 2; seed < 20 && !saw; seed++) {
        const s = makeState(seed);
        s.start();
        const b = s.currentPiece.shape.map((r) => r.slice());
        s.rotate();
        saw = !sameMatrix(b, s.currentPiece.shape);
    }
    assert.ok(saw, 'at least one piece should have rotated successfully');
});

test('hardDrop locks piece at the bottom and spawns next', () => {
    const state = makeState(7);
    state.start();
    const firstType = state.currentPiece.type;
    let locked = false;
    state.on('piece-locked', () => { locked = true; });
    state.hardDrop();
    assert.equal(locked, true, 'piece-locked should fire');
    // The new current piece should be different (or at least a distinct
    // object) — new spawn.
    assert.ok(state.currentPiece !== null);
    // Check that some cells in the lower rows are filled.
    let filled = 0;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (state.board[y][x]) filled++;
    }
    assert.ok(filled > 0, `expected some locked cells after hard drop (firstType=${firstType})`);
});

test('checkLines clears a full bottom row and awards LINE_POINTS[1] * level', () => {
    const state = makeState(3);
    state.start();
    // Build a full bottom row manually.
    for (let x = 0; x < COLS; x++) state.board[ROWS - 1][x] = 'red';
    // Also put one block above so gravity pulls it down to row 19.
    state.board[ROWS - 3][3] = 'blue';
    const scoreBefore = state.score;
    state._checkLines();
    assert.equal(state.lines, 1);
    assert.equal(state.score - scoreBefore, LINE_POINTS[1] * 1);
    // The block that was above should still be present somewhere.
    let foundBlue = false;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (state.board[y][x] === 'blue') foundBlue = true;
    }
    assert.equal(foundBlue, true);
});

test('tetris (4 full rows) awards LINE_POINTS[4]', () => {
    const state = makeState(3);
    state.start();
    for (let y = ROWS - 4; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) state.board[y][x] = 'red';
    }
    const scoreBefore = state.score;
    state._checkLines();
    assert.equal(state.lines, 4);
    assert.equal(state.score - scoreBefore, LINE_POINTS[4] * 1);
});

test('applyGravity compacts floating columns', () => {
    const state = makeState(3);
    state.start();
    // Single floating block at y=5.
    state.board[5][0] = 'red';
    state._applyGravity();
    assert.equal(state.board[ROWS - 1][0], 'red');
    assert.equal(state.board[5][0], null);
});

test('clickCell on a 4-run triggers match-cleared, +40 score, snake spawn (collapsed)', () => {
    const state = makeState(9, { complexity: PIECE_COMPLEXITY.COLLAPSED });
    state.start();
    const baseline = { score: state.score, level: state.level };
    fillBoard(state, [
        'rrrr......', // bottom row: 4 red in cols 0..3
    ]);

    let cleared = null;
    state.on('match-cleared', (e) => { cleared = e; });

    const result = state.clickCell(1, ROWS - 1);
    assert.equal(result.handled, true);
    assert.equal(result.kind, 'match');
    assert.equal(result.matchLength, 4);
    assert.ok(cleared, 'match-cleared should fire');
    assert.equal(cleared.cells.length, 4);
    assert.equal(cleared.color, 'red');
    assert.ok(cleared.special, 'a snake should have spawned');
    assert.equal(cleared.special.type, 'snake');
    assert.equal(state.score - baseline.score, 4 * 10 * baseline.level);

    // All 4 original cells except the snake cell should be empty now.
    for (let x = 0; x < 4; x++) {
        const cellColor = state.board[ROWS - 1][x];
        if (x === cleared.special.x) assert.equal(cellColor, 'snake');
        else assert.equal(cellColor, null);
    }
});

test('clickCell on a 5-run spawns a bomb at the middle (collapsed)', () => {
    const state = makeState(11, { complexity: PIECE_COMPLEXITY.COLLAPSED });
    state.start();
    fillBoard(state, ['bbbbb.....']);
    let cleared = null;
    state.on('match-cleared', (e) => { cleared = e; });
    const result = state.clickCell(2, ROWS - 1);
    assert.equal(result.kind, 'match');
    assert.equal(result.matchLength, 5);
    assert.ok(cleared.special, 'a bomb should have spawned');
    assert.equal(cleared.special.type, 'bomb');
    // Bomb lands on one of the five cleared cells.
    assert.ok(cleared.special.x >= 0 && cleared.special.x <= 4);
    assert.equal(cleared.special.y, ROWS - 1);
    assert.equal(state.board[ROWS - 1][cleared.special.x], 'bomb');
});

test('clickCell on a 3-run does nothing', () => {
    const state = makeState(13);
    state.start();
    fillBoard(state, ['ggg.......']);
    const beforeScore = state.score;
    const result = state.clickCell(1, ROWS - 1);
    assert.equal(result.handled, false);
    assert.equal(state.score, beforeScore);
    assert.equal(state.board[ROWS - 1][0], 'green');
});

test('clickCell on a bomb explodes a 5x5 area', () => {
    const state = makeState(13, { complexity: PIECE_COMPLEXITY.COLLAPSED });
    state.start();
    // Put a bomb at (2, 18) surrounded by blocks; the board below/beside
    // it should all clear.
    fillBoard(state, [
        'rrrrrrrrrr',
        'rrrrrrrrrr',
        'rrBrrrrrrr',
        'rrrrrrrrrr',
        'rrrrrrrrrr',
    ]);
    const result = state.clickCell(2, ROWS - 3);
    assert.equal(result.kind, 'bomb');
    // All 5x5 around (2, 17) should now be empty — but gravity will have
    // pulled remaining pieces down, so we just count the missing-cell
    // delta.
    let filled = 0;
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) if (state.board[y][x]) filled++;
    }
    // 5 rows x 10 cols = 50 cells. Bomb cleared 5x5 = 25. Leaves 25.
    assert.equal(filled, 25);
});

test('clickCell on vertical 4-run works too', () => {
    const state = makeState(21);
    state.start();
    // Build a vertical 4-run of yellow in column 3.
    for (let y = ROWS - 4; y < ROWS; y++) state.board[y][3] = 'yellow';
    let cleared = null;
    state.on('match-cleared', (e) => { cleared = e; });
    const result = state.clickCell(3, ROWS - 2);
    assert.equal(result.kind, 'match');
    assert.equal(cleared.cells.length, 4);
});

test('level advances every 10 lines cleared', () => {
    const state = makeState(2);
    state.start();
    // Clear 10 single rows by forcing full-row board writes.
    for (let i = 0; i < 10; i++) {
        for (let x = 0; x < COLS; x++) state.board[ROWS - 1][x] = 'red';
        state._checkLines();
    }
    assert.equal(state.lines, 10);
    assert.equal(state.level, 2);
});

test('game-over fires when a newly spawned piece immediately collides', () => {
    const state = makeState(4);
    state.start();
    let ended = null;
    state.on('game-over', (e) => { ended = e; });
    // Fill the board except the bottom row so the piece lands on row 1
    // and the next spawn collides.
    for (let y = 0; y < ROWS - 1; y++) {
        for (let x = 0; x < COLS; x++) state.board[y][x] = 'red';
    }
    // Trigger lock; the top-row check fires game-over.
    state.hardDrop();
    assert.ok(ended, 'game-over should have fired');
    assert.equal(state.gameOver, true);
});

test('endGameEarly fires game-over once and clears currentPiece', () => {
    const state = makeState(5);
    state.start();
    let count = 0;
    state.on('game-over', () => { count++; });
    state.endGameEarly();
    state.endGameEarly();
    assert.equal(count, 1);
    assert.equal(state.currentPiece, null);
});

// ---------------------------------------------------------------------------
// Mode + complexity tests (added with the gameplay-mode feature).
// ---------------------------------------------------------------------------

test('mutated complexity does NOT spawn snake on a 4-match', () => {
    const state = makeState(17, { complexity: PIECE_COMPLEXITY.MUTATED });
    state.start();
    fillBoard(state, ['rrrr......']);
    let cleared = null;
    state.on('match-cleared', (e) => { cleared = e; });
    const result = state.clickCell(1, ROWS - 1);
    assert.equal(result.kind, 'match');
    assert.equal(result.matchLength, 4);
    assert.equal(cleared.special, null, 'no snake in non-collapsed complexity');
    for (let x = 0; x < 4; x++) {
        assert.equal(state.board[ROWS - 1][x], null);
    }
});

test('mutated complexity does NOT spawn bomb on a 5-match', () => {
    const state = makeState(19, { complexity: PIECE_COMPLEXITY.MUTATED });
    state.start();
    fillBoard(state, ['bbbbb.....']);
    let cleared = null;
    state.on('match-cleared', (e) => { cleared = e; });
    const result = state.clickCell(2, ROWS - 1);
    assert.equal(result.kind, 'match');
    assert.equal(result.matchLength, 5);
    assert.equal(cleared.special, null, 'no bomb in non-collapsed complexity');
});

test('tetris mode ignores clickCell; score stays at 0', () => {
    const state = makeState(23, {
        mode: GAME_MODES.TETRIS,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
    });
    state.start();
    fillBoard(state, ['rrrr......']);
    const before = state.score;
    const result = state.clickCell(1, ROWS - 1);
    assert.equal(result.handled, false);
    assert.equal(result.kind, 'disabled');
    assert.equal(state.score, before);
    // Cells are untouched -- no auto clearing from a click.
    for (let x = 0; x < 4; x++) assert.equal(state.board[ROWS - 1][x], 'red');
});

test('auto-match mode auto-clears a 4+ run created by a locking piece', () => {
    const state = makeState(29, {
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.CLASSIC,
    });
    state.start();
    // Prefill the bottom row with three reds so that when a fourth-column
    // red cell is locked in, auto-match should clear the full 4-run. We do
    // this by directly placing a piece via _lockPiece mechanics:
    state.board[ROWS - 1][0] = 'red';
    state.board[ROWS - 1][1] = 'red';
    state.board[ROWS - 1][2] = 'red';
    // Stand up a fake 1x1 red piece at (3, ROWS-1) and lock it.
    state.currentPiece = {
        x: 3,
        y: ROWS - 1,
        shape: [[1]],
        colorMatrix: [['red']],
        type: 0,
    };
    const baseline = state.score;
    state._lockPiece();
    // After lock, the 4-run should have been auto-cleared and the bottom
    // row should be empty. Score should have gained at least the 4-match
    // reward (40 * level 1).
    let filled = 0;
    for (let x = 0; x < COLS; x++) if (state.board[ROWS - 1][x]) filled++;
    assert.equal(filled, 0, 'auto-match should clear the run on lock');
    assert.ok(state.score - baseline >= 40, `score should grow by >=40 (got ${state.score - baseline})`);
});

test('classic mode does NOT auto-match on lock (manual click still required)', () => {
    const state = makeState(31, {
        mode: GAME_MODES.CLASSIC,
        complexity: PIECE_COMPLEXITY.CLASSIC,
    });
    state.start();
    state.board[ROWS - 1][0] = 'red';
    state.board[ROWS - 1][1] = 'red';
    state.board[ROWS - 1][2] = 'red';
    state.currentPiece = {
        x: 3,
        y: ROWS - 1,
        shape: [[1]],
        colorMatrix: [['red']],
        type: 0,
    };
    const baseline = state.score;
    state._lockPiece();
    // Classic mode: run stays on the board until the player clicks it.
    let filled = 0;
    for (let x = 0; x < 4; x++) if (state.board[ROWS - 1][x] === 'red') filled++;
    assert.equal(filled, 4);
    assert.equal(state.score, baseline);
});

test('classic-complexity pieces are monochrome and drawn from the 7-tetromino pool', () => {
    const state = makeState(37, { complexity: PIECE_COMPLEXITY.CLASSIC });
    state.start();
    for (let i = 0; i < 30; i++) {
        const piece = state.currentPiece;
        assert.ok(piece.type < CLASSIC_SHAPES.length,
            `piece.type ${piece.type} should index into classic pool`);
        let color = null;
        for (let y = 0; y < piece.colorMatrix.length; y++) {
            for (let x = 0; x < piece.colorMatrix[y].length; x++) {
                const c = piece.colorMatrix[y][x];
                if (!c) continue;
                assert.notEqual(c, 'bomb', 'classic pieces never contain bombs');
                if (color === null) color = c;
                else assert.equal(c, color, 'classic piece should be monochrome');
            }
        }
        state.hardDrop();
        if (state.gameOver) break;
    }
});

test('mutated-complexity pieces can draw from the full 15-shape pool', () => {
    // With enough spawns a mutated state should see at least one shape
    // that isn't in the classic 7-piece pool. Iterate until we either
    // confirm it or exhaust a sensible budget.
    const state = makeState(43, { complexity: PIECE_COMPLEXITY.MUTATED });
    state.start();
    let sawMutatedOnly = false;
    for (let i = 0; i < 80 && !state.gameOver; i++) {
        const type = state.currentPiece.type;
        assert.ok(type < MUTATED_SHAPES.length);
        if (type >= CLASSIC_SHAPES.length) { sawMutatedOnly = true; break; }
        state.hardDrop();
    }
    assert.ok(sawMutatedOnly, 'expected at least one mutated-only shape across 80 spawns');
});

function sameMatrix(a, b) {
    if (a.length !== b.length) return false;
    for (let y = 0; y < a.length; y++) {
        if (a[y].length !== b[y].length) return false;
        for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) return false;
    }
    return true;
}
