// StellarCoreTab (ADR-0014) — the clicker/idle layer, merged INTO the hub.
//
// Layout (uses all three hub columns, like every other tab):
//   LEFT bay   (CORE ACTIONS) — Collapse / Bomb / Snake / Trade / Supernova,
//              core contracts, dark matter, status line.
//   CENTER     — the star itself, big and centered: click it (old click-
//              match with combo, CRITs, Click Mastery tiers and FEVER
//              bursts at 25/50/100 combo), stardust + production readouts,
//              Core and Defense-wave progress bars, next upgrades.
//   RIGHT bay  (GENERATORS) — the eight automated minigames with buy
//              buttons and a x1/x10/x100 toggle.
//
// One wallet: everything earned lands in MetaState (credits / minerals /
// warp / ores / reputation) via adoptWallet/walletDeltas; station research,
// charted sectors and completed missions multiply core production. Pure
// rules live in src/clicker-state.js — this file only renders + syncs.
import { Container, Graphics, Text, TextStyle, Circle } from 'pixi.js';
import { panelLabel, buildSimpleButton, drawStarShape } from '../../pixi-ui-kit.js';
import { ClickerState, GENERATORS, UPGRADES, fmt } from '../../clicker-state.js';

const AMBER = 0xfcd34d, CYAN = 0x67e8f9, WHITE = 0xf1f5f9, MUTED = 0xa8bedd, GREEN = 0x6ee7b7, RED = 0xfb7185, PURPLE = 0xc4b5fd;
const txt = (text, size, fill, weight = '600') => new Text({ text, style: new TextStyle({ fontFamily: 'Inter, "Segoe UI", sans-serif', fontSize: size, fontWeight: weight, fill, wordWrap: false }) });
const ORE_ICON = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', bomb: '💣', snake: '🐍' };

export class StellarCoreTab {
  constructor({ parent, meta, side = null, right = null }) {
    if (!parent) throw new Error('StellarCoreTab: parent container is required');
    this.parent = parent; this.meta = meta;
    this.usesSidePanel = true; this.sidePanelTitle = '⚡ CORE ACTIONS';
    this.usesRightPanel = true; this.rightPanelTitle = '🏭 GENERATORS';
    this.root = new Container(); this.root.visible = false; this.parent.addChild(this.root);
    this._sideList = side?.list || null; this._rightList = right?.list || null;
    this.game = new ClickerState(meta?.getClickerSave?.() || null);
    this._adoptWallet();
    this._offline = this.game.applyOffline();
    this.game.on('burst', ({ combo, burst }) => { this._status = `🔥 FEVER BURST ×${combo} combo! +${fmt(burst)} ✦`; this._float(`🔥 +${fmt(burst)}`); });
    this.buyQty = 1; this._nodes = null; this._refreshAt = 0; this._saveAt = 0; this._animMs = 0; this._popMs = 0; this._w = 600; this._h = 520;
    this._status = this._offline ? `👋 Welcome back — the core made ${fmt(this._offline.stardust)} ✦ while you were away.` : '⭐ Click the star! Fast clicks build combo → FEVER bursts.';
  }
  get visible() { return !!(this.root && this.root.visible); }

