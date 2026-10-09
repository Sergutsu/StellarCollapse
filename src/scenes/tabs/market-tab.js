// MarketTab -- interstellar commodity exchange + refinery. Mounts into the
// hub's center panel when the user clicks the MARKET bottom-nav tab.
//
// P8 replaced the old flat credits <-> minerals swap with the real market:
//
//   * Seven goods (six ores + minerals) priced by `economy.marketPrices()`.
//     Prices drift once per UTC day, and the tech tree's Trade Compact plus
//     a charted Nova Bazaar bend the spread in the player's favour.
//   * Orders are quoted by `economy.tradeQuote()` and applied by
//     `MetaState.applyTrade()`, so the number on the button is always the
//     number that lands — a buy can never overspend credits and a sell can
//     never sell stock the player does not have.
//   * The refinery melts ore into minerals (`economy.refinePlan` +
//     `MetaState.applyRefine`), which is the main mineral faucet feeding
//     the BUILD/UPGRADE and RESEARCH sinks.
//
// P9 split the tab the way a trading terminal is split:
//
//   * The goods list moved to the hub's LEFT PANEL (the same bay that
//     carries ACTIVE MISSIONS and ACTIVE RESEARCH). It doubles as a
//     watchlist: tapping a row charts that good.
//   * The CENTER panel is now one thing — a TradingView-style price chart
//     for the selected good, drawn from `economy.priceHistory()`.
//
// Pure view code: every rule lives in economy.js / meta-state.js.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
} from '../../pixi-ui-kit.js';
import {
    MARKET_GOODS,
    TRADE_LOTS,
    REFINE_RATIO_COMMON,
    REFINE_RATIO_RARE,
    PRICE_HISTORY_POINTS,
    balanceKeyFor,
    marketReport,
    tradeQuote,
    refinePlan,
    priceHistory,
} from '../../economy.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_SLATE_500 = 0x64748b;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_EMERALD_300 = 0x6ee7b7;
const COLOR_ROSE_300 = 0xfda4af;
const COLOR_PURPLE_300 = 0xc4b5fd;
const GRID_LINE = 0x334155;

// Per-good swatch colours, keyed by the ore colour each good maps to.
const GOOD_TINT = {
    red: 0xfb7185,
    blue: 0x60a5fa,
    green: 0x4ade80,
    yellow: 0xfacc15,
    bomb: 0xf97316,
    snake: 0xa78bfa,
    null: COLOR_PURPLE_300,
};

const ROW_H_MAX = 30;
const ROW_H_MIN = 22;
// HubScene._buildSidePanel() mounts `list` at (12, 40) inside the frame, so
// a tab's usable height is the panel height minus that 40 px header offset.
const SIDE_LIST_TOP = 40;
const BUTTON_H = 20;
const BUTTON_W = 32;

// Chart frame: room for the header strip, the price axis on the right and
// the hour axis along the bottom.
const CHART_TOP = 46;
const CHART_RIGHT = 56;
const CHART_BOTTOM = 22;
const CHART_LEFT = 10;
const GRID_ROWS = 5;
const GRID_COLS = 6;
const CHART_MIN_H = 140;

