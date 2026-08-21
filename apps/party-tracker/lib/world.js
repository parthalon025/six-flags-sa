/**
 * Collaborative world — Skins, Kits, Marks, Thanks.
 *
 * Deep module: catalog, earn ladders, Wear/Offer, and Mark evidence/fade
 * live here. Callers pass plain progress + party world snapshots; nothing
 * here touches the DOM, storage, or the mesh.
 */

import { rankPrizesForRank } from '@party-tracker/shared/rankPrizes.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const FADE_DIM_MS = 7 * DAY_MS;
export const FADE_GONE_MS = 28 * DAY_MS;

export const SIGN_PHRASES = [
  'Queue this way',
  'Rest here',
  'Height checked',
  'Nice view',
  'This way to restrooms',
];

export const MARK_TYPES = ['plaque', 'sign', 'lantern', 'sticker', 'cairn', 'beacon'];

/* Which of the six a guest may put down, and which are put down for them.
 *
 * `recordSideQuest` below mints plaque + lantern for a settled height, a cairn
 * for geometry or a path, and a sticker for anything answered at a Place — so
 * those four are *evidence that a fact was settled*, and their whole worth is
 * that nobody chose to leave them. `dropMark` is the only other way a Mark is
 * born, and sign and beacon are the only two that reach it honestly.
 *
 * The split is a rule about authorship, not a display filter, which is why it
 * lives beside MARK_TYPES rather than in the screen that draws the rows: a
 * hand-placed plaque is indistinguishable from an earned one to `visibleMarks`
 * and `thankMark`, so the only place to stop it is before it is made.
 *
 * MARK_TYPES itself stays all six — it is what the transport and the API
 * validate against, and an earned plaque travels the same `world-mark` path a
 * placed sign does.
 */
export const PLACEABLE_MARK_TYPES = ['sign', 'beacon'];
export const EARNED_MARK_TYPES = ['plaque', 'lantern', 'cairn', 'sticker'];

/** What each Mark is called in a sentence — `type[0].toUpperCase()` is a
 *  transform, not a name, and it has no answer the day a type is two words. */
export const MARK_LABELS = {
  plaque: 'Plaque',
  sign: 'Sign',
  lantern: 'Lantern',
  sticker: 'Sticker',
  cairn: 'Cairn',
  beacon: 'Beacon',
};

/** Icon.jsx names for Kit chrome — SF-style labels stay in KITS.glyph. */
export const KIT_ICONS = {
  'porter-cuff': 'location.fill',
  buddy: 'person.crop.circle.fill',
  'street-arrow': 'location.north.fill',
  'meet-flag': 'flag.fill',
  'cairn-trail': 'mappin.and.ellipse',
  'quest-sensor': 'safari',
};

export const MARK_ICONS = {
  plaque: 'figure.rollercoaster',
  sign: 'flag.fill',
  lantern: 'bolt.fill',
  sticker: 'camera.fill',
  cairn: 'mappin.and.ellipse',
  beacon: 'location.north.fill',
};

const PALETTES = new Set(['day', 'night']);

export const KITS = {
  'porter-cuff': { id: 'porter-cuff', label: 'Porter cuff', glyph: 'link' },
  buddy: { id: 'buddy', label: 'Buddy', glyph: 'pawprint.fill' },
  'street-arrow': { id: 'street-arrow', label: 'Street arrow', glyph: 'location.north.fill' },
  'meet-flag': { id: 'meet-flag', label: 'Meet flag', glyph: 'flag.fill' },
  'cairn-trail': { id: 'cairn-trail', label: 'Cairn trail', glyph: 'circle.grid.3x3.fill' },
  'quest-sensor': { id: 'quest-sensor', label: 'Quest sensor', glyph: 'sensor.fill' },
};

function paint(path, ground, water, grass, building, label) {
  return {
    path: { stroke: path, width: 2.4, casing: ground, casingWidth: 4.6 },
    building: { fill: building, stroke: path, width: 0.8 },
    water: { fill: water, stroke: water, width: 0.6 },
    grass: { fill: grass, stroke: 'none' },
    ground,
    groundEdge: path,
    wood: grass,
    lot: building,
    lotEdge: path,
    waterFill: water,
    waterEdge: water,
    poolFill: water,
    poolEdge: path,
    backOfHouse: building,
    midway: path,
    midwayCase: ground,
    structure: building,
    structureEdge: path,
    label: { fill: label, halo: ground, fontSize: 9.5 },
    land: { fill: label, fontSize: 15, tracking: 2.4 },
    mapBg: ground,
    contrastFloor: 4.5,
    labelFill: label,
    labelStroke: ground,
  };
}

