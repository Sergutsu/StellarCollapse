// MarketTab -- interstellar resource exchange. Mounts into the hub's
// center panel when the user clicks the MARKET bottom-nav tab.
//
// Provides a simple two-way exchange: credits ↔ minerals.
// Ships cost minerals to build, crew cost credits to hire, so the
// market lets the player rebalance between the two currencies.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
    buildStartButton,
} from '../../pixi-ui-kit.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_EMERALD_300 = 0x6ee7b7;
const COLOR_ROSE_300 = 0xfda4af;
const COLOR_PURPLE_300 = 0xc4b5fd;

// Exchange rates: credits per mineral unit.
const BUY_RATE = 5;   // Buy 1 mineral for 5 credits.
const SELL_RATE = 3;   // Sell 1 mineral for 3 credits.

// Preset amounts for quick trades.
const TRADE_AMOUNTS = [10, 50, 100, 500];

export class MarketTab {
    constructor({ parent, meta }) {
        if (!parent) throw new Error('MarketTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
    }

    get visible() { return !!this.root.visible; }

    show() {
        if (!this._nodes) this._build();
        this._refresh();
        this.root.visible = true;
    }

    hide() { this.root.visible = false; }

    layout(screen) {
        if (!this._nodes || !screen) return;
        const w = screen.width || 0;
        const h = screen.height || 0;
        if (w <= 0 || h <= 0) return;
        this._layout(w, h);
    }

    destroy() {
        if (this.root) {
            this.root.destroy({ children: true });
            this.root = null;
        }
        this._nodes = null;
    }

    _build() {
        const title = panelLabel('MARKET: INTERSTELLAR EXCHANGE', COLOR_AMBER_300, { size: 14, weight: '800' });
        title.style.letterSpacing = 2;
        title.position.set(16, 12);
        this.root.addChild(title);

        // Balances panel.
        const balancesPanel = drawHologramPanel(460, 60, { accent: COLOR_CYAN_500 });
        this.root.addChild(balancesPanel);

        const creditsLabel = panelLabel('CREDITS:', COLOR_EMERALD_300, { size: 12, weight: '700' });
        creditsLabel.position.set(16, 10);
        balancesPanel.addChild(creditsLabel);

        const creditsValue = panelLabel('0', COLOR_SLATE_200, { size: 16, weight: '800' });
        creditsValue.position.set(16, 28);
        balancesPanel.addChild(creditsValue);

        const mineralsLabel = panelLabel('MINERALS:', COLOR_PURPLE_300, { size: 12, weight: '700' });
        mineralsLabel.position.set(230, 10);
        balancesPanel.addChild(mineralsLabel);

        const mineralsValue = panelLabel('0', COLOR_SLATE_200, { size: 16, weight: '800' });
        mineralsValue.position.set(230, 28);
        balancesPanel.addChild(mineralsValue);

        // BUY minerals panel (credits -> minerals).
        const buyPanel = drawHologramPanel(220, 260, { accent: 0x14532d });
        this.root.addChild(buyPanel);

        const buyTitle = panelLabel('BUY MINERALS', COLOR_EMERALD_300, { size: 12, weight: '800' });
        buyTitle.position.set(12, 10);
        buyPanel.addChild(buyTitle);

        const buyRate = panelLabel(`Rate: ${BUY_RATE} credits per mineral`, COLOR_SLATE_400, { size: 10 });
        buyRate.position.set(12, 30);
        buyPanel.addChild(buyRate);

        const buyButtons = TRADE_AMOUNTS.map((amount, i) => {
            const cost = amount * BUY_RATE;
            const btn = buildSimpleButton({
                text: `${amount}`,
                width: 80,
                height: 28,
                accent: 'green',
                onTap: () => this._buyMinerals(amount),
            });
            buyPanel.addChild(btn.container);

            const costLabel = panelLabel(`${cost} cr`, COLOR_SLATE_400, { size: 9 });
            buyPanel.addChild(costLabel);

            return { btn, costLabel, amount };
        });

        // SELL minerals panel (minerals -> credits).
        const sellPanel = drawHologramPanel(220, 260, { accent: 0x4a1d96 });
        this.root.addChild(sellPanel);

        const sellTitle = panelLabel('SELL MINERALS', COLOR_PURPLE_300, { size: 12, weight: '800' });
        sellTitle.position.set(12, 10);
        sellPanel.addChild(sellTitle);

        const sellRate = panelLabel(`Rate: ${SELL_RATE} credits per mineral`, COLOR_SLATE_400, { size: 10 });
        sellRate.position.set(12, 30);
        sellPanel.addChild(sellRate);

        const sellButtons = TRADE_AMOUNTS.map((amount, i) => {
            const gain = amount * SELL_RATE;
            const btn = buildSimpleButton({
                text: `${amount}`,
                width: 80,
                height: 28,
                accent: 'magenta',
                onTap: () => this._sellMinerals(amount),
            });
            sellPanel.addChild(btn.container);

            const gainLabel = panelLabel(`${gain} cr`, COLOR_SLATE_400, { size: 9 });
            sellPanel.addChild(gainLabel);

            return { btn, gainLabel, amount };
        });

        // Market news ticker.
        const newsPanel = drawHologramPanel(460, 50, { accent: 0x334155 });
        this.root.addChild(newsPanel);

        const newsLabel = panelLabel('MARKET NEWS', COLOR_SLATE_400, { size: 10, weight: '700' });
        newsLabel.position.set(12, 8);
        newsPanel.addChild(newsLabel);

        const newsText = panelLabel('Exchange rates are stable. Trade wisely, Commander.', COLOR_SLATE_200, { size: 10 });
        newsText.position.set(12, 26);
        newsPanel.addChild(newsText);

        this._nodes = {
            title,
            balancesPanel, creditsLabel, creditsValue, mineralsLabel, mineralsValue,
            buyPanel, buyTitle, buyRate, buyButtons,
            sellPanel, sellTitle, sellRate, sellButtons,
            newsPanel, newsLabel, newsText,
        };
    }

    _refresh() {
        if (!this._nodes) return;
        const n = this._nodes;
        const credits = this.meta?.credits ?? 0;
        const minerals = this.meta?.getHubResource('minerals') ?? 0;

        n.creditsValue.text = credits.toLocaleString('en-US');
        n.mineralsValue.text = minerals.toLocaleString('en-US');

        // Update button affordance.
        n.buyButtons.forEach((b) => {
            const cost = b.amount * BUY_RATE;
            const canBuy = credits >= cost;
            b.btn.container.alpha = canBuy ? 1 : 0.4;
            b.btn.container.eventMode = canBuy ? 'static' : 'none';
        });

        n.sellButtons.forEach((b) => {
            const canSell = minerals >= b.amount;
            b.btn.container.alpha = canSell ? 1 : 0.4;
            b.btn.container.eventMode = canSell ? 'static' : 'none';
        });
    }

    _buyMinerals(amount) {
        if (!this.meta) return;
        const cost = amount * BUY_RATE;
        if (this.meta.credits < cost) return;
        this.meta.addCredits(-cost);
        this.meta.setHubResource('minerals', (this.meta.getHubResource('minerals') || 0) + amount);
        this._refresh();
    }

    _sellMinerals(amount) {
        if (!this.meta) return;
        const minerals = this.meta.getHubResource('minerals') || 0;
        if (minerals < amount) return;
        this.meta.setHubResource('minerals', minerals - amount);
        this.meta.addCredits(amount * SELL_RATE);
        this._refresh();
    }

    _layout(w, h) {
        if (!this._nodes) return;
        const n = this._nodes;

        n.title.position.set(16, 12);

        // Balances panel spans top.
        const balW = Math.min(w - 16, 500);
        n.balancesPanel.position.set(8, 38);
        redrawHologramPanel(n.balancesPanel, balW, 60, { accent: COLOR_CYAN_500 });
        n.mineralsLabel.position.set(Math.floor(balW * 0.5), 10);
        n.mineralsValue.position.set(Math.floor(balW * 0.5), 28);

        // Buy/sell panels side by side.
        const panelW = Math.floor((balW - 16) / 2);
        const panelY = 110;
        const panelH = Math.max(200, h - panelY - 70);

        n.buyPanel.position.set(8, panelY);
        redrawHologramPanel(n.buyPanel, panelW, panelH, { accent: 0x14532d });

        n.sellPanel.position.set(8 + panelW + 16, panelY);
        redrawHologramPanel(n.sellPanel, panelW, panelH, { accent: 0x4a1d96 });

        // Position buy buttons in a 2×2 grid.
        const btnColW = Math.floor((panelW - 36) / 2);
        n.buyButtons.forEach((b, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            b.btn.container.position.set(12 + col * (btnColW + 12), 52 + row * 60);
            b.costLabel.position.set(12 + col * (btnColW + 12), 82 + row * 60);
        });

        n.sellButtons.forEach((b, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            b.btn.container.position.set(12 + col * (btnColW + 12), 52 + row * 60);
            b.gainLabel.position.set(12 + col * (btnColW + 12), 82 + row * 60);
        });

        // News panel at bottom.
        const newsY = panelY + panelH + 8;
        n.newsPanel.position.set(8, newsY);
        redrawHologramPanel(n.newsPanel, balW, Math.max(40, h - newsY - 8), { accent: 0x334155 });
    }
}
