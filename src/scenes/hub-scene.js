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

import { CELL_PALETTE } from './cell-palette.js';
import { colors } from '../theme/tokens.js';
import { createTab } from '../ui/Tab.js';
import {
    drawTechPanel,
    redrawTechPanel,
    drawTechChip,
    redrawTechChip,
    buildStartButton,
    buildSimpleButton,
    panelLabel,
    drawStarShape,
} from '../pixi-ui-kit.js';
import { StarMapTab } from './tabs/star-map-tab.js';
import { ResearchTab } from './tabs/research-tab.js';
import { BuildUpgradeTab } from './tabs/build-upgrade-tab.js';
import { CrewTab } from './tabs/crew-tab.js';
import { MarketTab } from './tabs/market-tab.js';

// Panel background + accent tints mirror the ones in pixi-view.js.
// Duplicated here so the hub scene stays self-contained; a later PR
// will promote them to a shared ui-kit module once 2+ scenes want
// them.
const PANEL_BG_TOP = colors.bg.panel;
const PANEL_BG_BOT = colors.bg.panelAlt;

const COLOR_CYAN_300 = colors.text.accent;
const COLOR_WHITE = colors.text.white;

// Hub shell layout constants. The hub fills the viewport: top bar +
// news ticker + 3 columns + bottom nav + a mission-board modal
// overlay. All numbers here are target pixel sizes at 1:1 viewport;
// layout() repositions on resize.
const HUB_TOPBAR_H = 72;
const HUB_NEWS_H = 28;
const HUB_NAV_H = 56;
const HUB_COL_W = 276;
const HUB_GUTTER = 14;
const HUB_SURFACE_INSET = HUB_GUTTER;
const HUB_SURFACE_INSET_Y = HUB_GUTTER;
const HUB_MIN_CENTER_W = 460;
const HUB_MIN_LAYOUT_W = HUB_COL_W * 2 + HUB_MIN_CENTER_W + HUB_GUTTER * 4;
const HUB_MIN_LAYOUT_H = 760;
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
    { id: 'star-map',   label: 'STAR MAP',      locked: false, colorKey: 'starMap' },
    { id: 'missions',   label: 'MISSIONS',      locked: false, colorKey: 'missions' },
    { id: 'build',      label: 'BUILD/UPGRADE', locked: false, colorKey: 'build' },
    { id: 'research',   label: 'RESEARCH',      locked: false, colorKey: 'research' },
    { id: 'crew',       label: 'CREW',          locked: false, colorKey: 'crew' },
    { id: 'market',     label: 'MARKET',        locked: false, colorKey: 'market' },
]);

