// ResearchTab -- second extracted hub-tab scene. Mounts into the hub's
// center panel when the user clicks the RESEARCH bottom-nav tab.
//
// Now fully functional: pulls live state from MetaState, supports
// initiating research (with cost checks), shows live ticking progress,
// and persists completed + in-progress research across reloads.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildStartButton,
} from '../../pixi-ui-kit.js';

import {
    getNodeView,
    getResearchProgress,
    getRemainingMs,
    isNodeAvailable,
    getAllNodes,
    getPrerequisites,
    RESEARCH_CATEGORIES as CATEGORIES,
    RESEARCH_NODES as NODES,
    RESEARCH_EDGES as EDGES,
} from '../../research.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_SLATE_600 = 0x475569;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_AMBER_500 = 0xf59e0b;
const COLOR_ROSE_300 = 0xfda4af;
const COLOR_EMERALD_300 = 0x6ee7b7;

// Node-state visual tokens (kept here for the tab's rendering)
const NODE_STATE = Object.freeze({
    locked:     { stroke: COLOR_SLATE_600, fill: 0x0b1424, label: 'Locked',             labelColor: COLOR_ROSE_300,   icon: COLOR_SLATE_600 },
    available:  { stroke: COLOR_CYAN_300,  fill: 0x0b1424, label: 'Available',          labelColor: COLOR_CYAN_300,   icon: COLOR_CYAN_300 },
    researching:{ stroke: COLOR_AMBER_300, fill: 0x1c1207, label: 'Currently Researching', labelColor: COLOR_AMBER_300, icon: COLOR_AMBER_300 },
    completed:  { stroke: COLOR_EMERALD_300, fill: 0x042f1f, label: 'Completed',         labelColor: COLOR_EMERALD_300, icon: COLOR_EMERALD_300 },
});

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
    constructor({ parent, meta = null }) {
        if (!parent) throw new Error('ResearchTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedId = 'mining-laser'; // Default selection
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
        this._refreshFromMeta();
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

        // Hex nodes - now driven by live MetaState via the pure research module
        const researchState = this._getCurrentResearchState();
        const liveNodes = getAllNodes().map((baseNode) => {
            const view = getNodeView(baseNode.id, researchState) || baseNode;
            const container = new Container();
            container.eventMode = 'static';
            container.cursor = 'pointer';

            const state = NODE_STATE[view.state] || NODE_STATE.locked;
            const hex = new Graphics();
            drawHex(hex, HEX_R, state);
            container.addChild(hex);

            const glyph = new Text({
                text: view.glyph,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    fontWeight: '800',
                    fill: state.icon,
                }),
            });
            glyph.anchor.set(0.5);
            container.addChild(glyph);

            const lvl = new Text({
                text: `L${view.level}`,
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

            const nameText = new Text({
                text: view.name,
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

            // Store the id for later lookup instead of the full static node
            container.on('pointertap', () => this._onNodeTapped({ id: view.id }));
            container.hitArea = new Rectangle(-HEX_R, -HEX_R, HEX_R * 2, HEX_R * 2 + 20);
            root.addChild(container);

            return { node: view, container, hex, glyph, lvl, nameText };
        });

        // Floating DETAIL card (right side of the tree).
        const detail = this._buildDetail();
        root.addChild(detail.container);

        // Legend strip (bottom-left, small).
        const legend = this._buildLegend();
        root.addChild(legend.container);

        // Research slots panel (left side when in research view)
        const researchSlots = this._buildResearchSlots();
        root.addChild(researchSlots.container);

        this._nodes = { title, categoryLabels, edges, nodes: liveNodes, detail, legend, researchSlots };
        this._refreshDetail();
    }

    _getCurrentResearchState() {
        if (this.meta && typeof this.meta.getResearchState === 'function') {
            return this.meta.getResearchState();
        }
        return { completed: [], researching: null };
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

        // CTA button (INITIATE / CANCEL / RESUME).
        const cta = buildStartButton({
            text: 'INITIATE RESEARCH',
            width: 200,
            height: 30,
            onTap: () => this._onResearchCta(),
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

    // Simple panel showing current research slots (2 by default)
    _buildResearchSlots() {
        const container = new Container();
        const panel = drawHologramPanel(260, 180, { accent: COLOR_AMBER_500 });
        container.addChild(panel);

        const header = panelLabel('ACTIVE RESEARCH', COLOR_AMBER_300, { size: 11 });
        header.position.set(12, 8);
        panel.addChild(header);

        const researchState = this._getCurrentResearchState();
        const active = researchState.activeResearches || [];
        const maxSlots = researchState.maxConcurrent || 2;

        const slotY = 32;
        const slotHeight = 60;

        for (let i = 0; i < maxSlots; i++) {
            const project = active[i];
            const y = slotY + i * slotHeight;

            const slotPanel = drawHologramPanel(236, 52, { accent: project ? COLOR_AMBER_300 : COLOR_SLATE_600 });
            slotPanel.position.set(12, y);
            panel.addChild(slotPanel);

            if (project) {
                const node = getAllNodes().find(n => n.id === project.nodeId);
                const name = new Text({
                    text: node ? node.name : project.nodeId,
                    style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: COLOR_SLATE_200 }),
                });
                name.position.set(18, y + 6);
                panel.addChild(name);

                const progress = getResearchProgressForProject(project, node, Date.now());
                const remaining = getRemainingMsForProject(project, node, Date.now());
                const totalSec = Math.ceil(remaining / 1000);
                const min = Math.floor(totalSec / 60);
                const sec = totalSec % 60;
                const timeText = `${min}m ${sec}s`;

                const progressText = new Text({
                    text: `${Math.round(progress * 100)}%  ·  ${timeText}`,
                    style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 10, fill: COLOR_AMBER_300 }),
                });
                progressText.position.set(18, y + 26);
                panel.addChild(progressText);

                const cancelBtn = buildStartButton({
                    text: 'CANCEL',
                    width: 70,
                    height: 22,
                    onTap: () => {
                        this.meta?.cancelResearch(project.nodeId);
                        this._refreshDetail();
                    },
                });
                cancelBtn.container.position.set(170, y + 18);
                panel.addChild(cancelBtn.container);
            } else {
                const empty = new Text({
                    text: 'Empty Slot',
                    style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fill: COLOR_SLATE_400 }),
                });
                empty.position.set(18, y + 18);
                panel.addChild(empty);
            }
        }

        return { container, panel, width: 260, height: 180 };
    }

    // ----------------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------------

    _onNodeTapped(node) {
        this._selectedId = node.id;
        this._refreshDetail();
    }

    // Called by HubScene when MetaState changes (resources or research state)
    _refreshFromMeta() {
        if (this._nodes) {
            this._refreshDetail();
        }
    }

    tick(deltaMs) {
        if (!this._nodes) return;

        const researchState = this._getCurrentResearchState();
        if (researchState.researching) {
            // Always refresh when something is researching (live progress + tree colors)
            this._refreshDetail();

            // Auto-complete when the research timer expires
            const remaining = getRemainingMs(researchState.researching, Date.now());
            if (remaining <= 0) {
                if (this.meta && typeof this.meta.completeResearch === 'function') {
                    this.meta.completeResearch(researchState.researching.nodeId);
                }
                // Force one more refresh after completion
                this._refreshDetail();
            }
        }
    }

    _onResearchCta() {
        if (!this.meta || !this._selectedId) return;

        const node = getAllNodes().find(n => n.id === this._selectedId);
        if (!node) return;

        const researchState = this.meta.getResearchState();
        const isActive = researchState.activeResearches?.some(r => r.nodeId === this._selectedId);

        if (isActive) {
            // Currently researching → Cancel (pause with progress)
            this.meta.cancelResearch(this._selectedId);
        } else {
            // Not active → try to start or resume
            const isPaused = researchState.activeResearches?.some(r => r.nodeId === this._selectedId && r.startedAt === 0);

            if (isPaused) {
                this.meta.resumeResearch(this._selectedId);
            } else {
                // Normal start
                const canAfford =
                    (this.meta.getHubResource('minerals') || 0) >= (node.cost?.minerals || 0) &&
                    (this.meta.getHubResource('credits') || 0) >= (node.cost?.credits || 0);

                if (!canAfford) return;

                if (node.cost?.minerals) this.meta.setHubResource('minerals', this.meta.getHubResource('minerals') - node.cost.minerals);
                if (node.cost?.credits)  this.meta.setHubResource('credits',  this.meta.getHubResource('credits')  - node.cost.credits);

                this.meta.startResearch(this._selectedId);
            }
        }

        this._refreshDetail();
    }

    _refreshDetail() {
        const n = this._nodes;
        if (!n) return;

        const researchState = this._getCurrentResearchState();
        const view = this._selectedId ? getNodeView(this._selectedId, researchState) : null;
        if (!view) return;

        const state = NODE_STATE[view.state] || NODE_STATE.locked;
        const d = n.detail;

        d.name.text = `${view.name} Lvl ${view.level}`;
        d.status.text = state.label;
        d.status.style.fill = state.labelColor;

        const costParts = [];
        if (view.cost?.minerals) costParts.push(`${view.cost.minerals} minerals`);
        if (view.cost?.credits)  costParts.push(`${view.cost.credits} credits`);
        if (view.time)           costParts.push(view.time);
        d.costLine.text = costParts.join('   \u00B7   ');
        d.costLine.visible = view.state !== 'completed';

        d.effect.text = view.effect || '';
        const effectY = view.state === 'researching' ? 112 : 94;
        d.effect.position.set(12, effectY);

        // Live progress bar for researching state
        const showProgress = view.state === 'researching';
        d.progressBg.clear();
        d.progressFill.clear();
        d.progressText.text = '';
        if (showProgress && this.meta) {
            const pct = getResearchProgress(researchState.researching, Date.now());
            const barW = 236;
            const barX = 12;
            const barY = 88;
            d.progressBg.roundRect(barX, barY, barW, 6, 3).fill({ color: 0x1e293b, alpha: 0.9 });
            d.progressBg.roundRect(barX, barY, barW, 6, 3).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.4 });
            d.progressFill.roundRect(barX, barY, barW * pct, 6, 3).fill({ color: COLOR_AMBER_300, alpha: 0.9 });

            const remainingMs = getRemainingMs(researchState.researching, Date.now());
            const totalSec = Math.ceil(remainingMs / 1000);
            const min = Math.floor(totalSec / 60);
            const sec = totalSec % 60;
            const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
            d.progressText.text = `${Math.round(pct * 100)}%  \u00B7  ${timeStr}`;
            d.progressText.position.set(12, 96);
        }

        // CTA based on live state (support cancel/resume for multi-research)
        let ctaText = 'INITIATE RESEARCH';
        let ctaAction = 'initiate';

        if (view.state === 'available') {
            ctaText = 'INITIATE RESEARCH';
            ctaAction = 'initiate';
        } else if (view.state === 'locked') {
            ctaText = 'PREREQUISITES LOCKED';
            ctaAction = 'locked';
        } else if (view.state === 'researching') {
            ctaText = 'CANCEL RESEARCH';
            ctaAction = 'cancel';
        } else if (view.state === 'completed') {
            ctaText = 'COMPLETED';
        }

        d.cta.label.text = ctaText;
        d.cta.container.visible = view.state !== 'completed';
        d.cta.container.alpha = (view.state === 'locked') ? 0.45 : 1.0;

        // Store action for the button handler
        d.cta._currentAction = ctaAction;
        d.cta._currentNodeId = view.id;

        // Update all node visuals based on live state
        n.nodes.forEach(({ node, hex }) => {
            const liveView = getNodeView(node.id, researchState);
            const st = NODE_STATE[liveView?.state || 'locked'] || NODE_STATE.locked;
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
        getAllNodes().forEach((node) => {
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

        // Position research slots panel on the left
        if (n.researchSlots) {
            redrawHologramPanel(n.researchSlots.panel, n.researchSlots.width, n.researchSlots.height, COLOR_AMBER_500);
            n.researchSlots.container.position.set(12, 80);
        }
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

// Re-export from the pure module for any consumers that still import from here
export {
    RESEARCH_NODES,
    RESEARCH_EDGES,
    RESEARCH_CATEGORIES,
} from '../../research.js';
