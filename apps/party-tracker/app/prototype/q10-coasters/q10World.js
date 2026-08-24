/* PROTOTYPE helper for Q10. Question: beautiful land, easily readable guest map. */

import { WAY_FLAGS } from '@party-tracker/shared/wayFlags.js';
import { normaliseRideName } from '@/lib/mapSymbols.js';

export const VENUE = 'kings-island';

/** Three jobs on one souvenir plate. Not palettes or themes. */
export const VARIANTS = [
  { key: 'A', name: 'Enter a land', thesis: 'The unit is a district. You walk into Rivertown.' },
  { key: 'B', name: 'Pick a ride', thesis: 'The unit is a destination. Lands stay the picture behind the catalog.' },
  { key: 'C', name: 'Walk from the gate', thesis: 'The unit is the course. Arrival land + destination land + midways.' },
];

/** Souvenir-strength district fills. Venue day tints are too pale to read as land. */
export const SOUVENIR_TINT = {
  'International Street': { fill: '#E8DCC0', stroke: '#C9B896', label: '#6B5A32' },
  'Coney Mall': { fill: '#F0C9B4', stroke: '#D4A088', label: '#7A3E2A' },
  Rivertown: { fill: '#C3DDB8', stroke: '#8FB37F', label: '#2F5C2F' },
  'Action Zone': { fill: '#C5D4E6', stroke: '#8FA4C4', label: '#2A4466' },
  'Area 72': { fill: '#D4C4E6', stroke: '#B09AC8', label: '#4A2A66' },
  'Planet Snoopy': { fill: '#F0E6A8', stroke: '#D4C46A', label: '#6B5E1E' },
  'Camp Snoopy': { fill: '#D4E6A8', stroke: '#B0C46A', label: '#4A5C1E' },
  'Adventure Port': { fill: '#B8E0D6', stroke: '#7FB8AC', label: '#1E5C54' },
  'Soak City': { fill: '#B4D8E8', stroke: '#7AB4C8', label: '#1E4A5C' },
  Oktoberfest: { fill: '#E8D4A0', stroke: '#C8B070', label: '#6B5420' },
};

export function souvenirTint(name) {
  return SOUVENIR_TINT[name] || { fill: '#E4E0D2', stroke: '#C9C2B0', label: '#5A5044' };
}

export function landLabelAt(land, anchors, project) {
  const a = anchors?.[land.name];
  if (Array.isArray(a) && a.length >= 2) return project(a[1], a[0]);
  return centroid(land.ring, project);
}

/** Push colliding land names apart so adjacent districts stay readable. */
export function spreadLandLabels(lands, anchors, project, min = 36) {
  const pts = lands.map((land) => {
    const at = landLabelAt(land, anchors, project);
    return { name: land.name, x: at?.[0], y: at?.[1] };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[j].x - pts[i].x;
      const dy = pts[j].y - pts[i].y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d >= min) continue;
      const push = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      pts[i].x -= nx * push;
      pts[i].y -= ny * push;
      pts[j].x += nx * push;
      pts[j].y += ny * push;
    }
  }
  return Object.fromEntries(pts.map((p) => [p.name, [p.x, p.y]]));
}

export function wrapLand(name) {
  const parts = String(name || '').split(' ');
  if (parts.length === 2 && name.length >= 12) return parts;
  return [name];
}

export function landNamesOf(world) {
  return (world?.lands || []).map((l) => l.name);
}

/** Honest Zone from the POI. Racer fragments tagged to the World sit on Coney Mall. */
export function rideZone(poi, landNames) {
  const names = landNames instanceof Set ? landNames : new Set(landNames || []);
  if (poi?.a && names.has(poi.a)) return poi.a;
  if (poi?.n && /racer/i.test(poi.n) && names.has('Coney Mall')) return 'Coney Mall';
  return null;
}

export function ridesInZone(coasters, zone, landNames) {
  return (coasters || []).filter((p) => rideZone(p, landNames) === zone);
}

/** Land nearest the main gate, from gate coords + land anchors. */
export function arrivalLandOf(world) {
  const gate = world?.gates?.find((g) => /main/i.test(g.n)) || world?.gates?.[0];
  const lands = world?.lands || [];
  if (!lands.length) return null;
  if (gate?.a && lands.some((l) => l.name === gate.a)) return gate.a;
  if (!gate) return lands[0].name;
  let best = lands[0].name;
  let bestD = Infinity;
  for (const land of lands) {
    const a = world.anchors?.[land.name];
    const lat = a ? a[0] : land.ring[0]?.[1];
    const lng = a ? a[1] : land.ring[0]?.[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = (lat - gate.lat) ** 2 + (lng - gate.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = land.name;
    }
  }
  return best;
}

export function landFocusBounds(land, pad = 0.22) {
  const b = boundsOf([[land.ring]]);
  const dx = (b.maxLng - b.minLng) || 0.002;
  const dy = (b.maxLat - b.minLat) || 0.002;
  return {
    minLng: b.minLng - dx * pad,
    maxLng: b.maxLng + dx * pad,
    minLat: b.minLat - dy * pad,
    maxLat: b.maxLat + dy * pad,
  };
}

export function ringHitsBounds(ring, b) {
  return (ring || []).some(([lng, lat]) => (
    lng >= b.minLng && lng <= b.maxLng && lat >= b.minLat && lat <= b.maxLat
  ));
}

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

/** Parked from the Google-LOD iteration. Unused by the current land plates. */
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
  const gates = (pois || []).filter((p) => p.c === 'gate' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

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

  return {
    tracks,
    coasters,
    park,
    lands,
    water,
    wood,
    grass,
    parking,
    buildings,
    service,
    paths,
    bounds,
    anchors: map.landAnchors || {},
    gates,
  };
}

/** Parked from the Google-LOD iteration. Unused by the current land plates. */
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
