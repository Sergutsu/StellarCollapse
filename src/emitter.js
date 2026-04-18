// Tiny, dependency-free pub/sub.
// Chose this over native EventTarget/CustomEvent because the handler
// signature is plain (receive payload directly, no .detail unwrap),
// which keeps call sites terse.

export class Emitter {
    constructor() {
        this._handlers = new Map();
    }

    on(event, handler) {
        let list = this._handlers.get(event);
        if (!list) {
            list = [];
            this._handlers.set(event, list);
        }
        list.push(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        const list = this._handlers.get(event);
        if (!list) return;
        const i = list.indexOf(handler);
        if (i !== -1) list.splice(i, 1);
    }

    emit(event, payload) {
        const list = this._handlers.get(event);
        if (!list || list.length === 0) return;
        // Iterate over a snapshot so handlers can safely call .off().
        const snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) {
            snapshot[i](payload);
        }
    }

    removeAll() {
        this._handlers.clear();
    }
}
