/**
 * README gallery shots and walkthrough video — which files exist, and which
 * source files should force a recapture. Pure helpers.
 */
import { pathMatchesAny } from './module-select.mjs';

export const CAPTURE_SCRIPT = 'test/app/readme-shots.mjs';

/**
 * Repo-relative path of the capture-freshness manifest the capture script
 * writes beside the shots: shot file → { commit, capturedAt }. It exists
 * because a deterministic harness recaptures a pixel-neutral change
 * byte-identically (#550) — the PNG never lands in the branch diff, so the
 * recapture has to be recorded out-of-band or the staleness check is
 * unsatisfiable.
 */
export function capturedManifestRel(manifest) {
  return mediaRel(manifest, 'captured.json');
}

/**
 * Record one shot's capture. Pure: returns a new entries object with keys
 * sorted, so the written manifest diffs stably however capture order moves.
 */
export function recordCapture(entries, file, { commit, capturedAt }) {
  const next = { ...(entries || {}), [file]: { commit, capturedAt } };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Shots whose freshness-manifest entry is new or changed against the base
 * ref's copy — i.e. recaptured within this branch. The precise rule would
 * compare the entry's commit against the source-changing commit's ancestry;
 * the pragmatic simplification (#550) is that an entry refreshed inside the
 * branch diff clears the shot, because `npm run readme:shots` rewrites every
 * entry it captures (fresh commit + timestamp) whether or not the pixels
 * moved. With no manifest on either side this returns [] and staleness
 * behaves exactly as before the manifest existed.
 */
export function refreshedShots(entries, baseEntries) {
  const base = baseEntries || {};
  return Object.entries(entries || {})
    .filter(([file, entry]) => JSON.stringify(entry) !== JSON.stringify(base[file] ?? null))
    .map(([file]) => file);
}

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
 * An item in `refreshed` (its captured.json entry rewritten within this
 * branch) counts as an output change even when the recaptured bytes are
 * identical (#550).
 */
function staleItems(items, files, scriptHit, manifest, refreshed = new Set()) {
  const stale = [];
  for (const item of items) {
    const out = mediaRel(manifest, item.file);
    if (files.has(out)) continue;
    if (refreshed.has(item.file)) continue;
    if (scriptHit || sourcesHit(files, item.sources)) stale.push(item.file);
  }
  return stale;
}

/**
 * Gallery stills (PNGs) whose source files (or the capture script) changed
 * in `changedFiles` without a matching output change. Those need
 * `npm run readme:shots` and CI blocks on them — stills always capture,
 * with no external dependency. A shot is cleared by its PNG appearing in
 * the diff OR by `refreshed` (see refreshedShots) recording a recapture the
 * pixels didn't show.
 */
export function shotsNeedingRefresh(changedFiles, manifest, { script = CAPTURE_SCRIPT, refreshed = [] } = {}) {
  const files = new Set((changedFiles || []).map(normalizePath));
  const scriptHit = files.has(normalizePath(script));
  const items = (manifest.shots || []).map((s) => ({ file: s.file, sources: s.sources }));
  return staleItems(items, files, scriptHit, manifest, new Set(refreshed));
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