/** `HH:00` in UTC — the same clock the daily drift runs on. */
function hourLabel(tMs) {
    const d = new Date(tMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

function signedPct(value) {
    const pct = (Number.isFinite(value) ? value : 0) * 100;
    return `${pct >= 0 ? '+' : '\u2212'}${Math.abs(pct).toFixed(1)}%`;
}

export class MarketTab {
    constructor({ parent, meta, side = null }) {
        if (!parent) throw new Error('MarketTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        // The hub's left-column panel holds the goods list (watchlist +
        // order buttons); this tab owns it while MARKET is the active tab.
        this._side = side;
        this._sideW = 276;
        this._sideH = 420;
        this.usesSidePanel = true;
        this.sidePanelTitle = 'MARKET';

        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._lot = TRADE_LOTS[0];
        this._rowH = ROW_H_MAX;   // set precisely by _refreshSide()
        this._selectedGood = MARKET_GOODS[0].id;
        this._status = 'Drift resets at 00:00 UTC. Buy low, sell high, Commander.';
        this._history = null;
        this._plot = null;
        this._crosshair = null;
        this._tickAccumMs = 0;
        this._lastW = 0;
        this._lastH = 0;
    }

    get visible() { return !!this.root.visible; }

    show() {
        if (!this._nodes) this._build();
        this._refresh();
        this.root.visible = true;
    }

    hide() {
        this.root.visible = false;
        this._crosshair = null;
        // Shared bay: take this tab's list with it when the tab goes away.
        if (this._nodes?.market) this._nodes.market.container.visible = false;
    }

    layout(screen) {
        if (!this._nodes || !screen) return;
        const w = screen.width || 0;
        const h = screen.height || 0;
        if (w <= 0 || h <= 0) return;
        this._layout(w, h);
    }

    /** Called by HubScene on activation and on every resize. */
    layoutSide({ width = 276, height = 420 } = {}) {
        this._sideW = Math.max(180, Math.floor(width));
        this._sideH = Math.max(200, Math.floor(height));
        this._refreshSide();
        this._refresh();
    }

    // The drift countdown in the headline ticks down; repaint once a second
    // while the tab is the one on screen.
    tick(deltaMs) {
        if (!this.root?.visible || !this._nodes) return;
        this._tickAccumMs += deltaMs || 0;
        if (this._tickAccumMs < 1000) return;
        this._tickAccumMs = 0;
        this._refreshHeadline();
    }

    destroy() {
        if (this.root) {
            this.root.destroy({ children: true });
            this.root = null;
        }
        this._nodes = null;
        this._plot = null;
    }

    // ------------------------------------------------------------------
    // Build — center panel (the chart)
    // ------------------------------------------------------------------

    _build() {
        const title = panelLabel('MARKET \u00B7 COMMODITY EXCHANGE', COLOR_AMBER_300, { size: 14, weight: '800' });
        title.style.letterSpacing = 2;
        title.position.set(16, 12);
        this.root.addChild(title);

        // --- Balances strip -----------------------------------------
        const balancesPanel = drawHologramPanel(460, 48, { accent: COLOR_CYAN_500 });
        this.root.addChild(balancesPanel);

        const creditsLabel = panelLabel('CREDITS', COLOR_EMERALD_300, { size: 9, weight: '700' });
        creditsLabel.position.set(14, 6);
        balancesPanel.addChild(creditsLabel);
        const creditsValue = panelLabel('0', COLOR_SLATE_200, { size: 15, weight: '800' });
        creditsValue.position.set(14, 20);
        balancesPanel.addChild(creditsValue);

        const mineralsLabel = panelLabel('MINERALS', COLOR_PURPLE_300, { size: 9, weight: '700' });
        mineralsLabel.position.set(140, 6);
        balancesPanel.addChild(mineralsLabel);
        const mineralsValue = panelLabel('0', COLOR_SLATE_200, { size: 15, weight: '800' });
        mineralsValue.position.set(140, 20);
        balancesPanel.addChild(mineralsValue);

        const headline = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace', fontSize: 9, fill: COLOR_CYAN_300,
                wordWrap: true, wordWrapWidth: 240, lineHeight: 12,
            }),
        });
        headline.position.set(270, 8);
        balancesPanel.addChild(headline);

        // --- Chart ---------------------------------------------------
        const chartPanel = drawHologramPanel(460, 300, { accent: COLOR_CYAN_500 });
        this.root.addChild(chartPanel);

        const chartG = new Graphics();
        chartPanel.addChild(chartG);

        const goodName = panelLabel('PYRITE', COLOR_SLATE_200, { size: 13, weight: '800' });
        goodName.position.set(14, 7);
        chartPanel.addChild(goodName);

        const lastPrice = new Text({
            text: '0',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace', fontSize: 16, fontWeight: '800', fill: COLOR_EMERALD_300,
            }),
        });
        lastPrice.position.set(14, 23);
        chartPanel.addChild(lastPrice);

        const changeText = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 10, fontWeight: '700', fill: COLOR_EMERALD_300 }),
        });
        changeText.position.set(120, 28);
        chartPanel.addChild(changeText);

        const rangeText = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 9, fill: COLOR_SLATE_400 }),
        });
        rangeText.anchor.set(1, 0);
        rangeText.position.set(446, 8);
        chartPanel.addChild(rangeText);

        const orderText = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 9, fill: COLOR_SLATE_400 }),
        });
        orderText.anchor.set(1, 0);
        orderText.position.set(446, 22);
        chartPanel.addChild(orderText);

        const hint = new Text({
            text: 'MOVE THE POINTER OVER THE CHART FOR A CROSSHAIR',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif', fontSize: 8, letterSpacing: 1, fill: COLOR_SLATE_500,
            }),
        });
        hint.position.set(14, 36);
        chartPanel.addChild(hint);

        // Axis label pools: created once, re-texted and repositioned on
        // every render so a price tick never allocates.
        const priceLabels = Array.from({ length: GRID_ROWS + 1 }, () => {
            const node = new Text({
                text: '',
                style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 8, fill: COLOR_SLATE_500 }),
            });
            node.anchor.set(0, 0.5);
            chartPanel.addChild(node);
            return node;
        });

        const timeLabels = Array.from({ length: GRID_COLS + 1 }, () => {
            const node = new Text({
                text: '',
                style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 8, fill: COLOR_SLATE_500 }),
            });
            node.anchor.set(0.5, 0);
            chartPanel.addChild(node);
            return node;
        });

        // Last-price tag + crosshair read-outs.
        const lastTag = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 8, fontWeight: '700', fill: 0x0b1220 }),
        });
        lastTag.anchor.set(0, 0.5);
        lastTag.visible = false;
        chartPanel.addChild(lastTag);

        const crossPrice = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 8, fontWeight: '700', fill: COLOR_SLATE_200 }),
        });
        crossPrice.anchor.set(0, 0.5);
        crossPrice.visible = false;
        chartPanel.addChild(crossPrice);

        const crossTime = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 8, fontWeight: '700', fill: COLOR_SLATE_200 }),
        });
        crossTime.anchor.set(0.5, 0);
        crossTime.visible = false;
        chartPanel.addChild(crossTime);

        // Crosshair input. The whole panel is the target; the render clips
        // the read-out to the plot rectangle.
        chartPanel.eventMode = 'static';
        chartPanel.on('pointermove', (e) => {
            const local = chartPanel.toLocal(e.global);
            this._crosshair = { x: local.x, y: local.y };
            this._renderChart();
        });
        // Both spellings: Pixi's boundary emits `pointerout` reliably and
        // `pointerleave` on recent versions. Binding twice is idempotent —
        // the handler only clears the crosshair — and an unsupported name
        // simply never fires, so one of the two always does.
        const clearCrosshair = () => {
            if (!this._crosshair) return;
            this._crosshair = null;
            this._renderChart();
        };
        chartPanel.on('pointerout', clearCrosshair);
        chartPanel.on('pointerleave', clearCrosshair);
        chartPanel.on('pointertap', () => {
            this._crosshair = null;
            this._renderChart();
        });

        // --- Refinery ------------------------------------------------
        const refineryPanel = drawHologramPanel(460, 70, { accent: 0x4a1d96 });
        this.root.addChild(refineryPanel);

        const refineryTitle = panelLabel('REFINERY', COLOR_PURPLE_300, { size: 11, weight: '800' });
        refineryTitle.position.set(12, 7);
        refineryPanel.addChild(refineryTitle);

        const refineryRatio = panelLabel(
            `Ore \u2192 minerals  \u00B7  common ${REFINE_RATIO_COMMON}:1  \u00B7  rare ${REFINE_RATIO_RARE}:1`,
            COLOR_SLATE_400,
            { size: 9 },
        );
        refineryRatio.position.set(12, 24);
        refineryPanel.addChild(refineryRatio);

        const refineryYield = panelLabel('0 minerals waiting', COLOR_AMBER_300, { size: 10, weight: '700' });
        refineryYield.position.set(12, 40);
        refineryPanel.addChild(refineryYield);

        const refineBtn = buildSimpleButton({
            text: 'REFINE ALL ORE',
            width: 150,
            height: 26,
            accent: 'magenta',
            onTap: () => this._refineAll(),
        });
        refineryPanel.addChild(refineBtn.container);

        // --- Status ---------------------------------------------------
        const newsPanel = drawHologramPanel(460, 34, { accent: 0x334155 });
        this.root.addChild(newsPanel);

        const statusText = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace', fontSize: 10, fill: COLOR_CYAN_300,
                wordWrap: true, wordWrapWidth: 436,
            }),
        });
        statusText.position.set(12, 9);
        newsPanel.addChild(statusText);

        // --- Goods list (lives in the hub's left panel) ---------------
        const market = this._buildGoodsList();

        this._nodes = {
            title,
            balancesPanel, creditsLabel, creditsValue, mineralsLabel, mineralsValue, headline,
            chartPanel, chartG, goodName, lastPrice, changeText, rangeText, orderText, hint,
            priceLabels, timeLabels, lastTag, crossPrice, crossTime,
            refineryPanel, refineryTitle, refineryRatio, refineryYield, refineBtn,
            newsPanel, statusText,
            market,
        };
    }

    /**
     * The goods list. Built once into its own container and re-parented
     * into the hub's left panel by `_refreshSide()`, which is also what
     * sizes it — the list no longer has to fight the chart for width.
     */
    _buildGoodsList() {
        const market = new Container();

        const lotLabel = panelLabel('LOT', COLOR_SLATE_400, { size: 9, weight: '700' });
        lotLabel.position.set(0, 5);
        market.addChild(lotLabel);

        const lotButtons = TRADE_LOTS.map((amount, i) => {
            const btn = buildSimpleButton({
                text: String(amount),
                width: 44,
                height: BUTTON_H,
                accent: 'cyan',
                onTap: () => this._setLot(amount),
            });
            btn.container.position.set(30 + i * 50, 0);
            market.addChild(btn.container);
            return { amount, btn };
        });

        const wallet = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 9, fontWeight: '700', fill: COLOR_AMBER_300 }),
        });
        wallet.anchor.set(1, 0);
        wallet.position.set(252, 5);
        market.addChild(wallet);

        const headGood = panelLabel('GOOD', COLOR_SLATE_500, { size: 8, weight: '700' });
        headGood.position.set(9, 26);
        market.addChild(headGood);

        const makeHead = (text, x) => {
            const node = panelLabel(text, COLOR_SLATE_500, { size: 8, weight: '700' });
            node.anchor.set(1, 0);
            node.position.set(x, 26);
            market.addChild(node);
            return node;
        };
        const headHeld = makeHead('HELD', 100);
        const headBuy = makeHead('BUY', 142);
        const headSell = makeHead('SELL', 182);

        const list = new Container();
        list.position.set(0, 40);
        market.addChild(list);

        const rows = MARKET_GOODS.map((good) => {
            const row = new Container();
            row.eventMode = 'static';
            row.cursor = 'pointer';
            list.addChild(row);

            const bg = new Graphics();
            row.addChild(bg);

            const tint = GOOD_TINT[good.color] ?? COLOR_SLATE_200;
            const swatch = new Graphics();
            row.addChild(swatch);

            const name = new Text({
                text: good.label.toUpperCase(),
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: '700',
                    letterSpacing: 0.5, fill: tint,
                }),
            });
            row.addChild(name);

            const mono = (fill) => new Text({
                text: '0',
                style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 9, fontWeight: '700', fill }),
            });

            const held = mono(COLOR_SLATE_200);
            held.anchor.set(1, 0);
            held.position.set(100, 0);
            row.addChild(held);

            const buyPrice = mono(COLOR_EMERALD_300);
            buyPrice.anchor.set(1, 0);
            buyPrice.position.set(142, 0);
            row.addChild(buyPrice);

            const sellPrice = mono(COLOR_ROSE_300);
            sellPrice.anchor.set(1, 0);
            sellPrice.position.set(182, 0);
            row.addChild(sellPrice);

            const buyBtn = buildSimpleButton({
                text: 'BUY',
                width: BUTTON_W,
                height: BUTTON_H - 2,
                accent: 'green',
                onTap: () => this._trade(good.id, 'buy'),
            });
            buyBtn.container.position.set(186, 0);
            row.addChild(buyBtn.container);

            const sellBtn = buildSimpleButton({
                text: 'SELL',
                width: BUTTON_W,
                height: BUTTON_H - 2,
                accent: 'magenta',
                onTap: () => this._trade(good.id, 'sell'),
            });
            sellBtn.container.position.set(220, 0);
            row.addChild(sellBtn.container);

            row.on('pointertap', () => this._selectGood(good.id));

            return { good, row, bg, swatch, name, held, buyPrice, sellPrice, buyBtn, sellBtn };
        });

        const footer = new Text({
            text: 'TAP A ROW TO CHART IT',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif', fontSize: 8, letterSpacing: 1, fill: COLOR_SLATE_500,
            }),
        });
        footer.position.set(9, 0);
        market.addChild(footer);

        return {
            container: market,
            lotLabel,
            lotButtons,
            wallet,
            headGood,
            headHeld,
            headBuy,
            headSell,
            list,
            rows,
            footer,
        };
    }

    // ------------------------------------------------------------------
    // Left panel
    // ------------------------------------------------------------------

    /**
     * Mount the goods list in the hub's left panel and size it. Row height
     * is derived from the panel so all seven goods are always visible
     * without scrolling — the list is the tab's whole navigation.
     */
    _refreshSide() {
        const side = this._side;
        const m = this._nodes?.market;
        if (!side?.list || !m) return;
        if (m.container.parent !== side.list) side.list.addChild(m.container);
        m.container.visible = true;

        const innerW = this._sideW - 24;
        const rowsTop = 40;
        const footerH = 16;
        const avail = Math.max(
            MARKET_GOODS.length * ROW_H_MIN,
            this._sideH - SIDE_LIST_TOP - rowsTop - footerH - 8,
        );
        this._rowH = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, Math.floor(avail / MARKET_GOODS.length)));
        const rowH = this._rowH;

        m.wallet.position.set(innerW, 5);
        m.headHeld.position.set(Math.min(100, innerW * 0.40), 26);
        m.headBuy.position.set(Math.min(142, innerW * 0.57), 26);
        m.headSell.position.set(Math.min(182, innerW * 0.73), 26);

        const heldX = Math.min(100, Math.round(innerW * 0.40));
        const buyX = Math.min(142, Math.round(innerW * 0.57));
        const sellX = Math.min(182, Math.round(innerW * 0.73));
        const btnW = Math.max(28, Math.min(BUTTON_W, Math.floor((innerW - sellX - 6) / 2)));
        const buyBtnX = sellX + 4;
        const sellBtnX = innerW - btnW;

        m.rows.forEach(({ row, bg, swatch, name, held, buyPrice, sellPrice, buyBtn, sellBtn, good }, i) => {
            row.position.set(0, i * rowH);
            row.hitArea = new Rectangle(0, 0, innerW, rowH);

            const selected = good.id === this._selectedGood;
            bg.clear();
            bg.rect(0, 0, innerW, rowH - 2).fill({ color: selected ? 0x164e63 : 0x0f172a, alpha: selected ? 0.55 : 0.4 });
            bg.rect(0, 0, innerW, rowH - 2).stroke({ color: selected ? COLOR_CYAN_500 : GRID_LINE, width: 1, alpha: selected ? 0.85 : 0.45 });
            if (selected) bg.rect(0, 0, 3, rowH - 2).fill({ color: COLOR_CYAN_300, alpha: 0.95 });

            const midY = Math.round((rowH - 10) / 2);
            swatch.clear();
            swatch.rect(5, midY, 3, 10).fill({ color: GOOD_TINT[good.color] ?? COLOR_SLATE_200, alpha: 0.95 });
            name.position.set(12, Math.round((rowH - name.height) / 2));
            name.style.fill = selected ? COLOR_CYAN_300 : (GOOD_TINT[good.color] ?? COLOR_SLATE_200);

            held.position.set(heldX, Math.round((rowH - held.height) / 2));
            buyPrice.position.set(buyX, Math.round((rowH - buyPrice.height) / 2));
            sellPrice.position.set(sellX, Math.round((rowH - sellPrice.height) / 2));
            buyBtn.container.position.set(buyBtnX, Math.round((rowH - (BUTTON_H - 2)) / 2));
            sellBtn.container.position.set(sellBtnX, Math.round((rowH - (BUTTON_H - 2)) / 2));
            buyBtn.container.hitArea = new Rectangle(-2, -3, btnW + 4, BUTTON_H + 4);
            sellBtn.container.hitArea = new Rectangle(-2, -3, btnW + 4, BUTTON_H + 4);
        });

        m.footer.position.set(9, MARKET_GOODS.length * rowH + 4);
        m.footer.visible = this._sideH - SIDE_LIST_TOP > rowsTop + MARKET_GOODS.length * rowH + 20;
    }

    /** Chart a good without trading it. */
    _selectGood(goodId) {
        if (this._selectedGood === goodId) return;
        this._selectedGood = goodId;
        this._crosshair = null;
        this._refreshSide();
        this._refresh();
    }

    // ------------------------------------------------------------------
    // State reads
    // ------------------------------------------------------------------

    _effects() {
        return this.meta ? this.meta.getEffects() : null;
    }

    _held(goodId) {
        if (!this.meta) return 0;
        const key = balanceKeyFor(goodId);
        if (!key) return 0;
        if (key === 'minerals') return this.meta.getHubResource('minerals') || 0;
        return this.meta.getOre(key.slice(4)) || 0;
    }

    _setLot(amount) {
        this._lot = amount;
        this._refresh();
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    /**
     * Place an order. `tradeQuote` clamps the size to what is affordable
     * (buys) or in stock (sells) and prices it off today's table, so the
     * profile can never be pushed negative by a stale button.
     */
    _trade(goodId, side) {
        if (!this.meta) return;
        const report = marketReport({ effects: this._effects(), nowMs: Date.now() });
        const quote = tradeQuote({
            goodId,
            side,
            amount: this._lot,
            prices: report.prices,
            credits: this.meta.credits,
            held: this._held(goodId),
        });
        if (!quote.ok) {
            this._status = `ORDER REFUSED: ${String(quote.reason || 'unknown').toUpperCase()}`;
            this._refresh();
            return;
        }
        const applied = this.meta.applyTrade({
            goodId,
            side,
            amount: quote.amount,
            credits: quote.credits,
        });
        const good = MARKET_GOODS.find((g) => g.id === goodId);
        const label = (good?.label || goodId).toUpperCase();
        this._status = applied
            ? `${side === 'buy' ? 'BOUGHT' : 'SOLD'} ${quote.amount} ${label} \u00B7 ${quote.credits.toLocaleString('en-US')} CR`
            : `ORDER REFUSED: ${label} TRADE FAILED`;
        // A fill on an uncharted good is worth charting: show what moved.
        this._selectedGood = goodId;
        this._refreshSide();
        this._refresh();
    }

    /** Melt the whole ore hold into minerals in one order. */
    _refineAll() {
        if (!this.meta) return;
        const plan = refinePlan(this.meta.oreCounts(), this._effects());
        if (plan.minerals <= 0) {
            this._status = 'REFINERY IDLE: NO ORE TO MELT';
            this._refresh();
            return;
        }
        const minerals = this.meta.applyRefine(plan);
        const used = Object.values(plan.consumed).reduce((sum, n) => sum + n, 0);
        this._status = `REFINED ${used} ORE \u2192 ${minerals.toLocaleString('en-US')} MINERALS`;
        this._refresh();
    }

    // ------------------------------------------------------------------
    // Refresh
    // ------------------------------------------------------------------

    _refresh() {
        if (!this._nodes) return;
        const n = this._nodes;
        const m = n.market;
        const credits = this.meta?.credits ?? 0;
        const minerals = this.meta?.getHubResource('minerals') ?? 0;
        n.creditsValue.text = credits.toLocaleString('en-US');
        n.mineralsValue.text = minerals.toLocaleString('en-US');

        m.lotButtons.forEach(({ amount, btn }) => {
            const active = amount === this._lot;
            btn.container.alpha = active ? 1 : 0.55;
            if (typeof btn.setAccent === 'function') btn.setAccent(active ? 'amber' : 'cyan');
        });
        m.wallet.text = `${credits.toLocaleString('en-US')} CR`;

        const report = marketReport({ effects: this._effects(), nowMs: Date.now() });
        this._lastReport = report;
        n.headline.text = report.headline;
        n.statusText.text = this._status;

        // The chart series: derived, deterministic, and anchored so its
        // right edge is exactly the price the order buttons quote.
        const history = priceHistory({
            goodId: this._selectedGood,
            nowMs: Date.now(),
            effects: this._effects(),
            points: PRICE_HISTORY_POINTS,
        });
        this._history = history;

        m.rows.forEach(({ good, held, buyPrice, sellPrice, buyBtn, sellBtn }) => {
            const price = report.prices[good.id];
            const stock = this._held(good.id);
            held.text = stock.toLocaleString('en-US');
            buyPrice.text = price ? String(price.buy) : '--';
            sellPrice.text = price ? String(price.sell) : '--';

            const buyQuote = tradeQuote({ goodId: good.id, side: 'buy', amount: this._lot, prices: report.prices, credits });
            const sellQuote = tradeQuote({ goodId: good.id, side: 'sell', amount: this._lot, prices: report.prices, held: stock });
            buyBtn.container.alpha = buyQuote.ok ? 1 : 0.35;
            buyBtn.container.eventMode = buyQuote.ok ? 'static' : 'none';
            sellBtn.container.alpha = sellQuote.ok ? 1 : 0.35;
            sellBtn.container.eventMode = sellQuote.ok ? 'static' : 'none';
        });

        this._refreshChartHeader();

        // Refinery preview: what a full melt would return right now.
        const plan = refinePlan(this.meta?.oreCounts?.() ?? {}, this._effects());
        n.refineryYield.text = plan.minerals > 0
            ? `${plan.minerals.toLocaleString('en-US')} minerals from ${Object.values(plan.consumed).reduce((sum, x) => sum + x, 0)} ore`
            : 'No ore in the hold';
        n.refineBtn.container.alpha = plan.minerals > 0 ? 1 : 0.35;
        n.refineBtn.container.eventMode = plan.minerals > 0 ? 'static' : 'none';

        this._renderChart();
    }

    /** Chart header: what is plotted, at what price, and what an order costs. */
    _refreshChartHeader() {
        const n = this._nodes;
        const history = this._history;
        if (!history?.ok) return;

        const up = history.changePct >= 0;
        const tint = up ? COLOR_EMERALD_300 : COLOR_ROSE_300;
        n.goodName.text = history.label.toUpperCase();
        n.goodName.style.fill = GOOD_TINT[history.color] ?? COLOR_SLATE_200;
        n.lastPrice.text = `${history.last.mid.toFixed(2)} cr`;
        n.lastPrice.style.fill = tint;
        n.changeText.text = `${signedPct(history.changePct)} 24H  \u00B7  ${signedPct(history.dayChangePct)} vs close`;
        n.changeText.style.fill = tint;
        n.changeText.position.set(14 + n.lastPrice.width + 12, 28);
        n.rangeText.text = `H ${history.high.toFixed(2)}  \u00B7  L ${history.low.toFixed(2)}  \u00B7  BASE ${history.base}`;

        const prices = this._lastReport?.prices || {};
        const buyQuote = tradeQuote({
            goodId: history.goodId, side: 'buy', amount: this._lot, prices, credits: this.meta?.credits ?? 0,
        });
        const sellQuote = tradeQuote({
            goodId: history.goodId, side: 'sell', amount: this._lot, prices, held: this._held(history.goodId),
        });
        n.orderText.text = `LOT ${this._lot}  \u00B7  BUY ${buyQuote.ok ? buyQuote.credits : '--'} CR`
            + `  \u00B7  SELL ${sellQuote.ok ? sellQuote.credits : '--'} CR`;
    }

    /** Repaint only the headline — called once a second from tick(). */
    _refreshHeadline() {
        if (!this._nodes) return;
        const report = marketReport({ effects: this._effects(), nowMs: Date.now() });
        this._nodes.headline.text = report.headline;
    }

    // ------------------------------------------------------------------
    // Chart rendering
    // ------------------------------------------------------------------

    /**
     * Draw the grid, the series and the axes for the selected good. One
     * Graphics object holds all the geometry; the labels are pooled Text
     * nodes repositioned here, so a redraw allocates nothing.
     */
    _renderChart() {
        const n = this._nodes;
        const plot = this._plot;
        const history = this._history;
        if (!n || !plot || !history?.ok) return;

        const g = n.chartG;
        g.clear();
        const { x, y, w, h } = plot;
        if (w <= 0 || h <= 0) return;

        const pts = history.points;
        const span = Math.max(0.0001, history.high - history.low);
        const pad = span * 0.14;
        const min = history.low - pad;
        const max = history.high + pad;
        const px = (i) => x + (pts.length > 1 ? (i / (pts.length - 1)) * w : w / 2);
        const py = (mid) => y + h - ((mid - min) / (max - min)) * h;

        const up = history.changePct >= 0;
        const lineTint = up ? COLOR_EMERALD_300 : COLOR_ROSE_300;

        // --- Grid + price axis --------------------------------------
        for (let r = 0; r <= GRID_ROWS; r += 1) {
            const gy = y + (r / GRID_ROWS) * h;
            const value = max - (r / GRID_ROWS) * (max - min);
            g.moveTo(x, gy).lineTo(x + w, gy).stroke({ color: GRID_LINE, width: 1, alpha: r === GRID_ROWS ? 0.9 : 0.4 });
            const label = n.priceLabels[r];
            label.text = value.toFixed(2);
            label.position.set(x + w + 6, gy);
            label.visible = true;
        }

        // --- Time axis ----------------------------------------------
        for (let c = 0; c <= GRID_COLS; c += 1) {
            const i = Math.round((c / GRID_COLS) * (pts.length - 1));
            const gx = px(i);
            g.moveTo(gx, y).lineTo(gx, y + h).stroke({ color: GRID_LINE, width: 1, alpha: c === 0 || c === GRID_COLS ? 0.8 : 0.28 });
            const label = n.timeLabels[c];
            label.text = hourLabel(pts[i].tMs);
            label.position.set(gx, y + h + 6);
            label.visible = true;
        }

        // --- Area + line --------------------------------------------
        const area = [x, y + h];
        pts.forEach((p, i) => { area.push(px(i), py(p.mid)); });
        area.push(x + w, y + h);
        g.poly(area).fill({ color: lineTint, alpha: 0.12 });

        pts.forEach((p, i) => {
            if (i === 0) g.moveTo(px(i), py(p.mid));
            else g.lineTo(px(i), py(p.mid));
        });
        g.stroke({ color: lineTint, width: 2, alpha: 0.95 });

        // Drift steps: mark every UTC midnight crossing inside the window
        // so the player can see the daily re-price, not just the wobble.
        pts.forEach((p, i) => {
            if (i === 0 || p.dayKey === pts[i - 1].dayKey) return;
            const gx = px(i);
            g.moveTo(gx, y).lineTo(gx, y + h).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.55 });
        });

        // --- Last price tag -----------------------------------------
        const lastY = py(history.last.mid);
        g.moveTo(x, lastY).lineTo(x + w, lastY).stroke({ color: lineTint, width: 1, alpha: 0.5 });
        g.circle(px(pts.length - 1), lastY, 3).fill({ color: lineTint, alpha: 1 });
        const tagW = CHART_RIGHT - 8;
        g.rect(x + w + 2, lastY - 7, tagW, 14).fill({ color: lineTint, alpha: 0.92 });
        n.lastTag.text = history.last.mid.toFixed(2);
        n.lastTag.position.set(x + w + 5, lastY);
        n.lastTag.visible = true;

        // --- Crosshair ----------------------------------------------
        const cross = this._crosshair;
        const inside = cross && cross.x >= x && cross.x <= x + w && cross.y >= y && cross.y <= y + h;
        n.crossPrice.visible = !!inside;
        n.crossTime.visible = !!inside;
        if (inside) {
            const i = Math.max(0, Math.min(pts.length - 1, Math.round(((cross.x - x) / w) * (pts.length - 1))));
            const p = pts[i];
            const cx = px(i);
            const cy = py(p.mid);
            g.moveTo(cx, y).lineTo(cx, y + h).stroke({ color: COLOR_SLATE_400, width: 1, alpha: 0.6 });
            g.moveTo(x, cy).lineTo(x + w, cy).stroke({ color: COLOR_SLATE_400, width: 1, alpha: 0.6 });
            g.circle(cx, cy, 3.5).stroke({ color: COLOR_SLATE_200, width: 1.5, alpha: 0.95 });
            n.crossPrice.text = `${p.mid.toFixed(2)}  (B${p.buy}/S${p.sell})`;
            n.crossPrice.position.set(x + w + 4, Math.max(y + 6, Math.min(y + h - 6, cy)));
            n.crossTime.text = hourLabel(p.tMs);
            n.crossTime.position.set(Math.max(x + 14, Math.min(x + w - 14, cx)), y + h + 6);
        }
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    _layout(w, h) {
        if (!this._nodes) return;
        const n = this._nodes;
        this._lastW = w;
        this._lastH = h;

        n.title.position.set(16, 12);

        const pad = 8;
        const fullW = Math.max(280, w - pad * 2);
        const balY = 38;
        const balH = 48;
        n.balancesPanel.position.set(pad, balY);
        redrawHologramPanel(n.balancesPanel, fullW, balH, { accent: COLOR_CYAN_500 });
        n.headline.style.wordWrapWidth = Math.max(120, fullW - 284);
        n.headline.position.set(270, 8);

        // --- Chart takes everything the refinery and status do not need.
        const refineryH = 70;
        const newsH = 34;
        const chartY = balY + balH + 8;
        const chartH = Math.max(CHART_MIN_H, h - chartY - refineryH - newsH - 24);
        n.chartPanel.position.set(pad, chartY);
        redrawHologramPanel(n.chartPanel, fullW, chartH, { accent: COLOR_CYAN_500 });
        n.chartPanel.hitArea = new Rectangle(0, 0, fullW, chartH);
        n.rangeText.position.set(fullW - 14, 8);
        n.orderText.position.set(fullW - 14, 22);
        n.hint.position.set(CHART_LEFT, chartH - CHART_BOTTOM - 12);
        n.hint.visible = chartH > CHART_MIN_H + 40;

        this._plot = {
            x: CHART_LEFT,
            y: CHART_TOP,
            w: Math.max(40, fullW - CHART_LEFT - CHART_RIGHT),
            h: Math.max(40, chartH - CHART_TOP - CHART_BOTTOM),
        };

        // --- Refinery + status.
        const refineryY = chartY + chartH + 8;
        n.refineryPanel.position.set(pad, refineryY);
        redrawHologramPanel(n.refineryPanel, fullW, refineryH, { accent: 0x4a1d96 });
        n.refineryRatio.style.wordWrap = true;
        n.refineryRatio.style.wordWrapWidth = Math.max(160, fullW - 190);
        n.refineryYield.style.wordWrap = true;
        n.refineryYield.style.wordWrapWidth = Math.max(160, fullW - 190);
        n.refineBtn.container.position.set(fullW - 162, refineryH - 38);

        const newsY = refineryY + refineryH + 8;
        const newsPanelH = Math.max(28, h - newsY - pad);
        n.newsPanel.position.set(pad, newsY);
        redrawHologramPanel(n.newsPanel, fullW, newsPanelH, { accent: 0x334155 });
        n.statusText.style.wordWrapWidth = fullW - 24;
        n.statusText.position.set(12, Math.max(6, (newsPanelH - n.statusText.height) / 2));

        this._refresh();
    }
}
