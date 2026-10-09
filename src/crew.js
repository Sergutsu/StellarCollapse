// Crew progression: XP, levels, roster slots, hiring costs, and the
// role ↔ mission-type affinity that makes "who do I send?" a real choice.
//
// Before P8 crew had a `level` field that nothing ever changed: the hub
// multiplied a mission's payout by `1 + (level-1) × 0.04` and the number
// was frozen at whatever the starter roster shipped with. Now every
// finished dispatch pays the assigned crew member XP, levels come from
// cumulative XP, and a matching role pays a bonus on top.
//
// Pure + framework-free. MetaState owns the roster and calls
// `awardCrewXp` / `levelForXp`; this module owns the math.

/** Crew roster slots before any tech. Habitat Extension adds one more. */
export const BASE_CREW_SLOTS = 6;

/** Level cap. Reaching it stops XP from mattering but keeps accruing. */
export const MAX_CREW_LEVEL = 20;

// XP curve: cumulative XP required to *reach* a level.
//   L2 = 180, L3 = 480, L4 = 900, L5 = 1440 ... L20 = 22,680
// Quadratic-with-a-nudge so early levels land in 2–3 dispatches and the
// back half is a long tail.
export const CREW_XP_BASE = 60;
export const CREW_XP_GROWTH = 1.0;

