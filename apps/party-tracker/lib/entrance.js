/**
 * How the app reads queue-entrance quality on a ride POI.
 *
 * Published entrances carry fused confidence in pois.json; the sidecar never
 * ships to the phone. This module is the one place that turns `e[0].src` into
 * words a visitor understands.
 */

const RANK = { unknown: 0, low: 1, moderate: 2, high: 3, very_high: 4 };

/** Pick the best published entrance on a place. */
export function bestEntrance(poi) {
  if (!poi?.e?.length) return null;
  const located = poi.e.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lng));
  if (!located.length) return null;
  return located.reduce((best, g) => {
    const band = g.src?.confidence || 'unknown';
    const score = RANK[band] ?? 0;
    const bestScore = RANK[best.src?.confidence || 'unknown'] ?? 0;
    return score > bestScore ? g : best;
  }, located[0]);
}

export function entranceBand(entrance) {
  return entrance?.src?.confidence || 'unknown';
}

export function atLeastBand(band, floor) {
  return (RANK[band] ?? 0) >= (RANK[floor] ?? 0);
}

/**
 * @returns {{ confirmed: boolean, band: string, label: string, hint: string, sources: string[] }}
 */
export function entranceMeta(poi) {
  const gate = bestEntrance(poi);
  if (!gate) {
    return {
      confirmed: false,
      band: 'unknown',
      label: 'Ride area',
      hint: 'Queue entrance not confirmed — walking to the ride on the map.',
      sources: [],
    };
  }
  const band = entranceBand(gate);
  const sources = gate.src?.sources || [];
  if (atLeastBand(band, 'moderate')) {
    return {
      confirmed: true,
      band,
      label: 'Queue entrance',
      hint: sources.length
        ? `Walking to the queue entrance (${sources.join(', ')}).`
        : 'Walking to the surveyed queue entrance.',
      sources,
    };
  }
  if (atLeastBand(band, 'low')) {
    return {
      confirmed: false,
      band,
      label: 'Approximate queue area',
      hint: 'Entrance position is approximate — follow signs on the midway.',
      sources,
    };
  }
  return {
    confirmed: false,
    band,
    label: 'Ride area',
    hint: 'Queue entrance not confirmed — walking to the ride on the map.',
    sources,
  };
}

/** Short line for route preview / nav banner. */
export function entranceLine(poi) {
  const m = entranceMeta(poi);
  return m.confirmed ? 'Queue entrance' : m.label;
}
