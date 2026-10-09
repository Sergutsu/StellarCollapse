// Node module resolve hook: maps the bare specifier `pixi.js` onto the
// headless mock in ./pixi-mock.js so scene modules can be imported under
// `node --test`. Registered by tests/hub-scene-smoke.test.js via
// `module.register()`; the runner gives every test file its own process, so
// the mapping never leaks into the other suites.

// `resolve` is aliased: Node requires the hook export to be named exactly
// `resolve`, which would otherwise collide with node:path's.
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOCK_URL = pathToFileURL(resolvePath(here, 'pixi-mock.js')).href;

// Node calls this export `resolve` — any other name is ignored silently and
// the bare specifier falls through to the real resolver (ENOENT for pixi.js).
export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'pixi.js') {
        return { url: MOCK_URL, shortCircuit: true, format: 'module' };
    }
    return nextResolve(specifier, context);
}
