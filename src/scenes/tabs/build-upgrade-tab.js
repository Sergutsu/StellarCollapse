// FleetUpgradeTab -- fleet construction, servicing, and mother-ship
// upgrade overview. Mounts into the hub center panel when FLEET UPGRADE
// tab is clicked.
//
// P8: berth capacity now comes from the research effect bundle
// (`MetaState.getEffects().fleetSlots`) instead of a second copy of the
// tech math living in this file, blueprints advertise the mission types
// their hull class is built for (`crew.SHIP_CLASS_AFFINITY`, which is what
// the dispatch fit bonus reads), and repairs report themselves to the
// lifetime stats through `MetaState.noteHullRepair()`.

import { Container, Graphics, Rectangle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
} from '../../pixi-ui-kit.js';
import { SHIP_CLASS_AFFINITY, BASE_FLEET_SLOTS, fleetSlotLimit } from '../../crew.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_EMERALD_300 = 0x6ee7b7;
const COLOR_ROSE_300 = 0xfda4af;
const COLOR_PURPLE_300 = 0xc084fc;

const CLASS_COLORS = {
    Scout:     0x67e8f9,
    Defense:   0xfda4af,
    Resource:  0x6ee7b7,
    Terraform: 0xa78bfa,
    Trade:     0xfcd34d,
    Frigate:   0x93c5fd,
    Corvette:  0xf97316,
};

// Ship blueprints available for construction.
const BLUEPRINTS = Object.freeze([
    { className: 'Scout',     baseName: 'Scout',      cost: 400,  desc: 'Fast recon vessel. Low hull but quick missions.' },
    { className: 'Defense',   baseName: 'Defender',   cost: 800,  desc: 'Armored patrol ship. Strong in combat missions.' },
    { className: 'Resource',  baseName: 'Harvester',  cost: 600,  desc: 'Mining vessel. Bonus mineral yield on resource missions.' },
    { className: 'Terraform', baseName: 'Terraformer', cost: 1000, desc: 'Planetary engineering. Enables terraform missions.' },
    { className: 'Trade',     baseName: 'Trader',      cost: 500,  desc: 'Cargo hauler. Extra credits from trade missions.' },
    { className: 'Frigate',   baseName: 'Frigate',     cost: 1200, desc: 'Heavy warship. Highest hull, strongest combat.' },
]);

// HubScene._buildSidePanel() mounts `list` at (12, 40) inside the frame, so
// a tab's usable height is the panel height minus that 40 px header offset.
const SIDE_LIST_TOP = 40;
const REPAIR_COST_PER_POINT = 3; // minerals per hull point
const DISASSEMBLE_RETURN = 0.4;  // fraction of build cost returned as minerals

/** Mission types a hull class is built for — the dispatch fit bonus. */
function specialtyFor(className) {
    const list = SHIP_CLASS_AFFINITY[className];
    return Array.isArray(list) && list.length ? list.join(' / ') : 'general duty';
}

// Mother-ship upgrade readouts driven by tech-tree completion. The tab
// shows these as the path toward larger fleet berths without inventing a
// second upgrade currency outside the research tree.
const FLEET_SLOT_TECH_UPGRADES = Object.freeze([
    { nodeId: 'fuel-cell', label: 'Compact Fuel Cell', slots: 2, desc: 'Auxiliary hangar power for two more fleet berths.' },
    { nodeId: 'warp-coils', label: 'Warp Coils', slots: 2, desc: 'Reinforced jump cradles stabilize two extra berths.' },
    { nodeId: 'habitat-extension', label: 'Habitat Extension', slots: 1, desc: 'Crew support expansion unlocks one command berth.' },
    { nodeId: 'shield-array', label: 'Shield Array', slots: 1, desc: 'Shielded docking lane opens one guarded berth.' },
]);

// Research lab expansion (increases concurrent research slots)
const RESEARCH_LAB_UPGRADE = {
    id: 'research-lab',
    name: 'Research Lab Expansion',
    cost: { minerals: 2000, credits: 1500 },
    effect: '+1 concurrent research slot',
    max: 5, // soft cap for now
};

