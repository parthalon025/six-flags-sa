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
/**
 * A civic boundary is never part of a venue.
 *
 * Kings Island sits inside the census area of Landen and the city of Mason, and
 * TIGER mapped both as `place=locality` with a name — which walked straight
 * through the district rule below, and, being far bigger than the park, was then
 * taken for the park's own outline. The map shipped drawing a census tract as
 * its ground. Whatever else these are, they are not a themed area inside
 * anywhere.
 */
const CIVIC = ['administrative', 'census', 'statistical', 'political', 'historic', 'postal_code'];
export const isCivicBoundary = (t) => has(t, 'boundary', CIVIC) || has(t, 'admin_level');

/**
 * What can be the venue's own outline: the shape that *is* the place, as
 * opposed to a district within it or the ground beside it.
 */
export const VENUE_RULES = [
  (t) => has(t, 'tourism', ['theme_park', 'zoo', 'attraction', 'camp_site', 'caravan_site']),
  (t) => has(t, 'leisure', ['park', 'water_park', 'nature_reserve', 'stadium', 'golf_course']),
  (t) => has(t, 'amenity', ['university', 'college', 'school', 'hospital']),
  (t) => has(t, 'landuse', ['recreation_ground', 'retail', 'commercial', 'education']),
];

export const isVenueOutline = (t) =>
  !isCivicBoundary(t) &&
  VENUE_RULES.some((test) => {
    try {
      return test(t);
    } catch {
      return false;
    }
  });

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
  // A campground inside a venue is a district of it in every sense that
  // matters here: it has a name people say out loud ("we're at Lighthouse
  // Point"), it covers ground, and its own places are named after it. Drawing
  // it as a tinted area with its name lying along it is how a camper finds the
  // way back at eleven at night.
  (t) => isCampground(t) && has(t, 'name'),
];

/**
 * A campground: the area, not the pitches inside it.
 *
 * `caravan_site` matters as much as `camp_site` and is the commoner tag for the
 * ones attached to parks — Cedar Point's Lighthouse Point carries it, which is
 * why the campground was being dropped from the bundle entirely: no land rule,
 * no layer rule and no POI rule matched it, so two hundred sites, the
 * registration desk and the shuttle stop simply were not in the app.
 */
export const isCampground = (t) => has(t, 'tourism', ['camp_site', 'caravan_site']);

/**
 * A single pitch inside a campground.
 *
 * `tourism=camp_pitch` is what the tag documentation asks for and what a
 * well-mapped site uses. What a park actually gets mapped as is a named
 * driveway per site — Lighthouse Point's 200 pitches are `service=parking_aisle`
 * ways called "Site 247", because that is what they physically are — so the
 * second half of this rule reads that shape too. It is only ever applied to
 * ways already known to lie inside a campground ring, which is what keeps it
 * from turning a supermarket car park into a hundred pitches.
 */
export const isCampPitch = (t) =>
  has(t, 'tourism', ['camp_pitch']) ||
  has(t, 'service', ['parking_aisle']) ||
  has(t, 'amenity', ['parking']);

/** Ordered POI category rules. The vocabulary matches lib/theme.js. */
export const POI_RULES = [
  ['coaster', (t) => has(t, 'attraction', ['roller_coaster']) || has(t, 'roller_coaster')],
  [
    'ride',
    (t) =>
      has(t, 'attraction') ||
      has(t, 'leisure', ['playground', 'water_park', 'amusement_arcade']) ||
      // A named pool at a venue like this is a ride: a wave pool, a lazy river,
      // the splashdown at the foot of a slide. Leaving it out meant Soak City's
      // seven pools were drawn on the map and missing from the list — and the
      // seven height rules somebody had compiled for them matched nothing, which
      // the build had been reporting as "no POI named Aruba Tuba" ever since.
      has(t, 'leisure', ['swimming_pool']),
  ],
  [
    'food',
    (t) =>
      has(t, 'amenity', ['restaurant', 'fast_food', 'cafe', 'ice_cream', 'bar', 'pub', 'biergarten', 'food_court']) ||
      has(t, 'shop', ['bakery', 'confectionery', 'deli', 'pastry', 'coffee', 'ice_cream']),
  ],
  ['restroom', (t) => has(t, 'amenity', ['toilets'])],
  [
    /* Camping, above the general rules because almost every part of a
       campground answers to something else first: a cabin is a building, the
       dump station is an amenity, a pitch is a driveway. Sitting here, the
       whole thing stays one category a visitor can switch on and off, and one
       thing a search for "camp" can find. */
    'campsite',
    (t) =>
      isCampground(t) ||
      has(t, 'tourism', ['camp_pitch', 'chalet', 'wilderness_hut']) ||
      has(t, 'amenity', ['sanitary_dump_station']) ||
      has(t, 'building', ['cabin', 'static_caravan', 'bungalow']) ||
      has(t, 'leisure', ['firepit']),
  ],
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
      /* A toll booth is the way in for everybody who drove, and it is one of
         the few unnamed barriers worth a pin: nobody puts five of them across a
         service road by accident. Fiesta Texas is mapped with five and no named
         entrance at all, so before this the park had no way in on the map. */
      has(t, 'barrier', ['toll_booth']) ||
      // A named shuttle stop is a way in and out of the venue in the only sense
      // that matters to somebody standing at one: it is where you catch the
      // thing that takes you to the gate. Cedar Point's campground has two of
      // them and a mile of peninsula between it and the turnstiles.
      (has(t, 'name') && (has(t, 'highway', ['bus_stop']) || has(t, 'public_transport', ['platform', 'stop_position']))) ||
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
  campsite: 'Campsite',
};

