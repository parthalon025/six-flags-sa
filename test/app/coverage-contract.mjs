#!/usr/bin/env node
/**
 * The gate over `test/app/critical-paths.json` (#24).
 *
 * The contract says every user-visible capability we ship keeps a named check.
 * Nothing verified that the names were real, and an unguarded registry drifts
 * both ways: real coverage sitting in `upcoming`, and absent coverage reported
 * as shipped. The second is the dangerous one — two rows named check strings
 * that appeared exactly once in the repo, in the registry claiming them.
 *
 * What it asserts:
 *   - every row names a suite the `suites` map resolves to a file on disk
 *   - every row's `check` appears verbatim in that suite's source, and every
 *     row's `check_includes` appears as a substring
 *   - `upcoming` rows are held to the same rule only when they carry a real
 *     check — a `TODO …` placeholder is the row admitting it is not covered
 *
 * What it does not assert: that the check named actually exercises the
 * capability described. No string match can. It closes the gap between a row
 * and a test that exists; reading the row against the test stays a human job,
 * which is what the context fingerprint below is a prompt for.
 *
 * CLI:
 *   node test/app/coverage-contract.mjs            — run the gate
 *   node test/app/coverage-contract.mjs --stamp    — restamp the context fingerprint
 *
 * Interface:
 *   CONTRACT_FILE / loadContract() / contextFingerprint() / coverageFailures()
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

export const CONTRACT_FILE = join(here, 'critical-paths.json');

export function loadContract(file = CONTRACT_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A placeholder check is a row saying "not covered yet", not a claim to verify. */
const isPlaceholder = (needle) => /^TODO\b/i.test(String(needle).trim());

function walk(target, out = []) {
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target).sort()) walk(join(target, entry), out);
  } else {
    out.push(target);
  }
  return out;
}

/**
 * Fingerprint of the domain context the rows were last reviewed against.
 * Path names are hashed alongside bytes so that moving a file is drift too.
 */
export function contextFingerprint(contract = loadContract(), cwd = root) {
  const hash = createHash('sha256');
  for (const rel of contract.context?.files || []) {
    for (const file of walk(resolve(cwd, rel))) {
      hash.update(file.slice(cwd.length + 1));
      hash.update(readFileSync(file));
    }
  }
  return hash.digest('hex');
}

/**
 * @returns {string[]} one operator-facing line per broken row; empty when clean
 */
export function coverageFailures(contract = loadContract(), readSuite = null) {
  const read =
    readSuite || ((rel) => readFileSync(resolve(root, rel), 'utf8'));
  const sources = new Map();
  const failures = [];

  const rows = [
    ...(contract.paths || []).map((row) => ({ row, shipped: true })),
    ...(contract.upcoming || []).map((row) => ({ row, shipped: false })),
  ];

  for (const { row, shipped } of rows) {
    const where = shipped ? 'paths' : 'upcoming';
    const verbatim = row.check;
    const substring = row.check_includes;
    const needle = verbatim ?? substring;

    if (needle === undefined) {
      failures.push(`${where}/${row.id}: names neither check nor check_includes`);
      continue;
    }
    if (!shipped && isPlaceholder(needle)) continue;

    const file = contract.suites?.[row.suite];
    if (!file) {
      failures.push(
        `${where}/${row.id}: suite "${row.suite}" is not in the suites map — add the suite and its file, or point the row at one that is`,
      );
      continue;
    }
    if (!sources.has(file)) {
      try {
        sources.set(file, read(file));
      } catch (err) {
        sources.set(file, null);
        failures.push(`${where}/${row.id}: suite file ${file} is unreadable (${err.message})`);
      }
    }
    const source = sources.get(file);
    if (source == null) continue;

    const found = verbatim !== undefined ? source.includes(verbatim) : source.includes(substring);
    if (!found) {
      failures.push(
        `${where}/${row.id}: ${file} contains no ${verbatim !== undefined ? 'check' : 'check_includes'} "${needle}" — the row claims coverage that does not exist`,
      );
    }
  }
  return failures;
}

function main(argv = process.argv.slice(2)) {
  const contract = loadContract();

  if (argv.includes('--stamp')) {
    const stamped = contextFingerprint(contract);
    // Surgical replacement rather than a re-serialize: JSON.stringify would
    // rewrite every escaped character in the file, burying a one-line stamp
    // under a diff nobody can read.
    const before = readFileSync(CONTRACT_FILE, 'utf8');
    const after = before.replace(
      /("sha256":\s*)"[0-9a-f]*"/,
      (_, head) => `${head}"${stamped}"`,
    );
    if (after === before && !before.includes(stamped)) {
      console.error('coverage-contract: no context.sha256 field to restamp');
      return 1;
    }
    writeFileSync(CONTRACT_FILE, after);
    console.log(`coverage-contract: context restamped ${stamped}`);
    return 0;
  }

  const failures = coverageFailures(contract);
  for (const line of failures) console.error(`  FAIL ${line}`);
  if (failures.length) {
    console.error(
      `\ncoverage-contract: ${failures.length} row(s) name a check nothing runs.\n` +
        '  Write the check, or correct the row to name the one that covers it — do not\n' +
        '  delete a row without deciding what happened to the capability it claimed.\n',
    );
    return 1;
  }

  const rows = (contract.paths || []).length + (contract.upcoming || []).length;
  const suites = Object.keys(contract.suites || {}).join(', ');
  console.log(`coverage-contract: ok (${rows} rows across ${suites})`);

  const fingerprint = contextFingerprint(contract);
  if (fingerprint !== contract.context?.sha256) {
    console.log(
      'coverage-contract: WARN domain context moved since these rows were last reviewed —\n' +
        `  read them against ${(contract.context?.files || []).join(', ')}, then restamp:\n` +
        '  node test/app/coverage-contract.mjs --stamp',
    );
  }
  return 0;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exit(main());
