/**
 * Open research from official park pages + optional LLM extraction.
 *
 * Official HTML (and the structured attractions already parsed from it) is the
 * authoritative input. An LLM may propose aliases, height *candidates* with
 * quoted prose, inventory gaps, and — required for map acquisition — park-map
 * asset search. Never coordinates, never silent truth.
 *
 * Output: data/venues/<id>/llm-research-cache.json (builder sidecar only).
 */

import { readJson, writeJson, venueSidecar } from './venue-io.mjs';
import { llmConfig, chatCompletion, isAgentPending } from './venue-llm.mjs';
import { loadOfficialData, officialCacheFile } from './venue-official-site.mjs';
import { readSources } from './venue-sources.mjs';
import { pairSuggestions } from './venue-judge.mjs';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { applyAliasClaims, proposeAliases } from './auto-alias.mjs';
import {
  deterministicParkMapCandidates,
  fetchParkMapPages,
  llmSearchParkMaps,
  mergeParkMapResearch,
  parkMapSearchRequired,
  applyParkMapCandidatesToSources,
  downloadParkMapImage,
} from './park-map-research.mjs';

export const llmResearchCacheFile = (id) => venueSidecar(id, 'llm-research-cache.json');

export {
  extractParkMapAssetUrls,
  deterministicParkMapCandidates,
  llmSearchParkMaps,
  mergeParkMapResearch,
  parkMapSearchRequired,
  applyParkMapCandidatesToSources,
  downloadParkMapImage,
} from './park-map-research.mjs';

const EXTRACT_SYSTEM = `You extract structured research candidates from an official theme-park website listing.
Rules:
- Never invent coordinates or GPS positions.
- Never invent height numbers that are not supported by the provided text or structured rows.
- Prefer omitting a field over guessing.
- Aliases: only when the official name clearly refers to the same physical ride as a bundle name.
- heightCandidates: include a short quote from the source text when possible.
- inventoryGaps: attractions that appear on the official listing but not in the bundle names.
Return ONLY compact JSON with keys: aliases, heightCandidates, inventoryGaps, notes.
aliases: [{ "official": string, "bundle": string, "confidence": "low"|"moderate"|"high", "reason": string }]
heightCandidates: [{ "name": string, "min": number|null, "alone": number|null, "max": number|null, "quote": string, "url": string|null }]
inventoryGaps: [{ "name": string, "note": string }]
notes: string[]`;

function parseJsonObject(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Deterministic open research from official structured attractions (no LLM).
 * Produces inventory gaps and alias proposals via name pairing.
 */
export function deterministicOfficialResearch({ official, pois }) {
  const rides = (pois || []).filter(isRideable);
  const bundleNames = rides.map((p) => p.n);
  const siteNames = (official?.attractions || []).map((a) => a.name);
  const { claims: aliasClaims } = proposeAliases({
    venueId: '_',
    pois,
    officialNames: siteNames,
    parksApiNames: [],
  });

  const onlyOnSite = siteNames.filter((n) => {
    const hit = pairSuggestions([n], bundleNames, { floor: 0.72, limit: 1 })[0];
    return !hit;
  });

  const heightCandidates = [];
  for (const row of official?.attractions || []) {
    const min = row.height?.min ?? row.detail?.min ?? null;
    const max = row.detail?.max ?? row.height?.max ?? null;
    const alone = row.detail?.alone ?? null;
    if (min == null && max == null && alone == null) continue;
    heightCandidates.push({
      name: row.name,
      min,
      alone,
      max,
      quote: row.height?.label || row.note || 'from official structured listing',
      url: row.url || null,
      source: 'official_site',
    });
  }

  return {
    fetched: official?.fetched || new Date().toISOString().slice(0, 10),
    source: 'official_site',
    mode: 'deterministic',
    aliases: aliasClaims.map((c) => ({
      official: c.officialName,
      bundle: c.bundleName,
      confidence: c.confidence,
      reason: c.claim,
      score: c.score,
      source: c.source,
    })),
    heightCandidates,
    inventoryGaps: onlyOnSite.map((name) => ({
      name,
      note: 'On official listing; no close bundle match',
    })),
    notes: aliasClaims.length
      ? [`${aliasClaims.length} official↔bundle alias proposal(s) from name pairing`]
      : [],
    siteCount: siteNames.length,
    bundleRideCount: bundleNames.length,
  };
}

/**
 * Optional LLM pass over official structured rows (+ short text snippets).
 */
export async function llmExtractOfficialResearch({ official, pois, opts = {} }) {
  const cfg = llmConfig();
  if (!cfg.ready && !opts.apiKey) {
    return { skipped: true, reason: 'no_llm_api_key' };
  }

  const rides = (pois || []).filter(isRideable).map((p) => p.n);
  const listing = (official?.attractions || []).slice(0, 80).map((a) => ({
    name: a.name,
    url: a.url || null,
    height: a.height || a.detail || null,
    categories: a.categories || [],
  }));

  const content = await chatCompletion(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          bundleRideNames: rides,
          officialAttractions: listing,
          pages: (official?.pages || []).slice(0, 6),
        }),
      },
    ],
    opts,
  );

  if (isAgentPending(content)) {
    return { skipped: true, reason: 'llm_brief_pending' };
  }
  const parsed = parseJsonObject(content);
  if (!parsed) {
    return { skipped: false, error: 'llm_json_parse_failed', raw: content?.slice?.(0, 500) || null };
  }

  return {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'llm_extract',
    mode: 'llm',
    aliases: Array.isArray(parsed.aliases) ? parsed.aliases : [],
    heightCandidates: Array.isArray(parsed.heightCandidates) ? parsed.heightCandidates : [],
    inventoryGaps: Array.isArray(parsed.inventoryGaps) ? parsed.inventoryGaps : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    model: opts.model || cfg.model,
  };
}

