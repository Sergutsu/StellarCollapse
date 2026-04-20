// Unit tests for the mission catalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMissions,
    findMission,
    baseCreditsFor,
    ORES,
    ORE_BY_COLOR,
} from '../src/missions.js';
import { HIGHSCORE_TIERS, NORMAL_COLORS, PIECE_COMPLEXITY } from '../src/constants.js';

test('buildMissions returns one mission per ranked tier', () => {
    const list = buildMissions();
    assert.equal(list.length, HIGHSCORE_TIERS.length);
    list.forEach((m, i) => {
        assert.equal(m.tierId, HIGHSCORE_TIERS[i].id);
        assert.equal(m.tierIndex, i + 1);
        assert.equal(m.tierColor, HIGHSCORE_TIERS[i].color);
        assert.equal(m.gameConfig.mode, HIGHSCORE_TIERS[i].mode);
        assert.equal(m.gameConfig.complexity, HIGHSCORE_TIERS[i].complexity);
        assert.ok(['small', 'medium', 'large'].includes(m.gameConfig.fieldSizeId));
    });
});

test('seeded buildMissions is deterministic', () => {
    const a = buildMissions({ seed: 1234 });
    const b = buildMissions({ seed: 1234 });
    assert.deepEqual(a.map((m) => m.name), b.map((m) => m.name));
});

test('different seeds pick different asteroid names (probabilistic)', () => {
    // Each tier has 3 flavor names; two distinct seeds should diverge on
    // at least one tier almost always. Pick two seeds and require any
    // single name difference.
    const a = buildMissions({ seed: 1 });
    const b = buildMissions({ seed: 42 });
    const differs = a.some((m, i) => m.name !== b[i].name);
    assert.ok(differs, 'expected seeded mission lists to differ on at least one tier');
});

test('baseCreditsFor scales linearly with tier index', () => {
    assert.equal(baseCreditsFor(1), 100);
    assert.equal(baseCreditsFor(5), 500);
    assert.equal(baseCreditsFor(9), 900);
});

test('every mission is currently available (no lock gates yet)', () => {
    const list = buildMissions({ seed: 7 });
    list.forEach((m) => assert.equal(m.available, true));
});

test('expectedOres always contains the four normal ores', () => {
    const list = buildMissions({ seed: 7 });
    list.forEach((m) => {
        NORMAL_COLORS.forEach((c) => {
            const ore = ORE_BY_COLOR[c];
            assert.ok(m.expectedOres.includes(ore.id), `${m.tierId} missing ${ore.id}`);
        });
    });
});

test('collapsed missions preview rare ores (volatiles / biomass)', () => {
    const list = buildMissions({ seed: 7 });
    list.forEach((m) => {
        const ranked = HIGHSCORE_TIERS.find((t) => t.id === m.tierId);
        if (ranked.complexity === PIECE_COMPLEXITY.COLLAPSED) {
            assert.ok(m.expectedOres.includes('volatiles'));
            assert.ok(m.expectedOres.includes('biomass'));
        } else {
            assert.ok(!m.expectedOres.includes('volatiles'));
            assert.ok(!m.expectedOres.includes('biomass'));
        }
    });
});

test('findMission looks up by id and returns null for unknown', () => {
    const list = buildMissions({ seed: 7 });
    assert.equal(findMission(list, list[3].id), list[3]);
    assert.equal(findMission(list, 'mission-unknown'), null);
    assert.equal(findMission(null, 'mission-x'), null);
});

test('ORES catalog covers every normal color exactly once', () => {
    const coloredIds = ORES.filter((o) => NORMAL_COLORS.includes(o.color)).map((o) => o.color);
    assert.equal(coloredIds.length, NORMAL_COLORS.length);
    NORMAL_COLORS.forEach((c) => assert.ok(coloredIds.includes(c), `missing ore for color ${c}`));
});
