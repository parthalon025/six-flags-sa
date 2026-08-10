'use client';

import { formatDistance } from '@/lib/geo';
import Icon from '@/components/Icon';

/* The bottom bar, in place of the sheet while a route is running: when you get
   there, how long it takes, how far, and the button that stops it. Arrival
   clock time is the headline because it is the number people actually act on —
   "we'll be there at 3:40" answers the question that "12 min" only implies. */

function clockAt(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const at = new Date(Date.now() + seconds * 1000);
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function NavBar({
  target,
  route,
  progress,
  voice,
  onVoice,
  northUp,
  onCompass,
  onSteps,
  onStop,
}) {
  if (!target || !route) return null;
  const remaining = progress?.remaining ?? route.metres;
  const seconds = progress?.seconds ?? route.seconds;
  const minutes = Math.max(1, Math.round(seconds / 60));

  return (
    <section className="navBar">
      <div className="navBarRow">
        <button type="button" className="navEnd" onClick={onStop}>
          Stop
        </button>
        <button type="button" className="navSummary" onClick={onSteps}>
          <b>{clockAt(seconds)}</b>
          <span>
            {minutes} min · {formatDistance(remaining)} · {target.label}
          </span>
        </button>
        <div className="navTools">
          <button
            type="button"
            className={`navTool ${voice ? 'on' : ''}`}
            onClick={onVoice}
            aria-pressed={voice}
            aria-label={voice ? 'Mute spoken directions' : 'Speak directions'}
          >
            <Icon name={voice ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} size={20} />
          </button>
          <button
            type="button"
            className={`navTool ${northUp ? '' : 'on'}`}
            onClick={onCompass}
            aria-label={northUp ? 'Turn the map with you' : 'Face the map north'}
          >
            <Icon name="location.north.fill" size={20} className="icn navCompass" />
          </button>
        </div>
      </div>
    </section>
  );
}
