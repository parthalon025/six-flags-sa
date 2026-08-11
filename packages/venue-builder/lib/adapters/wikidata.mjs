/**
 * Wikidata adapter — entity resolution, aliases, infobox metadata.
 * Uses the Wikidata API (CC0 data).
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

export const wikidataCacheFile = (id) => cachePath(id, 'wikidata');

async function searchEntity(label, { lat, lng } = {}) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    language: 'en',
    type: 'item',
    search: label,
    limit: '5',
  });
  const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
  const hits = data.search || [];
  if (!hits.length) return null;
  if (lat == null || lng == null) return hits[0];

  let best = hits[0];
  let bestD = Infinity;
  for (const hit of hits) {
    const entity = await fetchEntity(hit.id);
    const coord = entity?.coordinates;
    if (!coord) continue;
    const d = Math.hypot((coord.lat - lat) * 110540, (coord.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180));
    if (d < bestD) {
      bestD = d;
      best = hit;
    }
  }
  return best;
}

async function fetchEntity(qid) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: qid,
    props: 'labels|claims|sitelinks',
    languages: 'en',
  });
  const data = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`);
  const entity = data.entities?.[qid];
  if (!entity) return null;

  const label = entity.labels?.en?.value || null;
  const website = claimString(entity, 'P856');
  const coords = claimCoordinate(entity, 'P625');
  const inception = claimTime(entity, 'P571');
  const operator = claimEntityLabel(entity, 'P137');

  return {
    qid,
    label,
    website,
    coordinates: coords,
    inception,
    operator,
    wikipedia: entity.sitelinks?.enwiki?.url || null,
  };
}

function claimString(entity, pid) {
  const c = entity.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value;
  return typeof c === 'string' ? c : null;
}

function claimCoordinate(entity, pid) {
  const c = entity.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value;
  if (!c || c.latitude == null) return null;
  return { lat: c.latitude, lng: c.longitude };
}

function claimTime(entity, pid) {
  const c = entity.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value?.time;
  return c ? c.replace(/^\+/, '').slice(0, 10) : null;
}

async function claimEntityLabel(entity, pid) {
  const id = entity.claims?.[pid]?.[0]?.mainsnak?.datavalue?.value?.id;
  if (!id) return null;
  const sub = await fetchEntity(id);
  return sub?.label || id;
}

export async function loadWikidataData(venueId, { venueName, center, qid, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'wikidata');
  if (offline) return cached || { fetched: null, error: 'No cache on disk.' };
  if (!fetch) return cached || { fetched: null, error: 'No Wikidata cache on disk.' };

  const label = venueName || venueId;
  let hit = null;
  if (qid) {
    const entity = await fetchEntity(qid);
    if (entity) hit = { id: qid, label: entity.label };
  }
  if (!hit) hit = await searchEntity(label, center || {});
  if (!hit) {
    return cached || { fetched: null, error: `No Wikidata match for "${label}".` };
  }

  const entity = await fetchEntity(hit.id);
  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'wikidata.org',
    license: 'CC0',
    search: label,
    entity,
  };
  writeCache(venueId, 'wikidata', out);
  return out;
}

/** Emit evidence claims for venue-level metadata (no coordinate publish). */
export function wikidataClaims(data) {
  const e = data?.entity;
  if (!e) return [];
  const claims = [];
  const date = data.fetched || new Date().toISOString().slice(0, 10);
  if (e.website) {
    claims.push({ source: 'wikidata', kind: 'metadata', date, note: `website: ${e.website}`, uri: `https://www.wikidata.org/wiki/${e.qid}` });
  }
  if (e.coordinates) {
    claims.push({
      source: 'wikidata',
      kind: 'metadata',
      at: e.coordinates,
      date,
      note: `Wikidata centroid for ${e.label}`,
      uri: `https://www.wikidata.org/wiki/${e.qid}`,
    });
  }
  return claims;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'wikidata', ok: false, error: 'venueId_required' };
  try {
    const data = await loadWikidataData(id, {
      venueName: ctx.venueName,
      center: ctx.center,
      qid: ctx.qid,
      fetch: ctx.fetch ?? true,
      offline: ctx.offline,
    });
    return {
      adapterId: 'wikidata',
      ok: Boolean(data.entity),
      claims: wikidataClaims(data),
      meta: { qid: data.entity?.qid },
      artifacts: data.entity ? [wikidataCacheFile(id)] : [],
      data,
      error: data.error,
    };
  } catch (err) {
    return { adapterId: 'wikidata', ok: false, error: err.message };
  }
}
