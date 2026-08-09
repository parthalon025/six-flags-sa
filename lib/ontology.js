/* What each POI category means, in one place.
 *
 * Until this existed, `p.c === 'coaster' || p.c === 'ride'` was copy-pasted
 * across ten files, and lib/weather.js carried its own partial sets that
 * disagreed at the edges. The manifest is the contract; everything else imports
 * from here.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/ontology.json'), 'utf8'),
);

export const ONTOLOGY = manifest;
export const CATEGORY_KEYS = Object.keys(manifest.categories);

/** Whether a POI implements a named interface from the manifest. */
export function implementsIface(poi, iface) {
  const cat = poi?.c;
  if (!cat) return false;
  const row = manifest.categories[cat];
  return Boolean(row?.interfaces?.includes(iface));
}

/** Every category key that implements an interface. */
export function categoriesWith(iface) {
  return CATEGORY_KEYS.filter((key) => manifest.categories[key].interfaces.includes(iface));
}

export const isRideable = (poi) => implementsIface(poi, 'Rideable');
export const isQueueable = (poi) => implementsIface(poi, 'Queueable');
export const isReportable = (poi) => implementsIface(poi, 'Reportable');
export const isMeetCandidate = (poi) => implementsIface(poi, 'MeetCandidate');
export const isSheltered = (poi) => implementsIface(poi, 'Sheltered');
export const isInert = (poi) => implementsIface(poi, 'Inert');

/** Predicate for Array.filter — rideable places. */
export const rideable = isRideable;
