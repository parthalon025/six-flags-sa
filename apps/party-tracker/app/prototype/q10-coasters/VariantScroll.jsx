'use client';

/* B — Unroll the park. Film of rooms from the gate. No north. */

import {
  landFocusBounds,
  landWalk,
  pathD,
  projector,
  ridesInZone,
  souvenirTint,
} from './q10World.js';

export const name = 'Unroll the park';

function Cell({ land, world, primary, onPick, onLand, index }) {
  const names = world.lands.map((l) => l.name);
  const crop = landFocusBounds(land, 0.08);
  const project = projector(crop, 420, 520, 10);
  const rides = ridesInZone(world.coasters, land.name, names);
  const t = souvenirTint(land.name);

  return (
    <article style={S.cell(t)} onClick={() => onLand(land.name)}>
      <p style={S.num}>ROOM {String(index + 1).padStart(2, '0')}</p>
      <svg viewBox="0 0 420 520" style={S.stamp} aria-hidden>
        <rect width="420" height="520" fill={t.fill} />
        <path d={pathD(land.ring, project)} fill={t.fill} stroke={t.label} strokeWidth="3" />
        {world.water.filter((r) => r.some((p) => (
          p[0] >= crop.minLng && p[0] <= crop.maxLng && p[1] >= crop.minLat && p[1] <= crop.maxLat
        ))).map((r, i) => (
          <path key={i} d={pathD(r, project)} fill="#5EA4BB" />
        ))}
      </svg>
      <h2 style={{ ...S.title, color: t.label }}>{land.name}</h2>
      <ul style={S.list}>
        {rides.map((p) => (
          <li key={p.i}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPick(p.n); }}
              style={S.ride(p.n === primary)}
            >
              {p.n}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function VariantScroll({ world, primary, onPick, onLand }) {
  const order = landWalk(world);
  const lands = order.map((name) => world.lands.find((l) => l.name === name)).filter(Boolean);

  return (
    <div style={S.page}>
      <p style={S.lede}>
        A scroll, not a map. The gate is frame 01. Slide sideways through the park.
      </p>
      <div style={S.film} data-prototype-state="">
        {lands.map((land, i) => (
          <Cell
            key={land.name}
            land={land}
            world={world}
            primary={primary}
            onPick={onPick}
            onLand={onLand}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#111', display: 'flex', flexDirection: 'column' },
  lede: {
    margin: 0,
    padding: '10px 16px 0',
    color: '#e8dcc4',
    font: '500 13px/1.4 var(--display), sans-serif',
  },
  film: {
    flex: 1,
    display: 'flex',
    gap: 0,
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    padding: '16px 0 96px',
  },
  cell: (t) => ({
    flex: '0 0 78vw',
    maxWidth: 440,
    scrollSnapAlign: 'start',
    margin: '0 8px',
    background: t.fill,
    border: `8px solid #111`,
    boxShadow: `inset 0 0 0 3px ${t.stroke}`,
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
  }),
  num: {
    margin: '10px 14px 0',
    font: '800 11px/1 var(--display), sans-serif',
    letterSpacing: '0.2em',
  },
  stamp: { width: '100%', height: 220, display: 'block' },
  title: { margin: '8px 14px 0', font: '800 36px/0.95 Georgia, serif' },
  list: { margin: '8px 10px 16px', padding: 0, listStyle: 'none' },
  ride: (on) => ({
    width: '100%',
    textAlign: 'left',
    border: 0,
    padding: '8px 6px',
    background: on ? '#E85D2C' : 'transparent',
    color: on ? '#fff' : '#1a140c',
    font: '700 16px/1.2 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
