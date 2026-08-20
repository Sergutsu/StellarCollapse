import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MetaState,
    META_SAVE_VERSION,
    ORE_IDS,
    HUB_RESOURCE_IDS,
    starterProfile,
} from '../src/meta-state.js';

test('starterProfile is a deep copy (caller mutations do not leak)', () => {
    const a = starterProfile();
    a.credits = 0;
    a.hubResources.minerals = 0;
    a.fleet[0].hull = 0;
    const b = starterProfile();
    assert.equal(b.credits, 4800);
    assert.equal(b.hubResources.minerals, 1200);
    assert.equal(b.fleet[0].hull, 100);
});

test('fresh MetaState exposes the starter profile values', () => {
    const meta = new MetaState();
    assert.equal(meta.credits, 4800);
    assert.equal(meta.reputationTier, 1);
    assert.equal(meta.getHubResource('minerals'), 1200);
    assert.equal(meta.getHubResource('credits'), 4800);
    assert.equal(meta.getHubResource('warp'), 3);
    for (const color of ORE_IDS) {
        assert.equal(meta.getOre(color), 0);
    }
    assert.equal(meta.fleetSnapshot().length, 5);
    assert.equal(meta.crewSnapshot().length, 5);
    assert.deepEqual(meta.completedMissionIds, []);
});

test('snapshot includes schema version and matches shape', () => {
    const snap = new MetaState().snapshot();
    assert.equal(snap.version, META_SAVE_VERSION);
    assert.ok(snap.hubResources);
    assert.ok(snap.ores);
    assert.ok(Array.isArray(snap.fleet));
    assert.ok(Array.isArray(snap.crew));
    for (const id of HUB_RESOURCE_IDS) {
        if (id === 'credits') continue;
        assert.ok(id in snap.hubResources, `missing ${id} in hubResources`);
    }
});

test('setCredits / addCredits clamp below zero and emit change', () => {
    const meta = new MetaState();
    const events = [];
    meta.on('change', (p) => events.push(p));

    meta.addCredits(100);
    assert.equal(meta.credits, 4900);
    meta.setCredits(-50);
    assert.equal(meta.credits, 0);
    // Setting to the same value is a no-op -- should not emit.
    meta.setCredits(0);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, 'credits');
});

test('addOre ignores unknown colors and clamps at zero', () => {
    const meta = new MetaState();
    meta.addOre('red', 5);
    assert.equal(meta.getOre('red'), 5);
    meta.addOre('red', -100);
    assert.equal(meta.getOre('red'), 0);
    meta.addOre('bogus', 99);
    // No throw, no change.
    assert.equal(meta.getOre('red'), 0);
});

test('applyMissionReward applies credits + ores atomically', () => {
    const meta = new MetaState();
    let changes = 0;
    meta.on('change', () => changes++);
    meta.applyMissionReward({
        credits: 250,
        ores: { red: 3, green: 1, bogus: 99 },
        missionId: 'm-stellar-classic-small',
    });
    assert.equal(meta.credits, 4800 + 250);
    assert.equal(meta.getOre('red'), 3);
    assert.equal(meta.getOre('green'), 1);
    assert.equal(meta.completedMissionIds.length, 1);
    // Single consolidated event for the whole reward.
    assert.equal(changes, 1);
});

test('applyMissionReward floors fractional credits and ores to integers', () => {
    const meta = new MetaState();
    meta.applyMissionReward({
        credits: 10.9,
        ores: { red: 2.7, blue: 1.4 },
        missionId: 'm-frac',
    });
    // Flooring happens on the full sum (same as setCredits / addOre).
    assert.equal(meta.credits, 4800 + 10);
    assert.equal(meta.getOre('red'), 2);
    assert.equal(meta.getOre('blue'), 1);
    // Snapshot must round-trip through JSON as integers too, so a
    // reload through Persistence cannot diverge from the in-memory copy.
    const snap = meta.snapshot();
    assert.equal(Number.isInteger(snap.credits), true);
    assert.equal(Number.isInteger(snap.ores.red), true);
    assert.equal(Number.isInteger(snap.ores.blue), true);
});

