// StarMapTab -- hub center-panel scene for the STAR MAP bottom-nav tab.
// Contract follows ADR-0010 (hub tab scenes):
//   ctor({ parent }):          mount root under an existing Pixi container.
//   show()/hide():             lazy _build; visibility + panel cleanup.
//   layout({width,height}):    re-fit viewport / overlays on resize.
//   tick(deltaMs):             advance orbital motion + keep panel anchored.
//   destroy():                 drop all Pixi nodes.
//
// Renders one procedurally generated planetary system inside a clipped
// central window: central star, orbit rings, planets with moons, space
// stations, hazards and ships. The camera supports wheel zoom (toward
// the cursor), drag-to-pan, and +/- / reset buttons. Body glyphs are
// counter-scaled against zoom so they stay readable at every zoom level
// (no invisible-dot problem); moons and ships fade in as you dive in.

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
const COLOR_DEEP = 0x0b1120;

// Default seed for starting game - can be overridden by game state.
const DEFAULT_SYSTEM_SEED = 12345;

// Normalized system coords (0..1 around the star) map to WORLD_SPAN px
// of world space; the camera zoom/pan transform maps world -> screen.
const WORLD_SPAN = 720;

// Zoom limits expressed relative to the fit-all zoom computed at first
// layout, so behaviour is resolution independent.
const FIT_MARGIN = 0.86;   // fraction of min(mapW,mapH) used by outermost orbit
const ZOOM_IN_MAX = 9;     // max multiple above fit zoom
const ZOOM_OUT_MIN = 0.55; // min multiple below fit zoom
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.3;

// Moons / ships only add clutter when zoomed out -- reveal progressively.
const MOON_ZOOM_REVEAL = 1.8; // x fit zoom
const SHIP_ZOOM_REVEAL = 1.3;

// Pointer movement (px) below which a down/up pair still counts as a tap.
const DRAG_TAP_SLOP = 5;

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

// Legend entries for POI types.
const LEGEND = Object.freeze([
    { kind: 'star',    label: 'Central Star',  color: COLOR_AMBER_300 },
    { kind: 'planet',  label: 'Planet',        color: COLOR_CYAN_300 },
    { kind: 'moon',    label: 'Moon',          color: COLOR_SLATE_400 },
    { kind: 'station', label: 'Station',       color: COLOR_AMBER_300 },
    { kind: 'belt',    label: 'Asteroid Belt', color: COLOR_AMBER_300 },
    { kind: 'hazard',  label: 'Hazard',        color: COLOR_ROSE_300 },
    { kind: 'ship',    label: 'Spacecraft',    color: COLOR_CYAN_300 },
]);

