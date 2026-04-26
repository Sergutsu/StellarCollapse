// BuildUpgradeTab -- ship construction, upgrade & disassembly. Mounts
// into the hub center panel when BUILD/UPGRADE tab is clicked.
//
// Left: current fleet list with hull bars + UPGRADE/DISASSEMBLE actions.
// Right: ship construction menu (blueprints that cost minerals).

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
    { className: 'Scout',     baseName: 'Scout',     cost: 400,  desc: 'Fast recon vessel. Low hull but quick missions.' },
    { className: 'Defense',   baseName: 'Defender',   cost: 800,  desc: 'Armored patrol ship. Strong in combat missions.' },
    { className: 'Resource',  baseName: 'Harvester',  cost: 600,  desc: 'Mining vessel. Bonus mineral yield on resource missions.' },
    { className: 'Terraform', baseName: 'Terraformer', cost: 1000, desc: 'Planetary engineering. Enables terraform missions.' },
    { className: 'Trade',     baseName: 'Trader',     cost: 500,  desc: 'Cargo hauler. Extra credits from trade missions.' },
    { className: 'Frigate',   baseName: 'Frigate',    cost: 1200, desc: 'Heavy warship. Highest hull, strongest combat.' },
]);

const REPAIR_COST_PER_POINT = 3; // minerals per hull point
const DISASSEMBLE_RETURN = 0.4;  // fraction of build cost returned as minerals

export class BuildUpgradeTab {
    constructor({ parent, meta }) {
        if (!parent) throw new Error('BuildUpgradeTab: parent container is required');
        this.parent = parent;
        this.meta = meta;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
        this._selectedShipId = null;
        this._shipCounter = 0;
    }

    get visible() { return !!this.root.visible; }

