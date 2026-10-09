// Meta-economy: refining, the daily-drift market, and warp-cell income.
//
// This is the module that closes the resource loop. Before P8 the game
// had three currencies with no source for two of them:
//
//   credits  ← mission payouts                     (worked)
//   minerals ← ??? spent by BUILD + RESEARCH        (no source at all —
//              a fresh save could only ever run *down* from 1200)
//   warp     ← ??? shown in the top bar, never used (dead resource)
//
// Now:
//   ores ──REFINE──▶ minerals ──BUILD/RESEARCH──▶ capacity + effects
//   ores ──SELL───▶ credits   ──HIRE/REROLL────▶ crew + board control
//   credits ──BUY─▶ ores/minerals (when a contract needs a specific seam)
//   exploration / salvage / combat dispatches ──▶ warp cells
//   warp cells ──SECTOR JUMP──▶ charted sectors ──▶ permanent payout bonuses
//
// Pure + framework-free. Prices are a pure function of the UTC day key so
// every player sees the same market on the same day and a reload never
// re-rolls it. All money math floors to integers and clamps at zero.

import { ORES, ORE_BY_COLOR } from './missions.js';
import { dayKey as defaultDayKey, hashString, countdownToNextDay } from './daily.js';

// ---- goods ------------------------------------------------------------

// Tradable goods: the six ores (keyed by their board colour, which is how
// MetaState stores them) plus raw minerals. `base` is the mid-price in
// credits before daily drift; rares sit ~4× commons so a Collapsed run's
// hazard ore actually matters to the wallet.
export const MARKET_GOODS = Object.freeze([
    Object.freeze({ id: 'pyrite',    color: 'red',    label: 'Pyrite',    rarity: 'common', base: 6 }),
    Object.freeze({ id: 'cryonite',  color: 'blue',   label: 'Cryonite',  rarity: 'common', base: 7 }),
    Object.freeze({ id: 'verdanite', color: 'green',  label: 'Verdanite', rarity: 'common', base: 8 }),
    Object.freeze({ id: 'helium',    color: 'yellow', label: 'Helium',    rarity: 'common', base: 9 }),
    Object.freeze({ id: 'volatiles', color: 'bomb',   label: 'Volatiles', rarity: 'rare',   base: 26 }),
    Object.freeze({ id: 'biomass',   color: 'snake',  label: 'Biomass',   rarity: 'rare',   base: 30 }),
    Object.freeze({ id: 'minerals',  color: null,     label: 'Minerals',  rarity: 'bulk',   base: 5 }),
]);

export const MARKET_GOOD_IDS = Object.freeze(MARKET_GOODS.map((g) => g.id));

/** Fraction of the buy price lost on the round trip (house spread). */
export const MARKET_SPREAD = 0.28;

/** Max daily price swing, either direction, as a fraction of base. */
export const MARKET_DRIFT = 0.22;

/** Quick-trade lot sizes the MARKET tab offers per row. */
export const TRADE_LOTS = Object.freeze([10, 50]);

// ---- refining ---------------------------------------------------------

// How many ore units melt down into one mineral. Rares are denser, so
// two hazard ore = one mineral; the Refinery tech scales the output.
export const REFINE_RATIO_COMMON = 4;
export const REFINE_RATIO_RARE = 2;

/** Refining ratio for one board colour. */
export function refineRatioFor(color) {
    const ore = ORE_BY_COLOR[color];
    return ore && ore.rarity === 'rare' ? REFINE_RATIO_RARE : REFINE_RATIO_COMMON;
}

/**
 * Quote a single refine order.
 *
 * @param {object} opts
 * @param {string} opts.color   board colour / MetaState ore key
 * @param {number} opts.amount  ore units to melt (clamped to what you hold)
 * @param {number} [opts.held]  units actually in the hold
 * @param {object} [opts.effects] resolved research effects
 * @returns {{ok:boolean, consumed:number, minerals:number, reason:string|null}}
 */
