// ResearchTab -- second extracted hub-tab scene. Mounts into the hub's
// center panel when the user clicks the RESEARCH bottom-nav tab. See
// ADR-0010 (hub tab scenes) for the contract + rationale.
//
// Visual: "RESEARCH: TECHNOLOGY TREE" title strip + 4 category columns
// (Propulsion, Resource Extraction, Defense, Economics) of hex nodes
// connected by prerequisite edges, plus a floating DETAIL card for the
// selected node (cost / ETA / INITIATE RESEARCH button / effect blurb).
//
// The scene is purely presentational for now -- tech-tree data is
// static, INITIATE RESEARCH is a stub. Real research ticking + cost
// deduction + upgrade-apply lands in a later phase (ROADMAP P8).

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildStartButton,
} from '../../pixi-ui-kit.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_SLATE_600 = 0x475569;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_AMBER_500 = 0xf59e0b;
const COLOR_ROSE_300 = 0xfda4af;
const COLOR_EMERALD_300 = 0x6ee7b7;

// Node-state visual tokens. Kept at module scope so the legend /
// detail-card status line + node glyph share one palette.
const NODE_STATE = Object.freeze({
    locked:     { stroke: COLOR_SLATE_600, fill: 0x0b1424, label: 'Locked',             labelColor: COLOR_ROSE_300,   icon: COLOR_SLATE_600 },
    available:  { stroke: COLOR_CYAN_300,  fill: 0x0b1424, label: 'Available',          labelColor: COLOR_CYAN_300,   icon: COLOR_CYAN_300 },
    researching:{ stroke: COLOR_AMBER_300, fill: 0x1c1207, label: 'Currently Researching', labelColor: COLOR_AMBER_300, icon: COLOR_AMBER_300 },
    completed:  { stroke: COLOR_EMERALD_300, fill: 0x042f1f, label: 'Completed',         labelColor: COLOR_EMERALD_300, icon: COLOR_EMERALD_300 },
});

// Category columns, left-to-right. `nx` is the normalized horizontal
// center of the column (0..1) inside the tree region.
const CATEGORIES = Object.freeze([
    { id: 'propulsion', label: 'Propulsion',         nx: 0.12 },
    { id: 'extraction', label: 'Resource Extraction', nx: 0.38 },
    { id: 'defense',    label: 'Defense',             nx: 0.64 },
    { id: 'economics',  label: 'Economics',           nx: 0.88 },
]);

