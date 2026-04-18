// Animated starfield background. Moved out of inline script so the main
// bootstrap file stays small. Purely decorative — no game state.

export function createStarsBackground(container, numStars = 100) {
    const types = ['small', 'medium', 'large', 'nebula', 'asteroid', 'supernova'];
    const weights = [0.45, 0.25, 0.15, 0.09, 0.05, 0.01];
    const frag = document.createDocumentFragment();

    for (let i = 0; i < numStars; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        let random = Math.random();
        let type = 'small';
        for (let j = 0; j < types.length; j++) {
            if (random < weights[j]) {
                type = types[j];
                break;
            }
            random -= weights[j];
        }
        star.classList.add(type);
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.animationDelay = `${Math.random() * 3}s`;
        frag.appendChild(star);
    }
    container.appendChild(frag);
}

export function injectEffectKeyframes() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes explode {
            0% { transform: scale(0.5) rotate(0deg); opacity: 1; }
            50% { transform: scale(1.5) rotate(180deg); opacity: 0.8; }
            100% { transform: scale(2) rotate(360deg); opacity: 0; }
        }
        @keyframes bombExplode {
            0% { transform: scale(0.3) rotate(0deg); opacity: 1; }
            25% { transform: scale(2) rotate(90deg); opacity: 1; }
            50% { transform: scale(3) rotate(180deg); opacity: 0.9; }
            75% { transform: scale(4) rotate(270deg); opacity: 0.6; }
            100% { transform: scale(5) rotate(360deg); opacity: 0; }
        }
        @keyframes snakeGlow {
            0% { transform: rotate(45deg) scale(0.8); opacity: 0.9; box-shadow: 0 0 15px rgba(0, 255, 136, 0.8); }
            50% { transform: rotate(45deg) scale(1.1); opacity: 1; box-shadow: 0 0 25px rgba(0, 255, 136, 1); }
            100% { transform: rotate(45deg) scale(1); opacity: 0.9; box-shadow: 0 0 20px rgba(0, 255, 136, 0.9); }
        }
        /* COLLAPSED countdown ring on bomb/snake cells. The conic-gradient
           background is set inline each tick; these rules just handle the
           mask, color theming, and the urgent-state pulse. */
        .special-countdown {
            border-radius: 50%;
            -webkit-mask: radial-gradient(circle, transparent 38%, #000 42%, #000 58%, transparent 62%);
                    mask: radial-gradient(circle, transparent 38%, #000 42%, #000 58%, transparent 62%);
            filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.6));
        }
        .special-countdown--bomb {
            color: #ffb347;
        }
        .special-countdown--snake {
            color: #5fffc7;
        }
        .special-countdown__digit {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Orbitron', 'Courier New', monospace;
            font-weight: 700;
            font-size: 0.9em;
            color: inherit;
            text-shadow: 0 0 4px currentColor, 0 0 8px rgba(0, 0, 0, 0.9);
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}
