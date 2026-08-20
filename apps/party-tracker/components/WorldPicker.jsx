'use client';

/* The second half of the intake, in one place.
 *
 * The first fix answers a question the app used to leave hanging: of the parks
 * this build ships, which one is this phone actually near? Asking it out loud
 * beats guessing, because the answer is not always the nearest park — someone
 * two hours down the interstate is nearer the park they left than the one they
 * are driving to. So this states the nearest one, asks whether that is where
 * they are going, and puts every other park one tap away.
 *
 * Saying yes is what builds the map: the park's geometry and its list of places
 * are fetched here, not at boot, so the phone only ever downloads the park it
 * is going to.
 *
 * This screen used to exist twice — once inside GpsGate for the GPS path and
 * once in ParkPrompt for the no-GPS one — and the two copies had already
 * drifted apart down to which words the skip button used. One component, two
 * mounts: `explore` is the manual pick, where there is no fix to reason from
 * and the question is simply which World, not whether this one.
 */

import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { formatDistance } from '@/lib/geo';

const MILE_M = 1609.344;

/*
 * A search field over four rows is furniture. It earns its place once the list
 * is longer than a thumb can scan — the manifest ships four Worlds today, so
 * this stays off until the factories ship more, and the filter below is written
 * for the day they do.
 */
const SEARCH_AT = 6;

/**
 * Park-scale distances read in feet; drive-scale ones read in whole miles.
 * Bare, with no "away" on the end: it is a column heading's worth of space in
 * the list, and the one sentence that needs the word adds it itself.
 */
function awayText(metres) {
  if (metres == null || Number.isNaN(metres)) return null;
  const miles = metres / MILE_M;
  if (miles >= 10) return `${Math.round(miles).toLocaleString()} mi`;
  return formatDistance(metres);
}

/** What "build the map" actually gets you, in the numbers the manifest carries. */
function dataText(venue) {
  const counts = venue?.counts || {};
  const bits = [];
  if (counts.rides) bits.push(`${counts.rides} rides`);
  if (counts.pois) bits.push(`${counts.pois} places`);
  return bits.join(' · ');
}

/**
 * @param choice      { venue, metres, inside } — the World being proposed
 * @param options     the other Worlds, already sorted by distance
 * @param busy        a World is downloading; every way of asking for a
 *                    different one stops taking taps (see .btn:disabled)
 * @param explore     manual pick with no fix behind it
 * @param locationOn  a live GPS fix, not a hand-dropped pin — the badge is a
 *                    claim about the phone and has to be true on the denied and
 *                    manual paths too
 * @param step        show the "2 OF 2" intake progress row
 */
export default function WorldPicker({
  choice,
  options = [],
  busy = false,
  error = null,
  explore = false,
  locationOn = false,
  step = false,
  onConfirm,
  onSkip = null,
}) {
  const [query, setQuery] = useState('');
  const venue = choice?.venue;
  const inside = Boolean(choice?.inside);
  const searchable = options.length > SEARCH_AT;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((row) =>
      `${row.venue.name} ${row.venue.locality || ''}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  if (!venue) return null;

  const away = inside ? 'you are here' : awayText(choice.metres);
  const data = dataText(venue);

  const heading = explore
    ? 'Which World are we exploring?'
    : inside
      ? `You’re at ${venue.name}!`
      : `Headed to ${venue.name}?`;
  const body = explore
    ? 'Choose a World and we will load its living map — paths, rides, Places, and real map Zones where they exist — so you are ready before you arrive.'
    : inside
      ? `You are inside ${venue.name}, ${venue.locality}. Load this World and start walking.`
      : `${venue.name} in ${venue.locality} is the closest, ${away} out. Load it now.`;

  return (
    <div className="worldPick">
      {step && (
        <div className="gateSteps" aria-hidden="true">
          <span className="gateStep on" />
          <span className="gateStep on" />
          <span className="gateStepLabel">2 OF 2</span>
        </div>
      )}

      <div className="worldPickHead">
        {locationOn && (
          <p className="worldFix">
            <Icon name="checkmark" size={14} className="icn worldFixMark" />
            <span>Location on</span>
          </p>
        )}
        <h2 className="worldHeading">{heading}</h2>
        <p className="worldBody">{body}</p>
        {data && (
          <p className="worldCounts">
            <i aria-hidden="true" />
            <span>{data}</span>
          </p>
        )}

        {error && <p className="gateError">{error}</p>}

        <button
          type="button"
          className="btn primary rect"
          disabled={busy}
          onClick={() => onConfirm?.(venue.id)}
        >
          {busy
            ? 'Getting it ready…'
            : explore
              ? `Enter ${venue.name}`
              : `Yes! Enter ${venue.name}`}
        </button>
      </div>

      {options.length > 0 && (
        <>
          <div className="label">
            Explore another World
            <span className="labelRight">{options.length} nearby</span>
          </div>
          {searchable && (
            <div className="searchField worldSearch">
              <span className="searchIn" aria-hidden="true">
                <Icon name="magnifyingglass" size={17} />
              </span>
              <input
                className="field"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Worlds"
                aria-label="Search Worlds"
              />
            </div>
          )}
          <div className="venueList worldList">
            {shown.map(({ venue: other, metres, inside: within }) => (
              <button
                key={other.id}
                type="button"
                className="venueRow"
                disabled={busy}
                onClick={() => onConfirm?.(other.id)}
              >
                <b>{other.name}</b>
                <span>{other.locality}</span>
                {/* The disclosure chevron is .venueRow::after — drawn, not imported. */}
                <span className="venueAway">{within ? 'you are here' : awayText(metres)}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="worldNone">No World matches “{query.trim()}”.</p>}
          </div>
        </>
      )}

      {onSkip && (
        <button type="button" className="btnQuiet muted" onClick={onSkip}>
          Skip for now — show me the map
        </button>
      )}

      <p className="gateFine">Downloads once and works offline. Switch Worlds from Me.</p>
    </div>
  );
}
