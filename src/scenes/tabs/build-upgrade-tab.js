import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import {
    drawHologramPanel,
    redrawHologramPanel,
    panelLabel,
    buildSimpleButton,
} from '../../pixi-ui-kit.js';

const COLOR_CYAN_300 = 0x67e8f9;
const COLOR_CYAN_500 = 0x06b6d4;
const COLOR_SLATE_200 = 0xe2e8f0;
const COLOR_SLATE_400 = 0x94a3b8;
const COLOR_AMBER_300 = 0xfcd34d;
const COLOR_EMERALD_300 = 0x6ee7b7;

const CALLOUTS = Object.freeze([
    { id: 'dock-a', label: 'Docking Arms', note: 'Queue throughput +10%', nx: 0.36, ny: 0.34, lx: 0.12, ly: 0.22 },
    { id: 'core', label: 'Reactor Spine', note: 'Power cap +1 module', nx: 0.50, ny: 0.50, lx: 0.11, ly: 0.52 },
    { id: 'array', label: 'Sensor Crown', note: 'Survey precision +8%', nx: 0.64, ny: 0.30, lx: 0.78, ly: 0.18 },
    { id: 'yard', label: 'Fabrication Yard', note: 'Build time -12%', nx: 0.62, ny: 0.66, lx: 0.80, ly: 0.62 },
]);

const BUILD_QUEUE = Object.freeze([
    { name: 'Shielded Cargo Pods', eta: '01:24:18', status: 'Building', color: COLOR_AMBER_300 },
    { name: 'Mk-II Mining Lasers', eta: 'Queued', status: 'Slot #2', color: COLOR_CYAN_300 },
    { name: 'Hull Nanoweave', eta: 'Queued', status: 'Slot #3', color: COLOR_CYAN_300 },
]);

const UPGRADE_CARDS = Object.freeze([
    { title: 'Dock Capacity', level: 2, effect: '+1 active mission slot', cost: '420 minerals', accent: COLOR_CYAN_300 },
    { title: 'Station Armor', level: 1, effect: 'Reduce hazard damage by 10%', cost: '680 minerals', accent: COLOR_EMERALD_300 },
]);

export class BuildUpgradeTab {
    constructor({ parent }) {
        if (!parent) throw new Error('BuildUpgradeTab: parent container is required');
        this.parent = parent;
        this.root = new Container();
        this.root.visible = false;
        this.parent.addChild(this.root);
        this._nodes = null;
    }

    get visible() {
        return !!this.root.visible;
    }

    show() {
        if (!this._nodes) this._build();
        this.root.visible = true;
    }

