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
// The scene now features a procedurally generated single star system
// with 50-100 points of interest (planets, moons, stations, hazards).
// Pan and zoom controls allow navigation around the system map.
// Ship icons are displayed in orbits around their parent POIs.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildStartButton,
} from '../../pixi-ui-kit.js';
import { generateStarSystem, calculateOrbitalPosition, getShipsOrbitingPoi } from '../../procedural-star-system.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_ROSE_300 = 0xfda4af;

// Default seed for starting game - can be overridden by game state
const DEFAULT_SYSTEM_SEED = 12345;

// Pin colors by POI type
function pinColor(poiType) {
    switch (poiType) {
        case 'planet': return COLOR_CYAN_300;
        case 'moon': return COLOR_SLATE_400;
        case 'station': return COLOR_AMBER_300;
        case 'belt': return COLOR_AMBER_300;
        case 'hazard': return COLOR_ROSE_300;
        case 'ship': return COLOR_CYAN_300;
        default: return COLOR_CYAN_300;
    }
}

// Legend entries for POI types
const LEGEND = Object.freeze([
    { kind: 'star',    label: 'Central Star',  color: COLOR_AMBER_300 },
    { kind: 'planet',  label: 'Planet',        color: COLOR_CYAN_300 },
    { kind: 'moon',    label: 'Moon',          color: COLOR_SLATE_400 },
    { kind: 'station', label: 'Station',       color: COLOR_AMBER_300 },
    { kind: 'belt',    label: 'Asteroid Belt', color: COLOR_AMBER_300 },
    { kind: 'hazard',  label: 'Hazard',        color: COLOR_ROSE_300 },
    { kind: 'ship',    label: 'Spacecraft',    color: COLOR_CYAN_300 },
]);

function drawPinGlyph(g, color, poiType, size = 8) {
    g.clear();
    
    if (poiType === 'star') {
        // Draw star shape
        const spikes = 8;
        const outerR = size * 1.5;
        const innerR = size * 0.6;
        let rot = -Math.PI / 2;
        const step = Math.PI / spikes;
        const pts = [];
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            pts.push(Math.cos(rot) * r, Math.sin(rot) * r);
            rot += step;
        }
        g.poly(pts).fill({ color, alpha: 0.9 });
        // Glow effect
        g.circle(0, 0, size * 2).stroke({ color, width: 1, alpha: 0.3 });
    } else if (poiType === 'planet') {
        // Outer ring
        g.circle(0, 0, size).stroke({ color, width: 1.5, alpha: 0.85 });
        // Inner dot
        g.circle(0, 0, size * 0.4).fill({ color, alpha: 0.95 });
    } else if (poiType === 'moon') {
        g.circle(0, 0, size * 0.6).fill({ color, alpha: 0.9 });
    } else if (poiType === 'station') {
        // Diamond shape for stations
        g.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.85 });
        g.circle(0, 0, size * 0.3).fill({ color, alpha: 0.9 });
    } else if (poiType === 'belt') {
        // Dashed circle for asteroid belt
        g.circle(0, 0, size * 1.2).stroke({ color, width: 1, alpha: 0.6 });
        g.circle(0, 0, size * 0.5).stroke({ color, width: 1, alpha: 0.4 });
    } else if (poiType === 'hazard') {
        // Warning triangle
        const s = size * 1.1;
        g.moveTo(0, -s).lineTo(s, s).lineTo(-s, s).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.9 });
        g.circle(0, 0, size * 0.3).fill({ color, alpha: 0.9 });
    } else if (poiType === 'ship') {
        // Ship icon - arrow/triangle pointing up
        const shipSize = size * 0.7;
        g.moveTo(0, -shipSize).lineTo(shipSize * 0.7, shipSize).lineTo(0, shipSize * 0.5).lineTo(-shipSize * 0.7, shipSize).closePath();
        g.fill({ color, alpha: 0.9 });
    } else {
        // Generic pin
        g.circle(0, 0, size).stroke({ color, width: 1.5, alpha: 0.85 });
        g.circle(0, 0, size * 0.4).fill({ color, alpha: 0.95 });
    }
}

