/**
 * Maps registry adapter ids to concrete run() implementations.
 */

import { run as runParksApi } from './parks-api.mjs';
import { run as runQueueTimes } from './queue-times.mjs';
import { run as runRopedrop } from './ropedrop.mjs';
import { run as runWikidata } from './wikidata.mjs';
import { run as runAccessibilityCloud } from './accessibility-cloud.mjs';
import { run as runRcdb } from './rcdb.mjs';
import { run as runOpenMeteo } from './open-meteo.mjs';
import { run as runOhm } from './openhistoricalmap.mjs';
import { run as runProjectSidewalk } from './project-sidewalk.mjs';
import { run as runGuestTraces } from './guest-traces.mjs';
import { run as runMapillary } from './mapillary-api.mjs';
import { run as runOrs } from './openrouteservice.mjs';
import { run as runPlaywright } from './playwright-official.mjs';

/** @type {Record<string, (ctx: object) => Promise<import('./types.mjs').AdapterResult>>} */
export const ADAPTER_IMPLEMENTATIONS = {
  'parks-api': runParksApi,
  'queue-times': runQueueTimes,
  ropedrop: runRopedrop,
  wikidata: runWikidata,
  'accessibility-cloud': runAccessibilityCloud,
  rcdb: runRcdb,
  'open-meteo': runOpenMeteo,
  openhistoricalmap: runOhm,
  'project-sidewalk': runProjectSidewalk,
  'guest-traces': runGuestTraces,
  'mapillary-api': runMapillary,
  openrouteservice: runOrs,
  playwright: runPlaywright,
};

export const EXTERNAL_ADAPTER_IDS = Object.keys(ADAPTER_IMPLEMENTATIONS).filter(
  (id) => id !== 'playwright',
);

export function getAdapterImplementation(id) {
  return ADAPTER_IMPLEMENTATIONS[id] || null;
}
