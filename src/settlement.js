// Dispatch settlement: the single place where a finished mission turns
// into banked resources.
//
// Two dispatch paths existed with two different reward implementations —
// `RunLedger.rewardEnvelope()` for manual minigame runs (credits + raw ore
// counts, ignoring ship/crew/tech/sector entirely) and the hub's
// `_claimIdleMission()` for idle contracts (credits baked at dispatch
// time, one ore per reward id). Crew level and ship class only ever
// affected the idle path, research only ever affected nothing, and
// sectors did not exist.
//
// `settleMission()` replaces both. One call takes the mission, the
// dispatch job (ship + crew pairing), the run summary, the resolved
// research effects and the charted-sector list, and returns a complete
// settlement: credits, ores, reputation, crew XP, hull wear, warp cells,
// and a human-readable log of every modifier that fired. Both callers
// then hand the result to `MetaState.applySettlement()` so one `change`
// event (and one save) covers the whole payout.
//
// Pure + framework-free: no DOM, no Pixi, no timers, no MetaState import.
// `nowMs` is injected where a timestamp is needed.

import { PIECE_COMPLEXITY } from './constants.js';
import { IDLE_DURATION_SEC_BY_RISK, ORES, ORE_BY_COLOR } from './missions.js';
import { resolveEffects } from './research.js';
import { sectorBonusForMission } from './star-map.js';
import { repForMission } from './reputation.js';
import {
    xpForMission,
    awardCrewXp,
    skillFactor,
    shipFactor,
    shipMatchesType,
} from './crew.js';
import { warpRewardFor } from './economy.js';

// ore id -> board colour. MetaState stores ore counts by colour, but idle
// job records carry ore *ids* (pyrite, cryonite, ...), so the idle path
// needs the reverse of missions.js ORE_BY_COLOR.
const ORE_COLOR_BY_ID = Object.freeze(
    ORES.reduce((m, o) => { m[o.id] = o.color; return m; }, {}),
);

// Hull wear tuning. A dispatch costs the ship `risk × 2` hull points,
// plus a penalty for coming home without finishing the objective, minus
// whatever Hull Plating / Countermeasures / Shield Array / Driftyard 9
// absorb. Wear is what makes the FLEET UPGRADE tab's REPAIR button and
// the minerals sink matter.
export const HULL_WEAR = Object.freeze({
    perRisk: 2,
    failurePenalty: 6,
    idleMultiplier: 0.6,      // autonomous contracts are flown conservatively
    shieldAbsorb: 4,          // flat points absorbed while a shield charge lasts
});

/** Complexity → environment level (1 classic, 2 mutated, 3 collapsed). */
export function environmentLevelForMission(mission) {
    const complexity = mission?.gameConfig?.complexity;
    if (complexity === PIECE_COMPLEXITY.COLLAPSED) return 3;
    if (complexity === PIECE_COMPLEXITY.MUTATED) return 2;
    return 1;
}

/**
 * Idle contract duration in seconds. Same shape the hub has used since
 * P4 (risk base + tier bonus + environment bonus + ship-fit penalty),
 * now scaled by Ion Thrusters and a charted sector's survey bonus.
 */
export function idleEtaSecForMission(mission, { shipTypeMatch = false, effects = null, sectorBonus = null } = {}) {
    const base = IDLE_DURATION_SEC_BY_RISK[mission?.risk] || 240;
    const tierBonus = Math.max(0, ((mission?.tierIndex || 1) - 1) * 15);
    const envBonus = (environmentLevelForMission(mission) - 1) * 25;
    const fitPenalty = shipTypeMatch ? -12 : 16;
    const raw = Math.max(60, base + tierBonus + envBonus + fitPenalty);
    const techMult = Number.isFinite(effects?.etaMultiplier) ? effects.etaMultiplier : 1;
    const sectorMult = Number.isFinite(sectorBonus?.etaMultiplier) ? sectorBonus.etaMultiplier : 1;
    return Math.max(45, Math.round(raw * techMult * sectorMult));
}

