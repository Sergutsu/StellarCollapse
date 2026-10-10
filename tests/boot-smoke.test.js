// Boot smoke: run the REAL src/main.js under node --test against the
// headless Pixi stand-in. Everything else exercises modules in isolation;
// this file proves the orchestrator itself wires up — PixiView.init,
// createBoard (GameScene HUD build), the hub build, hotkeys, input,
// pause/help dialogs, and the first-boot manual — without throwing.
//
// A missing import or a typo'd delegate in main.js fails here instead of
// as a blank screen in the browser. Skips itself on Node < 20.6 (no
// module.register) and captures unhandled rejections from the fire-and-
// forget boot() promise.

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

let register = null;
try {
    ({ register } = await import('node:module'));
} catch {
    register = null;
}
const HOOK_AVAILABLE = typeof register === 'function';

let pixi = null;
let loadError = null;
const rejections = [];

function fakeDom() {
    const docListeners = new Map();
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    const containerEl = {
        innerHTML: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        querySelector: () => canvas,
    };
    globalThis.document = {
        readyState: 'complete',
        visibilityState: 'visible',
        getElementById: () => containerEl,
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, new Set());
            docListeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    };
    globalThis.window = {
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 1,
        addEventListener() {},
        removeEventListener() {},
        setInterval: () => 0,
        location: { reload() {} },
    };
    return {
        containerEl,
        listenerCount: () => [...docListeners.values()].reduce((n, s) => n + s.size, 0),
    };
}

describe('main.js boots the real game against a headless Pixi', { skip: !HOOK_AVAILABLE && 'module.register() unavailable on this Node' }, () => {
    before(() => {
        if (loadError) throw loadError;
    });

    it('wires view, hub, HUD, help and hotkeys without throwing', async () => {
        register('./helpers/pixi-resolve-hook.mjs', import.meta.url);
        pixi = await import('./helpers/pixi-mock.js');

        // Capture every Application the boot creates so we can inspect the stage.
        const apps = [];
        const origInit = pixi.Application.prototype.init;
        pixi.Application.prototype.init = async function init(...args) {
            apps.push(this);
            return origInit.apply(this, args);
        };
        process.on('unhandledRejection', (err) => rejections.push(err));

        const dom = fakeDom();
        await import('../src/main.js');

        // boot() is fire-and-forget async. It ends with bindHotkeys (3rd
        // document listener: visibilitychange + input keydown + hotkeys).
        const deadline = Date.now() + 4000;
        while (dom.listenerCount() < 3 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 25));
        }
        // A couple of turns for the first-boot help overlay to build.
        await new Promise((r) => setTimeout(r, 50));

        assert.deepEqual(rejections, [], `boot threw: ${rejections[0]?.stack || ''}`);
        assert.ok(dom.containerEl.children.length > 0, 'canvas mounted into #gameContainer');
        assert.equal(apps.length, 1, 'one Pixi application');

        const app = apps[0];
        const stageChildren = app.stage.children;
        assert.ok(stageChildren.length >= 2, 'starfield + uiRoot on the stage');

        // First boot: the HOW TO PLAY overlay is up (ui.helpSeen is false).
        const overlays = stageChildren[stageChildren.length - 1].children || [];
        assert.ok(
            overlays.some((c) => c.visible && c.eventMode === 'static'),
            'a full-screen overlay (the first-run manual) is visible at boot',
        );

        // The hub (mission board + planner) is underneath and built.
        const uiRoot = stageChildren[stageChildren.length - 1];
        assert.ok(uiRoot.children.length >= 2, 'hub + help both live under uiRoot');

        process.removeAllListeners('unhandledRejection');
        pixi.Application.prototype.init = origInit;
    });
});
