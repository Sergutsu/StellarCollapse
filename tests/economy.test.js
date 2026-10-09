// Meta-economy: refining, daily-drift market, warp income (P8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MARKET_GOODS,
    MARKET_GOOD_IDS,
    MARKET_SPREAD,
    MARKET_DRIFT,
    REFINE_RATIO_COMMON,
    REFINE_RATIO_RARE,
    refineRatioFor,
    refineQuote,
    refinePlan,
    marketPrices,
    driftFor,
    marketReport,
    tradeQuote,
    balanceKeyFor,
    warpRewardFor,
    priceHistory,
    intradayWobbleFor,
    PRICE_HISTORY_POINTS,
    PRICE_INTRADAY_WOBBLE,
} from '../src/economy.js';
import { ORES } from '../src/missions.js';
import { ORE_IDS } from '../src/meta-state.js';

const DAY = '2026-10-09';

test('the market trades every ore plus raw minerals', () => {
    ORES.forEach((ore) => assert.ok(MARKET_GOOD_IDS.includes(ore.id), `${ore.id} tradable`));
    assert.ok(MARKET_GOOD_IDS.includes('minerals'));
    assert.equal(MARKET_GOODS.length, ORES.length + 1);
});

test('balanceKeyFor maps goods onto MetaState buckets', () => {
    assert.equal(balanceKeyFor('pyrite'), 'ore:red');
    assert.equal(balanceKeyFor('biomass'), 'ore:snake');
    assert.equal(balanceKeyFor('minerals'), 'minerals');
    assert.equal(balanceKeyFor('nope'), null);
    ORE_IDS.forEach((color) => {
        const good = MARKET_GOODS.find((g) => g.color === color);
        assert.ok(good, `a good exists for ore colour ${color}`);
    });
});

test('prices are deterministic per day and per good', () => {
    const a = marketPrices({ dayKey: DAY });
    const b = marketPrices({ dayKey: DAY });
    assert.deepEqual(a, b);
    assert.equal(driftFor('pyrite', DAY), driftFor('pyrite', DAY));
});

test('prices drift across days', () => {
    const a = marketPrices({ dayKey: '2026-10-09' });
    const b = marketPrices({ dayKey: '2026-10-10' });
    const moved = MARKET_GOOD_IDS.some((id) => a[id].drift !== b[id].drift);
    assert.ok(moved, 'expected at least one good to drift day over day');
});

test('drift stays inside the documented band', () => {
    for (let d = 1; d <= 30; d += 1) {
        const dayKey = `2026-11-${String(d).padStart(2, '0')}`;
        for (const id of MARKET_GOOD_IDS) {
            const drift = driftFor(id, dayKey);
            assert.ok(Math.abs(drift) <= MARKET_DRIFT + 1e-9, `${id} ${dayKey} drift ${drift}`);
        }
    }
});

test('the house always takes a spread: sell < buy', () => {
    const prices = marketPrices({ dayKey: DAY });
    MARKET_GOOD_IDS.forEach((id) => {
        const p = prices[id];
        assert.ok(p.sell < p.buy, `${id} sell ${p.sell} >= buy ${p.buy}`);
        assert.ok(p.buy >= 1 && p.sell >= 1, `${id} prices are positive integers`);
        assert.ok(Number.isInteger(p.buy) && Number.isInteger(p.sell));
    });
    assert.ok(MARKET_SPREAD > 0 && MARKET_SPREAD < 1);
});

test('trade compact lifts sells and cuts buys', () => {
    const plain = marketPrices({ dayKey: DAY });
    const compact = marketPrices({ dayKey: DAY, effects: { marketSellBonus: 0.06, marketBuyDiscount: 0.03 } });
    MARKET_GOOD_IDS.forEach((id) => {
        assert.ok(compact[id].sell >= plain[id].sell, `${id} sell not improved`);
        assert.ok(compact[id].buy <= plain[id].buy, `${id} buy not discounted`);
    });
});

test('marketReport names the day\'s movers and the drift countdown', () => {
    const report = marketReport({ dayKey: DAY, nowMs: Date.UTC(2026, 9, 9, 12, 0, 0) });
    assert.equal(report.dayKey, DAY);
    assert.ok(report.headline.includes('drift resets in 12:00:00'), report.headline);
    assert.equal(report.movers.length, MARKET_GOODS.length);
    assert.ok(report.top.drift >= report.bottom.drift);
});

// ---- refining ---------------------------------------------------------

test('refining ratios differ for common vs rare ore', () => {
    assert.equal(refineRatioFor('red'), REFINE_RATIO_COMMON);
    assert.equal(refineRatioFor('yellow'), REFINE_RATIO_COMMON);
    assert.equal(refineRatioFor('bomb'), REFINE_RATIO_RARE);
    assert.equal(refineRatioFor('snake'), REFINE_RATIO_RARE);
});

test('refineQuote melts whole bars only and keeps the remainder', () => {
    const quote = refineQuote({ color: 'red', amount: 10, held: 10 });
    assert.equal(quote.ok, true);
    assert.equal(quote.minerals, 2);
    assert.equal(quote.consumed, 8, 'leftover 2 units stay in the hold');
});

