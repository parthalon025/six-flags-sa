'use client';

import { useEffect, useState } from 'react';
import { stackIsoItems } from '@party-tracker/shared/isoWorld.js';
import { worldImageRect } from '@/lib/customMap';

/**
 * Custom-map paint — sits on or instead of the OSM base (see customMap.js).
 * ParkMap decides placement and camera; this file only draws the extra geometry.
 *
 * Two renderers: `iso` assembles live SVG meshes; `baked` draws the Visual
 * factory's world image from the World's display pack (ADR-0016) on its
 * truth bounds, under the live overlay ParkMap draws after this layer.
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

/* Sidecar fetches, cached for the session — a Wear toggle must not refetch
   a file the phone already holds, and a venue without a baked world must
   answer "none" once, not on every render. */
const worldSidecars = new Map();
function fetchWorldSidecar(url) {
  if (!worldSidecars.has(url)) {
    worldSidecars.set(
      url,
      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    );
  }
  return worldSidecars.get(url);
}

/**
 * The baked world: one <image> in venue-local mercator metres, positioned by
 * the truth bounds the pack sidecar echoes — the hillshade mechanism, not
 * tiling. The mapWorld transform is y-up (scale(s, -s)), so the image nests
 * in its own y-flip; lat→metre is linear over a park bbox, which keeps the
 * corner-pinned stretch inside the world's certified displacement budget.
 *
 * The sidecar is authoritative for projection; the CUSTOM_MAPS declaration
 * is the fallback. Iso worlds (per-rotation images) declare `iso` and pick
 * the image matching the current rotation once a pack ships one — their
 * screen placement block rides the iso pack tier, so until then an iso
 * declaration draws nothing rather than a wrongly-placed plate.
 */
function BakedWorldLayer({ spec, venueId, worldOrigin = [0, 0] }) {
  const url = venueId ? `/venues/${venueId}/display/${spec.id}.world.json` : null;
  // Answers are keyed by url so a venue/Skin switch never shows the previous
  // world while the new sidecar is in flight — no state reset needed.
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!url) return undefined;
    fetchWorldSidecar(url).then((sidecar) => {
      if (alive) setAnswer({ url, sidecar });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  const world = answer && answer.url === url ? answer.sidecar : null;
  const bounds = world?.bounds;
  if (!bounds || !world.file) return null;
  const projection = world.projection || spec.world?.projection || 'top-down';
  if (projection !== 'top-down') return null;
  const rect = worldImageRect(bounds, worldOrigin);
  if (!rect) return null;
  return (
    <g className={`lyr-custom lyr-baked-world lyr-${spec.id}`} transform="scale(1,-1)">
      <image
        href={`/venues/${venueId}/display/${world.file}`}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        preserveAspectRatio="none"
      />
    </g>
  );
}

export default function CustomMapLayer({
  spec,
  buildings = [],
  tracks = [],
  highlightedTrackIds = [],
  venueId = null,
  worldOrigin = [0, 0],
}) {
  if (!spec) return null;
  if (spec.renderer === 'baked') {
    return <BakedWorldLayer spec={spec} venueId={venueId} worldOrigin={worldOrigin} />;
  }
  if (spec.renderer !== 'iso') return null;
  return (
    <IsoMapLayer
      spec={spec}
      buildings={buildings}
      tracks={tracks}
      highlightedTrackIds={highlightedTrackIds}
    />
  );
}
