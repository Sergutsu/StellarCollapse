// CrewTab -- personnel overview + hire/recruit. Mounts into the hub's
// center panel when the user clicks the CREW bottom-nav tab.
//
// Left column:  scrollable roster of current crew members.
// Right column: detail card for selected crew member (stats, role) +
//               RECRUIT panel at the bottom with 3 random candidates.
//
// Hiring deducts credits from MetaState and adds the new crew member.
//
// P8 made the roster a progression system instead of a name list:
//   * every member carries XP, so the roster + detail card render an XP
//     bar and a live level from `crew.crewProgress()`;
//   * hiring costs `crew.hireCost(rosterSize)` (escalating past 5 heads)
//     and is capped by `MetaState.crewSlots()` (Habitat Extension tech);
//   * dismiss returns `DISMISS_RETURN` of the current hire cost;
//   * each role advertises the mission types it is trained for
//     (`crew.ROLE_AFFINITY`), which is what the dispatch fit bonus reads.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
    buildStartButton,
} from '../../pixi-ui-kit.js';
import {
    crewProgress,
    hireCost,
    xpForLevel,
    skillFactor,
    DISMISS_RETURN,
    ROLE_AFFINITY,
    MAX_CREW_LEVEL,
} from '../../crew.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_EMERALD_300 = 0x6ee7b7;
const COLOR_ROSE_300 = 0xfda4af;

const ROLES = ['Captain', 'Engineer', 'Navigator', 'Tactician', 'Quartermaster', 'Scientist', 'Medic', 'Pilot'];
const FIRST_NAMES = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'J.', 'K.', 'L.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.', 'V.', 'W.', 'Z.'];
const LAST_NAMES = ['Korin', 'Voss', 'Reyes', 'Tanaka', 'Okafor', 'Strand', 'Moreau', 'Petrov', 'Ashby', 'Deluca', 'Nkosi', 'Harlan', 'Xu', 'Bard', 'Thorne', 'Qadir', 'Alvar', 'Zheng', 'Frost', 'Kael'];

// A recruit arrives with exactly the XP their advertised level needs, so
// `crewProgress()` never demotes a freshly hired veteran.
function _randomCandidate(existingIds) {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const role = ROLES[Math.floor(Math.random() * ROLES.length)];
    const level = 1 + Math.floor(Math.random() * 3);
    let id;
    do { id = `crew-${Date.now()}-${Math.floor(Math.random() * 10000)}`; } while (existingIds.has(id));
    return { id, name: `${first} ${last}`, role, level, xp: xpForLevel(level) };
}

const ROLE_COLORS = {
    Captain:       0xfcd34d,
    Engineer:      0x67e8f9,
    Navigator:     0x818cf8,
    Tactician:     0xfda4af,
    Quartermaster: 0x6ee7b7,
    Scientist:     0xa78bfa,
    Medic:         0xf9a8d4,
    Pilot:         0x93c5fd,
};