// Tech-tree node catalog. `ny` is the normalized vertical position
// (0..1) inside the tree region. `glyph` is a compact char/emoji shown
// inside the hex (kept ASCII-safe for font reliability).
const NODES = Object.freeze([
    // Propulsion
    { id: 'ion-thrusters',     category: 'propulsion', name: 'Ion Thrusters',        level: 3, ny: 0.22, state: 'locked',      glyph: '>>', effect: 'Increase fleet cruise speed. Reduces mission ETA by 8%.',                               cost: { minerals: 600, credits: 1200 }, time: '5h 00m' },
    { id: 'warp-coils',        category: 'propulsion', name: 'Warp Coils',           level: 2, ny: 0.50, state: 'available',   glyph: '~~', effect: 'Cut warp-cell consumption for long-range plots by 1.',                                cost: { minerals: 500, credits: 900  }, time: '3h 45m' },
    { id: 'fuel-cell',         category: 'propulsion', name: 'Compact Fuel Cell',    level: 1, ny: 0.78, state: 'completed',   glyph: '[]', effect: 'Doubles fleet fuel reserves. Enables longer missions.',                               cost: { minerals: 300, credits: 500  }, time: '1h 30m' },

    // Resource Extraction
    { id: 'mining-laser',      category: 'extraction', name: 'Advanced Mining Laser',level: 4, ny: 0.30, state: 'available',   glyph: '//', effect: 'Advanced mining laser. Increased cost by rocky planets, increase of time; 3 more effects.', cost: { minerals: 800, credits: 1500 }, time: '6h 30m' },
    { id: 'refinery',          category: 'extraction', name: 'Refinery Throughput',  level: 2, ny: 0.58, state: 'locked',      glyph: 'Rf', effect: 'Refinery converts 15% more ore per hour.',                                          cost: { minerals: 700, credits: 1300 }, time: '5h 00m' },
    { id: 'deep-scanner',      category: 'extraction', name: 'Deep Scanner',         level: 1, ny: 0.84, state: 'completed',   glyph: '()', effect: 'Reveals rare-ore bonus tiles on the mining board.',                                cost: { minerals: 400, credits: 800  }, time: '2h 00m' },

    // Defense
    { id: 'hull-plating',      category: 'defense',    name: 'Hull Plating',         level: 2, ny: 0.26, state: 'available',   glyph: '##', effect: 'Fleet hull takes 12% less damage on high-risk missions.',                           cost: { minerals: 650, credits: 1100 }, time: '4h 15m' },
    { id: 'shield-array',      category: 'defense',    name: 'Shield Array',         level: 1, ny: 0.54, state: 'locked',      glyph: '()', effect: 'Equip shield array on cruiser-class ships. Blocks one hull hit per run.',           cost: { minerals: 900, credits: 1700 }, time: '7h 00m' },
    { id: 'countermeasures',   category: 'defense',    name: 'Countermeasures',      level: 1, ny: 0.82, state: 'locked',      glyph: '!!', effect: 'Auto-reroll one unlucky risk event per mission.',                                   cost: { minerals: 1100, credits: 2200 }, time: '9h 30m' },

    // Economics
    { id: 'habitat-extension', category: 'economics',  name: 'Habitat Extension',    level: 2, ny: 0.32, state: 'researching', glyph: 'Hb', effect: '+1 crew slot on NOVA STATION. Unlocks tier-II contracts.',                         cost: { minerals: 550, credits: 1000 }, time: '4h 30m', progress: 0.65, eta: '02:45:00' },
    { id: 'trade-compact',     category: 'economics',  name: 'Trade Compact',        level: 1, ny: 0.60, state: 'available',   glyph: '$$', effect: 'MARKET tab prices 6% more favorable on sell orders.',                             cost: { minerals: 450, credits: 1400 }, time: '3h 00m' },
    { id: 'reputation-boost',  category: 'economics',  name: 'Reputation Programs',  level: 1, ny: 0.86, state: 'locked',      glyph: '**', effect: 'Reputation gain +10% per completed mission.',                                    cost: { minerals: 700, credits: 1800 }, time: '5h 45m' },
]);

// Prerequisite edges (directed: `from -> to`). Rendered as thin cyan
// polyline connectors so the tree reads as a dependency graph.
const EDGES = Object.freeze([
    { from: 'fuel-cell',         to: 'warp-coils' },
    { from: 'warp-coils',        to: 'ion-thrusters' },
    { from: 'deep-scanner',      to: 'refinery' },
    { from: 'refinery',          to: 'mining-laser' },
    { from: 'warp-coils',        to: 'mining-laser' },
    { from: 'hull-plating',      to: 'shield-array' },
    { from: 'shield-array',      to: 'countermeasures' },
    { from: 'trade-compact',     to: 'habitat-extension' },
    { from: 'reputation-boost',  to: 'trade-compact' },
]);

const HEX_R = 22; // outer radius of a hex node in world pixels.

function drawHex(g, r, { stroke, fill }) {
    g.clear();
    // Flat-top hexagon, 6 vertices at 0, 60, 120, ... degrees.
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6; // pointy-top
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.poly(pts).fill({ color: fill, alpha: 0.9 });
    g.poly(pts).stroke({ color: stroke, width: 1.8, alpha: 0.95 });
}

export class ResearchTab {
    constructor({ parent }) {
        if (!parent) throw new Error('ResearchTab: parent container is required');
        this.parent = parent;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedId = 'mining-laser'; // Mock shows this as the default selection.
    }

    // ----------------------------------------------------------------
    // Scene / tab contract
    // ----------------------------------------------------------------

    get visible() {
        return !!this.root.visible;
    }

    show() {
        if (!this._nodes) this._build();
        this.root.visible = true;
        // Re-open the detail card for whatever was previously selected
        // so tab switches do not silently drop the selection.
        if (this._nodes && this._selectedId) this._refreshDetail();
    }

