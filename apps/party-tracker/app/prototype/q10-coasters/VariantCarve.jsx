'use client';

/* B — Ink carve. The park is stamped. You walk the unprinted paper. */

import { pathD } from './q10World.js';
import { ROAD_HALF, nodeWays, projectWays } from './q10Roads.js';

export const name = 'Ink carve';

function lineD(pts) {
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
}

export default function VariantCarve({ world, project, primary, onPick }) {
  const walk = nodeWays(projectWays(world.paths.filter((p) => p.rank === 'arterial'), project));
  const rails = world.tracks.map((t) => t.ring.map((pair) => project(pair[0], pair[1])));
  const hw = ROAD_HALF.overview.arterial;

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="Ink carve, walk the paper">
        <rect width="720" height="920" fill="#efe4cf" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#6e1f24" />
        ))}
        {world.wood.map((r, i) => (
          <path key={`w${i}`} d={pathD(r, project)} fill="#4a1418" />
        ))}
        {world.water.map((r, i) => (
          <path key={`wa${i}`} d={pathD(r, project)} fill="#efe4cf" />
        ))}
        {world.buildings.map((r, i) => (
          <path key={`b${i}`} d={pathD(r, project)} fill="#3a0f12" />
        ))}
        {walk.map((pts, i) => (
          <path
            key={`wk${i}`}
            d={lineD(pts)}
            fill="none"
            stroke="#efe4cf"
            strokeWidth={hw * 2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {rails.map((pts, i) => (
          <path
            key={`r${i}`}
            d={lineD(pts)}
            fill="none"
            stroke="#c9a227"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <text key={p.i} x={x} y={y} textAnchor="middle" style={S.label(on)} onClick={() => onPick(p.n)}>
              {p.n}
            </text>
          );
        })}
      </svg>
      <p style={S.note}>Woodblock: ink is the park. The pale cut is the midway. Gold is rail.</p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#efe4cf', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block' },
  label: (on) => ({
    font: `800 ${on ? 13 : 9}px var(--display), sans-serif`,
    fill: on ? '#efe4cf' : '#f3d27a',
    cursor: 'pointer',
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.35 var(--display), sans-serif',
    color: '#3d180f',
    background: '#e6d4b4',
  },
};