export function refineQuote({ color, amount, held = Infinity, effects = null } = {}) {
    if (!color || !ORE_BY_COLOR[color]) {
        return { ok: false, consumed: 0, minerals: 0, reason: 'unknown ore' };
    }
    const have = Math.max(0, Math.floor(Number.isFinite(held) ? held : 0));
    const want = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    const consumed = Math.min(want, have);
    if (consumed <= 0) return { ok: false, consumed: 0, minerals: 0, reason: 'nothing to refine' };

    const ratio = refineRatioFor(color);
    const throughput = Number.isFinite(effects?.mineralYieldMultiplier) ? effects.mineralYieldMultiplier : 1;
    const minerals = Math.floor((consumed / ratio) * throughput);
    if (minerals <= 0) {
        return { ok: false, consumed: 0, minerals: 0, reason: `need ${ratio} units per mineral` };
    }
    // Only melt what actually produced a mineral, so leftover units stay
    // in the hold and accumulate toward the next bar.
    const used = Math.min(consumed, minerals * ratio);
    return { ok: true, consumed: used, minerals, reason: null };
}

/**
 * Plan a "REFINE ALL" across the whole hold.
 *
 * @param {Record<string, number>} counts  ore counts keyed by colour
 * @param {object} [effects]
 * @returns {{minerals:number, consumed:Record<string, number>, rows:Array}}
 */
export function refinePlan(counts = {}, effects = null) {
    const consumed = {};
    const rows = [];
    let minerals = 0;
    for (const ore of ORES) {
        const held = Math.max(0, Math.floor(counts?.[ore.color] || 0));
        const quote = refineQuote({ color: ore.color, amount: held, held, effects });
        rows.push({ ...ore, held, consumed: quote.consumed, minerals: quote.minerals, ok: quote.ok });
        if (quote.ok) {
            minerals += quote.minerals;
            consumed[ore.color] = quote.consumed;
        }
    }
    return { minerals: Math.max(0, Math.floor(minerals)), consumed, rows };
}

// ---- market prices ----------------------------------------------------

/**
 * Deterministic daily price table.
 *
 * @param {object} [opts]
 * @param {string} [opts.dayKey]  UTC day (defaults to today)
 * @param {object} [opts.effects] resolved research effects (Trade Compact)
 * @returns {Record<string, {buy:number, sell:number, drift:number, base:number, label:string, color:string|null, rarity:string}>}
 */
export function marketPrices({ dayKey = defaultDayKey(), effects = null } = {}) {
    const sellBonus = Number.isFinite(effects?.marketSellBonus) ? effects.marketSellBonus : 0;
    const buyDiscount = Number.isFinite(effects?.marketBuyDiscount) ? effects.marketBuyDiscount : 0;
    const table = {};
    for (const good of MARKET_GOODS) {
        const drift = driftFor(good.id, dayKey);
        const mid = good.base * (1 + drift);
        const buy = Math.max(1, Math.round(mid * (1 - buyDiscount)));
        const sell = Math.max(1, Math.round(mid * (1 - MARKET_SPREAD) * (1 + sellBonus)));
        table[good.id] = {
            id: good.id,
            label: good.label,
            color: good.color,
            rarity: good.rarity,
            base: good.base,
            drift,
            buy,
            sell,
        };
    }
    return table;
}

/** Signed drift for one good on one day, in [-MARKET_DRIFT, +MARKET_DRIFT]. */
export function driftFor(goodId, dayKey = defaultDayKey()) {
    const h = hashString(`stellar-market:${dayKey}:${goodId}`);
    const unit = (h % 10000) / 10000;           // 0..0.9999
    return Number(((unit * 2 - 1) * MARKET_DRIFT).toFixed(4));
}

/**
 * Full market report for the tab: prices + a headline that names the
 * day's biggest mover + the countdown to the next drift.
 */
