// Sector network: the STAR MAP's strategic layer.
//
// A **sector** is a named region of the fringe. Charting one costs warp
// cells (the resource the top bar has been showing since P3 and nothing
// ever spent) and pays out twice:
//
//   1. a one-off discovery grant (credits, rep, minerals, sometimes ore
//      or another warp cell), and
//   2. a permanent bonus — either to every dispatch flown *in that
//      sector* (`bonus`), or station-wide (`stationBonus`, for the two
//      sectors that have no mission of their own: the Nova Bazaar trade
//      hub and the Driftyard 9 repair yard).
//
// Sector names match `mission.sector` in src/missions.js one-for-one, so
// `sectorBonusForMission(mission, discoveredIds)` is a name lookup. That
// is the tie between the map and the mission board: chart the sector a
// contract flies to and that contract pays better forever.
//
// Pure + framework-free; `rng` is injected where a roll is needed.

import { resolveEffects } from './research.js';
import { repForSectorDiscovery } from './reputation.js';

export const SECTORS = Object.freeze([
    Object.freeze({
        id: 'omega-4-belt', name: 'Omega-4 Belt', warpCost: 1, threat: 1,
        specialty: 'Pyrite seams', brief: 'Routine belt work. Cheap to reach, cheap to hold.',
        bonus: Object.freeze({ oreMultiplier: 1.06 }),
        reward: Object.freeze({ credits: 180, minerals: 60, ores: Object.freeze({ red: 12 }) }),
    }),
    Object.freeze({
        id: 'gliese-fringe', name: 'Gliese Fringe', warpCost: 1, threat: 1,
        specialty: 'Ice-shard harvest', brief: 'Cold, quiet, and paying above belt rates.',
        bonus: Object.freeze({ creditMultiplier: 1.06 }),
        reward: Object.freeze({ credits: 220, minerals: 50, ores: Object.freeze({ blue: 12 }) }),
    }),
    Object.freeze({
        id: 'gliese-876', name: 'Gliese-876 System', warpCost: 2, threat: 2,
        specialty: 'Charted lanes', brief: 'Scout sweeps have the whole system mapped. Transits are faster.',
        bonus: Object.freeze({ etaMultiplier: 0.94 }),
        reward: Object.freeze({ credits: 300, minerals: 90, warp: 1 }),
    }),
    Object.freeze({
        id: 'kuiper-fringe', name: 'Kuiper Fringe', warpCost: 2, threat: 2,
        specialty: 'Xeno-archeology', brief: 'The dig guild pays for named relics, not raw tonnage.',
        bonus: Object.freeze({ repMultiplier: 1.10 }),
        reward: Object.freeze({ credits: 260, minerals: 80, ores: Object.freeze({ green: 14 }) }),
    }),
    Object.freeze({
        id: 'nova-bazaar', name: 'Nova Bazaar', warpCost: 2, threat: 1,
        specialty: 'Trade hub', brief: 'A permanent broker licence. Better sell orders station-wide.',
        stationBonus: Object.freeze({ marketSellBonus: 0.04 }),
        reward: Object.freeze({ credits: 400, minerals: 120 }),
    }),
    Object.freeze({
        id: 'driftyard-9', name: 'Driftyard 9', warpCost: 2, threat: 2,
        specialty: 'Repair yard', brief: 'Docking rights at a hull yard. Ships come home lighter-damaged.',
        stationBonus: Object.freeze({ hullDamageMultiplier: 0.90 }),
        reward: Object.freeze({ credits: 320, minerals: 160 }),
    }),
    Object.freeze({
        id: 'event-horizon', name: 'Event Horizon Shadow', warpCost: 3, threat: 3,
        specialty: 'Anomaly research', brief: 'Hazard pay is generous for anyone willing to look at it.',
        bonus: Object.freeze({ creditMultiplier: 1.10 }),
        reward: Object.freeze({ credits: 520, minerals: 150, warp: 1, ores: Object.freeze({ yellow: 16 }) }),
    }),
    Object.freeze({
        id: 'ironspan-flats', name: 'Ironspan Flats', warpCost: 3, threat: 3,
        specialty: 'Core drilling', brief: 'Dense crust. Every collapse yields more than the survey said.',
        bonus: Object.freeze({ oreMultiplier: 1.10 }),
        reward: Object.freeze({ credits: 480, minerals: 220, ores: Object.freeze({ red: 18 }) }),
    }),
    Object.freeze({
        id: 'voidwreck-field', name: 'Voidwreck Field', warpCost: 3, threat: 4,
        specialty: 'Salvage rights', brief: 'Wreckage rich enough that salvagers fight over it.',
        bonus: Object.freeze({ oreMultiplier: 1.12, repMultiplier: 1.05 }),
        reward: Object.freeze({ credits: 600, minerals: 180, ores: Object.freeze({ bomb: 6, snake: 6 }) }),
    }),
    Object.freeze({
        id: 'outer-rim-lanes', name: 'Outer Rim Lanes', warpCost: 4, threat: 4,
        specialty: 'Escort contracts', brief: 'Trade routes under raid. Escorts bill by the hour.',
        bonus: Object.freeze({ creditMultiplier: 1.12 }),
        reward: Object.freeze({ credits: 760, minerals: 200, warp: 1, ores: Object.freeze({ blue: 20 }) }),
    }),
    Object.freeze({
        id: 'seismic-rift', name: 'Seismic Rift', warpCost: 4, threat: 5,
        specialty: 'Deep survey', brief: 'Unstable crust, unstable contracts. Both pay extremely well.',
        bonus: Object.freeze({ creditMultiplier: 1.16, oreMultiplier: 1.06 }),
        reward: Object.freeze({ credits: 900, minerals: 260, ores: Object.freeze({ green: 22, yellow: 18 }) }),
    }),
    Object.freeze({
        id: 'terminus-deep', name: 'Terminus Deep', warpCost: 5, threat: 5,
        specialty: 'Collapse protocol', brief: 'The end of the charted fringe. Nothing here is safe.',
        bonus: Object.freeze({ oreMultiplier: 1.18, repMultiplier: 1.10 }),
        reward: Object.freeze({ credits: 1100, minerals: 320, warp: 1, ores: Object.freeze({ bomb: 10, snake: 8 }) }),
    }),
    Object.freeze({
        id: 'terminus-core', name: 'Terminus Core', warpCost: 5, threat: 5,
        specialty: 'Core breach', brief: 'A hollowed-out core under siege. The bounty is the whole point.',
        bonus: Object.freeze({ creditMultiplier: 1.20, repMultiplier: 1.08 }),
        reward: Object.freeze({ credits: 1250, minerals: 360, warp: 1, ores: Object.freeze({ bomb: 12, snake: 10 }) }),
    }),
]);

