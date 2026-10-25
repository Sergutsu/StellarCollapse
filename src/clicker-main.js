// DOM clicker/idle front-end. All logic lives in clicker-state.js.
import { ClickerState, GENERATORS, UPGRADES, RESEARCH, SECTORS, SHIPS, CREW, PRESTIGE_UPGRADES, fmt } from './clicker-state.js';

const KEY = 'stellar-venture-clicker-v1';
let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
const game = new ClickerState(saved);
const offline = game.applyOffline();
let buyQty = 1;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function save() { game.touch(); try { localStorage.setItem(KEY, JSON.stringify(game.snapshot())); } catch {} }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

function popups(amount, crit) {
  const el = document.createElement('div'); el.className = 'float' + (crit ? ' crit' : '');
  el.textContent = (crit ? 'CRIT +' : '+') + fmt(amount);
  el.style.left = (38 + Math.random() * 24) + '%'; el.style.top = (30 + Math.random() * 20) + '%';
  $('#star-wrap').appendChild(el); setTimeout(() => el.remove(), 1100);
}

function render() {
  const s = game.s, pps = game.productionPerSec();
  $('#res').innerHTML = [
    ['✦ Stardust', fmt(s.stardust)], ['⚡ /sec', fmt(pps)], ['👆 Click', fmt(game.clickPower() * game.comboMult())],
    ['💰 Credits', fmt(s.credits)], ['💎 Minerals', fmt(s.minerals)], ['🌀 Warp', fmt(s.warp)],
    ['⭐ Level', game.starLevel()], ['🏅 Rep T' + game.repTier(), fmt(s.rep)], ['🌑 Dark Matter', fmt(s.darkMatter)],
  ].map(([k, v]) => `<div class="res"><span>${k}</span><b>${v}</b></div>`).join('') +
    `<div class="res ores"><span>Ore hold</span><b>${Object.entries(s.ores).map(([k, v]) => `${({red:'🔴',blue:'🔵',green:'🟢',yellow:'🟡',bomb:'💣',snake:'🐍'})[k]} ${fmt(v)}`).join(' ')}</b></div>`;

  $('#combo').textContent = s.combo > 1 ? `🔥 COMBO ×${game.comboMult().toFixed(2)} (${s.combo})` : 'Click fast to build combo!';
  $('#core-fill').style.width = s.core + '%'; $('#core-label').textContent = `⬢ CORE ${Math.floor(s.core)}% ${s.core >= 100 ? '— COLLAPSE READY!' : '(drones & extractors fill it)'}`;
  $('#collapse-btn').disabled = s.core < 100;
  $('#wave').innerHTML = `🛡 <b>Wave ${s.wave}</b>${s.wave % 10 === 0 ? ' 👹 BOSS' : ''} — invader HP ${fmt(Math.max(0, s.waveHp))}/${fmt(s.waveMaxHp)} · turret DPS ${fmt(game.dps())} · waves cleared ${s.wavesCleared}`;
  $('#wave-fill').style.width = clampPct(s.waveHp / s.waveMaxHp);
  $('#bomb-btn').textContent = `💣 Bomb Blast (5 💣 ore) — burst + wave damage`; $('#bomb-btn').disabled = s.ores.bomb < 5;
  $('#snake-btn').textContent = `🐍 Snake Chain (5 🐍 ore) — +4 of every ore`; $('#snake-btn').disabled = s.ores.snake < 5;
  const golden = Date.now() >= (s.goldenAt || Infinity) && s.goldenAt;
  $('#golden').style.display = golden ? 'block' : 'none';

  $('#gens').innerHTML = GENERATORS.map(g => {
    const owned = s.gens[g.id] || 0, qty = buyQty === 'max' ? Math.max(1, game.maxAffordable(g)) : buyQty;
    const cost = game.genCost(g, qty);
    return `<div class="card"><div class="ic">${g.icon}</div><div class="grow"><b>${g.name}</b> <span class="dim">×${owned}</span><br><small>${g.blurb}</small><br><small class="dim">${fmt(game.genRate(g))}/s ${owned && owned % 10 === 0 ? '· milestone ×2!' : ''} · next milestone at ${Math.ceil((owned + 1) / 10) * 10}</small></div><button data-gen="${g.id}" ${s.stardust < cost ? 'disabled' : ''}>Buy ×${qty}<br>${fmt(cost)} ✦</button></div>`;
  }).join('');

  const prices = game.prices();
  $('#market').innerHTML = Object.entries(s.ores).map(([color, amt]) => {
    const p = Object.values(prices).find(x => x.color === color);
    return `<div class="row"><span>${color} — ${fmt(amt)} held · sell ${p ? p.sell : '?'}¢ ea</span><span><button data-sell="${color}:10">Sell 10</button> <button data-sell="${color}:999999">Sell all</button> <button data-refine="${color}">Refine</button></span></div>`;
  }).join('') + `<button id="refine-all" class="wide">🏭 REFINE ALL ORE → MINERALS</button>`;

  $('#contracts').innerHTML = s.contracts.map(c => {
    const prog = c.need === 'clicks' ? game.s.clicksRun - (c.baseline || 0) : c.progress || 0;
    const done = prog >= c.target;
    return `<div class="card"><div class="ic">${c.icon}</div><div class="grow"><b>${c.name}</b><br><small>${c.desc}: ${fmt(Math.min(prog, c.target))} / ${fmt(c.target)}</small><div class="bar"><i style="width:${clampPct(prog / c.target)}"></i></div><small class="dim">Reward: ${Object.entries(c.reward).map(([k, v]) => `${v} ${k}`).join(' · ')}</small></div><button data-contract="${c.uid}" ${done ? '' : 'disabled'}>CLAIM</button></div>`;
  }).join('') || '<p class="dim">No contracts — check back in a moment.</p>';

  $('#upgrades').innerHTML = UPGRADES.filter(u => !s.upgrades.includes(u.id)).map(u => {
    const avail = (u.req?.(game) ?? true);
    return `<div class="card ${avail ? '' : 'locked'}"><div class="ic">${u.icon}</div><div class="grow"><b>${u.name}</b><br><small>${u.desc}</small>${avail ? '' : '<br><small class="dim">🔒 keep playing to unlock</small>'}</div><button data-up="${u.id}" ${!avail || s[u.curr] < u.cost ? 'disabled' : ''}>${fmt(u.cost)} ${u.curr}</button></div>`;
  }).join('') || '<p class="dim">All upgrades bought. Nice.</p>';

  const ra = s.researchActive;
  $('#research').innerHTML = (ra ? `<p>🔬 Researching <b>${RESEARCH.find(r => r.id === ra.id)?.name}</b> — ${Math.max(0, Math.ceil((ra.endsAt - Date.now()) / 1000))}s left (works offline)</p>` : '') +
    RESEARCH.map(r => s.researchDone.includes(r.id) ? `<div class="row"><span>${r.icon} ${r.name} ✅</span><small>${r.desc}</small></div>`
      : `<div class="card"><div class="ic">${r.icon}</div><div class="grow"><b>${r.name}</b> (${r.sec}s)<br><small>${r.desc}</small></div><button data-research="${r.id}" ${ra || s.credits < r.cost.credits || s.minerals < r.cost.minerals ? 'disabled' : ''}>${r.cost.credits}¢ + ${r.cost.minerals}💎</button></div>`).join('');

  $('#station').innerHTML =
    '<h3>🌌 Sectors (warp + rep gated, permanent)</h3>' + SECTORS.map(x => `<div class="row"><span>${x.icon} ${x.name} — ${x.desc}</span>${s.sectors.includes(x.id) ? '<b>CHARTED ✅</b>' : `<button data-sector="${x.id}" ${s.warp < x.warp || s.rep < x.rep ? 'disabled' : ''}>Chart: ${x.warp}🌀 · rep ${x.rep}</button>`}</div>`).join('') +
    '<h3>🚀 Fleet (credits, permanent)</h3>' + SHIPS.map(x => `<div class="row"><span>${x.icon} ${x.name} — ${x.desc}</span>${s.ships.includes(x.id) ? '<b>OWNED ✅</b>' : `<button data-ship="${x.id}" ${s.credits < x.cost ? 'disabled' : ''}>${fmt(x.cost)}¢</button>`}</div>`).join('') +
    '<h3>🧑‍🚀 Crew (credits, permanent)</h3>' + CREW.map(x => `<div class="row"><span>${x.icon} ${x.name} — ${x.desc}</span>${s.crew.includes(x.id) ? '<b>HIRED ✅</b>' : `<button data-crew="${x.id}" ${s.credits < x.cost ? 'disabled' : ''}>${fmt(x.cost)}¢</button>`}</div>`).join('');

  const dm = game.darkMatterOnSupernova();
  $('#prestige').innerHTML = `<p>🌑 Dark Matter: <b>${fmt(s.darkMatter)}</b> (each = +10% all production, forever)<br>Supernova now for <b>${dm}</b> 🌑 — resets stardust, generators, upgrades & contracts. Keeps Dark Matter, sectors, research, prestige upgrades.</p>
  <button id="supernova" class="danger wide" ${dm < 1 ? 'disabled' : ''}>💥 SUPERNOVA ${dm < 1 ? `(produce ${fmt(50000)} stardust this run first)` : `→ +${dm} 🌑`}</button>` +
    PRESTIGE_UPGRADES.map(u => `<div class="row"><span>${u.icon} ${u.name} — ${u.desc}</span>${s.prestigeUpgrades.includes(u.id) ? '<b>✅</b>' : `<button data-prestige="${u.id}" ${s.darkMatter < u.cost ? 'disabled' : ''}>${u.cost} 🌑</button>`}</div>`).join('') +
    `<p class="dim">Lifetime stardust ${fmt(s.lifetime)} · clicks ${fmt(s.totalClicks)} · best combo ${s.bestCombo} · collapses ${s.collapses} · supernovas ${s.stats.supernovas}</p>`;
  bindDynamic();
}
function clampPct(v) { return Math.max(0, Math.min(100, (v || 0) * 100)) + '%'; }

