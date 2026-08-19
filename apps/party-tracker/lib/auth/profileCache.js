/**
 * Offline profile snapshot (EP.4) — IndexedDB after sign-in.
 * Never stores magic-link tokens; only fields needed for UX + attribution.
 */

const DB_NAME = 'parkbound.profile';
const STORE = 'snapshot';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

/** @param {object} profile */
export async function writeProfileCache(profile) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...profile, cachedAt: new Date().toISOString() }, KEY);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Read-modify-write in ONE IndexedDB transaction, so two concurrent patches
 * (the Me stats refresh, the finder-credit toggle) can never clobber each
 * other's fields. Returns the merged snapshot, or null without a Profile.
 */
export async function patchProfileCache(patch) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(KEY);
    let next = null;
    req.onsuccess = () => {
      const snap = req.result;
      if (!snap?.userId) return;
      next = { ...snap, ...patch, cachedAt: new Date().toISOString() };
      store.put(next, KEY);
    };
    tx.oncomplete = () => {
      db.close();
      resolve(next);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function readProfileCache() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

export async function clearProfileCache() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    return false;
  }
}

/**
 * Finder-credit preference: named credit on Contributions. Unset means on —
 * the display name is already public on the Party roster, and named credit
 * is the social reward for finding. Explicit false means "a fellow guest".
 */
export function sharesName(snapshot) {
  return snapshot?.shareName !== false;
}

/** @returns {Array<{ id: string, displayName: string, heightIn?: number, heightConfirmedAt?: string }>} */
export async function listManagedGuests() {
  const snap = await readProfileCache();
  return Array.isArray(snap?.guests) ? snap.guests : [];
}

/**
 * Save or replace a Managed Guest on the cached Profile. Does not touch the
 * live Party roster.
 */
export async function upsertManagedGuest(guest) {
  const snap = await readProfileCache();
  if (!snap?.userId) throw new Error('A Profile is required to save a Managed Guest');
  const id = String(guest?.id || `g_${Date.now().toString(36)}`);
  const next = {
    id,
    displayName: String(guest?.displayName || 'Guest').slice(0, 24),
    heightIn: Number.isFinite(guest?.heightIn) ? guest.heightIn : null,
    heightConfirmedAt: guest?.heightConfirmedAt || new Date().toISOString(),
  };
  const guests = listWithout(snap.guests, id);
  guests.push(next);
  await writeProfileCache({ ...snap, guests });
  return next;
}

function listWithout(guests, id) {
  return (Array.isArray(guests) ? guests : []).filter((g) => g?.id !== id);
}
