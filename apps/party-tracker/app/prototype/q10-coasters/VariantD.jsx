'use client';

/* D ink + Google path LOD. Stitched centerlines paint as wide round ribbons
 * (casing + fill) so junctions melt together — the same primitive MapLibre uses. */

import { pathD } from './q10World.js';
import { ROAD_CASE, ROAD_FILL, ROAD_HALF, projectWays, stitchWays } from './q10Roads.js';

export const name = 'D + LOD';

const RAIL = { overview: 2.4, streets: 2.1, close: 1.8 };

function lineD(pts) {
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
}

function ribbons(rows, project, rank, band) {
  const hw = ROAD_HALF[band]?.[rank] || 0;
  if (hw <= 0) return [];
  return stitchWays(projectWays(rows.filter((r) => r.rank === rank), project))
    .map(lineD)
    .filter(Boolean)
    .map((d) => ({ d, width: hw * 2 }));
}

export default function VariantD({ world, project, primary, onPick, band }) {
  const ranks = ['service', 'foot', 'street', 'arterial'];
  const layers = ranks.map((rank) => ({
    rank,
    ribbons: ribbons(rank === 'service' ? world.service : world.paths, project, rank, band),
  }));

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label={`${band} road ribbons on D ink`}>
        <rect width="720" height="920" fill="#7f9a6a" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#8eab74" />
        ))}
        {layers.map(({ rank, ribbons: rs }) =>
          rs.map((r, i) => (
            <path
              key={`c-${rank}-${i}`}
              d={r.d}
              fill="none"
              stroke={ROAD_CASE[rank]}
              strokeWidth={r.width + 2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}
        {layers.map(({ rank, ribbons: rs }) =>
          rs.map((r, i) => (
            <path
              key={`f-${rank}-${i}`}
              d={r.d}
              fill="none"
              stroke={ROAD_FILL[rank]}
              strokeWidth={r.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}
        {world.tracks.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke={t.name ? '#c45a2e' : '#5a5048'}
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
        Roads are ribbons: stitch shared ends, then a wide round-join casing + fill so
        junctions connect. Arterial widest. Rails stay thin on top.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#7f9a6a', display: 'flex', flexDirection: 'column' },
  svg: { flex: 1, width: '100%', display: 'block' },
  label: (on) => ({
    font: `${on ? 700 : 400} ${on ? 10 : 7}px var(--display), sans-serif`,
    fill: on ? '#7a2a10' : '#243018',
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