const NIGHT_PAINT = paint('#C4A882', '#1A1520', '#1E4A5C', '#1E3020', '#2A2438', '#F0E8DC');
const DAY_PAINT = paint('#8B7355', '#F5F0E8', '#7EC8E3', '#B8D4A0', '#E8E0D4', '#2C2416');

export const SKINS = {
  postcard: {
    id: 'postcard',
    label: 'Postcard',
    unlock: { contributions: 1 },
    share: { venues: 3 },
    paint: paint('#C45C4A', '#F4E4C8', '#7EB8D4', '#C8D48A', '#E8C9A0', '#5A2A22'),
  },
  handbill: {
    id: 'handbill',
    label: 'Handbill',
    unlock: { venueGaps: 8 },
    share: { venueGaps: 20 },
    paint: paint('#6B4A2A', '#F3E6C8', '#8FBFCF', '#C5D9A4', '#E4D2B0', '#3A2814'),
  },
  'ticket-stub': {
    id: 'ticket-stub',
    label: 'Ticket stub',
    unlock: { planStops: 5, nearPlanQuests: 3 },
    share: { planComplete: true, quests: 10 },
    paint: paint('#B03030', '#F7EFE4', '#9CC9D8', '#D4E0B8', '#EDE0D0', '#4A1818'),
  },
  drafting: {
    id: 'drafting',
    label: 'Drafting',
    unlock: { pathGaps: 5 },
    share: { pathGaps: 25 },
    paint: paint('#D8E6F0', '#1B3A6B', '#3A6A9A', '#1B3A6B', '#24508A', '#F4F8FC'),
  },
  operator: {
    id: 'operator',
    label: 'Operator',
    unlock: { rideReports: 10 },
    share: { rideAgrees: 10 },
    paint: paint('#C4B896', '#2A2A28', '#3A4A48', '#2E3828', '#3A3A36', '#E8E0D0'),
  },
  'down-line': {
    id: 'down-line',
    label: 'Down-line',
    unlock: { rideAgrees: 3 },
    share: { rideAgrees: 10 },
    paint: paint('#E6C200', '#2A2A20', '#4A4A30', '#3A3A20', '#4A4420', '#F5E6A0'),
  },
  marquee: {
    id: 'marquee',
    label: 'Marquee',
    unlock: { nightQuests: 5 },
    share: { nightQuests: 20 },
    paint: paint('#FF6B9A', '#0A0614', '#1A2050', '#120818', '#2A1840', '#FFE8F0'),
    traits: { neon: true },
  },
  haunt: {
    id: 'haunt',
    label: 'Haunt',
    season: 'haunt',
    unlock: { hauntQuests: 5 },
    share: { hauntQuests: 12 },
    paint: paint('#E07020', '#140C10', '#1A3040', '#1A2010', '#2A1810', '#F0D8C0'),
  },
  frost: {
    id: 'frost',
    label: 'Frost',
    season: 'frost',
    unlock: { frostQuests: 5 },
    share: { frostQuests: 12 },
    paint: paint('#A0C8E0', '#E8F2F8', '#C8E4F4', '#F4FAFC', '#D8E8F0', '#1A3040'),
  },
  'rain-day': {
    id: 'rain-day',
    label: 'Rain day',
    unlock: { rainQuests: 3 },
    share: { rainReports: 8 },
    paint: paint('#5A7A90', '#C8D4DC', '#6A9AB0', '#A8B8A0', '#B8C4C8', '#243038'),
  },
  junior: {
    id: 'junior',
    label: 'Junior',
    unlock: { deviceLessHeight: true, heightQuests: 1 },
    share: { heightQuests: 5 },
    paint: paint('#FF6B6B', '#FFF5D6', '#7EC8FF', '#B8F0A0', '#FFE0A0', '#3A2060'),
    traits: { markerBoost: true },
  },
  'sticker-book': {
    id: 'sticker-book',
    label: 'Sticker book',
    unlock: { fogPct: 25 },
    share: { fogPct: 100 },
    paint: paint('#C45C8A', '#E8D4B8', '#7EC8E3', '#C8E0A0', '#F0DCC8', '#4A2030'),
  },
  'star-chart': {
    id: 'star-chart',
    label: 'Star chart',
    unlock: { nightQuests: 4 },
    share: { nightQuests: 12 },
    paint: paint('#C8B8FF', '#080818', '#102040', '#0C1810', '#181428', '#F0E8FF'),
  },
  'water-slick': {
    id: 'water-slick',
    label: 'Water slick',
    venueKind: 'water-park',
    unlock: { waterGaps: 3 },
    share: { waterPassport: true },
    paint: paint('#FF6B9A', '#7EC8E8', '#40B0E0', '#A0E0C0', '#FFE08A', '#143048'),
  },
  'camp-lantern': {
    id: 'camp-lantern',
    label: 'Camp lantern',
    venueKind: 'campground',
    unlock: { campGaps: 3 },
    share: { campPassport: true },
    paint: paint('#E09040', '#1A140C', '#1E3A40', '#1A3018', '#2A2010', '#F4E0C0'),
  },
  'chalk-lot': {
    id: 'chalk-lot',
    label: 'Chalk lot',
    unlock: { withKid: true, quests: 1 },
    share: { familyQuests: 10 },
    paint: paint('#5B8CFF', '#F4F0E8', '#80D0F0', '#B0E090', '#FFE9A0', '#203060'),
  },
  sunrise: {
    id: 'sunrise',
    label: 'Sunrise',
    unlock: { openingQuests: 3 },
    share: { ropeDropDays: 3 },
    paint: paint('#E87840', '#FFE8C8', '#88C8E0', '#D4E898', '#F4D0A0', '#4A2010'),
  },
  woodblock: {
    id: 'woodblock',
    label: 'Woodblock',
    unlock: { contributions: 12 },
    share: { impactHelped: 25 },
    paint: paint('#2A1810', '#E8D0A8', '#6A90A0', '#A8C070', '#D4B080', '#1A1008'),
  },
  'pixel-tycoon': {
    id: 'pixel-tycoon',
    label: 'Pixel tycoon',
    unlock: { fogPct: 25 },
    share: { fogPct: 100 },
    /* RCT Classic: lush grass, grey stone paths, tan stalls, terracotta roofs. */
    paint: {
      ...paint('#C8C8C0', '#4FA83A', '#3AA8D0', '#6BC04A', '#E8C878', '#2A2418'),
      wood: '#2E7A28',
      groundEdge: '#3A8A28',
      midway: '#C8C8C0',
      midwayCase: '#8A8A80',
      structure: '#E8C878',
      structureEdge: '#C45C38',
      lot: '#A8A090',
      lotEdge: '#787060',
      backOfHouse: '#C4B898',
    },
    traits: { pixel: true },
  },
  /* Reference-inspired map Skins — hexes ledgered in the builder's display
     skins.json (harvested from PR #447); map-visual.test.mjs asserts parity. */
  'layered-atlas': {
    id: 'layered-atlas',
    label: 'Layered atlas',
    unlock: { fogPct: 25 },
    share: { fogPct: 100 },
    paint: {
      ...paint('#3F6570', '#C9D6C0', '#5CA8B3', '#A7C58E', '#C9B58D', '#243B45'),
      midway: '#3F6570',
      midwayCase: '#C9D6C0',
      structure: '#C9B58D',
      structureEdge: '#7A6655',
      groundEdge: '#6E8975',
    },
    traits: { mapSkin: 'layered-atlas', mapStyle: 'analytical' },
  },
  'watercolor-quest': {
    id: 'watercolor-quest',
    label: 'Watercolor quest',
    unlock: { fogPct: 25 },
    share: { fogPct: 100 },
    paint: {
      ...paint('#756276', '#F4EFDF', '#8FB5C2', '#D9D0B5', '#B8A68D', '#57485C'),
      midway: '#756276',
      midwayCase: '#F4EFDF',
      structure: '#B8A68D',
      structureEdge: '#756276',
      groundEdge: '#C9BFAE',
    },
    traits: { mapSkin: 'watercolor-quest', mapStyle: 'watercolor' },
  },
  'block-park': {
    id: 'block-park',
    label: 'Block park',
    unlock: { walkedPlaces: 10, quests: 5 },
    share: { fogPct: 100 },
    paint: paint('#8B5A2A', '#5A8A3A', '#3A6A9A', '#3A7A28', '#7A7A7A', '#F0E8D0'),
  },
  redline: {
    id: 'redline',
    label: 'Redline',
    unlock: { reviews: 10 },
    share: { reviews: 25 },
    paint: paint('#E04040', '#F4F0E8', '#A0C0D0', '#D0D8C8', '#E8E0D4', '#401010'),
  },
};

