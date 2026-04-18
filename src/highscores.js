// Local-storage-backed top-5 leaderboard. Kept separate from GameState so
// tests can exercise game rules without touching storage.

const STORAGE_KEY = 'tetrisHighScores';
const MAX_SCORES = 5;

export class HighScores {
    constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        this.storage = storage;
        this.entries = [];
        this.load();
    }

    load() {
        if (!this.storage) return;
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) this.entries = parsed;
        } catch {
            // Corrupt payload — treat as empty, don't crash the game.
            this.entries = [];
        }
    }

    save(name, score) {
        this.entries.push({ name: name || 'Pilot', score });
        this.entries.sort((a, b) => b.score - a.score);
        this.entries = this.entries.slice(0, MAX_SCORES);
        if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    }

    top() {
        return this.entries.slice();
    }
}