export class BuildUpgradeTab {
    constructor({ parent, meta, side = null }) {
        if (!parent) throw new Error('BuildUpgradeTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        // The hub's left-column panel: this tab moves the shipyard
        // (blueprints, berth capacity, build status) into it so the centre
        // is left for the fleet itself.
        this._side = side;
        this._sideW = 276;
        this._sideH = 420;
        this.usesSidePanel = true;
        this.sidePanelTitle = 'SHIPYARD';
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedShipId = null;
        this._shipCounter = 0;
        this._activeSubTab = 'fleet';
        this._yardStatus = '';
    }

    get visible() { return !!this.root.visible; }

    show() {
        if (!this._nodes) this._build();
        this._refresh();
        this.root.visible = true;
    }

    hide() {
        this.root.visible = false;
        // Shared bay: the yard travels with the tab.
        if (this._nodes?.yard) this._nodes.yard.visible = false;
    }

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
        const title = panelLabel('FLEET UPGRADE  ·  SHIPYARD', COLOR_AMBER_300, { size: 14, weight: '800' });
        title.style.letterSpacing = 2;
        title.position.set(16, 12);
        this.root.addChild(title);

        const fleetTab = buildSimpleButton({
            text: 'AVAILABLE FLEET',
            width: 142,
            height: 28,
            accent: 'cyan',
            onTap: () => this._setSubTab('fleet'),
        });
        const motherShipTab = buildSimpleButton({
            text: 'MOTHER-SHIP',
            width: 128,
            height: 28,
            accent: 'magenta',
            onTap: () => this._setSubTab('motherShip'),
        });
        this.root.addChild(fleetTab.container, motherShipTab.container);

        const contentPanel = drawHologramPanel(620, 400, { accent: COLOR_CYAN_500 });
        this.root.addChild(contentPanel);

        const visualPanel = drawHologramPanel(300, 400, { accent: COLOR_PURPLE_300 });
        this.root.addChild(visualPanel);

        const fleetContent = new Container();
        contentPanel.addChild(fleetContent);
        const motherShipContent = new Container();
        contentPanel.addChild(motherShipContent);

        const visualContent = this._buildVisualContent(visualPanel);
        const fleetNodes = this._buildFleetContent(fleetContent);
        const motherShipNodes = this._buildMotherShipContent(motherShipContent);

        this._nodes = {
            title,
            fleetTab,
            motherShipTab,
            contentPanel,
            visualPanel,
            fleetContent,
            motherShipContent,
            visualContent,
            ...fleetNodes,
            ...motherShipNodes,
        };
    }

    _buildFleetContent(parent) {
        const fleetHeader = panelLabel('CURRENT FLEET', COLOR_CYAN_300, { size: 11 });
        fleetHeader.position.set(12, 12);
        parent.addChild(fleetHeader);

        const fleetList = new Container();
        parent.addChild(fleetList);

        const detailPanel = drawHologramPanel(260, 132, { accent: COLOR_CYAN_500 });
        parent.addChild(detailPanel);

        const detailName = panelLabel('', COLOR_SLATE_200, { size: 13, weight: '800' });
        detailName.position.set(12, 12);
        detailPanel.addChild(detailName);

        const detailClass = panelLabel('', COLOR_CYAN_300, { size: 11 });
        detailClass.position.set(12, 30);
        detailPanel.addChild(detailClass);

        const detailHull = panelLabel('', COLOR_EMERALD_300, { size: 11 });
        detailHull.position.set(12, 48);
        detailPanel.addChild(detailHull);

        const detailStatus = panelLabel('', COLOR_SLATE_400, { size: 11 });
        detailStatus.position.set(12, 66);
        detailPanel.addChild(detailStatus);

        const repairBtn = buildSimpleButton({
            text: 'REPAIR',
            width: 80,
            height: 24,
            accent: 'green',
            onTap: () => this._repairShip(),
        });
        detailPanel.addChild(repairBtn.container);

        const repairCost = panelLabel('', COLOR_SLATE_400, { size: 9 });
        detailPanel.addChild(repairCost);

        const disassembleBtn = buildSimpleButton({
            text: 'DISASSEMBLE',
            width: 104,
            height: 24,
            accent: 'amber',
            onTap: () => this._disassembleShip(),
        });
        detailPanel.addChild(disassembleBtn.container);

        // The shipyard is the left panel's content now: it is built once
        // into its own container and re-parented into the hub panel by
        // `_refreshSide`, so `_refresh()` keeps working on the same nodes.
        const yard = new Container();

        const buildHeader = panelLabel('BUILD NEW SHIP', COLOR_EMERALD_300, { size: 11, weight: '700' });
        yard.addChild(buildHeader);

        const capacityText = panelLabel('', COLOR_SLATE_400, { size: 10 });
        yard.addChild(capacityText);

        const yardStatus = panelLabel('', COLOR_ROSE_300, { size: 9 });
        yard.addChild(yardStatus);

        const blueprintCards = BLUEPRINTS.map((bp) => {
            const card = new Container();
            card.eventMode = 'static';
            card.cursor = 'pointer';

            const bg = new Graphics();
            card.addChild(bg);

            const classColor = CLASS_COLORS[bp.className] || COLOR_SLATE_200;
            const name = panelLabel(bp.baseName, classColor, { size: 11, weight: '700' });
            name.position.set(8, 5);
            card.addChild(name);

            const desc = panelLabel(bp.desc, COLOR_SLATE_400, { size: 9 });
            desc.position.set(8, 20);
            card.addChild(desc);

            // The fit bonus is invisible unless the yard says so: name the
            // mission types this hull class pays +12% on, right on the
            // price line.
            const cost = panelLabel(`${bp.cost} minerals \u00B7 fits ${specialtyFor(bp.className)}`, COLOR_AMBER_300, { size: 9, weight: '700' });
            cost.position.set(8, 35);
            card.addChild(cost);

            const buildBtn = buildSimpleButton({
                text: 'BUILD',
                width: 60,
                height: 22,
                accent: 'green',
                onTap: () => this._buildShip(bp),
            });
            card.addChild(buildBtn.container);

            yard.addChild(card);
            return { card, bg, name, desc, cost, buildBtn, bp };
        });

        return {
            yard,
            fleetHeader,
            fleetList,
            detailPanel,
            detailName,
            detailClass,
            detailHull,
            detailStatus,
            repairBtn,
            repairCost,
            disassembleBtn,
            buildHeader,
            capacityText,
            yardStatus,
            blueprintCards,
        };
    }

