import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';

// Density-based population so the field stays full at any aspect ratio.
const STAR_DENSITY_PER_PIXEL = 0.00042;
const STAR_MIN_COUNT = 260;
const STAR_MAX_COUNT = 900;

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

function buildCrossTexture(renderer) {
    const size = 36;
    const c = size / 2;
    const g = new Graphics();

    // Soft halo + ring to give variety through tint/alpha at runtime.
    g.circle(c, c, 10.5).fill({ color: 0xffffff, alpha: 0.08 });
    g.circle(c, c, 6.5).fill({ color: 0xffffff, alpha: 0.16 });
    g.circle(c, c, 3.0).fill({ color: 0xffffff, alpha: 0.28 });
    g.stroke({ color: 0xffffff, alpha: 0.16, width: 1.2 }).circle(c, c, 7.8);

    // Perfect orthogonal cross (no tilt).
    const longRay = 14.5;
    const shortRay = 2.0;
    g.poly([
        c,
        c - longRay,
        c + shortRay,
        c,
        c,
        c + longRay,
        c - shortRay,
        c,
    ]).fill({ color: 0xffffff, alpha: 0.95 });

    g.poly([
        c - longRay,
        c,
        c,
        c - shortRay,
        c + longRay,
        c,
        c,
        c + shortRay,
    ]).fill({ color: 0xffffff, alpha: 0.95 });

    g.circle(c, c, 1.5).fill({ color: 0xffffff, alpha: 1.0 });

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
    const overscan = 28;

    const nebulaBuilt = buildNebulaTexture(renderer, width, height, overscan);
    const nebula = new Sprite(nebulaBuilt.tex);
    nebula.x = -overscan;
    nebula.y = -overscan;
    nebula.alpha = 0.92;
    container.addChild(nebula);

    const starLayer = new Container();
    starLayer.eventMode = 'none';
    starLayer.interactiveChildren = false;
    container.addChild(starLayer);

    const crossTex = buildCrossTexture(renderer);

    const area = width * height;
    const starCount = clamp(Math.round(area * STAR_DENSITY_PER_PIXEL), STAR_MIN_COUNT, STAR_MAX_COUNT);
    const points = distributeStars(width, height, starCount);

    const stars = [];
    for (const p of points) {
        const s = new Sprite(crossTex);
        s.anchor.set(0.5);
        s.x = p.x;
        s.y = p.y;
        s.rotation = 0; // lock to orthogonal + shape

        const scale = randBetween(0.34, 0.9);
        const baseAlpha = randBetween(0.45, 0.95);
        s.scale.set(scale);
        s.alpha = baseAlpha;
        s.tint = CROSS_TINTS[(Math.random() * CROSS_TINTS.length) | 0];

        stars.push({
            sprite: s,
            phase: Math.random() * Math.PI * 2,
            speed: randBetween(0.0009, 0.0028),
            baseAlpha,
            baseScale: scale,
            pulseStrength: randBetween(0.12, 0.34),
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
        crossTex.destroy(true);
    }

    return { container, update, destroy };
}
