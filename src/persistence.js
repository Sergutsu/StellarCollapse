// Versioned localStorage wrapper for the meta-state save blob.
//
// Design goals:
// - Never throw at the call site. localStorage can fail on SSR, in
//   private-mode Safari, on quota-exceeded, or if the user cleared the
//   key between save and load. Every path returns a safe default.
// - One versioned key ("stellarVentureSaveV1"). When we need a breaking
//   change, bump to V2 and keep V1 around as a migration source.
// - Dependency-injected storage so tests can pass a fake without
//   touching global state.

import { META_SAVE_VERSION } from './meta-state.js';

export const STORAGE_KEY = 'stellarVentureSaveV1';

export function getDefaultStorage() {
    // `typeof localStorage` avoids a ReferenceError in non-browser
    // hosts (tests, SSR). Accessing `window.localStorage` can also
    // throw in sandboxed iframes / certain browser settings.
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch { /* fall through */ }
    return null;
}

export class Persistence {
    constructor({ storage = getDefaultStorage(), key = STORAGE_KEY } = {}) {
        this._storage = storage;
        this._key = key;
    }

    // Returns the parsed save blob, or null if there's nothing usable
    // (empty storage, parse error, or incompatible schema version).
    load() {
        if (!this._storage) return null;
        let raw;
        try {
            raw = this._storage.getItem(this._key);
        } catch {
            return null;
        }
        if (!raw) return null;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null;
        }
        if (!parsed || typeof parsed !== 'object') return null;
        // Refuse to hydrate an incompatible version -- the caller will
        // fall back to the starter profile and overwrite the bad blob
        // on the next save. Keeps corrupted data from cascading.
        if (parsed.version !== META_SAVE_VERSION) return null;
        return parsed;
    }

    // Serialize + write. Returns true on success, false on any storage
    // failure (quota, disabled storage, etc). Callers should not block
    // on a failed save -- gameplay continues.
    save(blob) {
        if (!this._storage) return false;
        let json;
        try {
            json = JSON.stringify(blob);
        } catch {
            return false;
        }
        try {
            this._storage.setItem(this._key, json);
            return true;
        } catch {
            return false;
        }
    }

    clear() {
        if (!this._storage) return false;
        try {
            this._storage.removeItem(this._key);
            return true;
        } catch {
            return false;
        }
    }
}

// In-memory storage that satisfies the Web Storage shape. Used by
// tests and as an optional fallback for hosts without a real
// localStorage (the caller decides -- default is to just skip saving).
export function createMemoryStorage() {
    const map = new Map();
    return {
        getItem(k)    { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
        clear()       { map.clear(); },
        key(i)        { return [...map.keys()][i] ?? null; },
        get length()  { return map.size; },
    };
}
