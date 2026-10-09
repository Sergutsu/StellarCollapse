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
import { SECTORS, sectorRoster, discoveryProgress, bonusLabelFor } from '../../star-map.js';

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
// Kept low on purpose: a system with invisible moons reads as a starfield of
// dots rather than a planetary system, which is the whole point of this tab.
const MOON_ZOOM_REVEAL = 1.0; // x fit zoom
const SHIP_ZOOM_REVEAL = 0.85;

// Orbital motion is decorative, so it runs at a fraction of wall time:
// planets take ~2 minutes per orbit instead of ~30 seconds, and moons
// ~20s instead of ~5s. Fast motion made the chart unreadable and made
// the SYSTEM DATA panel swim while it tracked a body.
const ORBIT_TIME_SCALE = 0.25;

// Body sizes in screen px (glyphs are counter-scaled against zoom, so these
// are what the player actually sees at any zoom level).
const STAR_GLYPH_SIZE = 26;
const PLANET_GLYPH_BASE = 9;
const PLANET_GLYPH_PER_RADIUS = 1.7;

// Per-type surface dressing. `ring` is the outer-ring radius as a multiple
// of the disc radius (gas + ice giants only); `bands` are latitude stripes
// drawn as ellipses clipped to the disc by construction.
const PLANET_TYPE_STYLE = Object.freeze({
    'Ocean':       Object.freeze({ bands: 0, blobs: 3, blobColor: 0x2f7d55, capAlpha: 0.45, atmo: 0x7fd4ff }),
    'Terrestrial': Object.freeze({ bands: 0, blobs: 4, blobColor: 0x4f7a3a, capAlpha: 0.40, atmo: 0xa7d8ff }),
    'Desert':      Object.freeze({ bands: 0, blobs: 4, blobColor: 0xb4813f, capAlpha: 0.18, atmo: 0xffd9a0 }),
    'Gas Giant':   Object.freeze({ bands: 5, blobs: 1, blobColor: 0xfff3e0, capAlpha: 0.00, atmo: 0xffcf9a, ring: 1.95 }),
    'Ice Giant':   Object.freeze({ bands: 3, blobs: 0, blobColor: 0xdff6ff, capAlpha: 0.28, atmo: 0x9fe8ff, ring: 1.6 }),
});

