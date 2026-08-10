#!/usr/bin/env node
/* Get the things only a park's own map knows out of the picture and onto the map.
 *
 * OpenStreetMap is the whole of a venue's geometry here and there are things it
 * simply does not have. Which end of a 400 m coaster the queue starts at — the
 * bundle has one point for a ride, and for a ride taken from its track that
 * point is the middle of the track, so "walk to Diamondback" walks you to the
 * top of the lift hill. Where the exit spits you out, which is a different place
 * and the one you are trying to meet somebody at. The path across the lawn that
 * everybody uses and nobody has drawn. Half the toilets. All of that is on the
 * map the park hands out at the gate, and none of it has been reachable.
 *
 *   node scripts/trace-venue.mjs data/venues/big-kahunas.trace.json
 *   node scripts/trace-venue.mjs <file> --model affine --max-error 6
 *   node scripts/trace-venue.mjs <file> --report        # the fit, as markdown
 *
 * The input is one JSON file: the control points that tie the picture to the
 * ground, and the features somebody clicked out of it, both in pixels.
 *
 *   {
 *     "venue": "big-kahunas",
 *     "image": "docs/big-kahunas-2026-parkmap.png",
 *     "source": "Big Kahuna's own 2026 park map",
 *     "controls": [
 *       { "n": "Wave pool, NE corner", "px": [1204, 880], "lat": 30.38871, "lng": -86.47262 }
 *     ],
 *     "features": [
 *       { "kind": "entrance", "of": "Jumanji", "px": [990, 640] },
 *       { "kind": "exit",     "of": "Jumanji", "px": [1010, 700] },
 *       { "kind": "place", "n": "Toilets, by the wave pool", "c": "restroom", "px": [880, 910] },
 *       { "kind": "route", "n": "Boardwalk", "px": [[880, 910], [905, 940], [960, 980]] }
 *     ]
 *   }
 *
 * Control points are the whole job. They are places you can identify in the
 * picture *and* read a real coordinate for out of OpenStreetMap — a building
 * corner, a path junction, the end of a pool. Spread them to the corners of the
 * venue; eight in a ring beats twenty along one midway, because a fit is only
 * pinned where you pinned it.
 *
 * What comes out is a GeoJSON file that `build-venue.mjs --trace` folds into the
 * venue, with the accuracy of the fit stamped onto every feature in it. Nothing
 * is written at all if the fit is worse than `--max-error`, which defaults to
 * ten metres — about the width of a midway, and the point past which a pin is
 * pointing at the wrong side of the path.
 *
 * That gate is the reason this exists rather than a scratch file of arithmetic.
 * Big Kahuna's map was georeferenced by hand, came out at 33 m RMS in a park
 * 400 m across, and the work was thrown away — correctly, and only because
 * somebody happened to check. A tool that makes the checking automatic is a
 * tool that can be trusted with the answer.
 */

import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compare, crossValidate, fit, MODELS, project, residuals } from '../lib/georef.mjs';

const USAGE = `
Georeference a park's own map and pull features off it.

  node scripts/trace-venue.mjs <trace file> [options]

  --model <m>        ${Object.keys(MODELS).join(' | ')} | auto   (default: auto)
  --smoothing <n>    tps only: let the spline miss its controls, for when the
                     controls themselves are only roughly surveyed (default: 0)
  --max-error <m>    refuse to write a fit whose cross-validated error is worse
                     than this, in metres (default: 10)
  --anyway           write it regardless, with the error stamped on every feature
  --out <file>       where to write (default: data/venues/<venue>.traced.geojson)
  --report           print the fit as markdown rather than a terminal summary
  --dry-run          fit and report, write nothing
`;

/* ------------------------------------------------------------------ args - */

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

/* ----------------------------------------------------------------- shapes - */

const KINDS = new Set(['entrance', 'exit', 'place', 'route']);

/**
 * Check the trace file before any arithmetic happens to it.
 *
 * A feature that names a ride the venue does not have, or a kind nothing reads,
 * is not an error anybody sees later — it is a pin that silently never arrives.
 * The whole point of this pipeline is that a thing which did not happen says so.
 */
