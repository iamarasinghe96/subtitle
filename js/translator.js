// translator.js
// Free, key-less translation with client-side caching.
// Default provider: MyMemory (CORS-friendly, no API key, rate-limited).
// The endpoint is configurable so a self-hosted LibreTranslate / Lingva
// instance can be dropped in later.

import { getCachedTranslation, putCachedTranslation } from './store.js';

const PROVIDERS = {
  mymemory: {
    label: 'MyMemory (free, no key)',
    async translate(text, src, tgt, signal) {
      const url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(text) +
        '&langpair=' +
        encodeURIComponent(`${src}|${tgt}`);
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      const out = data?.responseData?.translatedText;
      if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) {
        throw new Error('quota-or-invalid');
      }
      return out;
    },
  },
};

export function providerLabel(id) {
  return PROVIDERS[id]?.label || id;
}

// Translate an array of cues. Adds `.translated` to each cue in place.
// options: { src, tgt, endpoint, concurrency, onProgress, signal }
// Returns { done, failed }.
export async function translateCues(cues, options) {
  const {
    src,
    tgt,
    endpoint = 'mymemory',
    concurrency = 3,
    onProgress = () => {},
    signal,
  } = options;

  const provider = PROVIDERS[endpoint] || PROVIDERS.mymemory;
  let done = 0;
  let failed = 0;

  // Unique source strings so repeated lines are translated once.
  const uniqueTexts = [...new Set(cues.map((c) => c.text))];
  const results = new Map();

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueTexts.length) {
      if (signal?.aborted) return;
      const text = uniqueTexts[cursor++];

      let value = await getCachedTranslation(text, src, tgt);
      if (!value) {
        try {
          value = await provider.translate(text, src, tgt, signal);
          await putCachedTranslation(text, src, tgt, value);
          // Gentle spacing to respect the free tier.
          await sleep(120);
        } catch (err) {
          if (signal?.aborted) return;
          failed++;
          value = null;
        }
      }
      if (value) results.set(text, value);
      done++;
      onProgress(done, uniqueTexts.length, failed);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, uniqueTexts.length) }, worker);
  await Promise.all(workers);

  // Apply back to every cue.
  for (const c of cues) {
    c.translated = results.get(c.text) || c.translated || null;
  }

  return { done, failed };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
