// Hotkey routing: raw key events → named actions per screen context.
// bindHotkeys only touches `document.addEventListener`, so a two-line
// fake DOM is enough to drive it under node --test.
import test from 'node:test';
import assert from 'node:assert/strict';

import { bindHotkeys, HOTKEY_TAB_ORDER } from '../src/hotkeys.js';

/** Capture the bound keydown handler and fire keys at it. */
function fakeDom() {
    const listeners = [];
    globalThis.document = {
        addEventListener: (type, fn) => {
            if (type === 'keydown') listeners.push(fn);
        },
        removeEventListener: (type, fn) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        },
    };
    return {
        press(key, { repeat = false, ctrlKey = false } = {}) {
            for (const fn of [...listeners]) {
                fn({ key, repeat, ctrlKey, metaKey: false, altKey: false, preventDefault() {} });
            }
        },
        get bound() { return listeners.length; },
    };
}

function record() {
    const calls = [];
    return {
        calls,
        actions: {
            escape: (ctx) => calls.push(['escape', ctx]),
            toggleHelp: () => calls.push(['toggleHelp']),
            togglePause: () => calls.push(['togglePause']),
            openMissionBoard: () => calls.push(['openMissionBoard']),
            selectTab: (i) => calls.push(['selectTab', i]),
        },
    };
}

test('H and ? open the manual from any context', () => {
    const dom = fakeDom();
    const rec = record();
    let context = 'hub';
    const unbind = bindHotkeys({ getContext: () => context, actions: rec.actions });

    for (const ctx of ['hub', 'run', 'results']) {
        context = ctx;
        dom.press('h');
        dom.press('?');
    }
    assert.deepEqual(rec.calls, [
        ['toggleHelp'], ['toggleHelp'],
        ['toggleHelp'], ['toggleHelp'],
        ['toggleHelp'], ['toggleHelp'],
    ]);
    unbind();
    assert.equal(dom.bound, 0, 'teardown removes the listener');
});

test('ESC routes to the per-context escape action', () => {
    const dom = fakeDom();
    const rec = record();
    let context = 'run';
    bindHotkeys({ getContext: () => context, actions: rec.actions });

    dom.press('Escape');
    context = 'hub';
    dom.press('Escape');
    assert.deepEqual(rec.calls, [['escape', 'run'], ['escape', 'hub']]);
});

test('tab hotkeys fire only on the hub and map to nav order', () => {
    const dom = fakeDom();
    const rec = record();
    let context = 'hub';
    bindHotkeys({ getContext: () => context, actions: rec.actions });

    dom.press('1');
    dom.press('6');
    context = 'run';
    dom.press('1');
    context = 'hub';
    dom.press('7'); // not a tab
    assert.deepEqual(rec.calls, [['selectTab', 0], ['selectTab', 5]]);
    assert.equal(HOTKEY_TAB_ORDER.length, 6);
    assert.equal(HOTKEY_TAB_ORDER[1], 'missions');
});

test('M opens the board on the hub; P pauses only during a run', () => {
    const dom = fakeDom();
    const rec = record();
    let context = 'hub';
    bindHotkeys({ getContext: () => context, actions: rec.actions });

    dom.press('m');
    dom.press('p'); // pause is a run verb
    context = 'run';
    dom.press('p');
    dom.press('m'); // board is a hub verb
    assert.deepEqual(rec.calls, [['openMissionBoard'], ['togglePause']]);
});

test('modifier chords and auto-repeat are ignored', () => {
    const dom = fakeDom();
    const rec = record();
    bindHotkeys({ getContext: () => 'hub', actions: rec.actions });

    dom.press('h', { ctrlKey: true });   // browser shortcut wins
    dom.press('m', { repeat: true });    // holding M does not spam
    assert.deepEqual(rec.calls, []);
});