test('refineQuote rejects orders it cannot fulfil', () => {
    assert.equal(refineQuote({ color: 'red', amount: 3, held: 3 }).ok, false, 'below one bar');
    assert.equal(refineQuote({ color: 'red', amount: 5, held: 0 }).ok, false, 'empty hold');
    assert.equal(refineQuote({ color: 'nope', amount: 5, held: 5 }).ok, false, 'unknown ore');
    assert.equal(refineQuote({ color: 'red', amount: 0, held: 50 }).ok, false, 'zero order');
});

test('refineQuote clamps to what is actually held', () => {
    const quote = refineQuote({ color: 'blue', amount: 999, held: 9 });
    assert.equal(quote.consumed, 8);
    assert.equal(quote.minerals, 2);
});

test('refinery research lifts throughput', () => {
    const plain = refineQuote({ color: 'red', amount: 100, held: 100 });
    const boosted = refineQuote({ color: 'red', amount: 100, held: 100, effects: { mineralYieldMultiplier: 1.15 } });
    assert.equal(plain.minerals, 25);
    assert.ok(boosted.minerals > plain.minerals);
});

test('rare ore is denser: two units per mineral', () => {
    const quote = refineQuote({ color: 'bomb', amount: 7, held: 7 });
    assert.equal(quote.minerals, 3);
    assert.equal(quote.consumed, 6);
});

test('refinePlan sweeps the whole hold and reports per-ore rows', () => {
    const counts = { red: 10, blue: 4, green: 0, yellow: 5, bomb: 3, snake: 0 };
    const plan = refinePlan(counts);
    assert.equal(plan.rows.length, ORES.length);
    assert.equal(plan.consumed.red, 8);
    assert.equal(plan.consumed.blue, 4);
    assert.equal(plan.consumed.bomb, 2);
    assert.equal(plan.consumed.yellow, 4);
    assert.equal(plan.consumed.green, undefined, 'nothing to melt is not listed');
    assert.equal(plan.consumed.snake, undefined);
    // red 10→2, blue 4→1, yellow 5→1, bomb 3→1
    assert.equal(plan.minerals, 5);
    assert.deepEqual(refinePlan({}).rows.map((r) => r.minerals), ORES.map(() => 0));
});

// ---- trading ----------------------------------------------------------

test('tradeQuote prices a sell from the daily table', () => {
    const prices = marketPrices({ dayKey: DAY });
    const quote = tradeQuote({ goodId: 'pyrite', side: 'sell', amount: 10, prices, held: 40 });
    assert.equal(quote.ok, true);
    assert.equal(quote.amount, 10);
    assert.equal(quote.credits, 10 * prices.pyrite.sell);
});

test('tradeQuote clamps sells to the hold and buys to the wallet', () => {
    const prices = marketPrices({ dayKey: DAY });
    const sell = tradeQuote({ goodId: 'biomass', side: 'sell', amount: 50, prices, held: 7 });
    assert.equal(sell.amount, 7);

    const buy = tradeQuote({ goodId: 'minerals', side: 'buy', amount: 500, prices, credits: 12 });
    assert.equal(buy.ok, true);
    assert.ok(buy.amount * prices.minerals.buy <= 12);
    assert.equal(buy.credits, buy.amount * prices.minerals.buy);
});

test('tradeQuote rejects impossible orders with a reason', () => {
    const prices = marketPrices({ dayKey: DAY });
    assert.equal(tradeQuote({ goodId: 'pyrite', side: 'buy', amount: 5, prices, credits: 0 }).reason, 'not enough credits');
    assert.equal(tradeQuote({ goodId: 'pyrite', side: 'sell', amount: 5, prices, held: 0 }).reason, 'nothing to sell');
    assert.equal(tradeQuote({ goodId: 'unobtainium', side: 'sell', amount: 5, prices }).reason, 'unknown good');
    assert.equal(tradeQuote({ goodId: 'pyrite', side: 'hold', amount: 5, prices }).reason, 'unknown side');
    assert.equal(tradeQuote({ goodId: 'pyrite', side: 'sell', amount: 0, prices, held: 5 }).reason, 'empty order');
});

// ---- warp income ------------------------------------------------------

test('warp cells come from exploration, salvage and combat dispatches', () => {
    assert.equal(warpRewardFor({ type: 'Exploration', risk: 2 }), 1);
    assert.equal(warpRewardFor({ type: 'Salvage', risk: 4 }), 1);
    assert.equal(warpRewardFor({ type: 'Combat', risk: 1 }), 1);
    assert.equal(warpRewardFor({ type: 'Mining', risk: 5 }), 0, 'mining never finds warp cells');
    assert.equal(warpRewardFor({ type: 'Research', risk: 5 }), 0);
});

test('low-risk contracts of a warp-bearing type find nothing', () => {
    assert.equal(warpRewardFor({ type: 'Exploration', risk: 1 }), 0);
    assert.equal(warpRewardFor({ type: 'Salvage', risk: 2 }), 0);
});

