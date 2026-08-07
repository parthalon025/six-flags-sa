'use client';

import { formatDistance, formatWalk } from '@/lib/geo';

/* The strip that runs while you are walking somewhere. One instruction, the
   distance to it, and how much is left — the three things worth reading with a
   phone held at waist height in a crowd. Everything else stays on the map. */

function TurnIcon({ turn }) {
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

export default function NavBanner({ target, route, progress, offRoute, onStop, onShowSteps, steps }) {
  if (!target) return null;

  const step = progress?.step ?? route?.steps?.[0] ?? null;
  const remaining = progress?.remaining ?? route?.metres ?? null;
  const toStep = progress?.toStep ?? null;

  return (
    <section className="navBanner" aria-live="polite">
      <div className="navMain">
        <span className={`navTurn ${step?.turn || 'depart'}`}>
          <TurnIcon turn={step?.turn || 'depart'} />
        </span>
        <span className="navText">
          <b>{step?.text || `Walking to ${target.label}`}</b>
          <em>
            {toStep != null && step?.turn !== 'arrive'
              ? `in ${formatDistance(toStep)}`
              : `to ${target.label}`}
          </em>
        </span>
        <span className="navEta">
          <b>{formatWalk(remaining)}</b>
          <em>{formatDistance(remaining)}</em>
        </span>
      </div>

      <div className="navFoot">
        <span className="navWhere">
          {offRoute
            ? 'Off the route — finding a new one'
            : route?.mode === 'direct'
              ? 'No mapped path — straight line'
              : `To ${target.label}`}
        </span>
        {steps > 1 && (
          <button type="button" className="navLink" onClick={onShowSteps}>
            All {steps} steps
          </button>
        )}
        <button type="button" className="navStop" onClick={onStop}>
          Stop
        </button>
      </div>

      <div className="navProgress">
        <i
          style={{
            width: `${
              route?.metres > 0
                ? Math.min(100, Math.max(0, ((route.metres - (remaining ?? 0)) / route.metres) * 100))
                : 0
            }%`,
          }}
        />
      </div>
    </section>
  );
}
