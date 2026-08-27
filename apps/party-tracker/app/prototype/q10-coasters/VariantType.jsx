'use client';

/* C — Type field. The names sit in the world. Almost no drawn geometry. */

import { pathD } from './q10World.js';

export const name = 'Type field';

export default function VariantType({ world, project, primary, onPick }) {
  const lands = world.lands || [];
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Typographic park">
        <rect width="720" height="920" fill="#f7f4ee" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="none" stroke="#d7cfc2" strokeWidth="0.7" />
        ))}
        {lands.map((l) => {
          const ring = l.ring || [];
          if (!ring.length) return null;
          const [x, y] = project(ring[0][0], ring[0][1]);
          return (
            <text key={l.name} x={x} y={y} style={S.land}>
              {String(l.name).toUpperCase()}
            </text>
          );
        })}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          const words = p.n.split(/\s+/);
          return (
            <text
              key={p.i}
              x={x}
              y={y}
              textAnchor="middle"
              style={S.ride(on)}
              onClick={() => onPick(p.n)}
            >
              {words.map((w, i) => (
                <tspan key={w} x={x} dy={i === 0 ? 0 : on ? 16 : 11}>
                  {w}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
      <p style={S.note}>Concrete poetry. A hairline park edge. No paths, no rails, no pavement.</p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#f7f4ee', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block' },
  land: {
    font: '700 8px var(--display), sans-serif',
    fill: '#c8b8a4',
    letterSpacing: '0.28em',
  },
  ride: (on) => ({
    font: `800 ${on ? 22 : 13}px/0.95 var(--display), sans-serif`,
    fill: on ? '#c45a2e' : '#1c1a17',
    cursor: 'pointer',
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.35 var(--display), sans-serif',
    color: '#3d342c',
    background: '#ebe4d6',
  },
};