/**
 * Price a dispatch *before* it flies: the numbers the mission planner
 * shows and an idle job bakes into its record.
 *
 * @returns {{rewardCredits:number, etaSec:number, threatLevel:number,
 *            environmentLevel:number, rewardOres:{common:string[], rare:string[]},
 *            shipTypeMatch:boolean, crewFactor:number, sectorCharted:boolean,
 *            creditsBreakdown:Array<{label:string, amount:number}>}}
 */
export function resolveDispatch({ mission, ship = null, crew = null, effects = null, discoveredSectors = [] } = {}) {
    const fx = effects || resolveEffects([]);
    const sector = sectorBonusForMission(mission, discoveredSectors);
    const shipTypeMatch = shipMatchesType(ship?.className, mission?.type);
    // A dispatch with no assigned ship/crew (quick-ACCEPT straight from a
    // board card) is neutral — the fit modifier only bites when the player
    // actually chose a hull and it was the wrong one for the job.
    const crewFactor = crew ? skillFactor(crew.level) : 1;
    const shipMult = ship ? shipFactor(ship.className, mission?.type) : 1;

    const base = Math.max(0, Math.floor(mission?.baseCredits || 0));
    const credits = Math.max(60, Math.round(base * crewFactor * shipMult * sector.creditMultiplier * fx.creditMultiplier));

    const breakdown = [{ label: 'Contract base', amount: base }];
    if (crew && crewFactor !== 1) breakdown.push({ label: `${crew.name} Lv${crew.level}`, amount: Math.round(base * crewFactor) - base });
    if (ship && shipMult !== 1) breakdown.push({ label: shipTypeMatch ? `${ship.name} fit` : 'Ship off-spec', amount: Math.round(base * crewFactor * shipMult) - Math.round(base * crewFactor) });
    if (sector.charted && sector.creditMultiplier !== 1) breakdown.push({ label: `${mission?.sector} charted`, amount: credits - Math.round(base * crewFactor * shipMult) });

    return {
        rewardCredits: credits,
        etaSec: idleEtaSecForMission(mission, { shipTypeMatch, effects: fx, sectorBonus: sector }),
        threatLevel: Math.max(1, Math.floor(mission?.risk || 1)),
        environmentLevel: environmentLevelForMission(mission),
        rewardOres: expectedRewardOres(mission),
        shipTypeMatch,
        crewFactor,
        sectorCharted: sector.charted,
        sectorBonus: sector,
        creditsBreakdown: breakdown,
    };
}

/** The `{common, rare}` ore-id lanes an idle contract pays (unchanged shape). */
export function expectedRewardOres(mission) {
    const expected = Array.isArray(mission?.expectedOres) ? mission.expectedOres : [];
    return {
        common: expected.filter((id) => id !== 'volatiles' && id !== 'biomass').slice(0, 2),
        rare: expected.filter((id) => id === 'volatiles' || id === 'biomass').slice(0, 1),
    };
}

/**
 * Scale a per-colour ore tally by the yield modifiers.
 *
 * Rounding is `Math.round` with a floor of 1 for any colour that earned
 * something, so a small multiplier can never delete a haul. When the
 * Advanced Mining Laser is online and the run actually mined a hazard
 * cell, `rareBonus` extra units land in the richest rare bucket.
 */
export function scaleOreCounts(counts = {}, multiplier = 1, { rareBonus = 0 } = {}) {
    const mult = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    const out = {};
    let rareMined = 0;
    let rareKey = 'bomb';
    for (const [color, raw] of Object.entries(counts || {})) {
        const n = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
        out[color] = n > 0 ? Math.max(1, Math.round(n * mult)) : 0;
        const ore = ORE_BY_COLOR[color];
        if (ore?.rarity === 'rare' && out[color] > 0) {
            rareMined += out[color];
            if (out[color] >= (out[rareKey] || 0)) rareKey = color;
        }
    }
    if (rareBonus > 0 && rareMined > 0) {
        out[rareKey] = (out[rareKey] || 0) + Math.floor(rareBonus);
    }
    return out;
}

