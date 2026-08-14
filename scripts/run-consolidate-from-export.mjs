#!/usr/bin/env node
/**
 * Run Node consolidate from a Databricks-exported queue (E0.5 orchestration hook).
 *
 *   node scripts/run-consolidate-from-export.mjs --queue data/consolidate/queue.json
 *   node scripts/run-consolidate-from-export.mjs --queue data/databricks/bronze/consolidate-export.json --apply
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { queue: path.join(ROOT, 'data', 'consolidate', 'queue.json'), apply: false, venue: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--queue') out.queue = path.resolve(argv[++i]);
    else if (a === '--venue') out.venue = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const flags = [
  '--json',
  '--queue',
  args.queue,
  args.apply ? '--apply' : '--dry-run',
  '--force',
];
if (args.venue) flags.push('--venue', args.venue);

execSync(`npm run venues:consolidate -- ${flags.map((f) => `"${f}"`).join(' ')}`, {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
