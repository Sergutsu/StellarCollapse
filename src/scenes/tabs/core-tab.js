// StellarCoreTab (ADR-0014) — the clicker/idle layer, merged INTO the hub.
//
// The old interface stays exactly as it was (missions you fly yourself,
// idle dispatch, market, research, crew, shipyard, star map). This tab adds
// the clicker core beside them, sharing ONE wallet: generator/wave/contract
// output lands in MetaState credits/minerals/warp/ores/reputation — the same
// balances the other tabs spend — and completed research + charted sectors
// feed back as a production multiplier here.
//
//   CLICK THE STAR (old click-match) · generators (Auto-Match / falling
//   pieces / Miner / Defense, automated) · CORE COLLAPSE (Miner) ·
//   BOMB / SNAKE (Collapsed specials) · idle Defense WAVES · clicker
//   CONTRACTS · SUPERNOVA prestige (Dark Matter).
//
// Pure rules live in src/clicker-state.js; this file only renders + syncs.
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { panelLabel, buildSimpleButton, drawStarShape } from '../../pixi-ui-kit.js';
import { ClickerState, GENERATORS, UPGRADES, fmt } from '../../clicker-state.js';

const AMBER = 0xfcd34d, CYAN = 0x67e8f9, WHITE = 0xe2e8f0, MUTED = 0x94a3b8, GREEN = 0x6ee7b7, RED = 0xfda4af;
const txt = (text, size, fill, weight = '600') => new Text({ text, style: new TextStyle({ fontFamily: 'Inter, "Segoe UI", sans-serif', fontSize: size, fontWeight: weight, fill }) });

export class StellarCoreTab {
  constructor({ parent, meta }) {
    if (!parent) throw new Error('StellarCoreTab: parent container is required');
    this.parent = parent; this.meta = meta;
    this.root = new Container(); this.root.visible = false; this.parent.addChild(this.root);
    this.game = new ClickerState(meta?.getClickerSave?.() || null);
    this._adoptWallet();
    this._offline = this.game.applyOffline();
    this.buyQty = 1; this._nodes = null; this._refreshAt = 0; this._saveAt = 0; this._floatT = 0;
    this._status = this._offline ? `Welcome back — the core produced ${fmt(this._offline.stardust)} ✦ while you were away.` : 'Click the star. Generators do the rest — even the old Defense waves.';
  }
  get visible() { return !!this.root.visible; }
  _adoptWallet() {
    if (!this.meta) return;
    this.game.adoptWallet({ credits: this.meta.credits, minerals: this.meta.getHubResource('minerals'), warp: this.meta.getHubResource('warp'), rep: this.meta.reputation, ores: this.meta.oreCounts() });
  }
  _syncWallet() {
    if (!this.meta) return;
    const d = this.game.walletDeltas();
    if (d.credits) this.meta.addCredits(d.credits);
    if (d.minerals) this.meta.setHubResource('minerals', Math.max(0, (this.meta.getHubResource('minerals') || 0) + d.minerals));
    if (d.warp) this.meta.setHubResource('warp', Math.max(0, (this.meta.getHubResource('warp') || 0) + d.warp));
    if (d.rep) this.meta.addReputation(d.rep);
    for (const [c, v] of Object.entries(d.ores)) this.meta.addOre(c, v);
  }
  _stationMult() {
    if (!this.meta) return 1;
    const research = this.meta.getResearchState?.().completed?.length || 0;
    const sectors = this.meta.discoveredSectorIds?.().length || 0;
    return 1 + research * 0.05 + sectors * 0.10;
  }
  show() { if (!this._nodes) this._build(); this._adoptWallet(); this._refresh(); this.root.visible = true; }
  hide() { this.root.visible = false; this._save(); }
  layout(screen) { if (!screen) return; const w = screen.width || 0, h = screen.height || 0; if (w > 0 && h > 0) { const s = Math.min(1, w / 780, h / 640); this.root.scale.set(Math.max(0.5, s)); } }
  destroy() { this._save(); if (this.root) this.root.destroy({ children: true }); this.root = null; this._nodes = null; }
  _save() { if (this.meta?.saveClickerState) { this.game.touch(); this.meta.saveClickerState(this.game.snapshot()); } }

  tick(deltaMs) {
    if (!this.game) return;
    this.game.externalMult = this._stationMult();
    this.game.tick(Math.min(5, (deltaMs || 0) / 1000));
    this._syncWallet();
    const now = Date.now();
    if (this._floatT > 0 && this._nodes) { this._floatT -= deltaMs; this._nodes.floatText.alpha = Math.max(0, this._floatT / 900); this._nodes.floatText.y -= deltaMs * 0.04; }
    if (now - this._saveAt > 5000) { this._saveAt = now; this._save(); }
    if (this.root.visible && now - this._refreshAt > 250) { this._refreshAt = now; this._refresh(); }
  }

