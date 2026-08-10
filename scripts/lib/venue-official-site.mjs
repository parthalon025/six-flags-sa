/**
 * Official park website data for venue research.
 *
 * Reads URLs from `*.sources.json` (`official_site`, `official_map`), fetches
 * listing pages when asked, and compares what the park publishes against the
 * built bundle and heights sidecar. Results can be cached on disk so tests and
 * offline runs do not need the network.
 */

import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { nameSimilarity, pairSuggestions } from './venue-judge.mjs';
import { normaliseRideName } from '../../lib/mapSymbols.js';

const UA = 'six-flags-sa-venue-research/1.0 (+https://github.com/parthalon025/six-flags-sa)';

export const officialCacheFile = (id) => path.join(OVERRIDE_DIR, `${id}.official-cache.json`);

/** Decode a handful of HTML entities without a parser dependency. */
function decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Turn `attraction-category-over-48` into a readable height hint. */
export function categoryToHeight(categories = []) {
  const mins = [];
  for (const c of categories) {
    const m = /^over-(\d+)$/.exec(c);
    if (m) mins.push(Number(m[1]));
  }
  if (mins.length) return { min: Math.max(...mins), label: `Over ${Math.max(...mins)}"` };
  if (categories.includes('kid-friendly')) return { min: 0, label: 'Kid-friendly' };
  if (categories.includes('fun-for-all')) return { min: 0, label: 'Fun for all' };
  return null;
}

/**
 * Parse a WordPress/Elementor attractions listing page.
 *
 * Expects loop cards with `type-attraction` and `attraction-category-*` classes.
 */
