'use client';

import { formatDistance, formatWalk } from '@/lib/geo';
import { TurnIcon } from '@/components/NavBanner';

/* The whole route, for the moment before you set off — or the moment you stop
   trusting the one-line banner. Steps already walked grey out as you go. */

export default function DirectionsPanel({
  target,
  route,
  progress,
  walking,
  onStart,
  onStop,
  onFocus,
  onClose,
}) {
  if (!target || !route) {
    return <p className="fine">Pick somewhere to walk to and the directions land here.</p>;
  }

  const current = progress?.stepIndex ?? -1;
  const left = progress?.remaining ?? route.metres;

  return (
    <div>
      <div className="label">
        Walking To
        <span className="labelRight">
          {route.mode === 'direct' ? 'straight line' : route.via ? `via ${route.via}` : 'on the paths'}
        </span>
      </div>
      <div className="codeBox column">
        <div>
          <b>{target.label}</b>
          <span className="fine block">
            {formatWalk(left)} · {formatDistance(left)}
            {walking && route.metres > 0
              ? ` · ${Math.round(((route.metres - left) / route.metres) * 100)}% walked`
              : ''}
          </span>
        </div>
        <div className="joinRow">
          {walking ? (
            <>
              <button type="button" className="btn small" onClick={onClose}>
                Back to the map
              </button>
              <button type="button" className="btn small" onClick={onStop}>
                Stop
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn small primary" onClick={onStart}>
                Start walking
              </button>
              <button type="button" className="btn small" onClick={onStop}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {route.mode === 'direct' && (
        <p className="fine">
          Nothing in the park&apos;s path data joins these two points, so this is the bearing and
          the crow-flies range rather than a walk. Head that way and it will pick up a route as
          soon as you are near a mapped path.
        </p>
      )}

      <div className="label">Directions</div>
      <ol className="stepList">
        {route.steps.map((s, i) => (
          <li
            key={`${s.turn}-${s.atIndex}`}
            className={`stepRow ${i < current ? 'done' : ''} ${i === current ? 'now' : ''}`}
          >
            <button
              type="button"
              className="stepMain"
              onClick={() => onFocus({ lat: s.at[0], lng: s.at[1] })}
            >
              <span className={`stepGlyph ${s.turn}`}>
                <TurnIcon turn={s.turn} />
              </span>
              <span className="stepText">
                <b>{s.text}</b>
                {s.metres > 0 && <span>then {formatDistance(s.metres)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className="fine">
        Routes follow the footpaths in the park&apos;s OpenStreetMap geometry. Paths close, queues
        move and staff redirect people — what you can see beats what this says.
      </p>
    </div>
  );
}
