'use client';

import { formatDistance } from '@/lib/geo';

/* Between asking for a route and walking it there is a decision: is this the
   way I want to go? Both phone maps put that decision on a card with the
   options on it, and so does this — the routes are already drawn on the map
   behind it, and tapping either one here or there swaps the choice. */

function clockAt(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function RoutePreview({
  target,
  routes,
  index,
  onPick,
  onStart,
  onCancel,
  onSteps,
  profiles = [],
  profileId = 'default',
  onProfile,
  profileNote = null,
}) {
  if (!target || !routes?.length) return null;
  const route = routes[index] ?? routes[0];
  const best = routes[0];
  const minutes = Math.max(1, Math.round(route.seconds / 60));

  return (
    <section className="routePreview">
      <div className="previewHead">
        <div className="previewMain">
          <b>
            {minutes} <em>min</em>
          </b>
          <span>
            {formatDistance(route.metres)} · arrive {clockAt(route.seconds)}
          </span>
        </div>
        <button type="button" className="previewGo" onClick={onStart}>
          Start
        </button>
      </div>

      <p className="previewWhere">
        To <b>{target.label}</b>
        {route.via ? ` · via ${route.via}` : ''}
        {route.mode === 'direct' ? ' · no mapped path, straight line' : ''}
      </p>

      {profiles.length > 1 && (
        <div className="previewAlts" role="radiogroup" aria-label="Route profile">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === profileId}
              className={`previewAlt ${p.id === profileId ? 'on' : ''}`}
              onClick={() => onProfile?.(p.id)}
            >
              <b>{p.label}</b>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      )}
      {profileNote ? <p className="fine">{profileNote}</p> : null}

      {routes.length > 1 && (
        <div className="previewAlts" role="radiogroup" aria-label="Route choices">
          {routes.map((r, i) => {
            const delta = Math.round((r.seconds - best.seconds) / 60);
            return (
              <button
                key={r.via ? `${r.via}-${i}` : i}
                type="button"
                role="radio"
                aria-checked={i === index}
                className={`previewAlt ${i === index ? 'on' : ''}`}
                onClick={() => onPick(i)}
              >
                <b>{Math.max(1, Math.round(r.seconds / 60))} min</b>
                <span>
                  {i === 0 ? 'Fastest' : delta > 0 ? `+${delta} min` : 'Same time'}
                  {r.via ? ` · via ${r.via}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="previewFoot">
        <button type="button" className="previewLink" onClick={onSteps}>
          {route.steps.length} steps
        </button>
        <button type="button" className="previewLink" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
