// Unit tests for the mission catalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMissions,
    findMission,
    baseCreditsFor,
    pickMissionBoard,
    MISSION_TYPES,
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

// -- Hub narrative metadata & MISSION BOARD roll ----------------------

test('every mission carries narrative metadata (name, type, sector, risk, ETA)', () => {
    const list = buildMissions({ seed: 99 });
    list.forEach((m) => {
        assert.equal(typeof m.narrativeName, 'string', `${m.tierId} narrativeName`);
        assert.ok(m.narrativeName.length > 0, `${m.tierId} narrativeName not empty`);
        assert.ok(MISSION_TYPES.includes(m.type), `${m.tierId} type is one of MISSION_TYPES`);
        assert.equal(typeof m.sector, 'string');
        assert.ok(m.sector.length > 0);
        assert.ok(Number.isInteger(m.risk));
        assert.ok(m.risk >= 1 && m.risk <= 5, `${m.tierId} risk in 1..5`);
        assert.equal(typeof m.etaLabel, 'string');
        assert.match(m.etaLabel, /\d/, `${m.tierId} etaLabel mentions a number`);
    });
});

test('narrative catalog spans every risk tier 1..5', () => {
    const list = buildMissions();
    const risks = new Set(list.map((m) => m.risk));
    for (let r = 1; r <= 5; r += 1) {
        assert.ok(risks.has(r), `missing narrative mission with risk ${r}`);
    }
});

test('pickMissionBoard returns a deterministic subset for a given seed', () => {
    const list = buildMissions({ seed: 7 });
    const a = pickMissionBoard(list, { count: 4, seed: 123 });
    const b = pickMissionBoard(list, { count: 4, seed: 123 });
    assert.equal(a.length, 4);
    assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
});

test('pickMissionBoard produces different boards across many seed pairs', () => {
    // Bucket sizes (risk 1..5) are 2/2/1/2/2 across the 9 missions, so a
    // specific pair of seeds can coincidentally land on the same 4-card
    // roll. Probe several pairs and require at least one divergence.
    const list = buildMissions({ seed: 7 });
    const sample = [1, 2, 7, 42, 1337, 99999].map((s) => pickMissionBoard(list, { count: 4, seed: s }));
    const keys = sample.map((board) => board.map((m) => m.id).join('|'));
    const unique = new Set(keys);
    assert.ok(unique.size >= 2, `expected >= 2 distinct rolls across seeds, got ${unique.size}`);
});

test('pickMissionBoard stratifies across risk buckets', () => {
    const list = buildMissions({ seed: 7 });
    const picks = pickMissionBoard(list, { count: 4, seed: 5 });
    const risks = new Set(picks.map((m) => m.risk));
    // 9 missions, 5 risk buckets -> a 4-card board must span at least 3
    // distinct risk levels under the stratified round-robin roll.
    assert.ok(risks.size >= 3, `expected risk spread >= 3, got ${risks.size}`);
});

test('pickMissionBoard handles empty and count>list gracefully', () => {
    assert.deepEqual(pickMissionBoard([], { count: 4, seed: 1 }), []);
    const list = buildMissions({ seed: 7 }).slice(0, 2);
    const picks = pickMissionBoard(list, { count: 4, seed: 1 });
    assert.equal(picks.length, 2);
});
