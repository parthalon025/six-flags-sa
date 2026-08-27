'use client';

/* B — Fog atlas. Chart lands to paint them. Same souvenir plate. */

import LandPlate from './LandPlate.jsx';

export const name = 'Fog atlas';

export default function VariantFog({ world, project, primary, onPick, onLand, seen }) {
  const charted = seen?.size || 0;
  const total = world.lands.length;

  return (
    <div style={S.page}>
      <div style={S.meter} data-prototype-state="">
        <b>{charted} / {total} lands charted</b>
        <span style={S.bar}>
          <i style={{ ...S.fill, width: `${(charted / total) * 100}%` }} />
        </span>
        <span>Tap a blank district to chart it.</span>
      </div>
      <LandPlate
        world={world}
        project={project}
        primary={primary}
        onPick={onPick}
        onLand={onLand}
        midways
        revealed={seen}
        rides="names"
        player
        quest
      />
      <p style={S.dock}>
        Exploration map. Unvisited lands stay paper. Charting does not invent geometry —
        it only paints a land you already have.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  meter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    font: '600 12px/1 var(--display), sans-serif',
    color: '#3d342c',
  },
  bar: {
    flex: 1,
    height: 8,
    background: '#E0D6C2',
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: { display: 'block', height: '100%', background: '#2C3A2E' },
  dock: {
    margin: 0,
    padding: '8px 12px 88px',
    background: '#EFE6D4',
    font: '500 12px/1.4 var(--display), sans-serif',
    color: '#3d342c',
  },
};
