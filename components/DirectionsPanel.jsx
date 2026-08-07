'use client';

import { formatDistance, formatWalk } from '@/lib/geo';

/* The whole route, for the moment before you set off — or the moment you stop
   trusting the one-line banner. Steps already walked grey out as you go. */

const GLYPH = {
  depart: '↑',
  straight: '↑',
  left: '←',
  right: '→',
  arrive: '⚑',
};

export default function DirectionsPanel({ target, route, progress, onStop, onFocus }) {
  if (!target || !route) {
    return <p className="fine">Pick somewhere to walk to and the directions land here.</p>;
  }

  const current = progress?.stepIndex ?? 0;

  return (
    <div>
      <div className="label">
        Walking to
        <span className="labelRight">{route.mode === 'direct' ? 'straight line' : 'on the paths'}</span>
      </div>
      <div className="codeBox column">
        <div>
          <b>{target.label}</b>
          <span className="fine block">
            {formatWalk(progress?.remaining ?? route.metres)} · {formatDistance(progress?.remaining ?? route.metres)} to go
            {progress?.remaining != null && route.metres > 0
              ? ` · ${Math.round(((route.metres - progress.remaining) / route.metres) * 100)}% walked`
              : ''}
          </span>
        </div>
        <button type="button" className="btn small" onClick={onStop}>
          Stop walking there
        </button>
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
          <li key={`${s.turn}-${s.atIndex}`} className={`stepRow ${i < current ? 'done' : ''} ${i === current ? 'now' : ''}`}>
            <button type="button" className="stepMain" onClick={() => onFocus({ lat: s.at[0], lng: s.at[1] })}>
              <span className={`stepGlyph ${s.turn}`} aria-hidden="true">
                {GLYPH[s.turn] || '↑'}
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
