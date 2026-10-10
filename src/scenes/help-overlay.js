// HOW TO PLAY overlay: the paged field manual for new dispatchers (and
// the reference everyone else opens with H / the top-bar HELP button).
// Content lives in src/help-content.js (pure, tested); this module only
// renders it and handles paging. One instance lives on PixiView's
// uiRoot so it can open over the hub OR over a paused shift.
//
//   help.show({ page: 0, firstRun: true, onClose, onStartShift });
//   help.nextPage() / help.prevPage() / help.goToPage(i);
//   help.hide(); help.visible; help.layout(screen); help.destroy();

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { HELP_PAGES, HELP_FIRST_RUN_CTA } from '../help-content.js';
import { colors } from '../theme/tokens.js';
import { drawTechPanel, buildSimpleButton, drawStarShape } from '../pixi-ui-kit.js';

export class HelpOverlay {
    constructor({ app, uiRoot }) {
        if (!uiRoot) throw new Error('HelpOverlay: uiRoot is required');
        this.app = app || null;
        this.uiRoot = uiRoot;

        this._nodes = null;
        this._pageIndex = 0;
        this._onClose = null;
        this._onStartShift = null;
        this._firstRun = false;
    }

    get visible() {
        return !!(this._nodes && this._nodes.container.visible);
    }

    get pageIndex() {
        return this._pageIndex;
    }

