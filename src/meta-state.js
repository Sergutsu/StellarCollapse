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
// Non-goals for P3: idle ticking (P4), building queues / upgrades (P5),
// research / crew levelling loops (P6+). Shape is permissive enough to
// extend without a migration when those phases land.

import { Emitter } from './emitter.js';

export const META_SAVE_VERSION = 1;

// 6-ore palette. Matches the 6 tile colors used by STELLAR / CLASSIC
// and maps 1:1 with mission reward previews. Order is stable because
// tests + saved snapshots depend on it.
export const ORE_IDS = Object.freeze([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
]);

// Hub top-bar resource ids. These are aggregate / life-support style
// counts the player sees at the top of the hub. Per-color ore counts
// live on meta.ores instead.
export const HUB_RESOURCE_IDS = Object.freeze([
    'o2',
    'fuel',
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
        o2: 82,        // percent, 0-100
        fuel: 640,
        minerals: 1200,
        warp: 3,
    }),
    ores: Object.freeze({
        red: 0,
        orange: 0,
        yellow: 0,
        green: 0,
        blue: 0,
        purple: 0,
    }),
    fleet: Object.freeze([
        Object.freeze({ id: 'ship-1', name: 'Nyx-I',     className: 'Corvette', hull: 100, status: 'Standby' }),
        Object.freeze({ id: 'ship-2', name: 'Oblivion',  className: 'Hauler',   hull: 78,  status: 'Standby' }),
        Object.freeze({ id: 'ship-3', name: 'Dawnbreak', className: 'Scout',    hull: 92,  status: 'Standby' }),
    ]),
    crew: Object.freeze([
        Object.freeze({ id: 'crew-1', name: 'V. Draeven', role: 'Captain',   level: 4, status: 'Available' }),
        Object.freeze({ id: 'crew-2', name: 'T. Halveri', role: 'Engineer',  level: 3, status: 'Available' }),
        Object.freeze({ id: 'crew-3', name: 'K. Saros',   role: 'Navigator', level: 2, status: 'Resting'   }),
    ]),
    reputationTier: 1,
    completedMissionIds: Object.freeze([]),
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
    applyMissionReward({ credits = 0, ores = {}, missionId = null } = {}) {
        let dirty = false;
        if (credits) {
            this._data.credits = Math.max(0, this._data.credits + credits);
            dirty = true;
        }
        for (const color of ORE_IDS) {
            const n = ores[color];
            if (n) {
                this._data.ores[color] = Math.max(0, this._data.ores[color] + n);
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
        if (!ship || ship.status === status) return;
        ship.status = String(status);
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
        if (!c || c.status === status) return;
        c.status = String(status);
        this._changed('crew-status', { id, status: c.status });
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
            // Only keep known ship ids; merge hull/status onto starter
            // defaults so cosmetic fields (name, class) stay canonical.
            for (const ship of base.fleet) {
                const found = incoming.fleet.find((s) => s && s.id === ship.id);
                if (!found) continue;
                if (typeof found.hull === 'number')  ship.hull   = Math.max(0, Math.min(100, Math.floor(found.hull)));
                if (typeof found.status === 'string') ship.status = found.status;
            }
        }
        if (Array.isArray(incoming.crew)) {
            for (const crew of base.crew) {
                const found = incoming.crew.find((c) => c && c.id === crew.id);
                if (!found) continue;
                if (typeof found.level === 'number')  crew.level  = Math.max(1, Math.floor(found.level));
                if (typeof found.status === 'string') crew.status = found.status;
            }
        }
        if (typeof incoming.reputationTier === 'number') {
            base.reputationTier = Math.max(1, Math.floor(incoming.reputationTier));
        }
        if (Array.isArray(incoming.completedMissionIds)) {
            base.completedMissionIds = incoming.completedMissionIds.filter((id) => typeof id === 'string');
        }
        return base;
    }
}
