import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Persistence, STORAGE_KEY, createMemoryStorage } from '../src/persistence.js';
import { MetaState, META_SAVE_VERSION } from '../src/meta-state.js';

test('save + load round-trips a MetaState snapshot', () => {
    const storage = createMemoryStorage();
    const p = new Persistence({ storage });
    const meta = new MetaState();
    meta.addCredits(1000);
    meta.addOre('green', 5);
    assert.equal(p.save(meta.snapshot()), true);

    const loaded = p.load();
    assert.ok(loaded);
    assert.equal(loaded.version, META_SAVE_VERSION);
    assert.equal(loaded.credits, 5800);
    assert.equal(loaded.ores.green, 5);
});

test('load returns null on empty storage', () => {
    const p = new Persistence({ storage: createMemoryStorage() });
    assert.equal(p.load(), null);
});

test('load returns null on unparseable blob', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{not valid json');
    const p = new Persistence({ storage });
    assert.equal(p.load(), null);
});

test('load refuses an incompatible schema version', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, credits: 1 }));
    const p = new Persistence({ storage });
    assert.equal(p.load(), null);
});

test('save swallows setItem errors (quota exceeded) and returns false', () => {
    const failingStorage = {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); },
        removeItem: () => {},
    };
    const p = new Persistence({ storage: failingStorage });
    assert.equal(p.save({ version: META_SAVE_VERSION, credits: 1 }), false);
});

test('missing storage: every method is a safe no-op', () => {
    const p = new Persistence({ storage: null });
    assert.equal(p.load(), null);
    assert.equal(p.save({ version: META_SAVE_VERSION }), false);
    assert.equal(p.clear(), false);
});

test('clear removes the save blob', () => {
    const storage = createMemoryStorage();
    const p = new Persistence({ storage });
    p.save(new MetaState().snapshot());
    assert.ok(p.load());
    assert.equal(p.clear(), true);
    assert.equal(p.load(), null);
});

test('full cycle: save -> rehydrate MetaState -> same snapshot', () => {
    const storage = createMemoryStorage();
    const p = new Persistence({ storage });
    const a = new MetaState();
    a.applyMissionReward({ credits: 500, ores: { blue: 2, purple: 1 }, missionId: 'm-x' });
    a.setShipHull('ship-2', 42);
    p.save(a.snapshot());

    const b = new MetaState(p.load());
    assert.deepEqual(b.snapshot(), a.snapshot());
});
