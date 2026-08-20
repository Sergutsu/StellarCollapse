import {
    Container,
    Graphics,
    Text,
    TextStyle,
} from 'pixi.js';

import { colors } from '../theme/tokens.js';

const BUTTON_STYLE = Object.freeze({
    fontFamily: '"Courier New", "Lucida Console", monospace',
    fontWeight: '700',
    letterSpacing: 1.5,
});

function toRgb(hex) {
    return {
        r: (hex >> 16) & 255,
        g: (hex >> 8) & 255,
        b: hex & 255,
    };
}

function rgbToHex({ r, g, b }) {
    return ((Math.max(0, Math.min(255, r)) << 16)
        | (Math.max(0, Math.min(255, g)) << 8)
        | Math.max(0, Math.min(255, b)));
}

function mixColor(a, b, weight = 0.5) {
    const w = Math.max(0, Math.min(1, weight));
    const ca = toRgb(a);
    const cb = toRgb(b);
    return rgbToHex({
        r: Math.round(ca.r + (cb.r - ca.r) * w),
        g: Math.round(ca.g + (cb.g - ca.g) * w),
        b: Math.round(ca.b + (cb.b - ca.b) * w),
    });
}

function resolvePalette(variant, palette) {
    if (palette) return palette;
    return colors.button[variant] ?? colors.button.default;
}

/**
 * Creates a reusable UI button with standardized variants and states.
 *
 * @param {object} options
 * @param {string} options.text
 * @param {number} options.width
 * @param {number} [options.height]
 * @param {'default'|'primary'|'danger'|'ghost'} [options.variant]
 * @param {'idle'|'hover'|'active'|'disabled'} [options.state]
 * @param {number} [options.textColor]
 * @param {boolean} [options.trimmed]
 * @param {{ fill:number, hover:number, active:number, disabled:number }} [options.palette]
 * @param {() => void} [options.onTap]
 */
