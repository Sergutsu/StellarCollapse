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
