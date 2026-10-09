// Sector network: warp jumps, charted bonuses, station perks (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SECTORS,
    SECTOR_IDS,
    getSector,
    getSectorByName,
    isSectorDiscovered,
    warpCostFor,
    sectorRoster,
    bonusLabelFor,
    sectorBonusForMission,
    applyStationBonuses,
    plotCourse,
    discoveryProgress,
} from '../src/star-map.js';
import { buildMissions } from '../src/missions.js';
import { resolveEffects } from '../src/research.js';

test('sector records are complete and unique', () => {
    const ids = new Set();
    const names = new Set();
    SECTORS.forEach((sector) => {
        assert.ok(sector.id && sector.name, 'id + name');
        assert.equal(ids.has(sector.id), false, `duplicate id ${sector.id}`);
        assert.equal(names.has(sector.name), false, `duplicate name ${sector.name}`);
        ids.add(sector.id);
        names.add(sector.name);
        assert.ok(Number.isInteger(sector.warpCost) && sector.warpCost >= 1 && sector.warpCost <= 5);
        assert.ok(Number.isInteger(sector.threat) && sector.threat >= 1 && sector.threat <= 5);
        assert.ok(sector.brief.length > 0);
        assert.ok(sector.bonus || sector.stationBonus, `${sector.id} grants something`);
        assert.ok(sector.reward && (sector.reward.credits > 0 || sector.reward.minerals > 0));
    });
    assert.deepEqual(SECTOR_IDS, SECTORS.map((s) => s.id));
});

test('every mission sector is chartable on the star map', () => {
    const missions = buildMissions({ seed: 4242 });
    missions.forEach((m) => {
        assert.ok(getSectorByName(m.sector), `no sector named "${m.sector}" (from ${m.tierId})`);
    });
});

test('lookup helpers', () => {
    assert.equal(getSector('omega-4-belt').name, 'Omega-4 Belt');
    assert.equal(getSector('missing'), null);
    assert.equal(getSectorByName('Omega-4 Belt').id, 'omega-4-belt');
    assert.equal(getSectorByName('OMEGA-4 BELT').id, 'omega-4-belt');
    assert.equal(getSectorByName(null), null);
    assert.equal(isSectorDiscovered('omega-4-belt', []), false);
    assert.equal(isSectorDiscovered('omega-4-belt', ['omega-4-belt']), true);
    assert.equal(isSectorDiscovered('omega-4-belt', null), false);
});

test('warp coils shave one cell off every jump, never below zero', () => {
    const sector = getSector('omega-4-belt');
    assert.equal(warpCostFor(sector, null), 1);
    assert.equal(warpCostFor(sector, resolveEffects(['warp-coils'])), 0);
    const deep = getSector('terminus-core');
    assert.equal(warpCostFor(deep, null), 5);
    assert.equal(warpCostFor(deep, resolveEffects(['warp-coils'])), 4);
    assert.equal(warpCostFor(null, null), 0);
});

test('sectorRoster annotates cost, charted state and a printable bonus', () => {
    const roster = sectorRoster({ discoveredIds: ['omega-4-belt'], effects: resolveEffects(['warp-coils']) });
    assert.equal(roster.length, SECTORS.length);
    const belt = roster.find((s) => s.id === 'omega-4-belt');
    assert.equal(belt.charted, true);
    assert.equal(belt.cost, 0);
    assert.ok(belt.bonusLabel.includes('ore'));
});

test('bonusLabelFor describes both sector and station bonuses', () => {
    assert.ok(bonusLabelFor(getSector('seismic-rift')).includes('credits +16%'));
    assert.ok(bonusLabelFor(getSector('nova-bazaar')).includes('market sells +4%'));
    assert.ok(bonusLabelFor(getSector('driftyard-9')).includes('hull wear −10%'));
    assert.equal(bonusLabelFor(null), '');
    assert.equal(bonusLabelFor({ id: 'x' }), 'No bonus');
});

test('charting a sector applies its bonus to missions flown there', () => {
    const mission = buildMissions({ seed: 1 }).find((m) => m.sector === 'Seismic Rift');
    assert.ok(mission, 'a mission flies to Seismic Rift');

    const uncharted = sectorBonusForMission(mission, []);
    assert.equal(uncharted.charted, false);
    assert.equal(uncharted.creditMultiplier, 1);
    assert.equal(uncharted.oreMultiplier, 1);

    const charted = sectorBonusForMission(mission, ['seismic-rift']);
    assert.equal(charted.charted, true);
    assert.equal(charted.sectorId, 'seismic-rift');
    assert.ok(charted.creditMultiplier > 1);
});

