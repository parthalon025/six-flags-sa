'use client';

/* A — Night catalog. Constellation, not a street map. */

import { pathD } from './q10World.js';

export const name = 'Night catalog';

function starLinks(coasters, project) {
  const pts = coasters.map((p) => ({ p, xy: project(p.lng, p.lat) }));
  const edges = [];
  const seen = new Set();
  for (const a of pts) {
    const near = pts
      .filter((b) => b.p.i !== a.p.i)
      .map((b) => ({ b, d: Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    for (const { b } of near) {
      const key = [a.p.i, b.p.i].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a.xy, b.xy]);
    }
  }
  return edges;
}

export default function VariantNight({ world, project, primary, onPick }) {
  const links = starLinks(world.coasters, project);
  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Night catalog constellation">
        <rect width="720" height="920" fill="#070b16" />
        {world.wood.map((r, i) => (
          <path key={`w${i}`} d={pathD(r, project)} fill="#122033" opacity="0.85" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#0a1828" />
        ))}
        {links.map((e, i) => (
          <path
            key={i}
            d={`M${e[0][0].toFixed(1)},${e[0][1].toFixed(1)}L${e[1][0].toFixed(1)},${e[1][1].toFixed(1)}`}
            stroke="#d7c39a"
            strokeWidth="0.45"
            opacity="0.45"
          />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 3.6 : 1.7} fill={on ? '#ffe7a3' : '#f4f0e6'} />
              <circle cx={x} cy={y} r={on ? 9 : 5} fill={on ? '#ffe7a3' : '#c9d4e8'} opacity="0.16" />
              <text x={x + 7} y={y + 3} style={S.label(on)}>
                {p.n.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={S.note}>No pavement. The graph is a star catalog — nearest-ride lines, not walkways.</p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#070b16', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block' },
  label: (on) => ({
    font: `600 ${on ? 9 : 7}px var(--display), sans-serif`,
    fill: on ? '#ffe7a3' : '#8b93a7',
    letterSpacing: '0.14em',
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.35 var(--display), sans-serif',
    color: '#c9d0dc',
    background: '#0c1220',
  },
};
