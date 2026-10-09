// Dispatch settlement: the single reward path for manual + idle missions (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    HULL_WEAR,
    environmentLevelForMission,
    idleEtaSecForMission,
    resolveDispatch,
    expectedRewardOres,
    scaleOreCounts,
    hullDamageFor,
    settleMission,
} from '../src/settlement.js';
import { buildMissions } from '../src/missions.js';
import { resolveEffects, BASE_EFFECTS, NODES } from '../src/research.js';
import { SECTOR_IDS, getSectorByName } from '../src/star-map.js';
import { repForMission } from '../src/reputation.js';
import { xpForMission } from '../src/crew.js';
import { PIECE_COMPLEXITY } from '../src/constants.js';

const missions = buildMissions({ seed: 4242, repTier: 6 });
const mining = missions.find((m) => m.tierId === 'stellar-classic');
const hard = missions.find((m) => m.tierId === 'blocks-collapsed');
const ship = { id: 'ship-3', name: 'Prospector', className: 'Resource', hull: 100, status: 'Standby' };
const crew = { id: 'crew-2', name: 'T. Halveri', role: 'Engineer', level: 3, xp: 480, status: 'Available' };
// The sector each test mission actually flies to (combat variants relocate
// their tier, so never hard-code the sector id).
const hardSectorId = getSectorByName(hard.sector).id;
const miningSectorId = getSectorByName(mining.sector).id;

test('environmentLevelForMission reads complexity', () => {
    assert.equal(environmentLevelForMission({ gameConfig: { complexity: PIECE_COMPLEXITY.CLASSIC } }), 1);
    assert.equal(environmentLevelForMission({ gameConfig: { complexity: PIECE_COMPLEXITY.MUTATED } }), 2);
    assert.equal(environmentLevelForMission({ gameConfig: { complexity: PIECE_COMPLEXITY.COLLAPSED } }), 3);
    assert.equal(environmentLevelForMission(null), 1);
});

test('idle ETA grows with tier + environment and shrinks for a fitted ship', () => {
    const unfit = idleEtaSecForMission(hard, { shipTypeMatch: false });
    const fit = idleEtaSecForMission(hard, { shipTypeMatch: true });
    assert.ok(fit < unfit);
    assert.ok(unfit > idleEtaSecForMission(mining, { shipTypeMatch: false }), 'harder missions take longer');
});

test('ion thrusters and a charted sector both shorten the ETA', () => {
    const plain = idleEtaSecForMission(hard, { shipTypeMatch: false });
    const thrusters = idleEtaSecForMission(hard, { shipTypeMatch: false, effects: resolveEffects(['ion-thrusters']) });
    assert.ok(thrusters < plain);
    const surveyed = idleEtaSecForMission(hard, { shipTypeMatch: false, sectorBonus: { etaMultiplier: 0.9 } });
    assert.ok(surveyed < plain);
    assert.ok(idleEtaSecForMission(hard, { effects: { etaMultiplier: 0 } }) >= 45, 'ETA never collapses to zero');
});

test('expectedRewardOres splits the preview into common + rare lanes', () => {
    const lanes = expectedRewardOres(hard);
    assert.equal(lanes.common.length, 2);
    assert.equal(lanes.rare.length, 1);
    assert.ok(lanes.rare.every((id) => id === 'volatiles' || id === 'biomass'));
    assert.deepEqual(expectedRewardOres(null), { common: [], rare: [] });
});

test('resolveDispatch prices a contract with crew + ship + sector + tech', () => {
    const plain = resolveDispatch({ mission: mining, ship, crew });
    assert.ok(plain.rewardCredits >= 60);
    assert.ok(plain.etaSec >= 45);
    assert.equal(plain.threatLevel, mining.risk);
    assert.equal(plain.environmentLevel, 1);
    assert.equal(plain.shipTypeMatch, true, 'a Resource hull is built for Mining');

    const offSpec = resolveDispatch({ mission: mining, ship: { ...ship, className: 'Scout' }, crew });
    assert.equal(offSpec.shipTypeMatch, false);
    assert.ok(offSpec.rewardCredits < plain.rewardCredits, 'an off-spec hull pays less');
});