  _adoptWallet() { if (this.meta) this.game.adoptWallet({ credits: this.meta.credits, minerals: this.meta.getHubResource('minerals'), warp: this.meta.getHubResource('warp'), rep: this.meta.reputation, ores: this.meta.oreCounts() }); }
  _syncWallet() {
    if (!this.meta) return; const d = this.game.walletDeltas();
    if (d.credits) this.meta.addCredits(d.credits);
    if (d.minerals) this.meta.setHubResource('minerals', Math.max(0, (this.meta.getHubResource('minerals') || 0) + d.minerals));
    if (d.warp) this.meta.setHubResource('warp', Math.max(0, (this.meta.getHubResource('warp') || 0) + d.warp));
    if (d.rep) this.meta.addReputation(d.rep);
    for (const [c, v] of Object.entries(d.ores)) this.meta.addOre(c, v);
  }
  _stationMult() {
    if (!this.meta) return 1;
    return 1 + (this.meta.getResearchState?.().completed?.length || 0) * 0.05
             + (this.meta.discoveredSectorIds?.().length || 0) * 0.10
             + (this.meta.getStats?.().missionsCompleted || 0) * 0.02;
  }
  show() { if (!this._nodes) this._build(); this._adoptWallet(); if (this._nodes) { this._nodes.sideBox.visible = true; this._nodes.rightBox.visible = true; } this._refresh(); this.root.visible = true; }
  hide() { this.root.visible = false; if (this._nodes) { this._nodes.sideBox.visible = false; this._nodes.rightBox.visible = false; } this._save(); }
  layout(screen) { if (!screen) return; const w = screen.width || 0, h = screen.height || 0; if (w > 0 && h > 0) { this._w = w; this._h = h; this._layoutCenter(); } }
  // The hub hides all bay children, then calls these on the new owner —
  // so this is where bay content becomes visible and sizes responsively.
  layoutSide({ width = 276, height = 420 } = {}) {
    this._sideW = width; this._sideH = height;
    const n = this._nodes; if (!n) return;
    n.sideBox.visible = true;
    const innerW = Math.max(180, width - 24);

    n.status.style.wordWrap = true;
    n.status.style.wordWrapWidth = innerW;
    n.status.position.set(0, 0);

    const btnH = 36;
    let y = 38;
    n.collapseBtn.resize(innerW, btnH);
    n.collapseBtn.container.position.set(0, y); y += btnH + 8;

    n.bombBtn.resize(innerW, btnH);
    n.bombBtn.container.position.set(0, y); y += btnH + 8;

    n.snakeBtn.resize(innerW, btnH);
    n.snakeBtn.container.position.set(0, y); y += btnH + 8;

    n.tradeBtn.resize(innerW, btnH);
    n.tradeBtn.container.position.set(0, y); y += btnH + 8;

    n.prestige.style.wordWrap = true;
    n.prestige.style.wordWrapWidth = innerW;
    n.prestige.position.set(0, y);
    y += 46;

    n.supernovaBtn.resize(innerW, btnH);
    n.supernovaBtn.container.position.set(0, y); y += btnH + 10;

    n.contractHeader.position.set(0, y); y += 22;
    n.contracts.style.wordWrap = true;
    n.contracts.style.wordWrapWidth = innerW;
    n.contracts.position.set(0, y);
  }
  layoutRight({ width = 276, height = 420 } = {}) {
    this._rightW = width; this._rightH = height;
    const n = this._nodes; if (!n) return;
    n.rightBox.visible = true;
    const innerW = Math.max(180, width - 24);

    const qCount = 3;
    const qGap = 6;
    const qW = Math.floor((innerW - (qCount - 1) * qGap) / qCount);
    [1, 10, 100].forEach((q, i) => {
      const b = n['qty' + q];
      b.resize(qW, 28);
      b.container.position.set(i * (qW + qGap), 0);
    });

    const wideMode = innerW >= 340;
    if (wideMode) {
      const btnW = Math.min(220, Math.max(140, Math.floor(innerW * 0.42)));
      const infoW = innerW - btnW - 12;
      GENERATORS.forEach((g, i) => {
        const row = n.genRows[i];
        const y = 38 + i * 50;
        row.icon.position.set(0, y + 2);
        row.name.position.set(28, y);
        row.name.style.wordWrap = true;
        row.name.style.wordWrapWidth = infoW;
        row.sub.position.set(28, y + 18);
        row.sub.style.wordWrap = true;
        row.sub.style.wordWrapWidth = infoW;
        row.btn.resize(btnW, 30);
        row.btn.container.position.set(innerW - btnW, y + 6);
      });
    } else {
      GENERATORS.forEach((g, i) => {
        const row = n.genRows[i];
        const y = 36 + i * 62;
        row.icon.position.set(0, y);
        row.name.position.set(28, y);
        row.name.style.wordWrap = true;
        row.name.style.wordWrapWidth = innerW - 30;
        row.sub.position.set(28, y + 16);
        row.sub.style.wordWrap = true;
        row.sub.style.wordWrapWidth = innerW - 30;
        row.btn.resize(innerW, 26);
        row.btn.container.position.set(0, y + 33);
      });
    }
  }
  destroy() { if (this.root) this.root.destroy({ children: true }); this.root = null; this._nodes = null; }
  _save() { if (this.meta?.saveClickerState) { this.game.touch(); this.meta.saveClickerState(this.game.snapshot()); } }

