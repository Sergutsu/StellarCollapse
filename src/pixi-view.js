// Pixi.js bootstrap + scene orchestration. Owns the `#gameContainer`
// mount, the Pixi Application, the full-viewport starfield, and the
// SceneManager that hosts every extracted scene (hub, game, results,
// future tab-scenes, minigames). PixiView itself holds no game logic
// and no hub logic -- it's a thin scene host with a few shared panel
// + button helpers that scenes consume via dependency injection.
//
// Public API (consumed by main.js; unchanged across the scene-split
// series so main.js never needed updating):
//
//   const view = new PixiView({ state, meta, elements });
//   await view.init();                       // async bootstrap
//   view.createBoard();                      // game-scene delegate
//   view.createPreviews();                   // game-scene delegate
//   view.setTopControlsHandlers({ onExit, onToggleSound });
//   view.setSoundEnabled(on);
//   view.setTip(text);
//   view.showStartScreen() / view.showGameScreen();
//   view.showResultsScreen(summary, { onContinue });
//   view.hideResultsScreen();
//   view.onStartGame(callback);              // hub-scene delegate
//   view._levelInfoFor = fn;                 // game-scene delegate
//
// See docs/adr/0009-scene-graph-extraction.md for the scene-split
// contract and roadmap.

import {
    Application,
    Assets,
    Container,
    FillGradient,
    Graphics,
    Text,
    TextStyle,
} from 'pixi.js';

import { createPixiStarfield } from './pixi-starfield.js';

import { SceneManager } from './scenes/scene-manager.js';
import { ResultsScene } from './scenes/results-scene.js';
import { HubScene } from './scenes/hub-scene.js';
import { GameScene } from './scenes/game-scene.js';

// CELL_PALETTE lives inside GameScene now -- PixiView only needs a
// placeholder reference to pass into ResultsScene's rewards grid so it
// can tint the 6-ore icons the same way the game board does.
import { CELL_PALETTE } from './scenes/cell-palette.js';

// HUD_W / HUD_H are the canonical HUD bounding box inside the viewport;
// the canvas fills the full window but sceneRoot centers on this.
const HUD_W = 860;
const HUD_H = 820;

// Hologram panel tints -- picked to match the DOM CSS backdrop
// (cyan-ish translucent gradient with a thin cyan border).
const PANEL_BG_TOP = 0x0b1b3a;
const PANEL_BG_BOT = 0x050a1c;
const PANEL_BORDER_ALPHA = 0.28;

const COLOR_WHITE = 0xffffff;

export class PixiView {
    constructor({ state, meta = null, elements }) {
        this.state = state;
        this.meta = meta;
        this.el = elements;

        this.app = null;
        this.sceneRoot = null;
        this.uiRoot = null;

        // Scene manager owns extracted Pixi scenes. Registered in
        // init() once Pixi + uiRoot are available.
        this._sceneMgr = new SceneManager();
        this._hub = null;
        this._game = null;
        this._results = null;

        this._starfield = null;
        this._backdropTexture = null;
        this._viewportUnsub = null;
    }

    // -------------------------------------------------------------------
    // Bootstrap. Pixi v8 requires async init; main.js awaits this once.
    // -------------------------------------------------------------------

