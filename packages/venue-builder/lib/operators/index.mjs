/**
 * Operator-family listing parsers — dispatch by official site URL.
 */

import { parseAttractionListing } from './generic.mjs';
import { parseSixFlagsListing } from './six-flags.mjs';
import { parseCedarFairListing } from './cedar-fair.mjs';
import { parseDisneyListing } from './disney.mjs';
import { parseUniversalListing } from './universal.mjs';
import { parseSeaWorldListing } from './seaworld.mjs';
import { parseLegolandListing } from './legoland.mjs';
import { parseHerschendListing } from './herschend.mjs';

export function operatorForUrl(url = '') {
  const u = String(url).toLowerCase();
  if (u.includes('sixflags.com')) return 'six-flags';
  if (
    u.includes('cedarpoint.com')
    || u.includes('visitkingsisland.com')
    || u.includes('carowinds.com')
    || u.includes('kingsdominion.com')
    || u.includes('worldsoffun.com')
    || u.includes('valleyfair.com')
    || u.includes('canadaswonderland.com')
    || u.includes('knotts.com')
  ) return 'cedar-fair';
  if (u.includes('disney.go.com') || u.includes('disneyland.com')) return 'disney';
  if (u.includes('universalorlando.com') || u.includes('universalstudioshollywood.com')) return 'universal';
  if (
    u.includes('seaworld.com')
    || u.includes('buschgardens.com')
    || u.includes('sesameplace.com')
    || u.includes('adventureisland.com')
  ) return 'seaworld';
  if (u.includes('legoland.com')) return 'legoland';
  if (
    u.includes('dollywood.com')
    || u.includes('silverdollarcity.com')
    || u.includes('idlewild.com')
    || u.includes('dutchwonderland.com')
  ) return 'herschend';
  return 'generic';
}

const PARSERS = {
  'six-flags': parseSixFlagsListing,
  'cedar-fair': parseCedarFairListing,
  disney: parseDisneyListing,
  universal: parseUniversalListing,
  seaworld: parseSeaWorldListing,
  legoland: parseLegolandListing,
  herschend: parseHerschendListing,
  generic: parseAttractionListing,
};

/** Parse a listing page using the operator adapter for its URL. */
export function parseListingForUrl(html, url) {
  const op = operatorForUrl(url);
  const parser = PARSERS[op] || parseAttractionListing;
  const rows = parser(html, url);
  return rows.map((r) => ({ ...r, operator: op }));
}
