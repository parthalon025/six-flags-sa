#!/usr/bin/env node
/**
 * CONTEXT.md mirror audit — advisory vocabulary drift report.
 *
 *   npm run context:mirror
 *   node scripts/context-mirror.mjs [--out path]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditContextMirror,
  renderContextMirrorReport,
} from './lib/context-mirror.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contextPath = join(root, 'CONTEXT.md');

const outArg = process.argv.indexOf('--out');
const outPath =
  outArg >= 0 ? process.argv[outArg + 1] : join(root, 'context-mirror-audit.md');

const contextMarkdown = readFileSync(contextPath, 'utf8');
const audit = auditContextMirror({ contextMarkdown, cwd: root });
const report = renderContextMirrorReport(audit);

writeFileSync(outPath, report, 'utf8');
console.log(`context-mirror: wrote ${outPath} (${audit.findings.length} finding(s))`);
process.exit(0);
