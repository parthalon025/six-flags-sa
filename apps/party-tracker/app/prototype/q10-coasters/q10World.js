/* PROTOTYPE helper for Q10 park-wide coaster ink.
 * Question: which rails are on at first paint? */

import { normaliseRideName } from '@/lib/mapSymbols.js';

export const VENUE = 'kings-island';

export const VARIANTS = [
  { key: 'A', name: 'Names only', thesis: 'Stars are destinations. Rails wait for a pinch.' },
  { key: 'B', name: 'One rail', thesis: 'One owner rail. Everyone else is a name.' },
  { key: 'C', name: 'Named + owner', thesis: 'Named rails autograph the park. Primary is loud.' },
  { key: 'D', name: 'Every line', thesis: 'All rails, unnamed fragments, and service. The hairball.' },
];

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
  const service = ringsOf(map.service);
  const paths = ringsOf(map.path);

  const bounds = boundsOf([
    park,
    lands.map((l) => l.ring),
    tracks.map((t) => t.ring),
    water,
  ]);

  return { tracks, coasters, park, lands, water, wood, service, paths, bounds };
}

export function inkStats(world, variant, primaryName) {
  const named = world.tracks.filter((t) => t.name);
  const unnamed = world.tracks.filter((t) => !t.name);
  const owners = ownersOf(world.tracks, primaryName);
  const showNamed = variant === 'C';
  const showOwner = variant === 'B' || variant === 'C';
  const showUnnamed = variant === 'D';
  const showService = variant === 'D';
  const showPaths = variant === 'D';
  return {
    variant,
    primary: primaryName,
    join: joinKey(primaryName),
    ownerFragments: owners.length,
    namedOn: variant === 'D' ? named.length : showNamed ? named.length : showOwner ? owners.length : 0,
    unnamedOn: showUnnamed ? unnamed.length : 0,
    serviceOn: showService ? world.service.length : 0,
    pathsOn: showPaths ? world.paths.length : 0,
    namesOn: world.coasters.length,
  };
}
