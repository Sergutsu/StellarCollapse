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

// ---------------------------------------------------------------------
// P8 meta systems: reputation, crew XP, sectors, board, stats, settlement
// ---------------------------------------------------------------------

test('fresh profile carries the P8 fields at zero', () => {
    const meta = new MetaState();
    assert.equal(meta.reputation, 0);
    assert.equal(meta.reputationTier, 1);
    assert.deepEqual(meta.discoveredSectorIds(), []);
    assert.deepEqual(meta.getBoardState().dayKey.length > 0 ? [1] : [], [1]);
    assert.equal(meta.getBoardState().rerollsToday, 0);
    assert.equal(meta.getStats().missionsCompleted, 0);
    assert.equal(meta.getStats().sectorsCharted, 0);
    assert.equal(meta.getHubResource('warp'), 3);
    assert.equal(meta.warpCapacity() >= 3, true);
    assert.equal(meta.crewSlots(), 6);
});

test('snapshot round-trips every P8 field', () => {
    const meta = new MetaState();
    meta.addReputation(1500);
    meta.discoverSector('omega-4-belt', { credits: 100, minerals: 10, rep: 25 });
    meta.addCrewXp('crew-1', 400);
    const snap = meta.snapshot();
    assert.equal(snap.version, META_SAVE_VERSION);
    assert.equal(snap.reputation, 1525, '1500 banked + 25 from the discovery grant');
    assert.equal(snap.reputationTier, 3);
    assert.deepEqual(snap.discoveredSectors, ['omega-4-belt']);
    assert.ok(snap.stats.repEarned >= 1500);
    assert.ok(snap.stats.sectorsCharted === 1);
    assert.ok(snap.crew[0].xp > 0);

    const reloaded = new MetaState(snap);
    assert.equal(reloaded.reputation, 1525);
    assert.equal(reloaded.reputationTier, 3);
    assert.deepEqual(reloaded.discoveredSectorIds(), ['omega-4-belt']);
    assert.equal(reloaded.crewSnapshot()[0].xp, snap.crew[0].xp);
    assert.equal(reloaded.getStats().sectorsCharted, 1);
});

test('starter crew are seeded with XP at their level threshold', () => {
    const meta = new MetaState();
    meta.crewSnapshot().forEach((member) => {
        assert.ok(Number.isInteger(member.xp) && member.xp >= 0);
    });
    const captain = meta.crewSnapshot().find((c) => c.id === 'crew-1');
    assert.equal(captain.level, 4);
    assert.ok(captain.xp > 0, 'a level-4 veteran has career XP');
});

test('addReputation banks points, derives the tier and emits', () => {
    const meta = new MetaState();
    const events = [];
    meta.on('change', (p) => events.push(p));

    meta.addReputation(399);
    assert.equal(meta.reputation, 399);
    assert.equal(meta.reputationTier, 1);

    meta.addReputation(1);
    assert.equal(meta.reputationTier, 2);
    assert.ok(events.some((e) => e.kind === 'rep-tier'));

    meta.addReputation(-10000);
    assert.equal(meta.reputation, 0, 'rep never goes negative');
    assert.equal(meta.reputationTier, 1);
    meta.addReputation(0);
    meta.addReputation(NaN);
    assert.equal(meta.reputation, 0);
});

test('getRepInfo mirrors the reputation ladder', () => {
    const meta = new MetaState();
    meta.addReputation(1200);
    const info = meta.getRepInfo();
    assert.equal(info.tier, 3);
    assert.equal(info.title, 'Senior Dispatcher');
    assert.ok(info.toNext > 0);
});

test('addCrewXp levels crew up and reports the gain', () => {
    const meta = new MetaState();
    const before = meta.crewSnapshot().find((c) => c.id === 'crew-3');
    const res = meta.addCrewXp('crew-3', 5000);
    assert.ok(res.levelsGained >= 1);
    const after = meta.crewSnapshot().find((c) => c.id === 'crew-3');
    assert.ok(after.level > before.level);
    assert.ok(after.xp >= before.xp + 5000);
    assert.equal(meta.addCrewXp('crew-nope', 100), null);
});

test('getEffects folds research + charted station sectors together', () => {
    const meta = new MetaState();
    assert.equal(meta.getEffects().etaMultiplier, 1);

    meta.startResearch('ion-thrusters');
    meta.completeResearch('ion-thrusters');
    assert.ok(meta.getEffects().etaMultiplier < 1);

    meta.discoverSector('nova-bazaar', {});
    assert.ok(meta.getEffects().marketSellBonus > 0);
    meta.discoverSector('driftyard-9', {});
    assert.ok(meta.getEffects().hullDamageMultiplier < 1);
});

