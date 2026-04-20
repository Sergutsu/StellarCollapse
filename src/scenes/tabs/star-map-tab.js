// StarMapTab -- first extracted hub-tab scene. Mounts into the hub's
// center panel when the user clicks the STAR MAP bottom-nav tab.
//
// Contract follows ADR-0010 (hub tab scenes):
//   ctor({ parent }):          mount root under an existing Pixi
//                              container (the hub's center panel).
//   show():                    lazy _build on first show; visible=true.
//   hide():                    visible=false; close any floating panel.
//   layout({ width, height }): reposition grid / pins / legend / panel
//                              when the center panel resizes.
//   destroy():                 drop all Pixi nodes.
//   get visible():             duck-type flag for the tab manager.
//
// The scene is purely presentational for now -- sector data is static,
// PLOT COURSE is a stub. Real warp-cost deduction + sector->mission
// wiring lands in a later phase (ROADMAP P7).

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildStartButton,
} from '../../pixi-ui-kit.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_ROSE_300 = 0xfda4af;

// Static sector catalog shown on the map. Coordinates are normalized
// (0..1) inside the tab-content area. `warpCost` and `threat` are
// display-only stubs until P7 wires them to MetaState + missions.
const SECTORS = Object.freeze([
    { id: 'omega4',   name: 'Omega-4 Belt',     nx: 0.18, ny: 0.22, klass: 'Asteroid Belt',   planets: '0 Mapped',     threat: 2, warpCost: 1, kind: 'belt' },
    { id: 'ares',     name: 'ARES Waystation',  nx: 0.42, ny: 0.18, klass: 'Orbital Platform', planets: '--',           threat: 1, warpCost: 0, kind: 'station' },
    { id: 'cygnus',   name: 'Cygnus X-1',       nx: 0.76, ny: 0.24, klass: 'Black Hole',       planets: 'Anomaly',      threat: 5, warpCost: 2, kind: 'hazard' },
    { id: 'sol',      name: 'Sol',              nx: 0.22, ny: 0.48, klass: 'Class G Yellow',   planets: '8 Planets',    threat: 1, warpCost: 1, kind: 'star' },
    { id: 'trappist', name: 'Trappist-1',       nx: 0.52, ny: 0.52, klass: 'Class M Dwarf',    planets: '7 Rocky Planets', threat: 3, warpCost: 1, kind: 'star' },
    { id: 'proxima',  name: 'Proxima Centauri', nx: 0.26, ny: 0.72, klass: 'Red Dwarf',        planets: '3 Planets',    threat: 2, warpCost: 1, kind: 'star' },
    { id: 'barnard',  name: "Barnard's Star",   nx: 0.50, ny: 0.80, klass: 'Red Dwarf',        planets: '2 Planets',    threat: 2, warpCost: 1, kind: 'star' },
    { id: 'psr',      name: 'PSR B1257+12',     nx: 0.78, ny: 0.74, klass: 'Pulsar',           planets: '4 Planets',    threat: 4, warpCost: 2, kind: 'hazard' },
]);

// Legend entries shown in the bottom-left card. Must cover every
// `kind` used in SECTORS above.
const LEGEND = Object.freeze([
    { kind: 'star',    label: 'Mapped System',  color: COLOR_CYAN_300 },
    { kind: 'belt',    label: 'Resource Belt',  color: COLOR_AMBER_300 },
    { kind: 'station', label: 'Waystation',     color: COLOR_SLATE_200 },
    { kind: 'hazard',  label: 'Hazard / Anomaly', color: COLOR_ROSE_300 },
]);

function pinColor(kind) {
    const entry = LEGEND.find((l) => l.kind === kind);
    return entry ? entry.color : COLOR_CYAN_300;
}

