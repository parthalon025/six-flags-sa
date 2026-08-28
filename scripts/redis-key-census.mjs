#!/usr/bin/env node
/**
 * Operator SCAN census — grouped `ki:*` key counts by prefix (#389).
 *
 *   node scripts/redis-key-census.mjs
 *
 * Reads Upstash credentials from the environment (either accepted pair —
 * see docs/guide/upstash.md). Read-only: only ever issues SCAN.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redisCredentialsConfigured } from './lib/production-redis-guard.mjs';
import { formatCensus, runKeyCensus } from './lib/redis-key-census.mjs';

async function main() {
  if (!redisCredentialsConfigured()) {
    console.log(
      'No Upstash Redis credentials configured (UPSTASH_REDIS_REST_URL/TOKEN or ' +
        'KV_REST_API_URL/TOKEN) — nothing to census. See docs/guide/upstash.md.',
    );
    return;
  }
  const census = await runKeyCensus();
  console.log(`Scanned ${census.pages} page(s), ${census.total} key(s) matching ki:*\n`);
  console.log(formatCensus(census));
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