test('resolveDispatch: a charted credit sector lifts the contract price', () => {
    // Seismic Rift pays a credit bonus, so use a mission that flies there.
    const rift = missions.find((m) => m.sector === 'Seismic Rift');
    assert.ok(rift, 'a mission flies to Seismic Rift');
    const sectorId = getSectorByName(rift.sector).id;

    const uncharted = resolveDispatch({ mission: rift, ship, crew, discoveredSectors: [] });
    const charted = resolveDispatch({ mission: rift, ship, crew, discoveredSectors: [sectorId] });
    assert.equal(uncharted.sectorCharted, false);
    assert.equal(charted.sectorCharted, true);
    assert.ok(charted.rewardCredits > uncharted.rewardCredits);
    assert.ok(charted.creditsBreakdown.some((row) => row.label.includes('charted')));
});

test('resolveDispatch: a charted survey sector shortens the ETA instead', () => {
    const uncharted = resolveDispatch({ mission: hard, ship, crew, discoveredSectors: [] });
    const charted = resolveDispatch({ mission: hard, ship, crew, discoveredSectors: [hardSectorId] });
    assert.equal(charted.sectorCharted, true);
    const bonus = getSectorByName(hard.sector).bonus || {};
    if (bonus.etaMultiplier) assert.ok(charted.etaSec <= uncharted.etaSec);
    if (bonus.creditMultiplier) assert.ok(charted.rewardCredits > uncharted.rewardCredits);
    assert.ok(charted.etaSec >= 45);
});

test('resolveDispatch credits breakdown sums to the payout', () => {
    const priced = resolveDispatch({ mission: hard, ship, crew, discoveredSectors: [hardSectorId] });
    const total = priced.creditsBreakdown.reduce((sum, row) => sum + row.amount, 0);
    assert.ok(Math.abs(total - priced.rewardCredits) <= 2, `${total} vs ${priced.rewardCredits}`);
});

// ---- ore scaling ------------------------------------------------------

test('scaleOreCounts rounds but never deletes a haul', () => {
    const scaled = scaleOreCounts({ red: 3, blue: 1 }, 0.5);
    assert.equal(scaled.red, 2);
    assert.equal(scaled.blue, 1, 'a single unit survives a harsh multiplier');
    assert.equal(scaled.green, undefined, 'unmined colours stay absent');
});

test('scaleOreCounts boosts with research + sector multipliers', () => {
    const scaled = scaleOreCounts({ red: 100 }, 1.12 * 1.06);
    assert.ok(scaled.red > 100);
    assert.deepEqual(scaleOreCounts({ red: 100 }, 1), { red: 100 });
});

test('the mining laser banks an extra hazard ore only when one was mined', () => {
    const withRare = scaleOreCounts({ red: 10, bomb: 2 }, 1, { rareBonus: 1 });
    assert.equal(withRare.bomb, 3);
    const without = scaleOreCounts({ red: 10 }, 1, { rareBonus: 1 });
    assert.equal(without.bomb, undefined);
    assert.equal(without.red, 10);
});

test('scaleOreCounts ignores junk', () => {
    assert.deepEqual(scaleOreCounts(null, NaN), {});
    assert.deepEqual(scaleOreCounts({ red: -5 }, 1), { red: 0 });
    assert.deepEqual(scaleOreCounts({ red: 2.9 }, 1), { red: 2 });
});

// ---- hull wear --------------------------------------------------------

test('hull wear scales with risk and failure', () => {
    assert.equal(hullDamageFor({ risk: 1, won: true }).damage, HULL_WEAR.perRisk);
    assert.equal(hullDamageFor({ risk: 5, won: true }).damage, 10);
    assert.ok(hullDamageFor({ risk: 5, won: false }).damage > hullDamageFor({ risk: 5, won: true }).damage);
});

test('idle contracts wear the hull less than hand-flown runs', () => {
    const manual = hullDamageFor({ risk: 4, dispatchMode: 'manual' }).damage;
    const idle = hullDamageFor({ risk: 4, dispatchMode: 'idle' }).damage;
    assert.ok(idle < manual);
});

test('hull plating, countermeasures and the repair yard stack', () => {
    const plain = hullDamageFor({ risk: 5 }).damage;
    const plated = hullDamageFor({ risk: 5, effects: resolveEffects(['hull-plating']) }).damage;
    const yard = hullDamageFor({ risk: 5, effects: resolveEffects(['hull-plating', 'countermeasures']) }).damage;
    assert.ok(plated < plain);
    assert.ok(yard <= plated);
});

test('a shield array absorbs a flat chunk and reports it', () => {
    const res = hullDamageFor({ risk: 5, effects: resolveEffects(['shield-array']) });
    assert.equal(res.absorbed, HULL_WEAR.shieldAbsorb);
    assert.equal(res.damage, 10 - HULL_WEAR.shieldAbsorb);
});