    _build() {
        const container = new Container();
        container.eventMode = 'static';
        container.visible = false;
        this.uiRoot.addChild(container);

        const dim = new Graphics();
        dim.eventMode = 'static';
        container.addChild(dim);

        const panelW = 760;
        const panelH = 540;
        const panel = drawTechPanel(panelW, panelH, { accent: 'cyan' });
        container.addChild(panel);

        const star = drawStarShape(12, colors.brand.gold);
        star.position.set(28, 30);
        panel.addChild(star);

        const title = new Text({
            text: 'HOW TO PLAY',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 20,
                fontWeight: '800',
                letterSpacing: 3,
                fill: colors.text.accent,
                dropShadow: { color: colors.text.accent, alpha: 0.3, blur: 8, distance: 0, angle: 0 },
            }),
        });
        title.position.set(48, 18);
        panel.addChild(title);

        const pageTitle = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fontWeight: '700',
                letterSpacing: 2,
                fill: colors.status.success,
            }),
        });
        pageTitle.anchor.set(1, 0);
        pageTitle.position.set(panelW - 64, 22);
        panel.addChild(pageTitle);

        const closeBtn = buildSimpleButton({
            text: 'CLOSE',
            width: 84,
            height: 28,
            accent: 'amber',
            onTap: () => this.hide(),
        });
        closeBtn.container.position.set(panelW - 116, 14);
        panel.addChild(closeBtn.container);

        const body = new Container();
        body.position.set(28, 58);
        panel.addChild(body);

        // Footer: paging on the left, first-run CTA on the right.
        const footerY = panelH - 54;
        const prevBtn = buildSimpleButton({
            text: '\u25C0 PREV',
            width: 104,
            height: 32,
            accent: 'cyan',
            onTap: () => this.prevPage(),
        });
        prevBtn.container.position.set(28, footerY);
        panel.addChild(prevBtn.container);

        const nextBtn = buildSimpleButton({
            text: 'NEXT \u25B6',
            width: 104,
            height: 32,
            accent: 'cyan',
            onTap: () => this.nextPage(),
        });
        nextBtn.container.position.set(144, footerY);
        panel.addChild(nextBtn.container);

        const dots = new Container();
        dots.position.set(panelW / 2 - 60, footerY + 16);
        panel.addChild(dots);

        const startBtn = buildSimpleButton({
            text: `${HELP_FIRST_RUN_CTA} \u2192`,
            width: 190,
            height: 36,
            accent: 'green',
            onTap: () => {
                const fn = this._onStartShift;
                this.hide();
                if (typeof fn === 'function') fn();
            },
        });
        startBtn.container.position.set(panelW - 218, footerY - 2);
        panel.addChild(startBtn.container);

        this._nodes = {
            container,
            dim,
            panel,
            panelW,
            panelH,
            title,
            pageTitle,
            closeBtn,
            body,
            prevBtn,
            nextBtn,
            dots,
            startBtn,
        };
    }

    show({ page = 0, firstRun = false, onClose = null, onStartShift = null } = {}) {
        if (!this._nodes) this._build();
        this._onClose = typeof onClose === 'function' ? onClose : null;
        this._onStartShift = typeof onStartShift === 'function' ? onStartShift : null;
        this._firstRun = !!firstRun;
        this._pageIndex = Math.max(0, Math.min(page, HELP_PAGES.length - 1));
        this._render();
        this.layout();
        this._nodes.container.visible = true;
    }

    hide() {
        if (!this._nodes) return;
        this._nodes.container.visible = false;
        const fn = this._onClose;
        this._onClose = null;
        this._onStartShift = null;
        if (typeof fn === 'function') fn();
    }

    nextPage() {
        this.goToPage(this._pageIndex + 1);
    }

    prevPage() {
        this.goToPage(this._pageIndex - 1);
    }

    goToPage(index) {
        const clamped = Math.max(0, Math.min(index, HELP_PAGES.length - 1));
        if (clamped === this._pageIndex && this._nodes?.body.children.length) return;
        this._pageIndex = clamped;
        if (this._nodes) this._render();
    }

    _render() {
        const r = this._nodes;
        if (!r) return;
        const page = HELP_PAGES[this._pageIndex];

        r.pageTitle.text = `${page.title}  ·  ${this._pageIndex + 1} / ${HELP_PAGES.length}`;
        r.body.removeChildren().forEach((c) => c.destroy?.({ children: true }));

        let y = 0;
        for (const block of page.blocks) {
            const heading = new Text({
                text: block.heading,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12,
                    fontWeight: '800',
                    letterSpacing: 2,
                    fill: block.color ?? colors.status.warning,
                }),
            });
            heading.position.set(0, y);
            r.body.addChild(heading);
            y += 20;

            const text = new Text({
                text: block.body,
                style: new TextStyle({
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 12.5,
                    fill: colors.text.secondary,
                    wordWrap: true,
                    wordWrapWidth: r.panelW - 96,
                    lineHeight: 19,
                }),
            });
            text.position.set(0, y);
            r.body.addChild(text);
            // +14 px of air between blocks. The mock text metric and the
            // real one both honour wordWrap height, so this stacks cleanly.
            y += text.height + 14;
        }

        r.prevBtn.container.alpha = this._pageIndex > 0 ? 1 : 0.35;
        r.prevBtn.container.eventMode = this._pageIndex > 0 ? 'static' : 'none';
        r.nextBtn.container.alpha = this._pageIndex < HELP_PAGES.length - 1 ? 1 : 0.35;
        r.nextBtn.container.eventMode = this._pageIndex < HELP_PAGES.length - 1 ? 'static' : 'none';

        // Page dots (tappable).
        r.dots.removeChildren().forEach((c) => c.destroy?.({ children: true }));
        HELP_PAGES.forEach((_, i) => {
            const dot = new Graphics();
            const active = i === this._pageIndex;
            dot.circle(0, 0, active ? 5 : 3.5).fill({ color: active ? colors.text.accent : colors.text.disabled });
            dot.position.set(i * 18, 0);
            dot.eventMode = 'static';
            dot.cursor = 'pointer';
            dot.on('pointertap', () => this.goToPage(i));
            r.dots.addChild(dot);
        });

        // The START SHIFT CTA belongs to the first-run open only; later
        // visits to the manual keep the footer for paging alone.
        r.startBtn.container.visible = this._firstRun;
    }

    layout(screen) {
        const r = this._nodes;
        if (!r) return;
        const w = (screen && screen.width) ?? this.app?.screen?.width ?? 1280;
        const h = (screen && screen.height) ?? this.app?.screen?.height ?? 720;
        r.dim.clear();
        r.dim.rect(0, 0, Math.max(1, w), Math.max(1, h)).fill({ color: 0x020617, alpha: 0.78 });
        r.panel.x = Math.round((w - r.panelW) / 2);
        r.panel.y = Math.round((h - r.panelH) / 2);
    }

    /** Test seam: fire the n-th body-adjacent control by name. */
    tapStart() {
        this._nodes?.startBtn.container.emit('pointertap', {});
    }

    destroy() {
        if (this._nodes) {
            this._nodes.container.destroy({ children: true });
            this._nodes = null;
        }
        this._onClose = null;
        this._onStartShift = null;
    }
}