/**
 * What a campground or a pitch offers, read off the tags that describe it.
 *
 * Generic on purpose: these are the documented OpenStreetMap keys for camp and
 * caravan sites, so any venue anywhere that has been mapped properly answers
 * this without a line of venue-specific code. Cedar Point's pitches carry none
 * of them — the mapper drew 145 driveways and named them, which is already more
 * than most places have — so at that park the same fields arrive from the
 * overrides file instead. Both paths end at the same shape, which is the point:
 * the app never learns where a hookup fact came from.
 *
 * `null` when the tags say nothing, so a caller can tell "no electricity here"
 * from "nobody has recorded whether there is electricity here".
 */
export function campDetailsFromTags(tags) {
  const yes = (v) => v === 'yes' || v === 'true' || v === '1';
  const no = (v) => v === 'no' || v === 'false' || v === '0';
  const bool = (...keys) => {
    for (const k of keys) {
      const v = tags[k];
      if (v == null) continue;
      if (yes(v)) return true;
      if (no(v)) return false;
    }
    return null;
  };
  const out = {};
  const set = (k, v) => {
    if (v != null && v !== '') out[k] = v;
  };

  set('power', bool('power_supply', 'electricity'));
  /* Amperage is written every way a person might write it: "30", "30;50",
     "30 A", "50amp". Everything that is a plausible North American RV service
     and nothing else. */
  const amps = String(tags['power_supply:amperage'] || tags.amperage || '')
    .split(/[;,/]/)
    .map((x) => Number(String(x).replace(/[^0-9]/g, '')))
    .filter((n) => [15, 20, 30, 50].includes(n));
  if (amps.length) set('amps', [...new Set(amps)].sort((a, b) => a - b));

  set('water', bool('water_point', 'drinking_water', 'water_supply'));
  set('sewer', bool('sanitary_dump_station', 'sewer', 'waste_disposal'));
  set('wifi', bool('internet_access') ?? (tags.internet_access ? tags.internet_access !== 'no' : null));
  set('cable', bool('television', 'cable_tv'));
  set('firepit', bool('openfire', 'fireplace', 'firepit'));
  set('picnic', bool('picnic_table'));

  // What can stand on it. A pitch that takes a caravan and not a tent is a
  // different answer to "can we stay here" than one that takes both.
  set('caravans', bool('caravans', 'motorhome'));
  set('tents', bool('tents', 'tent'));

  // Back in or drive through — the question anybody towing asks first.
  if (yes(tags.drive_through) || yes(tags.pull_through)) set('drive', 'pull-through');
  else if (no(tags.drive_through) || yes(tags.backin)) set('drive', 'back-in');

  const length = Number(String(tags.maxlength || tags['maxlength:caravan'] || tags.length || '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(length) && length > 5 && length < 200) set('length', Math.round(length));
  set('surface', tags.surface || null);
  const capacity = Number(String(tags.capacity || '').replace(/[^0-9]/g, ''));
  if (Number.isFinite(capacity) && capacity > 0) set('capacity', capacity);
  // The number on the post, where it is not already the name.
  set('ref', tags.ref || null);

  return Object.keys(out).length ? out : null;
}

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
  if (isCivicBoundary(tags)) return false;
  return LAND_RULES.some((test) => {
    try {
      return test(tags);
    } catch {
      return false;
    }
  });
}
