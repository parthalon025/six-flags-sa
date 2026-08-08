/* The tag→layer and tag→category rules that turn raw OpenStreetMap into the
   two files a venue is made of.
 *
 * These rules are the whole reason the map can point at somewhere that is not
 * an amusement park. The renderer only knows about layer names; nothing below
 * it knows what a "coaster" is. So a state fair, a zoo, a campus or a festival
 * ground all come through the same pipeline — they simply leave the coaster and
 * slide layers empty, and the renderer draws nothing where there is nothing.
 *
 * Order matters in both tables: the first rule that matches wins, so the
 * specific sits above the general. `attraction=roller_coaster` has to be tested
 * before `building`, or every coaster station swallows its own track.
 */

const has = (tags, key, values) => {
  const v = tags[key];
  if (v == null) return false;
  if (!values) return true;
  return values.includes(v);
};

/** Ordered layer rules for closed areas and ways. */
export const LAYER_RULES = [
  // A coaster is mapped as its track. The station is tagged with the same ride
  // name and is a building — drawing it as track puts a stray loop through the
  // queue house, so it is sent down the building rule instead.
  [
    'coaster',
    (t) => (has(t, 'attraction', ['roller_coaster']) || has(t, 'roller_coaster')) && t.roller_coaster !== 'station',
  ],
  ['slide', (t) => has(t, 'attraction', ['water_slide']) || has(t, 'man_made', ['water_slide'])],
  ['pool', (t) => has(t, 'leisure', ['swimming_pool', 'water_park']) || has(t, 'sport', ['swimming'])],
  [
    'water',
    (t) =>
      has(t, 'natural', ['water', 'bay', 'wetland']) ||
      has(t, 'waterway', ['riverbank', 'dock', 'canal', 'stream', 'river']) ||
      has(t, 'landuse', ['reservoir', 'basin']) ||
      has(t, 'water'),
  ],
  ['wood', (t) => has(t, 'natural', ['wood', 'scrub', 'tree_row']) || has(t, 'landuse', ['forest'])],
  [
    'grass',
    (t) =>
      has(t, 'natural', ['grassland', 'heath', 'sand', 'beach']) ||
      has(t, 'landuse', ['grass', 'meadow', 'village_green', 'recreation_ground', 'greenfield', 'flowerbed']) ||
      // An unnamed leisure=park is ordinary green ground; a named one has
      // already been taken as a district by the land rules above.
      has(t, 'leisure', ['garden', 'pitch', 'golf_course', 'common', 'park']),
  ],
  ['parking', (t) => has(t, 'amenity', ['parking']) || has(t, 'parking')],
  ['building', (t) => has(t, 'building') || has(t, 'building:part')],
  [
    'path',
    (t) =>
      has(t, 'highway', ['footway', 'path', 'pedestrian', 'steps', 'corridor', 'living_street', 'cycleway', 'track']),
  ],
  [
    'service',
    (t) =>
      has(t, 'highway', [
        'service',
        'residential',
        'unclassified',
        'tertiary',
        'tertiary_link',
        'secondary',
        'secondary_link',
        'primary',
        'primary_link',
        'trunk',
        'trunk_link',
        'road',
      ]) || has(t, 'railway', ['rail', 'narrow_gauge', 'light_rail', 'tram', 'miniature', 'funicular']),
  ],
];

/** Layers drawn as open polylines rather than filled rings. */
export const LINE_LAYERS = new Set(['path', 'service', 'coaster', 'slide']);

/** Every layer the renderer knows how to draw, in the order it expects them. */
export const LAYERS = [
  // The body of water a venue stands in or beside, as opposed to a pond inside
  // it. Kept apart from `water` because of where it has to be drawn: a pond
  // goes over the ground, and a lake goes under it. See build-venue.mjs.
  'sea',
  'lands',
  'water',
  'wood',
  'grass',
  'parking',
  'building',
  'path',
  'service',
  'coaster',
  'slide',
  'pool',
  'park',
];

/**
 * A "land" is a named district inside the venue — Coney Mall at a park, a quad
 * on a campus, a neighbourhood in a town centre. They get their own tint and a
 * label at low zoom, which is what makes a drawn map legible before you have
 * zoomed in far enough to read anything else.
 */
