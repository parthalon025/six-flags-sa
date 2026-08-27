#!/usr/bin/env node
/** Stamp meta.coverage onto venue maps already on disk (no Overpass). */

import { listVenuePackages } from '../lib/venue-io.mjs';
import { resolveStampCoverageIds, stampCoverage } from '../lib/stamp-coverage-run.mjs';

const explicit = process.argv.slice(2);
const ids = resolveStampCoverageIds(explicit, listVenuePackages);

stampCoverage({ ids, explicit: explicit.length > 0 });
