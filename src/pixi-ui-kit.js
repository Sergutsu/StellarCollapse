// Shared Pixi UI-kit. Panel chrome, labels, buttons, star icons -- any
// render helper that more than one scene needs lives here. Scenes
// import directly from this module; no more hand-wired dependency
// injection through `PixiView` constructor arguments.
//
// Design notes:
// - Zero GameState / MetaState / DOM imports. Pure Pixi render data.
// - Every helper is a plain function (no class). Scenes that want a
//   per-instance cache wrap the call themselves.
// - Constants (panel gradient stops, border alpha, default button
//   tints) live in this file, not `src/constants.js`, because they're
//   strictly Pixi render data and nothing pure-state should depend on
//   them.
//
// Today's consumers: `src/scenes/hub-scene.js`, `src/scenes/game-scene.js`,
// `src/scenes/results-scene.js`. `src/pixi-view.js` no longer carries
// the implementations -- it delegates straight into this module.

import {
    Container,
    FillGradient,
    Graphics,
    Text,
    TextStyle,
} from 'pixi.js';

// Hologram panel tints -- picked to match the DOM CSS backdrop
// (cyan-ish translucent gradient with a thin cyan border).
export const PANEL_BG_TOP = 0x0b1b3a;
export const PANEL_BG_BOT = 0x050a1c;
export const PANEL_BORDER_ALPHA = 0.28;
export const PANEL_DEFAULT_ACCENT = 0x00d4ff;
export const PANEL_ACCENT_VARIANTS = Object.freeze({
    cyan: 0x22d3ee,
    amber: 0xf59e0b,
    magenta: 0xe879f9,
    green: 0x22c55e,
});

// Default button tints used by the hub + mission-board CTAs.
export const BUTTON_DEFAULT_FILL = 0x172554;
export const BUTTON_DEFAULT_HOVER = 0x1d4ed8;
export const BUTTON_DEFAULT_STROKE = 0x22d3ee;
export const BUTTON_DEFAULT_TEXT = 0xffffff;

// -------------------------------------------------------------------
// Panel chrome
// -------------------------------------------------------------------

function _resolveAccentColor(accent) {
    if (typeof accent === 'number' && Number.isFinite(accent)) return accent;
    return PANEL_ACCENT_VARIANTS[accent] ?? PANEL_DEFAULT_ACCENT;
}

function _angledPoints(x, y, w, h, cut) {
    const c = Math.max(2, Math.min(cut, Math.floor(Math.min(w, h) * 0.2)));
    return [
        x + c, y,
        x + w - c, y,
        x + w, y + c,
        x + w, y + h - c,
        x + w - c, y + h,
        x + c, y + h,
        x, y + h - c,
        x, y + c,
    ];
}

function _drawTechFrame({
    bgFill,
    outerStroke,
    innerStroke,
    glow,
    scan,
    w,
    h,
    accent,
    cut = 10,
    alpha = 0.65,
    scanAlpha = 0.05,
}) {
    const accentColor = _resolveAccentColor(accent);
    const grad = new FillGradient(0, 0, 0, h);
    grad.addColorStop(0, PANEL_BG_TOP);
    grad.addColorStop(1, PANEL_BG_BOT);
    const outerPts = _angledPoints(0, 0, w, h, cut);
    const innerPts = _angledPoints(2, 2, Math.max(4, w - 4), Math.max(4, h - 4), Math.max(2, cut - 2));

    bgFill.clear();
    bgFill.poly(outerPts).fill(grad);
    bgFill.alpha = alpha;

    glow.clear();
    glow.poly(outerPts).stroke({ color: accentColor, width: 7, alpha: 0.1 });
    glow.poly(innerPts).stroke({ color: accentColor, width: 3, alpha: 0.12 });

    outerStroke.clear();
    outerStroke.poly(outerPts).stroke({ color: accentColor, width: 1.25, alpha: PANEL_BORDER_ALPHA + 0.2 });

    innerStroke.clear();
    innerStroke.poly(innerPts).stroke({ color: accentColor, width: 1, alpha: PANEL_BORDER_ALPHA + 0.05 });

    scan.clear();
    for (let y = 3; y < h - 2; y += 3) {
        const inset = y < cut || y > h - cut ? 3 : 2;
        scan.rect(inset, y, Math.max(2, w - inset * 2), 1).fill({ color: accentColor, alpha: scanAlpha });
    }
}

export function drawTechPanel(w, h, { accent = 'cyan', cut = 10 } = {}) {
    const c = new Container();
    const bgFill = new Graphics();
    const glow = new Graphics();
    const outerStroke = new Graphics();
    const innerStroke = new Graphics();
    const scan = new Graphics();
    c.addChild(bgFill);
    c.addChild(glow);
    c.addChild(outerStroke);
    c.addChild(innerStroke);
    c.addChild(scan);
    _drawTechFrame({ bgFill, outerStroke, innerStroke, glow, scan, w, h, accent, cut });
    c.__techCut = cut;
    return c;
}

