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
    getMissingPrerequisites,
    getMissingPrerequisiteNames,
    getAllNodes,
    getNode,
    getPrerequisites,
    activeEffectSummaries,
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

const HEX_R = 18; // outer radius of a hex node in world pixels.

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
        this._selectedId = 'fuel-cell'; // Default selection (T1 immediately available)
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
                    fontSize: 10,
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
                    fontSize: 8,
                    fontWeight: '700',
                    fill: COLOR_SLATE_200,
                    stroke: { color: 0x020617, width: 2, alpha: 0.9 },
                }),
            });
            lvl.anchor.set(0.5);
            lvl.position.set(0, HEX_R + 1);
            container.addChild(lvl);

            const nameText = new Text({
                text: view.name,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 9,
                    fill: COLOR_SLATE_400,
                    stroke: { color: 0x020617, width: 2, alpha: 0.85 },
                    align: 'center',
                    wordWrap: true,
                    wordWrapWidth: 85,
                }),
            });
            nameText.anchor.set(0.5, 0);
            nameText.position.set(0, HEX_R + 10);
            container.addChild(nameText);

            // Store the id for later lookup instead of the full static node
            container.on('pointertap', () => this._onNodeTapped({ id: view.id }));
            container.hitArea = new Rectangle(-HEX_R, -HEX_R, HEX_R * 2, HEX_R * 2 + 18);
            root.addChild(container);

            return { node: view, container, hex, glyph, lvl, nameText };
        });

        // Floating DETAIL card (right side of the tree).
        const detail = this._buildDetail();
        root.addChild(detail.container);

        // Legend strip (bottom-left, small).
        const legend = this._buildLegend();
        root.addChild(legend.container);

        // ACTIVE BONUSES: what the completed nodes are actually doing for
        // the station right now. Until P8 the effect layer had no reader,
        // so this is where the tech tree's payoff becomes visible.
        const bonuses = this._buildBonuses();
        root.addChild(bonuses.container);

        this._nodes = { title, categoryLabels, edges, nodes: liveNodes, detail, legend, bonuses };
        this._refreshDetail();
        this._refreshBonuses();
    }

    _getCurrentResearchState() {
        if (this.meta && typeof this.meta.getResearchState === 'function') {
            return this.meta.getResearchState();
        }
        return { completed: [], researching: null };
    }

    _buildDetail() {
        const container = new Container();
        const panel = drawHologramPanel(260, 224, { accent: COLOR_AMBER_500 });
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
        status.position.set(12, 46);
        panel.addChild(status);

        const prereqLine = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fontWeight: '600',
                fill: COLOR_ROSE_300,
                wordWrap: true,
                wordWrapWidth: 236,
            }),
        });
        prereqLine.position.set(12, 62);
        panel.addChild(prereqLine);

        // Cost row: "<minerals> minerals   <credits> credits   <time>"
        const costLine = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fill: COLOR_SLATE_200,
            }),
        });
        costLine.position.set(12, 78);
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
        progressText.position.set(12, 94);
        panel.addChild(progressText);

        // Effect blurb.
        const effect = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 10,
                fill: COLOR_SLATE_400,
                wordWrap: true,
                wordWrapWidth: 236,
                lineHeight: 14,
            }),
        });
        effect.position.set(12, 114);
        panel.addChild(effect);

        // CTA button (INITIATE / CANCEL / RESUME / REQUIRES).
        const cta = buildStartButton({
            text: 'INITIATE RESEARCH',
            width: 220,
            height: 30,
            onTap: () => this._onResearchCta(),
        });
        cta.container.position.set(12, 180);
        panel.addChild(cta.container);

        return { container, panel, header, name, status, prereqLine, costLine, progressBg, progressFill, progressText, effect, cta, width: 260, height: 224 };
    }

    _buildBonuses() {
        const container = new Container();
        const panel = drawHologramPanel(260, 150, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('ACTIVE BONUSES', COLOR_AMBER_300, { size: 10, weight: '700' });
        header.position.set(10, 8);
        panel.addChild(header);

        const count = panelLabel('', COLOR_SLATE_400, { size: 9 });
        count.anchor.set(1, 0);
        count.position.set(250, 9);
        panel.addChild(count);

        const list = new Container();
        list.position.set(10, 24);
        panel.addChild(list);

        return { container, panel, header, count, list, width: 260, height: 150 };
    }

    /**
     * One line per online node, straight from `research.activeEffectSummaries()`
     * — the same strings the settlement math is built from, so the panel
     * can never claim a bonus the game does not apply. Row height adapts so
     * a fully researched tree still fits the card.
     */
    _refreshBonuses() {
        const n = this._nodes?.bonuses;
        if (!n) return;
        const completed = this._getCurrentResearchState().completed || [];
        const lines = activeEffectSummaries(completed);
        n.count.text = `${lines.length} online`;

        n.list.removeChildren().forEach((child) => child?.destroy?.({ children: true }));
        if (lines.length === 0) {
            const empty = new Text({
                text: 'No tech online yet.\nComplete a node to see its bonus here.',
                style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: COLOR_SLATE_400, lineHeight: 14 }),
            });
            n.list.addChild(empty);
            return;
        }

        const rowH = Math.max(11, Math.min(16, Math.floor((n.height - 32) / lines.length)));
        lines.forEach((line, i) => {
            const row = new Container();
            row.position.set(0, i * rowH);
            n.list.addChild(row);

            const dot = new Graphics();
            dot.circle(3, Math.round(rowH / 2), 2).fill({ color: COLOR_EMERALD_300, alpha: 0.9 });
            row.addChild(dot);

            const text = new Text({
                text: line,
                style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: rowH >= 15 ? 10 : 9, fill: COLOR_SLATE_200 }),
            });
            text.position.set(12, Math.max(0, (rowH - text.height) / 2));
            row.addChild(text);
        });
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

    // Called by HubScene when MetaState changes (resources or research state)
    _refreshFromMeta() {
        if (this._nodes) {
            this._refreshDetail();
            this._refreshBonuses();
        }
    }

    tick(deltaMs) {
        if (!this._nodes) return;

        if (this.meta && typeof this.meta.checkResearchCompletions === 'function') {
            const completed = this.meta.checkResearchCompletions(Date.now());
            if (completed && completed.length > 0) {
                this._refreshFromMeta();
                return;
            }
        }

        const researchState = this._getCurrentResearchState();
        if (researchState.activeResearches?.length > 0 || researchState.researching) {
            this._refreshDetail();
        }
    }

    _onResearchCta() {
        if (!this.meta || !this._selectedId) return;

        const node = getNode(this._selectedId);
        if (!node) return;

        const researchState = this.meta.getResearchState();
        const activeResearches = researchState.activeResearches || [];
        const project = activeResearches.find(r => r && r.nodeId === this._selectedId);

        if (project) {
            const remaining = getRemainingMs(project, Date.now());
            if (remaining <= 0) {
                this.meta.completeResearch(this._selectedId);
                this._refreshFromMeta();
                return;
            }
            if (project.startedAt > 0) {
                this.meta.cancelResearch(this._selectedId);
            } else {
                this.meta.resumeResearch(this._selectedId);
            }
            this._refreshDetail();
            return;
        }

        if (researchState.completed?.includes(this._selectedId)) {
            return;
        }

        const completed = researchState.completed || [];
        if (!isNodeAvailable(this._selectedId, completed)) {
            // Jump to first missing prerequisite!
            const missing = getMissingPrerequisites(this._selectedId, completed);
            if (missing.length > 0) {
                this._selectedId = missing[0];
                this._refreshDetail();
            }
            return;
        }

        // Available! Check resources
        const curMinerals = this.meta.getHubResource('minerals') || 0;
        const curCredits = this.meta.getHubResource('credits') || 0;
        const costMinerals = node.cost?.minerals || 0;
        const costCredits = node.cost?.credits || 0;

        if (curMinerals < costMinerals || curCredits < costCredits) {
            return;
        }

        if (costMinerals > 0) this.meta.setHubResource('minerals', curMinerals - costMinerals);
        if (costCredits > 0) this.meta.setHubResource('credits', curCredits - costCredits);

        this.meta.startResearch(this._selectedId);
        this._refreshFromMeta();
    }

    _refreshDetail() {
        const n = this._nodes;
        if (!n) return;

        const researchState = this._getCurrentResearchState();
        const view = this._selectedId ? getNodeView(this._selectedId, researchState) : null;
        if (!view) return;

        const completed = researchState.completed || [];
        const activeResearches = researchState.activeResearches || [];
        const activeProject = activeResearches.find(r => r && r.nodeId === this._selectedId) ||
                              (researchState.researching?.nodeId === this._selectedId ? researchState.researching : null);

        const state = NODE_STATE[view.state] || NODE_STATE.locked;
        const d = n.detail;

        d.name.text = `${view.name} (T${view.level})`;
        d.status.text = state.label;
        d.status.style.fill = state.labelColor;

        // Prerequisite text
        const missing = getMissingPrerequisiteNames(view.id, completed);
        if (view.state === 'locked' && missing.length > 0) {
            d.prereqLine.text = `Requires: ${missing.join(', ')}`;
            d.prereqLine.visible = true;
        } else {
            d.prereqLine.text = '';
            d.prereqLine.visible = false;
        }

        const costParts = [];
        if (view.cost?.minerals) costParts.push(`${view.cost.minerals} minerals`);
        if (view.cost?.credits)  costParts.push(`${view.cost.credits} credits`);
        if (view.time)           costParts.push(view.time);
        d.costLine.text = view.state === 'completed'
            ? 'ONLINE · ALL BONUSES ACTIVE'
            : costParts.join('   \u00B7   ');
        d.costLine.style.fill = view.state === 'completed' ? COLOR_EMERALD_300 : COLOR_SLATE_200;
        d.costLine.visible = true;

        d.effect.text = view.effect || '';
        const effectY = (view.state === 'researching') ? 116 : (d.prereqLine.visible ? 104 : 96);
        d.effect.position.set(12, effectY);

        // Live progress bar for researching state
        const showProgress = view.state === 'researching' && activeProject;
        d.progressBg.clear();
        d.progressFill.clear();
        d.progressText.text = '';
        if (showProgress) {
            const pct = getResearchProgress(activeProject, Date.now());
            const barW = 236;
            const barX = 12;
            const barY = 96;
            d.progressBg.roundRect(barX, barY, barW, 6, 3).fill({ color: 0x1e293b, alpha: 0.9 });
            d.progressBg.roundRect(barX, barY, barW, 6, 3).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.4 });
            d.progressFill.roundRect(barX, barY, Math.max(2, barW * pct), 6, 3).fill({ color: COLOR_AMBER_300, alpha: 0.9 });

            const remainingMs = getRemainingMs(activeProject, Date.now());
            const totalSec = Math.ceil(remainingMs / 1000);
            const min = Math.floor(totalSec / 60);
            const sec = totalSec % 60;
            const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
            const isPaused = activeProject.startedAt === 0;
            d.progressText.text = isPaused
                ? `${Math.round(pct * 100)}%  ·  PAUSED`
                : `${Math.round(pct * 100)}%  ·  ${timeStr}`;
            d.progressText.position.set(12, 104);
        }

        // CTA based on live state
        let ctaText = 'INITIATE RESEARCH';
        let ctaAlpha = 1.0;
        let ctaVisible = true;

        if (view.state === 'available') {
            const curMinerals = this.meta ? (this.meta.getHubResource('minerals') || 0) : 0;
            const curCredits = this.meta ? (this.meta.getHubResource('credits') || 0) : 0;
            const canAfford = curMinerals >= (view.cost?.minerals || 0) && curCredits >= (view.cost?.credits || 0);
            ctaText = canAfford ? 'INITIATE RESEARCH' : 'INSUFFICIENT RESOURCES';
            ctaAlpha = canAfford ? 1.0 : 0.55;
            ctaVisible = true;
        } else if (view.state === 'locked') {
            ctaText = missing.length > 0 ? `REQUIRES: ${missing[0].toUpperCase()}` : 'PREREQUISITES LOCKED';
            ctaAlpha = 0.85;
            ctaVisible = true;
        } else if (view.state === 'researching') {
            const remainingMs = activeProject ? getRemainingMs(activeProject, Date.now()) : 999;
            if (remainingMs <= 0) {
                ctaText = 'COMPLETE RESEARCH';
                ctaAlpha = 1.0;
            } else if (activeProject?.startedAt === 0) {
                ctaText = 'RESUME RESEARCH';
                ctaAlpha = 1.0;
            } else {
                ctaText = 'CANCEL (PAUSE)';
                ctaAlpha = 0.9;
            }
            ctaVisible = true;
        } else if (view.state === 'completed') {
            ctaText = 'COMPLETED';
            ctaVisible = false;
        }

        d.cta.label.text = ctaText;
        d.cta.container.visible = ctaVisible;
        d.cta.container.alpha = ctaAlpha;

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

        // ACTIVE BONUSES: right column, under the detail card, taking
        // whatever height is left.
        if (n.bonuses) {
            const bonusY = detailY + detailH + 12;
            const bonusH = Math.max(70, treeY + treeH - bonusY - 4);
            n.bonuses.height = bonusH;
            redrawHologramPanel(n.bonuses.panel, n.bonuses.width, bonusH, COLOR_CYAN_500);
            n.bonuses.container.position.set(detailX, bonusY);
            n.bonuses.container.visible = bonusH >= 70;
            this._refreshBonuses();
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
