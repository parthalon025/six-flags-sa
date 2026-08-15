#!/usr/bin/env node
/**
 * Validate Apple store identifiers, Capacitor shell, Clerk redirect URLs, and billing constants.
 *
 *   node scripts/billing-sync-check.mjs
 *   npm run billing:sync-check
 */
import { billingSyncIssues } from './lib/billing-sync-check.mjs';

const { ok, issues } = billingSyncIssues();

if (!ok) {
  console.error('billing-sync-check failed:\n');
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log('billing-sync-check: ok');
