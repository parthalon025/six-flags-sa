'use client';

/* C — Overworld. Hop lands on a board. Not a street map. */

import {
  landGraph,
  landNamesOf,
  neighborsOf,
  projector,
  ridesInZone,
  souvenirTint,
} from './q10World.js';

export const name = 'Overworld';

export default function VariantOverworld({ world, primary, land, onPick, onLand, seen }) {
  const graph = landGraph(world, 2);
  const names = landNamesOf(world);
  const here = land || graph.nodes[0]?.name;
  const open = new Set([here, ...neighborsOf(graph, here)]);
  const rides = ridesInZone(world.coasters, here, names);
  const project = projector(world.bounds, 720, 720, 48);
  const pts = Object.fromEntries(
    graph.nodes.map((n) => [n.name, project(n.lng, n.lat)]),
  );

  return (
    <div style={S.page}>
      <svg viewBox="0 0 720 720" style={S.svg} aria-label="Overworld land board">
        <rect width="720" height="720" fill="#F6F0E2" />
        {graph.edges.map(([a, b]) => {
          const pa = pts[a];
          const pb = pts[b];
          if (!pa || !pb) return null;
          const live = open.has(a) && open.has(b);
          return (
            <path
              key={`${a}|${b}`}
              d={`M${pa[0].toFixed(1)},${pa[1].toFixed(1)}L${pb[0].toFixed(1)},${pb[1].toFixed(1)}`}
              fill="none"
              stroke={live ? '#C9BBA4' : '#E0D6C2'}
              strokeWidth={live ? 8 : 4}
              strokeLinecap="round"
            />
          );
        })}
        {graph.nodes.map((n) => {
          const [x, y] = pts[n.name] || [0, 0];
          const t = souvenirTint(n.name);
          const standing = n.name === here;
          const reach = open.has(n.name);
          const charted = !seen || seen.has(n.name);
          return (
            <g key={n.name} onClick={() => reach && onLand(n.name)} style={{ cursor: reach ? 'pointer' : 'default' }}>
              <circle
                cx={x}
                cy={y}
                r={standing ? 34 : 26}
                fill={charted ? t.fill : '#E8E0D0'}
                stroke={standing ? '#E85D2C' : t.stroke}
                strokeWidth={standing ? 4 : 2}
                opacity={reach ? 1 : 0.4}
              />
              {standing ? (
                <polygon
                  points={`${x},${y - 10} ${x - 7},${y + 8} ${x + 7},${y + 8}`}
                  fill="#2C3A2E"
                />
              ) : null}
              <text x={x} y={y + 46} textAnchor="middle" style={S.land(t.label, reach)}>
                {charted ? n.name : '???'}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={S.dock} data-prototype-state="">
        <b>{here}</b>
        {rides.length === 0 ? (
          <span>No coasters on this node.</span>
        ) : rides.map((p) => (
          <button key={p.i} type="button" onClick={() => onPick(p.n)} style={S.btn(p.n === primary)}>
            {p.n}
          </button>
        ))}
      </div>
    </div>
  );
}

const S = {
  page: { height: '100%', background: '#F6F0E2', display: 'flex', flexDirection: 'column' },
  svg: { width: '100%', flex: 1, display: 'block', minHeight: 0 },
  land: (fill, reach) => ({
    font: '800 12px/1 var(--display), Georgia, serif',
    fill,
    opacity: reach ? 1 : 0.4,
    paintOrder: 'stroke',
    stroke: '#F6F0E2',
    strokeWidth: 3,
  }),
  dock: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    padding: '8px 12px 88px',
    background: '#EFE6D4',
    font: '500 12px/1.3 var(--display), sans-serif',
    color: '#3d342c',
  },
  btn: (on) => ({
    border: on ? '1px solid #E85D2C' : '1px solid #c9bfb0',
    borderRadius: 999,
    padding: '5px 9px',
    background: on ? '#E85D2C' : '#F6F0E2',
    color: on ? '#fff' : '#2C3A2E',
    font: '700 12px/1 var(--display), sans-serif',
    cursor: 'pointer',
  }),
};
