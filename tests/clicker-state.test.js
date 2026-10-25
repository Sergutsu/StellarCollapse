import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ClickerState, GENERATORS, fmt } from '../src/clicker-state.js';

const make = (saved, opts = {}) => new ClickerState(saved, { rng: () => 0.99, now: () => opts.now ?? 1_000_000, ...opts });
const rich = (over = {}) => ({ stardust: 1e9, lifetime: 1e9, runStardust: 1e9, credits: 1e9, minerals: 1e9, warp: 99, rep: 999, ...over });

describe('clicker conversion', () => {
  it('clicking yields stardust, ore and combo (old click-match)', () => {
    const g = make(); const r = g.clickStar();
    assert.ok(r.gain >= 1); assert.ok(g.s.stardust >= 1); assert.equal(g.s.totalClicks, 1);
    assert.ok(Object.values(g.s.ores).reduce((a, b) => a + b, 0) >= 1);
  });
  it('generators produce idle income via tick (old falling/auto-match)', () => {
    const g = make(rich()); assert.ok(g.buyGenerator('siphon', 10));
    const before = g.s.stardust; g.tick(60); assert.ok(g.s.stardust > before);
    assert.ok(g.productionPerSec() > 0);
  });
  it('bulk buy and max-affordable are consistent', () => {
    const g = make(rich()); const q = g.maxAffordable(GENERATORS[0]); assert.ok(q > 10);
    assert.ok(g.buyGenerator('siphon', 'max')); assert.ok(g.s.stardust < 1e9);
  });
  it('cannot buy unaffordable generator', () => { const g = make(); assert.equal(g.buyGenerator('dyson', 1), false); });
  it('milestone doubles generator output at 10 owned', () => {
    const a = make(rich()); a.buyGenerator('siphon', 9); const r9 = a.genRate(GENERATORS[0]);
    const b = make(rich()); b.buyGenerator('siphon', 10); assert.ok(b.genRate(GENERATORS[0]) / 10 > r9 / 9 * 1.9);
  });
  it('core fills and collapses for a burst (old Miner)', () => {
    const g = make(rich()); g.s.core = 100; const p = g.collapseCore(); assert.ok(p > 0); assert.equal(g.s.core, 0); assert.equal(g.s.collapses, 1);
  });
  it('bomb and snake consumables consume rare ore (old specials)', () => {
    const g = make(rich()); g.s.ores.bomb = 5; g.s.ores.snake = 5;
    assert.ok(g.useBomb() > 0); assert.equal(g.s.ores.bomb, 0);
    assert.ok(g.useSnake() > 0); assert.ok(g.s.ores.red >= 4);
  });
  it('idle turrets clear waves and boss pays out (old Defense)', () => {
    const g = make(rich()); g.buyGenerator('turret', 20); g.tick(30);
    assert.ok(g.s.wavesCleared >= 1); assert.ok(g.s.wave > 1);
  });
  it('market sell and refine convert ore (old economy)', () => {
    const g = make(rich()); g.s.ores.red = 100; const c0 = g.s.credits;
    assert.ok(g.sellOre('red', 10) > 0); assert.ok(g.s.credits > c0);
    assert.ok(g.refine('red', 40).minerals > 0); assert.ok(g.s.minerals > 1e9 - 1);
  });
  it('research completes after its timer', () => {
    let t = 1_000_000; const g = new ClickerState(rich(), { now: () => t, rng: () => 0.99 });
    assert.ok(g.startResearch('automation')); t += 61_000; g.tick(0.1); assert.ok(g.s.researchDone.includes('automation'));
  });
  it('sectors/ships/crew are permanent purchases with gates', () => {
    const g = make(rich()); assert.ok(g.chartSector('ember')); assert.ok(g.buyShip('nyx')); assert.ok(g.hireCrew('draeven'));
    const poor = make(); assert.equal(poor.chartSector('core'), false);
  });
  it('contracts claim only when target met, then reroll', () => {
    const g = make(rich()); const c = g.s.contracts.find(x => x.need === 'stardust');
    c.progress = c.target; const r = g.claimContract(c.uid); assert.ok(r); assert.ok(g.s.contracts.length >= 3);
  });
  it('offline earnings are capped and credited', () => {
    let t = 1_000_000; const g = new ClickerState(rich({ lastSeen: t }), { now: () => t, rng: () => 0.99 });
    g.buyGenerator('siphon', 10); const rep = g.applyOffline(t + 100 * 3600 * 1000);
    assert.ok(rep.seconds <= 8 * 3600); assert.ok(rep.stardust > 0);
  });
  it('supernova grants dark matter and resets the run', () => {
    const g = make(rich()); g.buyGenerator('siphon', 5);
    const dm = g.supernova(); assert.ok(dm >= 1); assert.equal(g.s.gens.siphon, undefined); assert.ok(g.s.darkMatter >= 1);
  });
  it('save snapshot round-trips', () => {
    const g = make(rich()); g.clickStar(); const restored = make(g.snapshot());
    assert.equal(restored.s.totalClicks, g.s.totalClicks);
  });
  it('fmt abbreviates large numbers', () => { assert.equal(fmt(1500), '1.50K'); assert.equal(fmt(2_500_000), '2.50M'); });
});

describe('merged hub wallet (ADR-0014)', () => {
  it('adoptWallet + walletDeltas report only earned integer deltas', () => {
    const g = make(null); g.adoptWallet({ credits: 100, minerals: 20, warp: 1, rep: 0, ores: { red: 3 } });
    assert.deepEqual(g.walletDeltas(), { credits: 0, minerals: 0, warp: 0, rep: 0, ores: {} });
    g.s.credits += 55; g.s.ores.red += 2.7;
    const d = g.walletDeltas();
    assert.equal(d.credits, 55); assert.equal(d.ores.red, 2); // fraction stays in the clicker
    assert.deepEqual(g.walletDeltas().ores, {});
  });
  it('externalMult (station research/sectors) scales production', () => {
    const g = make(rich()); g.buyGenerator('siphon', 1); const base = g.productionPerSec();
    g.externalMult = 2; assert.ok(Math.abs(g.productionPerSec() - base * 2) < 1e-9);
  });
  it('clicker slice round-trips through MetaState', async () => {
    const { MetaState } = await import('../src/meta-state.js');
    const meta = new MetaState(); assert.equal(meta.getClickerSave(), null);
    meta.saveClickerState({ stardust: 42, gens: { siphon: 3 } });
    const reloaded = new MetaState(meta.snapshot());
    assert.equal(reloaded.getClickerSave().stardust, 42);
  });
});
