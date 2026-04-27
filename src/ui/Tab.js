import { Text, TextStyle } from 'pixi.js';

import { createButton } from './Button.js';
import { colors } from '../theme/tokens.js';

function paletteForTab(colorKey) {
    const lane = colors.tabs[colorKey] || colors.tabs.missions;
    return {
        fill: lane.fill,
        hover: lane.hover,
        active: lane.hover,
        disabled: colors.tabs.locked.fill,
    };
}

/**
 * Build a themed hub tab button.
 *
 * @param {{
 *   label: string,
 *   colorKey: string,
 *   locked?: boolean,
 *   lockRep?: number,
 *   width: number,
 *   height?: number,
 *   onTap?: Function,
 * }} opts
 */
export function createTab(opts) {
    const {
        label,
        colorKey,
        locked = false,
        lockRep = 2,
        width,
        height = 40,
        onTap,
    } = opts;

    const button = createButton({
        text: label,
        width,
        height,
        variant: 'ghost',
        state: 'idle',
        textColor: locked ? colors.text.disabled : colors.text.secondary,
        palette: paletteForTab(colorKey),
        trimmed: true,
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
    button.container.addChild(sublabel);

    return {
        container: button.container,
        label: button.label,
        sublabel,
        width,
        height,
        setState(nextState) {
            button.setState(nextState);
        },
        setVariant(nextVariant) {
            button.setVariant(nextVariant);
        },
    };
}
