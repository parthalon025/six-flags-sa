#!/usr/bin/env node
/**
 * Contribution pipeline vertical — submit → accept → consolidate dry-run (#444).
 *
 *   node test/app/contribution-consolidate-vertical.test.mjs
 *
 * Memory mode by default (no DATABASE_URL). When BASE_URL answers /api/health,
 * also proves the HTTP submit seam against the production server.
 */

import {
  assertContributionConsolidatePipeline,
  assertContributionConsolidatePipelineHttp,
  submitContributionViaStoreSeam,
} from './lib/contribution-pipeline-vertical.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

delete process.env.DATABASE_URL;

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

async function serverHealthy() {
  try {
    const res = await fetch(`${BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

console.log('\ncontribution consolidate vertical (#444)\n');

await check('validate+insert → accept → consolidate dry-run (store seam)', async () => {
  await assertContributionConsolidatePipeline({ submit: submitContributionViaStoreSeam });
});

if (await serverHealthy()) {
  await check('POST /api/contributions → accept → consolidate dry-run (HTTP seam)', async () => {
    await assertContributionConsolidatePipelineHttp(BASE);
  });
} else {
  console.log('  SKIP POST /api/contributions seam — no server at', BASE);
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) process.exit(1);
