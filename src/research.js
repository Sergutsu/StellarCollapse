// Pure research / technology tree data and helpers.
// This module owns the canonical tech tree definition and provides
// stateless functions for state derivation (availability, remaining time, etc.).
// No DOM, no timers, fully testable with node --test.

export const HEX_R = 18;

// Visual tokens for node states (used by the tab for colors)
export const NODE_STATE = Object.freeze({
    locked:     { stroke: 0x475569, fill: 0x0b1424, label: 'Locked',             labelColor: 0xfda4af, icon: 0x475569 },
    available:  { stroke: 0x67e8f9, fill: 0x0b1424, label: 'Available',          labelColor: 0x67e8f9, icon: 0x67e8f9 },
    researching:{ stroke: 0xfcd34d, fill: 0x1c1207, label: 'Currently Researching', labelColor: 0xfcd34d, icon: 0xfcd34d },
    completed:  { stroke: 0x6ee7b7, fill: 0x042f1f, label: 'Completed',         labelColor: 0x6ee7b7, icon: 0x6ee7b7 },
});

// Category columns (order matters for layout)
export const CATEGORIES = Object.freeze([
    { id: 'propulsion', label: 'Propulsion', nx: 0.12 },
    { id: 'extraction', label: 'Extraction', nx: 0.38 },
    { id: 'defense',    label: 'Defense',    nx: 0.64 },
    { id: 'economics',  label: 'Economics',  nx: 0.88 },
]);

