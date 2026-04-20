// Mission catalog.
//
// A "mission" is one asteroid-run archetype that wraps the existing
// GameState into a tiered, selectable job. Each high-score tier becomes
// one mission archetype (9 total, green -> red by difficulty), and the
// mission exposes a `gameConfig` the GameState can consume verbatim.
//
// This file is deliberately pure: no DOM, no Pixi, no IO. Tests cover
// the pool + seedable roll so future sessions can persist the roll and
// unit tests stay deterministic.
//
// In later PRs this module will grow:
//   - `availability(metaState)` -> bool (reputation gates).
//   - `rewards(metaState, runStats)` -> credits + per-ore tally.
//   - Generated missions beyond the 9 archetypes (procedural names,
//     time-limited specials, double-reward events, etc.).
// For now every archetype is always available and the reward preview is
// a static base-credit tuned off the tier index.

import {
    GAME_MODES,
    PIECE_COMPLEXITY,
    HIGHSCORE_TIERS,
    NORMAL_COLORS,
} from './constants.js';

// Ore catalog. Every normal tile color becomes its own ore; bomb and
// snake specials are rarer "hazard ores" tallied separately. Order is
// stable so the UI can render icons in a fixed sequence.
//
// `color` is the gameplay color id (used by the view palette). `label`
// is the flavor name (used for tooltips / receipts). `icon` is a single
// character or emoji; the view can substitute a glyph later.
export const ORES = Object.freeze([
    { id: 'pyrite',    color: 'red',    label: 'Pyrite',    icon: '◆', rarity: 'common' },
    { id: 'cryonite',  color: 'blue',   label: 'Cryonite',  icon: '◆', rarity: 'common' },
    { id: 'verdanite', color: 'green',  label: 'Verdanite', icon: '◆', rarity: 'common' },
    { id: 'helium',    color: 'yellow', label: 'Helium',    icon: '◆', rarity: 'common' },
    { id: 'volatiles', color: 'bomb',   label: 'Volatiles', icon: '✦', rarity: 'rare'   },
    { id: 'biomass',   color: 'snake',  label: 'Biomass',   icon: '✦', rarity: 'rare'   },
]);

// color -> ore lookup. View and meta-state use this to translate a
// cleared-cell color into an ore id.
export const ORE_BY_COLOR = Object.freeze(
    ORES.reduce((m, o) => { m[o.color] = o; return m; }, {}),
);

// Flavor-name pool per tier. Each tier has a handful of evocative
// asteroid names; the session picks one so each run's mission list
// reads a little different without us having to invent a name every
// time. Names intentionally tilt sci-fi-industrial for Chief Dispatcher
// vibes.
const ASTEROID_NAMES = {
    'stellar-classic': ['K-227 "Ironfall"', 'C-14 "Copper Drift"', 'Belt-9 "Ferric"'],
    'stellar-mutated': ['N-82 "Nickel Shard"', 'V-11 "Crimson Vein"', 'R-7 "Rust Crag"'],
    'auto-match-classic': ['B-300 "Bellix Prime"', 'T-42 "Titan Scree"', 'P-19 "Plexor"'],
    'auto-match-mutated': ['M-55 "Magneton"', 'Z-206 "Zeffra"', 'Q-88 "Quarry-8"'],
    'stellar-collapsed': ['X-9 "Null Drift"', 'Y-412 "Void Splinter"', 'A-73 "Ashfall"'],
    'auto-match-collapsed': ['D-660 "Darkveil"', 'H-301 "Hollow Core"', 'U-14 "Umbrite"'],
    'blocks-classic': ['G-440 "Granitor"', 'L-17 "Lithos"', 'S-5 "Slabline"'],
    'blocks-mutated': ['E-912 "Erebos"', 'J-33 "Jagged Sigil"', 'W-207 "Wraithstone"'],
    'blocks-collapsed': ['O-000 "Orpheus Null"', 'K-?? "Kephra Terminal"', 'T-∞ "Terminus"'],
};

// Base credit reward per tier, scaled off the tier index (1-based).
// Linear: T1=100, T2=200 ... T9=900. Multiplier picks up on size choice
// and difficulty modifiers in a later PR; this is the preview amount
// the mission-select card shows.
export function baseCreditsFor(tierIndex) {
    return Math.max(100, tierIndex * 100);
}

