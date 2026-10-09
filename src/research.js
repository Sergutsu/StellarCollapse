// Pure research / technology tree data and helpers.
// This module owns the canonical tech tree definition and provides
// stateless functions for state derivation (availability, remaining time, etc.).
// No DOM, no timers, fully testable with node --test.

export const HEX_R = 22;

// Visual tokens for node states (used by the tab for colors)
export const NODE_STATE = Object.freeze({
    locked:     { stroke: 0x475569, fill: 0x0b1424, label: 'Locked',             labelColor: 0xfda4af, icon: 0x475569 },
    available:  { stroke: 0x67e8f9, fill: 0x0b1424, label: 'Available',          labelColor: 0x67e8f9, icon: 0x67e8f9 },
    researching:{ stroke: 0xfcd34d, fill: 0x1c1207, label: 'Currently Researching', labelColor: 0xfcd34d, icon: 0xfcd34d },
    completed:  { stroke: 0x6ee7b7, fill: 0x042f1f, label: 'Completed',         labelColor: 0x6ee7b7, icon: 0x6ee7b7 },
});

// Category columns (order matters for layout)
export const CATEGORIES = Object.freeze([
    { id: 'propulsion', label: 'Propulsion',         nx: 0.12 },
    { id: 'extraction', label: 'Resource Extraction', nx: 0.38 },
    { id: 'defense',    label: 'Defense',             nx: 0.64 },
    { id: 'economics',  label: 'Economics',           nx: 0.88 },
]);

// Core tech tree definition.
// `time` is human display only. `durationSec` is the canonical duration used for ticking.
export const NODES = Object.freeze([
    // Propulsion
    {
        id: 'fuel-cell',
        category: 'propulsion',
        name: 'Compact Fuel Cell',
        level: 1,
        ny: 0.78,
        glyph: '[]',
        effect: 'Doubles fleet fuel reserves. Enables longer missions.',
        cost: { minerals: 300, credits: 500 },
        time: '1h 30m',
        durationSec: 90 * 60,
    },
    {
        id: 'warp-coils',
        category: 'propulsion',
        name: 'Warp Coils',
        level: 2,
        ny: 0.50,
        glyph: '~~',
        effect: 'Cut warp-cell consumption for long-range plots by 1.',
        cost: { minerals: 500, credits: 900 },
        time: '3h 45m',
        durationSec: (3 * 3600) + (45 * 60),
    },
    {
        id: 'ion-thrusters',
        category: 'propulsion',
        name: 'Ion Thrusters',
        level: 3,
        ny: 0.22,
        glyph: '>>',
        effect: 'Increase fleet cruise speed. Reduces mission ETA by 8%.',
        cost: { minerals: 600, credits: 1200 },
        time: '5h 00m',
        durationSec: 5 * 3600,
    },

    // Resource Extraction
    {
        id: 'deep-scanner',
        category: 'extraction',
        name: 'Deep Scanner',
        level: 1,
        ny: 0.84,
        glyph: '()',
        effect: 'Reveals rare-ore bonus tiles on the mining board.',
        cost: { minerals: 400, credits: 800 },
        time: '2h 00m',
        durationSec: 2 * 3600,
    },
    {
        id: 'refinery',
        category: 'extraction',
        name: 'Refinery Throughput',
        level: 2,
        ny: 0.58,
        glyph: 'Rf',
        effect: 'Refinery converts 15% more ore per hour.',
        cost: { minerals: 700, credits: 1300 },
        time: '5h 00m',
        durationSec: 5 * 3600,
    },
    {
        id: 'mining-laser',
        category: 'extraction',
        name: 'Advanced Mining Laser',
        level: 4,
        ny: 0.30,
        glyph: '//',
        effect: '+12% ore yield on every run; rare seams bank one extra hazard ore.',
        cost: { minerals: 800, credits: 1500 },
        time: '6h 30m',
        durationSec: (6 * 3600) + (30 * 60),
    },

    // Defense
    {
        id: 'hull-plating',
        category: 'defense',
        name: 'Hull Plating',
        level: 2,
        ny: 0.26,
        glyph: '##',
        effect: 'Fleet hull takes 12% less damage on high-risk missions.',
        cost: { minerals: 650, credits: 1100 },
        time: '4h 15m',
        durationSec: (4 * 3600) + (15 * 60),
    },
    {
        id: 'shield-array',
        category: 'defense',
        name: 'Shield Array',
        level: 1,
        ny: 0.54,
        glyph: '()',
        effect: 'Equip shield array on cruiser-class ships. Blocks one hull hit per run.',
        cost: { minerals: 900, credits: 1700 },
        time: '7h 00m',
        durationSec: 7 * 3600,
    },
    {
        id: 'countermeasures',
        category: 'defense',
        name: 'Countermeasures',
        level: 1,
        ny: 0.82,
        glyph: '!!',
        effect: 'One extra paid mission-board reroll each day, plus hardened hulls.',
        cost: { minerals: 1100, credits: 2200 },
        time: '9h 30m',
        durationSec: (9 * 3600) + (30 * 60),
    },

    // Economics
    {
        id: 'reputation-boost',
        category: 'economics',
        name: 'Reputation Programs',
        level: 1,
        ny: 0.86,
        glyph: '**',
        effect: 'Reputation gain +10% per completed mission.',
        cost: { minerals: 700, credits: 1800 },
        time: '5h 45m',
        durationSec: (5 * 3600) + (45 * 60),
    },
    {
        id: 'trade-compact',
        category: 'economics',
        name: 'Trade Compact',
        level: 1,
        ny: 0.60,
        glyph: '$$',
        effect: 'MARKET tab prices 6% more favorable on sell orders.',
        cost: { minerals: 450, credits: 1400 },
        time: '3h 00m',
        durationSec: 3 * 3600,
    },
    {
        id: 'habitat-extension',
        category: 'economics',
        name: 'Habitat Extension',
        level: 2,
        ny: 0.32,
        glyph: 'Hb',
        effect: '+1 crew slot on NOVA STATION. Unlocks tier-II contracts.',
        cost: { minerals: 550, credits: 1000 },
        time: '4h 30m',
        durationSec: (4 * 3600) + (30 * 60),
    },
]);

