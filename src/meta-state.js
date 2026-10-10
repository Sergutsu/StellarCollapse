// Persistent player profile. Pure, framework-free, event-emitting so
// view layers can react without polling. Owned by main.js, hydrated on
// boot from Persistence, and re-saved on every `change`.
//
// Scope for P3: hold the hub's resource strip, fleet roster, crew
// roster, credits, per-color ore counts, reputation tier, and the list
// of completed mission ids. Mutations are exposed for P1 (results
// screen applying mission rewards) but no gameplay module calls them
// yet -- that wiring lands in P1.
//
// P4 (idle dispatch) added activeMissions + lastTickAt for persistent
// wall-time autonomous missions. Shape remains additive for future phases.

import { Emitter } from './emitter.js';
import { resolveEffects } from './research.js';
import { applyStationBonuses, plotCourse, SECTOR_IDS } from './star-map.js';
import { tierForRep, repInfo } from './reputation.js';
import { awardCrewXp, xpForLevel, crewSlotLimit, fleetSlotLimit } from './crew.js';
import { balanceKeyFor, refinePlan } from './economy.js';
import { normalizeBoardState, rerollCost } from './daily.js';

// Bumped 1 → 2 when the P8 meta systems landed (reputation points, crew
// XP, charted sectors, daily board state, lifetime stats). v1 blobs are
// migrated forward on load by Persistence + `_merge`; nothing is dropped.
export const META_SAVE_VERSION = 2;
export const META_SAVE_VERSIONS_SUPPORTED = Object.freeze([1, 2]);

/** Warp cells the station can hold before research expands the racks. */
export const BASE_WARP_CAPACITY = 5;
const SHIP_STATUSES = Object.freeze(new Set(['Standby', 'On Mission']));
const CREW_STATUSES = Object.freeze(new Set(['Available', 'On Mission']));

// 6-ore palette. Matches the actual tile colors used by the gameplay
// board -- 4 normal colors (`NORMAL_COLORS` in constants.js) plus the
// two special hazard tiles `bomb` and `snake`. Matches `ORES` /
// `ORE_BY_COLOR` in `missions.js` 1:1 so P1's run-tally can translate
// cleared-cell colors straight into ore ids. Order is stable because
// tests + saved snapshots depend on it.
export const ORE_IDS = Object.freeze([
    'red',
    'blue',
    'green',
    'yellow',
    'bomb',
    'snake',
]);

// Hub top-bar resource ids. These are aggregate / life-support style
// counts the player sees at the top of the hub. Per-color ore counts
// live on meta.ores instead.
export const HUB_RESOURCE_IDS = Object.freeze([
    'minerals',
    'credits',
    'warp',
]);

// Starter profile -- matches what the hub rendered as static strings in
// P2 so first-boot looks identical to pre-persistence. Every numeric
// field is a number here (view formats them); saving a string by
// accident is an easy bug to catch.
const STARTER_PROFILE = Object.freeze({
    credits: 4800,
    hubResources: Object.freeze({
        minerals: 1200,
        warp: 3,
    }),
    ores: Object.freeze({
        red: 0,
        blue: 0,
        green: 0,
        yellow: 0,
        bomb: 0,
        snake: 0,
    }),
    fleet: Object.freeze([
        Object.freeze({ id: 'ship-1', name: 'Nyx-I',      className: 'Scout',     hull: 100, status: 'Standby' }),
        Object.freeze({ id: 'ship-2', name: 'Aegis-Delta', className: 'Defense',   hull: 96,  status: 'Standby' }),
        Object.freeze({ id: 'ship-3', name: 'Prospector', className: 'Resource',  hull: 92,  status: 'Standby' }),
        Object.freeze({ id: 'ship-4', name: 'Gaia-Line',  className: 'Terraform', hull: 94,  status: 'Standby' }),
        Object.freeze({ id: 'ship-5', name: 'Mercury Arc', className: 'Trade',     hull: 89,  status: 'Standby' }),
    ]),
    crew: Object.freeze([
        Object.freeze({ id: 'crew-1', name: 'V. Draeven',  role: 'Captain',    level: 4, status: 'Available' }),
        Object.freeze({ id: 'crew-2', name: 'T. Halveri',  role: 'Engineer',   level: 3, status: 'Available' }),
        Object.freeze({ id: 'crew-3', name: 'K. Saros',    role: 'Navigator',  level: 2, status: 'Available' }),
        Object.freeze({ id: 'crew-4', name: 'L. Marrow',   role: 'Tactician',  level: 3, status: 'Available' }),
        Object.freeze({ id: 'crew-5', name: 'I. Nadir',    role: 'Quartermaster', level: 2, status: 'Available' }),
    ]),
    reputationTier: 1,
    // P8: cumulative reputation points. `reputationTier` is derived from
    // this (reputation.js ladder) and kept in the blob so old readers and
    // the save schema stay stable.
    reputation: 0,
    completedMissionIds: Object.freeze([]),
    // P8: STAR MAP charted sectors (warp-cell sinks + payout bonuses).
    discoveredSectors: Object.freeze([]),
    // P8: daily mission-board state ({ dayKey, rerollsToday }).
    board: Object.freeze({ dayKey: '', rerollsToday: 0 }),
    // P8: lifetime dispatcher stats (read by the hub + results screen).
    stats: Object.freeze({
        missionsCompleted: 0,
        missionsFailed: 0,
        combatWins: 0,
        idleClaims: 0,
        idleAborts: 0,
        creditsEarned: 0,
        oresMined: 0,
        mineralsRefined: 0,
        repEarned: 0,
        sectorsCharted: 0,
        warpSpent: 0,
        warpFound: 0,
        hullRepairs: 0,
        crewLevelsGained: 0,
        bestScore: 0,
    }),
    // P4: persistent idle dispatches (source of truth for Hub left column)
    activeMissions: Object.freeze([]),
    lastTickAt: 0,
    // Research system - multiple concurrent projects + upgradable slots
    research: Object.freeze({
        completed: Object.freeze([]),
        activeResearches: Object.freeze([]), // [{ nodeId, startedAt, accumulatedMs }]
        maxConcurrent: 2,
    }),
    // P10: lightweight UI preferences. `helpSeen` stops the first-boot
    // HOW TO PLAY overlay from re-appearing once the manual is read.
    ui: Object.freeze({
        helpSeen: false,
    }),
});

