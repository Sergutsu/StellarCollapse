import { Container } from 'pixi.js';

import { buildStartButton } from '../pixi-ui-kit.js';
import { colors } from '../theme/tokens.js';

function paletteForVariant(variant, overrides = null) {
    if (overrides && typeof overrides === 'object') {
        return {
            fill: overrides.fill ?? colors.button.default.fill,
            hover: overrides.hover ?? overrides.active ?? colors.button.default.hover,
            active: overrides.active ?? overrides.hover ?? colors.button.default.active,
            disabled: overrides.disabled ?? colors.button.default.disabled,
        };
    }
    const base = colors.button[variant] || colors.button.default;
    return {
        fill: base.fill,
        hover: base.hover,
        active: base.active,
        disabled: base.disabled,
    };
}

/**
 * Build a reusable themed button with explicit state + variant APIs.
 *
 * @param {{
 *   text: string,
 *   width: number,
 *   height?: number,
 *   variant?: 'default'|'primary'|'danger'|'ghost',
 *   state?: 'idle'|'hover'|'active'|'disabled',
 *   textColor?: number,
 *   palette?: { fill?: number, hover?: number, active?: number, disabled?: number },
 *   trimmed?: boolean,
 *   onTap?: Function,
 * }} opts
 */
export function createButton(opts) {
    const {
        text,
        width,
        height = 40,
        variant = 'default',
        state = 'idle',
        textColor = colors.text.white,
        palette = null,
        trimmed = true,
        onTap,
    } = opts;

    const host = new Container();
    host.eventMode = 'static';
    host.cursor = 'pointer';

    let currentVariant = variant;
    let currentState = state;
    let currentNode = null;

    const rebuild = () => {
        const resolved = paletteForVariant(currentVariant, palette);
        const nextNode = buildStartButton({
            text,
            width,
            height,
            fill: resolved.fill,
            hoverFill: resolved.hover,
            textColor,
            trimmed,
            onTap,
        });
        if (currentNode?.container) {
            host.removeChild(currentNode.container);
            currentNode.container.destroy({ children: true });
        }
        currentNode = nextNode;
        host.addChild(currentNode.container);
        applyState(currentState);
    };

    const applyState = (nextState) => {
        currentState = nextState;
        if (!currentNode) return;
        const resolved = paletteForVariant(currentVariant, palette);
        const disabled = nextState === 'disabled';
        currentNode.container.eventMode = disabled ? 'none' : 'static';
        currentNode.container.cursor = disabled ? 'default' : 'pointer';
        currentNode.container.alpha = disabled ? 0.62 : 1;
        if (disabled) {
            currentNode.label.style.fill = resolved.disabled;
            currentNode.setActive(false);
            return;
        }
        currentNode.label.style.fill = textColor;
        currentNode.setActive(nextState === 'active' || nextState === 'hover');
    };

    rebuild();

    return {
        container: host,
        width,
        height,
        get label() {
            return currentNode?.label || null;
        },
        setState(nextState) {
            applyState(nextState);
        },
        setVariant(nextVariant) {
            currentVariant = nextVariant;
            rebuild();
        },
    };
}