function bindDynamic() {
  document.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => { if (game.buyGenerator(b.dataset.gen, buyQty)) toast('Bought ' + b.dataset.gen); render(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { game.buyUpgrade(b.dataset.up); render(); });
  document.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => { const [c, a] = b.dataset.sell.split(':'); const g = game.sellOre(c, +a); if (g) toast(`Sold for ${fmt(g)}¢`); render(); });
  document.querySelectorAll('[data-refine]').forEach(b => b.onclick = () => { const q = game.refine(b.dataset.refine); toast(q.ok ? `Refined → ${q.minerals}💎` : q.reason); render(); });
  const ra = $('#refine-all'); if (ra) ra.onclick = () => { toast(`Refined → ${game.refineAll()}💎`); render(); };
  document.querySelectorAll('[data-contract]').forEach(b => b.onclick = () => { if (game.claimContract(+b.dataset.contract)) toast('Contract paid! +rep'); render(); });
  document.querySelectorAll('[data-research]').forEach(b => b.onclick = () => { game.startResearch(b.dataset.research); render(); });
  document.querySelectorAll('[data-sector]').forEach(b => b.onclick = () => { game.chartSector(b.dataset.sector); render(); });
  document.querySelectorAll('[data-ship]').forEach(b => b.onclick = () => { game.buyShip(b.dataset.ship); render(); });
  document.querySelectorAll('[data-crew]').forEach(b => b.onclick = () => { game.hireCrew(b.dataset.crew); render(); });
  document.querySelectorAll('[data-prestige]').forEach(b => b.onclick = () => { game.buyPrestige(b.dataset.prestige); render(); });
  const sn = $('#supernova'); if (sn) sn.onclick = () => { if (confirm('Supernova? Reset this run for Dark Matter?')) { const d = game.supernova(); toast(`💥 +${d} Dark Matter!`); save(); render(); } };
}