// Pick the field size id that best matches each tier's intended feel.
// Small on the gentlest, Large on the hardest. Medium for the middle.
// Size also feeds into the existing scoring multiplier (0.75x .. 1.5x)
// so rougher missions aren't uniformly more valuable; the player can
// still farm easier tiers for faster credit trickle.
const TIER_SIZE_BY_ID = {
    'stellar-classic':      'small',
    'stellar-mutated':      'medium',
    'auto-match-classic':   'small',
    'auto-match-mutated':   'medium',
    'stellar-collapsed':    'medium',
    'auto-match-collapsed': 'medium',
    'blocks-classic':       'medium',
    'blocks-mutated':       'medium',
    'blocks-collapsed':     'large',
};

// Short human-readable difficulty tag per tier. Kept out of constants.js
// so it can evolve freely with the meta-game.
const TIER_DIFFICULTY_BY_ID = {
    'stellar-classic':      'LOW',
    'stellar-mutated':      'LOW',
    'auto-match-classic':   'MODERATE',
    'auto-match-mutated':   'MODERATE',
    'stellar-collapsed':    'ELEVATED',
    'auto-match-collapsed': 'HIGH',
    'blocks-classic':       'HIGH',
    'blocks-mutated':       'EXTREME',
    'blocks-collapsed':     'CRITICAL',
};

// A short flavor brief shown on the card. One line each so the layout
// stays predictable.
const TIER_BRIEF_BY_ID = {
    'stellar-classic':      'Sweep a starter vein for routine ore.',
    'stellar-mutated':      'Irregular seams -- pick your own clears.',
    'auto-match-classic':   'Drill runs auto-detonate on lock.',
    'auto-match-mutated':   'Mixed ore surge. Watch the ceiling.',
    'stellar-collapsed':    'Zero-g clears -- ore floats until a sweep.',
    'auto-match-collapsed': 'Auto-clears in zero-g. High variance.',
    'blocks-classic':       'Block-stack only. No colour match credit.',
    'blocks-mutated':       'Jagged shape pool. Stack or scrap.',
    'blocks-collapsed':     'Critical hauler. Everything fights you.',
};

// Build a mission object from a HIGHSCORE_TIERS entry. The returned
// object is the one the UI renders and the runner feeds to GameState.
function missionFromTier(tier, idx, nameRng) {
    const pool = ASTEROID_NAMES[tier.id] || [tier.label];
    const name = pool[Math.floor(nameRng() * pool.length) % pool.length];
    const sizeId = TIER_SIZE_BY_ID[tier.id] || 'medium';
    return Object.freeze({
        id: `mission-${tier.id}`,
        tierId: tier.id,
        tierIndex: idx + 1,
        tierColor: tier.color,
        name,
        label: tier.label,
        difficulty: TIER_DIFFICULTY_BY_ID[tier.id] || 'MODERATE',
        brief: TIER_BRIEF_BY_ID[tier.id] || '',
        baseCredits: baseCreditsFor(idx + 1),
        // Expected ore preview on the card: the four "common" ores are
        // always in play, plus a rare-ore hint on collapsed tiers.
        expectedOres: Object.freeze([
            ...NORMAL_COLORS.map((c) => ORE_BY_COLOR[c].id),
            ...(tier.complexity === PIECE_COMPLEXITY.COLLAPSED ? ['volatiles', 'biomass'] : []),
        ]),
        gameConfig: Object.freeze({
            mode: tier.mode,
            complexity: tier.complexity,
            fieldSizeId: sizeId,
        }),
        // Reserved for later PRs. All missions are currently unlocked.
        available: true,
        requires: null,
    });
}

// Deterministic but varied asteroid-name picker. A tiny Mulberry32 so
// tests can seed and assert a stable mission list. Uses `Math.random`
// when no seed is supplied.
function rng(seed) {
    if (typeof seed !== 'number') return Math.random;
    let t = seed >>> 0;
    return function next() {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = t;
        r = Math.imul(r ^ (r >>> 15), r | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// Build the full 9-mission list. Pass a `seed` to get a stable list
// (used by tests + by the session roller so missions stay the same
// between menu visits within one boot).
export function buildMissions({ seed } = {}) {
    const pick = rng(seed);
    return HIGHSCORE_TIERS.map((tier, idx) => missionFromTier(tier, idx, pick));
}

// Look up a mission by id from a built list. Returns null if missing.
export function findMission(list, id) {
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
    }
    return null;
}

// Re-export for convenience so the view can render ore icons without
// also importing constants.js.
export { GAME_MODES, PIECE_COMPLEXITY };