// Resource strip metadata. Numeric values come from MetaState at
// render time. `metaId` is the MetaState key; `format` is the
// display format.
const HUB_RESOURCES = Object.freeze([
    { id: 'mins', metaId: 'minerals', label: 'Minerals',  format: 'kilo',    color: colors.misc.mineral },
    { id: 'cred', metaId: 'credits',  label: 'Credits',   format: 'comma',   color: colors.status.success },
    { id: 'warp', metaId: 'warp',     label: 'Warp',      format: 'int',     color: colors.misc.warp },
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

function formatDuration(totalSec) {
    const s = Math.max(0, Math.floor(totalSec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

// Risk -> label/color mapping on mission-board cards.
const HUB_RISK_PRESETS = Object.freeze({
    1: { label: 'LOW',      color: colors.status.success },
    2: { label: 'MODERATE', color: colors.status.warning },
    3: { label: 'ELEVATED', color: colors.status.elevated },
    4: { label: 'HIGH',     color: colors.status.high },
    5: { label: 'CRITICAL', color: colors.status.error },
});

const PLANNER_ROW_H = 30;
const PLANNER_ROW_GAP = 8;
const PLANNER_SECTION_GAP = 18;
const PLANNER_DISPATCH_BUTTON = Object.freeze({ width: 220, height: 46 });

// CELL_PALETTE (ore preview dots on mission cards) is shared across
// scenes via src/scenes/cell-palette.js.

export class HubScene {
    constructor({
        app,
        uiRoot,
        meta = null,
    }) {
        this.app = app;
        this.uiRoot = uiRoot;
        this.meta = meta;

        this._onStartGame = null;
        this._metaChipSyncBound = false;

        // Deterministic per-boot mission catalog so asteroid names on
        // cards don't shuffle every time the player re-opens the menu.
        this._missions = buildMissions({ seed: Math.floor(Math.random() * 0xffffffff) });
        this._idleMissions = [];
        this._idleMissionSeq = 1;
        this._selectedMissionDispatch = 'idle';
        this._selectedMissionTierId = this._missions[0]?.tierId || null;
        this._selectedShipId = null;
        this._selectedCrewId = null;
        this._lastIdleUiRefreshAt = 0;

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
        this._reconcileIdleMissionState();
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

        const now = Date.now();
        if (now - this._lastIdleUiRefreshAt >= 250) {
            this._lastIdleUiRefreshAt = now;
            this._refreshActiveIdleMissions();
        }
    }

    destroy() {
        if (this._nodes) {
            // Tear down any extracted tab scenes before the center
            // panel itself is destroyed so their own refs are cleared.
            const tabs = this._nodes.tabs;
            if (tabs) {
                Object.values(tabs).forEach((scene) => {
                    if (typeof scene.destroy === 'function') scene.destroy();
                });
            }
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

        // Hub-tab scenes (ADR-0010). Mutually-exclusive scenes hosted
        // inside the center panel's hologram surface. _setActiveTab
        // shows the right one and hides the others. STAR MAP,
        // BUILD/UPGRADE, and RESEARCH are extracted scenes; the
        // remaining tabs still render a locked stub.
        const starMapTab = new StarMapTab({ parent: centerPanel.panel });
        const buildTab = new BuildUpgradeTab({ parent: centerPanel.panel, meta: this.meta });
        const researchTab = new ResearchTab({ parent: centerPanel.panel });
        const crewTab = new CrewTab({ parent: centerPanel.panel, meta: this.meta });
        const marketTab = new MarketTab({ parent: centerPanel.panel, meta: this.meta });
        const tabs = { 'star-map': starMapTab, build: buildTab, research: researchTab, crew: crewTab, market: marketTab };

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
            tabs,
            activeTabId: 'missions',
        };

        if (this.app) this._layoutShell(this.app.screen.width, this.app.screen.height);
        this._setActiveTab('missions');
        this._refreshActiveIdleMissions();
    }

    _buildTopBar() {
        const container = new Container();
        container.eventMode = 'static';

        const frame = drawTechPanel(960, HUB_TOPBAR_H, { accent: 'cyan' });
        container.addChild(frame);

        const star = drawStarShape(14, colors.brand.gold);
        container.addChild(star);

        const brandGradient = new FillGradient(0, 0, 320, 0);
        brandGradient.addColorStop(0, colors.brand.cyan);
        brandGradient.addColorStop(0.5, colors.brand.gold);
        brandGradient.addColorStop(1, colors.status.error);
        const brand = new Text({
            text: 'STELLAR VENTURE',
            style: new TextStyle({
                fontFamily: 'Inter, "Segoe UI", sans-serif',
                fontSize: 22,
                fontWeight: '800',
                letterSpacing: 3,
                fill: brandGradient,
                dropShadow: { color: colors.brand.gold, alpha: 0.24, blur: 6, distance: 0, angle: 0 },
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
                fill: colors.brand.amber,
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
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 20, fill: colors.text.info }),
        });
        gear.anchor.set(0.5);
        gear.eventMode = 'static';
        gear.cursor = 'pointer';
        container.addChild(gear);

        return {
            container, frame, star, brand, dispatcherBadge, chips, gear,
        };
    }

    _syncResourceChips(chips) {
        if (!chips) return;
        for (const chip of chips) {
            const value = this.meta ? this.meta.getHubResource(chip.metaId) : null;
            chip.valueText.text = formatHubResourceValue(value, chip.format);
        }
    }

    _buildResourceChip({ label, color }) {
        const chipFrame = drawTechChip(88, 36, { accent: color });
        const { container, frame } = chipFrame;
        container.eventMode = 'static';

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
                fill: colors.text.primary,
            }),
        });
        valueText.anchor.set(0, 0.5);
        container.addChild(valueText);

        return { container, frame, labelText, valueText, color };
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
                fill: colors.status.warning,
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
                fill: colors.misc.pale,
            }),
        });
        scroller.addChild(body);

        return { container, bg, prefix, clipMask, scroller, body, offset: 0 };
    }

    _buildActiveMissions() {
        const container = new Container();
        const panel = drawTechPanel(HUB_COL_W, 420, { accent: 'amber' });
        container.addChild(panel);

        const header = panelLabel('IDLE FLEET MISSIONS', COLOR_CYAN_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const counter = new Text({
            text: '0 / 0',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: colors.text.info }),
        });
        counter.anchor.set(1, 0);
        counter.position.set(HUB_COL_W - 14, 12);
        panel.addChild(counter);

        const list = new Container();
        list.position.set(12, 40);
        panel.addChild(list);

        const empty = drawTechPanel(HUB_COL_W - 24, 108, { accent: 'cyan' });
        list.addChild(empty);

        const emptyTitle = new Text({
            text: 'No fleet dispatches',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: colors.text.secondary }),
        });
        emptyTitle.position.set(14, 14);
        empty.addChild(emptyTitle);

        const emptyHint = new Text({
            text: 'Open MISSIONS > IDLE FLEET and\ndispatch a ship + crew.',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fill: colors.text.muted, wordWrap: true, wordWrapWidth: HUB_COL_W - 52 }),
        });
        emptyHint.position.set(14, 38);
        empty.addChild(emptyHint);

        return {
            container, panel, panelAccent: 'amber', header, counter, list, empty, emptyTitle, emptyHint, rows: [],
        };
    }

    _buildCenter() {
        const container = new Container();

        const panel = drawTechPanel(600, 420, { accent: 'magenta' });
        container.addChild(panel);

        const tabTitle = new Text({
            text: 'MISSIONS',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '800', letterSpacing: 2, fill: COLOR_CYAN_300 }),
        });
        tabTitle.position.set(16, 12);
        panel.addChild(tabTitle);

        const planner = this._buildMissionPlannerPanel();
        panel.addChild(planner.container);

        return {
            container,
            panel,
            tabTitle,
            planner,
        };
    }

    _buildMissionPlannerPanel() {
        const container = new Container();
        const frame = drawTechPanel(560, 320, { accent: 'cyan' });
        container.addChild(frame);

        const subtitle = new Text({
            text: 'Pick ship, crew, mission, and dispatch mode.',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fill: colors.text.muted }),
        });
        subtitle.position.set(12, 12);
        frame.addChild(subtitle);

        const modeLabel = new Text({
            text: 'DISPATCH MODE',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 2, fill: colors.text.info }),
        });
        modeLabel.position.set(12, 34);
        frame.addChild(modeLabel);

        const modeIdle = buildSimpleButton({
            text: 'IDLE',
            width: 96,
            height: 28,
            accent: 'cyan',
            onTap: () => this._setDispatchMode('idle'),
        });
        frame.addChild(modeIdle.container);
        const modeManual = buildSimpleButton({
            text: 'MANUAL',
            width: 110,
            height: 28,
            accent: 'magenta',
            onTap: () => this._setDispatchMode('manual'),
        });
        frame.addChild(modeManual.container);

        const hint = new Text({
            text: 'Manual gameplay currently available for RESOURCE missions only.',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: colors.text.muted }),
        });
        hint.position.set(232, 40);
        frame.addChild(hint);

        const shipHeader = panelLabel('FREE SHIPS', COLOR_CYAN_300, { size: 11 });
        shipHeader.position.set(12, 78);
        frame.addChild(shipHeader);
        const shipList = new Container();
        frame.addChild(shipList);

        const crewHeader = panelLabel('FREE CREWS', COLOR_CYAN_300, { size: 11 });
        crewHeader.position.set(200, 78);
        frame.addChild(crewHeader);
        const crewList = new Container();
        frame.addChild(crewList);

        const missionHeader = panelLabel('MISSION TYPES', COLOR_CYAN_300, { size: 11 });
        missionHeader.position.set(388, 78);
        frame.addChild(missionHeader);
        const missionList = new Container();
        frame.addChild(missionList);

        const outcomeCard = drawTechPanel(536, 96, { accent: 'green' });
        frame.addChild(outcomeCard);
        const outcomeTitle = new Text({
            text: 'POSSIBLE OUTCOME',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '700', letterSpacing: 1, fill: colors.status.success }),
        });
        outcomeTitle.position.set(10, 8);
        outcomeCard.addChild(outcomeTitle);
        const outcomeBody = new Text({
            text: '',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fill: colors.misc.pale, wordWrap: true, wordWrapWidth: 518 }),
        });
        outcomeBody.position.set(10, 28);
        outcomeCard.addChild(outcomeBody);

        const capacityText = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: colors.text.info }),
        });
        frame.addChild(capacityText);

        const dispatch = buildStartButton({
            text: 'DISPATCH',
            width: PLANNER_DISPATCH_BUTTON.width,
            height: PLANNER_DISPATCH_BUTTON.height,
            onTap: () => this._dispatchSelectedMission(),
        });
        frame.addChild(dispatch.container);

        return {
            container,
            frame,
            modeIdle,
            modeManual,
            hint,
            shipHeader,
            crewHeader,
            missionHeader,
            shipList,
            crewList,
            missionList,
            outcomeCard,
            outcomeBody,
            capacityText,
            dispatch,
            shipRows: [],
            crewRows: [],
            missionRows: [],
        };
    }

    _buildFleetCrew() {
        const container = new Container();
        const panel = drawTechPanel(HUB_COL_W, 420, { accent: 'green' });
        container.addChild(panel);

        const header = panelLabel('FLEET & CREW', COLOR_CYAN_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const fleetLabel = new Text({
            text: 'FLEET',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 2, fill: colors.text.info }),
        });
        fleetLabel.position.set(14, 38);
        panel.addChild(fleetLabel);

        const fleet = this.meta ? this.meta.fleetSnapshot() : [];
        const crew  = this.meta ? this.meta.crewSnapshot()  : [];
        const fleetRows = fleet.map((ship, i) => {
            const row = this._buildFleetRow(ship, HUB_COL_W - 28);
            row.container.position.set(14, 56 + i * 48);
            panel.addChild(row.container);
            return row;
        });

        const crewLabel = new Text({
            text: 'CREW',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 2, fill: colors.text.info }),
        });
        crewLabel.position.set(14, 56 + fleet.length * 48 + 10);
        panel.addChild(crewLabel);

        const crewRows = crew.map((crewMember, i) => {
            const row = this._buildCrewRow(crewMember, HUB_COL_W - 28);
            row.container.position.set(14, 56 + fleet.length * 48 + 28 + i * 38);
            panel.addChild(row.container);
            return row;
        });

        return {
            container, panel, panelAccent: 'green', header, fleetLabel, fleetRows, crewLabel, crewRows,
        };
    }

    _buildFleetRow(ship, w) {
        const container = new Container();

        const name = new Text({
            text: `${ship.name}`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: colors.text.secondary }),
        });
        name.position.set(0, 0);
        container.addChild(name);

        const klass = new Text({
            text: ship.className,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: colors.text.muted }),
        });
        klass.anchor.set(1, 0);
        klass.position.set(w, 2);
        container.addChild(klass);

        // Hull % bar + value.
        const barBg = new Graphics();
        barBg.roundRect(0, 22, w, 8, 4).fill({ color: colors.bg.dark, alpha: 0.85 });
        container.addChild(barBg);

        const hullColor = ship.hull >= 75 ? colors.status.success : ship.hull >= 45 ? colors.status.warning : colors.status.error;
        const bar = new Graphics();
        bar.roundRect(0, 22, Math.max(2, (w) * (ship.hull / 100)), 8, 4).fill({ color: hullColor, alpha: 0.9 });
        container.addChild(bar);

        const hullText = new Text({
            text: `HULL ${ship.hull}%`,
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 10, fill: colors.text.info }),
        });
        hullText.position.set(0, 34);
        container.addChild(hullText);

        const status = new Text({
            text: ship.status.toUpperCase(),
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 1, fill: colors.status.success }),
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
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '700', fill: colors.text.secondary }),
        });
        container.addChild(name);

        const role = new Text({
            text: `${crew.role} \u00B7 Lv ${crew.level}`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: colors.text.muted }),
        });
        role.position.set(0, 16);
        container.addChild(role);

        const status = new Text({
            text: crew.status.toUpperCase(),
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700', letterSpacing: 1,
                fill: crew.status === 'Available' ? colors.status.success : colors.status.warning }),
        });
        status.anchor.set(1, 0);
        status.position.set(w, 4);
        container.addChild(status);

        return { container, name, role, status };
    }

    _buildBottomNav() {
        const container = new Container();
        const frame = drawTechPanel(960, HUB_NAV_H, { accent: 'cyan' });
        container.addChild(frame);

        const tabs = HUB_TABS.map((tab) => {
            const button = this._buildNavTab(tab);
            container.addChild(button.container);
            return button;
        });

        return { container, frame, tabs };
    }

    _buildNavTab(tab) {
        const dynamicWidth = Math.max(136, Math.round(56 + (tab.label.length * 9)));
        const button = createTab({
            label: tab.label,
            colorKey: tab.colorKey,
            locked: tab.locked,
            lockRep: tab.lockRep,
            width: dynamicWidth,
            height: 40,
            onTap: () => this._setActiveTab(tab.id),
        });
        return {
            container: button.container,
            control: button,
            label: button.label,
            sublabel: button.sublabel,
            tab,
        };
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

        const panel = drawTechPanel(640, 480, { accent: 'cyan' });
        container.addChild(panel);

        const title = new Text({
            text: 'MISSION BOARD',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 18,
                fontWeight: '800',
                letterSpacing: 3,
                fill: colors.text.accent,
                dropShadow: { color: colors.text.accent, alpha: 0.3, blur: 8, distance: 0, angle: 0 },
            }),
        });
        title.position.set(18, 14);
        panel.addChild(title);

        const subtitle = new Text({
            text: 'Select a contract to dispatch',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fill: colors.text.muted }),
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

        const rerollButton = buildStartButton({
            text: 'REROLL BOARD',
            width: 160,
            height: 34,
            onTap: () => this._rerollMissionBoard(),
        });
        panel.addChild(rerollButton.container);

        const closeButton = buildSimpleButton({
            text: 'CLOSE',
            width: 100,
            height: 34,
            accent: 'amber',
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
                fill: colors.text.info,
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
                fill: colors.text.primary,
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
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: colors.misc.pale }),
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
                fill: colors.status.warning,
            }),
        });
        reward.anchor.set(1, 0.5);
        reward.position.set(w - 12, h - 56);
        container.addChild(reward);

        // ACCEPT button spans the card's bottom edge.
        const accept = buildSimpleButton({
            text: 'ACCEPT',
            width: w - 24,
            height: 28,
            accent: 'green',
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
            t.control.setState(isActive ? 'active' : 'idle');
            t.label.style.fill = t.tab.locked ? (isActive ? colors.misc.cream : colors.text.muted) : (isActive ? colors.misc.frost : colors.text.secondary);
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
        // Center panel contents change per tab.
        //   MISSIONS  -> mission-board modal + open-board button.
        //   STAR MAP / BUILD / RESEARCH -> extracted tab scene.
        //   any other -> locked stub text (until that tab is extracted).
        const c = n.centerPanel;
        const activeTab = HUB_TABS.find((t) => t.id === tabId) || HUB_TABS[1];

        // Hide every extracted tab scene first; then show the one that
        // owns this tabId, if any. This keeps the show/hide logic
        // symmetric regardless of which tab was previously active.
        Object.entries(n.tabs).forEach(([id, scene]) => {
            if (id !== tabId) scene.hide();
        });

        if (tabId === 'missions') {
            c.tabTitle.visible = true;
            c.tabTitle.text = 'MISSIONS';
            c.planner.container.visible = true;
            this._refreshMissionPlanner();
        } else if (n.tabs[tabId]) {
            // Extracted tab scenes own their own title + surface; hide
            // the default chrome so they don't overlap.
            c.tabTitle.visible = false;
            c.planner.container.visible = false;
            this._closeMissionBoard();
            const scene = n.tabs[tabId];
            scene.show();
            if (typeof scene.layout === 'function' && c._w && c._h) {
                scene.layout({ width: c._w, height: c._h });
            }
        } else {
            c.tabTitle.visible = true;
            c.tabTitle.text = activeTab.label;
            c.planner.container.visible = false;
            this._closeMissionBoard();
        }
    }

    _setDispatchMode(mode) {
        this._selectedMissionDispatch = mode === 'manual' ? 'manual' : 'idle';
        this._refreshMissionPlanner();
    }

    _environmentLevelForMission(mission) {
        const complexity = mission?.gameConfig?.complexity;
        if (complexity === PIECE_COMPLEXITY.COLLAPSED) return 3;
        if (complexity === PIECE_COMPLEXITY.MUTATED) return 2;
        return 1;
    }

    _idleEtaSecForMission(mission, shipTypeMatch) {
        const base = IDLE_DURATION_SEC_BY_RISK[mission?.risk] || 240;
        const tierBonus = Math.max(0, ((mission?.tierIndex || 1) - 1) * 15);
        const envBonus = (this._environmentLevelForMission(mission) - 1) * 25;
        const hullPenalty = shipTypeMatch ? -12 : 16;
        return Math.max(90, Math.round(base + tierBonus + envBonus + hullPenalty));
    }

    _truncateSingleLine(textNode, fullText, maxWidth) {
        if (!textNode) return;
        let next = String(fullText ?? '');
        textNode.text = next;
        if (textNode.width <= maxWidth) return;
        const ellipsis = '\u2026';
        while (next.length > 1) {
            next = next.slice(0, -1);
            textNode.text = `${next}${ellipsis}`;
            if (textNode.width <= maxWidth) return;
        }
        textNode.text = ellipsis;
    }

    _buildSelectableRow(label, width, onTap) {
        const container = new Container();
        container.eventMode = 'static';
        container.cursor = 'pointer';
        const frame = drawTechPanel(width, 30, { accent: 'cyan' });
        container.addChild(frame);
        const title = new Text({
            text: label,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '700', fill: colors.text.primary }),
        });
        title.position.set(8, 7);
        frame.addChild(title);
        this._truncateSingleLine(title, label, width - 14);
        container.on('pointertap', onTap);
        return { container, frame, title };
    }

    _refreshMissionPlanner() {
        this._reconcileIdleMissionState();
        const planner = this._nodes?.centerPanel?.planner;
        if (!planner) return;
        const fleet = this.meta?.fleetSnapshot() || [];
        const crew = this.meta?.crewSnapshot() || [];
        const freeShips = fleet.filter((s) => s.status === 'Standby');
        const freeCrew = crew.filter((c) => c.status === 'Available');
        if (!freeShips.find((s) => s.id === this._selectedShipId)) this._selectedShipId = freeShips[0]?.id ?? null;
        if (!freeCrew.find((c) => c.id === this._selectedCrewId)) this._selectedCrewId = freeCrew[0]?.id ?? null;
        const missionPool = Array.isArray(this._missions) ? this._missions : [];
        if (!missionPool.find((m) => m.tierId === this._selectedMissionTierId)) {
            this._selectedMissionTierId = missionPool[0]?.tierId ?? null;
        }

        const modeIdleActive = this._selectedMissionDispatch === 'idle';
        const modeManualActive = this._selectedMissionDispatch === 'manual';
        planner.modeIdle.setAccent?.(modeIdleActive ? 'cyan' : 'green');
        planner.modeManual.setAccent?.(modeManualActive ? 'magenta' : 'amber');
        planner.modeIdle.label.style.fill = modeIdleActive ? colors.text.white : colors.text.muted;
        planner.modeManual.label.style.fill = modeManualActive ? colors.text.white : colors.text.muted;

        const shipRowW = planner.shipRowW || 160;
        const crewRowW = planner.crewRowW || 160;
        const missionRowW = planner.missionRowW || 160;
        const shipX = planner.shipListX ?? 12;
        const crewX = planner.crewListX ?? (shipX + shipRowW + PLANNER_SECTION_GAP);
        const missionX = planner.missionListX ?? (crewX + crewRowW + PLANNER_SECTION_GAP);
        const listY = planner.listBaseY ?? 86;

        planner.shipRows.forEach((r) => r.container.destroy({ children: true }));
        planner.shipRows = [];
        freeShips.forEach((ship, i) => {
            const row = this._buildSelectableRow(`${ship.name} · ${ship.className}`, shipRowW, () => {
                this._selectedShipId = ship.id;
                this._refreshMissionPlanner();
            });
            if (ship.id === this._selectedShipId) redrawTechPanel(row.frame, shipRowW, PLANNER_ROW_H, { accent: 'magenta' });
            row.container.position.set(shipX, listY + i * (PLANNER_ROW_H + PLANNER_ROW_GAP));
            planner.frame.addChild(row.container);
            planner.shipRows.push(row);
        });

        planner.crewRows.forEach((r) => r.container.destroy({ children: true }));
        planner.crewRows = [];
        freeCrew.forEach((member, i) => {
            const row = this._buildSelectableRow(`${member.name} · Lv${member.level}`, crewRowW, () => {
                this._selectedCrewId = member.id;
                this._refreshMissionPlanner();
            });
            if (member.id === this._selectedCrewId) redrawTechPanel(row.frame, crewRowW, PLANNER_ROW_H, { accent: 'magenta' });
            row.container.position.set(crewX, listY + i * (PLANNER_ROW_H + PLANNER_ROW_GAP));
            planner.frame.addChild(row.container);
            planner.crewRows.push(row);
        });

        planner.missionRows.forEach((r) => r.container.destroy({ children: true }));
        planner.missionRows = [];
        missionPool.forEach((mission, i) => {
            const rowLabel = `T${mission.tierIndex} · ${mission.type.toUpperCase()} · ${mission.difficulty}`;
            const row = this._buildSelectableRow(rowLabel, missionRowW, () => {
                this._selectedMissionTierId = mission.tierId;
                this._refreshMissionPlanner();
            });
            if (mission.tierId === this._selectedMissionTierId) redrawTechPanel(row.frame, missionRowW, PLANNER_ROW_H, { accent: 'magenta' });
            row.container.position.set(missionX, listY + i * (PLANNER_ROW_H + PLANNER_ROW_GAP));
            planner.frame.addChild(row.container);
            planner.missionRows.push(row);
        });

        const mission = missionPool.find((m) => m.tierId === this._selectedMissionTierId) || missionPool[0];
        const maxIdle = this._maxIdleAssignments();
        const risk = HUB_RISK_PRESETS[mission.risk] || HUB_RISK_PRESETS[3];
        const envLvl = this._environmentLevelForMission(mission);
        const threatLvl = mission.risk;
        const etaPreviewSec = this._idleEtaSecForMission(mission, true);
        planner.outcomeBody.text = `${mission.narrativeName} · ${mission.type} · ${mission.difficulty}\n` +
            `Threat Lv ${threatLvl} · Environment Lv ${envLvl} · ETA ${formatDuration(etaPreviewSec)}\n` +
            `Reward ~${Math.round(mission.baseCredits * 0.8)}-${Math.round(mission.baseCredits * 1.25)} credits. ` +
            `${this._selectedMissionDispatch === 'manual'
                ? 'Launches playable minigame.'
                : 'Autonomous idle run, can be aborted anytime for partial return.'}`;
        planner.capacityText.text = `IDLE CAPACITY ${this._idleMissions.length}/${maxIdle} · FREE SHIPS ${freeShips.length} · FREE CREW ${freeCrew.length}`;

        const canDispatch = !!(this._selectedShipId && this._selectedCrewId && mission);
        planner.dispatch.container.eventMode = canDispatch ? 'static' : 'none';
        planner.dispatch.container.cursor = canDispatch ? 'pointer' : 'not-allowed';
        planner.dispatch.label.style.fill = canDispatch ? colors.text.white : colors.text.muted;
    }

    _dispatchSelectedMission() {
        const ship = this.meta?.fleetSnapshot().find((s) => s.id === this._selectedShipId && s.status === 'Standby');
        const crew = this.meta?.crewSnapshot().find((c) => c.id === this._selectedCrewId && c.status === 'Available');
        const mission = this._missions.find((m) => m.tierId === this._selectedMissionTierId);
        if (!ship || !crew || !mission) return;
        if (this._selectedMissionDispatch === 'idle' && this._idleMissions.length >= this._maxIdleAssignments()) return;

        const now = Date.now();
        const missionResult = this._resolveMissionForDispatch(mission, ship, crew);
        const jobId = `dispatch-${this._idleMissionSeq++}`;
        this._idleMissions.push({
            id: jobId,
            offerId: mission.tierId,
            missionId: mission.id,
            title: mission.narrativeName,
            type: mission.type,
            dispatchMode: this._selectedMissionDispatch,
            risk: mission.risk,
            difficulty: mission.difficulty,
            threatLevel: missionResult.threatLevel,
            environmentLevel: missionResult.environmentLevel,
            rewardCredits: missionResult.rewardCredits,
            rewardOres: missionResult.rewardOres,
            shipId: ship.id,
            shipName: ship.name,
            crewId: crew.id,
            crewName: crew.name,
            startedAt: now,
            etaSec: missionResult.etaSec,
            endsAt: now + missionResult.etaSec * 1000,
            claimed: false,
        });
        this.meta?.setShipStatus(ship.id, 'On Mission');
        this.meta?.setCrewStatus(crew.id, 'On Mission');
        if (this._selectedMissionDispatch === 'manual') {
            this._onMissionCardTapped(mission);
        }
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
    }

    _resolveMissionForDispatch(mission, ship, crew) {
        const missionType = String(mission.type || '').toLowerCase();
        const shipTypeMatch = String(ship.className || '').toLowerCase().includes(missionType);
        const skillFactor = 1 + ((crew.level - 1) * 0.04);
        const typeFactor = shipTypeMatch ? 1.12 : 0.94;
        const threatLevel = mission.risk;
        const environmentLevel = this._environmentLevelForMission(mission);
        const rewardCredits = Math.max(60, Math.round(mission.baseCredits * skillFactor * typeFactor));
        const etaSec = this._idleEtaSecForMission(mission, shipTypeMatch);
        return {
            rewardCredits,
            etaSec,
            threatLevel,
            environmentLevel,
            rewardOres: { common: [], rare: [] },
        };
    }

    _maxIdleAssignments() {
        const ships = this.meta?.fleetSnapshot()?.length || 0;
        const crews = this.meta?.crewSnapshot()?.length || 0;
        return Math.max(0, Math.min(ships, crews));
    }

    _refreshFleetCrewPanel() {
        const col = this._nodes?.rightCol;
        if (!col || !this.meta) return;
        const fleet = this.meta.fleetSnapshot();
        const crew = this.meta.crewSnapshot();
        col.fleetRows.forEach((row, i) => {
            const ship = fleet[i];
            if (!ship) return;
            row.status.text = ship.status.toUpperCase();
            row.status.style.fill = ship.status === 'Standby' ? colors.status.success : colors.status.warning;
            row.hull = ship.hull;
        });
        col.crewRows.forEach((row, i) => {
            const member = crew[i];
            if (!member) return;
            row.status.text = member.status.toUpperCase();
            row.status.style.fill = member.status === 'Available' ? colors.status.success : colors.status.warning;
        });
    }

    _refreshActiveIdleMissions() {
        this._reconcileIdleMissionState();
        const left = this._nodes?.leftCol;
        if (!left) return;
        left.counter.text = `${this._idleMissions.length} / ${this._maxIdleAssignments()}`;
        if (left.empty?.parent === left.list) {
            left.list.removeChild(left.empty);
        }
        if (Array.isArray(left.rows)) {
            left.rows.forEach((row) => {
                row?.container?.destroy({ children: true });
            });
        }
        left.rows = [];
        if (this._idleMissions.length === 0) {
            left.list.addChild(left.empty);
            return;
        }
        const rowW = HUB_COL_W - 24;
        const now = Date.now();
        this._idleMissions.forEach((job, i) => {
            const remainingSec = Math.max(0, Math.ceil((job.endsAt - now) / 1000));
            const done = remainingSec <= 0;
            const row = this._buildActiveIdleRow(job, rowW, remainingSec, done);
            row.container.y = i * 118;
            left.list.addChild(row.container);
            left.rows.push(row);
        });
    }

    _reconcileIdleMissionState() {
        if (!this.meta) return;
        const fleet = this.meta.fleetSnapshot();
        const crew = this.meta.crewSnapshot();
        const fleetById = new Map(fleet.map((ship) => [ship.id, ship]));
        const crewById = new Map(crew.map((member) => [member.id, member]));
        const validJobs = [];
        const usedShips = new Set();
        const usedCrew = new Set();

        for (const job of this._idleMissions) {
            if (!fleetById.has(job.shipId) || !crewById.has(job.crewId)) {
                continue;
            }
            if (usedShips.has(job.shipId) || usedCrew.has(job.crewId)) {
                continue;
            }
            validJobs.push(job);
            usedShips.add(job.shipId);
            usedCrew.add(job.crewId);
        }
        this._idleMissions = validJobs;

        const orphanShips = fleet.filter((ship) => ship.status === 'On Mission' && !usedShips.has(ship.id));
        const orphanCrew = crew.filter((member) => member.status === 'On Mission' && !usedCrew.has(member.id));
        const pairCount = Math.min(orphanShips.length, orphanCrew.length);
        for (let i = 0; i < pairCount; i += 1) {
            const ship = orphanShips[i];
            const member = orphanCrew[i];
            const now = Date.now();
            this._idleMissions.push({
                id: `dispatch-${this._idleMissionSeq++}`,
                offerId: 'recovered-assignment',
                title: 'Recovered Idle Assignment',
                type: 'recovery',
                dispatchMode: 'idle',
                risk: 1,
                rewardCredits: 0,
                rewardOres: { common: [], rare: [] },
                shipId: ship.id,
                shipName: ship.name,
                crewId: member.id,
                crewName: member.name,
                startedAt: now,
                etaSec: 0,
                endsAt: now,
                claimed: false,
            });
            usedShips.add(ship.id);
            usedCrew.add(member.id);
        }

        for (const ship of fleet) {
            const onMission = usedShips.has(ship.id);
            const next = onMission ? 'On Mission' : 'Standby';
            if (ship.status !== next) this.meta.setShipStatus(ship.id, next);
        }
        for (const member of crew) {
            const onMission = usedCrew.has(member.id);
            const next = onMission ? 'On Mission' : 'Available';
            if (member.status !== next) this.meta.setCrewStatus(member.id, next);
        }
    }

    _buildActiveIdleRow(job, w, remainingSec, done) {
        const container = new Container();
        const frame = drawTechPanel(w, 108, { accent: done ? 'green' : 'cyan' });
        container.addChild(frame);
        const title = new Text({
            text: job.title,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '700', fill: colors.text.primary, wordWrap: true, wordWrapWidth: w - 20 }),
        });
        title.position.set(10, 10);
        frame.addChild(title);
        const crewShip = new Text({
            text: `${job.shipName} · ${job.crewName}`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: colors.text.muted }),
        });
        crewShip.position.set(10, 46);
        frame.addChild(crewShip);
        const status = new Text({
            text: done ? `READY · +${job.rewardCredits} CR` : `ETA ${formatDuration(remainingSec)}`,
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: done ? colors.status.success : colors.text.info }),
        });
        status.position.set(10, 66);
        frame.addChild(status);
        if (done) {
            const claim = buildSimpleButton({
                text: 'CLAIM',
                width: 80,
                height: 26,
                accent: 'green',
                onTap: () => this._claimIdleMission(job.id),
            });
            claim.container.position.set(w - 90, 72);
            frame.addChild(claim.container);
        } else {
            const abort = buildSimpleButton({
                text: 'RETURN',
                width: 80,
                height: 26,
                accent: 'amber',
                onTap: () => this._abortIdleMission(job.id),
            });
            abort.container.position.set(w - 90, 72);
            frame.addChild(abort.container);
        }
        return { container, frame };
    }

    _abortIdleMission(jobId) {
        const job = this._idleMissions.find((m) => m.id === jobId);
        if (!job) return;
        const elapsed = Math.max(0, Date.now() - job.startedAt);
        const duration = Math.max(1, job.etaSec * 1000);
        const pct = Math.min(1, elapsed / duration);
        const partialCredits = Math.max(0, Math.floor(job.rewardCredits * pct));
        this.meta?.addCredits(partialCredits);
        this.meta?.setShipStatus(job.shipId, 'Standby');
        this.meta?.setCrewStatus(job.crewId, 'Available');
        this._idleMissions = this._idleMissions.filter((m) => m.id !== jobId);
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
    }

    _claimIdleMission(jobId) {
        const idx = this._idleMissions.findIndex((m) => m.id === jobId);
        if (idx < 0) return;
        const job = this._idleMissions[idx];
        this.meta?.addCredits(job.rewardCredits);
        if (Array.isArray(job.rewardOres.common)) {
            job.rewardOres.common.forEach((oreId) => {
                const ore = ORES.find((o) => o.id === oreId);
                if (ore?.color) this.meta?.addOre(ore.color, 1);
            });
        }
        if (Array.isArray(job.rewardOres.rare)) {
            job.rewardOres.rare.forEach((oreId) => {
                const ore = ORES.find((o) => o.id === oreId);
                if (ore?.color) this.meta?.addOre(ore.color, 1);
            });
        }
        this.meta?.setShipStatus(job.shipId, 'Standby');
        this.meta?.setCrewStatus(job.crewId, 'Available');
        this._idleMissions.splice(idx, 1);
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
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
        // Keep the desktop-first hub shell intact and scale it down as a
        // single surface when the viewport is narrower than the layout's
        // minimum width/height. This avoids panel overlap on phones while
        // preserving one authoritative set of hub coordinates.
        const scale = Math.min(w / HUB_MIN_LAYOUT_W, h / HUB_MIN_LAYOUT_H, 1);
        const vw = Math.max(HUB_MIN_LAYOUT_W, w / scale);
        const vh = Math.max(HUB_MIN_LAYOUT_H, h / scale);
        n.root.scale.set(scale);
        n.root.position.set(
            Math.round((w - (vw * scale)) / 2),
            Math.round((h - (vh * scale)) / 2),
        );

        const shellX = HUB_SURFACE_INSET;
        const shellW = Math.max(HUB_MIN_LAYOUT_W - HUB_SURFACE_INSET * 2, vw - HUB_SURFACE_INSET * 2);

        // --- Top bar: aligned to the same outer edges as middle panels.
        this._layoutTopBar(n.topBar, shellX, shellW, HUB_SURFACE_INSET_Y);

        // --- News ticker: aligned to shell width under top bar.
        this._layoutNewsTicker(n.news, shellX, shellW, HUB_SURFACE_INSET_Y + HUB_TOPBAR_H);

        // --- Columns + center live in the middle band.
        const columnsY = HUB_SURFACE_INSET_Y + HUB_TOPBAR_H + HUB_NEWS_H + HUB_GUTTER;
        const columnsH = Math.max(360, vh - columnsY - HUB_NAV_H - HUB_GUTTER - HUB_SURFACE_INSET_Y);
        const leftX = shellX;
        const rightX = Math.max(leftX + HUB_COL_W + HUB_GUTTER, shellX + shellW - HUB_COL_W);
        // Center gets whatever is left; clamp to a minimum so cards
        // don't overlap at narrow viewports.
        const centerX = leftX + HUB_COL_W + HUB_GUTTER;
        const centerW = Math.max(HUB_MIN_CENTER_W, rightX - centerX - HUB_GUTTER);

        this._layoutColumnPanel(n.leftCol, leftX, columnsY, HUB_COL_W, columnsH);
        this._layoutColumnPanel(n.rightCol, rightX, columnsY, HUB_COL_W, columnsH);
        this._layoutCenterPanel(n.centerPanel, centerX, columnsY, centerW, columnsH);

        // --- Bottom nav: aligned to shell width, pinned to bottom.
        this._layoutBottomNav(n.bottomNav, shellX, shellW, vh - HUB_SURFACE_INSET_Y - HUB_NAV_H, HUB_NAV_H);

        // --- Modal is centered on the viewport. Panel clamps to viewport.
        this._layoutModal(n.modal, vw, vh);
    }

    _layoutTopBar(topBar, x, w, y = 0) {
        const h = HUB_TOPBAR_H;
        topBar.container.position.set(x, y);
        redrawTechPanel(topBar.frame, w, h, { accent: 'cyan' });

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
            redrawTechChip(chip.frame, chipW, 36, { accent: chip.color });
            chip.labelText.position.set(10, 10);
            chip.valueText.position.set(10, 22);
        });
    }

    _layoutNewsTicker(news, x, w, y) {
        const h = HUB_NEWS_H;
        news.container.position.set(x, y);
        news.bg.clear();
        news.bg.rect(0, 0, w, h).fill({ color: colors.bg.panel, alpha: 0.7 });
        news.bg.rect(0, h - 1, w, 1).fill({ color: colors.misc.line, alpha: 0.2 });

        news.prefix.position.set(14, h / 2);

        const prefixRight = 14 + news.prefix.width + 16;
        const bandWidth = Math.max(120, w - prefixRight - 14);
        news.clipMask.clear();
        news.clipMask.rect(prefixRight, 0, bandWidth, h).fill({ color: colors.text.white });

        news.scroller.position.set(prefixRight, h / 2 - news.body.height / 2);
        news.__bandWidth = bandWidth;
        if (typeof news.offset !== 'number' || news.offset > bandWidth) {
            news.offset = bandWidth;
        }
        news.body.x = Math.round(news.offset);
    }

    _layoutColumnPanel(col, x, y, w, h) {
        col.container.position.set(x, y);
        redrawTechPanel(col.panel, w, h, { accent: col.panelAccent ?? 'cyan' });
        if (col.counter) col.counter.position.set(w - 14, 12);
        if (col.list) col.list.position.set(12, 40);
        if (col.empty) {
            // Keep the sky-400 accent set by _buildActiveMissions;
            // re-using the default cyan here would mute the empty card
            // against the panel border.
            redrawTechPanel(col.empty, w - 24, 108, { accent: 'cyan' });
            col.empty.position.set(0, 0);
        }
        if (col.fleetRows) {
            const rowW = w - 28;
            col.fleetRows.forEach((row, i) => {
                row.container.position.set(14, 56 + i * 48);
                row.klass.position.set(rowW, 2);
                row.barBg.clear();
                row.barBg.roundRect(0, 22, rowW, 8, 4).fill({ color: colors.bg.dark, alpha: 0.85 });
                row.bar.clear();
                const hull = typeof row.hull === 'number' ? row.hull : 0;
                const hullColor = hull >= 75 ? colors.status.success : hull >= 45 ? colors.status.warning : colors.status.error;
                row.bar.roundRect(0, 22, Math.max(2, rowW * (hull / 100)), 8, 4).fill({ color: hullColor, alpha: 0.9 });
                row.status.position.set(rowW, 34);
            });
            if (col.crewLabel) col.crewLabel.position.set(14, 56 + col.fleetRows.length * 48 + 10);
            if (col.crewRows) {
                col.crewRows.forEach((row, i) => {
                    row.container.position.set(14, 56 + col.fleetRows.length * 48 + 28 + i * 38);
                    row.status.position.set(rowW, 4);
                });
            }
        }
    }

    _layoutCenterPanel(center, x, y, w, h) {
        center.container.position.set(x, y);
        // Stash the last-known inner dims so tab-scene switches can
        // lay out the newly-shown scene even when it was lazy-built
        // AFTER the most recent _layoutShell pass (see _setActiveTab).
        center._w = w;
        center._h = h;
        redrawTechPanel(center.panel, w, h, { accent: 'magenta' });
        center.planner.container.position.set(12, 38);
        const plannerW = Math.max(260, w - 24);
        const plannerH = Math.max(220, h - 50);
        redrawTechPanel(center.planner.frame, plannerW, plannerH, { accent: 'cyan' });
        center.planner.modeIdle.container.position.set(12, 46);
        center.planner.modeManual.container.position.set(114, 46);
        const rowW = Math.max(130, Math.floor((plannerW - 24 - (PLANNER_SECTION_GAP * 2)) / 3));
        const usedW = rowW * 3 + PLANNER_SECTION_GAP * 2;
        const listStartX = Math.round((plannerW - usedW) / 2);
        center.planner.shipRowW = rowW;
        center.planner.crewRowW = rowW;
        center.planner.missionRowW = rowW;
        center.planner.shipListX = listStartX;
        center.planner.crewListX = listStartX + rowW + PLANNER_SECTION_GAP;
        center.planner.missionListX = listStartX + (rowW + PLANNER_SECTION_GAP) * 2;
        center.planner.listBaseY = 98;
        center.planner.shipHeader.position.set(center.planner.shipListX, 78);
        center.planner.crewHeader.position.set(center.planner.crewListX, 78);
        center.planner.missionHeader.position.set(center.planner.missionListX, 78);

        const outcomeY = Math.max(262, plannerH - 182);
        center.planner.outcomeCard.position.set(10, outcomeY);
        redrawTechPanel(center.planner.outcomeCard, Math.max(220, plannerW - 20), 96, { accent: 'green' });
        center.planner.outcomeBody.style.wordWrapWidth = Math.max(170, plannerW - 40);
        center.planner.capacityText.position.set(12, plannerH - 62);
        center.planner.dispatch.container.position.set(
            Math.round((plannerW - center.planner.dispatch.width) / 2),
            plannerH - center.planner.dispatch.height - 10,
        );
        this._refreshMissionPlanner();

        // Fan out to any extracted tab scenes hosted in the center
        // panel. They lay out against the panel's inner surface (same
        // w/h) regardless of which one is currently visible so a
        // hidden scene doesn't flash at the old size on re-show.
        const tabs = this._nodes?.tabs;
        if (tabs) {
            Object.values(tabs).forEach((scene) => {
                if (typeof scene.layout === 'function') {
                    scene.layout({ width: w, height: h });
                }
            });
        }
    }

    _layoutBottomNav(nav, x, w, y, h) {
        nav.container.position.set(x, y);
        redrawTechPanel(nav.frame, w, h, { accent: 'cyan' });

        const pad = HUB_GUTTER;
        const totalInner = Math.max(0, w - pad * 2);
        const gap = 16;
        const tabH = h - 12;
        const baseWidths = nav.tabs.map((t) => {
            const raw = t?.control?.width;
            return (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) ? raw : 136;
        });
        const totalBaseW = baseWidths.reduce((sum, bw) => sum + bw, 0) + gap * Math.max(0, nav.tabs.length - 1);
        const groupScale = totalBaseW > totalInner ? totalInner / totalBaseW : 1;
        const contentW = totalBaseW * groupScale;
        let cursorX = pad + Math.round((totalInner - contentW) / 2);
        if (!Number.isFinite(cursorX)) cursorX = pad;

        nav.tabs.forEach((t, i) => {
            const btnW = baseWidths[i];
            const rawH = t?.control?.height;
            const btnH = (typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0) ? rawH : 40;
            const slotW = btnW * groupScale;
            const s = Math.min(slotW / btnW, tabH / btnH);
            t.container.scale.set(s);
            const scaledW = btnW * s;
            const scaledH = btnH * s;
            t.container.position.set(cursorX + Math.round((slotW - scaledW) / 2), 6 + Math.round((tabH - scaledH) / 2));
            t.container.__width = slotW;
            t.container.__height = tabH;
            t.container.hitArea = new Rectangle(0, 0, btnW, btnH);
            t.sublabel.position.set(btnW / 2, btnH / 2 + 12);
            cursorX += slotW + gap * groupScale;
        });
        // Re-apply the active-tab visual (depends on __width / __height).
        // Uses the highlight-only variant so a user-dismissed modal is
        // not forcibly reopened on every window resize.
        this._redrawTabHighlights(this._nodes?.activeTabId || 'missions');
    }

    _layoutModal(modal, w, h) {
        modal.dim.clear();
        modal.dim.rect(0, 0, w, h).fill({ color: colors.bg.base, alpha: 0.75 });
        modal.dim.hitArea = new Rectangle(0, 0, w, h);

        const panelW = Math.min(700, Math.max(520, w - 80));
        const panelH = Math.min(540, Math.max(420, h - 120));
        const px = Math.round((w - panelW) / 2);
        const py = Math.round((h - panelH) / 2);
        modal.panel.position.set(px, py);
        redrawTechPanel(modal.panel, panelW, panelH, { accent: 'cyan' });

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
