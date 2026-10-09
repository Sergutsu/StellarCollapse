// The hub's left column can be handed to a tab (P9): STAR MAP puts its
// SYSTEM DATA board there, BUILD/UPGRADE its shipyard, MARKET its goods
// list. The hub owns the frame, the tab owns the content (ADR-0010), and
// the two sides meet through a small duck-typed contract:
//
//   usesSidePanel  — opt in, so the hub knows to show the panel at all
//   sidePanelTitle — the header text the hub writes
//   layoutSide({width,height}) — called on activation and on every resize
//   side.list      — the container the tab builds its children into
//
// Scene classes never execute under `node --test` (they need WebGL), so
// the contract is asserted over the sources instead — the same trick
// `module-imports.test.js` uses to catch a call to a function nobody
// imported.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

const HUB = 'src/scenes/hub-scene.js';
const TABS = {
    starmap: 'src/scenes/tabs/star-map-tab.js',
    build: 'src/scenes/tabs/build-upgrade-tab.js',
    market: 'src/scenes/tabs/market-tab.js',
};

const read = (p) => readFileSync(p, 'utf8');

describe('tab-owned left panel contract', () => {
    it('the hub builds the panel, injects it, and sizes it on activation', () => {
        const hub = read(HUB);
        assert.match(hub, /_buildSidePanel\(\)\s*\{/, 'panel factory exists');
        assert.match(hub, /list,\s*\n\s*\/\/|list,/, 'panel exposes a `list` container');
        assert.match(hub, /sidePanel\.container/, 'panel is mounted in the scene graph');

        // Every tab that opts in must be constructed with the panel.
        const injected = [...hub.matchAll(/new (\w+Tab)\(\{[^}]*side:\s*sidePanel[^}]*\}\)/g)]
            .map((m) => m[1]);
        assert.deepEqual(injected.sort(), ['BuildUpgradeTab', 'MarketTab', 'StarMapTab']);

        assert.match(hub, /usesSidePanel/, 'the hub reads the opt-in flag');
        assert.match(hub, /sidePanelTitle/, 'the hub reads the header text');
        assert.match(hub, /scene\.layoutSide\(\{/, 'the hub hands the tab its size');
        assert.match(hub, /width:\s*side\._w/, 'the size comes from the laid-out panel');
    });

    it('shows the panel only for tabs that opt in, and never over the other left content', () => {
        const hub = read(HUB);
        assert.match(hub, /const showSideLeft = !showIdleLeft && !showResearchLeft && !!sideScene\?\.usesSidePanel;/);
        assert.match(hub, /n\.sidePanel\.container\.visible = showSideLeft;/);
        assert.match(hub, /n\.sidePanel\.ownerId = tabId;/, 'the owner is tracked so resizes reach the right tab');
    });

    for (const [name, path] of Object.entries(TABS)) {
        it(`${name} opts in, names its panel, and implements layoutSide`, () => {
            const src = read(path);
            assert.match(src, /side\s*=\s*null/, 'accepts the injected panel (optional)');
            assert.match(src, /this\._side = side;/, 'stores it');
            assert.match(src, /this\.usesSidePanel = true;/, 'opts in');
            assert.match(src, /this\.sidePanelTitle = '[A-Z][A-Z /]+';/, 'names the header');
            assert.match(src, /layoutSide\(\{ width = \d+, height = \d+ \} = \{\}\)/, 'implements layoutSide');
            assert.match(src, /side\.list/, 'reads the hub-provided list container');
            assert.match(src, /(?:side\.)?list\.addChild\(/, 'builds into that list');
            // Either the content is rebuilt into the list on every render
            // (STAR MAP) or a persistent container is re-parented once
            // (SHIPYARD, MARKET). Both must be idempotent under a resize.
            assert.ok(
                src.includes('parent !== side.list') || src.includes('list.removeChildren()'),
                'mounting into the list is idempotent',
            );
        });
    }

    it('the panels stay owned by their tabs: star map, shipyard, market list', () => {
        assert.match(read(TABS.starmap), /sidePanelTitle = 'SYSTEM DATA';/);
        assert.match(read(TABS.starmap), /_renderSidePanel\(\)/, 'renders the body read-out');
        assert.match(read(TABS.starmap), /SYSTEM INDEX/, 'and an index of the system');

        assert.match(read(TABS.build), /sidePanelTitle = 'SHIPYARD';/);
        assert.match(read(TABS.build), /yard\.addChild\(card\)/, 'blueprint cards live in the yard container');

        assert.match(read(TABS.market), /sidePanelTitle = 'MARKET';/);
        assert.match(read(TABS.market), /_buildGoodsList\(\)/, 'the goods list is its own container');
        assert.match(read(TABS.market), /priceHistory\(/, 'the centre panel charts a derived series');
    });

    it('the bay is shared safely: own container, no clearing of `side.list`', () => {
        // Regression: STAR MAP used to rebuild its board by clearing the
        // shared `side.list`, which destroyed the containers the SHIPYARD and
        // MARKET tabs had parked there — the yard's BUILD buttons came back
        // dead after one visit to the star map.
        for (const [name, path] of Object.entries(TABS)) {
            const src = read(path);
            assert.ok(
                !/side\.list\.removeChildren|list\.removeChildren\(\)\.forEach[\s\S]{0,80}side\.list/.test(src)
                    || name === 'starmap',
                `${name} must not clear the shared list`,
            );
            if (name === 'starmap') {
                assert.match(src, /this\._sideRoot = new Container\(\)/, 'keeps its content in its own container');
                assert.match(src, /this\._sideRoot\.parent !== side\.list/, 'mounts that container once');
                assert.match(src, /const list = this\._sideRoot;/, 'and only ever clears that');
            } else {
                assert.match(src, /parent !== side\.list/, `${name} re-parents its own container once`);
            }
        }
    });

    it('each owner hides its content when it loses the bay', () => {
        // Regression: all three tabs left their content visible, so the
        // previous owner rendered behind the new one (16 star-map children
        // still showing under the SHIPYARD).
        assert.match(read(TABS.starmap), /if \(this\._sideRoot\) this\._sideRoot\.visible = false;/);
        assert.match(read(TABS.market), /this\._nodes\?\.market\.container\.visible = false|market\) this\._nodes\.market\.container\.visible = false/);
        assert.match(read(TABS.build), /this\._nodes\?\.yard\.visible = false|yard\) this\._nodes\.yard\.visible = false/);

        // Each owner also re-shows itself when it lays out.
        assert.match(read(TABS.starmap), /this\._sideRoot\.visible = true;/);
        assert.match(read(TABS.market), /m\.container\.visible = true;/);
        assert.match(read(TABS.build), /yard\.visible = visible;/);

        // And the hub hides every non-owner's container on a hand-over, so a
        // tab that forgets cannot render behind the next owner.
        const hub = read(HUB);
        assert.match(hub, /if \(n\.sidePanel\.ownerId !== tabId\) \{/);
        assert.match(hub, /n\.sidePanel\.list\.children\.forEach\(\(child\) => \{ child\.visible = false; \}\);/);
    });

    it('berth capacity is base berths plus research extras, read from one place', () => {
        // Regression: the yard read `effects.fleetSlots` (an extras counter
        // that starts at 0) as the capacity, so a fresh station had one berth
        // for a four-ship starter fleet and refused every BUILD order.
        const src = read(TABS.build);
        assert.match(src, /import \{[^}]*fleetSlotLimit[^}]*\} from '\.\.\/\.\.\/crew\.js'/, 'imports the pure berth math');
        assert.match(src, /BASE_FLEET_SLOTS/, 'and the base-berth constant');
        assert.match(src, /typeof this\.meta\?\.fleetSlots === 'function'/, 'prefers MetaState.fleetSlots()');
        assert.ok(
            !/getEffects\?\.\(\)\.fleetSlots;\s*\n\s*if \(Number\.isFinite/.test(src),
            'no longer reads the extras counter as the capacity',
        );

        const meta = read('src/meta-state.js');
        assert.match(meta, /fleetSlots\(\) \{ return fleetSlotLimit\(this\.getEffects\(\)\); \}/);

        const crew = read('src/crew.js');
        assert.match(crew, /export const BASE_FLEET_SLOTS = 10;/);
        assert.match(crew, /return BASE_FLEET_SLOTS \+ extra;/);
    });

    it('the floating SYSTEM DATA overlay is gone', () => {
        const src = read(TABS.starmap);
        assert.ok(!src.includes('_buildSystemData'), 'no floating panel builder');
        assert.ok(!src.includes('_layoutSystemData'), 'no per-frame anchoring');
        assert.ok(!src.includes('systemData'), 'no stale node references');
    });
});