function validate(trace) {
  if (!trace?.venue) throw new Error('The trace file needs a "venue" — the id it belongs to.');
  if (!Array.isArray(trace.controls) || trace.controls.length < 2) {
    throw new Error('The trace file needs a "controls" list of at least two surveyed points.');
  }
  const features = trace.features || [];
  features.forEach((f, i) => {
    const where = f.n || f.of || `feature #${i + 1}`;
    if (!KINDS.has(f.kind)) {
      throw new Error(`"${where}" has kind "${f.kind}" — one of: ${[...KINDS].join(', ')}.`);
    }
    if (f.kind === 'entrance' || f.kind === 'exit') {
      if (!f.of) throw new Error(`"${where}" is an ${f.kind} of nothing — give it "of": "<ride name>".`);
    }
    if (f.kind === 'route') {
      if (!Array.isArray(f.px) || f.px.length < 2 || !Array.isArray(f.px[0])) {
        throw new Error(`Route "${where}" wants a list of at least two [x, y] pixels.`);
      }
    } else if (!Array.isArray(f.px) || !Number.isFinite(f.px[0])) {
      throw new Error(`"${where}" wants a single [x, y] pixel.`);
    }
  });
  return features;
}

/** The traced features as GeoJSON, each carrying where it came from and how well. */
function toGeoJson(trace, fitted, features, accuracy) {
  const src = {
    by: 'trace',
    image: trace.image || null,
    source: trace.source || null,
    model: fitted.model,
    controls: fitted.n,
    /* The number that decides whether a pin is worth having, carried by the pin
       rather than left in a terminal somebody has closed. A place two metres out
       and a place twenty metres out are different data and must not become the
       same data by being written to the same file. */
    error_m: accuracy.rms == null ? null : Number(accuracy.rms.toFixed(1)),
    worst_m: accuracy.max == null ? null : Number(accuracy.max.toFixed(1)),
  };

  return {
    type: 'FeatureCollection',
    properties: { venue: trace.venue, traced: src },
    features: features.map((f) => {
      const { px, ...rest } = f;
      const geometry = f.kind === 'route'
        ? { type: 'LineString', coordinates: px.map((p) => { const g = project(fitted, p); return [g.lng, g.lat]; }) }
        : (() => { const g = project(fitted, px); return { type: 'Point', coordinates: [g.lng, g.lat] }; })();
      return { type: 'Feature', geometry, properties: { ...rest, src } };
    }),
  };
}

/* ----------------------------------------------------------------- report - */

function report(trace, fitted, accuracy, options, asMarkdown) {
  const lines = [];
  const say = (s = '') => lines.push(s);
  const m = (n) => (n == null ? '—' : `${n.toFixed(1)} m`);

  say(`### ${trace.venue} — georeferencing ${trace.image || 'the traced picture'}`);
  say();
  say(`* **${fitted.n}** control points, fitted as **${fitted.model}**`
    + `${trace.source ? ` — ${trace.source}` : ''}`);
  if (accuracy.possible) {
    say(`* **${m(accuracy.rms)}** RMS error at a point the fit has never seen, worst `
      + `**${m(accuracy.max)}** (${accuracy.worst})`);
  } else {
    say(`* **accuracy unknown** — ${accuracy.why}`);
  }
  say();

  const alternatives = options.alternatives || [];
  if (alternatives.length > 1) {
    say('| Model | Cross-validated RMS | Worst |');
    say('| --- | ---: | ---: |');
    for (const a of alternatives) {
      say(`| ${a.model}${a.model === fitted.model ? ' ←' : ''} | ${m(a.rms)} | ${m(a.max)} |`);
    }
    say();
  }

  if (accuracy.residuals?.length) {
    say('| Control | Left-out error |');
    say('| --- | ---: |');
    for (const r of accuracy.residuals.slice(0, 12)) say(`| ${r.n} | ${m(r.metres)} |`);
    say();
    say('The control that lands worst is the one to look at first: usually it is the pixel that '
      + 'was clicked slightly wrong, or the surveyed coordinate that belongs to the building next '
      + 'door. Fixing one bad control does more than any model does.');
    say();
  }

  /* In-sample, said out loud and immediately undercut, because the number is
     seductive and meaningless on its own — a spline is exactly zero here no
     matter how wrong it is anywhere else. */
  const inSample = residuals(fitted, trace.controls);
  const inRms = Math.sqrt(inSample.reduce((s, r) => s + r.metres * r.metres, 0) / inSample.length);
  say(`For completeness: ${m(inRms)} RMS *against its own control points* — the quantity this fit `
    + 'was chosen to make small, so it flatters itself by construction'
    + (fitted.model === 'tps' ? ', and a spline drives it to zero however wrong it is in between' : '')
    + '. The number above is the one to act on.');
  say();

  if (asMarkdown) console.log(lines.join('\n'));
  else console.error(lines.join('\n'));
}

