/* Park wifi is bad and cell coverage in a queue line is worse, so the shell and
   the drawn map are cached aggressively. Party data is never cached — a stale
   roster is worse than no roster. */
const CACHE = 'ki-tracker-v1';
const SHELL = ['/', '/parkmap.json', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;          // always live
  if (url.origin !== self.location.origin) return;       // fonts etc. handled by the browser

  // The map file is big and never changes: serve from cache, refresh behind.
  if (url.pathname === '/parkmap.json') {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const net = fetch(e.request).then((res) => {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || net;
      }),
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/'))),
  );
});
