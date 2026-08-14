'use client';

import BrandLockup from '@/components/BrandLockup';
import InstallCard from '@/components/InstallCard';
import { BRAND } from '@/lib/brand';
import { formatDistance } from '@/lib/geo';

const PARTY_LOCK = {
  title: 'Turn Location back on',
  body: 'You are still in the party. Other phones will not see your live dot until Location is on.',
  action: 'Allow location',
};

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

const NEAREST_PARK_HINT =
  'Go to nearest park uses your GPS once to find the closest map we have, shows you which park that is, and asks you to confirm before anything downloads — so you never pull the wrong park by accident.';

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
 * First-run landing: brand lockup, optional install pitch, and a clear nearest-park
 * path. Nearest-park always confirms before download — wrong park is costly on
 * park wifi. GPS enable and Add to Home Screen sit together on first open.
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
  partyLock = false,
  firstRun = false,
}) {
  const copy = partyLock
    ? {
        title: PARTY_LOCK.title,
        body: `${PARTY_LOCK.body} ${COPY[status]?.body || COPY.denied.body}`,
        action: COPY[status]?.action || PARTY_LOCK.action,
      }
    : COPY[status] || COPY.idle;
  const parkVenue = parkChoice?.venue;
  const showParkQuestion = Boolean(parkVenue) && !partyLock;
  const welcomeIdle = welcome && status === 'idle' && !nearestIntent && !showParkQuestion && !partyLock;
  const welcomeSearching = welcome && nearestIntent && status === 'asking' && !showParkQuestion && !partyLock;
  const showPhoneSetup = !showParkQuestion;

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
    <div className={firstRun ? 'gate gateFirstRun' : 'gate'}>
      <div className="gateCard">
        {welcome && !showParkQuestion && !partyLock ? (
          <>
            <div className="gateEyebrow">Welcome</div>
            <BrandLockup size="lg" stacked showTagline className="gateBrandLockup" />
            <p>{BRAND.shortDescription}</p>
            {welcomeIdle && <p className="gateFine">{NEAREST_PARK_HINT}</p>}
            {welcomeSearching && (
              <p className="gateFine">
                When your phone shares a fix, we will show the nearest park and ask you to
                confirm before the map downloads.
              </p>
            )}
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

        {showPhoneSetup && (
          <div className="gatePhoneSetup">
            <button
              type="button"
              className="btn primary"
              disabled={primaryDisabled}
              onClick={primaryAction}
            >
              {primaryLabel}
            </button>
            {welcome && !nearestIntent && !partyLock && <InstallCard compact />}
          </div>
        )}

        {!showParkQuestion && !partyLock && (
          <>
            <button type="button" className="btn" onClick={onManual}>
              Explore parks
            </button>
            <button type="button" className="btnQuiet" onClick={onDismiss}>
              {venueName ? `Just browsing ${venueName}` : 'Just show me the map'}
            </button>
          </>
        )}

        {showParkQuestion && !partyLock && (
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