export const SECTOR_IDS = Object.freeze(SECTORS.map((s) => s.id));

/** Look a sector up by id. */
export function getSector(id) {
    return SECTORS.find((s) => s.id === id) || null;
}

/** Look a sector up by its display name (what missions carry). */
export function getSectorByName(name) {
    if (!name) return null;
    const needle = String(name).trim().toLowerCase();
    return SECTORS.find((s) => s.name.toLowerCase() === needle) || null;
}

/** True once a sector is charted. */
export function isSectorDiscovered(id, discoveredIds = []) {
    return Array.isArray(discoveredIds) && discoveredIds.includes(id);
}

/**
 * Warp cells a jump costs after tech modifiers.
 * Warp Coils shaves one off every plot; nothing ever costs less than 0.
 */
export function warpCostFor(sector, effects = null) {
    if (!sector) return 0;
    const delta = Number.isFinite(effects?.warpCostDelta) ? effects.warpCostDelta : 0;
    return Math.max(0, Math.floor((sector.warpCost || 0) + delta));
}

/**
 * Sector list rendered by the STAR MAP tab: each entry annotated with
 * cost-after-tech, charted state, and the bonus line to print.
 */
export function sectorRoster({ discoveredIds = [], effects = null } = {}) {
    return SECTORS.map((sector) => ({
        ...sector,
        charted: isSectorDiscovered(sector.id, discoveredIds),
        cost: warpCostFor(sector, effects),
        bonusLabel: bonusLabelFor(sector),
    }));
}

/** One-line human description of what charting a sector buys. */
export function bonusLabelFor(sector) {
    if (!sector) return '';
    const parts = [];
    const bonus = sector.bonus || {};
    const station = sector.stationBonus || {};
    if (bonus.creditMultiplier) parts.push(`credits +${pct(bonus.creditMultiplier - 1)}`);
    if (bonus.oreMultiplier) parts.push(`ore +${pct(bonus.oreMultiplier - 1)}`);
    if (bonus.repMultiplier) parts.push(`rep +${pct(bonus.repMultiplier - 1)}`);
    if (bonus.etaMultiplier) parts.push(`ETA −${pct(1 - bonus.etaMultiplier)}`);
    if (station.marketSellBonus) parts.push(`station: market sells +${pct(station.marketSellBonus)}`);
    if (station.hullDamageMultiplier) parts.push(`station: hull wear −${pct(1 - station.hullDamageMultiplier)}`);
    return parts.join(' · ') || 'No bonus';
}

