#!/usr/bin/env node
/**
 * Critical-path coverage contract (middle ground).
 *
 * Not every UI action — just the vertical user capabilities we claim to ship.
 * Fails if a required check title is missing from functional.mjs / grandma.mjs.
 * Upcoming epic rows are listed but not enforced until their `check` is set.
 *
 * The contract also pins the domain context it was reviewed against:
 * `context.sha256` in critical-paths.json fingerprints CONTEXT.md and
 * docs/adr/*.md. When new context is built (glossary terms, ADRs), this
 * script fails until someone reviews the rows against the new capabilities
 * and restamps — so the user-action e2e contract cannot silently fall behind
 * the domain model.
 *
 *   node test/app/coverage-contract.mjs          # verify rows + context stamp
 *   node test/app/coverage-contract.mjs --stamp  # restamp after reviewing rows
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CONTRACT_PATH = path.join(HERE, 'critical-paths.json');
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
const stampMode = process.argv.includes('--stamp');

const sources = {
  functional: readFileSync(path.join(ROOT, contract.suites.functional), 'utf8'),
  grandma: readFileSync(path.join(ROOT, contract.suites.grandma), 'utf8'),
};

/** Deterministic fingerprint of the domain-context entries (files, or dirs of *.md). */
export function contextHash(root, entries) {
  const files = [];
  for (const entry of entries) {
    const abs = path.join(root, entry);
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (name.endsWith('.md')) files.push(path.posix.join(entry, name));
      }
    } else {
      files.push(entry);
    }
  }
  const hash = createHash('sha256');
  for (const rel of files.sort()) {
    hash.update(`${rel}\n`);
    hash.update(readFileSync(path.join(root, rel)));
    hash.update('\n');
  }
  return hash.digest('hex');
}

const missing = [];
const ok = [];

for (const row of contract.paths) {
  const src = sources[row.suite];
  if (!src) {
    missing.push(`${row.id}: unknown suite ${row.suite}`);
    continue;
  }
  if (row.check) {
    const needle = `await check('${row.check}'`;
    const alt = `await check("${row.check}"`;
    if (!src.includes(needle) && !src.includes(alt)) {
      missing.push(`${row.id}: missing check "${row.check}" in ${row.suite}`);
    } else {
      ok.push(row.id);
    }
  } else if (row.check_includes) {
    if (!new RegExp(row.check_includes, 'i').test(src)) {
      missing.push(`${row.id}: ${row.suite} has no check mentioning /${row.check_includes}/i`);
    } else {
      ok.push(row.id);
    }
  }
}

console.log(`coverage-contract: ${ok.length} critical paths present`);
if (contract.upcoming?.length) {
  console.log(`coverage-contract: ${contract.upcoming.length} upcoming epic rows (not enforced yet)`);
}

let staleContext = false;
if (contract.context?.files?.length) {
  const current = contextHash(ROOT, contract.context.files);
  if (stampMode) {
    if (missing.length) {
      console.error('coverage-contract: refusing to --stamp while rows are missing checks');
    } else {
      contract.context.sha256 = current;
      writeFileSync(CONTRACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
      console.log(`coverage-contract: context stamp updated (${current.slice(0, 12)}…)`);
    }
  } else if (contract.context.sha256 !== current) {
    staleContext = true;
    console.error('coverage-contract FAILED: domain context changed since the contract was last reviewed.');
    console.error(`  fingerprinted: ${contract.context.files.join(', ')}`);
    console.error(`  stamped ${String(contract.context.sha256).slice(0, 12)}… but current is ${current.slice(0, 12)}…`);
    console.error('  New context was built — review test/app/critical-paths.json against the new');
    console.error('  capabilities (add or adjust rows and their functional.mjs checks), then restamp:');
    console.error('    node test/app/coverage-contract.mjs --stamp');
  } else {
    console.log('coverage-contract: context stamp matches CONTEXT.md + docs/adr');
  }
}

if (missing.length) {
  console.error('coverage-contract FAILED:');
  for (const m of missing) console.error(' !', m);
}
if (missing.length || staleContext) {
  process.exitCode = 1;
} else if (!stampMode) {
  console.log('coverage-contract ok');
}
