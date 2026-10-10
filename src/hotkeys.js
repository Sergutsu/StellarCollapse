// Global hotkey binder. Translates raw key events into named actions
// and lets main.js decide what each action means in the current screen
// context (hub vs. run vs. overlay). Kept separate from `input.js`
// (which owns only GameState movement verbs) so the control scheme for
// navigation never bleeds into the minigames.
//
//   const unbind = bindHotkeys({
//       getContext: () => 'hub' | 'run' | 'results',
//       actions: { escape, toggleHelp, togglePause, selectTab, openMissionBoard },
//   });
//
// Rules:
// - Never fires while Ctrl/Meta/Alt are held (browser shortcuts win).
// - Never fires on auto-repeat (holding M does not spam the board).
// - Movement keys are NOT handled here — input.js / defense-input.js.

const TAB_KEYS = Object.freeze({
    '1': 0,
    '2': 1,
    '3': 2,
    '4': 3,
    '5': 4,
    '6': 5,
});

export function bindHotkeys({ getContext, actions = {} } = {}) {
    const onKeyDown = (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.repeat) return;
        const context = typeof getContext === 'function' ? getContext() : 'hub';
        const key = event.key;

        // Help works from anywhere a player can get lost.
        if (key === 'h' || key === 'H' || key === '?') {
            event.preventDefault();
            actions.toggleHelp?.();
            return;
        }

        if (key === 'Escape') {
            event.preventDefault();
            actions.escape?.(context);
            return;
        }

        if (context === 'run' && (key === 'p' || key === 'P')) {
            event.preventDefault();
            actions.togglePause?.();
            return;
        }

        if (context !== 'hub') return;

        if (key === 'm' || key === 'M') {
            event.preventDefault();
            actions.openMissionBoard?.();
            return;
        }
        if (Object.hasOwn(TAB_KEYS, key)) {
            event.preventDefault();
            actions.selectTab?.(TAB_KEYS[key]);
        }
    };

    document.addEventListener('keydown', onKeyDown);
    return function unbindHotkeys() {
        document.removeEventListener('keydown', onKeyDown);
    };
}

/** The bottom-nav order the numeric hotkeys map to (1 → first tab). */
export const HOTKEY_TAB_ORDER = Object.freeze(['star-map', 'missions', 'build', 'research', 'crew', 'market']);
