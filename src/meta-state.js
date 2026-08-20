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

export const META_SAVE_VERSION = 1;
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
    completedMissionIds: Object.freeze([]),
    // P4: persistent idle dispatches (source of truth for Hub left column)
    activeMissions: Object.freeze([]),
    lastTickAt: 0,
    // Research system - multiple concurrent projects + upgradable slots
    research: Object.freeze({
        completed: Object.freeze([]),
        activeResearches: Object.freeze([]), // [{ nodeId, startedAt, accumulatedMs }]
        maxConcurrent: 2,
    }),
});

export function starterProfile() {
    // Deep clone so callers can mutate safely.
    return {
        credits: STARTER_PROFILE.credits,
        hubResources: { ...STARTER_PROFILE.hubResources },
        ores: { ...STARTER_PROFILE.ores },
        fleet: STARTER_PROFILE.fleet.map((s) => ({ ...s })),
        crew: STARTER_PROFILE.crew.map((c) => ({ ...c })),
        reputationTier: STARTER_PROFILE.reputationTier,
        completedMissionIds: [...STARTER_PROFILE.completedMissionIds],
        activeMissions: [],
        lastTickAt: Date.now(),
        research: {
            completed: [],
            activeResearches: [],
            maxConcurrent: 2,
        },
    };
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
            completedMissionIds: this._data.completedMissionIds.slice(),
            activeMissions: (this._data.activeMissions || []).map((j) => ({
                ...j,
                rewardOres: j && j.rewardOres ? { ...j.rewardOres } : { common: [], rare: [] },
            })),
            lastTickAt: this._data.lastTickAt || Date.now(),
            research: this.getResearchState(),
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
        const ship = this._data.fleet.find((s) => s.id === id);
        if (!ship) return;
        const normalized = SHIP_STATUSES.has(status) ? status : 'Standby';
        if (ship.status === normalized) return;
        ship.status = normalized;
        this._changed('ship-status', { id, status: ship.status });
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
        const c = this._data.crew.find((m) => m.id === id);
        if (!c) return;
        // Legacy saves may include "Resting". Crew currently only has
        // two gameplay statuses, so any unknown value gets normalized
        // back to Available on load and on write.
        const normalized = CREW_STATUSES.has(status) ? status : 'Available';
        if (c.status === normalized) return;
        c.status = normalized;
        this._changed('crew-status', { id, status: c.status });
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
            }
            // Restore hired crew not in the starter set.
            for (const c of incoming.crew) {
                if (!c || !c.id || !c.name || !c.role) continue;
                if (base.crew.find((b) => b.id === c.id)) continue;
                base.crew.push({
                    id: c.id, name: c.name, role: c.role,
                    level: typeof c.level === 'number' ? Math.max(1, Math.floor(c.level)) : 1,
                    status: CREW_STATUSES.has(c.status) ? c.status : 'Available',
                });
            }
        }
        if (typeof incoming.reputationTier === 'number') {
            base.reputationTier = Math.max(1, Math.floor(incoming.reputationTier));
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

        return base;
    }
}
