/**
 * Classify changed paths into store release tiers for Park Bound.
 *
 * Tiers (highest wins): native_binary > metadata > web > none
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRepoPath } from './repo-path.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TIER_ORDER = ['none', 'web', 'metadata', 'native_binary'];

const TIER_LABELS = {
  none: 'No store action',
  web: 'Web-only (Vercel production)',
  metadata: 'Listing metadata (no new binary)',
  native_binary: 'Native binary (TestFlight / App Store / Play)',
};

export function loadStoreReleasePaths(configPath) {
  const path = configPath ?? join(__dirname, 'store-release-paths.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function pathMatchesPrefix(file, prefix) {
  const normalized = normalizeRepoPath(file);
  const p = normalizeRepoPath(prefix);
  if (!p) return false;
  return normalized === p || normalized.startsWith(p);
}

export function tiersForFile(file, prefixesByTier) {
  const tiers = [];
  for (const tier of ['native_binary', 'metadata', 'web']) {
    const prefixes = prefixesByTier[tier] ?? [];
    if (prefixes.some((prefix) => pathMatchesPrefix(file, prefix))) {
      tiers.push(tier);
    }
  }
  return tiers.length > 0 ? tiers : ['none'];
}

export function classifyStoreRelease(changedFiles, prefixesByTier = loadStoreReleasePaths()) {
  const files = [...new Set(changedFiles.map(normalizeRepoPath).filter(Boolean))];
  const byFile = {};
  const tierSet = new Set();

  for (const file of files) {
    const tiers = tiersForFile(file, prefixesByTier);
    byFile[file] = tiers;
    for (const tier of tiers) {
      tierSet.add(tier);
    }
  }

  let recommended = 'none';
  for (const tier of TIER_ORDER) {
    if (tierSet.has(tier)) {
      recommended = tier;
    }
  }

  return {
    recommended,
    label: TIER_LABELS[recommended],
    files,
    byFile,
    tiers: [...tierSet].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)),
  };
}

export function storeReleaseCommands(result) {
  const commands = [];

  if (result.tiers.includes('web') || result.recommended === 'web') {
    commands.push({
      tier: 'web',
      summary: 'Merge to main — Vercel production deploy (no App Store review)',
      steps: [
        'Open PR → pass CI → merge to main',
        'Confirm https://parkbound.kurat0r.ai reflects the change (Capacitor WebView loads this origin)',
        'Optional smoke: npm run test:pre-merge-vertical on the branch before merge',
      ],
    });
  }

  if (result.tiers.includes('metadata')) {
    commands.push({
      tier: 'metadata',
      summary: 'Upload App Store / Play listing copy (no Xcode build on ubuntu for iOS metadata)',
      steps: [
        'Edit fastlane/metadata/ios/en-US/release_notes.txt (and android changelogs if needed)',
        'npm run store:screenshots && npm run store:app-preview when UI changed',
        'Push to main (auto: ios-app-store-metadata workflow) OR Actions → iOS App Store metadata',
        'Local: FASTLANE_METADATA_ONLY=true bundle exec fastlane ios metadata',
      ],
    });
  }

  if (result.tiers.includes('native_binary') || result.recommended === 'native_binary') {
    commands.push({
      tier: 'native_binary',
      summary: 'New IPA/AAB — Apple reviews each App Store production submission',
      steps: [
        'Batch native changes; avoid store releases for web-only fixes',
        'npm run cap:sync locally and verify ios/ android/ on device',
        'TestFlight first: Actions → Store binaries → platform ios → track beta',
        'Or: bundle exec fastlane ios beta (macOS + signing)',
        'Production: Actions → Store binaries → track production (IOS_AUTOMATIC_RELEASE=false by default)',
        'After Apple approval: release manually or enable phased release in App Store Connect',
      ],
    });
  }

  if (result.recommended === 'none') {
    commands.push({
      tier: 'none',
      summary: 'Docs/tooling only — no deploy required for store users',
      steps: ['No store or Vercel action unless you intended an app change'],
    });
  }

  return commands;
}

export function formatStoreReleasePlan(result, commands = storeReleaseCommands(result)) {
  const lines = [
    `Recommended: ${result.label} (${result.recommended})`,
    `Files: ${result.files.length}`,
    '',
  ];

  if (result.files.length > 0) {
    lines.push('Changed paths:');
    for (const file of result.files) {
      const tiers = result.byFile[file].join(', ');
      lines.push(`  ${file}  [${tiers}]`);
    }
    lines.push('');
  }

  for (const block of commands) {
    lines.push(`## ${block.summary}`);
    for (const step of block.steps) {
      lines.push(`  - ${step}`);
    }
    lines.push('');
  }

  lines.push('Guide: docs/guide/store-releases.md');
  return lines.join('\n');
}