/**
 * Merge deterministic official research with optional LLM extraction + park maps.
 * Height candidates from LLM are tagged llm_extract and never auto-applied to heights.json.
 * Park-map LLM search is required for map acquisition when requested.
 */
export function mergeOpenResearch(deterministic, llm, parkMap = null) {
  const out = {
    version: 1,
    fetched: deterministic.fetched,
    sources: ['official_site'],
    mode: llm && !llm.skipped && !llm.error ? 'official+llm' : 'official',
    aliases: [...(deterministic.aliases || [])],
    heightCandidates: [...(deterministic.heightCandidates || [])],
    inventoryGaps: [...(deterministic.inventoryGaps || [])],
    parkMaps: [],
    followUpUrls: [],
    searchQueries: [],
    notes: [...(deterministic.notes || [])],
    siteCount: deterministic.siteCount,
    bundleRideCount: deterministic.bundleRideCount,
    llm: null,
    llmParkMapSearch: null,
  };

  if (llm && !llm.skipped && !llm.error) {
    out.sources.push('llm_extract');
    out.llm = { model: llm.model, fetched: llm.fetched };
    for (const a of llm.aliases || []) {
      out.aliases.push({ ...a, source: 'llm_extract' });
    }
    for (const h of llm.heightCandidates || []) {
      out.heightCandidates.push({ ...h, source: 'llm_extract' });
    }
    for (const g of llm.inventoryGaps || []) {
      out.inventoryGaps.push({ ...g, source: 'llm_extract' });
    }
    out.notes.push(...(llm.notes || []));
  } else if (llm?.skipped) {
    out.notes.push(`LLM open research skipped: ${llm.reason}`);
  } else if (llm?.error) {
    out.notes.push(`LLM open research error: ${llm.error}`);
  }

  if (parkMap) {
    out.parkMaps = parkMap.parkMaps || [];
    out.followUpUrls = parkMap.followUpUrls || [];
    out.searchQueries = parkMap.searchQueries || [];
    out.llmParkMapSearch = parkMap.llmParkMapSearch;
    out.notes.push(...(parkMap.notes || []));
    if (parkMap.llmParkMapSearch && !parkMap.llmParkMapSearch.skipped && !parkMap.llmParkMapSearch.error) {
      out.sources.push('llm_park_map_search');
      if (out.mode === 'official') out.mode = 'official+llm';
      else if (out.mode === 'official+llm') out.mode = 'official+llm';
    }
  }

  return out;
}