export class StarMapTab {
    constructor({ parent, seed = DEFAULT_SYSTEM_SEED }) {
        if (!parent) throw new Error('StarMapTab: parent container is required');
        this.parent = parent;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedId = null;
        this._seed = seed;
        this._system = generateStarSystem(seed);
        this._timeMs = 0;
        this._map = { mapX: 0, mapY: 0, mapW: 1, mapH: 1 };
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

    tick(deltaMs) {
        if (!this.root?.visible || !this._nodes) return;
        this._timeMs += deltaMs;
        this._updatePinPositions();
        if (this._nodes.systemData.container.visible && this._selectedId && this._lastW && this._lastH) {
            this._layoutSystemData(this._lastW, this._lastH);
        }
    }

    destroy() {
        if (this.root) {
            this.root.destroy({ children: true });
            this.root = null;
        }
        this._nodes = null;
    }

    _mapBodies() {
        return [
            { ...this._system.star, poiType: 'star' },
            ...this._system.pois,
            ...this._system.ships,
        ];
    }

    _findBody(id) {
        if (this._system.star.id === id) return { ...this._system.star, poiType: 'star' };
        return this._system.pois.find((p) => p.id === id)
            || this._system.ships.find((s) => s.id === id)
            || null;
    }

    _parentFor(poi) {
        if (!poi?.parentId) return null;
        if (poi.parentId === this._system.star.id) return null;
        return this._system.pois.find((p) => p.id === poi.parentId) || null;
    }

    _poiPosition(poi) {
        if (!poi) return { x: 0.5, y: 0.5 };
        if (poi.poiType === 'star' || (poi.x != null && poi.y != null && poi.orbitRadius == null && poi.poiType !== 'belt')) {
            return { x: poi.x ?? 0.5, y: poi.y ?? 0.5 };
        }
        if (poi.poiType === 'belt') {
            const r = ((poi.innerRadius || 0.2) + (poi.outerRadius || 0.3)) / 2;
            return { x: 0.5 + r, y: 0.5 };
        }
        return calculateOrbitalPosition(poi, this._timeMs, this._parentFor(poi));
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

        const pins = this._mapBodies().map((poi) => {
            const container = new Container();
            container.eventMode = 'static';
            container.cursor = 'pointer';

            const glyph = new Graphics();
            const size = poi.poiType === 'star' ? 10 : poi.poiType === 'planet' ? 7 : 5;
            drawPinGlyph(glyph, poi.color || pinColor(poi.poiType), poi.poiType, size);
            container.addChild(glyph);

            const showLabel = poi.poiType === 'star' || poi.poiType === 'planet' || poi.poiType === 'station';
            let label = null;
            if (showLabel) {
                label = new Text({
                    text: poi.name,
                    style: new TextStyle({
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 10,
                        fontWeight: '600',
                        fill: COLOR_SLATE_200,
                        stroke: { color: 0x020617, width: 3, alpha: 0.85 },
                    }),
                });
                label.anchor.set(0.5, 0);
                label.position.set(0, 12);
                container.addChild(label);
            }

            container.on('pointertap', () => this._onPinTapped(poi));
            root.addChild(container);

            return { poi, container, glyph, label };
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
        const panel = drawHologramPanel(200, 168, { accent: COLOR_CYAN_500 });
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

        return { container, panel, header, rows, width: 200, height: 168 };
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

    _onPinTapped(poi) {
        this._selectedId = poi.id;
        const live = this._findBody(poi.id) || poi;
        const sd = this._nodes.systemData;
        sd.name.text = live.name;
        sd.klass.text = `Class: ${live.type || live.poiType || '--'}`;
        const shipsHere = getShipsOrbitingPoi(this._system.ships, live.id);
        sd.planets.text = live.description
            || (live.services ? `Services: ${live.services.join(', ')}` : `Orbiters: ${shipsHere.length}`);
        sd.threat.text = `Threat Level: ${live.threat ?? 0} / 5`;
        if (live.resources) {
            sd.warp.text = `Minerals ${live.resources.minerals}  Fuel ${live.resources.fuel}`;
        } else if (live.faction) {
            sd.warp.text = `Faction: ${live.faction}`;
        } else {
            sd.warp.text = live.temperature ? `Temp: ${live.temperature}` : '';
        }
        sd.container.visible = true;
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

        this._map = { mapX, mapY, mapW, mapH };
        this._updatePinPositions();

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
        this._layoutSystemData(w, h);
    }

    _updatePinPositions() {
        const n = this._nodes;
        if (!n) return;
        const { mapX, mapY, mapW, mapH } = this._map;
        n.pins.forEach(({ poi, container }) => {
            const pos = this._poiPosition(this._findBody(poi.id) || poi);
            const px = mapX + pos.x * mapW;
            const py = mapY + pos.y * mapH;
            container.position.set(px, py);
            container.hitArea = new Rectangle(-14, -14, 28, 28);
        });
    }

    _layoutSystemData(w, h) {
        const n = this._nodes;
        if (!n?.systemData.container.visible || !this._selectedId) return;
        const { mapX, mapY, mapW, mapH } = this._map;
        const sel = this._findBody(this._selectedId);
        if (!sel) return;
        const pos = this._poiPosition(sel);
        const sw = n.systemData.width;
        const sh = n.systemData.height;
        const anchorX = mapX + pos.x * mapW;
        const anchorY = mapY + pos.y * mapH;
        let sx = anchorX + 18;
        let sy = anchorY - sh / 2;
        if (sx + sw > mapX + mapW - 8) sx = anchorX - sw - 18;
        if (sy < mapY + 8) sy = mapY + 8;
        if (sy + sh > mapY + mapH - 8) sy = mapY + mapH - sh - 8;
        n.systemData.container.position.set(sx, sy);
    }
}

export const STAR_MAP_SECTORS = [];
export { LEGEND as STAR_MAP_LEGEND };

// Export the default seed constant for use in hub-scene.js
export { DEFAULT_SYSTEM_SEED as STAR_MAP_DEFAULT_SEED };
