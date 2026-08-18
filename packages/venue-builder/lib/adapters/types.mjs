/**
 * Shared shapes for external-tool adapters around the Universal Venue Builder.
 *
 * Adapters are not forks of upstream repos. Each adapter documents how an
 * external project would be invoked (CLI, container, HTTP) and what evidence
 * or geometry it can contribute. Runtime wiring lives in builder services;
 * the phone app still consumes fused JSON from public/venues/.
 */

/** How this repo relates to the upstream project. */
export const ADOPT_MODES = ['adopt', 'wrap', 'fork', 'replace', 'evaluate', 'defer', 'reject'];

/** Builder pipeline stage an adapter feeds. */
export const STAGES = [
  'research',   // web discovery, official pages, maps
  'geo',        // base geography, OSM, routing graphs
  'vision',     // imagery, detection, segmentation, SfM
  'venue_data', // park inventories, hours, wait-time concepts
  'tiles',      // vector tile delivery
  'orchestration', // long-running agent workflows
  'runtime_map', // client map renderer (optional future)
  'display', // PR #471 Display-layer assets (materials, tiles, skins) — enforced empty evidence_sources, see registry.mjs
];

/**
 * @typedef {object} AdapterDescriptor
 * @property {string} id
 * @property {string} name
 * @property {string} repo
 * @property {string} capability
 * @property {string} role
 * @property {string} stage
 * @property {string} license
 * @property {string} adopt — one of ADOPT_MODES
 * @property {string} maturity — prototype | beta | production
 * @property {number} maintenance — 0–5 subjective activity score
 * @property {string[]} languages
 * @property {boolean} docker
 * @property {boolean} gpu
 * @property {boolean} offline
 * @property {boolean} commercial_ok — rough AGPL/commercial viability flag
 * @property {string[]} evidence_sources — keys into evidence.WEIGHTS when applicable
 * @property {string} integration — integration difficulty: low | medium | high
 * @property {string} overlap — how much existing builder code already covers this
 * @property {string} notes
 * @property {string} [url]
 */

/**
 * Normalised evidence claim an adapter may emit for fusion.
 *
 * @typedef {object} EvidenceClaim
 * @property {string} feature_id — stable place or candidate id in sidecar
 * @property {string} source — evidence.WEIGHTS key
 * @property {string} [kind] — entrance | exit | queue | path | metadata | hours
 * @property {{ lat: number, lng: number }} [at]
 * @property {string} [date] — ISO date the observation was made
 * @property {string} [uri] — permalink to image, OSM element, API record
 * @property {string} [note]
 * @property {object} [raw] — adapter-specific payload kept in sidecar only
 */

/**
 * @typedef {object} AdapterRunContext
 * @property {string} venueId
 * @property {object} [bounds]
 * @property {string} [place]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} AdapterResult
 * @property {string} adapterId
 * @property {boolean} ok
 * @property {EvidenceClaim[]} [claims]
 * @property {string[]} [artifacts] — paths written (GeoJSON, traces, caches)
 * @property {string} [error]
 * @property {object} [meta]
 */

/** Stub interface — concrete adapters implement `describe` + optional `run`. */
export function defineAdapter(descriptor, impl = {}) {
  return {
    ...descriptor,
    describe() {
      return { ...descriptor };
    },
    async run(ctx) {
      if (impl.run) return impl.run(ctx);
      return {
        adapterId: descriptor.id,
        ok: false,
        error: 'not_implemented',
        meta: { message: 'Adapter registered for evaluation; no run() yet.' },
      };
    },
  };
}
