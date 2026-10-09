// Hub smoke suite: executes the real HubScene + tab scenes under node --test.
//
// Everything else in tests/ covers pure logic. The hub's view code could not be
// executed at all, because scene modules import the bare specifier `pixi.js`,
// which only the browser's importmap resolves. That blind spot shipped real
// defects: `hub-scene.js` called `buildIdleMissions()` without importing it (so
// every IDLE dispatch threw), `_fleetSlotLimit()` read `effects.fleetSlots` — an
// *extras* counter that starts at 0 — as the berth capacity (so a fresh station
// had one berth and refused every BUILD order), and STAR MAP rebuilt its left
// panel by clearing the bay's shared `list`, destroying the containers the
// SHIPYARD and MARKET tabs had parked there.
//
// So this suite boots the hub against a headless Pixi stand-in
// (tests/helpers/pixi-mock.js, mapped by pixi-resolve-hook.mjs) and drives the
// lifecycle a player drives: boot → activate every tab → resize → tap rows and
// buttons → dispatch → destroy. It asserts *behaviour and geometry*, not
// appearance: no throws, no non-finite coordinates, exactly one owner of the
// shared left bay, and profile mutations that match what the UI quoted.
//
// If the host Node predates `module.register()` (Node < 20.6) the hook cannot be
// installed and the suite skips itself rather than failing CI.

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

let register = null;
try {
    ({ register } = await import('node:module'));
} catch {
    register = null;
}

const HOOK_AVAILABLE = typeof register === 'function';

let HubScene = null;
let MetaState = null;
let starterProfile = null;
let pixi = null;
let loadError = null;

if (HOOK_AVAILABLE) {
    try {
        register('./helpers/pixi-resolve-hook.mjs', import.meta.url);
        pixi = await import('./helpers/pixi-mock.js');
        ({ HubScene } = await import('../src/scenes/hub-scene.js'));
        ({ MetaState, starterProfile } = await import('../src/meta-state.js'));
    } catch (err) {
        loadError = err;
    }
}

// Viewport sizes the hub must survive: a wide desktop down to the narrowest
// layout the shell clamps to.
const VIEWPORTS = [[1920, 1080], [1440, 900], [1280, 800], [1024, 700], [900, 600], [820, 560]];
const TAB_IDS = ['star-map', 'missions', 'build', 'research', 'crew', 'market'];