export class CrewTab {
    constructor({ parent, meta }) {
        if (!parent) throw new Error('CrewTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedCrewId = null;
        this._candidates = [];
        this._status = 'Sign contracts, fly them, and the crew levels up.';
        this._detailW = 300;
        this._detailH = 220;
    }

    get visible() { return !!this.root.visible; }

    show() {
        if (!this._nodes) this._build();
        this._refreshCandidates();
        this._refresh();
        this.root.visible = true;
    }

    hide() { this.root.visible = false; }

    layout(screen) {
        if (!this._nodes || !screen) return;
        const w = screen.width || 0;
        const h = screen.height || 0;
        if (w <= 0 || h <= 0) return;
        this._layout(w, h);
    }

    destroy() {
        if (this.root) {
            this.root.destroy({ children: true });
            this.root = null;
        }
        this._nodes = null;
    }

    _build() {
        const title = panelLabel('CREW PERSONNEL OVERVIEW', COLOR_AMBER_300, { size: 14, weight: '800' });
        title.style.letterSpacing = 2;
        title.position.set(16, 12);
        this.root.addChild(title);

        // Left pane: crew roster list.
        const rosterPanel = drawHologramPanel(220, 400, { accent: COLOR_CYAN_500 });
        this.root.addChild(rosterPanel);

        const rosterHeader = panelLabel('CREW', COLOR_CYAN_300, { size: 11 });
        rosterHeader.position.set(12, 9);
        rosterPanel.addChild(rosterHeader);

        const rosterCount = panelLabel('0 / 0', COLOR_SLATE_400, { size: 10, weight: '700' });
        rosterCount.anchor.set(1, 0);
        rosterCount.position.set(208, 10);
        rosterPanel.addChild(rosterCount);

        const rosterList = new Container();
        rosterPanel.addChild(rosterList);

        // Right pane: detail card.
        const detailPanel = drawHologramPanel(300, 240, { accent: COLOR_CYAN_500 });
        this.root.addChild(detailPanel);

        const detailName = panelLabel('', COLOR_SLATE_200, { size: 14, weight: '800' });
        detailName.position.set(12, 12);
        detailPanel.addChild(detailName);

        const detailRole = panelLabel('', COLOR_CYAN_300, { size: 11 });
        detailRole.position.set(12, 32);
        detailPanel.addChild(detailRole);

        const detailLevel = panelLabel('', COLOR_AMBER_300, { size: 11 });
        detailLevel.position.set(12, 50);
        detailPanel.addChild(detailLevel);

        const detailStatus = panelLabel('', COLOR_EMERALD_300, { size: 11 });
        detailStatus.position.set(12, 68);
        detailPanel.addChild(detailStatus);

        // XP progression: numeric line + bar + the payout multiplier the
        // level buys, then the mission types this role is trained for.
        const detailXp = panelLabel('', COLOR_AMBER_300, { size: 10, weight: '700' });
        detailXp.position.set(12, 88);
        detailPanel.addChild(detailXp);

        const xpBar = new Graphics();
        xpBar.position.set(12, 104);
        detailPanel.addChild(xpBar);

        const detailSkill = panelLabel('', COLOR_SLATE_400, { size: 10 });
        detailSkill.position.set(12, 116);
        detailPanel.addChild(detailSkill);

        const detailAffinity = panelLabel('', COLOR_CYAN_300, { size: 10 });
        detailAffinity.position.set(12, 134);
        detailPanel.addChild(detailAffinity);

        // Stats bars.
        const statsContainer = new Container();
        detailPanel.addChild(statsContainer);

        const dismissBtn = buildSimpleButton({
            text: 'DISMISS',
            width: 90,
            height: 26,
            accent: 'amber',
            onTap: () => this._dismissCrew(),
        });
        detailPanel.addChild(dismissBtn.container);

        // Recruit panel.
        const recruitPanel = drawHologramPanel(300, 140, { accent: 0x14532d });
        this.root.addChild(recruitPanel);

        const recruitHeader = panelLabel('RECRUIT NEW PERSONNEL', COLOR_EMERALD_300, { size: 11, weight: '700' });
        recruitHeader.position.set(12, 9);
        recruitPanel.addChild(recruitHeader);

        const recruitCost = panelLabel('Cost: 0 credits', COLOR_SLATE_400, { size: 10 });
        recruitCost.position.set(12, 26);
        recruitPanel.addChild(recruitCost);

        const recruitStatus = panelLabel('', COLOR_ROSE_300, { size: 9 });
        recruitStatus.position.set(12, 112);
        recruitPanel.addChild(recruitStatus);

        const candidateSlots = [];
        for (let i = 0; i < 3; i++) {
            const slot = new Container();
            slot.eventMode = 'static';
            slot.cursor = 'pointer';

            const bg = new Graphics();
            slot.addChild(bg);

            const name = panelLabel('', COLOR_SLATE_200, { size: 10, weight: '700' });
            name.position.set(6, 6);
            slot.addChild(name);

            const role = panelLabel('', COLOR_SLATE_400, { size: 9 });
            role.position.set(6, 20);
            slot.addChild(role);

            const lvl = panelLabel('', COLOR_AMBER_300, { size: 9 });
            lvl.position.set(6, 34);
            slot.addChild(lvl);

            const hireBtn = buildSimpleButton({
                text: 'HIRE',
                width: 52,
                height: 22,
                accent: 'green',
                onTap: () => this._hireCrew(i),
            });
            slot.addChild(hireBtn.container);

            recruitPanel.addChild(slot);
            candidateSlots.push({ slot, bg, name, role, lvl, hireBtn });
        }

        const rerollBtn = buildSimpleButton({
            text: 'REROLL',
            width: 70,
            height: 24,
            accent: 'cyan',
            onTap: () => { this._refreshCandidates(); this._refresh(); },
        });
        recruitPanel.addChild(rerollBtn.container);

        this._nodes = {
            title,
            rosterPanel, rosterHeader, rosterCount, rosterList,
            detailPanel, detailName, detailRole, detailLevel, detailStatus,
            detailXp, xpBar, detailSkill, detailAffinity,
            statsContainer, dismissBtn,
            recruitPanel, recruitHeader, recruitCost, recruitStatus, candidateSlots, rerollBtn,
        };
    }

    _refreshCandidates() {
        const existing = new Set((this.meta?.crewSnapshot() || []).map((c) => c.id));
        this._candidates = [
            _randomCandidate(existing),
            _randomCandidate(existing),
            _randomCandidate(existing),
        ];
    }

    _refresh() {
        if (!this._nodes) return;
        const n = this._nodes;
        const crew = this.meta?.crewSnapshot() || [];
        const slots = this.meta ? this.meta.crewSlots() : crew.length;
        const cost = hireCost(crew.length);
        const credits = this.meta?.credits ?? 0;
        const full = crew.length >= slots;
        n.rosterCount.text = `${crew.length} / ${slots}`;
        n.rosterCount.style.fill = full ? COLOR_ROSE_300 : COLOR_SLATE_400;

        // Rebuild roster list.
        n.rosterList.removeChildren().forEach((child) => child?.destroy?.({ children: true }));
        crew.forEach((c, i) => {
            const row = new Container();
            row.eventMode = 'static';
            row.cursor = 'pointer';

            const isSelected = c.id === this._selectedCrewId;
            const bg = new Graphics();
            bg.roundRect(0, 0, 196, 32, 4).fill({ color: isSelected ? 0x1e3a5f : 0x0f172a, alpha: 0.85 });
            bg.roundRect(0, 0, 196, 32, 4).stroke({ color: isSelected ? COLOR_CYAN_300 : 0x334155, width: 1, alpha: 0.6 });
            row.addChild(bg);

            const statusDot = new Graphics();
            const dotColor = c.status === 'Available' ? COLOR_EMERALD_300 : COLOR_AMBER_300;
            statusDot.circle(0, 0, 4).fill({ color: dotColor });
            statusDot.position.set(12, 16);
            row.addChild(statusDot);

            const nameLabel = panelLabel(c.name, COLOR_SLATE_200, { size: 10, weight: '700' });
            nameLabel.position.set(22, 4);
            row.addChild(nameLabel);

            const roleColor = ROLE_COLORS[c.role] || COLOR_SLATE_400;
            const progress = crewProgress(c);
            const roleLabel = panelLabel(`${c.role} \u00B7 Lv ${progress.level}`, roleColor, { size: 9 });
            roleLabel.position.set(22, 17);
            row.addChild(roleLabel);

            // XP bar: the only visible signal that flying contracts grows
            // the crew. Maxed members read as a full amber strip.
            const barW = 168;
            const bar = new Graphics();
            bar.roundRect(22, 27, barW, 3, 1.5).fill({ color: 0x1e293b, alpha: 0.9 });
            const fillW = Math.max(0, Math.round(barW * (progress.maxed ? 1 : progress.progress)));
            if (fillW > 0) {
                bar.roundRect(22, 27, fillW, 3, 1.5).fill({ color: progress.maxed ? COLOR_AMBER_300 : COLOR_CYAN_300, alpha: 0.9 });
            }
            row.addChild(bar);

            row.position.set(12, 30 + i * 36);
            row.hitArea = new Rectangle(0, 0, 196, 32);
            row.on('pointertap', () => { this._selectedCrewId = c.id; this._refresh(); });
            n.rosterList.addChild(row);
        });

        // Detail pane.
        const selected = crew.find((c) => c.id === this._selectedCrewId);
        if (!selected && crew.length > 0) {
            this._selectedCrewId = crew[0].id;
            return this._refresh();
        }

        if (selected) {
            const progress = crewProgress(selected);
            n.detailName.text = selected.name;
            n.detailRole.text = selected.role;
            n.detailLevel.text = progress.maxed
                ? `Level ${progress.level} \u00B7 MAX RANK`
                : `Level ${progress.level} / ${MAX_CREW_LEVEL}`;
            n.detailStatus.text = selected.status;
            n.detailStatus.style.fill = selected.status === 'Available' ? COLOR_EMERALD_300 : COLOR_AMBER_300;
            n.detailXp.text = progress.maxed
                ? 'Experience capped'
                : `XP ${progress.xpIntoLevel.toLocaleString('en-US')} / ${(progress.xpIntoLevel + progress.xpForNext).toLocaleString('en-US')} \u00B7 next level in ${progress.xpForNext.toLocaleString('en-US')} xp`;
            n.detailSkill.text = `Contract payout \u00D7${skillFactor(progress.level).toFixed(2)} \u00B7 total ${progress.xp.toLocaleString('en-US')} xp`;

            const affinity = ROLE_AFFINITY[selected.role] || [];
            n.detailAffinity.text = affinity.length
                ? `Trained for: ${affinity.join(', ')} (+25% xp on those contracts)`
                : 'No specialty training';

            const barW = Math.max(60, this._detailW - 24);
            n.xpBar.clear();
            n.xpBar.roundRect(0, 0, barW, 6, 3).fill({ color: 0x1e293b, alpha: 0.95 });
            const fillW = Math.round(barW * (progress.maxed ? 1 : progress.progress));
            if (fillW > 0) {
                n.xpBar.roundRect(0, 0, fillW, 6, 3).fill({ color: progress.maxed ? COLOR_AMBER_300 : COLOR_CYAN_300, alpha: 0.95 });
            }
            n.xpBar.visible = true;

            n.detailPanel.visible = true;
            n.dismissBtn.container.visible = selected.status === 'Available';
        } else {
            n.detailPanel.visible = false;
            n.xpBar.visible = false;
        }

        // Candidates. Each shows the price of the NEXT berth, and the
        // HIRE button dims when the roster is full or credits run short.
        this._candidates.forEach((cand, i) => {
            const slot = n.candidateSlots[i];
            slot.name.text = cand.name;
            slot.role.text = cand.role;
            const progress = crewProgress(cand);
            slot.lvl.text = `Lv ${progress.level} \u00B7 ${(ROLE_AFFINITY[cand.role] || []).join('/') || 'general'}`;
            const canHire = !full && credits >= cost;
            slot.hireBtn.label.text = `${cost.toLocaleString('en-US')} CR`;
            slot.hireBtn.container.alpha = canHire ? 1 : 0.35;
            slot.hireBtn.container.eventMode = canHire ? 'static' : 'none';
        });

        n.recruitCost.text = `Berth ${crew.length + 1} costs ${cost.toLocaleString('en-US')} credits (have: ${credits.toLocaleString('en-US')})`;
        n.recruitCost.style.fill = !full && credits >= cost ? COLOR_EMERALD_300 : COLOR_ROSE_300;
        n.recruitStatus.text = this._status;
        n.recruitStatus.style.fill = full ? COLOR_ROSE_300 : COLOR_SLATE_400;
    }

    _hireCrew(index) {
        if (!this.meta) return;
        const cand = this._candidates[index];
        if (!cand) return;
        const roster = this.meta.crewSnapshot();
        const slots = this.meta.crewSlots();
        if (roster.length >= slots) {
            this._status = `All ${slots} berths full \u2014 research Habitat Extension for more.`;
            this._refresh();
            return;
        }
        const cost = hireCost(roster.length);
        if (this.meta.credits < cost) {
            this._status = `Need ${cost.toLocaleString('en-US')} credits for this contract.`;
            this._refresh();
            return;
        }
        this.meta.addCredits(-cost);
        this.meta.addCrew(cand);
        this._candidates.splice(index, 1);
        const existing = new Set(this.meta.crewSnapshot().map((c) => c.id));
        this._candidates.splice(index, 0, _randomCandidate(existing));
        this._selectedCrewId = cand.id;
        this._status = `${cand.name} signed on as ${cand.role} for ${cost.toLocaleString('en-US')} credits.`;
        this._refresh();
    }

    _dismissCrew() {
        if (!this.meta || !this._selectedCrewId) return;
        const roster = this.meta.crewSnapshot();
        const c = roster.find((m) => m.id === this._selectedCrewId);
        if (!c || c.status !== 'Available') return;
        // Severance is a fraction of what the *next* berth would cost, so
        // churning the roster is always a net loss.
        const refund = Math.floor(hireCost(roster.length) * DISMISS_RETURN);
        this.meta.removeCrew(this._selectedCrewId);
        this.meta.addCredits(refund);
        this._selectedCrewId = null;
        this._status = `${c.name} mustered out \u00B7 ${refund.toLocaleString('en-US')} credits severance.`;
        this._refresh();
    }

    _layout(w, h) {
        if (!this._nodes) return;
        const n = this._nodes;

        // Title.
        n.title.position.set(16, 12);

        // Roster panel (left).
        const rosterW = Math.min(230, Math.floor(w * 0.38));
        const rosterH = h - 50;
        n.rosterPanel.position.set(8, 38);
        redrawHologramPanel(n.rosterPanel, rosterW, rosterH, { accent: COLOR_CYAN_500 });

        // Detail panel (right).
        const detailX = rosterW + 24;
        const detailW = Math.max(260, w - detailX - 16);
        const detailH = Math.min(220, Math.floor((h - 50) * 0.55));
        n.detailPanel.position.set(detailX, 38);
        redrawHologramPanel(n.detailPanel, detailW, detailH, { accent: COLOR_CYAN_500 });
        n.dismissBtn.container.position.set(detailW - 102, detailH - 36);
        this._detailW = detailW;
        this._detailH = detailH;
        n.detailAffinity.style.wordWrap = true;
        n.detailAffinity.style.wordWrapWidth = detailW - 24;

        // Stats container.
        n.statsContainer.position.set(12, 90);

        // Recruit panel (below detail).
        const recruitY = 38 + detailH + 12;
        const recruitH = Math.max(120, h - recruitY - 10);
        n.recruitPanel.position.set(detailX, recruitY);
        redrawHologramPanel(n.recruitPanel, detailW, recruitH, { accent: 0x14532d });

        // Candidate slots.
        const slotW = Math.floor((detailW - 48 - 82) / 3);
        n.candidateSlots.forEach((s, i) => {
            s.slot.position.set(12 + i * (slotW + 8), 44);
            s.bg.clear();
            s.bg.roundRect(0, 0, slotW, 60, 4).fill({ color: 0x0f172a, alpha: 0.8 });
            s.bg.roundRect(0, 0, slotW, 60, 4).stroke({ color: 0x334155, width: 1, alpha: 0.5 });
            s.hireBtn.container.position.set(slotW - 58, 32);
        });

        n.rerollBtn.container.position.set(detailW - 82, 44 + 18);
        n.recruitStatus.style.wordWrap = true;
        n.recruitStatus.style.wordWrapWidth = detailW - 24;
        n.recruitStatus.position.set(12, Math.max(104, recruitH - 26));

        // Row heights follow the roster panel; re-run the refresh so the
        // XP bars pick up the new geometry.
        this._refresh();
    }
}
