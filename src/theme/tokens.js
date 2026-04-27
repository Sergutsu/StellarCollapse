export const colors = Object.freeze({
    bg: Object.freeze({
        base: 0x020617,
        panel: 0x0b1b3a,
        panelAlt: 0x050a1c,
        dark: 0x0f172a,
    }),
    text: Object.freeze({
        primary: 0xf8fafc,
        secondary: 0xe2e8f0,
        muted: 0x94a3b8,
        disabled: 0x64748b,
        accent: 0x67e8f9,
        info: 0x93c5fd,
        caution: 0xfde047,
        white: 0xffffff,
    }),
    button: Object.freeze({
        default: Object.freeze({
            fill: 0x172554,
            hover: 0x1d4ed8,
            active: 0x1d4ed8,
            disabled: 0x64748b,
        }),
        primary: Object.freeze({
            fill: 0x14532d,
            hover: 0x166534,
            active: 0x166534,
            disabled: 0x64748b,
        }),
        danger: Object.freeze({
            fill: 0x7f1d1d,
            hover: 0x991b1b,
            active: 0xb91c1c,
            disabled: 0x64748b,
        }),
        ghost: Object.freeze({
            fill: 0x0b1b3a,
            hover: 0x1e3a8a,
            active: 0x1d4ed8,
            disabled: 0x64748b,
        }),
    }),
    tabs: Object.freeze({
        starMap: Object.freeze({ fill: 0x0c2461, hover: 0x1e3a8a }),
        missions: Object.freeze({ fill: 0x14532d, hover: 0x166534 }),
        build: Object.freeze({ fill: 0x4a1d96, hover: 0x6b21a8 }),
        research: Object.freeze({ fill: 0x78350f, hover: 0x92400e }),
        crew: Object.freeze({ fill: 0x164e63, hover: 0x155e75 }),
        market: Object.freeze({ fill: 0x713f12, hover: 0x854d0e }),
        locked: Object.freeze({ fill: 0x64748b, hover: 0x94a3b8 }),
    }),
    status: Object.freeze({
        success: 0x86efac,
        warning: 0xfde047,
        error: 0xf87171,
        info: 0x93c5fd,
        elevated: 0xfbbf24,
        high: 0xfb923c,
    }),
    brand: Object.freeze({
        cyan: 0x22d3ee,
        gold: 0xfacc15,
        amber: 0xfde68a,
    }),
    misc: Object.freeze({
        mineral: 0xc4b5fd,
        warp: 0xf9a8d4,
        line: 0x38bdf8,
        pale: 0xcbd5e1,
        cream: 0xfef3c7,
        frost: 0xf0f9ff,
    }),
});

export const spacing = Object.freeze({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
export const radius = Object.freeze({ sm: 4, md: 8, lg: 12, pill: 999 });
export const typography = Object.freeze({
    h1: Object.freeze({ fontFamily: 'Inter, sans-serif', fontSize: 36, fontWeight: '800' }),
    h2: Object.freeze({ fontFamily: 'Inter, sans-serif', fontSize: 24, fontWeight: '700' }),
    body: Object.freeze({ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '400' }),
    label: Object.freeze({ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: '700' }),
    mono: Object.freeze({ fontFamily: '"Courier New", monospace', fontSize: 11, fontWeight: '400' }),
});
export const motion = Object.freeze({ hoverMs: 120, pressMs: 80 });
