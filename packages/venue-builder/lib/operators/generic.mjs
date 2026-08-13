/**
 * Generic official-site listing parser (WordPress/Elementor attraction cards).
 *
 * Lives here so operator adapters can reuse it without importing
 * `venue-official-site.mjs` (that file dispatches *to* operators).
 */

/** Decode a handful of HTML entities without a parser dependency. */
export function decodeHtml(s) {
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
