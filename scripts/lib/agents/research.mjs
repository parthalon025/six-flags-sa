/**
 * Research agent — official site, browser fetch, ParksAPI inventory.
 */

import { loadVenuePacket, packetSummary } from '../venue-packet.mjs';
import { runAdapter } from '../adapters/runner.mjs';
import { officialUrls } from '../venue-official-site.mjs';
import { agentReview } from '../venue-llm.mjs';

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
    adapterRuns.push(await runAdapter('parks-api', { venueId }));
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
      judgements: packet.judgements?.map((j) => ({ key: j.key, count: j.count })),
    });
  }

  return {
    role: 'research',
    ok: true,
    summary,
    adapterRuns,
    packet,
    llm,
  };
}
