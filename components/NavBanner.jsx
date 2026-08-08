'use client';

import { formatDistance } from '@/lib/geo';

/* The strip that runs while you are walking somewhere: one maneuver, the
   distance to it, and a glance at the one after. Everything else — how long is
   left, when you get there, how to stop — lives on the bar at the bottom, the
   way both phone maps do it, because the top of a phone is where your eyes go
   and the bottom is where your thumb goes. */

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

  const step = progress?.step ?? route?.steps?.[0] ?? null;
  const then = progress?.next ?? route?.steps?.[1] ?? null;
  const toStep = progress?.toStep ?? null;
  const arriving = step?.turn === 'arrive';

  return (
    <section className={`navBanner ${offRoute ? 'off' : ''}`} aria-live="polite">
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
            then {then.text.toLowerCase()}
          </div>
        )
      )}
    </section>
  );
}
