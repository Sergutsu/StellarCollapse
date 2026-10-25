// Clicker / idle conversion of every Stellar Venture mechanic.
// Pure + framework-free (no DOM, no Pixi): the view renders, this decides.
//
// Conversion map (old mechanic -> clicker/idle mechanic):
//   Stellar click-match (click a 4+ run) -> CLICK THE STAR: each click is a
//     match; clicks build a COMBO that multiplies yield and decays idle.
//   Auto-Match (runs clear on lock)      -> Auto-Matcher generators.
//   Falling pieces / gravity / lines     -> generator tiers + output lines
//     per second; "level" comes from lifetime stardust, not falling speed.
//   Miner (minerals fall to a 6x6 core)  -> Mining Drones fill the CORE;
//     a full core COLLAPSES for a burst (the old core-collapse payout).
//   Bomb / Snake specials (Collapsed)    -> Bomb Blast & Snake Chain
//     consumables + Bomb Reactor / Snake Conduit generators (rare ores).
//   Defense (paddle/ball/invaders/boss)  -> idle turret DPS vs WAVES;
//     clicking the star also damages the wave; boss every 10 waves.
//   Missions / contracts                 -> production CONTRACTS with
//     targets, timers and the same credit/mineral/rep-style rewards.
//   Idle dispatch + offline earnings     -> all generators tick from
//     timestamps; offline progress is computed (capped) on load.
//   Market / refinery                    -> sell 6 ores, refine ore->minerals.
//   Research tree                        -> timed idle research projects.
//   Crew / fleet / hull                  -> crew boost assigned generators,
//     ships are purchasable global multipliers (no wear micro-management:
//     hull wear became ship upkeep folded into purchase tiers).
//   Star map / warp                      -> chart sectors with warp cells
//     for permanent production bonuses.
//   Reputation tiers                     -> earned from contracts/waves,
//     gates sectors, generators and research.
//   Daily board                          -> daily contract with bonus pay.
//   Score / levels                       -> lifetime stardust -> Star Level.
//   Game over / abort                    -> removed: an idle game cannot
//     top-out. Failure in Defense only stalls the wave.
//   Prestige (new, idle-genre standard)  -> SUPERNOVA: reset for Dark
//     Matter, a permanent multiplier, plus prestige upgrades.
import { Emitter } from './emitter.js';
import { marketPrices, refineQuote } from './economy.js';

export const CLICKER_SAVE_VERSION = 1;
export const OFFLINE_CAP_SEC = 8 * 3600;
export const COMBO_WINDOW_MS = 2500;
export const COMBO_MAX = 100;
export const GOLDEN_STAR_EVERY_SEC = 75;