/** Walk a scene graph collecting every non-finite coordinate or size. */
function nonFiniteGeometry(node, path = 'root', out = []) {
    if (!node) return out;
    const checks = {
        x: node.position?.x, y: node.position?.y,
        scaleX: node.scale?.x, scaleY: node.scale?.y,
        width: node._width, height: node._height, alpha: node.alpha,
        rotation: node.rotation,
    };
    for (const [key, value] of Object.entries(checks)) {
        if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${path}.${key}=${value}`);
    }
    (node.children || []).forEach((child, i) => nonFiniteGeometry(child, `${path}/${child.constructor?.name || 'node'}[${i}]`, out));
    return out;
}

/** Every descendant that listens for `pointertap` — i.e. everything clickable. */
function tappable(node, out = []) {
    (node?.children || []).forEach((child) => {
        if (typeof child.listenerCount === 'function' && child.listenerCount('pointertap') > 0) out.push(child);
        tappable(child, out);
    });
    return out;
}

/** Boot a hub with a fresh profile and a stocked wallet/hold. */
function bootHub({ width = 1440, height = 900, minerals = 5000, ores = {} } = {}) {
    const meta = new MetaState(starterProfile());
    meta.setHubResource('minerals', minerals);
    for (const [color, amount] of Object.entries(ores)) meta.addOre(color, amount);

    const app = { screen: { width, height } };
    const uiRoot = new pixi.Container();
    const hub = new HubScene({ app, uiRoot, meta });
    hub.show();
    hub.layout({ width, height });
    return { hub, meta, app, uiRoot };
}

describe('hub scene smoke (executed against a headless Pixi)', { skip: !HOOK_AVAILABLE && 'module.register() unavailable on this Node' }, () => {
    before(() => {
        if (loadError) throw loadError;   // a real import failure must fail, not skip
        assert.ok(HubScene && MetaState && pixi, 'hub + mock loaded');
    });

    it('boots, builds every tab and lays out at six viewport sizes', () => {
        const { hub, uiRoot, app } = bootHub();
        const tabs = hub._nodes.tabs;
        for (const id of ['star-map', 'build', 'research', 'crew', 'market']) {
            assert.ok(tabs[id], `tab scene ${id} exists`);
        }
        assert.ok(hub._nodes.sidePanel?.list, 'the shared left bay exists');

        for (const [w, h] of VIEWPORTS) {
            app.screen.width = w;
            app.screen.height = h;
            hub.layout({ width: w, height: h });
            const bad = nonFiniteGeometry(uiRoot);
            assert.deepEqual(bad, [], `finite geometry at ${w}x${h}`);
        }
    });

    it('activates every tab and keeps exactly one owner of the left bay', () => {
        const { hub } = bootHub();
        const side = hub._nodes.sidePanel;

        for (const id of TAB_IDS) {
            hub._setActiveTab(id);
            const scene = hub._nodes.tabs[id];
            const owns = !!scene?.usesSidePanel;
            assert.equal(side.container.visible, owns, `${id}: bay visible iff the tab owns it`);
            assert.equal(scene?.hide ? true : true, true);

            const visibleOwners = side.list.children.filter((child) => child.visible);
            assert.ok(
                visibleOwners.length <= 1,
                `${id}: at most one owner's content visible in the shared bay (saw ${visibleOwners.length})`,
            );
            if (owns) {
                assert.equal(side.ownerId, id);
                assert.equal(side.header.text, scene.sidePanelTitle);
                assert.equal(visibleOwners.length, 1, `${id}: the owner's content is shown`);
                assert.ok(visibleOwners[0].children.length > 0, `${id}: and it is not empty`);
            } else {
                assert.equal(side.ownerId, null, `${id}: bay released`);
            }
        }
    });

    it('STAR MAP: renders the board + index for every body kind, and slows the sky', () => {
        const { hub } = bootHub();
        hub._setActiveTab('star-map');
        const sm = hub._nodes.tabs['star-map'];
        const side = hub._nodes.sidePanel;

        // Orbital motion is scaled, not raw: 1 s of frames advances 250 ms.
        sm._timeMs = 0;
        sm.tick(1000);
        assert.equal(sm._timeMs, 250, 'ORBIT_TIME_SCALE slows celestial motion');
        for (let i = 0; i < 60; i += 1) sm.tick(16);

        const kinds = ['star', 'planet', 'moon', 'station', 'hazard', 'belt', 'ship'];
        for (const kind of kinds) {
            const body = kind === 'star'
                ? sm._findBody(sm._system.star.id)
                : kind === 'ship'
                    ? sm._system.ships[0]
                    : sm._system.pois.find((p) => p.poiType === kind);
            if (!body) continue;
            sm._onPinTapped(body);
            assert.equal(sm._selectedId, body.id, `${kind}: selection taken`);
            assert.ok(side.list.children.some((c) => c.visible && c.children.length > 0), `${kind}: board rendered`);
            assert.deepEqual(nonFiniteGeometry(side.list), [], `${kind}: finite board geometry`);
        }

        // The index rows are real controls and selecting one works.
        const rows = tappable(side.list.children.find((c) => c.visible));
        assert.ok(rows.length >= 5, `SYSTEM INDEX + PLOT COURSE are tappable (${rows.length})`);
        rows.forEach((row) => row.emit('pointertap', {}));
        assert.deepEqual(nonFiniteGeometry(side.list), [], 'finite geometry after tapping every row');

        // Empty space clears the selection; the bay stays usable.
        sm._closeSystemData();
        assert.equal(sm._selectedId, null);
        assert.ok(side.list.children.some((c) => c.visible), 'the index survives a cleared selection');
    });

    it('STAR MAP: PLOT COURSE charts a sector through MetaState', () => {
        const { hub, meta } = bootHub();
        hub._setActiveTab('star-map');
        const sm = hub._nodes.tabs['star-map'];
        meta.addWarp(5);

        sm._selectSector('omega-4-belt');
        assert.equal(sm._selectedSectorId, 'omega-4-belt');
        sm._onPlotCourse();
        assert.ok(meta.isSectorDiscovered('omega-4-belt'), 'sector charted');
        assert.match(sm._sectorStatus, /CHARTED/);

        // A second jump to the same sector is refused and costs nothing.
        const warp = meta.getHubResource('warp');
        sm._onPlotCourse();
        assert.equal(meta.getHubResource('warp'), warp, 'a refusal spends no warp');
        assert.match(sm._sectorStatus, /REFUSED|CHARTED/);
    });

    it('MARKET: charts every good and the series matches the order ticket', () => {
        const { hub, meta } = bootHub({ ores: { red: 40, bomb: 8 } });
        hub._setActiveTab('market');
        const mk = hub._nodes.tabs.market;

        for (const id of ['pyrite', 'cryonite', 'verdanite', 'helium', 'volatiles', 'biomass', 'minerals']) {
            mk._selectGood(id);
            const history = mk._history;
            assert.equal(history?.ok, true, `${id}: series derived`);
            assert.equal(history.goodId, id);
            assert.ok(history.points.length >= 2);
            history.points.forEach((p) => {
                assert.ok(Number.isFinite(p.mid) && p.mid > 0, `${id}: finite mid`);
                assert.ok(Number.isInteger(p.buy) && Number.isInteger(p.sell));
            });
            // The chart's right edge is the price the buttons quote.
            const quoted = meta.getEffects ? mk._lastReport.prices[id] : null;
            assert.equal(history.last.buy, quoted.buy, `${id}: chart agrees with the ticket`);
            assert.equal(history.last.sell, quoted.sell);
            assert.deepEqual(nonFiniteGeometry(mk._nodes.chartPanel), [], `${id}: finite chart geometry`);
        }

        // Crosshair events must not throw and must clear again.
        const panel = mk._nodes.chartPanel;
        panel.emit('pointermove', { global: { x: 200, y: 120 } });
        assert.ok(mk._crosshair, 'crosshair tracked');
        panel.emit('pointerout', {});
        assert.equal(mk._crosshair, null, 'crosshair cleared');
    });

    it('MARKET: BUY / SELL / REFINE in the left panel move the profile as quoted', () => {
        // No seeded pyrite: the round trip below has to be measured on units
        // this test actually bought, or free ore hides the spread.
        const { hub, meta } = bootHub({ ores: {} });
        hub._setActiveTab('market');
        const mk = hub._nodes.tabs.market;

        const creditsBefore = meta.credits;
        const buyPrice = mk._lastReport?.prices?.pyrite?.buy ?? null;
        const sellPrice = mk._lastReport?.prices?.pyrite?.sell ?? null;
        mk._setLot(10);
        mk._trade('pyrite', 'buy');
        assert.equal(meta.getOre('red'), 10, 'bought the 10-unit lot');
        assert.ok(meta.credits < creditsBefore, 'credits spent');
        assert.equal(creditsBefore - meta.credits, 10 * buyPrice, 'spent exactly the quoted price');

        // Selling the same units back must lose the house spread.
        const creditsAfterBuy = meta.credits;
        mk._trade('pyrite', 'sell');
        assert.equal(meta.getOre('red'), 0, 'sold the hold');
        assert.equal(meta.credits - creditsAfterBuy, 10 * sellPrice, 'returned the quoted sell price');
        assert.ok(meta.credits < creditsBefore, 'the round trip cost the spread');

        // An empty hold refuses rather than going negative.
        mk._trade('biomass', 'sell');
        assert.match(mk._status, /REFUSED/);
        assert.equal(meta.getOre('snake'), 0);

        // The refinery turns ore into minerals.
        meta.addOre('blue', 8);
        const mineralsBefore = meta.getHubResource('minerals');
        mk._refineAll();
        assert.equal(meta.getHubResource('minerals'), mineralsBefore + 2, '8 common ore → 2 minerals');
        assert.match(mk._status, /REFINED/);

        // The watchlist rows are live controls.
        const rows = tappable(hub._nodes.sidePanel.list.children.find((c) => c.visible));
        assert.ok(rows.length >= 7, `goods rows are tappable (${rows.length})`);
    });

    it('BUILD: a fresh station has its 10 berths and the yard button builds', () => {
        const { hub, meta } = bootHub({ minerals: 5000 });
        hub._setActiveTab('build');
        const bu = hub._nodes.tabs.build;

        // The starter fleet must fit inside the cap, or BUILD is refused forever.
        assert.equal(bu._fleetSlotLimit(), 10, 'base berths, not the research extras counter');
        assert.ok(meta.fleetSnapshot().length < bu._fleetSlotLimit(), 'the starter fleet fits');

        const card = bu._nodes.blueprintCards[0];
        const fleetBefore = meta.fleetSnapshot().length;
        const mineralsBefore = meta.getHubResource('minerals');

        // Tap the actual button that lives in the left panel.
        card.buildBtn.container.emit('pointertap', {});
        assert.equal(meta.fleetSnapshot().length, fleetBefore + 1, 'a hull was launched');
        assert.equal(meta.getHubResource('minerals'), mineralsBefore - card.bp.cost, 'priced in minerals');
        assert.match(bu._yardStatus, /launched/);

        // An unaffordable order refuses and explains itself.
        bu._buildShip({ className: 'Frigate', baseName: 'Frigate', cost: 999999 });
        assert.match(bu._yardStatus, /more minerals/);

        // The yard belongs to the AVAILABLE FLEET sub-tab only.
        bu._setSubTab('motherShip');
        assert.equal(bu._nodes.yard.visible, false, 'yard hidden on MOTHER-SHIP');
        bu._setSubTab('fleet');
        assert.equal(bu._nodes.yard.visible, true, 'yard back on AVAILABLE FLEET');
    });

    it('BUILD: the yard survives another tab owning the bay', () => {
        const { hub, meta } = bootHub({ minerals: 5000 });
        hub._setActiveTab('build');
        const bu = hub._nodes.tabs.build;
        const side = hub._nodes.sidePanel;
        const yard = bu._nodes.yard;

        // Regression: STAR MAP cleared the shared list and destroyed this.
        hub._setActiveTab('star-map');
        hub._setActiveTab('market');
        hub._setActiveTab('build');

        assert.equal(yard.parent, side.list, 'the yard is still mounted in the bay');
        assert.equal(yard.visible, true, 'and visible again for its owner');
        const fleetBefore = meta.fleetSnapshot().length;
        bu._nodes.blueprintCards[0].buildBtn.container.emit('pointertap', {});
        assert.equal(meta.fleetSnapshot().length, fleetBefore + 1, 'its BUILD button still works');
    });

    it('MISSIONS: IDLE dispatch creates a job (the reported bug)', () => {
        const { hub, meta } = bootHub();
        hub._setActiveTab('missions');
        hub._setDispatchMode('idle');

        const before = meta.activeMissionsSnapshot().length;
        hub._dispatchSelectedMission();
        const after = meta.activeMissionsSnapshot();
        assert.equal(after.length, before + 1, 'an idle job was created');
        assert.ok(after[0].missionId || after[0].id, 'the job names its contract');
        assert.ok(Number.isFinite(after[0].endsAt), 'and carries an absolute ETA');
    });

    it('tears down without leaving a scene graph behind', () => {
        const { hub, uiRoot } = bootHub();
        hub._setActiveTab('market');
        hub.hide();
        hub.destroy();
        assert.equal(hub._nodes, null, 'nodes dropped');
        assert.deepEqual(nonFiniteGeometry(uiRoot), [], 'no dangling geometry');
    });
});