test('applyMissionReward does not double-count the same missionId', () => {
    const meta = new MetaState();
    meta.applyMissionReward({ credits: 10, missionId: 'm-a' });
    meta.applyMissionReward({ credits: 10, missionId: 'm-a' });
    assert.equal(meta.completedMissionIds.length, 1);
    assert.equal(meta.credits, 4820);
});

test('fleet / crew mutations clamp and emit', () => {
    const meta = new MetaState();
    const events = [];
    meta.on('change', (p) => events.push(p.kind));

    meta.setShipHull('ship-2', 50);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-2').hull, 50);
    meta.setShipHull('ship-2', 200);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-2').hull, 100);
    // Unknown status is normalized to Standby; ship-2 already starts in
    // Standby, so this write is a no-op.
    meta.setShipStatus('ship-2', 'Repairing');
    meta.setCrewLevel('crew-1', 5);
    meta.setCrewStatus('crew-3', 'On Mission');
    assert.deepEqual(events, ['ship-hull', 'ship-hull', 'crew-level', 'crew-status']);
    assert.equal(meta.crewSnapshot().find((c) => c.id === 'crew-1').level, 5);
});

test('constructor merges saved data onto starter defaults', () => {
    const meta = new MetaState({
        credits: 9000,
        hubResources: { minerals: 2000, bogusKey: 'ignored' },
        ores: { red: 7 },
        fleet: [{ id: 'ship-1', hull: 55, status: 'Repairing' }],
        crew: [{ id: 'crew-2', level: 9 }],
        reputationTier: 3,
        completedMissionIds: ['m-1'],
    });
    assert.equal(meta.credits, 9000);
    assert.equal(meta.getHubResource('minerals'), 2000);
    // Untouched keys fall back to starter defaults.
    assert.equal(meta.getHubResource('warp'), 3);
    assert.equal(meta.getOre('red'), 7);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').hull, 55);
    // Legacy status values (e.g. Repairing/Resting) are normalized.
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').status, 'Standby');
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').className, 'Scout');
    assert.equal(meta.crewSnapshot().find((c) => c.id === 'crew-2').level, 9);
    assert.equal(meta.reputationTier, 3);
    assert.deepEqual(meta.completedMissionIds, ['m-1']);
});

test('constructor tolerates malformed saved data', () => {
    assert.doesNotThrow(() => new MetaState(null));
    assert.doesNotThrow(() => new MetaState(42));
    assert.doesNotThrow(() => new MetaState({ ores: 'nope', fleet: 'nope', crew: 'nope' }));
    const meta = new MetaState({ credits: 'lots', hubResources: null });
    assert.equal(meta.credits, 4800);
});

test('snapshot() returns defensive copies (mutating does not affect meta)', () => {
    const meta = new MetaState();
    const snap = meta.snapshot();
    snap.credits = 0;
    snap.hubResources.minerals = 0;
    snap.fleet[0].hull = 0;
    snap.ores.red = 99;
    assert.equal(meta.credits, 4800);
    assert.equal(meta.getHubResource('minerals'), 1200);
    assert.equal(meta.fleetSnapshot()[0].hull, 100);
    assert.equal(meta.getOre('red'), 0);
});

// ------------------------------------------------------------------
// P4: activeMissions persistence + mutations
// ------------------------------------------------------------------

test('starter profile and fresh MetaState expose empty activeMissions + lastTickAt', () => {
    const meta = new MetaState();
    const snap = meta.snapshot();
    assert.ok(Array.isArray(snap.activeMissions));
    assert.equal(snap.activeMissions.length, 0);
    assert.ok(Number.isFinite(snap.lastTickAt));
    assert.deepEqual(meta.activeMissionsSnapshot(), []);
});

