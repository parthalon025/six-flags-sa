/**
 * Auto-alias resolution — official name ≠ OSM name, recorded as claims.
 *
 * Never silent renames: emits alias claims with dissent when confidence is low.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { OVERRIDE_DIR, readJson, writeJson } from './venue-io.mjs';
import { pairSuggestions } from './venue-judge.mjs';
import { addressBook } from './venue-ids.mjs';

export const ALIAS_FLOOR = 0.85;
export const ALIAS_CLAIM_FILE = (id) => path.join(OVERRIDE_DIR, `${id}.alias-claims.json`);

/**
 * Propose alias claims from official names to bundle ride names.
 *
 * @returns {{ claims: object[], applied: number }}
 */
export function proposeAliases({ venueId, pois = [], officialNames = [], parksApiNames = [] } = {}) {
  const rides = pois.filter((p) => p.c === 'coaster' || p.c === 'ride');
  const bundleNames = rides.map((p) => p.n);
  const book = addressBook(pois);
  const claims = [];

  const sources = [
    { source: 'official_site', names: officialNames },
    { source: 'parks_api', names: parksApiNames },
  ];

  for (const { source, names } of sources) {
    for (const official of names) {
      const pairs = pairSuggestions([official], bundleNames, { floor: 0.72, limit: 1 });
      const hit = pairs[0];
      if (!hit || hit.score < ALIAS_FLOOR) continue;
      if (hit.left === hit.right) continue;
      const target = book.byName.get(hit.right);
      if (!target) continue;
      const existingAliases = new Set(
        Object.values(book.byKey.get(target.key)?.aliases || []).concat(target.aliases || []),
      );
      if (existingAliases.has(official)) continue;

      claims.push({
        key: `alias-${official.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        claim: `"${official}" is the same ride as "${hit.right}"`,
        officialName: official,
        bundleName: hit.right,
        bundleKey: target.key,
        score: hit.score,
        confidence: hit.score >= 0.95 ? 'high' : hit.score >= ALIAS_FLOOR ? 'moderate' : 'low',
        source,
        falsifier: 'A guest-facing sign still uses only the bundle name with no redirect',
        soWhat: 'Height rules and overrides filed under the official name will reach the ride',
        dissent: hit.score < 0.95 ? `Score ${hit.score.toFixed(2)} — verify before merging` : null,
      });
    }
  }

  return { claims };
}

/**
 * Apply alias claims to heights.json rules (alias field on matched rule).
 */
export function applyAliasClaims(venueId, claims, { dryRun = false } = {}) {
  const heightsFile = path.join(OVERRIDE_DIR, `${venueId}.heights.json`);
  if (!existsSync(heightsFile)) return { applied: 0, skipped: claims.length };
  const sidecar = readJson(heightsFile);
  let applied = 0;

  for (const c of claims) {
    if (c.confidence === 'low') continue;
    const rule = sidecar.rules?.[c.bundleName];
    if (!rule) continue;
    const aliases = new Set(rule.alias || []);
    if (aliases.has(c.officialName)) continue;
    aliases.add(c.officialName);
    rule.alias = [...aliases];
    applied += 1;
  }

  const claimDoc = {
    version: 1,
    venue: venueId,
    generated: new Date().toISOString().slice(0, 10),
    claims,
    applied,
  };

  if (!dryRun && applied) writeJson(heightsFile, sidecar, true);
  writeJson(ALIAS_CLAIM_FILE(venueId), claimDoc, true);
  return { applied, claims: claimDoc };
}
