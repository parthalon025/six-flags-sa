'use client';

import { BRAND } from '@/lib/brand';
import { formatDistance } from '@/lib/geo';

const COPY = {
  idle: {
    title: 'Turn on location',
    body: 'Parkbound needs your phone’s GPS to place you on the map, measure range and bearing to your party, and point you at the meet-up. Nothing is stored until you join a party.',
    action: 'Allow location',
  },
  asking: {
    title: 'Waiting for a fix',
    body: 'Your phone should be asking for permission now. Say yes, then give it a few seconds — first fix under tree cover or inside a queue building can take a while.',
    action: 'Ask again',
  },
  denied: {
    title: 'Location is blocked',
    body: 'Your browser is refusing the request. On iPhone: Settings → Safari → Location → Ask, then reload. On Android Chrome: tap the padlock in the address bar → Permissions → Location → Allow.',
    action: 'Try again',
  },
  insecure: {
    title: 'Needs a secure connection',
    body: 'Browsers only hand out GPS over HTTPS or on localhost. Open this on http://localhost:3000 while developing, or deploy it and use the https:// address.',
    action: 'Try anyway',
  },
  unsupported: {
    title: 'No location API',
    body: 'This browser does not expose geolocation at all. You can still use every other part of the map by placing yourself by hand.',
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
 * The landing is one line and one button. Someone standing in a car park does
 * not need five bullets before they will tap Allow — they need to know what
 * this is and what the one good button does. The park question used to be a
 * whole second card; it now lives here when it is needed, and the happy path
 * ("go to nearest park") skips it and reports progress with a toast instead.
 *
 * Brand copy is Parkbound (name + slogan). The five-bullet Welcome intro from
 * the design-language branch yields to this streamlined first-run flow from
 * main — both intents cannot own the same card.
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
            ? `Setting up ${venue.name} — the map, rides and places for ${venue.locality}.`
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
          ? `Your fix puts you inside ${venue.name}, ${venue.locality}. Say the word and this phone builds that park.`
          : `${venue.name} in ${venue.locality} is the closest park — ${distanceText}.`}
      </p>
      {error && <p className="gateError">{error}</p>}

      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={() => onConfirm?.(venue.id)}
      >
        {busy ? 'Setting it up…' : `Yes — set up ${venue.name}`}
      </button>

      {options.length > 0 && (
        <>
          <div className="label">Somewhere Else</div>
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
          {venue.name} is {data}. Everything is fetched once and kept on this phone.
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
  welcome = false,
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
  const welcomeIdle = welcome && status === 'idle' && !nearestIntent;
  const welcomeSearching = welcome && nearestIntent && status === 'asking';

  let primaryLabel = copy.action;
  let primaryAction = onRequest;
  let primaryDisabled = false;

  if (welcomeIdle) {
    primaryLabel = 'Go to nearest park';
    primaryAction = onGoNearest || onRequest;
  } else if (welcomeSearching || (welcome && status === 'asking' && nearestIntent)) {
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
          {welcome ? 'Welcome' : `${venueName ? `${venueName} · ` : ''}${BRAND.nameUpper}`}
        </div>
        <h2>
          {welcome && !showParkQuestion
            ? BRAND.nameUpper
            : showParkQuestion
              ? parkChoice.inside
                ? `You’re at ${parkVenue.name}`
                : `Going to ${parkVenue.name}?`
              : copy.title}
        </h2>

        {welcome && !showParkQuestion && !settingUp && (
          <p className="gateSlogan">{BRAND.slogan}</p>
        )}
        {welcome && !showParkQuestion && !settingUp && (
          <p>{BRAND.shortDescription}</p>
        )}
        {!welcome && !showParkQuestion && !settingUp && <p>{copy.body}</p>}

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
              I&apos;ll tap where I am on the map
            </button>
            <button type="button" className="btnQuiet" onClick={onDismiss}>
              {venueName ? `Just look around ${venueName}` : 'Just show me the map'}
            </button>
          </>
        )}

        {showParkQuestion && (
          <button type="button" className="btnQuiet" onClick={onDismiss}>
            Not now — just show me the map
          </button>
        )}

        <p className="gateFine">
          Where you are stays on your phone. Join a party and it goes only to those
          people, encrypted on the way, so nobody in between can read it.
          {showParkQuestion ? ' Change parks any time under Day → Which park.' : ''}
        </p>
      </div>
    </div>
  );
}