    _buildMotherShipContent(parent) {
        const motherShipHeader = panelLabel('MOTHER-SHIP UPGRADES', COLOR_PURPLE_300, { size: 11, weight: '700' });
        motherShipHeader.position.set(12, 12);
        parent.addChild(motherShipHeader);

        const berthSummary = panelLabel('', COLOR_SLATE_200, { size: 12 });
        berthSummary.position.set(12, 34);
        parent.addChild(berthSummary);

        const berthDetail = panelLabel('', COLOR_SLATE_400, { size: 10 });
        berthDetail.position.set(12, 52);
        parent.addChild(berthDetail);

        const upgradeCards = FLEET_SLOT_TECH_UPGRADES.map((upgrade) => {
            const card = new Container();
            const bg = new Graphics();
            card.addChild(bg);
            const name = panelLabel(upgrade.label, COLOR_SLATE_200, { size: 11, weight: '700' });
            name.position.set(10, 7);
            card.addChild(name);
            const status = panelLabel('', COLOR_SLATE_400, { size: 9, weight: '700' });
            status.position.set(10, 24);
            card.addChild(status);
            const desc = panelLabel(upgrade.desc, COLOR_SLATE_400, { size: 9 });
            desc.position.set(10, 39);
            card.addChild(desc);
            parent.addChild(card);
            return { card, bg, name, status, desc, upgrade };
        });

        const researchLabPanel = drawHologramPanel(260, 90, { accent: COLOR_AMBER_300 });
        parent.addChild(researchLabPanel);

        const researchLabHeader = panelLabel('RESEARCH LAB', COLOR_AMBER_300, { size: 10, weight: '700' });
        researchLabHeader.position.set(12, 6);
        researchLabPanel.addChild(researchLabHeader);

        const researchLabDesc = panelLabel('+1 research slot', COLOR_SLATE_200, { size: 10 });
        researchLabDesc.position.set(12, 22);
        researchLabPanel.addChild(researchLabDesc);

        const researchLabCost = panelLabel('', COLOR_AMBER_300, { size: 9, weight: '700' });
        researchLabCost.position.set(12, 38);
        researchLabPanel.addChild(researchLabCost);

        const researchLabBtn = buildSimpleButton({
            text: 'EXPAND',
            width: 70,
            height: 22,
            accent: 'amber',
            onTap: () => this._upgradeResearchLab(),
        });
        researchLabPanel.addChild(researchLabBtn.container);

        return {
            motherShipHeader,
            berthSummary,
            berthDetail,
            upgradeCards,
            researchLabPanel,
            researchLabHeader,
            researchLabDesc,
            researchLabCost,
            researchLabBtn,
        };
    }