const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmt(v) {
  v = n(v);
  if (v < 1000) return Number.isInteger(v) ? String(v) : v.toFixed(1);
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp'];
  let u = -1;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)}${units[u]}`;
}

// id, name, icon, baseCost(stardust), baseRate(stardust/s), ore per 60s, blurb (old mechanic)
export const GENERATORS = Object.freeze([
  { id: 'siphon',   name: 'Stellar Siphon',   icon: '✦', cost: 15,     rate: 0.2,  ore: 'red',    oreRate: 0.6, blurb: 'Old Stellar board, siphoning matches for you.' },
  { id: 'matcher',  name: 'Auto-Matcher',     icon: '▦', cost: 120,    rate: 1.2,  ore: 'blue',   oreRate: 0.5, blurb: 'Auto-Match mode: clears 4+ runs on every lock.' },
  { id: 'drone',    name: 'Mining Drone',     icon: '⛏', cost: 900,    rate: 7,    ore: 'green',  oreRate: 0.7, blurb: 'Miner mode: hauls minerals in from all 4 edges.' },
  { id: 'turret',   name: 'Defense Turret',   icon: '♜', cost: 6500,   rate: 38,   ore: 'yellow', oreRate: 0.6, dps: 6, blurb: 'Defense mode: auto-fires at invader waves.' },
  { id: 'extractor',name: 'Core Extractor',   icon: '⬢', cost: 42000,  rate: 210,  ore: 'green',  oreRate: 1.4, coreRate: 2.2, blurb: 'Builds the 6×6 core that used to need hand-stacking.' },
  { id: 'snake',    name: 'Snake Conduit',    icon: '🐍', cost: 260000, rate: 1250, ore: 'snake',  oreRate: 0.25, blurb: 'Snake special, tamed: chains cells all day.' },
  { id: 'bomb',     name: 'Bomb Reactor',     icon: '💣', cost: 1600000,rate: 7600, ore: 'bomb',   oreRate: 0.25, blurb: 'Bomb special, contained: 5×5 blasts on tap.' },
  { id: 'dyson',    name: 'Dyson Swarm',      icon: '☀', cost: 12000000,rate: 48000,ore: 'yellow', oreRate: 2.5, blurb: 'Endgame: a star, fully farmed.' },
]);
export const GEN_BY_ID = Object.fromEntries(GENERATORS.map(g => [g.id, g]));

const U = (id, name, icon, cost, curr, desc, req, mult) => ({ id, name, icon, cost, curr, desc, req, mult });
export const UPGRADES = Object.freeze([
  U('click1', 'Reinforced Glove', '👆', 100, 'stardust', 'Click power ×2', g => g.s.totalClicks >= 25, { click: 2 }),
  U('click2', 'Quantum Glove', '✋', 5000, 'stardust', 'Click power ×2', g => g.s.totalClicks >= 150, { click: 2 }),
  U('click3', 'Event-Horizon Glove', '🌀', 250000, 'stardust', 'Click power ×3', g => g.s.totalClicks >= 500, { click: 3 }),
  U('siphon1', 'Polished Siphons', '✦', 600, 'stardust', 'Stellar Siphons ×2', g => (g.s.gens.siphon || 0) >= 10, { gen: 'siphon', x: 2 }),
  U('matcher1', 'Overclocked Matchers', '▦', 6000, 'stardust', 'Auto-Matchers ×2', g => (g.s.gens.matcher || 0) >= 10, { gen: 'matcher', x: 2 }),
  U('drone1', 'Titanium Drills', '⛏', 40000, 'stardust', 'Mining Drones ×2', g => (g.s.gens.drone || 0) >= 10, { gen: 'drone', x: 2 }),
  U('turret1', 'Railgun Turrets', '♜', 300000, 'stardust', 'Turrets ×2 output & DPS', g => (g.s.gens.turret || 0) >= 10, { gen: 'turret', x: 2 }),
  U('global1', 'Efficient Station', '🏭', 50000, 'stardust', 'ALL production ×1.5', g => g.starLevel() >= 3, { global: 1.5 }),
  U('global2', 'Dyson Logistics', '🛰', 3000000, 'stardust', 'ALL production ×2', g => g.starLevel() >= 5, { global: 2 }),
  U('click-ore', 'Ore-Tipped Glove', '💎', 2000, 'stardust', 'Clicks also yield +1 ore', g => g.s.totalClicks >= 75, { clickOre: 1 }),
  U('combo1', 'Combo Amplifier', '🔥', 15000, 'stardust', 'Combo bonus doubled', g => g.s.bestCombo >= 40, { combo: 2 }),
  U('offline1', 'Deep-Space Relays', '📡', 100000, 'stardust', 'Offline cap 8h → 16h, offline rate 50% → 75%', g => g.starLevel() >= 4, { offline: 1 }),
]);

export const RESEARCH = Object.freeze([
  { id: 'automation', name: 'Automation', icon: '🤖', sec: 60, cost: { credits: 200, minerals: 0 }, desc: 'All production ×1.25', mult: { global: 1.25 } },
  { id: 'refinery', name: 'Refinery', icon: '🏭', sec: 180, cost: { credits: 300, minerals: 40 }, desc: 'Refining yields +50% minerals', mult: { refine: 1.5 } },
  { id: 'weapons', name: 'Weapons Lab', icon: '🔫', sec: 300, cost: { credits: 600, minerals: 80 }, desc: 'Turret/click wave damage ×2', mult: { dps: 2 } },
  { id: 'trade', name: 'Trade Compact', icon: '💱', sec: 420, cost: { credits: 900, minerals: 120 }, desc: 'Ore sell prices +25%', mult: { sell: 1.25 } },
  { id: 'warp', name: 'Warp Coils', icon: '🌀', sec: 600, cost: { credits: 1500, minerals: 200 }, desc: 'Wave/contract warp drops ×2', mult: { warp: 2 } },
  { id: 'dyson-tech', name: 'Dyson Tech', icon: '☀', sec: 900, cost: { credits: 3000, minerals: 400 }, desc: 'All production ×2', mult: { global: 2 } },
]);

export const SECTORS = Object.freeze([
  { id: 'ember', name: 'Ember Reach', icon: '🔥', warp: 1, rep: 0, bonus: 1.15, desc: '+15% production' },
  { id: 'frost', name: 'Frost Verge', icon: '❄', warp: 2, rep: 20, bonus: 1.25, desc: '+25% production' },
  { id: 'verdant', name: 'Verdant Deep', icon: '🌿', warp: 3, rep: 60, bonus: 1.4, desc: '+40% production' },
  { id: 'void', name: 'Void Crown', icon: '👑', warp: 5, rep: 150, bonus: 1.75, desc: '+75% production' },
  { id: 'core', name: 'Galactic Core', icon: '🌌', warp: 8, rep: 400, bonus: 2.5, desc: '+150% production' },
]);

export const SHIPS = Object.freeze([
  { id: 'nyx', name: 'Nyx-I Scout', icon: '🚀', cost: 500, desc: '+10% production', mult: 1.10 },
  { id: 'aegis', name: 'Aegis-Delta', icon: '🛡', cost: 2500, desc: '+25% wave damage', mult: 1.25, dps: true },
  { id: 'prospector', name: 'Prospector', icon: '⛏', cost: 8000, desc: '+30% ore yield', mult: 1.30, ore: true },
  { id: 'gaia', name: 'Gaia-Line', icon: '🌍', cost: 25000, desc: '+35% production', mult: 1.35 },
  { id: 'mercury', name: 'Mercury Arc', icon: '☿', cost: 75000, desc: '+50% sell prices', mult: 1.50, sell: true },
]);

export const CREW = Object.freeze([
  { id: 'draeven', name: 'V. Draeven · Captain', icon: '🧑‍🚀', cost: 300, gen: null, desc: '+15% ALL production', x: 1.15 },
  { id: 'halveri', name: 'T. Halveri · Engineer', icon: '👷', cost: 250, gen: 'siphon', desc: 'Siphons & Matchers ×1.5', x: 1.5, gen2: 'matcher' },
  { id: 'saros', name: 'K. Saros · Navigator', icon: '🧭', cost: 250, gen: 'drone', desc: 'Drones & Extractors ×1.5', x: 1.5, gen2: 'extractor' },
  { id: 'marrow', name: 'L. Marrow · Tactician', icon: '🎯', cost: 250, gen: 'turret', desc: 'Turrets ×1.5 & +DPS', x: 1.5 },
  { id: 'nadir', name: 'I. Nadir · Quartermaster', icon: '📦', cost: 250, gen: 'snake', desc: 'Snake & Bomb ×1.5', x: 1.5, gen2: 'bomb' },
]);

export const PRESTIGE_UPGRADES = Object.freeze([
  { id: 'p-click', name: 'Dark Glove', icon: '🌑', cost: 1, desc: 'Click power ×3 (permanent)', mult: { click: 3 } },
  { id: 'p-auto', name: 'Dark Automation', icon: '⬛', cost: 2, desc: 'All production ×3 (permanent)', mult: { global: 3 } },
  { id: 'p-start', name: 'Head Start', icon: '⏩', cost: 1, desc: 'Start each Supernova with 1,000 stardust', mult: { start: 1000 } },
  { id: 'p-core', name: 'Dark Core', icon: '⚫', cost: 3, desc: 'Core collapse payout ×3', mult: { core: 3 } },
]);

const CONTRACT_TEMPLATES = [
  { id: 'haul', name: 'Ore Haul', icon: '📦', need: 'stardust', desc: 'Produce stardust', reward: { credits: 250, minerals: 20 } },
  { id: 'defend', name: 'Sector Defense', icon: '🛡', need: 'waves', desc: 'Clear waves', reward: { credits: 400, warp: 1 } },
  { id: 'collapse', name: 'Core Collapse', icon: '⬢', need: 'collapses', desc: 'Collapse cores', reward: { credits: 350, minerals: 50 } },
  { id: 'clicks', name: 'Manual Override', icon: '👆', need: 'clicks', desc: 'Click the star', reward: { credits: 200, rep: 8 } },
  { id: 'daily', name: '★ DAILY: Big Haul', icon: '📅', need: 'stardust', desc: 'Produce stardust (daily bonus!)', reward: { credits: 1000, minerals: 80, rep: 15, warp: 1 }, daily: true },
];
const CONTRACT_SCALE = { stardust: [5000, 60000, 750000], waves: [3, 8, 20], collapses: [1, 3, 8], clicks: [60, 200, 600] };

export const STATION_SURGES = Object.freeze([
  { id: 'quantum', name: 'Quantum Core Surge', icon: '⚡', tab: 'research', tabLabel: 'RESEARCH', desc: '3x Research Speed for 45s!', durationSec: 45 },
  { id: 'market', name: 'Market Speculation', icon: '📈', tab: 'market', tabLabel: 'MARKET', desc: '+50% Ore Sell Prices & Refinery Yield for 60s!', durationSec: 60 },
  { id: 'solar', name: 'Solar Ion Drift', icon: '🚀', tab: 'missions', tabLabel: 'MISSIONS', desc: '2x Idle Mission Speed for 60s!', durationSec: 60 },
  { id: 'warp', name: 'Warp Resonance', icon: '🌌', tab: 'star-map', tabLabel: 'STAR MAP', desc: '-1 Warp Jump Cost for 45s!', durationSec: 45 },
]);

function starter() {
  return {
    v: CLICKER_SAVE_VERSION, stardust: 0, lifetime: 0, runStardust: 0,
    credits: 100, minerals: 20, warp: 1, darkMatter: 0, rep: 0,
    ores: { red: 0, blue: 0, green: 0, yellow: 0, bomb: 0, snake: 0 },
    gens: {}, upgrades: [], researchDone: [], researchActive: null, // {id, endsAt}
    sectors: [], ships: [], crew: [], prestigeUpgrades: [],
    combo: 0, bestCombo: 0, comboExpiresAt: 0, totalClicks: 0, clicksRun: 0,
    core: 0, collapses: 0, wave: 1, waveHp: 10, waveMaxHp: 10, wavesCleared: 0,
    contracts: [], contractSeq: 0, lastDaily: '', goldenAt: 0,
    activeSurge: null, nextSurgeAt: 0,
    stats: { bombsUsed: 0, snakesUsed: 0, goldenClicked: 0, supernovas: 0, offlineClaimed: 0 },
    lastSeen: Date.now(), createdAt: Date.now(),
  };
}

export class ClickerState {
  constructor(saved = null, { now = () => Date.now(), rng = Math.random } = {}) {
    this._e = new Emitter(); this.now = now; this.rng = rng;
    this.s = starter();
    if (saved && typeof saved === 'object') {
      const base = starter();
      this.s = { ...base, ...saved, ores: { ...base.ores, ...(saved.ores || {}) }, gens: { ...(saved.gens || {}) }, stats: { ...base.stats, ...(saved.stats || {}) } };
    }
    if (!this.s.contracts?.length) this._rollContracts();
    this.offlineReport = null;
  }
  on(ev, fn) { return this._e.on(ev, fn); }
  emit(ev, p) { this._e.emit(ev, p); }
  snapshot() { return JSON.parse(JSON.stringify(this.s)); }

  // ---- derived ----
  starLevel() { return 1 + Math.floor(Math.cbrt(this.s.lifetime / 1000)); }
  repTier() { return this.s.rep >= 400 ? 6 : this.s.rep >= 150 ? 5 : this.s.rep >= 60 ? 4 : this.s.rep >= 20 ? 3 : this.s.rep >= 5 ? 2 : 1; }
  _mults() {
    const m = { click: 1, global: 1, gen: {}, dps: 1, sell: 1, refine: 1, warp: 1, core: 1, ore: 1, clickOre: 0, combo: 1, start: 0 };
    const apply = (mm) => { if (!mm) return;
      if (mm.click) m.click *= mm.click; if (mm.global) m.global *= mm.global;
      if (mm.gen) m.gen[mm.gen] = (m.gen[mm.gen] || 1) * mm.x; if (mm.dps) m.dps *= mm.dps;
      if (mm.sell) m.sell *= mm.sell; if (mm.refine) m.refine *= mm.refine; if (mm.warp) m.warp *= mm.warp;
      if (mm.core) m.core *= mm.core; if (mm.clickOre) m.clickOre += mm.clickOre; if (mm.combo) m.combo *= mm.combo; if (mm.start) m.start += mm.start; };
    for (const id of this.s.upgrades) apply(UPGRADES.find(u => u.id === id)?.mult);
    for (const id of this.s.researchDone) apply(RESEARCH.find(r => r.id === id)?.mult);
    for (const id of this.s.prestigeUpgrades) apply(PRESTIGE_UPGRADES.find(u => u.id === id)?.mult);
    for (const id of this.s.sectors) { const sec = SECTORS.find(x => x.id === id); if (sec) m.global *= sec.bonus; }
    for (const id of this.s.ships) { const sh = SHIPS.find(x => x.id === id); if (!sh) continue; if (sh.dps) m.dps *= sh.mult; else if (sh.ore) m.ore *= sh.mult; else if (sh.sell) m.sell *= sh.mult; else m.global *= sh.mult; }
    for (const id of this.s.crew) { const c = CREW.find(x => x.id === id); if (!c) continue; if (!c.gen) m.global *= c.x; else { m.gen[c.gen] = (m.gen[c.gen] || 1) * c.x; if (c.gen2) m.gen[c.gen2] = (m.gen[c.gen2] || 1) * c.x; if (c.gen === 'turret') m.dps *= c.x; } }
    m.global *= 1 + this.s.darkMatter * 0.10; // each Dark Matter +10% forever
    if (Number.isFinite(this.externalMult) && this.externalMult > 0) m.global *= this.externalMult; // station research/sectors (set by hub tab)
    // generator milestones: every 10 owned doubles that generator
    return m;
  }
  genRate(g) {
    const count = this.s.gens[g.id] || 0; if (!count) return 0;
    const m = this._mults();
    const milestone = Math.pow(2, Math.floor(count / 10));
    return g.rate * count * milestone * (m.gen[g.id] || 1) * m.global;
  }
  productionPerSec() { return GENERATORS.reduce((a, g) => a + this.genRate(g), 0); }
  orePerSec() {
    const m = this._mults();
    const out = {};
    for (const g of GENERATORS) {
      const c = this.s.gens[g.id] || 0;
      if (c) {
        const effectiveCount = c <= 15 ? c : 15 + Math.sqrt(c - 15) * 3;
        out[g.ore] = (out[g.ore] || 0) + (g.oreRate * effectiveCount / 60) * Math.min(2.5, m.ore) * Math.min(3, (m.gen[g.id] || 1));
      }
    }
    return out;
  }
  dps() { const m = this._mults(); const t = GENERATORS.find(g => g.id === 'turret'); return (this.s.gens.turret || 0) * (t.dps || 0) * (m.gen.turret || 1) * m.dps + this.clickPower() * 0.5 * m.dps; }
  comboMult() { const active = this.now() < this.s.comboExpiresAt; const c = active ? this.s.combo : 0; return 1 + (c / 100) * 0.5 * this._mults().combo; } // up to +50% (or +100%)
  clickTier() { return Math.floor((this.s.totalClicks || 0) / 50); } // Click Mastery: +50% click power per tier
  clickPower() { return 1 * this._mults().click * (1 + this.clickTier() * 0.5) * (1 + this.productionPerSec() * 0.01); } // clicks scale with your engine (1% of /sec)
  coreMax() { return 100; }

  // ---- actions ----
  clickStar() {
    const t = this.now();
    this.s.combo = t < this.s.comboExpiresAt ? Math.min(COMBO_MAX, this.s.combo + 1) : 1;
    this.s.comboExpiresAt = t + COMBO_WINDOW_MS; this.s.bestCombo = Math.max(this.s.bestCombo, this.s.combo);
    const crit = this.rng() < 0.07;
    const gain = this.clickPower() * this.comboMult() * (crit ? 5 : 1);
    this._gain(gain); this.s.totalClicks++; this.s.clicksRun++;
    const ores = ['red', 'blue', 'green', 'yellow'];
    this.s.ores[ores[Math.floor(this.rng() * 4)]] += 1 + this._mults().clickOre;
    if (this.rng() < 0.04) this.s.ores[this.rng() < 0.5 ? 'bomb' : 'snake'] += 1;
    this._damageWave(this.clickPower() * this._mults().dps);
    // FEVER BURSTS at combo milestones: 25/50/100 clicks in a streak pay a
    // chunk of idle production — fast clicking should feel explosive.
    let burst = 0;
    if ([25, 50, 100].includes(this.s.combo)) {
      burst = this.productionPerSec() * (this.s.combo / 2) + this.clickPower() * this.s.combo;
      this._gain(burst); this.emit('burst', { combo: this.s.combo, burst });
    }
    // Small chance to trigger a station surge on fever burst or crit
    if (!this.s.activeSurge && (burst > 0 || (crit && this.rng() < 0.25))) {
      this.triggerSurge();
    }
    this.emit('click', { gain, crit, combo: this.s.combo });
    return { gain: gain + burst, crit, burst };
  }
  _gain(v) { this.s.stardust += v; this.s.lifetime += v; this.s.runStardust += v; for (const c of this.s.contracts) if (c.need === 'stardust') c.progress = Math.min(c.target, (c.progress || 0) + v); }
  _damageWave(dmg) {
    if (dmg <= 0) return;
    this.s.waveHp -= dmg;
    let clearsThisTick = 0;
    while (this.s.waveHp <= 0 && clearsThisTick < 3) {
      clearsThisTick++;
      const boss = this.s.wave % 10 === 0;
      const credits = Math.min(60, Math.floor((6 + this.s.wave * 0.75) * (boss ? 4 : 1)));
      this.s.credits += credits; this.s.wavesCleared++;
      if (boss) {
        if (this.s.warp < 20) this.s.warp += 1;
        if (this.s.rep < 500) this.s.rep += 1;
      }
      for (const c of this.s.contracts) if (c.need === 'waves') c.progress = Math.min(c.target, (c.progress || 0) + 1);
      this.emit('wave-clear', { wave: this.s.wave, boss, credits });
      this.s.wave++; this.s.waveMaxHp = Math.floor(15 * Math.pow(1.35, Math.min(50, this.s.wave - 1))); this.s.waveHp += this.s.waveMaxHp;
    }
    if (this.s.waveHp <= 0) {
      this.s.waveHp = this.s.waveMaxHp;
    }
  }
  genCost(g, qty = 1) { const owned = this.s.gens[g.id] || 0; let total = 0; for (let i = 0; i < qty; i++) total += Math.ceil(g.cost * Math.pow(1.15, owned + i)); return total; }
  maxAffordable(g) { let qty = 0, budget = this.s.stardust; while (qty < 1000) { const c = Math.ceil(g.cost * Math.pow(1.15, (this.s.gens[g.id] || 0) + qty)); if (c > budget) break; budget -= c; qty++; } return qty; }
  buyGenerator(id, qty = 1) { const g = GEN_BY_ID[id]; if (!g) return false; if (qty === 'max') qty = this.maxAffordable(g); qty = Math.max(1, Math.floor(qty)); const cost = this.genCost(g, qty); if (this.s.stardust < cost) return false; this.s.stardust -= cost; this.s.gens[id] = (this.s.gens[id] || 0) + qty; this.emit('buy', { id, qty }); return true; }
  buyUpgrade(id) { const u = UPGRADES.find(x => x.id === id); if (!u || this.s.upgrades.includes(id) || !this.canAfford(u.cost, u.curr) || !(u.req?.(this) ?? true)) return false; this._pay(u.cost, u.curr); this.s.upgrades.push(id); return true; }
  canAfford(cost, curr = 'stardust') { return n(this.s[curr]) >= cost; }
  _pay(cost, curr = 'stardust') { this.s[curr] = Math.max(0, n(this.s[curr]) - cost); }
  collapseCore() { if (this.s.core < this.coreMax()) return 0; const payout = Math.max(100, this.productionPerSec() * 120 + this.clickPower() * 50) * this._mults().core; this.s.core = 0; this.s.collapses++; this._gain(payout); for (const c of this.s.contracts) if (c.need === 'collapses') c.progress = Math.min(c.target, (c.progress || 0) + 1); this.emit('collapse', { payout }); return payout; }
  useBomb() { if (this.s.ores.bomb < 5) return 0; this.s.ores.bomb -= 5; this.s.stats.bombsUsed++; const payout = Math.max(50, this.productionPerSec() * 60 + this.clickPower() * 25); this._gain(payout); this._damageWave(this.s.waveMaxHp * 0.35); return payout; }
  useSnake() { if (this.s.ores.snake < 5) return 0; this.s.ores.snake -= 5; this.s.stats.snakesUsed++; for (const k of Object.keys(this.s.ores)) this.s.ores[k] += 4; const payout = Math.max(40, this.clickPower() * 30); this._gain(payout); return payout; }
  clickGolden() { const payout = Math.max(50, this.productionPerSec() * 90 + this.clickPower() * 40); this._gain(payout); this.s.stats.goldenClicked++; this.s.goldenAt = 0; return payout; }
  /** Cross-resource exchange with the main game: burn stardust, bank station resources (synced to MetaState by the hub). */
  convertStardust() { if (this.s.stardust < 500) return null; this.s.stardust -= 500; this.s.credits += 50; this.s.minerals += 20; return { credits: 50, minerals: 20 }; }

  // economy: reuse the game's daily market + refinery math
  prices() { return marketPrices({ effects: { marketSellBonus: this._mults().sell - 1 } }); }
  sellOre(color, amount = 10) { const good = Object.values(this.prices()).find(p => p.color === color); if (!good) return 0; const qty = Math.min(amount, Math.floor(this.s.ores[color] || 0)); if (qty <= 0) return 0; this.s.ores[color] -= qty; const gain = qty * good.sell; this.s.credits += gain; return gain; }
  refine(color, amount = 99999) { const q = refineQuote({ color, amount, held: this.s.ores[color] || 0, effects: { mineralYieldMultiplier: this._mults().refine } }); if (!q.ok) return q; this.s.ores[color] -= q.consumed; this.s.minerals += q.minerals; return q; }
  refineAll() { let total = 0; for (const c of Object.keys(this.s.ores)) total += this.refine(c).minerals || 0; return total; }

  startResearch(id) { const r = RESEARCH.find(x => x.id === id); if (!r || this.s.researchDone.includes(id) || this.s.researchActive) return false; if (this.s.credits < r.cost.credits || this.s.minerals < r.cost.minerals) return false; this.s.credits -= r.cost.credits; this.s.minerals -= r.cost.minerals; this.s.researchActive = { id, endsAt: this.now() + r.sec * 1000 }; return true; }
  chartSector(id) { const sec = SECTORS.find(x => x.id === id); if (!sec || this.s.sectors.includes(id) || this.s.warp < sec.warp || this.s.rep < sec.rep) return false; this.s.warp -= sec.warp; this.s.sectors.push(id); return true; }
  buyShip(id) { const sh = SHIPS.find(x => x.id === id); if (!sh || this.s.ships.includes(id) || this.s.credits < sh.cost) return false; this.s.credits -= sh.cost; this.s.ships.push(id); return true; }
  hireCrew(id) { const c = CREW.find(x => x.id === id); if (!c || this.s.crew.includes(id) || this.s.credits < c.cost) return false; this.s.credits -= c.cost; this.s.crew.push(id); return true; }

  _rollContracts(forceDaily = false) {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const pool = CONTRACT_TEMPLATES.filter(t => !t.daily);
    const picks = [...pool].sort(() => this.rng() - 0.5).slice(0, 3);
    this.s.contracts = picks.map((t, i) => ({ uid: ++this.s.contractSeq, ...t, target: CONTRACT_SCALE[t.need][Math.min(2, Math.floor(this.starLevel() / 3))] || CONTRACT_SCALE[t.need][0], progress: 0 }));
    if (this.s.lastDaily !== today || forceDaily) { const d = CONTRACT_TEMPLATES.find(t => t.daily); this.s.contracts.unshift({ uid: ++this.s.contractSeq, ...d, target: 2500 * this.starLevel(), progress: 0 }); this.s.lastDaily = today; }
    for (const c of this.s.contracts) if (c.need === 'clicks') c.baseline = this.s.clicksRun || 0;
  }
  claimContract(uid) { const i = this.s.contracts.findIndex(c => c.uid === uid); if (i < 0) return null; const c = this.s.contracts[i]; const targetProgress = c.need === 'clicks' ? this.s.clicksRun - (c.baseline || 0) : c.progress; if ((c.need === 'clicks' ? targetProgress : c.progress) < c.target) return null; const r = c.reward; this.s.credits += r.credits || 0; this.s.minerals += r.minerals || 0; this.s.warp += r.warp || 0; this.s.rep += r.rep || 3; this.s.contracts.splice(i, 1); this._rollOne(); this.emit('contract', c); return r; }
  _rollOne() { const pool = CONTRACT_TEMPLATES.filter(t => !t.daily && !this.s.contracts.some(c => c.id === t.id)); if (!pool.length) return; const t = pool[Math.floor(this.rng() * pool.length)]; const c = { uid: ++this.s.contractSeq, ...t, target: CONTRACT_SCALE[t.need][Math.min(2, Math.floor(this.starLevel() / 3))], progress: 0 }; if (t.need === 'clicks') c.baseline = this.s.clicksRun; this.s.contracts.push(c); }

  darkMatterOnSupernova() { return Math.max(0, Math.floor(Math.cbrt((this.s.runStardust || 0) / 50000))); }
  supernova() {
    const dm = this.darkMatterOnSupernova();
    if (dm < 1) return 0;
    const keep = {
      darkMatter: this.s.darkMatter + dm,
      prestigeUpgrades: this.s.prestigeUpgrades,
      stats: { ...this.s.stats, supernovas: this.s.stats.supernovas + 1 },
      lifetime: this.s.lifetime,
      crew: [],
      ships: [],
      sectors: this.s.sectors,
      researchDone: this.s.researchDone,
      lastDaily: this.s.lastDaily,
    };
    const fresh = starter();
    Object.assign(fresh, keep);
    const startBonus = PRESTIGE_UPGRADES.filter(u => keep.prestigeUpgrades.includes(u.id)).reduce((a, u) => a + (u.mult.start || 0), 0);
    fresh.stardust = startBonus;

    // BIGGEST RESOURCE GAIN AFTER SUPERNOVA PRESTIGE EVENT:
    // Millions of players' favorite idle moment: giant prestige windfall directly into station economy!
    const bountyCredits = 5000 * dm + Math.floor(Math.sqrt(this.s.runStardust || 0) * 8);
    const bountyMinerals = 1200 * dm + Math.floor(Math.sqrt(this.s.runStardust || 0) * 2);
    const bountyWarp = 3 * dm;
    const bountyRep = 15 * dm;
    fresh.credits = (this.s.credits || 0) + bountyCredits;
    fresh.minerals = (this.s.minerals || 0) + bountyMinerals;
    fresh.warp = (this.s.warp || 0) + bountyWarp;
    fresh.rep = (this.s.rep || 0) + bountyRep;

    this.s = fresh;
    this._rollContracts();
    this.emit('supernova', { dm, bounty: { credits: bountyCredits, minerals: bountyMinerals, warp: bountyWarp, rep: bountyRep } });
    return dm;
  }
  buyPrestige(id) { const u = PRESTIGE_UPGRADES.find(x => x.id === id); if (!u || this.s.prestigeUpgrades.includes(id) || this.s.darkMatter < u.cost) return false; this.s.darkMatter -= u.cost; this.s.prestigeUpgrades.push(id); return true; }

  triggerSurge(forcedId = null) {
    const template = forcedId
      ? STATION_SURGES.find(s => s.id === forcedId)
      : STATION_SURGES[Math.floor(this.rng() * STATION_SURGES.length)];
    if (!template) return null;
    const now = this.now();
    const surge = {
      ...template,
      startedAt: now,
      expiresAt: now + template.durationSec * 1000,
    };
    this.s.activeSurge = surge;
    this.s.nextSurgeAt = surge.expiresAt + (55 + this.rng() * 45) * 1000;
    this.emit('surge-start', surge);
    return surge;
  }

  getActiveSurge(now = this.now()) {
    if (!this.s.activeSurge) return null;
    if (now >= this.s.activeSurge.expiresAt) {
      this.s.activeSurge = null;
      return null;
    }
    const remainingSec = Math.max(0, Math.ceil((this.s.activeSurge.expiresAt - now) / 1000));
    return { ...this.s.activeSurge, remainingSec };
  }

  // ---- merged hub wallet (ADR-0014) ----
  // The clicker adopts the station wallet as its own: credits, minerals,
  // warp, reputation and the ore hold ARE MetaState's, so generators and
  // Defense waves pay into the same economy the hub tabs spend from.
  adoptWallet({ credits = 0, minerals = 0, warp = 0, rep = 0, ores = {} } = {}) {
    this.s.credits = n(credits); this.s.minerals = n(minerals); this.s.warp = n(warp); this.s.rep = n(rep);
    for (const k of Object.keys(this.s.ores)) this.s.ores[k] = n(ores[k]);
    this._synced = this._walletFloors();
  }
  _walletFloors() {
    const ores = {}; for (const k of Object.keys(this.s.ores)) ores[k] = Math.floor(this.s.ores[k]);
    return { credits: Math.floor(this.s.credits), minerals: Math.floor(this.s.minerals), warp: Math.floor(this.s.warp), rep: Math.floor(this.s.rep), ores };
  }
  /** Integer wallet deltas since adoptWallet()/last call; advances the sync point. Fractional ore stays in the clicker. */
  walletDeltas() {
    if (!this._synced) { this._synced = this._walletFloors(); return { credits: 0, minerals: 0, warp: 0, rep: 0, ores: {} }; }
    const cur = this._walletFloors(); const d = { credits: cur.credits - this._synced.credits, minerals: cur.minerals - this._synced.minerals, warp: cur.warp - this._synced.warp, rep: cur.rep - this._synced.rep, ores: {} };
    for (const k of Object.keys(cur.ores)) { const v = cur.ores[k] - (this._synced.ores[k] || 0); if (v) d.ores[k] = v; }
    this._synced = cur; return d;
  }
  tick(dtSec) {
    if (!(dtSec > 0)) return;
    const now = this.now();
    // Manage active station surges
    if (this.s.activeSurge && now >= this.s.activeSurge.expiresAt) {
      const ended = this.s.activeSurge;
      this.s.activeSurge = null;
      this.s.nextSurgeAt = now + (55 + this.rng() * 45) * 1000;
      this.emit('surge-end', ended);
    }
    if (!this.s.activeSurge && (!this.s.nextSurgeAt || now >= this.s.nextSurgeAt)) {
      this.triggerSurge();
    }

    const pps = this.productionPerSec();
    if (pps) this._gain(pps * dtSec);
    const ore = this.orePerSec(); for (const [k, v] of Object.entries(ore)) this.s.ores[k] += v * dtSec;
    for (const g of GENERATORS) if (g.coreRate && this.s.gens[g.id]) this.s.core = Math.min(this.coreMax(), this.s.core + g.coreRate * (this.s.gens[g.id]) * dtSec / 10);
    if (this.s.gens.drone) this.s.core = Math.min(this.coreMax(), this.s.core + (this.s.gens.drone) * dtSec / 20);
    const dps = (this.s.gens.turret || 0) * 6 * (this._mults().gen.turret || 1) * this._mults().dps;
    if (dps) this._damageWave(dps * dtSec);
    if (now > this.s.comboExpiresAt) this.s.combo = 0;
    const ra = this.s.researchActive;
    if (ra && now >= ra.endsAt) { this.s.researchDone.push(ra.id); this.s.researchActive = null; this.emit('research-done', ra); }
    if (!this.s.goldenAt) this.s.goldenAt = now + GOLDEN_STAR_EVERY_SEC * 1000 * (0.7 + this.rng() * 0.6);
  }
  applyOffline(nowMs = this.now()) {
    const elapsed = clamp((nowMs - (this.s.lastSeen || nowMs)) / 1000, 0, this._mults().offline ? OFFLINE_CAP_SEC * 2 : OFFLINE_CAP_SEC);
    if (elapsed < 60) { this.s.lastSeen = nowMs; return null; }
    const rate = this._mults().offline ? 0.75 : 0.5;
    const gain = this.productionPerSec() * elapsed * rate;
    // simulate at 50-75% without looping per second: gain + wave estimate
    if (gain > 0) this._gain(gain);
    const ore = this.orePerSec(); for (const [k, v] of Object.entries(ore)) this.s.ores[k] += v * elapsed * rate;
    this.s.stats.offlineClaimed += gain; this.s.lastSeen = nowMs;
    this.offlineReport = { seconds: elapsed, stardust: gain, rate };
    return this.offlineReport;
  }
  touch() { this.s.lastSeen = this.now(); }
}
export { CONTRACT_TEMPLATES };