export const SKIN_IDS = Object.keys(SKINS);

export function isSkin(id) {
  return Boolean(SKINS[id]);
}

export function isAllowedSign(phrase) {
  return SIGN_PHRASES.includes(phrase);
}

export function emptyWorld() {
  return { offers: [], marks: [], thanks: [] };
}

/** Party mesh + park store share one snapshot for Wear / visible Marks. */
export function mergeWorlds(...worlds) {
  const offers = [];
  const offerKey = new Set();
  const marks = new Map();
  const thanks = [];
  const thankKey = new Set();
  for (const w of worlds) {
    if (!w) continue;
    for (const o of w.offers || []) {
      const k = `${o.fromMemberId}|${o.skinId}`;
      if (offerKey.has(k)) continue;
      offerKey.add(k);
      offers.push(o);
    }
    for (const m of w.marks || []) {
      if (!m?.id) continue;
      const prev = marks.get(m.id);
      const evidenceParties = [...new Set([...(prev?.evidenceParties || []), ...(m.evidenceParties || [])])];
      const newer = !prev || (m.lastUseAt || m.createdAt || 0) >= (prev.lastUseAt || prev.createdAt || 0);
      marks.set(m.id, { ...(newer ? { ...prev, ...m } : { ...m, ...prev }), evidenceParties });
    }
    for (const t of w.thanks || []) {
      const k = `${t.profileId}|${t.targetId}|${t.day}`;
      if (thankKey.has(k)) continue;
      thankKey.add(k);
      thanks.push(t);
    }
  }
  return { offers, marks: [...marks.values()], thanks };
}

