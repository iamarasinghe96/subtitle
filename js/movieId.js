// movieId.js — identify a film from a snippet of overheard dialogue.
//
// No public subtitle API searches by dialogue content (OpenSubtitles matches on
// title, IMDb/TMDb id, or file hash), so the transcript goes to Claude, which
// returns candidate titles as structured JSON.
//
// Raw fetch rather than @anthropic-ai/sdk: this app ships as static files with
// no bundler, and the SDK is not consumable from a plain <script type="module">.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

// Structured outputs need additionalProperties:false on every object, and
// don't support numeric/length constraints — keep the schema plain.
const GUESS_SCHEMA = {
  type: 'object',
  properties: {
    guesses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          year: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          why: { type: 'string' },
        },
        required: ['title', 'year', 'confidence', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['guesses'],
  additionalProperties: false,
};

const SYSTEM = `You identify films from short, noisy snippets of their dialogue.

The transcript comes from a phone microphone pointed at a TV, so expect dropped
words, misheard names and run-together lines. Work from distinctive phrasing,
character names and subject matter rather than exact wording.

Return up to 4 candidates, most likely first. Set confidence to "high" only when
the dialogue is genuinely distinctive to one film. If the snippet is generic
small talk that could belong to almost anything, say so with low confidence
rather than inventing a plausible-sounding title. Return an empty list if you
have no real candidate. Keep "why" to one short sentence naming the specific
clue you used.`;

/**
 * @param  {string} transcript  Dialogue heard through the mic.
 * @param  {{apiKey: string, signal?: AbortSignal}} opts
 * @return {Promise<Array<{title,year,confidence,why}>>}
 */
export async function identifyFilm(transcript, { apiKey, signal } = {}) {
  if (!apiKey) throw new Error('no-api-key');
  if (!transcript || transcript.trim().length < 12) throw new Error('transcript-too-short');

  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calls made straight from a browser. It also opts you into
      // exposing the key to anyone with devtools — see the README.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      // Thinking is on by default on this model and shares the max_tokens
      // budget with the answer, so leave headroom above.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: GUESS_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: `Dialogue heard from the film:\n\n"""${transcript}"""`,
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('bad-api-key');
    if (res.status === 429) throw new Error('rate-limited');
    throw new Error(`claude-http-${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();

  // A refused request is a 200 with an empty or partial content array — check
  // this before indexing into content.
  if (data.stop_reason === 'refusal') throw new Error('refused');
  if (data.stop_reason === 'max_tokens') throw new Error('truncated');

  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('empty-response');

  const parsed = JSON.parse(text);
  return Array.isArray(parsed.guesses) ? parsed.guesses : [];
}
