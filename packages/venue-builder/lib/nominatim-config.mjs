/**
 * Shared Nominatim geocoder endpoint for builder CLIs (#412).
 *
 * Override with VENUE_NOMINATIM_URL (preferred) or NOMINATIM_URL. Values may be
 * either a host base (`http://localhost:8080`) or a full `/search` endpoint.
 */

export const DEFAULT_NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

export function resolveNominatimSearchUrl(env = process.env) {
  const raw = env.VENUE_NOMINATIM_URL || env.NOMINATIM_URL;
  if (!raw) return DEFAULT_NOMINATIM_SEARCH_URL;
  const trimmed = String(raw).trim().replace(/\/$/, '');
  if (trimmed.endsWith('/search')) return trimmed;
  return `${trimmed}/search`;
}

export function buildNominatimSearchRequestUrl(query, opts = {}) {
  const base = opts.searchUrl ?? resolveNominatimSearchUrl(opts.env);
  const suffix = opts.extratags ? '&extratags=1' : '';
  return `${base}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=0${suffix}`;
}

export async function fetchNominatimHits(query, opts = {}) {
  const url = buildNominatimSearchRequestUrl(query, opts);
  const res = await (opts.fetch ?? fetch)(url, {
    headers: { 'User-Agent': opts.userAgent, 'Accept-Language': 'en', ...opts.headers },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}
