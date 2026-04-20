// Hub ("Chief Dispatcher HQ") scene. Owns the viewport-filling main
// menu: top resource bar, GALACTIC NEWS ticker, ACTIVE MISSIONS left
// column, galactic-map center panel, FLEET & CREW right column, 6-tab
// bottom nav, and the MISSION BOARD modal overlay. Dependencies
// (Pixi app, uiRoot, MetaState, panel + button helpers) are injected
// via constructor so the scene does not import from pixi-view (no
// circular imports).
//
// Contract (used by SceneManager + PixiView):
//   hub.show()              -- makes the root visible, lazy-builds on
//                              first call
//   hub.hide()              -- hides the root (does NOT destroy)
//   hub.layout(screen)      -- re-runs layout for the current viewport
//   hub.tick(deltaMs)       -- drives the news-ticker scroll
//   hub.destroy()           -- tears down all Pixi nodes
//   hub.setStartGameCallback(fn)
//                           -- PixiView.onStartGame(fn) forwards here
//   hub.visible             -- read-only; scene manager contract
//
// See docs/adr/0009-scene-graph-extraction.md.

import {
    Container,
    FillGradient,
    Graphics,
    Rectangle,
    Text,
    TextStyle,
} from 'pixi.js';

import {
    GAME_MODES,
    PIECE_COMPLEXITY,
} from '../constants.js';

import { buildMissions, pickMissionBoard, ORES } from '../missions.js';

// Panel background + accent tints mirror the ones in pixi-view.js.
// Duplicated here so the hub scene stays self-contained; a later PR
// will promote them to a shared ui-kit module once 2+ scenes want
// them.
const PANEL_BG_TOP = 0x0b1b3a;
const PANEL_BG_BOT = 0x050a1c;

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_WHITE = 0xffffff;

// Hub shell layout constants. The hub fills the viewport: top bar +
// news ticker + 3 columns + bottom nav + a mission-board modal
// overlay. All numbers here are target pixel sizes at 1:1 viewport;
// layout() repositions on resize.
const HUB_TOPBAR_H = 72;
const HUB_NEWS_H = 28;
const HUB_NAV_H = 56;
const HUB_COL_W = 276;
const HUB_GUTTER = 14;
const HUB_MIN_CENTER_W = 460;

// Galactic News ticker pool. Static flavor strings for now; runtime
// mission-complete / ship-damaged / anomaly events wire in from P4.
const HUB_NEWS_POOL = Object.freeze([
    'Omega-4 Belt reports heightened pirate chatter. Escorts recommended.',
    'Xeno-archeology guild posts bounty on Verdanite-rich ruins.',
    'Trade Route Defense contracts paying +15% this quarter.',
    'Black-hole anomaly detected at Event Horizon Shadow. Research teams invited.',
    'Seismic Rift survey crews report hazard pay doubled after last week\'s collapse.',
    'Voidwreck Field salvage rights auctioned; registered dispatchers only.',
    'Kuiper Fringe relics recovered from Dig-47 fetch record bids at market.',
    'Terminus Core Protocol advisory: escort clearance required.',
]);

// Hub bottom-nav tabs. Only MISSIONS is active; the rest render a
// locked stub panel. `lockRep` is a placeholder gate until rep lands.
const HUB_TABS = Object.freeze([
    { id: 'star-map',   label: 'STAR MAP',      locked: true,  lockRep: 2 },
    { id: 'missions',   label: 'MISSIONS',      locked: false },
    { id: 'build',      label: 'BUILD/UPGRADE', locked: true,  lockRep: 3 },
    { id: 'research',   label: 'RESEARCH',      locked: true,  lockRep: 4 },
    { id: 'crew',       label: 'CREW',          locked: true,  lockRep: 3 },
    { id: 'market',     label: 'MARKET',        locked: true,  lockRep: 2 },
]);

// Resource strip metadata. Numeric values come from MetaState at
// render time. `metaId` is the MetaState key; `format` is the
// display format.
const HUB_RESOURCES = Object.freeze([
    { id: 'o2',   metaId: 'o2',       label: 'O\u2082',   format: 'percent', color: 0x67e8f9 },
    { id: 'fuel', metaId: 'fuel',     label: 'Fuel',      format: 'int',     color: 0xfcd34d },
    { id: 'mins', metaId: 'minerals', label: 'Minerals',  format: 'kilo',    color: 0xc4b5fd },
    { id: 'cred', metaId: 'credits',  label: 'Credits',   format: 'comma',   color: 0x86efac },
    { id: 'warp', metaId: 'warp',     label: 'Warp',      format: 'int',     color: 0xf9a8d4 },
]);

// Format a numeric MetaState value for the top-bar chip.
function formatHubResourceValue(value, format) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    switch (format) {
        case 'percent': return `${Math.round(value)}%`;
        case 'kilo':    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
        case 'comma':   return value.toLocaleString('en-US');
        case 'int':
        default:        return String(Math.round(value));
    }
}

// Risk -> label/color mapping on mission-board cards.
const HUB_RISK_PRESETS = Object.freeze({
    1: { label: 'LOW',      color: 0x86efac },
    2: { label: 'MODERATE', color: 0xfde047 },
    3: { label: 'ELEVATED', color: 0xfbbf24 },
    4: { label: 'HIGH',     color: 0xfb923c },
    5: { label: 'CRITICAL', color: 0xf87171 },
});