    hide() {
        this.root.visible = false;
    }

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

    // ----------------------------------------------------------------
    // Build (once, on first show)
    // ----------------------------------------------------------------

    _build() {
        const root = this.root;

        // Title strip (top-left).
        const title = new Text({
            text: 'RESEARCH  \u00B7  TECHNOLOGY TREE',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: '800',
                letterSpacing: 2,
                fill: COLOR_AMBER_300,
            }),
        });
        title.position.set(16, 12);
        root.addChild(title);

        // Category headers.
        const categoryLabels = CATEGORIES.map((cat) => {
            const text = new Text({
                text: cat.label,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    fontWeight: '700',
                    fill: COLOR_SLATE_200,
                    letterSpacing: 1,
                }),
            });
            text.anchor.set(0.5, 0);
            root.addChild(text);
            return { cat, text };
        });

        // Edges first so nodes render on top.
        const edges = new Graphics();
        root.addChild(edges);

        // Hex nodes.
        const nodes = NODES.map((node) => {
            const container = new Container();
            container.eventMode = 'static';
            container.cursor = 'pointer';

            const state = NODE_STATE[node.state] || NODE_STATE.locked;
            const hex = new Graphics();
            drawHex(hex, HEX_R, state);
            container.addChild(hex);

            const glyph = new Text({
                text: node.glyph,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    fontWeight: '800',
                    fill: state.icon,
                }),
            });
            glyph.anchor.set(0.5);
            container.addChild(glyph);

            // Level pill at the bottom of the hex.
            const lvl = new Text({
                text: `L${node.level}`,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 9,
                    fontWeight: '700',
                    fill: COLOR_SLATE_200,
                    stroke: { color: 0x020617, width: 3, alpha: 0.9 },
                }),
            });
            lvl.anchor.set(0.5);
            lvl.position.set(0, HEX_R + 2);
            container.addChild(lvl);

            // Name label under the level pill.
            const nameText = new Text({
                text: node.name,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 10,
                    fill: COLOR_SLATE_400,
                    stroke: { color: 0x020617, width: 3, alpha: 0.85 },
                    align: 'center',
                    wordWrap: true,
                    wordWrapWidth: 110,
                }),
            });
            nameText.anchor.set(0.5, 0);
            nameText.position.set(0, HEX_R + 14);
            container.addChild(nameText);

            container.on('pointertap', () => this._onNodeTapped(node));
            container.hitArea = new Rectangle(-HEX_R, -HEX_R, HEX_R * 2, HEX_R * 2 + 20);
            root.addChild(container);

            return { node, container, hex, glyph, lvl, nameText };
        });

        // Floating DETAIL card (right side of the tree).
        const detail = this._buildDetail();
        root.addChild(detail.container);

        // Legend strip (bottom-left, small).
        const legend = this._buildLegend();
        root.addChild(legend.container);

        this._nodes = { title, categoryLabels, edges, nodes, detail, legend };
        this._refreshDetail();
    }

    _buildDetail() {
        const container = new Container();
        const panel = drawHologramPanel(260, 210, { accent: COLOR_AMBER_500 });
        container.addChild(panel);

        const header = panelLabel('RESEARCH NODE', COLOR_AMBER_300, { size: 11 });
        header.position.set(12, 10);
        panel.addChild(header);

        const name = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: '700',
                fill: COLOR_SLATE_200,
            }),
        });
        name.position.set(12, 28);
        panel.addChild(name);

        const status = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fontWeight: '600',
                fill: COLOR_CYAN_300,
            }),
        });
        status.position.set(12, 48);
        panel.addChild(status);

        // Cost row: "<minerals> minerals   <credits> credits   <time>"
        const costLine = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_SLATE_200,
            }),
        });
        costLine.position.set(12, 70);
        panel.addChild(costLine);

        // Progress bar (only visible when state = researching).
        const progressBg = new Graphics();
        panel.addChild(progressBg);
        const progressFill = new Graphics();
        panel.addChild(progressFill);
        const progressText = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '700',
                fill: COLOR_AMBER_300,
            }),
        });
        progressText.position.set(12, 90);
        panel.addChild(progressText);

        // Effect blurb.
        const effect = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_SLATE_400,
                wordWrap: true,
                wordWrapWidth: 236,
                lineHeight: 14,
            }),
        });
        effect.position.set(12, 112);
        panel.addChild(effect);

        // CTA button (INITIATE RESEARCH / VIEW PROGRESS / etc.).
        const cta = buildStartButton({
            text: 'INITIATE RESEARCH',
            width: 200,
            height: 30,
            onTap: () => this._onInitiateResearch(),
        });
        cta.container.position.set(12, 170);
        panel.addChild(cta.container);

        return { container, panel, header, name, status, costLine, progressBg, progressFill, progressText, effect, cta, width: 260, height: 210 };
    }

    _buildLegend() {
        const container = new Container();
        const panel = drawHologramPanel(220, 76, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('NODE STATES', COLOR_CYAN_300, { size: 10 });
        header.position.set(10, 8);
        panel.addChild(header);

        const states = [
            { key: 'available',   color: NODE_STATE.available.stroke,   label: 'Available' },
            { key: 'researching', color: NODE_STATE.researching.stroke, label: 'Researching' },
            { key: 'completed',   color: NODE_STATE.completed.stroke,   label: 'Completed' },
            { key: 'locked',      color: NODE_STATE.locked.stroke,      label: 'Locked' },
        ];
        const rows = states.map((s, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = 14 + col * 104;
            const y = 28 + row * 18;
            const dot = new Graphics();
            dot.circle(0, 0, 4).fill({ color: s.color, alpha: 0.95 });
            dot.position.set(x, y + 6);
            panel.addChild(dot);
            const text = new Text({
                text: s.label,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 10,
                    fill: COLOR_SLATE_200,
                }),
            });
            text.position.set(x + 10, y);
            panel.addChild(text);
            return { key: s.key, dot, text };
        });

        return { container, panel, header, rows, width: 220, height: 76 };
    }

    // ----------------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------------

    _onNodeTapped(node) {
        this._selectedId = node.id;
        this._refreshDetail();
    }

    _onInitiateResearch() {
        // Stub -- real research-ticking + cost deduction lands under
        // ROADMAP P8. For now the button is a visual affordance.
    }

    _refreshDetail() {
        const n = this._nodes;
        if (!n) return;
        const sel = NODES.find((x) => x.id === this._selectedId);
        if (!sel) return;
        const state = NODE_STATE[sel.state] || NODE_STATE.locked;
        const d = n.detail;

        d.name.text = `${sel.name} Lvl ${sel.level}`;
        d.status.text = state.label;
        d.status.style.fill = state.labelColor;

        const costParts = [];
        if (sel.cost?.minerals) costParts.push(`${sel.cost.minerals} minerals`);
        if (sel.cost?.credits)  costParts.push(`${sel.cost.credits} credits`);
        if (sel.time)           costParts.push(sel.time);
        d.costLine.text = costParts.join('   \u00B7   ');
        d.costLine.visible = sel.state !== 'completed';

        d.effect.text = sel.effect || '';
        const effectY = sel.state === 'researching' ? 112 : 94;
        d.effect.position.set(12, effectY);

        // Progress bar: only for researching state.
        const showProgress = sel.state === 'researching';
        d.progressBg.clear();
        d.progressFill.clear();
        d.progressText.text = '';
        if (showProgress) {
            const pct = Math.max(0, Math.min(1, sel.progress || 0));
            const barW = 236;
            const barX = 12;
            const barY = 88;
            d.progressBg.roundRect(barX, barY, barW, 6, 3).fill({ color: 0x1e293b, alpha: 0.9 });
            d.progressBg.roundRect(barX, barY, barW, 6, 3).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.4 });
            d.progressFill.roundRect(barX, barY, barW * pct, 6, 3).fill({ color: COLOR_AMBER_300, alpha: 0.9 });
            d.progressText.text = `${Math.round(pct * 100)}%  \u00B7  ETA ${sel.eta || '--:--:--'}`;
            d.progressText.position.set(12, 96);
        }

        // CTA copy + visibility per state.
        const ctaText = {
            available:   'INITIATE RESEARCH',
            locked:      'PREREQUISITES LOCKED',
            researching: 'VIEW PROGRESS',
            completed:   'COMPLETED',
        }[sel.state] || 'INITIATE RESEARCH';
        d.cta.label.text = ctaText;
        d.cta.container.visible = sel.state !== 'completed';
        // Dim the CTA for locked nodes; the button is inert either way
        // because the onTap handler is a stub, but the dim reads right.
        d.cta.container.alpha = sel.state === 'locked' ? 0.45 : 1.0;

        // Highlight the selected hex with an amber outer glow ring.
        n.nodes.forEach(({ node, hex }) => {
            const st = NODE_STATE[node.state] || NODE_STATE.locked;
            drawHex(hex, HEX_R, st);
            if (node.id === this._selectedId) {
                hex.poly([
                    ...buildHexPoints(HEX_R + 4),
                ]).stroke({ color: COLOR_AMBER_300, width: 1.5, alpha: 0.85 });
            }
        });
    }

    // ----------------------------------------------------------------
    // Layout (re-run on every viewport change)
    // ----------------------------------------------------------------

    _layout(w, h) {
        const n = this._nodes;
        if (!n) return;
        this._lastW = w;
        this._lastH = h;

        // Detail card sits in the right third. Tree region is the left
        // ~60% of the panel so the detail card is always visible next
        // to the tree -- matches the mock.
        const pad = 20;
        const detailW = n.detail.width;
        const detailH = n.detail.height;
        const treeX = pad;
        const treeY = 44;
        const treeW = Math.max(360, w - pad * 3 - detailW);
        const treeH = Math.max(240, h - treeY - pad);

        // Category headers.
        n.categoryLabels.forEach(({ cat, text }) => {
            text.position.set(treeX + cat.nx * treeW, treeY + 2);
        });

        // Compute per-node screen positions.
        const nodePos = new Map();
        NODES.forEach((node) => {
            const cat = CATEGORIES.find((c) => c.id === node.category);
            const nx = cat ? cat.nx : 0.5;
            const x = treeX + nx * treeW;
            const y = treeY + 30 + node.ny * (treeH - 50);
            nodePos.set(node.id, { x, y });
        });

        // Position each hex container + redraw highlight for selection.
        n.nodes.forEach(({ node, container }) => {
            const p = nodePos.get(node.id);
            if (p) container.position.set(p.x, p.y);
        });

        // Draw prerequisite edges behind nodes.
        n.edges.clear();
        EDGES.forEach(({ from, to }) => {
            const a = nodePos.get(from);
            const b = nodePos.get(to);
            if (!a || !b) return;
            // Orthogonal-ish routing: horizontal then vertical when
            // nodes sit in different columns, straight otherwise.
            n.edges.moveTo(a.x, a.y);
            if (Math.abs(a.x - b.x) > 8) {
                const midX = (a.x + b.x) / 2;
                n.edges.lineTo(midX, a.y).lineTo(midX, b.y).lineTo(b.x, b.y);
            } else {
                n.edges.lineTo(b.x, b.y);
            }
            n.edges.stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.28 });
        });

        // Refresh the selection highlight now that positions moved.
        this._refreshDetail();

        // Detail card: right side, vertically centered inside the panel.
        const detailX = treeX + treeW + pad;
        const detailY = treeY + Math.max(0, (treeH - detailH) / 2);
        redrawHologramPanel(n.detail.panel, detailW, detailH, COLOR_AMBER_500);
        n.detail.container.position.set(detailX, detailY);

        // Legend: bottom-left of the tree area.
        redrawHologramPanel(n.legend.panel, n.legend.width, n.legend.height, COLOR_CYAN_500);
        n.legend.container.position.set(treeX, treeY + treeH - n.legend.height - 4);
    }
}

// Module-local helper used for the selection outline ring.
function buildHexPoints(r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return pts;
}

export { NODES as RESEARCH_NODES, EDGES as RESEARCH_EDGES, CATEGORIES as RESEARCH_CATEGORIES };