    async init() {
        const app = new Application();
        await app.init({
            antialias: true,
            backgroundAlpha: 0,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
            width: Math.max(1, Math.round(window.innerWidth || HUD_W)),
            height: Math.max(1, Math.round(window.innerHeight || HUD_H)),
        });
        this.app = app;

        const mount = this.el.container;
        if (mount) {
            mount.innerHTML = '';
            mount.appendChild(app.canvas);
            app.canvas.style.display = 'block';
            mount.style.width = '100vw';
            mount.style.height = '100vh';
            mount.style.border = 'none';
            mount.style.boxShadow = 'none';
            mount.style.background = 'transparent';
            mount.style.animation = 'none';
        }

        try {
            this._backdropTexture = await Assets.load('./assets/hub-backdrop.jpg');
        } catch {
            this._backdropTexture = null;
        }

        this._rebuildStarfield(app.screen.width, app.screen.height);

        this.sceneRoot = new Container();
        app.stage.addChild(this.sceneRoot);
        this.uiRoot = new Container();
        app.stage.addChild(this.uiRoot);

        // Register every extracted scene. Each one gets the shared
        // panel/button/label/star helpers it needs; none of them
        // import from pixi-view (no circular imports). A later PR
        // promotes the helpers to pixi-ui-kit.js once enough scenes
        // want direct access.
        this._results = new ResultsScene({
            app,
            uiRoot: this.uiRoot,
            drawHologramPanel: (w, h, opts) => this._drawHologramPanel(w, h, opts),
            buildStartButton: (opts) => this._buildStartButton(opts),
            palette: CELL_PALETTE,
        });
        this._sceneMgr.register('results', this._results);

        this._hub = new HubScene({
            app,
            uiRoot: this.uiRoot,
            meta: this.meta,
            drawHologramPanel: (w, h, opts) => this._drawHologramPanel(w, h, opts),
            redrawHologramPanel: (panel, w, h, accent) => this._redrawHologramPanel(panel, w, h, accent),
            buildStartButton: (opts) => this._buildStartButton(opts),
            panelLabel: (text, color, opts) => this._panelLabel(text, color, opts),
            drawStarShape: (r, color) => this._drawStarShape(r, color),
        });
        this._sceneMgr.register('hub', this._hub);

        this._game = new GameScene({
            app,
            state: this.state,
            sceneRoot: this.sceneRoot,
            uiRoot: this.uiRoot,
            drawHologramPanel: (w, h, opts) => this._drawHologramPanel(w, h, opts),
            drawStarShape: (r, color) => this._drawStarShape(r, color),
            panelLabel: (text, color, opts) => this._panelLabel(text, color, opts),
        });
        this._sceneMgr.register('game', this._game);

        this._layoutViewport();

        // Hub is the default boot screen; lazy-build happens on first
        // show(). Game scene builds lazily on first createBoard().
        this._hub.show();

        // Single ticker: drive starfield + every scene that exposes
        // tick(deltaMs). Scenes own their own animation state.
        app.ticker.add((ticker) => {
            this._starfield?.update(ticker.deltaMS);
            for (const name of ['hub', 'game', 'results']) {
                const scene = this._sceneMgr.get(name);
                if (scene && typeof scene.tick === 'function') {
                    scene.tick(ticker.deltaMS);
                }
            }
        });

        const onResize = () => this._layoutViewport({ rebuildStarfield: true });
        window.addEventListener('resize', onResize);
        this._viewportUnsub = () => window.removeEventListener('resize', onResize);
        if (mount) {
            mount.style.visibility = 'visible';
        }
        this.showStartScreen();
    }

    // -------------------------------------------------------------------
    // Public API -- main.js wiring. All of these are thin delegates
    // onto the appropriate extracted scene.
    // -------------------------------------------------------------------

    createBoard() {
        this._game?.createBoard();
    }

    createPreviews() {
        this._game?.createPreviews();
    }

    setTopControlsHandlers(handlers) {
        this._game?.setTopControlsHandlers(handlers);
    }

    setSoundEnabled(enabled) {
        this._game?.setSoundEnabled(enabled);
    }

    setTip(text) {
        this._game?.setTip(text);
    }

    onStartGame(callback) {
        this._hub?.setStartGameCallback(callback);
    }

    // Legacy accessor: main.js sets `view._levelInfoFor = ...` to
    // customize the LEVEL panel subtitle. Forward the setter into
    // GameScene so the old call-site keeps working.
    set _levelInfoFor(fn) {
        this._game?.setLevelInfoFor(fn);
    }

    showStartScreen() {
        this._game?.hide();
        this._sceneMgr.show('hub');
    }

    showGameScreen() {
        this._sceneMgr.hide('hub');
        this._game?.show();
    }

    showResultsScreen(summary, opts = {}) {
        this._sceneMgr.show('results', summary, opts);
    }

    hideResultsScreen() {
        this._sceneMgr.hide('results');
    }

    // -------------------------------------------------------------------
    // Starfield + viewport layout (shared across every scene).
    // -------------------------------------------------------------------

