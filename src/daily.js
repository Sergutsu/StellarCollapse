// Daily clock: the "one day" rhythm behind the mission board and the
// market. Everything here is a pure function of a wall-clock timestamp
// (callers inject `nowMs` so tests stay deterministic) — no timers, no
// IO, no `Date.now()` at rule boundaries.
//
// Two systems read this module:
//   * MISSION BOARD -- the visible 4-card subset rerolls for free at the
//     UTC day boundary; extra rerolls the same day cost escalating
//     credits (`rerollCost`). Answers the long-standing open question in
//     docs/DESIGN.md ("How expensive should daily reroll be?").
//   * MARKET -- ore prices drift once per UTC day (`marketDayKey` in
//     economy.js uses the same `dayKey`), and the tab shows a countdown
//     to the next drift (`msUntilNextDay`).
//
// Days are UTC, not local: the save blob is portable and a player who
// travels doesn't get two free rerolls in one afternoon.

export const DAY_MS = 86_400_000;

/** First manual reroll of a day costs this many credits. */
export const REROLL_BASE_COST = 150;

/** Hard cap on paid rerolls per day (the board still refreshes daily). */
export const MAX_REROLLS_PER_DAY = 6;

/**
 * Stable `YYYY-MM-DD` (UTC) key for a timestamp.
 * @param {number} [nowMs]
 */
export function dayKey(nowMs = Date.now()) {
    const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Whole days since the Unix epoch. Increments exactly at the UTC boundary. */
export function dayIndex(nowMs = Date.now()) {
    const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
    return Math.floor(ms / DAY_MS);
}

/** Milliseconds until the next UTC day boundary (0..DAY_MS). */
export function msUntilNextDay(nowMs = Date.now()) {
    const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
    const into = ((ms % DAY_MS) + DAY_MS) % DAY_MS;
    return DAY_MS - into;
}

/** `HH:MM:SS` until the next daily reset — the market/board countdown copy. */
export function countdownToNextDay(nowMs = Date.now()) {
    return formatHms(msUntilNextDay(nowMs));
}

export function formatHms(ms) {
    const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Seed for today's board roll. Same all day, everywhere, for every
 * player — that is what makes the board feel like a shared daily
 * contract list rather than a random shuffle.
 */
export function dailyBoardSeed(nowMs = Date.now()) {
    return hashString(`stellar-board:${dayKey(nowMs)}`);
}

/**
 * Seed for the board after `rerollsToday` paid rerolls. Each reroll
 * walks the seed forward deterministically so reloading mid-day shows
 * the same rerolled board the player paid for. With `rerollsToday: 0`
 * this is exactly `dailyBoardSeed` for that day.
 */
export function boardSeedFor({ dayIndex: day = dayIndex(), rerollsToday = 0 } = {}) {
    const rerolls = Math.max(0, Math.floor(Number.isFinite(rerollsToday) ? rerollsToday : 0));
    const base = hashString(`stellar-board:${dayKey(day * DAY_MS)}`);
    if (rerolls === 0) return base >>> 0;
    return (base + Math.imul(rerolls, 0x9e3779b1)) >>> 0;
}

/** How many paid rerolls a day allows after tech modifiers. */
export function rerollCap({ extraRerolls = 0 } = {}) {
    const extra = Math.max(0, Math.floor(Number.isFinite(extraRerolls) ? extraRerolls : 0));
    return MAX_REROLLS_PER_DAY + extra;
}

/**
 * Credit price of the next manual reroll. Free rerolls are modelled by
 * the caller (a fresh day resets `rerollsToday` to 0 and the daily roll
 * happens on its own), so every call to this costs credits and the price
 * escalates linearly: 150, 300, 450, ...
 *
 * `extraRerolls` is the research allowance (`effects.riskRerolls`, +1 from
 * Countermeasures): it lifts the daily cap without changing the ladder.
 *
 * @returns {number} cost in credits, or `Infinity` past the daily cap
 */
export function rerollCost(rerollsToday = 0, { extraRerolls = 0 } = {}) {
    const done = Math.max(0, Math.floor(Number.isFinite(rerollsToday) ? rerollsToday : 0));
    if (done >= rerollCap({ extraRerolls })) return Infinity;
    return REROLL_BASE_COST * (done + 1);
}

/**
 * Normalise a persisted board record against "today".
 * A record from a previous day is reset (free daily refresh); a record
 * from today keeps its reroll counter.
 *
 * @param {{dayKey?:string, rerollsToday?:number, seedOffset?:number}} stored
 * @param {number} [nowMs]
 * @param {{extraRerolls?:number}} [opts] research allowance (`effects.riskRerolls`)
 */
export function normalizeBoardState(stored = null, nowMs = Date.now(), { extraRerolls = 0 } = {}) {
    const today = dayKey(nowMs);
    const sameDay = stored && stored.dayKey === today;
    const cap = rerollCap({ extraRerolls });
    const rerolls = sameDay ? Math.max(0, Math.min(cap, Math.floor(stored.rerollsToday || 0))) : 0;
    return {
        dayKey: today,
        rerollsToday: rerolls,
        rerollCap: cap,
        seed: boardSeedFor({ dayIndex: dayIndex(nowMs), rerollsToday: rerolls }),
        nextRerollCost: rerollCost(rerolls, { extraRerolls }),
        canReroll: rerolls < cap,
    };
}

/** Small deterministic string hash (FNV-1a, 32-bit). */
export function hashString(str) {
    let h = 0x811c9dc5;
    const s = String(str ?? '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
