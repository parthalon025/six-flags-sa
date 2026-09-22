/**
 * OSM opening_hours on venue POIs — validate at publish time, format at read time.
 *
 * Full OSM evaluation is out of scope; we never claim "open now" without proof.
 */

const MAX_LEN = 512;

/** @param {unknown} raw */
export function validateOpeningHoursRaw(raw) {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, errors: ['opening_hours must be a string'] };
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > MAX_LEN) return { ok: false, errors: ['opening_hours too long'] };
  return { ok: true, value: s };
}

/**
 * @param {string} raw
 * @returns {{ kind: 'always' } | { kind: 'osm', raw: string }}
 */
export function parseOpeningHours(raw) {
  const v = validateOpeningHoursRaw(raw);
  if (!v.ok || !v.value) return null;
  const norm = v.value.replace(/\s+/g, ' ').toLowerCase();
  if (norm === '24/7' || norm === '24 hours' || norm === 'open 24/7') return { kind: 'always' };
  return { kind: 'osm', raw: v.value };
}

/**
 * @param {{ oh?: string, c?: string } | null | undefined} poi
 * @param {{ now?: number }} [opts]
 * @returns {{ detail: string, planLine: string } | null}
 */
export function openingHoursForPoi(poi, opts = {}) {
  if (!poi?.oh) return null;
  const parsed = parseOpeningHours(poi.oh);
  if (!parsed) return null;

  const isShow = poi.c === 'show';
  const label = isShow ? 'Showtimes' : 'Hours';

  if (parsed.kind === 'always') {
    const detail = 'Open 24 hours';
    return { detail, planLine: isShow ? 'Showtimes · 24h' : 'Open 24h' };
  }

  const detail = `${label}: ${parsed.raw}`;
  const planLine = `${label} · ${compactPlanLine(parsed.raw)}`;
  return { detail, planLine };
}

/** One sub-line for the Plan card — keep the OSM string honest but shorter. */
function compactPlanLine(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length <= 48) return s;
  return `${s.slice(0, 45)}…`;
}
