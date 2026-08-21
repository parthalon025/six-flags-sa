/**
 * Overlay — the phone’s pending/accepted Contribution layer on the shipped
 * Venue map. Pure: no storage, no network, no Party mesh.
 *
 * This phone’s map draws Overlay, not the Side Quest upload queue. Last
 * Contribution per Place + type is the drawn fact; completions stay as a
 * list. Live Ride reports are not Overlay.
 */

export const FIELD_TYPES = Object.freeze([
  'height',
  'queue',
  'path',
  'restroom',
  'food',
  'gate',
  'camping',
]);

const FIELD = new Set(FIELD_TYPES);

export const COMPLETIONS_MAX = 200;

export function emptyOverlay() {
  return { drawn: {}, completions: [] };
}

export function normalizeOverlay(raw) {
  if (!raw || typeof raw !== 'object') return emptyOverlay();
  const completions = Array.isArray(raw.completions)
    ? raw.completions.map((c) => normalizeContribution(c)).filter(Boolean)
    : [];
  const drawnIn = raw.drawn && typeof raw.drawn === 'object' ? raw.drawn : {};
  const drawn = {};
  for (const [key, value] of Object.entries(drawnIn)) {
    const c = normalizeContribution(value);
    if (c) drawn[key] = c;
  }
  if (!completions.length && Object.keys(drawn).length) {
    return { drawn, completions: Object.values(drawn) };
  }
  return { drawn: Object.keys(drawn).length ? drawn : rebuildDrawn(completions), completions };
}

export function overlayKey(type, placeId) {
  return `${type || ''}:${placeId || ''}`;
}

export function normalizeContribution(raw = {}, now = Date.now()) {
  const type = FIELD.has(raw.type) ? raw.type : null;
  if (!type) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : null;
  if (!id) return null;
  const placeId = typeof raw.placeId === 'string' && raw.placeId ? raw.placeId.slice(0, 80) : null;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  return {
    id,
    type,
    placeId,
    venueId: typeof raw.venueId === 'string' ? raw.venueId.slice(0, 80) : null,
    authorId: typeof raw.authorId === 'string' ? raw.authorId.slice(0, 80) : null,
    authorName: typeof raw.authorName === 'string' ? raw.authorName.slice(0, 40) : 'Someone',
    authorTitle: typeof raw.authorTitle === 'string' && raw.authorTitle ? raw.authorTitle.slice(0, 24) : null,
    payload,
    lat: Number.isFinite(raw.lat) ? raw.lat : null,
    lng: Number.isFinite(raw.lng) ? raw.lng : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
  };
}

export function contributionFromGapSubmit({
  id,
  type,
  placeId = null,
  venueId = null,
  authorId = null,
  authorName = 'Someone',
  authorTitle = null,
  payload = {},
  lat = null,
  lng = null,
  now = Date.now(),
} = {}) {
  return normalizeContribution(
    { id, type, placeId, venueId, authorId, authorName, authorTitle, payload, lat, lng, createdAt: now },
    now,
  );
}

function rebuildDrawn(completions) {
  const drawn = {};
  for (const c of completions) {
    const key = overlayKey(c.type, c.placeId);
    const cur = drawn[key];
    if (!cur || c.createdAt >= cur.createdAt) drawn[key] = c;
  }
  return drawn;
}

export function applyContribution(overlay = emptyOverlay(), raw, now = Date.now()) {
  const contribution = normalizeContribution(raw, now);
  if (!contribution) return overlay || emptyOverlay();
  const completions = Array.isArray(overlay?.completions) ? overlay.completions : [];
  if (completions.some((c) => c.id === contribution.id)) {
    return { drawn: overlay.drawn || rebuildDrawn(completions), completions };
  }
  const next = [...completions, contribution];
  while (next.length > COMPLETIONS_MAX) next.shift();
  return { drawn: rebuildDrawn(next), completions: next };
}

