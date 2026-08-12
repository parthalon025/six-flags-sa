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

/** ISO-8601 build stamp from inject-version — unique per deploy even when semver is unchanged. */
export const APP_BUILT =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_APP_BUILT) || '';

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

/**
 * Conventional Commits release kind from commit / PR messages.
 * Highest wins: major > minor > patch > none.
 * Merge-PR subjects are ignored (no signal). A message with no type is patch.
 *
 * @param {string | string[]} messages
 * @returns {'major' | 'minor' | 'patch' | 'none'}
 */
export function releaseKindFromMessages(messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).map((m) => String(m || ''));
  const rank = { none: 0, patch: 1, minor: 2, major: 3 };
  let kind = null;
  for (const text of list) {
    const k = kindFromMessage(text);
    if (k == null) continue;
    if (kind == null || rank[k] > rank[kind]) kind = k;
  }
  return kind || 'patch';
}

function kindFromMessage(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const subject = (normalized.split('\n')[0] || '').trim();
  if (!subject) return null;
  if (/^Merge pull request #\d+ from /i.test(subject)) return null;
  if (/(^|\n)BREAKING[ -]CHANGE:/i.test(normalized)) return 'major';
  const m = /^(feat|fix|chore|docs|test|refactor|perf|ci|style)(?:\([^)]+\))?(!)?:(\s|$)/i.exec(subject);
  if (!m) return 'patch';
  if (m[2] === '!') return 'major';
  const type = m[1].toLowerCase();
  if (type === 'feat') return 'minor';
  if (type === 'fix') return 'patch';
  return 'none';
}

/**
 * Next version for a SemVer kind. `none` leaves the string unchanged.
 * @param {string} raw
 * @param {'major' | 'minor' | 'patch' | 'none'} kind
 */
export function bumpVersion(raw, kind) {
  if (kind === 'none') return raw;
  const v = parseVersion(raw);
  if (!v) return '0.0.1';
  if (kind === 'major') return `${v.major + 1}.0.0`;
  if (kind === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

/** Next patch release for a semver string, e.g. `1.1.0` → `1.1.1`. */
export function bumpPatchVersion(raw) {
  return bumpVersion(raw, 'patch');
}

/**
 * True when `candidate` is a newer deploy than `installed`.
 * Semver wins when it differs; when it matches, a newer `built` stamp means a
 * redeploy landed without a package.json bump.
 *
 * @param {{ version: string, built?: string }} candidate
 * @param {{ version: string, built?: string }} installed
 */
export function isNewerBuild(candidate, installed) {
  const cmp = compareVersions(candidate.version, installed.version);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  const cb = String(candidate.built || '').trim();
  const ib = String(installed.built || '').trim();
  if (cb && ib) return cb > ib;
  // Legacy tab with no baked-in stamp: trust the server's build id once.
  if (cb && !ib) return true;
  return false;
}