    _buildVisualContent(parent) {
        const header = panelLabel('MOTHER-SHIP + FLEET', COLOR_PURPLE_300, { size: 11, weight: '700' });
        header.position.set(12, 12);
        parent.addChild(header);

        const shipGraphic = new Graphics();
        parent.addChild(shipGraphic);

        const shipName = panelLabel('SV STARWARDEN', COLOR_SLATE_200, { size: 12, weight: '800' });
        parent.addChild(shipName);

        const shipStats = panelLabel('', COLOR_SLATE_400, { size: 10 });
        parent.addChild(shipStats);

        const slotsLabel = panelLabel('FLEET BERTHS', COLOR_CYAN_300, { size: 10 });
        parent.addChild(slotsLabel);

        const slotNodes = Array.from({ length: 20 }, () => {
            const slot = new Graphics();
            parent.addChild(slot);
            return slot;
        });

        const fleetText = panelLabel('', COLOR_SLATE_400, { size: 9 });
        parent.addChild(fleetText);

        return { header, shipGraphic, shipName, shipStats, slotsLabel, slotNodes, fleetText };
    }

    _setSubTab(tabId) {
        this._activeSubTab = tabId === 'motherShip' ? 'motherShip' : 'fleet';
        this._refresh();
        // The shipyard belongs to the AVAILABLE FLEET view only.
        this._refreshSide();
    }

    /** Called by HubScene on activation and on every resize. */
    layoutSide({ width = 276, height = 420 } = {}) {
        this._sideW = Math.max(180, Math.floor(width));
        this._sideH = Math.max(200, Math.floor(height));
        this._refreshSide();
    }

    /**
     * Move the yard into the hub's left panel and lay it out as one column
     * of blueprint cards, sized to the panel instead of to whatever space
     * the centre panel had left over.
     */
    _refreshSide() {
        const side = this._side;
        const n = this._nodes;
        const yard = n?.yard;
        if (!side?.list || !yard) return;
        if (yard.parent !== side.list) side.list.addChild(yard);

        const visible = this._activeSubTab === 'fleet';
        yard.visible = visible;
        if (!visible) return;

        const innerW = this._sideW - 24;
        n.buildHeader.position.set(0, 0);
        n.capacityText.position.set(0, 16);
        if (n.yardStatus) {
            n.yardStatus.style.wordWrap = true;
            n.yardStatus.style.wordWrapWidth = innerW;
            n.yardStatus.position.set(0, 32);
        }

        const cardW = innerW;
        const statusH = n.yardStatus ? Math.min(46, Math.max(14, n.yardStatus.height)) : 0;
        const startY = 34 + statusH + 8;

        // All six blueprints stay on screen at every viewport height: when
        // the panel is short the cards go compact (name + price + BUILD,
        // blurb dropped) instead of running off the bottom edge.
        const count = n.blueprintCards.length;
        const availH = Math.max(0, this._sideH - SIDE_LIST_TOP - startY - 8);
        const compact = availH < count * 54;
        const rowH = compact ? Math.max(38, Math.floor(availH / Math.max(1, count))) : 58;
        const cardH = Math.max(30, rowH - 8);

        n.blueprintCards.forEach((entry, i) => {
            entry.card.position.set(0, startY + i * rowH);
            entry.bg.clear();
            entry.bg.roundRect(0, 0, cardW, cardH, 4).fill({ color: 0x0f172a, alpha: 0.85 });
            entry.bg.roundRect(0, 0, cardW, cardH, 4).stroke({ color: 0x334155, width: 1, alpha: 0.5 });
            entry.desc.visible = !compact;
            entry.desc.style.wordWrap = true;
            entry.desc.style.wordWrapWidth = Math.max(80, cardW - 16);
            entry.cost.position.set(8, compact ? 18 : 30);
            entry.cost.style.wordWrap = true;
            entry.cost.style.wordWrapWidth = Math.max(80, cardW - 84);
            entry.buildBtn.container.position.set(cardW - 68, Math.max(4, cardH - 26));
            entry.card.hitArea = new Rectangle(0, 0, cardW, cardH);
        });
    }