export function starterProfile() {
    // Deep clone so callers can mutate safely.
    const profile = {
        credits: STARTER_PROFILE.credits,
        hubResources: { ...STARTER_PROFILE.hubResources },
        ores: { ...STARTER_PROFILE.ores },
        fleet: STARTER_PROFILE.fleet.map((s) => ({ ...s })),
        crew: STARTER_PROFILE.crew.map((c) => ({ ...c })),
        reputationTier: STARTER_PROFILE.reputationTier,
        reputation: 0,
        completedMissionIds: [...STARTER_PROFILE.completedMissionIds],
        discoveredSectors: [],
        board: { dayKey: '', rerollsToday: 0 },
        stats: { ...STARTER_PROFILE.stats },
        activeMissions: [],
        lastTickAt: Date.now(),
        research: {
            completed: [],
            activeResearches: [],
            maxConcurrent: 2,
        },
        ui: {
            helpSeen: false,
        },
    };
    // Starter crew are veterans: seed their XP at their level threshold so
    // the CREW tab's bar reads 0% toward the next level instead of showing
    // a level-4 officer with zero career XP.
    profile.crew.forEach((c) => { c.xp = xpForLevel(c.level); });
    return profile;
}

export class MetaState {
    constructor(initial = null) {
        this._emitter = new Emitter();
        this._data = initial ? this._merge(starterProfile(), initial) : starterProfile();
    }

    on(event, handler)  { return this._emitter.on(event, handler); }
    off(event, handler) { this._emitter.off(event, handler); }

    // ---- reads -------------------------------------------------------

    get credits()             { return this._data.credits; }
    get reputationTier()      { return this._data.reputationTier; }
    get completedMissionIds() { return this._data.completedMissionIds.slice(); }

    // Return a defensive copy of a hub resource record suitable for
    // rendering. Id is the HUB_RESOURCE_IDS key; formatting lives on
    // the view. `credits` is handled specially so the chip pulls from
    // the top-level credits field.
    getHubResource(id) {
        if (id === 'credits') return this._data.credits;
        return this._data.hubResources[id];
    }

    getOre(color) {
        return this._data.ores[color] ?? 0;
    }

    fleetSnapshot() { return this._data.fleet.map((s) => ({ ...s })); }
    crewSnapshot()  { return this._data.crew.map((c)  => ({ ...c })); }

    // ---- P8 meta reads ----------------------------------------------
    //
    // These are the read side of the completed meta loop: reputation,
    // resolved research + station effects, charted sectors, the daily
    // board record, and lifetime stats. All return defensive copies.

    /** Cumulative reputation points. */
    get reputation() { return this._data.reputation || 0; }

    /** Full rep read-out: tier, title, progress toward the next rank. */
    getRepInfo() { return repInfo(this.reputation); }

    /**
     * Every modifier currently in force: research nodes folded together,
     * then charted-sector station bonuses (Nova Bazaar, Driftyard 9) on
     * top. This is the single object settlement.js / economy.js read.
     */
    getEffects() {
        return applyStationBonuses(
            resolveEffects(this.getResearchState().completed),
            this.discoveredSectorIds(),
        );
    }

    discoveredSectorIds() { return [...(this._data.discoveredSectors || [])]; }

    isSectorDiscovered(id) { return (this._data.discoveredSectors || []).includes(id); }

    getStats() { return { ...(this._data.stats || {}) }; }

    /** Per-colour ore counts (the hold the MARKET tab trades out of). */
    oreCounts() { return { ...(this._data.ores || {}) }; }

    /** P10: has the HOW TO PLAY manual been opened before? */
    hasSeenHelp() { return !!(this._data.ui && this._data.ui.helpSeen); }

    /** P10: record that the manual has been read (one save, idempotent). */
    markHelpSeen() {
        if (this.hasSeenHelp()) return;
        this._data.ui = { ...(this._data.ui || {}), helpSeen: true };
        this._changed('ui', { helpSeen: true });
    }

    /**
     * Today's mission-board record, normalised: a stale `dayKey` resets
     * the paid-reroll counter because the board refreshed for free.
     */
    /**
     * Today's board record, with the daily reroll cap lifted by the
     * research allowance (`effects.riskRerolls`).
     */
    getBoardState(nowMs = Date.now()) {
        return normalizeBoardState(this._data.board, nowMs, {
            extraRerolls: this.getEffects().riskRerolls || 0,
        });
    }

    /** Warp cells the station can hold (base + Compact Fuel Cell racks). */
    warpCapacity() {
        return BASE_WARP_CAPACITY + Math.max(0, Math.floor(this.getEffects().warpCapacity || 0));
    }

    /** Crew roster capacity (base + Habitat Extension). */
    crewSlots() { return crewSlotLimit(this.getEffects()); }

    /** Mother-ship berths (base + Fuel Cell / Warp Coils / Habitat / Shields). */
    fleetSlots() { return fleetSlotLimit(this.getEffects()); }

    // P4: defensive copy of currently dispatched idle jobs (the live source
    // for the hub's left column). Jobs are plain objects with baked rewards
    // and absolute endsAt times.
    activeMissionsSnapshot() {
        return (this._data.activeMissions || []).map((j) => ({
            ...j,
            rewardOres: j && j.rewardOres ? { ...j.rewardOres } : { common: [], rare: [] },
        }));
    }

