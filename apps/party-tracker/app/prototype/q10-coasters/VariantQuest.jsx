'use client';

/* A — Quest map. Pause-menu cartograph. Same souvenir lands. */

import LandPlate from './LandPlate.jsx';
import { arrivalLandOf, rideZone } from './q10World.js';

export const name = 'Quest map';

export default function VariantQuest({ world, project, primary, onPick, onLand }) {
  const names = world.lands.map((l) => l.name);
  const dest = rideZone(world.coasters.find((p) => p.n === primary), names);
  const here = arrivalLandOf(world);

  return (
    <div style={S.page}>
      <div style={S.banner} data-prototype-state="">
        <span style={S.kicker}>QUEST</span>
        <strong>{primary}</strong>
        <span>in {dest || 'the park'} · you are at {here}</span>
      </div>
      <div style={S.stage}>
        <LandPlate
          world={world}
          project={project}
          primary={primary}
          onPick={onPick}
          onLand={onLand}
          midways
          rides="dest"
          quest
          player
        />
        <svg viewBox="0 0 120 120" style={S.compass} aria-hidden>
          <circle cx="60" cy="60" r="46" fill="#F6F0E2" stroke="#2C3A2E" strokeWidth="2" />
          <polygon points="60,18 66,60 60,54 54,60" fill="#E85D2C" />
          <polygon points="60,102 66,60 60,66 54,60" fill="#2C3A2E" />
          <text x="60" y="16" textAnchor="middle" style={S.n}>N</text>
        </svg>
      </div>
      <p style={S.dock}>
        Pause-menu map. The diamond is the quest. The triangle is you, at the gate.
        Lands stay the picture. Tap a ride to retarget the quest.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  banner: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    padding: '10px 14px',
    background: '#2C3A2E',
    color: '#F6F0E2',
    font: '500 13px/1.2 var(--display), sans-serif',
  },
  kicker: {
    font: '800 11px/1 var(--display), sans-serif',
    letterSpacing: '0.18em',
    color: '#E85D2C',
  },
  stage: { flex: 1, minHeight: 0, position: 'relative', display: 'flex' },
  compass: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 72,
    height: 72,
    pointerEvents: 'none',
  },
  n: { font: '800 10px var(--display), sans-serif', fill: '#2C3A2E' },
  dock: {
    margin: 0,
    padding: '8px 12px 88px',
    background: '#EFE6D4',
    font: '500 12px/1.4 var(--display), sans-serif',
    color: '#3d342c',
  },
};
