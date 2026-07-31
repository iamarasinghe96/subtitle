// player.js — Mode A time source: an in-app <video> element.
// Exposes the shared time-source interface: getTimeMs(), isRunning().

export class VideoSource {
  constructor(videoEl) {
    this.video = videoEl;
    this._url = null;
  }

  loadFile(file) {
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = URL.createObjectURL(file);
    this.video.src = this._url;
    this.video.load();
  }

  getTimeMs() {
    return this.video.currentTime * 1000;
  }

  isRunning() {
    return !this.video.paused && !this.video.ended;
  }

  dispose() {
    if (this._url) {
      URL.revokeObjectURL(this._url);
      this._url = null;
    }
  }
}
