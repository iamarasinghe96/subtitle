# SubSync

A free, offline-friendly **subtitle companion** for movies. The film plays wherever you
already watch it — TV, Netflix, a projector — and your iPad shows the captions in sync
beside it. Optional translation to **English or Sinhala**.

No backend. Pure static files that run on GitHub Pages. Loading a `.srt` yourself
needs no account at all; the optional auto-find feature uses your own API keys,
kept in your browser's local storage and never committed.

## Auto-find (optional)

One button: it listens to the film through the mic for ~15 seconds, works out
which film it is, downloads the subtitles, and loads them roughly aligned.

Two credentials are needed, both entered under **Keys & account** on the
setup screen:

- **Groq API key** — identifies the film from the overheard dialogue. No public
  subtitle API searches by dialogue content (OpenSubtitles matches on title,
  IMDb/TMDb id, or file hash), so this step needs a model that can recognize a
  film from its lines. Groq has a free tier; the model is set at the top of
  `js/movieId.js` and may need updating as their catalogue rotates.
- **OpenSubtitles API key + account** — the REST API requires a key on every
  request, and downloads additionally require a login token and are capped per
  day on the free tier.

### Caveats worth knowing

- **The keys are readable on your own device.** Any API key used from
  client-side JS can be read by anyone with devtools open. Nothing is ever
  written to the repo — this repo is public, so a committed key would be
  world-readable and preserved in git history — but treat these as personal-use
  credentials and rotate them if the device is shared. A small proxy would avoid
  this; it would also mean this is no longer a backend-free app.
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
- Two providers, picked under Controls → Language:
  - **Groq** (default) translates ~40 lines per request, so a feature film is a
    few dozen calls and finishes in a couple of minutes. Uses the same key as
    auto-find.
  - **MyMemory** needs no key but sends one request per line against a small
    daily character quota — fine for a short clip, it will not finish a film.
- Sinhala output is noticeably rougher than English: it is a low-resource
  language for every machine translator, so expect to reread the odd line.

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