// Prerequisite edges (from -> to). Used for both rendering and availability checks.
export const EDGES = Object.freeze([
    { from: 'fuel-cell',         to: 'warp-coils' },
    { from: 'warp-coils',        to: 'ion-thrusters' },
    { from: 'deep-scanner',      to: 'refinery' },
    { from: 'refinery',          to: 'mining-laser' },
    { from: 'warp-coils',        to: 'mining-laser' },
    { from: 'hull-plating',      to: 'shield-array' },
    { from: 'shield-array',      to: 'countermeasures' },
    { from: 'trade-compact',     to: 'habitat-extension' },
    { from: 'reputation-boost',  to: 'trade-compact' },
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
 * Convert a node into a runtime view for the UI.
 * This is the main function the tab will call.
 */
export function getNodeView(nodeId, researchState) {
    const node = getNode(nodeId);
    if (!node) return null;

    const completed = researchState?.completed || [];
    const researching = researchState?.researching;

    let state = 'locked';
    if (completed.includes(nodeId)) {
        state = 'completed';
    } else if (researching && researching.nodeId === nodeId) {
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
 * Returns 0 if not researching or already finished.
 */
export function getRemainingMs(researching, now = Date.now()) {
    if (!researching) return 0;

    const node = getNode(researching.nodeId);
    if (!node) return 0;

    const elapsed = now - researching.startedAt;
    const remaining = (node.durationSec * 1000) - elapsed;
    return Math.max(0, remaining);
}

/**
 * Returns progress (0..1) for a researching node.
 */
export function getResearchProgress(researching, now = Date.now()) {
    if (!researching) return 0;
    const node = getNode(researching.nodeId);
    if (!node || node.durationSec === 0) return 0;

    const elapsed = now - researching.startedAt;
    return Math.min(1, Math.max(0, elapsed / (node.durationSec * 1000)));
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