/** Cumulative XP needed to reach `level` (level 1 needs 0). */
export function xpForLevel(level) {
    const l = Math.max(1, Math.min(MAX_CREW_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
    const n = l - 1;
    return Math.round(CREW_XP_BASE * (n * n * CREW_XP_GROWTH + n * 2));
}

/** Level a cumulative XP total sits at. */
export function levelForXp(xp) {
    const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
    let level = 1;
    while (level < MAX_CREW_LEVEL && total >= xpForLevel(level + 1)) level += 1;
    return level;
}

/**
 * Progress read-out for the CREW tab's XP bar.
 *
 * Legacy members (pre-P8 saves) have a `level` but no `xp`; those are
 * treated as sitting exactly on their level's threshold so the bar reads
 * 0% instead of demoting a veteran to level 1.
 *
 * @param {{level?:number, xp?:number}} member
 */
export function crewProgress(member = {}) {
    const storedLevel = Number.isFinite(member?.level) ? Math.floor(member.level) : null;
    const hasXp = Number.isFinite(member?.xp);
    const xp = Math.max(0, Math.floor(hasXp ? member.xp : (storedLevel ? xpForLevel(storedLevel) : 0)));
    const derived = levelForXp(xp);
    const level = Math.max(1, Math.min(MAX_CREW_LEVEL, storedLevel ? Math.max(storedLevel, derived) : derived));
    const floorXp = xpForLevel(level);
    const ceilXp = level >= MAX_CREW_LEVEL ? floorXp : xpForLevel(level + 1);
    const span = Math.max(1, ceilXp - floorXp);
    return {
        level,
        xp,
        xpIntoLevel: Math.max(0, xp - floorXp),
        xpForNext: Math.max(0, ceilXp - xp),
        progress: level >= MAX_CREW_LEVEL ? 1 : Math.min(1, Math.max(0, (xp - floorXp) / span)),
        maxed: level >= MAX_CREW_LEVEL,
    };
}

// XP payout tuning for one finished dispatch.
export const CREW_XP_GAIN = Object.freeze({
    base: 18,
    perRisk: 12,
    perTierIndex: 3,
    failMultiplier: 0.45,       // a lost run still teaches something
    idleMultiplier: 0.5,        // autonomous contracts pay half
    roleMatchMultiplier: 1.25,  // right specialist for the job
});

/** Role → mission types the specialist is trained for. */
export const ROLE_AFFINITY = Object.freeze({
    Captain:       Object.freeze(['Combat', 'Exploration']),
    Tactician:     Object.freeze(['Combat']),
    Pilot:         Object.freeze(['Exploration', 'Combat']),
    Engineer:      Object.freeze(['Mining']),
    Navigator:     Object.freeze(['Exploration']),
    Scientist:     Object.freeze(['Research']),
    Quartermaster: Object.freeze(['Salvage', 'Mining']),
    Medic:         Object.freeze(['Salvage', 'Combat']),
});

/** True when this crew member's role is trained for this mission type. */
export function roleMatchesType(role, missionType) {
    const list = ROLE_AFFINITY[role];
    if (!list || !missionType) return false;
    return list.includes(String(missionType));
}

/**
 * XP one finished dispatch pays its assigned crew member.
 *
 * @param {object} opts
 * @param {number} [opts.risk=1]
 * @param {number} [opts.tierIndex=1]
 * @param {string} [opts.role]        assigned crew member's role
 * @param {string} [opts.type]        mission type
 * @param {boolean} [opts.won=true]
 * @param {string} [opts.dispatchMode] 'manual' | 'idle'
 * @returns {number} integer XP >= 0
 */
export function xpForMission({
    risk = 1,
    tierIndex = 1,
    role = null,
    type = null,
    won = true,
    dispatchMode = 'manual',
} = {}) {
    const r = Math.max(1, Math.min(5, Math.floor(Number.isFinite(risk) ? risk : 1)));
    const t = Math.max(1, Math.floor(Number.isFinite(tierIndex) ? tierIndex : 1));
    let xp = CREW_XP_GAIN.base + r * CREW_XP_GAIN.perRisk + t * CREW_XP_GAIN.perTierIndex;
    if (dispatchMode === 'idle') xp *= CREW_XP_GAIN.idleMultiplier;
    if (!won) xp *= CREW_XP_GAIN.failMultiplier;
    if (roleMatchesType(role, type)) xp *= CREW_XP_GAIN.roleMatchMultiplier;
    return Math.max(0, Math.round(xp));
}

/**
 * Apply an XP grant to a member record, returning the new level.
 * Never mutates the input. Levels never go down — a legacy member whose
 * stored level outranks their XP total keeps their rank.
 *
 * @returns {{level:number, xp:number, levelsGained:number}}
 */
export function awardCrewXp(member = {}, xp = 0) {
    const before = crewProgress(member);
    const total = before.xp + Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
    const level = Math.min(MAX_CREW_LEVEL, Math.max(before.level, levelForXp(total)));
    return { level, xp: total, levelsGained: Math.max(0, level - before.level) };
}

/** Roster capacity: base slots plus tech (Habitat Extension). */
export function crewSlotLimit(effects = null) {
    const extra = Number.isFinite(effects?.crewSlots) ? Math.max(0, Math.floor(effects.crewSlots)) : 0;
    return BASE_CREW_SLOTS + extra;
}

/**
 * Mother-ship berths before any tech. Compact Fuel Cell and Warp Coils add
 * two each, Habitat Extension and Shield Array one each (see
 * `research.EFFECTS_BY_NODE[...].mods.fleetSlots`).
 */
export const BASE_FLEET_SLOTS = 10;

/**
 * Fleet berth capacity: base berths plus the tech extras.
 *
 * `effects.fleetSlots` is an **extra-berths counter that starts at 0**, not a
 * capacity — reading it as the total left a fresh station with a single berth
 * while its starter fleet had four hulls, which refused every BUILD order and
 * every idle dispatch beyond the first. Same shape as `crewSlotLimit`.
 */
export function fleetSlotLimit(effects = null) {
    const extra = Number.isFinite(effects?.fleetSlots) ? Math.max(0, Math.floor(effects.fleetSlots)) : 0;
    return BASE_FLEET_SLOTS + extra;
}

/**
 * Hiring cost, escalating with roster size so an expanding fleet stays a
 * meaningful credit sink. Starter roster (5) hires at the base rate.
 */
export const HIRE_BASE_COST = 800;
export const HIRE_COST_GROWTH = 1.35;

export function hireCost(rosterSize = 0) {
    const size = Math.max(0, Math.floor(Number.isFinite(rosterSize) ? rosterSize : 0));
    const steps = Math.max(0, size - 5);
    return Math.round(HIRE_BASE_COST * Math.pow(HIRE_COST_GROWTH, steps));
}

/** Severance: fraction of the current hire cost returned on dismiss. */
export const DISMISS_RETURN = 0.3;

/**
 * Payout multiplier from crew level. Matches the factor the hub has used
 * since P4 (`1 + (level-1) × 0.04`) so idle contracts don't reprice.
 */
export function skillFactor(level = 1) {
    const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
    return 1 + (l - 1) * 0.04;
}

/** Ship-class ↔ mission-type match factor (unchanged from the P4 hub math). */
export const SHIP_MATCH_FACTOR = 1.12;
export const SHIP_MISMATCH_FACTOR = 0.94;

// Hull class → the mission types it was built for. Mirrors ROLE_AFFINITY
// for crew.
//
// This replaces the old `className.includes(missionType)` substring test,
// which never actually matched anything: no starter class name contains
// "Mining", "Combat", "Exploration", "Research" or "Salvage", so the
// ±12% / −6% fit modifier has been dead code since P4. The table below is
// what the FLEET UPGRADE tab's blueprint descriptions advertise.
export const SHIP_CLASS_AFFINITY = Object.freeze({
    Scout:     Object.freeze(['Exploration']),
    Defense:   Object.freeze(['Combat']),
    Frigate:   Object.freeze(['Combat']),
    Corvette:  Object.freeze(['Combat', 'Exploration']),
    Resource:  Object.freeze(['Mining']),
    Terraform: Object.freeze(['Research']),
    Trade:     Object.freeze(['Salvage']),
});

/**
 * True when this hull was built for this mission type.
 * Unknown/custom classes fall back to the legacy substring rule so a
 * modded or future class name still gets a chance to match.
 */
export function shipMatchesType(className, missionType) {
    if (!className || !missionType) return false;
    const list = SHIP_CLASS_AFFINITY[String(className)];
    if (list) return list.includes(String(missionType));
    return String(className).toLowerCase().includes(String(missionType).toLowerCase());
}

export function shipFactor(className, missionType) {
    return shipMatchesType(className, missionType) ? SHIP_MATCH_FACTOR : SHIP_MISMATCH_FACTOR;
}
