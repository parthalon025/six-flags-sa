/**
 * What to say about a campsite, and how to say it.
 *
 * Two sources, one shape. A venue publishes what is true of its whole
 * campground — "every site is full hookup, 30/50 amp, concrete pad" — and that
 * lives on the venue, because that is the fact anybody actually stated. A pitch
 * carries only what is known about that pitch: what OpenStreetMap tagged on it,
 * or what an imported dataset said. The pitch wins for the fields it knows and
 * inherits the rest.
 *
 * Nothing here knows which campground it is describing. A site in Ohio and a
 * site in the Cairngorms come through the same function; the labels are about
 * hookups, not about anybody's park.
 */

/** A pitch's own details laid over its venue's. Either may be missing. */
export function campDetails(poi, venue) {
  if (!poi || poi.c !== 'campsite') return null;
  const base = venue?.camping || null;
  if (!base && !poi.camp) return null;
  return { ...(base || {}), ...(poi.camp || {}) };
}

const HOOKUP_WORD = {
  full: 'Full hookup',
  partial: 'Partial hookup',
  water: 'Water and electric',
  electric: 'Electric only',
  none: 'No hookups',
};

/**
 * The details as short phrases, in the order somebody towing a caravan asks
 * them: can I plug in, can I fill up, can I empty out, will I fit, what is
 * under the wheels.
 *
 * Deliberately says nothing where nothing is known. A blank is honest; "no
 * electric" when nobody recorded whether there is electric is not.
 */
export function campChips(details) {
  if (!details) return [];
  const out = [];
  const d = details;
  if (d.hookup && HOOKUP_WORD[d.hookup]) out.push(HOOKUP_WORD[d.hookup]);
  if (d.amps?.length) out.push(`${d.amps.join('/')} amp`);
  else if (d.power === true) out.push('Electric');
  else if (d.power === false) out.push('No electric');
  if (d.water === true) out.push('Water');
  if (d.sewer === true) out.push('Sewer');
  if (d.drive) out.push(d.drive === 'pull-through' ? 'Pull-through' : 'Back-in');
  if (d.length) out.push(`Up to ${d.length} ft`);
  if (d.surface) out.push(`${d.surface[0].toUpperCase()}${d.surface.slice(1)} pad`);
  if (d.cable === true) out.push('Cable');
  if (d.wifi === true) out.push('Wi-Fi');
  if (d.firepit === true) out.push('Fire pit');
  if (d.picnic === true) out.push('Picnic table');
  if (d.tents === true) out.push('Tents');
  else if (d.tents === false && d.caravans === true) out.push('No tents');
  if (d.capacity) out.push(`Sleeps ${d.capacity}`);
  return out;
}

/**
 * The same facts as words a search can match, so "50 amp", "pull through" and
 * "full hookup" find pitches even though not one of those strings is in a
 * pitch's name — every pitch here is called "Site 247".
 */
export function campSearchText(details) {
  const chips = campChips(details);
  if (!chips.length) return '';
  const extra = [];
  if (details.amps?.length) extra.push(...details.amps.map((a) => `${a}amp`));
  if (details.drive === 'pull-through') extra.push('pullthrough', 'pull thru', 'drive through');
  if (details.hookup === 'full') extra.push('fhu', 'hookups');
  return [...chips, ...extra].join(' ').toLowerCase();
}
