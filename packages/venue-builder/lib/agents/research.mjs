/**
 * Research agent — official site, browser fetch, ParksAPI inventory, open-source adapters,
 * and optional LLM open research over official pages.
 */

import path from 'node:path';
import { loadVenuePacket, packetSummary } from '../venue-packet.mjs';
import { runAdapter } from '../adapters/runner.mjs';
import { runAdapters } from '../adapters/runner.mjs';
import { officialUrls } from '../venue-official-site.mjs';
import { agentReview } from '../venue-llm.mjs';
import { venueResearchContext, resolveExternalAdapterIds } from '../external-research.mjs';
import { runOpenResearch } from '../open-research.mjs';
import { readJson, VENUE_DIR } from '../venue-io.mjs';

export async function runResearchAgent(venueId, opts = {}) {
  const packet = await loadVenuePacket(venueId, {
    fetch: opts.fetch ?? true,
    browser: opts.browser ?? true,
    parksApi: opts.parksApi ?? true,
    offline: opts.offline,
    fetchDetails: opts.fetchDetails,
  });

  const adapterRuns = [];
  const urls = officialUrls(packet.catalog);
  if (opts.browser && urls.site[0]?.url) {
    adapterRuns.push(await runAdapter('playwright', { url: urls.site[0].url }));
  }
  if (opts.parksApi || opts.fetch) {
    adapterRuns.push(await runAdapter('parks-api', { venueId, fetch: opts.fetch ?? true }));
  }
  if (opts.syncExternal ?? opts.fetch) {
    const ctx = { ...venueResearchContext(venueId), fetch: opts.fetch ?? true, offline: opts.offline };
    const ids = resolveExternalAdapterIds(venueId, opts);
    adapterRuns.push(...await runAdapters(ids, ctx));
  }

  let openResearch = null;
  if (opts.openResearch !== false) {
    const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []) || [];
    try {
      openResearch = await runOpenResearch(venueId, pois, {
        /* Pinned offline until #23: every other step above takes the caller's
           `fetch`, and this one refused it, so the park-map lane could not run
           by any route — not through `--ai`, not through the deterministic HTML
           extract that needs no model at all. `park_map_research` then read
           `searchQueries: []` on three venues and was read as "never run", which
           was true and could not have been otherwise. Default stays offline, so
           a build is still reproducible unless a caller asks for the network. */
        fetch: opts.fetch ?? false,
        offline: opts.offline ?? !(opts.fetch || opts.fetchMaps || opts.ai),
        fetchMaps: opts.fetchMaps,
        browser: false,
        ai: opts.ai ?? false,
        applyAliases: opts.applyAliases ?? false,
        // Test-only redirect for the sidecar write; unset in every real build run.
        cacheFile: opts.researchCacheFile,
      });
    } catch (err) {
      openResearch = { error: err.message };
    }
  }

  const summary = packetSummary(packet);
  let llm = null;
  if (opts.ai) {
    llm = await agentReview('research', {
      summary,
      official: {
        matched: packet.official?.matched,
        siteCount: packet.official?.siteCount,
        onlyOnSite: packet.official?.onlyOnSite?.slice(0, 8),
      },
      parksApi: {
        matched: packet.parksApi?.matched,
        onlyOnApi: packet.parksApi?.onlyOnApi?.slice(0, 8),
      },
      external: {
        queueTimesMatched: packet.external?.queueTimes?.matched,
        rcdbMatched: packet.external?.rcdb?.matched,
        claims: packet.external?.claims?.length,
      },
      openResearch: openResearch?.research
        ? {
            mode: openResearch.research.mode,
            aliases: openResearch.research.aliases?.length,
            heightCandidates: openResearch.research.heightCandidates?.length,
            inventoryGaps: openResearch.research.inventoryGaps?.length,
            parkMaps: openResearch.research.parkMaps?.length,
            llmParkMapSearch: openResearch.research.llmParkMapSearch,
            searchQueries: openResearch.research.searchQueries?.slice?.(0, 5),
          }
        : null,
      judgements: packet.judgements?.map((j) => ({ key: j.key, count: j.count })),
    });
  }

  return {
    role: 'research',
    ok: true,
    summary,
    adapterRuns,
    packet,
    openResearch,
    llm,
  };
}
