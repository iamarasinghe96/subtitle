// clock.js — Mode B time source: a local clock for when the movie plays
// on a TV / another device. The user aligns it with Tap to Sync.

export class LocalClock {
  constructor() {
    this._running = false;
    this._baseMs = 0;          // movie time at last start
    this._startedAt = 0;       // performance.now() at last start
  }

  getTimeMs() {
    if (!this._running) return this._baseMs;
    return this._baseMs + (performance.now() - this._startedAt);
  }

  isRunning() {
    return this._running;
  }

  start() {
    if (this._running) return;
    this._startedAt = performance.now();
    this._running = true;
  }

  pause() {
    if (!this._running) return;
    this._baseMs = this.getTimeMs();
    this._running = false;
  }

  toggle() {
    this._running ? this.pause() : this.start();
  }

  // Jump the clock to a specific movie time (ms), preserving run state.
  setTimeMs(ms) {
    this._baseMs = ms;
    this._startedAt = performance.now();
  }

  reset() {
    this._running = false;
    this._baseMs = 0;
    this._startedAt = 0;
  }
}
