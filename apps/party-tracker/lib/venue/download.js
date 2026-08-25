/* The venue download manager (ADR-0018; ADR-0013 item 5).
 *
 * A venue bundle is everything one World needs offline — the truth trio the
 * store already fetches plus the display-pack files — listed, hash-pinned,
 * in `/venues/<id>.bundle.json` on the deployed origin. This module fetches
 * by that manifest and keeps a verified copy in Cache Storage.
 *
 * Cache Storage rather than IndexedDB, on purpose: the app's whole offline
 * path for venue files already runs through the service worker's caches —
 * the store fetches, sw.js answers from cache. Verified bundle bytes go into
 * their own cache (`VENUE_BUNDLE_CACHE`), which sw.js prefers for /venues/
 * requests and preserves across version bumps: content is addressed by the
 * manifest's hashes, not by app version, so a deploy invalidates nothing
 * that did not change and a guest re-downloads only changed bytes.
 *
 * The manifest is re-checked when the app starts and a connection is
 * available (CONTEXT.md's World rule); pre-bundled seed venues short-circuit
 * — bytes already in any cache that hash correctly are adopted without a
 * network fetch. Nothing here throws: offline is an ordinary state, and the
 * map a phone already holds is never worse off for a failed sync.
 *
 * Delivery `?since=<revision_id>` (ticket 17) is a server query on the
 * origin manifest. This module still plans from the full bundle + hashes
 * (`planBundleSync`). Slice 1 stub: `packages/venue-builder/lib/delivery/delta-sync.mjs`.
 */

/* Must match BUNDLE_CACHE in public/sw.js — the worker cannot import this
   module, so the name is written down twice and a unit test holds the two
   copies together. */
export const VENUE_BUNDLE_CACHE = 'tracker-venue-bundles-v1';

/** The one URL the app trusts for a venue's bundle. */
export function bundleUrlFor(venue) {
  if (venue?.bundle) return venue.bundle;
  return venue?.id ? `/venues/${venue.id}.bundle.json` : null;
}

/**
 * The fetch URL for one bundle entry. The hash rides as a query so the
 * service worker's cache-first paths miss on changed content and the request
 * reaches the network — the hash is the address, which is the whole reason a
 * re-download only ever happens on change.
 */
export function hashedUrlFor(entry) {
  return `${entry.path}?v=${entry.sha256.slice(0, 16)}`;
}

/** path → sha256 for a stored manifest; an absent manifest is an empty index. */
export function bundleIndexOf(manifest) {
  const index = new Map();
  for (const f of manifest?.files || []) {
    if (f?.path && f?.sha256) index.set(f.path, f.sha256);
  }
  return index;
}

/**
 * Pure: what a sync has to do. `fetch` is every entry whose pinned hash the
 * held copy does not match, `keep` is everything already right, `drop` is
 * every held path the new manifest no longer ships.
 */
export function planBundleSync(manifest, previousIndex = new Map()) {
  const files = (manifest?.files || []).filter((f) => f?.path && f?.sha256);
  const wanted = new Set(files.map((f) => f.path));
  return {
    fetch: files.filter((f) => previousIndex.get(f.path) !== f.sha256),
    keep: files.filter((f) => previousIndex.get(f.path) === f.sha256),
    drop: [...previousIndex.keys()].filter((p) => !wanted.has(p)),
  };
}

/** Lowercase hex sha256, or null where WebCrypto is unavailable. */
export async function sha256Hex(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) return null;
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function contentTypeFor(path) {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function readCachedManifest(cache, url) {
  try {
    const hit = await cache.match(url);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

/**
 * Bytes for an entry that are already on this phone — any cache, including
 * the service worker's seed precache — verified against the pinned hash.
 * This is the pre-bundled short-circuit: a venue that shipped with the app
 * is adopted into the bundle cache without a single network fetch.
 */
async function verifiedLocalBytes(entry, cacheStorage, cryptoImpl) {
  try {
    const hit = await cacheStorage.match(entry.path);
    if (!hit) return null;
    const bytes = await hit.arrayBuffer();
    return (await sha256Hex(bytes, cryptoImpl)) === entry.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

function responseFor(entry, bytes) {
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': contentTypeFor(entry.path) },
  });
}

/**
 * Fetch-and-cache one venue's bundle from the deployed origin, by manifest.
 *
 * Never throws. Returns what happened: `{ ok, fetched, reused, kept,
 * dropped, failed }` on a sync that ran, `{ ok: false, reason }` when it
 * could not — offline, no bundle manifest deployed yet, no WebCrypto, no
 * Cache Storage. The manifest itself is committed to the cache only after
 * every entry verified, so a half-landed bundle re-syncs next start instead
 * of masquerading as current.
 *
 * @param {{ id?: string, bundle?: string } | null} venue a manifest row
 * @param {{ fetchImpl?: typeof fetch, cacheStorage?: CacheStorage,
 *           cryptoImpl?: Crypto, online?: boolean }} [deps] injected for tests
 */
export async function syncVenueBundle(venue, deps = {}) {
  const {
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    cacheStorage = typeof caches !== 'undefined' ? caches : null,
    cryptoImpl = globalThis.crypto,
    online = typeof navigator === 'undefined' || navigator.onLine !== false,
  } = deps;
  const url = bundleUrlFor(venue);
  if (!url) return { ok: false, reason: 'no-venue' };
  if (!fetchImpl || !cacheStorage) return { ok: false, reason: 'unsupported' };
  // No WebCrypto means no verification, and unverified bytes do not get to
  // claim the bundle cache — the service worker's plain caching still works.
  if (!cryptoImpl?.subtle) return { ok: false, reason: 'no-crypto' };
  if (!online) return { ok: false, reason: 'offline' };

  let manifest = null;
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res?.ok) return { ok: false, reason: 'no-manifest' };
    manifest = await res.json();
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (!Array.isArray(manifest?.files)) return { ok: false, reason: 'no-manifest' };

  try {
    const cache = await cacheStorage.open(VENUE_BUNDLE_CACHE);
    const previous = await readCachedManifest(cache, url);
    const plan = planBundleSync(manifest, bundleIndexOf(previous));
    let fetched = 0;
    let reused = 0;
    const failed = [];

    for (const entry of plan.fetch) {
      const local = await verifiedLocalBytes(entry, cacheStorage, cryptoImpl);
      if (local) {
        await cache.put(entry.path, responseFor(entry, local));
        reused += 1;
        continue;
      }
      try {
        const res = await fetchImpl(hashedUrlFor(entry), { cache: 'no-store' });
        if (!res?.ok) {
          failed.push(entry.path);
          continue;
        }
        const bytes = await res.arrayBuffer();
        if ((await sha256Hex(bytes, cryptoImpl)) !== entry.sha256) {
          // Wrong bytes are worse than no bytes: never cached.
          failed.push(entry.path);
          continue;
        }
        await cache.put(entry.path, responseFor(entry, bytes));
        fetched += 1;
      } catch {
        failed.push(entry.path);
      }
    }

    for (const stale of plan.drop) await cache.delete(stale);

    if (!failed.length) {
      await cache.put(
        url,
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return {
      ok: failed.length === 0,
      fetched,
      reused,
      kept: plan.keep.length,
      dropped: plan.drop.length,
      failed,
    };
  } catch {
    return { ok: false, reason: 'cache-error' };
  }
}
