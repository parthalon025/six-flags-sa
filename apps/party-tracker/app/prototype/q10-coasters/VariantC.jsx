'use client';

/* C — Souvenir autograph. Every named rail, one loud owner. */

import { centroid, isOwner, pathD } from './q10World.js';

export const name = 'Named + owner';

export default function VariantC({ world, project, primary, onPick }) {
  const named = world.tracks.filter((t) => t.name);
  const quiet = named.filter((t) => !isOwner(t.name, primary));
  const loud = named.filter((t) => isOwner(t.name, primary));
  const labels = new Map();
  for (const t of named) {
    const key = t.name;
    if (labels.has(key)) continue;
    const at = centroid(t.ring, project);
    if (at) labels.set(key, at);
  }

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Named rails as a souvenir silhouette">
        <rect width="720" height="920" fill="#F7F4EC" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#e4e0d2" />
        ))}
        {world.lands.map((l, i) => (
          <path key={l.name} d={pathD(l.ring, project)} fill={LAND[i % LAND.length]} />
        ))}
        {world.water.map((r, i) => (
          <path key={`w${i}`} d={pathD(r, project)} fill="#c5dce2" />
        ))}
        {quiet.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#6b5344"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity="0.72"
          />
        ))}
        {loud.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#E85D2C"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {[...labels.entries()].map(([n, [x, y]]) => (
          <text
            key={n}
            x={x}
            y={y}
            textAnchor="middle"
            style={{
              font: `${n === primary ? 700 : 500} ${n === primary ? 11 : 8.5}px var(--display), sans-serif`,
              fill: n === primary ? '#E85D2C' : '#4a3d34',
            }}
          >
            {n}
          </text>
        ))}
      </svg>
      <div style={S.caption}>
        <b>Printed-map calm.</b> Unnamed fragments stay off. Service stays off.
        <span style={S.picks}>
          {world.coasters.map((p) => (
            <button key={p.i} type="button" onClick={() => onPick(p.n)} style={S.chip(p.n === primary)}>
              {p.n}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

const LAND = ['#d7e4c5', '#ead9b3', '#e4cfc4', '#cfe0d8', '#d8d3e6'];

const S = {
  page: { height: '100%', background: '#F7F4EC', display: 'flex', flexDirection: 'column' },
  svg: { flex: 1, width: '100%', display: 'block' },
  caption: {
    padding: '10px 14px 88px',
    font: '500 13px/1.4 var(--display), sans-serif',
    color: '#3d342c',
  },
  picks: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  chip: (on) => ({
    border: on ? '1px solid #E85D2C' : '1px solid #c9bfb0',
    borderRadius: 999,
    padding: '4px 8px',
    background: on ? '#E85D2C' : '#fff',
    color: on ? '#fff' : '#3d342c',
    font: '700 11px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
