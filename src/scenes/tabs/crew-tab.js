// CrewTab -- personnel overview + hire/recruit. Mounts into the hub's
// center panel when the user clicks the CREW bottom-nav tab.
//
// Left column:  scrollable roster of current crew members.
// Right column: detail card for selected crew member (stats, role) +
//               RECRUIT panel at the bottom with 3 random candidates.
//
// Hiring deducts credits from MetaState and adds the new crew member.

import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
    buildStartButton,
} from '../../pixi-ui-kit.js';

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

const HIRE_COST = 800;

function _randomCandidate(existingIds) {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const role = ROLES[Math.floor(Math.random() * ROLES.length)];
    const level = 1 + Math.floor(Math.random() * 3);
    let id;
    do { id = `crew-${Date.now()}-${Math.floor(Math.random() * 10000)}`; } while (existingIds.has(id));
    return { id, name: `${first} ${last}`, role, level };
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

        const recruitCost = panelLabel(`Cost: ${HIRE_COST} credits`, COLOR_SLATE_400, { size: 10 });
        recruitCost.position.set(12, 26);
        recruitPanel.addChild(recruitCost);

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
            rosterPanel, rosterHeader, rosterList,
            detailPanel, detailName, detailRole, detailLevel, detailStatus,
            statsContainer, dismissBtn,
            recruitPanel, recruitHeader, recruitCost, candidateSlots, rerollBtn,
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

        // Rebuild roster list.
        n.rosterList.removeChildren();
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
            const roleLabel = panelLabel(`${c.role} · Lv ${c.level}`, roleColor, { size: 9 });
            roleLabel.position.set(22, 18);
            row.addChild(roleLabel);

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
            n.detailName.text = selected.name;
            n.detailRole.text = selected.role;
            n.detailLevel.text = `Level ${selected.level}`;
            n.detailStatus.text = selected.status;
            n.detailStatus.style.fill = selected.status === 'Available' ? COLOR_EMERALD_300 : COLOR_AMBER_300;
            n.detailPanel.visible = true;
            n.dismissBtn.container.visible = selected.status === 'Available';
        } else {
            n.detailPanel.visible = false;
        }

        // Candidates.
        this._candidates.forEach((cand, i) => {
            const slot = n.candidateSlots[i];
            slot.name.text = cand.name;
            slot.role.text = cand.role;
            slot.lvl.text = `Lv ${cand.level}`;
        });

        // Update hire cost display.
        const credits = this.meta?.credits ?? 0;
        n.recruitCost.text = `Cost: ${HIRE_COST} credits (have: ${credits.toLocaleString('en-US')})`;
        n.recruitCost.style.fill = credits >= HIRE_COST ? COLOR_EMERALD_300 : COLOR_ROSE_300;
    }

    _hireCrew(index) {
        if (!this.meta) return;
        const cand = this._candidates[index];
        if (!cand) return;
        if (this.meta.credits < HIRE_COST) return;
        this.meta.addCredits(-HIRE_COST);
        this.meta.addCrew(cand);
        this._candidates.splice(index, 1);
        const existing = new Set(this.meta.crewSnapshot().map((c) => c.id));
        this._candidates.splice(index, 0, _randomCandidate(existing));
        this._selectedCrewId = cand.id;
        this._refresh();
    }

    _dismissCrew() {
        if (!this.meta || !this._selectedCrewId) return;
        const c = this.meta.crewSnapshot().find((m) => m.id === this._selectedCrewId);
        if (!c || c.status !== 'Available') return;
        this.meta.removeCrew(this._selectedCrewId);
        this.meta.addCredits(Math.floor(HIRE_COST * 0.3));
        this._selectedCrewId = null;
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
    }
}
