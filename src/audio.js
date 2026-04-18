// Web Audio sound bank. Subscribes to GameState events and plays sounds;
// it does not read game state directly. Safe to omit entirely (e.g. in
// tests) — the game plays through without it.

import { NORMAL_COLORS } from './constants.js';

const SOUND_DEFS = {
    pieceDrop: { type: 'tone', frequency: 220, duration: 0.1, volume: 0.2 },
    pieceMove: { type: 'click', frequency: 800, duration: 0.03, volume: 0.15 },
    pieceRotate: { type: 'tone', frequency: 550, duration: 0.08, volume: 0.2 },
    pieceLock: { type: 'thud', frequency: 150, duration: 0.15, volume: 0.25 },
    lineClear: { type: 'sweep', startFreq: 440, endFreq: 880, duration: 0.3, volume: 0.4 },
    colorMatch: { type: 'chord', frequencies: [330, 415, 523], duration: 0.2, volume: 0.3 },
    bombExplosion: { type: 'explosion', duration: 0.6, volume: 0.5 },
    snakeTrail: { type: 'glide', startFreq: 200, endFreq: 800, duration: 0.3, volume: 0.25 },
    gameOver: { type: 'descent', startFreq: 440, endFreq: 110, duration: 1.2, volume: 0.4 },
    levelUp: { type: 'ascent', startFreq: 262, endFreq: 523, duration: 0.5, volume: 0.35 },
    fourLine: { type: 'fanfare', frequencies: [262, 330, 392, 523], duration: 0.8, volume: 0.45 },
};

export class Audio {
    constructor({ masterVolume = 0.3 } = {}) {
        this.ctx = null;
        this.enabled = true;
        this.masterVolume = masterVolume;
    }

    init() {
        if (this.ctx) return;
        try {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) {
                this.enabled = false;
                return;
            }
            this.ctx = new Ctor();
        } catch (err) {
            console.warn('Audio not supported:', err);
            this.enabled = false;
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) this.play('pieceMove');
        return this.enabled;
    }

    // Bind to a GameState so plays happen automatically. Returns an
    // unsubscribe function.
    bindState(state) {
        const offs = [
            state.on('piece-moved', ({ direction }) => {
                if (direction.dx !== 0) this.play('pieceMove');
                else if (direction.dy > 0) this.play('pieceDrop');
            }),
            state.on('piece-rotated', () => this.play('pieceRotate')),
            state.on('piece-locked', () => this.play('pieceLock')),
            state.on('lines-cleared', ({ count }) => {
                if (count === 4) this.play('fourLine');
                else this.play('lineClear');
            }),
            state.on('match-detected', () => this.play('colorMatch')),
            state.on('bomb-detonating', () => this.play('bombExplosion')),
            state.on('snake-activated', () => this.play('snakeTrail')),
            state.on('level-up', () => this.play('levelUp')),
            state.on('game-over', () => this.play('gameOver')),
        ];
        return () => offs.forEach((off) => off());
    }

    play(name, options = {}) {
        if (!this.enabled || !this.ctx) return;
        const sound = SOUND_DEFS[name];
        if (!sound) return;
        const volume = (options.volume || sound.volume || 0.3) * this.masterVolume;
        try {
            switch (sound.type) {
                case 'tone':
                    this._playTone(sound.frequency, sound.duration, volume);
                    break;
                case 'click':
                    this._playClick(sound.frequency, sound.duration, volume);
                    break;
                case 'thud':
                    this._playThud(sound.frequency, sound.duration, volume);
                    break;
                case 'sweep':
                    this._playSweep(sound.startFreq, sound.endFreq, sound.duration, volume);
                    break;
                case 'chord':
                    this._playChord(sound.frequencies, sound.duration, volume);
                    break;
                case 'explosion':
                    this._playExplosion(sound.duration, volume);
                    break;
                case 'glide':
                    this._playGlide(sound.startFreq, sound.endFreq, sound.duration, volume);
                    break;
                case 'descent':
                    this._playDescent(sound.startFreq, sound.endFreq, sound.duration, volume);
                    break;
                case 'ascent':
                    this._playAscent(sound.startFreq, sound.endFreq, sound.duration, volume);
                    break;
                case 'fanfare':
                    this._playFanfare(sound.frequencies, sound.duration, volume);
                    break;
            }
        } catch (err) {
            console.warn('Sound playback error:', err);
        }
    }

    _mkOscGain() {
        const oscillator = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        return { oscillator, gainNode };
    }

    _playTone(frequency, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(frequency, t);
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(volume, t + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playClick(frequency, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(frequency, t);
        oscillator.type = 'square';
        gainNode.gain.setValueAtTime(volume, t);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playThud(frequency, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(frequency, t);
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(volume, t);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playSweep(startFreq, endFreq, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(startFreq, t);
        oscillator.frequency.linearRampToValueAtTime(endFreq, t + duration);
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(volume, t + 0.05);
        gainNode.gain.linearRampToValueAtTime(0, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playChord(frequencies, duration, volume) {
        frequencies.forEach((freq) => this._playTone(freq, duration, volume / frequencies.length));
    }

    _playExplosion(duration, volume) {
        const bufferSize = Math.floor(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const noise = this.ctx.createBufferSource();
        const gainNode = this.ctx.createGain();
        noise.buffer = buffer;
        noise.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        noise.start(this.ctx.currentTime);
    }

    _playGlide(startFreq, endFreq, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(startFreq, t);
        oscillator.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
        oscillator.type = 'triangle';
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(volume, t + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playDescent(startFreq, endFreq, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(startFreq, t);
        oscillator.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(volume, t);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playAscent(startFreq, endFreq, duration, volume) {
        const { oscillator, gainNode } = this._mkOscGain();
        const t = this.ctx.currentTime;
        oscillator.frequency.setValueAtTime(startFreq, t);
        oscillator.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(volume, t + 0.1);
        gainNode.gain.linearRampToValueAtTime(0, t + duration);
        oscillator.start(t);
        oscillator.stop(t + duration);
    }

    _playFanfare(frequencies, duration, volume) {
        frequencies.forEach((freq, index) => {
            const delay = index * 0.1;
            setTimeout(() => {
                this._playTone(freq, duration - delay, volume / frequencies.length);
            }, delay * 1000);
        });
    }
}

// eslint-ignore-next-line — kept only for module typecheck; tests don't use it.
export const _SOUND_DEFS = SOUND_DEFS;
export { NORMAL_COLORS as _PALETTE };
