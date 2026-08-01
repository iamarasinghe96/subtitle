// translator.js
// Subtitle translation with client-side caching.
//
// Two providers, with different shapes:
//   groq     — batched. Sends ~40 lines per request, so a feature film is a few
//              dozen calls rather than a couple of thousand. Needs the same key
//              the auto-find feature uses.
//   mymemory — key-less, but one request per line and a small daily character
//              quota, so it can't realistically finish a whole film. Kept as a
//              fallback for short files and for anyone without a key.

import { getCachedTranslation, putCachedTranslation } from './store.js';

const LANG_NAMES = {
  en: 'English', si: 'Sinhala', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', zh: 'Chinese',
};
const langName = (code) => LANG_NAMES[code] || code;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function groqSystem(src, tgt) {
  return `You translate film subtitles from ${langName(src)} into ${langName(tgt)}.

You receive a JSON array of subtitle lines. Reply with JSON only, in exactly
this shape, with the translations in the same order and the same count:

{"t": ["…", "…"]}

Rules:
- Translate every line. Never merge, split, drop or reorder lines, and never
  add commentary — the count must match exactly.
- Keep any newline inside a line where it is; subtitles are laid out in two
  short lines and that break matters.
- Use natural spoken ${langName(tgt)}, the way people actually talk, not a
  stiff literal rendering. These are characters speaking to each other.
- Leave proper nouns, place names and brand names in their usual form.
- Preserve the tone: keep swearing as swearing, jokes as jokes, and keep
  formal or informal address consistent with the speaker.
- Keep lines short enough to read on screen in the time available.
- If a line is only a sound effect or music marker like [gunshot] or ♪,
  return it unchanged.`;
}

const PROVIDERS = {
  groq: {
    label: 'Groq (needs your key, much better Sinhala)',
    needsKey: true,
    batchSize: 40,

    async translateBatch(texts, src, tgt, signal, apiKey) {
      if (!apiKey) throw new Error('no-api-key');

      const res = await fetch(GROQ_URL, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.3,
          // Sinhala is script-heavy: budget well above the input's token count.
          max_tokens: 8000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: groqSystem(src, tgt) },
            { role: 'user', content: JSON.stringify(texts) },
          ],
        }),
      });

      if (res.status === 401) throw new Error('bad-api-key');
      if (res.status === 429) throw new Error('rate-limited');
      if (!res.ok) throw new Error(`http ${res.status}`);

      const data = await res.json();
      const choice = (data.choices || [])[0];
      if (choice?.finish_reason === 'length') throw new Error('truncated');

      const out = JSON.parse(choice?.message?.content || '{}');
      // A count mismatch would silently shift every later subtitle onto the
      // wrong line, so treat it as a failed batch rather than guessing.
      if (!Array.isArray(out.t) || out.t.length !== texts.length) {
        throw new Error('count-mismatch');
      }
      return out.t.map((s) => (typeof s === 'string' ? s : ''));
    },
  },

  mymemory: {
    label: 'MyMemory (free, no key, small daily quota)',
    needsKey: false,

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

export function providerNeedsKey(id) {
  return !!PROVIDERS[id]?.needsKey;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Translate an array of cues. Adds `.translated` to each cue in place.
 * options: { src, tgt, endpoint, apiKey, concurrency, onProgress, signal }
 * Returns { done, failed }.
 */
export async function translateCues(cues, options) {
  const {
    src, tgt, endpoint = 'groq', apiKey,
    concurrency = 3, onProgress = () => {}, signal,
  } = options;

  const provider = PROVIDERS[endpoint] || PROVIDERS.groq;

  // Repeated lines ("Yes.", "Come on!") are translated once.
  const unique = [...new Set(cues.map((c) => c.text))];
  const results = new Map();

  // Anything already cached costs nothing, including from a previous run that
  // failed partway.
  const pending = [];
  for (const text of unique) {
    const hit = await getCachedTranslation(text, src, tgt);
    if (hit) results.set(text, hit);
    else pending.push(text);
  }

  let done = unique.length - pending.length;
  let failed = 0;
  onProgress(done, unique.length, failed);

  const record = async (text, value) => {
    if (value) {
      results.set(text, value);
      await putCachedTranslation(text, src, tgt, value);
    } else {
      failed++;
    }
    done++;
  };

  if (provider.translateBatch) {
    const size = provider.batchSize || 25;
    for (let i = 0; i < pending.length; i += size) {
      if (signal?.aborted) break;
      const batch = pending.slice(i, i + size);
      try {
        const out = await provider.translateBatch(batch, src, tgt, signal, apiKey);
        for (let j = 0; j < batch.length; j++) await record(batch[j], out[j]);
      } catch (err) {
        if (signal?.aborted) break;
        // A bad key or exhausted quota will fail every remaining batch too —
        // stop rather than burning through the whole file to prove it.
        if (err.message === 'no-api-key' || err.message === 'bad-api-key') throw err;
        if (err.message === 'rate-limited') { await sleep(5000); i -= size; continue; }
        for (const text of batch) await record(text, null);
      }
      onProgress(done, unique.length, failed);
      await sleep(400);   // stay under the free tier's per-minute ceiling
    }
  } else {
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        if (signal?.aborted) return;
        const text = pending[cursor++];
        try {
          await record(text, await provider.translate(text, src, tgt, signal));
        } catch {
          if (signal?.aborted) return;
          await record(text, null);
        }
        onProgress(done, unique.length, failed);
        await sleep(120);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, worker),
    );
  }

  for (const c of cues) {
    c.translated = results.get(c.text) || c.translated || null;
  }
  return { done, failed };
}
