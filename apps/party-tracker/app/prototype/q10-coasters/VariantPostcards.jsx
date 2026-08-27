'use client';

/* B — Pick a ride. The unit is a destination. Same souvenir plate. */

import LandPlate from './LandPlate.jsx';
import { landNamesOf, rideZone } from './q10World.js';

export const name = 'Pick a ride';

export default function VariantPostcards({ world, project, primary, onPick }) {
  const names = landNamesOf(world);
  const catalog = world.coasters.map((p, i) => ({
    ...p,
    num: i + 1,
    zone: rideZone(p, names) || 'Park',
  }));

  return (
    <div style={S.page}>
      <LandPlate
        world={world}
        project={project}
        primary={primary}
        onPick={onPick}
        rides="numbers"
      />
      <ol style={S.dock} data-prototype-state="">
        {catalog.map((p) => (
          <li key={p.i}>
            <button type="button" onClick={() => onPick(p.n)} style={S.btn(p.n === primary)}>
              <b>{p.num}</b>
              <span>{p.n}</span>
              <em>{p.zone}</em>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  dock: {
    margin: 0,
    padding: '8px 12px 88px',
    listStyle: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    background: '#EFE6D4',
  },
  btn: (on) => ({
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    border: on ? '1px solid #E85D2C' : '1px solid #c9bfb0',
    borderRadius: 999,
    padding: '5px 9px',
    background: on ? '#E85D2C' : '#F6F0E2',
    color: on ? '#fff' : '#2C3A2E',
    font: '700 12px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
