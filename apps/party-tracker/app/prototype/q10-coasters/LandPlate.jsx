'use client';

/* Shared souvenir plate. Jobs differ; paint does not. */

import {
  ownersOf,
  pathD,
  rideZone,
  souvenirTint,
  spreadLandLabels,
  wrapLand,
} from './q10World.js';

const PAPER = '#F6F0E2';

export default function LandPlate({
  world,
  project,
  primary,
  onPick,
  onLand,
  midways = false,
  dimLands = null,
  rides = 'names',
  destLand = null,
  showGate = false,
  height = 920,
}) {
  const names = world.lands.map((l) => l.name);
  const labels = spreadLandLabels(world.lands, world.anchors, project);
  const loud = ownersOf(world.tracks, primary);
  const dest = destLand || rideZone(world.coasters.find((p) => p.n === primary), names);
  const gate = world.gates?.find((g) => /main/i.test(g.n)) || world.gates?.[0];
  const numbered = world.coasters.map((p, i) => ({ ...p, num: i + 1 }));
  const walk = midways ? world.paths.filter((p) => p.rank === 'arterial') : [];

  const showRide = (p) => {
    if (rides === 'none') return false;
    if (rides === 'dest') return rideZone(p, names) === dest;
    return true;
  };

  return (
    <svg viewBox={`0 0 720 ${height}`} style={S.svg} aria-label="Souvenir land map">
      <rect width="720" height={height} fill={PAPER} />
      {world.park.map((r, i) => (
        <path key={`p${i}`} d={pathD(r, project)} fill="#DCE6C4" />
      ))}
      {world.lands.map((l) => {
        const t = souvenirTint(l.name);
        const dim = dimLands && !dimLands.has(l.name);
        return (
          <path
            key={l.name}
            d={pathD(l.ring, project)}
            fill={t.fill}
            stroke={t.stroke}
            strokeWidth="1.2"
            opacity={dim ? 0.28 : 1}
            onClick={onLand ? () => onLand(l.name) : undefined}
            style={onLand ? { cursor: 'pointer' } : undefined}
          />
        );
      })}
      {world.wood.map((r, i) => (
        <path key={`wo${i}`} d={pathD(r, project)} fill="#9BB57A" opacity="0.55" />
      ))}
      {world.water.map((r, i) => (
        <path key={`wa${i}`} d={pathD(r, project)} fill="#7EB6C9" />
      ))}
      {walk.map((p) => (
        <path
          key={`e-${p.id}`}
          d={pathD(p.ring, project)}
          fill="none"
          stroke="#C9BBA4"
          strokeWidth="5.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {walk.map((p) => (
        <path
          key={`i-${p.id}`}
          d={pathD(p.ring, project)}
          fill="none"
          stroke="#F7F1E6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {loud.map((t) => (
        <path
          key={t.id}
          d={pathD(t.ring, project)}
          fill="none"
          stroke="#E85D2C"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {world.lands.map((l) => {
        const at = labels[l.name];
        if (!at) return null;
        const t = souvenirTint(l.name);
        const dim = dimLands && !dimLands.has(l.name);
        const lines = wrapLand(l.name);
        return (
          <text
            key={`ln-${l.name}`}
            x={at[0]}
            y={at[1]}
            textAnchor="middle"
            style={S.land(t.label, dim)}
          >
            {lines.map((line, i) => (
              <tspan key={line} x={at[0]} dy={i ? 16 : 0}>{line}</tspan>
            ))}
          </text>
        );
      })}
      {showGate && gate ? (() => {
        const [x, y] = project(gate.lng, gate.lat);
        return (
          <g>
            <circle cx={x} cy={y} r="6" fill="#2C3A2E" />
            <text x={x + 9} y={y + 4} style={S.ride(false)}>{gate.n}</text>
          </g>
        );
      })() : null}
      {numbered.filter(showRide).map((p) => {
        const [x, y] = project(p.lng, p.lat);
        const on = p.n === primary;
        return (
          <g key={p.i} onClick={() => onPick(p.n)} style={{ cursor: 'pointer' }}>
            {rides === 'numbers' ? (
              <>
                <circle cx={x} cy={y} r={on ? 9 : 7.5} fill={on ? '#E85D2C' : '#2C3A2E'} />
                <text x={x} y={y + 4} textAnchor="middle" style={S.num}>{p.num}</text>
              </>
            ) : (
              <>
                <circle cx={x} cy={y} r={on ? 5.5 : 3.6} fill={on ? '#E85D2C' : '#2C3A2E'} />
                <text x={x + 7} y={y + 4} style={S.ride(on)}>{p.n}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const S = {
  svg: { width: '100%', flex: 1, display: 'block', minHeight: 0 },
  land: (fill, dim) => ({
    font: '800 15px/1.05 var(--display), Georgia, serif',
    fill,
    opacity: dim ? 0.45 : 1,
    letterSpacing: '0.04em',
    paintOrder: 'stroke',
    stroke: PAPER,
    strokeWidth: 4,
    pointerEvents: 'none',
  }),
  ride: (on) => ({
    font: `${on ? 700 : 500} ${on ? 12 : 10}px var(--display), sans-serif`,
    fill: on ? '#C4481C' : '#2C3A2E',
    paintOrder: 'stroke',
    stroke: PAPER,
    strokeWidth: 3,
  }),
  num: {
    font: '800 10px/1 var(--display), sans-serif',
    fill: PAPER,
    pointerEvents: 'none',
  },
};