export function unionOverlays(a = emptyOverlay(), b = emptyOverlay()) {
  const seen = new Set();
  const completions = [];
  for (const c of [...(a.completions || []), ...(b.completions || [])]) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    completions.push(c);
  }
  completions.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  const trimmed = completions.slice(-COMPLETIONS_MAX);
  return { drawn: rebuildDrawn(trimmed), completions: trimmed };
}

export function authoredOnly(overlay = emptyOverlay(), authorId) {
  const completions = (overlay.completions || []).filter((c) => c.authorId && c.authorId === authorId);
  return { drawn: rebuildDrawn(completions), completions };
}

export function completionsForPlace(overlay = emptyOverlay(), placeId) {
  const id = placeId || '';
  return (overlay.completions || []).filter((c) => (c.placeId || '') === id);
}

export function completionLine(c) {
  if (!c) return '';
  // First-to-find credit: the finder's name (and Title, once earned) rides on
  // the fact. Confirms and denies stay statistical — no names on those.
  const name = c.authorName || 'Someone';
  const who = c.authorTitle ? `${name} · ${c.authorTitle}` : name;
  if (c.type === 'height') {
    const n = c.payload?.heightIn;
    if (n === 0) return `${who} confirmed no minimum`;
    if (Number.isFinite(n)) return `${who} confirmed ${n}"`;
    return `${who} confirmed the height sign`;
  }
  if (c.type === 'queue') return `${who} pinned the queue`;
  if (c.type === 'path') return `${who} walked a path`;
  if (c.type === 'restroom' || c.type === 'food' || c.type === 'gate') {
    const name = c.payload?.name;
    return name ? `${who} added ${name}` : `${who} marked a ${c.type}`;
  }
  if (c.type === 'camping') {
    const hook = c.payload?.hookup;
    return hook ? `${who} marked ${hook}` : `${who} confirmed camping`;
  }
  return `${who} completed a Side Quest`;
}

/**
 * Paint Overlay onto shipped Places. Does not mutate `pois`.
 * Path crumbs and queue pins are extra drawables, not walkable geometry.
 */
export function applyOverlayToPlaces(pois = [], overlay = emptyOverlay()) {
  const byId = new Map();
  for (const p of pois) {
    const id = p?.i || p?.id;
    if (!id) continue;
    byId.set(id, { ...p });
  }
  const extras = [];
  const pins = [];
  let venueCamping = null;

  for (const fact of Object.values(overlay.drawn || {})) {
    if (!fact || !FIELD.has(fact.type)) continue;
    const target = fact.placeId;
    if (fact.type === 'height' && target && byId.has(target)) {
      const answer = fact.payload?.heightIn;
      const inches = answer == null || answer === '' ? Number.NaN : Number(answer);
      const p = byId.get(target);
      // A height Contribution answers one question — the posted minimum. The
      // Side Quest sends only `heightIn`, so the fact cannot speak to `alone`
      // (the ride-alone line), `max` or `advisory`. Merge over the shipped
      // rule; replacing it erased `alone`, and Eligibility — computed, never
      // stored — then faithfully recomputed a plain eligible where the rider
      // was Companion. The app stopped telling a family the child needs an
      // adult riding along, and nothing later healed it.
      //
      // `heightIn === 0` is "no minimum posted", a fact about the minimum
      // only — not a claim that this Attraction has no height rule at all. It
      // clears `min` to 'none' and leaves the rest of the rule standing:
      // keeping an `alone` line the Contribution did not contradict can only
      // over-ask for an adult, while dropping a real one under-warns.
      //
      // A payload with no usable inches speaks to nothing, so it paints
      // nothing and leaves `p.overlay` off. An absent answer is spelt out
      // rather than coerced: `Number(null)` and `Number('')` are both 0, and
      // 0 here would read as "no minimum posted" and clear a real one.
      if (Number.isFinite(inches)) {
        p.h = { ...(p.h || {}), min: inches === 0 ? 'none' : inches };
        p.overlay = true;
      }
    } else if (fact.type === 'queue' && Number.isFinite(fact.lat) && Number.isFinite(fact.lng)) {
      if (target && byId.has(target)) {
        const p = byId.get(target);
        p.e = [{ lat: fact.lat, lng: fact.lng, src: { confidence: 'high', sources: ['overlay'] } }];
        p.overlay = true;
      }
      pins.push({
        id: `overlay:queue:${fact.id}`,
        kind: 'queue',
        lat: fact.lat,
        lng: fact.lng,
        label: 'Queue',
      });
    } else if (fact.type === 'path' && Number.isFinite(fact.lat) && Number.isFinite(fact.lng)) {
      pins.push({
        id: `overlay:path:${fact.id}`,
        kind: 'path',
        lat: fact.lat,
        lng: fact.lng,
        label: 'Path',
      });
    } else if (
      (fact.type === 'restroom' || fact.type === 'food' || fact.type === 'gate') &&
      Number.isFinite(fact.lat) &&
      Number.isFinite(fact.lng)
    ) {
      extras.push({
        i: `overlay:${fact.type}:${fact.id}`,
        n: fact.payload?.name || fact.type,
        c: fact.type,
        lat: fact.lat,
        lng: fact.lng,
        overlay: true,
      });
    } else if (fact.type === 'camping') {
      venueCamping = { hookup: fact.payload?.hookup };
      for (const p of byId.values()) {
        if (p.c === 'campsite') {
          p.camp = { ...(p.camp || {}), hookup: fact.payload?.hookup };
          p.overlay = true;
        }
      }
    }
  }

  return {
    places: [...byId.values(), ...extras],
    pins,
    venueCamping,
  };
}