function pct(fraction) {
    return `${Math.round(fraction * 100)}%`;
}

/**
 * Combined multiplier bundle a charted sector applies to a dispatch
 * flying to it. Returns neutral 1s for uncharted sectors so callers can
 * multiply blindly.
 */
export function sectorBonusForMission(mission, discoveredIds = []) {
    const neutral = { creditMultiplier: 1, oreMultiplier: 1, repMultiplier: 1, etaMultiplier: 1, charted: false, sectorId: null };
    const sector = getSectorByName(mission?.sector);
    if (!sector || !isSectorDiscovered(sector.id, discoveredIds)) return neutral;
    const b = sector.bonus || {};
    return {
        creditMultiplier: b.creditMultiplier ?? 1,
        oreMultiplier: b.oreMultiplier ?? 1,
        repMultiplier: b.repMultiplier ?? 1,
        etaMultiplier: b.etaMultiplier ?? 1,
        charted: true,
        sectorId: sector.id,
    };
}

/**
 * Station-wide bonuses from charted hub sectors (Nova Bazaar, Driftyard 9),
 * folded on top of a research effect bundle. Returns a new frozen object;
 * the input bundle is never mutated.
 */
export function applyStationBonuses(effects = null, discoveredIds = []) {
    const base = { ...(effects || resolveEffects([])) };
    for (const sector of SECTORS) {
        const station = sector.stationBonus;
        if (!station || !isSectorDiscovered(sector.id, discoveredIds)) continue;
        for (const [key, value] of Object.entries(station)) {
            if (!(key in base)) continue;
            if (typeof value === 'boolean') base[key] = base[key] || value;
            else if (key.endsWith('Multiplier')) base[key] = base[key] * value;
            else base[key] = base[key] + value;
        }
    }
    return Object.freeze(base);
}

/**
 * Attempt a warp jump.
 *
 * @param {object} opts
 * @param {string} opts.sectorId
 * @param {number} opts.warp            warp cells currently held
 * @param {string[]} [opts.discoveredIds]
 * @param {object} [opts.effects]       resolved research effects
 * @param {number} [opts.repTier]       dispatcher rep tier (gates threat 5)
 * @returns {{ok:boolean, reason:string|null, sector:object|null, warpSpent:number,
 *            rewards:{credits:number, rep:number, minerals:number, warp:number, ores:Record<string,number>},
 *            newWarp:number}}
 */
export function plotCourse({ sectorId, warp = 0, discoveredIds = [], effects = null, repTier = 1 } = {}) {
    const sector = getSector(sectorId);
    const fail = (reason) => ({
        ok: false,
        reason,
        sector,
        warpSpent: 0,
        rewards: { credits: 0, rep: 0, minerals: 0, warp: 0, ores: {} },
        newWarp: Math.max(0, Math.floor(warp || 0)),
    });

    if (!sector) return fail('unknown sector');
    if (isSectorDiscovered(sector.id, discoveredIds)) return fail('sector already charted');

    const held = Math.max(0, Math.floor(Number.isFinite(warp) ? warp : 0));
    const cost = warpCostFor(sector, effects);
    if (held < cost) return fail(`need ${cost} warp cell${cost === 1 ? '' : 's'}`);

    // Threat-5 sectors need a dispatcher who has earned the clearance.
    const rank = Math.max(1, Math.floor(Number.isFinite(repTier) ? repTier : 1));
    if (sector.threat >= 5 && rank < 3) return fail('requires REP tier 3 clearance');

    const reward = sector.reward || {};
    const rewards = {
        credits: Math.max(0, Math.floor(reward.credits || 0)),
        rep: repForSectorDiscovery({ effects }),
        minerals: Math.max(0, Math.floor(reward.minerals || 0)),
        warp: Math.max(0, Math.floor(reward.warp || 0)),
        ores: { ...(reward.ores || {}) },
    };

    return {
        ok: true,
        reason: null,
        sector,
        warpSpent: cost,
        rewards,
        newWarp: held - cost + rewards.warp,
    };
}

/** How many sectors are charted / chartable — the STAR MAP completion read-out. */
export function discoveryProgress(discoveredIds = []) {
    const charted = SECTORS.filter((s) => isSectorDiscovered(s.id, discoveredIds)).length;
    return { charted, total: SECTORS.length, pct: SECTORS.length ? charted / SECTORS.length : 0 };
}
