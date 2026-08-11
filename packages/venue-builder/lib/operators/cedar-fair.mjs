/**
 * Cedar Fair family listing parser (visit*.com, cedarpoint.com, knotts.com).
 */

function decodeHtml(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function parseCedarFairListing(html) {
  const out = [];
  const seen = new Set();

  /* Card grid with ride title links */
  for (const hit of html.matchAll(
    /<a[^>]+href="([^"]*\/rides-experiences\/[^"]+)"[^>]*>[\s\S]*?<(?:h2|h3|span)[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</gi,
  )) {
    const name = decodeHtml(hit[2]).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, url: hit[1], categories: [], height: null });
  }

  /* Simpler h3 + link pattern */
  if (!out.length) {
    for (const hit of html.matchAll(
      /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h3>/gi,
    )) {
      const name = decodeHtml(hit[2]).trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, url: hit[1], categories: [], height: null });
    }
  }

  return out;
}