    /**
     * Berth capacity from the pure `crew.fleetSlotLimit()` — base berths plus
     * the tech extras in the effect bundle — so the yard, `MetaState` and
     * settlement can never disagree about how big the fleet is. The tech table
     * below stays as the *display* of where those berths come from.
     *
     * (This used to read `effects.fleetSlots` as the capacity. That key counts
     * *extra* berths and starts at 0, so a fresh station had one berth for a
     * four-ship starter fleet and refused every BUILD order.)
     */
    _fleetSlotLimit() {
        if (typeof this.meta?.fleetSlots === 'function') return this.meta.fleetSlots();
        return fleetSlotLimit(this.meta?.getEffects?.() ?? null);
    }

    _refresh() {
        if (!this._nodes) return;
        const n = this._nodes;
        const fleet = this.meta?.fleetSnapshot() || [];
        const minerals = this.meta?.getHubResource('minerals') ?? 0;
        const credits = this.meta?.getHubResource('credits') ?? 0;
        const slotLimit = this._fleetSlotLimit();
        const hasFreeBerth = fleet.length < slotLimit;

        n.fleetContent.visible = this._activeSubTab === 'fleet';
        n.motherShipContent.visible = this._activeSubTab === 'motherShip';
        n.fleetTab.container.alpha = this._activeSubTab === 'fleet' ? 1 : 0.62;
        n.motherShipTab.container.alpha = this._activeSubTab === 'motherShip' ? 1 : 0.62;

        this._refreshFleetList(fleet, minerals, hasFreeBerth, slotLimit);
        this._refreshMotherShip(fleet, minerals, credits, slotLimit);
        this._refreshVisual(fleet, slotLimit);
    }

    _refreshFleetList(fleet, minerals, hasFreeBerth, slotLimit) {
        const n = this._nodes;
        n.fleetList.removeChildren();
        fleet.forEach((s, i) => {
            const row = new Container();
            row.eventMode = 'static';
            row.cursor = 'pointer';

            const isSelected = s.id === this._selectedShipId;
            const bg = new Graphics();
            bg.roundRect(0, 0, 216, 38, 4).fill({ color: isSelected ? 0x1e3a5f : 0x0f172a, alpha: 0.85 });
            bg.roundRect(0, 0, 216, 38, 4).stroke({ color: isSelected ? COLOR_CYAN_300 : 0x334155, width: 1, alpha: 0.6 });
            row.addChild(bg);

            const classColor = CLASS_COLORS[s.className] || COLOR_SLATE_200;
            const nameLabel = panelLabel(s.name, COLOR_SLATE_200, { size: 10, weight: '700' });
            nameLabel.position.set(10, 3);
            row.addChild(nameLabel);

            const classLabel = panelLabel(s.className, classColor, { size: 9 });
            classLabel.position.set(10, 17);
            row.addChild(classLabel);

            const hullBg = new Graphics();
            hullBg.roundRect(120, 20, 80, 8, 3).fill({ color: 0x1e293b });
            row.addChild(hullBg);

            const hullFill = new Graphics();
            const hullW = Math.max(0, (s.hull / 100) * 80);
            const hullColor = s.hull > 60 ? COLOR_EMERALD_300 : s.hull > 30 ? COLOR_AMBER_300 : COLOR_ROSE_300;
            hullFill.roundRect(120, 20, hullW, 8, 3).fill({ color: hullColor });
            row.addChild(hullFill);

            const hullPct = panelLabel(`${s.hull}%`, COLOR_SLATE_400, { size: 8 });
            hullPct.position.set(204, 17);
            row.addChild(hullPct);

            const statusLabel = panelLabel(s.status, s.status === 'Standby' ? COLOR_EMERALD_300 : COLOR_AMBER_300, { size: 8 });
            statusLabel.position.set(120, 5);
            row.addChild(statusLabel);

            row.position.set(12, 34 + i * 42);
            row.hitArea = new Rectangle(0, 0, 216, 38);
            row.on('pointertap', () => { this._selectedShipId = s.id; this._refresh(); });
            n.fleetList.addChild(row);
        });

        const selected = fleet.find((s) => s.id === this._selectedShipId);
        if (!selected && fleet.length > 0) {
            this._selectedShipId = fleet[0].id;
            return this._refresh();
        }

        if (selected) {
            n.detailName.text = selected.name;
            n.detailClass.text = `Class: ${selected.className}  \u00B7  fits ${specialtyFor(selected.className)}`;
            n.detailHull.text = `Hull: ${selected.hull}%`;
            n.detailStatus.text = `Status: ${selected.status}`;
            n.detailPanel.visible = true;

            const damage = 100 - selected.hull;
            const cost = damage * REPAIR_COST_PER_POINT;
            n.repairBtn.container.visible = damage > 0 && selected.status === 'Standby';
            n.repairCost.text = damage > 0 ? `${cost} minerals` : '';
            n.repairCost.visible = damage > 0 && selected.status === 'Standby';
            n.repairBtn.container.alpha = minerals >= cost ? 1 : 0.4;
            n.repairBtn.container.eventMode = minerals >= cost && damage > 0 ? 'static' : 'none';
            n.disassembleBtn.container.visible = selected.status === 'Standby';
        } else {
            n.detailPanel.visible = false;
        }

        n.capacityText.text = `Fleet berths: ${fleet.length}/${slotLimit}${hasFreeBerth ? '' : ' \u00B7 capacity full'}`;
        if (n.yardStatus) n.yardStatus.text = this._yardStatus;
        n.blueprintCards.forEach((entry) => {
            const canBuild = minerals >= entry.bp.cost && hasFreeBerth;
            entry.buildBtn.container.alpha = canBuild ? 1 : 0.4;
            entry.buildBtn.container.eventMode = canBuild ? 'static' : 'none';
        });
    }