    hide() {
        this.root.visible = false;
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
        const title = new Text({
            text: 'BUILD / UPGRADE  ·  NOVA STATION',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: '800',
                letterSpacing: 2,
                fill: COLOR_AMBER_300,
            }),
        });
        title.position.set(16, 12);
        this.root.addChild(title);

        const composition = new Container();
        this.root.addChild(composition);

        const starfield = new Graphics();
        composition.addChild(starfield);

        const planet = new Graphics();
        composition.addChild(planet);

        const station = new Graphics();
        composition.addChild(station);

        const calloutLines = new Graphics();
        composition.addChild(calloutLines);

        const calloutLabels = CALLOUTS.map((callout) => {
            const label = new Text({
                text: `${callout.label}\n${callout.note}`,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 10,
                    fontWeight: '700',
                    fill: COLOR_SLATE_200,
                    stroke: { color: 0x020617, width: 3, alpha: 0.92 },
                    lineHeight: 14,
                }),
            });
            label.anchor.set(callout.lx < 0.5 ? 0 : 1, 0.5);
            composition.addChild(label);
            return { callout, label };
        });

        const rightPane = this._buildRightPane();
        this.root.addChild(rightPane.container);

        this._nodes = {
            title,
            composition,
            starfield,
            planet,
            station,
            calloutLines,
            calloutLabels,
            rightPane,
        };
    }

    _buildRightPane() {
        const container = new Container();

        const queue = drawHologramPanel(240, 156, { accent: COLOR_CYAN_500 });
        container.addChild(queue);
        const queueHeader = panelLabel('BUILD QUEUE', COLOR_CYAN_300, { size: 11 });
        queueHeader.position.set(12, 9);
        queue.addChild(queueHeader);

        const queueRows = BUILD_QUEUE.map((item, i) => {
            const y = 32 + i * 36;
            const dot = new Graphics();
            dot.circle(0, 0, 4).fill({ color: item.color, alpha: 0.95 });
            dot.position.set(16, y + 8);
            queue.addChild(dot);

            const name = new Text({
                text: item.name,
                style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: COLOR_SLATE_200 }),
            });
            name.position.set(28, y);
            queue.addChild(name);

            const meta = new Text({
                text: `${item.status} · ${item.eta}`,
                style: new TextStyle({ fontFamily: 'Inter, sans-serif', fontSize: 10, fill: COLOR_SLATE_400 }),
            });
            meta.position.set(28, y + 15);
            queue.addChild(meta);
            return { dot, name, meta };
        });

        const cards = UPGRADE_CARDS.map((card) => {
            const cardShell = drawHologramPanel(240, 116, { accent: card.accent });
            container.addChild(cardShell);

            const title = new Text({
                text: `${card.title}  ·  LV ${card.level}`,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fontWeight: '800',
                    letterSpacing: 1,
                    fill: card.accent,
                }),
            });
            title.position.set(12, 10);
            cardShell.addChild(title);

            const effect = new Text({
                text: card.effect,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fill: COLOR_SLATE_200,
                    wordWrap: true,
                    wordWrapWidth: 150,
                }),
            });
            effect.position.set(12, 34);
            cardShell.addChild(effect);

            const cost = new Text({
                text: `Cost: ${card.cost}`,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 10,
                    fontWeight: '700',
                    fill: COLOR_CYAN_300,
                }),
            });
            cost.position.set(12, 90);
            cardShell.addChild(cost);

            const apply = buildSimpleButton({ text: 'APPLY', width: 66, height: 28, accent: 'cyan', onTap: () => {} });
            cardShell.addChild(apply.container);

            return { card, shell: cardShell, title, effect, cost, apply };
        });

        return { container, queue, queueHeader, queueRows, cards };
    }

    _layout(width, height) {
        const n = this._nodes;

        const topPad = 42;
        const sidePad = 14;
        const rightW = Math.max(228, Math.min(250, Math.floor(width * 0.34)));
        const centerW = Math.max(240, width - sidePad * 3 - rightW);
        const centerH = Math.max(220, height - topPad - 12);

        n.composition.position.set(sidePad, topPad);
        n.rightPane.container.position.set(sidePad * 2 + centerW, topPad + 6);

        this._drawStarfield(n.starfield, centerW, centerH);
        this._drawPlanet(n.planet, centerW, centerH);
        this._drawStation(n.station, centerW, centerH);
        this._drawCallouts(n.calloutLines, n.calloutLabels, centerW, centerH);

        redrawHologramPanel(n.rightPane.queue, rightW, 156, { accent: COLOR_CYAN_500 });

        let y = 0;
        n.rightPane.queue.position.set(0, y);
        y += 168;

        n.rightPane.cards.forEach((entry) => {
            redrawHologramPanel(entry.shell, rightW, 116, { accent: entry.card.accent });
            entry.effect.style.wordWrapWidth = Math.max(120, rightW - 90);
            entry.apply.container.position.set(rightW - entry.apply.width - 12, 74);
            entry.shell.position.set(0, y);
            y += 126;
        });
    }

    _drawStarfield(g, w, h) {
        g.clear();
        g.roundRect(0, 0, w, h, 12).fill({ color: 0x030712, alpha: 0.88 });
        g.roundRect(0, 0, w, h, 12).stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.18 });
        for (let i = 0; i < 110; i++) {
            const x = (Math.sin(i * 127.13) * 0.5 + 0.5) * (w - 20) + 10;
            const y = (Math.cos(i * 93.73) * 0.5 + 0.5) * (h - 20) + 10;
            const r = (i % 7 === 0) ? 1.4 : 0.8;
            g.circle(x, y, r).fill({ color: 0x93c5fd, alpha: i % 5 === 0 ? 0.65 : 0.28 });
        }
    }

    _drawPlanet(g, w, h) {
        g.clear();
        const px = w * 0.42;
        const py = h * 0.58;
        const pr = Math.min(w, h) * 0.24;
        g.circle(px + pr * 0.15, py + pr * 0.2, pr * 1.05).fill({ color: 0x020617, alpha: 0.6 });
        g.circle(px, py, pr).fill({ color: 0x1e293b, alpha: 0.95 });
        g.circle(px - pr * 0.24, py - pr * 0.2, pr * 0.82).fill({ color: 0x334155, alpha: 0.9 });
        g.ellipse(px + pr * 0.2, py + pr * 0.45, pr * 1.05, pr * 0.22).stroke({ color: COLOR_CYAN_300, width: 2, alpha: 0.35 });
    }

    _drawStation(g, w, h) {
        g.clear();
        const cx = w * 0.54;
        const cy = h * 0.46;
        g.circle(cx, cy, 24).stroke({ color: COLOR_SLATE_200, width: 1.2, alpha: 0.8 });
        g.circle(cx, cy, 9).fill({ color: COLOR_CYAN_300, alpha: 0.85 });
        g.rect(cx - 50, cy - 6, 100, 12).stroke({ color: COLOR_SLATE_200, width: 1.1, alpha: 0.72 });
        g.rect(cx - 8, cy - 52, 16, 104).stroke({ color: COLOR_SLATE_200, width: 1.1, alpha: 0.72 });
        g.poly([cx - 92, cy - 10, cx - 56, cy - 28, cx - 56, cy + 8]).stroke({ color: COLOR_SLATE_400, width: 1, alpha: 0.75 });
        g.poly([cx + 92, cy + 10, cx + 56, cy - 8, cx + 56, cy + 28]).stroke({ color: COLOR_SLATE_400, width: 1, alpha: 0.75 });
        g.moveTo(cx - 70, cy - 34).lineTo(cx - 18, cy - 10).stroke({ color: COLOR_EMERALD_300, width: 1, alpha: 0.55 });
        g.moveTo(cx + 70, cy + 34).lineTo(cx + 18, cy + 10).stroke({ color: COLOR_EMERALD_300, width: 1, alpha: 0.55 });
    }

    _drawCallouts(lines, labels, w, h) {
        lines.clear();
        labels.forEach(({ callout, label }) => {
            const px = w * callout.nx;
            const py = h * callout.ny;
            const lx = w * callout.lx;
            const ly = h * callout.ly;
            label.position.set(lx, ly);
            const elbowX = callout.lx < 0.5 ? lx + 72 : lx - 72;
            lines.moveTo(lx, ly).lineTo(elbowX, ly).lineTo(px, py)
                .stroke({ color: COLOR_CYAN_300, width: 1, alpha: 0.65 });
            lines.circle(px, py, 3).fill({ color: COLOR_EMERALD_300, alpha: 0.9 });
        });
        lines.roundRect(0, 0, w, h, 12).stroke({ color: COLOR_AMBER_300, width: 1, alpha: 0.12 });
    }
}
