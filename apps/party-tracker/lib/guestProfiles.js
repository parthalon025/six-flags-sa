/* Local guest profiles: a small roster of riders — a label, a height, and
 * whether an adult is assumed along — kept only on this phone. Heights are
 * personal, so this never touches the party wire: it is a plain
 * localStorage-backed store, the same shape lib/venue/store.js uses for
 * anything that outlives a render but is not itself React state.
 *
 * The functions below split into two groups on purpose: the list-transforming
 * ones (add/update/remove/normalize) are pure and take/return arrays, so the
 * unit suite can exercise them straight in Node with no DOM. The load/save
 * pair is the only part that touches localStorage, guarded so importing this
 * module outside a browser is harmless rather than a crash.
 */

/** A "small list" tops out here — plenty for a family, short enough to stay
 *  a strip of chips rather than a scrolling settings page. */
export const MAX_GUESTS = 6;

const LS_GUESTS = 'party.guestProfiles.v1';
const LS_ACTIVE = 'party.guestProfiles.active.v1';

const hasStorage = () => typeof localStorage !== 'undefined';

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

/** Coerces anything read back from storage (or handed in by a caller) into a
 *  guest shape the rest of the app can rely on, or drops it if it is not
 *  salvageable. */
export function normalizeGuestProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Guest';
  const heightIn = Number.isFinite(raw.heightIn) ? raw.heightIn : null;
  const withAdult = Boolean(raw.withAdult);
  return { id, label, heightIn, withAdult };
}

export function createGuestProfile({ label, heightIn = null, withAdult = false } = {}) {
  return normalizeGuestProfile({ id: makeId(), label, heightIn, withAdult });
}

const clean = (list) => (list || []).map(normalizeGuestProfile).filter(Boolean);

/** Returns a new list — never mutates the one passed in — capped at
 *  MAX_GUESTS. A list already at the cap comes back unchanged. */
export function addGuestProfile(list, patch) {
  const next = clean(list);
  if (next.length >= MAX_GUESTS) return next;
  next.push(createGuestProfile(patch));
  return next;
}

export function updateGuestProfile(list, id, patch) {
  return clean(list).map((g) => (g.id === id ? normalizeGuestProfile({ ...g, ...patch, id: g.id }) : g));
}

export function removeGuestProfile(list, id) {
  return clean(list).filter((g) => g.id !== id);
}

export function findGuestProfile(list, id) {
  if (!id) return null;
  return clean(list).find((g) => g.id === id) || null;
}

export function loadGuestProfiles() {
  if (!hasStorage()) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LS_GUESTS) || '[]');
    if (!Array.isArray(raw)) return [];
    return clean(raw).slice(0, MAX_GUESTS);
  } catch {
    return [];
  }
}

export function saveGuestProfiles(list) {
  const next = clean(list).slice(0, MAX_GUESTS);
  if (hasStorage()) {
    try {
      localStorage.setItem(LS_GUESTS, JSON.stringify(next));
    } catch {
      /* storage full or blocked — the in-memory list still works this session */
    }
  }
  return next;
}

export function loadActiveGuestId() {
  if (!hasStorage()) return null;
  try {
    return localStorage.getItem(LS_ACTIVE) || null;
  } catch {
    return null;
  }
}

export function saveActiveGuestId(id) {
  if (!hasStorage()) return;
  try {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  } catch {
    /* no-op */
  }
}
