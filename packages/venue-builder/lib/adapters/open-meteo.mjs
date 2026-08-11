/**
 * Open-Meteo — weather station context for venue center (CC BY 4.0 data).
 * https://github.com/open-meteo/open-meteo
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

export const openMeteoCacheFile = (id) => cachePath(id, 'open-meteo');

export async function loadOpenMeteoData(venueId, { center, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'open-meteo');
  if (offline) return cached || { fetched: null, error: 'No cache on disk.' };
  if (!fetch) return cached || { fetched: null, error: 'No open-meteo cache on disk.' };
  if (!center?.lat) return { fetched: null, error: 'center_required' };

  const params = new URLSearchParams({
    latitude: String(center.lat),
    longitude: String(center.lng),
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    forecast_days: '2',
    timezone: 'auto',
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'open-meteo.com',
    license: 'CC BY 4.0',
    center,
    hourly: data.hourly,
    meta: {
      elevation: data.elevation,
      timezone: data.timezone,
    },
  };
  writeCache(venueId, 'open-meteo', out);
  return out;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'open-meteo', ok: false, error: 'venueId_required' };
  try {
    const data = await loadOpenMeteoData(id, { center: ctx.center, fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'open-meteo',
      ok: Boolean(data.hourly),
      meta: { timezone: data.meta?.timezone },
      artifacts: data.hourly ? [openMeteoCacheFile(id)] : [],
      data,
      error: data.error,
    };
  } catch (err) {
    return { adapterId: 'open-meteo', ok: false, error: err.message };
  }
}