export function createProgress({ userId = null } = {}) {
  return {
    userId: userId || null,
    wearSkin: null,
    kit: null,
    fogMapEnabled: false,
    rankPrizesGranted: [],
    meters: {
      contributions: 0,
      venues: [],
      gapByVenue: {},
      pathGaps: 0,
      heightQuests: 0,
      rideReports: 0,
      rideAgrees: 0,
      observations: 0,
      nightQuests: 0,
      hauntQuests: 0,
      frostQuests: 0,
      rainQuests: 0,
      rainReports: 0,
      openingQuests: 0,
      quests: 0,
      planStops: 0,
      nearPlanQuests: 0,
      planComplete: false,
      thanksReceived: 0,
      impactHelped: 0,
      fogByVenue: {},
      walkedByVenue: {},
      venuePlaceCount: {},
      waterGaps: 0,
      waterPassport: false,
      campGaps: 0,
      campPassport: false,
      deviceLessHeight: false,
      withKid: false,
      familyQuests: 0,
      reviews: 0,
      ropeDropDays: [],
    },
  };
}

export function eventSeason(now) {
  const month = new Date(now).getUTCMonth();
  if (month === 9 || month === 10) return 'haunt';
  if (month === 11 || month === 0) return 'frost';
  return null;
}

function addUnique(list, value) {
  if (!value) return list;
  return list.includes(value) ? list : [...list, value];
}

function bumpVenueMap(map, venueId, placeId) {
  const cur = { ...(map || {}) };
  const set = new Set(cur[venueId] || []);
  if (placeId) set.add(placeId);
  cur[venueId] = [...set];
  return cur;
}

export function recordSideQuest(progress, event = {}) {
  const now = event.now || Date.now();
  const meters = { ...progress.meters };
  meters.quests += 1;
  meters.contributions += 1;
  meters.venues = addUnique(meters.venues, event.venueId);
  if (event.venueId) {
    meters.gapByVenue = {
      ...meters.gapByVenue,
      [event.venueId]: (meters.gapByVenue[event.venueId] || 0) + 1,
    };
  }
  if (event.venuePlaceCount && event.venueId) {
    meters.venuePlaceCount = { ...meters.venuePlaceCount, [event.venueId]: event.venuePlaceCount };
  }
  if (event.kind === 'geometry' || event.kind === 'path') meters.pathGaps += 1;
  if (event.kind === 'height' || event.questId === 'height_rule') meters.heightQuests += 1;
  if (event.kind === 'status' || event.questId === 'ride_status') {
    meters.rideReports += 1;
    if (event.agreed) meters.rideAgrees += 1;
    if (event.observation) meters.observations += 1;
    if (event.weatherHold) meters.rainReports += 1;
  }
  const hour = Number.isFinite(event.hour) ? event.hour : new Date(now).getUTCHours();
  const month = Number.isFinite(event.month) ? event.month : new Date(now).getUTCMonth();
  if (hour >= 20 || hour < 6) meters.nightQuests += 1;
  if (hour >= 6 && hour < 10) {
    meters.openingQuests += 1;
    const day = new Date(now).toISOString().slice(0, 10);
    meters.ropeDropDays = addUnique(meters.ropeDropDays, day);
  }
  if (month === 9 || month === 10) meters.hauntQuests += 1;
  if (month === 11 || month === 0) meters.frostQuests += 1;
  if (event.weatherHold) meters.rainQuests += 1;
  if (event.nearPlan) meters.nearPlanQuests += 1;
  if (event.planStop) meters.planStops += 1;
  if (event.planComplete) meters.planComplete = true;
  if (event.deviceLessHeight) meters.deviceLessHeight = true;
  if (event.withKid) {
    meters.withKid = true;
    meters.familyQuests += 1;
  }
  if (event.reviews) meters.reviews += event.reviews;
  if (event.kind === 'geometry' && event.venueKind === 'water-park') meters.waterGaps += 1;
  if (event.kind === 'geometry' && event.venueKind === 'campground') meters.campGaps += 1;
  if (event.waterPassport) meters.waterPassport = true;
  if (event.campPassport) meters.campPassport = true;
  if (event.placeId && event.venueId) {
    meters.walkedByVenue = bumpVenueMap(meters.walkedByVenue, event.venueId, event.placeId);
    if (event.fogPlaces) {
      const places = Array.from({ length: event.fogPlaces }, (_, i) => `fog-${i}`);
      meters.fogByVenue = { ...meters.fogByVenue, [event.venueId]: places };
    } else {
      meters.fogByVenue = bumpVenueMap(meters.fogByVenue, event.venueId, event.placeId);
    }
  } else if (event.fogPlaces && event.venueId) {
    const places = Array.from({ length: event.fogPlaces }, (_, i) => `fog-${i}`);
    meters.fogByVenue = { ...meters.fogByVenue, [event.venueId]: places };
  }

  const next = { ...progress, meters };
  const marks = [];
  const authorPartyId = event.partyId || null;
  const base = {
    placeId: event.placeId || null,
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    authorId: progress.userId,
    authorPartyId,
    venueId: event.venueId || null,
    now,
  };
  if (event.kind === 'height' || event.questId === 'height_rule') {
    marks.push(makeMark({ ...base, type: 'plaque' }));
    marks.push(makeMark({ ...base, type: 'lantern' }));
  } else if (event.kind === 'geometry' || event.kind === 'path') {
    marks.push(makeMark({ ...base, type: 'cairn' }));
  } else if (event.placeId) {
    marks.push(makeMark({ ...base, type: 'sticker' }));
  }
  return { progress: next, marks };
}

