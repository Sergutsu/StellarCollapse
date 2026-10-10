// Headless stand-in for pixi.js v8, used by tests/hub-scene-smoke.test.js.
//
// The repo has no build step and no npm dependencies, and the browser pulls
// the real Pixi from the importmap in index.html — so under `node --test` the
// bare specifier `pixi.js` resolves to nothing and every scene module fails to
// import. That is why the hub's view code has never executed in CI, and why a
// missing import (`buildIdleMissions`) and a mis-read effect key
// (`effects.fleetSlots` treated as a capacity instead of an extras counter)
// both shipped: `node --check` parses them fine and no unit test reaches them.
//
// This mock implements only the scene-graph contract the view code relies on:
// a Container tree (addChild / addChildAt / removeChildren / destroy), a
// chainable Graphics, Text with *approximated* measured metrics (layout code
// branches on `.width` / `.height`, so they must be plausible rather than 0),
// Rectangle / TextStyle / FillGradient value types, and a mini event emitter
// so `pointertap` / `pointermove` handlers can be driven directly.
//
// It renders nothing and models no hit-testing: passing here means "the code
// ran, produced finite geometry and mutated the profile as intended", NOT
// "it looks right". `tests/helpers/pixi-resolve-hook.mjs` maps the specifier.

/* eslint-disable no-unused-vars */

const APPROX_CHAR_W = 0.58;   // em-width for Inter-ish metrics

class Point {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x = 0, y = x) { this.x = x; this.y = y; return this; }
    copyFrom(p) { this.x = p?.x ?? 0; this.y = p?.y ?? 0; return this; }
    clone() { return new Point(this.x, this.y); }
}

class Emitter {
    constructor() { this._handlers = new Map(); }
    on(ev, fn) { if (!this._handlers.has(ev)) this._handlers.set(ev, new Set()); this._handlers.get(ev).add(fn); return this; }
    off(ev, fn) { const s = this._handlers.get(ev); if (s) s.delete(fn); return this; }
    once(ev, fn) { const wrap = (e) => { this.off(ev, wrap); fn(e); }; return this.on(ev, wrap); }
    removeAllListeners(ev) { if (ev) this._handlers.delete(ev); else this._handlers.clear(); return this; }
    emit(ev, payload) {
        const s = this._handlers.get(ev);
        if (!s) return false;
        for (const fn of [...s]) fn(payload);
        return true;
    }
    listenerCount(ev) { return this._handlers.get(ev)?.size ?? 0; }
}

class DisplayObject extends Emitter {
    constructor() {
        super();
        this.parent = null;
        this.visible = true;
        this.renderable = true;
        this.alpha = 1;
        this.position = new Point();
        this.scale = new Point(1, 1);
        this.pivot = new Point();
        this.skew = new Point();
        this.rotation = 0;
        this.eventMode = 'passive';
        this.cursor = null;
        this.hitArea = null;
        this.mask = null;
        this.filters = null;
        this.blendMode = 'normal';
        this.zIndex = 0;
        this.sortableChildren = false;
        this.label = '';
        this.tint = 0xffffff;
    }
    get x() { return this.position.x; }
    set x(v) { this.position.x = v; }
    get y() { return this.position.y; }
    set y(v) { this.position.y = v; }
    get worldTransform() { return { a: 1, b: 0, c: 0, d: 1, tx: this.position.x, ty: this.position.y }; }
    toLocal(global) { return new Point((global?.x ?? 0) - this.position.x, (global?.y ?? 0) - this.position.y); }
    getGlobalPosition() { return new Point(this.position.x, this.position.y); }
    destroy() { this.parent = null; this.removeAllListeners(); }
}

class Container extends DisplayObject {
    constructor(opts) {
        super();
        this.children = [];
        this._width = 0;
        this._height = 0;
        if (opts && typeof opts === 'object') Object.assign(this, opts);
    }
    addChild(...kids) {
        for (const k of kids) {
            if (!k) continue;
            if (k.parent && k.parent !== this) k.parent.removeChild(k);
            k.parent = this;
            this.children.push(k);
        }
        return kids[0];
    }
    addChildAt(child, index) {
        if (!child) return child;
        if (child.parent && child.parent !== this) child.parent.removeChild(child);
        child.parent = this;
        this.children.splice(Math.max(0, Math.min(index, this.children.length)), 0, child);
        return child;
    }
    removeChild(...kids) {
        for (const k of kids) {
            const i = this.children.indexOf(k);
            if (i >= 0) { this.children.splice(i, 1); k.parent = null; }
        }
        return kids[0];
    }
    removeChildren() {
        const removed = this.children.slice();
        this.children = [];
        removed.forEach((c) => { c.parent = null; });
        return removed;
    }
    setParent(p) { p?.addChild(this); return p; }
    get width() { return this._width; }
    set width(v) { this._width = v; }
    get height() { return this._height; }
    set height(v) { this._height = v; }
    destroy(opts) {
        if (opts?.children) this.removeChildren().forEach((c) => c.destroy?.(opts));
        else this.children.forEach((c) => { c.parent = null; });
        this.children = [];
        super.destroy(opts);
    }
}