$('#star').onclick = (e) => { const r = game.clickStar(); popups(r.gain, r.crit); const st = $('#star'); st.classList.remove('pulse'); void st.offsetWidth; st.classList.add('pulse'); render(); };
$('#golden').onclick = () => { toast(`⭐ Golden star! +${fmt(game.clickGolden())} ✦`); render(); };
$('#collapse-btn').onclick = () => { const p = game.collapseCore(); if (p) toast(`⬢ CORE COLLAPSE! +${fmt(p)} ✦`); render(); };
$('#bomb-btn').onclick = () => { const p = game.useBomb(); if (p) toast(`💣 +${fmt(p)} ✦`); render(); };
$('#snake-btn').onclick = () => { const p = game.useSnake(); if (p) toast(`🐍 +${fmt(p)} ✦ & ore!`); render(); };
document.querySelectorAll('[data-qty]').forEach(b => b.onclick = () => { buyQty = b.dataset.qty === 'max' ? 'max' : +b.dataset.qty; document.querySelectorAll('[data-qty]').forEach(x => x.classList.toggle('on', x === b)); render(); });
$('#reset').onclick = () => { if (confirm('Wipe clicker save and start over?')) { localStorage.removeItem(KEY); location.reload(); } };
game.on('wave-clear', ({ wave, boss }) => { if (boss) toast(`👹 Boss wave ${wave} cleared! Warp + rep!`); });
game.on('research-done', () => { toast('🔬 Research complete!'); render(); });

render();
if (offline) { $('#offline').style.display = 'block'; $('#offline').innerHTML = `👋 <b>Welcome back!</b> Your station produced <b>${fmt(offline.stardust)} ✦</b> while you were away (${Math.floor(offline.seconds / 60)} min at ${offline.rate * 100}% efficiency). It is already in your hold. <button onclick="this.parentElement.style.display='none'">OK</button>`; }
let last = performance.now();
setInterval(() => { const now = performance.now(); game.tick(Math.min(5, (now - last) / 1000)); last = now; render(); }, 500);
setInterval(save, 5000);
addEventListener('pagehide', save); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
