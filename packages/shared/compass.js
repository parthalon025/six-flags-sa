/**
 * Facing-relative Compass — phone strip and Apple Watch dial.
 *
 * Mark language is one product rule set; surfaces only lay it out.
 * See CONTEXT.md (**Compass**) and docs/adr/0011-facing-compass.md.
 */

/** @typedef {'glance' | 'split' | 'detail'} CompassDensity */
/** @typedef {'calm' | 'full' | 'off'} CompassAlwaysOn */
/** @typedef {'imperial' | 'metric'} CompassUnits */

export const WATCH_SETTINGS_KEY = 'parkbound-watch-compass-v1';

/** Shipping default — glance-first density, calm Always On. */
export const DEFAULT_WATCH_SETTINGS = Object.freeze({
  density: /** @type {CompassDensity} */ ('glance'),
  alwaysOn: /** @type {CompassAlwaysOn} */ ('calm'),
  showParty: true,
  showMeet: true,
  units: /** @type {CompassUnits} */ ('imperial'),
  turnHaptics: true,
  raiseToNav: true,
});

const DENSITIES = new Set(['glance', 'split', 'detail']);
const ALWAYS_ON = new Set(['calm', 'full', 'off']);
const UNITS = new Set(['imperial', 'metric']);

export function normalizeWatchSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    density: DENSITIES.has(src.density) ? src.density : DEFAULT_WATCH_SETTINGS.density,
    alwaysOn: ALWAYS_ON.has(src.alwaysOn) ? src.alwaysOn : DEFAULT_WATCH_SETTINGS.alwaysOn,
    showParty: src.showParty !== false,
    showMeet: src.showMeet !== false,
    units: UNITS.has(src.units) ? src.units : DEFAULT_WATCH_SETTINGS.units,
    turnHaptics: src.turnHaptics !== false,
    raiseToNav: src.raiseToNav !== false,
  };
}

function storageOf(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadWatchSettings(storage) {
  const store = storageOf(storage);
  if (!store?.getItem) return { ...DEFAULT_WATCH_SETTINGS };
  try {
    return normalizeWatchSettings(JSON.parse(store.getItem(WATCH_SETTINGS_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_WATCH_SETTINGS };
  }
}

export function saveWatchSettings(next, storage) {
  const store = storageOf(storage);
  const normalized = normalizeWatchSettings(next);
  if (store?.setItem) store.setItem(WATCH_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

/** Stable key for coalescing two pins at the same Place. */
export function placeKeyOf(point) {
  if (!point || typeof point !== 'object') return null;
  if (typeof point.placeId === 'string' && point.placeId) return `id:${point.placeId}`;
  if (typeof point.id === 'string' && point.id && point.kind !== 'member') {
    return `id:${point.id}`;
  }
  if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    return `ll:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
  }
  return null;
}

/**
 * Map camera rotation in degrees. North-up always except during Go
 * (course-up unless the guest forces north-up).
 */
export function mapRotationDegrees({ walking, northUp, heading, course }) {
  if (!walking || northUp) return 0;
  const source = Number.isFinite(heading) ? heading : Number.isFinite(course) ? course : null;
  if (source == null) return 0;
  return Math.round(source / 3) * 3;
}

const PRI = { go: 0, meet: 1, selection: 2, plan: 3, member: 4, north: 5 };

function bearingBetween(me, point) {
  const aLat = (me.lat * Math.PI) / 180;
  const aLng = (me.lng * Math.PI) / 180;
  const bLat = (point.lat * Math.PI) / 180;
  const bLng = (point.lng * Math.PI) / 180;
  const y = Math.sin(bLng - aLng) * Math.cos(bLat);
  const x =
    Math.cos(aLat) * Math.sin(bLat) - Math.sin(aLat) * Math.cos(bLat) * Math.cos(bLng - aLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distanceM(me, point) {
  const R = 6371000;
  const dLat = ((point.lat - me.lat) * Math.PI) / 180;
  const dLng = ((point.lng - me.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((me.lat * Math.PI) / 180) *
      Math.cos((point.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Build Compass marks for phone strip or Watch dial.
 *
 * @returns {{ facing: number|null, marks: object[], emptyReason: string|null, primary: object|null }}
 */
export function buildCompassMarks({
  me = null,
  heading = null,
  members = [],
  meet = null,
  go = null,
  selection = null,
  planNext = null,
  includeNorth = true,
  showParty = true,
  showMeet = true,
} = {}) {
  if (heading == null || !Number.isFinite(heading)) {
    return { facing: null, marks: [], emptyReason: 'no-facing', primary: null };
  }

  const byKey = new Map();

  function upsert(mark) {
    const key = mark.placeKey;
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev || mark.priority < prev.priority) byKey.set(key, mark);
  }

  const haveMe = me && Number.isFinite(me.lat) && Number.isFinite(me.lng);

  function fromPoint(point, role, kind, extra = {}) {
    if (!haveMe || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    const placeKey = placeKeyOf(point) || placeKeyOf({ lat: point.lat, lng: point.lng });
    upsert({
      kind,
      role,
      placeKey,
      bearing: bearingBetween(me, point),
      distanceM: distanceM(me, point),
      label: typeof point.label === 'string' ? point.label : typeof point.n === 'string' ? point.n : role,
      priority: PRI[role] ?? PRI.member,
      showDistance: kind === 'primary',
      ...extra,
    });
  }

  // Primary Place: Go > selection > Plan-next (selection replaces Plan when both set).
  if (go) fromPoint(go, 'go', 'primary');
  else if (selection) fromPoint(selection, 'selection', 'primary');
  else if (planNext) fromPoint(planNext, 'plan', 'primary');

  if (showMeet && meet) fromPoint(meet, 'meet', 'meet', { glyph: '★' });

  if (showParty && Array.isArray(members)) {
    for (const m of members) {
      if (!m || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      // Bodies only — ignore Member targets.
      const placeKey =
        typeof m.id === 'string' && m.id
          ? `member:${m.id}`
          : placeKeyOf({ lat: m.lat, lng: m.lng });
      upsert({
        kind: 'member',
        role: 'member',
        placeKey,
        bearing: bearingBetween(me, m),
        distanceM: distanceM(me, m),
        label: typeof m.name === 'string' ? m.name : 'Member',
        initials: typeof m.initials === 'string' ? m.initials : (m.name || '?').slice(0, 1),
        colour: m.colour,
        help: m.status === 'NEED HELP',
        priority: PRI.member,
        showDistance: false,
      });
    }
  }

  if (includeNorth) {
    upsert({
      kind: 'north',
      role: 'north',
      placeKey: 'north',
      bearing: 0,
      distanceM: null,
      label: 'N',
      priority: PRI.north,
      showDistance: false,
    });
  }

  const marks = [...byKey.values()]
    .sort((a, b) => a.priority - b.priority || a.bearing - b.bearing)
    .map(({ priority: _p, ...rest }) => rest);

  const primary = marks.find((m) => m.kind === 'primary') || null;
  return { facing: heading, marks, emptyReason: null, primary };
}

/** Watch Always On: calm = primary range + next-turn only (no mark field). */
export function watchAlwaysOnPayload(settings, { primaryDistanceM = null, nextTurn = null } = {}) {
  const s = normalizeWatchSettings(settings);
  if (s.alwaysOn === 'off') return { mode: 'blank' };
  if (s.alwaysOn === 'calm') {
    return {
      mode: 'calm',
      primaryDistanceM,
      nextTurn: nextTurn && typeof nextTurn === 'object' ? nextTurn : null,
    };
  }
  return { mode: 'full' };
}
