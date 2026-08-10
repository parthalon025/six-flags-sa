'use client';

/**
 * The sky, as far as this phone can tell.
 *
 * Two rules shape everything here, and both come from the same fact: the moment
 * this feature matters most is the moment the network is worst. A park full of
 * people sheltering under the same roof is a park where nothing loads.
 *
 *   1. The last good reading is kept in localStorage and returned immediately
 *      on mount, before any request goes out. A ten-minute-old forecast shown
 *      instantly beats a fresh one that arrives after the family has decided.
 *   2. A failed fetch never clears what is already known. `stale` goes true,
 *      the UI says when the reading is from, and nothing disappears.
 *
 * The result is a hook that has an answer offline, on a dead cell, and on the
 * first paint — and degrades to "no banner" rather than to a spinner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyWeather } from '@/lib/weather';

const STORE_KEY = 'ki-weather';
/** Matches the route's own cache: asking more often just spends battery. */
const REFRESH_MS = 10 * 60 * 1000;
/** Past this, a cached reading is too old to colour a ride and is dropped. */
const EXPIRY_MS = 3 * 60 * 60 * 1000;
/** A failed poll backs off rather than hammering a radio that is already busy. */
const RETRY_MS = 60 * 1000;

function readCache() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.observed || !Number.isFinite(saved.at)) return null;
    if (Date.now() - saved.at > EXPIRY_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Private mode, a full quota, a browser that has opinions. The hook works
    // without the cache; it just loses the head start on the next launch.
  }
}

/**
 * @param center {{lat, lng}|null} the park's middle. Null disables the hook.
 * @param enabled pass false to keep the radio quiet entirely.
 *
 * @returns {{ weather, observed, at, stale, offline, error, refresh }}
 *   `weather` is the classifyWeather verdict, ready for outlookFor/statusFor,
 *   or null when nothing is known — which every caller renders as no banner.
 */
export default function useWeather(center, enabled = true) {
  const [reading, setReading] = useState(null); // { observed, at }
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef(null);

  const lat = center?.lat;
  const lng = center?.lng;

  const fetchNow = useCallback(async () => {
    if (!enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 503 ? 'Weather unavailable' : `HTTP ${res.status}`);
      const body = await res.json();
      if (!body?.observed) throw new Error('Weather unavailable');
      const next = { observed: body.observed, at: Number(body.at) || Date.now() };
      setReading(next);
      setError(null);
      setOffline(false);
      writeCache(next);
      return true;
    } catch (err) {
      // Deliberately does not touch `reading`: losing signal must not blank a
      // banner that is still broadly true.
      setError(String(err?.message || err));
      setOffline(true);
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [enabled, lat, lng]);

  // The cached reading, before the network is asked anything.
  useEffect(() => {
    const saved = readCache();
    if (saved) setReading({ observed: saved.observed, at: saved.at });
  }, []);

  useEffect(() => {
    if (!enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    let stopped = false;

    const tick = async () => {
      const ok = await fetchNow();
      if (stopped) return;
      // A poll that failed is retried sooner than one that worked, because the
      // usual cause is a dead minute of signal rather than a dead service.
      timer.current = setTimeout(tick, ok ? REFRESH_MS : RETRY_MS);
    };
    tick();

    // Coming back to the app after an hour in a queue should not show an hour
    // of nothing, and a phone that regains signal should not wait out the
    // interval to notice.
    const wake = () => {
      if (document.visibilityState === 'visible') fetchNow();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);

    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [enabled, lat, lng, fetchNow]);

  const age = reading ? Date.now() - reading.at : null;

  return {
    weather: reading ? classifyWeather(reading.observed) : null,
    observed: reading?.observed ?? null,
    at: reading?.at ?? null,
    // "Old enough to say so", not "old enough to ignore" — the hook keeps
    // serving it either way and lets the banner do the hedging.
    stale: age != null && age > REFRESH_MS * 2,
    offline,
    error,
    refresh: fetchNow,
  };
}
