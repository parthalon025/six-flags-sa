/**
 * User-facing release notes keyed by semver.
 *
 * Shown once per version on the startup splash after an update lands. The
 * catalog ships in the bundle so the notes are readable with no signal.
 */

import catalog from '../data/release-notes.json' with { type: 'json' };
import { APP_VERSION, compareVersions, isNewerVersion } from './version.js';

export const RELEASE_NOTES_KEY = 'tracker-release-notes-seen';

/** @typedef {{ version: string, title: string, items: string[] }} ReleaseNoteBlock */

/**
 * @param {Record<string, { title?: string, items?: string[] }>} source
 * @returns {ReleaseNoteBlock[]}
 */
export function normalizeCatalog(source = catalog) {
  return Object.entries(source)
    .filter(([, block]) => Array.isArray(block?.items) && block.items.length > 0)
    .map(([version, block]) => ({
      version,
      title: block.title || "What's new",
      items: block.items.filter((line) => typeof line === 'string' && line.trim()),
    }))
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Notes for every shipped version after `lastSeen` up to and including `current`.
 * @param {string | null | undefined} lastSeen
 * @param {string} [current]
 * @param {Record<string, { title?: string, items?: string[] }>} [source]
 * @returns {ReleaseNoteBlock[]}
 */
export function releaseNotesSince(lastSeen, current = APP_VERSION, source = catalog) {
  const floor = lastSeen && parseVersionSafe(lastSeen) ? lastSeen : '0.0.0';
  return normalizeCatalog(source).filter(
    (block) =>
      isNewerVersion(block.version, floor) && compareVersions(block.version, current) <= 0,
  );
}

function parseVersionSafe(raw) {
  const parts = String(raw || '')
    .trim()
    .split('.');
  return parts.length >= 2 && parts.every((p) => /^\d+$/.test(p));
}

/** @returns {string | null} */
export function readReleaseNotesSeen() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RELEASE_NOTES_KEY);
    return raw && parseVersionSafe(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** @param {string} version */
export function markReleaseNotesSeen(version = APP_VERSION) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RELEASE_NOTES_KEY, version);
  } catch {
    /* private mode */
  }
}

/**
 * Whether the splash should block startup for the installed build.
 * @param {string} [current]
 * @returns {ReleaseNoteBlock[]}
 */
export function pendingReleaseNotes(current = APP_VERSION) {
  return releaseNotesSince(readReleaseNotesSeen(), current);
}

/**
 * All shipped release notes up to and including `current`, for on-demand display
 * (e.g. tapping the version on the intro splash).
 * @param {string} [current]
 * @returns {ReleaseNoteBlock[]}
 */
export function allReleaseNotes(current = APP_VERSION, source = catalog) {
  return releaseNotesSince('0.0.0', current, source);
}