    _refreshMotherShip(fleet, minerals, credits, slotLimit) {
        const n = this._nodes;
        const completed = this.meta?.getResearchState?.().completed || [];
        n.berthSummary.text = `SV Starwarden berths: ${fleet.length}/${slotLimit}`;
        const extra = Number.isFinite(this.meta?.getEffects?.().fleetSlots)
            ? Math.max(0, Math.floor(this.meta.getEffects().fleetSlots))
            : 0;
        n.berthDetail.text = extra > 0
            ? `Base ${BASE_FLEET_SLOTS} berths + ${extra} from research = ${slotLimit}.`
            : `Base mother-ship capacity is ${BASE_FLEET_SLOTS} berths. Research completions add more.`;

        n.upgradeCards.forEach((entry) => {
            const unlocked = completed.includes(entry.upgrade.nodeId);
            entry.status.text = unlocked ? `ONLINE  ·  +${entry.upgrade.slots} slots` : `TECH TREE  ·  ${entry.upgrade.nodeId}`;
            entry.status.style.fill = unlocked ? COLOR_EMERALD_300 : COLOR_AMBER_300;
        });

        const currentMax = this.meta ? (this.meta.getResearchState().maxConcurrent || 2) : 2;
        const canUpgrade = currentMax < RESEARCH_LAB_UPGRADE.max
            && minerals >= RESEARCH_LAB_UPGRADE.cost.minerals
            && credits >= RESEARCH_LAB_UPGRADE.cost.credits;

        n.researchLabCost.text = `${RESEARCH_LAB_UPGRADE.cost.minerals} minerals  ·  ${RESEARCH_LAB_UPGRADE.cost.credits} credits`;
        n.researchLabBtn.container.alpha = canUpgrade ? 1 : 0.4;
        n.researchLabBtn.container.eventMode = canUpgrade ? 'static' : 'none';
        n.researchLabDesc.text = `Current: ${currentMax} slots  →  ${RESEARCH_LAB_UPGRADE.effect}`;
    }

    _refreshVisual(fleet, slotLimit) {
        const v = this._nodes.visualContent;
        v.shipStats.text = `Carrier core online · Fleet capacity ${fleet.length}/${slotLimit}`;
        v.slotNodes.forEach((slot, i) => {
            slot.clear();
            const isUnlocked = i < slotLimit;
            const ship = fleet[i];
            const color = ship ? (CLASS_COLORS[ship.className] || COLOR_CYAN_300) : 0x1e293b;
            const alpha = ship ? 0.95 : (isUnlocked ? 0.72 : 0.24);
            slot.roundRect(0, 0, 16, 16, 4).fill({ color, alpha });
            slot.roundRect(0, 0, 16, 16, 4).stroke({ color: isUnlocked ? COLOR_CYAN_300 : 0x475569, width: 1, alpha: isUnlocked ? 0.65 : 0.35 });
        });
        v.fleetText.text = fleet.length > 0
            ? fleet.map((s, i) => `${String(i + 1).padStart(2, '0')} ${s.name} · ${s.className}`).join('\n')
            : 'No ships assigned to fleet berths.';
    }