/**
 * Upload seam: local outbox + optional HTTP. Tests pass only `local`.
 * Overlay is not this queue — callers apply Overlay first, then enqueue.
 */
export function createUploadSeam(adapters = []) {
  const list = Array.isArray(adapters) ? adapters.filter(Boolean) : [];
  return {
    async enqueue(contribution) {
      const errors = [];
      for (const adapter of list) {
        try {
          await adapter.enqueue(contribution);
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length === list.length && list.length) throw errors[0];
      return contribution;
    },
  };
}

/** Map Overlay Field Research types onto the contributions API `kind`. */
const HTTP_KIND = {
  height: 'height',
  queue: 'geometry',
  path: 'geometry',
  restroom: 'amenity',
  food: 'amenity',
  gate: 'amenity',
  camping: 'amenity',
};

export function contributionHttpBody(contribution) {
  if (!contribution) return contribution;
  return {
    id: contribution.id || undefined,
    authorId: contribution.authorId,
    venueId: contribution.venueId,
    placeId: contribution.placeId || undefined,
    kind: HTTP_KIND[contribution.type] || contribution.kind || contribution.type,
    payload: { ...(contribution.payload || {}), overlayType: contribution.type, id: contribution.id },
    lat: contribution.lat,
    lng: contribution.lng,
  };
}

export function createHttpUploadAdapter({
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  url = '/api/contributions',
} = {}) {
  return {
    name: 'http',
    async enqueue(contribution) {
      if (!fetchImpl) return { skipped: true };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contributionHttpBody(contribution)),
      });
      if (!res.ok) throw new Error(`contribute HTTP ${res.status}`);
      return contribution;
    },
  };
}

export function createLocalUploadAdapter({ enqueue }) {
  if (typeof enqueue !== 'function') throw new Error('local adapter needs enqueue');
  return {
    name: 'local',
    enqueue,
  };
}

export const OVERLAY_KEY = 'parkbound.overlay.v1';

function storageOf(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadOverlay(storage) {
  const store = storageOf(storage);
  if (!store) return emptyOverlay();
  try {
    return normalizeOverlay(JSON.parse(store.getItem(OVERLAY_KEY) || 'null'));
  } catch {
    return emptyOverlay();
  }
}

export function saveOverlay(overlay, storage) {
  const store = storageOf(storage);
  const next = normalizeOverlay(overlay);
  if (!store) return next;
  try {
    store.setItem(OVERLAY_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

