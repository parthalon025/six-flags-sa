'use client';

/* A — Destination board. Stars are names. No rails. */

import { pathD } from './q10World.js';

export const name = 'Names only';

export default function VariantA({ world, project, primary, onPick }) {
  return (
    <div style={S.grid}>
      <aside style={S.board}>
        <p style={S.kicker}>Kings Island · at rest</p>
        <h1 style={S.title}>The show is the name</h1>
        <p style={S.lede}>
          Park-wide reads like a playbill. Rails stay off until you pinch. Tap a star to make it the Compass primary.
        </p>
        <ol style={S.list}>
          {world.coasters.map((p) => {
            const on = p.n === primary;
            return (
              <li key={p.i}>
                <button type="button" onClick={() => onPick(p.n)} style={S.row(on)}>
                  <span style={S.dot(on)} />
                  <span>{p.n}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Quiet land map, no rails">
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#d9e3c8" />
        ))}
        {world.lands.map((l) => (
          <path key={l.name} d={pathD(l.ring, project)} fill="#c5d4b0" opacity="0.7" />
        ))}
        {world.water.map((r, i) => (
          <path key={`w${i}`} d={pathD(r, project)} fill="#9ec8d4" />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 7 : 4.5} fill={on ? '#E85D2C' : '#2c3a2e'} />
              <text x={x + 8} y={y + 4} style={S.pin(on)}>
                {p.n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const S = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 34%) 1fr',
    height: '100%',
    background: '#f4efe4',
  },
  board: {
    overflow: 'auto',
    padding: '28px 22px 88px',
    background: '#1a140c',
    color: '#f4efe4',
  },
  kicker: { margin: 0, font: '700 11px/1 var(--display), sans-serif', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#E85D2C' },
  title: { margin: '10px 0 8px', font: '800 34px/0.95 var(--display), sans-serif' },
  lede: { margin: '0 0 22px', font: '500 14px/1.45 var(--display), sans-serif', opacity: 0.72 },
  list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 },
  row: (on) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 10px',
    border: 0,
    borderRadius: 8,
    background: on ? '#E85D2C' : 'transparent',
    color: on ? '#1a140c' : '#f4efe4',
    font: '700 15px/1.2 var(--display), sans-serif',
    textAlign: 'left',
    cursor: 'pointer',
  }),
  dot: (on) => ({
    width: 8,
    height: 8,
    borderRadius: 99,
    background: on ? '#1a140c' : '#E85D2C',
    flex: 'none',
  }),
  svg: { width: '100%', height: '100%', display: 'block' },
  pin: (on) => ({
    font: `${on ? 700 : 500} ${on ? 12 : 10}px var(--display), sans-serif`,
    fill: on ? '#E85D2C' : '#2c3a2e',
  }),
};