test('discoverSector spends nothing itself but banks the grant once', () => {
    const meta = new MetaState();
    const creditsBefore = meta.credits;
    const mineralsBefore = meta.getHubResource('minerals');
    const oresBefore = meta.getOre('red');

    assert.equal(meta.discoverSector('omega-4-belt', { credits: 180, minerals: 60, rep: 25, ores: { red: 12 } }), true);
    assert.equal(meta.credits, creditsBefore + 180);
    assert.equal(meta.getHubResource('minerals'), mineralsBefore + 60);
    assert.equal(meta.getOre('red'), oresBefore + 12);
    assert.equal(meta.reputation, 25);
    assert.equal(meta.isSectorDiscovered('omega-4-belt'), true);

    // Second discovery is a no-op.
    assert.equal(meta.discoverSector('omega-4-belt', { credits: 9999 }), false);
    assert.equal(meta.credits, creditsBefore + 180);
    assert.equal(meta.discoverSector('not-a-sector', {}), false);
    assert.equal(meta.discoverSector(null, {}), false);
});

test('warp cells are clamped to the rack capacity', () => {
    const meta = new MetaState();
    const cap = meta.warpCapacity();
    meta.addWarp(99);
    assert.equal(meta.getHubResource('warp'), cap);
    assert.equal(meta.spendWarp(2), true);
    assert.equal(meta.getHubResource('warp'), cap - 2);
    assert.equal(meta.spendWarp(cap * 2), false, 'cannot overspend');
    assert.equal(meta.getHubResource('warp'), cap - 2);
    assert.equal(meta.spendWarp(0), true);
});

test('Compact Fuel Cell research raises the warp capacity', () => {
    const meta = new MetaState();
    const base = meta.warpCapacity();
    meta.startResearch('fuel-cell');
    meta.completeResearch('fuel-cell');
    assert.equal(meta.warpCapacity(), base + 2);
});

test('applySettlement lands the whole payout in one change event', () => {
    const meta = new MetaState();
    let changes = 0;
    meta.on('change', () => { changes += 1; });

    const creditsBefore = meta.credits;
    const hullBefore = meta.fleetSnapshot().find((s) => s.id === 'ship-1').hull;
    meta.applySettlement({
        credits: 500,
        ores: { red: 20, bomb: 2 },
        rep: 60,
        crewId: 'crew-1',
        crewXp: 120,
        shipId: 'ship-1',
        hullDamage: 4,
        warp: 1,
        missionId: 'mission-stellar-classic',
        won: true,
        dispatchMode: 'manual',
        type: 'Mining',
        finalScore: 4200,
    });

    assert.equal(changes, 1, 'one save for the whole settlement');
    assert.equal(meta.credits, creditsBefore + 500);
    assert.equal(meta.getOre('red'), 20);
    assert.equal(meta.getOre('bomb'), 2);
    assert.equal(meta.reputation, 60);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').hull, hullBefore - 4);
    assert.ok(meta.completedMissionIds.includes('mission-stellar-classic'));
    const stats = meta.getStats();
    assert.equal(stats.missionsCompleted, 1);
    assert.equal(stats.creditsEarned, 500);
    assert.equal(stats.oresMined, 22);
    assert.equal(stats.bestScore, 4200);
    assert.equal(stats.warpFound, 1);
});

test('applySettlement tracks combat wins, failures and idle claims separately', () => {
    const meta = new MetaState();
    meta.applySettlement({ credits: 10, won: true, type: 'Combat', dispatchMode: 'manual' });
    meta.applySettlement({ credits: 10, won: false, type: 'Combat', dispatchMode: 'manual' });
    meta.applySettlement({ credits: 10, won: true, dispatchMode: 'idle' });
    meta.applySettlement({ credits: 10, aborted: true, dispatchMode: 'idle' });
    const stats = meta.getStats();
    assert.equal(stats.combatWins, 1);
    assert.equal(stats.missionsCompleted, 1);
    assert.equal(stats.missionsFailed, 1);
    assert.equal(stats.idleClaims, 1);
    assert.equal(stats.idleAborts, 1);
});

test('applySettlement clamps hull at zero and ignores unknown ids', () => {
    const meta = new MetaState();
    meta.applySettlement({ credits: 0, shipId: 'ship-1', hullDamage: 5000 });
    assert.equal(meta.fleetSnapshot().find((s) => s.id === 'ship-1').hull, 0);
    meta.applySettlement({ credits: 0, shipId: 'ghost', hullDamage: 10 });
    meta.applySettlement({ credits: 0, crewId: 'ghost', crewXp: 10 });
    meta.applySettlement({});
});

