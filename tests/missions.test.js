// Unit tests for the mission catalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMissions,
    buildIdleMissions,
    findMission,
    baseCreditsFor,
    pickCombatVariantTierIds,
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

test('ungated missions are available at REP 1; T8/T9 need a rank', () => {
    const list = buildMissions({ seed: 7, repTier: 1 });
    list.forEach((m) => {
        if (m.tierIndex >= 8) {
            assert.equal(m.available, false, `${m.tierId} should be rep-gated`);
            assert.ok(m.repTierRequired >= 3, `${m.tierId} requires REP 3+`);
            assert.deepEqual(m.requires, { repTier: m.repTierRequired });
        } else {
            assert.equal(m.available, true, `${m.tierId} should be open`);
            assert.equal(m.repTierRequired, 1);
            assert.equal(m.requires, null);
        }
    });
});

test('raising repTier unlocks the gated archetypes', () => {
    const list = buildMissions({ seed: 7, repTier: 6 });
    list.forEach((m) => assert.equal(m.available, true, `${m.tierId} unlocked at REP 6`));
});

test('expectedOres always contains common ores (Combat variants carry 3 + both rares)', () => {
    const list = buildMissions({ seed: 7 });
    list.forEach((m) => {
        const commons = NORMAL_COLORS.map((c) => ORE_BY_COLOR[c].id).filter((id) => m.expectedOres.includes(id));
        if (m.variant === 'combat') {
            assert.equal(commons.length, 3, `${m.tierId} combat preview shows three commons`);
            assert.ok(m.expectedOres.includes('volatiles'), `${m.tierId} combat previews volatiles`);
            assert.ok(m.expectedOres.includes('biomass'), `${m.tierId} combat previews biomass`);
        } else {
            assert.equal(commons.length, 4, `${m.tierId} standard preview shows all four commons`);
        }
    });
});

test('collapsed + combat missions preview rare ores (volatiles / biomass)', () => {
    const list = buildMissions({ seed: 7 });
    list.forEach((m) => {
        const ranked = HIGHSCORE_TIERS.find((t) => t.id === m.tierId);
        const rare = ranked.complexity === PIECE_COMPLEXITY.COLLAPSED || m.variant === 'combat';
        if (rare) {
            assert.ok(m.expectedOres.includes('volatiles'), `${m.tierId} volatiles`);
            assert.ok(m.expectedOres.includes('biomass'), `${m.tierId} biomass`);
        } else {
            assert.ok(!m.expectedOres.includes('volatiles'), `${m.tierId} no volatiles`);
            assert.ok(!m.expectedOres.includes('biomass'), `${m.tierId} no biomass`);
        }
    });
});

// -- Combat variants (the optional defense minigame as a mission) ------

test('combat variants only ever land on T5..T9 and keep their tier gameConfig', () => {
    for (const seed of [1, 7, 42, 1337, 99991]) {
        const list = buildMissions({ seed });
        list.forEach((m, i) => {
            if (m.variant === 'combat') {
                assert.ok(m.tierIndex >= 5, `seed ${seed}: ${m.tierId} combat variant below T5`);
                assert.equal(m.type, 'Combat');
                assert.equal(m.runsDefense, true);
                assert.equal(m.gameConfig.mode, HIGHSCORE_TIERS[i].mode);
                assert.equal(m.gameConfig.complexity, HIGHSCORE_TIERS[i].complexity);
                assert.ok(m.narrativeName.length > 0);
                assert.ok(m.sector.length > 0);
            } else {
                assert.equal(m.variant, 'standard');
                assert.equal(m.runsDefense, false);
            }
        });
    }
});

test('every daily roll fields at least one combat mission', () => {
    for (const seed of [1, 2, 7, 42, 1337, 99991, 555]) {
        const list = buildMissions({ seed });
        const combat = list.filter((m) => m.variant === 'combat');
        assert.ok(combat.length >= 1, `seed ${seed} rolled no combat mission`);
        assert.ok(combat.length <= 2, `seed ${seed} rolled ${combat.length} combat missions`);
    }
});

test('combat variant assignment is deterministic per seed', () => {
    const a = buildMissions({ seed: 2024 }).filter((m) => m.variant === 'combat').map((m) => m.tierId);
    const b = buildMissions({ seed: 2024 }).filter((m) => m.variant === 'combat').map((m) => m.tierId);
    assert.deepEqual(a, b);
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

test('buildIdleMissions derives one idle contract per manual mission', () => {
    const manual = buildMissions({ seed: 11 });
    const idle = buildIdleMissions(manual);
    assert.equal(idle.length, manual.length);
    idle.forEach((job, i) => {
        assert.equal(job.sourceMissionId, manual[i].id);
        assert.ok(job.id.startsWith('idle-mission-'));
        assert.ok(job.etaSec >= 120);
        assert.ok(job.rewardCredits >= 120);
    });
});

test('buildIdleMissions includes ore payout lanes', () => {
    const idle = buildIdleMissions(buildMissions({ seed: 7 }));
    idle.forEach((job) => {
        assert.ok(Array.isArray(job.rewardOres.common));
        assert.ok(Array.isArray(job.rewardOres.rare));
        assert.ok(job.rewardOres.common.length <= 2);
        assert.ok(job.rewardOres.rare.length <= 1);
    });
});

test('pickCombatVariantTierIds only returns eligible tier ids', () => {
    const ids = HIGHSCORE_TIERS.map((t) => t.id);
    for (const seed of [1, 9, 77, 4242]) {
        const picked = pickCombatVariantTierIds(ids, { seed });
        assert.ok(picked.length >= 1 && picked.length <= 2);
        picked.forEach((id) => assert.ok(ids.includes(id), `${id} is a real tier`));
        assert.equal(new Set(picked).size, picked.length, 'no duplicate picks');
    }
});
