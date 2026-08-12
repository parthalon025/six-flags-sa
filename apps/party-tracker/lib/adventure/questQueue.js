'use client';

/**
 * Side Quests' local outbox — reports queue on the phone the moment a guest
 * taps Submit, whether or not anything is reachable to send them to.
 *
 * "Reports will sync when Side Quests go live" (the panel's own copy) is a
 * promise this file exists to keep: it never blocks on a network, a login,
 * or even a browser storage API being available. IndexedDB is tried first,
 * localStorage next, and a plain in-memory array last — the same fallback
 * ladder as lib/gps/movementStore.js and lib/transport/offlineQueue.js, so a
 * report a guest just typed is never the thing that gets lost.
 *
 * Nothing here uploads. This is the drafts box; upload is a later epic.
 */

import { newMemberId } from '../core/ids.js';
import { distance } from '../geo.js';

export const STATUS_PENDING = 'pending';

/** Adventure rule: a few pins, not a feed — the queue keeps a bounded tail. */
export const MAX_QUEUE = 200;

/** Reports resolved to a place count as "nearby" once this close. */
export const NEARBY_RADIUS_M = 150;

const DB_NAME = 'parkbound-quest-queue';
const DB_STORE = 'reports';
const DB_VERSION = 1;
export const DEFAULT_STORAGE_KEY = 'parkbound.questQueue.v1';

/** Soft session read: a userId to stamp on a report when one exists, never a gate on writing locally. */
export const SESSION_STORAGE_KEY = 'parkbound.session';

/**
 * One queued report, ready to persist. Pure — no storage, no clock reads
 * beyond the `now` a caller may override for tests.
 */
export function createReport({
  questId,
  venueId = null,
  placeId = null,
  kind,
  payload = {},
  lat = null,
  lng = null,
  userId = readSessionUserId(),
  now = Date.now(),
} = {}) {
  if (!questId) throw new Error('createReport requires questId');
  if (!kind) throw new Error('createReport requires kind');
  return {
    id: newMemberId(),
    questId,
    venueId: venueId || null,
    placeId: placeId || null,
    kind,
    payload: payload && typeof payload === 'object' ? payload : {},
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    userId: userId || null,
    createdAt: now,
    status: STATUS_PENDING,
  };
}

/**
 * Best-effort userId from sessionStorage, when a party session happens to be
 * live. Absence is completely ordinary — Side Quests drafts locally with or
 * without one, and it is only ever an enrichment on the report, never a gate.
 */
export function readSessionUserId() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = parsed?.userId ?? parsed?.selfId ?? parsed?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Reports with a resolvable fix, within `radiusM` of `position`, nearest
 * first. A report holding no lat/lng never counts as nearby — this never
 * invents a coordinate to make the count look better.
 */
export function nearbyReports(reports = [], position = null, radiusM = NEARBY_RADIUS_M) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return [];
  return reports
    .filter((r) => Number.isFinite(r?.lat) && Number.isFinite(r?.lng))
    .map((r) => ({ report: r, distanceM: distance(position.lat, position.lng, r.lat, r.lng) }))
    .filter(({ distanceM }) => distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .map(({ report }) => report);
}

function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

const byCreatedAt = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

/**
 * Build one queue instance. A factory rather than a singleton so a test (or
 * a future multi-venue queue) can hold its own storageKey/dbName without
 * stepping on another instance's persisted state — mirrors
 * lib/transport/offlineQueue.js's createOfflineQueue.
 */
export function createQuestQueue({
  storageKey = DEFAULT_STORAGE_KEY,
  dbName = DB_NAME,
  dbVersion = DB_VERSION,
  max = MAX_QUEUE,
} = {}) {
  let memory = [];
  let dbPromise = null;

  function openDb() {
    if (!hasIndexedDb()) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(dbName, dbVersion);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
              db.createObjectStore(DB_STORE, { keyPath: 'id' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  function readLocalStorage() {
    if (!hasLocalStorage()) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLocalStorage(list) {
    if (!hasLocalStorage()) return false;
    try {
      // Bounded on write too — a phone that never reopens the tab should not
      // grow this without limit either.
      localStorage.setItem(storageKey, JSON.stringify(list.slice(-max)));
      return true;
    } catch {
      // Quota exceeded or a read-only store: the in-memory copy for this
      // session still works, it just will not survive a reload.
      return false;
    }
  }

  async function load() {
    const db = await openDb();
    if (db) {
      const rows = await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).getAll();
          req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (rows) return [...rows].sort(byCreatedAt);
    }
    const ls = readLocalStorage();
    if (ls) return [...ls].sort(byCreatedAt);
    return [...memory].sort(byCreatedAt);
  }

  /** Persist a report already built with `createReport`. Returns it back. */
  async function enqueue(report) {
    if (!report || !report.id) throw new Error('enqueue expects a report built by createReport');
    const db = await openDb();
    if (db) {
      const ok = await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(report);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
      if (ok) return report;
    }
    if (hasLocalStorage()) {
      const list = readLocalStorage() || [];
      list.push(report);
      if (writeLocalStorage(list)) return report;
    }
    memory.push(report);
    while (memory.length > max) memory.shift();
    return report;
  }

  async function remove(id) {
    const db = await openDb();
    if (db) {
      const ok = await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(id);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
      if (ok) return;
    }
    if (hasLocalStorage()) {
      writeLocalStorage((readLocalStorage() || []).filter((r) => r.id !== id));
      return;
    }
    memory = memory.filter((r) => r.id !== id);
  }

  async function clear() {
    const db = await openDb();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }
    if (hasLocalStorage()) writeLocalStorage([]);
    memory = [];
  }

  async function pendingCount() {
    const list = await load();
    return list.filter((r) => r.status === STATUS_PENDING).length;
  }

  return { enqueue, load, remove, clear, pendingCount };
}

/** The app's one shared outbox — created lazily so importing this module never touches storage. */
let shared = null;
export function defaultQuestQueue() {
  if (!shared) shared = createQuestQueue();
  return shared;
}