// ---- settlement -------------------------------------------------------

test('a manual run settles credits, ore, rep, XP, hull and warp', () => {
    const summary = { credits: 400, ores: { red: 30, blue: 12, bomb: 2 }, finalScore: 3000, won: true };
    const s = settleMission({ mission: hard, summary, ship, crew, dispatchMode: 'manual' });

    assert.equal(s.ok, true);
    assert.equal(s.dispatchMode, 'manual');
    assert.equal(s.missionId, hard.id);
    assert.ok(s.credits >= summary.credits, 'crew + ship factors never reduce a payout below the run haul');
    assert.ok(s.ores.red >= 30);
    assert.ok(s.rep > 0);
    assert.equal(s.rep, repForMission({ risk: hard.risk, tierIndex: hard.tierIndex, type: hard.type, won: true, dispatchMode: 'manual', effects: BASE_EFFECTS }));
    assert.equal(s.crewXp, xpForMission({ risk: hard.risk, tierIndex: hard.tierIndex, role: crew.role, type: hard.type, won: true, dispatchMode: 'manual' }));
    assert.ok(s.hullDamage > 0);
    assert.equal(s.shipId, ship.id);
    assert.equal(s.crewId, crew.id);
    assert.ok(Array.isArray(s.log));
});

test('crew level and ship fit both move the payout', () => {
    const summary = { credits: 500, ores: { red: 10 } };
    const offSpec = { ...ship, className: 'Scout' };
    const rookie = settleMission({ mission: mining, summary, ship: offSpec, crew: { ...crew, level: 1 }, dispatchMode: 'manual' });
    const veteran = settleMission({ mission: mining, summary, ship: offSpec, crew: { ...crew, level: 10 }, dispatchMode: 'manual' });
    assert.ok(veteran.credits > rookie.credits);
    assert.ok(rookie.creditsBreakdown.some((row) => row.label.includes('off-spec')));

    const fitted = settleMission({ mission: mining, summary, ship: { ...ship, className: 'Resource' }, crew: { ...crew, level: 1 }, dispatchMode: 'manual' });
    assert.ok(fitted.credits > rookie.credits, 'a fitted hull pays the fit bonus');
    assert.ok(fitted.creditsBreakdown.some((row) => row.label.includes('fit')));
});

test('a charted sector pays more and says so in the log', () => {
    const rift = missions.find((m) => m.sector === 'Seismic Rift');
    const sectorId = getSectorByName(rift.sector).id;
    const summary = { credits: 500, ores: { red: 10 } };
    const plain = settleMission({ mission: rift, summary, ship, crew });
    const charted = settleMission({ mission: rift, summary, ship, crew, discoveredSectors: [sectorId] });
    assert.ok(charted.credits > plain.credits, 'Seismic Rift pays a credit bonus');
    assert.ok(charted.ores.red >= plain.ores.red, 'and an ore bonus');
    assert.equal(charted.rep, plain.rep, 'Seismic Rift grants no rep bonus, so rep is unchanged');
    assert.ok(charted.log.some((line) => line.includes('charted')));
    assert.equal(charted.sectorCharted, true);
});

test('research effects flow through settlement', () => {
    const summary = { credits: 500, ores: { red: 100 } };
    const plain = settleMission({ mission: mining, summary, ship, crew });
    const laser = settleMission({ mission: mining, summary, ship, crew, effects: resolveEffects(['mining-laser']) });
    assert.ok(laser.ores.red > plain.ores.red);
    assert.ok(laser.log.some((line) => line.includes('Ore yield')));

    const boost = settleMission({ mission: mining, summary, ship, crew, effects: resolveEffects(['reputation-boost']) });
    assert.ok(boost.rep > plain.rep);

    const thrusters = settleMission({ mission: mining, summary, ship, crew, effects: resolveEffects(['hull-plating']) });
    assert.ok(thrusters.hullDamage <= plain.hullDamage);
});

test('a combat win pays the combat rep bonus and can find a warp cell', () => {
    const combat = missions.find((m) => m.variant === 'combat') || { ...mining, type: 'Combat', risk: 4, tierIndex: 7 };
    const summary = { credits: 300, ores: { red: 9, bomb: 4, snake: 3 }, won: true };
    const s = settleMission({ mission: { ...combat, type: 'Combat' }, summary, ship, crew });
    assert.equal(s.warp, 1);
    assert.equal(s.type, 'Combat');
    const mined = settleMission({ mission: { ...combat, type: 'Mining' }, summary, ship, crew });
    assert.equal(mined.warp, 0);
    assert.ok(s.rep > mined.rep, 'combat win bonus');
});