function fogPct(meters, venueId) {
  const places = meters.fogByVenue[venueId] || [];
  const total = meters.venuePlaceCount[venueId] || 0;
  if (!total) return 0;
  return Math.round((places.length / total) * 100);
}

function walkedCount(meters) {
  return Object.values(meters.walkedByVenue || {}).reduce((n, list) => n + (list?.length || 0), 0);
}

function maxVenueGaps(meters) {
  return Math.max(0, ...Object.values(meters.gapByVenue || {}), 0);
}

function met(rule, meters, venueId) {
  if (!rule) return true;
  if (rule.contributions && meters.contributions < rule.contributions) return false;
  if (rule.venues && meters.venues.length < rule.venues) return false;
  if (rule.venueGaps && maxVenueGaps(meters) < rule.venueGaps) return false;
  if (rule.pathGaps && meters.pathGaps < rule.pathGaps) return false;
  if (rule.heightQuests && meters.heightQuests < rule.heightQuests) return false;
  if (rule.rideReports && meters.rideReports < rule.rideReports) return false;
  if (rule.rideAgrees && meters.rideAgrees < rule.rideAgrees) return false;
  if (rule.nightQuests && meters.nightQuests < rule.nightQuests) return false;
  if (rule.hauntQuests && meters.hauntQuests < rule.hauntQuests) return false;
  if (rule.frostQuests && meters.frostQuests < rule.frostQuests) return false;
  if (rule.rainQuests && meters.rainQuests < rule.rainQuests) return false;
  if (rule.rainReports && meters.rainReports < rule.rainReports) return false;
  if (rule.openingQuests && meters.openingQuests < rule.openingQuests) return false;
  if (rule.quests && meters.quests < rule.quests) return false;
  if (rule.planStops && meters.planStops < rule.planStops) return false;
  if (rule.nearPlanQuests && meters.nearPlanQuests < rule.nearPlanQuests) return false;
  if (rule.planComplete && !meters.planComplete) return false;
  if (rule.impactHelped && meters.impactHelped < rule.impactHelped) return false;
  if (rule.fogPct && fogPct(meters, venueId) < rule.fogPct && maxFog(meters) < rule.fogPct) return false;
  if (rule.walkedPlaces && walkedCount(meters) < rule.walkedPlaces) return false;
  if (rule.waterGaps && meters.waterGaps < rule.waterGaps) return false;
  if (rule.waterPassport && !meters.waterPassport) return false;
  if (rule.campGaps && meters.campGaps < rule.campGaps) return false;
  if (rule.campPassport && !meters.campPassport) return false;
  if (rule.deviceLessHeight && !meters.deviceLessHeight) return false;
  if (rule.withKid && !meters.withKid) return false;
  if (rule.familyQuests && meters.familyQuests < rule.familyQuests) return false;
  if (rule.reviews && meters.reviews < rule.reviews) return false;
  if (rule.ropeDropDays && meters.ropeDropDays.length < rule.ropeDropDays) return false;
  return true;
}

function maxFog(meters) {
  let best = 0;
  for (const venueId of Object.keys(meters.fogByVenue || {})) {
    best = Math.max(best, fogPct(meters, venueId));
  }
  return best;
}

