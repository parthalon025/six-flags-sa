/**
 * Side Quests — on-the-ground missions for gaps open sources cannot settle.
 *
 * Used by the Side Quests tab, plus the reporting queue in
 * lib/adventure/questQueue.js once a guest taps a card to submit one.
 */

import { distance } from './geo.js';
import { findPlace, identityOf } from './venue/ids.js';

/** A quest with a target this close counts as "right here" while you walk. */
export const NEARBY_RADIUS_M = 150;

/** Live Side Quests (Ride reports) are name-first. Gap quests stay Profile-gated. */
export function isLiveQuest(quest) {
  const id = quest?.id || quest?.type;
  return id === 'ride_status' || id === 'queue_band';
}

/**
 * In-party Ride report from a live "Ride up or down?" tap.
 * Queue-band stays a quest note — it is wait, not open/down.
 * Same-Party taps stay in-party; park-wide needs parkWideReport().
 */
export function rideReportFromLiveQuest(quest, { status, pois = [], position = null } = {}) {
  const id = quest?.id || quest?.type;
  if (id !== 'ride_status') return null;
  const rideId = nearestRideId(pois, position, quest?.targets);
  if (!rideId) return null;
  return { rideId, status: status === 'issue' ? 'down' : 'open' };
}

function nearestRideId(pois, position, targets) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
  const rides = (pois || []).filter(
    (p) => p && (p.c === 'coaster' || p.c === 'ride') && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  let pool = rides;
  if (Array.isArray(targets) && targets.length) {
    const wanted = new Set(targets);
    const named = rides.filter(
      (p) => wanted.has(identityOf(p)) || wanted.has(p.n) || wanted.has(p.id) || wanted.has(p.i),
    );
    if (named.length) pool = named;
  }
  let best = null;
  for (const p of pool) {
    const d = distance(position.lat, position.lng, p.lat, p.lng);
    if (!best || d < best.d) best = { p, d };
  }
  return best ? identityOf(best.p) : null;
}

const TIER1 = [
  {
    id: 'ride_status',
    title: 'Ride up or down?',
    blurb: 'Walk near, see it, mark it — you do not have to stand in the queue.',
    icon: 'figure.rollercoaster',
  },
  {
    id: 'queue_band',
    title: 'How long is the line?',
    blurb: 'Short, medium, or long — helps others decide where to walk next.',
    icon: 'person.2.fill',
  },
  {
    id: 'amenity_outage',
    title: 'Restroom or fountain out?',
    blurb: 'Report a closed amenity so the glance rail stays honest.',
    icon: 'mappin.and.ellipse',
  },
];

/**
 * Build durable side-quest cards from Gaps the builder shipped.
 * The phone does not invent height / queue / amenity Gaps from POI fields.
 * Missing or empty `gaps` means no durable cards — live ambient quests remain.
 *
 * @param {{ pois?: object[], gaps?: object[], venueName?: string, venueId?: string, scoredKeys?: string[] }} opts
 */
export function buildSideQuests({
  pois = [],
  gaps = null,
  venueName = 'this park',
  venueId = '',
  scoredKeys = [],
} = {}) {
  const durable = groupShippedGaps({
    gaps: Array.isArray(gaps) ? gaps : [],
    venueName,
    venueId,
    scoredKeys,
  });
  return { durable, ambient: TIER1, counts: { durable: durable.length, ambient: TIER1.length } };
}

const GAP_CARD = {
  height: {
    title: 'Confirm height on the sign',
    blurb: (n, venueName) =>
      `${n} ride${n === 1 ? '' : 's'} at ${venueName} still say “check at the ride”.`,
    icon: 'flag.fill',
  },
  queue: {
    title: 'Pin the queue entrance',
    blurb: () => 'Stand where the line starts and drop a pin — OSM rarely has this.',
    icon: 'mappin.and.ellipse',
  },
  path: {
    title: 'Walk a missing path',
    blurb: (n, venueName) =>
      n > 1
        ? `Rides at ${venueName} sit off the walkable map, and cut-throughs OSM missed still need a walk.`
        : 'Walk a cut-through OSM missed so others can follow.',
    icon: 'location.north.fill',
  },
  restroom: {
    title: 'Find the restrooms',
    blurb: () => 'This map has no restroom yet. Mark one you can see.',
    icon: 'flag.fill',
  },
  food: {
    title: 'Find somewhere to eat',
    blurb: () => 'No food places on this map yet. Mark a stand or restaurant.',
    icon: 'flag.fill',
  },
  gate: {
    title: 'Find a way in',
    blurb: () => 'Mark a gate or entrance so others can find it.',
    icon: 'mappin.and.ellipse',
  },
  camping: {
    title: 'What the campground has laid on',
    blurb: () => 'Hookups and pad facts are not in OSM — confirm what is actually here.',
    icon: 'flag.fill',
    rankLast: true,
  },
};

const GAP_TYPE_ORDER = ['height', 'queue', 'path', 'restroom', 'food', 'gate', 'camping'];

