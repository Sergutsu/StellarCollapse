// Per-run tally of cleared tiles -> ores, plus final summary the
// results scene consumes and the MetaState mutation envelope we apply
// when the player clicks CONTINUE.
//
// Pure + framework-free. Subscribes to three GameState events while a
// run is active and aggregates:
//   - `match-cleared`  (click-match path + auto-match sweep path)
//   - `bomb-exploded`  (explicit bomb detonation)
//   - `lines-cleared`  (Blocks mode + any full-row clears)
//
// Every cell cleared by those events is mapped through the tile-color
// -> ore-id identity (they are the same symbol -- see meta-state.js
// `ORE_IDS` which mirrors constants.js `NORMAL_COLORS` + the two
// special tiles). A single cleared cell contributes +1 to its ore
// bucket; there is no per-tier ore multiplier (that stays as future
// work on mission modifiers).
//
// Credits on completion are the mission's `baseCredits` preview plus a
// flat `Math.floor(score / 10)` score bonus so bigger runs pay more
// without breaking the preview-number the mission card advertises. See
// GAMEPLAY.md for the documented formula.

import { ORE_IDS } from './meta-state.js';

function zeroedOreCounts() {
    const m = Object.create(null);
    for (const id of ORE_IDS) m[id] = 0;
    return m;
}

// `baseCredits + floor(score / 10)`, clamped at zero. Single source of
// truth for the reward formula; both RunLedger.summary() and the tests
// call this helper so tuning stays a one-line change.
export function computeCredits({ baseCredits = 0, score = 0 } = {}) {
    const base = Math.max(0, Math.floor(baseCredits));
    const bonus = Math.max(0, Math.floor((score || 0) / 10));
    return base + bonus;
}

export class RunLedger {
    constructor({ state, mission } = {}) {
        this.mission = mission || null;
        this.ores = zeroedOreCounts();
        this.matchesCleared = 0;
        this.bombsExploded = 0;
        this.linesCleared = 0;
        this.cellsCleared = 0;
        this._state = null;
        this._bound = [];
        if (state) this._attach(state);
    }

    // ---- subscriptions ----------------------------------------------

    _attach(state) {
        const onMatch = (p) => this._tallyMatch(p);
        const onBomb  = (p) => this._tallyBomb(p);
        const onLine  = (p) => this._tallyLines(p);
        state.on('match-cleared', onMatch);
        state.on('bomb-exploded', onBomb);
        state.on('lines-cleared', onLine);
        this._state = state;
        this._bound = [
            ['match-cleared', onMatch],
            ['bomb-exploded', onBomb],
            ['lines-cleared', onLine],
        ];
    }

    // Safe to call more than once. The caller (main.js) detaches the
    // ledger after taking a summary so a second run on the same ledger
    // does not keep accumulating ghost cells.
    detach() {
        if (this._state) {
            for (const [evt, fn] of this._bound) this._state.off(evt, fn);
        }
        this._bound = [];
        this._state = null;
    }

    // ---- tallies -----------------------------------------------------

    _tallyMatch(payload) {
        if (!payload) return;
        this.matchesCleared++;
        const cells = Array.isArray(payload.cells) ? payload.cells : [];
        // Click-match: every cell is the same color, carried on the
        // payload itself. Auto-match sweep: each cell has its own
        // `.color` because independent runs get unioned into the
        // cleared set. Fall back to payload.color when a cell lacks
        // one so both shapes tally correctly.
        for (const cell of cells) {
            const color = cell?.color ?? payload.color ?? null;
            this._creditOre(color);
        }
    }

    _tallyBomb(payload) {
        if (!payload) return;
        this.bombsExploded++;
        const cells = Array.isArray(payload.cells) ? payload.cells : [];
        for (const cell of cells) {
            this._creditOre(cell?.color ?? null);
        }
    }

    _tallyLines(payload) {
        if (!payload) return;
        const count = typeof payload.count === 'number' ? payload.count : 0;
        this.linesCleared += count;
        const colors = Array.isArray(payload.colors) ? payload.colors : [];
        for (const color of colors) {
            this._creditOre(color);
        }
    }

    _creditOre(color) {
        if (!color) return;
        if (!(color in this.ores)) return;
        this.ores[color]++;
        this.cellsCleared++;
    }

    // ---- summary -----------------------------------------------------
    //
    // `runFinalState` is the GameState snapshot-at-game-over (usually
    // just the state object itself). We only read `score`, `level`,
    // and `lines` -- the view + rewards logic don't need more.
    summary(runFinalState = null) {
        const score = runFinalState?.score ?? 0;
        const level = runFinalState?.level ?? 1;
        const lines = runFinalState?.lines ?? this.linesCleared;
        const baseCredits = this.mission?.baseCredits || 0;
        const scoreBonus  = Math.max(0, Math.floor(score / 10));
        const credits = computeCredits({ baseCredits, score });
        return {
            missionId:     this.mission?.id ?? null,
            missionName:   this.mission?.name ?? null,
            narrativeName: this.mission?.narrativeName ?? null,
            sector:        this.mission?.sector ?? null,
            tierIndex:     this.mission?.tierIndex ?? null,
            tierColor:     this.mission?.tierColor ?? null,
            baseCredits,
            scoreBonus,
            credits,
            ores: { ...this.ores },
            cellsCleared:   this.cellsCleared,
            matchesCleared: this.matchesCleared,
            bombsExploded:  this.bombsExploded,
            linesCleared:   this.linesCleared,
            finalScore: score,
            finalLevel: level,
            finalLines: lines,
        };
    }

    // Mutation envelope the results scene feeds to
    // `MetaState.applyMissionReward(...)`. Strips summary metadata the
    // profile does not store, keeps the payload minimal.
    rewardEnvelope(summary) {
        const s = summary || this.summary();
        return {
            credits:   s.credits,
            ores:      { ...s.ores },
            missionId: s.missionId,
        };
    }
}
