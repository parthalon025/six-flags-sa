/**
 * Side Quests — on-the-ground missions for gaps open sources cannot settle.
 *
 * Used by the Side Quests tab. Submission / XP is backlog E9–E10; this only
 * lists what still needs a person in the park.
 */

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
