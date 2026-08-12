/**
 * Side Quests — on-the-ground missions for gaps open sources cannot settle.
 *
 * Used by the Side Quests tab, plus the reporting queue in
 * lib/adventure/questQueue.js once a guest taps a card to submit one.
 */

import { distance } from './geo.js';

/** A quest with a target this close counts as "right here" while you walk. */
export const NEARBY_RADIUS_M = 150;

const TIER1 = [
  {
    id: 'ride_status',
    title: 'Ride up or down?',
    blurb: 'Tell nearby parties if a ride is boarding, delayed, or shut.',
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
 * Build durable side-quest cards from the loaded venue POIs.
 * @param {{ pois?: object[], venueName?: string }} opts
 */
export function buildSideQuests({ pois = [], venueName = 'this park' } = {}) {
  const rides = pois.filter((p) => p.c === 'coaster' || p.c === 'ride');
  const noHeight = rides.filter((p) => !p.h).map((p) => p.n).filter(Boolean);
  const noEntrance = rides.filter((p) => !p.e).map((p) => p.n).filter(Boolean);
  const hasRestroom = pois.some((p) => p.c === 'restroom');
  const hasFood = pois.some((p) => p.c === 'food');

  const durable = [];

  if (noHeight.length) {
    durable.push({
      id: 'height_rule',
      type: 'height_rule',
      title: 'Confirm height on the sign',
      blurb: `${noHeight.length} ride${noHeight.length === 1 ? '' : 's'} at ${venueName} still say “check at the ride”.`,
      targets: noHeight.slice(0, 8),
      icon: 'flag.fill',
    });
  }

  if (noEntrance.length) {
    durable.push({
      id: 'queue_entrance',
      type: 'geometry_nudge',
      title: 'Pin the queue entrance',
      blurb: 'Stand where the line starts and drop a pin — OSM rarely has this.',
      targets: noEntrance.slice(0, 8),
      icon: 'mappin.and.ellipse',
    });
  }

  if (!hasRestroom) {
    durable.push({
      id: 'poi_restroom',
      type: 'poi_presence',
      title: 'Find the toilets',
      blurb: 'This map has no restroom yet. Mark one you can see.',
      targets: [],
      icon: 'flag.fill',
    });
  }

  if (!hasFood) {
    durable.push({
      id: 'poi_food',
      type: 'poi_presence',
      title: 'Find somewhere to eat',
      blurb: 'No food places on this map yet. Mark a stand or restaurant.',
      targets: [],
      icon: 'flag.fill',
    });
  }

  return { durable, ambient: TIER1, counts: { durable: durable.length, ambient: TIER1.length } };
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
    const poi = pois.find((p) => p.n === name);
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
      const aNear = a.distanceM != null && a.distanceM <= radiusM;
      const bNear = b.distanceM != null && b.distanceM <= radiusM;
      if (aNear !== bNear) return aNear ? -1 : 1;
      if (a.distanceM == null && b.distanceM == null) return a.index - b.index;
      if (a.distanceM == null) return 1;
      if (b.distanceM == null) return -1;
      return a.distanceM - b.distanceM || a.index - b.index;
    })
    .map(({ quest, distanceM }) => ({
      ...quest,
      distanceM,
      nearby: distanceM != null && distanceM <= radiusM,
    }));
}