// Tile palette subset used for ore preview dots on mission cards.
// Mirrors the palette in pixi-view.js; duplicated so the hub scene
// does not import from the render root.
const CELL_PALETTE = {
    red:    { glow: 0xff4400 },
    blue:   { glow: 0x4488ff },
    green:  { glow: 0x44ff66 },
    yellow: { glow: 0xffdd00 },
    bomb:   { glow: 0xff0000 },
    snake:  { glow: 0x00ff64 },
};

export class HubScene {
    constructor({
        app,
        uiRoot,
        meta = null,
        drawHologramPanel,
        redrawHologramPanel,
        buildStartButton,
        panelLabel,
        drawStarShape,
    }) {
        this.app = app;
        this.uiRoot = uiRoot;
        this.meta = meta;
        this._drawPanel = drawHologramPanel;
        this._redrawPanel = redrawHologramPanel;
        this._makeStartButton = buildStartButton;
        this._panelLabel = panelLabel;
        this._drawStarShape = drawStarShape;

        this._onStartGame = null;
        this._metaChipSyncBound = false;

        // Deterministic per-boot mission catalog so asteroid names on
        // cards don't shuffle every time the player re-opens the menu.
        this._missions = buildMissions({ seed: Math.floor(Math.random() * 0xffffffff) });

        // Mirrors whichever mission is currently selected. HUD tier
        // color + size multiplier readouts read this via getStartState.
        this._startState = {
            mode: this._missions[0].gameConfig.mode,
            complexity: this._missions[0].gameConfig.complexity,
            fieldSizeId: this._missions[0].gameConfig.fieldSizeId,
            selectedMissionId: this._missions[0].id,
        };

        this._hubBoardSeed = 0;
        this._nodes = null;
    }

    // ----------------------------------------------------------------
    // Scene manager contract
    // ----------------------------------------------------------------

    get visible() {
        return !!(this._nodes && this._nodes.root.visible);
    }

    show() {
        if (!this._nodes) this._build();
        this._nodes.root.visible = true;
    }

    hide() {
        if (this._nodes) this._nodes.root.visible = false;
    }

    layout(screen) {
        if (!this._nodes || !screen) return;
        this._layoutShell(screen.width, screen.height);
    }

    tick(deltaMs) {
        const n = this._nodes;
        if (!n || !n.root.visible) return;
        const news = n.news;
        if (!news) return;
        const speedPxPerMs = 0.06;
        news.offset -= speedPxPerMs * deltaMs;
        const bodyW = news.body.width || 0;
        const bandW = news.__bandWidth || 0;
        if (bodyW > 0 && bandW > 0 && news.offset < -bodyW) {
            news.offset = bandW;
        }
        news.body.x = Math.round(news.offset);
    }

    destroy() {
        if (this._nodes) {
            this._nodes.root.destroy({ children: true });
            this._nodes = null;
        }
    }

    // ----------------------------------------------------------------
    // Public hub API consumed by PixiView
    // ----------------------------------------------------------------

    setStartGameCallback(fn) {
        this._onStartGame = typeof fn === 'function' ? fn : null;
    }

    getStartState() {
        return this._startState;
    }

    getMissions() {
        return this._missions;
    }

    // ----------------------------------------------------------------
    // Build (lazy; first show() call wires the tree)
    // ----------------------------------------------------------------

    _build() {
        const root = new Container();
        root.eventMode = 'static';
        this.uiRoot.addChild(root);

        const topBar = this._buildTopBar();
        const news = this._buildNewsTicker();
        const leftCol = this._buildActiveMissions();
        const centerPanel = this._buildCenter();
        const rightCol = this._buildFleetCrew();
        const bottomNav = this._buildBottomNav();
        const modal = this._buildMissionBoardModal();

        root.addChild(topBar.container);
        root.addChild(news.container);
        root.addChild(leftCol.container);
        root.addChild(centerPanel.container);
        root.addChild(rightCol.container);
        root.addChild(bottomNav.container);
        root.addChild(modal.container);

        this._nodes = {
            root,
            topBar,
            news,
            leftCol,
            centerPanel,
            rightCol,
            bottomNav,
            modal,
            activeTabId: 'missions',
        };

        if (this.app) this._layoutShell(this.app.screen.width, this.app.screen.height);
        this._setActiveTab('missions');
    }

