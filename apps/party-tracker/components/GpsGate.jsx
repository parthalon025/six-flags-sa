'use client';

import BrandLockup from '@/components/BrandLockup';
import Icon from '@/components/Icon';
import InstallCard from '@/components/InstallCard';
import WorldPicker from '@/components/WorldPicker';
import { BRAND } from '@/lib/brand';

const PARTY_LOCK = {
  title: 'Turn Location back on',
  body: 'You are still in the party. Other phones will not see your live dot until Location is on.',
  action: 'Allow location',
};

const COPY = {
  idle: {
    title: 'Find you on the map',
    body: 'Parkbound uses your GPS to place you in a World, point you at Places, and walk you there on guest paths. Nothing leaves your phone until you join a Party.',
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
  'I’m ready uses your GPS once to find the closest map we have, shows you which World that is, and asks you to confirm before anything downloads — so you never pull the wrong map by accident.';

/*
 * The intake, in two steps and said once.
 *
 * Step one is this card: what the app is for, and the one permission it needs
 * to do it. Step two is the World pick, which is why the progress row counts to
 * two and why the primary here asks for the fix rather than skipping it — the
 * fix is what makes step two answerable.
 *
 * Everything below idle — asking, denied, insecure, unsupported, and the party
 * lock — keeps the older head and the fuller set of ways out. Those are the
 * troubleshooting states, and the person reading one is looking for the
 * paragraph that names their phone, not for a tidier screen.
 */
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
  locationOn = false,
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
  /* Step one of the intake proper. Not every welcome state: a phone that has
     already refused is not being asked "shall we start", it is being told how
     to undo a refusal, and that card needs its own words. */
  const stepOne = welcomeIdle || welcomeSearching;

  let primaryLabel = copy.action;
  let primaryAction = onRequest;
  let primaryDisabled = false;

  if (welcomeIdle) {
    // The label is the twin's; the handler is the one that already existed and
    // already leads to step two — it asks for the fix, then offers the nearest
    // World for confirmation before anything downloads.
    primaryLabel = 'I’m ready';
    primaryAction = onGoNearest || onRequest;
  } else if (welcomeSearching || (welcome && status === 'asking' && nearestIntent && !showParkQuestion)) {
    primaryLabel = 'Finding your location…';
    primaryDisabled = true;
  } else if (status === 'asking' && !showParkQuestion) {
    primaryLabel = 'Ask again';
  }

  return (
    <div className={firstRun ? 'gate gateFirstRun' : 'gate'}>
      <div className="gateCard gpsGateCard">
        {showParkQuestion ? (
          <WorldPicker
            step
            locationOn={locationOn}
            choice={parkChoice}
            options={parkOptions}
            busy={setupBusy}
            /* A download that failed says so; otherwise whatever the fix itself
               is complaining about, which is the same order this card used
               before the picker was pulled out of it. */
            error={setupError || error}
            onConfirm={onConfirmPark}
            onSkip={onDismiss}
          />
        ) : (
          <>
            {stepOne ? (
              <div className="gateStepHead">
                <div className="gateSteps" aria-hidden="true">
                  <span className="gateStep on" />
                  <span className="gateStep" />
                  <span className="gateStepLabel">1 OF 2</span>
                </div>
                <span className="gateStepIcon" aria-hidden="true">
                  <Icon name="location.north.fill" size={24} />
                </span>
                <h2 className="gateStepTitle">Plan your day</h2>
                <p className="gateStepBody">{BRAND.gatePitch}</p>
                {welcomeIdle && <p className="gateFine">{NEAREST_PARK_HINT}</p>}
                {welcomeSearching && (
                  <p className="gateFine">
                    When your phone shares a fix, we will show the nearest World and ask you to
                    confirm before the map downloads.
                  </p>
                )}
              </div>
            ) : welcome && !partyLock ? (
              <>
                <div className="gateEyebrow">Welcome</div>
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
                <h2>{copy.title}</h2>
                <p>{copy.body}</p>
              </>
            )}

            {error && !setupError && <p className="gateError">{error}</p>}

            {showPhoneSetup && (
              <div className="gatePhoneSetup">
                <button
                  type="button"
                  className="btn primary rect"
                  disabled={primaryDisabled}
                  onClick={primaryAction}
                >
                  {primaryLabel}
                </button>
                {welcome && !nearestIntent && !partyLock && <InstallCard compact />}
              </div>
            )}

            {!partyLock &&
              (stepOne ? (
                /* One way out, not two. "Browse Worlds" is the manual pick, which
                   is the only other answer to "where are you" this card can take;
                   the dismiss path keeps its button on every troubleshooting
                   state below, where someone stuck without a fix needs it. */
                <button type="button" className="btnQuiet muted" onClick={onManual}>
                  Browse Worlds
                </button>
              ) : (
                <>
                  <button type="button" className="btn" onClick={onManual}>
                    Explore Worlds
                  </button>
                  <button type="button" className="btnQuiet" onClick={onDismiss}>
                    {venueName ? `Just browsing ${venueName}` : 'Just show me the map'}
                  </button>
                </>
              ))}

            <p className="gateFine">
              Your location stays on your phone. Join a party and it goes only to your crew,
              encrypted in transit — nobody in the middle can peek.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
