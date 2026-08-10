'use client';

import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { formatDistance } from '@/lib/geo';

const COPY = {
  idle: {
    title: 'Find you on the map',
    body: 'Parkbound uses your GPS to drop your dot, point you at toilets, food and rides, and walk you there on guest paths. Nothing leaves your phone until you join a party.',
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
 * The landing is one line and one button. Someone standing in a car park does
 * not need five bullets before they will tap Allow — they need to know what
 * this is and what the one good button does. Nearest-park still asks "is this
 * the right park?" before downloading — auto-setup used to skip that confirm.
 */
function ParkSection({
  choice,
  options = [],
  busy = false,
  error = null,
  onConfirm,
}) {
  const venue = choice?.venue;
  if (!venue) return null;
  const inside = Boolean(choice.inside);
  const distanceText = inside ? 'you are here' : awayText(choice.metres);
  const data = dataText(venue);

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
  const showParkQuestion = Boolean(parkVenue);
  const welcomeIdle = welcome && status === 'idle' && !nearestIntent && !showParkQuestion;
  const welcomeSearching = welcome && nearestIntent && status === 'asking' && !showParkQuestion;

  let primaryLabel = copy.action;
  let primaryAction = onRequest;
  let primaryDisabled = false;

  if (welcomeIdle) {
    primaryLabel = 'Go to nearest park';
    primaryAction = onGoNearest || onRequest;
  } else if (welcomeSearching || (welcome && status === 'asking' && nearestIntent && !showParkQuestion)) {
    primaryLabel = 'Finding your location…';
    primaryDisabled = true;
  } else if (status === 'asking' && !showParkQuestion) {
    primaryLabel = 'Ask again';
  }

  return (
    <div className="gate">
      <div className="gateCard">
        {welcome && !showParkQuestion ? (
          <>
            <div className="gateEyebrow">Welcome</div>
            {/* Splash: primary logo lockup (brand sheet Image 1) */}
            <BrandLockup size="lg" stacked showTagline className="gateBrandLockup" />
            <p>{BRAND.shortDescription}</p>
          </>
        ) : (
          <>
            <div className="gateEyebrow">
              {welcome
                ? 'Welcome'
                : `${venueName ? `${venueName} · ` : ''}${BRAND.nameUpper}`}
            </div>
            <h2>
              {showParkQuestion
                ? parkChoice.inside
                  ? `You’re at ${parkVenue.name}!`
                  : `Headed to ${parkVenue.name}?`
                : copy.title}
            </h2>
            {!showParkQuestion && <p>{copy.body}</p>}
          </>
        )}

        {showParkQuestion && (
          <ParkSection
            choice={parkChoice}
            options={parkOptions}
            busy={setupBusy}
            error={setupError}
            onConfirm={onConfirmPark}
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

        {!showParkQuestion && (
          <>
            <button type="button" className="btn" onClick={onManual}>
              I&apos;ll tap where I am
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
          {showParkQuestion ? ' Switch parks any time under Me → Which park.' : ''}
        </p>
      </div>
    </div>
  );
}
