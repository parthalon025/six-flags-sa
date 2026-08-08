'use client';

/**
 * The park-wide headline, and the only thing in the app that appears without
 * being asked for.
 *
 * It earns that by staying quiet: on a clear day it renders nothing at all. A
 * banner that is always there is a banner nobody reads on the one afternoon it
 * matters, so the bar for showing it is "something outdoors is affected", not
 * "we have a forecast".
 *
 * It also refuses to overstate itself. Everything here is worded as expectation
 * — "likely", "usually", "watch" — because a forecast is not an operations
 * feed, and a family that walks to a ride on our say-so and finds it running is
 * a smaller failure than one that skips a running ride because we said closed.
 */

import { CONDITIONS } from '@/lib/weather';
import { formatAge } from '@/lib/geo';

const TONE = {
  storm: 'bad',
  wind: 'warn',
  rain: 'warn',
  cold: 'warn',
  heat: 'warn',
  clear: 'ok',
};

const HEADLINE = {
  storm: 'Lightning — outdoor rides stop',
  wind: 'High wind — tall rides stop first',
  rain: 'Rain across the park',
  cold: 'Cold for the water park',
  heat: 'Extreme heat',
};

// One formatter for the whole app — see lib/geo.js. This screen used to carry
// its own, spelled differently from the roster's, on the same phone.
const ago = (at, now) => formatAge(Math.max(0, now - at));

export default function WeatherBanner({
  weather,
  summary,
  at,
  stale,
  offline,
  now = Date.now(),
  onOpen,
}) {
  const reported = summary?.reportedDown ?? 0;

  // Nothing known, or a clear sky with nothing reported down: say nothing. The
  // party's own reports are the exception — those are facts and always show,
  // even in sunshine, because a ride being down has nothing to do with weather.
  if (!weather && reported === 0) return null;
  const calm = !weather || weather.key === CONDITIONS.clear.key;
  if (calm && reported === 0) return null;

  const tone = calm ? 'warn' : TONE[weather.key] || 'warn';
  const headline = calm ? 'Rides reported down' : HEADLINE[weather.key] || weather.label;

  const counts = [];
  if (reported > 0) counts.push(`${reported} reported down`);
  if (!calm && summary?.atRisk > 0) counts.push(`${summary.atRisk} at risk`);

  return (
    <button
      type="button"
      className={`wxBanner ${tone}`}
      onClick={onOpen}
      aria-label={`${headline}. ${counts.join(', ')}. Open the rides list.`}
    >
      <span className="wxMain">
        <b>{headline}</b>
        {counts.length > 0 && <span className="wxCounts">{counts.join(' · ')}</span>}
      </span>
      <span className="wxWhy">
        {(weather?.reasons || []).slice(0, 2).join(' · ') || 'From your party'}
        {at && (stale || offline) ? ` · reading from ${ago(at, now)}` : ''}
      </span>
    </button>
  );
}
