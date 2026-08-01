// subtitleFinder.js — search and download subtitles from OpenSubtitles.
//
// Their REST API needs an Api-Key on every call, and /download additionally
// needs a JWT from /login, so this only works with the user's own account.
// Credentials live in localStorage on the device and are never committed.

const BASE = 'https://api.opensubtitles.com/api/v1';
const TOKEN_KEY = 'subsync.os.token';

function authHeaders(apiKey, token) {
  const h = { 'Api-Key': apiKey, 'content-type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function cachedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw);
    return Date.now() < expires ? token : null;
  } catch {
    return null;
  }
}

function cacheToken(token) {
  // Tokens are good for about a day; re-login well before that.
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      token, expires: Date.now() + 20 * 60 * 60 * 1000,
    }));
  } catch { /* storage blocked — just re-login next time */ }
}

async function login({ apiKey, username, password }) {
  const cached = cachedToken();
  if (cached) return cached;

  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) throw new Error('os-bad-login');
  if (!res.ok) throw new Error(`os-login-http-${res.status}`);

  const { token } = await res.json();
  if (!token) throw new Error('os-no-token');
  cacheToken(token);
  return token;
}

/**
 * Search by film title. Returns the candidates sorted by download count, which
 * correlates well with "the release most people actually have".
 *
 * @param {{title: string, year?: number, language: string, apiKey: string}} q
 */
export async function searchSubtitles({ title, year, language, apiKey }) {
  if (!apiKey) throw new Error('os-no-api-key');

  const params = new URLSearchParams({
    query: title,
    languages: language || 'en',
    type: 'movie',
  });
  if (year) params.set('year', String(year));

  const res = await fetch(`${BASE}/subtitles?${params}`, {
    headers: authHeaders(apiKey),
  });
  if (res.status === 401 || res.status === 403) throw new Error('os-bad-api-key');
  if (!res.ok) throw new Error(`os-search-http-${res.status}`);

  const { data } = await res.json();
  return (data || [])
    .map((row) => {
      const a = row.attributes || {};
      const file = (a.files || [])[0] || {};
      return {
        fileId: file.file_id,
        name: file.file_name || a.release || title,
        release: a.release || '',
        downloads: a.download_count || 0,
        language: a.language,
        filmTitle: a.feature_details?.title || title,
        filmYear: a.feature_details?.year,
      };
    })
    .filter((s) => s.fileId)
    .sort((a, b) => b.downloads - a.downloads);
}

/**
 * Resolve a search hit to actual .srt text. Two hops: /download hands back a
 * short-lived link, which then serves the file.
 *
 * @param {{fileId: number, apiKey: string, username: string, password: string}} opts
 * @return {Promise<{name: string, text: string, remaining: number}>}
 */
export async function downloadSubtitle({ fileId, apiKey, username, password }) {
  const token = await login({ apiKey, username, password });

  const res = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: authHeaders(apiKey, token),
    body: JSON.stringify({ file_id: fileId }),
  });

  if (res.status === 406) throw new Error('os-quota-exhausted');
  if (res.status === 401) {
    // Token expired early — drop it so the next attempt logs in again.
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    throw new Error('os-token-expired');
  }
  if (!res.ok) throw new Error(`os-download-http-${res.status}`);

  const { link, file_name: fileName, remaining } = await res.json();
  if (!link) throw new Error('os-no-link');

  const fileRes = await fetch(link);
  if (!fileRes.ok) throw new Error(`os-fetch-http-${fileRes.status}`);

  return {
    name: fileName || 'subtitles.srt',
    text: await fileRes.text(),
    remaining: typeof remaining === 'number' ? remaining : null,
  };
}
