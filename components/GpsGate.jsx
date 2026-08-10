'use client';

import { BRAND } from '@/lib/brand';

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

/*
 * The first screen says what Parkbound is and asks for location, in that
 * order, on the one screen — rather than asking on a screen of its own.
 *
 * That order is the whole point. Someone handed the phone's own permission box
 * before anything has said what the app does says no, and on a phone "no" is
 * close to permanent: getting it back means a trip into browser settings that
 * most people never make. Saying what they get first, in three lines they can
 * read standing in a car park, is what makes the box worth saying yes to — and
 * the ways out below are ours rather than the phone's, so turning it down here
 * costs nothing and the same button works later.
 */
function Welcome() {
  return (
    <>
      <p className="gateSlogan">{BRAND.slogan}</p>
      <p>{BRAND.promise}</p>
      <div className="introList">
        <p>
          <b>See where everyone is.</b> Your party is an expedition on the map, with how far
          away they are and how long the walk is.
        </p>
        <p>
          <b>Meet up without ringing round.</b> Anyone can drop a pin on a spot, and
          everyone else gets a trail to it.
        </p>
        <p>
          <b>Everything in the park.</b> Every ride and who is tall enough for it, and the
          nearest toilet, food or first aid.
        </p>
        <p>
          <b>An eye on the sky.</b> The forecast for the park, and which rides tend to shut
          when the weather turns.
        </p>
        <p>
          <b>No bars, no problem.</b> The map, the rides and the walking trails are
          saved on your phone, so they work in a queue with no signal. Only watching your
          party move needs a connection, and everyone catches up when it comes back.
        </p>
      </div>
      <p>To put you on the map, Parkbound needs to use your location.</p>
    </>
  );
}

export default function GpsGate({
  status,
  error,
  onRequest,
  onManual,
  onDismiss,
  venueName,
  welcome = false,
}) {
  const copy = COPY[status] || COPY.idle;
  return (
    <div className="gate">
      <div className="gateCard">
        <div className="gateEyebrow">
          {welcome ? 'Welcome' : `${venueName ? `${venueName} · ` : ''}${BRAND.nameUpper}`}
        </div>
        <h2>{welcome ? BRAND.nameUpper : copy.title}</h2>
        {welcome ? <Welcome /> : <p>{copy.body}</p>}
        {error && <p className="gateError">{error}</p>}
        <button type="button" className="btn primary" onClick={onRequest}>
          {status === 'asking' ? 'Ask again' : copy.action}
        </button>
        {/* These two used to read "Place myself on the map instead" and "Just
            show me the map", which are the same sentence to anyone not already
            holding the model. Say what each one leaves you able to do. */}
        <button type="button" className="btn" onClick={onManual}>
          I&apos;ll tap where I am on the map
        </button>
        <button type="button" className="btnQuiet" onClick={onDismiss}>
          {venueName ? `Just look around ${venueName}` : 'Just show me the map'}
        </button>
        <p className="gateFine">
          Where you are stays on your phone. Join a party and it goes only to those
          people, encrypted on the way, so nobody in between can read it.
        </p>
      </div>
    </div>
  );
}