export function skinRung(progress, skinId, venueId = null) {
  const skin = SKINS[skinId];
  if (!skin) return null;
  const meters = progress.meters;
  if (!met(skin.unlock, meters, venueId)) return null;
  if (met(skin.share, meters, venueId)) return 'share';
  return 'unlock';
}

export function canOffer(progress, skinId, venueId = null) {
  return Boolean(progress?.userId) && skinRung(progress, skinId, venueId) === 'share';
}

export function skinAllowedAt({ skinId, venue = null, now = Date.now() }) {
  const skin = SKINS[skinId];
  if (!skin) return PALETTES.has(skinId);
  if (skin.season && eventSeason(now) !== skin.season) return false;
  if (skin.venueKind && venue?.kind !== skin.venueKind) return false;
  return true;
}

function defaultOwnSkin(progress, now, venue) {
  if (progress.wearSkin && skinRung(progress, progress.wearSkin) && skinAllowedAt({ skinId: progress.wearSkin, venue, now })) {
    return progress.wearSkin;
  }
  if (skinRung(progress, 'postcard') && skinAllowedAt({ skinId: 'postcard', venue, now })) return 'postcard';
  for (const id of SKIN_IDS) {
    if (skinRung(progress, id) && skinAllowedAt({ skinId: id, venue, now })) return id;
  }
  return 'night';
}

export function wearMap({
  progress,
  partyMembers = {},
  selfId = null,
  acceptedOffer = null,
  world = null,
  now = Date.now(),
  venue = null,
  palette = 'night',
} = {}) {
  if (acceptedOffer?.fromMemberId && acceptedOffer.skinId) {
    const owner = partyMembers[acceptedOffer.fromMemberId];
    const live = (world?.offers || []).some(
      (o) => o.fromMemberId === acceptedOffer.fromMemberId && o.skinId === acceptedOffer.skinId,
    );
    if (owner && live && skinAllowedAt({ skinId: acceptedOffer.skinId, venue, now })) {
      return acceptedOffer.skinId;
    }
  }
  const own = defaultOwnSkin(progress || createProgress(), now, venue);
  if (own === 'night' && (palette === 'day' || palette === 'night')) return palette;
  return own;
}

export function offerSkin({
  world,
  fromMemberId,
  fromProfileId,
  skinId,
  progress,
  now = Date.now(),
  force = false,
}) {
  if (!force && !canOffer(progress, skinId)) return world || emptyWorld();
  if (!fromProfileId || !isSkin(skinId)) return world || emptyWorld();
  const next = {
    offers: [...(world?.offers || [])],
    marks: [...(world?.marks || [])],
    thanks: [...(world?.thanks || [])],
  };
  if (next.offers.some((o) => o.fromMemberId === fromMemberId && o.skinId === skinId)) return next;
  next.offers.push({
    fromMemberId,
    fromProfileId,
    skinId,
    ts: now,
  });
  return next;
}

export function withdrawOffer(world, { fromMemberId, skinId }) {
  const next = {
    offers: (world?.offers || []).filter((o) => !(o.fromMemberId === fromMemberId && (!skinId || o.skinId === skinId))),
    marks: [...(world?.marks || [])],
    thanks: [...(world?.thanks || [])],
  };
  return next;
}

function makeMark({ type, placeId, lat, lng, authorId, authorPartyId, venueId, now, phrase = null, id = null }) {
  const resolvedId = id || `mk_${Math.abs(hash(`${authorId}|${placeId}|${type}|${now}`)).toString(16)}`;
  return {
    id: resolvedId,
    type,
    placeId: placeId || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    authorId: authorId || null,
    authorPartyId: authorPartyId || null,
    venueId: venueId || null,
    phrase: type === 'sign' && isAllowedSign(phrase) ? phrase : type === 'sign' ? SIGN_PHRASES[0] : null,
    createdAt: now,
    lastUseAt: now,
    evidenceParties: authorPartyId ? [authorPartyId] : [],
  };
}

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export function dropMark(world, fields) {
  const mark = makeMark(fields);
  if (fields.type === 'sign' && fields.phrase && !isAllowedSign(fields.phrase)) {
    return world || emptyWorld();
  }
  return {
    offers: [...(world?.offers || [])],
    marks: [...(world?.marks || []), mark].slice(-200),
    thanks: [...(world?.thanks || [])],
  };
}

export function thankMark(world, { profileId, partyId, targetId, now = Date.now() }) {
  if (!profileId || !targetId) return world || emptyWorld();
  const day = new Date(now).toISOString().slice(0, 10);
  const already = (world?.thanks || []).some(
    (t) => t.profileId === profileId && t.targetId === targetId && t.day === day,
  );
  if (already) return world;
  const thanks = [...(world?.thanks || []), { profileId, partyId, targetId, day, ts: now }];
  const marks = (world?.marks || []).map((m) => {
    if (m.id !== targetId) return m;
    const evidenceParties = addUnique(m.evidenceParties || [], partyId);
    return { ...m, lastUseAt: now, evidenceParties };
  });
  return {
    offers: [...(world?.offers || [])],
    marks,
    thanks,
  };
}

