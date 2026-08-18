/**
 * README gallery shots and walkthrough video — which files exist, and which
 * source files should force a recapture. Pure helpers.
 */
import { pathMatchesAny } from './module-select.mjs';

export const CAPTURE_SCRIPT = 'test/app/readme-shots.mjs';

export function normalizePath(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

export function mediaRel(manifest, file) {
  const dir = (manifest.dir || 'docs/images/readme').replace(/\/+$/, '');
  return `${dir}/${file}`;
}

/** Repo-relative paths of every PNG and video the README gallery commits. */
export function mediaFiles(manifest) {
  const files = (manifest.shots || []).map((s) => mediaRel(manifest, s.file));
  for (const v of manifest.videos || []) {
    files.push(mediaRel(manifest, v.file));
    if (v.poster) files.push(mediaRel(manifest, v.poster));
  }
  return files;
}

function sourcesHit(files, sources) {
  return [...files].some((f) => pathMatchesAny(f, sources || []));
}

/**
 * Items (in manifest-output terms) whose source files — or the capture
 * script itself — changed in `files` without a matching output change.
 */
function staleItems(items, files, scriptHit, manifest) {
  const stale = [];
  for (const item of items) {
    const out = mediaRel(manifest, item.file);
    if (files.has(out)) continue;
    if (scriptHit || sourcesHit(files, item.sources)) stale.push(item.file);
  }
  return stale;
}

/**
 * Gallery stills (PNGs) whose source files (or the capture script) changed
 * in `changedFiles` without a matching output change. Those need
 * `npm run readme:shots` and CI blocks on them — stills always capture,
 * with no external dependency.
 */
export function shotsNeedingRefresh(changedFiles, manifest, { script = CAPTURE_SCRIPT } = {}) {
  const files = new Set((changedFiles || []).map(normalizePath));
  const scriptHit = files.has(normalizePath(script));
  const items = (manifest.shots || []).map((s) => ({ file: s.file, sources: s.sources }));
  return staleItems(items, files, scriptHit, manifest);
}

/**
 * Walkthrough videos (and their posters) whose source files (or the capture
 * script) changed without a matching output change. Advisory only: encoding
 * the video needs ffmpeg, which isn't guaranteed to be installed (#469), so
 * callers should warn rather than block on this list.
 */
export function videosNeedingRefresh(changedFiles, manifest, { script = CAPTURE_SCRIPT } = {}) {
  const files = new Set((changedFiles || []).map(normalizePath));
  const scriptHit = files.has(normalizePath(script));
  const items = (manifest.videos || []).flatMap((v) => [
    { file: v.file, sources: v.sources },
    ...(v.poster ? [{ file: v.poster, sources: v.sources }] : []),
  ]);
  return staleItems(items, files, scriptHit, manifest);
}

export function missingFromReadme(readme, manifest) {
  return mediaFiles(manifest).filter((rel) => !readme.includes(rel));
}
