'use client';

/* B — Spotlight. One owner rail. The rest are quiet dots. */

import { ownersOf, pathD } from './q10World.js';

export const name = 'One rail';

export default function VariantB({ world, project, primary, onPick }) {
  const owners = ownersOf(world.tracks, primary);
  return (
    <div style={S.stage}>
      <svg viewBox="0 0 720 920" style={S.svg} aria-label="One owner rail on a dark park">
        <defs>
          <radialGradient id="q10vig" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="#1a2a38" />
            <stop offset="100%" stopColor="#070c12" />
          </radialGradient>
        </defs>
        <rect width="720" height="920" fill="url(#q10vig)" />
        {world.park.map((r, i) => (
          <path key={`p${i}`} d={pathD(r, project)} fill="#12202c" />
        ))}
        {world.water.map((r, i) => (
          <path key={`w${i}`} d={pathD(r, project)} fill="#16313d" />
        ))}
        {world.coasters.map((p) => {
          const [x, y] = project(p.lng, p.lat);
          const on = p.n === primary;
          if (on) return null;
          return <circle key={p.i} cx={x} cy={y} r={2.6} fill="#8aa0b3" opacity="0.45" />;
        })}
        {owners.map((t) => (
          <path
            key={t.id}
            d={pathD(t.ring, project)}
            fill="none"
            stroke="#FF6B35"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {world.coasters.filter((p) => p.n === primary).map((p) => {
          const [x, y] = project(p.lng, p.lat);
          return <circle key={p.i} cx={x} cy={y} r={8} fill="#FFC857" />;
        })}
      </svg>
      <div style={S.card}>
        <p style={S.kicker}>Compass primary</p>
        <h1 style={S.title}>{primary}</h1>
        <p style={S.note}>
          {owners.length
            ? `${owners.length} rail fragment${owners.length === 1 ? '' : 's'} joined by name.`
            : 'No named rail matches. Marker only.'}
        </p>
        <div style={S.picks}>
          {world.coasters.map((p) => (
            <button key={p.i} type="button" onClick={() => onPick(p.n)} style={S.chip(p.n === primary)}>
              {p.n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const S = {
  stage: { position: 'relative', height: '100%', background: '#070c12' },
  svg: { width: '100%', height: '100%', display: 'block' },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 88,
    padding: '18px 18px 16px',
    borderRadius: 16,
    background: 'rgba(7,12,18,.82)',
    color: '#e8f1f2',
    backdropFilter: 'blur(8px)',
  },
  kicker: { margin: 0, font: '700 11px/1 var(--display), sans-serif', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#FF6B35' },
  title: { margin: '8px 0 6px', font: '800 40px/0.9 var(--display), sans-serif' },
  note: { margin: '0 0 12px', font: '500 13px/1.4 var(--display), sans-serif', opacity: 0.7 },
  picks: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: (on) => ({
    border: 0,
    borderRadius: 999,
    padding: '5px 10px',
    background: on ? '#FF6B35' : '#1c2b38',
    color: on ? '#140a06' : '#d5e2ea',
    font: '700 11px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
