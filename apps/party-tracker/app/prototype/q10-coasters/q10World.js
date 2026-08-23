/* PROTOTYPE helper for Q10. Locked ink is D (all rails).
 * New question: Google-style path LOD on that ink. */

import { WAY_FLAGS } from '@party-tracker/shared/wayFlags.js';
import { normaliseRideName } from '@/lib/mapSymbols.js';

export const VENUE = 'kings-island';

/** Zoom bands — D ink, Google road LOD. O city / S neighborhood / F walking. */
export const VARIANTS = [
  { key: 'O', name: 'Overview', thesis: 'Rails + long midways. Queues, stubs, and service wait.', band: 'overview' },
  { key: 'S', name: 'Streets', thesis: 'Neighborhood zoom. Local paths join the midways.', band: 'streets' },
  { key: 'F', name: 'Foot', thesis: 'Walking zoom. Minor paths, queues, steps, and service.', band: 'close' },
];

const QUEUE_NAME = /queue|line|entrance|exit|station/i;
const EARTH_M = 6371000;

function havM(a, b) {
  const to = (x) => (x * Math.PI) / 180;
  const dlat = to(b[1] - a[1]);
  const dlng = to(b[0] - a[0]);
  const s = Math.sin(dlat / 2) ** 2 + Math.cos(to(a[1])) * Math.cos(to(b[1])) * Math.sin(dlng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function ringLengthM(ring) {
  let m = 0;
  for (let i = 1; i < ring.length; i += 1) m += havM(ring[i - 1], ring[i]);
  return m;
}

/** Google analog without highway class on the shipped file.
 *  arterial ≈ major road · street ≈ residential · foot ≈ alley/footway. */
export function rankWalk(row, lengthM) {
  const flags = Number(row?.f) || 0;
  const name = typeof row?.n === 'string' ? row.n : '';
  if ((flags & WAY_FLAGS.STEPS) === WAY_FLAGS.STEPS) return 'foot';
  if (name && QUEUE_NAME.test(name)) return 'foot';
  if (lengthM < 25) return 'foot';
  if (lengthM >= 160) return 'arterial';
  return 'street';
}

export function walkVisible(rank, band) {
  if (rank === 'arterial') return true;
  if (rank === 'street') return band === 'streets' || band === 'close';
  if (rank === 'foot' || rank === 'service') return band === 'close';
  return false;
}

export function joinKey(name) {
  return normaliseRideName(name);
}

export function isOwner(trackName, primaryName) {
  const a = joinKey(trackName);
  const b = joinKey(primaryName);
  return Boolean(a && b && a === b);
}

export function ownersOf(tracks, primaryName) {
  return tracks.filter((t) => isOwner(t.name, primaryName));
}

export function ringsOf(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row : row?.r)).filter((r) => Array.isArray(r) && r.length > 1);
}

export function boundsOf(ringLists) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const rings of ringLists) {
    for (const ring of rings) {
      for (const pair of ring) {
        const lng = pair[0];
        const lat = pair[1];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

export function projector(bounds, width, height, pad = 28) {
  const { minLng, maxLng, minLat, maxLat } = bounds;
  const dx = maxLng - minLng || 1;
  const dy = maxLat - minLat || 1;
  return (lng, lat) => {
    const x = pad + ((lng - minLng) / dx) * (width - pad * 2);
    const y = pad + ((maxLat - lat) / dy) * (height - pad * 2);
    return [x, y];
  };
}

export function pathD(ring, project) {
  if (!ring?.length) return '';
  return ring
    .map((pair, i) => {
      const [x, y] = project(pair[0], pair[1]);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');
}

export function centroid(ring, project) {
  if (!ring?.length) return null;
  let x = 0;
  let y = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(ring.length / 12));
  for (let i = 0; i < ring.length; i += step) {
    const p = project(ring[i][0], ring[i][1]);
    x += p[0];
    y += p[1];
    n += 1;
  }
  return n ? [x / n, y / n] : null;
}

export function readWorld(map, pois) {
  const tracks = (map.coaster || []).map((row, i) => ({
    id: row?.i ?? `coaster-${i}`,
    name: typeof row?.n === 'string' ? row.n : '',
    ring: row?.r,
  })).filter((t) => Array.isArray(t.ring) && t.ring.length > 1);

  const coasters = (pois || []).filter((p) => p.c === 'coaster' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const park = ringsOf(map.park);
  const lands = (map.lands || []).map((row, i) => ({
    name: row?.n || `Land ${i}`,
    ring: row?.r,
  })).filter((l) => Array.isArray(l.ring));
  const water = ringsOf(map.water);
  const wood = ringsOf(map.wood);
  const grass = ringsOf(map.grass);
  const parking = ringsOf(map.parking);
  const buildings = ringsOf(map.building);
  const service = (map.service || []).map((row, i) => {
    const ring = row?.r;
    if (!Array.isArray(ring) || ring.length < 2) return null;
    return {
      id: row?.i ?? `service-${i}`,
      name: typeof row?.n === 'string' ? row.n : '',
      ring,
      lengthM: ringLengthM(ring),
      rank: 'service',
    };
  }).filter(Boolean);
  const paths = (map.path || []).map((row, i) => {
    const ring = row?.r;
    if (!Array.isArray(ring) || ring.length < 2) return null;
    const lengthM = ringLengthM(ring);
    return {
      id: row?.i ?? `path-${i}`,
      name: typeof row?.n === 'string' ? row.n : '',
      ring,
      flags: Number(row?.f) || 0,
      lengthM,
      rank: rankWalk(row, lengthM),
    };
  }).filter(Boolean);

  const bounds = boundsOf([
    park,
    lands.map((l) => l.ring),
    tracks.map((t) => t.ring),
    water,
  ]);

  return { tracks, coasters, park, lands, water, wood, grass, parking, buildings, service, paths, bounds };
}

export function bandOf(variantKey) {
  return VARIANTS.find((v) => v.key === variantKey)?.band || 'overview';
}

/** Crop the plate toward the primary, like pinching in Google Maps. */
export function bandBounds(full, focus, band) {
  if (band === 'overview' || !focus) return full;
  const t = band === 'streets' ? 0.44 : 0.2;
  const dx = (full.maxLng - full.minLng) * t;
  const dy = (full.maxLat - full.minLat) * t;
  return {
    minLng: focus.lng - dx / 2,
    maxLng: focus.lng + dx / 2,
    minLat: focus.lat - dy / 2,
    maxLat: focus.lat + dy / 2,
  };
}

export function lodStats(world, band) {
  const pathsOn = world.paths.filter((p) => walkVisible(p.rank, band));
  const serviceOn = world.service.filter((p) => walkVisible(p.rank, band));
  const count = (rank) => world.paths.filter((p) => p.rank === rank).length;
  return {
    band,
    railsOn: world.tracks.length,
    arterial: count('arterial'),
    street: count('street'),
    foot: count('foot'),
    pathsOn: pathsOn.length,
    serviceOn: serviceOn.length,
    serviceAll: world.service.length,
  };
}