// Core tech tree definition: 20 nodes across 4 columns and 5 tiers.
// Fast idle-clicker durations: Tier 1: 20s, Tier 2: 45s, Tier 3: 90s, Tier 4: 180s, Tier 5: 300s.
// All 4 disciplines start immediately available at Tier 1 (0 prerequisites).
export const NODES = Object.freeze([
    // Propulsion (nx: 0.12)
    {
        id: 'fuel-cell',
        category: 'propulsion',
        name: 'Compact Fuel Cell',
        level: 1,
        ny: 0.86,
        glyph: '[]',
        effect: 'Doubles fleet warp capacity and expands fleet berths. (+2 warp capacity, +2 fleet berths)',
        cost: { minerals: 250, credits: 400 },
        time: '0m 20s',
        durationSec: 20,
    },
    {
        id: 'warp-coils',
        category: 'propulsion',
        name: 'Warp Coils',
        level: 2,
        ny: 0.69,
        glyph: '~~',
        effect: 'Reduces sector jump costs by 1 warp cell and provides +2 fleet berths.',
        cost: { minerals: 450, credits: 750 },
        time: '0m 45s',
        durationSec: 45,
    },
    {
        id: 'ion-thrusters',
        category: 'propulsion',
        name: 'Ion Thrusters',
        level: 3,
        ny: 0.52,
        glyph: '>>',
        effect: 'Advanced ion propulsion stream reduces mission ETA by 8%.',
        cost: { minerals: 700, credits: 1200 },
        time: '1m 30s',
        durationSec: 90,
    },
    {
        id: 'slipstream-drive',
        category: 'propulsion',
        name: 'Slipstream Drive',
        level: 4,
        ny: 0.35,
        glyph: '=>',
        effect: 'Sub-space conduits reduce mission ETA by an extra 12% and grant +1 warp capacity.',
        cost: { minerals: 1100, credits: 2000 },
        time: '3m 00s',
        durationSec: 180,
    },
    {
        id: 'hyperdrive-matrix',
        category: 'propulsion',
        name: 'Hyperdrive Matrix',
        level: 5,
        ny: 0.18,
        glyph: '><',
        effect: 'Tachyon matrix reduces mission ETA by 15% and grants +2 fleet berths.',
        cost: { minerals: 1800, credits: 3500 },
        time: '5m 00s',
        durationSec: 300,
    },

    // Resource Extraction (nx: 0.38)
    {
        id: 'deep-scanner',
        category: 'extraction',
        name: 'Deep Scanner',
        level: 1,
        ny: 0.86,
        glyph: '()',
        effect: 'Reveals rare-ore bonus seams on mining boards. +5% ore yield.',
        cost: { minerals: 200, credits: 350 },
        time: '0m 20s',
        durationSec: 20,
    },
    {
        id: 'refinery',
        category: 'extraction',
        name: 'Refinery Throughput',
        level: 2,
        ny: 0.69,
        glyph: 'Rf',
        effect: 'Optimized catalytic converters lift mineral refinery throughput by +15%.',
        cost: { minerals: 500, credits: 800 },
        time: '0m 45s',
        durationSec: 45,
    },
    {
        id: 'mining-laser',
        category: 'extraction',
        name: 'Advanced Mining Laser',
        level: 3,
        ny: 0.52,
        glyph: '//',
        effect: '+12% ore yield on all operations; banks +1 extra hazard ore per run.',
        cost: { minerals: 750, credits: 1300 },
        time: '1m 30s',
        durationSec: 90,
    },
    {
        id: 'plasma-extractor',
        category: 'extraction',
        name: 'Plasma Extractor',
        level: 4,
        ny: 0.35,
        glyph: 'PX',
        effect: 'Superheated plasma drill lifts ore yield by +15% and refining throughput by +15%.',
        cost: { minerals: 1200, credits: 2100 },
        time: '3m 00s',
        durationSec: 180,
    },
    {
        id: 'matter-siphon',
        category: 'extraction',
        name: 'Matter Siphon',
        level: 5,
        ny: 0.18,
        glyph: 'MS',
        effect: 'Direct stellar accretion siphons +20% ore yield and +2 hazard ore banked per run.',
        cost: { minerals: 2000, credits: 3600 },
        time: '5m 00s',
        durationSec: 300,
    },

    // Defense (nx: 0.64)
    {
        id: 'hull-plating',
        category: 'defense',
        name: 'Hull Plating',
        level: 1,
        ny: 0.86,
        glyph: '##',
        effect: 'Reinforced composite hull absorbs impact wear. Hull damage reduced by 12%.',
        cost: { minerals: 220, credits: 380 },
        time: '0m 20s',
        durationSec: 20,
    },
    {
        id: 'shield-array',
        category: 'defense',
        name: 'Shield Array',
        level: 2,
        ny: 0.69,
        glyph: '((',
        effect: 'Cruiser-grade deflector shields absorb 1 hull hit per run. Grants +1 fleet berth.',
        cost: { minerals: 480, credits: 850 },
        time: '0m 45s',
        durationSec: 45,
    },
    {
        id: 'countermeasures',
        category: 'defense',
        name: 'Countermeasures',
        level: 3,
        ny: 0.52,
        glyph: '!!',
        effect: 'Hardened electronic warfare suites reduce hull wear by 6% and grant +1 daily board reroll.',
        cost: { minerals: 800, credits: 1400 },
        time: '1m 30s',
        durationSec: 90,
    },
    {
        id: 'reactive-armor',
        category: 'defense',
        name: 'Reactive Armor',
        level: 4,
        ny: 0.35,
        glyph: 'RA',
        effect: 'Smart nanite lattice mitigates catastrophic structural wear. Hull wear reduced by 15%.',
        cost: { minerals: 1300, credits: 2200 },
        time: '3m 00s',
        durationSec: 180,
    },
    {
        id: 'aegis-protocol',
        category: 'defense',
        name: 'Aegis Protocol',
        level: 5,
        ny: 0.18,
        glyph: 'AP',
        effect: 'Automated station defense umbrella absorbs +1 hull hit per run and grants +1 daily board reroll.',
        cost: { minerals: 2100, credits: 3800 },
        time: '5m 00s',
        durationSec: 300,
    },

    // Economics (nx: 0.88)
    {
        id: 'trade-compact',
        category: 'economics',
        name: 'Trade Compact',
        level: 1,
        ny: 0.86,
        glyph: '$$',
        effect: 'Favorable guild terms: Market sell orders +6% credits, buy orders −3% discount.',
        cost: { minerals: 200, credits: 350 },
        time: '0m 20s',
        durationSec: 20,
    },
    {
        id: 'habitat-extension',
        category: 'economics',
        name: 'Habitat Extension',
        level: 2,
        ny: 0.69,
        glyph: 'Hb',
        effect: 'Station expansion grants +1 crew slot, +1 fleet berth, and +1 concurrent research slot.',
        cost: { minerals: 450, credits: 800 },
        time: '0m 45s',
        durationSec: 45,
    },
    {
        id: 'reputation-boost',
        category: 'economics',
        name: 'Reputation Programs',
        level: 3,
        ny: 0.52,
        glyph: '**',
        effect: 'Public diplomatic relations lift reputation gains by +10% across all missions.',
        cost: { minerals: 750, credits: 1350 },
        time: '1m 30s',
        durationSec: 90,
    },
    {
        id: 'orbital-exchange',
        category: 'economics',
        name: 'Orbital Exchange',
        level: 4,
        ny: 0.35,
        glyph: 'OE',
        effect: 'Interstellar commodities exchange: Market sells +10%, buys −5%, and +1 crew slot.',
        cost: { minerals: 1250, credits: 2300 },
        time: '3m 00s',
        durationSec: 180,
    },
    {
        id: 'stellar-harmonizer',
        category: 'economics',
        name: 'Stellar Harmonizer',
        level: 5,
        ny: 0.18,
        glyph: 'SH',
        effect: 'Harness galactic resonance: Reputation gain +20% and unlocks +1 concurrent research slot.',
        cost: { minerals: 2200, credits: 4000 },
        time: '5m 00s',
        durationSec: 300,
    },
]);