test('applyRefine consumes ore and banks minerals', () => {
    const meta = new MetaState();
    meta.applySettlement({ credits: 0, ores: { red: 12, bomb: 3 } });
    const mineralsBefore = meta.getHubResource('minerals');
    const gained = meta.applyRefine({ minerals: 4, consumed: { red: 12, bomb: 2 } });
    assert.equal(gained, 4);
    assert.equal(meta.getOre('red'), 0);
    assert.equal(meta.getOre('bomb'), 1);
    assert.equal(meta.getHubResource('minerals'), mineralsBefore + 4);
    assert.equal(meta.getStats().mineralsRefined, 4);
    assert.equal(meta.applyRefine({ minerals: 0, consumed: {} }), 0);
});

test('refineAllOres plans and applies in one call', () => {
    const meta = new MetaState();
    meta.applySettlement({ credits: 0, ores: { red: 40, blue: 40, green: 40, yellow: 40, bomb: 10, snake: 10 } });
    const before = meta.getHubResource('minerals');
    const { plan, minerals } = meta.refineAllOres();
    assert.ok(minerals > 0);
    assert.equal(minerals, plan.minerals);
    assert.equal(meta.getHubResource('minerals'), before + minerals);
    // 40 of each common = 10 bars each (40), 10 of each rare = 5 bars each (10).
    assert.equal(minerals, 50);
    assert.equal(meta.getOre('red'), 0);
});

test('applyTrade moves credits and goods both ways', () => {
    const meta = new MetaState();
    const creditsBefore = meta.credits;
    assert.equal(meta.applyTrade({ goodId: 'pyrite', side: 'buy', amount: 10, credits: 60 }), true);
    assert.equal(meta.credits, creditsBefore - 60);
    assert.equal(meta.getOre('red'), 10);

    assert.equal(meta.applyTrade({ goodId: 'pyrite', side: 'sell', amount: 4, credits: 20 }), true);
    assert.equal(meta.getOre('red'), 6);
    assert.equal(meta.credits, creditsBefore - 40);

    assert.equal(meta.applyTrade({ goodId: 'pyrite', side: 'sell', amount: 99, credits: 20 }), false, 'cannot oversell');
    assert.equal(meta.applyTrade({ goodId: 'pyrite', side: 'buy', amount: 1, credits: 10 ** 9 }), false, 'cannot overspend');
    assert.equal(meta.applyTrade({ goodId: 'unobtainium', side: 'buy', amount: 1, credits: 1 }), false);
    assert.equal(meta.applyTrade({ goodId: 'pyrite', side: 'buy', amount: 0, credits: 0 }), false);
});

test('applyTrade handles the minerals bucket', () => {
    const meta = new MetaState();
    const mineralsBefore = meta.getHubResource('minerals');
    assert.equal(meta.applyTrade({ goodId: 'minerals', side: 'sell', amount: 100, credits: 300 }), true);
    assert.equal(meta.getHubResource('minerals'), mineralsBefore - 100);
    assert.equal(meta.credits, 4800 + 300);
    assert.equal(meta.applyTrade({ goodId: 'minerals', side: 'sell', amount: 10 ** 6, credits: 1 }), false);
});

test('buyBoardReroll charges escalating credits and caps per day', () => {
    const meta = new MetaState();
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    const creditsBefore = meta.credits;

    const first = meta.buyBoardReroll(now);
    assert.equal(first.ok, true);
    assert.equal(first.cost, 150);
    assert.equal(first.rerollsToday, 1);
    assert.equal(meta.credits, creditsBefore - 150);

    const second = meta.buyBoardReroll(now);
    assert.equal(second.cost, 300);
    assert.equal(meta.getBoardState(now).rerollsToday, 2);

    // A new day resets the counter (and therefore the price).
    const nextDay = Date.UTC(2026, 9, 10, 1, 0, 0);
    assert.equal(meta.getBoardState(nextDay).rerollsToday, 0);
    assert.equal(meta.buyBoardReroll(nextDay).cost, 150);
});

test('buyBoardReroll refuses when the wallet is empty', () => {
    const meta = new MetaState();
    meta.setCredits(10);
    const res = meta.buyBoardReroll(Date.UTC(2026, 9, 9, 12, 0, 0));
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not enough credits');
    assert.equal(meta.credits, 10);
});

test('buyBoardReroll stops at the daily cap', () => {
    const meta = new MetaState();
    meta.setCredits(10 ** 7);
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    for (let i = 0; i < 6; i += 1) assert.equal(meta.buyBoardReroll(now).ok, true);
    const blocked = meta.buyBoardReroll(now);
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /limit reached/);
});

