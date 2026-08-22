'use client';

import { useEffect, useState } from 'react';
import { worldImageRect } from '@/lib/customMap';

/**
 * Custom-map paint — sits on or instead of the OSM base (see customMap.js).
 * ParkMap decides placement and camera; this file only draws the extra geometry.
 *
 * One renderer: `baked` draws the Visual factory's world image from the World's
 * display pack (ADR-0016) on its truth bounds, under the live overlay ParkMap
 * draws after this layer.
 *
 * There were two. `iso` assembled live SVG meshes from shared isoWorld —
 * depth-sorted building extrusions and lifted coaster tracks — for the one Skin
 * that declared it. ADR-0019 clause 6 retired it from the map path along with
 * the projection it existed to serve, and ADR-0021 reaffirmed the rejection of
 * keeping it for pixel-tycoon alone: "not two renderers forever". The iso
 * feeling is painted into the kit's sprites now, with a per-Skin camera preset
 * (packages/shared/mapCamera.js) turning the world a quarter-turn.
 *
 * This is the MAP path only. `isoWorld.js` and the Visual factory's
 * `--target iso` bake are a separate artefact path and are untouched by it.
 */

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
 * The sidecar is authoritative for projection; the CUSTOM_MAPS declaration is
 * the fallback. A sidecar declaring anything but `top-down` draws nothing
 * rather than a wrongly-placed plate: the rect below pins truth bounds to a
 * north-up rectangle, so any other projection would land the picture somewhere
 * the World is not. Since ADR-0019 clause 6 that is a guard against a stale
 * pack rather than a live second tier — every band bakes top-down.
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

export default function CustomMapLayer({ spec, venueId = null, worldOrigin = [0, 0] }) {
  if (!spec) return null;
  if (spec.renderer !== 'baked') return null;
  return <BakedWorldLayer spec={spec} venueId={venueId} worldOrigin={worldOrigin} />;
}
