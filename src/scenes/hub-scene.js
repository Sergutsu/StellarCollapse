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
    buildMissions,
    buildIdleMissions,
    pickMissionBoard,
    ORES,
} from '../missions.js';

import {
    computeJobState,
    makeRecoveryJob,
} from '../idle-clock.js';

// P8 meta systems. The hub is the only scene that mutates the dispatch
// side of MetaState, so it owns settlement (one reward path for manual
// runs and idle contracts), rep gating on board cards, and the daily
// board seed + paid rerolls.
import {
    settleMission,
    resolveDispatch,
    environmentLevelForMission,
    idleEtaSecForMission,
} from '../settlement.js';
import { isMissionUnlocked, repInfo, repTierRequiredForMission } from '../reputation.js';
import { countdownToNextDay } from '../daily.js';

import { CELL_PALETTE } from './cell-palette.js';
import { colors } from '../theme/tokens.js';
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
import { createTab } from '../ui/Tab.js';
import { StarMapTab } from './tabs/star-map-tab.js';
import { ResearchTab } from './tabs/research-tab.js';
import {
    getAllNodes,
    getResearchProgressForProject,
    getRemainingMsForProject,
} from '../research.js';
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
const COLOR_AMBER_300 = colors.status.warning;
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
    { id: 'build',      label: 'FLEET UPGRADE', locked: false, colorKey: 'build' },
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