  tick(deltaMs) {
    if (!this.game) return;
    this._animMs += deltaMs || 0;
    this.game.externalMult = this._stationMult();
    this.game.tick(Math.min(5, (deltaMs || 0) / 1000));
    this._syncWallet();
    const now = Date.now();
    if (now - this._saveAt > 5000) { this._saveAt = now; this._save(); }
    if (this._nodes && this.root.visible) this._animate();
    if (this.root.visible && now - this._refreshAt > 250) { this._refreshAt = now; this._refresh(); }
  }
  _animate() {
    const n = this._nodes; if (!n) return; const t = this._animMs / 1000;
    this._popMs = Math.max(0, this._popMs - 16);
    const pop = 1 + (this._popMs / 180) * 0.22;
    const baseS = this._starBaseScale || 1;
    n.starWrap.scale.set((1 + Math.sin(t * 2.2) * 0.045) * pop * baseS);
    n.starWrap.rotation = Math.sin(t * 0.9) * 0.06;
    n.orbit.rotation = t * 0.7;
    n.halo.clear(); n.halo.circle(0, 0, (76 + Math.sin(t * 2.2) * 6) * baseS).fill({ color: 0xfacc15, alpha: 0.07 });
    n.floats.forEach(f => { if (f.alpha > 0) { f.y -= 1.6; f.alpha -= 0.016; } });
  }
  _float(text) { const n = this._nodes; if (!n) return; const f = n.floats.find(x => x.alpha <= 0) || n.floats[0]; f.text = text; f.alpha = 1; f.position.set(this._w / 2 - 40 + Math.random() * 50, this._h * 0.30); }

