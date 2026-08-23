'use client';

/* D ink + Google path LOD. Roads are stitched, buffered shapes — not hairlines. */

import { pathD } from './q10World.js';
import {
  ROAD_CASE,
  ROAD_FILL,
  ROAD_HALF,
  bufferWay,
  polyD,
  projectWays,
  stitchWays,
} from './q10Roads.js';

export const name = 'D + LOD';

const RAIL = { overview: 2.3, streets: 2.0, close: 1.7 };

function roadShapes(rows, project, rank, band) {
  const hw = ROAD_HALF[band]?.[rank] || 0;
  if (hw <= 0) return [];
  const stitched = stitchWays(projectWays(rows.filter((r) => r.rank === rank), project));
  return stitched
    .map((pts) => ({ caseD: polyD(bufferWay(pts, hw + 1.1)), fillD: polyD(bufferWay(pts, hw)) }))
    .filter((s) => s.fillD);
}

export default function VariantD({ world, project, primary, onPick, band }) {
  const ranks = ['service', 'foot', 'street', 'arterial'];
  const layers = ranks.map((rank) => ({
    rank,
    shapes: roadShapes(
      rank === 'service' ? world.service : world.paths,
      project,
      rank,
      band,
    ),
  }));

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label={`${band} road shapes on D ink`}>
        <rect width="720" height="920" fill="#e4ddd0" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#cfc8b8" />
        ))}
        {layers.map(({ rank, shapes }) =>
          shapes.map((s, i) => (
            <path key={`c-${rank}-${i}`} d={s.caseD} fill={ROAD_CASE[rank]} />
          )),
        )}
        {layers.map(({ rank, shapes }) =>
          shapes.map((s, i) => (
            <path key={`f-${rank}-${i}`} d={s.fillD} fill={ROAD_FILL[rank]} />
          )),
        )}
        {world.tracks.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke={t.name ? '#c45a2e' : '#6a6a6a'}
            strokeWidth={RAIL[band] || 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          return (
            <text key={p.i} x={x} y={y} style={S.label(on)} onClick={() => onPick(p.n)}>
              {p.n}
            </text>
          );
        })}
      </svg>
      <p style={S.note}>
        Roads are shapes: ways that share an end stitch, then buffer to a width.
        Arterial widest · street next · foot and service last. Rails stay lines.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#e4ddd0', display: 'flex', flexDirection: 'column' },
  svg: { flex: 1, width: '100%', display: 'block' },
  label: (on) => ({
    font: `${on ? 700 : 400} ${on ? 10 : 7}px var(--display), sans-serif`,
    fill: on ? '#c45a2e' : '#333',
    cursor: 'pointer',
  }),
  note: {
    margin: 0,
    padding: '8px 14px 88px',
    font: '500 12px/1.35 var(--display), sans-serif',
    color: '#3d342c',
    background: '#ece6dc',
  },
};
