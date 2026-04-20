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
} from 'pixi.js';

import { createPixiStarfield } from './pixi-starfield.js';

import { SceneManager } from './scenes/scene-manager.js';
import { ResultsScene } from './scenes/results-scene.js';
import { HubScene } from './scenes/hub-scene.js';
import { GameScene } from './scenes/game-scene.js';

// Shared palette consumed by ResultsScene's ore chips + the game
// scenes' tile tints. Lives in its own module so all three scenes can
// import it without touching PixiView.
import { CELL_PALETTE } from './scenes/cell-palette.js';

// HUD_W / HUD_H are the canonical HUD bounding box inside the viewport;
// the canvas fills the full window but sceneRoot centers on this.
const HUD_W = 860;
const HUD_H = 820;

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

        // Register every extracted scene. All shared render helpers
        // live in src/pixi-ui-kit.js and each scene imports them
        // directly -- PixiView no longer hand-wires them through the
        // constructor.
        this._results = new ResultsScene({
            app,
            uiRoot: this.uiRoot,
            palette: CELL_PALETTE,
        });
        this._sceneMgr.register('results', this._results);

        this._hub = new HubScene({
            app,
            uiRoot: this.uiRoot,
            meta: this.meta,
        });
        this._sceneMgr.register('hub', this._hub);

        this._game = new GameScene({
            app,
            state: this.state,
            sceneRoot: this.sceneRoot,
            uiRoot: this.uiRoot,
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

}
