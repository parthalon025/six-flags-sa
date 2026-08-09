/**
 * Application semver — the build stamped into the client, not the party
 * protocol version in lib/core/protocol.js.
 *
 * `NEXT_PUBLIC_APP_VERSION` is set from package.json in next.config.mjs so the
 * running tab knows what it shipped with. `/api/version` is the same number on
 * the wire when a phone can reach the server.
 */

/** @type {string} */
export const APP_VERSION =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_VERSION) || '0.0.0';

/**
 * Split a semver string into [major, minor, patch, prerelease].
 * Non-numeric segments are ignored after the patch.
 */
export function parseVersion(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(s);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || '',
  };
}

/**
 * Compare two semver strings.
 * @returns {-1 | 0 | 1} negative when a < b, positive when a > b
 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  if (va.prerelease === vb.prerelease) return 0;
  // A release without a prerelease tag outranks one with it.
  if (!va.prerelease) return 1;
  if (!vb.prerelease) return -1;
  return va.prerelease < vb.prerelease ? -1 : va.prerelease > vb.prerelease ? 1 : 0;
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerVersion(candidate, installed) {
  return compareVersions(candidate, installed) > 0;
}
