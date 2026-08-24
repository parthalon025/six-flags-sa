/**
 * Map factory — truth build and certification interface.
 *
 * Cross-module entry: buildTruth. I/O through map-io only.
 */

export { buildTruth } from './build-truth.mjs';
export { readTruth, truthStamp, truthPaths, writeVenue } from './map-io.mjs';