test('a lost defense run still banks part of the haul', () => {
    const combat = { ...hard, type: 'Combat' };
    const won = settleMission({ mission: combat, summary: { credits: 400, ores: { red: 20 }, won: true }, ship, crew });
    const lost = settleMission({ mission: combat, summary: { credits: 400, ores: { red: 20 }, won: false }, ship, crew, won: false });
    assert.ok(lost.rep < won.rep);
    assert.ok(lost.crewXp < won.crewXp);
    assert.ok(lost.hullDamage > won.hullDamage);
    assert.equal(lost.warp, 0);
    assert.equal(lost.credits, won.credits, 'ore already mined is still banked');
});

test('idle settlements pay the baked contract, not the run ledger', () => {
    const priced = resolveDispatch({ mission: hard, ship, crew, discoveredSectors: ['terminus-deep'] });
    const job = {
        id: 'dispatch-1',
        missionId: hard.id,
        title: hard.narrativeName,
        type: hard.type,
        risk: hard.risk,
        rewardCredits: priced.rewardCredits,
        rewardOres: priced.rewardOres,
        shipId: ship.id,
        crewId: crew.id,
        startedAt: Date.now() - 600_000,
        etaSec: 600,
        endsAt: Date.now(),
    };
    const s = settleMission({ mission: hard, job, ship, crew, dispatchMode: 'idle', discoveredSectors: [hardSectorId] });
    assert.equal(s.dispatchMode, 'idle');
    assert.equal(s.credits, priced.rewardCredits);
    const oreUnits = Object.values(s.ores).reduce((a, b) => a + b, 0);
    assert.ok(oreUnits > 0, 'idle contracts haul ore in bulk');
    assert.ok(s.rep > 0 && s.crewXp > 0);
});

test('aborting an idle contract pays a partial and skips ore + XP', () => {
    const now = Date.now();
    const job = {
        id: 'dispatch-2', missionId: hard.id, type: hard.type, risk: hard.risk,
        rewardCredits: 600, rewardOres: { common: ['pyrite', 'cryonite'], rare: ['volatiles'] },
        shipId: ship.id, crewId: crew.id, startedAt: now - 300_000, etaSec: 600, endsAt: now + 300_000,
    };
    const s = settleMission({ mission: hard, job, ship, crew, dispatchMode: 'idle', aborted: true });
    assert.equal(s.aborted, true);
    assert.ok(s.credits > 0 && s.credits < 600, 'roughly half way through');
    assert.deepEqual(s.ores, {});
    assert.equal(s.crewXp, 0);
    assert.equal(s.hullDamage, 0);
    assert.ok(s.log.some((line) => line.includes('returned early')));
});

test('settlement survives missing ship/crew/mission data', () => {
    const s = settleMission({ summary: { credits: 100, ores: { red: 4 } } });
    assert.equal(s.ok, true);
    assert.ok(s.credits >= 0);
    assert.equal(s.shipId, null);
    assert.equal(s.crewId, null);
    assert.equal(s.crewLevel, null);
    assert.ok(Number.isInteger(s.rep));
    const empty = settleMission({});
    assert.equal(empty.credits, 0);
    assert.deepEqual(empty.ores, {});
});

test('settlement carries the run report fields the results scene needs', () => {
    const summary = { credits: 250, ores: { red: 5 }, finalScore: 2500, statLabels: { level: 'WAVE' }, minigame: 'defense' };
    const s = settleMission({ mission: mining, summary, ship, crew });
    assert.equal(s.finalScore, 2500);
    assert.equal(s.minigame, 'defense');
    assert.deepEqual(s.statLabels, { level: 'WAVE' });
    assert.equal(s.variant, mining.variant);
});

test('all charted sectors never produce a runaway payout', () => {
    const summary = { credits: 900, ores: { red: 40, blue: 40, green: 40, yellow: 40, bomb: 8, snake: 8 } };
    const everything = resolveEffects(NODES.map((n) => n.id));
    const s = settleMission({
        mission: hard,
        summary,
        ship,
        crew,
        effects: everything,
        discoveredSectors: SECTOR_IDS,
    });
    assert.ok(s.credits < summary.credits * 8, `payout ${s.credits} exploded`);
    assert.ok(s.ores.red < 400);
});