/* ------------------------------------------------------------------- main - */

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || (!args._[0] && !args.trace)) {
    console.log(USAGE);
    if (!args._[0] && !args.trace && !args.help && !args.h) process.exitCode = 1;
    return;
  }

  const file = args._[0] || String(args.trace);
  const trace = JSON.parse(readFileSync(file, 'utf8'));
  const features = validate(trace);

  const model = args.model ? String(args.model) : trace.model || 'auto';
  const smoothing = Number(args.smoothing ?? trace.smoothing ?? 0);
  const maxError = Number(args['max-error'] ?? 10);

  /* Every model the control count can carry, scored, before one is chosen.
     Which transform suits a picture is not a thing anybody can tell by looking
     at it, and the cross-validated number can. */
  const alternatives = compare(trace.controls, { smoothing });
  const chosen = model === 'auto' && alternatives.length ? alternatives[0].model : model;

  const fitted = fit(trace.controls, { model: chosen, smoothing });
  const accuracy = crossValidate(trace.controls, { model: chosen, smoothing });
  report(trace, fitted, accuracy, { alternatives }, Boolean(args.report));

  if (!features.length) {
    console.error('No features traced — nothing to write. The fit above is still worth keeping.');
    return;
  }

  /* The gate. A pin that is confidently in the wrong place is worse than no pin:
     nobody checks a map that looks right, and "the toilets are over there" is
     the one thing this app is asked at a run. */
  if (accuracy.possible && accuracy.rms > maxError && !args.anyway) {
    throw new Error(
      `${accuracy.rms.toFixed(1)} m of error is worse than the ${maxError} m this is allowed to `
        + 'write, so nothing was written.\n'
        + '  · Look at the worst control above — one bad pixel or one coordinate off a neighbouring '
        + 'building costs more than any model choice.\n'
        + '  · Add control points, spread to the corners. An illustrated map needs more than a scan.\n'
        + '  · Try --model tps, which stops assuming the drawing is flat.\n'
        + '  · Raise --max-error if this venue genuinely does not need the precision, or pass '
        + '--anyway to write it with the error stamped on every feature.',
    );
  }
  if (!accuracy.possible && !args.anyway) {
    throw new Error(
      `${accuracy.why}\n  Nothing written. Pass --anyway to write it unverified.`,
    );
  }

  const out = args.out
    ? String(args.out)
    : path.join('data', 'venues', `${trace.venue}.traced.geojson`);
  const gj = toGeoJson(trace, fitted, features, accuracy);

  if (args['dry-run']) {
    console.error(`\nDry run — ${gj.features.length} feature(s) would go to ${out}.`);
    return;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(gj, null, 2)}\n`);
  const counts = {};
  for (const f of features) counts[f.kind] = (counts[f.kind] || 0) + 1;
  console.error(
    `\nWrote ${out} — ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}.`,
  );
  console.error(`Fold it into the venue: npm run venues:build -- --rebuild ${trace.venue} --trace ${out}`);
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

export { toGeoJson, validate };
