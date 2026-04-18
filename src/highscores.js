// Local-storage-backed per-tier leaderboards. Each difficulty tier
// (mode x complexity) keeps its own top-5 list so players can compete
// fairly within a given difficulty.

import { HIGHSCORE_TIERS } from './constants.js';

const STORAGE_KEY = 'stellarCollapseScoresV2';
const LEGACY_STORAGE_KEY = 'tetrisHighScores';
const MAX_SCORES = 5;

export class HighScores {
    constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        this.storage = storage;
        // Map of tierId -> array of { name, score }.
        this.entries = {};
        for (let i = 0; i < HIGHSCORE_TIERS.length; i++) {
            this.entries[HIGHSCORE_TIERS[i].id] = [];
        }
        this.load();
    }

    load() {
        if (!this.storage) return;
        const raw = this.storage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (let i = 0; i < HIGHSCORE_TIERS.length; i++) {
                        const id = HIGHSCORE_TIERS[i].id;
                        const list = Array.isArray(parsed[id]) ? parsed[id] : [];
                        this.entries[id] = list.slice(0, MAX_SCORES);
                    }
                }
                return;
            } catch {
                // Corrupt payload -> fall through to legacy import.
            }
        }
        // One-shot migration from the single-list legacy store. Put every
        // old entry into the easiest tier so players don't feel their old
        // scores vanished.
        const legacyRaw = this.storage.getItem(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
            try {
                const legacy = JSON.parse(legacyRaw);
                if (Array.isArray(legacy)) {
                    const firstTier = HIGHSCORE_TIERS[0].id;
                    this.entries[firstTier] = legacy
                        .filter((e) => e && typeof e.score === 'number')
                        .slice(0, MAX_SCORES);
                    this._persist();
                }
            } catch {
                // Legacy corrupt -> ignore.
            }
        }
    }

    _persist() {
        if (!this.storage) return;
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    }

    save(tierId, name, score) {
        if (!this.entries[tierId]) this.entries[tierId] = [];
        this.entries[tierId].push({ name: name || 'Pilot', score });
        this.entries[tierId].sort((a, b) => b.score - a.score);
        this.entries[tierId] = this.entries[tierId].slice(0, MAX_SCORES);
        this._persist();
    }

    top(tierId) {
        const list = this.entries[tierId];
        return list ? list.slice() : [];
    }

    // All entries across all tiers as { [tierId]: [...] }. Used by the
    // multi-tab leaderboard UI.
    all() {
        const out = {};
        for (const id of Object.keys(this.entries)) out[id] = this.entries[id].slice();
        return out;
    }
}
