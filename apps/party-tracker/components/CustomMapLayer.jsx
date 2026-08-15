'use client';

/**
 * Custom-map paint — sits on or instead of the OSM base (see customMap.js).
 * ParkMap decides placement and camera; this file only draws the extra geometry.
 */

function PixelTycoonLayer({ buildings = [], tracks = [] }) {
  return (
    <g className="lyr-custom lyr-pixel-tycoon">
      {buildings.map((b) => (
        <g key={`iso-b${b.i}`} className="isoBuilding">
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
      ))}
      {tracks.map((t) => (
        <g key={`iso-c${t.i}`} className="isoCoaster">
          <path className="isoShadow" d={t.shadow.d} vectorEffect="non-scaling-stroke" />
          {t.supports.map((s, si) => (
            <path key={si} className="isoSupport" d={s.d} vectorEffect="non-scaling-stroke" />
          ))}
          <path className="isoTrack" d={t.track.d} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
}

const LAYERS = {
  'pixel-tycoon': PixelTycoonLayer,
};

export default function CustomMapLayer({ spec, buildings = [], tracks = [] }) {
  if (!spec) return null;
  const Layer = LAYERS[spec.id];
  if (!Layer) return null;
  return <Layer buildings={buildings} tracks={tracks} />;
}