test('touch stamps the offline baseline', () => {
    const meta = new MetaState();
    meta.touch(1234567);
    assert.equal(meta.lastTickAt, 1234567);
    meta.touch();
    assert.ok(meta.lastTickAt > 1234567);
});

test('noteHullRepair feeds lifetime stats', () => {
    const meta = new MetaState();
    meta.noteHullRepair(12);
    meta.noteHullRepair(8);
    assert.equal(meta.getStats().hullRepairs, 20);
    meta.noteHullRepair(-5);
    assert.equal(meta.getStats().hullRepairs, 20);
});

// ---------------------------------------------------------------------------
// P8: chartSector() — warp jump + discovery grant in one atomic write
// ---------------------------------------------------------------------------

test('chartSector spends warp, banks the grant and fires exactly one change', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    meta.addWarp(5);
    let changes = 0;
    meta.on('change', () => { changes += 1; });

    const creditsBefore = meta.credits;
    const repBefore = meta.reputation;
    const plan = meta.chartSector('omega-4-belt');
    assert.equal(plan.ok, true);
    assert.equal(plan.warpSpent, 1);
    assert.equal(meta.getHubResource('warp'), 4);
    assert.equal(meta.isSectorDiscovered('omega-4-belt'), true);
    assert.equal(changes, 1, 'one atomic write');
    assert.equal(meta.getStats().sectorsCharted, 1);
    assert.equal(meta.getStats().warpSpent, 1);
    assert.equal(meta.credits - creditsBefore, plan.rewards.credits);
    assert.equal(meta.reputation - repBefore, plan.rewards.rep);
    assert.equal(meta.getOre('red'), plan.rewards.ores.red);
});

test('chartSector refuses a repeat jump and an unaffordable one without touching the profile', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    meta.addWarp(5);
    assert.equal(meta.chartSector('omega-4-belt').ok, true);

    const repeat = meta.chartSector('omega-4-belt');
    assert.equal(repeat.ok, false);
    assert.equal(repeat.reason, 'sector already charted');

    // Terminator Core costs the most warp in the network.
    const broke = new MetaState(starterProfile({ credits: 0 }));
    const plan = broke.chartSector('terminus-core');
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /need \d+ warp cell/);
    assert.equal(broke.discoveredSectorIds().length, 0);
    assert.equal(broke.getStats().warpSpent || 0, 0);
});

test('chartSector gates threat-5 sectors behind REP tier 3 clearance', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    meta.addWarp(9);
    // The rack caps at warpCapacity(), so this is the full tank.
    const tank = meta.getHubResource('warp');
    assert.ok(tank >= 5);
    assert.equal(meta.reputationTier, 1);
    const blocked = meta.chartSector('terminus-core');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'requires REP tier 3 clearance');
    assert.equal(meta.getHubResource('warp'), tank, 'refused jump spends nothing');

    meta.addReputation(1200);
    assert.equal(meta.reputationTier, 3);
    assert.equal(meta.chartSector('terminus-core').ok, true);
});

test('discoverSector still works standalone for callers that pay the warp themselves', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    meta.addWarp(3);
    assert.equal(meta.spendWarp(1), true);
    const creditsBefore = meta.credits;
    const repBefore = meta.reputation;
    assert.equal(meta.discoverSector('gliese-fringe', { credits: 50, rep: 10 }), true);
    assert.equal(meta.credits - creditsBefore, 50);
    assert.equal(meta.reputation - repBefore, 10);
    assert.equal(meta.discoverSector('gliese-fringe', {}), false, 'no double chart');
});

// ---------------------------------------------------------------------------
// P8: settleActiveMission() — reward + job retirement in one write
// ---------------------------------------------------------------------------

function idleJobFixture(overrides = {}) {
    return {
        id: 'dispatch-1',
        missionId: 'mission-t3',
        title: 'Ice Survey',
        type: 'Exploration',
        dispatchMode: 'idle',
        risk: 2,
        rewardCredits: 500,
        shipId: 'ship-1',
        crewId: 'crew-1',
        startedAt: 1_000,
        endsAt: 2_000,
        claimed: false,
        ...overrides,
    };
}