/** Deterministic per-body RNG so surface detail never shimmers frame to frame. */
function bodyRng(seedStr) {
    let h = 2166136261;
    const str = String(seedStr ?? 'body');
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    let s = h >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Pointer movement (px) below which a down/up pair still counts as a tap.
const DRAG_TAP_SLOP = 5;

// SECTOR NETWORK rail: the strategic layer beside the system chart. It
// needs the room, so on narrow viewports it collapses and the map takes
// the full width again.
// HubScene._buildSidePanel() mounts `list` at (12, 40) inside the frame.
const SIDE_LIST_TOP = 40;
const SECTOR_PANEL_W = 244;
const SECTOR_PANEL_MIN_W = 780;
const SECTOR_PANEL_GAP = 12;
const COLOR_GREEN_400 = 0x4ade80;
const COLOR_VIOLET_300 = 0xa78bfa;

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
/**
 * Draw one celestial body. Planets are shaded discs with type-specific
 * surface dressing (latitude bands for giants, continents for rocky
 * worlds, ice caps, an atmosphere halo and — for the giants — a ring
 * system), not the flat dots that used to make the chart read as a
 * starfield. Everything is drawn inside the disc by construction: bands
 * and caps are ellipses whose half-width is `sqrt(r² − y²)`, so no
 * clipping mask is needed.
 */
function drawBodyGlyph(g, poi, size) {
    const color = poi?.color ?? COLOR_SLATE_400;
    const poiType = poi?.poiType;
    g.clear();

    if (poiType === 'star') {
        // Corona + photosphere + a hot core highlight.
        g.circle(0, 0, size * 2.4).fill({ color, alpha: 0.05 });
        g.circle(0, 0, size * 1.75).fill({ color, alpha: 0.09 });
        g.circle(0, 0, size * 1.28).fill({ color, alpha: 0.16 });
        g.circle(0, 0, size).fill({ color, alpha: 1 });
        g.circle(0, 0, size * 0.72).fill({ color: 0xfff7d6, alpha: 0.55 });
        g.circle(-size * 0.24, -size * 0.24, size * 0.3).fill({ color: 0xffffff, alpha: 0.4 });
        return;
    }

    if (poiType === 'planet') {
        const style = PLANET_TYPE_STYLE[poi.type] || PLANET_TYPE_STYLE.Terrestrial;
        const rng = bodyRng(poi.id || poi.name);

        // Ring system: back half first, so the disc overlaps it.
        if (style.ring) {
            g.ellipse(0, 0, size * style.ring, size * style.ring * 0.26)
                .stroke({ color: style.atmo, width: Math.max(1.5, size * 0.09), alpha: 0.32 });
        }

        // Atmosphere halo, then the disc.
        g.circle(0, 0, size * 1.3).fill({ color: style.atmo, alpha: 0.09 });
        g.circle(0, 0, size * 1.12).fill({ color: style.atmo, alpha: 0.09 });
        g.circle(0, 0, size).fill({ color, alpha: 1 });

        // Latitude bands (giants): each band is an ellipse clipped to the
        // disc because its half-width is derived from the disc equation.
        for (let i = 0; i < style.bands; i += 1) {
            const y = -size * 0.78 + (i * size * 1.56) / Math.max(1, style.bands - 1);
            const halfW = Math.sqrt(Math.max(0, size * size - y * y));
            const shade = i % 2 === 0 ? 0xffffff : 0x0b1120;
            g.ellipse(0, y, halfW * 0.99, Math.max(1, size * 0.13))
                .fill({ color: shade, alpha: i % 2 === 0 ? 0.1 : 0.16 });
        }

        // Continents / mottling on rocky worlds. Centres stay inside
        // 0.55r with a 0.26r radius, so blobs can't spill off the limb.
        for (let i = 0; i < style.blobs; i += 1) {
            const a = rng() * Math.PI * 2;
            const d = rng() * size * 0.55;
            const bx = Math.cos(a) * d;
            const by = Math.sin(a) * d * 0.8;
            g.ellipse(bx, by, size * (0.14 + rng() * 0.12), size * (0.1 + rng() * 0.1))
                .fill({ color: style.blobColor, alpha: 0.5 });
        }

        // Polar ice caps.
        if (style.capAlpha > 0) {
            for (const sign of [-1, 1]) {
                const y = sign * size * 0.84;
                const halfW = Math.sqrt(Math.max(0, size * size - y * y));
                g.ellipse(0, y, halfW * 0.92, size * 0.15)
                    .fill({ color: 0xf8fbff, alpha: style.capAlpha });
            }
        }

        // Limb light + the ring's front half.
        g.circle(0, 0, size).stroke({ color: 0xffffff, width: 1, alpha: 0.22 });
        if (style.ring) {
            g.ellipse(0, size * 0.02, size * style.ring, size * style.ring * 0.26)
                .stroke({ color: style.atmo, width: Math.max(1, size * 0.05), alpha: 0.18 });
        }
        return;
    }

    if (poiType === 'moon') {
        g.circle(0, 0, size).fill({ color, alpha: 0.95 });
        const rng = bodyRng(poi.id || poi.name);
        for (let i = 0; i < 2; i += 1) {
            const a = rng() * Math.PI * 2;
            const d = rng() * size * 0.4;
            g.circle(Math.cos(a) * d, Math.sin(a) * d, size * 0.18)
                .fill({ color: 0x0b1120, alpha: 0.22 });
        }
        g.circle(0, 0, size).stroke({ color: 0xffffff, width: 0.75, alpha: 0.18 });
        return;
    }

    if (poiType === 'station') {
        g.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).closePath();
        g.fill({ color: 0x0b1120, alpha: 0.7 });
        g.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.95 });
        g.circle(0, 0, size * 0.32).fill({ color, alpha: 0.95 });
        return;
    }

    if (poiType === 'hazard') {
        const t = size * 1.1;
        g.moveTo(0, -t).lineTo(t, t).lineTo(-t, t).closePath();
        g.fill({ color: 0x0b1120, alpha: 0.6 });
        g.moveTo(0, -t).lineTo(t, t).lineTo(-t, t).closePath();
        g.stroke({ color, width: 1.5, alpha: 0.9 });
        g.circle(0, 0, size * 0.3).fill({ color, alpha: 0.9 });
        return;
    }

    if (poiType === 'ship') {
        g.moveTo(0, -size).lineTo(size * 0.7, size).lineTo(0, size * 0.5).lineTo(-size * 0.7, size).closePath();
        g.fill({ color, alpha: 0.95 });
        return;
    }

    g.circle(0, 0, size).stroke({ color, width: 1.5, alpha: 0.85 });
    g.circle(0, 0, size * 0.4).fill({ color, alpha: 0.95 });
}

/** On-screen glyph radius for a body, by kind. */
function bodyGlyphSize(poi) {
    switch (poi?.poiType) {
        case 'star': return STAR_GLYPH_SIZE;
        case 'planet': return PLANET_GLYPH_BASE + (poi.radius || 6) * PLANET_GLYPH_PER_RADIUS;
        case 'moon': return 3 + (poi.radius || 2) * 1.1;
        case 'station': return 7;
        case 'hazard': return 7;
        case 'ship': return 5;
        default: return 6;
    }
}

/**
 * How long one orbit takes *on screen*, i.e. after `ORBIT_TIME_SCALE`. The
 * raw period is `2π / orbitSpeed` in milliseconds; the chart advances that
 * clock at quarter speed, so the real wait is four times longer. Moons come
 * out in seconds and planets in minutes — printing "~0 min" for a moon would
 * be worse than printing nothing.
 */
