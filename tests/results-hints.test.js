// Tests for the mission-report NEXT-STEP hints (pure module).
import test from 'node:test';
import assert from 'node:assert/strict';

import { nextStepHints } from '../src/results-hints.js';

test('a plain haul points at the refinery', () => {
    const hints = nextStepHints({ ores: { red: 4, blue: 2 } });
    assert.equal(hints.length, 1);
    assert.equal(hints[0].label, 'MARKET');
    assert.match(hints[0].text, /refine/i);
});

test('hull damage outranks the ore hint', () => {
    const hints = nextStepHints({ ores: { red: 4 }, hullDamage: 6 }, 1);
    assert.equal(hints[0].label, 'SHIPYARD');
    assert.match(hints[0].text, /3 minerals/);
});

test('a found warp cell charts a sector', () => {
    const hints = nextStepHints({ ores: { red: 1 }, warp: 1 }, 2);
    assert.equal(hints[0].label, 'STAR MAP');
    assert.equal(hints[1].label, 'MARKET');
});

test('a promotion headline makes the cut before generic advice', () => {
    const hints = nextStepHints({ promoted: true, repTitleAfter: 'Senior Dispatcher' }, 1);
    assert.equal(hints[0].label, 'RANK');
    assert.match(hints[0].text, /Senior Dispatcher/);
});

test('a crew level-up is surfaced', () => {
    const hints = nextStepHints({ crewName: 'V. Draeven', crewLevelsGained: 1 }, 3);
    assert.ok(hints.some((h) => h.label === 'CREW' && /V\. Draeven/.test(h.text)));
});

test('an empty report falls back to the loop', () => {
    const hints = nextStepHints({});
    assert.equal(hints.length, 1);
    assert.equal(hints[0].label, 'MISSION BOARD');
});

test('the cap is respected and never zero', () => {
    const summary = { ores: { red: 1 }, hullDamage: 2, warp: 1, promoted: true };
    assert.equal(nextStepHints(summary, 2).length, 2);
    assert.equal(nextStepHints(summary, 0).length, 1);
    assert.equal(nextStepHints(summary, -3).length, 1);
});

test('handles garbage without throwing', () => {
    assert.equal(nextStepHints(null).length, 1);
    assert.equal(nextStepHints({ ores: null, hullDamage: NaN }).length, 1);
});