    _rebuildStarfield(width, height) {
        if (!this.app) return;
        if (this._starfield?.container) {
            this.app.stage.removeChild(this._starfield.container);
            this._starfield.destroy();
        }
        this._starfield = createPixiStarfield(this.app, {
            width,
            height,
            backdropTexture: this._backdropTexture,
        });
        this.app.stage.addChildAt(this._starfield.container, 0);
    }

    _layoutViewport({ rebuildStarfield = false } = {}) {
        if (!this.app) return;
        const w = Math.max(1, Math.round(window.innerWidth || HUD_W));
        const h = Math.max(1, Math.round(window.innerHeight || HUD_H));
        this.app.renderer.resize(w, h);
        this.sceneRoot.x = Math.round((w - HUD_W) / 2);
        this.sceneRoot.y = Math.round((h - HUD_H) / 2);
        // Fan out to every registered scene (hidden scenes also get
        // a layout pass so they don't flash at stale positions).
        this._sceneMgr.layout(this.app.screen);
        if (rebuildStarfield) {
            this._rebuildStarfield(w, h);
        }
    }

    // -------------------------------------------------------------------
    // Shared ui-kit helpers. Kept on PixiView until a second+ scene
    // outside of hub/game/results needs them directly -- at that point
    // they promote to pixi-ui-kit.js (tracked in ADR-0009 as the
    // follow-up PR after GameScene lands).
    // -------------------------------------------------------------------

    _drawHologramPanel(w, h, { accent = 0x00d4ff } = {}) {
        const c = new Container();
        const grad = new FillGradient(0, 0, 0, h);
        grad.addColorStop(0, PANEL_BG_TOP);
        grad.addColorStop(1, PANEL_BG_BOT);
        const bgFill = new Graphics();
        bgFill.roundRect(0, 0, w, h, 6).fill(grad);
        bgFill.alpha = 0.65;
        c.addChild(bgFill);
        const bg = new Graphics();
        bg.roundRect(0, 0, w, h, 6).stroke({ color: accent, width: 1, alpha: PANEL_BORDER_ALPHA });
        c.addChild(bg);

        const scan = new Graphics();
        for (let y = 1; y < h; y += 3) {
            scan.rect(1, y, w - 2, 1).fill({ color: accent, alpha: 0.04 });
        }
        c.addChild(scan);

        return c;
    }

    _redrawHologramPanel(panel, w, h, accent = 0x00d4ff) {
        if (!panel) return;
        const children = panel.children;
        if (children.length < 3) return;
        const [bgFill, border, scan] = children;
        const grad = new FillGradient(0, 0, 0, h);
        grad.addColorStop(0, PANEL_BG_TOP);
        grad.addColorStop(1, PANEL_BG_BOT);
        bgFill.clear();
        bgFill.roundRect(0, 0, w, h, 6).fill(grad);
        bgFill.alpha = 0.65;
        border.clear();
        border.roundRect(0, 0, w, h, 6).stroke({ color: accent, width: 1, alpha: PANEL_BORDER_ALPHA });
        scan.clear();
        for (let y = 1; y < h; y += 3) {
            scan.rect(1, y, w - 2, 1).fill({ color: accent, alpha: 0.04 });
        }
    }

    _panelLabel(text, color, { size = 12, weight = '700' } = {}) {
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

    _drawStarShape(r, color) {
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

    _buildStartButton({ text, width, height = 40, fill = 0x172554, hoverFill = 0x1d4ed8, textColor = COLOR_WHITE, onTap }) {
        const container = new Container();
        container.eventMode = 'static';
        container.cursor = 'pointer';
        const bg = new Graphics();
        const draw = (color, active = false) => {
            bg.clear();
            bg.roundRect(0, 0, width, height, 8).fill({ color, alpha: active ? 0.92 : 0.72 });
            bg.roundRect(0, 0, width, height, 8).stroke({ color: 0x22d3ee, width: active ? 2 : 1, alpha: active ? 0.9 : 0.35 });
        };
        draw(fill, false);
        container.addChild(bg);
        const label = new Text({ text, style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: '700', fill: textColor }) });
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
}