    _buildShip(bp) {
        if (!this.meta) return;
        const fleet = this.meta.fleetSnapshot();
        const slotLimit = this._fleetSlotLimit();
        if (fleet.length >= slotLimit) {
            this._yardStatus = `All ${slotLimit} berths occupied \u2014 disassemble a hull or research more slots.`;
            this._refresh();
            return;
        }
        const minerals = this.meta.getHubResource('minerals') || 0;
        if (minerals < bp.cost) {
            this._yardStatus = `Need ${bp.cost - minerals} more minerals for the ${bp.baseName}.`;
            this._refresh();
            return;
        }
        this.meta.setHubResource('minerals', minerals - bp.cost);
        this._shipCounter++;
        const id = `ship-built-${Date.now()}-${this._shipCounter}`;
        const name = `${bp.baseName}-${String(this._shipCounter).padStart(2, '0')}`;
        this.meta.addShip({ id, name, className: bp.className });
        this._selectedShipId = id;
        this._yardStatus = `${name} launched \u00B7 ${bp.cost} minerals \u00B7 fits ${specialtyFor(bp.className)}.`;
        this._refresh();
    }

    _repairShip() {
        if (!this.meta || !this._selectedShipId) return;
        const ship = this.meta.fleetSnapshot().find((s) => s.id === this._selectedShipId);
        if (!ship || ship.hull >= 100 || ship.status !== 'Standby') return;
        const damage = 100 - ship.hull;
        const cost = damage * REPAIR_COST_PER_POINT;
        const minerals = this.meta.getHubResource('minerals') || 0;
        if (minerals < cost) {
            this._yardStatus = `Repair needs ${cost} minerals \u2014 ${cost - minerals} short.`;
            this._refresh();
            return;
        }
        this.meta.setHubResource('minerals', minerals - cost);
        this.meta.setShipHull(this._selectedShipId, 100);
        // Lifetime stat: hull wear is a real cost, so the yard counts it.
        this.meta.noteHullRepair(damage);
        this._yardStatus = `${ship.name} patched to 100% hull for ${cost} minerals.`;
        this._refresh();
    }

    _disassembleShip() {
        if (!this.meta || !this._selectedShipId) return;
        const ship = this.meta.fleetSnapshot().find((s) => s.id === this._selectedShipId);
        if (!ship || ship.status !== 'Standby') {
            this._yardStatus = ship ? `${ship.name} is ${ship.status} \u2014 recall it before scrapping.` : '';
            this._refresh();
            return;
        }
        const bp = BLUEPRINTS.find((b) => b.className === ship.className);
        const returnMinerals = Math.floor((bp?.cost || 500) * DISASSEMBLE_RETURN);
        this.meta.removeShip(this._selectedShipId);
        this.meta.setHubResource('minerals', (this.meta.getHubResource('minerals') || 0) + returnMinerals);
        this._selectedShipId = null;
        this._yardStatus = `${ship.name} broken down \u00B7 ${returnMinerals} minerals recovered.`;
        this._refresh();
    }

    _upgradeResearchLab() {
        if (!this.meta) return;

        const current = this.meta.getResearchState();
        const currentMax = current.maxConcurrent || 2;
        if (currentMax >= RESEARCH_LAB_UPGRADE.max) return;

        const minerals = this.meta.getHubResource('minerals') || 0;
        const credits = this.meta.getHubResource('credits') || 0;

        const costM = RESEARCH_LAB_UPGRADE.cost.minerals;
        const costC = RESEARCH_LAB_UPGRADE.cost.credits;

        if (minerals < costM || credits < costC) return;

        this.meta.setHubResource('minerals', minerals - costM);
        this.meta.setHubResource('credits', credits - costC);
        this.meta.upgradeResearchSlots();
        this._refresh();
    }

    _layout(w, h) {
        if (!this._nodes) return;
        const n = this._nodes;

        n.title.position.set(16, 12);
        n.fleetTab.container.position.set(16, 36);
        n.motherShipTab.container.position.set(166, 36);

        const topY = 70;
        const panelH = Math.max(280, h - topY - 12);
        const visualW = Math.min(340, Math.max(260, Math.floor(w * 0.30)));
        const contentW = Math.max(420, w - visualW - 30);
        n.contentPanel.position.set(8, topY);
        n.visualPanel.position.set(18 + contentW, topY);
        redrawHologramPanel(n.contentPanel, contentW, panelH, COLOR_CYAN_500);
        redrawHologramPanel(n.visualPanel, visualW, panelH, COLOR_PURPLE_300);

        this._layoutFleetContent(contentW, panelH);
        this._layoutMotherShipContent(contentW, panelH);
        this._layoutVisualContent(visualW, panelH);
    }