function groupShippedGaps({ gaps, venueName, venueId, scoredKeys }) {
  const scored = new Set(Array.isArray(scoredKeys) ? scoredKeys : []);
  const byType = new Map();
  for (const gap of gaps) {
    const type = gap?.type;
    if (!GAP_CARD[type]) continue;
    const target = gap.target ?? null;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push({ type, target });
  }
  const durable = [];
  for (const type of GAP_TYPE_ORDER) {
    const items = byType.get(type);
    if (!items?.length) continue;
    const meta = GAP_CARD[type];
    const targets = items.map((g) => g.target).filter(Boolean);
    const countable = type === 'path' ? items.filter((g) => g.target) : items;
    const progressItems = countable.length ? countable : items;
    const done = progressItems.filter((g) => scored.has(`${venueId}:${type}:${g.target ?? ''}`)).length;
    durable.push({
      id: `gap:${type}`,
      type,
      title: meta.title,
      blurb: meta.blurb(items.length, venueName),
      targets,
      items,
      progress: { done, total: progressItems.length },
      icon: meta.icon,
      rankLast: Boolean(meta.rankLast),
    });
  }
  return durable;
}

/** Guest traces already treat walks this close as “on the mapped path”. */
export const ON_WALKWAY_METRES = 12;

function metresBetween(aLat, aLng, bLat, bLng) {
  const kx = 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((bLng - aLng) * kx, (bLat - aLat) * 110540);
}

function distPointToSegment(lat, lng, aLat, aLng, bLat, bLng) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const px = lng * kx;
  const py = lat * ky;
  const ax = aLng * kx;
  const ay = aLat * ky;
  const bx = bLng * kx;
  const by = bLat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function walkableRings(map) {
  const rings = [];
  for (const layer of [map?.path, map?.service]) {
    for (const way of layer || []) {
      if (Array.isArray(way?.r) && way.r.length) rings.push(way.r);
    }
  }
  return rings;
}

/** Metres from a GPS fix to the nearest walkable path/service segment. */
export function metresToWalkable(map, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rings = walkableRings(map);
  if (!rings.length) return Infinity;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || a.length < 2) continue;
      const d = b && b.length >= 2
        ? distPointToSegment(lat, lng, a[1], a[0], b[1], b[0])
        : metresBetween(lat, lng, a[1], a[0]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** True when GPS is already on a mapped walkway (no path Gap XP). */
export function isOnWalkway(map, position, gapM = ON_WALKWAY_METRES) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return false;
  const d = metresToWalkable(map, position.lat, position.lng);
  return Number.isFinite(d) && d <= gapM;
}

/** Closed chips for a height-sign Gap. `0` is “no minimum”, not “nobody looked”. */
export const HEIGHT_INCH_CHIPS = [36, 40, 42, 44, 48, 52, 54];

export const CAMPING_HOOKUPS = [
  { value: 'none', label: 'No hookups' },
  { value: 'water', label: 'Water' },
  { value: 'electric', label: 'Electric' },
  { value: 'full', label: 'Full hookup' },
];

/** Add-Place chips this ship (Field Research). Full ontology Create is later Cartographer. */
export const ADD_PLACE_TYPES = ['restroom', 'food', 'gate'];

export function isGapQuest(quest) {
  return Boolean(quest?.id?.startsWith('gap:') || GAP_CARD[quest?.type]);
}

/**
 * How close a quest's nearest named target is to `position`, in metres, or
 * null when there is no position or none of its targets resolve to a POI
 * with a fix — a quest with no targets (the "while you walk" ambient ones)
 * is always null, never zero.
 */
export function nearestTargetDistance(quest, pois = [], position = null) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
  if (!quest?.targets?.length) return null;
  let best = null;
  for (const name of quest.targets) {
    const poi = findPlace(pois, name);
    if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) continue;
    const d = distance(position.lat, position.lng, poi.lat, poi.lng);
    if (best == null || d < best) best = d;
  }
  return best;
}

/**
 * Quests within `radiusM` sorted to the front, nearest first — the rest keep
 * their place rather than being dropped. A guest standing at the entrance
 * queue sees "pin the queue entrance" before "find the toilets" clear across
 * the park, but the toilets quest is still right there below it.
 */
export function sortByProximity(quests = [], pois = [], position = null, radiusM = NEARBY_RADIUS_M) {
  if (!position) return quests;
  return quests
    .map((quest, index) => ({
      quest,
      index,
      distanceM: nearestTargetDistance(quest, pois, position),
    }))
    .sort((a, b) => {
      if (Boolean(a.quest.rankLast) !== Boolean(b.quest.rankLast)) {
        return a.quest.rankLast ? 1 : -1;
      }
      const aNear = (a.distanceM != null && a.distanceM <= radiusM) || Boolean(a.quest.nearby);
      const bNear = (b.distanceM != null && b.distanceM <= radiusM) || Boolean(b.quest.nearby);
      if (aNear !== bNear) return aNear ? -1 : 1;
      if (a.distanceM == null && b.distanceM == null) return a.index - b.index;
      if (a.distanceM == null) return 1;
      if (b.distanceM == null) return -1;
      return a.distanceM - b.distanceM || a.index - b.index;
    })
    .map(({ quest, distanceM }) => ({
      ...quest,
      distanceM,
      nearby: (distanceM != null && distanceM <= radiusM) || Boolean(quest.nearby),
    }));
}
