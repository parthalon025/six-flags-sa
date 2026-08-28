/**
 * Park map acquisition — deterministic HTML scrape + required LLM search.
 *
 * Official handout maps are often only discoverable via the park's map page
 * (embedded images, PDFs, CDN assets). Deterministic extraction pulls candidate
 * URLs from fetched HTML; an LLM pass is required to rank which assets are the
 * current park map, propose year / map_kind, and suggest a package-local path
 * under data/venues/<id>/maps/. Neither step invents coordinates.
 */

import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { llmConfig, chatCompletion, isAgentPending } from './venue-llm.mjs';
import { fetchUrl } from './venue-official-site.mjs';
import { officialMapsFromCatalog } from './official-map.mjs';
import {
  readJson,
  writeJson,
  venueSidecar,
  venueSidecarRel,
  venuePkgDir,
  resolveBuilderPath,
} from './venue-io.mjs';
import { readSources } from './venue-sources.mjs';

const MAP_ASSET_RE = /\.(?:png|jpe?g|webp|gif|pdf|svg)(?:\?|#|$)/i;
const MAPISH_RE = /park[-_ ]?map|map[-_ ]?of|guest[-_ ]?map|guide[-_ ]?map|schematic|handout|cartograph|venue[-_ ]?map/i;
const SANITY_DIM_RE = /-(\d+)x(\d+)\.(?:png|jpe?g|webp|gif)$/i;
const NEXT_IMAGE_RE = /\/_next\/image\?url=([^"'&\s]+)/gi;

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sanityDimensions(url) {
  const base = String(url || '').split('?')[0];
  const m = base.match(SANITY_DIM_RE);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return { w, h, aspect: w / h };
}

/** Wide schematic guest maps (Cedar Fair / Six Flags Sanity assets) are mapish by aspect. */
function mapishFromUrl(url) {
  const dim = sanityDimensions(url);
  if (dim && dim.aspect >= 2.5) return true;
  return MAP_ASSET_RE.test(url) && MAPISH_RE.test(url);
}

const PARK_MAP_LLM_SYSTEM = `You help acquire official theme-park guest maps for an open-source map builder.
Rules:
- Never invent coordinates or GPS positions.
- Prefer URLs that appear in the provided HTML candidates or page snippets.
- If no usable map image is in the candidates, propose followUpUrls (official pages to fetch next) and searchQueries — do not invent download URLs.
- Classify map_kind as schematic (illustrated/not-to-scale), photo (photo of a board), or to_scale (survey/CAD).
- Suggest imagePath relative to the venue-builder package, e.g. data/venues/<id>/maps/2026-parkmap.webp
Return ONLY compact JSON:
{
  "parkMaps": [{
    "pageUrl": string|null,
    "imageUrl": string|null,
    "year": number|null,
    "mapKind": "schematic"|"photo"|"to_scale",
    "confidence": "low"|"moderate"|"high",
    "title": string|null,
    "quote": string|null,
    "imagePath": string|null,
    "reason": string
  }],
  "followUpUrls": string[],
  "searchQueries": string[],
  "notes": string[]
}`;

function absolutize(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl || undefined).href;
  } catch {
    return null;
  }
}

/** Pull map-like image/PDF URLs from an HTML page. */
export function extractParkMapAssetUrls(html, pageUrl) {
  const text = decodeHtmlEntities(html || '');
  const found = new Map();

  const consider = (raw, via) => {
    const url = absolutize(String(raw || '').trim().replace(/^<|>$/g, ''), pageUrl);
    if (!url || !/^https?:/i.test(url)) return;
    if (!MAP_ASSET_RE.test(url)) return;
    const key = url.split('#')[0];
    if (found.has(key)) return;
    const mapish = mapishFromUrl(url) || MAPISH_RE.test(via || '');
    found.set(key, {
      imageUrl: key,
      pageUrl: pageUrl || null,
      via: via || 'html',
      mapish,
      source: 'html_extract',
    });
  };

  for (const m of text.matchAll(/\bsrc=["']([^"']+)["']/gi)) consider(m[1], 'img.src');
  for (const m of text.matchAll(/\bdata-src=["']([^"']+)["']/gi)) consider(m[1], 'img.data-src');
  for (const m of text.matchAll(/\bhref=["']([^"']+)["']/gi)) consider(m[1], 'a.href');
  for (const m of text.matchAll(/content=["'](https?:[^"']+\.(?:png|jpe?g|webp|gif|pdf)[^"']*)["']/gi)) {
    consider(m[1], 'meta');
  }
  for (const m of text.matchAll(/\b(?:srcset|data-srcset)=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      consider(u, 'srcset');
    }
  }

  // Next.js image optimizer encodes Sanity CDN guest maps — decode the inner URL.
  for (const m of text.matchAll(NEXT_IMAGE_RE)) {
    let encoded = m[1];
    try {
      encoded = decodeURIComponent(encoded);
    } catch {
      /* keep raw */
    }
    consider(encoded, 'next_image');
  }

  // Direct Sanity CDN references (inline JSON, preload links, etc.)
  for (const m of text.matchAll(/https:\/\/cdn\.sanity\.io\/images\/[^"'\s\\]+/gi)) {
    consider(m[0].replace(/\\+$/, ''), 'sanity_cdn');
  }

  return [...found.values()].sort((a, b) => Number(b.mapish) - Number(a.mapish));
}

/**
 * Deterministic park-map candidates from catalogue + HTML extracts.
 * Does not call an LLM.
 */
export function deterministicParkMapCandidates({ catalog, official, htmlByUrl = {} } = {}) {
  const maps = officialMapsFromCatalog(catalog);
  const candidates = [];

  for (const m of maps) {
    if (m.image) {
      candidates.push({
        pageUrl: m.url || null,
        imageUrl: null,
        imagePath: m.image,
        mapKind: m.mapKind,
        year: null,
        confidence: existsSync(resolveBuilderPath(m.image) || '') ? 'high' : 'moderate',
        title: m.id,
        quote: 'catalogued in sources.json',
        source: 'sources_catalog',
        localExists: Boolean(resolveBuilderPath(m.image) && existsSync(resolveBuilderPath(m.image))),
      });
    }
    if (m.url && htmlByUrl[m.url]) {
      for (const hit of extractParkMapAssetUrls(htmlByUrl[m.url], m.url)) {
        candidates.push({
          ...hit,
          mapKind: m.mapKind,
          confidence: hit.mapish ? 'moderate' : 'low',
          title: m.id,
        });
      }
    }
  }

  for (const page of official?.pages || []) {
    if (page.kind !== 'official_map') continue;
    if (page.image) {
      candidates.push({
        pageUrl: page.url || null,
        imageUrl: null,
        imagePath: page.image,
        mapKind: 'schematic',
        confidence: 'moderate',
        title: page.id || 'official_map',
        quote: 'official-cache page image',
        source: 'official_cache',
      });
    }
  }

  return {
    mode: 'deterministic',
    source: 'park_map_html',
    parkMaps: candidates,
    followUpUrls: maps.filter((m) => m.url).map((m) => m.url),
    searchQueries: [],
    notes: candidates.length
      ? [`${candidates.length} park-map candidate(s) from catalogue/HTML`]
      : ['No park-map assets found in catalogue or HTML — LLM search required'],
  };
}

/**
 * Fetch official_map pages for HTML extraction (network).
 */
export async function fetchParkMapPages(catalog, opts = {}) {
  const maps = officialMapsFromCatalog(catalog);
  const htmlByUrl = {};
  const errors = [];
  for (const m of maps) {
    if (!m.url) continue;
    if (opts.offline) continue;
    try {
      htmlByUrl[m.url] = await fetchUrl(m.url, { timeoutMs: opts.timeoutMs || 25000 });
    } catch (err) {
      errors.push(`${m.url}: ${err.message}`);
    }
  }
  return { htmlByUrl, errors };
}

/**
 * LLM park-map search — required when acquiring maps with --ai.
 * Uses catalogue URLs, deterministic candidates, and short HTML snippets.
 */
export async function llmSearchParkMaps({
  venueId,
  venueName,
  catalog,
  candidates = [],
  htmlByUrl = {},
  opts = {},
} = {}) {
  const cfg = llmConfig();
  if (!cfg.ready && !opts.apiKey) {
    return { skipped: true, reason: 'no_llm_api_key', required: true };
  }

  const maps = officialMapsFromCatalog(catalog);
  const snippets = {};
  for (const [url, html] of Object.entries(htmlByUrl || {})) {
    const text = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500);
    snippets[url] = text;
  }

  const content = await chatCompletion(
    [
      { role: 'system', content: PARK_MAP_LLM_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          venueId,
          venueName: venueName || venueId,
          cataloguedMaps: maps.map((m) => ({
            id: m.id,
            url: m.url,
            image: m.image,
            mapKind: m.mapKind,
          })),
          htmlCandidates: candidates.slice(0, 40),
          pageSnippets: snippets,
          required: 'Identify the current official guest park map for tracing/georef.',
        }),
      },
    ],
    opts,
  );

  if (isAgentPending(content)) {
    // skipped:true matches the sibling in open-research.mjs so the merge
    // functions report "answer the brief", never a completed search.
    return { skipped: true, required: true, pending: true, reason: 'llm_brief_pending' };
  }
  const parsed = parseJsonObject(content);
  if (!parsed) {
    return {
      skipped: false,
      required: true,
      error: 'llm_json_parse_failed',
      raw: content?.slice?.(0, 500) || null,
    };
  }

  const parkMaps = (Array.isArray(parsed.parkMaps) ? parsed.parkMaps : []).map((row) => ({
    pageUrl: row.pageUrl || null,
    imageUrl: row.imageUrl || null,
    year: row.year ?? null,
    mapKind: row.mapKind || 'schematic',
    confidence: row.confidence || 'low',
    title: row.title || null,
    quote: row.quote || null,
    imagePath: row.imagePath || null,
    reason: row.reason || null,
    source: 'llm_park_map_search',
  }));

  return {
    skipped: false,
    required: true,
    fetched: new Date().toISOString().slice(0, 10),
    source: 'llm_park_map_search',
    mode: 'llm',
    parkMaps,
    followUpUrls: Array.isArray(parsed.followUpUrls) ? parsed.followUpUrls : [],
    searchQueries: Array.isArray(parsed.searchQueries) ? parsed.searchQueries : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    model: opts.model || cfg.model,
  };
}

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

/** Merge deterministic + LLM park-map results (LLM never replaces local catalogue truth silently). */
export function mergeParkMapResearch(deterministic, llm) {
  const out = {
    parkMaps: [...(deterministic?.parkMaps || [])],
    followUpUrls: [...(deterministic?.followUpUrls || [])],
    searchQueries: [],
    notes: [...(deterministic?.notes || [])],
    llmParkMapSearch: null,
  };

  if (llm && !llm.skipped && !llm.error && !llm.pending) {
    out.llmParkMapSearch = { model: llm.model, fetched: llm.fetched, required: true };
    for (const m of llm.parkMaps || []) {
      out.parkMaps.push({ ...m, source: m.source || 'llm_park_map_search' });
    }
    out.followUpUrls.push(...(llm.followUpUrls || []));
    out.searchQueries.push(...(llm.searchQueries || []));
    out.notes.push(...(llm.notes || []));
    out.notes.push('LLM park-map search completed (required for map acquisition)');
  } else if (llm?.skipped) {
    out.notes.push(`LLM park-map search skipped (required): ${llm.reason}`);
    out.llmParkMapSearch = { skipped: true, reason: llm.reason, required: true };
  } else if (llm?.error) {
    out.notes.push(`LLM park-map search error (required): ${llm.error}`);
    out.llmParkMapSearch = { error: llm.error, required: true };
  } else if (llm == null) {
    out.notes.push('LLM park-map search not run — required to acquire official map assets');
    out.llmParkMapSearch = { skipped: true, reason: 'not_run', required: true };
  }

  // Dedupe follow-ups / queries
  out.followUpUrls = [...new Set(out.followUpUrls.filter(Boolean))];
  out.searchQueries = [...new Set(out.searchQueries.filter(Boolean))];
  return out;
}

/**
 * Wire a high-confidence local imagePath into sources.json official_map.image.
 * Never invents coordinates; only updates catalogue pointers.
 */
export function applyParkMapCandidatesToSources(venueId, parkMaps, opts = {}) {
  const { file, data } = readSources(venueId);
  if (!data) return { applied: 0, reason: 'no_sources' };

  const pick = (parkMaps || []).find((m) => {
    if (!m.imagePath) return false;
    if (m.confidence === 'low') return false;
    const abs = resolveBuilderPath(m.imagePath);
    return abs && existsSync(abs);
  });
  if (!pick && !opts.allowMissingFile) return { applied: 0, reason: 'no_local_image' };

  let applied = 0;
  for (const s of data.sources || []) {
    if (s.kind !== 'official_map') continue;
    if (s.image && !opts.force) continue;
    const pathToUse = pick?.imagePath
      || (opts.imagePath ? String(opts.imagePath) : null);
    if (!pathToUse) continue;
    s.image = pathToUse;
    if (pick?.mapKind) s.map_kind = pick.mapKind;
    applied += 1;
  }
  if (applied) writeJson(venueSidecar(venueId, 'sources.json'), data, true);
  return { applied, file, image: pick?.imagePath || opts.imagePath || null };
}

/**
 * Download a remote map image into the venue package maps/ folder.
 * Maintainer/CI opt-in — never invents content.
 */
export async function downloadParkMapImage(venueId, imageUrl, opts = {}) {
  if (!imageUrl) throw new Error('imageUrl required');
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'parkbound-venue-builder/1.0', Accept: 'image/*,application/pdf' },
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  });
  if (!res.ok) throw new Error(`${imageUrl} returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (() => {
    const u = imageUrl.toLowerCase();
    if (u.includes('.webp')) return 'webp';
    if (u.includes('.jpg') || u.includes('.jpeg')) return 'jpg';
    if (u.includes('.pdf')) return 'pdf';
    if (u.includes('.png')) return 'png';
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('jpeg')) return 'jpg';
    if (ct.includes('pdf')) return 'pdf';
    return 'png';
  })();
  const year = opts.year || new Date().getUTCFullYear();
  const name = opts.filename || `${year}-parkmap.${ext}`;
  const dir = path.join(venuePkgDir(venueId), 'maps');
  mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  writeFileSync(abs, buf);
  return {
    file: abs,
    rel: venueSidecarRel(venueId, path.join('maps', name)),
    bytes: buf.length,
  };
}

/** Whether sources.json asks for LLM park-map search (default true when open research on). */
export function parkMapSearchRequired(catalog) {
  const r = catalog?.research || {};
  if (r.llm_park_map_search === false) return false;
  if (r.llm_park_map_search === true) return true;
  return r.llm_open_research !== false;
}
