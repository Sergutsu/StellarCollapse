import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    computeJobState,
    computePartialCredits,
    partitionJobs,
    isJobDone,
    makeRecoveryJob,
} from '../src/idle-clock.js';

function makeJob(overrides = {}) {
    const now = overrides._now || Date.now();
    const eta = overrides.etaSec ?? 120;
    return {
        id: overrides.id || 'job-1',
        title: 'Test Idle',
        rewardCredits: overrides.rewardCredits ?? 240,
        rewardOres: { common: ['pyrite', 'cryonite'], rare: [] },
        shipId: 'ship-1',
        shipName: 'Nyx-I',
        crewId: 'crew-1',
        crewName: 'V. Draeven',
        startedAt: now - (overrides.elapsedMs || 0),
        etaSec: eta,
        endsAt: now - (overrides.elapsedMs || 0) + eta * 1000,
        ...overrides,
    };
}

test('computeJobState returns correct remaining / done / progress for fresh job', () => {
    const now = Date.now();
    const job = makeJob({ _now: now, etaSec: 120, elapsedMs: 0 });
    const s = computeJobState(job, now);
    assert.equal(s.done, false);
    assert.ok(s.remainingSec >= 119 && s.remainingSec <= 120);
    assert.equal(s.progressPct, 0);
});

test('computeJobState marks job done when past endsAt', () => {
    const now = Date.now();
    const job = makeJob({ _now: now, etaSec: 10, elapsedMs: 15000 });
    const s = computeJobState(job, now);
    assert.equal(s.done, true);
    assert.equal(s.remainingSec, 0);
    assert.ok(s.progressPct >= 1);
});

test('computePartialCredits returns proportional payout on abort', () => {
    const now = Date.now();
    const job = makeJob({ _now: now, rewardCredits: 100, etaSec: 100, elapsedMs: 25000 });
    const partial = computePartialCredits(job, now);
    // ~25% complete
    assert.ok(partial >= 24 && partial <= 26);
});

test('partitionJobs splits active vs ready correctly', () => {
    const now = Date.now();
    const active = makeJob({ _now: now, id: 'a', elapsedMs: 0, etaSec: 300 });
    const ready = makeJob({ _now: now, id: 'b', elapsedMs: 999999, etaSec: 10 });
    const { active: act, ready: rdy } = partitionJobs([active, ready], now);
    assert.equal(act.length, 1);
    assert.equal(act[0].id, 'a');
    assert.equal(rdy.length, 1);
    assert.equal(rdy[0].id, 'b');
});

test('isJobDone is true exactly when remaining <= 0', () => {
    const now = Date.now();
    const notDone = makeJob({ _now: now, elapsedMs: 0 });
    const done = makeJob({ _now: now, elapsedMs: 999999 });
    assert.equal(isJobDone(notDone, now), false);
    assert.equal(isJobDone(done, now), true);
});

test('makeRecoveryJob produces a zero-reward instant-claim placeholder with correct shape', () => {
    const ship = { id: 's-99', name: 'Ghost' };
    const crew = { id: 'c-99', name: 'Spectre' };
    const rec = makeRecoveryJob(ship, crew, 42);
    assert.equal(rec.id.includes('recovered'), true);
    assert.equal(rec.rewardCredits, 0);
    assert.equal(rec.etaSec, 0);
    assert.equal(rec.endsAt, rec.startedAt);
    assert.equal(rec.shipId, 's-99');
});

// ---------------------------------------------------------------------
// P8: offline / welcome-back summary
// ---------------------------------------------------------------------

import { summarizeOffline, formatAway } from '../src/idle-clock.js';

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 9, 18, 0, 0);

test('summarizeOffline reports what finished while the player was away', () => {
    const jobs = [
        makeJob({ id: 'a', _now: NOW, elapsedMs: 3 * HOUR, etaSec: 3600, rewardCredits: 400 }),
        makeJob({ id: 'b', _now: NOW, elapsedMs: 0, etaSec: 3600, rewardCredits: 250 }),
    ];
    const summary = summarizeOffline({ jobs, lastSeenMs: NOW - 2 * HOUR, nowMs: NOW });
    assert.equal(summary.away, true);
    assert.equal(summary.awaySec, 7200);
    assert.equal(summary.awayLabel, '2h 0m');
    assert.equal(summary.completed.length, 1);
    assert.equal(summary.completed[0].id, 'a');
    assert.equal(summary.pending.length, 1);
    assert.equal(summary.credits, 400);
    assert.equal(summary.oreUnits, 2);
});

test('jobs that finished before the absence are not reported as new', () => {
    const jobs = [makeJob({ id: 'old', _now: NOW, elapsedMs: 10 * HOUR, etaSec: 3600 })];
    const summary = summarizeOffline({ jobs, lastSeenMs: NOW - HOUR, nowMs: NOW });
    assert.equal(summary.ready, 1, 'still claimable');
    assert.equal(summary.completed.length, 0, 'but not new while away');
    assert.equal(summary.credits, 0);
});

test('a short absence is not "away"', () => {
    const summary = summarizeOffline({ jobs: [], lastSeenMs: NOW - 5000, nowMs: NOW });
    assert.equal(summary.away, false);
    assert.equal(summary.awaySec, 5);
    assert.deepEqual(summary.completed, []);
});

test('summarizeOffline tolerates missing or junk input', () => {
    const empty = summarizeOffline({});
    assert.equal(empty.away, false);
    assert.equal(empty.credits, 0);
    assert.deepEqual(empty.completed, []);
    const noLastSeen = summarizeOffline({ jobs: [], lastSeenMs: 0, nowMs: NOW });
    assert.equal(noLastSeen.away, false);
    const junk = summarizeOffline({ jobs: null, lastSeenMs: NaN, nowMs: NaN });
    assert.equal(junk.away, false);
});

test('formatAway renders coarse human durations', () => {
    assert.equal(formatAway(0), '0s');
    assert.equal(formatAway(59_000), '59s');
    assert.equal(formatAway(60_000), '1m');
    assert.equal(formatAway(90 * 60_000), '1h 30m');
    assert.equal(formatAway(25 * HOUR), '1d 1h');
    assert.equal(formatAway(-1), '0s');
});
