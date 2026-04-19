import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';

// Density-based population so the field stays full at any aspect ratio.
const STAR_DENSITY_PER_PIXEL = 0.00045;
const STAR_MIN_COUNT = 260;
const STAR_MAX_COUNT = 1100;

// Nebula generation. We build fewer, larger cloud systems composed of
// connected lobes so they read as coherent nebulae instead of random dots.
const NEBULA_SYSTEMS = 4;
const NEBULA_LOBES_MIN = 4;
const NEBULA_LOBES_MAX = 7;
const NEBULA_STAMPS_PER_LOBE = 90;

const CROSS_TINTS = [
    0xffffff,
    0xdbeafe,
    0xa5f3fc,
    0xfde68a,
    0xf9a8d4,
];

const NEBULA_TINTS = [
    0x312e81,
    0x1e3a8a,
    0x5b21b6,
    0x0f766e,
    0x831843,
];

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function randBetween(min, max) {
    return min + Math.random() * (max - min);
}

function buildRingTexture(renderer) {
    const size = 36;
    const c = size / 2;
    const g = new Graphics();

    // Soft halo + nested rings (hollow center) for a cleaner "ring star" look.
    g.circle(c, c, 10.5).fill({ color: 0xffffff, alpha: 0.08 });
    g.stroke({ color: 0xffffff, alpha: 0.85, width: 1.4 }).circle(c, c, 8.8);
    g.stroke({ color: 0xffffff, alpha: 0.42, width: 1.1 }).circle(c, c, 6.2);
    g.stroke({ color: 0xffffff, alpha: 0.26, width: 0.8 }).circle(c, c, 4.2);
    g.circle(c, c, 2.2).fill({ color: 0x000000, alpha: 0.9 });

    const tex = RenderTexture.create({ width: size, height: size, resolution: 2 });
    renderer.render({ container: g, target: tex });
    g.destroy();
    return tex;
}

function buildCrossTexture(renderer) {
    const size = 36;
    const c = size / 2;
    const g = new Graphics();

    // Thin diffraction cross with a very soft center glow.
    g.rect(c - 0.6, c - 10, 1.2, 20).fill({ color: 0xffffff, alpha: 0.75 });
    g.rect(c - 10, c - 0.6, 20, 1.2).fill({ color: 0xffffff, alpha: 0.75 });
    g.circle(c, c, 3.2).fill({ color: 0xffffff, alpha: 0.35 });
    g.circle(c, c, 7.6).fill({ color: 0xffffff, alpha: 0.08 });

    const tex = RenderTexture.create({ width: size, height: size, resolution: 2 });
    renderer.render({ container: g, target: tex });
    g.destroy();
    return tex;
}

function drawNebulaLobe(g, cx, cy, radiusX, radiusY, tint) {
    for (let i = 0; i < NEBULA_STAMPS_PER_LOBE; i++) {
        // Gaussian-ish cluster so lobes are denser near centers.
        const angle = Math.random() * Math.PI * 2;
        const falloff = Math.sqrt(Math.random());
        const x = cx + Math.cos(angle) * radiusX * falloff;
        const y = cy + Math.sin(angle) * radiusY * falloff;
        const stampR = randBetween(16, 58) * (1 - 0.55 * falloff);
        const alpha = 0.008 + (1 - falloff) * 0.02;
        g.circle(x, y, stampR).fill({ color: tint, alpha });
    }
}

function buildNebulaTexture(renderer, width, height, overscan) {
    const texW = width + overscan * 2;
    const texH = height + overscan * 2;
    const stage = new Container();

    for (let i = 0; i < NEBULA_SYSTEMS; i++) {
        const g = new Graphics();
        const tint = NEBULA_TINTS[i % NEBULA_TINTS.length];

        let x = randBetween(overscan * 0.4, texW - overscan * 0.4);
        let y = randBetween(overscan * 0.4, texH - overscan * 0.4);
        const lobes = Math.floor(randBetween(NEBULA_LOBES_MIN, NEBULA_LOBES_MAX + 1));

        for (let l = 0; l < lobes; l++) {
            const rx = randBetween(120, 220);
            const ry = randBetween(70, 170);
            drawNebulaLobe(g, x, y, rx, ry, tint);

            // Connected chain: each lobe grows from the previous one.
            x += randBetween(-150, 150);
            y += randBetween(-110, 110);
            x = clamp(x, overscan * 0.2, texW - overscan * 0.2);
            y = clamp(y, overscan * 0.2, texH - overscan * 0.2);
        }

        // Subtle bright core pockets to add depth.
        for (let k = 0; k < 24; k++) {
            const px = randBetween(overscan * 0.3, texW - overscan * 0.3);
            const py = randBetween(overscan * 0.3, texH - overscan * 0.3);
            const r = randBetween(14, 46);
            g.circle(px, py, r).fill({ color: 0xffffff, alpha: 0.006 });
        }

        stage.addChild(g);
    }

    const tex = RenderTexture.create({ width: texW, height: texH, resolution: 1 });
    renderer.render({ container: stage, target: tex });
    stage.destroy({ children: true });
    return { tex };
}