    // Full snapshot for Persistence.save(). Includes the schema version
    // so loaders can refuse incompatible blobs instead of corrupting.
    snapshot() {
        return {
            version: META_SAVE_VERSION,
            credits: this._data.credits,
            hubResources: { ...this._data.hubResources },
            ores: { ...this._data.ores },
            fleet: this._data.fleet.map((s) => ({ ...s })),
            crew: this._data.crew.map((c) => ({ ...c })),
            reputationTier: this._data.reputationTier,
            reputation: this._data.reputation || 0,
            discoveredSectors: [...(this._data.discoveredSectors || [])],
            board: { ...(this._data.board || { dayKey: '', rerollsToday: 0 }) },
            stats: { ...(this._data.stats || {}) },
            completedMissionIds: this._data.completedMissionIds.slice(),
            activeMissions: (this._data.activeMissions || []).map((j) => ({
                ...j,
                rewardOres: j && j.rewardOres ? { ...j.rewardOres } : { common: [], rare: [] },
            })),
            lastTickAt: this._data.lastTickAt || Date.now(),
            research: this.getResearchState(),
            ui: { helpSeen: !!(this._data.ui && this._data.ui.helpSeen) },
        };
    }

    // ---- writes ------------------------------------------------------
    //
    // Each mutation emits `change` with a `{ kind, detail }` payload so
    // the persistence layer can save + the view can targeted-refresh
    // without a full re-render. P3 currently only relies on `change`
    // firing at all (save everything); kind/detail are for P4+.

    setCredits(n) {
        const v = Math.max(0, Math.floor(n));
        if (v === this._data.credits) return;
        this._data.credits = v;
        this._changed('credits', { value: v });
    }

    addCredits(delta) {
        this.setCredits(this._data.credits + delta);
    }

    setHubResource(id, n) {
        if (id === 'credits') { this.setCredits(n); return; }
        if (!(id in this._data.hubResources)) return;
        const v = Math.max(0, Math.floor(n));
        if (v === this._data.hubResources[id]) return;
        this._data.hubResources[id] = v;
        this._changed('hub-resource', { id, value: v });
    }

    addOre(color, delta) {
        if (!(color in this._data.ores)) return;
        const v = Math.max(0, Math.floor(this._data.ores[color] + delta));
        if (v === this._data.ores[color]) return;
        this._data.ores[color] = v;
        this._changed('ore', { color, value: v });
    }

    // Convenience for the P1 results screen: apply a full mission
    // reward envelope in one shot so only one save fires.
    //
    // Credits + ore deltas are floored to integers to match the
    // `setCredits` / `addOre` contract (GAMEPLAY.md: "Clamps >= 0,
    // floors to int"). A caller passing a fractional value would
    // otherwise leave the in-memory state unrounded until the next
    // reload through `_merge`.
    applyMissionReward({ credits = 0, ores = {}, missionId = null } = {}) {
        let dirty = false;
        if (credits) {
            this._data.credits = Math.max(0, Math.floor(this._data.credits + credits));
            dirty = true;
        }
        for (const color of ORE_IDS) {
            const n = ores[color];
            if (n) {
                this._data.ores[color] = Math.max(0, Math.floor(this._data.ores[color] + n));
                dirty = true;
            }
        }
        if (missionId && !this._data.completedMissionIds.includes(missionId)) {
            this._data.completedMissionIds.push(missionId);
            dirty = true;
        }
        if (dirty) this._changed('mission-reward', { credits, ores, missionId });
    }

    setShipHull(id, hull) {
        const ship = this._data.fleet.find((s) => s.id === id);
        if (!ship) return;
        const v = Math.max(0, Math.min(100, Math.floor(hull)));
        if (v === ship.hull) return;
        ship.hull = v;
        this._changed('ship-hull', { id, hull: v });
    }

    setShipStatus(id, status) {
        if (!this._rawSetShipStatus(id, status)) return;
        const ship = this._data.fleet.find((s) => s.id === id);
        this._changed('ship-status', { id, status: ship.status });
    }

    /** True when the status actually moved (callers batch their own event). */
    _rawSetShipStatus(id, status) {
        const ship = this._data.fleet.find((s) => s.id === id);
        if (!ship) return false;
        const normalized = SHIP_STATUSES.has(status) ? status : 'Standby';
        if (ship.status === normalized) return false;
        ship.status = normalized;
        return true;
    }

    setCrewLevel(id, level) {
        const c = this._data.crew.find((m) => m.id === id);
        if (!c) return;
        const v = Math.max(1, Math.floor(level));
        if (v === c.level) return;
        c.level = v;
        this._changed('crew-level', { id, level: v });
    }

    setCrewStatus(id, status) {
        if (!this._rawSetCrewStatus(id, status)) return;
        const c = this._data.crew.find((m) => m.id === id);
        this._changed('crew-status', { id, status: c.status });
    }

    /** True when the status actually moved (callers batch their own event). */
    _rawSetCrewStatus(id, status) {
        const c = this._data.crew.find((m) => m.id === id);
        if (!c) return false;
        // Legacy saves may include "Resting". Crew currently only has
        // two gameplay statuses, so any unknown value gets normalized
        // back to Available on load and on write.
        const normalized = CREW_STATUSES.has(status) ? status : 'Available';
        if (c.status === normalized) return false;
        c.status = normalized;
        return true;
    }

    // ---- crew management ----------------------------------------------

    addCrew(member) {
        if (!member || !member.id || !member.name || !member.role) return;
        if (this._data.crew.find((c) => c.id === member.id)) return;
        this._data.crew.push({
            id: member.id,
            name: member.name,
            role: member.role,
            level: member.level ?? 1,
            status: 'Available',
        });
        this._changed('crew-add', { id: member.id });
    }

    removeCrew(id) {
        const idx = this._data.crew.findIndex((c) => c.id === id);
        if (idx < 0) return;
        this._data.crew.splice(idx, 1);
        this._changed('crew-remove', { id });
    }

    // ---- fleet management ---------------------------------------------

    addShip(ship) {
        if (!ship || !ship.id || !ship.name || !ship.className) return;
        if (this._data.fleet.find((s) => s.id === ship.id)) return;
        this._data.fleet.push({
            id: ship.id,
            name: ship.name,
            className: ship.className,
            hull: ship.hull ?? 100,
            status: 'Standby',
        });
        this._changed('ship-add', { id: ship.id });
    }