function markOpacity(mark, now) {
  const age = now - (mark.lastUseAt || mark.createdAt || 0);
  if (age >= FADE_DIM_MS) return 0.4;
  return 1;
}

export function visibleMarks({ world, viewerPartyId, now = Date.now() }) {
  const out = [];
  for (const mark of world?.marks || []) {
    const age = now - (mark.lastUseAt || mark.createdAt || 0);
    const inParty = mark.authorPartyId && mark.authorPartyId === viewerPartyId;
    const evidenced = (mark.evidenceParties || []).length >= 2;
    if (!inParty && !evidenced) continue;
    if (!inParty && age >= FADE_GONE_MS) continue;
    out.push({ ...mark, opacity: markOpacity(mark, now) });
  }
  return out;
}

/**
 * One author's Marks of one type — the earned tally the Marks screen prints.
 *
 * Sits beside `visibleMarks` rather than in the screen that counts them for
 * the reason the placeable/earned split does: `world.marks` is one flat list
 * that the mesh, the venue API and `recordSideQuest` all append to, and every
 * question asked of it — who left it, what kind it is, is it still visible —
 * is answered here or nowhere.
 *
 * Unfiltered by fade and evidence, unlike `visibleMarks`: those two rules
 * decide what a stranger is shown on the map, and a tally of what you have
 * earned must not shrink because nobody has Thanked it yet.
 *
 * Returns the Marks, like `visibleMarks` does. The screen that only wants the
 * number takes its length; a screen that wants to list them does not have to
 * re-derive the filter to get it.
 *
 * @param {object|null} world  merged park + party world
 * @param {string} type        one of MARK_TYPES
 * @param {string|null} authorId  the Profile whose Marks to count
 */
export function marksByType(world, type, authorId) {
  if (!type || !authorId) return [];
  return (world?.marks || []).filter((m) => m.type === type && m.authorId === authorId);
}

export function kitForViewer({ kit, viewerInParty }) {
  if (!viewerInParty) return null;
  return KITS[kit] ? kit : null;
}

export function mapPaint(id) {
  if (id === 'day') return { id: 'day', label: 'Trail (light)', traits: {}, ...DAY_PAINT };
  if (id === 'night') return { id: 'night', label: 'Park Midnight (dark)', traits: {}, ...NIGHT_PAINT };
  const skin = SKINS[id];
  if (!skin) return { id: 'night', label: 'Park Midnight (dark)', traits: {}, ...NIGHT_PAINT };
  return { id: skin.id, label: skin.label, traits: skin.traits || {}, ...skin.paint };
}

/** Demo / store capture — unlock ship-polish Skins without farming. */
export function grantShipSkins(progress, { venueId = null, now = Date.now() } = {}) {
  const meters = { ...progress.meters };
  meters.contributions = Math.max(meters.contributions || 0, 3);
  meters.venues = [...new Set([...(meters.venues || []), 'demo-a', 'demo-b', 'demo-c'])];
  meters.nightQuests = Math.max(meters.nightQuests || 0, 20);
  meters.deviceLessHeight = true;
  meters.heightQuests = Math.max(meters.heightQuests || 0, 5);
  if (venueId) {
    const fog = meters.fogByVenue?.[venueId] || [];
    meters.fogByVenue = {
      ...(meters.fogByVenue || {}),
      [venueId]: fog.length >= 4 ? fog : ['fog-0', 'fog-1', 'fog-2', 'fog-3'],
    };
    meters.venuePlaceCount = {
      ...(meters.venuePlaceCount || {}),
      [venueId]: Math.max(meters.venuePlaceCount?.[venueId] || 0, 16),
    };
  }
  return {
    ...progress,
    wearSkin: progress.wearSkin || 'postcard',
    meters,
  };
}