    show() {
        if (!this._nodes) this._build();
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
        const title = panelLabel('BUILD / UPGRADE  ·  SHIPYARD', COLOR_AMBER_300, { size: 14, weight: '800' });
        title.style.letterSpacing = 2;
        title.position.set(16, 12);
        this.root.addChild(title);

        // Left pane: current fleet.
        const fleetPanel = drawHologramPanel(240, 400, { accent: COLOR_CYAN_500 });
        this.root.addChild(fleetPanel);

        const fleetHeader = panelLabel('CURRENT FLEET', COLOR_CYAN_300, { size: 11 });
        fleetHeader.position.set(12, 9);
        fleetPanel.addChild(fleetHeader);

        const fleetList = new Container();
        fleetPanel.addChild(fleetList);

        // Ship detail pane (selected ship info + actions).
        const detailPanel = drawHologramPanel(260, 160, { accent: COLOR_CYAN_500 });
        this.root.addChild(detailPanel);

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
            height: 26,
            accent: 'green',
            onTap: () => this._repairShip(),
        });
        detailPanel.addChild(repairBtn.container);

        const repairCost = panelLabel('', COLOR_SLATE_400, { size: 9 });
        detailPanel.addChild(repairCost);

        const disassembleBtn = buildSimpleButton({
            text: 'DISASSEMBLE',
            width: 100,
            height: 26,
            accent: 'amber',
            onTap: () => this._disassembleShip(),
        });
        detailPanel.addChild(disassembleBtn.container);

        // Right pane: blueprints for building.
        const buildPanel = drawHologramPanel(260, 300, { accent: 0x14532d });
        this.root.addChild(buildPanel);

        const buildHeader = panelLabel('BUILD NEW SHIP', COLOR_EMERALD_300, { size: 11, weight: '700' });
        buildHeader.position.set(12, 9);
        buildPanel.addChild(buildHeader);

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

            const cost = panelLabel(`${bp.cost} minerals`, COLOR_AMBER_300, { size: 9, weight: '700' });
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

            buildPanel.addChild(card);
            return { card, bg, name, desc, cost, buildBtn, bp };
        });

        this._nodes = {
            title,
            fleetPanel, fleetHeader, fleetList,
            detailPanel, detailName, detailClass, detailHull, detailStatus,
            repairBtn, repairCost, disassembleBtn,
            buildPanel, buildHeader, blueprintCards,
        };
    }

    _refresh() {
        if (!this._nodes) return;
        const n = this._nodes;
        const fleet = this.meta?.fleetSnapshot() || [];
        const minerals = this.meta?.getHubResource('minerals') ?? 0;

        // Rebuild fleet list.
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

            // Hull bar.
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

            row.position.set(12, 30 + i * 42);
            row.hitArea = new Rectangle(0, 0, 216, 38);
            row.on('pointertap', () => { this._selectedShipId = s.id; this._refresh(); });
            n.fleetList.addChild(row);
        });

        // Detail panel.
        const selected = fleet.find((s) => s.id === this._selectedShipId);
        if (!selected && fleet.length > 0) {
            this._selectedShipId = fleet[0].id;
            return this._refresh();
        }

        if (selected) {
            n.detailName.text = selected.name;
            n.detailClass.text = `Class: ${selected.className}`;
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

        // Update blueprint affordance.
        n.blueprintCards.forEach((entry) => {
            const canBuild = minerals >= entry.bp.cost;
            entry.buildBtn.container.alpha = canBuild ? 1 : 0.4;
            entry.buildBtn.container.eventMode = canBuild ? 'static' : 'none';
        });
    }

    _buildShip(bp) {
        if (!this.meta) return;
        const minerals = this.meta.getHubResource('minerals') || 0;
        if (minerals < bp.cost) return;
        this.meta.setHubResource('minerals', minerals - bp.cost);
        this._shipCounter++;
        const id = `ship-built-${Date.now()}-${this._shipCounter}`;
        const name = `${bp.baseName}-${String(this._shipCounter).padStart(2, '0')}`;
        this.meta.addShip({ id, name, className: bp.className });
        this._selectedShipId = id;
        this._refresh();
    }

    _repairShip() {
        if (!this.meta || !this._selectedShipId) return;
        const ship = this.meta.fleetSnapshot().find((s) => s.id === this._selectedShipId);
        if (!ship || ship.hull >= 100 || ship.status !== 'Standby') return;
        const damage = 100 - ship.hull;
        const cost = damage * REPAIR_COST_PER_POINT;
        const minerals = this.meta.getHubResource('minerals') || 0;
        if (minerals < cost) return;
        this.meta.setHubResource('minerals', minerals - cost);
        this.meta.setShipHull(this._selectedShipId, 100);
        this._refresh();
    }

    _disassembleShip() {
        if (!this.meta || !this._selectedShipId) return;
        const ship = this.meta.fleetSnapshot().find((s) => s.id === this._selectedShipId);
        if (!ship || ship.status !== 'Standby') return;
        const bp = BLUEPRINTS.find((b) => b.className === ship.className);
        const returnMinerals = Math.floor((bp?.cost || 500) * DISASSEMBLE_RETURN);
        this.meta.removeShip(this._selectedShipId);
        this.meta.setHubResource('minerals', (this.meta.getHubResource('minerals') || 0) + returnMinerals);
        this._selectedShipId = null;
        this._refresh();
    }

    _layout(w, h) {
        if (!this._nodes) return;
        const n = this._nodes;

        n.title.position.set(16, 12);

        // Fleet panel (left).
        const fleetW = Math.min(250, Math.floor(w * 0.42));
        const fleetH = h - 50;
        n.fleetPanel.position.set(8, 38);
        redrawHologramPanel(n.fleetPanel, fleetW, fleetH, { accent: COLOR_CYAN_500 });

        // Detail panel (right top).
        const rightX = fleetW + 24;
        const rightW = Math.max(240, w - rightX - 8);
        const detailH = 160;
        n.detailPanel.position.set(rightX, 38);
        redrawHologramPanel(n.detailPanel, rightW, detailH, { accent: COLOR_CYAN_500 });

        n.repairBtn.container.position.set(12, 92);
        n.repairCost.position.set(98, 97);
        n.disassembleBtn.container.position.set(12, 124);

        // Build panel (right bottom).
        const buildY = 38 + detailH + 12;
        const buildH = Math.max(200, h - buildY - 10);
        n.buildPanel.position.set(rightX, buildY);
        redrawHologramPanel(n.buildPanel, rightW, buildH, { accent: 0x14532d });

        // Position blueprint cards.
        const cardW = rightW - 24;
        n.blueprintCards.forEach((entry, i) => {
            entry.card.position.set(12, 30 + i * 54);
            entry.bg.clear();
            entry.bg.roundRect(0, 0, cardW, 48, 4).fill({ color: 0x0f172a, alpha: 0.8 });
            entry.bg.roundRect(0, 0, cardW, 48, 4).stroke({ color: 0x334155, width: 1, alpha: 0.5 });
            entry.buildBtn.container.position.set(cardW - 68, 12);
            entry.desc.style.wordWrapWidth = Math.max(80, cardW - 100);
        });
    }
}
