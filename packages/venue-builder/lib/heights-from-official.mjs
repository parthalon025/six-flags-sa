/**
 * Write height rules from a park's official website into the heights sidecar.
 *
 * Matches official attraction listings to rideable POIs in the built bundle,
 * then writes data/venues/<id>.heights.json for the builder to re-apply.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { OVERRIDE_DIR, readJson, writeJson, venueSidecar } from './venue-io.mjs';
import { pairSuggestions } from './venue-judge.mjs';
import { loadOfficialData } from './venue-official-site.mjs';
import { officialSiteForPark } from './park-official-urls.mjs';
import { scaffoldSourcesCatalogue } from './park-capabilities.mjs';
import { ensureExternalDatasets } from './venue-sources.mjs';

export const heightsFile = (id) => venueSidecar(id, 'heights.json');
export const sourcesFile = (id) => venueSidecar(id, 'sources.json');

const defaultCredit = (park) =>
  `Height requirements compiled from ${park.name}'s official website for the current season.`;

/** Ensure sources.json exists, carries an official_site URL, and declares datasets.external. */
export function ensureSourcesCatalogue(park) {
  const file = sourcesFile(park.id);
  let catalog = existsSync(file) ? readJson(file) : null;
  const site = officialSiteForPark(park);
  if (!catalog) {
    catalog = scaffoldSourcesCatalogue(park.id, park);
  }
  if (!Array.isArray(catalog.sources)) catalog.sources = [];
  if (site && !catalog.sources.some((s) => s.kind === 'official_site')) {
    catalog.sources.push({
      id: `${park.id}-site`,
      kind: 'official_site',
      url: site,
      used_for: 'Height requirements and attraction names for the current season.',
    });
  } else if (site) {
    const row = catalog.sources.find((s) => s.kind === 'official_site');
    if (row && !row.url) row.url = site;
  }
  ensureExternalDatasets(catalog);
  catalog.generated = new Date().toISOString().slice(0, 10);
  writeJson(file, catalog, true);
  return catalog;
}

/**
 * Build height rules from official attraction data matched to bundle rides.
 *
 * @param {{ id: string, name: string }} park
 * @param {object[]} pois built POI list
 * @param {object} official output of loadOfficialData
 * @param {string} [credit]
 */
export function heightsSidecarFromOfficial(park, pois, official, credit = defaultCredit(park)) {
  const rides = pois.filter(isRideable);
  const siteRows = official?.attractions || [];
  const siteNames = siteRows.map((a) => a.name);
  const rules = {};
  const today = official?.fetched || new Date().toISOString().slice(0, 10);
  let matched = 0;

  for (const ride of rides) {
    const pair = pairSuggestions([ride.n], siteNames, { floor: 0.72, limit: 1 })[0];
    if (!pair) continue;
    const row = siteRows.find((a) => a.name === pair.right);
    if (!row) continue;

    const min = row.height?.min ?? row.detail?.min ?? null;
    const max = row.detail?.max ?? row.height?.max ?? null;
    const alone = row.detail?.alone ?? null;

    if (min == null && max == null) continue;

    const rule = {
      h: {
        min: min ?? 0,
        alone: alone ?? null,
        max: max ?? null,
      },
      evidence: [{
        source: 'official_site',
        date: today,
        note: credit,
        url: row.url || null,
      }],
    };
    if (row.note) rule.note = row.note;
    rules[ride.n] = rule;
    matched += 1;
  }

  return {
    sidecar: {
      version: 1,
      _comment: 'Height rules beside the venue bundle. Re-applied on every build after overrides. A below-floor rule publishes as reported, not confirmed — never dropped.',
      venue: park.id,
      generated: today,
      publish_at: 'moderate',
      rules,
    },
    matched,
    rideCount: rides.length,
    siteCount: siteRows.length,
  };
}

/**
 * Fetch official listings and write the heights sidecar for a park.
 *
 * @param {object} park catalog row with id and name
 * @param {object[]} pois built POI list
 * @param {{ browser?: boolean, fetchDetails?: boolean }} opts
 */
export async function syncHeightsFromOfficial(park, pois, opts = {}) {
  const catalog = ensureSourcesCatalogue(park);
  const official = await loadOfficialData(park.id, catalog, {
    fetch: opts.fetch ?? !opts.offline,
    offline: opts.offline ?? false,
    browser: opts.browser ?? true,
    details: opts.fetchDetails ?? true,
  });

  const { sidecar, matched, rideCount, siteCount } = heightsSidecarFromOfficial(park, pois, official);
  const file = heightsFile(park.id);
  const existed = existsSync(file);
  writeJson(file, sidecar, true);

  return {
    file,
    wrote: !existed || matched > 0,
    matched,
    rideCount,
    siteCount,
    ruleCount: Object.keys(sidecar.rules).length,
    officialErrors: official.errors || [],
  };
}