// WELCOME BACK banner height in the idle-fleet column.
const WELCOME_BANNER_H = 96;
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

        // Daily mission catalog. The board now rolls from the persisted
        // daily seed (src/daily.js) instead of a per-boot random, so the
        // contract list is the same all day, survives a reload, and only
        // changes at the UTC boundary or when the player pays for a
        // reroll. `repTier` decides which cards are gated.
        const boardState = meta?.getBoardState ? meta.getBoardState() : null;
        this._missions = [];
        this._rebuildMissionCatalog(boardState?.seed ?? Math.floor(Math.random() * 0xffffffff));
        // Runtime news lines pushed by meta events (rep promotion, sector
        // charted, contract claimed). Prepended to the static flavor pool.
        this._newsRuntime = [];
        // Offline summary handed in by main.js at boot; renders the
        // WELCOME BACK banner over the idle fleet list.
        this._offlineSummary = null;
        this._welcomeBanner = null;
        this._lastBoardMetaRefresh = 0;
        this._idleMissions = [];
        this._idleMissionSeq = 1;
        // MANUAL is the default dispatch mode: pressing DISPATCH immediately
        // launches the selected mission's playable minigame. IDLE is opt-in.
        this._selectedMissionDispatch = 'manual';
        this._onResetGame = null;
        // Miner (blocks tiers) is the default sandbox: preselect the first
        // blocks-tier mission so a fresh boot points at the miner board.
        // Combat variants of a blocks tier route to the defense minigame
        // instead, so skip them when picking the default.
        const defaultMission =
            this._missions.find((m) => m.tierId === 'blocks-classic' && !m.runsDefense) ||
            this._missions.find((m) => m.tierId?.startsWith('blocks-') && !m.runsDefense) ||
            this._missions.find((m) => !m.runsDefense) ||
            this._missions[0];
        this._selectedMissionTierId = defaultMission?.tierId || null;
        this._selectedShipId = null;
        this._selectedCrewId = null;
        this._lastIdleUiRefreshAt = 0;

        // Mirrors whichever mission is currently selected. HUD tier
        // color + size multiplier readouts read this via getStartState.
        this._startState = {
            mode: defaultMission.gameConfig.mode,
            complexity: defaultMission.gameConfig.complexity,
            fieldSizeId: defaultMission.gameConfig.fieldSizeId,
            selectedMissionId: defaultMission.id,
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
        // Re-run layout on every show so nodes created while the app
        // screen was still 0x0 don't stay pinned at their build-time
        // defaults (notably the bottom-nav tabs at y=0).
        if (this.app?.screen) {
            this._layoutShell(this.app.screen.width, this.app.screen.height);
        }
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

        // The board's "free refresh in HH:MM:SS" countdown + reroll price
        // only need a 1 Hz repaint, and only while the modal is open.
        if (n.modal?.container.visible && now - this._lastBoardMetaRefresh >= 1000) {
            this._lastBoardMetaRefresh = now;
            this._refreshMissionBoardMeta();
        }

        // Forward tick to live tabs (Research needs it for live progress)
        const activeTab = this._nodes?.tabs?.[this._nodes.activeTabId];
        if (activeTab && typeof activeTab.tick === 'function') {
            activeTab.tick(deltaMs);
        }

        // Always tick Research for background progress + auto-completion
        const researchTab = this._nodes?.tabs?.research;
        if (researchTab && typeof researchTab.tick === 'function') {
            researchTab.tick(deltaMs);
        }

        // Live update research projects in left column when visible
        if (this._nodes?.researchProjects?.container.visible) {
            this._refreshResearchProjectsPanel();
        }
    }

    destroy() {
        this._destroyWelcomeBanner();
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

    setResetGameCallback(fn) {
        this._onResetGame = typeof fn === 'function' ? fn : null;
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
        const researchProjects = this._buildResearchProjects(); // shown when RESEARCH tab is active
        const sidePanel = this._buildSidePanel();               // shown when a tab owns it
        const centerPanel = this._buildCenter();
        const rightCol = this._buildFleetCrew();
        const bottomNav = this._buildBottomNav();
        const modal = this._buildMissionBoardModal();

        // Hub-tab scenes (ADR-0010). Mutually-exclusive scenes hosted
        // inside the center panel's hologram surface. _setActiveTab
        // shows the right one and hides the others. STAR MAP,
        // BUILD/UPGRADE, and RESEARCH are extracted scenes; the
        // remaining tabs still render a locked stub.
        const starMapTab = new StarMapTab({ parent: centerPanel.panel, meta: this.meta, side: sidePanel });
        const buildTab = new BuildUpgradeTab({ parent: centerPanel.panel, meta: this.meta, side: sidePanel });
        const researchTab = new ResearchTab({ parent: centerPanel.panel, meta: this.meta });
        const crewTab = new CrewTab({ parent: centerPanel.panel, meta: this.meta });
        const marketTab = new MarketTab({ parent: centerPanel.panel, meta: this.meta, side: sidePanel });
        const tabs = { 'star-map': starMapTab, build: buildTab, research: researchTab, crew: crewTab, market: marketTab };

        root.addChild(topBar.container);
        root.addChild(news.container);
        root.addChild(leftCol.container);
        root.addChild(researchProjects.container); // will be shown/hidden based on active tab
        root.addChild(sidePanel.container);        // tab-owned left panel (STAR MAP / BUILD / MARKET)
        root.addChild(centerPanel.container);
        root.addChild(rightCol.container);
        root.addChild(bottomNav.container);
        root.addChild(modal.container);

        this._nodes = {
            root,
            topBar,
            news,
            leftCol,
            researchProjects, // alternative left column content
            sidePanel,        // tab-owned alternative left column content
            centerPanel,
            rightCol,
            bottomNav,
            modal,
            tabs,
            activeTabId: 'missions',
        };

        if (this.app) this._layoutShell(this.app.screen.width, this.app.screen.height);

        // Start with idle fleet visible, research projects hidden
        researchProjects.container.visible = false;
        leftCol.container.visible = true;

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
        // REP chip: the dispatcher rank + progress toward the next one.
        // Rendered like a resource chip but sourced from MetaState's
        // reputation points through reputation.js, not a hub resource.
        const repChip = this._buildResourceChip({ label: 'REP', color: colors.brand.gold });
        repChip.metaId = null;
        repChip.format = 'rep';
        repChip.wide = true;
        chips.push(repChip);
        chips.forEach((chip) => container.addChild(chip.container));
        // Sync chip values with MetaState now, and re-sync whenever
        // MetaState emits `change` so reward grants surface in the top
        // bar without a full hub rebuild.
        this._syncResourceChips(chips);
        if (this.meta && !this._metaChipSyncBound) {
            this._metaChipSyncBound = true;
            this.meta.on('change', (payload) => {
                if (this._nodes && this._nodes.topBar) {
                    this._syncResourceChips(this._nodes.topBar.chips);
                }
                // Runtime headlines: a rank promotion or a newly charted
                // sector is exactly the kind of thing the ticker is for.
                if (payload?.kind === 'rep-tier') {
                    const info = this.meta.getRepInfo();
                    this.pushNews(`Promotion: you are now ${info.title} (REP tier ${info.tier}).`);
                }
                if (payload?.kind === 'sector-discovered') {
                    this.pushNews(`New sector charted: ${payload.detail?.id?.replace(/-/g, ' ')}.`);
                }
                if (payload?.kind === 'research-complete') {
                    this.pushNews(`Research online: ${payload.detail?.nodeId?.replace(/-/g, ' ')}.`);
                }
                // P4: any meta mutation (dispatch claim/abort, rewards, etc.) can affect the idle list
                this._refreshActiveIdleMissions?.();
                this._refreshMissionPlanner?.();
                this._refreshFleetCrewPanel?.();

                // Whichever tab is on screen reacts to resource + state
                // changes (research nodes, sector rail, market prices,
                // crew roster, fleet berths).
                this._refreshVisibleTab();

                // If research projects are visible in left column, refresh them
                if (this._nodes?.researchProjects?.container.visible) {
                    this._refreshResearchProjectsPanel();
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

        // Reset Game: wipes the saved profile and reloads so the player can
        // always start a fresh run, even if dispatch state wedged itself.
        const reset = new Text({
            text: '\u21BA RESET',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 1,
                fill: colors.status.warning,
            }),
        });
        reset.anchor.set(0.5);
        reset.eventMode = 'static';
        reset.cursor = 'pointer';
        reset.on('pointertap', () => this._onResetGame?.());
        container.addChild(reset);

        return {
            container, frame, star, brand, dispatcherBadge, chips, gear, reset,
        };
    }

    _syncResourceChips(chips) {
        if (!chips) return;
        for (const chip of chips) {
            if (chip.format === 'rep') {
                const info = this.meta?.getRepInfo ? this.meta.getRepInfo() : repInfo(0);
                chip.labelText.text = `REP ${info.tier} · ${info.title.split(' ')[0].toUpperCase()}`;
                chip.valueText.text = info.maxed
                    ? 'MAX RANK'
                    : `${info.rep - info.threshold} / ${info.nextThreshold - info.threshold}`;
                continue;
            }
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

    // Research projects view for when the RESEARCH tab is active (replaces idle fleet in left column)
    _buildResearchProjects() {
        const container = new Container();
        const panel = drawTechPanel(HUB_COL_W, 420, { accent: 'amber' });
        container.addChild(panel);

        const header = panelLabel('ACTIVE RESEARCH', COLOR_AMBER_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const list = new Container();
        list.position.set(12, 40);
        panel.addChild(list);

        return {
            container,
            panel,
            panelAccent: 'amber',
            header,
            list,
            slots: [], // will hold the rendered research slot rows
        };
    }

    /**
     * Generic left-column panel owned by whichever tab is active.
     *
     * MISSIONS keeps its idle-fleet list and RESEARCH keeps its project
     * list; the other tabs get this panel instead, so tab-specific tooling
     * lives on the left where the player's eye already is:
     *
     *   STAR MAP      -> SYSTEM DATA for the selected body
     *   BUILD/UPGRADE -> the shipyard (blueprints + berth counter)
     *   MARKET        -> the goods list with BUY/SELL
     *
     * The tab builds its own children into `list` and re-lays them out from
     * `layoutSide({ width, height })`, which the hub calls on activation and
     * on every resize. ADR-0010 still holds: the tab owns its content, the
     * hub only owns the frame.
     */
    _buildSidePanel() {
        const container = new Container();
        const panel = drawTechPanel(HUB_COL_W, 420, { accent: 'cyan' });
        container.addChild(panel);

        const header = panelLabel('PANEL', COLOR_CYAN_300, { size: 14 });
        header.position.set(14, 12);
        panel.addChild(header);

        const list = new Container();
        list.position.set(12, 40);
        panel.addChild(list);

        return {
            container,
            panel,
            panelAccent: 'cyan',
            header,
            list,
            // Tab currently driving the panel; used to skip relayout when a
            // hidden tab's stale content is still mounted.
            ownerId: null,
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
            text: 'MANUAL launches the mission minigame now. IDLE runs it in the background.',
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
        const btn = createTab({
            label: tab.label,
            width: dynamicWidth,
            height: 40,
            colorKey: tab.colorKey,
            locked: !!tab.locked,
            lockRep: tab.lockRep,
            onTap: () => {
                if (!tab.locked) this._setActiveTab(tab.id);
            },
        });
        return { container: btn.container, bg: btn, label: btn.label, sublabel: btn.sublabel, tab };
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

        // Roll the initial 2x2 subset from the *daily* seed so the board
        // is stable across reloads within a UTC day and only changes at
        // the day boundary or when the player pays for a reroll.
        this._hubBoardSeed = this._boardSeed;
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
            width: 200,
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

    // Live copy on the board: today's reroll price + the countdown to the
    // free daily refresh. Called from tick() at ~1 Hz while the modal is
    // open, and after every reroll.
    _refreshMissionBoardMeta() {
        const modal = this._nodes?.modal;
        if (!modal) return;
        const now = Date.now();
        const board = this.meta?.getBoardState ? this.meta.getBoardState(now) : null;
        const credits = this.meta?.credits ?? 0;
        const cost = board?.nextRerollCost ?? Infinity;
        const affordable = Number.isFinite(cost) && credits >= cost;

        modal.subtitle.text = board
            ? `Daily contracts · free refresh in ${countdownToNextDay(now)} · ${board.rerollsToday} reroll${board.rerollsToday === 1 ? '' : 's'} used today`
            : 'Select a contract to dispatch';
        modal.rerollButton.label.text = !board?.canReroll
            ? 'REROLL LIMIT REACHED'
            : `REROLL BOARD · ${cost.toLocaleString('en-US')} CR`;
        modal.rerollButton.container.alpha = affordable ? 1 : 0.42;
        modal.rerollButton.container.eventMode = affordable ? 'static' : 'none';
        modal.rerollButton.container.cursor = affordable ? 'pointer' : 'not-allowed';
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

        // Type tag (top-left) + sector name (top-right). Combat variants
        // get a second badge so the player knows this card launches the
        // defense minigame instead of the puzzle board.
        const isCombat = !!mission.runsDefense;
        const typeTag = new Text({
            text: isCombat ? `${mission.type.toUpperCase()} · MINIGAME` : mission.type.toUpperCase(),
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 2,
                fill: isCombat ? colors.status.error : tierFill,
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

        // Rep gate: T8/T9 cards stay visible (they show what you are
        // working toward) but refuse a dispatch until the rank is earned.
        const repTier = this.meta?.reputationTier ?? 1;
        const unlocked = isMissionUnlocked(mission, repTier);
        const requiredRep = repTierRequiredForMission(mission);

        // ACCEPT button spans the card's bottom edge.
        const accept = buildSimpleButton({
            text: unlocked ? 'ACCEPT' : `LOCKED · REP ${requiredRep}`,
            width: w - 24,
            height: 28,
            accent: unlocked ? 'green' : 'amber',
        });
        accept.container.position.set(12, h - 40);
        accept.container.eventMode = 'none';
        container.addChild(accept.container);

        let lockOverlay = null;
        let lockText = null;
        if (!unlocked) {
            lockOverlay = new Graphics();
            lockOverlay.roundRect(0, 0, w, h, 10).fill({ color: 0x020617, alpha: 0.62 });
            container.addChild(lockOverlay);
            lockText = new Text({
                text: `REP TIER ${requiredRep} REQUIRED\nYou are REP ${repTier} · ${repInfo(this.meta?.reputation ?? 0).title}`,
                style: new TextStyle({
                    fontFamily: '"Courier New", monospace',
                    fontSize: 12,
                    fontWeight: '700',
                    align: 'center',
                    letterSpacing: 1,
                    fill: colors.status.warning,
                }),
            });
            lockText.anchor.set(0.5);
            lockText.position.set(w / 2, h / 2 - 8);
            container.addChild(lockText);
        }

        // Hover state: brighten border. Click forwards through the
        // parent card's pointertap (set by the caller).
        const redraw = (hovered) => {
            const live = hovered && unlocked;
            border.clear();
            border.roundRect(0, 0, w, h, 10).stroke({
                color: unlocked ? tierFill : colors.status.warning,
                width: live ? 2 : 1,
                alpha: unlocked ? (live ? 0.95 : 0.55) : 0.5,
            });
            bgFill.alpha = live ? 0.9 : 0.78;
        };
        container.on('pointerover', () => redraw(true));
        container.on('pointerout', () => redraw(false));
        container.cursor = unlocked ? 'pointer' : 'not-allowed';

        return { container, border, bgFill, accept, lockOverlay, lockText, unlocked, missionId: mission.id };
    }

    _rerollMissionBoard() {
        // Paid reroll: MetaState charges the escalating credit cost and
        // persists the day's reroll counter, then the board re-rolls from
        // the new deterministic seed. The first roll of each UTC day is
        // free and happens by itself (normalizeBoardState resets it).
        if (this.meta?.buyBoardReroll) {
            const result = this.meta.buyBoardReroll();
            if (!result.ok) {
                this.pushNews(`Reroll declined: ${result.reason}.`);
                this._refreshMissionBoardMeta();
                return;
            }
            // Rebuild the whole catalog from the new daily seed: the seed
            // decides which Combat variants (sector, risk lane, ore split)
            // hang off the nine tiers, so a paid reroll changes more than
            // which four cards are face up.
            this._rebuildMissionCatalog(this.meta.getBoardState().seed);
        } else {
            this._rebuildMissionCatalog((this._hubBoardSeed + 0x9E3779B9) >>> 0);
        }
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
        this._refreshMissionBoardMeta();
        // The planner lists contracts from the same catalog; keep its
        // preselection pointed at a record that still exists.
        this._refreshMissionPlanner();
    }

    /**
     * Rebuild the daily mission catalog from a board seed. Shared by the
     * constructor and the paid reroll so the seed -> catalog derivation
     * exists in exactly one place.
     */
    _rebuildMissionCatalog(seed) {
        this._boardSeed = (seed >>> 0) || 1;
        this._hubBoardSeed = this._boardSeed;
        this._missions = buildMissions({
            seed: this._boardSeed,
            repTier: this.meta?.reputationTier ?? 1,
        });
        return this._missions;
    }

    _openMissionBoard() {
        if (this._nodes?.modal) {
            this._nodes.modal.container.visible = true;
            this._refreshMissionBoardMeta();
        }
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
            t.bg.setActive?.(isActive);
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
        //   STAR MAP / FLEET UPGRADE / RESEARCH -> extracted tab scene.
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

        // Left-column content is contextual: idle dispatches on MISSIONS,
        // active projects on RESEARCH, and the tab-owned side panel on any
        // tab that declares `usesSidePanel` (STAR MAP, BUILD/UPGRADE,
        // MARKET). CREW keeps the bay clear so its roster can breathe.
        const showIdleLeft = tabId === 'missions';
        const showResearchLeft = tabId === 'research';
        const sideScene = n.tabs[tabId];
        const showSideLeft = !showIdleLeft && !showResearchLeft && !!sideScene?.usesSidePanel;

        if (n.leftCol && n.researchProjects) {
            n.leftCol.container.visible = showIdleLeft;
            n.researchProjects.container.visible = showResearchLeft;

            if (showResearchLeft) {
                this._refreshResearchProjectsPanel();
            }
        }

        if (n.sidePanel) {
            n.sidePanel.container.visible = showSideLeft;
            if (showSideLeft) {
                // The bay is shared by three tabs, each of which parks its
                // own container in `list`. Hide everything before the new
                // owner lays out, so a tab that forgets to hide itself on
                // `hide()` cannot render behind the next owner's content.
                if (n.sidePanel.ownerId !== tabId) {
                    n.sidePanel.list.children.forEach((child) => { child.visible = false; });
                }
                n.sidePanel.ownerId = tabId;
                n.sidePanel.header.text = sideScene.sidePanelTitle || 'PANEL';
                this._layoutSidePanel();
            } else if (n.sidePanel.ownerId) {
                n.sidePanel.ownerId = null;
            }
        }
    }

    /**
     * Hand the tab-owned left panel its current inner size. Called on tab
     * activation and from `_layoutShell` on every resize.
     */
    _layoutSidePanel() {
        const n = this._nodes;
        const side = n?.sidePanel;
        if (!side || !side.ownerId) return;
        const scene = n.tabs[side.ownerId];
        if (!scene || typeof scene.layoutSide !== 'function') return;
        scene.layoutSide({
            width: side._w || HUB_COL_W,
            height: side._h || 420,
        });
    }

    /**
     * Re-paint whichever tab scene is on screen. Every meta write can move
     * a number a tab shows — warp balance, mineral stock, crew roster — so
     * the visible tab is refreshed from the single `change` event instead
     * of each tab polling.
     */
    _refreshVisibleTab() {
        const scene = this._nodes?.tabs?.[this._nodes?.activeTabId];
        if (!scene || scene.visible === false) return;
        if (typeof scene._refreshFromMeta === 'function') { scene._refreshFromMeta(); return; }
        if (typeof scene._refreshSectors === 'function') { scene._refreshSectors(); return; }
        if (typeof scene._refresh === 'function') scene._refresh();
    }

    _setDispatchMode(mode) {
        this._selectedMissionDispatch = mode === 'manual' ? 'manual' : 'idle';
        this._refreshMissionPlanner();
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
        // Priced through settlement.resolveDispatch so the preview shows
        // exactly what the crew, hull, tech tree and charted sectors will
        // pay — the same number the idle job bakes in at dispatch time.
        const selectedShip = fleet.find((sh) => sh.id === this._selectedShipId) || null;
        const selectedCrew = crew.find((c) => c.id === this._selectedCrewId) || null;
        const priced = resolveDispatch({
            mission,
            ship: selectedShip,
            crew: selectedCrew,
            effects: this._effects(),
            discoveredSectors: this._sectors(),
        });
        const envLvl = priced.environmentLevel;
        const threatLvl = priced.threatLevel;
        const etaPreviewSec = priced.etaSec;
        const locked = !isMissionUnlocked(mission, this.meta?.reputationTier ?? 1);
        const modeLine = locked
            ? `LOCKED — REP tier ${repTierRequiredForMission(mission)} clearance required.`
            : mission.runsDefense
                ? 'Launches the DEFENSE minigame now.'
                : this._selectedMissionDispatch === 'manual'
                    ? `Launches the ${mission.type.toUpperCase()} minigame now.`
                    : 'Autonomous idle run; RETURN early for a partial payout.';
        const bonusLine = priced.sectorCharted
            ? ` · ${mission.sector} charted bonus live`
            : ` · chart ${mission.sector} on STAR MAP for a bonus`;
        planner.outcomeBody.text = `${mission.narrativeName} · ${mission.type} · ${mission.difficulty}\n` +
            `Threat Lv ${threatLvl} · Environment Lv ${envLvl} · ETA ${formatDuration(etaPreviewSec)}\n` +
            `Payout ~${priced.rewardCredits.toLocaleString('en-US')} credits${bonusLine}. ${modeLine}`;
        planner.capacityText.text = `IDLE CAPACITY ${this._idleMissions.length}/${maxIdle} · FREE SHIPS ${freeShips.length} · FREE CREW ${freeCrew.length}`;

        const canDispatch = !!(this._selectedShipId && this._selectedCrewId && mission && !locked);
        planner.dispatch.container.eventMode = canDispatch ? 'static' : 'none';
        planner.dispatch.container.cursor = canDispatch ? 'pointer' : 'not-allowed';
        planner.dispatch.label.style.fill = canDispatch ? colors.text.white : colors.text.muted;
    }

    _dispatchSelectedMission() {
        const ship = this.meta?.fleetSnapshot().find((s) => s.id === this._selectedShipId && s.status === 'Standby');
        const crew = this.meta?.crewSnapshot().find((c) => c.id === this._selectedCrewId && c.status === 'Available');
        const mission = this._missions.find((m) => m.tierId === this._selectedMissionTierId);
        if (!ship || !crew || !mission) return;
        if (!isMissionUnlocked(mission, this.meta?.reputationTier ?? 1)) {
            this.pushNews(`${mission.narrativeName} needs REP tier ${repTierRequiredForMission(mission)} clearance.`);
            return;
        }
        if (this._selectedMissionDispatch === 'idle' && this._idleMissions.length >= this._maxIdleAssignments()) return;

        const now = Date.now();
        const missionResult = this._resolveMissionForDispatch(mission, ship, crew);

        // P4: for idle dispatches, populate real ore rewards using the same
        // catalog derivation that buildIdleMissions uses (common + rare split).
        let rewardOres = missionResult.rewardOres;
        if (this._selectedMissionDispatch === 'idle') {
            const idleOffers = buildIdleMissions(this._missions);
            const offer = idleOffers.find((o) => o.sourceMissionId === mission.id || o.id === `idle-${mission.id}`);
            if (offer && offer.rewardOres) {
                rewardOres = offer.rewardOres;
            }
        }

        const jobId = `dispatch-${this._idleMissionSeq++}`;
        const job = {
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
            rewardOres,
            shipId: ship.id,
            shipName: ship.name,
            crewId: crew.id,
            crewName: crew.name,
            startedAt: now,
            etaSec: missionResult.etaSec,
            endsAt: now + missionResult.etaSec * 1000,
            claimed: false,
        };

        if (this._selectedMissionDispatch === 'idle') {
            // P4: persist via MetaState (auto-saves + emits change)
            this.meta?.addActiveMission(job);
            // Local cache will be refreshed from meta in the change handler + explicit refresh below
            this._idleMissions.push(job);
        } else {
            this._idleMissions.push(job);
        }

        this.meta?.setShipStatus(ship.id, 'On Mission');
        this.meta?.setCrewStatus(crew.id, 'On Mission');

        if (this._selectedMissionDispatch === 'manual') {
            this._onMissionCardTapped(mission);
        }

        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
    }

    // Called by main.js when a manually-dispatched mission run ends (the
    // player hit CONTINUE on the results screen). Frees the ship + crew
    // that were locked by _dispatchSelectedMission and drops the local
    // job row so they are immediately available for the next dispatch.
    // Without this, a manual run permanently consumed its assets.
    completeManualMission(missionId) {
        if (!missionId) return;
        const idx = this._idleMissions.findIndex(
            (j) => j.missionId === missionId && j.dispatchMode === 'manual' && !j.claimed,
        );
        if (idx === -1) return;
        const job = this._idleMissions[idx];
        this._idleMissions.splice(idx, 1);
        if (job.shipId) this.meta?.setShipStatus(job.shipId, 'Standby');
        if (job.crewId) this.meta?.setCrewStatus(job.crewId, 'Available');
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
    }

    // Thin delegate onto settlement.resolveDispatch so the planner preview
    // and the persisted idle job are priced by exactly the same code.
    _resolveMissionForDispatch(mission, ship, crew) {
        return resolveDispatch({
            mission,
            ship,
            crew,
            effects: this._effects(),
            discoveredSectors: this._sectors(),
        });
    }

    _environmentLevelForMission(mission) {
        return environmentLevelForMission(mission);
    }

    _idleEtaSecForMission(mission, shipTypeMatch) {
        return idleEtaSecForMission(mission, {
            shipTypeMatch,
            effects: this._effects(),
            sectorBonus: null,
        });
    }

    /** Resolved research + station-sector modifiers (never null). */
    _effects() {
        return this.meta?.getEffects ? this.meta.getEffects() : null;
    }

    /** Charted sector ids. */
    _sectors() {
        return this.meta?.discoveredSectorIds ? this.meta.discoveredSectorIds() : [];
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

    // Refresh the research projects shown in the left column when RESEARCH tab is active
    _refreshResearchProjectsPanel() {
        const col = this._nodes?.researchProjects;
        if (!col || !this.meta) return;

        const researchState = this.meta.getResearchState();
        const active = researchState.activeResearches || [];
        const maxSlots = researchState.maxConcurrent || 2;

        // Clear previous content
        col.list.removeChildren();

        const rowH = 78;
        const rowW = HUB_COL_W - 24;

        for (let i = 0; i < maxSlots; i++) {
            const project = active[i];
            const y = i * (rowH + 6);

            const slot = drawTechPanel(rowW, rowH, { accent: project ? 'amber' : 'slate' });
            slot.position.set(0, y);
            col.list.addChild(slot);

            if (project) {
                const node = getAllNodes().find(n => n.id === project.nodeId);
                const title = new Text({
                    text: `${node?.glyph || '??'} ${node ? node.name : project.nodeId}`,
                    style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '700', fill: colors.text.primary }),
                });
                title.position.set(10, 8);
                slot.addChild(title);

                const progress = getResearchProgressForProject(project, node, Date.now());
                const remainingMs = getRemainingMsForProject(project, node, Date.now());
                const totalSec = Math.ceil(remainingMs / 1000);
                const min = Math.floor(totalSec / 60);
                const sec = totalSec % 60;
                const timeStr = `${min}m ${sec}s`;

                const progressText = new Text({
                    text: `${Math.round(progress * 100)}%  ·  ${timeStr}`,
                    style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: colors.status.warning }),
                });
                progressText.position.set(10, 28);
                slot.addChild(progressText);

                const cancel = buildSimpleButton({
                    text: 'CANCEL',
                    width: 70,
                    height: 22,
                    accent: 'rose',
                    onTap: () => {
                        this.meta.cancelResearch(project.nodeId);
                        this._refreshResearchProjectsPanel();
                        // Also refresh the research tab if open
                        this._nodes?.tabs?.research?._refreshFromMeta?.();
                    },
                });
                cancel.container.position.set(rowW - 80, 42);
                slot.addChild(cancel.container);

                // Optional: Resume button if paused (startedAt === 0)
                if (project.startedAt === 0) {
                    const resume = buildSimpleButton({
                        text: 'RESUME',
                        width: 70,
                        height: 22,
                        accent: 'cyan',
                        onTap: () => {
                            this.meta.resumeResearch(project.nodeId);
                            this._refreshResearchProjectsPanel();
                            this._nodes?.tabs?.research?._refreshFromMeta?.();
                        },
                    });
                    resume.container.position.set(rowW - 160, 42);
                    slot.addChild(resume.container);
                }
            } else {
                const empty = new Text({
                    text: 'Empty Research Slot',
                    style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fill: colors.text.muted }),
                });
                empty.position.set(10, 28);
                slot.addChild(empty);
            }
        }
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
        left.emptyOffset = 0;

        // WELCOME BACK banner: idle contracts store absolute end times, so
        // anything that finished while the tab was closed is already
        // claimable. The banner says so out loud instead of leaving the
        // player to notice a number changed.
        this._destroyWelcomeBanner();
        let rowOffset = 0;
        const banner = this._buildWelcomeBanner(HUB_COL_W - 24);
        if (banner) {
            banner.container.position.set(0, 0);
            left.list.addChild(banner.container);
            this._welcomeBanner = banner;
            rowOffset = WELCOME_BANNER_H + 10;
            left.emptyOffset = rowOffset;
        }

        if (this._idleMissions.length === 0) {
            left.empty.position.set(0, rowOffset);
            left.list.addChild(left.empty);
            return;
        }
        const rowW = HUB_COL_W - 24;
        const now = Date.now();
        this._idleMissions.forEach((job, i) => {
            const state = computeJobState(job, now);
            const row = this._buildActiveIdleRow(job, rowW, state.remainingSec, state.done);
            row.container.y = rowOffset + i * 118;
            left.list.addChild(row.container);
            left.rows.push(row);
        });
    }

    _destroyWelcomeBanner() {
        if (!this._welcomeBanner) return;
        const node = this._welcomeBanner.container;
        if (node?.parent) node.parent.removeChild(node);
        node?.destroy({ children: true });
        this._welcomeBanner = null;
    }

    /** Returns null when there is nothing to welcome the player back to. */
    _buildWelcomeBanner(w) {
        const summary = this._offlineSummary;
        if (!summary || !summary.completed || summary.completed.length === 0) return null;

        const container = new Container();
        const frame = drawTechPanel(w, WELCOME_BANNER_H, { accent: 'green' });
        container.addChild(frame);

        const title = new Text({
            text: 'WELCOME BACK',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '800', letterSpacing: 2, fill: colors.status.success }),
        });
        title.position.set(12, 8);
        frame.addChild(title);

        const away = new Text({
            text: `Away ${summary.awayLabel} · ${summary.completed.length} contract${summary.completed.length === 1 ? '' : 's'} finished`,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: colors.text.muted, wordWrap: true, wordWrapWidth: w - 24 }),
        });
        away.position.set(12, 26);
        frame.addChild(away);

        const payout = new Text({
            text: `${summary.credits.toLocaleString('en-US')} CR · ${summary.oreUnits} ore lanes waiting`,
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 11, fill: colors.status.warning }),
        });
        payout.position.set(12, 44);
        frame.addChild(payout);

        const claimAll = buildSimpleButton({
            text: 'CLAIM ALL',
            width: w - 24,
            height: 26,
            accent: 'green',
            onTap: () => {
                const claimed = this.claimAllReadyMissions();
                this.pushNews(`${claimed} idle contract${claimed === 1 ? '' : 's'} claimed after ${summary.awayLabel} away.`);
            },
        });
        claimAll.container.position.set(12, WELCOME_BANNER_H - 34);
        frame.addChild(claimAll.container);

        return { container, frame, title, away, payout, claimAll };
    }

    _reconcileIdleMissionState() {
        if (!this.meta) return;

        // P4: primary source of truth is now the persisted list in MetaState.
        // Hydrate local working copy from meta (defensive deep-ish copy).
        const persisted = this.meta.activeMissionsSnapshot ? this.meta.activeMissionsSnapshot() : [];
        // Merge any local-only jobs that haven't been persisted yet (race on first dispatch)
        const localOnly = this._idleMissions.filter((j) => !persisted.some((p) => p.id === j.id));
        this._idleMissions = [...persisted, ...localOnly];

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

        // Only fabricate recovery placeholders for truly orphaned "On Mission" assets
        // (defensive; real jobs should come from persisted activeMissions).
        const orphanShips = fleet.filter((ship) => ship.status === 'On Mission' && !usedShips.has(ship.id));
        const orphanCrew = crew.filter((member) => member.status === 'On Mission' && !usedCrew.has(member.id));
        const pairCount = Math.min(orphanShips.length, orphanCrew.length);
        for (let i = 0; i < pairCount; i += 1) {
            const ship = orphanShips[i];
            const member = orphanCrew[i];
            const rec = makeRecoveryJob(ship, member, this._idleMissionSeq++);
            this._idleMissions.push(rec);
            usedShips.add(ship.id);
            usedCrew.add(member.id);
            // Also persist the recovery so it survives the next reload
            this.meta.addActiveMission?.(rec);
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

        // P8: the partial payout is a settlement like any other — same
        // crew/hull/rep rules, `aborted: true` zeroes the ore + XP and
        // pays the elapsed fraction of the contract. One atomic write
        // banks it and retires the job (ship + crew released).
        const settlement = this._settleJob(job, { aborted: true });
        if (this.meta) this.meta.settleActiveMission(jobId, settlement);
        this.pushNews(`${job.title} returned early \u2014 ${settlement.credits.toLocaleString('en-US')} CR salvaged.`);

        // Keep local cache in sync (meta change handler will also refresh)
        this._idleMissions = this._idleMissions.filter((m) => m.id !== jobId);
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
    }

    _claimIdleMission(jobId) {
        const idx = this._idleMissions.findIndex((m) => m.id === jobId);
        if (idx < 0) return null;
        const job = this._idleMissions[idx];

        // P8: one settlement covers credits, ores, rep, crew XP, hull wear
        // and any warp cell the fleet brought home. `applySettlement`
        // mutates + saves in a single change event; the job record is then
        // removed and its ship/crew released by claimActiveMission.
        const settlement = this._settleJob(job, { aborted: false });
        if (this.meta) this.meta.settleActiveMission(jobId, settlement);
        this._announceSettlement(settlement);

        this._idleMissions.splice(idx, 1);
        this._refreshActiveIdleMissions();
        this._refreshMissionPlanner();
        this._refreshFleetCrewPanel();
        return settlement;
    }

    /**
     * Claim every ready contract at once — the WELCOME BACK action after
     * an offline stretch. Returns the number of contracts claimed.
     */
    claimAllReadyMissions() {
        const now = Date.now();
        const ready = this._idleMissions.filter((job) => computeJobState(job, now).done);
        ready.forEach((job) => this._claimIdleMission(job.id));
        this._offlineSummary = null;
        this._refreshActiveIdleMissions();
        return ready.length;
    }

    // Build a settlement for a persisted idle job: look the ship + crew up
    // in MetaState so hull wear and XP land on the right records.
    _settleJob(job, { aborted = false } = {}) {
        const nowMs = Date.now();
        const mission = this._missions.find((m) => m.id === job.missionId) || null;
        const ship = this.meta?.fleetSnapshot().find((s) => s.id === job.shipId) || null;
        const crew = this.meta?.crewSnapshot().find((c) => c.id === job.crewId) || null;
        return settleMission({
            mission: mission || { id: job.missionId, risk: job.risk, type: job.type, sector: job.sector, tierIndex: 1 },
            job,
            ship,
            crew,
            effects: this._effects(),
            discoveredSectors: this._sectors(),
            dispatchMode: 'idle',
            won: !aborted,
            aborted,
            nowMs,
        });
    }

    // One-line Galactic News entry for a finished contract, plus a rep
    // promotion call-out when the payout crossed a rank boundary.
    _announceSettlement(settlement) {
        if (!settlement) return;
        const parts = [`${settlement.title} paid ${settlement.credits.toLocaleString('en-US')} CR`];
        if (settlement.rep > 0) parts.push(`+${settlement.rep} REP`);
        if (settlement.warp > 0) parts.push(`+${settlement.warp} warp`);
        this.pushNews(parts.join(' · ') + '.');
    }

    /**
     * Prepend a runtime headline to the Galactic News ticker. Keeps the
     * last few so the strip stays a live feed instead of static flavor.
     */
    pushNews(text) {
        if (!text) return;
        this._newsRuntime = [String(text), ...this._newsRuntime].slice(0, 4);
        const body = this._nodes?.news?.body;
        if (body) body.text = [...this._newsRuntime, ...HUB_NEWS_POOL].join('   \u25C7   ');
    }

    /**
     * Offline report handed in by main.js at boot. Renders the WELCOME
     * BACK banner over the idle fleet list until the player claims.
     */
    setOfflineSummary(summary) {
        this._offlineSummary = summary && summary.completed?.length ? summary : null;
        if (this._nodes) this._refreshActiveIdleMissions();
    }

    /**
     * The manual-dispatch job record for a mission, so main.js can settle
     * a finished run against the ship + crew the player actually sent.
     */
    getPendingManualDispatch(missionId) {
        if (!missionId) return null;
        return this._idleMissions.find(
            (j) => j.missionId === missionId && j.dispatchMode === 'manual' && !j.claimed,
        ) || null;
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
        if (!isMissionUnlocked(mission, this.meta?.reputationTier ?? 1)) {
            const required = repTierRequiredForMission(mission);
            this.pushNews(`${mission.narrativeName} needs REP tier ${required} clearance.`);
            return;
        }
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
        const safeW = (typeof w === 'number' && Number.isFinite(w) && w > 0) ? w : HUB_MIN_LAYOUT_W;
        const safeH = (typeof h === 'number' && Number.isFinite(h) && h > 0) ? h : HUB_MIN_LAYOUT_H;
        // Keep the desktop-first hub shell intact and scale it down as a
        // single surface when the viewport is narrower than the layout's
        // minimum width/height. This avoids panel overlap on phones while
        // preserving one authoritative set of hub coordinates.
        const scale = Math.min(safeW / HUB_MIN_LAYOUT_W, safeH / HUB_MIN_LAYOUT_H, 1);
        const vw = Math.max(HUB_MIN_LAYOUT_W, safeW / scale);
        const vh = Math.max(HUB_MIN_LAYOUT_H, safeH / scale);
        n.root.scale.set(scale);
        n.root.position.set(
            Math.round((safeW - (vw * scale)) / 2),
            Math.round((safeH - (vh * scale)) / 2),
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
        this._layoutColumnPanel(n.researchProjects, leftX, columnsY, HUB_COL_W, columnsH);
        this._layoutColumnPanel(n.sidePanel, leftX, columnsY, HUB_COL_W, columnsH);
        // The owning tab re-fits its own content after the frame is sized.
        this._layoutSidePanel();
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

        // Gear sits at the far right edge; the reset control sits left of it.
        topBar.gear.position.set(w - 24, h / 2);
        topBar.reset.position.set(w - 78, h / 2);

        // Resource chips flex between the dispatcher badge and the controls.
        // The REP chip is wider because it carries the rank title.
        const chipGap = 14;
        const chipW = 88;
        const repW = 132;
        const widths = topBar.chips.map((chip) => (chip.wide ? repW : chipW));
        const stripW = widths.reduce((sum, cw) => sum + cw, 0) + (widths.length - 1) * chipGap;
        const stripRight = w - 116;
        const stripLeft = stripRight - stripW;
        let cursor = stripLeft;
        topBar.chips.forEach((chip, i) => {
            const cw = widths[i];
            chip.container.position.set(cursor, h / 2 - 18);
            redrawTechChip(chip.frame, cw, 36, { accent: chip.color });
            chip.labelText.position.set(10, 10);
            chip.valueText.position.set(10, 22);
            cursor += cw + chipGap;
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
        if (!col) return;
        col.container.position.set(x, y);
        // Remember the fitted size: `_layoutSidePanel()` hands it to the
        // tab that owns the panel so its content can re-fit too.
        col._w = w;
        col._h = h;
        redrawTechPanel(col.panel, w, h, { accent: col.panelAccent ?? 'cyan' });
        if (col.counter) col.counter.position.set(w - 14, 12);
        if (col.list) col.list.position.set(12, 40);
        if (col.empty) {
            // Keep the sky-400 accent set by _buildActiveMissions;
            // re-using the default cyan here would mute the empty card
            // against the panel border. `emptyOffset` leaves room for the
            // WELCOME BACK banner when one is showing.
            redrawTechPanel(col.empty, w - 24, 108, { accent: 'cyan' });
            col.empty.position.set(0, col.emptyOffset || 0);
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
            const raw = t?.bg?.width;
            return (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) ? raw : 136;
        });
        const totalBaseW = baseWidths.reduce((sum, bw) => sum + bw, 0) + gap * Math.max(0, nav.tabs.length - 1);
        const groupScale = totalBaseW > totalInner ? totalInner / totalBaseW : 1;
        const contentW = totalBaseW * groupScale;
        let cursorX = pad + Math.round((totalInner - contentW) / 2);
        if (!Number.isFinite(cursorX)) cursorX = pad;

        nav.tabs.forEach((t, i) => {
            const btnW = baseWidths[i];
            const rawH = t?.bg?.height;
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
