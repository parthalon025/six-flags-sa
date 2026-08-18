/**
 * Mapillary Tools — ride-walkthrough video → geotagged frames.
 * https://github.com/mapillary/mapillary_tools (video_process: sample_video + process)
 *
 * A ride walkthrough shot with location services on (or paired with a separately
 * logged GPX trace, the same shape as `guest-traces`) becomes geotagged frames
 * through the `mapillary_tools` Python CLI already documented in the registry.
 * Requires the CLI on PATH and an explicit `ctx.videoPath`; gaps gracefully when
 * either is missing, the same shape `mapillary-api.mjs` uses for a missing token.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { cachePath, readCache, writeCache } from './_cache.mjs';
import { venueSidecar } from '../venue-io.mjs';

const execFileAsync = promisify(execFile);

export const videoCacheFile = (id) => cachePath(id, 'mapillary-video');

export async function cliAvailable(exec = execFileAsync) {
  try {
    await exec('mapillary_tools', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `mapillary_tools video_process` against a walkthrough video, returning the
 * geotagged frame list. Does not touch the cache — callers decide what to persist.
 */
export async function processWalkthroughVideo(videoPath, outDir, exec = execFileAsync) {
  mkdirSync(outDir, { recursive: true });
  await exec('mapillary_tools', ['video_process', videoPath, outDir]);
  const manifestPath = path.join(outDir, 'mapillary_image_description.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest
    .filter((f) => Number.isFinite(f.MAPLatitude) && Number.isFinite(f.MAPLongitude))
    .map((f) => ({
      filename: f.filename,
      lat: f.MAPLatitude,
      lng: f.MAPLongitude,
      capturedAt: f.MAPCaptureTime,
    }));
}

/** capturedAt may be an epoch-ms number or an ISO-ish string; either parses via Date. */
const dateOf = (capturedAt) => {
  const d = capturedAt ? new Date(capturedAt) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
};

/** Pure: frame list → evidence claims. Testable without the CLI installed. */
export function videoClaims(frames = [], { date } = {}) {
  return frames
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng))
    .map((f) => ({
      source: 'video',
      kind: 'imagery',
      at: { lat: f.lat, lng: f.lng },
      date: date || dateOf(f.capturedAt),
      note: `Ride-walkthrough frame ${f.filename}`,
    }));
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'mapillary-tools', ok: false, error: 'venueId_required' };

  const cached = readCache(id, 'mapillary-video');
  if (ctx.offline) {
    return {
      adapterId: 'mapillary-tools',
      ok: Boolean(cached?.frames?.length),
      claims: videoClaims(cached?.frames),
      data: cached,
    };
  }

  const videoPath = ctx.videoPath;
  if (!videoPath) {
    const stub = cached || {
      frames: [],
      error: 'Set ctx.videoPath to a ride-walkthrough video to run video_process.',
      gap: true,
    };
    writeCache(id, 'mapillary-video', stub);
    return { adapterId: 'mapillary-tools', ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
  }

  if (!(await cliAvailable())) {
    const stub = cached || { frames: [], error: 'mapillary_tools CLI not found on PATH.', gap: true };
    writeCache(id, 'mapillary-video', stub);
    return { adapterId: 'mapillary-tools', ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
  }

  try {
    const outDir = venueSidecar(id, 'mapillary-video-frames');
    const frames = await processWalkthroughVideo(videoPath, outDir);
    const out = {
      fetched: new Date().toISOString().slice(0, 19),
      source: 'mapillary_tools video_process',
      frames,
    };
    writeCache(id, 'mapillary-video', out);
    return {
      adapterId: 'mapillary-tools',
      ok: frames.length > 0,
      claims: videoClaims(frames),
      meta: { count: frames.length },
      artifacts: [videoCacheFile(id), outDir],
      data: out,
    };
  } catch (err) {
    return { adapterId: 'mapillary-tools', ok: false, error: err.message };
  }
}
