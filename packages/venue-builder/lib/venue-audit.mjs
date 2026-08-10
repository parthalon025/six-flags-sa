/**
 * Cross-park audit — weaknesses every venue shares, and which builder tool
 * addresses each one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { checklist, failures } from './venue-checklist.mjs';
import { requests } from './venue-requests.mjs';
import { readSources, sourcesFile, osmGaps } from './venue-sources.mjs';
import { judgements } from './venue-judge.mjs';
import { tagCoverageFromMap } from './tag-coverage.mjs';
import { capabilityFor, KNOWN_OFFICIAL, scaffoldSourcesCatalogue, CAPABILITIES } from './park-capabilities.mjs';
import { compareOfficialToBundle, officialCacheFile, loadOfficialData, enrichOfficialFromSidecar } from './venue-official-site.mjs';
import { OVERRIDE_DIR, VENUE_DIR, readJson } from './venue-io.mjs';

const RIDE = (p) => p.c === 'coaster' || p.c === 'ride';

function readAttractionsSummary(id) {
  const data = readJson(path.join(OVERRIDE_DIR, `${id}.attractions.json`));
  if (!data?.attractions?.length) return { rides: 0, published: 0 };
  const rides = data.attractions.length;
  const published = data.attractions.filter(
    (a) => ['moderate', 'high', 'very_high'].includes(a.features?.queue_entrance?.confidence),
  ).length;
  return { rides, published };
}

/**
 * Weaknesses for one venue, with recommended capabilities.
 */
export function auditVenue({
  venue,
  map,
  pois,
  overrides,
  heightsSidecar = null,
  official = null,
  catalog = null,
}) {
  const id = venue.id;
  const layers = { coaster: map.coaster || [], slide: map.slide || [] };
  const items = checklist(venue, map, pois, {
    mapKb: fs.existsSync(path.join(VENUE_DIR, `${id}.map.json`))
      ? Math.round(fs.statSync(path.join(VENUE_DIR, `${id}.map.json`)).size / 1024)
      : null,
  });
  const checklistFails = failures(items);
  const missingDistricts = items.some((i) => i.key === 'districts' && i.status === 'missing');
  const reqs = requests({ venue, map, pois, overrides });
  const judge = judgements({ pois, layers, overrides });
  const gaps = osmGaps({ pois, layers });
  const tagCov = tagCoverageFromMap(map);
  const attractions = readAttractionsSummary(id);
  const rides = pois.filter(RIDE);
  const heights = rides.filter((p) => p.h).length;

  const weaknesses = [];

  if (!fs.existsSync(sourcesFile(id))) {
    weaknesses.push({ key: 'no-source-catalogue', severity: 'medium', detail: 'No sources.json on disk.' });
  }
  if (!fs.existsSync(officialCacheFile(id)) && KNOWN_OFFICIAL[id]?.site) {
    weaknesses.push({
      key: 'no-official-cache',
      severity: 'low',
      detail: 'Official site not fetched yet — npm run venues:research -- <id> --fetch',
    });
  }
  if (gaps.missingRides.length) {
    weaknesses.push({
      key: 'osm-gap-rides',
      severity: 'medium',
      count: gaps.missingRides.length,
      detail: gaps.missingRides.slice(0, 5).join('; '),
    });
  }
  const dupes = judge.find((j) => j.key === 'duplicate-normalised');
  if (dupes) {
    weaknesses.push({
      key: 'duplicate-normalised',
      severity: 'low',
      count: dupes.count,
      detail: 'Queue nodes and rides may share one height rule via alias.',
    });
  }
  if (missingDistricts) {
    weaknesses.push({ key: 'no-districts', severity: 'low', detail: 'No named lands drawn.' });
  }
  if (rides.length && heights < rides.length) {
    weaknesses.push({
      key: 'missing-heights',
      severity: heights === 0 ? 'high' : 'medium',
      count: rides.length - heights,
      detail: `${rides.length - heights} ride(s) without height rules.`,
    });
  }
  if (attractions.rides && attractions.published < attractions.rides * 0.1) {
    weaknesses.push({
      key: 'low-entrance-confidence',
      severity: 'low',
      count: attractions.rides - attractions.published,
      detail: `${attractions.published}/${attractions.rides} rides publish a queue entrance.`,
    });
  }
  if (tagCov.ways > 50 && tagCov.steps === 0) {
    weaknesses.push({
      key: 'low-path-attributes',
      severity: 'low',
      detail: `${tagCov.ways} walkable ways, none tagged as steps in the built map.`,
    });
  }
  for (const r of reqs) {
    if (r.key === 'unmatched') {
      weaknesses.push({ key: 'unmatched-overrides', severity: 'medium', count: r.targets.length });
    }
  }
  if (official?.onlyOnSite?.length) {
    weaknesses.push({
      key: 'site-only-attractions',
      severity: 'medium',
      count: official.onlyOnSite.length,
      detail: official.onlyOnSite.slice(0, 4).join('; '),
    });
  }
  if (official?.heightMismatches?.length) {
    weaknesses.push({
      key: 'height-mismatch',
      severity: 'high',
      count: official.heightMismatches.length,
    });
  }

  const recommendations = [...new Set(weaknesses.map((w) => capabilityFor(w.key)?.id).filter(Boolean))]
    .map((capId) => CAPABILITIES.find((c) => c.id === capId))
    .filter(Boolean);

  return {
    id,
    name: venue.name,
    weaknesses,
    recommendations,
    stats: {
      rides: rides.length,
      heights,
      pois: pois.length,
      shapes: Object.values(map).filter(Array.isArray).reduce((n, a) => n + a.length, 0),
      tagCoverage: tagCov,
      attractions,
      officialMatched: official?.matched ?? null,
    },
    checklistFails,
    judgements: judge,
    requests: reqs,
  };
}

