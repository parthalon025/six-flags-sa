/**
 * SeaWorld Parks & Entertainment listing parser (seaworld.com, buschgardens.com, etc.).
 */

import { decodeHtml } from './generic.mjs';

/** Sitecore ride cards — card-title links under /rides/ paths. */
export function parseSeaWorldListing(html) {
  const out = [];
  const seen = new Set();

  for (const hit of html.matchAll(
    /<h3[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
  )) {
    const name = decodeHtml(hit[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, url: hit[1], categories: [], height: null });
  }

  /* Broader ride-card grid without card-title class */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<a[^>]+href="([^"]*\/rides\/[^"]+)"[^>]*>[\s\S]{0,120}?<(?:h2|h3)[^>]*>([^<]+)</gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  /* h3 + link inside ride-card article */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<article[^>]*class="[^"]*ride-card[^"]*"[\s\S]*?<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}
