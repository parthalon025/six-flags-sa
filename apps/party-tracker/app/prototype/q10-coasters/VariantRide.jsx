'use client';

/* A — Ride the quest. The camera is the coaster. */

import { useEffect, useMemo, useState } from 'react';
import {
  landPoint,
  longestOwner,
  pathD,
  projector,
  resampleRing,
  rideZone,
  souvenirTint,
} from './q10World.js';

export const name = 'Ride the quest';

export default function VariantRide({ world, primary, onPick }) {
  const track = useMemo(() => longestOwner(world.tracks, primary), [world.tracks, primary]);
  const samples = useMemo(() => resampleRing(track?.ring, 260), [track]);
  const [i, setI] = useState(0);
  const names = world.lands.map((l) => l.name);
  const dest = rideZone(world.coasters.find((p) => p.n === primary), names);

  useEffect(() => {
    setI(0);
    if (samples.length < 2) return undefined;
    let id = 0;
    let cur = 0;
    const tick = () => {
      cur = (cur + 1) % samples.length;
      setI(cur);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [samples]);

  const here = samples[i] || samples[0];
  const look = samples[Math.min(samples.length - 1, i + 8)] || here;
  const span = 0.0034;
  const project = here
    ? projector({
      minLng: here[0] - span,
      maxLng: here[0] + span,
      minLat: here[1] - span * 0.8,
      maxLat: here[1] + span * 0.8,
    }, 720, 720, 8)
    : null;

  const landNow = dest && here
    ? world.lands.find((l) => {
      const at = landPoint(world, l.name);
      if (!at) return false;
      return Math.hypot(at.lng - here[0], at.lat - here[1]) < 0.008;
    })?.name || dest
    : dest;

  if (!track || !project || !here) {
    return <p style={S.dock}>This ride has no owner track to fall through.</p>;
  }

  const [x, y] = project(here[0], here[1]);
  const [lx, ly] = project(look[0], look[1]);

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 720" style={S.svg} aria-label="Ride camera">
        <rect width="720" height="720" fill={souvenirTint(landNow || dest).fill} />
        {world.lands.map((l) => {
          const t = souvenirTint(l.name);
          return (
            <path
              key={l.name}
              d={pathD(l.ring, project)}
              fill={t.fill}
              stroke={t.stroke}
              strokeWidth="6"
              opacity={l.name === landNow ? 1 : 0.35}
            />
          );
        })}
        {world.wood.map((r, n) => (
          <path key={`w${n}`} d={pathD(r, project)} fill="#4a6a32" opacity="0.45" />
        ))}
        <path
          d={pathD(track.ring, project)}
          fill="none"
          stroke="#1a140c"
          strokeWidth="28"
          strokeLinecap="round"
        />
        <path
          d={pathD(track.ring, project)}
          fill="none"
          stroke="#E85D2C"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <line x1={x} y1={y} x2={lx} y2={ly} stroke="#fff" strokeWidth="3" />
        <circle cx={x} cy={y} r="11" fill="#fff" />
        <circle cx={x} cy={y} r="6" fill="#E85D2C" />
        <text x="36" y="80" style={S.huge}>{landNow}</text>
        <text x="36" y="130" style={S.ride}>{primary}</text>
      </svg>
      <div style={S.dock} data-prototype-state="">
        <b>You are the train.</b> North is gone. Pick another quest:
        {world.coasters.map((p) => (
          <button key={p.i} type="button" onClick={() => onPick(p.n)} style={S.btn(p.n === primary)}>
            {p.n}
          </button>
        ))}
      </div>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#1a140c', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block', minHeight: 0 },
  huge: {
    font: '800 42px/0.9 Georgia, serif',
    fill: '#1a140c',
    paintOrder: 'stroke',
    stroke: '#F6F0E2',
    strokeWidth: 10,
  },
  ride: {
    font: '800 22px var(--display), sans-serif',
    fill: '#E85D2C',
    paintOrder: 'stroke',
    stroke: '#F6F0E2',
    strokeWidth: 6,
  },
  dock: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    padding: '8px 12px 88px',
    background: '#1a140c',
    color: '#F6F0E2',
    font: '500 12px/1.3 var(--display), sans-serif',
  },
  btn: (on) => ({
    border: 0,
    borderRadius: 999,
    padding: '5px 9px',
    background: on ? '#E85D2C' : '#3a3024',
    color: '#fff',
    font: '700 11px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
