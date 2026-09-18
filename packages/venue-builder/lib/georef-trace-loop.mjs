/**
 * Georef trace→fit operator loop — one venue id in, traced GeoJSON + report out (#417).
 *
 * The trace-venue CLI and georef library already knew how to fit a trace file;
 * this module is the seam for "given a venue, run the loop" so pipeline,
 * inspect, and operators share one path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compare, crossValidate, fit } from './georef.mjs';
import {
  ensureTraceDatasetWired,
  resolveTraceGeorefOptions,
  traceTemplateFile,
  tracedGeoJsonFile,
} from './official-map.mjs';
import { OVERRIDE_DIR, readJson, venueSidecarRel, writeJson } from './venue-io.mjs';
import { readManifest } from '../src/compare.mjs';
import { MANIFEST_FILE } from '../src/paths.mjs';
import { toGeoJson, validate } from '../bin/trace-venue.mjs';

export const GEOREF_REPORT_JSON = 'georef-report.json';
export const GEOREF_REPORT_MD = 'georef-report.md';

function venuePackagePath(venueId, name, opts = {}) {
  const base = path.resolve(opts.overrideDir || OVERRIDE_DIR);
  const file = path.resolve(base, venueId, name);
  if (!file.startsWith(`${base}${path.sep}`) && file !== base) return null;
  return file;
}

export function traceFileForVenue(venueId, opts = {}) {
  const file = opts.traceFile || venuePackagePath(venueId, 'trace.json', opts);
  if (!file || !existsSync(file)) return null;
  return file;
}

export function georefReportPaths(venueId, opts = {}) {
  const base = path.resolve(opts.overrideDir || OVERRIDE_DIR);
  const json = path.resolve(base, venueId, GEOREF_REPORT_JSON);
  const md = path.resolve(base, venueId, GEOREF_REPORT_MD);
  if (!json.startsWith(`${base}${path.sep}`)) return { json: null, md: null };
  return { json, md };
}

function persistGeorefReport(venueId, report, opts = {}) {
  const { json, md } = georefReportPaths(venueId, opts);
  if (!json) return null;
  mkdirSync(path.dirname(json), { recursive: true });
  writeJson(json, report, true);
  writeFileSync(md, `${renderGeorefReportMarkdown(report)}\n`);
  return { json, md };
}

/**
 * @param {object} report persisted georef-report.json body
 */
export function renderGeorefReportMarkdown(report) {
  const lines = [];
  const say = (s = '') => lines.push(s);
  const m = (n) => (n == null ? '—' : `${Number(n).toFixed(1)} m`);
  const acc = report.accuracy || {};

  say(`### ${report.venue} — georef fit`);
  say();
  say(`* Model **${report.model}** (${report.mapKind || 'unknown'} map)`
    + `${report.source ? ` — ${report.source}` : ''}`);
  if (report.policyNote) say(`* Policy: ${report.policyNote}`);
  if (acc.possible) {
    say(`* Cross-validated **${m(acc.rms)}** RMS, worst **${m(acc.max)}** at ${acc.worst || '—'}`
      + `; budget **${m(report.budgetM)}**`);
    say(`* ${report.accepted ? 'Accepted — traced GeoJSON written' : 'Rejected — fit over budget, nothing written'}`);
  } else {
    say(`* **Accuracy unknown** — ${acc.why || 'too few controls to cross-validate'}`);
    say(`* ${report.accepted ? 'Written with --anyway semantics' : 'Rejected — cannot verify fit'}`);
  }
  say();

  if (report.alternatives?.length > 1) {
    say('| Model | Cross-validated RMS | Worst |');
    say('| --- | ---: | ---: |');
    for (const a of report.alternatives) {
      say(`| ${a.model}${a.model === report.model ? ' ←' : ''} | ${m(a.rms)} | ${m(a.max)} |`);
    }
    say();
  }

  if (acc.residuals?.length) {
    say('| Control | Left-out error |');
    say('| --- | ---: |');
    for (const r of acc.residuals.slice(0, 12)) say(`| ${r.n} | ${m(r.metres)} |`);
    say();
  }

  if (report.featureCounts && Object.keys(report.featureCounts).length) {
    const parts = Object.entries(report.featureCounts).map(([k, n]) => `${n} ${k}`);
    say(`Features traced: ${parts.join(', ')}.`);
    say();
  }

  return lines.join('\n');
}

/**
 * Fit one trace document and optionally write traced.geojson + reports.
 *
 * @param {object} trace parsed trace.json
 * @param {object} [opts]
 */
