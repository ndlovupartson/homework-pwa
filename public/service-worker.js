// Service worker — caches the APP SHELL only (HTML/CSS/JS/icons/fonts-css).
//
// IMPORTANT, per the architecture doc §13: this file must never be the
// place application data lives. Homework/submissions/answers live in
// IndexedDB (src/db/*), not here. This cache exists purely so the shell
// itself (layout, styles, nav) still loads with no network at all.

const CACHE_VERSION = 'shell-v2';
// Fallback list used only if the generated manifest can't be fetched
// (e.g. it hasn't been generated yet) — see scripts/generate-sw-manifest.js.
// The real precache list is loaded from asset-manifest.json at install
// time so it can't silently drift out of sync with the actual file set.
const FALLBACK_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/src/app-shell/tokens.css',
  '/src/app-shell/shell.css',
  '/src/app-shell/shell.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      let assets = FALLBACK_ASSETS;
      try {
        const manifestResponse = await fetch('/asset-manifest.json');
        if (manifestResponse.ok) assets = await manifestResponse.json();
      } catch (err) {
        // Fall back to the hardcoded list — better than failing install entirely.
      }
      await cache.addAll(assets);
    })()
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept API calls to the Worker — those must always hit the
  // network (or fail loudly so the sync engine's retry logic can handle it).
  // The sync engine, not the service worker, owns offline behaviour for data.
  // NOTE: must check the URL PATH prefix, not "contains /api/" — a naive
  // substring check here also matched /src/api/client.js (our own app
  // code, not a backend call) and silently excluded it from caching,
  // which only broke visibly on a genuinely offline reload. Found by
  // testing, not assumed.
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached || caches.match('/offline.html'))
      )
    );
    return;
  }

  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Cache-first for pre-cached shell assets; for everything else same-origin
  // (the growing list of screen modules/styles), cache opportunistically as
  // they're fetched, so a second offline visit works without this file
  // needing to enumerate every module by hand.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