    _layoutFleetContent(w, h) {
        const n = this._nodes;
        const leftW = Math.min(250, Math.max(224, Math.floor(w * 0.42)));
        const rightX = leftW + 18;
        const rightW = Math.max(170, w - rightX - 14);

        n.fleetList.position.set(0, 0);
        n.detailPanel.position.set(rightX, 34);
        redrawHologramPanel(n.detailPanel, rightW, 132, COLOR_CYAN_500);
        n.repairBtn.container.position.set(12, 94);
        n.repairCost.position.set(98, 99);
        n.disassembleBtn.container.position.set(Math.min(180, rightW - 116), 94);

        // The yard lives in the left panel now (see `_refreshSide`), so
        // the centre keeps the fleet list and the selected-hull read-out.
        const maxVisibleRows = Math.max(0, Math.floor((h - 50) / 42));
        n.fleetList.children.forEach((row, i) => { row.visible = i < maxVisibleRows; });
    }

    _layoutMotherShipContent(w, h) {
        const n = this._nodes;
        const cardW = Math.max(260, w - 28);
        n.upgradeCards.forEach((entry, i) => {
            entry.card.position.set(12, 82 + i * 66);
            entry.bg.clear();
            entry.bg.roundRect(0, 0, cardW, 58, 4).fill({ color: 0x0f172a, alpha: 0.8 });
            entry.bg.roundRect(0, 0, cardW, 58, 4).stroke({ color: 0x6d28d9, width: 1, alpha: 0.55 });
            entry.desc.style.wordWrapWidth = Math.max(180, cardW - 22);
        });
        const researchY = Math.min(h - 104, 82 + n.upgradeCards.length * 66 + 10);
        n.researchLabPanel.position.set(12, researchY);
        redrawHologramPanel(n.researchLabPanel, cardW, 90, COLOR_AMBER_300);
        n.researchLabBtn.container.position.set(cardW - 84, 34);
    }

    _layoutVisualContent(w, h) {
        const v = this._nodes.visualContent;
        v.header.position.set(12, 12);
        v.shipGraphic.clear();
        const cx = Math.round(w / 2);
        const shipY = 78;
        v.shipGraphic.poly([
            cx, shipY - 42,
            cx + 92, shipY,
            cx + 38, shipY + 34,
            cx, shipY + 22,
            cx - 38, shipY + 34,
            cx - 92, shipY,
        ]).fill({ color: 0x111827, alpha: 0.9 });
        v.shipGraphic.poly([
            cx, shipY - 42,
            cx + 92, shipY,
            cx + 38, shipY + 34,
            cx, shipY + 22,
            cx - 38, shipY + 34,
            cx - 92, shipY,
        ]).stroke({ color: COLOR_PURPLE_300, width: 2, alpha: 0.8 });
        v.shipGraphic.circle(cx, shipY, 14).fill({ color: 0x0e7490, alpha: 0.9 });
        v.shipGraphic.circle(cx, shipY, 14).stroke({ color: COLOR_CYAN_300, width: 1.5, alpha: 0.9 });

        v.shipName.position.set(14, 126);
        v.shipStats.position.set(14, 146);
        v.shipStats.style.wordWrap = true;
        v.shipStats.style.wordWrapWidth = Math.max(160, w - 28);
        v.slotsLabel.position.set(14, 178);

        const slotSize = 16;
        const gap = 6;
        const cols = Math.max(5, Math.min(10, Math.floor((w - 28) / (slotSize + gap))));
        v.slotNodes.forEach((slot, i) => {
            const x = 14 + (i % cols) * (slotSize + gap);
            const y = 200 + Math.floor(i / cols) * (slotSize + gap);
            slot.position.set(x, y);
        });

        v.fleetText.position.set(14, Math.min(h - 170, 258));
        v.fleetText.style.wordWrap = true;
        v.fleetText.style.wordWrapWidth = Math.max(160, w - 28);
    }
}
