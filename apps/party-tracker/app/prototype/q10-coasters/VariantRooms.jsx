'use client';

/* A — Enter a land. The unit is a district. Same souvenir plate. */

import LandPlate from './LandPlate.jsx';
import {
  landFocusBounds,
  landNamesOf,
  projector,
  ridesInZone,
  souvenirTint,
} from './q10World.js';

export const name = 'Enter a land';

export default function VariantRooms({ world, primary, land, onPick, onLand }) {
  const names = landNamesOf(world);
  const focus = world.lands.find((l) => l.name === land) || world.lands[0];
  const project = projector(landFocusBounds(focus), 720, 720, 36);
  const rides = ridesInZone(world.coasters, focus.name, names);
  const tint = souvenirTint(focus.name);

  return (
    <div style={S.page}>
      <div style={S.chips} data-prototype-state="">
        {world.lands.map((l) => {
          const t = souvenirTint(l.name);
          const on = l.name === focus.name;
          return (
            <button key={l.name} type="button" onClick={() => onLand(l.name)} style={S.chip(on, t)}>
              {l.name}
            </button>
          );
        })}
      </div>
      <LandPlate
        world={world}
        project={project}
        primary={primary}
        onPick={onPick}
        onLand={onLand}
        midways
        dimLands={new Set([focus.name])}
        rides="dest"
        destLand={focus.name}
        height={720}
      />
      <div style={S.dock}>
        <b style={{ color: tint.label }}>{focus.name}</b>
        {rides.length === 0 ? (
          <span>No coasters in this land.</span>
        ) : rides.map((p) => (
          <button key={p.i} type="button" onClick={() => onPick(p.n)} style={S.btn(p.n === primary)}>
            {p.n}
          </button>
        ))}
      </div>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px 4px' },
  chip: (on, t) => ({
    border: `1px solid ${on ? t.label : '#E0D6C2'}`,
    borderRadius: 999,
    padding: '5px 10px',
    background: on ? t.fill : '#F6F0E2',
    color: t.label,
    font: '700 12px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
  dock: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    padding: '8px 12px 88px',
    background: '#EFE6D4',
    font: '500 12px/1.3 var(--display), sans-serif',
    color: '#3d342c',
  },
  btn: (on) => ({
    border: on ? '1px solid #E85D2C' : '1px solid #c9bfb0',
    borderRadius: 999,
    padding: '5px 9px',
    background: on ? '#E85D2C' : '#F6F0E2',
    color: on ? '#fff' : '#2C3A2E',
    font: '700 12px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
