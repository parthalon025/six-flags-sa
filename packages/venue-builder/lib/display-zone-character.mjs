/**
 * Per-Zone character — hand-authored venue relationships the harvest must not
 * overwrite (ADR-0020: design owns treatment, the venue owns relationships).
 *
 * Measured grounding classes live in `grounding.json`; Zone character lives
 * in `zone-character.json` beside it. A re-harvest rewrites only the former.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';

/** Closed vocabulary — must stay aligned with `LAND_CHARACTERS` in display-pack.mjs. */
export const ZONE_CHARACTER_KEYS = new Set([
  'woodland', 'water', 'steel', 'midway', 'built', 'civic', 'open',
]);

export const zoneCharacterFile = (venueId) =>
  path.join(OVERRIDE_DIR, venueId, 'display', 'zone-character.json');

/** Hand-authored Zone character for one World, or null when unset. */
export function readZoneCharacter(venueId) {
  return readJson(zoneCharacterFile(venueId), null);
}

/**
 * Merge harvested grounding with the hand-authored character map.
 * @param {object|null} grounding harvested or committed grounding.json body
 * @param {object|null} zoneCharacter zone-character.json body
 */
export function groundingWithZoneCharacter(grounding, zoneCharacter) {
  if (!grounding) return null;
  if (zoneCharacter?.policy === 'uncharacterised') {
    const { zones: _legacy, _zonesComment: _comment, ...rest } = grounding;
    return { ...rest, zones: {} };
  }
  const zones = zoneCharacter?.zones;
  if (!zones || typeof zones !== 'object') {
    return grounding;
  }
  const { zones: _legacy, _zonesComment: _comment, ...rest } = grounding;
  return { ...rest, zones };
}

/**
 * Gate Zone character curation. Returns problems; empty means green.
 *
 * @param {object|null} record zone-character.json body
 * @param {{ venueId?: string, landCoverZones?: string[] }} ctx
 */
export function validateZoneCharacter(record, { venueId = record?.venue, landCoverZones = [] } = {}) {
  const problems = [];
  const at = venueId ? `${venueId} zone-character` : 'zone-character';
  if (!record || typeof record !== 'object') {
    problems.push(`${at}: missing — per-Zone character must live outside grounding.json so a re-harvest cannot drop it`);
    return problems;
  }
  if (record.venue && venueId && record.venue !== venueId) {
    problems.push(`${at}: names World "${record.venue}", expected "${venueId}"`);
  }

  if (record.policy === 'uncharacterised') {
    if (record.zones && Object.keys(record.zones).length) {
      problems.push(`${at}: declares policy uncharacterised but also carries zones — pick one authority`);
    }
    return problems;
  }

  const zones = record.zones || {};
  for (const [zone, row] of Object.entries(zones)) {
    const character = row?.character;
    if (!character) {
      problems.push(`${at}: Zone "${zone}" names no character`);
      continue;
    }
    if (!ZONE_CHARACTER_KEYS.has(character)) {
      problems.push(`${at}: Zone "${zone}" declares unknown character "${character}"`);
    }
  }

  if (landCoverZones.length && !Object.keys(zones).length && record.policy !== 'uncharacterised') {
    problems.push(
      `${at}: this World has ${landCoverZones.length} Zone(s) in land cover but no character map — `
        + 'either curate zones here or set policy to "uncharacterised"',
    );
  }

  return problems;
}

/** True when a flagship carries an explicit zone-character record on disk. */
export function hasZoneCharacterRecord(venueId) {
  return existsSync(zoneCharacterFile(venueId));
}
