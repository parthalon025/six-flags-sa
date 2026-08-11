/**
 * Venue certification — the twin's birth certificate.
 *
 * Runs report (checklist), compare, route-qa, and ask as pass/fail gates.
 * Emits data/venues/<id>.certification.json with claim, evidence, confidence,
 * falsifier, and so-what per check. Below threshold, certification fails and
 * the ask brief is attached for a maintainer to act on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { compareVenue } from '../src/compare.mjs';
import { checklist, failures } from './venue-checklist.mjs';
import { requests, briefJson } from './venue-requests.mjs';
import { readRecipe } from './venue-recipe.mjs';
import { PUBLISH_AT, atLeast } from './evidence.mjs';
import { OVERRIDE_DIR, VENUE_DIR, readJson, writeJson } from './venue-io.mjs';
import { qaVenueRouting, MAX_ROUTING_ISLANDS, MAX_RIDE_SNAP_METRES } from './venue-route-qa-core.mjs';
import { readSources, externalAdaptersFromCatalog } from './venue-sources.mjs';

export const CERT_VERSION = 1;

const RIDE = (p) => p.c === 'coaster' || p.c === 'ride';

function check({ key, claim, pass, evidence, confidence, falsifier, soWhat }) {
  return { key, claim, pass, evidence, confidence, falsifier, soWhat };
}

function readAttractionsEntrances(id) {
  const data = readJson(path.join(OVERRIDE_DIR, `${id}.attractions.json`));
  if (!data?.attractions?.length) return { known: 0, published: 0, rides: 0 };
  const rides = data.attractions.length;
  let published = 0;
  let known = 0;
  for (const a of data.attractions) {
    const slot = a.features?.queue_entrance;
    if (!slot) continue;
    if (slot.at && !slot.conflict) known += 1;
    if (slot.at && !slot.conflict && atLeast(slot.confidence, PUBLISH_AT)) published += 1;
  }
  return { known, published, rides };
}

function heightsDeclaredAbsent(recipe, overrides) {
  if (recipe?.options?.['allow-no-heights']) return true;
  if (overrides?.heightsDeclaredAbsent) return true;
  return false;
}

function loadVenue(id) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venue = manifest.venues.find((v) => v.id === id);
  if (!venue) throw new Error(`No venue "${id}" in manifest`);
  const mapFile = path.join(VENUE_DIR, `${id}.map.json`);
  const poisFile = path.join(VENUE_DIR, `${id}.pois.json`);
  const map = readJson(mapFile, null);
  const pois = readJson(poisFile, null);
  if (!map || !pois) throw new Error(`Venue "${id}" is missing map.json or pois.json`);
  const sizes = {
    mapKb: fs.existsSync(mapFile) ? Math.round(fs.statSync(mapFile).size / 1024) : null,
    poisKb: fs.existsSync(poisFile) ? Math.round(fs.statSync(poisFile).size / 1024) : null,
  };
  const overrides = readJson(path.join(OVERRIDE_DIR, `${id}.overrides.json`), null);
  const recipe = readRecipe(id);
  return { venue, map, pois, sizes, overrides, recipe };
}

/**
 * Run all certification gates for one venue.
 *
 * @param {string} id
 * @param {{ write?: boolean }} opts
 * @returns certification result (also written when write !== false)
 */