/** Hull points a finished dispatch costs its ship. */
export function hullDamageFor({ risk = 1, won = true, effects = null, dispatchMode = 'manual' } = {}) {
    const fx = effects || resolveEffects([]);
    const r = Math.max(1, Math.min(5, Math.floor(Number.isFinite(risk) ? risk : 1)));
    let damage = r * HULL_WEAR.perRisk + (won ? 0 : HULL_WEAR.failurePenalty);
    if (dispatchMode === 'idle') damage *= HULL_WEAR.idleMultiplier;
    damage *= Number.isFinite(fx.hullDamageMultiplier) ? fx.hullDamageMultiplier : 1;
    let absorbed = 0;
    if ((fx.shieldCharges || 0) > 0 && damage > 0) {
        absorbed = Math.min(damage, HULL_WEAR.shieldAbsorb);
        damage -= absorbed;
    }
    return {
        damage: Math.max(0, Math.round(damage)),
        absorbed: Math.round(absorbed),
    };
}

/**
 * Settle one finished dispatch.
 *
 * @param {object} opts
 * @param {object}  opts.mission           catalog mission record
 * @param {object} [opts.job]              dispatch job (ship/crew pairing + baked idle rewards)
 * @param {object} [opts.summary]          RunLedger/DefenseLedger summary (manual runs)
 * @param {object} [opts.ship]
 * @param {object} [opts.crew]
 * @param {object} [opts.effects]          resolved research + station bonuses
 * @param {string[]} [opts.discoveredSectors]
 * @param {'manual'|'idle'} [opts.dispatchMode='manual']
 * @param {boolean} [opts.won=true]
 * @param {boolean} [opts.aborted=false]   idle contract RETURNed early
 * @returns {object} settlement (see module header)
 */
