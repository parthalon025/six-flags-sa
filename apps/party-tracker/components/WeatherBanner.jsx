'use client';

/**
 * The weather, disclosed in three steps.
 *
 * It used to be one step: a full-width banner that appeared when something was
 * wrong and rendered nothing at all otherwise. That was the right instinct —
 * a banner that is always there is a banner nobody reads on the one afternoon
 * it matters — carried one step too far. Rendering nothing on a clear day meant
 * the app had a forecast and no way to ask it for one, so "is that cloud going
 * to shut the coasters" had no answer anywhere on the screen.
 *
 * So:
 *
 *   1. a chip in the top-left corner, whenever there is a reading at all. A
 *      glyph and the temperature. It is the size of the buttons opposite it
 *      and it stays that size on a fine day.
 *   2. tap it and it opens: the headline, what is affected, what the reading
 *      was based on, and how old it is.
 *   3. it opens itself when the weather is actually stopping rides, or when
 *      somebody in the party has reported something down. That is the case the
 *      original banner existed for, and it still behaves exactly as it did.
 *
 * It also refuses to overstate itself. Everything here is worded as expectation
 * — "likely", "usually", "watch" — because a forecast is not an operations
 * feed, and a family that walks to a ride on our say-so and finds it running is
 * a smaller failure than one that skips a running ride because we said closed.
 */

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
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

/** One glyph per condition, at the size a 44px target gives it. */
const GLYPH = {
  storm: 'bolt.fill',
  wind: 'wind',
  rain: 'cloud.rain.fill',
  cold: 'snowflake',
  heat: 'thermometer.high',
  clear: 'sun.max.fill',
};

/**
 * What opens the card on its own. Rain and heat change the shape of a day;
 * wind and lightning stop rides, and being told that late is the failure this
 * whole feature exists to avoid.
 */
const INSISTS = new Set(['storm', 'wind']);

// One formatter for the whole app — see lib/geo.js. This screen used to carry
// its own, spelled differently from the roster's, on the same phone.
const ago = (at, now) => formatAge(Math.max(0, now - at));

/**
 * What the reading actually says, for the fine day the classifier has nothing
 * to complain about.
 *
 * The card's second line is normally the reasons the condition was raised, and
 * a clear sky raises none — which used to leave it falling through to "From
 * your party", a sentence about a source rather than about the weather and
 * plainly wrong under the word "Clear". So on a quiet day it reads the numbers
 * out instead, which is the whole reason somebody opened it.
 */
function plainReading(obs) {
  if (!obs) return '';
  const bits = [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const feels = num(obs.feelsF);
  const temp = num(obs.tempF);
  if (feels != null && temp != null && Math.abs(feels - temp) >= 4) {
    bits.push(`Feels like ${Math.round(feels)}°`);
  }
  const gust = num(obs.gustMph) ?? num(obs.windMph);
  if (gust != null) bits.push(gust < 8 ? 'Barely any wind' : `Wind ${Math.round(gust)} mph`);
  const chance = num(obs.precipChance);
  if (chance != null) {
    bits.push(chance < 15 ? 'No rain due' : `${Math.round(chance)}% chance of rain`);
  }
  return bits.join(' · ');
}

export default function WeatherBanner({
  weather,
  observed,
  summary,
  at,
  stale,
  offline,
  /* The clock is handed in rather than read here, so the whole screen agrees
     on what "12 min ago" means within one render — and so this component stays
     a pure function of its props. */
  now,
  onOpen,
}) {
  const reported = summary?.reportedDown ?? 0;
  const calm = !weather || weather.key === CONDITIONS.clear.key;
  const key = weather?.key || 'clear';
  const urgent = INSISTS.has(key) || reported > 0;

  const [open, setOpen] = useState(false);
  /* The card opens itself when the weather turns, and does not shut itself
     when it passes: somebody who has read it and collapsed it has dealt with
     it, and reopening under their thumb every time the gusts tick over the
     threshold is how a useful thing becomes one people learn to dismiss. */
  useEffect(() => {
    if (urgent) setOpen(true);
  }, [urgent]);

  // Nothing known at all: no chip, because a chip that says nothing is furniture.
  if (!weather && reported === 0) return null;

  const tone = calm ? (reported > 0 ? 'warn' : 'ok') : TONE[key] || 'warn';
  const headline = calm
    ? reported > 0
      ? 'Rides reported down'
      : weather?.label || 'Clear'
    : HEADLINE[key] || weather.label;

  const counts = [];
  if (reported > 0) counts.push(`${reported} reported down`);
  if (!calm && summary?.atRisk > 0) counts.push(`${summary.atRisk} at risk`);

  const tempF = Number.isFinite(Number(observed?.tempF)) ? Math.round(Number(observed.tempF)) : null;
  /* Why we are saying this, in the order it is worth hearing: what the
     classifier objected to, then what a person in the park saw, then — on a
     day with nothing wrong — the reading itself. */
  const why =
    (weather?.reasons || []).slice(0, 2).join(' · ') ||
    plainReading(observed) ||
    (reported > 0 ? 'From your party' : '');

  return (
    <>
      <button
        type="button"
        className={`wxChip ${tone} ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          `Weather: ${headline}${tempF != null ? `, ${tempF} degrees` : ''}. ` +
          (open ? 'Hide the detail.' : 'Show the detail.')
        }
      >
        <Icon name={GLYPH[key] || GLYPH.clear} size={21} />
        {tempF != null && (
          <span className="wxTemp">
            {tempF}
            <em>°</em>
          </span>
        )}
        {/* A count is the one thing worth escaping the chip, because it is the
            part that is not a forecast — somebody saw a ride standing still. */}
        {reported > 0 && <span className="wxDot" aria-hidden="true" />}
      </button>

      {open && (
        <div className={`wxCard ${tone}`} role="status">
          <button
            type="button"
            className="wxCardMain"
            onClick={onOpen}
            aria-label={`${headline}. ${counts.join(', ')}. Open the rides list.`}
          >
            <span className="wxMain">
              <b>{headline}</b>
              {counts.length > 0 && <span className="wxCounts">{counts.join(' · ')}</span>}
            </span>
            <span className="wxWhy">
              {why}
              {at && now && (stale || offline) ? ` · reading from ${ago(at, now)}` : ''}
            </span>
          </button>
          <button
            type="button"
            className="wxClose"
            onClick={() => setOpen(false)}
            aria-label="Hide the weather detail"
          >
            <Icon name="xmark.circle.fill" size={20} />
          </button>
        </div>
      )}
    </>
  );
}
