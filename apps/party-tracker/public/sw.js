/* Park wifi is bad and cell coverage in a queue line is worse, so the shell,
   the drawn map of whichever venue is loaded, and its place list are cached
   aggressively.

   Party state is never cached here. It is not that a stale roster is merely
   unhelpful — under the local-first model the roster is sealed ciphertext
   addressed to this device, and a service worker replaying an old envelope
   would feed the client a version it has already applied. Offline party state
   lives in the client's own replica and its outbox instead, which are
   versioned and know how to catch up. */
/* Replaced by scripts/inject-version.mjs from package.json on prebuild/predev. */
const CACHE = 'tracker-1.11.1';
const SHELL = [
  '/',
  '/join',
  '/venues/manifest.json',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

/**
 * Which venue's geometry to hold is not known at build time — the manifest
 * decides, and a deployment can ship several. Precache the default one so a
 * phone that installs the app at home has a map before it loses signal in the
 * car park; any other venue is cached the first time it is opened.
 */
async function precacheDefaultVenue(cache) {
  try {
    const manifest = await fetch('/venues/manifest.json').then((r) => r.json());
    const venue = manifest.venues?.find((v) => v.id === manifest.default) || manifest.venues?.[0];
    if (!venue) return;
    await Promise.all([venue.map, venue.pois, venue.gaps].filter(Boolean).map((u) => cache.add(u).catch(() => {})));
  } catch {
    /* offline at install time: the runtime handler will catch it later */
  }
}

/* Cacheable read-only reference data. Everything else under /api/ is either a
   mailbox (opaque, per-peer, single-delivery) or a mutation. */
const CACHEABLE_API = /^\/api\/(rides|version)(\/|$)/;

/* The page asks a waiting worker to skip the queue once it has shown the toast. */
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 and the whole install fails, which would
      // leave the app with no offline shell at all. Add individually instead.
      .then(async (c) => {
        await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
        await precacheDefaultVenue(c);
      })
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

/** Cache first, refresh in the background. For the app shell and hashed assets. */
function cacheFirstRevalidate(request) {
  return caches.match(request).then((cached) => {
    const fetchPromise = fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      }
      return res;
    });
    return cached || fetchPromise;
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // fonts etc. handled by the browser

  if (url.pathname.startsWith('/api/')) {
    // The ride database is the one API response worth holding: it is what makes
    // height requirements work with the signal dead in a queue line.
    //
    // /api/weather is deliberately not on that list. A cached forecast handed
    // back with no indication of its age is worse than none — it would say
    // "clear" through a thunderstorm. The offline copy lives in localStorage
    // instead, stamped with when it was taken, so the UI can show the age.
    if (CACHEABLE_API.test(url.pathname)) {
      e.respondWith(staleWhileRevalidate(e.request));
    }
    return; // everything else stays live
  }

  // Venue files are big, static and the whole point of the app working with no
  // signal, so they are held for as long as the cache lives.
  if (url.pathname.startsWith('/venues/')) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  if (
    url.pathname === '/' ||
    url.pathname === '/join' ||
    url.pathname.startsWith('/_next/static/')
  ) {
    e.respondWith(cacheFirstRevalidate(e.request));
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

/* ============================================================
   notifications
   ============================================================

   A push arrives when the page is gone: no React, no party runtime, nothing
   but this worker and whatever is on disk. So the body arrives sealed with the
   party key, and the key is read back out of IndexedDB where the page left it.

   Chrome requires `userVisibleOnly`, which means every push must put something
   on screen. That is not a constraint to work around here — if the envelope
   cannot be opened, the honest thing is still to say that something happened
   and let the person open the app, rather than to stay silent about a message
   that might have been someone asking for help. */

const PUSH_DB = 'tracker-push';
const PUSH_STORE = 'party';

function readParty() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(PUSH_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(PUSH_STORE);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const get = db.transaction(PUSH_STORE, 'readonly').objectStore(PUSH_STORE).get('current');
        get.onsuccess = () => {
          resolve(get.result || null);
          db.close();
        };
        get.onerror = () => {
          resolve(null);
          db.close();
        };
      } catch {
        resolve(null);
      }
    };
  });
}

function b64url(str) {
  const padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/* The same envelope shape lib/core/crypto.js seals: the party id is
   authenticated but not encrypted, so a frame cannot be relabelled into
   another party without the tag failing. */
async function unseal(keyString, partyId, sealed) {
  const key = await crypto.subtle.importKey('raw', b64url(keyString), { name: 'AES-GCM' }, true, [
    'decrypt',
  ]);
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b64url(sealed.iv),
      additionalData: new TextEncoder().encode(partyId),
    },
    key,
    b64url(sealed.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      const vague = {
        title: 'Something happened in your party',
        body: 'Open the map to see.',
        data: {},
      };
      let payload = null;
      try {
        payload = e.data?.json();
      } catch {
        /* not ours, or truncated */
      }

      let note = null;
      let party = null;
      if (payload?.sealed && payload?.pid) {
        party = await readParty();
        // A push for a party this phone has left is not readable, and should
        // not be: leaving cleared the key.
        if (party?.keyString && party.partyId === payload.pid) {
          try {
            note = await unseal(party.keyString, payload.pid, payload.sealed);
          } catch {
            /* wrong key, or a tampered frame */
          }
        }
      }

      /* Kinds the owner has switched off are not shown. This does technically
         spend a `userVisibleOnly` push without putting anything on screen, and
         a browser may eventually substitute its own generic card if that
         happens a lot — which is the right pressure, and the reason only the
         cry-wolf one ("someone has gone quiet") is off by default. */
      if (note && party?.prefs && party.prefs[note.kind] === false) return;

      const shown = note
        ? {
            title: note.title || vague.title,
            body: note.body || '',
            data: { focus: note.focus || null },
            tag: note.kind === 'help' ? `help-${note.focus?.id || 'x'}` : note.kind || 'party',
            // Help re-alerts even if a card for it is already on screen; the
            // rest replace quietly rather than stacking up a wall of cards.
            renotify: note.kind === 'help',
            requireInteraction: note.kind === 'help',
            vibrate: note.kind === 'help' ? [120, 70, 120] : [60],
          }
        : { ...vague, tag: 'party' };

      await self.registration.showNotification(shown.title, {
        body: shown.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: shown.data,
        tag: shown.tag,
        renotify: shown.renotify,
        requireInteraction: shown.requireInteraction,
        vibrate: shown.vibrate,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const focus = e.notification.data?.focus || null;
  // Tapping a notification means "show me this", so it re-uses an open tab
  // where there is one rather than stacking up copies of the app.
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = all.find((c) => c.url.includes(self.registration.scope));
      if (open) {
        await open.focus();
        open.postMessage({ type: 'notification-open', focus });
        return;
      }
      await self.clients.openWindow(focus ? `/?focus=${encodeURIComponent(JSON.stringify(focus))}` : '/');
    })(),
  );
});