test('addActiveMission / abortActiveMission / claimActiveMission round-trip and update statuses', () => {
    const meta = new MetaState();
    const now = Date.now();

    meta.addActiveMission({
        id: 'idle-1',
        title: 'Test Dispatch',
        shipId: 'ship-1',
        shipName: 'Nyx-I',
        crewId: 'crew-1',
        crewName: 'V. Draeven',
        startedAt: now,
        etaSec: 120,
        endsAt: now + 120000,
        rewardCredits: 300,
        rewardOres: { common: ['pyrite'], rare: [] },
    });

    assert.equal(meta.activeMissionsSnapshot().length, 1);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').status, 'On Mission');
    assert.equal(meta.crewSnapshot().find((c) => c.id === 'crew-1').status, 'On Mission');

    // Abort with partial (caller computes via clock in real usage)
    meta.abortActiveMission('idle-1', { partialCredits: 75 });
    assert.equal(meta.activeMissionsSnapshot().length, 0);
    assert.equal(meta.credits, 4800 + 75);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').status, 'Standby');
    assert.equal(meta.crewSnapshot().find((c) => c.id === 'crew-1').status, 'Available');
});

test('claimActiveMission grants credits + ores and frees assets', () => {
    const meta = new MetaState();
    const now = Date.now();

    meta.addActiveMission({
        id: 'idle-2',
        shipId: 'ship-2',
        crewId: 'crew-2',
        startedAt: now,
        etaSec: 60,
        endsAt: now + 60000,
        rewardCredits: 450,
        rewardOres: { common: ['cryonite'], rare: ['volatiles'] },
    });

    meta.claimActiveMission('idle-2', { credits: 450, ores: { blue: 1, bomb: 1 } });

    assert.equal(meta.activeMissionsSnapshot().length, 0);
    assert.equal(meta.credits, 4800 + 450);
    assert.equal(meta.getOre('blue'), 1);
    assert.equal(meta.getOre('bomb'), 1);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-2').status, 'Standby');
});

test('activeMissions round-trip through snapshot + load (persistence)', () => {
    const meta1 = new MetaState();
    const now = Date.now();
    meta1.addActiveMission({
        id: 'persist-1',
        shipId: 'ship-3',
        crewId: 'crew-3',
        startedAt: now,
        etaSec: 90,
        endsAt: now + 90000,
        rewardCredits: 180,
    });

    const snap = meta1.snapshot();
    const meta2 = new MetaState(snap);

    const restored = meta2.activeMissionsSnapshot();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, 'persist-1');
    assert.equal(restored[0].rewardCredits, 180);
    assert.equal(meta2.fleetSnapshot().find((s) => s.id === 'ship-3').status, 'On Mission');
});

// ------------------------------------------------------------------
// Multi-research tests (new concurrent research system)
// ------------------------------------------------------------------

test('can start up to maxConcurrent researches', () => {
    const meta = new MetaState();
    meta.startResearch('warp-coils');
    meta.startResearch('hull-plating');

    const state = meta.getResearchState();
    assert.equal(state.activeResearches.length, 2);
    assert.equal(state.maxConcurrent, 2);
});

test('cannot exceed maxConcurrent research slots', () => {
    const meta = new MetaState();
    meta.startResearch('warp-coils');
    meta.startResearch('hull-plating');
    meta.startResearch('trade-compact'); // should be blocked

    assert.equal(meta.getResearchState().activeResearches.length, 2);
});

test('cancelResearch preserves progress via accumulatedMs', () => {
    const meta = new MetaState();
    meta.startResearch('warp-coils');

    // Simulate time passing (we can't easily fake time, but cancel should store accumulated)
    meta.cancelResearch('warp-coils');

    const state = meta.getResearchState();
    const project = state.activeResearches[0];
    assert.equal(project.nodeId, 'warp-coils');
    assert.equal(project.startedAt, 0); // paused
    assert.ok(project.accumulatedMs >= 0);
});

test('resumeResearch after cancel continues from accumulated progress', () => {
    const meta = new MetaState();
    meta.startResearch('warp-coils');
    meta.cancelResearch('warp-coils');

    const before = meta.getResearchState().activeResearches[0].accumulatedMs || 0;

    meta.resumeResearch('warp-coils');

    const after = meta.getResearchState().activeResearches[0];
    assert.ok(after.startedAt > 0);
    assert.equal(after.accumulatedMs, before);
});

test('upgradeResearchSlots increases maxConcurrent', () => {
    const meta = new MetaState();
    assert.equal(meta.getResearchState().maxConcurrent, 2);

    meta.upgradeResearchSlots();
    assert.equal(meta.getResearchState().maxConcurrent, 3);
});
