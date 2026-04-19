// Pixi-native animated starfield. Replaces the DOM `.stars` layer when
// running under `?engine=pixi` so the background renders on the same
// canvas as the board -- no more DOM + canvas double-stack.
//
// Three parts:
//   1. Procedural-noise nebulae baked once into a RenderTexture so the
//      cloud layer is a single sprite draw call at runtime.
//   2. Tiny twinkling dot stars (most of the field), each with its own
//      blink phase so the population shimmers asynchronously.
//   3. Sparse 4-pointed cross/sparkle stars with a slightly stronger
//      pulse + subtle rotation.
//
// All sprites share a pair of cached textures (dot + cross) so the GPU
// only uploads two small atlases even though hundreds of instances
// render per frame.

import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';

// ----- Tuning knobs -------------------------------------------------

// Dot-star population: small, quiet, fills the field. Kept on the low
// side because the cross stars and nebulae carry most of the drama.
const DOT_COUNT = 160;
const CROSS_COUNT = 24;

// Nebula clouds. Each is a cluster of soft-radial stamps whose density
// is sampled from 2D value noise, so the clouds read as wispy rather
// than uniform blobs.
const NEBULA_COUNT = 5;
const NEBULA_SAMPLES = 320; // stamps per cloud
const NEBULA_MIN_RADIUS = 140;
const NEBULA_MAX_RADIUS = 260;

// Soft palette tints for dots. Mostly white with a sprinkling of cool
// and warm tones so the field doesn't feel monochrome.
const DOT_TINTS = [
    0xffffff, 0xffffff, 0xffffff, 0xffffff,
    0xbfdbfe, 0xa5f3fc, 0xfde68a, 0xfbcfe8,
];

// Cross stars lean into cyan/yellow/pink so they pop against the dot
// background.
const CROSS_TINTS = [
    0xffffff, 0xffffff,
    0xa5f3fc, 0x67e8f9,
    0xfde68a, 0xfacc15,
    0xf9a8d4, 0xfca5a5,
];

// Nebula tints. Kept dim and slightly purple/cyan/pink so the clouds
// don't overpower the gameplay foreground.
const NEBULA_TINTS = [
    0x4c1d95, // indigo
    0x1e3a8a, // deep blue
    0x831843, // magenta
    0x0e7490, // cyan
    0x7c2d12, // burnt orange
    0x312e81, // violet
];

// ----- Small deterministic-looking value noise ----------------------
// Not seeded: each page load gets a slightly different cloud pattern,
// which is fine because the field is baked once and reused.

function _hash2(x, y) {
    // sin/fract trick; cheap and "random enough" for cloud density.
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return h - Math.floor(h);
}

function _smoothNoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const n00 = _hash2(x0, y0);
    const n10 = _hash2(x0 + 1, y0);
    const n01 = _hash2(x0, y0 + 1);
    const n11 = _hash2(x0 + 1, y0 + 1);
    // Smoothstep on both axes -> bilinear interp.
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = n00 * (1 - sx) + n10 * sx;
    const b = n01 * (1 - sx) + n11 * sx;
    return a * (1 - sy) + b * sy;
}

function _fbm(x, y, octaves = 3) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * _smoothNoise(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
    }
    return sum;
}

// ----- Texture builders --------------------------------------------

function _buildDotTexture(renderer) {
    // A soft white disc with a glow halo. Kept tiny (8px) so we can
    // scale it up for bigger stars without losing performance.
    const g = new Graphics();
    g.circle(4, 4, 3.6).fill({ color: 0xffffff, alpha: 0.18 });
    g.circle(4, 4, 2.4).fill({ color: 0xffffff, alpha: 0.45 });
    g.circle(4, 4, 1.0).fill({ color: 0xffffff, alpha: 1.0 });
    const tex = RenderTexture.create({ width: 8, height: 8, resolution: 2 });
    renderer.render({ container: g, target: tex });
    g.destroy();
    return tex;
}

function _buildCrossTexture(renderer) {
    // Four-rayed sparkle. Two long thin rays + soft halo disc. Looks
    // like a Hubble image star once tinted.
    const size = 24;
    const center = size / 2;
    const g = new Graphics();
    // Outer halo
    g.circle(center, center, 5.5).fill({ color: 0xffffff, alpha: 0.18 });
    g.circle(center, center, 3.0).fill({ color: 0xffffff, alpha: 0.35 });
    // Horizontal + vertical rays: two overlapping tapered diamonds so
    // the ray thickness falls off toward the tips.
    const halfH = center;
    const rayW = 1.2;
    g.poly([
        center, center - halfH,       // top tip
        center + rayW, center,        // right-inner
        center, center + halfH,       // bottom tip
        center - rayW, center,        // left-inner
    ]).fill({ color: 0xffffff });
    g.poly([
        center - halfH, center,
        center, center - rayW,
        center + halfH, center,
        center, center + rayW,
    ]).fill({ color: 0xffffff });
    // Bright core
    g.circle(center, center, 1.4).fill({ color: 0xffffff });
    const tex = RenderTexture.create({ width: size, height: size, resolution: 2 });
    renderer.render({ container: g, target: tex });
    g.destroy();
    return tex;
}

