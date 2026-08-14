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
 * Media whose source files (or the capture script) changed in `changedFiles`
 * without a matching output change. Those need `npm run readme:shots`.
 */
export function shotsNeedingRefresh(changedFiles, manifest, { script = CAPTURE_SCRIPT } = {}) {
  const files = new Set((changedFiles || []).map(normalizePath));
  const scriptHit = files.has(normalizePath(script));
  const stale = [];
  const items = [
    ...(manifest.shots || []).map((s) => ({ file: s.file, sources: s.sources })),
    ...(manifest.videos || []).flatMap((v) => [
      { file: v.file, sources: v.sources },
      ...(v.poster ? [{ file: v.poster, sources: v.sources }] : []),
    ]),
  ];
  for (const item of items) {
    const out = mediaRel(manifest, item.file);
    if (files.has(out)) continue;
    if (scriptHit || sourcesHit(files, item.sources)) stale.push(item.file);
  }
  return stale;
}

export function missingFromReadme(readme, manifest) {
  return mediaFiles(manifest).filter((rel) => !readme.includes(rel));
}
