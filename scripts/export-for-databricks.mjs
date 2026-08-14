#!/usr/bin/env node
/**
 * Local dev export for Databricks bronze bootstrap.
 * Calls operator APIs and writes JSON under data/databricks/bronze/.
 *
 *   node scripts/export-for-databricks.mjs
 *   PARKBOUND_API_BASE=https://app.example node scripts/export-for-databricks.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'databricks', 'bronze');

const BASE = (process.env.PARKBOUND_API_BASE || process.env.GUEST_TRACES_API || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN || '';

async function fetchJson(url) {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const venues = ['kings-island', 'cedar-point', 'six-flags-fiesta-texas', 'big-kahunas'];

  const consolidate = await fetchJson(`${BASE}/api/admin/consolidate/export`);
  writeFileSync(path.join(OUT, 'consolidate-export.json'), JSON.stringify(consolidate, null, 2));

  for (const venueId of venues) {
    try {
      const traces = await fetchJson(
        `${BASE}/api/contributions/traces?venueId=${venueId}&format=geojson`,
      );
      writeFileSync(path.join(OUT, `guest-traces-${venueId}.geojson`), JSON.stringify(traces, null, 2));
    } catch (err) {
      console.warn(`traces ${venueId}: ${err.message}`);
    }
  }

  console.log(`Wrote bronze exports to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
