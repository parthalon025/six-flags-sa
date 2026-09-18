#!/usr/bin/env node
/**
 * Operator loop: trace.json → georef fit → traced.geojson + georef-report (#417).
 *
 *   npm run venues:trace-fit -- kings-island
 *   npm run venues:trace-fit -- kings-island --wire --anyway
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  fitTraceDocument,
  runGeorefTraceLoop,
  traceFileForVenue,
  renderGeorefReportMarkdown,
} from '../lib/georef-trace-loop.mjs';
import { readJson } from '../lib/venue-io.mjs';

const USAGE = `
Fit a venue's trace.json and write traced.geojson + georef-report sidecars.

  npm run venues:trace-fit -- <venue-id> [options]

  --model <m>        similarity | affine | projective | tps | auto
  --smoothing <n>    tps smoothing (schematic maps default 0.25)
  --max-error <m>    refuse when CV RMS exceeds this (map_kind default)
  --map-kind <k>     to_scale | photo | schematic
  --anyway           write even when over budget or unverified
  --wire             add datasets.trace to sources.json after write
  --report           print georef-report.md to stdout
  --dry-run          fit and report only; do not write traced.geojson
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const next = argv[i + 1];
    if (eq !== -1) out[key] = a.slice(eq + 1);
    else if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }
  const venueId = args._[0];
  if (!venueId) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const opts = {
    wire: Boolean(args.wire),
    anyway: Boolean(args.anyway),
    model: args.model ? String(args.model) : undefined,
    smoothing: args.smoothing != null ? Number(args.smoothing) : undefined,
    maxErrorM: args['max-error'] != null ? Number(args['max-error']) : undefined,
    mapKind: args['map-kind'] ? String(args['map-kind']) : undefined,
  };

  if (args['dry-run']) {
    const traceFile = traceFileForVenue(venueId);
    if (!traceFile) {
      console.error(`No trace.json for ${venueId} — nothing to fit.`);
      return;
    }
    const trace = readJson(traceFile);
    const result = fitTraceDocument(trace, { ...opts, traceFile });
    if (args.report) console.log(renderGeorefReportMarkdown(result.report));
    else console.error(`Dry run — status ${result.status}${result.reason ? `: ${result.reason}` : ''}`);
    return;
  }

  const result = runGeorefTraceLoop(venueId, opts);
  if (result.status === 'skipped') {
    console.error(result.reason);
    return;
  }
  if (args.report && result.report) {
    console.log(renderGeorefReportMarkdown(result.report));
  }
  if (result.status === 'rejected') {
    throw new Error(result.reason || 'georef fit rejected — over error budget');
  }
  if (result.status !== 'ok') {
    throw new Error(result.reason || `georef trace loop failed (${result.status})`);
  }
  console.error(
    `Wrote ${result.tracedFile} and ${result.reportFile}`
      + `${result.wired?.wired ? `; wired ${result.wired.file}` : ''}`,
  );
  console.error(`Rebuild to fold traced features: npm run venues:rebuild -- ${venueId}`);
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
}
