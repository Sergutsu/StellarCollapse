// Crew progression: XP curve, roster slots, hiring, role affinity (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BASE_CREW_SLOTS,
    MAX_CREW_LEVEL,
    CREW_XP_GAIN,
    ROLE_AFFINITY,
    HIRE_BASE_COST,
    DISMISS_RETURN,
    xpForLevel,
    levelForXp,
    crewProgress,
    xpForMission,
    awardCrewXp,
    crewSlotLimit,
    fleetSlotLimit,
    BASE_FLEET_SLOTS,
    hireCost,
    skillFactor,
    shipFactor,
    shipMatchesType,
    roleMatchesType,
} from '../src/crew.js';
import { resolveEffects } from '../src/research.js';

test('the XP curve starts at zero and strictly increases to the cap', () => {
    assert.equal(xpForLevel(1), 0);
    for (let level = 2; level <= MAX_CREW_LEVEL; level += 1) {
        assert.ok(xpForLevel(level) > xpForLevel(level - 1), `level ${level}`);
    }
    assert.ok(Number.isInteger(xpForLevel(MAX_CREW_LEVEL)));
});

test('xpForLevel clamps out-of-range levels', () => {
    assert.equal(xpForLevel(0), 0);
    assert.equal(xpForLevel(-4), 0);
    assert.equal(xpForLevel(MAX_CREW_LEVEL + 5), xpForLevel(MAX_CREW_LEVEL));
    assert.equal(xpForLevel(NaN), 0);
});

test('levelForXp is the inverse of xpForLevel', () => {
    for (let level = 1; level < MAX_CREW_LEVEL; level += 1) {
        assert.equal(levelForXp(xpForLevel(level)), level);
        assert.equal(levelForXp(xpForLevel(level + 1) - 1), level);
    }
    assert.equal(levelForXp(0), 1);
    assert.equal(levelForXp(-100), 1);
    assert.equal(levelForXp(10 ** 9), MAX_CREW_LEVEL);
});

test('crewProgress reads a live member', () => {
    const member = { level: 2, xp: xpForLevel(2) + 30 };
    const p = crewProgress(member);
    assert.equal(p.level, 2);
    assert.equal(p.xpIntoLevel, 30);
    assert.equal(p.xpForNext, xpForLevel(3) - xpForLevel(2) - 30);
    assert.ok(p.progress > 0 && p.progress < 1);
    assert.equal(p.maxed, false);
});

test('crewProgress backfills XP for legacy members with a level but no XP', () => {
    const legacy = { level: 4 };
    const p = crewProgress(legacy);
    assert.equal(p.level, 4);
    assert.equal(p.xp, xpForLevel(4));
    assert.equal(p.xpIntoLevel, 0);
    assert.equal(p.progress, 0);
});

test('crewProgress at the cap reports maxed', () => {
    const p = crewProgress({ level: MAX_CREW_LEVEL, xp: xpForLevel(MAX_CREW_LEVEL) + 5000 });
    assert.equal(p.level, MAX_CREW_LEVEL);
    assert.equal(p.maxed, true);
    assert.equal(p.progress, 1);
    assert.equal(p.xpForNext, 0);
});

test('crewProgress tolerates junk', () => {
    const p = crewProgress(null);
    assert.equal(p.level, 1);
    assert.equal(p.xp, 0);
    assert.equal(p.progress, 0);
});

test('xpForMission scales with risk, tier and outcome', () => {
    const small = xpForMission({ risk: 1, tierIndex: 1 });
    const big = xpForMission({ risk: 5, tierIndex: 9 });
    assert.ok(big > small);
    assert.equal(small, CREW_XP_GAIN.base + CREW_XP_GAIN.perRisk + CREW_XP_GAIN.perTierIndex);
    assert.ok(xpForMission({ risk: 3, tierIndex: 5, won: false }) < xpForMission({ risk: 3, tierIndex: 5 }));
    assert.ok(xpForMission({ risk: 3, tierIndex: 5, dispatchMode: 'idle' }) < xpForMission({ risk: 3, tierIndex: 5 }));
});

test('a matching specialist earns the role bonus', () => {
    const plain = xpForMission({ risk: 3, tierIndex: 5, role: 'Medic', type: 'Mining' });
    const matched = xpForMission({ risk: 3, tierIndex: 5, role: 'Engineer', type: 'Mining' });
    assert.equal(matched, Math.round(plain * CREW_XP_GAIN.roleMatchMultiplier));
});

test('role affinity table covers every documented role', () => {
    const expected = {
        Captain: ['Combat', 'Exploration'],
        Tactician: ['Combat'],
        Engineer: ['Mining'],
        Navigator: ['Exploration'],
        Scientist: ['Research'],
        Quartermaster: ['Salvage', 'Mining'],
        Medic: ['Salvage', 'Combat'],
        Pilot: ['Exploration', 'Combat'],
    };
    for (const [role, types] of Object.entries(expected)) {
        assert.deepEqual([...ROLE_AFFINITY[role]], types, role);
        types.forEach((t) => assert.equal(roleMatchesType(role, t), true));
    }
    assert.equal(roleMatchesType('Engineer', 'Combat'), false);
    assert.equal(roleMatchesType('Ghost', 'Mining'), false);
    assert.equal(roleMatchesType(null, null), false);
});

