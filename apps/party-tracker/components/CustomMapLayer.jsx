'use client';

import { stackIsoItems } from '@party-tracker/shared/isoWorld.js';

/**
 * Custom-map paint — sits on or instead of the OSM base (see customMap.js).
 * ParkMap decides placement and camera; this file only draws the extra geometry.
 */

function BuildingMesh({ b }) {
  return (
    <g className="isoBuilding">
      <path className="isoFoot" d={b.foot.d} />
      {b.walls.map((w, wi) => (
        <path
          key={wi}
          className={w.side === 'L' ? 'isoWallL' : 'isoWallR'}
          d={w.d}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path className="isoRoof" d={b.roof.d} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function TrackMesh({ t, highlighted = false }) {
  return (
    <g className={highlighted ? 'isoCoaster isoCoasterSelected' : 'isoCoaster'}>
      <path className="isoShadow" d={t.shadow.d} vectorEffect="non-scaling-stroke" />
      {t.supports.map((s, si) => (
        <path key={si} className="isoSupport" d={s.d} vectorEffect="non-scaling-stroke" />
      ))}
      <path className="isoTrack" d={t.track.d} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function IsoMapLayer({ spec, buildings = [], tracks = [], highlightedTrackIds = [] }) {
  const stack = stackIsoItems(buildings, tracks);
  const highlighted = new Set(highlightedTrackIds);
  return (
    <g className={`lyr-custom lyr-iso-map lyr-${spec.id}`}>
      {stack.map((entry) =>
        entry.type === 'building' ? (
          <BuildingMesh key={`iso-b${entry.item.i}`} b={entry.item} />
        ) : (
          <TrackMesh
            key={`iso-c${entry.item.i}`}
            t={entry.item}
            highlighted={highlighted.has(entry.item.i)}
          />
        ),
      )}
    </g>
  );
}

export default function CustomMapLayer({
  spec,
  buildings = [],
  tracks = [],
  highlightedTrackIds = [],
}) {
  if (!spec) return null;
  const Layer = spec.renderer === 'iso' ? IsoMapLayer : null;
  if (!Layer) return null;
  return (
    <Layer
      spec={spec}
      buildings={buildings}
      tracks={tracks}
      highlightedTrackIds={highlightedTrackIds}
    />
  );
}
