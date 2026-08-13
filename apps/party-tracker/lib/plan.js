/**
 * Plan — the Party's shared, ordered Places for today.
 *
 * One list. Before join, the same Plan may sit as a draft on this phone.
 * Create, or join when the shared Plan is empty, promotes that draft.
 * Callers pass Party or draft facts via `view` — they do not keep a second
 * ordered-stop store. Favorites on a Member are not this list. Meet is not
 * this list.
 *
 * Relative `.js` imports so the unit suite can load this in plain Node.
 */

/** Shared Plan stops. Same ceiling as personal favorites — the list rides in every snapshot. */
export const PLAN_MAX = 20;

export const DRAFT_KEY = 'party-plan-draft-v1';
const LEGACY_KEY = 'party-scenario-v1';

function storageOf(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function asPlaceId(value) {
  if (typeof value !== 'string') return '';
  const id = value.slice(0, 80);
  return id;
}

/** Wire shape: `{ id, placeId, label }`. */
export function itemFromPlace(place) {
  if (!place || typeof place !== 'object') return null;
  const placeId = asPlaceId(place.placeId || place.i || place.id);
  if (!placeId) return null;
  const labelRaw = place.label || place.n || place.name;
  const label = typeof labelRaw === 'string' && labelRaw ? labelRaw.slice(0, 80) : placeId;
  const idRaw = typeof place.id === 'string' && place.id ? place.id.slice(0, 80) : placeId;
  return { id: idRaw, placeId, label };
}

export function normalize(plan) {
  if (!Array.isArray(plan)) return [];
  const out = [];
  const seen = new Set();
  for (const step of plan.slice(0, PLAN_MAX)) {
    const item = itemFromPlace(step);
    if (!item || seen.has(item.placeId)) continue;
    seen.add(item.placeId);
    out.push(item);
  }
  return out;
}

/** Add a Place if it is not already a stop. Caps at PLAN_MAX. */
export function star(plan, place) {
  const current = normalize(plan);
  const item = itemFromPlace(place);
  if (!item) return current;
  if (current.some((s) => s.placeId === item.placeId)) return current;
  if (current.length >= PLAN_MAX) return current;
  return [...current, item];
}

export function unstar(plan, placeId) {
  const id = asPlaceId(placeId);
  return normalize(plan).filter((s) => s.placeId !== id);
}

export function reorder(plan, index, delta) {
  const items = normalize(plan);
  const j = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return items;
  if (j < 0 || j >= items.length) return items;
  const next = items.slice();
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Down rides stay on the Plan, struck through. */
export function withDown(plan, rides = {}) {
  return normalize(plan).map((step) => {
    const report = step.placeId ? rides[step.placeId] : null;
    const down = report?.status === 'down';
    return {
      ...step,
      down,
      reason: down ? report.note || 'Reported down' : null,
    };
  });
}

function itemsFromLegacy(raw) {
  try {
    const sc = JSON.parse(raw);
    return normalize(Array.isArray(sc?.steps) ? sc.steps : []);
  } catch {
    return [];
  }
}

export function loadDraft(storage) {
  const store = storageOf(storage);
  if (!store?.getItem) return [];
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (raw) return normalize(JSON.parse(raw));
    const legacy = store.getItem(LEGACY_KEY);
    if (!legacy) return [];
    const items = itemsFromLegacy(legacy);
    if (items.length) {
      store.setItem?.(DRAFT_KEY, JSON.stringify(items));
      store.removeItem?.(LEGACY_KEY);
    }
    return items;
  } catch {
    return [];
  }
}

export function saveDraft(plan, storage) {
  const store = storageOf(storage);
  if (!store?.setItem) return normalize(plan);
  const items = normalize(plan);
  store.setItem(DRAFT_KEY, JSON.stringify(items));
  store.removeItem?.(LEGACY_KEY);
  return items;
}

export function clearDraft(storage) {
  const store = storageOf(storage);
  if (!store?.removeItem) return [];
  store.removeItem(DRAFT_KEY);
  store.removeItem(LEGACY_KEY);
  return [];
}

/**
 * Items to write into a shared Plan, or null when there is nothing to promote
 * (empty draft, or the shared Plan already has stops).
 */
export function promote(draft, shared) {
  const existing = normalize(shared);
  if (existing.length) return null;
  const items = normalize(draft);
  return items.length ? items : null;
}

/**
 * The one list to show. In a Party, the shared Plan — even when empty.
 * Otherwise the draft on this phone.
 */
export function view({ party, draft } = {}) {
  if (party?.active) return normalize(party.plan);
  return normalize(draft);
}