function orbitPeriodLabel(orbitSpeed) {
    if (!(orbitSpeed > 0)) return null;
    const realSec = (Math.PI * 2) / (orbitSpeed * 1000 * ORBIT_TIME_SCALE);
    if (!Number.isFinite(realSec)) return null;
    if (realSec < 90) return `${Math.round(realSec)} s`;
    const minutes = realSec / 60;
    return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min`;
}

/**
 * The night side of a body: a half-disc rotated so its flat edge faces the
 * light source. Drawn as a sibling of the glyph (not inside it) so the
 * label underneath never rotates.
 */
function drawBodyShade(g, size) {
    g.clear();
    g.arc(0, 0, size, -Math.PI / 2, Math.PI / 2).closePath().fill({ color: 0x020617, alpha: 0.5 });
}

export class StarMapTab {
    constructor({ parent, seed = DEFAULT_SYSTEM_SEED, meta = null, side = null }) {
        if (!parent) throw new Error('StarMapTab: parent container is required');
        this.parent = parent;
        // MetaState drives the sector network: warp balance, charted ids,
        // research modifiers. Without it the rail renders read-only.
        this._meta = meta;
        // The hub's left-column panel, which this tab owns while it is the
        // active tab: it carries the SYSTEM DATA board for the selected
        // body plus an index of every body in the system.
        this._side = side;
        this._sideW = 276;
        this._sideH = 420;
        this.usesSidePanel = true;
        this.sidePanelTitle = 'SYSTEM DATA';
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedId = null;
        this._selectedSectorId = null;
        this._sectorRows = [];
        this._sectorStatus = 'SELECT A SECTOR TO PLOT A COURSE';
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
        this._refreshSectors();
    }

    hide() {
        this.root.visible = false;
        this._pan = null;
        this._selectedId = null;
        // The bay is shared: leaving the tab must take this tab's content
        // with it, or it renders behind whoever owns the panel next.
        if (this._sideRoot) this._sideRoot.visible = false;
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
        // Scaled, not raw: orbital motion is ambience and must not outpace
        // the player reading the chart (see ORBIT_TIME_SCALE).
        this._timeMs += (deltaMs || 0) * ORBIT_TIME_SCALE;
        this._updateBodies();
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

        const controls = this._buildControls();
        root.addChild(controls.container);

        const sectors = this._buildSectorPanel();
        root.addChild(sectors.container);

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

        this._nodes = { title, viewport, maskG, backdrop, input, world, orbits, frame, pins, legend, controls, hint, sectors };
        this._drawOrbitRings();
        this._attachInput();
        this._publishSelection();
    }

    _buildPins(world) {
        return this._mapBodies()
            .filter((poi) => poi.poiType !== 'belt') // belts render as rings
            .map((poi) => {
                const container = new Container();
                container.eventMode = 'static';
                container.cursor = 'pointer';

                const size = bodyGlyphSize(poi);
                const glyph = new Graphics();
                drawBodyGlyph(glyph, poi, size);
                container.addChild(glyph);

                // Night side, rotated toward the light source every frame.
                // Only round bodies get one; stations/hazards/ships are
                // glyphs, not lit spheres.
                let shade = null;
                if (poi.poiType === 'planet' || poi.poiType === 'moon') {
                    shade = new Graphics();
                    drawBodyShade(shade, size);
                    container.addChild(shade);
                }

                // Selection reticle, drawn under the glyph so it reads as a
                // ring around the body rather than over it.
                const reticle = new Graphics();
                reticle.circle(0, 0, size + 7).stroke({ color: COLOR_CYAN_300, width: 1.2, alpha: 0.9 });
                reticle.circle(0, 0, size + 11).stroke({ color: COLOR_CYAN_300, width: 0.8, alpha: 0.35 });
                reticle.visible = false;
                container.addChildAt(reticle, 0);

                const showLabel = poi.poiType === 'star' || poi.poiType === 'planet' || poi.poiType === 'station';
                let label = null;
                let subLabel = null;
                if (showLabel) {
                    label = new Text({
                        text: poi.name,
                        style: new TextStyle({
                            fontFamily: 'Inter, sans-serif',
                            fontSize: 10,
                            fontWeight: '700',
                            fill: COLOR_SLATE_200,
                            stroke: { color: 0x020617, width: 3, alpha: 0.85 },
                        }),
                    });
                    label.anchor.set(0.5, 0);
                    label.position.set(0, size + 5);
                    container.addChild(label);

                    // The classification line is what makes a planet read as
                    // a planet instead of another dot in the sky.
                    if (poi.type) {
                        subLabel = new Text({
                            text: String(poi.type).toUpperCase(),
                            style: new TextStyle({
                                fontFamily: '"Courier New", monospace',
                                fontSize: 8,
                                letterSpacing: 0.8,
                                fill: poi.poiType === 'star' ? COLOR_AMBER_300 : COLOR_CYAN_300,
                                stroke: { color: 0x020617, width: 3, alpha: 0.85 },
                            }),
                        });
                        subLabel.anchor.set(0.5, 0);
                        subLabel.position.set(0, size + 18);
                        container.addChild(subLabel);
                    }
                }

                // Hit area in local px; counter-scaling keeps it a
                // constant ~28px target on screen at any zoom.
                const pad = Math.max(size, 12) + 4;
                container.hitArea = new Rectangle(-pad, -pad, pad * 2, pad * 2);

                world.addChild(container);
                return { poi, container, glyph, shade, reticle, label, subLabel, size };
            });
    }

    _drawOrbitRings() {
        const g = this._nodes.orbits;
        g.clear();
        // Which orbit the selected body sits on, so picking a planet also
        // lights its lane.
        const selected = this._selectedId ? this._findBody(this._selectedId) : null;
        const selectedRadius = selected && selected.poiType === 'planet'
            ? selected.orbitRadius
            : null;
        this._system.orbits.forEach((o) => {
            const r = o.radius * WORLD_SPAN;
            if (o.isBelt) {
                // Wide faint band + thin edge lines to suggest rubble.
                g.circle(0, 0, r).stroke({ color: o.color ?? 0xd4a574, width: Math.max(4, (o.width || 0.04) * WORLD_SPAN), alpha: 0.07 });
                g.circle(0, 0, r).stroke({ color: o.color ?? 0xd4a574, width: 1, alpha: 0.22 });
            } else {
                const isSel = selectedRadius !== null && Math.abs(o.radius - selectedRadius) < 1e-6;
                g.circle(0, 0, r).stroke({
                    color: isSel ? COLOR_CYAN_300 : (o.color ?? COLOR_CYAN_500),
                    width: isSel ? 1.8 : 1,
                    alpha: isSel ? 0.75 : 0.26,
                });
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
        const star = this._system?.star || null;
        const starX = star?.x ?? 0.5;
        const starY = star?.y ?? 0.5;
        n.pins.forEach((pin) => {
            const { poi, container, shade, reticle } = pin;
            const pos = this._poiPosition(poi);
            container.position.set((pos.x - 0.5) * WORLD_SPAN, (pos.y - 0.5) * WORLD_SPAN);
            container.scale.set(invZ); // constant on-screen glyph size

            // Light comes from the central star: rotate the night side so
            // its flat edge faces the star. Moons use their planet's
            // position as the light direction, which is close enough at
            // these scales and keeps the pair visually consistent.
            if (shade) {
                let lx = starX;
                let ly = starY;
                if (poi.poiType === 'moon') {
                    const parent = this._parentFor(poi);
                    if (parent) {
                        const pp = this._poiPosition(parent);
                        lx = pp.x;
                        ly = pp.y;
                    }
                }
                shade.rotation = Math.atan2(pos.y - ly, pos.x - lx);
            }

            if (reticle) reticle.visible = poi.id === this._selectedId;
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
    // ----------------------------------------------------------------
    // SYSTEM DATA — the hub's left-column panel
    //
    // The body read-out used to float over the map and swim along with
    // whatever it was anchored to. It now lives in the hub's left panel,
    // which is where the player already looks for contextual data, and it
    // is joined by an index of every body in the system so nothing has to
    // be hunted for among the orbit rings.
    // ----------------------------------------------------------------

    /** Called by HubScene on activation and on every resize. */
    layoutSide({ width = 276, height = 420 } = {}) {
        this._sideW = Math.max(180, Math.floor(width));
        this._sideH = Math.max(200, Math.floor(height));
        this._renderSidePanel();
    }

    /** Re-render the left panel from the current selection. */
    _publishSelection() {
        this._renderSidePanel();
    }

    _renderSidePanel() {
        const side = this._side;
        if (!side?.list) return;
        // This tab's own subtree inside the shared bay. Clearing `side.list`
        // itself would destroy whatever the SHIPYARD or MARKET tab parked
        // there — the bay is shared, so each owner keeps its content in its
        // own container and only ever clears that.
        if (!this._sideRoot) this._sideRoot = new Container();
        if (this._sideRoot.parent !== side.list) side.list.addChild(this._sideRoot);
        this._sideRoot.visible = true;
        const list = this._sideRoot;
        list.removeChildren().forEach((child) => child?.destroy?.({ children: true }));

        const innerW = this._sideW - 24;
        const selected = this._selectedId ? this._findBody(this._selectedId) : null;
        let y = 0;

        // --- Selected body -----------------------------------------
        // At the shortest hub viewport the bay is ~320 px of usable height;
        // dropping the prose blurb there keeps the survey numbers, the jump
        // button and at least a few index rows on screen.
        const usableH = this._sideH - SIDE_LIST_TOP;
        if (selected) {
            y = this._renderBodyDetail(list, selected, innerW, y, { compact: usableH < 300 });
        } else {
            const hint = new Text({
                text: 'Tap a planet, moon, station or hazard to read its survey data.',
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif', fontSize: 10, fill: COLOR_SLATE_400,
                    wordWrap: true, wordWrapWidth: innerW, lineHeight: 14,
                }),
            });
            hint.position.set(0, y);
            list.addChild(hint);
            y += hint.height + 12;
        }

        // --- System index ------------------------------------------
        y += 6;
        const rule = new Graphics().rect(0, y, innerW, 1).fill({ color: 0x334155, alpha: 0.9 });
        list.addChild(rule);
        y += 9;

        const header = panelLabel('SYSTEM INDEX', COLOR_CYAN_300, { size: 10 });
        header.position.set(0, y);
        list.addChild(header);
        y += 16;

        const bodies = this._indexBodies();
        // 40 = the header offset HubScene gives `list` inside the frame.
        const room = this._sideH - SIDE_LIST_TOP - y;
        const remaining = Math.max(24, room);   // divisor for the row height only
        const rowH = Math.max(15, Math.min(24, Math.floor(remaining / Math.max(1, bodies.length))));
        // Never draw past the bottom of the panel: at short viewport heights
        // the index is truncated (star and planets come first) and says so.
        // `maxRows` is measured against the *real* room left, so a tall body
        // read-out can shrink the index to nothing rather than overflow.
        const maxRows = room >= rowH + 12 ? Math.max(0, Math.floor((room - 12) / rowH)) : 0;
        const shown = bodies.slice(0, maxRows);
        const hidden = bodies.length - shown.length;

        shown.forEach((body) => {
            const row = new Container();
            row.position.set(0, y);
            row.eventMode = 'static';
            row.cursor = 'pointer';
            row.hitArea = new Rectangle(0, -1, innerW, rowH);
            list.addChild(row);
            y += rowH;

            const isSelected = body.id === this._selectedId;
            if (isSelected) {
                row.addChild(new Graphics().rect(0, 0, innerW, rowH - 1).fill({ color: COLOR_CYAN_500, alpha: 0.16 }));
            }

            const dot = new Graphics();
            dot.circle(4, Math.round(rowH / 2), 3).fill({ color: body.color || pinColor(body.poiType), alpha: 0.95 });
            row.addChild(dot);

            const name = new Text({
                text: String(body.name || body.id).toUpperCase(),
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: rowH >= 20 ? 10 : 9,
                    fontWeight: isSelected ? '800' : '600',
                    fill: isSelected ? COLOR_CYAN_300 : COLOR_SLATE_200,
                }),
            });
            name.position.set(13, Math.max(0, (rowH - name.height) / 2 - 1));
            row.addChild(name);

            const kind = new Text({
                text: String(body.type || body.poiType || '').toUpperCase(),
                style: new TextStyle({
                    fontFamily: '"Courier New", monospace',
                    fontSize: rowH >= 20 ? 8 : 7,
                    fill: COLOR_SLATE_400,
                }),
            });
            kind.anchor.set(1, 0);
            kind.position.set(innerW - 2, Math.max(0, (rowH - kind.height) / 2 - 1));
            row.addChild(kind);

            row.on('pointertap', () => this._onPinTapped(body));
        });

        if (hidden > 0 && room >= 24) {
            const more = new Text({
                text: `+${hidden} MORE \u2014 ZOOM THE CHART TO PICK THEM`,
                style: new TextStyle({
                    fontFamily: '"Courier New", monospace', fontSize: 8, fill: COLOR_SLATE_400,
                }),
            });
            more.position.set(0, y + 2);
            list.addChild(more);
        }
    }

    /** The survey read-out for one body. Returns the next free y. */
    _renderBodyDetail(list, body, innerW, startY, { compact = false } = {}) {
        let y = startY;
        const addText = (text, { size = 10, fill = COLOR_SLATE_200, weight = '400', gap = 2, mono = false } = {}) => {
            const node = new Text({
                text,
                style: new TextStyle({
                    fontFamily: mono ? '"Courier New", monospace' : 'Inter, sans-serif',
                    fontSize: size,
                    fontWeight: weight,
                    fill,
                    wordWrap: true,
                    wordWrapWidth: innerW,
                    lineHeight: size + 4,
                }),
            });
            node.position.set(0, y);
            list.addChild(node);
            y += node.height + gap;
            return node;
        };

        addText(String(body.name || body.id).toUpperCase(), { size: 13, fill: COLOR_SLATE_200, weight: '800', gap: 3 });
        addText(`${String(body.type || body.poiType || 'unknown').toUpperCase()}  \u00B7  ${body.poiType === 'star' ? 'PRIMARY' : `ORBIT ${((body.orbitRadius || 0) * 100).toFixed(1)} AU`}`,
            { size: 9, fill: COLOR_CYAN_300, mono: true, gap: 6 });

        const blurb = body.description
            || (body.services ? `Services: ${body.services.join(', ')}` : null)
            || (body.faction ? `Faction: ${body.faction}` : null)
            || (body.temperature ? `Surface temp ${body.temperature}` : null);
        if (blurb && !compact) addText(blurb, { size: 10, fill: COLOR_SLATE_400, gap: 6 });

        // Threat pips.
        const threat = Math.max(0, Math.min(5, Math.floor(body.threat ?? 0)));
        const threatRow = new Container();
        threatRow.position.set(0, y);
        list.addChild(threatRow);
        const threatLabel = panelLabel('THREAT', COLOR_SLATE_400, { size: 9 });
        threatRow.addChild(threatLabel);
        const pips = new Graphics();
        for (let i = 0; i < 5; i += 1) {
            const on = i < threat;
            pips.rect(56 + i * 12, 1, 8, 8).fill({ color: on ? (threat >= 4 ? COLOR_ROSE_300 : COLOR_AMBER_300) : 0x1e293b, alpha: on ? 0.95 : 0.8 });
        }
        threatRow.addChild(pips);
        y += 16;

        // Survey numbers: resources for planets/moons, orbiters otherwise.
        const shipsHere = getShipsOrbitingPoi(this._system.ships, body.id);
        const moons = (this._system.pois || []).filter((p) => p.poiType === 'moon' && p.parentId === body.id);
        if (body.resources) {
            const r = body.resources;
            const grid = [
                ['MINERALS', r.minerals], ['O2', r.o2], ['FUEL', r.fuel], ['WARP', r.warp],
            ];
            grid.forEach(([label, value], i) => {
                const col = i % 2;
                const row = Math.floor(i / 2);
                const cell = new Container();
                cell.position.set(col * Math.floor(innerW / 2), y + row * 26);
                list.addChild(cell);
                const cap = panelLabel(label, COLOR_SLATE_400, { size: 8 });
                cell.addChild(cap);
                const val = new Text({
                    text: String(value ?? 0),
                    style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 13, fontWeight: '800', fill: COLOR_AMBER_300 }),
                });
                val.position.set(0, 10);
                cell.addChild(val);
            });
            y += 58;
        }

        const period = orbitPeriodLabel(body.orbitSpeed);
        addText([
            `Orbiters: ${shipsHere.length}`,
            moons.length ? `Moons: ${moons.length}` : null,
            period ? `Orbit: ~${period}` : null,
        ].filter(Boolean).join('   \u00B7   '), { size: 9, fill: COLOR_SLATE_400, mono: true, gap: 8 });

        // PLOT COURSE charts the selected sector (the strategic action);
        // the button lives with the body data because that is where the
        // player is looking when they decide to jump. Priced off the same
        // annotated roster as the SECTOR NETWORK rail, so a warp-coil
        // discount shows in both places at once.
        const sector = this._rosterSector(this._selectedSectorId);
        const plot = buildStartButton({
            text: sector && !sector.charted ? `PLOT COURSE \u00B7 ${sector.cost} WARP` : 'PLOT COURSE',
            width: innerW,
            height: 28,
            onTap: () => this._onPlotCourse(),
        });
        plot.container.alpha = sector && !sector.charted ? 1 : 0.45;
        plot.container.position.set(0, y);
        list.addChild(plot.container);
        y += 36;

        const status = new Text({
            text: this._sectorStatus,
            style: new TextStyle({
                fontFamily: '"Courier New", monospace', fontSize: 9, fill: COLOR_CYAN_300,
                wordWrap: true, wordWrapWidth: innerW, lineHeight: 12,
            }),
        });
        status.position.set(0, y);
        list.addChild(status);
        y += status.height + 4;

        return y;
    }

    /** One sector from the annotated roster (cost after tech modifiers). */
    _rosterSector(sectorId) {
        if (!sectorId) return null;
        const meta = this._meta;
        const roster = sectorRoster({
            discoveredIds: meta ? meta.discoveredSectorIds() : [],
            effects: meta ? meta.getEffects() : null,
        });
        return roster.find((s) => s.id === sectorId) || null;
    }

    /** Bodies worth listing: primary, planets, stations, hazards, belts. */
    _indexBodies() {
        const star = this._system?.star ? [{ ...this._system.star, poiType: 'star' }] : [];
        const pois = (this._system?.pois || []).filter((p) => p.poiType !== 'moon' && p.poiType !== 'ship');
        return [...star, ...pois];
    }

    // ----------------------------------------------------------------
    // SECTOR NETWORK rail
    //
    // The strategic half of the STAR MAP: thirteen chartable sectors, each
    // with a warp price, a threat rating and a permanent bonus. Rows are
    // rebuilt from `sectorRoster()` (cost after tech modifiers + charted
    // state), so the rail never drifts from MetaState.
    // ----------------------------------------------------------------

    _buildSectorPanel() {
        const container = new Container();
        container.visible = false;
        const panel = drawHologramPanel(SECTOR_PANEL_W, 400, { accent: COLOR_CYAN_500 });
        container.addChild(panel);

        const header = panelLabel('SECTOR NETWORK', COLOR_CYAN_300, { size: 11 });
        header.position.set(12, 10);
        panel.addChild(header);

        const progress = new Text({
            text: '0 / 13 CHARTED',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 10, letterSpacing: 1, fill: COLOR_SLATE_400 }),
        });
        progress.anchor.set(1, 0);
        panel.addChild(progress);

        const list = new Container();
        list.position.set(12, 30);
        panel.addChild(list);

        const detail = new Container();
        panel.addChild(detail);
        const mkText = (fontSize, fill, weight = '400') => new Text({
            text: '',
            style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize, fontWeight: weight, fill }),
        });
        const detailName = mkText(12, COLOR_SLATE_200, '700');
        const detailThreat = mkText(10, COLOR_ROSE_300);
        const detailSpecialty = mkText(10, COLOR_SLATE_400);
        detailSpecialty.wordWrap = true;
        detailSpecialty.wordWrapWidth = SECTOR_PANEL_W - 24;
        const detailBonus = mkText(10, COLOR_AMBER_300);
        detailBonus.wordWrap = true;
        detailBonus.wordWrapWidth = SECTOR_PANEL_W - 24;
        const detailReward = mkText(10, COLOR_VIOLET_300);
        detail.addChild(detailName, detailThreat, detailSpecialty, detailBonus, detailReward);

        const status = new Text({
            text: '',
            style: new TextStyle({ fontFamily: '"Courier New", monospace', fontSize: 9, letterSpacing: 0.5, fill: COLOR_SLATE_400, wordWrap: true, wordWrapWidth: SECTOR_PANEL_W - 24 }),
        });
        panel.addChild(status);

        const plot = buildStartButton({
            text: 'PLOT COURSE',
            width: SECTOR_PANEL_W - 24,
            height: 30,
            onTap: () => this._onPlotCourse(),
        });
        panel.addChild(plot.container);

        return { container, panel, header, progress, list, detail, detailName, detailThreat, detailSpecialty, detailBonus, detailReward, status, plot, width: SECTOR_PANEL_W, height: 400 };
    }

    /**
     * Rebuild the sector rows + detail block from the live profile. Row
     * height adapts to the panel so all thirteen always fit without
     * scrolling on any viewport the hub can produce.
     */
    _refreshSectors() {
        const n = this._nodes?.sectors;
        if (!n) return;
        const meta = this._meta;
        const discovered = meta ? meta.discoveredSectorIds() : [];
        const effects = meta ? meta.getEffects() : null;
        const roster = sectorRoster({ discoveredIds: discovered, effects });
        const warpHeld = meta ? meta.getHubResource('warp') : 0;

        const charted = discoveryProgress(discovered).charted;
        n.progress.text = `${charted} / ${roster.length} CHARTED`;
        n.progress.position.set(SECTOR_PANEL_W - 12, 10);

        n.list.removeChildren().forEach((child) => child?.destroy?.({ children: true }));
        this._sectorRows = [];

        const panelH = n.height;
        const reserved = 30 /* header */ + 96 /* detail */ + 42 /* button */ + 26 /* status */ + 18;
        const rowH = Math.max(13, Math.min(22, Math.floor((panelH - reserved) / roster.length)));
        const rowW = SECTOR_PANEL_W - 24;

        roster.forEach((sector, i) => {
            const row = new Container();
            row.position.set(0, i * rowH);
            row.eventMode = 'static';
            row.cursor = 'pointer';
            row.hitArea = new Rectangle(0, -1, rowW, rowH);
            n.list.addChild(row);

            const selected = sector.id === this._selectedSectorId;
            if (selected) {
                const hl = new Graphics().rect(0, 0, rowW, rowH - 1).fill({ color: COLOR_CYAN_500, alpha: 0.16 });
                row.addChild(hl);
            }

            const affordable = sector.charted || warpHeld >= sector.cost;
            const name = new Text({
                text: sector.name.toUpperCase(),
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: rowH >= 18 ? 10 : 9,
                    fontWeight: selected ? '800' : '600',
                    letterSpacing: 0.4,
                    fill: sector.charted ? COLOR_GREEN_400 : (affordable ? COLOR_SLATE_200 : COLOR_SLATE_400),
                }),
            });
            name.position.set(4, Math.max(0, (rowH - name.height) / 2 - 1));
            row.addChild(name);

            const cost = new Text({
                text: sector.charted ? '\u2713 CHARTED' : `\u25C6 ${sector.cost}`,
                style: new TextStyle({
                    fontFamily: '"Courier New", monospace',
                    fontSize: rowH >= 18 ? 10 : 9,
                    fontWeight: '700',
                    fill: sector.charted ? COLOR_GREEN_400 : (affordable ? COLOR_AMBER_300 : COLOR_ROSE_300),
                }),
            });
            cost.anchor.set(1, 0);
            cost.position.set(rowW - 4, Math.max(0, (rowH - cost.height) / 2 - 1));
            row.addChild(cost);

            row.on('pointertap', () => this._selectSector(sector.id));
            this._sectorRows.push({ container: row, sector });
        });

        this._renderSectorDetail(roster);
    }

    /** Selected-sector read-out: threat, specialty, bonus and the grant. */
    _renderSectorDetail(roster) {
        const n = this._nodes?.sectors;
        if (!n) return;
        const sector = roster.find((s) => s.id === this._selectedSectorId) || null;
        const detailY = n.height - 96 - 42 - 26 - 6;
        n.detail.position.set(12, detailY);
        n.detail.visible = !!sector;

        if (sector) {
            n.detailName.text = sector.name.toUpperCase();
            n.detailName.position.set(0, 0);
            n.detailThreat.text = `THREAT ${sector.threat}/5  \u00B7  WARP ${sector.cost}`;
            n.detailThreat.position.set(0, 15);
            n.detailSpecialty.text = sector.specialty || '';
            n.detailSpecialty.position.set(0, 29);
            n.detailBonus.text = bonusLabelFor(sector);
            n.detailBonus.position.set(0, 43);
            const reward = sector.reward || {};
            const rewardParts = [];
            if (reward.credits) rewardParts.push(`${reward.credits} CR`);
            if (reward.minerals) rewardParts.push(`${reward.minerals} MIN`);
            if (reward.warp) rewardParts.push(`${reward.warp} WARP`);
            if (reward.ores) {
                for (const [color, amount] of Object.entries(reward.ores)) rewardParts.push(`${amount} ${color.toUpperCase()}`);
            }
            n.detailReward.text = sector.charted ? 'ALREADY CHARTED' : `GRANT: ${rewardParts.join('  ')}`;
            n.detailReward.position.set(0, 68);
        }

        const buttonY = n.height - 42 - 26;
        n.plot.container.position.set(12, buttonY);
        n.plot.label.text = sector && !sector.charted ? `PLOT COURSE \u00B7 ${sector.cost} WARP` : 'PLOT COURSE';
        n.status.text = this._sectorStatus;
        n.status.position.set(12, n.height - 24);
    }

    _selectSector(sectorId) {
        this._selectedSectorId = sectorId;
        const sector = SECTORS.find((s) => s.id === sectorId) || null;
        this._announceSector(sector ? sector.brief || '' : 'SELECT A SECTOR TO PLOT A COURSE');
    }

    _layoutSectorPanel(mapX, mapY, mapW, mapH, availW) {
        const n = this._nodes?.sectors;
        if (!n) return;
        const wide = availW >= SECTOR_PANEL_MIN_W;
        n.container.visible = wide;
        if (!wide) return;
        n.height = Math.max(260, mapH);
        redrawHologramPanel(n.panel, SECTOR_PANEL_W, n.height, COLOR_CYAN_500);
        n.container.position.set(mapX + mapW + SECTOR_PANEL_GAP, mapY);
        this._refreshSectors();
    }
    // ----------------------------------------------------------------
    // Interactions
    // ----------------------------------------------------------------

    _onPinTapped(poi) {
        if (!poi) return;
        this._selectedId = poi.id;
        this._drawOrbitRings();
        // The read-out lives in the hub's left panel now.
        this._publishSelection();
    }

    /**
     * Chart the selected sector. `MetaState.chartSector()` runs the whole
     * jump atomically (warp cost + discovery grant + rep in one write) and
     * hands back the plan, so a refusal — already charted, not enough warp
     * cells, or a threat-5 sector without REP tier 3 — costs nothing and
     * just reports why.
     */
    _onPlotCourse() {
        if (!this._selectedSectorId) {
            this._announceSector('SELECT A SECTOR FROM THE NETWORK FIRST');
            return;
        }
        if (!this._meta) {
            this._announceSector('NO PROFILE ATTACHED \u2014 RAIL IS READ-ONLY');
            return;
        }

        const plan = this._meta.chartSector(this._selectedSectorId);
        if (!plan.ok) {
            this._announceSector(`JUMP REFUSED: ${String(plan.reason || 'unknown').toUpperCase()}`);
            return;
        }

        const grant = plan.rewards || {};
        const parts = [];
        if (grant.credits) parts.push(`+${grant.credits} CR`);
        if (grant.minerals) parts.push(`+${grant.minerals} MIN`);
        if (grant.warp) parts.push(`+${grant.warp} WARP`);
        if (grant.rep) parts.push(`+${grant.rep} REP`);
        // Keep the body selection: PLOT COURSE now lives inside the left
        // panel's body read-out, so clearing it would delete the button the
        // player just pressed.
        this._announceSector(`${plan.sector.name.toUpperCase()} CHARTED \u00B7 ${parts.join(' ')}`);
    }

    /**
     * Set the status line and repaint both places it appears: the SECTOR
     * NETWORK rail and the left panel's body read-out.
     */
    _announceSector(text) {
        this._sectorStatus = text;
        this._refreshSectors();
        this._publishSelection();
    }

    /** Clear the selection (empty map click, or after a successful jump). */
    _closeSystemData() {
        this._selectedId = null;
        if (this._nodes) this._drawOrbitRings();
        this._publishSelection();
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
        const availW = w - pad * 2;
        // The SECTOR NETWORK rail only appears once there is room for both
        // it and a usable system chart.
        const railW = availW >= SECTOR_PANEL_MIN_W ? SECTOR_PANEL_W + SECTOR_PANEL_GAP : 0;
        const mapW = Math.max(240, availW - railW);
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
        // Deep-space speckle. Deliberately sparse and dim: 160 bright dots
        // used to compete with the planets and the whole window read as a
        // starfield instead of a star *system*.
        const rng = createBackdropRNG((this._seed ^ 0x5f3759df) >>> 0);
        for (let i = 0; i < 90; i++) {
            const sx = mapX - m + rng() * (mapW + m * 2);
            const sy = mapY - m + rng() * (mapH + m * 2);
            const r = 0.5 + rng() * 0.8;
            n.backdrop.circle(sx, sy, r).fill({ color: COLOR_SLATE_200, alpha: 0.07 + rng() * 0.14 });
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
        this._layoutSectorPanel(mapX, mapY, mapW, mapH, availW);
    }

}

// The chartable sector network (was an empty placeholder until P8 wired
// the rail to src/star-map.js).
export const STAR_MAP_SECTORS = SECTORS;
export { LEGEND as STAR_MAP_LEGEND };

// Export the default seed constant for use in hub-scene.js
export { DEFAULT_SYSTEM_SEED as STAR_MAP_DEFAULT_SEED };









