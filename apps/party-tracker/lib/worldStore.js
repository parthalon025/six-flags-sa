/**
 * Local Skin / Kit / Wear progress. Same storage ladder as Side Quest drafts:
 * IndexedDB, then localStorage, then memory. Nothing here uploads.
 */

import { createProgress } from './world.js';

export const WORLD_STORAGE_KEY = 'parkbound.world.v1';
const DB_NAME = 'parkbound-world';
const DB_STORE = 'state';
const DB_VERSION = 1;
const RECORD_ID = 'current';

export function emptySavedWorld({ userId = null } = {}) {
  return { progress: createProgress({ userId }), acceptedOffer: null };
}

/** Merge a persisted blob onto a fresh progress so old saves cannot drop meters. */
export function hydrateSavedWorld(raw, { userId = null } = {}) {
  const fresh = emptySavedWorld({ userId });
  if (!raw || typeof raw !== 'object') return fresh;
  const meters = { ...fresh.progress.meters, ...(raw.progress?.meters || {}) };
  return {
    progress: {
      ...fresh.progress,
      ...(raw.progress && typeof raw.progress === 'object' ? raw.progress : {}),
      meters,
      userId: userId || raw.progress?.userId || null,
    },
    acceptedOffer: raw.acceptedOffer && typeof raw.acceptedOffer === 'object' ? raw.acceptedOffer : null,
  };
}

function memoryStore() {
  const mem = globalThis.__parkboundWorldMem ?? (globalThis.__parkboundWorldMem = { value: null });
  return {
    getItem() {
      return mem.value;
    },
    setItem(_key, value) {
      mem.value = value;
    },
  };
}

function localStorageStore() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readSavedWorld(storage, { userId = null } = {}) {
  const store = storage || localStorageStore() || memoryStore();
  try {
    const raw = store.getItem(WORLD_STORAGE_KEY);
    return hydrateSavedWorld(raw ? JSON.parse(raw) : null, { userId });
  } catch {
    return emptySavedWorld({ userId });
  }
}

export function writeSavedWorld(saved, storage) {
  const store = storage || localStorageStore() || memoryStore();
  try {
    store.setItem(WORLD_STORAGE_KEY, JSON.stringify(saved || emptySavedWorld()));
  } catch {
    /* quota / private mode */
  }
  return saved;
}

function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadWorld({ userId = null } = {}) {
  const db = await openDb();
  if (db) {
    const fromDb = await new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(RECORD_ID);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (fromDb?.progress) return hydrateSavedWorld(fromDb, { userId });
  }
  return readSavedWorld(null, { userId });
}

export async function saveWorld(saved) {
  writeSavedWorld(saved);
  const db = await openDb();
  if (!db) return saved;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ id: RECORD_ID, ...saved });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  return saved;
}