/** Bump meters so a Skin's unlock rule is satisfied (Rank ex-prize grants). */
function meterFloorForSkinUnlock(meters, rule = {}) {
  const m = { ...meters };
  if (rule.contributions) m.contributions = Math.max(m.contributions || 0, rule.contributions);
  if (rule.venues) {
    const need = rule.venues;
    const venues = [...(m.venues || [])];
    while (venues.length < need) venues.push(`rank-venue-${venues.length}`);
    m.venues = venues;
  }
  if (rule.venueGaps) {
    m.gapByVenue = { ...(m.gapByVenue || {}) };
    const key = 'rank-grant';
    m.gapByVenue[key] = Math.max(m.gapByVenue[key] || 0, rule.venueGaps);
  }
  if (rule.pathGaps) m.pathGaps = Math.max(m.pathGaps || 0, rule.pathGaps);
  if (rule.heightQuests) m.heightQuests = Math.max(m.heightQuests || 0, rule.heightQuests);
  if (rule.nightQuests) m.nightQuests = Math.max(m.nightQuests || 0, rule.nightQuests);
  if (rule.fogPct) {
    m.fogByVenue = { ...(m.fogByVenue || {}) };
    const key = 'rank-grant';
    const places = m.fogByVenue[key] || [];
    const need = Math.max(4, Math.ceil((rule.fogPct / 100) * 16));
    if (places.length < need) {
      m.fogByVenue[key] = Array.from({ length: need }, (_, i) => `fog-${i}`);
    }
    m.venuePlaceCount = { ...(m.venuePlaceCount || {}), [key]: Math.max(m.venuePlaceCount?.[key] || 0, 16) };
  }
  return m;
}

/**
 * Grant Rank prizes (Skins / Kits) once per Profile rank.
 * @param {object} progress world progress snapshot
 * @param {string} rank scout | ranger | cartographer | steward
 */
export function grantRankPrizes(progress, rank) {
  if (!rank || rank === 'visitor') return progress;
  const granted = new Set(progress.rankPrizesGranted || []);
  if (granted.has(rank)) return progress;
  const prizes = rankPrizesForRank(rank);
  if (!prizes.length) {
    return { ...progress, rankPrizesGranted: [...granted, rank] };
  }
  let next = {
    ...progress,
    rankPrizesGranted: [...granted, rank],
    meters: { ...(progress.meters || {}) },
  };
  for (const prize of prizes) {
    if (prize.kind === 'kit' && prize.id && !next.kit) {
      next = { ...next, kit: prize.id };
    }
    if (prize.kind === 'skin' && prize.id) {
      const skin = SKINS[prize.id];
      if (skin?.unlock) {
        next = { ...next, meters: meterFloorForSkinUnlock(next.meters, skin.unlock) };
      }
      if (!next.wearSkin) next = { ...next, wearSkin: prize.id };
    }
  }
  return next;
}

const RANK_PRIZE_ORDER = ['scout', 'ranger', 'cartographer', 'steward'];

/** Grant every Rank prize through `rank` (backfill on sign-in). */
export function syncRankPrizes(progress, rank) {
  const i = RANK_PRIZE_ORDER.indexOf(rank);
  if (i < 0) return progress;
  let next = progress;
  for (let j = 0; j <= i; j += 1) {
    next = grantRankPrizes(next, RANK_PRIZE_ORDER[j]);
  }
  return next;
}

export function mapThemeCssVars(pack) {
  const p = pack.path ? pack : mapPaint(pack);
  return {
    '--map-path-stroke': p.path.stroke,
    '--map-path-width': `${p.path.width}px`,
    '--map-path-casing': p.path.casing,
    '--map-building-fill': p.building.fill,
    '--map-water-fill': p.water.fill,
    '--map-label-fill': p.label.fill,
    '--map-label-halo': p.label.halo,
    '--ground': p.ground,
    '--groundEdge': p.groundEdge,
    '--wood': p.wood,
    '--grass': p.grass.fill || p.wood,
    '--lot': p.lot,
    '--lotEdge': p.lotEdge,
    '--waterFill': p.waterFill,
    '--waterEdge': p.waterEdge,
    '--poolFill': p.poolFill,
    '--poolEdge': p.poolEdge,
    '--backOfHouse': p.backOfHouse,
    '--midway': p.midway,
    '--midwayCase': p.midwayCase,
    '--structure': p.structure,
    '--structureEdge': p.structureEdge,
    '--mapBg': p.mapBg,
    '--labelFill': p.labelFill,
    '--labelStroke': p.labelStroke,
  };
}

export function applyMapSkin(el, skinId) {
  if (!el?.style) return;
  const pack = mapPaint(skinId);
  const vars = mapThemeCssVars(pack);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  if (el.dataset) {
    el.dataset.skin = skinId;
    el.dataset.skinPixel = pack.traits?.pixel ? '1' : '';
    el.dataset.skinNeon = pack.traits?.neon ? '1' : '';
    el.dataset.skinJunior = pack.traits?.markerBoost ? '1' : '';
    el.dataset.skinMap = pack.traits?.mapSkin || '';
    el.dataset.skinMapStyle = pack.traits?.mapStyle || '';
  }
}

export function applyThanksToProgress(progress, world, authorId) {
  const n = (world?.thanks || []).filter((t) => {
    const mark = (world.marks || []).find((m) => m.id === t.targetId);
    return mark?.authorId === authorId;
  }).length;
  return {
    ...progress,
    meters: {
      ...progress.meters,
      thanksReceived: n,
      impactHelped: Math.max(progress.meters.impactHelped, n),
    },
  };
}
