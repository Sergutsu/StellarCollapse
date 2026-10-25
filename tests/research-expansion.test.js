import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    NODES,
    CATEGORIES,
    EDGES,
    EFFECTS_BY_NODE,
    getAllNodes,
    getNode,
    getPrerequisites,
    isNodeAvailable,
    getMissingPrerequisites,
    getMissingPrerequisiteNames,
    getNodeView,
    getRemainingMs,
    getResearchProgress,
    resolveEffects,
    activeEffectSummaries,
} from '../src/research.js';

import { MetaState } from '../src/meta-state.js';

test('tech tree expansion: 20 nodes evenly distributed across 4 categories', () => {
    assert.equal(NODES.length, 20);
    assert.equal(CATEGORIES.length, 4);

    for (const cat of CATEGORIES) {
        const catNodes = NODES.filter(n => n.category === cat.id);
        assert.equal(catNodes.length, 5, `Category ${cat.id} should have exactly 5 tiers`);
        const levels = catNodes.map(n => n.level).sort();
        assert.deepEqual(levels, [1, 2, 3, 4, 5], `Category ${cat.id} should have levels 1 through 5`);
    }
});

test('fast snappy durations: T1=20s, T2=45s, T3=90s, T4=180s, T5=300s', () => {
    const expectedDurations = { 1: 20, 2: 45, 3: 90, 4: 180, 5: 300 };
    for (const node of NODES) {
        assert.equal(
            node.durationSec,
            expectedDurations[node.level],
            `Node ${node.id} (L${node.level}) expected ${expectedDurations[node.level]}s, got ${node.durationSec}s`
        );
    }
});

test('all Tier 1 nodes start with zero prerequisites and are immediately available', () => {
    const t1Nodes = NODES.filter(n => n.level === 1);
    assert.equal(t1Nodes.length, 4);
    for (const t1 of t1Nodes) {
        const prereqs = getPrerequisites(t1.id);
        assert.deepEqual(prereqs, [], `${t1.id} should have no prerequisites`);
        assert.equal(isNodeAvailable(t1.id, []), true, `${t1.id} should be available immediately`);
        assert.deepEqual(getMissingPrerequisites(t1.id, []), []);
        assert.deepEqual(getMissingPrerequisiteNames(t1.id, []), []);
    }
});

test('prerequisite guidance reports missing prerequisite IDs and user-friendly names', () => {
    const missingIds = getMissingPrerequisites('warp-coils', []);
    assert.deepEqual(missingIds, ['fuel-cell']);

    const missingNames = getMissingPrerequisiteNames('warp-coils', []);
    assert.deepEqual(missingNames, ['Compact Fuel Cell']);

    // When fuel-cell is completed, warp-coils has no missing prereqs
    assert.deepEqual(getMissingPrerequisites('warp-coils', ['fuel-cell']), []);
    assert.deepEqual(getMissingPrerequisiteNames('warp-coils', ['fuel-cell']), []);
});

test('getNodeView accurately reflects multi-research activeResearches state', () => {
    const researchState = {
        completed: ['fuel-cell'],
        activeResearches: [{ nodeId: 'warp-coils', startedAt: Date.now(), accumulatedMs: 0 }],
        maxConcurrent: 2,
    };

    assert.equal(getNodeView('fuel-cell', researchState).state, 'completed');
    assert.equal(getNodeView('warp-coils', researchState).state, 'researching');
    assert.equal(getNodeView('deep-scanner', researchState).state, 'available');
    assert.equal(getNodeView('ion-thrusters', researchState).state, 'locked');
});

test('MetaState checkResearchCompletions auto-completes elapsed projects', () => {
    const meta = new MetaState();
    meta.startResearch('deep-scanner');

    let state = meta.getResearchState();
    assert.equal(state.activeResearches.length, 1);
    assert.equal(state.completed.includes('deep-scanner'), false);

    // After 21 seconds (deep-scanner duration is 20s)
    const completed = meta.checkResearchCompletions(Date.now() + 21000);
    assert.deepEqual(completed, ['deep-scanner']);

    state = meta.getResearchState();
    assert.equal(state.activeResearches.length, 0);
    assert.ok(state.completed.includes('deep-scanner'));
});

test('MetaState accelerateResearch adds progress ms during quantum surges', () => {
    const meta = new MetaState();
    meta.startResearch('fuel-cell');

    meta.accelerateResearch(5000); // add 5s bonus
    const project = meta.getResearchState().activeResearches[0];
    assert.equal(project.accumulatedMs, 5000);

    // With 5s accumulated + 16s elapsed (total 21s >= 20s duration), it auto-completes
    const completed = meta.checkResearchCompletions(project.startedAt + 16000);
    assert.deepEqual(completed, ['fuel-cell']);
});

test('all 20 nodes have valid effect entries with non-empty summaries', () => {
    for (const node of NODES) {
        const entry = EFFECTS_BY_NODE[node.id];
        assert.ok(entry, `Node ${node.id} must have an EFFECTS_BY_NODE entry`);
        assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0);
        assert.ok(entry.mods && typeof entry.mods === 'object');
    }

    const allNodeIds = NODES.map(n => n.id);
    const fx = resolveEffects(allNodeIds);
    assert.ok(fx.etaMultiplier < 1);
    assert.ok(fx.oreYieldMultiplier > 1);
    assert.ok(fx.mineralYieldMultiplier > 1);
    assert.ok(fx.repMultiplier > 1);
    assert.ok(fx.fleetSlots >= 6);
    assert.ok(fx.crewSlots >= 2);
    assert.ok(fx.researchSlots >= 2);

    const summaries = activeEffectSummaries(allNodeIds);
    assert.equal(summaries.length, 20);
});
