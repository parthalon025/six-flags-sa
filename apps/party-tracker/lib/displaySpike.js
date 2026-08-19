/**
 * Byte source for the MapLibre display-pipeline spike (issue #527).
 *
 * Big Kahuna's certified display pack (`base.pmtiles`, one Skin's
 * `style.json`) lives under the builder's own data directory — it is a
 * build artifact, gitignored there like every other venue's, and this spec
 * is explicit that publishing display packs to `public/venues` is Phase 5's
 * venue download manager, not this one. So the spike reads the builder's
 * copy directly instead: server-only, one hardcoded venue and Skin, no
 * manifest entry and no download/caching flow. No import.meta — safe for
 * the Next bundler (mirrors lib/venueCompare.js's appRoot()).
 */
import path from 'node:path';

export const DISPLAY_SPIKE_VENUE = 'big-kahunas';
export const DISPLAY_SPIKE_SKIN = 'watercolor-quest';

function appRoot() {
  const cwd = process.cwd();
  if (cwd.endsWith('party-tracker')) return cwd;
  return path.join(cwd, 'apps', 'party-tracker');
}

function displayDir() {
  return path.join(appRoot(), '..', '..', 'packages', 'venue-builder', 'data', 'venues', DISPLAY_SPIKE_VENUE, 'display');
}

/** The only two files this spike ever serves — base.pmtiles and one Skin's style.json. */
const ALLOWED_FILES = {
  'base.pmtiles': 'application/octet-stream',
  [`${DISPLAY_SPIKE_SKIN}.style.json`]: 'application/json',
};

/** Absolute path for an allowed display-pack file, or null for anything else. */
export function displaySpikeFile(name) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_FILES, name)) return null;
  return path.join(displayDir(), name);
}

export function displaySpikeContentType(name) {
  return ALLOWED_FILES[name] || null;
}
