// Reputation ladder + rep-gain math.
//
// Reputation is the meta-progression rank of the Chief Dispatcher. It is
// earned by *finishing* dispatches (manual minigame runs and idle
// contracts alike), never by spending credits, so it reads as "how good
// a dispatcher are you" rather than "how rich are you".
//
// Two jobs:
//   1. `repForMission(...)`  -- how much rep one finished dispatch pays.
//   2. `repInfo(rep)`        -- which tier that total sits in, how far
//                               through it, and what the next rank is.
//
// Rep tiers also gate the hardest mission cards (`repTierRequiredFor...`)
// so the T8/T9 board slots are a progression reward, matching
// docs/DESIGN.md "Rep tier is a cumulative rank ... Gates some T8/T9
// missions."
//
// Pure + framework-free: no DOM, no timers, no IO. `node --test` friendly.

// Cumulative rep thresholds. `threshold` is the total rep required to
// *reach* the tier, so tier 1 starts at 0. Titles are what the hub top
// bar and the results screen print.
export const REP_TIERS = Object.freeze([
    Object.freeze({ tier: 1, title: 'Apprentice Dispatcher',  threshold: 0 }),
    Object.freeze({ tier: 2, title: 'Journeyman Dispatcher',  threshold: 400 }),
    Object.freeze({ tier: 3, title: 'Senior Dispatcher',      threshold: 1200 }),
    Object.freeze({ tier: 4, title: 'Fleet Dispatcher',       threshold: 2800 }),
    Object.freeze({ tier: 5, title: 'Sector Commander',       threshold: 5600 }),
    Object.freeze({ tier: 6, title: 'Master Dispatcher',      threshold: 10000 }),
]);

export const MAX_REP_TIER = REP_TIERS[REP_TIERS.length - 1].tier;

// Rep payout tuning. Kept in one object so balance passes touch one
// place (and so docs/GAMEPLAY.md can mirror it verbatim).
export const REP_GAIN = Object.freeze({
    base: 20,             // flat rep for finishing any dispatch
    perRisk: 10,          // + per mission risk point (1..5)
    perTierIndex: 4,      // + per tier index (1..9)
    failMultiplier: 0.35, // lost / overrun runs still pay a third
    idleMultiplier: 0.6,  // autonomous contracts pay less than hands-on runs
    abortMultiplier: 0.15,// RETURNing early pays almost nothing
    combatWinBonus: 15,   // clearing a Combat (defense) minigame by hand
    sectorDiscovery: 25,  // charting a new sector on the STAR MAP
});

// Mission tiers that need a rep rank before their board card unlocks.
// Everything not listed here is open from tier 1. Only the two hardest
// archetypes are gated (DESIGN.md: "Gates some T8/T9 missions").
const REP_TIER_REQUIRED_BY_TIER_INDEX = Object.freeze({
    8: 3,
    9: 4,
});

/**
 * Rep paid for one finished dispatch.
 *
 * @param {object}  opts
 * @param {number}  [opts.risk=1]          mission risk 1..5
 * @param {number}  [opts.tierIndex=1]     mission tier index 1..9
 * @param {string}  [opts.type]            mission type ('Combat' pays a win bonus)
 * @param {boolean} [opts.won=true]        did the player finish the objective
 * @param {string}  [opts.dispatchMode]    'manual' | 'idle'
 * @param {boolean} [opts.aborted=false]   idle contract RETURNed early
 * @param {object}  [opts.effects]         resolved research effects (repMultiplier)
 * @returns {number} integer rep, always >= 0
 */
export function repForMission({
    risk = 1,
    tierIndex = 1,
    type = null,
    won = true,
    dispatchMode = 'manual',
    aborted = false,
    effects = null,
} = {}) {
    const r = clampInt(risk, 1, 5);
    const t = clampInt(tierIndex, 1, 99);
    let rep = REP_GAIN.base + r * REP_GAIN.perRisk + t * REP_GAIN.perTierIndex;

    if (aborted) rep *= REP_GAIN.abortMultiplier;
    else if (dispatchMode === 'idle') rep *= REP_GAIN.idleMultiplier;
    if (!won && !aborted) rep *= REP_GAIN.failMultiplier;
    if (won && !aborted && String(type).toLowerCase() === 'combat' && dispatchMode !== 'idle') {
        rep += REP_GAIN.combatWinBonus;
    }

    const mult = Number.isFinite(effects?.repMultiplier) ? effects.repMultiplier : 1;
    return Math.max(0, Math.round(rep * mult));
}

/** Rep paid for charting a previously-unknown sector. */
export function repForSectorDiscovery({ effects = null } = {}) {
    const mult = Number.isFinite(effects?.repMultiplier) ? effects.repMultiplier : 1;
    return Math.max(0, Math.round(REP_GAIN.sectorDiscovery * mult));
}

/** The REP_TIERS entry a rep total currently sits in. */
export function tierEntryForRep(rep = 0) {
    const total = Math.max(0, Math.floor(Number.isFinite(rep) ? rep : 0));
    let entry = REP_TIERS[0];
    for (const candidate of REP_TIERS) {
        if (total >= candidate.threshold) entry = candidate;
    }
    return entry;
}

/** Numeric rep tier (1..MAX_REP_TIER) for a rep total. */
export function tierForRep(rep = 0) {
    return tierEntryForRep(rep).tier;
}

/**
 * Full read-out used by the hub's REP chip + the results screen.
 *
 * @returns {{ rep:number, tier:number, title:string, threshold:number,
 *             nextTier:number|null, nextTitle:string|null, nextThreshold:number|null,
 *             toNext:number, progress:number, maxed:boolean }}
 */
export function repInfo(rep = 0) {
    const total = Math.max(0, Math.floor(Number.isFinite(rep) ? rep : 0));
    const entry = tierEntryForRep(total);
    const next = REP_TIERS.find((t) => t.tier === entry.tier + 1) || null;
    const span = next ? Math.max(1, next.threshold - entry.threshold) : 1;
    const into = total - entry.threshold;
    return {
        rep: total,
        tier: entry.tier,
        title: entry.title,
        threshold: entry.threshold,
        nextTier: next ? next.tier : null,
        nextTitle: next ? next.title : null,
        nextThreshold: next ? next.threshold : null,
        toNext: next ? Math.max(0, next.threshold - total) : 0,
        progress: next ? Math.min(1, Math.max(0, into / span)) : 1,
        maxed: !next,
    };
}

/** Rep tier a mission tier index requires (1 when ungated). */
export function repTierRequiredForTierIndex(tierIndex) {
    return REP_TIER_REQUIRED_BY_TIER_INDEX[tierIndex] || 1;
}

/** Rep tier a mission card requires, reading the mission's own tier index. */
export function repTierRequiredForMission(mission) {
    if (!mission) return 1;
    if (Number.isFinite(mission.repTierRequired)) return mission.repTierRequired;
    return repTierRequiredForTierIndex(mission.tierIndex);
}

/**
 * Is this mission card open to a dispatcher at `repTier`?
 * Ungated missions (the vast majority) are always open.
 */
export function isMissionUnlocked(mission, repTier = 1) {
    const required = repTierRequiredForMission(mission);
    const have = Math.max(1, Math.floor(Number.isFinite(repTier) ? repTier : 1));
    return have >= required;
}

/** Short "REP 3 / 6" style label for chips + badges. */
export function repTierLabel(rep = 0) {
    const info = repInfo(rep);
    return `REP ${info.tier}`;
}

function clampInt(value, min, max) {
    const n = Number.isFinite(value) ? Math.floor(value) : min;
    return Math.max(min, Math.min(max, n));
}