function distributeStars(width, height, count) {
    // Stratified placement avoids sparse corners and keeps uniform fill.
    const cols = Math.ceil(Math.sqrt((count * width) / height));
    const rows = Math.ceil(count / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    const points = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (points.length >= count) break;
            points.push({
                x: c * cellW + Math.random() * cellW,
                y: r * cellH + Math.random() * cellH,
            });
        }
    }
    return points;
}

export function createPixiStarfield(app, { width, height }) {
    const container = new Container();
    container.eventMode = 'none';
    container.interactiveChildren = false;

    const renderer = app.renderer;
    const screenW = Math.max(1, Math.round(width || app?.screen?.width || window.innerWidth || 1));
    const screenH = Math.max(1, Math.round(height || app?.screen?.height || window.innerHeight || 1));
    const overscan = 48;

    const nebulaBuilt = buildNebulaTexture(renderer, screenW, screenH, overscan);
    const nebula = new Sprite(nebulaBuilt.tex);
    nebula.x = -overscan;
    nebula.y = -overscan;
    nebula.alpha = 0.92;
    container.addChild(nebula);

    const starLayer = new Container();
    starLayer.eventMode = 'none';
    starLayer.interactiveChildren = false;
    container.addChild(starLayer);

    const ringTex = buildRingTexture(renderer);
    const crossTex = buildCrossTexture(renderer);

    const area = screenW * screenH;
    const starCount = clamp(Math.round(area * STAR_DENSITY_PER_PIXEL), STAR_MIN_COUNT, STAR_MAX_COUNT);
    const points = distributeStars(screenW, screenH, starCount);

    const stars = [];
    for (const p of points) {
        const useCross = Math.random() < 0.38;
        const s = new Sprite(useCross ? crossTex : ringTex);
        s.anchor.set(0.5);
        s.x = p.x;
        s.y = p.y;
        const scaleBucket = Math.random();
        const scale = scaleBucket < 0.7
            ? randBetween(0.16, 0.58)
            : randBetween(0.58, 1.2);
        const baseAlpha = scaleBucket < 0.7
            ? randBetween(0.15, 0.45)
            : randBetween(0.32, 0.7);
        s.scale.set(scale);
        s.alpha = baseAlpha;
        s.tint = CROSS_TINTS[(Math.random() * CROSS_TINTS.length) | 0];

        stars.push({
            sprite: s,
            phase: Math.random() * Math.PI * 2,
            speed: randBetween(0.0008, 0.0032),
            baseAlpha,
            baseScale: scale,
            pulseStrength: randBetween(0.08, 0.24),
        });
        starLayer.addChild(s);
    }

    let clock = 0;
    function update(dtMs) {
        if (!dtMs || dtMs <= 0) return;
        clock += dtMs;

        nebula.x = -overscan + Math.sin(clock * 0.000018) * 9;
        nebula.y = -overscan + Math.cos(clock * 0.000014) * 7;

        for (const rec of stars) {
            rec.phase += dtMs * rec.speed;
            const pulse = 0.5 + 0.5 * Math.sin(rec.phase);
            rec.sprite.alpha = rec.baseAlpha * (0.72 + pulse * rec.pulseStrength);
            rec.sprite.scale.set(rec.baseScale * (0.94 + pulse * 0.16));
            rec.sprite.rotation = 0;
        }
    }

    function destroy() {
        container.destroy({ children: true });
        nebulaBuilt.tex.destroy(true);
        ringTex.destroy(true);
        crossTex.destroy(true);
    }

    return { container, update, destroy };
}
