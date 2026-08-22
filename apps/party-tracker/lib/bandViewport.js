/**
 * Which bands the viewport should hold versus request.
 *
 * ADR-0021 clause 5: bands stream by viewport; the mid band in the pack is
 * the offline floor. A camera that wants overview or close does not make
 * those bands held — it names them to fetch. Until the bytes arrive, the
 * seam keeps drawing the parent it already has (the packed mid).
 *
 * This module is the pure half. I/O stays with the caller.
 */

import { bandForZoom, parentOf } from '@party-tracker/shared/zoomBands.js';

export const PACKED_BANDS = Object.freeze(['mid']);

const ORDER = Object.freeze(['overview', 'mid', 'close']);

/**
 * @param {{ zoom?: number, latitude?: number, packedBands?: string[], streamedBands?: string[] }} opts
 * @returns {{ hold: string[], request: string[] }}
 */
export function bandsForViewport({
  zoom,
  latitude,
  packedBands = PACKED_BANDS,
  streamedBands = [],
} = {}) {
  const packed = new Set(packedBands);
  const streamed = new Set(streamedBands);
  const request = new Set(packed);
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    const primary = bandForZoom(zoom, { latitude });
    if (primary) {
      request.add(primary);
      const parent = parentOf(primary);
      if (parent) request.add(parent);
    }
  }
  const hold = new Set(
    [...request].filter((id) => packed.has(id) || streamed.has(id)),
  );
  return {
    hold: ORDER.filter((id) => hold.has(id)),
    request: ORDER.filter((id) => request.has(id)),
  };
}

/**
 * Subscribe a camera getter to held-band changes.
 *
 * `onHeldChange` receives only bands the device actually has. `onRequestChange`
 * receives the bands the viewport wants fetched. Marking one arrived is
 * `received(id)` — that is the only way a streamed band enters `hold`.
 *
 * @param {{ world: { bounds?: { south?: number, north?: number } },
 *           onHeldChange: (ids: string[]) => void,
 *           onRequestChange?: (ids: string[]) => void,
 *           getCamera: () => { zoom?: number },
 *           packedBands?: string[] }} opts
 */
export function createBandViewport({
  world,
  onHeldChange,
  onRequestChange,
  getCamera,
  packedBands = PACKED_BANDS,
} = {}) {
  const latitude = ((world?.bounds?.south ?? 0) + (world?.bounds?.north ?? 0)) / 2;
  const streamed = new Set();
  let lastHold = '';
  let lastRequest = '';
  const tick = () => {
    const camera = typeof getCamera === 'function' ? getCamera() : {};
    const ids = bandsForViewport({
      zoom: camera?.zoom,
      latitude,
      packedBands,
      streamedBands: [...streamed],
    });
    const holdKey = ids.hold.join(',');
    const requestKey = ids.request.join(',');
    if (holdKey !== lastHold) {
      lastHold = holdKey;
      onHeldChange?.(ids.hold);
    }
    if (requestKey !== lastRequest) {
      lastRequest = requestKey;
      onRequestChange?.(ids.request);
    }
    return ids;
  };
  const received = (id) => {
    if (typeof id === 'string' && id) streamed.add(id);
    return tick();
  };
  tick();
  return { tick, received, latitude };
}

/**
 * Fetch streamed band archives the viewport asked for. `received` is the
 * only way those bytes enter hold — HEAD-ok is enough to mark arrival.
 */
export function requestStreamedBands({
  request = [],
  world,
  received,
  fetchFn = globalThis.fetch,
} = {}) {
  const jobs = [];
  for (const id of request) {
    const url = world?.bands?.[id]?.pmtiles;
    if (!url || typeof received !== 'function') continue;
    jobs.push(
      Promise.resolve(fetchFn(url, { method: 'HEAD' }))
        .then((res) => {
          if (res?.ok) received(id);
        })
        .catch(() => {}),
    );
  }
  return Promise.all(jobs);
}
