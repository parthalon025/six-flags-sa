/**
 * Disney parks listing parser — JSON-LD ItemList when present, DOM fallback.
 */

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function parseDisneyListing(html) {
  const out = [];
  const seen = new Set();

  /* JSON-LD attraction lists */
  for (const block of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(block[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const node of items) {
        const list = node.itemListElement || node['@graph']?.flatMap((g) => g.itemListElement || []) || [];
        for (const el of list) {
          const item = el.item || el;
          const name = item?.name || el?.name;
          const url = item?.url || el?.url;
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          out.push({ name: decodeHtml(name), url: url || null, categories: [], height: null });
        }
      }
    } catch { /* skip malformed */ }
  }

  /* DOM: attraction card titles */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<a[^>]+href="([^"]*attractions[^"]*)"[^>]*>[\s\S]{0,200}?<(?:span|h2|h3)[^>]*>([^<]{2,80})</gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}