  _build() {
    const n = { genRows: [], upRows: [], floats: [] };
    // ---------- CENTER ----------
    const title = panelLabel('⭐ STELLAR CORE — CLICKER / IDLE', AMBER, { size: 19, weight: '800' }); title.anchor.set(0.5, 0); this.root.addChild(title); n.title = title;
    n.stardust = txt('', 26, WHITE, '800'); n.stardust.anchor.set(0.5, 0); this.root.addChild(n.stardust);
    n.perSec = txt('', 14, CYAN, '700'); n.perSec.anchor.set(0.5, 0); this.root.addChild(n.perSec);
    const starWrap = new Container(); starWrap.eventMode = 'static'; starWrap.cursor = 'pointer';
    starWrap.hitArea = new Circle(0, 0, 115);
    n.halo = new Graphics(); starWrap.addChild(n.halo);
    n.orbit = new Container();
    for (let i = 0; i < 3; i++) { const s = drawStarShape(9, 0x7dd3fc); const a = (i / 3) * Math.PI * 2; s.position.set(Math.cos(a) * 82, Math.sin(a) * 82); n.orbit.addChild(s); }
    starWrap.addChild(n.orbit);
    starWrap.addChild(drawStarShape(60, 0xfacc15));
    starWrap.addChild(drawStarShape(40, 0xfde68a));
    this.root.addChild(starWrap); n.starWrap = starWrap;
    const onStarClick = () => {
      const r = this.game.clickStar();
      this._popMs = 180;
      this._float(r.crit ? `💥 CRIT +${fmt(r.gain)}` : `+${fmt(r.gain)}`);
      this._syncWallet();
      if (this._nodes) {
        this._nodes.stardust.text = `✦ ${fmt(this.game.s.stardust)} STARDUST`;
        this._nodes.combo.text = this.game.s.combo > 1 ? `🔥 COMBO ×${this.game.s.combo} — payout ×${this.game.comboMult().toFixed(2)}` : '👆 Click fast — combo & FEVER bursts!';
      }
    };
    starWrap.on('pointerdown', onStarClick);
    for (let i = 0; i < 6; i++) { const f = txt('', 19, AMBER, '800'); f.alpha = 0; this.root.addChild(f); n.floats.push(f); }
    n.combo = txt('', 17, RED, '800'); n.combo.anchor.set(0.5, 0); this.root.addChild(n.combo);
    n.clickInfo = txt('', 14, WHITE, '700'); n.clickInfo.anchor.set(0.5, 0); this.root.addChild(n.clickInfo);
    n.masteryBar = new Graphics(); this.root.addChild(n.masteryBar);
    n.coreLabel = txt('', 14, WHITE, '700'); this.root.addChild(n.coreLabel);
    n.coreBar = new Graphics(); this.root.addChild(n.coreBar);
    n.waveLabel = txt('', 14, WHITE, '700'); this.root.addChild(n.waveLabel);
    n.waveBar = new Graphics(); this.root.addChild(n.waveBar);
    const uh = panelLabel('⬆ NEXT UPGRADES', CYAN, { size: 14, weight: '800' }); this.root.addChild(uh); n.upHeader = uh;
    for (let i = 0; i < 2; i++) {
      const label = txt('', 13, WHITE, '700'); this.root.addChild(label);
      const b = buildSimpleButton({ text: 'BUY', width: 118, height: 34, accent: 'magenta', onTap: () => { const u = this._visibleUpgrades()[i]; if (u && this.game.buyUpgrade(u.id)) this._status = `⬆ ${u.name} installed!`; this._refresh(); } });
      this.root.addChild(b.container); n.upRows.push({ label, btn: b });
    }

    // ---------- LEFT BAY: actions ----------
    const sideBox = new Container(); sideBox.visible = false; this._sideList?.addChild(sideBox); n.sideBox = sideBox;
    n.status = txt('', 12, MUTED); n.status.style.wordWrap = true; n.status.style.wordWrapWidth = 228; sideBox.addChild(n.status);
    const mkSide = (label, accent, fn) => { const b = buildSimpleButton({ text: label, width: 228, height: 36, accent, onTap: () => { fn(); this._syncWallet(); this._refresh(); } }); sideBox.addChild(b.container); return b; };
    n.collapseBtn = mkSide('⬢ COLLAPSE CORE', 'cyan', () => { const p = this.game.collapseCore(); if (p) this._status = `⬢ CORE COLLAPSE! +${fmt(p)} ✦`; });
    n.bombBtn = mkSide('💣 BOMB BLAST · 5 💣', 'amber', () => { const p = this.game.useBomb(); if (p) this._status = `💣 Bomb blast +${fmt(p)} ✦ + wave damage!`; });
    n.snakeBtn = mkSide('🐍 SNAKE CHAIN · 5 🐍', 'green', () => { const p = this.game.useSnake(); if (p) this._status = `🐍 Snake chain +${fmt(p)} ✦ and +4 of every ore!`; });
    n.tradeBtn = mkSide('🔁 500 ✦ → 50¢ + 20 💎', 'magenta', () => { const r = this.game.convertStardust(); this._status = r ? '🔁 Traded stardust into the station wallet!' : 'Need 500 ✦ to trade.'; });
    n.prestige = txt('', 12, PURPLE); n.prestige.style.wordWrap = true; n.prestige.style.wordWrapWidth = 228; sideBox.addChild(n.prestige);
    n.supernovaBtn = mkSide('💥 SUPERNOVA', 'amber', () => {
      const dm = this.game.supernova();
      if (dm) {
        this._status = `💥 SUPERNOVA! +${dm} 🌑 Dark Matter & HUGE station windfall granted!`;
        this._adoptWallet();
      }
    });
    const ch = panelLabel('📋 CORE CONTRACTS', CYAN, { size: 13, weight: '800' }); sideBox.addChild(ch); n.contractHeader = ch;
    n.contracts = txt('', 12, MUTED); n.contracts.style.wordWrap = true; n.contracts.style.wordWrapWidth = 228; sideBox.addChild(n.contracts);

    // ---------- RIGHT BAY: generators ----------
    const rightBox = new Container(); rightBox.visible = false; this._rightList?.addChild(rightBox); n.rightBox = rightBox;
    [1, 10, 100].forEach((q) => { const b = buildSimpleButton({ text: `BUY ×${q}`, width: 72, height: 28, accent: q === this.buyQty ? 'green' : 'cyan', onTap: () => { this.buyQty = q; this._refresh(); } }); rightBox.addChild(b.container); n['qty' + q] = b; });
    GENERATORS.forEach((g) => {
      const icon = txt(g.icon, 20, WHITE); rightBox.addChild(icon);
      const name = txt('', 13, WHITE, '800'); rightBox.addChild(name);
      const sub = txt('', 11, MUTED); rightBox.addChild(sub);
      const b = buildSimpleButton({ text: 'BUY', width: 228, height: 28, accent: 'green', onTap: () => { if (this.game.buyGenerator(g.id, this.buyQty)) this._status = `${g.icon} ${g.name} online!`; this._refresh(); } });
      rightBox.addChild(b.container);
      n.genRows.push({ g, icon, name, sub, btn: b });
    });
    this._nodes = n;
    this._layoutCenter();
    this.layoutSide({ width: this._sideW || 276, height: this._sideH || 420 });
    this.layoutRight({ width: this._rightW || 276, height: this._rightH || 420 });
  }

