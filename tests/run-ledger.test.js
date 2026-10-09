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

// ---------------------------------------------------------------------
// DefenseLedger — the Combat minigame's ore tally (P8)
// ---------------------------------------------------------------------

import {
    DefenseLedger,
    DEFENSE_ORE_PER_INVADER,
    DEFENSE_HELIUM_PER_POWERUP,
    DEFENSE_BOSS_HAUL,
} from '../src/run-ledger.js';

const COMBAT_MISSION = Object.freeze({
    id: 'mission-blocks-classic',
    name: 'G-440 "Granitor"',
    narrativeName: 'Trade Route Defense: Outer Rim',
    sector: 'Outer Rim Lanes',
    tierIndex: 7,
    tierColor: '#fb923c',
    baseCredits: 700,
    type: 'Combat',
    risk: 4,
});

function stubDefense() {
    const em = new Emitter();
    return {
        on:  (evt, fn) => em.on(evt, fn),
        off: (evt, fn) => em.off(evt, fn),
        emit: (evt, payload) => em.emit(evt, payload),
        score: 0,
        won: false,
    };
}

test('each destroyed formation banks ore of its own colour', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    state.emit('invader-destroyed', { type: 0 });
    state.emit('invader-destroyed', { type: 1 });
    state.emit('invader-destroyed', { type: 2 });
    const s = ledger.summary({ score: 300, won: false });
    assert.equal(s.ores.red, DEFENSE_ORE_PER_INVADER);
    assert.equal(s.ores.blue, DEFENSE_ORE_PER_INVADER);
    assert.equal(s.ores.green, DEFENSE_ORE_PER_INVADER);
    assert.equal(s.matchesCleared, 3);
    assert.equal(s.cellsCleared, 3);
});

test('power-ups bank helium', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    state.emit('powerup-collected', { type: 'MULTI' });
    state.emit('powerup-collected', { type: 'WIDE' });
    const s = ledger.summary({ score: 0, won: false });
    assert.equal(s.ores.yellow, DEFENSE_HELIUM_PER_POWERUP * 2);
    assert.equal(s.bombsExploded, 2);
});

test('the boss sheds both hazard ores', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    state.emit('boss-destroyed');
    const s = ledger.summary({ score: 1200, won: true });
    assert.equal(s.ores.bomb, DEFENSE_BOSS_HAUL.bomb);
    assert.equal(s.ores.snake, DEFENSE_BOSS_HAUL.snake);
    assert.equal(s.won, true);
    assert.equal(s.linesCleared, 1);
});

test('defense credits use the same formula as a puzzle run', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    const s = ledger.summary({ score: 2500, won: true });
    assert.equal(s.baseCredits, COMBAT_MISSION.baseCredits);
    assert.equal(s.scoreBonus, 250);
    assert.equal(s.credits, computeCredits({ baseCredits: COMBAT_MISSION.baseCredits, score: 2500 }));
});

test('the defense summary carries combat stat labels for the results scene', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    const s = ledger.summary({ score: 10, won: false });
    assert.equal(s.minigame, 'defense');
    assert.equal(s.statLabels.lines, 'BALLS LOST');
    assert.equal(s.statLabels.matches, 'WRECKS');
    assert.equal(s.statLabels.bombs, 'PICKUPS');
    assert.equal(s.statLabels.level, 'WAVE');
});

test('ball losses are tallied and detach stops the tally', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state, mission: COMBAT_MISSION });
    state.emit('ball-lost');
    state.emit('ball-lost');
    assert.equal(ledger.summary({ score: 0 }).finalLines, 2);
    ledger.detach();
    state.emit('invader-destroyed', { type: 0 });
    state.emit('ball-lost');
    assert.equal(ledger.summary({ score: 0 }).matchesCleared, 0);
    assert.equal(ledger.summary({ score: 0 }).finalLines, 2);
});

test('a defense ledger without a mission still produces a valid envelope', () => {
    const state = stubDefense();
    const ledger = new DefenseLedger({ state });
    state.emit('invader-destroyed', { type: 1 });
    const s = ledger.summary({ score: 50, won: false });
    assert.equal(s.missionId, null);
    assert.equal(s.baseCredits, 0);
    const envelope = ledger.rewardEnvelope();
    assert.deepEqual(Object.keys(envelope).sort(), ['credits', 'missionId', 'ores']);
    assert.equal(envelope.ores.blue, DEFENSE_ORE_PER_INVADER);
});
