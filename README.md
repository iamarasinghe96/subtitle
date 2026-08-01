# SubSync

A free, offline-friendly **subtitle companion** for movies. The film plays wherever you
already watch it — TV, Netflix, a projector — and your iPad shows the captions in sync
beside it. Optional free translation to **English or Sinhala**.

No backend. Pure static files that run on GitHub Pages. Loading a `.srt` yourself
needs no account at all; the optional auto-find feature uses your own API keys,
kept in your browser's local storage and never committed.

## Auto-find (optional)

One button: it listens to the film through the mic for ~15 seconds, works out
which film it is, downloads the subtitles, and loads them roughly aligned.

Two credentials are needed, both entered in **Controls → Auto-find**:

- **Anthropic API key** — identifies the film from the overheard dialogue. No
  public subtitle API searches by dialogue content (OpenSubtitles matches on
  title, IMDb/TMDb id, or file hash), so this step needs a model that can
  recognize a film from its lines.
- **OpenSubtitles API key + account** — the REST API requires a key on every
  request, and downloads additionally require a login token and are capped per
  day on the free tier.

### Caveats worth knowing

- **The key is exposed to your own browser.** Calling Anthropic directly from
  client-side JS requires the `anthropic-dangerous-direct-browser-access`
  header, and anyone with devtools open on your device can read the key. It is
  never written to the repo, but treat it as a personal-use key and revoke it if
  the device is shared. A small proxy would avoid this; it would also mean this
  is no longer a backend-free app.
- **Identification is a guess.** You confirm the film before anything downloads,
  and generic dialogue often yields low confidence or nothing at all.
- **Alignment is approximate.** The heard line is anchored to the middle of the
  listening window, so expect to be a few seconds out — Tap to sync fixes it.
- **CORS is not guaranteed.** Both APIs must allow browser origins. If a request
  fails with a bare network error and no status code, that is what happened.

## How it works

The movie plays elsewhere (TV, Netflix, etc.). The iPad runs a local clock you align with
**Tap to Sync**, and shows big captions like a second screen.

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
js/clock.js           local clock driving the captions
js/movieId.js         film identification from overheard dialogue
js/subtitleFinder.js  OpenSubtitles search + download
js/translator.js      free translation + cache
js/store.js           settings, per-file sync, IndexedDB cache
js/speechAutoSync.js  experimental mic auto-sync
js/app.js             wiring
sw.js                 offline app-shell cache
manifest.webmanifest  PWA install metadata
```
