// app.js — wires everything together.

import { parseSrt, formatMs } from './srtParser.js';
import { SyncEngine } from './syncEngine.js';
import { VideoSource } from './player.js';
import { LocalClock } from './clock.js';
import { translateCues, providerLabel } from './translator.js';
import { speechSupported, attemptAutoSync } from './speechAutoSync.js';
import {
  loadSettings, saveSettings,
  syncKeyFor, loadSync, saveSync,
} from './store.js';

const $ = (sel) => document.querySelector(sel);

// ---- state ----
const settings = loadSettings();
const engine = new SyncEngine();
const videoSource = new VideoSource($('#video'));
const clock = new LocalClock();

let mode = null;            // 'A' (in-app video) | 'B' (companion)
let timeSource = null;      // videoSource | clock
let srtFiles = [];          // [{ name, size, cues, warnings }]
let activeSrt = -1;
let translateAbort = null;
let wakeLock = null;
let twoPt = { a: null, b: null };

// ---- setup: mode selection ----
document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    mode = card.dataset.mode;
    refreshStartState();
  });
});

// ---- setup: load SRT (file / paste / url) ----
$('#srtFile').addEventListener('change', (e) => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  file.text()
    .then((txt) => addSrt(file.name, file.size, txt))
    .catch(() => setWarning(`Couldn't read "${file.name}". Try a different file.`))
    // Reset so re-picking the same file fires change again after a failed load.
    .finally(() => { input.value = ''; });
});

$('#loadPasteBtn').addEventListener('click', () => {
  const txt = $('#srtPaste').value;
  if (!txt.trim()) return;
  addSrt('Pasted subtitles', txt.length, txt);
  $('#srtPaste').value = '';
});

$('#loadUrlBtn').addEventListener('click', async () => {
  const url = $('#srtUrl').value.trim();
  if (!url) return;
  setWarning('Fetching subtitle file…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    const name = url.split('/').pop() || 'subtitles.srt';
    addSrt(name, txt.length, txt);
  } catch {
    setWarning("Couldn't fetch that URL. The site may block cross-origin requests — download the .srt and load it as a file instead.");
  }
});

function addSrt(name, size, text) {
  const { cues, warnings } = parseSrt(text);
  if (cues.length === 0) {
    setWarning(warnings.join(' '));
    return;
  }
  srtFiles.push({ name, size, cues, warnings });
  activeSrt = srtFiles.length - 1;
  rebuildSrtList();
  setWarning(warnings.length ? warnings.join(' ') : `Loaded ${cues.length} lines from "${name}".`);
  refreshStartState();
}

// Release names run long ("Movie.2026.1080p.WEBRip.x265.10bit.AAC5.1-GROUP.srt").
// Keep the head and tail so releases stay tellable apart, drop the middle.
function shortName(name, max = 40) {
  const base = name.replace(/\.srt$/i, '');
  if (base.length <= max) return base;
  const head = Math.ceil((max - 1) / 2);
  return `${base.slice(0, head)}…${base.slice(base.length - (max - 1 - head))}`;
}

