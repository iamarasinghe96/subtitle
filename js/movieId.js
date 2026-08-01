// movieId.js — identify a film from a snippet of overheard dialogue.
//
// No public subtitle API searches by dialogue content (OpenSubtitles matches on
// title, IMDb/TMDb id, or file hash), so the transcript goes to an LLM, which
// returns candidate titles as JSON.
//
// Groq's OpenAI-compatible chat-completions endpoint. Raw fetch rather than a
// client library: this app ships as static files with no bundler.

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq rotates its catalogue fairly often. If this 404s with a
// model_not_found, pick a current one from https://console.groq.com/docs/models
const MODEL = 'llama-3.3-70b-versatile';

// json_object mode is supported far more widely across Groq's models than
// json_schema, so the shape is specified in the prompt and validated here.
const SYSTEM = `You identify films from short, noisy snippets of their dialogue.

The transcript comes from a phone microphone pointed at a TV, so expect dropped
words, misheard names and run-together lines. Work from distinctive phrasing,
character names and subject matter rather than exact wording.

Reply with JSON only, in exactly this shape:

{"guesses": [{"title": "…", "year": 1999, "confidence": "high", "why": "…"}]}

Rules:
- At most 4 guesses, most likely first.
- "confidence" is exactly one of "high", "medium", "low". Use "high" only when
  the dialogue is genuinely distinctive to one film.
- "year" is the release year as a number. Use 0 if you truly don't know it.
- "why" is one short sentence naming the specific clue you used.
- If the snippet is generic small talk that could belong to almost anything,
  return low confidence or an empty list. Do not invent a plausible title.`;

const CONFIDENCES = new Set(['high', 'medium', 'low']);

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.guesses)) return [];
  return raw.guesses
    .filter((g) => g && typeof g.title === 'string' && g.title.trim())
    .slice(0, 4)
    .map((g) => ({
      title: g.title.trim(),
      year: Number.isFinite(g.year) && g.year > 1800 ? g.year : null,
      confidence: CONFIDENCES.has(g.confidence) ? g.confidence : 'low',
      why: typeof g.why === 'string' ? g.why : '',
    }));
}

/**
 * @param  {string} transcript  Dialogue heard through the mic.
 * @param  {{apiKey: string, signal?: AbortSignal}} opts
 * @return {Promise<Array<{title, year, confidence, why}>>}
 */
export async function identifyFilm(transcript, { apiKey, signal } = {}) {
  if (!apiKey) throw new Error('no-api-key');
  if (!transcript || transcript.trim().length < 12) throw new Error('transcript-too-short');

  const res = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Dialogue heard from the film:\n\n"""${transcript}"""` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('bad-api-key');
    if (res.status === 429) throw new Error('rate-limited');
    if (res.status === 404 && /model/i.test(detail)) throw new Error('model-retired');
    throw new Error(`groq-http-${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await res.json();
  const choice = (data.choices || [])[0];
  const text = choice?.message?.content;
  if (!text) throw new Error('empty-response');
  if (choice.finish_reason === 'length') throw new Error('truncated');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('bad-json');
  }
  return normalize(parsed);
}