test('awardCrewXp levels a member up and never down', () => {
    const rookie = { level: 1, xp: 0 };
    const first = awardCrewXp(rookie, xpForLevel(2));
    assert.equal(first.level, 2);
    assert.equal(first.levelsGained, 1);
    assert.equal(first.xp, xpForLevel(2));
    // The input was not mutated.
    assert.equal(rookie.level, 1);
    assert.equal(rookie.xp, 0);

    const legacy = { level: 6 };
    const after = awardCrewXp(legacy, 10);
    assert.equal(after.level, 6, 'a veteran is not demoted by a small grant');
    assert.equal(after.levelsGained, 0);
    assert.ok(after.xp >= xpForLevel(6));
});

test('awardCrewXp can jump several levels and stops at the cap', () => {
    const jumped = awardCrewXp({ level: 1, xp: 0 }, xpForLevel(5));
    assert.equal(jumped.level, 5);
    assert.equal(jumped.levelsGained, 4);
    const capped = awardCrewXp({ level: MAX_CREW_LEVEL - 1, xp: xpForLevel(MAX_CREW_LEVEL - 1) }, 10 ** 7);
    assert.equal(capped.level, MAX_CREW_LEVEL);
    const zero = awardCrewXp({ level: 3, xp: xpForLevel(3) }, 0);
    assert.equal(zero.levelsGained, 0);
});

test('crew slots start at the base and grow with Habitat Extension', () => {
    assert.equal(crewSlotLimit(null), BASE_CREW_SLOTS);
    assert.equal(crewSlotLimit(resolveEffects([])), BASE_CREW_SLOTS);
    assert.equal(crewSlotLimit(resolveEffects(['habitat-extension'])), BASE_CREW_SLOTS + 1);
});

test('hiring gets more expensive as the roster grows', () => {
    assert.equal(hireCost(0), HIRE_BASE_COST);
    assert.equal(hireCost(5), HIRE_BASE_COST);
    assert.ok(hireCost(6) > hireCost(5));
    assert.ok(hireCost(10) > hireCost(7));
    assert.ok(Number.isInteger(hireCost(12)));
    assert.ok(DISMISS_RETURN > 0 && DISMISS_RETURN < 1);
});

test('skillFactor matches the payout curve the hub has used since P4', () => {
    assert.equal(skillFactor(1), 1);
    assert.ok(Math.abs(skillFactor(4) - 1.12) < 1e-9);
    assert.equal(skillFactor(0), 1);
    assert.equal(skillFactor(-3), 1);
    assert.ok(skillFactor(20) > skillFactor(10));
});

test('every hull class has a specialty and every mission type has a hull', () => {
    const pairs = {
        Scout: 'Exploration',
        Defense: 'Combat',
        Frigate: 'Combat',
        Corvette: 'Combat',
        Resource: 'Mining',
        Terraform: 'Research',
        Trade: 'Salvage',
    };
    for (const [className, type] of Object.entries(pairs)) {
        assert.equal(shipMatchesType(className, type), true, `${className} fits ${type}`);
        assert.ok(shipFactor(className, type) > 1, `${className} pays the fit bonus on ${type}`);
    }
    ['Mining', 'Exploration', 'Research', 'Salvage', 'Combat'].forEach((type) => {
        const covered = Object.keys(pairs).some((c) => shipMatchesType(c, type));
        assert.ok(covered, `some hull fits ${type}`);
    });
});

test('off-spec hulls pay the mismatch factor; unknown classes fall back to substring matching', () => {
    assert.equal(shipMatchesType('Resource', 'Combat'), false);
    assert.equal(shipMatchesType('Scout', 'Mining'), false);
    assert.ok(shipFactor('Scout', 'Mining') < 1);
    assert.equal(shipFactor(null, null), shipFactor('Scout', 'Mining'));
    assert.equal(shipMatchesType('Mining Barge', 'Mining'), true);
    assert.equal(shipMatchesType('Heavy Miner', 'Mining'), false);
    assert.equal(shipMatchesType(null, 'Mining'), false);
});

// ---- fleet berths ----------------------------------------------------

test('berth capacity is base berths plus the tech extras', () => {
    assert.equal(BASE_FLEET_SLOTS, 10);
    assert.equal(fleetSlotLimit(null), BASE_FLEET_SLOTS, 'no bundle = base berths');
    assert.equal(fleetSlotLimit({}), BASE_FLEET_SLOTS);
    // A fresh profile resolves to BASE_EFFECTS, whose fleetSlots is 0 —
    // that is an *extras* counter, so the station still has its 10 berths.
    assert.equal(fleetSlotLimit(resolveEffects([])), BASE_FLEET_SLOTS);
    assert.equal(fleetSlotLimit(resolveEffects(['fuel-cell'])), BASE_FLEET_SLOTS + 2);
    assert.equal(fleetSlotLimit(resolveEffects(['fuel-cell', 'warp-coils'])), BASE_FLEET_SLOTS + 4);
    assert.equal(
        fleetSlotLimit(resolveEffects(['fuel-cell', 'warp-coils', 'habitat-extension', 'shield-array'])),
        BASE_FLEET_SLOTS + 6,
    );
});

test('berth capacity never drops below the base and ignores junk input', () => {
    assert.equal(fleetSlotLimit({ fleetSlots: -5 }), BASE_FLEET_SLOTS, 'negative extras clamp');
    assert.equal(fleetSlotLimit({ fleetSlots: 2.7 }), BASE_FLEET_SLOTS + 2, 'floors');
    assert.equal(fleetSlotLimit({ fleetSlots: NaN }), BASE_FLEET_SLOTS);
    assert.equal(fleetSlotLimit({ fleetSlots: '3' }), BASE_FLEET_SLOTS, 'non-numeric ignored');
    assert.ok(fleetSlotLimit(null) >= 4, 'the four-ship starter fleet always fits');
});