// Prerequisite edges (from -> to). Used for both rendering and availability checks.
export const EDGES = Object.freeze([
    // Propulsion chain
    { from: 'fuel-cell',         to: 'warp-coils' },
    { from: 'warp-coils',        to: 'ion-thrusters' },
    { from: 'ion-thrusters',     to: 'slipstream-drive' },
    { from: 'slipstream-drive',  to: 'hyperdrive-matrix' },

    // Extraction chain
    { from: 'deep-scanner',      to: 'refinery' },
    { from: 'refinery',          to: 'mining-laser' },
    { from: 'mining-laser',      to: 'plasma-extractor' },
    { from: 'plasma-extractor',  to: 'matter-siphon' },

    // Defense chain
    { from: 'hull-plating',      to: 'shield-array' },
    { from: 'shield-array',      to: 'countermeasures' },
    { from: 'countermeasures',   to: 'reactive-armor' },
    { from: 'reactive-armor',    to: 'aegis-protocol' },

    // Economics chain
    { from: 'trade-compact',     to: 'habitat-extension' },
    { from: 'habitat-extension', to: 'reputation-boost' },
    { from: 'reputation-boost',  to: 'orbital-exchange' },
    { from: 'orbital-exchange',  to: 'stellar-harmonizer' },

    // Cross-discipline synergies
    { from: 'warp-coils',        to: 'mining-laser' },
    { from: 'habitat-extension', to: 'shield-array' },
]);

// --- Pure helper functions ---

export function getAllNodes() {
    return NODES;
}

export function getNode(id) {
    return NODES.find(n => n.id === id) || null;
}

export function getPrerequisites(nodeId) {
    return EDGES.filter(e => e.to === nodeId).map(e => e.from);
}

/**
 * Returns true if the node can be started (all prereqs completed).
 */
export function isNodeAvailable(nodeId, completedIds = []) {
    const prereqs = getPrerequisites(nodeId);
    return prereqs.every(p => completedIds.includes(p));
}

/**
 * Returns the array of missing prerequisite node IDs for a given node.
 */
export function getMissingPrerequisites(nodeId, completedIds = []) {
    const prereqs = getPrerequisites(nodeId);
    return prereqs.filter(p => !completedIds.includes(p));
}

/**
 * Returns user-friendly names for missing prerequisite nodes.
 */
export function getMissingPrerequisiteNames(nodeId, completedIds = []) {
    const missing = getMissingPrerequisites(nodeId, completedIds);
    return missing.map(id => getNode(id)?.name || id);
}

