/**
 * IndexedDB persistence for guest movement sessions + localStorage prefs.
 *
 * Mirrors lib/actionLog.js: append-friendly, local to one phone, never on the
 * wire unless the guest explicitly uploads from the history panel.
 */

'use client';

import {
  PREFS_KEY,
  defaultPrefs,
  parsePrefs,
  recordPoint,
  MAX_SESSIONS,
} from './movementLog.js';

const DB = 'parkbound-movement-log';
const STORE = 'state';
const VERSION = 1;
const STATE_KEY = 'current';

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function emptyState() {
  return { key: STATE_KEY, sessions: [], openId: null, updatedAt: Date.now() };
}

export async function loadState() {
  const db = await openDb();
  if (!db) return emptyState();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(STATE_KEY);
    req.onsuccess = () => {
      const row = req.result;
      if (!row || !Array.isArray(row.sessions)) {
        resolve(emptyState());
        return;
      }
      resolve({
        key: STATE_KEY,
        sessions: row.sessions,
        openId: row.openId || null,
        updatedAt: row.updatedAt || Date.now(),
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(state) {
  const db = await openDb();
  if (!db) return false;
  const row = {
    key: STATE_KEY,
    sessions: (state.sessions || []).slice(-MAX_SESSIONS),
    openId: state.openId || null,
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(row);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function loadPrefs() {
  try {
    if (typeof localStorage === 'undefined') return defaultPrefs();
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return parsePrefs(raw);
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs) {
  const next = parsePrefs(prefs);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    }
  } catch {
    // Privacy mode / quota — in-memory prefs still work for this session.
  }
  return next;
}

/**
 * Record one GPS fix when tracking is enabled. Returns the updated state plus
 * whether a point was kept (for UI feedback / diagnostics).
 */
export async function appendFix({ point, venueId, venueName, bounds, enabled }) {
  if (!enabled) {
    const state = await loadState();
    return { ...state, recorded: false, reason: 'disabled' };
  }
  const state = await loadState();
  const next = recordPoint(state, { point, venueId, venueName, bounds });
  if (next.recorded) {
    await saveState(next);
  }
  return next;
}

export async function markUploaded(sessionIds, uploadedAt = Date.now()) {
  const state = await loadState();
  const set = new Set(sessionIds);
  const sessions = state.sessions.map((s) =>
    set.has(s.id) ? { ...s, uploadedAt } : s,
  );
  const next = { ...state, sessions };
  await saveState(next);
  return next;
}

export async function deleteSession(sessionId) {
  const state = await loadState();
  const sessions = state.sessions.filter((s) => s.id !== sessionId);
  const openId = state.openId === sessionId ? null : state.openId;
  const next = { ...state, sessions, openId };
  await saveState(next);
  return next;
}

export async function clearAllSessions() {
  const next = emptyState();
  await saveState(next);
  return next;
}

export async function getSession(sessionId) {
  const state = await loadState();
  return state.sessions.find((s) => s.id === sessionId) || null;
}
