// Research effect resolution (P8): what a completed tech node actually does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    NODES,
    BASE_EFFECTS,
    EFFECTS_BY_NODE,
    resolveEffects,
    activeEffectSummaries,
    hasAnyEffect,
} from '../src/research.js';

test('every tech node has an effect entry', () => {
    NODES.forEach((node) => {
        const entry = EFFECTS_BY_NODE[node.id];
        assert.ok(entry, `${node.id} has no effect entry`);
        assert.ok(entry.mods && Object.keys(entry.mods).length > 0, `${node.id} has empty mods`);
        assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0, `${node.id} has no summary`);
        for (const key of Object.keys(entry.mods)) {
            assert.ok(key in BASE_EFFECTS, `${node.id} modifies unknown effect "${key}"`);
        }
    });
});

test('resolveEffects with nothing completed returns the neutral bundle', () => {
    const fx = resolveEffects([]);
    assert.deepEqual(fx, BASE_EFFECTS);
    assert.equal(fx.etaMultiplier, 1);
    assert.equal(fx.oreYieldMultiplier, 1);
    assert.equal(fx.fleetSlots, 0);
    assert.equal(fx.rareOreReveal, false);
    assert.equal(hasAnyEffect([]), false);
});

test('resolveEffects is frozen and fully populated', () => {
    const fx = resolveEffects(['ion-thrusters']);
    assert.ok(Object.isFrozen(fx));
    for (const key of Object.keys(BASE_EFFECTS)) {
        assert.ok(key in fx, `missing ${key}`);
    }
});

test('ion thrusters cut ETA by 8%', () => {
    const fx = resolveEffects(['ion-thrusters']);
    assert.ok(Math.abs(fx.etaMultiplier - 0.92) < 1e-9);
});

test('multipliers stack multiplicatively', () => {
    const fx = resolveEffects(['deep-scanner', 'mining-laser']);
    assert.ok(Math.abs(fx.oreYieldMultiplier - 1.05 * 1.12) < 1e-6);
});

test('hull damage reductions stack multiplicatively', () => {
    const fx = resolveEffects(['hull-plating', 'countermeasures']);
    assert.ok(Math.abs(fx.hullDamageMultiplier - 0.88 * 0.94) < 1e-6);
});

test('slots and deltas add', () => {
    const fx = resolveEffects(['fuel-cell', 'warp-coils', 'habitat-extension', 'shield-array', 'countermeasures']);
    // 2 + 2 + 1 + 1 berths, matching the FLEET UPGRADE tab's old table.
    assert.equal(fx.fleetSlots, 6);
    assert.equal(fx.crewSlots, 1);
    assert.equal(fx.researchSlots, 1);
    assert.equal(fx.warpCapacity, 2);
    assert.equal(fx.warpCostDelta, -1);
    assert.equal(fx.shieldCharges, 1);
    assert.equal(fx.riskRerolls, 1);
    assert.ok(Math.abs(fx.hullDamageMultiplier - 0.94) < 1e-9);
});

test('booleans OR together', () => {
    assert.equal(resolveEffects([]).rareOreReveal, false);
    assert.equal(resolveEffects(['deep-scanner']).rareOreReveal, true);
    assert.equal(resolveEffects(['deep-scanner', 'ion-thrusters']).rareOreReveal, true);
});

test('unknown or junk node ids are ignored', () => {
    const fx = resolveEffects(['not-a-node', null, undefined, 42]);
    assert.deepEqual(fx, BASE_EFFECTS);
    assert.deepEqual(resolveEffects(null), BASE_EFFECTS);
    assert.deepEqual(resolveEffects(), BASE_EFFECTS);
});

test('duplicate completions do not double-dip', () => {
    const once = resolveEffects(['ion-thrusters']);
    const twice = resolveEffects(['ion-thrusters', 'ion-thrusters', 'ion-thrusters']);
    assert.equal(once.etaMultiplier, twice.etaMultiplier);
});

test('trade compact improves both sides of the market', () => {
    const fx = resolveEffects(['trade-compact']);
    assert.ok(Math.abs(fx.marketSellBonus - 0.06) < 1e-9);
    assert.ok(Math.abs(fx.marketBuyDiscount - 0.03) < 1e-9);
});

test('refinery scales mineral throughput', () => {
    const fx = resolveEffects(['refinery']);
    assert.ok(Math.abs(fx.mineralYieldMultiplier - 1.15) < 1e-9);
});

test('reputation programs scale rep gain', () => {
    const fx = resolveEffects(['reputation-boost']);
    assert.ok(Math.abs(fx.repMultiplier - 1.10) < 1e-9);
});

test('multipliers are floored so a pathological stack cannot zero out', () => {
    const fx = resolveEffects(Object.keys(EFFECTS_BY_NODE));
    for (const key of ['etaMultiplier', 'creditMultiplier', 'oreYieldMultiplier', 'mineralYieldMultiplier', 'repMultiplier', 'hullDamageMultiplier']) {
        assert.ok(fx[key] >= 0.05, `${key} collapsed to ${fx[key]}`);
        assert.ok(Number.isFinite(fx[key]));
    }
});

test('activeEffectSummaries lists one line per online node', () => {
    const lines = activeEffectSummaries(['ion-thrusters', 'refinery']);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('ETA'));
    assert.ok(lines[1].includes('Refinery'));
    assert.deepEqual(activeEffectSummaries([]), []);
    assert.equal(hasAnyEffect(['refinery']), true);
});
