// Generic modal dialog: pause menu, reset confirmation, anything that
// needs "title + a few words + 2–3 buttons" over a dimmed screen.
// Owned by PixiView (one instance, mounted on uiRoot) and driven from
// main.js — scenes never build their own modal chrome.
//
//   dialog.show({
//       title: 'SHIFT PAUSED',
//       body: 'The board is frozen.',
//       detail: 'Esc resumes.',              // optional muted line
//       buttons: [
//           { label: 'RESUME', style: 'primary', role: 'cancel', onTap },
//           { label: 'ABORT SHIFT', style: 'danger', role: 'confirm', onTap },
//       ],
//   });
//
// `role: 'cancel'` marks the safe action: `dialog.cancel()` (wired to
// ESC by main.js) fires it, or just hides the dialog when there is none.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import { colors } from '../theme/tokens.js';
import { drawTechPanel, buildSimpleButton } from '../pixi-ui-kit.js';

const STYLE_ACCENT = Object.freeze({
    primary: 'green',
    danger: colors.status.error,
    ghost: 'cyan',
    amber: 'amber',
});

export class ModalDialog {
    constructor({ app, uiRoot }) {
        if (!uiRoot) throw new Error('ModalDialog: uiRoot is required');
        this.app = app || null;
        this.uiRoot = uiRoot;

        this._nodes = null;
        this._buttons = [];
        this._onCancel = null;
    }

    get visible() {
        return !!(this._nodes && this._nodes.container.visible);
    }

    _build() {
        const container = new Container();
        container.eventMode = 'static';
        container.visible = false;
        this.uiRoot.addChild(container);

        const dim = new Graphics();
        dim.eventMode = 'static';
        // Clicking the void is the safe action (cancel / resume).
        dim.on('pointertap', () => this.cancel());
        container.addChild(dim);

        const panelW = 520;
        const panelH = 300;
        const panel = drawTechPanel(panelW, panelH, { accent: 'cyan' });
        container.addChild(panel);

        const title = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 20,
                fontWeight: '800',
                letterSpacing: 3,
                fill: colors.text.accent,
                dropShadow: { color: colors.text.accent, alpha: 0.3, blur: 8, distance: 0, angle: 0 },
            }),
        });
        title.position.set(22, 18);
        panel.addChild(title);

        const body = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                fill: colors.text.primary,
                wordWrap: true,
                wordWrapWidth: panelW - 44,
                lineHeight: 20,
            }),
        });
        body.position.set(22, 58);
        panel.addChild(body);

        const detail = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                fill: colors.text.muted,
                wordWrap: true,
                wordWrapWidth: panelW - 44,
            }),
        });
        detail.position.set(22, 150);
        panel.addChild(detail);

        const buttonRow = new Container();
        buttonRow.position.set(22, panelH - 62);
        panel.addChild(buttonRow);

        this._nodes = {
            container,
            dim,
            panel,
            panelW,
            panelH,
            title,
            body,
            detail,
            buttonRow,
        };
    }

    /**
     * @param {object} opts
     * @param {string} opts.title
     * @param {string} [opts.body]
     * @param {string} [opts.detail]
     * @param {Array<{label:string, style?:string, role?:'cancel'|'confirm', onTap?:Function}>} opts.buttons
     */
    show({ title = 'PAUSED', body = '', detail = '', buttons = [] } = {}) {
        if (!this._nodes) this._build();
        const r = this._nodes;
        r.title.text = title;
        r.body.text = body;
        r.detail.text = detail;

        r.buttonRow.removeChildren().forEach((c) => c.destroy?.({ children: true }));
        this._buttons = [];
        this._onCancel = null;

        const list = Array.isArray(buttons) ? buttons.filter(Boolean) : [];
        let x = 0;
        list.forEach((btn) => {
            const width = Math.max(120, Math.min(200, 44 + String(btn.label || '').length * 9));
            const built = buildSimpleButton({
                text: btn.label || 'OK',
                width,
                height: 38,
                accent: STYLE_ACCENT[btn.style] ?? 'cyan',
                onTap: () => {
                    const fn = btn.onTap;
                    if (btn.role !== 'confirm') this.hide();
                    if (typeof fn === 'function') fn();
                    // A confirm action that stays open is allowed (e.g. a
                    // two-step), but by default any tap dismisses.
                    if (btn.role === 'confirm') this.hide();
                },
            });
            built.container.position.set(x, 0);
            r.buttonRow.addChild(built.container);
            this._buttons.push(built);
            if (btn.role === 'cancel') this._onCancel = btn.onTap || null;
            x += width + 12;
        });

        this.layout();
        r.container.visible = true;
    }

    /** Safe action (ESC / dim tap): fires the `cancel`-role button. */
    cancel() {
        if (!this.visible) return;
        const fn = this._onCancel;
        this.hide();
        if (typeof fn === 'function') fn();
    }

    hide() {
        if (this._nodes) this._nodes.container.visible = false;
    }

    layout(screen) {
        const r = this._nodes;
        if (!r) return;
        const w = (screen && screen.width) ?? this.app?.screen?.width ?? 1280;
        const h = (screen && screen.height) ?? this.app?.screen?.height ?? 720;
        r.dim.clear();
        r.dim.rect(0, 0, Math.max(1, w), Math.max(1, h)).fill({ color: 0x020617, alpha: 0.72 });
        r.panel.x = Math.round((w - r.panelW) / 2);
        r.panel.y = Math.round((h - r.panelH) / 2);
    }

    /** Test seam: fire the n-th button as if tapped. */
    tapButton(index) {
        this._buttons[index]?.container.emit('pointertap', {});
    }

    destroy() {
        if (this._nodes) {
            this._nodes.container.destroy({ children: true });
            this._nodes = null;
        }
        this._buttons = [];
        this._onCancel = null;
    }
}