test('a sector bonus never leaks to missions flying elsewhere', () => {
    const mission = buildMissions({ seed: 1 }).find((m) => m.sector === 'Omega-4 Belt');
    const bonus = sectorBonusForMission(mission, ['seismic-rift', 'terminus-core']);
    assert.equal(bonus.charted, false);
    assert.equal(bonus.creditMultiplier, 1);
    assert.equal(sectorBonusForMission(null, SECTOR_IDS).charted, false);
});

test('station bonuses fold onto the research bundle without mutating it', () => {
    const base = resolveEffects(['trade-compact']);
    const withStations = applyStationBonuses(base, ['nova-bazaar', 'driftyard-9']);
    assert.notEqual(withStations, base);
    assert.ok(Math.abs(base.marketSellBonus - 0.06) < 1e-9, 'input untouched');
    assert.ok(Math.abs(withStations.marketSellBonus - 0.10) < 1e-9, '0.06 + 0.04');
    assert.ok(Math.abs(withStations.hullDamageMultiplier - 0.90) < 1e-9);
});

test('uncharted hub sectors grant nothing station-wide', () => {
    const base = resolveEffects([]);
    const out = applyStationBonuses(base, []);
    assert.equal(out.marketSellBonus, base.marketSellBonus);
    assert.equal(out.hullDamageMultiplier, base.hullDamageMultiplier);
});

test('plotCourse refuses jumps you cannot pay for', () => {
    const res = plotCourse({ sectorId: 'terminus-deep', warp: 2, discoveredIds: [] });
    assert.equal(res.ok, false);
    assert.match(res.reason, /need 5 warp cells/);
    assert.equal(res.warpSpent, 0);
    assert.equal(res.newWarp, 2);
});

test('plotCourse refuses re-charting and unknown sectors', () => {
    assert.equal(plotCourse({ sectorId: 'omega-4-belt', warp: 9, discoveredIds: ['omega-4-belt'] }).reason, 'sector already charted');
    assert.equal(plotCourse({ sectorId: 'nowhere', warp: 9 }).reason, 'unknown sector');
});

test('threat-5 sectors need REP 3 clearance', () => {
    const blocked = plotCourse({ sectorId: 'terminus-core', warp: 9, repTier: 2 });
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /REP tier 3/);
    const cleared = plotCourse({ sectorId: 'terminus-core', warp: 9, repTier: 3 });
    assert.equal(cleared.ok, true);
});

test('a successful jump spends warp and pays the discovery grant', () => {
    const res = plotCourse({ sectorId: 'ironspan-flats', warp: 4, discoveredIds: [] });
    assert.equal(res.ok, true);
    assert.equal(res.warpSpent, 3);
    assert.equal(res.newWarp, 1);
    assert.ok(res.rewards.credits > 0);
    assert.ok(res.rewards.minerals > 0);
    assert.ok(res.rewards.rep > 0);
    assert.ok(res.rewards.ores.red > 0);
});

test('warp coils make cheap sectors free to reach', () => {
    const res = plotCourse({
        sectorId: 'omega-4-belt',
        warp: 1,
        effects: resolveEffects(['warp-coils']),
    });
    assert.equal(res.ok, true);
    assert.equal(res.warpSpent, 0);
    assert.equal(res.newWarp, 1);
});

test('a jump that finds a warp cell can leave you ahead', () => {
    const res = plotCourse({ sectorId: 'event-horizon', warp: 3, discoveredIds: [] });
    assert.equal(res.ok, true);
    assert.equal(res.warpSpent, 3);
    assert.equal(res.rewards.warp, 1);
    assert.equal(res.newWarp, 1);
});

test('discoveryProgress counts charted sectors', () => {
    assert.deepEqual(discoveryProgress([]), { charted: 0, total: SECTORS.length, pct: 0 });
    const half = SECTOR_IDS.slice(0, Math.floor(SECTORS.length / 2));
    const progress = discoveryProgress(half);
    assert.equal(progress.charted, half.length);
    assert.ok(progress.pct > 0 && progress.pct < 1);
    assert.equal(discoveryProgress(SECTOR_IDS).charted, SECTORS.length);
});
