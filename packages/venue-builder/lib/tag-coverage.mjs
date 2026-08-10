/**
 * Per-venue counts of path attributes in the built map.
 *
 * Honest copy for routing profiles: a wheelchair button with zero coverage is
 * worse than no button at all.
 */

import { WAY_FLAGS } from '@party-tracker/shared/wayFlags.js';
import { hasWayFlag } from '@party-tracker/shared/wayFlags.js';
import { ROUTED_LAYERS } from './osm-tags.mjs';

const countFlag = (ways, bit) => ways.filter((w) => hasWayFlag(w.f, bit)).length;
const countLayer = (ways) => ways.filter((w) => Number(w.l)).length;

/** Summarise tag coverage across path and service ways in a built map. */
export function tagCoverageFromMap(map) {
  const ways = [...ROUTED_LAYERS].flatMap((layer) => map[layer] || []);
  const total = ways.length;
  const steps = countFlag(ways, WAY_FLAGS.STEPS);
  const bridge = countFlag(ways, WAY_FLAGS.BRIDGE);
  const tunnel = countFlag(ways, WAY_FLAGS.TUNNEL);
  const oneway = countFlag(ways, WAY_FLAGS.ONEWAY) + countFlag(ways, WAY_FLAGS.ONEWAY_BACK);
  const restricted = countFlag(ways, WAY_FLAGS.RESTRICTED);
  const layered = countLayer(ways);

  let walkableKm = 0;
  for (const way of ways) {
    const ring = way.r || [];
    for (let i = 1; i < ring.length; i += 1) {
      const [lng0, lat0] = ring[i - 1];
      const [lng1, lat1] = ring[i];
      const dx = (lng1 - lng0) * 111320 * Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180));
      const dy = (lat1 - lat0) * 110540;
      walkableKm += Math.hypot(dx, dy) / 1000;
    }
  }

  return {
    ways: total,
    steps,
    bridge,
    tunnel,
    layer: layered,
    oneway,
    restricted,
    walkable_km: Math.round(walkableKm * 10) / 10,
  };
}
