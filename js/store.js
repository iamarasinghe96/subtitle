// store.js
// Small persistence helpers.
//  - Settings and per-file sync live in localStorage (tiny, synchronous).
//  - The translation cache lives in IndexedDB (can grow large, stays offline).

const SETTINGS_KEY = 'subsync.settings.v1';

// Bumped whenever a stored value needs rewriting. Saved settings are merged
// *over* the defaults, so changing a default alone never reaches an existing
// install — it needs a migration below.
const SCHEMA = 2;

const DEFAULT_SETTINGS = {
  schema: SCHEMA,
  targetLang: 'off',        // 'off' | 'en' | 'si'
  sourceLang: 'en',         // source language of the SRT for translation
  showBoth: false,          // show original + translation stacked
  fontScale: 1.0,           // caption size multiplier
  bgOpacity: 0,             // caption backing — 0 keeps the stage pure black
  capBright: 1.0,           // caption opacity, for dark rooms
  endpoint: 'groq',         // translation provider id

  // Auto-find credentials. Kept on this device only — never in the repo.
  groqKey: '',              // identifies the film from overheard dialogue
  osApiKey: '',             // OpenSubtitles API key
  osUser: '',
  osPass: '',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const saved = JSON.parse(raw);
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    // Read the version off the *saved* object: the merge above would otherwise
    // hand back the current schema and every migration would look done.
    const from = Number(saved.schema) || 1;

    if (from < 2) {
      // Batched Groq translation replaced MyMemory as the default. Installs
      // predating it kept MyMemory, whose per-line quota cannot finish a film.
      if (settings.endpoint === 'mymemory') settings.endpoint = 'groq';
    }

    if (from < SCHEMA) {
      settings.schema = SCHEMA;
      saveSettings(settings);
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

// Per-file sync (offset + scale), keyed so re-opening a file restores alignment.
export function syncKeyFor(fileMeta) {
  return `subsync.sync.${fileMeta.name}.${fileMeta.size}`;
}

export function loadSync(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSync(key, { offsetMs, scale }) {
  try {
    localStorage.setItem(key, JSON.stringify({ offsetMs, scale }));
  } catch {
    /* non-fatal */
  }
}

// ---- Translation cache (IndexedDB) ----

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('no-indexeddb'));
      return;
    }
    const req = indexedDB.open('subsync', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('translations')) {
        db.createObjectStore('translations'); // key = `${src}|${tgt}|${text}`
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function cacheKey(text, src, tgt) {
  return `${src}|${tgt}|${text}`;
}

export async function getCachedTranslation(text, src, tgt) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction('translations', 'readonly');
      const req = tx.objectStore('translations').get(cacheKey(text, src, tgt));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedTranslation(text, src, tgt, value) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction('translations', 'readwrite');
      tx.objectStore('translations').put(value, cacheKey(text, src, tgt));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* non-fatal */
  }
}
