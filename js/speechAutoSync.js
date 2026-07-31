// speechAutoSync.js — EXPERIMENTAL.
// Uses the microphone + the browser's speech recognition to hear the movie,
// then fuzzy-matches a snippet against the SRT to guess the offset.
//
// This is unreliable on iOS Safari (movie audio is hard to transcribe, and
// recognition often fails once installed as a home-screen PWA). It must never
// be a hard dependency — always fall back to Tap to Sync.

export function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenScore(a, b) {
  const at = new Set(normalize(a).split(' ').filter(Boolean));
  const bt = new Set(normalize(b).split(' ').filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let overlap = 0;
  for (const t of at) if (bt.has(t)) overlap++;
  return overlap / Math.min(at.size, bt.size);
}

// Listen for `listenMs`, then return { transcript }.
function listen(listenMs, lang) {
  return new Promise((resolve, reject) => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = lang || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let transcript = '';

    rec.onresult = (e) => {
      transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript + ' ';
      }
    };
    rec.onerror = (e) => reject(new Error(e.error || 'speech-error'));

    try {
      rec.start();
    } catch (err) {
      reject(err);
      return;
    }

    setTimeout(() => {
      try { rec.stop(); } catch { /* ignore */ }
      resolve({ transcript: transcript.trim() });
    }, listenMs);
  });
}

// Attempt an auto-sync. Returns { matchedCue, confidence, listenedAtMs } or null.
// getNowMs() must return the current movie time at the moment listening ends.
export async function attemptAutoSync(cues, getNowMs, { lang = 'en-US', listenMs = 12000 } = {}) {
  if (!speechSupported() || cues.length === 0) return null;

  const { transcript } = await listen(listenMs, lang);
  const listenedAtMs = getNowMs();
  if (!transcript) return null;

  // Score every cue against the heard snippet; take the best.
  let best = null;
  for (const cue of cues) {
    const score = tokenScore(transcript, cue.text);
    if (!best || score > best.confidence) best = { matchedCue: cue, confidence: score };
  }

  if (!best || best.confidence < 0.35) return null;
  return { ...best, listenedAtMs };
}
