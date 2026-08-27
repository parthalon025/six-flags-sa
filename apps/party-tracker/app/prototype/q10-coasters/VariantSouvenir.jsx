'use client';

/* A — Souvenir wash. Lands are the picture. Ride names are destinations. */

import { ownersOf, pathD, souvenirTint, spreadLandLabels, wrapLand } from './q10World.js';

export const name = 'Souvenir wash';

export default function VariantSouvenir({ world, project, primary, onPick }) {
  const loud = ownersOf(world.tracks, primary);
  const labels = spreadLandLabels(world.lands, world.anchors, project);
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Souvenir land map">
        <rect width="720" height="920" fill="#F6F0E2" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#DCE6C4" />
        ))}
        {world.lands.map((l) => {
          const t = souvenirTint(l.name);
          return (
            <path
              key={l.name}
              d={pathD(l.ring, project)}
              fill={t.fill}
              stroke={t.stroke}
              strokeWidth="1.2"
            />
          );
        })}
        {world.wood.map((r, i) => (
          <path key={`wo${i}`} d={pathD(r, project)} fill="#9BB57A" opacity="0.55" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#7EB6C9" />
        ))}
        {loud.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#E85D2C"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {world.lands.map((l) => {
          const at = labels[l.name];
          if (!at) return null;
          const t = souvenirTint(l.name);
          const lines = wrapLand(l.name);
          return (
            <text
              key={`ln-${l.name}`}
              x={at[0]}
              y={at[1]}
              textAnchor="middle"
              style={S.land(t.label)}
            >
              {lines.map((line, i) => (
                <tspan key={line} x={at[0]} dy={i ? 16 : 0}>{line}</tspan>
              ))}
            </text>
          );
        })}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 5.5 : 3.6} fill={on ? '#E85D2C' : '#2C3A2E'} />
              <text x={x + 7} y={y + 4} style={S.ride(on)}>{p.n}</text>
            </g>
          );
        })}
      </svg>
      <p style={S.note}>
        Printed-map calm. Lands carry the park. Ride names are the destination layer. Service and path spaghetti stay off.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block' },
  land: (fill) => ({
    font: '800 15px/1.05 var(--display), Georgia, serif',
    fill,
    letterSpacing: '0.04em',
    paintOrder: 'stroke',
    stroke: '#F6F0E2',
    strokeWidth: 4,
    pointerEvents: 'none',
  }),
  ride: (on) => ({
    font: `${on ? 700 : 500} ${on ? 12 : 10}px var(--display), sans-serif`,
    fill: on ? '#C4481C' : '#2C3A2E',
    paintOrder: 'stroke',
    stroke: '#F6F0E2',
    strokeWidth: 3,
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.4 var(--display), sans-serif',
    color: '#3d342c',
    background: '#EFE6D4',
  },
};
