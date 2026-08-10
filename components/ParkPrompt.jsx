'use client';

/* The second half of the intake.
 *
 * The first fix answers a question the app used to leave hanging: of the parks
 * this build ships, which one is this phone actually near? Asking it out loud
 * beats guessing, because the answer is not always the nearest park — someone
 * two hours down the interstate is nearer the park they left than the one they
 * are driving to. So this states the nearest one, asks whether that is where
 * they are going, and puts every other park one tap away.
 *
 * Saying yes is what builds the map: the park's geometry and its list of
 * places are fetched here, not at boot, so the phone only ever downloads the
 * park it is going to.
 */

import { formatDistance } from '@/lib/geo';

const MILE_M = 1609.344;

/** Park-scale distances read in feet; drive-scale ones read in whole miles. */
function awayText(metres) {
  if (metres == null || Number.isNaN(metres)) return null;
  const miles = metres / MILE_M;
  if (miles >= 10) return `${Math.round(miles).toLocaleString()} mi away`;
  return `${formatDistance(metres)} away`;
}

/** What "build the map" actually gets you, in the numbers the manifest carries. */
function dataText(venue) {
  const counts = venue?.counts || {};
  const bits = [];
  if (counts.rides) bits.push(`${counts.rides} rides`);
  if (counts.pois) bits.push(`${counts.pois} places`);
  return bits.join(' · ');
}

export default function ParkPrompt({
  choice,
  options = [],
  busy = false,
  error = null,
  explore = false,
  onConfirm,
  onSkip,
}) {
  const venue = choice?.venue;
  if (!venue) return null;
  const inside = Boolean(choice.inside);
  const distanceText = inside ? 'you are here' : awayText(choice.metres);
  const data = dataText(venue);

  const heading = explore
    ? 'Where are we headed today?'
    : inside
      ? `You’re at ${venue.name}!`
      : `Headed to ${venue.name}?`;
  const body = explore
    ? 'Pick a park and we will build the whole thing on this phone — paths, rides and every spot on the map — so you are ready before you even park the car.'
    : inside
      ? `Your GPS says you are inside ${venue.name}, ${venue.locality}. Tap below and we will load the full map — every path, ride and place.`
      : `${venue.name} in ${venue.locality} is the closest park we have (${distanceText}). Headed that way? We will build the map now so it is waiting when you arrive.`;

  return (
    <div className="gate">
      <div className="gateCard">
        <div className="gateEyebrow">Pick your park</div>
        <h2>{heading}</h2>
        <p>{body}</p>
        {error && <p className="gateError">{error}</p>}

        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => onConfirm?.(venue.id)}
        >
          {busy
            ? 'Getting it ready…'
            : explore
              ? `Set up ${venue.name}`
              : `Yes! Set up ${venue.name}`}
        </button>

        {options.length > 0 && (
          <>
            <div className="label">Different park?</div>
            <div className="venueList">
              {options.map(({ venue: other, metres, inside: within }) => (
                <button
                  key={other.id}
                  type="button"
                  className="venueRow"
                  disabled={busy}
                  onClick={() => onConfirm?.(other.id)}
                >
                  <b>{other.name}</b>
                  <span>
                    {[other.locality, within ? 'you are here' : awayText(metres)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <button type="button" className="btnQuiet" onClick={onSkip}>
          Skip for now — just show me the map
        </button>
        <p className="gateFine">
          {data ? `${venue.name} has ${data}. ` : ''}
          Everything downloads once and stays on this phone, so the map still works in a
          queue with no signal. Switch parks any time under Me &rarr; Which map.
        </p>
      </div>
    </div>
  );
}