  _layoutCenter() {
    const n = this._nodes; if (!n) return; const w = this._w, cx = w / 2;
    const h = this._h;
    const dy = h < 640 ? -36 : 0;
    const wrapW = Math.max(220, w - 40);

    n.title.position.set(cx, 12);
    n.stardust.style.wordWrap = false;
    n.stardust.position.set(cx, 42);

    n.perSec.style.wordWrap = true;
    n.perSec.style.wordWrapWidth = wrapW;
    n.perSec.style.align = 'center';
    n.perSec.position.set(cx, 76);

    const starScale = Math.min(1, Math.max(0.75, Math.min(w / 580, h / 640)));
    this._starBaseScale = starScale;
    n.starWrap.position.set(cx, 188 + dy);

    n.combo.style.wordWrap = true;
    n.combo.style.wordWrapWidth = wrapW;
    n.combo.style.align = 'center';
    n.combo.position.set(cx, 286 + dy);

    n.clickInfo.style.wordWrap = true;
    n.clickInfo.style.wordWrapWidth = wrapW;
    n.clickInfo.style.align = 'center';
    n.clickInfo.position.set(cx, 312 + dy);

    n.masteryBar.position.set(30, 340 + dy);
    n.coreLabel.style.wordWrap = true;
    n.coreLabel.style.wordWrapWidth = wrapW;
    n.coreLabel.style.align = 'left';
    n.coreLabel.position.set(30, 364 + dy);
    n.coreBar.position.set(30, 388 + dy);

    n.waveLabel.style.wordWrap = true;
    n.waveLabel.style.wordWrapWidth = wrapW;
    n.waveLabel.style.align = 'left';
    n.waveLabel.position.set(30, 414 + dy);
    n.waveBar.position.set(30, 438 + dy);

    n.upHeader.position.set(30, 470 + dy);

    const btnW = Math.min(118, Math.max(88, Math.floor(w * 0.22)));
    const labelW = Math.max(140, w - btnW - 80);
    n.upRows.forEach((r, i) => {
      const y = 498 + dy + i * 42;
      r.label.style.wordWrap = true;
      r.label.style.wordWrapWidth = labelW;
      r.label.position.set(30, y + 5);
      r.btn.resize(btnW, 32);
      r.btn.container.position.set(w - btnW - 30, y);
    });

    this._refresh();
  }
  _visibleUpgrades() { return UPGRADES.filter(u => !this.game.s.upgrades.includes(u.id) && (u.req?.(this.game) ?? true)).slice(0, 2); }
  _bar(g, w, frac, color) { g.clear(); g.roundRect(0, 0, w, 16, 6).fill({ color: 0x020617 }); g.roundRect(0, 0, Math.max(4, Math.min(1, frac) * w), 16, 6).fill({ color }); }
  _refresh() {
    const n = this._nodes; if (!n) return; const s = this.game.s, w = this._w;
    n.stardust.text = `✦ ${fmt(s.stardust)} STARDUST`;
    n.perSec.text = `⚡ ${fmt(this.game.productionPerSec())}/s   ·   station boost ×${this._stationMult().toFixed(2)}   ·   ⭐ Lv ${this.game.starLevel()}   ·   🌑 ${fmt(s.darkMatter)}`;
    n.combo.text = s.combo > 1 ? `🔥 COMBO ×${s.combo} — payout ×${this.game.comboMult().toFixed(2)}${s.combo < 25 ? ` · burst at 25!` : ''}` : '👆 Click fast — combo & FEVER bursts at 25/50/100!';
    const tier = this.game.clickTier();
    n.clickInfo.text = `👆 ${fmt(this.game.clickPower())} per click · Mastery Tier ${tier} (+${tier * 50}%) · next tier in ${50 - (s.totalClicks % 50)} clicks`;
    const barW = Math.max(140, w - 60);
    this._bar(n.masteryBar, barW, (s.totalClicks % 50) / 50, 0xfacc15);
    n.coreLabel.text = `⬢ MINER CORE ${Math.floor(s.core)}% — drones fill it, collapse pays big`;
    this._bar(n.coreBar, barW, s.core / 100, 0x38bdf8);
    n.waveLabel.text = `🛡 DEFENSE WAVE ${s.wave}${s.wave % 10 === 0 ? ' 👹 BOSS!' : ''} — ${fmt(Math.max(0, s.waveHp))}/${fmt(s.waveMaxHp)} HP · turrets ${fmt(this.game.dps())} DPS · cleared ${s.wavesCleared}`;
    this._bar(n.waveBar, barW, s.waveMaxHp ? s.waveHp / s.waveMaxHp : 0, 0xfb7185);
    const ups = this._visibleUpgrades();
    n.upRows.forEach((row, i) => { const u = ups[i]; const vis = !!u; row.label.visible = vis; row.btn.container.visible = vis; if (u) { row.label.text = `${u.icon} ${u.name} — ${u.desc}`; row.btn.label.text = `${fmt(u.cost)} ✦`; } });
    const surge = this.game.getActiveSurge();
    n.status.text = surge
      ? `⚡ ${surge.name.toUpperCase()} (${surge.remainingSec}s)\n${surge.desc} [Switch to ${surge.tabLabel} Tab!]`
      : this._status;
    const dm = this.game.darkMatterOnSupernova();
    n.prestige.text = `🌑 Dark Matter: ${fmt(s.darkMatter)} (each +10% forever)\n💥 Supernova now: +${dm} 🌑 + HUGE station bounty!${dm < 1 ? ` (need ${fmt(50000)} ✦ this run)` : ''}`;
    n.contracts.text = s.contracts.slice(0, 4).map(c => { const p = c.need === 'clicks' ? s.clicksRun - (c.baseline || 0) : (c.progress || 0); return `${c.icon} ${c.name}\n   ${fmt(Math.min(p, c.target))}/${fmt(c.target)}${p >= c.target ? ' ✔ paying…' : ''}`; }).join('\n');
    for (const c of [...s.contracts]) { const p = c.need === 'clicks' ? s.clicksRun - (c.baseline || 0) : (c.progress || 0); if (p >= c.target) { const r = this.game.claimContract(c.uid); if (r) { this._status = `📋 Contract paid: ${Object.entries(r).map(([k, v]) => `+${v} ${k}`).join(' ')} (in wallet!)`; this._syncWallet(); } } }
    n.genRows.forEach(({ g, name, sub, btn }) => {
      const owned = s.gens[g.id] || 0;
      name.text = `${g.name} ×${owned}`;
      sub.text = `${fmt(this.game.genRate(g))}/s · ${ORE_ICON[g.ore]} ore`;
      btn.label.text = `BUY ×${this.buyQty} — ${fmt(this.game.genCost(g, this.buyQty))} ✦`;
    });
  }
}
