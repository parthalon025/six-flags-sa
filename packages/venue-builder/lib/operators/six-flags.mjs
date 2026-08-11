/**
 * Six Flags official site listing parser.
 */

import { parseAttractionListing, categoryToHeight } from '../venue-official-site.mjs';

function decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Six Flags attraction cards — Elementor loop or card-title links. */
export function parseSixFlagsListing(html) {
  const generic = parseAttractionListing(html);
  if (generic.length) return generic;

  const out = [];
  const seen = new Set();
  const cardRe = /<(?:h2|h3)[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeHtml(m[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const chunk = html.slice(m.index, m.index + 2000);
    const cats = [...chunk.matchAll(/attraction-category-([a-z0-9_-]+)/gi)].map((x) => x[1]);
    out.push({ name, url: m[1], categories: [...new Set(cats)], height: categoryToHeight(cats) });
  }

  return out;
}