    removeShip(id) {
        const idx = this._data.fleet.findIndex((s) => s.id === id);
        if (idx < 0) return;
        this._data.fleet.splice(idx, 1);
        this._changed('ship-remove', { id });
    }

    // ---- P4 active idle missions (persistent dispatch loop) ------------

    addActiveMission(job = {}) {
        if (!job || !job.id || !job.shipId || !job.crewId) return;
        if (this._data.activeMissions.some((j) => j.id === job.id)) return;

        const normalized = {
            id: String(job.id),
            offerId: job.offerId || job.missionId || null,
            missionId: job.missionId || null,
            title: String(job.title || 'Idle Assignment'),
            type: job.type || 'Mining',
            dispatchMode: job.dispatchMode === 'manual' ? 'manual' : 'idle',
            risk: Number.isFinite(job.risk) ? job.risk : 1,
            rewardCredits: Math.max(0, Math.floor(job.rewardCredits || 0)),
            rewardOres: {
                common: Array.isArray(job.rewardOres?.common) ? job.rewardOres.common.slice() : [],
                rare: Array.isArray(job.rewardOres?.rare) ? job.rewardOres.rare.slice() : [],
            },
            shipId: job.shipId,
            shipName: job.shipName || job.shipId,
            crewId: job.crewId,
            crewName: job.crewName || job.crewId,
            startedAt: Number.isFinite(job.startedAt) ? job.startedAt : Date.now(),
            etaSec: Math.max(1, Math.floor(job.etaSec || 60)),
            endsAt: Number.isFinite(job.endsAt) ? job.endsAt : (Number.isFinite(job.startedAt) ? job.startedAt : Date.now()) + Math.max(1, Math.floor(job.etaSec || 60)) * 1000,
            claimed: false,
        };

        this._data.activeMissions = [...(this._data.activeMissions || []), normalized];
        // Self-contained: the act of dispatching also marks the assets unavailable
        this.setShipStatus(normalized.shipId, 'On Mission');
        this.setCrewStatus(normalized.crewId, 'On Mission');
        this._touchLastTick();
        this._changed('active-mission-add', { id: normalized.id });
    }

    abortActiveMission(id, { partialCredits = 0 } = {}) {
        const idx = (this._data.activeMissions || []).findIndex((j) => j.id === id);
        if (idx < 0) return;
        const job = this._data.activeMissions[idx];

        if (partialCredits > 0) {
            this.addCredits(partialCredits);
        }
        this.setShipStatus(job.shipId, 'Standby');
        this.setCrewStatus(job.crewId, 'Available');

        this._data.activeMissions = this._data.activeMissions.filter((j) => j.id !== id);
        this._touchLastTick();
        this._changed('active-mission-abort', { id, partialCredits });
    }

    claimActiveMission(id, { credits = 0, ores = {} } = {}) {
        const idx = (this._data.activeMissions || []).findIndex((j) => j.id === id);
        if (idx < 0) return;
        const job = this._data.activeMissions[idx];

        if (credits > 0) {
            this.addCredits(credits);
        }
        // Apply ores using the same safe pattern as applyMissionReward
        for (const color of ORE_IDS) {
            const n = ores[color];
            if (n) {
                this._data.ores[color] = Math.max(0, Math.floor(this._data.ores[color] + n));
            }
        }

        this.setShipStatus(job.shipId, 'Standby');
        this.setCrewStatus(job.crewId, 'Available');

        this._data.activeMissions = this._data.activeMissions.filter((j) => j.id !== id);
        this._touchLastTick();
        this._changed('active-mission-claim', { id, credits, ores });
    }

    // ---- Research (tech tree) - multiple concurrent projects ------------

