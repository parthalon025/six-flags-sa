/**
 * Execute wrapped external adapters by id (builder-side only).
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { OVERRIDE_DIR, VENUE_DIR, readJson } from '../venue-io.mjs';
import { getAdapter } from './index.mjs';
import { fetchWithBrowser } from './playwright-official.mjs';
import { loadParksApiData, parksApiCacheFile } from './parks-api.mjs';
import { exportTileGeoJson } from '../tiles-export.mjs';
import { graphFromSidecar } from '../evidence-graph.mjs';
import { renderEvidenceHtml } from '../venue-validate-html.mjs';

/** @typedef {import('./types.mjs').AdapterResult} AdapterResult */

export async function runAdapter(adapterId, ctx = {}) {
  const desc = getAdapter(adapterId);
  if (!desc) return { adapterId, ok: false, error: 'unknown_adapter' };
  if (desc.adopt === 'reject') {
    return {
      adapterId,
      ok: false,
      error: 'license_rejected',
      meta: { license: desc.license, notes: desc.notes },
    };
  }

  const venueId = ctx.venueId;
  switch (adapterId) {
    case 'playwright':
      if (!ctx.url) return { adapterId, ok: false, error: 'url_required' };
      try {
        const html = await fetchWithBrowser(ctx.url, { timeoutMs: ctx.timeoutMs });
        return { adapterId, ok: true, meta: { bytes: html.length }, html };
      } catch (err) {
        return { adapterId, ok: false, error: err.message };
      }

    case 'parks-api':
      if (!venueId) return { adapterId, ok: false, error: 'venueId_required' };
      try {
        const data = await loadParksApiData(venueId, { fetch: true });
        return {
          adapterId,
          ok: true,
          meta: { count: data.attractions?.length || 0 },
          artifacts: [parksApiCacheFile(venueId)],
          data,
        };
      } catch (err) {
        return { adapterId, ok: false, error: err.message };
      }

    case 'tippecanoe':
      if (!venueId) return { adapterId, ok: false, error: 'venueId_required' };
      const map = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), {});
      const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
      const outDir = ctx.outDir || path.join(OVERRIDE_DIR, `${venueId}.tiles`);
      const written = exportTileGeoJson(outDir, map, pois);
      return { adapterId, ok: true, artifacts: written, meta: { outDir } };

    case 'evidence-html':
      if (!venueId) return { adapterId, ok: false, error: 'venueId_required' };
      const sidecar = readJson(path.join(OVERRIDE_DIR, `${venueId}.attractions.json`), {});
      const mapMeta = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), {}).meta || {};
      const out = ctx.htmlPath || path.join(OVERRIDE_DIR, `${venueId}.evidence.html`);
      const html = renderEvidenceHtml({
        venueId,
        venueName: mapMeta.name || venueId,
        mapMeta,
        sidecar,
      });
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, html);
      return { adapterId, ok: true, artifacts: [out] };

    case 'evidence-graph':
      if (!venueId) return { adapterId, ok: false, error: 'venueId_required' };
      const sc = readJson(path.join(OVERRIDE_DIR, `${venueId}.attractions.json`), {});
      const graph = graphFromSidecar(sc);
      return { adapterId, ok: true, meta: graph.summary };

    default:
      return desc.run(ctx);
  }
}

export async function runAdapters(ids, ctx) {
  const results = [];
  for (const id of ids) {
    results.push(await runAdapter(id, ctx));
  }
  return results;
}
