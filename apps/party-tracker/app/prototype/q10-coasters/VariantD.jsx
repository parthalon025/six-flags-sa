'use client';

/* Google-plate prototype. Terrain + poured pavement + thin rail.
 * Examples: Kings Island on Google Maps — paths are one grey shape, not strokes. */

import { pathD } from './q10World.js';
import {
  PAVEMENT,
  PAVEMENT_EDGE,
  ROAD_HALF,
  TRAIL,
  junctionDiscs,
  nodeWays,
  projectWays,
  railTies,
} from './q10Roads.js';

export const name = 'Google plate';

function lineD(pts) {
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
}

function network(rows, project, rank, band) {
  const hw = ROAD_HALF[band]?.[rank] || 0;
  if (hw <= 0 || !rows.length) return { ribbons: [], discs: [], hw: 0 };
  const chains = nodeWays(projectWays(rows.filter((r) => r.rank === rank), project));
  return {
    ribbons: chains.map(lineD).filter(Boolean),
    discs: junctionDiscs(chains),
    hw,
  };
}

export default function VariantD({ world, project, primary, onPick, band }) {
  const layers = [
    network(world.service, project, 'service', band),
    network(world.paths, project, 'foot', band),
    network(world.paths, project, 'street', band),
    network(world.paths, project, 'arterial', band),
  ].filter((l) => l.hw);

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Google-like path plate">
        <rect width="720" height="920" fill="#d7e2c8" />
        {world.grass.map((r, i) => (
          <path key={`g${i}`} d={pathD(r, project)} fill="#cfe0bc" />
        ))}
        {world.wood.map((r, i) => (
          <path key={`wo${i}`} d={pathD(r, project)} fill="#b4c9a4" />
        ))}
        {world.parking.map((r, i) => (
          <path key={`pk${i}`} d={pathD(r, project)} fill="#d8d5ce" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#9dcee0" />
        ))}
        {layers.map((l, li) =>
          l.ribbons.map((d, i) => (
            <path
              key={`e${li}-${i}`}
              d={d}
              fill="none"
              stroke={PAVEMENT_EDGE}
              strokeWidth={l.hw * 2 + 1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}
        {layers.map((l, li) =>
          l.ribbons.map((d, i) => (
            <path
              key={`p${li}-${i}`}
              d={d}
              fill="none"
              stroke={l.hw <= 3.5 ? TRAIL : PAVEMENT}
              strokeWidth={l.hw * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}
        {layers.map((l, li) =>
          l.discs.map((p, i) => (
            <circle key={`j${li}-${i}`} cx={p[0]} cy={p[1]} r={l.hw} fill={PAVEMENT} />
          )),
        )}
        {world.buildings.map((r, i) => (
          <path key={`b${i}`} d={pathD(r, project)} fill="#f2f0ea" stroke="#d4d0c8" strokeWidth="0.4" />
        ))}
        {world.tracks.map((t) => {
          const pts = t.ring.map((pair) => project(pair[0], pair[1]));
          return (
            <g key={t.id}>
              <path d={lineD(pts)} fill="none" stroke="#5a5a5a" strokeWidth="1.15" strokeLinecap="round" />
              {railTies(pts).map((tie, i) => (
                <path
                  key={i}
                  d={`M${tie[0][0].toFixed(1)},${tie[0][1].toFixed(1)}L${tie[1][0].toFixed(1)},${tie[1][1].toFixed(1)}`}
                  stroke="#5a5a5a"
                  strokeWidth="0.7"
                />
              ))}
            </g>
          );
        })}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={on ? 5 : 3.4} fill="#7b4fc4" />
              <text x={x + 6} y={y + 3} style={S.label(on)}>
                {p.n}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={S.note}>
        Google plate: pale grass, woods, water, buildings. Pavement is one grey
        poured network (noded T-junctions + junction discs). Rails are thin track
        with ties — not roads.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#d7e2c8', display: 'flex', flexDirection: 'column' },
  svg: { flex: 1, width: '100%', display: 'block' },
  label: (on) => ({
    font: `${on ? 700 : 500} ${on ? 10 : 8}px var(--display), sans-serif`,
    fill: on ? '#4a2a86' : '#333',
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.35 var(--display), sans-serif',
    color: '#3d342c',
    background: '#ece6dc',
  },
};
