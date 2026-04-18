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
import {
    LINE_POINTS,
    GAME_MODES,
    PIECE_COMPLEXITY,
    FIELD_SIZES,
    DEFAULT_FIELD_SIZE_ID,
    resolveFieldSize,
    HIGHSCORE_TIERS,
    findTier,
    BLOCK_SIZE_FOR,
    BLOCK_SIZE,
    MIN_BLOCK_SIZE,
    MAX_BOARD_HEIGHT,
} from '../src/constants.js';
import { CLASSIC_SHAPES, MUTATED_SHAPES } from '../src/shapes.js';

// Most legacy assertions were written against the historical 10x20
// board. We pin that geometry for those tests by passing cols/rows
// explicitly -- the default field sizes (driven by complexity) are
// exercised in their own dedicated tests further down.
const COLS = 10;
const ROWS = 20;

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
        cols: COLS,
        rows: ROWS,
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

test('start() populates a fresh board at the configured size and spawns a piece', () => {
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

test('four full rows in one clear award LINE_POINTS[4]', () => {
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

test('blocks mode ignores clickCell; score stays at 0', () => {
    const state = makeState(23, {
        mode: GAME_MODES.BLOCKS,
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

test('auto-match dedupes overlapping runs (cross pattern scores unique cells once)', () => {
    const state = makeState(41, {
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.CLASSIC,
    });
    state.start();
    // Cross of red: horizontal 4-run on row 18 cols 0..3; vertical 4-run
    // on col 2 rows 16..19. Share cell (2, 18). 7 unique cells total.
    state.board[18][0] = 'red';
    state.board[18][1] = 'red';
    state.board[18][2] = 'red';
    state.board[18][3] = 'red';
    state.board[16][2] = 'red';
    state.board[17][2] = 'red';
    state.board[19][2] = 'red';
    const baseline = state.score;
    let matchEvent = null;
    state.on('match-cleared', (e) => { matchEvent = e; });
    // Lock an empty no-op piece to trigger the sweep.
    state.currentPiece = {
        x: 9, y: 0,
        shape: [[1]],
        colorMatrix: [['blue']],
        type: 0,
    };
    state._lockPiece();
    assert.ok(matchEvent, 'auto-match should emit match-cleared');
    assert.equal(matchEvent.cells.length, 7, 'cross has 7 unique cells');
    // 7 cells * 10 pts * level 1 = 70.
    assert.equal(state.score - baseline, 70);
});

test('auto-match does NOT game-over when match is in the spawn zone', () => {
    // Regression: the earlier implementation scheduled clears via setTimeout
    // and spawned the next piece synchronously, so a 4-run near the top
    // would still be on the board during the spawn-collision check.
    const realTimeoutState = new GameState({
        cols: COLS,
        rows: ROWS,
        rng: mulberry32(51),
        // Production-style scheduler: defers via setTimeout. If the sweep
        // still deferred anything, the spawn check would see the match-cells.
        schedule: (fn, ms) => setTimeout(fn, ms),
        mode: GAME_MODES.AUTO_MATCH,
        complexity: PIECE_COMPLEXITY.CLASSIC,
    });
    realTimeoutState.start();
    // Fill the spawn zone (rows 0-1) with a 4-run that auto-match will clear.
    realTimeoutState.board[0][3] = 'red';
    realTimeoutState.board[0][4] = 'red';
    realTimeoutState.board[0][5] = 'red';
    realTimeoutState.board[0][6] = 'red';
    realTimeoutState.currentPiece = {
        x: 0, y: ROWS - 1,
        shape: [[1]],
        colorMatrix: [['blue']],
        type: 0,
    };
    let gameOverReason = null;
    realTimeoutState.on('game-over', (e) => { gameOverReason = e; });
    realTimeoutState._lockPiece();
    assert.equal(gameOverReason, null, 'auto-match should clear before spawn');
    for (let x = 3; x <= 6; x++) {
        assert.equal(realTimeoutState.board[0][x], null, 'spawn zone cleared');
    }
});

test('classic mode does NOT auto-match on lock (manual click still required)', () => {
    const state = makeState(31, {
        mode: GAME_MODES.STELLAR,
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

test('COLLAPSED complexity: click-match leaves survivors floating (no gravity)', () => {
    const state = makeState(91, {
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
    });
    state.start();
    // 4-red run at bottom, blue floater 5 rows above col 0.
    state.board[ROWS - 1][0] = 'red';
    state.board[ROWS - 1][1] = 'red';
    state.board[ROWS - 1][2] = 'red';
    state.board[ROWS - 1][3] = 'red';
    state.board[ROWS - 6][0] = 'blue';
    let floatingChanged = 0;
    state.on('floating-changed', () => { floatingChanged++; });
    state.clickCell(0, ROWS - 1);
    // Reds cleared (one of the 4 slots becomes a snake in COLLAPSED).
    let redsRemaining = 0;
    for (let x = 0; x < 4; x++) if (state.board[ROWS - 1][x] === 'red') redsRemaining++;
    assert.equal(redsRemaining, 0, 'all red cells should be cleared');
    // Blue floater MUST still be at its original y: gravity skipped.
    assert.equal(state.board[ROWS - 6][0], 'blue', 'blue floater stays suspended');
    assert.equal(state.board[ROWS - 1][0], null, 'nothing fell into the gap');
    assert.ok(floatingChanged > 0, 'floating-changed should have been emitted');
});

test('COLLAPSED complexity: bomb explosion leaves survivors floating', () => {
    const state = makeState(93, {
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
    });
    state.start();
    // Bomb at (5, ROWS-3). Blue floater in same column 6 rows up.
    state.board[ROWS - 3][5] = 'bomb';
    state.board[ROWS - 9][5] = 'blue';
    state.clickCell(5, ROWS - 3);
    assert.equal(state.board[ROWS - 3][5], null, 'bomb cell consumed');
    assert.equal(state.board[ROWS - 9][5], 'blue', 'bomb blast does not drop floaters in COLLAPSED');
});

test('COLLAPSED complexity: snake run DOES unlock gravity (survivors drop)', () => {
    const state = makeState(97, {
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.COLLAPSED,
    });
    state.start();
    // Seed a snake cell to activate directly, plus a blue floater.
    state.board[ROWS - 1][4] = 'snake';
    state.board[ROWS - 10][0] = 'blue';
    state.clickCell(4, ROWS - 1);
    // Snake recolors everything, then gravity runs (sync scheduler). The
    // surviving block in column 0 should end up at the bottom of that
    // column -- snake unlocks the floating state.
    assert.equal(state.board[ROWS - 10][0], null, 'blue no longer at its original row');
    const bottom = state.board[ROWS - 1][0];
    assert.ok(bottom !== null, 'column 0 bottom should now hold the dropped block');
});

test('non-COLLAPSED complexity: matches still trigger gravity (no regression)', () => {
    const state = makeState(99, {
        mode: GAME_MODES.STELLAR,
        complexity: PIECE_COMPLEXITY.MUTATED,
    });
    state.start();
    state.board[ROWS - 1][0] = 'red';
    state.board[ROWS - 1][1] = 'red';
    state.board[ROWS - 1][2] = 'red';
    state.board[ROWS - 1][3] = 'red';
    state.board[ROWS - 6][0] = 'blue';
    state.clickCell(0, ROWS - 1);
    // MUTATED drops: the blue floater should settle at the bottom of col 0.
    assert.equal(state.board[ROWS - 6][0], null, 'blue should have fallen out of its row');
    assert.equal(state.board[ROWS - 1][0], 'blue', 'blue dropped to the floor');
});

test('default mode is STELLAR when none is supplied', () => {
    const state = makeState(101);
    assert.equal(state.mode, GAME_MODES.STELLAR);
    assert.equal(GAME_MODES.STELLAR, 'stellar');
});

// ---------------------------------------------------------------------------
// Mode rename (Tetris -> Blocks) for copyright compliance.
// ---------------------------------------------------------------------------

test('GAME_MODES exposes BLOCKS (renamed from TETRIS) and no longer exposes TETRIS', () => {
    assert.equal(GAME_MODES.BLOCKS, 'blocks');
    assert.equal(GAME_MODES.TETRIS, undefined, 'TETRIS alias must be removed for copyright safety');
});

test('leaderboard tier ids use blocks-* (no tetris-* ids remain)', () => {
    const ids = HIGHSCORE_TIERS.map((t) => t.id);
    assert.ok(ids.includes('blocks-mutated'), 'blocks-mutated tier id missing');
    assert.ok(ids.includes('blocks-collapsed'), 'blocks-collapsed tier id missing');
    for (const id of ids) {
        assert.ok(!/tetris/i.test(id), `tier id should not contain "tetris": ${id}`);
    }
    for (const t of HIGHSCORE_TIERS) {
        assert.ok(!/tetris/i.test(t.label), `tier label should not contain "Tetris": ${t.label}`);
    }
});

test('findTier maps BLOCKS mode to the correct blocks-* tier ids', () => {
    const mutated = findTier(GAME_MODES.BLOCKS, PIECE_COMPLEXITY.MUTATED);
    const collapsed = findTier(GAME_MODES.BLOCKS, PIECE_COMPLEXITY.COLLAPSED);
    assert.equal(mutated && mutated.id, 'blocks-mutated');
    assert.equal(collapsed && collapsed.id, 'blocks-collapsed');
});

// ---------------------------------------------------------------------------
// Field sizes (3 per complexity; none use the original 10x20 grid).
// ---------------------------------------------------------------------------

test('FIELD_SIZES exposes 3 sizes per complexity and none of them are 10x20', () => {
    for (const complexity of Object.values(PIECE_COMPLEXITY)) {
        const sizes = FIELD_SIZES[complexity];
        assert.ok(Array.isArray(sizes), `sizes missing for ${complexity}`);
        assert.equal(sizes.length, 3, `expected 3 sizes for ${complexity}`);
        const ids = sizes.map((s) => s.id);
        assert.deepEqual(ids, ['small', 'medium', 'large']);
        for (const s of sizes) {
            assert.ok(s.cols > 0 && s.rows > 0, 'sizes must be positive');
            assert.ok(!(s.cols === 10 && s.rows === 20), `10x20 is forbidden (got ${s.cols}x${s.rows} for ${complexity})`);
        }
    }
});

test('resolveFieldSize returns the medium entry when given an unknown size id', () => {
    const r = resolveFieldSize(PIECE_COMPLEXITY.CLASSIC, 'does-not-exist');
    assert.equal(r.id, DEFAULT_FIELD_SIZE_ID);
    // Medium classic is 9x18 per FIELD_SIZES; assert from the table
    // instead of hard-coding numbers so this stays in sync.
    const medium = FIELD_SIZES[PIECE_COMPLEXITY.CLASSIC].find((s) => s.id === 'medium');
    assert.equal(r.cols, medium.cols);
    assert.equal(r.rows, medium.rows);
});

test('GameState constructor resolves cols/rows from (complexity, fieldSizeId)', () => {
    const state = new GameState({
        rng: mulberry32(1),
        schedule: (fn) => fn(),
        complexity: PIECE_COMPLEXITY.COLLAPSED,
        fieldSizeId: 'large',
    });
    const expected = resolveFieldSize(PIECE_COMPLEXITY.COLLAPSED, 'large');
    assert.equal(state.cols, expected.cols);
    assert.equal(state.rows, expected.rows);
    assert.equal(state.board.length, expected.rows);
    assert.equal(state.board[0].length, expected.cols);
});

test('configure() rebuilds the board for the new field size', () => {
    const state = new GameState({
        rng: mulberry32(2),
        schedule: (fn) => fn(),
        complexity: PIECE_COMPLEXITY.CLASSIC,
        fieldSizeId: 'small',
    });
    const smallExpected = resolveFieldSize(PIECE_COMPLEXITY.CLASSIC, 'small');
    assert.equal(state.cols, smallExpected.cols);
    state.configure({ complexity: PIECE_COMPLEXITY.MUTATED, fieldSizeId: 'large' });
    const largeExpected = resolveFieldSize(PIECE_COMPLEXITY.MUTATED, 'large');
    assert.equal(state.cols, largeExpected.cols);
    assert.equal(state.rows, largeExpected.rows);
    assert.equal(state.board.length, largeExpected.rows);
    assert.equal(state.board[0].length, largeExpected.cols);
});

test('BLOCK_SIZE_FOR keeps the board within MAX_BOARD_HEIGHT and clamps to MIN_BLOCK_SIZE', () => {
    // Short grid -> full-size blocks.
    assert.equal(BLOCK_SIZE_FOR(10), BLOCK_SIZE);
    // Tall grids shrink but never go below MIN_BLOCK_SIZE.
    const tall = BLOCK_SIZE_FOR(28);
    assert.ok(tall <= BLOCK_SIZE);
    assert.ok(tall >= MIN_BLOCK_SIZE);
    assert.ok(28 * tall <= MAX_BOARD_HEIGHT, `${28 * tall} should fit under ${MAX_BOARD_HEIGHT}`);
    // Absurdly tall grid bottoms out at the floor, not below.
    assert.equal(BLOCK_SIZE_FOR(1000), MIN_BLOCK_SIZE);
});

function sameMatrix(a, b) {
    if (a.length !== b.length) return false;
    for (let y = 0; y < a.length; y++) {
        if (a[y].length !== b[y].length) return false;
        for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) return false;
    }
    return true;
}
