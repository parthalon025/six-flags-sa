/**
 * The one thing in this app that reaches outside itself.
 *
 * Everything else here is local-first by construction — a party is hosted by a
 * phone, the map is a bundled file, nothing needs an account. The sky is the
 * exception: no amount of peer-to-peer cleverness tells you there is lightning
 * eight miles out, so this route asks somebody who knows.
 *
 * Open-Meteo, because it needs no key, no account and no environment variable,
 * which keeps the install story ("there is nothing to configure") true. If it
 * is unreachable — no signal, a blocked egress, the service down — this returns
 * 503 with a shaped body and the client falls back to its last reading. The
 * feature degrades to the app that existed before it.
 *
 * The proxy is not decoration. It keeps the upstream host out of the browser's
 * connection list, gives one shared cache instead of one per phone in the
 * party, and means a park full of guests on the same wifi makes one request a
 * few times an hour rather than hundreds.
 *
 * That last claim is only true because the response says so. This is the one
 * route in the app whose body has no party in it, so it is the one route a
 * shared cache may hold — and on a serverless host it has to be, because the
 * in-process map below belongs to a single instance and a deployment under load
 * is a dozen of them, each with its own empty copy. `Cache-Control` is what
 * turns "one request per instance per ten minutes" into one request per region.
 * The map stays as a second tier: it still absorbs the requests a cold instance
 * serves before the edge has anything to hand back.
 */

import { badRequest, json, jsonCached } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** The upstream call is already bounded at TIMEOUT_MS; this bounds the rest. */
export const maxDuration = 15;

const UPSTREAM = 'https://api.open-meteo.com/v1/forecast';

/**
 * Weather moves slower than anyone refreshes a phone. Ten minutes is inside the
 * update cadence of every forecast model in use and far outside the interval a
 * bored guest can generate by pulling to refresh.
 */
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;

/**
 * How long a shared cache may serve this, in seconds, and how long past that it
 * may serve a stale copy while it refreshes behind the request. Kept equal to
 * TTL_MS so the edge and the in-process map expire together rather than one
 * quietly extending the other.
 */
const SHARED_MAX_AGE_S = Math.round(TTL_MS / 1000);
const STALE_WHILE_REVALIDATE_S = 60 * 60;

/** A forecast the CDN, and only the CDN, may reuse. Never a party body. */
const cacheable = (body) =>
  jsonCached(body, { sMaxAge: SHARED_MAX_AGE_S, swr: STALE_WHILE_REVALIDATE_S });

/** Coordinates are rounded before they are used as a key: one park, one entry. */
const KEY_PRECISION = 2;

/** Process-local second tier, behind the shared cache above. */
const cache = new Map();

const FIELDS = {
  current: [
    'temperature_2m',
    'apparent_temperature',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'wind_gusts_10m',
    'is_day',
  ].join(','),
  hourly: ['precipitation_probability', 'cape'].join(','),
};

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return badRequest('lat and lng are required');
  }

  const key = `${lat.toFixed(KEY_PRECISION)},${lng.toFixed(KEY_PRECISION)}`;
  const hit = cache.get(key);
  const at = Date.now();
  if (hit && at - hit.at < TTL_MS) return cacheable({ ...hit.body, cached: true });

  const url =
    `${UPSTREAM}?latitude=${lat}&longitude=${lng}` +
    `&current=${FIELDS.current}&hourly=${FIELDS.hourly}&forecast_hours=3` +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto';

  let upstream;
  try {
    // An abort rather than an open wait: a forecast that arrives after the
    // family has already walked to the ride is not worth the held connection.
    upstream = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return stale(hit) ?? json({ error: 'Weather unavailable', observed: null }, 503);
  }

  if (!upstream.ok) return stale(hit) ?? json({ error: 'Weather unavailable', observed: null }, 503);

  let raw;
  try {
    raw = await upstream.json();
  } catch {
    return stale(hit) ?? json({ error: 'Weather unreadable', observed: null }, 503);
  }

  const body = shape(raw, at);
  cache.set(key, { at, body });
  // One entry per park and a process that restarts on deploy, but an unbounded
  // map fed by a query parameter is a leak with a public tap on it.
  if (cache.size > 64) cache.delete(cache.keys().next().value);

  return cacheable(body);
}

/**
 * Serving a reading from an hour ago beats serving nothing: the client is told
 * how old it is and can say so. Only used when the upstream call failed.
 *
 * Deliberately not `cacheable`. A failure is a moment, not a forecast, and
 * pinning one into a shared cache for ten minutes would outlast the outage that
 * caused it and take the recovery with it.
 */
function stale(hit) {
  if (!hit) return null;
  return json({ ...hit.body, cached: true, stale: true });
}

/**
 * Flatten the upstream shape into the handful of fields classifyWeather reads.
 *
 * Deliberately lossy. Keeping the provider's full response would leak its
 * schema into the client and into the offline cache, and the next provider
 * would break both; this shape is ours.
 */
function shape(raw, at) {
  const c = raw?.current ?? {};
  const h = raw?.hourly ?? {};

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  // The next few hours, not this instant: a family deciding whether to walk
  // across the park cares about the storm that is coming, not the one clear
  // minute they are standing in.
  const peak = (series) => {
    const vals = (Array.isArray(series) ? series : []).slice(0, 3).map(num).filter((v) => v != null);
    return vals.length ? Math.max(...vals) : null;
  };

  return {
    observed: {
      code: num(c.weather_code),
      tempF: num(c.temperature_2m),
      feelsF: num(c.apparent_temperature),
      precipIn: num(c.precipitation),
      windMph: num(c.wind_speed_10m),
      gustMph: num(c.wind_gusts_10m),
      isDay: c.is_day === 1 || c.is_day === true,
      precipChance: peak(h.precipitation_probability),
      // Convective potential: the number that says a clear sky is about to stop
      // being one. classifyWeather only trusts it alongside a rain chance.
      cape: peak(h.cape),
    },
    at,
    source: 'open-meteo',
  };
}