function rebuildSrtList() {
  const sel = $('#srtList');
  sel.innerHTML = '';
  srtFiles.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${shortName(f.name)} · ${f.cues.length} lines`;
    opt.title = f.name;
    sel.appendChild(opt);
  });
  sel.value = String(activeSrt);
  $('#srtListRow').hidden = srtFiles.length === 0;
}

$('#srtList').addEventListener('change', (e) => {
  activeSrt = Number(e.target.value);
  applyActiveSrt();
});

function applyActiveSrt() {
  if (activeSrt < 0) return;
  const f = srtFiles[activeSrt];
  engine.setCues(f.cues);
  // Restore any saved alignment for this file.
  const saved = loadSync(syncKeyFor(f));
  if (saved) { engine.offsetMs = saved.offsetMs; engine.scale = saved.scale; }
  else { engine.reset(); }
  updateOffsetReadout();
}

function refreshStartState() {
  const needsMode = !mode;
  const needsSrt = srtFiles.length === 0;
  $('#startBtn').disabled = needsMode || needsSrt;
  // Say which step is still outstanding — a dead Start button with no
  // explanation reads as broken.
  $('#startHint').textContent =
    needsMode && needsSrt ? 'Choose how you’re watching in step 1, then load a .srt in step 2.'
    : needsMode ? 'Choose how you’re watching in step 1.'
    : needsSrt ? 'Load a .srt file in step 2.'
    : '';
}

function setWarning(msg) {
  $('#warnings').textContent = msg || '';
}

// ---- start ----
$('#startBtn').addEventListener('click', () => {
  applyActiveSrt();
  timeSource = mode === 'A' ? videoSource : clock;

  $('#setup').hidden = true;
  $('#stage').hidden = false;
  document.body.classList.toggle('mode-companion', mode === 'B');

  $('#video').hidden = mode !== 'A';
  $('#transportRow').hidden = mode === 'A';   // Mode A uses the video's own controls

  $('#autoSyncBtn').hidden = !speechSupported();
  $('#modeLabel').textContent = mode === 'A' ? 'In-app player' : 'Companion';

  showLangPrompt();
  requestWakeLock();
  renderLoop();
});

$('#backBtn').addEventListener('click', () => {
  $('#stage').hidden = true;
  $('#setup').hidden = false;
  if (mode === 'B') clock.pause();
  releaseWakeLock();
});

// ---- language prompt overlay ----
function showLangPrompt() {
  $('#langPrompt').hidden = false;
}
document.querySelectorAll('#langPrompt [data-lang]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.targetLang = btn.dataset.lang;
    saveSettings(settings);
    syncSettingsToControls();
    $('#langPrompt').hidden = true;
    if (settings.targetLang !== 'off') maybeOfferTranslate();
  });
});

function maybeOfferTranslate() {
  const f = srtFiles[activeSrt];
  const hasAny = f.cues.some((c) => c.translated);
  if (!hasAny) setWarning(`Tip: open Controls → Translate to fill in ${settings.targetLang === 'si' ? 'Sinhala' : 'English'}.`);
}

// ---- controls drawer ----
$('#gearBtn').addEventListener('click', () => {
  $('#controls').classList.toggle('open');
});

// Mode B transport
$('#clockToggle').addEventListener('click', () => {
  clock.toggle();
  $('#clockToggle').textContent = clock.isRunning() ? 'Pause' : 'Play';
});

// ---- Tap to Sync ----
$('#tapSyncBtn').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = engine.activeCue(now) || engine.upcomingCue(now);
  if (!cue) return;
  engine.syncCueToNow(cue, now);
  persistSync();
  updateOffsetReadout();
  flash('#tapSyncBtn');
});

// ---- Two-point sync ----
$('#ptABtn').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = engine.activeCue(now) || engine.upcomingCue(now);
  twoPt.a = { cue, actual: now };
  $('#twoPtInfo').textContent = `Point A set on: "${clip(cue.text)}"`;
});
$('#ptBBtn').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = engine.activeCue(now) || engine.upcomingCue(now);
  twoPt.b = { cue, actual: now };
  $('#twoPtInfo').textContent = `Point B set on: "${clip(cue.text)}"`;
});
$('#applyTwoPt').addEventListener('click', () => {
  if (!twoPt.a || !twoPt.b) {
    $('#twoPtInfo').textContent = 'Set both point A and point B first.';
    return;
  }
  const ok = engine.twoPointSync(twoPt.a.cue, twoPt.a.actual, twoPt.b.cue, twoPt.b.actual);
  if (!ok) { $('#twoPtInfo').textContent = 'Pick two different lines.'; return; }
  persistSync();
  updateOffsetReadout();
  $('#twoPtInfo').textContent = 'Two-point sync applied.';
});

// ---- Nudge ----
const nudge = (ms) => { engine.nudge(ms); persistSync(); updateOffsetReadout(); };
$('#nudgeMinus1').addEventListener('click', () => nudge(-1000));
$('#nudgeMinusS').addEventListener('click', () => nudge(-100));
$('#nudgePlusS').addEventListener('click', () => nudge(100));
$('#nudgePlus1').addEventListener('click', () => nudge(1000));
$('#resetSyncBtn').addEventListener('click', () => { engine.reset(); persistSync(); updateOffsetReadout(); });

// Keyboard: arrows nudge, space pauses (Mode B)
document.addEventListener('keydown', (e) => {
  if ($('#stage').hidden) return;
  if (e.key === 'ArrowLeft') nudge(-100);
  else if (e.key === 'ArrowRight') nudge(100);
  else if (e.key === ' ' && mode === 'B') { e.preventDefault(); $('#clockToggle').click(); }
});

function persistSync() {
  if (activeSrt < 0) return;
  saveSync(syncKeyFor(srtFiles[activeSrt]), { offsetMs: engine.offsetMs, scale: engine.scale });
}
function updateOffsetReadout() {
  $('#offsetReadout').textContent = `offset ${formatMs(engine.offsetMs)} · scale ${engine.scale.toFixed(4)}`;
}

// ---- Settings controls ----
function syncSettingsToControls() {
  $('#targetLang').value = settings.targetLang;
  $('#sourceLang').value = settings.sourceLang;
  $('#showBoth').checked = settings.showBoth;
  $('#fontScale').value = settings.fontScale;
  $('#bgOpacity').value = settings.bgOpacity;
  applyDisplayVars();
}
$('#targetLang').addEventListener('change', (e) => { settings.targetLang = e.target.value; saveSettings(settings); });
$('#sourceLang').addEventListener('change', (e) => { settings.sourceLang = e.target.value; saveSettings(settings); });
$('#showBoth').addEventListener('change', (e) => { settings.showBoth = e.target.checked; saveSettings(settings); });
$('#fontScale').addEventListener('input', (e) => { settings.fontScale = Number(e.target.value); applyDisplayVars(); saveSettings(settings); });
$('#bgOpacity').addEventListener('input', (e) => { settings.bgOpacity = Number(e.target.value); applyDisplayVars(); saveSettings(settings); });

function applyDisplayVars() {
  document.documentElement.style.setProperty('--cap-scale', settings.fontScale);
  document.documentElement.style.setProperty('--cap-bg', settings.bgOpacity);
}

// ---- Translation ----
$('#translateBtn').addEventListener('click', async () => {
  if (activeSrt < 0) return;
  const tgt = $('#targetLang').value;
  if (tgt === 'off') { setControlMsg('Choose English or Sinhala first.'); return; }
  const src = $('#sourceLang').value;
  const f = srtFiles[activeSrt];

  if (translateAbort) translateAbort.abort();
  translateAbort = new AbortController();
  $('#translateBtn').disabled = true;
  $('#translateProgress').hidden = false;

  const { failed } = await translateCues(f.cues, {
    src, tgt,
    endpoint: settings.endpoint,
    signal: translateAbort.signal,
    onProgress: (done, total, fail) => {
      $('#translateBar').style.width = `${Math.round((done / total) * 100)}%`;
      $('#translateCount').textContent = `${done}/${total}${fail ? ` · ${fail} failed` : ''}`;
    },
  });

  $('#translateBtn').disabled = false;
  setControlMsg(
    failed
      ? `Translated with ${failed} lines skipped (free-tier limit). Tap Translate again later to fill gaps — done lines are cached.`
      : `Translated all lines to ${tgt === 'si' ? 'Sinhala' : 'English'}. Cached for offline use.`
  );
});

function setControlMsg(msg) { $('#twoPtInfo').textContent = msg; }

// ---- Experimental auto-sync ----
$('#autoSyncBtn').addEventListener('click', async () => {
  $('#autoSyncBtn').disabled = true;
  $('#autoSyncBtn').textContent = 'Listening…';
  try {
    const res = await attemptAutoSync(
      engine.cues,
      () => timeSource.getTimeMs(),
      { lang: langTag(settings.sourceLang) }
    );
    if (res) {
      engine.syncCueToNow(res.matchedCue, res.listenedAtMs);
      persistSync();
      updateOffsetReadout();
      setControlMsg(`Matched "${clip(res.matchedCue.text)}" (${Math.round(res.confidence * 100)}%). Fine-tune with the nudge buttons.`);
    } else {
      setControlMsg("Couldn't match the audio — use Tap to Sync instead.");
    }
  } catch {
    setControlMsg('Speech recognition failed on this device. Use Tap to Sync.');
  } finally {
    $('#autoSyncBtn').disabled = false;
    $('#autoSyncBtn').textContent = 'Auto-sync (experimental)';
  }
});

// ---- render loop ----
function renderLoop() {
  if ($('#stage').hidden) return;

  const t = timeSource.getTimeMs();
  const cue = engine.activeCue(t);

  const capO = $('#captionOriginal');
  const capT = $('#captionTranslated');

  if (!cue) {
    capO.textContent = '';
    capT.textContent = '';
    $('#captionWrap').classList.remove('live');
  } else {
    $('#captionWrap').classList.add('live');
    const tgt = settings.targetLang;
    const translated = cue.translated;

    // The primary (large) line always goes in capT; capO is the small line
    // used only when showing both.
    if (tgt === 'off') {
      capT.textContent = cue.text;
      capO.textContent = '';
    } else if (settings.showBoth) {
      capT.textContent = translated || cue.text;
      capO.textContent = translated ? cue.text : '';
    } else {
      capT.textContent = translated || cue.text;
      capO.textContent = '';
    }
  }

  // Tap-to-sync button shows the line you're aiming at.
  const upcoming = engine.upcomingCue(t);
  $('#tapTarget').textContent = upcoming ? clip(upcoming.text, 60) : '—';

  // Mode B clock readout.
  if (mode === 'B') $('#clockTime').textContent = formatMs(t);

  requestAnimationFrame(renderLoop);
}

// ---- helpers ----
function clip(s, n = 42) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function flash(sel) {
  const el = $(sel); el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 250);
}
function langTag(code) {
  return { en: 'en-US', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', zh: 'zh-CN' }[code] || 'en-US';
}

// ---- wake lock ----
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not supported / denied — non-fatal */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#stage').hidden) requestWakeLock();
});

// ---- init ----
$('#endpointLabel').textContent = providerLabel(settings.endpoint);
syncSettingsToControls();
applyDisplayVars();
refreshStartState();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