/**
 * Convert a node into a runtime view for the UI.
 * Supports both multi-research activeResearches array and single researching object.
 */
export function getNodeView(nodeId, researchState) {
    const node = getNode(nodeId);
    if (!node) return null;

    const completed = researchState?.completed || [];
    const activeResearches = researchState?.activeResearches || [];
    const isActive = activeResearches.some(r => r && r.nodeId === nodeId) ||
                     (researchState?.researching?.nodeId === nodeId);

    let state = 'locked';
    if (completed.includes(nodeId)) {
        state = 'completed';
    } else if (isActive) {
        state = 'researching';
    } else if (isNodeAvailable(nodeId, completed)) {
        state = 'available';
    }

    return {
        ...node,
        state,
    };
}

/**
 * Returns how many milliseconds remain for a researching project.
 * Supports both multi-research project record and legacy researching record.
 */
export function getRemainingMs(researching, now = Date.now()) {
    if (!researching) return 0;

    const node = getNode(researching.nodeId);
    if (!node) return 0;

    const effectiveMs = getEffectiveProgressMs(researching, now);
    const totalMs = (node.durationSec || 0) * 1000;
    return Math.max(0, totalMs - effectiveMs);
}

/**
 * Returns progress (0..1) for a researching node.
 * Supports both multi-research project record and legacy researching record.
 */
export function getResearchProgress(researching, now = Date.now()) {
    if (!researching) return 0;
    const node = getNode(researching.nodeId);
    if (!node || !node.durationSec) return 0;

    const effectiveMs = getEffectiveProgressMs(researching, now);
    return Math.min(1, Math.max(0, effectiveMs / (node.durationSec * 1000)));
}

/**
 * Returns the list of nodes that are currently available to start.
 */
export function getAvailableNodes(completedIds = []) {
    return NODES.filter(n => isNodeAvailable(n.id, completedIds));
}

// --- Multi-research helpers (for 2+ concurrent slots) ---

/**
 * Calculate effective progress in ms for a research project (supports cancel/resume).
 */
export function getEffectiveProgressMs(project, now = Date.now()) {
    if (!project) return 0;
    const elapsed = project.startedAt > 0 ? (now - project.startedAt) : 0;
    return (project.accumulatedMs || 0) + elapsed;
}

export function getResearchProgressForProject(project, node, now = Date.now()) {
    if (!project || !node || !node.durationSec) return 0;
    const effectiveMs = getEffectiveProgressMs(project, now);
    return Math.min(1, effectiveMs / (node.durationSec * 1000));
}

export function getRemainingMsForProject(project, node, now = Date.now()) {
    if (!project || !node) return 0;
    const effectiveMs = getEffectiveProgressMs(project, now);
    const totalNeeded = node.durationSec * 1000;
    return Math.max(0, totalNeeded - effectiveMs);
}

/**
 * Check if we can start another research (respect max slots).
 */
export function canStartNewResearch(activeResearches = [], maxConcurrent = 2) {
    return (activeResearches.length || 0) < maxConcurrent;
}

// --- Research effects (what a completed node actually DOES) -----------
//
// Before P8 the tech tree was cosmetic: finishing a node flipped its hex
// green and nothing else changed. `EFFECTS_BY_NODE` is now the canonical
// modifier table and `resolveEffects(completedIds)` folds every completed
// node into one frozen bundle that the rest of the game reads:
//
//   settlement.js  -- credits / ore yield / hull wear / crew XP / ETA
//   economy.js     -- market spread + refinery throughput
//   star-map.js    -- warp-cell cost of a sector jump, fleet berths
//   crew-tab.js    -- crew roster slots
//   build-tab.js   -- fleet berth slots
//
// Combination rules (kept boring on purpose so the bundle is predictable):
//   * `*Multiplier` fields multiply together (0.92 × 0.88 = 0.8096).
//   * `*Bonus` / `*Delta` / `*Slots` / `*Charges` / `*Rerolls` add.
//   * booleans OR.
// Every key exists on the returned bundle even when nothing modifies it,
// so call sites never need `?? 1` guards.

