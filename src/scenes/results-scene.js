// Mission-report overlay shown when a run ends. Was originally built
// inline inside PixiView (_buildResultsScreen / _populateResultsScreen
// / _layoutResultsScreen / showResultsScreen / hideResultsScreen).
// Splitting it out is the first step of the PixiView -> scenes
// refactor captured in ADR-0009.
//
// Dependencies are injected via the constructor so this module stays
// decoupled from PixiView internals -- it only knows it has a Pixi
// Application, a UI root Container to attach to, and two shared
// helpers for panel chrome + buttons. Later PRs (HubScene, GameScene)
// will move those helpers into a proper pixi-ui-kit module.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { ORES } from '../missions.js';

// Local alias for readability; keeps this file independent of whatever
// "helper shape" PixiView uses internally. The only contract is that
// these callables return Pixi display objects / records matching the
// signatures used by the original PixiView implementation.
//
//   drawHologramPanel(w, h, { accent }) -> Container
//   buildStartButton({ text, width, height, onTap }) -> { container, ... }

export class ResultsScene {
    constructor({ app, uiRoot, drawHologramPanel, buildStartButton, palette = {} }) {
        if (!app) throw new Error('ResultsScene: app is required');
        if (!uiRoot) throw new Error('ResultsScene: uiRoot is required');
        if (typeof drawHologramPanel !== 'function') {
            throw new Error('ResultsScene: drawHologramPanel helper is required');
        }
        if (typeof buildStartButton !== 'function') {
            throw new Error('ResultsScene: buildStartButton helper is required');
        }
        this.app = app;
        this.uiRoot = uiRoot;
        this._drawHologramPanel = drawHologramPanel;
        this._buildStartButton = buildStartButton;
        this._palette = palette;

        this._nodes = null;
        this._onContinue = null;
    }

    get visible() {
        return this._nodes?.container?.visible === true;
    }