    getResearchState() {
        const r = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };
        return {
            completed: [...(r.completed || [])],
            activeResearches: (r.activeResearches || []).map(r => ({ ...r })),
            maxConcurrent: r.maxConcurrent ?? 2,
        };
    }

    /** Start researching a node in a free slot (if available) */
    startResearch(nodeId) {
        if (!nodeId) return;
        const current = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };

        if (current.completed.includes(nodeId)) return;
        if (current.activeResearches.some(r => r.nodeId === nodeId)) return;

        if (current.activeResearches.length >= (current.maxConcurrent ?? 2)) return;

        const newResearch = {
            nodeId,
            startedAt: Date.now(),
            accumulatedMs: 0,
        };

        this._data.research = {
            completed: [...current.completed],
            activeResearches: [...current.activeResearches, newResearch],
            maxConcurrent: current.maxConcurrent ?? 2,
        };
        this._touchLastTick();
        this._changed('research-start', { nodeId });
    }

    /** Cancel (pause) a research project, preserving progress */
    cancelResearch(nodeId) {
        if (!nodeId) return;
        const current = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };

        const idx = current.activeResearches.findIndex(r => r.nodeId === nodeId);
        if (idx === -1) return;

        const project = current.activeResearches[idx];
        const elapsed = Math.max(0, Date.now() - project.startedAt);
        const newAccumulated = (project.accumulatedMs || 0) + elapsed;

        const updated = [...current.activeResearches];
        updated[idx] = {
            ...project,
            startedAt: 0,
            accumulatedMs: newAccumulated,
        };

        this._data.research = {
            completed: [...current.completed],
            activeResearches: updated,
            maxConcurrent: current.maxConcurrent ?? 2,
        };
        this._touchLastTick();
        this._changed('research-cancel', { nodeId });
    }

    /** Resume a previously canceled research */
    resumeResearch(nodeId) {
        if (!nodeId) return;
        const current = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };

        if (current.completed.includes(nodeId)) return;

        const idx = current.activeResearches.findIndex(r => r.nodeId === nodeId);
        if (idx === -1) return;

        const project = current.activeResearches[idx];
        if (project.startedAt > 0) return; // already running

        const updated = [...current.activeResearches];
        updated[idx] = {
            ...project,
            startedAt: Date.now(),
        };

        this._data.research = {
            completed: [...current.completed],
            activeResearches: updated,
            maxConcurrent: current.maxConcurrent ?? 2,
        };
        this._touchLastTick();
        this._changed('research-resume', { nodeId });
    }

    /** Mark a research as completed (called by UI when timer expires) */
    completeResearch(nodeId) {
        if (!nodeId) return;
        const current = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };

        const filtered = current.activeResearches.filter(r => r.nodeId !== nodeId);
        const completed = [...current.completed];
        if (!completed.includes(nodeId)) completed.push(nodeId);

        this._data.research = {
            completed,
            activeResearches: filtered,
            maxConcurrent: current.maxConcurrent ?? 2,
        };
        this._touchLastTick();
        this._changed('research-complete', { nodeId });
    }

    /** Upgrade the number of concurrent research slots (called from BUILD tab) */
    upgradeResearchSlots() {
        const current = this._data.research || { completed: [], activeResearches: [], maxConcurrent: 2 };
        const newMax = (current.maxConcurrent ?? 2) + 1;

        this._data.research = {
            ...current,
            maxConcurrent: newMax,
        };
        this._touchLastTick();
        this._changed('research-slots-upgraded', { newMax });
    }

    // ---- P8 meta writes ---------------------------------------------
    //
    // Every mutation below is built from non-emitting `_raw*` helpers and
    // fires exactly ONE `change` event, so one settlement = one save. The
    // older single-field setters above keep their own events; they are
    // still what the tabs use for one-off edits (repair, hire, research).

    /**
     * Bank reputation points and re-derive the tier from the ladder.
     * @returns {{rep:number, tier:number, promoted:boolean}}
     */
    addReputation(delta) {
        const result = this._rawAddRep(delta);
        if (!result.moved) return { rep: result.rep, tier: result.tier, promoted: false };
        this._bumpStats({ repEarned: Math.max(0, Math.floor(delta || 0)) });
        this._changed('rep', result);
        if (result.promoted) this._changed('rep-tier', { tier: result.tier });
        return result;
    }

    _rawAddRep(delta) {
        const d = Math.floor(Number.isFinite(delta) ? delta : 0);
        const before = this._data.reputation || 0;
        const next = Math.max(0, before + d);
        const tier = tierForRep(next);
        const promoted = tier !== this._data.reputationTier;
        this._data.reputation = next;
        this._data.reputationTier = tier;
        return { moved: next !== before, rep: next, tier, promoted, delta: d };
    }

    /** Award XP to a crew member; levels come from the crew.js curve. */
    addCrewXp(id, xp) {
        const result = this._rawAddCrewXp(id, xp);
        if (!result) return null;
        if (result.levelsGained > 0) this._bumpStats({ crewLevelsGained: result.levelsGained });
        this._changed('crew-xp', { id, ...result });
        return result;
    }

    _rawAddCrewXp(id, xp) {
        const member = this._data.crew.find((c) => c.id === id);
        if (!member) return null;
        const result = awardCrewXp(member, xp);
        member.xp = result.xp;
        member.level = result.level;
        return result;
    }

    /**
     * Chart a sector: bank the discovery grant from `plotCourse()`.
     * The warp cost is spent by the caller (`spendWarp`) so a failed jump
     * never touches the profile.
     */
    discoverSector(id, rewards = {}) {
        const granted = this._rawDiscoverSector(id, rewards);
        if (!granted) return false;
        this._touchLastTick();
        this._changed('sector-discovered', granted);
        return true;
    }

    // Non-emitting half of a discovery, shared with chartSector().
    _rawDiscoverSector(id, rewards = {}) {
        if (!id || !SECTOR_IDS.includes(id)) return null;
        if (this.isSectorDiscovered(id)) return null;
        this._data.discoveredSectors = [...(this._data.discoveredSectors || []), id];

        const credits = Math.max(0, Math.floor(rewards.credits || 0));
        const minerals = Math.max(0, Math.floor(rewards.minerals || 0));
        const warp = Math.max(0, Math.floor(rewards.warp || 0));
        if (credits) this._rawAddCredits(credits);
        if (minerals) this._rawAddMinerals(minerals);
        if (warp) this._rawAddWarp(warp);
        for (const color of ORE_IDS) {
            const n = rewards.ores?.[color];
            if (n) this._rawAddOre(color, n);
        }
        const rep = this._rawAddRep(rewards.rep || 0);
        this._bumpStats({ sectorsCharted: 1, warpFound: warp, creditsEarned: credits });
        return { id, rewards, rep: rep.rep, tier: rep.tier, promoted: rep.promoted };
    }

    /**
     * Plot a course and chart the sector in ONE atomic write: the warp
     * cost, the discovery grant and the rep bump fire a single `change`
     * event (so exactly one save lands). Returns the `plotCourse()` plan
     * either way — when `ok` is false nothing was touched and `reason`
     * says why, which is what the STAR MAP tab prints.
     */
    chartSector(sectorId, nowMs = Date.now()) {
        const plan = plotCourse({
            sectorId,
            warp: this._data.hubResources.warp || 0,
            discoveredIds: this.discoveredSectorIds(),
            effects: this.getEffects(),
            repTier: this.reputationTier,
        });
        if (!plan.ok) return plan;

        const held = this._data.hubResources.warp || 0;
        this._data.hubResources.warp = held - plan.warpSpent;
        this._bumpStats({ warpSpent: plan.warpSpent });

        const granted = this._rawDiscoverSector(sectorId, plan.rewards);
        this._touchLastTick(nowMs);
        this._changed('sector-discovered', {
            ...granted,
            warpSpent: plan.warpSpent,
            newWarp: this._data.hubResources.warp,
        });
        return { ...plan, warpSpent: plan.warpSpent, newWarp: this._data.hubResources.warp, rep: granted.rep, promoted: granted.promoted };
    }

    /** Spend warp cells (sector jumps). Returns false when short. */
    spendWarp(n) {
        const amount = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
        if (amount === 0) return true;
        const held = this._data.hubResources.warp || 0;
        if (held < amount) return false;
        this._data.hubResources.warp = held - amount;
        this._bumpStats({ warpSpent: amount });
        this._changed('hub-resource', { id: 'warp', value: held - amount });
        return true;
    }

    /** Add warp cells, clamped to the station's rack capacity. */
    addWarp(n) {
        const amount = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
        if (amount === 0) return this._data.hubResources.warp || 0;
        const next = this._rawAddWarp(amount);
        this._changed('hub-resource', { id: 'warp', value: next });
        return next;
    }

    _rawAddWarp(amount) {
        const cap = this.warpCapacity();
        const held = this._data.hubResources.warp || 0;
        const next = Math.max(0, Math.min(cap, held + amount));
        this._data.hubResources.warp = next;
        if (next > held) this._bumpStats({ warpFound: next - held });
        return next;
    }

    // Deltas may be negative (market sells, refunds); the *balance* is
    // what clamps at zero.
    _rawAddCredits(n) {
        this._data.credits = Math.max(0, Math.floor(this._data.credits + (Number.isFinite(n) ? n : 0)));
        return this._data.credits;
    }

    _rawAddMinerals(n) {
        const current = this._data.hubResources.minerals || 0;
        this._data.hubResources.minerals = Math.max(0, Math.floor(current + (Number.isFinite(n) ? n : 0)));
        return this._data.hubResources.minerals;
    }

    _rawAddOre(color, n) {
        if (!(color in this._data.ores)) return 0;
        const amount = Math.floor(Number.isFinite(n) ? n : 0);
        this._data.ores[color] = Math.max(0, Math.floor(this._data.ores[color] + amount));
        return this._data.ores[color];
    }

    /**
     * Apply a full settlement from settlement.js — the single mutation a
     * finished dispatch causes. Credits, ores, rep, crew XP, hull wear,
     * warp cells, the completed-mission list and the lifetime stats all
     * land in one `change` event (so exactly one save fires).
     */
    applySettlement(settlement = {}) {
        const detail = this._rawApplySettlement(settlement);
        this._touchLastTick();
        this._changed('settlement', detail);
        return this.getRepInfo();
    }

    /**
     * Settle a finished (or aborted) idle contract AND retire its job
     * record in one atomic write: rewards, rep, crew XP, hull wear, the
     * ship/crew release and the removal from `activeMissions` all fire a
     * single `change` event, so exactly one save lands.
     *
     * @returns {object} the rep info after the settlement
     */
    settleActiveMission(jobId, settlement = {}) {
        const jobs = this._data.activeMissions || [];
        const idx = jobs.findIndex((j) => j.id === jobId);
        const job = idx >= 0 ? jobs[idx] : null;

        const detail = this._rawApplySettlement(settlement);
        if (job) {
            this._rawSetShipStatus(job.shipId, 'Standby');
            this._rawSetCrewStatus(job.crewId, 'Available');
            this._data.activeMissions = jobs.filter((j) => j.id !== jobId);
        }
        this._touchLastTick();
        this._changed('settlement', { ...detail, jobId: jobId || null });
        return this.getRepInfo();
    }

    // Non-emitting settlement body, shared by applySettlement() and
    // settleActiveMission(). Returns the `change` detail payload.
    _rawApplySettlement(settlement = {}) {
        const s = settlement || {};
        const credits = Math.max(0, Math.floor(s.credits || 0));
        if (credits) this._rawAddCredits(credits);

        let oresMined = 0;
        for (const color of ORE_IDS) {
            const n = Math.max(0, Math.floor(s.ores?.[color] || 0));
            if (!n) continue;
            this._rawAddOre(color, n);
            oresMined += n;
        }

        const crewResult = s.crewId && s.crewXp > 0 ? this._rawAddCrewXp(s.crewId, s.crewXp) : null;
        if (s.shipId && s.hullDamage > 0) {
            const ship = this._data.fleet.find((f) => f.id === s.shipId);
            if (ship) ship.hull = Math.max(0, Math.min(100, Math.floor(ship.hull - s.hullDamage)));
        }
        if (s.warp > 0) this._rawAddWarp(s.warp);

        if (s.missionId && !this._data.completedMissionIds.includes(s.missionId)) {
            this._data.completedMissionIds.push(s.missionId);
        }

        const statsPatch = { creditsEarned: credits, oresMined };
        if (s.aborted) statsPatch.idleAborts = 1;
        else if (s.dispatchMode === 'idle') statsPatch.idleClaims = 1;
        else if (s.won) statsPatch.missionsCompleted = 1;
        else statsPatch.missionsFailed = 1;
        if (s.won && String(s.type).toLowerCase() === 'combat') statsPatch.combatWins = 1;
        if (crewResult?.levelsGained > 0) statsPatch.crewLevelsGained = crewResult.levelsGained;
        if (Number.isFinite(s.finalScore) && s.finalScore > 0) statsPatch.bestScore = Math.floor(s.finalScore);
        this._bumpStats(statsPatch);

        const rep = this._rawAddRep(s.rep || 0);
        return {
            missionId: s.missionId || null,
            credits,
            ores: oresMined,
            rep: rep.rep,
            tier: rep.tier,
            promoted: rep.promoted,
            crewLevel: crewResult ? crewResult.level : null,
            crewLevelsGained: crewResult ? crewResult.levelsGained : 0,
            hullDamage: Math.max(0, Math.floor(s.hullDamage || 0)),
            warp: Math.max(0, Math.floor(s.warp || 0)),
        };
    }

    /**
     * Melt ore into minerals (MARKET tab's refinery). `plan` comes from
     * economy.refinePlan so the quote the player saw is exactly what lands.
     */
    applyRefine(plan = {}) {
        const minerals = Math.max(0, Math.floor(plan.minerals || 0));
        if (minerals <= 0) return 0;
        for (const color of ORE_IDS) {
            const used = Math.max(0, Math.floor(plan.consumed?.[color] || 0));
            if (used) this._data.ores[color] = Math.max(0, this._data.ores[color] - used);
        }
        this._rawAddMinerals(minerals);
        this._bumpStats({ mineralsRefined: minerals });
        this._touchLastTick();
        this._changed('refine', { minerals });
        return minerals;
    }

    /** Convenience wrapper: plan + apply a full-hold refine in one call. */
    refineAllOres(effects = null) {
        const plan = refinePlan(this.oreCounts(), effects || this.getEffects());
        return { plan, minerals: this.applyRefine(plan) };
    }

    /**
     * Apply a market order (economy.tradeQuote decides legality).
     * Buys move credits → goods; sells move goods → credits.
     */
    applyTrade({ goodId, side, amount, credits } = {}) {
        const qty = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
        const money = Math.max(0, Math.floor(Number.isFinite(credits) ? credits : 0));
        if (qty <= 0 || money <= 0) return false;
        const key = balanceKeyFor(goodId);
        if (!key) return false;

        if (side === 'buy') {
            if (this._data.credits < money) return false;
            this._rawAddCredits(-money);
            this._applyGoodDelta(key, qty);
            this._changed('trade', { goodId, side, amount: qty, credits: -money });
            return true;
        }
        if (side === 'sell') {
            if (this._goodBalance(key) < qty) return false;
            this._applyGoodDelta(key, -qty);
            this._rawAddCredits(money);
            this._bumpStats({ creditsEarned: money });
            this._changed('trade', { goodId, side, amount: qty, credits: money });
            return true;
        }
        return false;
    }

    _goodBalance(key) {
        if (key === 'minerals') return this._data.hubResources.minerals || 0;
        if (key.startsWith('ore:')) return this._data.ores[key.slice(4)] || 0;
        return 0;
    }

    _applyGoodDelta(key, delta) {
        if (key === 'minerals') { this._rawAddMinerals(delta); return; }
        if (key.startsWith('ore:')) this._rawAddOre(key.slice(4), delta);
    }

    /**
     * Buy a mission-board reroll. The daily refresh is free (a new UTC day
     * resets `rerollsToday`), every extra roll costs escalating credits.
     * @returns {{ok:boolean, cost:number, rerollsToday:number, reason:string|null}}
     */
    buyBoardReroll(nowMs = Date.now()) {
        const state = this.getBoardState(nowMs);
        const cost = state.canReroll
            ? rerollCost(state.rerollsToday, { extraRerolls: this.getEffects().riskRerolls || 0 })
            : Infinity;
        if (!Number.isFinite(cost)) {
            return { ok: false, cost: 0, rerollsToday: state.rerollsToday, reason: 'daily reroll limit reached' };
        }
        if (this._data.credits < cost) {
            return { ok: false, cost, rerollsToday: state.rerollsToday, reason: 'not enough credits' };
        }
        this._rawAddCredits(-cost);
        const rerollsToday = state.rerollsToday + 1;
        this._data.board = { dayKey: state.dayKey, rerollsToday };
        this._touchLastTick();
        this._changed('board-reroll', { cost, rerollsToday });
        return { ok: true, cost, rerollsToday, reason: null };
    }

    /** Note a hull repair so lifetime stats stay honest. */
    noteHullRepair(points = 0) {
        this._bumpStats({ hullRepairs: Math.max(0, Math.floor(points || 0)) });
    }

    /** Stamp the "hub was alive" clock (offline summary baseline). */
    touch(nowMs = Date.now()) {
        this._data.lastTickAt = Number.isFinite(nowMs) ? nowMs : Date.now();
    }

    get lastTickAt() { return this._data.lastTickAt || 0; }

    _bumpStats(patch = {}) {
        const stats = this._data.stats || (this._data.stats = {});
        for (const [key, delta] of Object.entries(patch)) {
            const n = Math.floor(Number.isFinite(delta) ? delta : 0);
            if (!n) continue;
            if (key === 'bestScore') stats.bestScore = Math.max(0, stats.bestScore || 0, n);
            else stats[key] = Math.max(0, (stats[key] || 0) + n);
        }
    }


    setReputationTier(n) {
        const v = Math.max(1, Math.floor(n));
        if (v === this._data.reputationTier) return;
        this._data.reputationTier = v;
        this._changed('rep', { value: v });
    }

    // ---- internals ---------------------------------------------------

    _changed(kind, detail) {
        this._emitter.emit('change', { kind, detail });
    }

    _touchLastTick() {
        this._data.lastTickAt = Date.now();
    }

    // Shallow-merge an incoming saved profile onto a fresh starter so
    // unknown fields are ignored and missing fields get starter values.
    // Keeps forward/backward compatibility cheap as long as we only add
    // fields (never rename/delete) within a schema version.
    _merge(base, incoming) {
        if (typeof incoming !== 'object' || incoming === null) return base;
        if (typeof incoming.credits === 'number') base.credits = Math.max(0, Math.floor(incoming.credits));
        if (incoming.hubResources && typeof incoming.hubResources === 'object') {
            for (const id of HUB_RESOURCE_IDS) {
                if (id === 'credits') continue;
                const v = incoming.hubResources[id];
                if (typeof v === 'number') base.hubResources[id] = Math.max(0, Math.floor(v));
            }
        }
        if (incoming.ores && typeof incoming.ores === 'object') {
            for (const color of ORE_IDS) {
                const v = incoming.ores[color];
                if (typeof v === 'number') base.ores[color] = Math.max(0, Math.floor(v));
            }
        }
        if (Array.isArray(incoming.fleet)) {
            // Merge hull/status onto starter defaults for known ships.
            for (const ship of base.fleet) {
                const found = incoming.fleet.find((s) => s && s.id === ship.id);
                if (!found) continue;
                if (typeof found.hull === 'number')  ship.hull   = Math.max(0, Math.min(100, Math.floor(found.hull)));
                if (typeof found.status === 'string') {
                    ship.status = SHIP_STATUSES.has(found.status) ? found.status : 'Standby';
                }
            }
            // Restore player-built ships that aren't part of the starter.
            for (const s of incoming.fleet) {
                if (!s || !s.id || !s.name || !s.className) continue;
                if (base.fleet.find((b) => b.id === s.id)) continue;
                base.fleet.push({
                    id: s.id, name: s.name, className: s.className,
                    hull: typeof s.hull === 'number' ? Math.max(0, Math.min(100, Math.floor(s.hull))) : 100,
                    status: SHIP_STATUSES.has(s.status) ? s.status : 'Standby',
                });
            }
        }
        if (Array.isArray(incoming.crew)) {
            for (const crew of base.crew) {
                const found = incoming.crew.find((c) => c && c.id === crew.id);
                if (!found) continue;
                if (typeof found.level === 'number')  crew.level  = Math.max(1, Math.floor(found.level));
                if (typeof found.status === 'string') {
                    crew.status = CREW_STATUSES.has(found.status) ? found.status : 'Available';
                }
                crew.xp = typeof found.xp === 'number'
                    ? Math.max(0, Math.floor(found.xp))
                    : xpForLevel(crew.level);
            }
            // Restore hired crew not in the starter set.
            for (const c of incoming.crew) {
                if (!c || !c.id || !c.name || !c.role) continue;
                if (base.crew.find((b) => b.id === c.id)) continue;
                const level = typeof c.level === 'number' ? Math.max(1, Math.floor(c.level)) : 1;
                base.crew.push({
                    id: c.id, name: c.name, role: c.role,
                    level,
                    // v1 saves predate crew XP: seed the level threshold so
                    // veterans don't read as brand-new hires.
                    xp: typeof c.xp === 'number' ? Math.max(0, Math.floor(c.xp)) : xpForLevel(level),
                    status: CREW_STATUSES.has(c.status) ? c.status : 'Available',
                });
            }
        }
        if (typeof incoming.reputationTier === 'number') {
            base.reputationTier = Math.max(1, Math.floor(incoming.reputationTier));
        }
        // P8 fields. All optional: a v1 blob simply lacks them and the
        // starter values survive (that IS the migration).
        if (typeof incoming.reputation === 'number') {
            base.reputation = Math.max(0, Math.floor(incoming.reputation));
            base.reputationTier = tierForRep(base.reputation);
        }
        if (Array.isArray(incoming.discoveredSectors)) {
            base.discoveredSectors = incoming.discoveredSectors.filter(
                (id) => typeof id === 'string' && SECTOR_IDS.includes(id),
            );
        }
        if (incoming.board && typeof incoming.board === 'object') {
            base.board = {
                dayKey: typeof incoming.board.dayKey === 'string' ? incoming.board.dayKey : '',
                rerollsToday: Number.isFinite(incoming.board.rerollsToday)
                    ? Math.max(0, Math.floor(incoming.board.rerollsToday))
                    : 0,
            };
        }
        if (incoming.stats && typeof incoming.stats === 'object') {
            for (const [key, value] of Object.entries(base.stats)) {
                const v = incoming.stats[key];
                if (typeof v === 'number' && Number.isFinite(v)) base.stats[key] = Math.max(0, Math.floor(v));
            }
        }
        if (Array.isArray(incoming.completedMissionIds)) {
            base.completedMissionIds = incoming.completedMissionIds.filter((id) => typeof id === 'string');
        }
        if (Array.isArray(incoming.activeMissions)) {
            // Accept any job-like objects; Hub + idle-clock treat unknown fields defensively.
            base.activeMissions = incoming.activeMissions
                .filter((j) => j && typeof j.id === 'string' && j.shipId && j.crewId)
                .map((j) => ({
                    id: String(j.id),
                    offerId: j.offerId || j.missionId || null,
                    missionId: j.missionId || null,
                    title: String(j.title || 'Idle Assignment'),
                    type: j.type || 'Mining',
                    dispatchMode: j.dispatchMode === 'manual' ? 'manual' : 'idle',
                    risk: Number.isFinite(j.risk) ? j.risk : 1,
                    rewardCredits: Math.max(0, Math.floor(j.rewardCredits || 0)),
                    rewardOres: {
                        common: Array.isArray(j.rewardOres?.common) ? j.rewardOres.common.filter((x) => typeof x === 'string') : [],
                        rare: Array.isArray(j.rewardOres?.rare) ? j.rewardOres.rare.filter((x) => typeof x === 'string') : [],
                    },
                    shipId: j.shipId,
                    shipName: j.shipName || j.shipId,
                    crewId: j.crewId,
                    crewName: j.crewName || j.crewId,
                    startedAt: Number.isFinite(j.startedAt) ? j.startedAt : Date.now(),
                    etaSec: Math.max(1, Math.floor(j.etaSec || 60)),
                    endsAt: Number.isFinite(j.endsAt) ? j.endsAt : Date.now() + 60000,
                    claimed: !!j.claimed,
                }));
        }
        if (Number.isFinite(incoming.lastTickAt)) {
            base.lastTickAt = incoming.lastTickAt;
        }

        // Research state (multi-slot)
        if (incoming.research && typeof incoming.research === 'object') {
            const inc = incoming.research;

            if (Array.isArray(inc.completed)) {
                base.research.completed = inc.completed.filter((id) => typeof id === 'string');
            }

            if (Array.isArray(inc.activeResearches)) {
                base.research.activeResearches = inc.activeResearches
                    .filter(r => r && typeof r.nodeId === 'string')
                    .map(r => ({
                        nodeId: String(r.nodeId),
                        startedAt: Number.isFinite(r.startedAt) ? r.startedAt : 0,
                        accumulatedMs: Number.isFinite(r.accumulatedMs) ? r.accumulatedMs : 0,
                    }));
            }

            if (Number.isFinite(inc.maxConcurrent)) {
                base.research.maxConcurrent = Math.max(1, Math.floor(inc.maxConcurrent));
            }
        }

        // P10: UI preferences (additive; a save from before this field
        // simply keeps the starter `helpSeen: false`).
        if (incoming.ui && typeof incoming.ui === 'object') {
            base.ui = {
                helpSeen: typeof incoming.ui.helpSeen === 'boolean' ? incoming.ui.helpSeen : base.ui.helpSeen,
            };
        }

        return base;
    }
}