export const BASE_EFFECTS = Object.freeze({
    // Dispatch timing + payouts
    etaMultiplier: 1,             // idle contract duration scale (ion-thrusters)
    creditMultiplier: 1,          // payout scale (sectors, not tech, normally)
    oreYieldMultiplier: 1,        // cleared-cell → ore scale
    mineralYieldMultiplier: 1,    // ore → mineral refining throughput
    repMultiplier: 1,             // reputation gain scale
    rareOreBonus: 0,              // extra hazard ore banked per run that mined one
    rareOreReveal: false,         // board shows rare-seam hints
    // Fleet + station capacity
    fleetSlots: 0,                // extra mother-ship berths
    crewSlots: 0,                 // extra crew roster slots
    researchSlots: 0,             // extra concurrent research projects
    warpCapacity: 0,              // extra warp cells the station can hold
    // Survival
    hullDamageMultiplier: 1,      // hull wear scale on risky dispatches
    shieldCharges: 0,             // hull hits absorbed per run
    riskRerolls: 0,               // extra paid mission-board rerolls per UTC day
    // Economy
    marketSellBonus: 0,           // fraction added to sell prices
    marketBuyDiscount: 0,         // fraction off buy prices
    warpCostDelta: 0,             // added to every sector jump cost (negative = cheaper)
});

// One entry per tech node. `summary` is the short line the RESEARCH tab
// prints in its ACTIVE BONUSES strip once the node is online.
export const EFFECTS_BY_NODE = Object.freeze({
    // Original 12 nodes (values preserved 100% identically)
    'fuel-cell':         Object.freeze({ mods: Object.freeze({ warpCapacity: 2, fleetSlots: 2 }),                summary: '+2 warp capacity · +2 fleet berths' }),
    'warp-coils':        Object.freeze({ mods: Object.freeze({ warpCostDelta: -1, fleetSlots: 2 }),              summary: 'Sector jumps cost 1 less warp · +2 berths' }),
    'ion-thrusters':     Object.freeze({ mods: Object.freeze({ etaMultiplier: 0.92 }),                           summary: 'Mission ETA −8%' }),
    'deep-scanner':      Object.freeze({ mods: Object.freeze({ rareOreReveal: true, oreYieldMultiplier: 1.05 }), summary: 'Rare seams revealed · ore yield +5%' }),
    'refinery':          Object.freeze({ mods: Object.freeze({ mineralYieldMultiplier: 1.15 }),                  summary: 'Refinery throughput +15%' }),
    'mining-laser':      Object.freeze({ mods: Object.freeze({ oreYieldMultiplier: 1.12, rareOreBonus: 1 }),     summary: 'Ore yield +12% · +1 hazard ore per run' }),
    'hull-plating':      Object.freeze({ mods: Object.freeze({ hullDamageMultiplier: 0.88 }),                    summary: 'Hull wear −12%' }),
    'shield-array':      Object.freeze({ mods: Object.freeze({ shieldCharges: 1, fleetSlots: 1 }),               summary: 'Absorbs one hull hit per run · +1 berth' }),
    'countermeasures':   Object.freeze({ mods: Object.freeze({ riskRerolls: 1, hullDamageMultiplier: 0.94 }),    summary: 'One extra board reroll per day · hull wear −6%' }),
    'reputation-boost':  Object.freeze({ mods: Object.freeze({ repMultiplier: 1.10 }),                           summary: 'Reputation gain +10%' }),
    'trade-compact':     Object.freeze({ mods: Object.freeze({ marketSellBonus: 0.06, marketBuyDiscount: 0.03 }), summary: 'Market sells +6% · buys −3%' }),
    'habitat-extension': Object.freeze({ mods: Object.freeze({ crewSlots: 1, fleetSlots: 1, researchSlots: 1 }), summary: '+1 crew slot · +1 berth · +1 research slot' }),

    // 8 Expanded tech nodes
    'slipstream-drive':   Object.freeze({ mods: Object.freeze({ etaMultiplier: 0.88, warpCapacity: 1 }),         summary: 'Mission ETA −12% · +1 warp capacity' }),
    'hyperdrive-matrix':  Object.freeze({ mods: Object.freeze({ etaMultiplier: 0.85, fleetSlots: 2 }),           summary: 'Mission ETA −15% · +2 fleet berths' }),
    'plasma-extractor':   Object.freeze({ mods: Object.freeze({ oreYieldMultiplier: 1.15, mineralYieldMultiplier: 1.15 }), summary: 'Ore yield +15% · refining +15%' }),
    'matter-siphon':      Object.freeze({ mods: Object.freeze({ oreYieldMultiplier: 1.20, rareOreBonus: 2 }),    summary: 'Ore yield +20% · +2 hazard ore per run' }),
    'reactive-armor':     Object.freeze({ mods: Object.freeze({ hullDamageMultiplier: 0.85 }),                   summary: 'Hull wear −15%' }),
    'aegis-protocol':     Object.freeze({ mods: Object.freeze({ shieldCharges: 1, riskRerolls: 1 }),              summary: 'Absorbs +1 hull hit · +1 board reroll/day' }),
    'orbital-exchange':   Object.freeze({ mods: Object.freeze({ marketSellBonus: 0.10, marketBuyDiscount: 0.05, crewSlots: 1 }), summary: 'Market sells +10% · buys −5% · +1 crew slot' }),
    'stellar-harmonizer': Object.freeze({ mods: Object.freeze({ repMultiplier: 1.20, researchSlots: 1 }),        summary: 'Reputation gain +20% · +1 research slot' }),
});

