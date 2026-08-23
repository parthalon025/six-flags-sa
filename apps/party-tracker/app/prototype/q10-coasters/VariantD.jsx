'use client';

/* D ink + Google path LOD. Rails always on. Walk rank enters by band. */

import { pathD, walkVisible } from './q10World.js';

export const name = 'D + LOD';

const STROKE = {
  overview: { rail: 2.3, arterial: 2.05, street: 0, foot: 0, service: 0 },
  streets: { rail: 2.0, arterial: 1.7, street: 1.05, foot: 0, service: 0 },
  close: { rail: 1.7, arterial: 1.45, street: 1.0, foot: 0.75, service: 0.7 },
};

export default function VariantD({ world, project, primary, onPick, band }) {
  const w = STROKE[band] || STROKE.overview;
  const paths = world.paths.filter((p) => walkVisible(p.rank, band));
  const service = world.service.filter((p) => walkVisible(p.rank, band));

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label={`${band} path LOD on D ink`}>
        <rect width="720" height="920" fill="#f2f2f0" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#e8e8e4" />
        ))}
        {service.map((p) => (
          <path key={p.id} d={pathD(p.ring, project)} fill="none" stroke="#8aa07a" strokeWidth={w.service} />
        ))}
        {paths.map((p) => (
          <path
            key={p.id}
            d={pathD(p.ring, project)}
            fill="none"
            stroke={p.rank === 'arterial' ? '#6a6258' : '#b9b3a8'}
            strokeWidth={w[p.rank] || w.street}
            strokeLinecap="round"
          />
        ))}
        {world.tracks.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke={t.name ? '#c45a2e' : '#6a6a6a'}
            strokeWidth={w.rail}
            strokeLinecap="round"
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
        Google analog: arterial ≥ 160 m at overview · streets ≥ 25 m next · foot, queues, steps, service last.
        Rails stay. Camera crops toward {primary}.
      </p>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#f2f2f0', display: 'flex', flexDirection: 'column' },
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
