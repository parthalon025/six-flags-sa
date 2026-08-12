import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Stamped by scripts/inject-version.mjs on predev/prebuild. */
function readVersionDoc() {
  try {
    return JSON.parse(readFileSync(new URL('./public/app-version.json', import.meta.url), 'utf8'));
  } catch {
    return { version: pkg.version, built: '' };
  }
}

const versionDoc = readVersionDoc();

/**
 * Cache headers for the files that are not code.
 *
 * A host serving /public with no instruction gives every file
 * `max-age=0, must-revalidate`, which is the right default for a directory
 * whose contents nobody has thought about, and the wrong one here: the venue
 * geometry is two thirds of a megabyte of drawn map that changes when a
 * deployment changes and at no other time, and revalidating it on every launch
 * is a round trip on park wifi to be told nothing happened.
 *
 * The split below is by what invalidates a file, not by where it lives:
 *
 *   - Venue geometry and icons are content addressed by the deploy that shipped
 *     them. A CDN may hold them for a year because a new deploy replaces them
 *     wholesale; the browser holds them for an hour so a phone that is wrong is
 *     only wrong briefly.
 *   - The service worker and the manifest are how the app learns it has been
 *     replaced. They are deliberately left to revalidate every time — a cached
 *     service worker is a deployment that never lands, and no amount of saved
 *     bandwidth is worth that.
 */

/** A year, in seconds — the conventional "until the URL changes" ceiling. */
const YEAR = 31536000;
const HOUR = 3600;
const DAY = 86400;

const durable = [
  { key: 'Cache-Control', value: `public, max-age=${HOUR}, s-maxage=${YEAR}, stale-while-revalidate=${DAY}` },
];

/** Baseline headers for every response — park PWA on a public CDN. */
const security = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Geolocation is the product; camera/mic stay off. Payment APIs unused.
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=(), payment=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: versionDoc.version || pkg.version,
    NEXT_PUBLIC_APP_BUILT: versionDoc.built || '',
  },
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: security },
      { source: '/venues/:path*', headers: durable },
      { source: '/icon-:size.png', headers: durable },
      { source: '/apple-touch-icon.png', headers: durable },
      { source: '/icon.svg', headers: durable },
      {
        // Belt and braces. This is the default for /public already, but it is
        // the one file where the default being changed later would be a bug
        // that takes a release to notice and a release to fix.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        source: '/app-version.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
};
export default nextConfig;