// Which fields combine multiplicatively. Everything else numeric adds.
const MULTIPLIER_KEYS = Object.freeze([
    'etaMultiplier',
    'creditMultiplier',
    'oreYieldMultiplier',
    'mineralYieldMultiplier',
    'repMultiplier',
    'hullDamageMultiplier',
]);

/**
 * Fold a list of completed node ids into one modifier bundle.
 * Unknown ids are ignored so a save from a future version can't crash
 * an older client.
 *
 * @param {string[]} [completedIds]
 * @returns {typeof BASE_EFFECTS} frozen, fully-populated effect bundle
 */
export function resolveEffects(completedIds = []) {
    const out = { ...BASE_EFFECTS };
    const ids = Array.isArray(completedIds) ? completedIds : [];
    // Dedupe: a save that somehow lists a node twice must not square its
    // multiplier or grant its slots twice.
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const entry = EFFECTS_BY_NODE[id];
        if (!entry || !entry.mods) continue;
        for (const [key, value] of Object.entries(entry.mods)) {
            if (!(key in out)) continue;
            if (typeof value === 'boolean') out[key] = out[key] || value;
            else if (MULTIPLIER_KEYS.includes(key)) out[key] = out[key] * value;
            else out[key] = out[key] + value;
        }
    }
    // Guard against a stack of multipliers rounding into nothing.
    for (const key of MULTIPLIER_KEYS) {
        out[key] = Math.max(0.05, Number(out[key].toFixed(4)));
    }
    return Object.freeze(out);
}

/**
 * Human-readable list of every non-default modifier currently online.
 * Rendered by the RESEARCH tab's ACTIVE BONUSES strip so a finished
 * node visibly does something.
 *
 * @returns {string[]} e.g. ['Mission ETA −8%', 'Ore yield +12% · +1 hazard ore per run']
 */
export function activeEffectSummaries(completedIds = []) {
    const ids = Array.isArray(completedIds) ? completedIds : [];
    return ids
        .map((id) => EFFECTS_BY_NODE[id]?.summary)
        .filter((line) => typeof line === 'string' && line.length > 0);
}

/** True when at least one node is online (used for empty-state copy). */
export function hasAnyEffect(completedIds = []) {
    return activeEffectSummaries(completedIds).length > 0;
}

// Re-export for convenience
export {
    NODES as RESEARCH_NODES,
    EDGES as RESEARCH_EDGES,
    CATEGORIES as RESEARCH_CATEGORIES,
};