class Graphics extends Container {
    clear() { this._cmds = []; return this; }
    // Every primitive returns `this` so `.rect(...).fill(...)` chains.
    circle() { return this; }
    ellipse() { return this; }
    rect() { return this; }
    roundRect() { return this; }
    poly() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    arc() { return this; }
    closePath() { return this; }
    fill() { return this; }
    stroke() { return this; }
    beginPath() { return this; }
    setMatrix() { return this; }
    drawStar() { return this; }
}

class TextStyle {
    constructor(opts = {}) {
        this.fontFamily = 'Inter, sans-serif';
        this.fontSize = 12;
        this.fontWeight = '400';
        this.fill = 0xffffff;
        this.letterSpacing = 0;
        this.lineHeight = 0;
        this.wordWrap = false;
        this.wordWrapWidth = 100;
        this.align = 'left';
        this.stroke = null;
        Object.assign(this, opts || {});
    }
    clone() { return new TextStyle({ ...this }); }
}

class Text extends Container {
    constructor(opts = {}, style = null) {
        super();
        if (typeof opts === 'string') { this._text = opts; this.style = new TextStyle(style || {}); }
        else { this._text = String(opts?.text ?? ''); this.style = opts?.style instanceof TextStyle ? opts.style : new TextStyle(opts?.style || {}); }
        this.anchor = new Point(0, 0);
        this.resolution = 1;
    }
    get text() { return this._text; }
    set text(v) { this._text = String(v ?? ''); }
    // Approximate measured metrics: layout code branches on these, so they
    // must be plausible rather than zero.
    get width() {
        const per = this.style.fontSize * APPROX_CHAR_W + (this.style.letterSpacing || 0);
        const longest = this._text.split('\n').reduce((m, line) => Math.max(m, line.length), 0);
        return longest * per;
    }
    get height() {
        const lines = this._text.split('\n');
        let wrapped = 0;
        const per = this.style.fontSize * APPROX_CHAR_W + (this.style.letterSpacing || 0);
        for (const line of lines) {
            if (this.style.wordWrap && this.style.wordWrapWidth > 0 && line.length * per > this.style.wordWrapWidth) {
                wrapped += Math.ceil((line.length * per) / this.style.wordWrapWidth);
            } else wrapped += 1;
        }
        const lh = this.style.lineHeight || this.style.fontSize * 1.2;
        return Math.max(1, wrapped) * lh;
    }
    destroy(opts) { this._text = ''; super.destroy(opts); }
}

class Rectangle {
    constructor(x = 0, y = 0, width = 0, height = 0) { this.x = x; this.y = y; this.width = width; this.height = height; this.type = 'rect'; }
    contains(x, y) { return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height; }
}

class FillGradient {
    constructor(x0 = 0, y0 = 0, x1 = 0, y1 = 1) { this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.stops = []; }
    addColorStop(offset, color) { this.stops.push({ offset, color }); return this; }
}

class Texture { static from() { return new Texture(); } static get WHITE() { return new Texture(); } }
class Sprite extends Container {
    constructor(texture = null) { super(); this.texture = texture; this.anchor = new Point(0, 0); }
    static from(src) { return new Sprite(new Texture()); }
}
class RenderTexture extends Texture { static create(opts) { return new RenderTexture(); } }
class Assets { static async load() { return new Texture(); } static add() {} }
class Renderer { constructor() { this.width = 1280; this.height = 720; } resize(w, h) { this.width = w; this.height = h; } render() {} destroy() {} }
class Application {
    constructor() {
        this.stage = new Container();
        this.renderer = new Renderer();
        this.screen = { width: 1280, height: 720 };
        this.canvas = {
            style: {},
            width: 1280,
            height: 720,
            addEventListener() {},
            removeEventListener() {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
        };
        this.ticker = { add() {}, remove() {}, start() {}, stop() {}, deltaMS: 16 };
    }
    async init(opts = {}) {
        if (opts.width) { this.screen.width = opts.width; this.renderer.width = opts.width; }
        if (opts.height) { this.screen.height = opts.height; this.renderer.height = opts.height; }
        return this;
    }
    get view() { return { canvas: { width: this.screen.width, height: this.screen.height } }; }
    render() {}
    destroy() {}
}

export {
    Application, Assets, Container, FillGradient, Graphics, Point, Rectangle,
    RenderTexture, Renderer, Sprite, Text, TextStyle, Texture,
};
export default { Application, Assets, Container, FillGradient, Graphics, Rectangle, RenderTexture, Sprite, Text, TextStyle };
