// Tiny scene manager used by PixiView while we chip away at the
// 3k-line monolith. Each registered scene is expected to expose:
//
//   scene.show(data?)        -- make the scene visible + wire callbacks
//   scene.hide()             -- hide the scene, drop callbacks
//   scene.layout(screen?)    -- reposition on viewport resize (optional)
//   scene.destroy()          -- tear down Pixi nodes (optional)
//   scene.visible            -- read-only getter, true when shown
//
// The manager does NOT own scene construction -- PixiView builds each
// scene with its own dependencies (Pixi Application, shared ui-kit
// helpers, state/meta refs) and registers it here. Responsibility
// split is intentional so PixiView can stage the migration one scene
// at a time without this file growing dependency knobs.
//
// Layout fan-out: `layout(screen)` calls every scene's `layout` so a
// hidden scene still re-centers when the viewport resizes. That way
// a scene re-shown after a resize doesn't flash at the old size.

export class SceneManager {
    constructor() {
        this._scenes = new Map();
    }

    register(name, scene) {
        if (!name || typeof name !== 'string') {
            throw new Error('SceneManager.register: name must be a non-empty string');
        }
        if (!scene || typeof scene !== 'object') {
            throw new Error('SceneManager.register: scene must be an object');
        }
        this._scenes.set(name, scene);
    }

    get(name) {
        return this._scenes.get(name) || null;
    }

    has(name) {
        return this._scenes.has(name);
    }

    show(name, ...args) {
        const scene = this._scenes.get(name);
        if (!scene) return false;
        scene.show(...args);
        return true;
    }

    hide(name) {
        const scene = this._scenes.get(name);
        if (!scene) return false;
        scene.hide();
        return true;
    }

    isVisible(name) {
        const scene = this._scenes.get(name);
        return !!(scene && scene.visible);
    }

    layout(screen) {
        for (const scene of this._scenes.values()) {
            if (typeof scene.layout === 'function') {
                scene.layout(screen);
            }
        }
    }

    destroy() {
        for (const scene of this._scenes.values()) {
            if (typeof scene.destroy === 'function') {
                scene.destroy();
            }
        }
        this._scenes.clear();
    }
}