test('a lost run finds nothing and idle fleets need risk 4+', () => {
    assert.equal(warpRewardFor({ type: 'Combat', risk: 5, won: false }), 0);
    assert.equal(warpRewardFor({ type: 'Combat', risk: 2, dispatchMode: 'idle' }), 0);
    assert.equal(warpRewardFor({ type: 'Exploration', risk: 4, dispatchMode: 'idle' }), 1);
});

// ---- price history (the MARKET chart) ---------------------------------

const NOW = Date.UTC(2026, 9, 9, 15, 30, 0);   // 2026-10-09T15:30Z

test('priceHistory derives one point per hour and ends on the live quote', () => {
    const effects = { marketSellBonus: 0.04 };
    const h = priceHistory({ goodId: 'pyrite', nowMs: NOW, effects });
    assert.equal(h.ok, true);
    assert.equal(h.points.length, PRICE_HISTORY_POINTS);
    assert.equal(h.label, 'Pyrite');

    // Right edge must equal what the order ticket quotes today.
    const table = marketPrices({ dayKey: '2026-10-09', effects }).pyrite;
    assert.equal(h.last.mid, Number((6 * (1 + table.drift)).toFixed(3)));
    assert.equal(h.last.buy, table.buy);
    assert.equal(h.last.sell, table.sell);
    assert.equal(h.last.wobble, 0, 'the live point never wobbles');

    // Points are evenly spaced and end exactly at nowMs.
    assert.equal(h.last.tMs, NOW);
    assert.equal(h.first.tMs, NOW - (PRICE_HISTORY_POINTS - 1) * 3600000);
    h.points.forEach((p, i) => {
        if (i) assert.equal(p.tMs - h.points[i - 1].tMs, 3600000);
    });
});

test('priceHistory is deterministic and never stored', () => {
    const a = priceHistory({ goodId: 'volatiles', nowMs: NOW }).points;
    const b = priceHistory({ goodId: 'volatiles', nowMs: NOW }).points;
    assert.deepEqual(a, b);
    assert.equal(intradayWobbleFor('volatiles', 5), intradayWobbleFor('volatiles', 5));
    const w = intradayWobbleFor('biomass', 12345);
    assert.ok(Math.abs(w) <= PRICE_INTRADAY_WOBBLE, `wobble ${w} inside amplitude`);
});

test('the intraday wobble stays inside its band and the drift steps at midnight', () => {
    const h = priceHistory({ goodId: 'cryonite', nowMs: NOW });
    h.points.forEach((p) => {
        assert.ok(Math.abs(p.wobble) <= PRICE_INTRADAY_WOBBLE + 1e-9);
        assert.ok(p.mid > 0 && Number.isInteger(p.buy) && Number.isInteger(p.sell));
        assert.ok(p.buy >= p.sell, 'the house spread always widens outward');
    });
    // A window that crosses UTC midnight carries two different day keys.
    const crossing = priceHistory({ goodId: 'cryonite', nowMs: Date.UTC(2026, 9, 9, 2, 0, 0) });
    const keys = new Set(crossing.points.map((p) => p.dayKey));
    assert.ok(keys.has('2026-10-09') && keys.has('2026-10-08'), [...keys].join(','));
    const drifts = new Set(crossing.points.map((p) => p.drift));
    assert.equal(drifts.size, 2, 'one drift per UTC day');
});

test('the series reports high/low and both change readings', () => {
    const h = priceHistory({ goodId: 'minerals', nowMs: NOW });
    const mids = h.points.map((p) => p.mid);
    assert.equal(h.high, Math.max(...mids));
    assert.equal(h.low, Math.min(...mids));
    assert.equal(h.changePct, Number(((h.last.mid - h.first.mid) / h.first.mid).toFixed(4)));
    assert.ok(Number.isFinite(h.dayChangePct));

    // Every good gets its own line.
    const seen = new Set();
    MARKET_GOOD_IDS.forEach((id) => {
        const s = priceHistory({ goodId: id, nowMs: NOW });
        assert.equal(s.ok, true);
        assert.equal(s.goodId, id);
        seen.add(s.last.mid);
    });
    assert.ok(seen.size >= 4, 'distinct series across goods');
});

test('priceHistory clamps bad input instead of throwing', () => {
    assert.equal(priceHistory({ goodId: 'unobtainium', nowMs: NOW }).ok, false);
    assert.deepEqual(priceHistory({}).points, []);
    const tiny = priceHistory({ goodId: 'helium', nowMs: NOW, points: 0 });
    assert.equal(tiny.points.length, 2, 'clamped to the minimum');
    const huge = priceHistory({ goodId: 'helium', nowMs: NOW, points: 100000 });
    assert.equal(huge.points.length, 168, 'clamped to the maximum');
    const stepped = priceHistory({ goodId: 'helium', nowMs: NOW, points: 6, stepMs: 4 * 3600000 });
    assert.equal(stepped.points[1].tMs - stepped.points[0].tMs, 4 * 3600000);
});