/**
 * Run open research for a venue: load official cache/pages, optional LLM,
 * required LLM park-map search when AI is on, write sidecar.
 *
 * `cacheFile` overrides where the merged sidecar is written — tests that
 * exercise a real venue's research step use it to redirect the write away
 * from the committed `data/venues/<id>/llm-research-cache.json`.
 *
 * @param {string} venueId
 * @param {object[]} pois
 * @param {{ fetch?: boolean, browser?: boolean, ai?: boolean, applyAliases?: boolean, applyMaps?: boolean, fetchMaps?: boolean, offline?: boolean, cacheFile?: string }} opts
 */
export async function runOpenResearch(venueId, pois, opts = {}) {
  const { data: catalog } = readSources(venueId);
  let official = readJson(officialCacheFile(venueId), null);
  if (opts.fetch || (!official && !opts.offline)) {
    official = await loadOfficialData(venueId, catalog, {
      fetch: opts.fetch ?? true,
      offline: opts.offline ?? false,
      browser: opts.browser ?? true,
      fetchDetails: opts.fetchDetails ?? false,
    });
  }

  const deterministic = deterministicOfficialResearch({ official, pois });
  let llm = null;
  if (opts.ai) {
    llm = await llmExtractOfficialResearch({ official, pois, opts });
  } else {
    llm = { skipped: true, reason: 'ai_not_requested' };
  }

  /* Park-map acquisition: HTML scrape + LLM search (required when research asks for it). */
  const needMapSearch = parkMapSearchRequired(catalog);
  let htmlByUrl = {};
  if (needMapSearch && !opts.offline && (opts.fetch || opts.fetchMaps || opts.ai)) {
    const fetched = await fetchParkMapPages(catalog, { offline: opts.offline });
    htmlByUrl = fetched.htmlByUrl || {};
  }
  const detMaps = deterministicParkMapCandidates({ catalog, official, htmlByUrl });
  let llmMaps = null;
  if (needMapSearch && opts.ai) {
    llmMaps = await llmSearchParkMaps({
      venueId,
      venueName: official?.venue || catalog?.venue || venueId,
      catalog,
      candidates: detMaps.parkMaps,
      htmlByUrl,
      opts,
    });
  } else if (needMapSearch) {
    llmMaps = { skipped: true, reason: 'ai_not_requested', required: true };
  }
  const parkMap = needMapSearch
    ? mergeParkMapResearch(detMaps, llmMaps)
    : { parkMaps: detMaps.parkMaps, followUpUrls: [], searchQueries: [], notes: [], llmParkMapSearch: null };

  const merged = mergeOpenResearch(deterministic, llm, parkMap);
  merged.venue = venueId;
  const cacheFile = opts.cacheFile || llmResearchCacheFile(venueId);
  writeJson(cacheFile, merged, true);

  let aliasesApplied = 0;
  if (opts.applyAliases) {
    const aliasClaims = (merged.aliases || [])
      .filter((a) => a.official && a.bundle && a.source !== 'llm_extract' && a.confidence !== 'low')
      .map((a) => ({
        officialName: a.official,
        bundleName: a.bundle,
        confidence: a.confidence,
        score: a.score,
        source: a.source || 'official_site',
        claim: a.reason,
      }));
    if (aliasClaims.length) {
      const result = applyAliasClaims(venueId, aliasClaims);
      aliasesApplied = result.applied;
    }
  }

  let mapsApplied = null;
  let downloaded = null;
  if (opts.fetchMaps) {
    const remote = (merged.parkMaps || []).find(
      (m) => m.imageUrl && m.confidence !== 'low' && m.source === 'llm_park_map_search',
    ) || (merged.parkMaps || []).find((m) => m.imageUrl && m.mapish);
    if (remote?.imageUrl) {
      downloaded = await downloadParkMapImage(venueId, remote.imageUrl, {
        year: remote.year || undefined,
      });
      if (opts.applyMaps !== false) {
        mapsApplied = applyParkMapCandidatesToSources(venueId, [
          { ...remote, imagePath: downloaded.rel, confidence: 'high' },
        ], { force: Boolean(opts.forceMapImage) });
      }
    }
  } else if (opts.applyMaps) {
    mapsApplied = applyParkMapCandidatesToSources(venueId, merged.parkMaps || []);
  }

  return {
    file: cacheFile,
    research: merged,
    aliasesApplied,
    mapsApplied,
    downloaded,
    officialFetched: official?.fetched || null,
    siteCount: official?.attractions?.length || 0,
  };
}