function drawPinGlyph(g, color) {
    g.clear();
    // Outer ring.
    g.circle(0, 0, 8).stroke({ color, width: 1.5, alpha: 0.85 });
    // Inner dot.
    g.circle(0, 0, 3).fill({ color, alpha: 0.95 });
    // Downward drop tail (pin foot).
    g.moveTo(-4, 4).lineTo(0, 12).lineTo(4, 4).stroke({ color, width: 1.2, alpha: 0.7 });
}

export class StarMapTab {
    constructor({ parent }) {
        if (!parent) throw new Error('StarMapTab: parent container is required');
        this.parent = parent;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedId = null;
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
    }

    hide() {
        this.root.visible = false;
        if (this._nodes) this._nodes.systemData.container.visible = false;
        this._selectedId = null;
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

        // Title strip (top-left of center panel).
        const title = new Text({
            text: 'STAR MAP  \u00B7  ORION CARTOGRAPHY',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: '800',
                letterSpacing: 2,
                fill: COLOR_CYAN_300,
            }),
        });
        title.position.set(16, 12);
        root.addChild(title);

        // Map canvas: coordinate grid + axis tick labels.
        const grid = new Graphics();
        root.addChild(grid);

        const axisLabels = new Container();
        root.addChild(axisLabels);

        // Sector pins.
        const pins = SECTORS.map((sector) => {
            const container = new Container();
            container.eventMode = 'static';
            container.cursor = 'pointer';

            const glyph = new Graphics();
            drawPinGlyph(glyph, pinColor(sector.kind));
            container.addChild(glyph);

            const label = new Text({
                text: sector.name,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fontWeight: '600',
                    fill: COLOR_SLATE_200,
                    stroke: { color: 0x020617, width: 3, alpha: 0.85 },
                }),
            });
            label.anchor.set(0.5, 0);
            label.position.set(0, 14);
            container.addChild(label);

            container.on('pointertap', () => this._onPinTapped(sector));
            root.addChild(container);

            return { sector, container, glyph, label };
        });

        // Map Legend card (bottom-left).
        const legend = this._buildLegend();
        root.addChild(legend.container);

        // Galactic overview thumbnail (top-right).
        const thumb = this._buildThumb();
        root.addChild(thumb.container);

        // Floating SYSTEM DATA panel (hidden until a pin is tapped).
        const systemData = this._buildSystemData();
        systemData.container.visible = false;
        root.addChild(systemData.container);

        this._nodes = { title, grid, axisLabels, pins, legend, thumb, systemData };
    }

    _buildLegend() {
        const container = new Container();
        const panel = drawHologramPanel(200, 108, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('MAP LEGEND', COLOR_CYAN_300, { size: 11 });
        header.position.set(12, 10);
        panel.addChild(header);

        const rows = LEGEND.map((entry, i) => {
            const rowY = 30 + i * 18;
            const dot = new Graphics();
            dot.circle(0, 0, 4).fill({ color: entry.color, alpha: 0.95 });
            dot.position.set(18, rowY + 6);
            panel.addChild(dot);

            const text = new Text({
                text: entry.label,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fill: COLOR_SLATE_200,
                }),
            });
            text.position.set(30, rowY);
            panel.addChild(text);
            return { entry, dot, text };
        });

        return { container, panel, header, rows, width: 200, height: 108 };
    }

    _buildThumb() {
        const container = new Container();
        const panel = drawHologramPanel(180, 96, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('GALACTIC OVERVIEW', COLOR_CYAN_300, { size: 10 });
        header.position.set(10, 8);
        panel.addChild(header);

        // Miniature swirl of dots evocative of a galaxy disc.
        const g = new Graphics();
        g.position.set(90, 56);
        // Central bulge.
        g.circle(0, 0, 6).fill({ color: COLOR_AMBER_300, alpha: 0.9 });
        g.circle(0, 0, 10).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.3 });
        // Spiral-ish scatter.
        for (let i = 0; i < 48; i++) {
            const theta = i * 0.35;
            const r = 8 + i * 0.6;
            const x = Math.cos(theta) * r;
            const y = Math.sin(theta) * r * 0.55;
            const alpha = Math.max(0.15, 0.85 - i * 0.015);
            g.circle(x, y, 1).fill({ color: COLOR_CYAN_300, alpha });
        }
        // Current-position crosshair.
        const cross = new Graphics();
        cross.position.set(90, 56);
        cross.moveTo(-6, 0).lineTo(6, 0).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.9 });
        cross.moveTo(0, -6).lineTo(0, 6).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.9 });
        panel.addChild(g);
        panel.addChild(cross);

        return { container, panel, header, width: 180, height: 96 };
    }

    _buildSystemData() {
        const container = new Container();
        const panel = drawHologramPanel(240, 168, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('SYSTEM DATA', COLOR_CYAN_300, { size: 11 });
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

        const klass = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_SLATE_400,
            }),
        });
        klass.position.set(12, 48);
        panel.addChild(klass);

        const planets = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_SLATE_400,
            }),
        });
        planets.position.set(12, 64);
        panel.addChild(planets);

        const threat = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_ROSE_300,
            }),
        });
        threat.position.set(12, 82);
        panel.addChild(threat);

        const warp = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: COLOR_AMBER_300,
            }),
        });
        warp.position.set(12, 100);
        panel.addChild(warp);

        const plot = buildStartButton({
            text: 'PLOT COURSE',
            width: 176,
            height: 30,
            onTap: () => this._onPlotCourse(),
        });
        plot.container.position.set(12, 126);
        panel.addChild(plot.container);

        // Small [x] dismiss button in the top-right of the panel.
        const closeBtn = new Container();
        closeBtn.eventMode = 'static';
        closeBtn.cursor = 'pointer';
        const closeBg = new Graphics();
        closeBg.circle(0, 0, 10).fill({ color: 0x0f172a, alpha: 0.85 });
        closeBg.circle(0, 0, 10).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.5 });
        closeBtn.addChild(closeBg);
        const closeX = new Text({
            text: '\u00d7',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: '700', fill: COLOR_SLATE_200 }),
        });
        closeX.anchor.set(0.5);
        closeBtn.addChild(closeX);
        closeBtn.position.set(228, 14);
        closeBtn.hitArea = new Rectangle(-10, -10, 20, 20);
        closeBtn.on('pointertap', () => this._closeSystemData());
        panel.addChild(closeBtn);

        return { container, panel, header, name, klass, planets, threat, warp, plot, width: 240, height: 168 };
    }

    // ----------------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------------

    _onPinTapped(sector) {
        this._selectedId = sector.id;
        const sd = this._nodes.systemData;
        sd.name.text = sector.name;
        sd.klass.text = `Class: ${sector.klass}`;
        sd.planets.text = `Survey: ${sector.planets}`;
        sd.threat.text = `Threat Level: ${sector.threat} / 5`;
        sd.warp.text = sector.warpCost > 0
            ? `Warp Cost: ${sector.warpCost} Warp Cell${sector.warpCost === 1 ? '' : 's'}`
            : 'Warp Cost: --';
        sd.container.visible = true;
        // Re-layout so the panel pins to the selected sector.
        if (this._lastW && this._lastH) this._layout(this._lastW, this._lastH);
    }

    _onPlotCourse() {
        // Stub -- real course-plotting (warp-cell deduction, mission
        // enqueue, fleet dispatch) lands in ROADMAP P7.
        this._closeSystemData();
    }

    _closeSystemData() {
        this._selectedId = null;
        if (this._nodes) this._nodes.systemData.container.visible = false;
    }

    // ----------------------------------------------------------------
    // Layout (re-run on every viewport change)
    // ----------------------------------------------------------------

    _layout(w, h) {
        const n = this._nodes;
        if (!n) return;
        this._lastW = w;
        this._lastH = h;

        // Map region: everything below the title strip, inset from the
        // panel edges so pins don't clip.
        const pad = 20;
        const mapX = pad;
        const mapY = 40;
        const mapW = Math.max(240, w - pad * 2);
        const mapH = Math.max(200, h - mapY - pad);

        // --- Coordinate grid.
        n.grid.clear();
        const step = 40;
        for (let gx = mapX; gx <= mapX + mapW; gx += step) {
            n.grid.moveTo(gx, mapY).lineTo(gx, mapY + mapH).stroke({ color: COLOR_CYAN_500, width: 1, alpha: 0.08 });
        }
        for (let gy = mapY; gy <= mapY + mapH; gy += step) {
            n.grid.moveTo(mapX, gy).lineTo(mapX + mapW, gy).stroke({ color: COLOR_CYAN_500, width: 1, alpha: 0.08 });
        }
        // Map frame.
        n.grid.rect(mapX, mapY, mapW, mapH).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.35 });

        // --- Axis tick labels (sparse, every other grid line).
        // Destroy the previous Text children (not just detach) so the
        // underlying style + GPU textures are released. removeChildren
        // alone would leak ~12-13 Text objects per resize.
        while (n.axisLabels.children.length > 0) {
            const old = n.axisLabels.children[0];
            n.axisLabels.removeChild(old);
            old.destroy({ children: true });
        }
        const mkLabel = (text) => new Text({
            text,
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 9, fill: COLOR_SLATE_400 }),
        });
        const longitudeBase = 42;
        for (let gx = mapX, i = 0; gx <= mapX + mapW; gx += step * 2, i++) {
            const lbl = mkLabel(`${longitudeBase + i * 12}\u00b0`);
            lbl.position.set(gx + 2, mapY - 12);
            n.axisLabels.addChild(lbl);
        }
        const latitudeBase = 12;
        for (let gy = mapY, i = 0; gy <= mapY + mapH; gy += step * 2, i++) {
            const lbl = mkLabel(`${latitudeBase + i * 8}\u00b0`);
            lbl.position.set(mapX - 22, gy - 5);
            n.axisLabels.addChild(lbl);
        }

        // --- Sector pins.
        n.pins.forEach(({ sector, container }) => {
            const px = mapX + sector.nx * mapW;
            const py = mapY + sector.ny * mapH;
            container.position.set(px, py);
            container.hitArea = new Rectangle(-14, -14, 28, 28);
        });

        // --- Map legend: bottom-left of map region.
        const legendW = n.legend.width;
        const legendH = n.legend.height;
        redrawHologramPanel(n.legend.panel, legendW, legendH, COLOR_CYAN_500);
        n.legend.container.position.set(mapX + 8, mapY + mapH - legendH - 8);

        // --- Thumb: top-right of map region.
        const thumbW = n.thumb.width;
        const thumbH = n.thumb.height;
        redrawHologramPanel(n.thumb.panel, thumbW, thumbH, COLOR_CYAN_500);
        n.thumb.container.position.set(mapX + mapW - thumbW - 8, mapY + 8);

        // --- System-data panel: pin to selected sector, nudged inside
        //     map bounds so it doesn't clip against panel edges.
        if (n.systemData.container.visible && this._selectedId) {
            const sel = SECTORS.find((s) => s.id === this._selectedId);
            if (sel) {
                const sw = n.systemData.width;
                const sh = n.systemData.height;
                const anchorX = mapX + sel.nx * mapW;
                const anchorY = mapY + sel.ny * mapH;
                let sx = anchorX + 18;
                let sy = anchorY - sh / 2;
                if (sx + sw > mapX + mapW - 8) sx = anchorX - sw - 18;
                if (sy < mapY + 8) sy = mapY + 8;
                if (sy + sh > mapY + mapH - 8) sy = mapY + mapH - sh - 8;
                n.systemData.container.position.set(sx, sy);
            }
        }
    }
}

export { SECTORS as STAR_MAP_SECTORS, LEGEND as STAR_MAP_LEGEND };