export function marketReport({ dayKey = defaultDayKey(), effects = null, nowMs = Date.now() } = {}) {
    const prices = marketPrices({ dayKey, effects });
    const movers = MARKET_GOODS
        .map((g) => ({ id: g.id, label: g.label, drift: prices[g.id].drift }))
        .sort((a, b) => b.drift - a.drift);
    const top = movers[0];
    const bottom = movers[movers.length - 1];
    const pct = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`;
    const headline = top && bottom && top.id !== bottom.id
        ? `${top.label} ${pct(top.drift)} today · ${bottom.label} ${pct(bottom.drift)} · drift resets in ${countdownToNextDay(nowMs)}`
        : `Exchange rates are stable. Drift resets in ${countdownToNextDay(nowMs)}`;
    return { dayKey, prices, headline, top, bottom, movers };
}

/**
 * Quote a buy/sell order without touching state.
 *
 * @param {object} opts
 * @param {string} opts.goodId      MARKET_GOODS id
 * @param {'buy'|'sell'} opts.side
 * @param {number} opts.amount      units requested
 * @param {object} [opts.prices]    price table (defaults to today's)
 * @param {number} [opts.credits]   wallet, used to clamp buys
 * @param {number} [opts.held]      units held, used to clamp sells
 * @returns {{ok:boolean, goodId:string, side:string, amount:number, credits:number, reason:string|null}}
 */
export function tradeQuote({ goodId, side, amount, prices = null, credits = Infinity, held = Infinity } = {}) {
    const table = prices || marketPrices({});
    const price = table[goodId];
    if (!price) return { ok: false, goodId, side, amount: 0, credits: 0, reason: 'unknown good' };
    const want = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
    if (want <= 0) return { ok: false, goodId, side, amount: 0, credits: 0, reason: 'empty order' };

    if (side === 'buy') {
        const affordable = Number.isFinite(credits)
            ? Math.floor(credits / Math.max(1, price.buy))
            : want;
        const qty = Math.min(want, affordable);
        if (qty <= 0) return { ok: false, goodId, side, amount: 0, credits: 0, reason: 'not enough credits' };
        return { ok: true, goodId, side, amount: qty, credits: qty * price.buy, reason: null };
    }

    if (side === 'sell') {
        const have = Math.max(0, Math.floor(Number.isFinite(held) ? held : 0));
        const qty = Math.min(want, have);
        if (qty <= 0) return { ok: false, goodId, side, amount: 0, credits: 0, reason: 'nothing to sell' };
        return { ok: true, goodId, side, amount: qty, credits: qty * price.sell, reason: null };
    }

    return { ok: false, goodId, side, amount: 0, credits: 0, reason: 'unknown side' };
}

/** Which MetaState bucket a good lives in: `'ore:<color>'` or `'minerals'`. */
export function balanceKeyFor(goodId) {
    const good = MARKET_GOODS.find((g) => g.id === goodId);
    if (!good) return null;
    return good.color ? `ore:${good.color}` : 'minerals';
}

// ---- price history (the MARKET chart) ---------------------------------

// The MARKET tab's centre panel is a TradingView-style price chart, and a
// chart needs a series — but the whole market is a pure function of the UTC
// day key, so there is nothing to remember between sessions. The series is
// therefore *derived*, not stored: each point re-runs the same drift math
// for the hour it belongs to, with a small hashed intraday wobble on top.
//
// Two properties make that safe:
//
//   * Deterministic. Same good, same `nowMs` → same series, forever, on
//     every machine. Nothing is written to the save file.
//   * Honest at the right edge. The final point's wobble is zero, so the
//     last candle is exactly today's `marketPrices()` mid — the number the
//     BUY/SELL buttons quote. A chart that disagreed with the order ticket
//     would be worse than no chart.

/** Default resolution: one point per hour over the last 24 hours. */
export const PRICE_HISTORY_POINTS = 24;

/** Amplitude of the intraday wobble, as a fraction of base price. */
export const PRICE_INTRADAY_WOBBLE = 0.06;

const HOUR_MS = 3600000;

/** Signed intraday wobble for one good in one hour bucket. */
export function intradayWobbleFor(goodId, hourBucket) {
    const h = hashString(`stellar-market-tick:${hourBucket}:${goodId}`);
    const unit = (h % 10000) / 10000;
    return Number(((unit * 2 - 1) * PRICE_INTRADAY_WOBBLE).toFixed(5));
}

/**
 * Derive the price series the chart draws.
 *
 * @param {object} opts
 * @param {string} opts.goodId      one of MARKET_GOOD_IDS
 * @param {number} [opts.nowMs]     right edge of the series (host clock)
 * @param {object} [opts.effects]   resolved research effects (spread bends)
 * @param {number} [opts.points]    series length, clamped to 2..168
 * @param {number} [opts.stepMs]    spacing between points (default 1 hour)
 * @returns {{ok:boolean, goodId:string|null, label:string, points:Array<{tMs:number, hourBucket:number, drift:number, wobble:number, mid:number, buy:number, sell:number}>, first:object|null, last:object|null, high:number, low:number, changePct:number, dayChangePct:number}}
 */
export function priceHistory({
    goodId = null,
    nowMs = Date.now(),
    effects = null,
    points = PRICE_HISTORY_POINTS,
    stepMs = HOUR_MS,
} = {}) {
    const good = MARKET_GOODS.find((g) => g.id === goodId);
    const empty = {
        ok: false, goodId: good ? good.id : null, label: good ? good.label : String(goodId || ''),
        points: [], first: null, last: null, high: 0, low: 0, changePct: 0, dayChangePct: 0,
    };
    if (!good) return empty;

    const t = Number.isFinite(nowMs) ? nowMs : Date.now();
    const count = Math.max(2, Math.min(168, Math.floor(Number.isFinite(points) ? points : PRICE_HISTORY_POINTS)));
    const step = Math.max(1, Math.floor(Number.isFinite(stepMs) ? stepMs : HOUR_MS));
    const sellBonus = Number.isFinite(effects?.marketSellBonus) ? effects.marketSellBonus : 0;
    const buyDiscount = Number.isFinite(effects?.marketBuyDiscount) ? effects.marketBuyDiscount : 0;

    const series = [];
    for (let i = 0; i < count; i += 1) {
        const tMs = t - (count - 1 - i) * step;
        const hourBucket = Math.floor(tMs / HOUR_MS);
        const key = defaultDayKey(tMs);
        const drift = driftFor(good.id, key);
        // The right edge is the live quote: no wobble, no disagreement.
        const wobble = i === count - 1 ? 0 : intradayWobbleFor(good.id, hourBucket);
        const mid = good.base * (1 + drift + wobble);
        series.push({
            tMs,
            hourBucket,
            dayKey: key,
            drift,
            wobble,
            mid: Number(mid.toFixed(3)),
            buy: Math.max(1, Math.round(mid * (1 - buyDiscount))),
            sell: Math.max(1, Math.round(mid * (1 - MARKET_SPREAD) * (1 + sellBonus))),
        });
    }

    const first = series[0];
    const last = series[series.length - 1];
    const mids = series.map((p) => p.mid);
    const yesterday = driftFor(good.id, defaultDayKey(t - 24 * HOUR_MS));
    const yesterdayMid = good.base * (1 + yesterday);

    return {
        ok: true,
        goodId: good.id,
        label: good.label,
        color: good.color,
        rarity: good.rarity,
        base: good.base,
        points: series,
        first,
        last,
        high: Math.max(...mids),
        low: Math.min(...mids),
        // Change across the visible window, and change against yesterday's
        // close — the two numbers a trading header normally shows.
        changePct: first.mid > 0 ? Number(((last.mid - first.mid) / first.mid).toFixed(4)) : 0,
        dayChangePct: yesterdayMid > 0 ? Number(((last.mid - yesterdayMid) / yesterdayMid).toFixed(4)) : 0,
    };
}

// ---- warp cells -------------------------------------------------------

// Warp cells are the STAR MAP fuel. They are *found*, never bought:
// exploration, salvage, and combat dispatches can bring one home, which
// makes the risky mission types the way to open the map.
export const WARP_FIND_RULES = Object.freeze({
    Exploration: Object.freeze({ minRisk: 2 }),
    Salvage:     Object.freeze({ minRisk: 3 }),
    Combat:      Object.freeze({ minRisk: 1 }),
});

/**
 * Warp cells recovered from one finished dispatch.
 *
 * @returns {number} 0 or 1
 */
export function warpRewardFor({ type = null, risk = 1, won = true, dispatchMode = 'manual' } = {}) {
    if (!won) return 0;
    const rule = WARP_FIND_RULES[String(type || '')];
    if (!rule) return 0;
    const r = Math.max(1, Math.min(5, Math.floor(Number.isFinite(risk) ? risk : 1)));
    if (r < rule.minRisk) return 0;
    // Idle fleets find warp cells half as often: only risk 4+ contracts.
    if (dispatchMode === 'idle' && r < 4) return 0;
    return 1;
}
