'use client';

/* C — Quiet midways. Lands plus cream walkways. No grey Google pour. */

import { ownersOf, pathD, souvenirTint, spreadLandLabels, wrapLand } from './q10World.js';

export const name = 'Quiet midways';

export default function VariantMidway({ world, project, primary, onPick }) {
  const loud = ownersOf(world.tracks, primary);
  const labels = spreadLandLabels(world.lands, world.anchors, project);
  const midways = world.paths.filter((p) => p.rank === 'arterial');
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Land map with quiet midways">
        <rect width="720" height="920" fill="#F4EFE4" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#D7E2C6" />
        ))}
        {world.lands.map((l) => {
          const t = souvenirTint(l.name);
          return (
            <path
              key={l.name}
              d={pathD(l.ring, project)}
              fill={t.fill}
              stroke={t.stroke}
              strokeWidth="0.9"
            />
          );
        })}
        {world.wood.map((r, i) => (
          <path key={`wo${i}`} d={pathD(r, project)} fill="#8EAF6C" opacity="0.45" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#73AFC4" />
        ))}
        {world.buildings.map((r, i) => (
          <path key={`b${i}`} d={pathD(r, project)} fill="#E7DCC8" opacity="0.9" />
        ))}
        {midways.map((p) => (
          <path
            key={`e-${p.id}`}
            d={pathD(p.ring, project)}
            fill="none"
            stroke="#C9BBA4"
            strokeWidth="5.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {midways.map((p) => (
          <path
            key={`i-${p.id}`}
            d={pathD(p.ring, project)}
            fill="none"
            stroke="#F7F1E6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {loud.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#E85D2C"
            strokeWidth="2.2"
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
                <tspan key={line} x={at[0]} dy={i ? 15 : 0}>{line}</tspan>
              ))}
            </text>
          );
        })}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 5 : 3.2} fill={on ? '#E85D2C' : '#314037'} />
              <text x={x + 7} y={y + 4} style={S.ride(on)}>{p.n}</text>
            </g>
          );
        })}
      </svg>
      <p style={S.note}>
        {midways.length} arterial walkways in cream — enough to see how lands connect.
        Street, foot, and service stay off. Tap a ride to light its owner track.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F4EFE4', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block' },
  land: (fill) => ({
    font: '800 14px/1.05 var(--display), Georgia, serif',
    fill,
    letterSpacing: '0.03em',
    paintOrder: 'stroke',
    stroke: '#F4EFE4',
    strokeWidth: 3.5,
    pointerEvents: 'none',
  }),
  ride: (on) => ({
    font: `${on ? 700 : 500} ${on ? 11.5 : 9.5}px var(--display), sans-serif`,
    fill: on ? '#C4481C' : '#314037',
    paintOrder: 'stroke',
    stroke: '#F4EFE4',
    strokeWidth: 2.8,
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.4 var(--display), sans-serif',
    color: '#3d342c',
    background: '#E8DFCC',
  },
};
