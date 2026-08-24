'use client';

/* C — Walk from the gate. The unit is the course. Same souvenir plate. */

import LandPlate from './LandPlate.jsx';
import { landNamesOf, rideZone } from './q10World.js';

export const name = 'Walk from the gate';

export default function VariantCourse({ world, project, primary, onPick, onLand }) {
  const names = landNamesOf(world);
  const dest = rideZone(world.coasters.find((p) => p.n === primary), names) || names[0];
  const arrival = names.includes('International Street') ? 'International Street' : names[0];
  const gate = world.gates?.find((g) => /main/i.test(g.n)) || world.gates?.[0];

  return (
    <div style={S.page}>
      <LandPlate
        world={world}
        project={project}
        primary={primary}
        onPick={onPick}
        onLand={onLand}
        midways
        dimLands={new Set([arrival, dest])}
        rides="dest"
        showGate
      />
      <p style={S.dock} data-prototype-state="">
        From {gate?.n || 'the gate'} through {arrival}, into {dest} for {primary}.
        Other lands stay as context. Tap a land to change the destination.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  dock: {
    margin: 0,
    padding: '8px 12px 88px',
    background: '#EFE6D4',
    font: '500 12px/1.4 var(--display), sans-serif',
    color: '#3d342c',
  },
};
