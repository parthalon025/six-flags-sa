'use client';

import { BRAND } from '@/lib/brand';

const COPY = {
  idle: {
    title: 'Find you on the map',
    body: 'Parkbound needs your GPS to drop your dot, see how far the crew is, and point you at the meet-up. Nothing leaves your phone until you join a party.',
    action: 'Share my location',
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

/*
 * The first screen says what Parkbound is and asks for location, in that
 * order, on the one screen — rather than asking on a screen of its own.
 *
 * That order is the whole point. Someone handed the phone's own permission box
 * before anything has said what the app does says no, and on a phone "no" is
 * close to permanent: getting it back means a trip into browser settings that
 * most people never make. Saying what they get first, in lines they can read
 * standing in a car park, is what makes the box worth saying yes to — and the
 * ways out below are ours rather than the phone's, so turning it down here
 * costs nothing and the same button works later.
 */
function Welcome() {
  return (
    <>
      <p className="gateSlogan">{BRAND.slogan}</p>
      <p>{BRAND.promise}</p>
      <div className="introList">
        <p>
          <b>Spot your whole crew.</b> Your party is an expedition on the map — how far away
          they are and how long the walk takes.
        </p>
        <p>
          <b>Meet up without the group-chat spiral.</b> Drop a pin on a spot and everyone
          gets a walking trail straight to it.
        </p>
        <p>
          <b>Trails that actually help.</b> Tap Go on any ride, bathroom or snack stand and
          follow step-by-step routes, just like a street map.
        </p>
        <p>
          <b>Everything the park has to offer.</b> Every ride, who is tall enough, what is
          running right now, and the nearest toilet, food or first aid.
        </p>
        <p>
          <b>Keep an eye on the weather.</b> The forecast for the park and a heads-up when
          rides tend to shut for rain or lightning.
        </p>
        <p>
          <b>Your favorite parks, ready to roll.</b> Cedar Point, Kings Island, Fiesta Texas,
          Big Kahuna&apos;s and more — pick yours and the whole map downloads before you walk
          in the gate.
        </p>
        <p>
          <b>Works even in the dead zone.</b> The map, rides and trails live on your phone, so
          queues with no signal are no problem. Parkbound updates itself when you are back
          online. Only live crew tracking needs bars — everyone catches up when they return.
        </p>
      </div>
      <p>Ready to put yourself on the map? Parkbound just needs your location for that.</p>
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
        <button type="button" className="btn" onClick={onManual}>
          I&apos;ll tap where I am
        </button>
        <button type="button" className="btnQuiet" onClick={onDismiss}>
          {venueName ? `Just browsing ${venueName}` : 'Just show me the map'}
        </button>
        <p className="gateFine">
          Your location stays on your phone. Join a party and it goes only to your crew,
          encrypted in transit — nobody in the middle can peek.
        </p>
      </div>
    </div>
  );
}
