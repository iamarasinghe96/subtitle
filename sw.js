// sw.js — caches the app shell for offline use.
// Bump CACHE when you change any cached file.

const CACHE = 'subsync-v8';

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/srtParser.js',
  './js/syncEngine.js',
  './js/translator.js',
  './js/store.js',
  './js/clock.js',
  './js/speechAutoSync.js',
  './js/movieId.js',
  './js/subtitleFinder.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only the app shell is ours to cache. Everything else — translation,
  // film identification, subtitle downloads — goes straight to the network
  // under default browser handling, so preflights and auth headers are
  // untouched.
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;

  // Cache-first for our own assets; fall back to network, then cache the result.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => hit);
    })
  );
});