export function fitTraceDocument(trace, opts = {}) {
  const features = validate(trace);
  const policy = resolveTraceGeorefOptions(trace, {
    model: opts.model,
    smoothing: opts.smoothing,
    maxErrorM: opts.maxErrorM,
    mapKind: opts.mapKind,
  });

  const model = opts.model ? String(opts.model) : policy.preferredModel;
  const smoothing = Number(opts.smoothing != null ? opts.smoothing : policy.smoothing);
  const maxError = Number(opts.maxErrorM != null ? opts.maxErrorM : policy.maxErrorM);

  const alternatives = compare(trace.controls, { smoothing });
  const chosen = model === 'auto' && alternatives.length ? alternatives[0].model : model;
  const fitted = fit(trace.controls, { model: chosen, smoothing });
  const accuracy = crossValidate(trace.controls, { model: chosen, smoothing });

  const report = {
    version: 1,
    venue: trace.venue,
    traceFile: opts.traceFile || null,
    image: trace.image || null,
    source: trace.source || null,
    mapKind: policy.mapKind,
    policyNote: policy.note,
    model: fitted.model,
    smoothing: fitted.smoothing ?? 0,
    controlCount: fitted.n,
    budgetM: maxError,
    accuracy: {
      possible: accuracy.possible,
      why: accuracy.why || null,
      rms: accuracy.rms,
      max: accuracy.max,
      worst: accuracy.worst || null,
      residuals: accuracy.residuals || [],
    },
    alternatives,
    featureCounts: features.reduce((acc, f) => {
      acc[f.kind] = (acc[f.kind] || 0) + 1;
      return acc;
    }, {}),
    accepted: false,
    tracedGeojson: null,
    fittedAt: new Date().toISOString(),
  };

  if (!features.length) {
    return {
      status: 'skipped',
      reason: 'trace has no features — fit computed only',
      report,
      geojson: null,
    };
  }

  const overBudget = accuracy.possible && accuracy.rms > maxError;
  const cannotVerify = !accuracy.possible;
  if ((overBudget || cannotVerify) && !opts.anyway) {
    report.accepted = false;
    report.rejection = overBudget
      ? `${accuracy.rms.toFixed(1)} m exceeds budget ${maxError} m`
      : accuracy.why;
    return { status: 'rejected', reason: report.rejection, report, geojson: null };
  }

  const geojson = toGeoJson(trace, fitted, features, accuracy, policy);
  report.accepted = true;
  report.tracedGeojson = opts.out || venueSidecarRel(trace.venue, 'traced.geojson');
  return { status: 'ok', report, geojson };
}

/**
 * Run trace→fit→write for a venue package.
 *
 * @param {string} venueId
 * @param {object} [opts]
 */
export function runGeorefTraceLoop(venueId, opts = {}) {
  const overrideDir = opts.overrideDir || OVERRIDE_DIR;
  const traceFile = traceFileForVenue(venueId, opts);
  if (!traceFile) {
    return {
      status: 'skipped',
      venueId,
      reason: `no trace.json for ${venueId}`,
    };
  }

  const trace = readJson(traceFile);
  const result = fitTraceDocument(trace, { ...opts, traceFile });
  const reportPaths = persistGeorefReport(venueId, result.report, { overrideDir });

  if (result.status !== 'ok' || !result.geojson) {
    return {
      status: result.status,
      venueId,
      traceFile,
      reason: result.reason,
      report: result.report,
      reportFile: reportPaths?.json || null,
    };
  }

  const out = opts.out || venuePackagePath(venueId, 'traced.geojson', { overrideDir }) || tracedGeoJsonFile(venueId);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result.geojson, null, 2)}\n`);

  let wired = null;
  if (opts.wire) {
    wired = ensureTraceDatasetWired(venueId);
  }

  return {
    status: 'ok',
    venueId,
    traceFile,
    tracedFile: out,
    reportFile: reportPaths?.json || null,
    reportMarkdown: reportPaths?.md || null,
    report: result.report,
    wired,
  };
}

export function readGeorefReport(venueId, opts = {}) {
  const { json } = georefReportPaths(venueId, opts);
  if (!json || !existsSync(json)) return null;
  return readJson(json, null);
}

export function georefVenueSummary(venueId, opts = {}) {
  const report = readGeorefReport(venueId, opts);
  const traceFile = traceFileForVenue(venueId, opts);
  if (!report && !traceFile) {
    return {
      venueId,
      available: false,
      hasTrace: false,
      accepted: null,
      rmsM: null,
      budgetM: null,
      model: null,
    };
  }
  return {
    venueId,
    available: Boolean(report),
    hasTrace: Boolean(traceFile),
    accepted: report?.accepted ?? null,
    rmsM: report?.accuracy?.rms ?? null,
    budgetM: report?.budgetM ?? null,
    model: report?.model ?? null,
    worstM: report?.accuracy?.max ?? null,
    controlCount: report?.controlCount ?? null,
    tracedAt: report?.fittedAt ?? null,
  };
}

export function georefDashboard(opts = {}) {
  const manifestFile = opts.manifestPath || MANIFEST_FILE;
  const manifest = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : readManifest();
  const venues = (manifest.venues || []).map((v) => georefVenueSummary(v.id, opts));
  return {
    total: venues.length,
    withTrace: venues.filter((v) => v.hasTrace).length,
    withReport: venues.filter((v) => v.available).length,
    accepted: venues.filter((v) => v.accepted).length,
    rejected: venues.filter((v) => v.available && v.accepted === false).length,
    venues,
  };
}

export function georefDetail(venueId, opts = {}) {
  const report = readGeorefReport(venueId, opts);
  if (!report) {
    const hasTrace = Boolean(traceFileForVenue(venueId, opts));
    return {
      venueId,
      available: false,
      hasTrace,
      markdown: hasTrace ? `# Georef — ${venueId}\n\nTrace file present; no fit report yet. Run \`npm run venues:trace-fit -- ${venueId}\`.` : null,
    };
  }
  return {
    venueId,
    available: true,
    accepted: report.accepted,
    markdown: renderGeorefReportMarkdown(report),
    summary: georefVenueSummary(venueId, opts),
  };
}
