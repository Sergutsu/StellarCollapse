// Unit tests for the tiny scene manager that PixiView uses to host
// extracted scenes during the monolith -> scene-graph migration.
// The manager itself is Pixi-free; we exercise it with plain-object
// stand-ins that record which methods were called.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SceneManager } from '../src/scenes/scene-manager.js';

function makeFakeScene() {
    return {
        visible: false,
        shownWith: null,
        hiddenCount: 0,
        layoutCalls: [],
        destroyed: 0,
        show(...args) {
            this.visible = true;
            this.shownWith = args;
        },
        hide() {
            this.visible = false;
            this.hiddenCount += 1;
        },
        layout(screen) {
            this.layoutCalls.push(screen);
        },
        destroy() {
            this.destroyed += 1;
        },
    };
}

test('register + get + has round-trip', () => {
    const mgr = new SceneManager();
    const a = makeFakeScene();
    mgr.register('results', a);
    assert.equal(mgr.has('results'), true);
    assert.equal(mgr.get('results'), a);
    assert.equal(mgr.has('missing'), false);
    assert.equal(mgr.get('missing'), null);
});

test('register rejects bad inputs', () => {
    const mgr = new SceneManager();
    assert.throws(() => mgr.register('', makeFakeScene()));
    assert.throws(() => mgr.register(null, makeFakeScene()));
    assert.throws(() => mgr.register('results', null));
});

test('show forwards all positional args to the scene', () => {
    const mgr = new SceneManager();
    const scene = makeFakeScene();
    mgr.register('results', scene);
    const summary = { finalScore: 42 };
    const opts = { onContinue: () => {} };
    const ok = mgr.show('results', summary, opts);
    assert.equal(ok, true);
    assert.equal(scene.visible, true);
    assert.equal(scene.shownWith.length, 2);
    assert.equal(scene.shownWith[0], summary);
    assert.equal(scene.shownWith[1], opts);
});

test('show returns false for an unknown scene', () => {
    const mgr = new SceneManager();
    assert.equal(mgr.show('ghost'), false);
});

test('hide flips visibility + is idempotent per scene', () => {
    const mgr = new SceneManager();
    const scene = makeFakeScene();
    mgr.register('results', scene);
    mgr.show('results', {});
    assert.equal(scene.visible, true);
    mgr.hide('results');
    assert.equal(scene.visible, false);
    assert.equal(scene.hiddenCount, 1);
    mgr.hide('results');
    assert.equal(scene.hiddenCount, 2);
});

test('isVisible reads the scene getter', () => {
    const mgr = new SceneManager();
    const scene = makeFakeScene();
    mgr.register('results', scene);
    assert.equal(mgr.isVisible('results'), false);
    mgr.show('results', {});
    assert.equal(mgr.isVisible('results'), true);
    assert.equal(mgr.isVisible('ghost'), false);
});

test('layout fans out to every registered scene, hidden or not', () => {
    const mgr = new SceneManager();
    const a = makeFakeScene();
    const b = makeFakeScene();
    mgr.register('a', a);
    mgr.register('b', b);
    const screen = { width: 1024, height: 768 };
    mgr.layout(screen);
    assert.equal(a.layoutCalls.length, 1);
    assert.equal(a.layoutCalls[0], screen);
    assert.equal(b.layoutCalls.length, 1);
    assert.equal(b.layoutCalls[0], screen);
});

test('layout tolerates scenes without a layout method', () => {
    const mgr = new SceneManager();
    mgr.register('partial', { show() {}, hide() {} });
    assert.doesNotThrow(() => mgr.layout({ width: 800, height: 600 }));
});

test('destroy tears down every scene and clears the registry', () => {
    const mgr = new SceneManager();
    const a = makeFakeScene();
    const b = makeFakeScene();
    mgr.register('a', a);
    mgr.register('b', b);
    mgr.destroy();
    assert.equal(a.destroyed, 1);
    assert.equal(b.destroyed, 1);
    assert.equal(mgr.has('a'), false);
    assert.equal(mgr.has('b'), false);
});
