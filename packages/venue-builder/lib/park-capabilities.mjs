/**
 * Universal builder capabilities mapped to the weaknesses they address.
 *
 * Derived from the tooling shipped in this repo (PR #20 tool module, #30
 * sources/imagery, #31 research/official-site) and the gaps called out in
 * docs/park-intelligence-review.md. Each entry names a command or file shape
 * a park maintainer can reach for when an audit flags a weakness.
 */

export const CAPABILITIES = [
  {
    id: 'recipe',
    weakness: 'build-not-reproducible',
    tool: 'npm run venues:rebuild -- <id>',
    file: 'data/venues/<id>.recipe.json',
    note: 'Every build records how it was shaped; replay without reconstructing flags from a PR.',
  },
  {
    id: 'sources-catalogue',
    weakness: 'no-source-catalogue',
    tool: 'npm run venues:audit -- --scaffold-sources <id>',
    file: 'data/venues/<id>.sources.json',
    note: 'Wire merge, trace, imagery datasets and official URLs beside overrides.',
  },
  {
    id: 'official-site',
    weakness: 'no-official-cache',
    tool: 'npm run venues:research -- <id> --fetch',
    file: 'data/venues/<id>.official-cache.json',
    note: 'Compare park website attraction names and height categories to the bundle.',
  },
  {
    id: 'heights-sidecar',
    weakness: 'missing-heights',
    tool: 'npm run venues:ask -- <id>',
    file: 'data/venues/<id>.heights.json',
    note: 'Height rules with evidence; re-applied on every rebuild.',
  },
  {
    id: 'imagery',
    weakness: 'osm-gap-rides',
    tool: 'survey → data/venues/<id>.imagery.geojson',
    file: 'datasets.imagery in sources.json',
    note: 'Signed orthophoto positions for named track OSM does not place.',
  },
  {
    id: 'trace',
    weakness: 'missing-poi',
    tool: 'npm run venues:trace -- data/venues/<id>.trace.json',
    file: 'data/venues/<id>.traced.geojson',
    note: 'Georeferenced park map; refuses fits worse than 10 m RMS.',
  },
  {
    id: 'attractions',
    weakness: 'low-entrance-confidence',
    tool: 'npm run venues:attractions -- <id> --report',
    file: 'data/venues/<id>.attractions.json',
    note: 'Queue entrances need moderate evidence; geometry alone never publishes.',
  },
  {
    id: 'lands',
    weakness: 'no-districts',
    tool: 'overrides.lands or OSM land-use polygons',
    file: 'data/venues/<id>.overrides.json',
    note: 'Named districts for low-zoom map readability.',
  },
  {
    id: 'entity-resolution',
    weakness: 'duplicate-normalised',
    tool: 'npm run venues:research -- <id>',
    file: 'alias in overrides or heights sidecar',
    note: 'Queue nodes and rides sharing a normalised name; heights need one entry with alias.',
  },
  {
    id: 'tag-coverage',
    weakness: 'low-path-attributes',
    tool: 'fix osm-tags.mjs or enrich OSM',
    file: 'public/venues/<id>.map.json',
    note: 'Steps, oneway, and layer tags for routing profiles.',
  },
  {
    id: 'adapter-matrix',
    weakness: 'unknown-external-tool',
    tool: 'npm run venues:adapters',
    file: 'docs/universal-venue-builder-dependency-matrix.md',
    note: 'Evaluate wrap vs adopt for OSM, Valhalla, Mapillary, CV, and agent stacks.',
  },
  {
    id: 'evidence-graph',
    weakness: 'low-entrance-confidence',
    tool: 'npm run venues:attractions -- <id> --report',
    file: 'data/venues/<id>.attractions.json + scripts/lib/evidence-graph.mjs',
    note: 'Converging claims per feature; fusion publishes only validated coordinates.',
  },
  {
    id: 'playwright-research',
    weakness: 'no-official-cache',
    tool: 'adapter: playwright (wrap) — future venues:research --browser',
    file: 'scripts/lib/adapters/registry.mjs',
    note: 'Browser agent for park maps and accessibility pages beyond regex fetch.',
  },
  {
    id: 'mapillary-evidence',
    weakness: 'low-entrance-confidence',
    tool: 'adapter: mapillary-tools (wrap) — future imagery ingest',
    file: 'data/venues/<id>.attractions.json',
    note: 'Street-level sequences as mapillary evidence source.',
  },
  {
    id: 'parks-api-metadata',
    weakness: 'missing-hours',
    tool: 'adapter: parks-api (wrap)',
    file: 'data/venues/<id>.attractions.json',
    note: 'Park inventories and hours concepts into sidecar; not live wait times on phone.',
  },
];

/** Default official URLs for parks already in the manifest. */
export const KNOWN_OFFICIAL = {
  'big-kahunas': {
    site: 'https://bigkahunas.com/destin/attractions/water-park/',
    map: 'https://bigkahunas.com/destin/park-map/',
    operator: 'Big Kahuna\'s',
  },
  'cedar-point': {
    site: 'https://www.cedarpoint.com/rides-experiences',
    map: 'https://www.cedarpoint.com/park-map',
    operator: 'Cedar Point',
  },
  'kings-island': {
    site: 'https://www.visitkingsisland.com/rides-experiences',
    map: 'https://www.visitkingsisland.com/park-map',
    operator: 'Kings Island',
  },
  'six-flags-fiesta-texas': {
    site: 'https://www.sixflags.com/fiestatexas/attractions',
    map: 'https://www.sixflags.com/fiestatexas/park-map',
    operator: 'Six Flags Fiesta Texas',
  },
};

export function capabilityFor(weakness) {
  const aliases = {
    'no-official-cache': 'official-site',
    'unmatched-overrides': 'entity-resolution',
    'site-only-attractions': 'imagery',
    'height-mismatch': 'heights-sidecar',
  };
  const key = aliases[weakness] || weakness;
  return CAPABILITIES.find((c) => c.weakness === key || c.id === key) || null;
}

export function scaffoldSourcesCatalogue(id, venue = {}) {
  const known = KNOWN_OFFICIAL[id] || {};
  const name = venue.name || id;
  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    {
      id: 'osm',
      kind: 'openstreetmap',
      license: 'ODbL',
      url: 'https://www.openstreetmap.org',
      used_for: 'Park geometry, paths, buildings, and the venue boundary.',
    },
  ];
  if (known.site) {
    sources.push({
      id: `${id}-site`,
      kind: 'official_site',
      url: known.site,
      used_for: 'Height requirements and attraction names for the current season.',
    });
  }
  if (known.map) {
    sources.push({
      id: `${id}-map`,
      kind: 'official_map',
      url: known.map,
      used_for: 'Food, restroom, and ride labels; trace control points when georeferenced.',
    });
  }
  return {
    version: 1,
    venue: id,
    _comment: `Source catalogue for ${name}. Wire datasets as they are surveyed; fetch official listings with npm run venues:research -- ${id} --fetch. External adapters sync via npm run venues:sync-sources -- ${id}.`,
    generated: today,
    sources,
    datasets: {
      external: [
        'parks-api',
        'queue-times',
        'wikidata',
        'rcdb',
        'open-meteo',
        'openhistoricalmap',
        'mapillary-api',
        'accessibility-cloud',
        'project-sidewalk',
        'openrouteservice',
      ],
    },
    research: {
      official_pages: true,
      llm_open_research: true,
      note: 'LLM may propose aliases and height candidates from official HTML; code decides. Never invents coordinates.',
    },
  };
}
