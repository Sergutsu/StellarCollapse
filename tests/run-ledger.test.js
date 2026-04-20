import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';
import { RunLedger, computeCredits } from '../src/run-ledger.js';

// Minimal stub that mimics GameState's emitter surface -- RunLedger only
// cares about on/off/emit, nothing else. Using this keeps the test pure
// + fast (no GameState setup + scheduling + board).
function stubState() {
    const em = new Emitter();
    return {
        on:  (evt, fn) => em.on(evt, fn),
        off: (evt, fn) => em.off(evt, fn),
        emit: (evt, payload) => em.emit(evt, payload),
        score: 0,
        level: 1,
        lines: 0,
    };
}

const FAKE_MISSION = Object.freeze({
    id: 'mission-stellar-classic',
    name: 'K-227 "Ironfall"',
    narrativeName: 'Training asteroid',
    sector: 'Belt 9',
    tierIndex: 1,
    tierColor: 0x00ff88,
    baseCredits: 100,
});

test('click-match tally: all cells share payload.color', () => {
    const state = stubState();
    const ledger = new RunLedger({ state, mission: FAKE_MISSION });
    state.emit('match-cleared', {
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
        color: 'red',
        special: null,
        points: 40,
    });
    assert.equal(ledger.ores.red, 4);
    assert.equal(ledger.cellsCleared, 4);
    assert.equal(ledger.matchesCleared, 1);
});

test('auto-match sweep tally: cells carry their own colors', () => {
    const state = stubState();
    const ledger = new RunLedger({ state });
    state.emit('match-cleared', {
        cells: [
            { x: 0, y: 0, color: 'blue'  },
            { x: 1, y: 0, color: 'blue'  },
            { x: 0, y: 1, color: 'green' },
            { x: 0, y: 2, color: 'green' },
        ],
        color: null,
        special: null,
        points: 40,
    });
    assert.equal(ledger.ores.blue, 2);
    assert.equal(ledger.ores.green, 2);
    assert.equal(ledger.cellsCleared, 4);
    assert.equal(ledger.matchesCleared, 1);
});

test('bomb tally: each cell carries its own color', () => {
    const state = stubState();
    const ledger = new RunLedger({ state });
    state.emit('bomb-exploded', {
        center: { x: 4, y: 4 },
        cells: [
            { x: 4, y: 4, color: 'red'    },
            { x: 5, y: 4, color: 'yellow' },
            { x: 4, y: 5, color: 'bomb'   },
        ],
        points: 60,
    });
    assert.equal(ledger.ores.red, 1);
    assert.equal(ledger.ores.yellow, 1);
    assert.equal(ledger.ores.bomb, 1);
    assert.equal(ledger.bombsExploded, 1);
    assert.equal(ledger.cellsCleared, 3);
});

test('line-clear tally: count + per-row colors', () => {
    const state = stubState();
    const ledger = new RunLedger({ state });
    state.emit('lines-cleared', {
        count: 2,
        points: 800,
        colors: ['red', 'red', 'blue', 'green', 'yellow', 'green'],
    });
    assert.equal(ledger.linesCleared, 2);
    assert.equal(ledger.ores.red, 2);
    assert.equal(ledger.ores.blue, 1);
    assert.equal(ledger.ores.green, 2);
    assert.equal(ledger.ores.yellow, 1);
    assert.equal(ledger.cellsCleared, 6);
});

test('unknown colors (no ore slot) are ignored silently', () => {
    const state = stubState();
    const ledger = new RunLedger({ state });
    state.emit('match-cleared', {
        cells: [{ x: 0, y: 0, color: 'purple' }, { x: 1, y: 0, color: 'chartreuse' }],
        color: null,
    });
    assert.equal(ledger.cellsCleared, 0);
});

test('detach stops further accumulation', () => {
    const state = stubState();
    const ledger = new RunLedger({ state, mission: FAKE_MISSION });
    state.emit('match-cleared', { cells: [{ x: 0, y: 0 }], color: 'red' });
    ledger.detach();
    state.emit('match-cleared', { cells: [{ x: 0, y: 0 }], color: 'red' });
    assert.equal(ledger.ores.red, 1);
    // Detach is idempotent + safe after first call.
    assert.doesNotThrow(() => ledger.detach());
});

test('computeCredits: baseCredits + floor(score / 10)', () => {
    assert.equal(computeCredits({ baseCredits: 100, score: 0    }),  100);
    assert.equal(computeCredits({ baseCredits: 100, score: 9    }),  100);
    assert.equal(computeCredits({ baseCredits: 100, score: 10   }),  101);
    assert.equal(computeCredits({ baseCredits: 100, score: 2050 }),  305);
    assert.equal(computeCredits({ baseCredits: 900, score: 99999 }), 900 + 9999);
    // Fractional input still returns integer output.
    assert.equal(Number.isInteger(computeCredits({ baseCredits: 100.9, score: 15.5 })), true);
});

test('computeCredits clamps negative inputs to zero-base', () => {
    assert.equal(computeCredits({ baseCredits: -500, score: 0 }), 0);
    assert.equal(computeCredits({ baseCredits: 0, score: -500 }), 0);
});

test('summary rolls up mission metadata + credits', () => {
    const state = stubState();
    const ledger = new RunLedger({ state, mission: FAKE_MISSION });
    state.emit('match-cleared', {
        cells: [
            { x: 0, y: 0, color: 'red' },
            { x: 1, y: 0, color: 'red' },
            { x: 2, y: 0, color: 'red' },
            { x: 3, y: 0, color: 'red' },
        ],
        color: 'red',
    });
    state.score = 1000;
    state.level = 3;
    state.lines = 5;
    const summary = ledger.summary(state);
    assert.equal(summary.missionId,      FAKE_MISSION.id);
    assert.equal(summary.narrativeName,  FAKE_MISSION.narrativeName);
    assert.equal(summary.baseCredits,    100);
    assert.equal(summary.scoreBonus,     100);
    assert.equal(summary.credits,        200);
    assert.equal(summary.ores.red,       4);
    assert.equal(summary.cellsCleared,   4);
    assert.equal(summary.matchesCleared, 1);
    assert.equal(summary.finalScore,     1000);
    assert.equal(summary.finalLevel,     3);
    assert.equal(summary.finalLines,     5);
});

test('summary works without a mission (sandbox boot)', () => {
    const state = stubState();
    const ledger = new RunLedger({ state });
    const summary = ledger.summary();
    assert.equal(summary.missionId,   null);
    assert.equal(summary.baseCredits, 0);
    assert.equal(summary.credits,     0);
});

test('rewardEnvelope matches MetaState.applyMissionReward shape', () => {
    const state = stubState();
    const ledger = new RunLedger({ state, mission: FAKE_MISSION });
    state.emit('match-cleared', { cells: [{ x: 0, y: 0 }], color: 'blue' });
    const envelope = ledger.rewardEnvelope();
    assert.deepEqual(Object.keys(envelope).sort(), ['credits', 'missionId', 'ores']);
    assert.equal(envelope.missionId, FAKE_MISSION.id);
    assert.equal(envelope.ores.blue, 1);
    // credits must be a non-negative integer for setCredits to accept
    // it without clamping.
    assert.equal(Number.isInteger(envelope.credits), true);
    assert.ok(envelope.credits >= 0);
});