export function settleMission({
    mission = null,
    job = null,
    summary = null,
    ship = null,
    crew = null,
    effects = null,
    discoveredSectors = [],
    dispatchMode = 'manual',
    won = true,
    aborted = false,
    nowMs = null,
} = {}) {
    const fx = effects || resolveEffects([]);
    const mode = dispatchMode === 'idle' ? 'idle' : 'manual';
    const sector = sectorBonusForMission(mission || job, discoveredSectors);
    const risk = Math.max(1, Math.min(5, Math.floor(mission?.risk ?? job?.risk ?? 1)));
    const tierIndex = Math.max(1, Math.floor(mission?.tierIndex ?? 1));
    const type = mission?.type || job?.type || 'Mining';

    // ---- credits ---------------------------------------------------
    let credits = 0;
    const creditsBreakdown = [];
    if (mode === 'idle') {
        // Idle jobs bake their payout at dispatch time (resolveDispatch
        // already applied crew, ship, sector and tech then).
        credits = Math.max(0, Math.floor(job?.rewardCredits || 0));
        creditsBreakdown.push({ label: 'Contract payout', amount: credits });
        if (aborted) {
            const partial = Math.max(0, Math.floor(credits * progressOf(job, nowMs)));
            creditsBreakdown.push({ label: 'Returned early', amount: partial - credits });
            credits = partial;
        }
    } else {
        const base = Math.max(0, Math.floor(summary?.credits || 0));
        const crewMult = crew ? skillFactor(crew.level) : 1;
        const shipMult = ship ? shipFactor(ship.className, type) : 1;
        const withCrew = Math.round(base * crewMult);
        const withShip = Math.round(withCrew * shipMult);
        credits = Math.max(0, Math.round(withShip * sector.creditMultiplier * fx.creditMultiplier));
        creditsBreakdown.push({ label: 'Run haul (base + score)', amount: base });
        if (crew && withCrew !== base) creditsBreakdown.push({ label: `${crew.name} Lv${crew.level}`, amount: withCrew - base });
        if (ship && withShip !== withCrew) creditsBreakdown.push({ label: shipMatchesType(ship.className, type) ? `${ship.name} fit` : 'Ship off-spec', amount: withShip - withCrew });
        if (sector.charted && sector.creditMultiplier !== 1) {
            creditsBreakdown.push({ label: `${mission?.sector || 'Sector'} charted`, amount: credits - withShip });
        }
    }

    // ---- ores ------------------------------------------------------
    const oreMult = (Number.isFinite(fx.oreYieldMultiplier) ? fx.oreYieldMultiplier : 1) * sector.oreMultiplier;
    let ores = {};
    if (mode === 'idle') {
        const counts = {};
        const add = (oreId) => {
            const color = ORE_COLOR_BY_ID[oreId];
            if (!color) return;
            counts[color] = (counts[color] || 0) + 1;
        };
        (job?.rewardOres?.common || []).forEach(add);
        (job?.rewardOres?.rare || []).forEach(add);
        // Idle contracts haul in bulk: each reward lane is worth a
        // risk-scaled stack, not a single unit.
        const stack = Math.max(1, risk * 2);
        for (const color of Object.keys(counts)) counts[color] *= stack;
        ores = aborted ? {} : scaleOreCounts(counts, oreMult, { rareBonus: fx.rareOreBonus });
    } else {
        ores = scaleOreCounts(summary?.ores || {}, oreMult, { rareBonus: fx.rareOreBonus });
    }

    // ---- reputation / crew XP / hull / warp ------------------------
    const repMult = fx.repMultiplier * sector.repMultiplier;
    const rep = repForMission({
        risk, tierIndex, type, won,
        dispatchMode: mode,
        aborted,
        effects: { ...fx, repMultiplier: repMult },
    });

    const crewXp = aborted ? 0 : xpForMission({
        risk, tierIndex, role: crew?.role, type, won, dispatchMode: mode,
    });
    const crewResult = crew ? awardCrewXp(crew, crewXp) : null;

    const hull = aborted
        ? { damage: 0, absorbed: 0 }
        : hullDamageFor({ risk, won, effects: fx, dispatchMode: mode });

    const warp = warpRewardFor({ type, risk, won, dispatchMode: mode });

    // ---- log -------------------------------------------------------
    const log = [];
    if (crewResult && crewResult.levelsGained > 0) {
        log.push(`${crew?.name || 'Crew'} reached level ${crewResult.level}`);
    }
    if (sector.charted) log.push(`${mission?.sector || job?.title || 'Sector'} charted — bonus applied`);
    if (fx.oreYieldMultiplier !== 1) log.push(`Ore yield ×${fx.oreYieldMultiplier.toFixed(2)}`);
    if (fx.rareOreBonus > 0 && (ores.bomb > 0 || ores.snake > 0)) log.push(`Mining laser banked +${fx.rareOreBonus} hazard ore`);
    if (hull.absorbed > 0) log.push(`Shield array absorbed ${hull.absorbed} hull damage`);
    if (hull.damage > 0) log.push(`${ship?.name || 'Ship'} took ${hull.damage} hull damage`);
    if (warp > 0) log.push(`Recovered ${warp} warp cell${warp === 1 ? '' : 's'}`);
    if (aborted) log.push('Contract returned early — partial payout');

    return {
        ok: true,
        dispatchMode: mode,
        won: !!won,
        aborted: !!aborted,
        missionId: mission?.id || job?.missionId || null,
        jobId: job?.id || null,
        title: mission?.narrativeName || job?.title || 'Dispatch',
        sector: mission?.sector || job?.sector || null,
        tierIndex,
        risk,
        type,
        variant: mission?.variant || 'standard',
        shipId: ship?.id || job?.shipId || null,
        shipName: ship?.name || job?.shipName || null,
        crewId: crew?.id || job?.crewId || null,
        crewName: crew?.name || job?.crewName || null,
        credits,
        creditsBreakdown,
        ores,
        rep,
        crewXp,
        crewLevel: crewResult ? crewResult.level : (crew?.level ?? null),
        crewLevelsGained: crewResult ? crewResult.levelsGained : 0,
        hullDamage: hull.damage,
        hullAbsorbed: hull.absorbed,
        warp,
        sectorCharted: sector.charted,
        finalScore: Math.max(0, Math.floor(summary?.finalScore || 0)),
        statLabels: summary?.statLabels || null,
        minigame: summary?.minigame || (mode === 'manual' ? 'puzzle' : 'idle'),
        log,
    };
}

// Elapsed fraction of a job. `nowMs` is injected by the host so an abort
// is reproducible in tests; the wall clock is only the fallback.
function progressOf(job, nowMs = null) {
    if (!job || !Number.isFinite(job.startedAt) || !Number.isFinite(job.endsAt)) return 0;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const total = Math.max(1, job.endsAt - job.startedAt);
    const elapsed = Math.max(0, now - job.startedAt);
    return Math.min(1, elapsed / total);
}
