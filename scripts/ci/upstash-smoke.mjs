#!/usr/bin/env node
/**
 * CI entry point for the optional Upstash smoke test (#377).
 *
 *   node scripts/ci/upstash-smoke.mjs
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Exits 0 (with a
 * skip message) when unset — this must never fail a run that has no test
 * credentials configured.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUpstashSmoke, shouldRunUpstashSmoke } from '../lib/upstash-smoke.mjs';

async function main() {
  if (!shouldRunUpstashSmoke()) {
    console.log('upstash-smoke: no UPSTASH_REDIS_REST_URL/TOKEN configured — skipping');
    return;
  }
  const result = await runUpstashSmoke({
    urlBase: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log(`upstash-smoke: ok — ping=${result.ping}, round-trip key=${result.roundTrip.key}`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