/**
 * Audit every venue in the manifest.
 */
export async function auditAll({ fetchOfficial = false, offline = true } = {}) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const parks = [];
  for (const venue of manifest.venues) {
    const map = readJson(path.join(VENUE_DIR, `${venue.id}.map.json`), {});
    const pois = readJson(path.join(VENUE_DIR, `${venue.id}.pois.json`), []);
    const overrides = readJson(path.join(OVERRIDE_DIR, `${venue.id}.overrides.json`), null);
    const heightsSidecar = readJson(path.join(OVERRIDE_DIR, `${venue.id}.heights.json`), null);
    const { data: catalog } = readSources(venue.id);
    const officialRaw = enrichOfficialFromSidecar(
      await loadOfficialData(venue.id, catalog, { fetch: fetchOfficial, offline }),
      heightsSidecar,
      catalog,
    );
    const official = compareOfficialToBundle({ official: officialRaw, pois, heightsSidecar });
    parks.push(auditVenue({
      venue, map, pois, overrides, heightsSidecar, official, catalog,
    }));
  }
  return { generated: new Date().toISOString().slice(0, 10), parks };
}

export function renderAuditMarkdown(report) {
  const lines = [
    '# Universal builder — cross-park audit',
    '',
    `Generated ${report.generated}. Weaknesses are grouped by capability from the repo's venue tooling (recipe, sources, research, trace, attractions).`,
    '',
    '| Park | Rides | Heights | Weaknesses | Top fix |',
    '| --- | ---: | ---: | ---: | --- |',
  ];
  for (const p of report.parks) {
    const top = p.recommendations[0]?.tool?.replace('<id>', p.id) || '—';
    lines.push(
      `| ${p.name} | ${p.stats.rides} | ${p.stats.heights} | ${p.weaknesses.length} | ${top} |`,
    );
  }
  lines.push('', '## Per park', '');
  for (const p of report.parks) {
    lines.push(`### ${p.name} (\`${p.id}\`)`, '');
    if (!p.weaknesses.length) {
      lines.push('No weaknesses flagged.', '');
      continue;
    }
    for (const w of p.weaknesses) {
      const cap = capabilityFor(w.key);
      lines.push(`- **${w.key}** (${w.severity})${w.detail ? `: ${w.detail}` : ''}`);
      if (cap) lines.push(`  - → \`${cap.tool.replace('<id>', p.id)}\``);
    }
    lines.push('');
  }
  lines.push('## Capability reference', '');
  for (const c of CAPABILITIES) {
    lines.push(`- **${c.id}** — ${c.note} (\`${c.tool}\`)`);
  }
  return lines.join('\n');
}

export { scaffoldSourcesCatalogue, KNOWN_OFFICIAL };
