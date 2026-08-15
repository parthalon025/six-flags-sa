'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Fade overlay when a venue map loads or switches.
 * Small interface: pass venue id, name, and loading flag from the venue store.
 */
export default function VenueLoadFade({ venueId, venueName, loading }) {
  const [phase, setPhase] = useState('hidden'); // hidden | in | out
  const [label, setLabel] = useState('');
  const prevId = useRef(venueId);
  const timer = useRef(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    clearTimer();
    if (!venueId) {
      setPhase('hidden');
      return undefined;
    }

    if (loading) {
      setLabel(venueName ? `Loading ${venueName}…` : 'Loading the map…');
      setPhase('in');
      return clearTimer;
    }

    const switched = prevId.current && prevId.current !== venueId;
    setLabel(venueName || 'Map ready');
    setPhase('in');
    const outAt = switched ? 900 : 700;
    const hideAt = switched ? 1500 : 1200;
    timer.current = setTimeout(() => setPhase('out'), outAt);
    const hideTimer = setTimeout(() => {
      setPhase('hidden');
      prevId.current = venueId;
    }, hideAt);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(hideTimer);
      timer.current = null;
    };
  }, [venueId, venueName, loading]);

  if (phase === 'hidden') return null;

  return (
    <div
      className={`venueLoadFade ${phase === 'out' ? 'out' : ''}`}
      aria-hidden={phase === 'out'}
      data-loading={loading ? '1' : undefined}
    >
      <span className="venueLoadFadeLabel">{label}</span>
    </div>
  );
}
