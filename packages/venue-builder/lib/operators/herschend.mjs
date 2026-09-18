/**
 * Herschend Family Entertainment listing parser (Dollywood, Silver Dollar City, etc.).
 */

import { decodeHtml } from './generic.mjs';

/** Attraction cards with rides-attractions detail links. */
export function parseHerschendListing(html) {
  const out = [];
  const seen = new Set();

  for (const hit of html.matchAll(
    /<h3[^>]*>\s*<a[^>]+href="([^"]*(?:rides-attractions|attractions)\/[^"]+)"[^>]*>([^<]+)<\/a>/gi,
  )) {
    const name = decodeHtml(hit[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, url: hit[1], categories: [], height: null });
  }

  /* Card wrapper variant */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<div[^>]*class="[^"]*attraction-card[^"]*"[\s\S]*?<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}
