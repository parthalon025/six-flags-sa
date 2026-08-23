'use client';

/* D — Raw survey. Every line the current map can dump at park-wide. */

import { pathD } from './q10World.js';

export const name = 'Every line';

export default function VariantD({ world, project, primary, onPick }) {
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="All rails, unnamed fragments, and service">
        <rect width="720" height="920" fill="#f2f2f0" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#e8e8e4" />
        ))}
        {world.paths.map((r, i) => (
          <path key={`pa${i}`} d={pathD(r, project)} fill="none" stroke="#b9b3a8" strokeWidth="0.6" />
        ))}
        {world.service.map((r, i) => (
          <path key={`s${i}`} d={pathD(r, project)} fill="none" stroke="#8aa07a" strokeWidth="0.7" />
        ))}
        {world.tracks.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke={t.name ? '#c45a2e' : '#6a6a6a'}
            strokeWidth="1.15"
            strokeLinecap="round"
          />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          return (
            <text key={p.i} x={x} y={y} style={S.tiny} onClick={() => onPick(p.n)}>
              {p.n}
            </text>
          );
        })}
      </svg>
      <p style={S.warn}>
        {world.tracks.length} rails ({world.tracks.filter((t) => !t.name).length} unnamed) · {world.service.length} service
        · {world.paths.length} paths. Primary ({primary}) is not louder. This is the spaghetti.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#f2f2f0', display: 'flex', flexDirection: 'column' },
  svg: { flex: 1, width: '100%', display: 'block' },
  tiny: { font: '400 7px system-ui, sans-serif', fill: '#333', cursor: 'pointer' },
  warn: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '600 12px/1.35 var(--display), sans-serif',
    color: '#5c2a1a',
    background: '#f3d6c8',
  },
};
