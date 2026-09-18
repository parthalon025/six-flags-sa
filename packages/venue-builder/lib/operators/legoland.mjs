/**
 * Legoland (Merlin) listing parser — legoland.com ride tiles.
 */

import { decodeHtml } from './generic.mjs';

/** Ride tile grid on things-to-do/rides listing pages. */
export function parseLegolandListing(html) {
  const out = [];
  const seen = new Set();

  for (const hit of html.matchAll(
    /<h3[^>]*class="[^"]*ride-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
  )) {
    const name = decodeHtml(hit[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, url: hit[1], categories: [], height: null });
  }

  /* Generic h3 + link on rides paths */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<h3[^>]*>\s*<a[^>]+href="([^"]*things-to-do\/rides\/[^"]+)"[^>]*>([^<]+)<\/a>/gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}
