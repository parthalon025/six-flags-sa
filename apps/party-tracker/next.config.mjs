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
    value: 'geolocation=(self), camera=(self), microphone=(), payment=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: versionDoc.version || pkg.version,
    NEXT_PUBLIC_APP_BUILT: versionDoc.built || '',
  },
  reactStrictMode: true,
  /* Dev only, and load-bearing. Next 16 refuses any request for a `/_next/*`
     dev resource whose Origin host is not `localhost` or named here, and it
     refuses with a bare 403 and an empty body. Nothing in the page reports it:
     every client chunk 403s, React never hydrates, and the app is left holding
     the opaque first-run cover it renders before localStorage has answered. So
     the whole symptom of this is "the introduction never showed up" — the
     splash is a client component and never mounts — on a phone that has seen
     the app before, the same dead build simply looks like a frozen map.

     127.0.0.1 is a different host from `localhost` to that check, and it is
     what `test/app/browser.mjs` and most "open the dev server" habits use. The
     private v4 ranges are for a phone on the LAN (`npm run phone -- --dev`),
     which reaches this machine by address. DEV_ORIGINS names a tunnel host for
     the same run without widening the list for everyone.

     None of this reaches production: `next start` and Vercel serve the built
     chunks with no origin check, which is why a deployed first run was always
     fine while a local one was not. */
  allowedDevOrigins: [
    '127.0.0.1',
    /* Bracketed: the check reads URL.hostname, which keeps them on a v6 literal. */
    '[::1]',
    '10.*.*.*',
    '192.168.*.*',
    /* 172.16.0.0/12, spelled out because the matcher has no ranges. */
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
    ...(process.env.DEV_ORIGINS || '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ],
  // The factories never deploy (the deploy ignore file excludes the builder
  // package): leave it external so the bundler never resolves it at build
  // time — the app's one seam to it (lib/venueCompare.js) imports it lazily
  // and degrades when absent.
  serverExternalPackages: ['@party-tracker/venue-builder'],
  // Immutable static chunks break Vercel production deploys for this monorepo
  // (build succeeds locally; production target fails since Clerk merge #155).
  // Preview already skipped immutable for GitHub comment patching (#163).
  supportsImmutableAssets: false,
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
