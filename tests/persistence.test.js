import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Persistence, STORAGE_KEY, createMemoryStorage, migrateSave } from '../src/persistence.js';
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

// ---------------------------------------------------------------------
// P8: versioned migration (v1 -> v2)
// ---------------------------------------------------------------------


test('migrateSave passes a current-version blob through untouched', () => {
    const blob = { version: META_SAVE_VERSION, credits: 10 };
    assert.equal(migrateSave(blob), blob);
});

test('migrateSave lifts a v1 blob to the current version', () => {
    const v1 = {
        version: 1,
        credits: 5200,
        hubResources: { minerals: 900, warp: 2 },
        ores: { red: 12, blue: 3, green: 0, yellow: 0, bomb: 1, snake: 0 },
        reputationTier: 2,
        completedMissionIds: ['mission-stellar-classic'],
        crew: [{ id: 'crew-1', name: 'V. Draeven', role: 'Captain', level: 4, status: 'Available' }],
        fleet: [{ id: 'ship-1', name: 'Nyx-I', className: 'Scout', hull: 88, status: 'Standby' }],
    };
    const migrated = migrateSave(v1);
    assert.equal(migrated.version, META_SAVE_VERSION);
    assert.equal(migrated.migratedFrom, 1);
    assert.equal(migrated.credits, 5200, 'v1 fields survive');
    assert.equal(migrated.hubResources.minerals, 900);

    const meta = new MetaState(migrated);
    assert.equal(meta.credits, 5200);
    assert.equal(meta.getOre('red'), 12);
    assert.equal(meta.getHubResource('minerals'), 900);
    assert.equal(meta.reputation, 0, 'a v1 save has no rep points yet');
    assert.deepEqual(meta.discoveredSectorIds(), []);
    assert.equal(meta.getBoardState().rerollsToday, 0);
    assert.equal(meta.getStats().missionsCompleted, 0);
    assert.equal(meta.completedMissionIds.length, 1);
    assert.equal(meta.fleetSnapshot()[0].hull, 88);
});

test('a v1 crew roster is backfilled with XP at each member\'s level', () => {
    const v1 = {
        version: 1,
        crew: [
            { id: 'crew-1', name: 'V. Draeven', role: 'Captain', level: 4, status: 'Available' },
            { id: 'crew-hired', name: 'R. Ilo', role: 'Pilot', level: 1, status: 'Available' },
        ],
    };
    const meta = new MetaState(migrateSave(v1));
    const roster = meta.crewSnapshot();
    const captain = roster.find((c) => c.id === 'crew-1');
    const hired = roster.find((c) => c.id === 'crew-hired');
    assert.equal(captain.level, 4);
    assert.ok(captain.xp > 0, 'veteran keeps a career XP total');
    assert.equal(hired.level, 1);
    assert.equal(hired.xp, 0);
});

test('migrateSave refuses unknown, future and malformed versions', () => {
    assert.equal(migrateSave({ version: 0 }), null);
    assert.equal(migrateSave({ version: 99 }), null);
    assert.equal(migrateSave({}), null);
    assert.equal(migrateSave(null), null);
    assert.equal(migrateSave('nope'), null);
    assert.equal(migrateSave([{ version: META_SAVE_VERSION }]), null);
});

test('load() migrates a v1 blob sitting in storage', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, credits: 777 }));
    const p = new Persistence({ storage });
    const loaded = p.load();
    assert.ok(loaded, 'v1 saves still load');
    assert.equal(loaded.version, META_SAVE_VERSION);
    assert.equal(loaded.credits, 777);
});

test('load() still refuses a corrupt or future blob', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 42, credits: 1 }));
    assert.equal(new Persistence({ storage }).load(), null);
});

test('saving a migrated profile writes the new version', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, credits: 300 }));
    const p = new Persistence({ storage });
    const meta = new MetaState(p.load());
    meta.addReputation(500);
    assert.equal(p.save(meta.snapshot()), true);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(raw.version, META_SAVE_VERSION);
    assert.equal(raw.reputation, 500);
    assert.equal(raw.credits, 300);
});
