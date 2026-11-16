// audio.js — every sound is synthesized with WebAudio: no audio files.
// Shots, reload clicks, footsteps, plant/defuse beeps, bomb beeps, stingers.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.stepT = 0;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Short filtered noise burst. */
  noise(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** A short oscillator blip. */
  tone(freq, dur, gain, type = 'square', when = 0, slideTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(weapon, dist = 0) {
    if (!this.ctx) return;
    const vol = Math.max(0.08, 1 - dist / 60);
    const base = { sidearm: 900, scatterjack: 500, raptor: 750, longarm: 420 }[weapon] ?? 750;
    this.noise(0.09, base, 0.5 * vol);
    this.tone(base * 0.4, 0.07, 0.22 * vol, 'square', 0, base * 0.15);
  }

  dryFire() { this.tone(1200, 0.03, 0.12, 'square'); }

  reload() {
    this.tone(500, 0.04, 0.15, 'square');
    this.tone(700, 0.04, 0.15, 'square', 0.18);
    this.tone(900, 0.05, 0.18, 'square', 0.42);
  }

  footstep(run) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.stepT < (run ? 320 : 420)) return;
    this.stepT = now;
    this.noise(0.06, 320, 0.12);
  }

  hitmarker(kill) {
    this.tone(kill ? 1400 : 1000, 0.05, 0.2, 'sine');
    if (kill) this.tone(1800, 0.08, 0.2, 'sine', 0.05);
  }

  plantBeep() { this.tone(880, 0.07, 0.2, 'sine'); }

  bombBeep() { this.tone(1150, 0.09, 0.22, 'sine'); }

  defuseBeep() { this.tone(660, 0.06, 0.18, 'sine'); }

  roundSting(win) {
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(f, 0.22, 0.22, 'triangle', i * 0.13));
  }

  matchSting(win) {
    const notes = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    notes.forEach((f, i) => this.tone(f, 0.3, 0.24, 'triangle', i * 0.16));
  }

  buySound() { this.tone(700, 0.06, 0.2, 'sine'); this.tone(1050, 0.08, 0.2, 'sine', 0.07); }

  denied() { this.tone(220, 0.12, 0.2, 'sawtooth'); }
}