function _buildNebulaTexture(renderer, width, height) {
    // Several noise-stamped clouds baked into a single RenderTexture.
    // The runtime cost is just one sprite draw per frame afterward.
    const stage = new Container();
    for (let i = 0; i < NEBULA_COUNT; i++) {
        const cx = Math.random() * width;
        const cy = Math.random() * height;
        const radius = NEBULA_MIN_RADIUS + Math.random() * (NEBULA_MAX_RADIUS - NEBULA_MIN_RADIUS);
        const tint = NEBULA_TINTS[i % NEBULA_TINTS.length];
        // Independent noise offset per cloud so they don't all repeat
        // the same pattern.
        const nox = Math.random() * 1000;
        const noy = Math.random() * 1000;
        const g = new Graphics();
        for (let j = 0; j < NEBULA_SAMPLES; j++) {
            // Uniformly sample inside the cloud's disc (sqrt keeps
            // density flat-ish so it doesn't clump at the center).
            const angle = Math.random() * Math.PI * 2;
            const r = radius * Math.sqrt(Math.random());
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            // Density = noise * distance-falloff -> wispy edges.
            const nv = _fbm((x + nox) * 0.012, (y + noy) * 0.012, 3);
            const distFade = Math.max(0, 1 - r / radius);
            const density = nv * distFade;
            if (density < 0.28) continue;
            // Larger stamps near the core, smaller at the edges.
            const size = 5 + Math.random() * 14 * distFade;
            g.circle(x, y, size).fill({
                color: tint,
                // Very low per-stamp alpha; many overlapping stamps
                // accumulate into a smooth cloud.
                alpha: 0.015 + density * 0.05,
            });
        }
        stage.addChild(g);
    }
    const tex = RenderTexture.create({ width, height, resolution: 1 });
    renderer.render({ container: stage, target: tex });
    stage.destroy({ children: true });
    return tex;
}

// ----- Main entry --------------------------------------------------

export function createPixiStarfield(app, { width, height }) {
    const container = new Container();
    // No need to hit-test the starfield -- it's decor behind
    // everything else.
    container.eventMode = 'none';
    container.interactiveChildren = false;

    const renderer = app.renderer;

    // Nebula layer (baked). Position at origin; we'll drift it subtly
    // via container.x/y in update().
    const nebulaTex = _buildNebulaTexture(renderer, width, height);
    const nebula = new Sprite(nebulaTex);
    nebula.alpha = 0.9;
    container.addChild(nebula);

    // Star layer. Kept in its own container so the nebula drift
    // doesn't shift the stars (they twinkle in place).
    const starLayer = new Container();
    starLayer.eventMode = 'none';
    starLayer.interactiveChildren = false;
    container.addChild(starLayer);

    const dotTex = _buildDotTexture(renderer);
    const crossTex = _buildCrossTexture(renderer);
    const stars = [];

    for (let i = 0; i < DOT_COUNT; i++) {
        const s = new Sprite(dotTex);
        s.anchor.set(0.5);
        s.x = Math.random() * width;
        s.y = Math.random() * height;
        const scale = 0.45 + Math.random() * 0.95;
        s.scale.set(scale);
        const baseAlpha = 0.35 + Math.random() * 0.55;
        s.alpha = baseAlpha;
        s.tint = DOT_TINTS[(Math.random() * DOT_TINTS.length) | 0];
        const rec = {
            sprite: s,
            kind: 'dot',
            phase: Math.random() * Math.PI * 2,
            // Blink speed in radians per ms. Keeps the population
            // shimmering at different tempos.
            speed: 0.0008 + Math.random() * 0.0022,
            baseAlpha,
            baseScale: scale,
        };
        stars.push(rec);
        starLayer.addChild(s);
    }

    for (let i = 0; i < CROSS_COUNT; i++) {
        const s = new Sprite(crossTex);
        s.anchor.set(0.5);
        s.x = Math.random() * width;
        s.y = Math.random() * height;
        const scale = 0.55 + Math.random() * 0.75;
        s.scale.set(scale);
        const baseAlpha = 0.55 + Math.random() * 0.4;
        s.alpha = baseAlpha;
        s.tint = CROSS_TINTS[(Math.random() * CROSS_TINTS.length) | 0];
        s.rotation = Math.random() * Math.PI * 0.25;
        const rec = {
            sprite: s,
            kind: 'cross',
            phase: Math.random() * Math.PI * 2,
            speed: 0.0012 + Math.random() * 0.0028,
            baseAlpha,
            baseScale: scale,
            baseRotation: s.rotation,
        };
        stars.push(rec);
        starLayer.addChild(s);
    }

    // Tiny parallax drift on the nebula, independent of the stars so
    // the two layers feel like they're at different depths.
    let clock = 0;
    function update(dtMs) {
        if (!dtMs || dtMs <= 0) return;
        clock += dtMs;
        // Subtle drift (<= ~6px) so the nebula breathes without
        // revealing any edge sharpness.
        nebula.x = Math.sin(clock * 0.00002) * 6;
        nebula.y = Math.cos(clock * 0.000016) * 4;

        for (const rec of stars) {
            rec.phase += dtMs * rec.speed;
            // 0..1 pulse. Start at half so stars never fully vanish.
            const pulse = 0.5 + 0.5 * Math.sin(rec.phase);
            if (rec.kind === 'dot') {
                rec.sprite.alpha = rec.baseAlpha * (0.45 + 0.55 * pulse);
            } else {
                // Cross stars get a stronger pulse + gentle rotation so
                // they read as twinkling diamonds rather than static +.
                rec.sprite.alpha = rec.baseAlpha * (0.55 + 0.45 * pulse);
                rec.sprite.scale.set(rec.baseScale * (0.9 + 0.2 * pulse));
                rec.sprite.rotation = rec.baseRotation + Math.sin(rec.phase * 0.5) * 0.08;
            }
        }
    }

    function destroy() {
        container.destroy({ children: true });
        nebulaTex.destroy(true);
        dotTex.destroy(true);
        crossTex.destroy(true);
    }

    return { container, update, destroy };
}
