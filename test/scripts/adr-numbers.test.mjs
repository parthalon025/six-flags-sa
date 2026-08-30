#!/usr/bin/env node
/**
 * ADR numbering — one number, one ADR.
 *
 * Two ADRs that both claimed `0008` made every "see ADR-0008" citation in the
 * repo ambiguous, and nothing noticed for two weeks. The letter suffix is the
 * repo's answer (the earlier filing keeps `0008`, the later one becomes
 * `0008a`), so the check has to treat `0008` and `0008a` as different ADRs and
 * only a repeated *full* id as drift.
 *
 *   node test/scripts/adr-numbers.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IGNORED_ADR_FILES,
  adrDriftReport,
  formatAdrDrift,
  parseAdrFilename,
} from '../../scripts/lib/adr-numbers.mjs';
import { runAdrNumbersCheck } from '../../scripts/ci/adr-numbers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Fixture names, assembled so a repo-wide rename sweep cannot rewrite them. */
const bare = (n, slug) => `${n}-${slug}.md`;
const suffixed = (n, letter, slug) => `${n}${letter}-${slug}.md`;

// ── parseAdrFilename ────────────────────────────────────────────────────────
assert.deepEqual(
  parseAdrFilename(bare('0008', 'plan-one-list')),
  { file: '0008-plan-one-list.md', number: '0008', letter: '', id: '0008', slug: 'plan-one-list' },
  'a bare-numbered ADR parses with an empty letter',
);
assert.deepEqual(
  parseAdrFilename(suffixed('0008', 'a', 'databricks-back-office')),
  {
    file: '0008a-databricks-back-office.md',
    number: '0008',
    letter: 'a',
    id: '0008a',
    slug: 'databricks-back-office',
  },
  'a letter suffix parses as its own ADR id under the same number',
);
assert.equal(parseAdrFilename('notes.md'), null, 'a file with no leading number is not an ADR');
assert.equal(parseAdrFilename('008-short.md'), null, 'ADR numbers are exactly four digits');
assert.equal(parseAdrFilename('0008A-shouty.md'), null, 'letter suffixes are lowercase');
assert.equal(
  parseAdrFilename('0008aa-typo.md'),
  null,
  'one letter only — the second collision on a number is b, not aa',
);

// ── collisions ──────────────────────────────────────────────────────────────
{
  const report = adrDriftReport([
    bare('0008', 'plan-one-list'),
    bare('0008', 'databricks-back-office'),
    bare('0009', 'ship-gaps'),
  ]);
  assert.equal(report.ok, false, 'two files claiming 0008 is drift');
  assert.deepEqual(report.collisions, [
    { id: '0008', files: ['0008-databricks-back-office.md', '0008-plan-one-list.md'] },
  ]);
  assert.deepEqual(report.malformed, []);
}

{
  const report = adrDriftReport([
    bare('0008', 'plan-one-list'),
    suffixed('0008', 'a', 'databricks-back-office'),
  ]);
  assert.equal(
    report.ok,
    true,
    '0008 and 0008a are different ADRs — the renumbering fix, not drift',
  );
  assert.deepEqual(report.collisions, []);
}

{
  const report = adrDriftReport([suffixed('0008', 'a', 'one'), suffixed('0008', 'a', 'two')]);
  assert.deepEqual(
    report.collisions,
    [{ id: '0008a', files: ['0008a-one.md', '0008a-two.md'] }],
    'a repeated suffixed id collides too — the suffix is an id, not an escape hatch',
  );
}

{
  const report = adrDriftReport([
    bare('0026', 'venue-geometry-inline-vs-tiles'),
    suffixed('0026', 'a', 'upstash-relay-store'),
    bare('0011', 'facing-compass'),
    suffixed('0011', 'a', 'profile-billing-entitlements'),
    bare('0011', 'third-claimant'),
  ]);
  assert.deepEqual(
    report.collisions,
    [{ id: '0011', files: ['0011-facing-compass.md', '0011-third-claimant.md'] }],
    'only the repeated id is reported; the suffixed neighbours are left alone',
  );
}

// ── non-ADR files ───────────────────────────────────────────────────────────
{
  const report = adrDriftReport([
    bare('0001', 'auth-profiles'),
    ...IGNORED_ADR_FILES,
    'diagram.png',
  ]);
  assert.equal(report.ok, true, 'index files and non-markdown files are not ADRs');
  assert.deepEqual(report.malformed, []);
}
{
  const report = adrDriftReport([bare('0001', 'auth-profiles'), 'thoughts-on-auth.md']);
  assert.equal(report.ok, false, 'a stray .md in docs/adr is drift too — it has no number to cite');
  assert.deepEqual(report.malformed, ['thoughts-on-auth.md']);
}

// ── the failure message names the files ─────────────────────────────────────
{
  const message = formatAdrDrift(
    adrDriftReport([bare('0010', 'clerk-profile-signup'), bare('0010', 'databricks-ops-free-tier')]),
  );
  assert.match(message, /ADR-0010/);
  assert.match(message, /0010-clerk-profile-signup\.md/);
  assert.match(message, /0010-databricks-ops-free-tier\.md/);
  assert.match(message, /0010a-/, 'the message tells the reader how to fix it');
  assert.equal(formatAdrDrift(adrDriftReport([bare('0010', 'clerk-profile-signup')])), '');
}

// ── CLI decision over a real directory ──────────────────────────────────────
{
  const dir = join(mkdtempSync(join(tmpdir(), 'adr-numbers-')), 'adr');
  mkdirSync(dir);
  const colliding = join(dir, bare('0008', 'databricks-back-office'));
  writeFileSync(join(dir, bare('0008', 'plan-one-list')), '# Plan is one shared list\n');
  writeFileSync(colliding, '# ADR-0008: Databricks\n');

  const logged = [];
  assert.equal(
    runAdrNumbersCheck({ dir, log: (m) => logged.push(m) }),
    1,
    'a colliding directory exits non-zero',
  );
  assert.match(logged.join('\n'), /0008-databricks-back-office\.md/);

  rmSync(colliding);
  writeFileSync(
    join(dir, suffixed('0008', 'a', 'databricks-back-office')),
    '# ADR-0008a: Databricks\n',
  );
  const cleanLog = [];
  assert.equal(
    runAdrNumbersCheck({ dir, log: (m) => cleanLog.push(m) }),
    0,
    'renumbering with a letter suffix clears the check',
  );
  assert.deepEqual(cleanLog, [], 'a clean run says nothing on the error channel');
}

// ── the repo's own docs/adr ─────────────────────────────────────────────────
{
  const report = adrDriftReport(readdirSync(join(root, 'docs/adr')));
  assert.equal(report.ok, true, `docs/adr drift:\n${formatAdrDrift(report)}`);
}

console.log('adr-numbers: ok');
