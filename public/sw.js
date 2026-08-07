/* Park wifi is bad and cell coverage in a queue line is worse, so the shell,
   the drawn map and the ride database are cached aggressively.

   Party state is never cached here. It is not that a stale roster is merely
   unhelpful — under the local-first model the roster is sealed ciphertext
   addressed to this device, and a service worker replaying an old envelope
   would feed the client a version it has already applied. Offline party state
   lives in the client's own replica and its outbox instead, which are
   versioned and know how to catch up. */
const CACHE = 'ki-tracker-v3';
const SHELL = [
  '/',
  '/join',
  '/parkmap.json',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

/* Cacheable read-only reference data. Everything else under /api/ is either a
   mailbox (opaque, per-peer, single-delivery) or a mutation. */
const CACHEABLE_API = /^\/api\/(rides|version)(\/|$)/;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 and the whole install fails, which would
      // leave the app with no offline shell at all. Add individually instead.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Cache first, refresh in the background. For things that are big and static. */
function staleWhileRevalidate(request) {
  return caches.match(request).then((hit) => {
    const net = fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => hit);
    return hit || net;
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // fonts etc. handled by the browser

  if (url.pathname.startsWith('/api/')) {
    // The ride database is the one API response worth holding: it is what makes
    // height requirements work with the signal dead in a queue line.
    if (CACHEABLE_API.test(url.pathname)) {
      e.respondWith(staleWhileRevalidate(e.request));
    }
    return; // everything else stays live
  }

  if (url.pathname === '/parkmap.json') {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      // A join link is a client-side route the network can't serve offline, so
      // fall back to the cached shell rather than a browser error page.
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match('/join') || caches.match('/')),
      ),
  );
});
