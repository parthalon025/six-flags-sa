'use client';

import { BRAND } from '@/lib/brand';
import { formatDistance } from '@/lib/geo';

const COPY = {
  idle: {
    title: 'Find you on the map',
    body: 'Parkbound needs your GPS to drop your dot, see how far the party is, and point you at the meet-up. Nothing leaves your phone until you join a party.',
    action: 'Allow location',
  },
  asking: {
    title: 'Hang tight…',
    body: 'Your phone should be asking right now — tap Allow, then give it a few seconds. First fix under trees or inside a queue building can take a minute.',
    action: 'Ask again',
  },
  denied: {
    title: 'Location is turned off',
    body: 'No worries — you can fix it. On iPhone: Settings → Safari → Location → Ask, then reload. On Android Chrome: tap the padlock → Permissions → Location → Allow.',
    action: 'Try again',
  },
  insecure: {
    title: 'Needs a secure connection',
    body: 'Browsers only share GPS over HTTPS (or localhost while you are building). Open the https:// link, or use http://localhost:3000 in dev.',
    action: 'Try anyway',
  },
  unsupported: {
    title: 'No GPS here',
    body: 'This browser does not do location — but you can still explore the map by tapping where you are.',
    action: 'Try anyway',
  },
};

const MILE_M = 1609.344;

/** Park-scale distances read in feet; drive-scale ones read in whole miles. */
function awayText(metres) {
  if (metres == null || Number.isNaN(metres)) return null;
  const miles = metres / MILE_M;
  if (miles >= 10) return `${Math.round(miles).toLocaleString()} mi away`;
  return `${formatDistance(metres)} away`;
}

function dataText(venue) {
  const counts = venue?.counts || {};
  const bits = [];
  if (counts.rides) bits.push(`${counts.rides} rides`);
  if (counts.pois) bits.push(`${counts.pois} places`);
  return bits.join(' · ');
}

/*
 * GPS and park intake — the screen after the intro splash. The happy path
 * ("go to nearest park") skips the park question and reports progress with a
 * toast instead. Brand copy lives on IntroSplash; this card is location only.
 */
function ParkSection({
  choice,
  options = [],
  busy = false,
  error = null,
  onConfirm,
  autoSetup = false,
}) {
  const venue = choice?.venue;
  if (!venue) return null;
  const inside = Boolean(choice.inside);
  const distanceText = inside ? 'you are here' : awayText(choice.metres);
  const data = dataText(venue);

  if (autoSetup) {
    return (
      <>
        <p>
          {busy
            ? `Getting ${venue.name} ready — the map, rides and places for ${venue.locality}.`
            : `Found ${venue.name}${distanceText ? `, ${distanceText}` : ''}.`}
        </p>
        {error && <p className="gateError">{error}</p>}
      </>
    );
  }

  return (
    <>
      <p>
        {inside
          ? `Your GPS says you are inside ${venue.name}, ${venue.locality}. Tap below and we will load the full map.`
          : `${venue.name} in ${venue.locality} is the closest park we have (${distanceText}). Headed that way?`}
      </p>
      {error && <p className="gateError">{error}</p>}

      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={() => onConfirm?.(venue.id)}
      >
        {busy ? 'Getting it ready…' : `Yes! Set up ${venue.name}`}
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

      {data && (
        <p className="gateFine">
          {venue.name} has {data}. Everything downloads once and stays on this phone.
        </p>
      )}
    </>
  );
}

export default function GpsGate({
  status,
  error,
  onRequest,
  onManual,
  onDismiss,
  onGoNearest,
  venueName,
  highlightNearest = false,
  parkChoice = null,
  parkOptions = [],
  onConfirmPark,
  setupBusy = false,
  setupError = null,
  nearestIntent = false,
}) {
  const copy = COPY[status] || COPY.idle;
  const parkVenue = parkChoice?.venue;
  const settingUp = nearestIntent && parkVenue;
  const showParkQuestion = parkVenue && !nearestIntent;
  const nearestIdle = highlightNearest && status === 'idle' && !nearestIntent;
  const nearestSearching = highlightNearest && nearestIntent && status === 'asking';

  let primaryLabel = copy.action;
  let primaryAction = onRequest;
  let primaryDisabled = false;

  if (nearestIdle) {
    primaryLabel = 'Go to nearest park';
    primaryAction = onGoNearest || onRequest;
  } else if (nearestSearching || (highlightNearest && status === 'asking' && nearestIntent)) {
    primaryLabel = 'Finding your location…';
    primaryDisabled = true;
  } else if (settingUp) {
    primaryLabel = setupBusy ? `Setting up ${parkVenue.name}…` : `Found ${parkVenue.name}`;
    primaryDisabled = true;
  } else if (status === 'asking') {
    primaryLabel = 'Ask again';
  }

  return (
    <div className="gate">
      <div className="gateCard">
        <div className="gateEyebrow">
          {`${venueName ? `${venueName} · ` : ''}${BRAND.nameUpper}`}
        </div>
        <h2>
          {showParkQuestion
            ? parkChoice.inside
              ? `You’re at ${parkVenue.name}!`
              : `Headed to ${parkVenue.name}?`
            : settingUp
              ? BRAND.nameUpper
              : copy.title}
        </h2>
        {!showParkQuestion && !settingUp && <p>{copy.body}</p>}

        {(settingUp || showParkQuestion) && (
          <ParkSection
            choice={parkChoice}
            options={parkOptions}
            busy={setupBusy}
            error={setupError}
            onConfirm={onConfirmPark}
            autoSetup={settingUp}
          />
        )}

        {error && !setupError && <p className="gateError">{error}</p>}

        {!showParkQuestion && (
          <button
            type="button"
            className="btn primary"
            disabled={primaryDisabled}
            onClick={primaryAction}
          >
            {primaryLabel}
          </button>
        )}

        {!showParkQuestion && !settingUp && (
          <>
            <button type="button" className="btn" onClick={onManual}>
              Explore parks
            </button>
            <button type="button" className="btnQuiet" onClick={onDismiss}>
              {venueName ? `Just browsing ${venueName}` : 'Just show me the map'}
            </button>
          </>
        )}

        {showParkQuestion && (
          <button type="button" className="btnQuiet" onClick={onDismiss}>
            Skip for now — just show me the map
          </button>
        )}

        <p className="gateFine">
          Your location stays on your phone. Join a party and it goes only to your crew,
          encrypted in transit — nobody in the middle can peek.
          {showParkQuestion ? ' Switch parks any time under Day → Which park.' : ''}
        </p>
      </div>
    </div>
  );
}