export function certifyVenue(id, opts = {}) {
  const { venue, map, pois, sizes, overrides, recipe } = loadVenue(id);
  const checks = [];

  /* ---- report / checklist ---- */
  const items = checklist(venue, map, pois, sizes);
  const requiredFails = failures(items);
  const gatingKeys = ['geometry', 'places', 'keys', 'heights'];
  const applicableRequired = items.filter((i) => gatingKeys.includes(i.key) && i.status !== 'n/a');
  const requiredPass = applicableRequired.length - requiredFails.length;
  checks.push(
    check({
      key: 'checklist',
      claim: 'Required completeness items pass',
      pass: requiredFails.length === 0,
      evidence: {
        numerator: requiredPass,
        denominator: applicableRequired.length,
        detail: requiredFails.length
          ? requiredFails.map((f) => f.label).join('; ')
          : `${requiredPass}/${applicableRequired.length} required items ok`,
      },
      confidence: requiredFails.length === 0 ? 'high' : 'low',
      falsifier: 'Any required checklist item is missing',
      soWhat: 'Half-built venues draw a map but hide whole app features silently',
    }),
  );

  /* ---- compare ---- */
  const { stats, issues } = compareVenue(venue);
  checks.push(
    check({
      key: 'compare',
      claim: 'Built bundle matches manifest counts and has a recipe',
      pass: stats.ok,
      evidence: {
        numerator: stats.ok ? 1 : 0,
        denominator: 1,
        detail: stats.ok ? 'manifest and disk agree' : issues.join('; '),
        counts: stats.actual,
      },
      confidence: stats.ok ? 'high' : 'moderate',
      falsifier: 'POI, ride, height, or path counts drift from manifest',
      soWhat: 'The app reads manifest numbers; drift breaks trust in coverage badges',
    }),
  );

  /* ---- route-qa ---- */
  const route = qaVenueRouting(id);
  checks.push(
    check({
      key: 'route',
      claim: `Path graph has ≤${MAX_ROUTING_ISLANDS} islands and every ride snaps to the network`,
      pass: route.pass,
      evidence: {
        numerator: route.rideCount - route.ridesFarFromNetwork,
        denominator: route.rideCount,
        detail: `${route.components} component(s), ${route.ridesFarFromNetwork} ride(s) >${MAX_RIDE_SNAP_METRES} m from network`,
        components: route.components,
        largestComponent: route.largestComponent,
        farRides: route.farRides,
      },
      confidence:
        route.pass ? 'high'
          : route.components > MAX_ROUTING_ISLANDS ? 'low'
            : 'moderate',
      falsifier: 'OpenStreetMap path gaps strand rides on routing islands',
      soWhat: 'Offline routing cannot reach a ride that is not on the walk network',
    }),
  );

  /* ---- heights ---- */
  const rides = pois.filter(RIDE);
  const heights = rides.filter((p) => p.h).length;
  const declaredAbsent = heightsDeclaredAbsent(recipe, overrides);
  let heightsPass = false;
  let heightsDetail = '';
  let heightsConfidence = 'unknown';
  if (rides.length === 0) {
    heightsPass = true;
    heightsDetail = 'no rides at this venue';
    heightsConfidence = 'high';
  } else if (heights > 0) {
    heightsPass = true;
    heightsDetail = `${heights} of ${rides.length} rides carry height rules`;
    heightsConfidence = heights >= rides.length ? 'high' : 'moderate';
  } else if (declaredAbsent) {
    heightsPass = true;
    heightsDetail = 'heights declared absent in recipe or overrides';
    heightsConfidence = 'moderate';
  } else {
    heightsPass = false;
    heightsDetail = `${rides.length} rides and no height rules — Rides tab will not ship`;
    heightsConfidence = 'low';
  }
  checks.push(
    check({
      key: 'heights',
      claim: 'Height rules present or declared absent',
      pass: heightsPass,
      evidence: {
        numerator: heights,
        denominator: rides.length,
        detail: heightsDetail,
        declaredAbsent,
      },
      confidence: heightsConfidence,
      falsifier: 'A park with rides ships without height filter coverage',
      soWhat: 'Guests cannot filter by rider height offline without these rules',
    }),
  );

  /* ---- entrances ---- */
  const entrances = readAttractionsEntrances(id);
  const entrancesPass = rides.length === 0 || entrances.published > 0 || entrances.known > 0;
  checks.push(
    check({
      key: 'entrances',
      claim: `Queue entrances published at ≥${PUBLISH_AT} or recorded as proposals`,
      pass: entrancesPass,
      evidence: {
        numerator: entrances.published,
        denominator: entrances.rides || rides.length,
        known: entrances.known,
        detail: `${entrances.published} published / ${entrances.known} known / ${entrances.rides || rides.length} rides inventoried`,
      },
      confidence:
        entrances.published >= (entrances.rides || rides.length) ? 'high'
          : entrances.published > 0 ? 'moderate'
            : entrances.known > 0 ? 'low'
              : 'unknown',
      falsifier: 'No entrance evidence was inventoried for rideable attractions',
      soWhat: 'Routing to a ride uses queue entrance coordinates when published',
    }),
  );

  /* ---- ask ---- */
  const reqs = requests({ venue, map, pois, overrides });
  const blocking = reqs.filter((r) => r.blocking);
  checks.push(
    check({
      key: 'ask',
      claim: 'No blocking external requests remain',
      pass: blocking.length === 0,
      evidence: {
        numerator: reqs.length - blocking.length,
        denominator: reqs.length,
        detail: blocking.length
          ? blocking.map((r) => r.need).join('; ')
          : reqs.length ? `${reqs.length} non-blocking request(s)` : 'nothing outstanding',
        blocking: blocking.map((r) => r.key),
      },
      confidence: blocking.length === 0 ? 'high' : 'low',
      falsifier: 'A blocking gap was papered over instead of recorded',
      soWhat: 'Blocking requests mean a whole app feature is absent without saying so',
    }),
  );

  /* ---- external sources catalogue ---- */
  const { data: catalog } = readSources(id);
  const declared = externalAdaptersFromCatalog(catalog, { fallback: [] });
  let cachedExternal = 0;
  for (const adapterId of declared) {
    const file = path.join(
      OVERRIDE_DIR,
      adapterId === 'parks-api' ? `${id}.parks-api-cache.json` : `${id}.${adapterId}-cache.json`,
    );
    if (readJson(file, null)) cachedExternal += 1;
  }
  const llmResearch = readJson(path.join(OVERRIDE_DIR, `${id}.llm-research-cache.json`), null);
  const officialCache = readJson(path.join(OVERRIDE_DIR, `${id}.official-cache.json`), null);
  const hasOfficialStrategy = Boolean(catalog?.sources?.some((s) => s.kind === 'official_site'));
  const hasResearchTrail = Boolean(officialCache) || Boolean(llmResearch) || cachedExternal > 0;
  const externalPass = declared.length === 0 || hasResearchTrail || hasOfficialStrategy;
  checks.push(
    check({
      key: 'external_sources',
      claim: 'Declared external adapters have caches or open research is recorded',
      pass: externalPass,
      evidence: {
        numerator: cachedExternal + (officialCache ? 1 : 0) + (llmResearch ? 1 : 0),
        denominator: Math.max(declared.length, 1),
        detail: declared.length
          ? `${cachedExternal}/${declared.length} external caches; official=${Boolean(officialCache)}; llm=${Boolean(llmResearch)}`
          : 'no datasets.external declared',
        declared,
      },
      confidence:
        declared.length && cachedExternal >= Math.ceil(declared.length * 0.5) ? 'high'
          : hasResearchTrail ? 'moderate'
            : hasOfficialStrategy ? 'low'
              : 'unknown',
      falsifier: 'sources.json lists adapters that were never synced and no open research ran',
      soWhat: 'Explore-more research sources must either feed the twin or show as an honest gap',
    }),
  );

  const certified = checks.every((c) => c.pass);
  const askBrief = certified ? null : briefJson(venue, reqs);

  const doc = {
    version: CERT_VERSION,
    venue: { id: venue.id, name: venue.name, locality: venue.locality },
    certified,
    certifiedAt: certified ? new Date().toISOString() : null,
    checks,
    ask: askBrief,
  };

  if (opts.write !== false) {
    const file = path.join(OVERRIDE_DIR, `${id}.certification.json`);
    writeJson(file, doc, true);
  }

  return doc;
}

/** Certify every venue in the manifest. */
export function certifyAll(opts = {}) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  return manifest.venues.map((v) => certifyVenue(v.id, opts));
}

export function certificationFile(id) {
  return path.join(OVERRIDE_DIR, `${id}.certification.json`);
}

export function renderCertificationMarkdown(doc) {
  const lines = [
    `# Certification — ${doc.venue.name}`,
    '',
    doc.certified ? '**Certified**' : '**Not certified**',
    '',
    '| Check | Pass | Evidence | Confidence |',
    '| --- | :-: | --- | --- |',
  ];
  for (const c of doc.checks) {
    lines.push(`| ${c.key} | ${c.pass ? '✅' : '❌'} | ${c.evidence.detail} | ${c.confidence} |`);
  }
  if (doc.ask?.blocking) {
    lines.push('', '## Blocking requests', '');
    for (const r of doc.ask.requests.filter((x) => x.blocking)) {
      lines.push(`- **${r.need}**: ${r.why}`);
    }
  }
  return lines.join('\n');
}