export const LAND_RULES = [
  (t) => has(t, 'tourism', ['theme_park', 'zoo', 'attraction']) && has(t, 'name'),
  (t) => has(t, 'leisure', ['park', 'water_park', 'nature_reserve', 'stadium']) && has(t, 'name'),
  (t) => has(t, 'landuse', ['recreation_ground', 'retail', 'commercial', 'education', 'religious']) && has(t, 'name'),
  // `locality` belongs here as much as the rest: it is how a themed area inside
  // a park is routinely tagged, and leaving it out is the difference between a
  // park whose districts are Rockville and Spassburg and one whose only named
  // areas are the retail park over the road.
  (t) => has(t, 'place', ['neighbourhood', 'suburb', 'quarter', 'city_block', 'locality']) && has(t, 'name'),
  (t) => has(t, 'amenity', ['university', 'college', 'school', 'hospital', 'marketplace']) && has(t, 'name'),
];

/** Ordered POI category rules. The vocabulary matches lib/theme.js. */
export const POI_RULES = [
  ['coaster', (t) => has(t, 'attraction', ['roller_coaster']) || has(t, 'roller_coaster')],
  [
    'ride',
    (t) => has(t, 'attraction') || has(t, 'leisure', ['playground', 'water_park', 'amusement_arcade']),
  ],
  [
    'food',
    (t) =>
      has(t, 'amenity', ['restaurant', 'fast_food', 'cafe', 'ice_cream', 'bar', 'pub', 'biergarten', 'food_court']) ||
      has(t, 'shop', ['bakery', 'confectionery', 'deli', 'pastry', 'coffee', 'ice_cream']),
  ],
  ['restroom', (t) => has(t, 'amenity', ['toilets'])],
  [
    'service',
    (t) =>
      has(t, 'amenity', [
        'first_aid',
        'hospital',
        'clinic',
        'doctors',
        'pharmacy',
        'police',
        'ranger_station',
        'drinking_water',
        'charging_station',
        'atm',
        'bank',
        'locker',
        'baby_care',
        'shower',
        'bicycle_rental',
        'car_rental',
      ]) ||
      has(t, 'healthcare') ||
      has(t, 'emergency', ['defibrillator', 'phone', 'ambulance_station']) ||
      has(t, 'first_aid'),
  ],
  ['show', (t) => has(t, 'amenity', ['theatre', 'cinema', 'arts_centre']) || has(t, 'leisure', ['bandstand', 'amphitheatre'])],
  [
    // The way in, not every hinge in the fence. A park mapped thoroughly has
    // one of these on each ride queue and each service road — Cedar Point has
    // 158 — and an unnamed `barrier=gate` is furniture rather than somewhere
    // anyone arranges to meet. A gate earns a pin by being the entrance, or by
    // having a name people use: "the North Gate", "Soak City Entrance".
    'gate',
    (t) =>
      has(t, 'entrance', ['main', 'primary']) ||
      has(t, 'amenity', ['ticket_booth']) ||
      (has(t, 'name') &&
        (has(t, 'barrier', ['gate', 'entrance', 'turnstile']) || has(t, 'entrance'))),
  ],
  ['shop', (t) => has(t, 'shop') || has(t, 'amenity', ['marketplace', 'vending_machine'])],
  ['parking', (t) => has(t, 'amenity', ['parking'])],
  [
    'landmark',
    (t) =>
      has(t, 'tourism', ['viewpoint', 'artwork', 'museum', 'information', 'picnic_site']) ||
      has(t, 'historic') ||
      has(t, 'man_made', ['tower', 'water_tower', 'obelisk', 'lighthouse', 'monument']) ||
      has(t, 'natural', ['peak']) ||
      has(t, 'memorial'),
  ],
];

/**
 * Categories worth keeping from a closed way that carries no name at all.
 *
 * Deliberately two. An unnamed gate or service area is noise on a map read at a
 * glance, but an unnamed toilet block is the thing people are looking for, and
 * mappers almost never name one — which is what `UNNAMED_LABELS` below is for.
 */
export const UNNAMED_AREA_CATEGORIES = new Set(['restroom', 'parking']);

/** What an unnamed POI of each category is called, when it is worth keeping anyway. */
export const UNNAMED_LABELS = {
  restroom: 'Restrooms',
  parking: 'Parking',
  gate: 'Entrance',
  service: 'Services',
};

export function classify(rules, tags) {
  for (const [key, test] of rules) {
    try {
      if (test(tags)) return key;
    } catch {
      /* a malformed tag set is not worth crashing a 40 MB import over */
    }
  }
  return null;
}

export function isLand(tags) {
  return LAND_RULES.some((test) => {
    try {
      return test(tags);
    } catch {
      return false;
    }
  });
}
