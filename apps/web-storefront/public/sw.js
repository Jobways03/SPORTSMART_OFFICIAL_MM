// Sportsmart storefront — minimal service worker for offline-cart + PWA install.
//
// Scope kept small intentionally: the API surface is too dynamic to
// cache aggressively (prices, stock, sessions), so the SW only:
//   1. Pre-caches the shell + offline fallback HTML on install.
//   2. Network-first for HTML navigations, falling back to /offline.html.
//   3. Cache-first for static assets (icons, manifest, fonts).
//   4. Lets all /api/* requests fall through untouched — sessions and
//      mutations stay correct.
//
// Bump CACHE_VERSION when shipping changes that need stale clients
// invalidated. Activate handler purges old caches so we never serve
// last week's static asset against this week's app shell.

const CACHE_VERSION = 'sportsmart-v1';
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API or auth-bearing requests — sessions + mutations
  // must stay correct.
  if (url.pathname.startsWith('/api/')) return;
  if (req.method !== 'GET') return;

  // Navigation requests: network-first with offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline.html').then((cached) => cached || new Response(
          '<h1>Offline</h1>',
          { headers: { 'Content-Type': 'text/html' } },
        )),
      ),
    );
    return;
  }

  // Static assets (icons, fonts, manifest): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          // Only cache successful, basic-type responses.
          if (!res.ok || res.type !== 'basic') return res;
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          return res;
        }),
      ),
    );
  }
});