    _buildTopBar() {
        const container = new Container();
        container.eventMode = 'static';

        const bg = new Graphics();
        container.addChild(bg);

        const star = this._drawStarShape(14, 0xfacc15);
        container.addChild(star);

        const brandGradient = new FillGradient(0, 0, 320, 0);
        brandGradient.addColorStop(0, 0x22d3ee);
        brandGradient.addColorStop(0.5, 0xfacc15);
        brandGradient.addColorStop(1, 0xf87171);
        const brand = new Text({
            text: 'STELLAR VENTURE',
            style: new TextStyle({
                fontFamily: 'Inter, "Segoe UI", sans-serif',
                fontSize: 22,
                fontWeight: '800',
                letterSpacing: 3,
                fill: brandGradient,
                dropShadow: { color: 0xfacc15, alpha: 0.24, blur: 6, distance: 0, angle: 0 },
            }),
        });
        container.addChild(brand);

        const dispatcherBadge = new Text({
            text: `CHIEF DISPATCHER \u00B7 ${this._rollCallsign()}`,
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 1,
                fill: 0xfde68a,
            }),
        });
        container.addChild(dispatcherBadge);

        const chips = HUB_RESOURCES.map((r) => {
            const chip = this._buildResourceChip(r);
            chip.metaId = r.metaId;
            chip.format = r.format;
            return chip;
        });
        chips.forEach((chip) => container.addChild(chip.container));
        // Sync chip values with MetaState now, and re-sync whenever
        // MetaState emits `change` so reward grants surface in the top
        // bar without a full hub rebuild.
        this._syncResourceChips(chips);
        if (this.meta && !this._metaChipSyncBound) {
            this._metaChipSyncBound = true;
            this.meta.on('change', () => {
                if (this._nodes && this._nodes.topBar) {
                    this._syncResourceChips(this._nodes.topBar.chips);
                }
            });
        }

        const gear = new Text({
            text: '\u2699',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 20, fill: 0x93c5fd }),
        });
        gear.anchor.set(0.5);
        gear.eventMode = 'static';
        gear.cursor = 'pointer';
        container.addChild(gear);

        return { container, bg, star, brand, dispatcherBadge, chips, gear };
    }

    _syncResourceChips(chips) {
        if (!chips) return;
        for (const chip of chips) {
            const value = this.meta ? this.meta.getHubResource(chip.metaId) : null;
            chip.valueText.text = formatHubResourceValue(value, chip.format);
        }
    }

    _buildResourceChip({ label, color }) {
        const container = new Container();
        container.eventMode = 'static';

        const bg = new Graphics();
        container.addChild(bg);

        const labelText = new Text({
            text: label,
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 1,
                fill: color,
            }),
        });
        labelText.anchor.set(0, 0.5);
        container.addChild(labelText);

        const valueText = new Text({
            text: '-',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 14,
                fontWeight: '700',
                fill: 0xf8fafc,
            }),
        });
        valueText.anchor.set(0, 0.5);
        container.addChild(valueText);

        return { container, bg, labelText, valueText, color };
    }

    _buildNewsTicker() {
        const container = new Container();

        const bg = new Graphics();
        container.addChild(bg);

        const prefix = new Text({
            text: 'GALACTIC NEWS',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 2,
                fill: 0xfde047,
            }),
        });
        prefix.anchor.set(0, 0.5);
        container.addChild(prefix);

        // Scrolling text clips to a masked band so the hub edges stay
        // clean. The body string is pre-joined with a bullet separator
        // so the ticker reads as one long headline stream.
        const clipMask = new Graphics();
        container.addChild(clipMask);

        const scroller = new Container();
        scroller.mask = clipMask;
        container.addChild(scroller);

        const body = new Text({
            text: HUB_NEWS_POOL.join('   \u25C7   '),
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fill: 0xcbd5e1,
            }),
        });
        scroller.addChild(body);

        return { container, bg, prefix, clipMask, scroller, body, offset: 0 };
    }

    _buildActiveMissions() {
        const container = new Container();
        const panel = this._drawPanel(HUB_COL_W, 420);
        container.addChild(panel);

        const header = this._panelLabel('ACTIVE MISSIONS', COLOR_CYAN_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const counter = new Text({
            text: '0 / 2',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: 0x93c5fd }),
        });
        counter.anchor.set(1, 0);
        counter.position.set(HUB_COL_W - 14, 12);
        panel.addChild(counter);

        // Empty-state card. Renders in place of any running missions
        // until P4 wires idle ticking + real mission state.
        const empty = this._drawPanel(HUB_COL_W - 24, 108, { accent: 0x38bdf8 });
        empty.position.set(12, 40);
        panel.addChild(empty);

        const emptyTitle = new Text({
            text: 'No active missions',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xe2e8f0 }),
        });
        emptyTitle.position.set(14, 14);
        empty.addChild(emptyTitle);

        const emptyHint = new Text({
            text: 'Deploy from the MISSIONS tab to\nput a ship to work.',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fill: 0x94a3b8, wordWrap: true, wordWrapWidth: HUB_COL_W - 52 }),
        });
        emptyHint.position.set(14, 38);
        empty.addChild(emptyHint);

        return { container, panel, header, counter, empty, emptyTitle, emptyHint };
    }

    _buildCenter() {
        const container = new Container();

        const panel = this._drawPanel(600, 420);
        container.addChild(panel);

        const tabTitle = new Text({
            text: 'MISSION BOARD',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '800', letterSpacing: 2, fill: COLOR_CYAN_300 }),
        });
        tabTitle.position.set(16, 12);
        panel.addChild(tabTitle);

        // Galactic-map backdrop stub: a dim star-grid hint so the
        // center panel reads as "looking at a region of space" even
        // before the real map ships. The mission-board modal floats
        // on top when MISSIONS tab is active.
        const map = new Graphics();
        panel.addChild(map);

        const stub = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fill: 0x94a3b8,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: 480,
            }),
        });
        stub.anchor.set(0.5);
        panel.addChild(stub);

        const openBoardButton = this._makeStartButton({
            text: 'OPEN MISSION BOARD',
            width: 220,
            height: 38,
            onTap: () => this._openMissionBoard(),
        });
        panel.addChild(openBoardButton.container);

        return { container, panel, tabTitle, map, stub, openBoardButton };
    }

    _buildFleetCrew() {
        const container = new Container();
        const panel = this._drawPanel(HUB_COL_W, 420);
        container.addChild(panel);

        const header = this._panelLabel('FLEET & CREW', COLOR_CYAN_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const fleetLabel = new Text({
            text: 'FLEET',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 2, fill: 0x93c5fd }),
        });
        fleetLabel.position.set(14, 38);
        panel.addChild(fleetLabel);

        const fleet = this.meta ? this.meta.fleetSnapshot() : [];
        const crew  = this.meta ? this.meta.crewSnapshot()  : [];
        const fleetRows = fleet.map((ship, i) => {
            const row = this._buildFleetRow(ship, HUB_COL_W - 28);
            row.container.position.set(14, 56 + i * 46);
            panel.addChild(row.container);
            return row;
        });

        const crewLabel = new Text({
            text: 'CREW',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 2, fill: 0x93c5fd }),
        });
        crewLabel.position.set(14, 56 + fleet.length * 46 + 10);
        panel.addChild(crewLabel);

        const crewRows = crew.map((crewMember, i) => {
            const row = this._buildCrewRow(crewMember, HUB_COL_W - 28);
            row.container.position.set(14, 56 + fleet.length * 46 + 28 + i * 38);
            panel.addChild(row.container);
            return row;
        });

        return { container, panel, header, fleetLabel, fleetRows, crewLabel, crewRows };
    }

    _buildFleetRow(ship, w) {
        const container = new Container();

        const name = new Text({
            text: `${ship.name}`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: 0xe2e8f0 }),
        });
        name.position.set(0, 0);
        container.addChild(name);

        const klass = new Text({
            text: ship.className,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: 0x94a3b8 }),
        });
        klass.anchor.set(1, 0);
        klass.position.set(w, 2);
        container.addChild(klass);

        // Hull % bar + value.
        const barBg = new Graphics();
        barBg.roundRect(0, 22, w, 8, 4).fill({ color: 0x0f172a, alpha: 0.85 });
        container.addChild(barBg);

        const hullColor = ship.hull >= 75 ? 0x86efac : ship.hull >= 45 ? 0xfde047 : 0xf87171;
        const bar = new Graphics();
        bar.roundRect(0, 22, Math.max(2, (w) * (ship.hull / 100)), 8, 4).fill({ color: hullColor, alpha: 0.9 });
        container.addChild(bar);

        const hullText = new Text({
            text: `HULL ${ship.hull}%`,
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 10, fill: 0x93c5fd }),
        });
        hullText.position.set(0, 34);
        container.addChild(hullText);

        const status = new Text({
            text: ship.status.toUpperCase(),
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 1, fill: 0x86efac }),
        });
        status.anchor.set(1, 0);
        status.position.set(w, 34);
        container.addChild(status);

        return { container, name, klass, barBg, bar, hullText, status, hull: ship.hull };
    }

    _buildCrewRow(crew, w) {
        const container = new Container();
        const name = new Text({
            text: crew.name,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xe2e8f0 }),
        });
        container.addChild(name);

        const role = new Text({
            text: `${crew.role} \u00B7 Lv ${crew.level}`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: 0x94a3b8 }),
        });
        role.position.set(0, 16);
        container.addChild(role);

        const status = new Text({
            text: crew.status.toUpperCase(),
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 1,
                fill: crew.status === 'Available' ? 0x86efac : 0xfde047 }),
        });
        status.anchor.set(1, 0);
        status.position.set(w, 4);
        container.addChild(status);

        return { container, name, role, status };
    }

    _buildBottomNav() {
        const container = new Container();
        const bg = new Graphics();
        container.addChild(bg);

        const tabs = HUB_TABS.map((tab) => {
            const button = this._buildNavTab(tab);
            container.addChild(button.container);
            button.container.on('pointertap', () => this._setActiveTab(tab.id));
            return button;
        });

        return { container, bg, tabs };
    }

    _buildNavTab(tab) {
        const container = new Container();
        container.eventMode = 'static';
        container.cursor = tab.locked ? 'not-allowed' : 'pointer';

        const bg = new Graphics();
        container.addChild(bg);

        const label = new Text({
            text: tab.label,
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 12,
                fontWeight: '800',
                letterSpacing: 2,
                fill: tab.locked ? 0x64748b : 0xe2e8f0,
            }),
        });
        label.anchor.set(0.5);
        container.addChild(label);

        const sublabel = new Text({
            text: tab.locked ? `Unlocks at Rep Tier ${tab.lockRep ?? 2}` : '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 9,
                fill: 0x64748b,
            }),
        });
        sublabel.anchor.set(0.5);
        container.addChild(sublabel);

        return { container, bg, label, sublabel, tab };
    }

    _buildMissionBoardModal() {
        const container = new Container();
        container.eventMode = 'static';
        container.visible = false;

        // Dim overlay covers the whole viewport.
        const dim = new Graphics();
        dim.eventMode = 'static';
        dim.on('pointertap', () => this._closeMissionBoard());
        container.addChild(dim);

        const panel = this._drawPanel(640, 480, { accent: 0x22d3ee });
        container.addChild(panel);

        const title = new Text({
            text: 'MISSION BOARD',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 18,
                fontWeight: '800',
                letterSpacing: 3,
                fill: 0x67e8f9,
                dropShadow: { color: 0x67e8f9, alpha: 0.3, blur: 8, distance: 0, angle: 0 },
            }),
        });
        title.position.set(18, 14);
        panel.addChild(title);

        const subtitle = new Text({
            text: 'Select a contract to dispatch',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fill: 0x94a3b8 }),
        });
        subtitle.position.set(18, 42);
        panel.addChild(subtitle);

        // Roll the initial 2x2 subset. Seed from the session's
        // mission-name RNG so the visible board stays stable between
        // opens within one boot but still varies run-to-run.
        this._hubBoardSeed = Math.floor(Math.random() * 0xffffffff);
        const picks = pickMissionBoard(this._missions, { count: 4, seed: this._hubBoardSeed });

        const cardsContainer = new Container();
        cardsContainer.position.set(18, 70);
        panel.addChild(cardsContainer);

        const cardW = 290;
        const cardH = 180;
        const cardGap = 14;
        const cards = picks.map((m, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const card = this._buildNarrativeMissionCard(m, cardW, cardH);
            card.container.x = col * (cardW + cardGap);
            card.container.y = row * (cardH + cardGap);
            card.container.on('pointertap', () => this._onMissionCardTapped(m));
            cardsContainer.addChild(card.container);
            return card;
        });

        const rerollButton = this._makeStartButton({
            text: 'REROLL BOARD',
            width: 160,
            height: 34,
            onTap: () => this._rerollMissionBoard(),
        });
        panel.addChild(rerollButton.container);

        const closeButton = this._makeStartButton({
            text: 'CLOSE',
            width: 100,
            height: 34,
            onTap: () => this._closeMissionBoard(),
        });
        panel.addChild(closeButton.container);

        return { container, dim, panel, title, subtitle, cardsContainer, cards, rerollButton, closeButton };
    }

    _buildNarrativeMissionCard(mission, w, h) {
        const container = new Container();
        container.eventMode = 'static';
        container.cursor = 'pointer';

        // Card background with tier-color accent.
        const tierFill = parseInt((mission.tierColor || '#67e8f9').replace('#', ''), 16);
        const grad = new FillGradient(0, 0, 0, h);
        grad.addColorStop(0, PANEL_BG_TOP);
        grad.addColorStop(1, PANEL_BG_BOT);
        const bgFill = new Graphics();
        bgFill.roundRect(0, 0, w, h, 10).fill(grad);
        bgFill.alpha = 0.78;
        container.addChild(bgFill);

        const border = new Graphics();
        border.roundRect(0, 0, w, h, 10).stroke({ color: tierFill, width: 1, alpha: 0.55 });
        container.addChild(border);

        const accent = new Graphics();
        accent.rect(0, 0, w, 3).fill({ color: tierFill, alpha: 0.9 });
        container.addChild(accent);

        // Type tag (top-left) + sector name (top-right).
        const typeTag = new Text({
            text: mission.type.toUpperCase(),
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 2,
                fill: tierFill,
            }),
        });
        typeTag.position.set(12, 12);
        container.addChild(typeTag);

        const sector = new Text({
            text: mission.sector,
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 10,
                fill: 0x93c5fd,
            }),
        });
        sector.anchor.set(1, 0);
        sector.position.set(w - 12, 12);
        container.addChild(sector);

        // Narrative name.
        const name = new Text({
            text: mission.narrativeName,
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 15,
                fontWeight: '800',
                fill: 0xf8fafc,
                wordWrap: true,
                wordWrapWidth: w - 24,
            }),
        });
        name.position.set(12, 30);
        container.addChild(name);

        // Risk + ETA + credits row.
        const risk = HUB_RISK_PRESETS[mission.risk] || HUB_RISK_PRESETS[3];
        const riskText = new Text({
            text: `RISK ${mission.risk} \u00B7 ${risk.label}`,
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 1,
                fill: risk.color,
            }),
        });
        riskText.position.set(12, h - 86);
        container.addChild(riskText);

        const etaText = new Text({
            text: `ETA ${mission.etaLabel}`,
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: 0xcbd5e1 }),
        });
        etaText.anchor.set(1, 0);
        etaText.position.set(w - 12, h - 86);
        container.addChild(etaText);

        // Ore preview dots.
        const oreRow = new Container();
        oreRow.position.set(12, h - 62);
        container.addChild(oreRow);
        mission.expectedOres.forEach((oreId, i) => {
            const ore = ORES.find((o) => o.id === oreId);
            if (!ore) return;
            const pal = CELL_PALETTE[ore.color];
            if (!pal) return;
            const dot = new Graphics();
            dot.circle(0, 0, ore.rarity === 'rare' ? 5 : 4.5)
                .fill({ color: pal.glow, alpha: ore.rarity === 'rare' ? 1 : 0.9 });
            dot.x = i * 13 + 6;
            dot.y = 6;
            oreRow.addChild(dot);
        });

        const reward = new Text({
            text: `+${mission.baseCredits} CR`,
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 13,
                fontWeight: '700',
                fill: 0xfde047,
            }),
        });
        reward.anchor.set(1, 0.5);
        reward.position.set(w - 12, h - 56);
        container.addChild(reward);

        // ACCEPT button spans the card's bottom edge.
        const accept = this._makeStartButton({
            text: 'ACCEPT',
            width: w - 24,
            height: 30,
            fill: 0x14532d,
            hoverFill: 0x166534,
        });
        accept.container.position.set(12, h - 40);
        container.addChild(accept.container);

        // Hover state: brighten border. Click forwards through the
        // parent card's pointertap (set by the caller).
        const redraw = (hovered) => {
            border.clear();
            border.roundRect(0, 0, w, h, 10).stroke({ color: tierFill, width: hovered ? 2 : 1, alpha: hovered ? 0.95 : 0.55 });
            bgFill.alpha = hovered ? 0.9 : 0.78;
        };
        container.on('pointerover', () => redraw(true));
        container.on('pointerout', () => redraw(false));

        return { container, border, bgFill, accept, missionId: mission.id };
    }

    _rerollMissionBoard() {
        // Bump seed so pickMissionBoard returns a different subset,
        // then rebuild the card container in place. Cheap enough to
        // dispose and recreate; the hub doesn't hit this on a hot
        // path.
        this._hubBoardSeed = (this._hubBoardSeed + 0x9E3779B9) >>> 0;
        const modal = this._nodes?.modal;
        if (!modal) return;
        modal.cardsContainer.removeChildren();
        const picks = pickMissionBoard(this._missions, { count: 4, seed: this._hubBoardSeed });
        const cardW = 290;
        const cardH = 180;
        const cardGap = 14;
        modal.cards = picks.map((m, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const card = this._buildNarrativeMissionCard(m, cardW, cardH);
            card.container.x = col * (cardW + cardGap);
            card.container.y = row * (cardH + cardGap);
            card.container.on('pointertap', () => this._onMissionCardTapped(m));
            modal.cardsContainer.addChild(card.container);
            return card;
        });
    }

    _openMissionBoard() {
        if (this._nodes?.modal) this._nodes.modal.container.visible = true;
    }

    _closeMissionBoard() {
        if (this._nodes?.modal) this._nodes.modal.container.visible = false;
    }

    // Repaints only the bottom-nav highlights at their current size.
    // Safe to call on every resize/layout pass: it does NOT touch the
    // center panel contents or modal visibility, so a user-dismissed
    // modal stays dismissed across window resizes.
    _redrawTabHighlights(tabId) {
        const n = this._nodes;
        if (!n) return;
        n.bottomNav.tabs.forEach((t) => {
            const isActive = t.tab.id === tabId;
            const w = t.container.__width || 0;
            const h = t.container.__height || 0;
            t.bg.clear();
            if (isActive) {
                t.bg.roundRect(0, 0, w, h, 6).fill({ color: 0x0e7490, alpha: 0.55 });
                t.bg.roundRect(0, 0, w, h, 6).stroke({ color: 0x22d3ee, width: 2, alpha: 0.95 });
            } else {
                t.bg.roundRect(0, 0, w, h, 6).fill({ color: 0x0f172a, alpha: 0.6 });
                t.bg.roundRect(0, 0, w, h, 6).stroke({ color: 0x38bdf8, width: 1, alpha: 0.25 });
            }
        });
    }

    // Full tab-switch: updates active id, redraws highlights, swaps
    // center panel content, and opens/closes the MISSION BOARD modal.
    // Only call on explicit user-driven tab clicks or at initial build.
    _setActiveTab(tabId) {
        const n = this._nodes;
        if (!n) return;
        n.activeTabId = tabId;
        this._redrawTabHighlights(tabId);
        // Center panel contents change per tab. MISSIONS opens the
        // modal; every other tab shows a locked-stub hint.
        const c = n.centerPanel;
        const activeTab = HUB_TABS.find((t) => t.id === tabId) || HUB_TABS[1];
        if (tabId === 'missions') {
            c.tabTitle.text = 'MISSIONS \u2014 MISSION BOARD';
            c.stub.text = '';
            c.openBoardButton.container.visible = true;
            this._openMissionBoard();
        } else {
            c.tabTitle.text = activeTab.label;
            c.stub.text = `${activeTab.label} \u2014 Unlocks at Rep Tier ${activeTab.lockRep ?? 2}.\nComing in a later phase.`;
            c.openBoardButton.container.visible = false;
            this._closeMissionBoard();
        }
    }

    _rollCallsign() {
        // 3-letter prefix + 3-digit suffix. Not persistent yet; just a
        // session-stable bit of flavor so the dispatcher badge doesn't
        // read like a test harness.
        const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const pick = () => letters[Math.floor(Math.random() * letters.length)];
        const num = 100 + Math.floor(Math.random() * 900);
        return `${pick()}${pick()}${pick()}-${num}`;
    }

    // Clicking a card: lock its config into _startState and fire the
    // start-game request. main.js listens and drives the GameState +
    // screen transition.
    _onMissionCardTapped(mission) {
        this._startState.mode = mission.gameConfig.mode;
        this._startState.complexity = mission.gameConfig.complexity;
        this._startState.fieldSizeId = mission.gameConfig.fieldSizeId;
        this._startState.selectedMissionId = mission.id;
        this._closeMissionBoard();
        if (typeof this._onStartGame === 'function') {
            this._onStartGame({
                mode: mission.gameConfig.mode,
                complexity: mission.gameConfig.complexity,
                fieldSizeId: mission.gameConfig.fieldSizeId,
                playerName: 'Chief Dispatcher',
                missionId: mission.id,
                tierId: mission.tierId,
                // Pass the full mission record so main.js can feed the
                // RunLedger without re-deriving it from the catalog.
                mission,
            });
        }
    }

    // ----------------------------------------------------------------
    // Layout (run on every viewport change)
    // ----------------------------------------------------------------

    _layoutShell(w, h) {
        const n = this._nodes;
        if (!n) return;

        // --- Top bar: full viewport width, fixed height.
        this._layoutTopBar(n.topBar, w);

        // --- News ticker: full viewport width, under top bar.
        this._layoutNewsTicker(n.news, w, HUB_TOPBAR_H);

        // --- Columns + center live in the middle band.
        const columnsY = HUB_TOPBAR_H + HUB_NEWS_H + HUB_GUTTER;
        const columnsH = Math.max(360, h - columnsY - HUB_NAV_H - HUB_GUTTER);
        const leftX = HUB_GUTTER;
        const rightX = Math.max(leftX + HUB_COL_W + HUB_GUTTER, w - HUB_COL_W - HUB_GUTTER);
        // Center gets whatever is left; clamp to a minimum so cards
        // don't overlap at narrow viewports.
        const centerX = leftX + HUB_COL_W + HUB_GUTTER;
        const centerW = Math.max(HUB_MIN_CENTER_W, rightX - centerX - HUB_GUTTER);

        this._layoutColumnPanel(n.leftCol, leftX, columnsY, HUB_COL_W, columnsH);
        this._layoutColumnPanel(n.rightCol, rightX, columnsY, HUB_COL_W, columnsH);
        this._layoutCenterPanel(n.centerPanel, centerX, columnsY, centerW, columnsH);

        // --- Bottom nav: full viewport width, pinned to bottom.
        this._layoutBottomNav(n.bottomNav, w, h - HUB_NAV_H, HUB_NAV_H);

        // --- Modal is centered on the viewport. Panel clamps to viewport.
        this._layoutModal(n.modal, w, h);
    }

    _layoutTopBar(topBar, w) {
        const h = HUB_TOPBAR_H;
        topBar.container.position.set(0, 0);
        topBar.bg.clear();
        topBar.bg.rect(0, 0, w, h).fill({ color: 0x020617, alpha: 0.9 });
        topBar.bg.rect(0, h - 1, w, 1).fill({ color: 0x0e7490, alpha: 0.55 });

        const starX = 20;
        topBar.star.position.set(starX, h / 2);
        topBar.brand.position.set(starX + 22, h / 2 - topBar.brand.height / 2);

        // Dispatcher badge sits just under the brand, left-aligned.
        topBar.dispatcherBadge.position.set(starX + 22, h / 2 + topBar.brand.height / 2 - 2);

        // Gear sits at the far right edge.
        topBar.gear.position.set(w - 24, h / 2);

        // Resource chips flex between the dispatcher badge and the gear.
        const chipCount = topBar.chips.length;
        const chipGap = 14;
        const chipW = 88;
        const stripW = chipCount * chipW + (chipCount - 1) * chipGap;
        const stripRight = w - 52;
        const stripLeft = stripRight - stripW;
        topBar.chips.forEach((chip, i) => {
            const cx = stripLeft + i * (chipW + chipGap);
            chip.container.position.set(cx, h / 2 - 18);
            chip.bg.clear();
            chip.bg.roundRect(0, 0, chipW, 36, 6).fill({ color: 0x0b1b3a, alpha: 0.75 });
            chip.bg.roundRect(0, 0, chipW, 36, 6).stroke({ color: chip.color, width: 1, alpha: 0.55 });
            chip.labelText.position.set(10, 10);
            chip.valueText.position.set(10, 22);
        });
    }

    _layoutNewsTicker(news, w, y) {
        const h = HUB_NEWS_H;
        news.container.position.set(0, y);
        news.bg.clear();
        news.bg.rect(0, 0, w, h).fill({ color: 0x0b1b3a, alpha: 0.7 });
        news.bg.rect(0, h - 1, w, 1).fill({ color: 0x38bdf8, alpha: 0.2 });

        news.prefix.position.set(14, h / 2);

        const prefixRight = 14 + news.prefix.width + 16;
        const bandWidth = Math.max(120, w - prefixRight - 14);
        news.clipMask.clear();
        news.clipMask.rect(prefixRight, 0, bandWidth, h).fill({ color: 0xffffff });

        news.scroller.position.set(prefixRight, h / 2 - news.body.height / 2);
        news.__bandWidth = bandWidth;
        if (typeof news.offset !== 'number' || news.offset > bandWidth) {
            news.offset = bandWidth;
        }
        news.body.x = Math.round(news.offset);
    }

    _layoutColumnPanel(col, x, y, w, h) {
        col.container.position.set(x, y);
        this._redrawPanel(col.panel, w, h);
        if (col.counter) col.counter.position.set(w - 14, 12);
        if (col.empty) {
            // Keep the sky-400 accent set by _buildActiveMissions;
            // re-using the default cyan here would mute the empty card
            // against the panel border.
            this._redrawPanel(col.empty, w - 24, 108, 0x38bdf8);
            col.empty.position.set(12, 40);
        }
        if (col.fleetRows) {
            const rowW = w - 28;
            col.fleetRows.forEach((row, i) => {
                row.container.position.set(14, 56 + i * 54);
                row.klass.position.set(rowW, 2);
                row.barBg.clear();
                row.barBg.roundRect(0, 22, rowW, 8, 4).fill({ color: 0x0f172a, alpha: 0.85 });
                row.bar.clear();
                const hull = typeof row.hull === 'number' ? row.hull : 0;
                const hullColor = hull >= 75 ? 0x86efac : hull >= 45 ? 0xfde047 : 0xf87171;
                row.bar.roundRect(0, 22, Math.max(2, rowW * (hull / 100)), 8, 4).fill({ color: hullColor, alpha: 0.9 });
                row.status.position.set(rowW, 34);
            });
            if (col.crewLabel) col.crewLabel.position.set(14, 56 + col.fleetRows.length * 54 + 10);
            if (col.crewRows) {
                col.crewRows.forEach((row, i) => {
                    row.container.position.set(14, 56 + col.fleetRows.length * 54 + 28 + i * 38);
                    row.status.position.set(rowW, 4);
                });
            }
        }
    }

    _layoutCenterPanel(center, x, y, w, h) {
        center.container.position.set(x, y);
        this._redrawPanel(center.panel, w, h);
        center.map.clear();
        // Faint dotted grid to evoke a star map.
        const gridStep = 40;
        for (let gx = gridStep; gx < w - 10; gx += gridStep) {
            for (let gy = 56; gy < h - 20; gy += gridStep) {
                center.map.circle(gx, gy, 1).fill({ color: 0x67e8f9, alpha: 0.25 });
            }
        }
        center.stub.position.set(w / 2, h / 2 + 10);
        center.stub.style.wordWrapWidth = w - 60;
        // Open-board button centered near the bottom of the center panel.
        const btnW = center.openBoardButton.width;
        center.openBoardButton.container.position.set((w - btnW) / 2, h - 64);
    }

    _layoutBottomNav(nav, w, y, h) {
        nav.container.position.set(0, y);
        nav.bg.clear();
        nav.bg.rect(0, 0, w, h).fill({ color: 0x020617, alpha: 0.9 });
        nav.bg.rect(0, 0, w, 1).fill({ color: 0x0e7490, alpha: 0.55 });

        const tabCount = nav.tabs.length;
        const pad = HUB_GUTTER;
        const totalInner = w - pad * 2;
        const gap = 10;
        const tabW = Math.floor((totalInner - gap * (tabCount - 1)) / tabCount);
        const tabH = h - 12;
        nav.tabs.forEach((t, i) => {
            const tx = pad + i * (tabW + gap);
            t.container.position.set(tx, 6);
            t.container.__width = tabW;
            t.container.__height = tabH;
            t.container.hitArea = new Rectangle(0, 0, tabW, tabH);
            t.label.position.set(tabW / 2, tabH / 2 - 8);
            t.sublabel.position.set(tabW / 2, tabH / 2 + 10);
        });
        // Re-apply the active-tab visual (depends on __width / __height).
        // Uses the highlight-only variant so a user-dismissed modal is
        // not forcibly reopened on every window resize.
        this._redrawTabHighlights(this._nodes?.activeTabId || 'missions');
    }

    _layoutModal(modal, w, h) {
        modal.dim.clear();
        modal.dim.rect(0, 0, w, h).fill({ color: 0x020617, alpha: 0.75 });
        modal.dim.hitArea = new Rectangle(0, 0, w, h);

        const panelW = Math.min(700, Math.max(520, w - 80));
        const panelH = Math.min(540, Math.max(420, h - 120));
        const px = Math.round((w - panelW) / 2);
        const py = Math.round((h - panelH) / 2);
        modal.panel.position.set(px, py);
        this._redrawPanel(modal.panel, panelW, panelH, 0x22d3ee);

        // Reroll + close buttons pinned to the bottom of the panel.
        const rerollW = modal.rerollButton.width;
        const closeW = modal.closeButton.width;
        const footerY = panelH - 44;
        modal.rerollButton.container.position.set(16, footerY);
        modal.closeButton.container.position.set(panelW - closeW - 16, footerY);
    }
}

// Re-export constants for tests + potential reuse.
export { HUB_TABS, HUB_RESOURCES, HUB_NEWS_POOL, HUB_RISK_PRESETS };