  _build() {
    const n = { genRows: [], upRows: [], contractRows: [] };
    const title = panelLabel('STELLAR CORE — CLICKER / IDLE', AMBER, { size: 15, weight: '800' }); title.position.set(16, 10); this.root.addChild(title);
    n.wallet = txt('', 11, CYAN); n.wallet.position.set(16, 34); this.root.addChild(n.wallet);

    // --- the star (old click-match) ---
    const starWrap = new Container(); starWrap.position.set(130, 128); starWrap.eventMode = 'static'; starWrap.cursor = 'pointer';
    const star = drawStarShape(62, 0xfacc15); starWrap.addChild(star); this.root.addChild(starWrap);
    starWrap.on('pointertap', () => { const r = this.game.clickStar(); this._float(`+${fmt(r.gain)}${r.crit ? ' CRIT!' : ''}`); this._syncWallet(); this._refresh(); });
    n.starWrap = starWrap;
    n.floatText = txt('', 16, AMBER, '800'); n.floatText.alpha = 0; n.floatText.position.set(80, 60); this.root.addChild(n.floatText);
    n.combo = txt('', 11, RED, '700'); n.combo.position.set(46, 202); this.root.addChild(n.combo);
    n.status = txt('', 10, MUTED); n.status.position.set(16, 224); this.root.addChild(n.status);

    // core + specials + waves (Miner / Collapsed / Defense)
    n.coreLabel = txt('', 11, WHITE, '700'); n.coreLabel.position.set(16, 252); this.root.addChild(n.coreLabel);
    n.coreBar = new Graphics(); n.coreBar.position.set(16, 272); this.root.addChild(n.coreBar);
    const mk = (label, y, fn) => { const b = buildSimpleButton({ text: label, width: 232, height: 28, accent: 'amber', onTap: () => { fn(); this._syncWallet(); this._refresh(); } }); b.container.position.set(16, y); this.root.addChild(b.container); return b; };
    n.collapseBtn = mk('⬢ COLLAPSE CORE', 282, () => { const p = this.game.collapseCore(); if (p) this._status = `⬢ CORE COLLAPSE! +${fmt(p)} ✦ (paid into the core)`; });
    n.bombBtn = mk('💣 BOMB BLAST (5 bomb ore)', 316, () => { const p = this.game.useBomb(); if (p) this._status = `💣 Bomb blast +${fmt(p)} ✦`; });
    n.snakeBtn = mk('🐍 SNAKE CHAIN (5 snake ore)', 350, () => { const p = this.game.useSnake(); if (p) this._status = `🐍 Snake chain +${fmt(p)} ✦ and +4 of every ore`; });
    n.waveLabel = txt('', 11, WHITE, '700'); n.waveLabel.position.set(16, 388); this.root.addChild(n.waveLabel);
    n.waveBar = new Graphics(); n.waveBar.position.set(16, 408); this.root.addChild(n.waveBar);
    n.prestige = txt('', 10, MUTED); n.prestige.position.set(16, 432); this.root.addChild(n.prestige);
    n.supernovaBtn = mk('💥 SUPERNOVA', 470, () => { const dm = this.game.supernova(); if (dm) { this._status = `💥 SUPERNOVA! +${dm} 🌑 Dark Matter — run reset, keep the power.`; this._adoptWallet(); } });
    const note = txt('Research & charted sectors boost this\ncore. MARKET sells its ore. Missions\nstill fly from the MISSIONS tab.', 10, MUTED);
    note.position.set(16, 512); this.root.addChild(note);

    // --- generators (right column) ---
    const gx = 272;
    const gh = panelLabel('GENERATORS — the old minigames, automated', CYAN, { size: 12, weight: '800' }); gh.position.set(gx, 34); this.root.addChild(gh);
    const qtyBtns = [1, 10, 100].map((q, i) => { const b = buildSimpleButton({ text: `×${q}`, width: 52, height: 22, onTap: () => { this.buyQty = q; this._refresh(); } }); b.container.position.set(gx + i * 58, 56); this.root.addChild(b.container); return b; });
    n.qtyBtns = qtyBtns;
    GENERATORS.forEach((g, i) => {
      const y = 86 + i * 40;
      const name = txt(`${g.icon} ${g.name}`, 11, WHITE, '700'); name.position.set(gx, y); this.root.addChild(name);
      const sub = txt('', 9, MUTED); sub.position.set(gx, y + 14); this.root.addChild(sub);
      const b = buildSimpleButton({ text: 'BUY', width: 104, height: 30, accent: 'green', onTap: () => { if (this.game.buyGenerator(g.id, this.buyQty)) this._status = `${g.name} online.`; this._refresh(); } });
      b.container.position.set(gx + 356, y); this.root.addChild(b.container);
      n.genRows.push({ g, name, sub, btn: b });
    });
    // upgrades (up to 4 visible)
    const uh = panelLabel('UPGRADES', CYAN, { size: 12, weight: '800' }); uh.position.set(gx, 412); this.root.addChild(uh);
    for (let i = 0; i < 4; i++) {
      const y = 436 + i * 34;
      const name = txt('', 10, WHITE, '700'); name.position.set(gx, y); this.root.addChild(name);
      const b = buildSimpleButton({ text: 'BUY', width: 104, height: 26, accent: 'magenta', onTap: () => { const u = this._visibleUpgrades()[i]; if (u && this.game.buyUpgrade(u.id)) this._status = `${u.name} installed.`; this._refresh(); } });
      b.container.position.set(gx + 356, y); this.root.addChild(b.container);
      n.upRows.push({ name, btn: b });
    }
    // contracts
    const ch = panelLabel('CORE CONTRACTS — pay into the shared wallet', CYAN, { size: 12, weight: '800' }); ch.position.set(gx, 578); this.root.addChild(ch);
    // contracts sit under upgrades if room allows; rows are compact and rebuilt by _refresh text
    for (let i = 0; i < 3; i++) {
      const y = 600 + i * 0; // placeholder positions corrected in _layoutContracts
      const name = txt('', 9, MUTED); name.position.set(gx, y); name.visible = false; this.root.addChild(name);
      n.contractRows.push({ name, btn: null });
    }
    n.contractsLabel = txt('', 9, MUTED); n.contractsLabel.position.set(gx, 578); this.root.addChild(n.contractsLabel);
    ch.visible = false;
    this._nodes = n;
  }
  _visibleUpgrades() { return UPGRADES.filter(u => !this.game.s.upgrades.includes(u.id) && (u.req?.(this.game) ?? true)).slice(0, 4); }
  _float(text) { const n = this._nodes; if (!n) return; n.floatText.text = text; n.floatText.alpha = 1; n.floatText.position.set(78, 66); this._floatT = 900; }
  _bar(g, w, frac, color) { g.clear(); g.rect(0, 0, w, 10).fill({ color: 0x020617 }); g.rect(0, 0, Math.max(0, Math.min(1, frac)) * w, 10).fill({ color }); }
  _refresh() {
    const n = this._nodes; if (!n) return; const s = this.game.s;
    n.wallet.text = `✦ ${fmt(s.stardust)} stardust · ${fmt(this.game.productionPerSec())}/s · 👆 ${fmt(this.game.clickPower())} · ⭐ Lv ${this.game.starLevel()} · 🌑 ${fmt(s.darkMatter)}`;
    n.combo.text = s.combo > 1 ? `🔥 COMBO ×${this.game.comboMult().toFixed(2)} (${s.combo})` : 'Click fast: combo multiplies every click';
    n.status.text = this._status.slice(0, 58);
    n.coreLabel.text = `⬢ CORE ${Math.floor(s.core)}% (Miner drones fill it)`;
    this._bar(n.coreBar, 232, s.core / 100, 0x38bdf8);
    n.waveLabel.text = `🛡 Defense wave ${s.wave}${s.wave % 10 === 0 ? ' 👹 BOSS' : ''} · cleared ${s.wavesCleared}`;
    this._bar(n.waveBar, 232, s.waveMaxHp ? s.waveHp / s.waveMaxHp : 0, 0xf87171);
    const dm = this.game.darkMatterOnSupernova();
    n.prestige.text = `Supernova ready: +${dm} 🌑\n(resets stardust/generators;\nkeeps Dark Matter & station)`;
    n.genRows.forEach(({ g, name, sub, btn }) => {
      const owned = s.gens[g.id] || 0; const cost = this.game.genCost(g, this.buyQty);
      name.text = `${g.icon} ${g.name}  ×${owned}`;
      sub.text = `${g.blurb} · ${fmt(this.game.genRate(g))}/s`;
      btn.label.text = `BUY ×${this.buyQty} · ${fmt(cost)}✦`;
    });
    const ups = this._visibleUpgrades();
    n.upRows.forEach((row, i) => { const u = ups[i]; row.name.visible = !!u; row.btn.container.visible = !!u; if (u) { row.name.text = `${u.icon} ${u.name} — ${u.desc}`; row.btn.label.text = `${fmt(u.cost)} ${u.curr}`; } });
    const cs = s.contracts.slice(0, 3).map(c => { const p = c.need === 'clicks' ? this.game.s.clicksRun - (c.baseline || 0) : (c.progress || 0); return `${c.icon} ${c.name}: ${fmt(Math.min(p, c.target))}/${fmt(c.target)}${p >= c.target ? ' — CLAIM on click!' : ''}`; });
    n.contractsLabel.text = ['CORE CONTRACTS — completed contracts auto-pay into the wallet:', ...cs].join('\n');
    // Auto-claim completed contracts into the shared wallet — idle-game friendly.
    for (const c of [...s.contracts]) { const p = c.need === 'clicks' ? s.clicksRun - (c.baseline || 0) : (c.progress || 0); if (p >= c.target) { const r = this.game.claimContract(c.uid); if (r) { this._status = `📋 Contract "${c.name}" auto-paid: ${Object.entries(r).map(([k, v]) => `+${v} ${k}`).join(' ')}`; this._syncWallet(); } } }
  }
}
