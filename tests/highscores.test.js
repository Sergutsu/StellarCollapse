// Unit tests for HighScores per-tier storage + legacy migration.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HighScores } from '../src/highscores.js';
import { HIGHSCORE_TIERS } from '../src/constants.js';

function memStorage(seed = {}) {
    const data = { ...seed };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        _dump: () => ({ ...data }),
    };
}

test('save stores entries per tier and sorts by score desc', () => {
    const hs = new HighScores(memStorage());
    const tierA = HIGHSCORE_TIERS[0].id;
    const tierB = HIGHSCORE_TIERS[5].id;
    hs.save(tierA, 'Ace', 100);
    hs.save(tierA, 'Beta', 500);
    hs.save(tierA, 'Gamma', 250);
    hs.save(tierB, 'Solo', 999);
    assert.deepEqual(hs.top(tierA).map((e) => e.score), [500, 250, 100]);
    assert.deepEqual(hs.top(tierB).map((e) => e.name), ['Solo']);
});

test('save caps each tier at 5 entries', () => {
    const hs = new HighScores(memStorage());
    const tier = HIGHSCORE_TIERS[2].id;
    for (let i = 0; i < 10; i++) hs.save(tier, `P${i}`, i * 10);
    const top = hs.top(tier);
    assert.equal(top.length, 5);
    assert.deepEqual(top.map((e) => e.score), [90, 80, 70, 60, 50]);
});

test('tiers are independent', () => {
    const hs = new HighScores(memStorage());
    const a = HIGHSCORE_TIERS[0].id;
    const b = HIGHSCORE_TIERS[1].id;
    hs.save(a, 'A', 10);
    assert.equal(hs.top(a).length, 1);
    assert.equal(hs.top(b).length, 0);
});

test('persists across instances via the storage backend', () => {
    const storage = memStorage();
    const first = new HighScores(storage);
    first.save(HIGHSCORE_TIERS[3].id, 'Chronos', 777);
    const second = new HighScores(storage);
    const top = second.top(HIGHSCORE_TIERS[3].id);
    assert.equal(top.length, 1);
    assert.equal(top[0].score, 777);
});

test('migrates legacy single-list store into the easiest tier', () => {
    const storage = memStorage({
        tetrisHighScores: JSON.stringify([
            { name: 'Legacy1', score: 1000 },
            { name: 'Legacy2', score: 500 },
        ]),
    });
    const hs = new HighScores(storage);
    const tier0 = HIGHSCORE_TIERS[0].id;
    const top = hs.top(tier0);
    assert.equal(top.length, 2);
    assert.equal(top[0].name, 'Legacy1');
    assert.equal(top[0].score, 1000);
    // Migration is persisted into the new storage key.
    assert.ok(storage._dump().stellarCollapseScoresV2);
});

test('renames legacy classic-* tier ids into stellar-* on load', () => {
    // Scores saved under the old "classic" gameplay-mode tier ids should
    // be absorbed into the renamed "stellar" tiers so players don't lose
    // their history after the mode rename.
    const storage = memStorage({
        stellarCollapseScoresV2: JSON.stringify({
            'classic-classic': [{ name: 'Old1', score: 900 }],
            'classic-mutated': [{ name: 'Old2', score: 750 }],
            'stellar-classic': [{ name: 'New', score: 500 }],
        }),
    });
    const hs = new HighScores(storage);
    const cc = hs.top('stellar-classic');
    assert.equal(cc.length, 2, 'old + new entries merge');
    assert.equal(cc[0].score, 900);
    assert.equal(hs.top('stellar-mutated')[0].score, 750);
    // Old ids no longer appear in persisted payload.
    const persisted = JSON.parse(storage._dump().stellarCollapseScoresV2);
    assert.equal(persisted['classic-classic'], undefined);
    assert.equal(persisted['classic-mutated'], undefined);
});

test('corrupt payload falls back to empty tiers without throwing', () => {
    const storage = memStorage({ stellarCollapseScoresV2: '{not json' });
    const hs = new HighScores(storage);
    for (const t of HIGHSCORE_TIERS) {
        assert.deepEqual(hs.top(t.id), []);
    }
});
