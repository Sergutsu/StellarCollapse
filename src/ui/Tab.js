import {
    Text,
    TextStyle,
} from 'pixi.js';

import { colors } from '../theme/tokens.js';
import { createButton } from './Button.js';

/**
 * Creates a tab UI control built on top of the shared Button component.
 *
 * @param {object} options
 * @param {string} options.label
 * @param {number} options.width
 * @param {number} [options.height]
 * @param {string} options.colorKey
 * @param {boolean} [options.locked]
 * @param {number} [options.lockRep]
 * @param {() => void} [options.onTap]
 */
export function createTab({
    label,
    width,
    height = 40,
    colorKey,
    locked = false,
    lockRep = 2,
    onTap,
}) {
    const tabPalette = colors.tabs[colorKey] ?? colors.tabs.locked;
    const button = createButton({
        text: label,
        width,
        height,
        trimmed: true,
        state: locked ? 'disabled' : 'idle',
        palette: {
            fill: tabPalette.fill,
            hover: tabPalette.hover,
            active: tabPalette.hover,
            disabled: colors.tabs.locked.fill,
        },
        textColor: locked ? colors.text.disabled : colors.text.secondary,
        onTap,
    });

    const sublabel = new Text({
        text: locked ? `REP ${lockRep}` : '',
        style: new TextStyle({
            fontFamily: 'Inter, sans-serif',
            fontSize: 8,
            letterSpacing: 1,
            fill: colors.text.disabled,
        }),
    });
    sublabel.anchor.set(0.5);
    sublabel.position.set(width / 2, height / 2 + 12);
    button.container.addChild(sublabel);

    return {
        ...button,
        sublabel,
        setLocked(nextLocked) {
            button.setState(nextLocked ? 'disabled' : 'idle');
            button.label.style.fill = nextLocked ? colors.text.disabled : colors.text.secondary;
            sublabel.text = nextLocked ? `REP ${lockRep}` : '';
        },
    };
}