export function parseAttractionListing(html) {
  const text = String(html || '');
  const out = [];
  const itemRe = /<div[^>]*class="[^"]*e-loop-item[^"]*type-attraction[^"]*"[^>]*>/gi;
  let m;
  while ((m = itemRe.exec(text)) !== null) {
    const tag = m[0];
    const chunk = text.slice(m.index, m.index + 4000);
    const categories = [...tag.matchAll(/attraction-category-([a-z0-9_-]+)/gi)].map((x) => x[1]);
    const title = chunk.match(
      /<h1[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h1>/i,
    );
    if (!title) continue;
    const name = decodeHtml(title[2]).trim();
    if (!name || name === 'WaterPark') continue;
    const height = categoryToHeight(categories);
    out.push({
      name,
      url: title[1],
      categories: [...new Set(categories)],
      height,
    });
  }

  /* Fallback: linked attraction titles without loop structure. */
  if (!out.length) {
    const seen = new Set();
    for (const hit of text.matchAll(
      /<h1[^>]*>\s*<a href="(https?:\/\/[^"]+\/attraction\/[^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h1>/gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}

/** Extract height/weight prose from an attraction detail page. */
export function parseAttractionDetail(html) {
  const text = decodeHtml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const out = { min: null, max: null, weightLb: null, notes: [] };

  const min = text.match(/minimum height(?: requirement)? of (\d+)\s*inch/i);
  if (min) out.min = Number(min[1]);

  const minAlt = text.match(/(\d+)\s*inch(?:es)?\s+(?:minimum|min\.?)\s+(?:to|height)/i);
  if (out.min == null && minAlt) out.min = Number(minAlt[1]);

  const over = text.match(/Over\s+(\d+)\s*(?:&#8243;|"|inch)/i);
  if (out.min == null && over) out.min = Number(over[1]);

  const maxW = text.match(/maximum weight(?: limit)? of (\d+)\s*lb/i);
  if (maxW) out.weightLb = Number(maxW[1]);

  const badge = text.match(/Over\s+(\d+)\s*(?:&#8243;|"|inch)\s+to\s+Ride/i);
  if (out.min == null && badge) out.min = Number(badge[1]);

  if (text.match(/fun for all|no height requirement/i)) out.min = out.min ?? 0;
  if (text.match(/kid[- ]friendly/i)) out.notes.push('Kid-friendly');
  return out;
}

export async function fetchUrl(url, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

/** Official URLs from the source catalogue. */
export function officialUrls(catalog) {
  const sources = catalog?.sources || [];
  return {
    site: sources.filter((s) => s.kind === 'official_site' && s.url).map((s) => ({ ...s })),
    map: sources.filter((s) => s.kind === 'official_map' && s.url).map((s) => ({ ...s })),
  };
}

/**
 * Load or fetch official attraction data.
 *
 * @param {string} id venue id
 * @param {object} catalog sources catalogue
 * @param {{ fetch?: boolean, offline?: boolean, details?: boolean }} opts
 */
export async function loadOfficialData(id, catalog, opts = {}) {
  const cachePath = officialCacheFile(id);
  const cached = readJson(cachePath);
  if (opts.offline) {
    return cached || { fetched: null, attractions: [], pages: [], error: 'No cache on disk.' };
  }
  if (!opts.fetch && cached?.attractions?.length) return cached;

  const urls = officialUrls(catalog);
  if (!urls.site.length) {
    return cached || { fetched: null, attractions: [], pages: [], error: 'No official_site URL in sources catalogue.' };
  }

  const pages = [];
  const attractions = [];
  const errors = [];

  for (const src of urls.site) {
    try {
      const html = await fetchUrl(src.url);
      pages.push({ id: src.id, url: src.url, kind: 'official_site' });
      const parsed = parseAttractionListing(html);
      for (const row of parsed) {
        attractions.push({ ...row, source: src.id, listing: src.url });
      }
    } catch (err) {
      errors.push(`${src.url}: ${err.message}`);
    }
  }

  for (const src of urls.map) {
    pages.push({ id: src.id, url: src.url, kind: 'official_map', image: src.image || null });
  }

  /* Optional detail pages for height prose — capped to avoid hammering the site. */
  if (opts.details) {
    const cap = 24;
    let n = 0;
    for (const row of attractions) {
      if (!row.url || row.detail) continue;
      if (n >= cap) break;
      try {
        const html = await fetchUrl(row.url);
        row.detail = parseAttractionDetail(html);
        if (row.detail.min != null && !row.height) {
          row.height = { min: row.detail.min, label: `Min ${row.detail.min}"` };
        }
        n += 1;
      } catch {
        // Detail fetch is best-effort.
      }
    }
  }

  const byName = new Map();
  for (const row of attractions) {
    const key = normaliseRideName(row.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, row);
  }

  const result = {
    version: 1,
    venue: id,
    fetched: new Date().toISOString().slice(0, 10),
    pages,
    attractions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    errors,
  };

  if (opts.fetch || result.attractions.length) {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(result, null, 2)}\n`);
  }

  return result;
}

const RIDE = (p) => p.c === 'coaster' || p.c === 'ride';

/**
 * Compare official site data to the bundle and heights sidecar.
 */
export function compareOfficialToBundle({ official, pois = [], heightsSidecar = null } = {}) {
  const siteNames = (official?.attractions || []).map((a) => a.name);
  const bundleRides = pois.filter(RIDE).map((p) => p.n);
  const bundleAll = pois.map((p) => p.n);

  const onlyOnSite = [];
  const onlyInBundle = [];
  const matched = [];

  for (const row of official?.attractions || []) {
    const pairs = pairSuggestions([row.name], bundleRides.length ? bundleRides : bundleAll, { floor: 0.72, limit: 1 });
    if (pairs.length) {
      matched.push({ site: row.name, bundle: pairs[0].right, score: pairs[0].score, official: row });
    } else {
      onlyOnSite.push(row);
    }
  }

  for (const name of bundleRides) {
    const pairs = pairSuggestions([name], siteNames, { floor: 0.72, limit: 1 });
    if (!pairs.length) onlyInBundle.push(name);
  }

  const heightMismatches = [];
  const rules = heightsSidecar?.rules || {};
  for (const { site, bundle, official: row } of matched) {
    const rule = rules[bundle] || rules[site] || Object.entries(rules).find(([k]) => nameSimilarity(k, site) >= 0.9)?.[1];
    const published = rule?.h?.min;
    const fromSite = row.height?.min ?? row.detail?.min;
    if (fromSite == null || published == null) continue;
    if (fromSite !== published) {
      heightMismatches.push({
        name: bundle,
        siteName: site,
        bundleMin: published,
        siteMin: fromSite,
        siteLabel: row.height?.label || null,
        url: row.url,
      });
    }
  }

  return {
    siteCount: siteNames.length,
    bundleRideCount: bundleRides.length,
    matched: matched.length,
    onlyOnSite: onlyOnSite.map((r) => r.name).sort(),
    onlyInBundle: onlyInBundle.sort(),
    heightMismatches,
    attractions: official?.attractions || [],
    pages: official?.pages || [],
    fetched: official?.fetched || null,
    errors: official?.errors || [],
  };
}

/** Read cached HTML from a fixture path (tests). */
export function loadFixtureHtml(file) {
  return readFileSync(file, 'utf8');
}