export function createButton({
    text,
    width,
    height = 40,
    variant = 'default',
    state = 'idle',
    textColor = colors.text.white,
    trimmed = false,
    palette = null,
    onTap,
}) {
    const container = new Container();
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const glow = new Graphics();
    const outerFrame = new Graphics();
    const bezel = new Graphics();
    const innerPlate = new Graphics();
    const shine = new Graphics();

    container.addChild(glow);
    container.addChild(outerFrame);
    container.addChild(bezel);
    container.addChild(innerPlate);
    container.addChild(shine);

    const label = new Text({
        text,
        style: new TextStyle({
            ...BUTTON_STYLE,
            fontSize: Math.max(11, Math.floor(height * 0.36)),
            fill: textColor,
            dropShadow: {
                color: colors.text.accent,
                alpha: 0.9,
                blur: 4,
                distance: 0,
                angle: 0,
            },
        }),
    });
    label.anchor.set(0.5);
    label.x = width / 2;
    label.y = height / 2;
    container.addChild(label);

    const cut = trimmed ? Math.max(6, Math.floor(Math.min(width, height) * 0.18)) : 0;

    const model = {
        variant,
        state,
        isPointerOver: false,
        isDisabled: state === 'disabled',
        palette: resolvePalette(variant, palette),
    };

    const draw = () => {
        const resolved = model.palette;
        const fillByState = {
            idle: resolved.fill,
            hover: resolved.hover,
            active: resolved.active,
            disabled: resolved.disabled,
        };
        const visualState = model.isDisabled
            ? 'disabled'
            : (model.state === 'active'
                ? 'active'
                : (model.isPointerOver ? 'hover' : 'idle'));
        const fill = fillByState[visualState] ?? resolved.fill;
        const active = visualState === 'active';
        const disabled = visualState === 'disabled';
        const hoverColor = resolved.hover;
        const neon = mixColor(fill, hoverColor, active ? 0.62 : 0.38);
        const frameColor = mixColor(neon, colors.text.disabled, 0.24);
        const deepPlate = mixColor(fill, colors.bg.base, 0.48);
        const brightPlate = mixColor(neon, colors.text.white, active ? 0.24 : 0.12);
        const innerStroke = mixColor(neon, colors.text.accent, 0.35);
        const corner = Math.max(5, Math.floor(height * 0.24));

        glow.clear();
        if (trimmed) {
            glow.poly(angledPoints(-2, -2, width + 4, height + 4, cut + 2)).stroke({
                color: neon,
                width: active ? 5 : 4,
                alpha: disabled ? 0.2 : (active ? 0.7 : 0.52),
            });
            glow.poly(angledPoints(-4, -4, width + 8, height + 8, cut + 4)).stroke({
                color: neon,
                width: 9,
                alpha: disabled ? 0.08 : (active ? 0.26 : 0.18),
            });
        } else {
            glow.roundRect(-2, -2, width + 4, height + 4, corner + 2).stroke({
                color: neon,
                width: active ? 5 : 4,
                alpha: disabled ? 0.2 : (active ? 0.7 : 0.52),
            });
            glow.roundRect(-4, -4, width + 8, height + 8, corner + 4).stroke({
                color: neon,
                width: 9,
                alpha: disabled ? 0.08 : (active ? 0.26 : 0.18),
            });
        }

        outerFrame.clear();
        if (trimmed) {
            outerFrame.poly(angledPoints(0, 0, width, height, cut)).fill({ color: colors.bg.dark, alpha: 0.84 });
            outerFrame.poly(angledPoints(0, 0, width, height, cut)).stroke({ color: frameColor, width: 2, alpha: 0.86 });
        } else {
            outerFrame.roundRect(0, 0, width, height, corner).fill({ color: colors.bg.dark, alpha: 0.84 });
            outerFrame.roundRect(0, 0, width, height, corner).stroke({ color: frameColor, width: 2, alpha: 0.86 });
        }

        const screwR = Math.max(1.5, Math.min(3.2, height * 0.09));
        const screwInset = Math.max(4, Math.min(8, height * 0.24));
        const screwInsetX = trimmed ? screwInset + cut * 0.5 : screwInset;
        const screwInsetY = trimmed ? screwInset + cut * 0.5 : screwInset;
        [
            [screwInsetX, screwInsetY],
            [width - screwInsetX, screwInsetY],
            [screwInsetX, height - screwInsetY],
            [width - screwInsetX, height - screwInsetY],
        ].forEach(([x, y]) => {
            outerFrame.circle(x, y, screwR).fill({ color: colors.text.disabled, alpha: 0.88 });
            outerFrame.circle(x, y, screwR).stroke({ color: colors.text.secondary, width: 1, alpha: 0.35 });
        });

        bezel.clear();
        if (trimmed) {
            const bCut = Math.max(4, cut - 2);
            bezel.poly(angledPoints(4, 4, width - 8, height - 8, bCut)).fill({ color: colors.bg.panel, alpha: 0.9 });
            bezel.poly(angledPoints(4, 4, width - 8, height - 8, bCut)).stroke({
                color: mixColor(frameColor, neon, 0.42),
                width: 1.2,
                alpha: 0.7,
            });
        } else {
            bezel.roundRect(4, 4, width - 8, height - 8, Math.max(4, corner - 2)).fill({ color: colors.bg.panel, alpha: 0.9 });
            bezel.roundRect(4, 4, width - 8, height - 8, Math.max(4, corner - 2)).stroke({
                color: mixColor(frameColor, neon, 0.42),
                width: 1.2,
                alpha: 0.7,
            });
        }

        innerPlate.clear();
        if (trimmed) {
            const iCut = Math.max(3, cut - 4);
            innerPlate.poly(angledPoints(8, 8, width - 16, height - 16, iCut)).fill({ color: deepPlate, alpha: 0.98 });
            innerPlate.poly(angledPoints(8, 8, width - 16, height - 16, iCut)).stroke({
                color: innerStroke,
                width: active ? 2 : 1.4,
                alpha: active ? 0.92 : 0.7,
            });
            innerPlate.poly(angledPoints(10, 10, width - 20, height - 20, Math.max(2, iCut - 2))).fill({
                color: brightPlate,
                alpha: active ? 0.28 : 0.2,
            });
        } else {
            innerPlate.roundRect(8, 8, width - 16, height - 16, Math.max(4, corner - 4)).fill({ color: deepPlate, alpha: 0.98 });
            innerPlate.roundRect(8, 8, width - 16, height - 16, Math.max(4, corner - 4)).stroke({
                color: innerStroke,
                width: active ? 2 : 1.4,
                alpha: active ? 0.92 : 0.7,
            });
            innerPlate.roundRect(10, 10, width - 20, height - 20, Math.max(3, corner - 6)).fill({
                color: brightPlate,
                alpha: active ? 0.28 : 0.2,
            });
        }

        shine.clear();
        if (trimmed) {
            const sCut = Math.max(2, cut - 6);
            shine.poly(angledPoints(12, 10, width - 24, Math.max(4, Math.floor((height - 20) * 0.32)), sCut)).fill({
                color: colors.text.white,
                alpha: active ? 0.2 : 0.13,
            });
        } else {
            shine.roundRect(12, 10, width - 24, Math.max(4, Math.floor((height - 20) * 0.32)), Math.max(3, corner - 6)).fill({
                color: colors.text.white,
                alpha: active ? 0.2 : 0.13,
            });
        }

        container.cursor = disabled ? 'default' : 'pointer';
        container.eventMode = disabled ? 'none' : 'static';
        label.alpha = disabled ? 0.7 : 1;
    };

    container.on('pointerover', () => {
        model.isPointerOver = true;
        draw();
    });
    container.on('pointerout', () => {
        model.isPointerOver = false;
        draw();
    });
    container.on('pointertap', () => {
        if (!model.isDisabled) onTap?.();
    });

    const api = {
        container,
        label,
        width,
        height,
        setState(nextState) {
            model.state = nextState;
            model.isDisabled = nextState === 'disabled';
            draw();
        },
        setVariant(nextVariant, nextPalette = null) {
            model.variant = nextVariant;
            model.palette = resolvePalette(nextVariant, nextPalette);
            draw();
        },
        setText(nextText) {
            label.text = nextText;
        },
        setActive(active) {
            model.state = active ? 'active' : 'idle';
            draw();
        },
    };

    draw();
    return api;
}

function angledPoints(x, y, w, h, cut) {
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
