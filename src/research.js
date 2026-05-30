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
        effect: 'Advanced mining laser. Increased cost by rocky planets, increase of time; 3 more effects.',
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
        effect: 'Auto-reroll one unlucky risk event per mission.',
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

// Re-export for convenience
export {
    NODES as RESEARCH_NODES,
    EDGES as RESEARCH_EDGES,
    CATEGORIES as RESEARCH_CATEGORIES,
};