// Deterministic RNG for backdrop dressing (mulberry32).
function createBackdropRNG(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// Screen-space body glyphs. Drawn inside containers that are
// counter-scaled against camera zoom, so these pixel sizes are what you
// actually see regardless of zoom level.
function drawBodyGlyph(g, color, poiType, size) {
    g.clear();

    if (poiType === 'star') {
        g.circle(0, 0, size * 2.1).fill({ color, alpha: 0.07 });
        g.circle(0, 0, size * 1.45).fill({ color, alpha: 0.14 });
        g.circle(0, 0, size).fill({ color, alpha: 1 });
        g.circle(-size * 0.28, -size * 0.28, size * 0.32).fill({ color: 0xffffff, alpha: 0.35 });
    } else if (poiType === 'planet') {
        g.circle(0, 0, size).fill({ color, alpha: 0.95 });
        g.circle(0, 0, size).stroke({ color: 0xffffff, width: 1, alpha: 0.18 });
        g.circle(-size * 0.3, -size * 0.3, size * 0.3).fill({ color: 0xffffff, alpha: 0.22 });
    } else if (poiType === 'moon') {
        g.circle(0, 0, size).fill({ color, alpha: 0.9 });
    } else if (poiType === 'station') {
        g.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.9 });
        g.circle(0, 0, size * 0.3).fill({ color, alpha: 0.95 });
    } else if (poiType === 'hazard') {
        const s = size * 1.1;
        g.moveTo(0, -s).lineTo(s, s).lineTo(-s, s).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.9 });
        g.circle(0, 0, size * 0.3).fill({ color, alpha: 0.9 });
    } else if (poiType === 'ship') {
        g.moveTo(0, -size).lineTo(size * 0.7, size).lineTo(0, size * 0.5).lineTo(-size * 0.7, size).closePath();
        g.fill({ color, alpha: 0.9 });
    } else {
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
        this._fitZoom = 1;
        this._cam = { x: 0, y: 0, zoom: 1 };
        this._pan = null;      // active drag state
        this._dragDist = 0;    // pointer travel during current/last drag
        this._fitted = false;
        this._lastW = 0;
        this._lastH = 0;
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
        this._pan = null;
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
        this._updateBodies();
        if (this._nodes.systemData.container.visible && this._selectedId) {
            this._layoutSystemData();
        }
    }

    destroy() {
        if (this.root) {
            this.root.destroy({ children: true });
            this.root = null;
        }
        this._nodes = null;
    }

    // ----------------------------------------------------------------
    // System data helpers
    // ----------------------------------------------------------------

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
        if (poi.poiType === 'star') {
            return { x: poi.x ?? 0.5, y: poi.y ?? 0.5 };
        }
        if (poi.poiType === 'belt') {
            // Belts render as rings; no pin position needed.
            return { x: 0.5, y: 0.5 };
        }
        return calculateOrbitalPosition(poi, this._timeMs, this._parentFor(poi));
    }

    // ----------------------------------------------------------------
    // Build (once, on first show)
    // ----------------------------------------------------------------

    _build() {
        const root = this.root;

        const title = new Text({
            text: 'STAR MAP  \u00B7  SYSTEM CHART',
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

        // Everything inside the clipped map window lives here.
        const viewport = new Container();
        root.addChild(viewport);

        // Mask node keeps world content from spilling past the window.
        const maskG = new Graphics();
        root.addChild(maskG);
        viewport.mask = maskG;

        // Parallax backdrop stars (screen-space dressing).
        const backdrop = new Graphics();
        viewport.addChild(backdrop);

        // Input surface for pan + wheel. Added before the world so body
        // pins (inside world) win pointer events where they overlap.
        const input = new Container();
        input.eventMode = 'static';
        input.cursor = 'grab';
        viewport.addChild(input);

        // World space: orbit rings + body pins, driven by the camera.
        const world = new Container();
        viewport.addChild(world);

        const orbits = new Graphics();
        world.addChild(orbits);

        const pins = this._buildPins(world);

        // Window frame drawn above the clipped content (not masked).
        const frame = new Graphics();
        root.addChild(frame);

        const legend = this._buildLegend();
        root.addChild(legend.container);

        const systemData = this._buildSystemData();
        systemData.container.visible = false;
        root.addChild(systemData.container);

        const controls = this._buildControls();
        root.addChild(controls.container);

        const hint = new Text({
            text: 'DRAG TO PAN  \u00B7  SCROLL TO ZOOM',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 9,
                letterSpacing: 1,
                fill: COLOR_SLATE_400,
            }),
        });
        root.addChild(hint);

        this._nodes = { title, viewport, maskG, backdrop, input, world, orbits, frame, pins, legend, systemData, controls, hint };
        this._drawOrbitRings();
        this._attachInput();
    }

    _buildPins(world) {
        return this._mapBodies()
            .filter((poi) => poi.poiType !== 'belt') // belts render as rings
            .map((poi) => {
                const container = new Container();
                container.eventMode = 'static';
                container.cursor = 'pointer';

                const glyph = new Graphics();
                const size = poi.poiType === 'star'
                    ? 22
                    : poi.poiType === 'planet'
                        ? 6 + (poi.radius || 6)
                        : poi.poiType === 'moon'
                            ? 3.5
                            : 6;
                drawBodyGlyph(glyph, poi.color || pinColor(poi.poiType), poi.poiType, size);
                container.addChild(glyph);

                const showLabel = poi.poiType === 'star' || poi.poiType === 'planet' || poi.poiType === 'station';
                if (showLabel) {
                    const label = new Text({
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
                    label.position.set(0, size + 4);
                    container.addChild(label);
                }

                // Hit area in local px; counter-scaling keeps it a
                // constant ~28px target on screen at any zoom.
                const pad = Math.max(size, 12) + 2;
                container.hitArea = new Rectangle(-pad, -pad, pad * 2, pad * 2);

                world.addChild(container);
                return { poi, container };
            });
    }

    _drawOrbitRings() {
        const g = this._nodes.orbits;
        g.clear();
        this._system.orbits.forEach((o) => {
            const r = o.radius * WORLD_SPAN;
            if (o.isBelt) {
                // Wide faint band + thin edge lines to suggest rubble.
                g.circle(0, 0, r).stroke({ color: o.color ?? 0xd4a574, width: Math.max(4, (o.width || 0.04) * WORLD_SPAN), alpha: 0.07 });
                g.circle(0, 0, r).stroke({ color: o.color ?? 0xd4a574, width: 1, alpha: 0.18 });
            } else {
                g.circle(0, 0, r).stroke({ color: o.color ?? COLOR_CYAN_500, width: 1, alpha: 0.16 });
            }
        });
    }

    // ----------------------------------------------------------------
    // Camera
    // ----------------------------------------------------------------

    _fitCamera() {
        const { mapW, mapH } = this._map;
        let maxR = 0.35;
        this._system.orbits.forEach((o) => {
            maxR = Math.max(maxR, o.isBelt ? (o.radius + (o.width || 0) / 2) : o.radius);
        });
        this._fitZoom = (Math.min(mapW, mapH) * FIT_MARGIN) / (maxR * 2 * WORLD_SPAN);
        this._cam = { x: 0, y: 0, zoom: this._fitZoom };
        this._fitted = true;
    }

    // Zoom keeping the world point under (sx, sy) pinned to the cursor.
    _zoomAt(sx, sy, factor) {
        if (!this._nodes || !this._fitted) return;
        const z0 = this._cam.zoom;
        const z1 = Math.min(
            this._fitZoom * ZOOM_IN_MAX,
            Math.max(this._fitZoom * ZOOM_OUT_MIN, z0 * factor),
        );
        if (z1 === z0) return;
        const k = z1 / z0;
        this._cam.x = sx - (sx - this._cam.x) * k;
        this._cam.y = sy - (sy - this._cam.y) * k;
        this._cam.zoom = z1;
        this._applyCamera();
    }

    _resetCamera() {
        if (!this._nodes || !this._fitted) return;
        this._cam.x = 0;
        this._cam.y = 0;
        this._cam.zoom = this._fitZoom;
        this._applyCamera();
    }

    _applyCamera() {
        const n = this._nodes;
        if (!n) return;
        const { mapX, mapY, mapW, mapH } = this._map;
        n.world.position.set(mapX + mapW / 2 + this._cam.x, mapY + mapH / 2 + this._cam.y);
        n.world.scale.set(this._cam.zoom);
        // Subtle parallax on the backdrop dressing.
        n.backdrop.position.set(this._cam.x * 0.12, this._cam.y * 0.12);

        // Progressive reveal of small bodies as you dive in.
        const zr = this._cam.zoom / this._fitZoom;
        n.pins.forEach(({ poi, container }) => {
            if (poi.poiType === 'moon') container.visible = zr >= MOON_ZOOM_REVEAL;
            else if (poi.poiType === 'ship') container.visible = zr >= SHIP_ZOOM_REVEAL;
        });
    }

    _updateBodies() {
        const n = this._nodes;
        if (!n) return;
        const invZ = 1 / this._cam.zoom;
        n.pins.forEach(({ poi, container }) => {
            const pos = this._poiPosition(poi);
            container.position.set((pos.x - 0.5) * WORLD_SPAN, (pos.y - 0.5) * WORLD_SPAN);
            container.scale.set(invZ); // constant on-screen glyph size
        });
    }
    // ----------------------------------------------------------------
    // Input (drag pan + wheel zoom)
    // ----------------------------------------------------------------

    _attachInput() {
        const n = this._nodes;

        n.input.on('pointerdown', (e) => {
            this._pan = { startGlobal: e.global.clone(), startCam: { ...this._cam } };
            this._dragDist = 0;
            n.input.cursor = 'grabbing';
        });
        n.input.on('pointermove', (e) => {
            if (!this._pan) return;
            const dx = e.global.x - this._pan.startGlobal.x;
            const dy = e.global.y - this._pan.startGlobal.y;
            this._dragDist = Math.max(this._dragDist, Math.hypot(dx, dy));
            this._cam.x = this._pan.startCam.x + dx;
            this._cam.y = this._pan.startCam.y + dy;
            this._applyCamera();
        });
        const endPan = () => {
            this._pan = null;
            n.input.cursor = 'grab';
        };
        n.input.on('pointerup', endPan);
        n.input.on('pointerupoutside', endPan);
        // Tap on empty space closes the detail panel.
        n.input.on('pointertap', () => {
            if (this._dragDist <= DRAG_TAP_SLOP) this._closeSystemData();
        });

        // Wheel zoom. Attached to the viewport so it also fires when the
        // pointer is over a body pin (events bubble up from pins).
        n.viewport.on('wheel', (e) => {
            e.preventDefault();
            const local = this.root.toLocal(e.global);
            this._zoomAt(local.x, local.y, e.deltaY > 0 ? 1 / WHEEL_STEP : WHEEL_STEP);
        });

        // Body pins: tap selects (unless the tap was really a drag).
        n.pins.forEach(({ poi, container }) => {
            container.on('pointertap', () => {
                if (this._dragDist > DRAG_TAP_SLOP) return;
                this._onPinTapped(poi);
            });
        });

        // Zoom buttons.
        const cx = () => this._map.mapX + this._map.mapW / 2;
        const cy = () => this._map.mapY + this._map.mapH / 2;
        n.controls.plus.on('pointertap', () => this._zoomAt(cx(), cy(), BUTTON_STEP));
        n.controls.minus.on('pointertap', () => this._zoomAt(cx(), cy(), 1 / BUTTON_STEP));
        n.controls.reset.on('pointertap', () => this._resetCamera());
    }
    _buildControls() {
        const container = new Container();
        const mkButton = (label, x, y) => {
            const btn = new Container();
            btn.eventMode = 'static';
            btn.cursor = 'pointer';
            const bg = new Graphics();
            bg.circle(0, 0, 13).fill({ color: 0x0f172a, alpha: 0.85 });
            bg.circle(0, 0, 13).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.5 });
            btn.addChild(bg);
            const t = new Text({
                text: label,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 14,
                    fontWeight: '700',
                    fill: COLOR_SLATE_200,
                }),
            });
            t.anchor.set(0.5);
            btn.addChild(t);
            btn.hitArea = new Rectangle(-13, -13, 26, 26);
            btn.position.set(x, y);
            container.addChild(btn);
            return btn;
        };
        const plus = mkButton('+', 0, 0);
        const minus = mkButton('\u2212', 0, 32);
        const reset = mkButton('\u21BA', 0, 64);
        return { container, plus, minus, reset, width: 26, height: 78 };
    }
    // ----------------------------------------------------------------
    // Overlay builders
    // ----------------------------------------------------------------

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
    _buildSystemData() {
        const container = new Container();
        const panel = drawHologramPanel(240, 168, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('SYSTEM DATA', COLOR_CYAN_300, { size: 11 });
        header.position.set(12, 10);
        panel.addChild(header);

        const mkText = (fontSize, fill) => new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize,
                fontWeight: fontSize >= 14 ? '700' : '400',
                fill,
            }),
        });

        const name = mkText(14, COLOR_SLATE_200);
        name.position.set(12, 28);
        panel.addChild(name);

        const klass = mkText(11, COLOR_SLATE_400);
        klass.position.set(12, 48);
        panel.addChild(klass);

        const planets = mkText(11, COLOR_SLATE_400);
        planets.position.set(12, 64);
        panel.addChild(planets);

        const threat = mkText(11, COLOR_ROSE_300);
        threat.position.set(12, 82);
        panel.addChild(threat);

        const warp = mkText(11, COLOR_AMBER_300);
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
        this._layoutSystemData();
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

        // Map window: everything below the title strip, inset from the
        // panel edges.
        const pad = 20;
        const mapX = pad;
        const mapY = 40;
        const mapW = Math.max(240, w - pad * 2);
        const mapH = Math.max(200, h - mapY - pad);
        this._map = { mapX, mapY, mapW, mapH };

        // --- Clip mask + window frame.
        n.maskG.clear();
        n.maskG.rect(mapX, mapY, mapW, mapH).fill({ color: 0xffffff });
        n.frame.clear();
        n.frame.rect(mapX, mapY, mapW, mapH).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.35 });

        // --- Input hit area covers the whole window.
        n.input.hitArea = new Rectangle(mapX, mapY, mapW, mapH);

        // --- Backdrop: deep-space tint + deterministic star speckle,
        //     drawn past the window edge so panning never reveals gaps.
        n.backdrop.clear();
        const m = 260;
        n.backdrop.rect(mapX - m, mapY - m, mapW + m * 2, mapH + m * 2).fill({ color: COLOR_DEEP, alpha: 0.6 });
        const rng = createBackdropRNG((this._seed ^ 0x5f3759df) >>> 0);
        for (let i = 0; i < 160; i++) {
            const sx = mapX - m + rng() * (mapW + m * 2);
            const sy = mapY - m + rng() * (mapH + m * 2);
            const r = 0.6 + rng() * 1.1;
            n.backdrop.circle(sx, sy, r).fill({ color: COLOR_SLATE_200, alpha: 0.12 + rng() * 0.25 });
        }

        // --- First layout: fit the whole system into the window.
        if (!this._fitted) this._fitCamera();
        this._applyCamera();

        // --- Hint: bottom-center of the window.
        n.hint.position.set(mapX + mapW / 2 - n.hint.width / 2, mapY + mapH - 18);

        // --- Legend: bottom-left of the window.
        const legendW = n.legend.width;
        const legendH = n.legend.height;
        redrawHologramPanel(n.legend.panel, legendW, legendH, COLOR_CYAN_500);
        n.legend.container.position.set(mapX + 8, mapY + mapH - legendH - 8);

        // --- Zoom controls: right edge of the window.
        n.controls.container.position.set(mapX + mapW - 34, mapY + mapH - n.controls.height - 30);

        this._updateBodies();
        this._layoutSystemData();
    }

    // Anchor the floating SYSTEM DATA panel next to the selected body's
    // current screen position, clamped inside the map window.
    _layoutSystemData() {
        const n = this._nodes;
        if (!n?.systemData.container.visible || !this._selectedId) return;
        const sel = this._findBody(this._selectedId);
        if (!sel) return;
        const pos = this._poiPosition(sel);
        const wx = (pos.x - 0.5) * WORLD_SPAN;
        const wy = (pos.y - 0.5) * WORLD_SPAN;
        const { mapX, mapY, mapW, mapH } = this._map;
        const anchorX = mapX + mapW / 2 + this._cam.x + wx * this._cam.zoom;
        const anchorY = mapY + mapH / 2 + this._cam.y + wy * this._cam.zoom;
        const sw = n.systemData.width;
        const sh = n.systemData.height;
        let sx = anchorX + 18;
        let sy = anchorY - sh / 2;
        if (sx + sw > mapX + mapW - 8) sx = Math.max(mapX + 8, anchorX - sw - 18);
        if (sy < mapY + 8) sy = mapY + 8;
        if (sy + sh > mapY + mapH - 8) sy = mapY + mapH - sh - 8;
        n.systemData.container.position.set(sx, sy);
    }
}

export const STAR_MAP_SECTORS = [];
export { LEGEND as STAR_MAP_LEGEND };

// Export the default seed constant for use in hub-scene.js
export { DEFAULT_SYSTEM_SEED as STAR_MAP_DEFAULT_SEED };









