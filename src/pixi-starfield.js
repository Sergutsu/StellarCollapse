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

// Retinted toward the hub-backdrop reference: dominant teals + cyans with
// scattered warm ember pockets. The old deep purples/magentas washed out
// the baked backdrop when layered; these tints reinforce it instead.
const NEBULA_TINTS = [
    0x0e7490, // cyan-700 — primary teal body
    0x155e75, // cyan-800 — shadow pockets
    0x0f766e, // teal-700 — cool veins
    0x7c2d12, // orange-900 — warm ember cloud
    0x4c1d95, // violet-900 — rare highlight
];

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function randBetween(min, max) {
    return min + Math.random() * (max - min);
}

function buildStarTexture(renderer) {
    const size = 36;
    const c = size / 2;
    const g = new Graphics();

    // Single star glyph: diffraction cross + thin rings + tiny center core.
    // No large filled circles to avoid "big dots" in the background.
    g.rect(c - 0.45, c - 11, 0.9, 22).fill({ color: 0xffffff, alpha: 0.95 });
    g.rect(c - 11, c - 0.45, 22, 0.9).fill({ color: 0xffffff, alpha: 0.95 });
    g.stroke({ color: 0xffffff, alpha: 0.82, width: 1.15 }).circle(c, c, 8.6);
    g.stroke({ color: 0xffffff, alpha: 0.46, width: 0.9 }).circle(c, c, 6.0);
    g.stroke({ color: 0xffffff, alpha: 0.3, width: 0.72 }).circle(c, c, 3.9);
    g.circle(c, c, 1.35).fill({ color: 0xffffff, alpha: 1.0 });
    g.circle(c, c, 2.1).fill({ color: 0xffffff, alpha: 0.28 });

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

export function createPixiStarfield(app, { width, height, backdropTexture } = {}) {
    const container = new Container();
    container.eventMode = 'none';
    container.interactiveChildren = false;

    const renderer = app.renderer;
    const screenW = Math.max(1, Math.round(width || app?.screen?.width || window.innerWidth || 1));
    const screenH = Math.max(1, Math.round(height || app?.screen?.height || window.innerHeight || 1));
    const overscan = 48;

    // Optional cinematic base layer (hub-backdrop.jpg). Cover-fits the
    // viewport like CSS `background-size: cover` so no letterboxing or
    // stretching regardless of aspect ratio. Slight darken + subtle drift
    // keeps it from looking painted-on; the procedural nebula and twinkle
    // layers render on top to preserve the "living space" feel.
    let backdrop = null;
    if (backdropTexture) {
        backdrop = new Sprite(backdropTexture);
        backdrop.eventMode = 'none';
        backdrop.alpha = 0.82;
        backdrop.tint = 0xbcd4e6;
        const texW = backdropTexture.width || backdropTexture.source?.width || 1;
        const texH = backdropTexture.height || backdropTexture.source?.height || 1;
        const scale = Math.max((screenW + overscan * 2) / texW, (screenH + overscan * 2) / texH);
        backdrop.scale.set(scale);
        backdrop.x = Math.round((screenW - texW * scale) / 2);
        backdrop.y = Math.round((screenH - texH * scale) / 2);
        container.addChild(backdrop);
    }

    const nebulaBuilt = buildNebulaTexture(renderer, screenW, screenH, overscan);
    const nebula = new Sprite(nebulaBuilt.tex);
    nebula.x = -overscan;
    nebula.y = -overscan;
    // Softened so the baked backdrop shows through. Without the backdrop
    // we push it back up to keep nebulae prominent on their own.
    nebula.alpha = backdrop ? 0.6 : 0.92;
    container.addChild(nebula);

    const starLayer = new Container();
    starLayer.eventMode = 'none';
    starLayer.interactiveChildren = false;
    container.addChild(starLayer);

    const starTex = buildStarTexture(renderer);

    const area = screenW * screenH;
    const starCount = clamp(Math.round(area * STAR_DENSITY_PER_PIXEL), STAR_MIN_COUNT, STAR_MAX_COUNT);
    const points = distributeStars(screenW, screenH, starCount);

    const stars = [];
    for (const p of points) {
        const s = new Sprite(starTex);
        s.anchor.set(0.5);
        s.x = p.x;
        s.y = p.y;
        const lum = Math.random() ** 2.85;
        const scale = 0.08 + lum * 1.34;
        const baseAlpha = 0.025 + lum * 0.955;
        s.scale.set(scale);
        s.alpha = baseAlpha;
        s.tint = CROSS_TINTS[(Math.random() * CROSS_TINTS.length) | 0];

        stars.push({
            sprite: s,
            phase: Math.random() * Math.PI * 2,
            speed: randBetween(0.0006, 0.0036),
            baseAlpha,
            baseScale: scale,
            pulseStrength: randBetween(0.16, 0.9),
        });
        starLayer.addChild(s);
    }

    let clock = 0;
    const backdropBaseX = backdrop ? backdrop.x : 0;
    const backdropBaseY = backdrop ? backdrop.y : 0;
    function update(dtMs) {
        if (!dtMs || dtMs <= 0) return;
        clock += dtMs;

        nebula.x = -overscan + Math.sin(clock * 0.000018) * 9;
        nebula.y = -overscan + Math.cos(clock * 0.000014) * 7;
        // Backdrop drifts at ~⅓ of nebula rate so the parallax separation
        // is visible but never distracting.
        if (backdrop) {
            backdrop.x = backdropBaseX + Math.sin(clock * 0.000006) * 4;
            backdrop.y = backdropBaseY + Math.cos(clock * 0.000005) * 3;
        }

        for (const rec of stars) {
            rec.phase += dtMs * rec.speed;
            const pulse = 0.5 + 0.5 * Math.sin(rec.phase);
            rec.sprite.alpha = clamp(rec.baseAlpha * (0.2 + pulse * rec.pulseStrength), 0.015, 1);
            rec.sprite.scale.set(rec.baseScale * (0.82 + pulse * 0.4));
            rec.sprite.rotation = 0;
        }
    }

    function destroy() {
        container.destroy({ children: true });
        nebulaBuilt.tex.destroy(true);
        starTex.destroy(true);
    }

    return { container, update, destroy };
}
