# SubSync

A free, offline-friendly **subtitle companion** for movies. It plays a `.srt` file in
sync with a film — either a video you open in the app, or one playing on a TV / streaming
app while your iPad shows the captions. Optional free translation to **English or Sinhala**.

No backend. No API keys. No login. Pure static files that run on GitHub Pages.

## Two ways to watch

- **Play a video file** — open a movie file in the app. Subtitles lock to the video's own
  clock exactly. No tapping needed. This is the most reliable mode.
- **Companion** — the movie plays elsewhere (TV, Netflix, etc.). The iPad runs a local
  clock you align with **Tap to Sync**, and shows big captions like a second screen.

## Syncing

- **Tap to Sync** — when you hear the line shown on the button, tap it. The offset locks.
- **Fine adjust** — nudge ±0.1s / ±1s (or use the ← → arrow keys).
- **Fix drift (two-point)** — tap A on an early line and B on a late line, then Apply. This
  solves both offset *and* speed, fixing the gradual desync you get from framerate mismatch
  (e.g. a 25fps subtitle on a 23.976fps film).
- Alignment is remembered per subtitle file.

## Translation

Optional. Uses the free **MyMemory** endpoint (no key). Translate a subtitle file once and
every line is cached in your browser for offline reuse. Free translation — Sinhala
especially — is approximate. If your `.srt` is already in the language you want, skip it.

## Run locally

ES modules need to be served over HTTP (not `file://`):

```bash
cd subtitle
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this folder to the repo (see below).
2. GitHub → **Settings → Pages** → Source: **Deploy from a branch** → `main` / `/ (root)`.
3. It goes live at `https://<user>.github.io/subtitle/`.

All paths are relative, so it works from that sub-path with no config.

## Install on iPad

Open the Pages URL in **Safari** → Share → **Add to Home Screen**. It launches full-screen.

## Known iOS limitations (by design)

- A browser can't capture audio from Netflix, Prime, or any other app — only the mic. So
  **Companion mode uses Tap to Sync**, not audio capture.
- **Auto-sync (experimental)** listens through the mic and guesses the offset. Movie audio
  is hard to transcribe and iOS often disables speech recognition inside a home-screen PWA,
  so treat it as a bonus — Tap to Sync is the dependable path.
- Live translation needs a connection; cached translations keep working offline.

## Project layout

```
index.html            app shell + UI
css/styles.css        theme
js/srtParser.js       .srt → cues
js/syncEngine.js      offset + scale math, active-cue lookup
js/player.js          Mode A time source (in-app <video>)
js/clock.js           Mode B time source (local clock)
js/translator.js      free translation + cache
js/store.js           settings, per-file sync, IndexedDB cache
js/speechAutoSync.js  experimental mic auto-sync
js/app.js             wiring
sw.js                 offline app-shell cache
manifest.webmanifest  PWA install metadata
```
