'use client';

/* B — Land poster. Districts shout. Rides are a numbered catalog. */

import { ownersOf, pathD, souvenirTint, spreadLandLabels, wrapLand } from './q10World.js';

export const name = 'Land poster';

export default function VariantPoster({ world, project, primary, onPick }) {
  const loud = ownersOf(world.tracks, primary);
  const labels = spreadLandLabels(world.lands, world.anchors, project, 48);
  const catalog = world.coasters.map((p, i) => ({ ...p, num: i + 1 }));
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Land poster with numbered rides">
        <rect width="720" height="920" fill="#FBF6EA" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#CFE3B4" />
        ))}
        {world.lands.map((l) => {
          const t = souvenirTint(l.name);
          return (
            <path
              key={l.name}
              d={pathD(l.ring, project)}
              fill={t.fill}
              stroke={t.stroke}
              strokeWidth="2.2"
            />
          );
        })}
        {world.wood.map((r, i) => (
          <path key={`wo${i}`} d={pathD(r, project)} fill="#7FA05C" opacity="0.4" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#5EA4BB" />
        ))}
        {loud.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#E85D2C"
            strokeWidth="2.8"
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
              y={at[1] - (lines.length > 1 ? 8 : 0)}
              textAnchor="middle"
              style={S.land(t.label)}
            >
              {lines.map((line, i) => (
                <tspan key={line} x={at[0]} dy={i ? 22 : 0}>{line.toUpperCase()}</tspan>
              ))}
            </text>
          );
        })}
        {catalog.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 10 : 8} fill={on ? '#E85D2C' : '#1F2A22'} />
              <text x={x} y={y + 4} textAnchor="middle" style={S.num}>{p.num}</text>
            </g>
          );
        })}
      </svg>
      <aside style={S.legend} data-prototype-state="">
        <p style={S.kicker}>Ride catalog</p>
        <ol style={S.list}>
          {catalog.map((p) => (
            <li key={p.i}>
              <button type="button" onClick={() => onPick(p.n)} style={S.row(p.n === primary)}>
                <b>{p.num}</b>
                <span>{p.n}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#FBF6EA', display: 'grid', gridTemplateColumns: '1fr minmax(220px, 28%)' },
  svg: { width: '100%', height: '100%', display: 'block' },
  land: (fill) => ({
    font: '800 20px/1 var(--display), Georgia, serif',
    fill,
    letterSpacing: '0.08em',
    paintOrder: 'stroke',
    stroke: 'rgba(251,246,234,0.88)',
    strokeWidth: 6,
    pointerEvents: 'none',
  }),
  num: {
    font: '800 10px/1 var(--display), sans-serif',
    fill: '#FBF6EA',
    pointerEvents: 'none',
  },
  legend: {
    overflow: 'auto',
    padding: '16px 14px 88px',
    background: '#1F2A22',
    color: '#FBF6EA',
  },
  kicker: {
    margin: '0 0 10px',
    font: '700 11px/1 var(--display), sans-serif',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#E85D2C',
  },
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 },
  row: (on) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 8px',
    border: 0,
    borderRadius: 8,
    background: on ? '#E85D2C' : 'transparent',
    color: on ? '#1F2A22' : '#FBF6EA',
    font: '600 13px/1.2 var(--display), sans-serif',
    textAlign: 'left',
    cursor: 'pointer',
  }),
};
