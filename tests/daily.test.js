// Daily clock: day keys, board seeds, reroll pricing (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DAY_MS,
    REROLL_BASE_COST,
    MAX_REROLLS_PER_DAY,
    dayKey,
    dayIndex,
    msUntilNextDay,
    countdownToNextDay,
    formatHms,
    dailyBoardSeed,
    boardSeedFor,
    rerollCost,
    normalizeBoardState,
    hashString,
    rerollCap,
} from '../src/daily.js';

const NOON_UTC = Date.UTC(2026, 9, 9, 12, 0, 0);

test('dayKey is a UTC YYYY-MM-DD string', () => {
    assert.equal(dayKey(NOON_UTC), '2026-10-09');
    assert.equal(dayKey(Date.UTC(2026, 0, 1, 0, 0, 0)), '2026-01-01');
    assert.equal(dayKey(Date.UTC(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('the day rolls at the UTC boundary, not before', () => {
    assert.equal(dayKey(Date.UTC(2026, 9, 9, 23, 59, 59, 999)), '2026-10-09');
    assert.equal(dayKey(Date.UTC(2026, 9, 10, 0, 0, 0, 0)), '2026-10-10');
    assert.equal(dayIndex(Date.UTC(2026, 9, 10, 0, 0, 0)) - dayIndex(NOON_UTC), 1);
});

test('msUntilNextDay counts down inside a day', () => {
    assert.equal(msUntilNextDay(NOON_UTC), DAY_MS / 2);
    assert.equal(msUntilNextDay(Date.UTC(2026, 9, 9, 0, 0, 0)), DAY_MS);
    assert.equal(msUntilNextDay(Date.UTC(2026, 9, 9, 23, 0, 0)), 3600_000);
    assert.equal(countdownToNextDay(NOON_UTC), '12:00:00');
});

test('formatHms pads and clamps', () => {
    assert.equal(formatHms(0), '00:00:00');
    assert.equal(formatHms(-5000), '00:00:00');
    assert.equal(formatHms(1000), '00:00:01');
    assert.equal(formatHms(3_723_000), '01:02:03');
    assert.equal(formatHms(90_000_000), '25:00:00');
});

test('the daily board seed is stable within a day and changes across days', () => {
    const morning = Date.UTC(2026, 9, 9, 1, 0, 0);
    const evening = Date.UTC(2026, 9, 9, 23, 0, 0);
    assert.equal(dailyBoardSeed(morning), dailyBoardSeed(evening));
    assert.notEqual(dailyBoardSeed(morning), dailyBoardSeed(Date.UTC(2026, 9, 10, 1, 0, 0)));
});

test('each paid reroll walks the board seed forward', () => {
    const seeds = [0, 1, 2, 3].map((n) => boardSeedFor({ dayIndex: 20700, rerollsToday: n }));
    assert.equal(new Set(seeds).size, seeds.length, 'no two rerolls share a board');
    seeds.forEach((s) => assert.ok(Number.isInteger(s) && s >= 0));
});

test('boardSeedFor with zero rerolls matches the plain daily seed', () => {
    const day = dayIndex(NOON_UTC);
    assert.equal(boardSeedFor({ dayIndex: day, rerollsToday: 0 }), dailyBoardSeed(NOON_UTC));
    assert.equal(boardSeedFor({ dayIndex: day, rerollsToday: 0 }), boardSeedFor({ dayIndex: day }));
    assert.notEqual(boardSeedFor({ dayIndex: day, rerollsToday: 1 }), dailyBoardSeed(NOON_UTC));
});

test('reroll cost escalates linearly and then stops', () => {
    assert.equal(rerollCost(0), REROLL_BASE_COST);
    assert.equal(rerollCost(1), REROLL_BASE_COST * 2);
    assert.equal(rerollCost(2), REROLL_BASE_COST * 3);
    assert.equal(rerollCost(MAX_REROLLS_PER_DAY), Infinity);
    assert.equal(rerollCost(MAX_REROLLS_PER_DAY + 10), Infinity);
    assert.equal(rerollCost(-3), REROLL_BASE_COST);
    assert.equal(rerollCost(NaN), REROLL_BASE_COST);
});

test('normalizeBoardState resets the counter on a new day', () => {
    const stale = normalizeBoardState({ dayKey: '2026-10-08', rerollsToday: 4 }, NOON_UTC);
    assert.equal(stale.dayKey, '2026-10-09');
    assert.equal(stale.rerollsToday, 0);
    assert.equal(stale.nextRerollCost, REROLL_BASE_COST);
    assert.equal(stale.canReroll, true);
});

test('normalizeBoardState keeps a same-day counter and clamps it', () => {
    const sameDay = normalizeBoardState({ dayKey: '2026-10-09', rerollsToday: 2 }, NOON_UTC);
    assert.equal(sameDay.rerollsToday, 2);
    assert.equal(sameDay.nextRerollCost, REROLL_BASE_COST * 3);

    const capped = normalizeBoardState({ dayKey: '2026-10-09', rerollsToday: 99 }, NOON_UTC);
    assert.equal(capped.rerollsToday, MAX_REROLLS_PER_DAY);
    assert.equal(capped.canReroll, false);
    assert.equal(capped.nextRerollCost, Infinity);
});

test('normalizeBoardState tolerates a missing or junk record', () => {
    [null, undefined, {}, { dayKey: 5, rerollsToday: 'x' }].forEach((stored) => {
        const state = normalizeBoardState(stored, NOON_UTC);
        assert.equal(state.dayKey, '2026-10-09');
        assert.equal(state.rerollsToday, 0);
        assert.ok(Number.isInteger(state.seed));
    });
});

test('hashString is deterministic and 32-bit unsigned', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    assert.notEqual(hashString('abc'), hashString('abd'));
    assert.ok(hashString('abc') >= 0 && hashString('abc') <= 0xffffffff);
    assert.equal(hashString(''), hashString(''));
    assert.ok(Number.isInteger(hashString(null)));
});

// ---------------------------------------------------------------------------
// P8: research allowance lifts the daily reroll cap (effects.riskRerolls)
// ---------------------------------------------------------------------------

test('rerollCap adds the research allowance on top of the base six', () => {
    assert.equal(rerollCap(), MAX_REROLLS_PER_DAY);
    assert.equal(rerollCap({ extraRerolls: 1 }), MAX_REROLLS_PER_DAY + 1);
    assert.equal(rerollCap({ extraRerolls: -4 }), MAX_REROLLS_PER_DAY, 'never below the base');
    assert.equal(rerollCap({ extraRerolls: 1.7 }), MAX_REROLLS_PER_DAY + 1);
});

test('rerollCost stays on the same ladder but runs one roll longer with an allowance', () => {
    assert.equal(rerollCost(MAX_REROLLS_PER_DAY - 1), REROLL_BASE_COST * MAX_REROLLS_PER_DAY);
    assert.equal(rerollCost(MAX_REROLLS_PER_DAY), Infinity);
    assert.equal(
        rerollCost(MAX_REROLLS_PER_DAY, { extraRerolls: 1 }),
        REROLL_BASE_COST * (MAX_REROLLS_PER_DAY + 1),
        'the extra roll is the next rung of the ladder, not a discount',
    );
    assert.equal(rerollCost(MAX_REROLLS_PER_DAY + 1, { extraRerolls: 1 }), Infinity);
});

test('normalizeBoardState reports the lifted cap and keeps roll 0 === the daily seed', () => {
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    const base = normalizeBoardState(null, now);
    const lifted = normalizeBoardState(null, now, { extraRerolls: 1 });
    assert.equal(base.rerollCap, MAX_REROLLS_PER_DAY);
    assert.equal(lifted.rerollCap, MAX_REROLLS_PER_DAY + 1);
    assert.equal(lifted.seed, dailyBoardSeed(now), 'allowance never moves the seed');

    // A stored counter above the base cap survives when tech allows it.
    const stored = { dayKey: dayKey(now), rerollsToday: MAX_REROLLS_PER_DAY + 1 };
    assert.equal(normalizeBoardState(stored, now).rerollsToday, MAX_REROLLS_PER_DAY, 'clamped without the tech');
    assert.equal(
        normalizeBoardState(stored, now, { extraRerolls: 1 }).rerollsToday,
        MAX_REROLLS_PER_DAY + 1,
        'kept with the tech',
    );
});
