// Reputation ladder + rep-gain math (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    REP_TIERS,
    MAX_REP_TIER,
    REP_GAIN,
    repForMission,
    repForSectorDiscovery,
    tierForRep,
    tierEntryForRep,
    repInfo,
    repTierRequiredForTierIndex,
    repTierRequiredForMission,
    isMissionUnlocked,
    repTierLabel,
} from '../src/reputation.js';

test('rep ladder starts at 0 and strictly increases', () => {
    assert.equal(REP_TIERS[0].tier, 1);
    assert.equal(REP_TIERS[0].threshold, 0);
    for (let i = 1; i < REP_TIERS.length; i += 1) {
        assert.equal(REP_TIERS[i].tier, REP_TIERS[i - 1].tier + 1);
        assert.ok(REP_TIERS[i].threshold > REP_TIERS[i - 1].threshold);
        assert.ok(REP_TIERS[i].title.length > 0);
    }
    assert.equal(MAX_REP_TIER, REP_TIERS.length);
});

test('tierForRep walks the ladder', () => {
    assert.equal(tierForRep(0), 1);
    assert.equal(tierForRep(399), 1);
    assert.equal(tierForRep(400), 2);
    assert.equal(tierForRep(1199), 2);
    assert.equal(tierForRep(1200), 3);
    assert.equal(tierForRep(999999), MAX_REP_TIER);
});

test('tierForRep clamps junk input', () => {
    assert.equal(tierForRep(-50), 1);
    assert.equal(tierForRep(NaN), 1);
    assert.equal(tierForRep(undefined), 1);
});

test('repInfo reports progress toward the next rank', () => {
    const info = repInfo(600);
    assert.equal(info.tier, 2);
    assert.equal(info.title, 'Journeyman Dispatcher');
    assert.equal(info.nextTier, 3);
    assert.equal(info.toNext, 600);
    assert.ok(info.progress > 0 && info.progress < 1);
    assert.equal(info.maxed, false);
});

test('repInfo at max rank is maxed with full progress', () => {
    const info = repInfo(10000);
    assert.equal(info.tier, MAX_REP_TIER);
    assert.equal(info.maxed, true);
    assert.equal(info.nextTier, null);
    assert.equal(info.progress, 1);
    assert.equal(info.toNext, 0);
});

test('repForMission scales with risk and tier index', () => {
    const low = repForMission({ risk: 1, tierIndex: 1 });
    const high = repForMission({ risk: 5, tierIndex: 9 });
    assert.ok(high > low);
    assert.equal(low, REP_GAIN.base + REP_GAIN.perRisk + REP_GAIN.perTierIndex);
});

test('losing a run still pays, but at the fail multiplier', () => {
    const won = repForMission({ risk: 3, tierIndex: 5, won: true });
    const lost = repForMission({ risk: 3, tierIndex: 5, won: false });
    assert.ok(lost > 0);
    assert.ok(lost < won);
    assert.equal(lost, Math.round(won * REP_GAIN.failMultiplier));
});

test('idle contracts pay less than hands-on runs', () => {
    const manual = repForMission({ risk: 3, tierIndex: 5, dispatchMode: 'manual' });
    const idle = repForMission({ risk: 3, tierIndex: 5, dispatchMode: 'idle' });
    assert.ok(idle < manual);
});

test('aborting an idle contract pays the abort fraction', () => {
    const aborted = repForMission({ risk: 4, tierIndex: 7, dispatchMode: 'idle', aborted: true });
    const full = repForMission({ risk: 4, tierIndex: 7, dispatchMode: 'idle' });
    assert.ok(aborted > 0 && aborted < full);
});

test('combat wins pay the hand-flown bonus, idle combat does not', () => {
    const combatManual = repForMission({ risk: 4, tierIndex: 7, type: 'Combat', dispatchMode: 'manual' });
    const miningManual = repForMission({ risk: 4, tierIndex: 7, type: 'Mining', dispatchMode: 'manual' });
    assert.equal(combatManual - miningManual, REP_GAIN.combatWinBonus);

    const combatIdle = repForMission({ risk: 4, tierIndex: 7, type: 'Combat', dispatchMode: 'idle' });
    const miningIdle = repForMission({ risk: 4, tierIndex: 7, type: 'Mining', dispatchMode: 'idle' });
    assert.equal(combatIdle, miningIdle);
});

test('reputation-boost research multiplies the payout', () => {
    const base = repForMission({ risk: 2, tierIndex: 3 });
    const boosted = repForMission({ risk: 2, tierIndex: 3, effects: { repMultiplier: 1.1 } });
    assert.equal(boosted, Math.round(base * 1.1));
});

test('rep is always a non-negative integer', () => {
    for (const risk of [-1, 0, 1, 3, 5, 99, NaN]) {
        for (const tierIndex of [0, 1, 9, 42, NaN]) {
            const rep = repForMission({ risk, tierIndex, effects: { repMultiplier: 0.001 } });
            assert.ok(Number.isInteger(rep) && rep >= 0, `risk ${risk} tier ${tierIndex} -> ${rep}`);
        }
    }
});

test('sector discovery pays its own flat rep', () => {
    assert.equal(repForSectorDiscovery(), REP_GAIN.sectorDiscovery);
    assert.equal(repForSectorDiscovery({ effects: { repMultiplier: 2 } }), REP_GAIN.sectorDiscovery * 2);
});

test('only T8/T9 are rep-gated', () => {
    for (let i = 1; i <= 9; i += 1) {
        const required = repTierRequiredForTierIndex(i);
        if (i === 8) assert.equal(required, 3);
        else if (i === 9) assert.equal(required, 4);
        else assert.equal(required, 1);
    }
});

test('isMissionUnlocked reads the mission record', () => {
    const t8 = { tierIndex: 8, repTierRequired: repTierRequiredForMission({ tierIndex: 8 }) };
    assert.equal(isMissionUnlocked(t8, 1), false);
    assert.equal(isMissionUnlocked(t8, 2), false);
    assert.equal(isMissionUnlocked(t8, 3), true);
    assert.equal(isMissionUnlocked({ tierIndex: 1 }, 1), true);
    assert.equal(isMissionUnlocked(null, 1), true);
});

test('repTierLabel is a short chip string', () => {
    assert.equal(repTierLabel(0), 'REP 1');
    assert.equal(repTierLabel(1200), 'REP 3');
});

test('tierEntryForRep is stable at exact thresholds', () => {
    REP_TIERS.forEach((entry) => {
        assert.equal(tierEntryForRep(entry.threshold).tier, entry.tier);
        assert.equal(tierEntryForRep(entry.threshold - 1).tier, Math.max(1, entry.tier - 1));
    });
});
