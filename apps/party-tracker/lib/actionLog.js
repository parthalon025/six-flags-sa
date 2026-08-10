/**
 * Append-only observation log in IndexedDB.
 *
 * Records what the party believed and when — the observation series the app
 * lacks. Not on the wire; local to one phone.
 */

const DB = 'party-action-log';
const STORE = 'entries';
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

/** Append one entry. Throws on duplicate id — append-only by structure. */
export async function append(entry) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(entry);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/** Recent entries, newest first. */
export async function recent(limit = 50) {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const idx = store.index('ts');
    const out = [];
    idx.openCursor(null, 'prev').onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function entryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
