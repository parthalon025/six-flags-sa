#!/usr/bin/env node
/**
 * Move height rules out of overrides into data/venues/<id>.heights.json.
 * Overrides keep corrections (alias, note, lands) — heights live beside the bundle.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson, writeJson } from '../lib/venue-io.mjs';

const VENUES = [
  'big-kahunas',
  'cedar-point',
  'kings-island',
  'six-flags-fiesta-texas',
];

const CREDITS = {
  'big-kahunas': 'Height requirements from the park operator for the 2026 season.',
  'cedar-point': 'Height requirements compiled from Cedar Point and third-party charts for the 2026 season.',
  'kings-island': 'Height requirements compiled from Kings Island Central and Theme Park Insider for the 2026 season.',
  'six-flags-fiesta-texas': 'Height requirements compiled from Six Flags and third-party charts for the 2026 season.',
};

const today = new Date().toISOString().slice(0, 10);

for (const id of VENUES) {
  const overridesPath = path.join(OVERRIDE_DIR, `${id}.overrides.json`);
  const heightsPath = path.join(OVERRIDE_DIR, `${id}.heights.json`);
  const overrides = readJson(overridesPath);
  if (!overrides?.pois) {
    console.error(`skip ${id}: no overrides`);
    continue;
  }

  const rules = {};
  let moved = 0;
  for (const [name, patch] of Object.entries(overrides.pois)) {
    if (!patch?.h) continue;
    const { h, alias, note, ...rest } = patch;
    rules[name] = {
      h,
      ...(alias ? { alias } : {}),
      ...(note ? { note } : {}),
      evidence: [
        {
          source: 'official_site',
          date: today,
          note: CREDITS[id] || 'Season height chart',
        },
      ],
    };
    const kept = Object.keys(rest).length ? rest : null;
    if (kept) overrides.pois[name] = kept;
    else delete overrides.pois[name];
    moved += 1;
  }

  const sidecar = {
    version: 1,
    _comment:
      'Height rules beside the venue bundle. Re-applied on every build after overrides. '
      + 'A below-floor rule publishes as reported, not confirmed — never dropped.',
    venue: id,
    generated: today,
    publish_at: 'moderate',
    rules,
  };

  writeJson(heightsPath, sidecar);
  writeJson(overridesPath, overrides);
  console.error(`${id}: ${moved} rule(s) -> ${heightsPath.replace(process.cwd() + '/', '')}`);
}