    // Build the overlay lazily on first show so init() stays fast and
    // stateless -- we only pay the construction cost once a player
    // actually finishes a run.
    _build() {
        const container = new Container();
        container.eventMode = 'static';
        container.visible = false;
        this.uiRoot.addChild(container);

        const dim = new Graphics();
        dim.eventMode = 'static';
        container.addChild(dim);

        const panelW = 620;
        const panelH = 500;
        const panel = this._drawHologramPanel(panelW, panelH, { accent: 0x22d3ee });
        container.addChild(panel);

        const title = new Text({
            text: 'MISSION REPORT',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 20,
                fontWeight: '800',
                letterSpacing: 3,
                fill: 0x67e8f9,
                dropShadow: { color: 0x67e8f9, alpha: 0.3, blur: 8, distance: 0, angle: 0 },
            }),
        });
        title.position.set(20, 16);
        panel.addChild(title);

        const asteroid = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                fontWeight: '700',
                fill: 0xf8fafc,
                wordWrap: true,
                wordWrapWidth: panelW - 40,
            }),
        });
        asteroid.position.set(20, 46);
        panel.addChild(asteroid);

        const sector = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 11,
                fill: 0x93c5fd,
                letterSpacing: 1,
            }),
        });
        sector.position.set(20, 68);
        panel.addChild(sector);

        // ---- Left column: run stats --------------------------------
        const statsX = 24;
        const statsY = 104;
        const statsLabelStyle = new TextStyle({
            fontFamily: '"Courier New", monospace',
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 1.5,
            fill: 0x94a3b8,
        });
        const statsValueStyle = new TextStyle({
            fontFamily: '"Courier New", monospace',
            fontSize: 16,
            fontWeight: '700',
            fill: 0xf8fafc,
        });
        const statDefs = [
            ['SCORE',   'score'],
            ['LEVEL',   'level'],
            ['LINES',   'lines'],
            ['CELLS',   'cells'],
            ['MATCHES', 'matches'],
            ['BOMBS',   'bombs'],
        ];
        const stats = {};
        statDefs.forEach(([label, key], i) => {
            const row = new Container();
            row.position.set(statsX, statsY + i * 28);
            panel.addChild(row);
            const l = new Text({ text: label, style: statsLabelStyle });
            row.addChild(l);
            const v = new Text({ text: '0', style: statsValueStyle });
            v.anchor.set(1, 0);
            v.x = 240;
            row.addChild(v);
            stats[key] = v;
        });

        // ---- Right column: ore breakdown ---------------------------
        const oreX = 320;
        const oreY = 100;
        const oreHeader = new Text({
            text: 'ORE HAUL',
            style: statsLabelStyle,
        });
        oreHeader.position.set(oreX, oreY - 12);
        panel.addChild(oreHeader);

        const ores = {};
        const oreNameStyle = new TextStyle({
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            fontWeight: '700',
            fill: 0xcbd5f5,
        });
        const oreValueStyle = new TextStyle({
            fontFamily: '"Courier New", monospace',
            fontSize: 16,
            fontWeight: '700',
            fill: 0xf8fafc,
        });
        const iconStyle = new TextStyle({
            fontFamily: '"Courier New", monospace',
            fontSize: 16,
            fontWeight: '800',
            fill: 0x22d3ee,
        });
        ORES.forEach((ore, i) => {
            const row = new Container();
            row.position.set(oreX, oreY + 8 + i * 26);
            panel.addChild(row);

            const palette = this._palette[ore.color];
            const iconColor = palette ? palette.glow : 0x22d3ee;
            const icon = new Text({
                text: ore.icon,
                style: new TextStyle({ ...iconStyle, fill: iconColor }),
            });
            row.addChild(icon);

            const name = new Text({
                text: ore.label,
                style: oreNameStyle,
            });
            name.position.set(22, 2);
            row.addChild(name);

            const value = new Text({ text: '0', style: oreValueStyle });
            value.anchor.set(1, 0);
            value.position.set(260, -1);
            row.addChild(value);
            ores[ore.color] = value;
        });

        // ---- Credits + breakdown ----------------------------------
        const creditsLabel = new Text({
            text: 'CREDITS EARNED',
            style: statsLabelStyle,
        });
        creditsLabel.position.set(statsX, panelH - 122);
        panel.addChild(creditsLabel);

        const creditsValue = new Text({
            text: '+0 cr',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 30,
                fontWeight: '800',
                fill: 0xfacc15,
                dropShadow: { color: 0xfacc15, alpha: 0.45, blur: 8, distance: 0, angle: 0 },
            }),
        });
        creditsValue.position.set(statsX, panelH - 110);
        panel.addChild(creditsValue);

        const breakdown = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: '"Courier New", monospace',
                fontSize: 11,
                fill: 0x94a3b8,
            }),
        });
        breakdown.position.set(statsX, panelH - 72);
        panel.addChild(breakdown);

        // ---- CONTINUE button --------------------------------------
        const continueBtn = this._buildStartButton({
            text: 'CONTINUE',
            width: 180,
            height: 40,
            onTap: () => {
                const cb = this._onContinue;
                if (typeof cb === 'function') cb();
            },
        });
        panel.addChild(continueBtn.container);
        continueBtn.container.position.set(panelW - 200, panelH - 58);

        this._nodes = {
            container,
            dim,
            panel,
            panelW,
            panelH,
            title,
            asteroid,
            sector,
            stats,
            ores,
            creditsLabel,
            creditsValue,
            breakdown,
            continueBtn,
        };
    }

    _populate(summary) {
        const r = this._nodes;
        if (!r) return;
        const s = summary || {};
        r.asteroid.text = s.narrativeName && s.missionName
            ? `${s.narrativeName} \u2014 ${s.missionName}`
            : (s.missionName || s.narrativeName || 'Asteroid');
        const tierPart = s.tierIndex ? `T${s.tierIndex}` : '';
        const sectorPart = s.sector || '';
        r.sector.text = [tierPart, sectorPart].filter(Boolean).join(' \u00B7 ');

        const formatInt = (n) => Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
        r.stats.score.text   = formatInt(s.finalScore);
        r.stats.level.text   = formatInt(s.finalLevel);
        r.stats.lines.text   = formatInt(s.finalLines);
        r.stats.cells.text   = formatInt(s.cellsCleared);
        r.stats.matches.text = formatInt(s.matchesCleared);
        r.stats.bombs.text   = formatInt(s.bombsExploded);

        const oreCounts = s.ores || {};
        for (const color of Object.keys(r.ores)) {
            r.ores[color].text = formatInt(oreCounts[color]);
        }

        const credits = Math.max(0, Math.floor(s.credits || 0));
        r.creditsValue.text = `+${credits.toLocaleString('en-US')} cr`;
        const base  = Math.max(0, Math.floor(s.baseCredits || 0));
        const bonus = Math.max(0, Math.floor(s.scoreBonus  || 0));
        r.breakdown.text = `Base ${base.toLocaleString('en-US')} cr + Score bonus ${bonus.toLocaleString('en-US')} cr`;
    }

    layout(screen) {
        const r = this._nodes;
        if (!r || !this.app) return;
        const w = (screen && screen.width)  || this.app.screen.width;
        const h = (screen && screen.height) || this.app.screen.height;
        r.dim.clear();
        r.dim.rect(0, 0, w, h).fill({ color: 0x020617, alpha: 0.72 });
        r.panel.x = Math.round((w - r.panelW) / 2);
        r.panel.y = Math.round((h - r.panelH) / 2);
    }

    show(summary, { onContinue } = {}) {
        if (!this._nodes) this._build();
        this._onContinue = typeof onContinue === 'function' ? onContinue : null;
        this._populate(summary);
        this.layout();
        this._nodes.container.visible = true;
    }

    hide() {
        if (!this._nodes) return;
        this._nodes.container.visible = false;
        this._onContinue = null;
    }

    destroy() {
        if (!this._nodes) return;
        const c = this._nodes.container;
        if (c && typeof c.destroy === 'function') {
            c.destroy({ children: true });
        }
        this._nodes = null;
        this._onContinue = null;
    }
}
