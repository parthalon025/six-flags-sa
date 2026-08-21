'use client';

import { formatDistance } from '@/lib/geo';

/* The strip that runs while you are walking somewhere: one maneuver, the
   distance to it, and a glance at the one after. Everything else — how long is
   left, when you get there, how to stop — lives on the bar at the bottom, the
   way both phone maps do it, because the top of a phone is where your eyes go
   and the bottom is where your thumb goes.

   The "then" line says how far the next leg runs, not what it is called. A
   step out of lib/routing.js narrate() is `{turn, text, metres, at, atIndex,
   landmark, fromStart}` — there is no per-step way name to quote, and there is
   no way to invent one: the park's paths mostly have no names, which is why
   viaName() names a whole route after the *land* nearest its middle rather
   than after a path. So the leg is stated in feet and the maneuver names
   itself, which is more use anyway — "445 ft, bear left at LaRosa's" tells you
   what to look for; a path name you cannot read off a sign does not. */

export function TurnIcon({ turn }) {
  // One arrow, rotated. A left turn is the right turn's mirror, and an arrival
  // is the only shape that isn't an arrow at all.
  if (turn === 'arrive') {
    return (
      <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 21 V3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M6 4 L18 7.5 L6 11 Z" fill="currentColor" />
      </svg>
    );
  }
  const flip = turn === 'left';
  return (
    <svg className="navIcon" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={flip ? 'translate(24 0) scale(-1 1)' : undefined}>
        {turn === 'straight' || turn === 'depart' ? (
          <path
            d="M12 21 V6 M12 3 l6 6 M12 3 l-6 6"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : (
          <path
            d="M7 21 V12 a5 5 0 0 1 5 -5 h5 M13 2 l6 5 -6 5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </g>
    </svg>
  );
}

export default function NavBanner({ target, route, progress, offRoute, rerouted }) {
  if (!target) return null;

  /* `progress` answers with an explicit null once there is no step after this
     one, so it is asked first and taken at its word — `??` onto the raw route
     turned that null back into steps[1], which on a two-step route is the
     arrival itself and printed "Arrive at X / then arrive at X". The raw route
     is only the stand-in for the moment before the first fix lands. */
  const step = progress ? progress.step : (route?.steps?.[0] ?? null);
  const then = progress ? progress.next : (route?.steps?.[1] ?? null);
  const toStep = progress?.toStep ?? null;
  const arriving = step?.turn === 'arrive';

  return (
    <section className={`navBanner ${offRoute ? 'off' : ''}`} aria-live="polite">
      {target.entranceMeta && (
        <p className={`navEntrance ${target.entranceMeta.confirmed ? 'confirmed' : 'approx'}`}>
          {target.entranceMeta.confirmed ? 'Queue entrance' : target.entranceMeta.label}
        </p>
      )}
      <div className="navMain">
        <span className={`navTurn ${step?.turn || 'depart'}`}>
          <TurnIcon turn={step?.turn || 'depart'} />
        </span>
        <span className="navText">
          {!arriving && toStep != null && <b className="navDist">{formatDistance(toStep)}</b>}
          <span className="navStep">{step?.text || `Walking to ${target.label}`}</span>
        </span>
      </div>

      {offRoute || rerouted ? (
        <div className="navThen rerouting">
          <span className="navSpinner" aria-hidden="true" />
          {offRoute ? 'Off the route — finding a new one' : 'New route from where you are'}
        </div>
      ) : (
        then && (
          <div className="navThen">
            <span className={`navThenIcon ${then.turn}`}>
              <TurnIcon turn={then.turn} />
            </span>
            then{' '}
            {Number.isFinite(step?.metres) && step.metres > 0
              ? `${formatDistance(step.metres)}, `
              : ''}
            {then.text.charAt(0).toLowerCase() + then.text.slice(1)}
          </div>
        )
      )}
    </section>
  );
}