test('settleActiveMission banks the settlement and retires the job in one change', () => {
    const profile = starterProfile({ credits: 0 });
    const meta = new MetaState(profile);
    const shipId = meta.fleetSnapshot()[0].id;
    const crewId = meta.crewSnapshot()[0].id;
    meta.setShipStatus(shipId, 'On Mission');
    meta.setCrewStatus(crewId, 'On Mission');
    meta.addActiveMission(idleJobFixture({ id: 'job-a', shipId, crewId }));

    const creditsBefore = meta.credits;
    let changes = 0;
    meta.on('change', () => { changes += 1; });

    const settlement = {
        missionId: 'mission-t3',
        jobId: 'job-a',
        dispatchMode: 'idle',
        won: true,
        credits: 620,
        ores: { red: 4 },
        rep: 30,
        crewId,
        crewXp: 40,
        shipId,
        hullDamage: 4,
        warp: 0,
        finalScore: 0,
    };
    meta.settleActiveMission('job-a', settlement);

    assert.equal(changes, 1, 'one atomic write');
    assert.equal(meta.activeMissionsSnapshot().length, 0, 'job retired');
    assert.equal(meta.fleetSnapshot().find((s) => s.id === shipId).status, 'Standby');
    assert.equal(meta.crewSnapshot().find((c) => c.id === crewId).status, 'Available');
    assert.equal(meta.credits - creditsBefore, 620);
    assert.equal(meta.getOre('red'), 4);
    assert.equal(meta.reputation, 30);
    assert.equal(meta.fleetSnapshot().find((s) => s.id === shipId).hull, 96);
    assert.equal(meta.getStats().idleClaims, 1);
    assert.ok(meta.completedMissionIds.includes('mission-t3'));
});

test('settleActiveMission on an abort pays the partial and counts the abort', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    const shipId = meta.fleetSnapshot()[0].id;
    const crewId = meta.crewSnapshot()[0].id;
    meta.addActiveMission(idleJobFixture({ id: 'job-b', shipId, crewId }));
    const creditsBefore = meta.credits;

    meta.settleActiveMission('job-b', {
        missionId: 'mission-t3',
        dispatchMode: 'idle',
        aborted: true,
        won: false,
        credits: 210,
        ores: {},
        rep: 5,
        crewId: null,
        crewXp: 0,
        shipId,
        hullDamage: 0,
    });

    assert.equal(meta.activeMissionsSnapshot().length, 0);
    assert.equal(meta.credits - creditsBefore, 210);
    assert.equal(meta.reputation, 5);
    assert.equal(meta.getStats().idleAborts, 1);
    assert.equal(meta.getStats().idleClaims || 0, 0, 'abort is not a claim');
    assert.equal(meta.crewSnapshot().find((c) => c.id === crewId).status, 'Available');
});

test('settleActiveMission tolerates an unknown job id (manual runs settle the same way)', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    let changes = 0;
    meta.on('change', () => { changes += 1; });
    const creditsBefore = meta.credits;
    meta.settleActiveMission('nope', { credits: 100, dispatchMode: 'manual', won: true, rep: 20 });
    assert.equal(changes, 1);
    assert.equal(meta.credits - creditsBefore, 100);
    assert.equal(meta.reputation, 20);
    assert.equal(meta.getStats().missionsCompleted, 1);
});

test('research riskRerolls lifts the daily board reroll cap', () => {
    const meta = new MetaState(starterProfile({ credits: 0 }));
    assert.equal(meta.getBoardState().rerollCap, 6);
    assert.equal(meta.getEffects().riskRerolls, 0);

    meta.completeResearch('countermeasures');
    const board = meta.getBoardState();
    assert.equal(meta.getEffects().riskRerolls, 1);
    assert.equal(board.rerollCap, 7, 'Countermeasures buys a seventh roll');
    assert.equal(board.canReroll, true);
    assert.equal(board.nextRerollCost, 150, 'ladder unchanged');

    // The seventh roll is buyable; the eighth is not.
    meta.setCredits(150 * 28);
    for (let i = 0; i < 7; i += 1) {
        assert.equal(meta.buyBoardReroll().ok, true, `roll ${i + 1}`);
    }
    const eighth = meta.buyBoardReroll();
    assert.equal(eighth.ok, false);
    assert.equal(eighth.reason, 'daily reroll limit reached');
});

// ---- fleet berths (P9 fix) -------------------------------------------

test('fleetSlots() reports base berths plus research extras', () => {
    const meta = new MetaState(starterProfile());
    assert.equal(meta.fleetSlots(), 10, 'a fresh station has its 10 berths');
    assert.ok(
        meta.fleetSlots() >= meta.fleetSnapshot().length,
        'the starter fleet fits inside the berth cap',
    );

    meta.startResearch('fuel-cell');
    meta.completeResearch('fuel-cell');
    assert.equal(meta.fleetSlots(), 12, 'Compact Fuel Cell adds two berths');
});
