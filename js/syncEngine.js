// syncEngine.js
// Maps a movie clock (ms) onto subtitle cues, applying an offset and a scale.
//
// A cue's raw time is transformed to the movie clock as:
//     shown = raw * scale + offsetMs
// So given a movie time t, the matching raw time is (t - offsetMs) / scale.

export class SyncEngine {
  constructor() {
    this.cues = [];
    this.offsetMs = 0;
    this.scale = 1.0;
    this._lastIdx = 0;
  }

  setCues(cues) {
    this.cues = cues || [];
    this._lastIdx = 0;
  }

  reset() {
    this.offsetMs = 0;
    this.scale = 1.0;
  }

  // Convert a raw cue time to its position on the movie clock.
  shown(rawMs) {
    return rawMs * this.scale + this.offsetMs;
  }

  // Nudge the offset by a delta (ms). Positive = subtitles appear later.
  nudge(deltaMs) {
    this.offsetMs += deltaMs;
  }

  // Single-point sync: make `cue` line up with movie time `nowMs`,
  // keeping the current scale.
  syncCueToNow(cue, nowMs) {
    if (!cue) return;
    this.offsetMs = nowMs - cue.startMs * this.scale;
  }

  // Two-point sync: solve scale + offset from two (cue, actualTime) anchors.
  // Fixes gradual drift caused by framerate mismatch.
  twoPointSync(cueA, actualA, cueB, actualB) {
    const rawA = cueA.startMs;
    const rawB = cueB.startMs;
    if (rawA === rawB) return false;
    this.scale = (actualA - actualB) / (rawA - rawB);
    this.offsetMs = actualA - rawA * this.scale;
    return true;
  }

  // The cue that should be on screen at movie time t (or null).
  activeCue(t) {
    const cues = this.cues;
    if (cues.length === 0) return null;

    // Start searching near the last hit for efficiency during playback.
    let i = Math.min(this._lastIdx, cues.length - 1);

    // Walk backward if we've scrubbed earlier.
    while (i > 0 && this.shown(cues[i].startMs) > t) i--;
    // Walk forward to the current region.
    while (i < cues.length - 1 && this.shown(cues[i].endMs) < t) i++;

    const cue = cues[i];
    this._lastIdx = i;
    if (t >= this.shown(cue.startMs) && t <= this.shown(cue.endMs)) return cue;
    return null;
  }

  // The next cue at or after movie time t — used by Tap to Sync.
  upcomingCue(t) {
    const cues = this.cues;
    for (let i = 0; i < cues.length; i++) {
      if (this.shown(cues[i].startMs) >= t - 200) return cues[i];
    }
    return cues.length ? cues[cues.length - 1] : null;
  }
}
