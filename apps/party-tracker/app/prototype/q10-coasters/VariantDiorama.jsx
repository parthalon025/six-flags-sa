'use client';

/* C — Stage flats. The park as theater wings. Sideways, not north-up. */

import { arrivalLandOf, landPoint, rideZone, ridesInZone, souvenirTint } from './q10World.js';

export const name = 'Stage flats';

export default function VariantDiorama({ world, primary, onPick, onLand }) {
  const names = world.lands.map((l) => l.name);
  const dest = rideZone(world.coasters.find((p) => p.n === primary), names);
  const gateLand = arrivalLandOf(world);
  const rows = world.lands
    .map((l) => {
      const at = landPoint(world, l.name);
      return { land: l, lat: at?.lat ?? 0, lng: at?.lng ?? 0 };
    })
    .sort((a, b) => b.lat - a.lat);

  return (
    <div style={S.page}>
      <div style={S.stage} data-prototype-state="">
        {rows.map((row, i) => {
          const t = souvenirTint(row.land.name);
          const depth = i / Math.max(1, rows.length - 1);
          const rides = ridesInZone(world.coasters, row.land.name, names);
          const on = row.land.name === dest;
          const x = 8 + ((row.lng + 84.27) * 8000);
          return (
            <button
              key={row.land.name}
              type="button"
              onClick={() => onLand(row.land.name)}
              style={S.flat(t, depth, on, x)}
            >
              <span style={S.landName}>{row.land.name}</span>
              <span style={S.flags}>
                {rides.map((p) => (
                  <span
                    key={p.i}
                    role="presentation"
                    onClick={(e) => { e.stopPropagation(); onPick(p.n); }}
                    style={S.flag(p.n === primary)}
                  >
                    {p.n}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
        <div style={S.apron}>
          <b>FOOTLIGHTS · {gateLand}</b>
          <span>Quest {primary} lives upstage in {dest || 'the dark'}.</span>
        </div>
      </div>
    </div>
  );
}

const S = {
  page: {
    height: '100%',
    background: 'radial-gradient(ellipse at 50% 120%, #3a2418 0%, #0c0a08 70%)',
    overflow: 'hidden',
  },
  stage: {
    height: '100%',
    position: 'relative',
    perspective: 900,
    padding: '24px 24px 110px',
  },
  flat: (t, depth, on, x) => ({
    position: 'absolute',
    left: `${Math.max(4, Math.min(42, 12 + x * 0.02))}%`,
    right: `${8 + depth * 10}%`,
    top: `${8 + depth * 6}%`,
    height: `${18 + (1 - depth) * 10}%`,
    border: 0,
    background: t.fill,
    boxShadow: on
      ? `0 0 0 4px #E85D2C, 0 24px 40px rgba(0,0,0,.45)`
      : `0 18px 28px rgba(0,0,0,${0.25 + depth * 0.3})`,
    transform: `translateZ(${(1 - depth) * -180}px) rotateX(${8 + depth * 4}deg)`,
    transformOrigin: '50% 100%',
    textAlign: 'left',
    padding: '14px 18px',
    cursor: 'pointer',
    zIndex: Math.round((1 - depth) * 10),
  }),
  landName: {
    display: 'block',
    font: '800 28px/1 Georgia, serif',
    color: '#1a140c',
  },
  flags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  flag: (on) => ({
    font: '700 11px/1 var(--display), sans-serif',
    padding: '4px 7px',
    background: on ? '#E85D2C' : 'rgba(26,20,12,.12)',
    color: on ? '#fff' : '#1a140c',
    borderRadius: 3,
  }),
  apron: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 88,
    padding: '16px 20px',
    background: '#1a140c',
    color: '#E8DCC4',
    font: '500 13px/1.4 var(--display), sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
};