export function redrawTechPanel(panel, w, h, { accent = 'cyan', cut = null } = {}) {
    if (!panel) return;
    if (!Array.isArray(panel.children) || panel.children.length < 5) return;
    const [bgFill, glow, outerStroke, innerStroke, scan] = panel.children;
    const resolvedCut = typeof cut === 'number' ? cut : (panel.__techCut ?? 10);
    _drawTechFrame({
        bgFill, outerStroke, innerStroke, glow, scan, w, h, accent, cut: resolvedCut,
    });
}

export function drawTechChip(w, h, { accent = 'cyan' } = {}) {
    const container = new Container();
    const frame = drawTechPanel(w, h, { accent, cut: 8 });
    container.addChild(frame);
    return { container, frame, accent };
}

export function redrawTechChip(chipOrFrame, w, h, { accent = 'cyan' } = {}) {
    if (!chipOrFrame) return;
    const frame = chipOrFrame.frame ?? chipOrFrame;
    redrawTechPanel(frame, w, h, { accent, cut: 8 });
}

/**
 * Draw a hologram panel -- translucent gradient background, thin
 * accent border, faint horizontal scanline overlay. Children order
 * inside the returned Container is stable (bgFill, border, scan) so
 * `redrawHologramPanel` can reuse the same node tree on resize.
 *
 * @param {number} w   Width in pixels.
 * @param {number} h   Height in pixels.
 * @param {{ accent?: number }} [opts]
 * @returns {Container}
 */
export function drawHologramPanel(w, h, { accent = PANEL_DEFAULT_ACCENT } = {}) {
    return drawTechPanel(w, h, { accent });
}

/**
 * Redraw an existing panel container in place to a new size / accent,
 * without rebuilding the Container or re-adding children. Expects the
 * layout produced by `drawHologramPanel` (3 children: bgFill, border,
 * scan). No-ops if `panel` is null or has fewer than 3 children.
 */
export function redrawHologramPanel(panel, w, h, accent = PANEL_DEFAULT_ACCENT) {
    redrawTechPanel(panel, w, h, { accent });
}

// -------------------------------------------------------------------
// Text helpers
// -------------------------------------------------------------------

/**
 * Short, all-caps label with a soft glow matching its fill colour.
 * Used for panel titles, mission metadata, tab labels, etc.
 */
export function panelLabel(text, color, { size = 12, weight = '700' } = {}) {
    return new Text({
        text,
        style: new TextStyle({
            fontFamily: 'Inter, "Segoe UI", sans-serif',
            fontSize: size,
            fontWeight: weight,
            letterSpacing: 1,
            fill: color,
            dropShadow: {
                color, alpha: 0.6, blur: 6, distance: 0, angle: 0,
            },
        }),
    });
}

// -------------------------------------------------------------------
// Star icon
// -------------------------------------------------------------------

/**
 * 5-point star Graphics (radius r, filled with `color`). Used for the
 * reactive STELLAR VENTURE title actor and the hub's galactic-map
 * marker pins.
 */
export function drawStarShape(r, color) {
    const g = new Graphics();
    const spikes = 5;
    const inner = r * 0.42;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    const pts = [];
    for (let i = 0; i < spikes; i++) {
        pts.push(Math.cos(rot) * r, Math.sin(rot) * r);
        rot += step;
        pts.push(Math.cos(rot) * inner, Math.sin(rot) * inner);
        rot += step;
    }
    g.poly(pts).fill({ color });
    g.pivot.set(0, 0);
    return g;
}

// -------------------------------------------------------------------
// Buttons
// -------------------------------------------------------------------

/**
 * Rounded CTA button with hover + active states. Returns both the
 * Pixi Container and a `setActive(bool)` helper so callers (e.g. the
 * mission-board ACCEPT card) can toggle the pressed-highlight state
 * without re-reading the Container internals.
 */
export function buildStartButton({
    text,
    width,
    height = 40,
    fill = BUTTON_DEFAULT_FILL,
    hoverFill = BUTTON_DEFAULT_HOVER,
    textColor = BUTTON_DEFAULT_TEXT,
    onTap,
}) {
    const container = new Container();
    container.eventMode = 'static';
    container.cursor = 'pointer';
    const bg = new Graphics();
    const draw = (color, active = false) => {
        bg.clear();
        bg.roundRect(0, 0, width, height, 8).fill({ color, alpha: active ? 0.92 : 0.72 });
        bg.roundRect(0, 0, width, height, 8).stroke({
            color: BUTTON_DEFAULT_STROKE,
            width: active ? 2 : 1,
            alpha: active ? 0.9 : 0.35,
        });
    };
    draw(fill, false);
    container.addChild(bg);
    const label = new Text({
        text,
        style: new TextStyle({
            fontFamily: 'Inter, sans-serif',
            fontSize: 13,
            fontWeight: '700',
            fill: textColor,
        }),
    });
    label.anchor.set(0.5);
    label.x = width / 2;
    label.y = height / 2;
    container.addChild(label);
    container.on('pointerover', () => draw(hoverFill, !!container.__active));
    container.on('pointerout', () => draw(container.__active ? hoverFill : fill, !!container.__active));
    container.on('pointertap', () => onTap?.());
    return {
        container, bg, label, width, height, fill, hoverFill,
        setActive: (active) => {
            container.__active = !!active;
            draw(active ? hoverFill : fill, active);
        },
    };
}
