/**
 * Universal parks listing parser.
 */

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function parseUniversalListing(html) {
  const out = [];
  const seen = new Set();

  for (const hit of html.matchAll(
    /<(?:h2|h3)[^>]*class="[^"]*(?:card|attraction|ride)[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi,
  )) {
    const name = decodeHtml(hit[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, url: hit[1], categories: [], height: null });
  }

  if (!out.length) {
    for (const hit of html.matchAll(
      /data-attraction-name="([^"]+)"[^>]*data-attraction-url="([^"]+)"/gi,
    )) {
      const name = decodeHtml(hit[1]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[2], categories: [], height: null });
    }
  }

  return out;
}
